/**
 * Auth: регистрация, логин, JWT (Фаза 2.2).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const config = require('../config');
const { withTransaction } = require('../db/transaction');
const {
  requireAuth,
  requireRole,
  requireOperation,
  requirePlatformAdmin,
  OPERATIONS,
  ROLES,
  isPlatformAdmin,
  buildPermissionSnapshot,
} = require('../middleware/auth');

const router = express.Router();
const PUBLIC_REGISTER_ROLE = 'respondent';
const TENANT_SCOPED_STAFF_ROLES = new Set([
  'PI',
  'researcher',
  'analyst',
  'assistant',
  'developer',
]);
const PASSWORD_MIN_LENGTH = 12;
const BCRYPT_MAX_PASSWORD_BYTES = 72;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('invalid-login-password-placeholder', 10);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function passwordValidator(field, options = {}) {
  let validator = body(field);
  if (options.optional) validator = validator.optional();
  return validator
    .isString()
    .isLength({ min: PASSWORD_MIN_LENGTH, max: BCRYPT_MAX_PASSWORD_BYTES })
    .withMessage(`password must be ${PASSWORD_MIN_LENGTH}-${BCRYPT_MAX_PASSWORD_BYTES} characters`)
    .custom(value => {
      if (Buffer.byteLength(value, 'utf8') > BCRYPT_MAX_PASSWORD_BYTES) {
        throw new Error(`password must not exceed ${BCRYPT_MAX_PASSWORD_BYTES} UTF-8 bytes`);
      }
      return true;
    });
}

function loginPasswordValidator(field) {
  return body(field)
    .isString()
    .isLength({ min: 1, max: BCRYPT_MAX_PASSWORD_BYTES })
    .custom(value => {
      if (Buffer.byteLength(value, 'utf8') > BCRYPT_MAX_PASSWORD_BYTES) {
        throw new Error('invalid password length');
      }
      return true;
    });
}

function issueStaffToken(user, csrf = null) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      ver: Number(user.token_version || 0),
      ...(csrf ? { csrf } : {}),
    },
    config.jwt.secret,
    {
      algorithm: 'HS256',
      issuer: config.jwt.staffIssuer,
      audience: config.jwt.staffAudience,
      expiresIn: config.jwt.expiresIn,
    }
  );
}

function wantsCookieTransport(req) {
  return req.authTransport === 'cookie'
    || String(req.get('X-Auth-Transport') || '').toLowerCase() === 'cookie';
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
  };
}

function buildAuthResponse(req, res, user) {
  const browserCookie = wantsCookieTransport(req);
  const csrf = browserCookie ? crypto.randomBytes(32).toString('base64url') : null;
  const token = issueStaffToken(user, csrf);
  if (browserCookie) res.cookie(config.auth.staffCookieName, token, cookieOptions());
  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      display_name: user.display_name,
    },
    ...(browserCookie ? { csrf_token: csrf, auth_transport: 'cookie' } : { token, auth_transport: 'bearer' }),
  };
}

async function isDeveloperEmailAllowed(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const r = await pool.query('SELECT 1 FROM developer_access_emails WHERE email = $1', [normalized]);
  return !!r.rows[0];
}

async function canManageRole(actor, targetRole, targetEmail) {
  if (!actor || !actor.role || !targetRole) return false;
  const platform = isPlatformAdmin(actor);
  if (targetRole === 'admin' || targetRole === 'PI') {
    return platform;
  }
  if (targetRole === 'developer') {
    if (!platform) return false;
    return isDeveloperEmailAllowed(targetEmail);
  }
  if (platform) return true;
  if (actor.role === 'PI') return true;
  return false;
}

async function hasContainedTenantScope(queryable, actorUserId, targetUserId) {
  const result = await queryable.query(
    `SELECT
       EXISTS (
         SELECT 1
         FROM user_projects target_up
         INNER JOIN projects p ON p.id = target_up.project_id
         INNER JOIN user_organizations target_uo
           ON target_uo.user_id = target_up.user_id
          AND target_uo.organization_id = p.organization_id
         INNER JOIN user_projects actor_up
           ON actor_up.user_id = $1
          AND actor_up.project_id = target_up.project_id
         INNER JOIN user_organizations actor_uo
           ON actor_uo.user_id = actor_up.user_id
          AND actor_uo.organization_id = p.organization_id
         WHERE target_up.user_id = $2
       ) AS has_shared_project,
       NOT EXISTS (
         SELECT 1
         FROM user_organizations target_uo
         LEFT JOIN user_organizations actor_uo
           ON actor_uo.user_id = $1
          AND actor_uo.organization_id = target_uo.organization_id
         WHERE target_uo.user_id = $2
           AND actor_uo.user_id IS NULL
       ) AS organizations_contained,
       NOT EXISTS (
         SELECT 1
         FROM user_projects target_up
         INNER JOIN projects p ON p.id = target_up.project_id
         LEFT JOIN user_organizations target_uo
           ON target_uo.user_id = target_up.user_id
          AND target_uo.organization_id = p.organization_id
         LEFT JOIN user_projects actor_up
           ON actor_up.user_id = $1
          AND actor_up.project_id = target_up.project_id
         LEFT JOIN user_organizations actor_uo
           ON actor_uo.user_id = $1
          AND actor_uo.organization_id = p.organization_id
         WHERE target_up.user_id = $2
           AND (
             target_uo.user_id IS NULL
             OR actor_up.user_id IS NULL
             OR actor_uo.user_id IS NULL
           )
       ) AS projects_contained`,
    [actorUserId, targetUserId]
  );
  const scope = result.rows[0];
  return Boolean(
    scope?.has_shared_project
    && scope.organizations_contained
    && scope.projects_contained
  );
}

const registerSchema = [
  body('email').isEmail().normalizeEmail(),
  passwordValidator('password'),
  body('display_name').optional().trim().isLength({ max: 255 }),
];

const loginSchema = [
  body('email').isEmail().normalizeEmail(),
  loginPasswordValidator('password'),
];

router.post(
  '/register',
  registerSchema,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { email, password, display_name } = req.body;
      // Public registration never grants staff access or tenant membership.
      const role = PUBLIC_REGISTER_ROLE;
      const password_hash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role, display_name, token_version, created_at`,
        [email, password_hash, role, display_name || null]
      );
      const user = result.rows[0];
      res.status(201).json(buildAuthResponse(req, res, user));
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
      console.error(err);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

router.post(
  '/login',
  loginSchema,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { email, password } = req.body;
      const result = await pool.query(
        `SELECT id, email, password_hash, role, display_name, token_version
         FROM users
         WHERE email = $1`,
        [email]
      );
      const user = result.rows[0];
      const passwordMatches = await bcrypt.compare(
        password,
        user?.password_hash || DUMMY_PASSWORD_HASH
      );
      if (!user || !passwordMatches) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      res.json(buildAuthResponse(req, res, user));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

router.post('/logout', (req, res) => {
  res.clearCookie(config.auth.staffCookieName, cookieOptions());
  res.status(204).send();
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, email, role, display_name, created_at FROM users WHERE id = $1',
      [req.user.sub]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({
      ...r.rows[0],
      ...(req.authTransport === 'cookie' && req.user.csrf
        ? { csrf_token: req.user.csrf, auth_transport: 'cookie' }
        : { auth_transport: 'bearer' }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/permissions', requireAuth, async (req, res) => {
  const platformAdmin = isPlatformAdmin(req.user);
  res.json({
    ...buildPermissionSnapshot(req.user),
    is_project_lead: req.user?.role === 'PI',
    is_platform_admin: platformAdmin,
    is_admin: platformAdmin || req.user?.role === 'PI',
    can_open_admin_panel: platformAdmin,
    can_grant_developer: platformAdmin,
    can_grant_admin: platformAdmin,
  });
});

router.patch(
  '/me/password',
  requireAuth,
  [
    loginPasswordValidator('currentPassword'),
    passwordValidator('newPassword'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const currentPassword = String(req.body.currentPassword || '');
      const newPassword = String(req.body.newPassword || '');
      if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'New password must be different from current password' });
      }

      const userRes = await pool.query('SELECT id, email, password_hash FROM users WHERE id = $1', [req.user.sub]);
      const user = userRes.rows[0];
      if (!user) return res.status(404).json({ error: 'User not found' });

      const ok = await bcrypt.compare(currentPassword, user.password_hash);
      if (!ok) return res.status(400).json({ error: 'Current password is invalid' });

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        `UPDATE users
         SET password_hash = $1,
             token_version = token_version + 1,
             updated_at = current_timestamp
         WHERE id = $2`,
        [passwordHash, user.id]
      );
      const refreshed = await pool.query(
        'SELECT id, email, role, display_name, token_version FROM users WHERE id = $1',
        [user.id]
      );
      const auth = req.authTransport === 'cookie'
        ? buildAuthResponse(req, res, refreshed.rows[0])
        : {};
      res.json({ ok: true, message: 'Password updated', ...auth });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update password' });
    }
  }
);

router.get(
  '/developer-access-emails',
  requireAuth,
  requirePlatformAdmin,
  async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT dae.id, dae.email, dae.granted_by_user_id, dae.created_at,
                u.email AS granted_by_email
         FROM developer_access_emails dae
         LEFT JOIN users u ON u.id = dae.granted_by_user_id
         ORDER BY dae.created_at DESC`
      );
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load developer access emails' });
    }
  }
);

router.post(
  '/developer-access-emails',
  requireAuth,
  requirePlatformAdmin,
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const email = normalizeEmail(req.body.email);
      const r = await pool.query(
        `INSERT INTO developer_access_emails (email, granted_by_user_id)
         VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id, email, granted_by_user_id, created_at`,
        [email, req.user.sub]
      );
      res.status(201).json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to add developer access email' });
    }
  }
);

router.delete(
  '/developer-access-emails/:id',
  requireAuth,
  requirePlatformAdmin,
  [param('id').isInt({ min: 1 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const r = await pool.query('DELETE FROM developer_access_emails WHERE id = $1 RETURNING id', [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to remove developer access email' });
    }
  }
);

router.post(
  '/grant-developer-access',
  requireAuth,
  requirePlatformAdmin,
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const email = normalizeEmail(req.body.email);
      const allowed = await isDeveloperEmailAllowed(email);
      if (!allowed) {
        return res.status(403).json({ error: 'Email is not in developer access list' });
      }
      const updatedUser = await withTransaction(pool, async client => {
        const target = await client.query(
          `SELECT id, email, role
           FROM users
           WHERE email = $1
           FOR UPDATE`,
          [email]
        );
        if (!target.rows[0]) {
          throw Object.assign(
            new Error('User with this email not found'),
            { status: 404, code: 'user_not_found' }
          );
        }
        const membership = await client.query(
          `SELECT up.project_id
           FROM users u
           INNER JOIN user_projects up ON up.user_id = u.id
           INNER JOIN projects p ON p.id = up.project_id
           INNER JOIN user_organizations uo
             ON uo.user_id = u.id
            AND uo.organization_id = p.organization_id
           WHERE u.id = $1
           LIMIT 1
           FOR KEY SHARE OF u, up, p, uo`,
          [target.rows[0].id]
        );
        if (!membership.rows[0]) {
          throw Object.assign(
            new Error('Developer requires organization and project membership'),
            { status: 400, code: 'staff_membership_required' }
          );
        }
        const updated = await client.query(
          `UPDATE users
           SET role = 'developer',
               token_version = token_version + 1,
               updated_at = current_timestamp
           WHERE id = $1
           RETURNING id, email, role, display_name, created_at, updated_at`,
          [target.rows[0].id]
        );
        return updated.rows[0];
      });
      res.json(updatedUser);
    } catch (err) {
      if (err.status && err.code) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      console.error(err);
      res.status(500).json({ error: 'Failed to grant developer access' });
    }
  }
);

router.get(
  '/users',
  requireAuth,
  requireRole('admin', 'PI'),
  requireOperation(OPERATIONS.USER_MANAGE),
  [
    query('role').optional().isIn(ROLES),
    query('q').optional().isString(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const filters = [];
      const params = [];
      let i = 1;
      const platformAdmin = isPlatformAdmin(req.user);
      const scopeJoins = platformAdmin
        ? ''
        : `
          INNER JOIN user_projects target_up ON target_up.user_id = u.id
          INNER JOIN user_projects actor_up
            ON actor_up.project_id = target_up.project_id AND actor_up.user_id = $1
          INNER JOIN projects scope_project ON scope_project.id = actor_up.project_id
          INNER JOIN user_organizations actor_uo
            ON actor_uo.organization_id = scope_project.organization_id
           AND actor_uo.user_id = actor_up.user_id
          INNER JOIN user_organizations target_uo
            ON target_uo.organization_id = scope_project.organization_id
           AND target_uo.user_id = target_up.user_id
        `;
      const organizationJoin = platformAdmin
        ? 'LEFT JOIN user_organizations uo ON uo.user_id = u.id'
        : `LEFT JOIN user_organizations uo
             ON uo.user_id = u.id
            AND uo.organization_id = scope_project.organization_id`;
      if (!platformAdmin) {
        params.push(req.user.sub);
        i += 1;
      }
      if (req.query.role) {
        filters.push(`u.role = $${i++}`);
        params.push(req.query.role);
      }
      if (req.query.q) {
        filters.push(`(u.email ILIKE $${i} OR COALESCE(u.display_name, '') ILIKE $${i})`);
        params.push(`%${req.query.q}%`);
        i += 1;
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const r = await pool.query(
        `SELECT
           u.id,
           u.email,
           u.role,
           u.display_name,
           u.created_at,
           COALESCE(
             ARRAY_AGG(DISTINCT uo.organization_id) FILTER (WHERE uo.organization_id IS NOT NULL),
             '{}'
           ) AS organization_ids
         FROM users u
         ${scopeJoins}
         ${organizationJoin}
         ${where}
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT 500`,
        params
      );
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load users' });
    }
  }
);

router.post(
  '/users',
  requireAuth,
  requireRole('admin', 'PI'),
  requireOperation(OPERATIONS.USER_MANAGE),
  [
    body('email').isEmail().normalizeEmail(),
    passwordValidator('password'),
    body('role').isIn(ROLES),
    body('display_name').optional().trim().isLength({ max: 255 }),
    body('organization_ids').optional().isArray(),
    body('organization_ids.*').optional().isInt({ min: 1 }),
    body('project_ids').optional().isArray(),
    body('project_ids.*').optional().isInt({ min: 1 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password, role, display_name, organization_ids, project_ids } = req.body;
      if (!(await canManageRole(req.user, role, email))) {
        return res.status(403).json({ error: 'Insufficient role to create this account type' });
      }

      const orgIds = Array.isArray(organization_ids)
        ? [...new Set(organization_ids.map((v) => parseInt(v, 10)).filter(Number.isInteger))]
        : [];
      const projectIds = Array.isArray(project_ids)
        ? [...new Set(project_ids.map((v) => parseInt(v, 10)).filter(Number.isInteger))]
        : [];
      if (
        TENANT_SCOPED_STAFF_ROLES.has(role)
        && (orgIds.length === 0 || projectIds.length === 0)
      ) {
        return res.status(400).json({
          error: 'Tenant-scoped staff require at least one organization and project membership',
          code: 'staff_membership_required',
        });
      }
      const password_hash = await bcrypt.hash(password, 10);
      const user = await withTransaction(pool, async client => {
        if (orgIds.length > 0) {
          const organizationAccess = isPlatformAdmin(req.user)
            ? await client.query(
              'SELECT id FROM organizations WHERE id = ANY($1::int[]) FOR KEY SHARE',
              [orgIds]
            )
            : await client.query(
              `SELECT organization_id AS id
               FROM user_organizations
               WHERE user_id = $1 AND organization_id = ANY($2::int[])
               FOR KEY SHARE`,
              [req.user.sub, orgIds]
            );
          if (organizationAccess.rows.length !== orgIds.length) {
            throw Object.assign(
              new Error('Cannot assign user to organizations you do not belong to'),
              { status: 403, code: 'organization_assignment_denied' }
            );
          }
        }
        let projectAccessRows = [];
        if (projectIds.length > 0) {
          const projectAccess = isPlatformAdmin(req.user)
            ? await client.query(
              `SELECT id, organization_id
               FROM projects
               WHERE id = ANY($1::int[])
               FOR KEY SHARE`,
              [projectIds]
            )
            : await client.query(
              `SELECT p.id, p.organization_id
               FROM projects p
               INNER JOIN user_projects up ON up.project_id = p.id AND up.user_id = $1
               INNER JOIN user_organizations uo
                 ON uo.organization_id = p.organization_id AND uo.user_id = up.user_id
               WHERE p.id = ANY($2::int[])
               FOR KEY SHARE OF p, up, uo`,
              [req.user.sub, projectIds]
            );
          projectAccessRows = projectAccess.rows;
          if (projectAccessRows.length !== projectIds.length) {
            throw Object.assign(
              new Error('Cannot assign user to projects you do not belong to'),
              { status: 403, code: 'project_assignment_denied' }
            );
          }
          const projectOrgIds = new Set(
            projectAccessRows.map(row => Number(row.organization_id))
          );
          const missingOrganizations = [...projectOrgIds]
            .filter(orgId => !orgIds.includes(orgId));
          if (missingOrganizations.length > 0) {
            throw Object.assign(
              new Error('Every project assignment requires the matching organization assignment'),
              {
                status: 400,
                code: 'project_organization_membership_required',
                organizationIds: missingOrganizations,
              }
            );
          }
        }

        const created = await client.query(
          `INSERT INTO users (email, password_hash, role, display_name)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, role, display_name, created_at`,
          [email, password_hash, role, display_name || null]
        );
        const createdUser = created.rows[0];
        if (orgIds.length > 0) {
          await client.query(
            `INSERT INTO user_organizations (user_id, organization_id, role)
             SELECT $1, value, 'member'
             FROM unnest($2::int[]) AS value`,
            [createdUser.id, orgIds]
          );
        }
        if (projectIds.length > 0) {
          await client.query(
            `INSERT INTO user_projects (user_id, project_id, role)
             SELECT $1, value, $2
             FROM unnest($3::int[]) AS value`,
            [createdUser.id, role, projectIds]
          );
        }
        return createdUser;
      });

      res.status(201).json(user);
    } catch (err) {
      if (err.status && err.code) {
        return res.status(err.status).json({
          error: err.message,
          code: err.code,
          ...(err.organizationIds ? { organization_ids: err.organizationIds } : {}),
        });
      }
      if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
      if (err.code === '23503') return res.status(400).json({ error: 'Organization not found' });
      console.error(err);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

router.patch(
  '/users/:id',
  requireAuth,
  requireRole('admin', 'PI'),
  requireOperation(OPERATIONS.USER_MANAGE),
  [
    param('id').isInt({ min: 1 }),
    body('role').optional().isIn(ROLES),
    body('display_name').optional().trim().isLength({ max: 255 }),
    passwordValidator('password', { optional: true }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const targetUserId = parseInt(req.params.id, 10);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ error: 'Invalid user id' });
      }
      const updatedUser = await withTransaction(pool, async client => {
        // The row lock also prevents a concurrent FK-backed membership grant
        // while tenant containment is being checked.
        const target = await client.query(
          'SELECT id, role, email FROM users WHERE id = $1 FOR UPDATE',
          [targetUserId]
        );
        if (!target.rows[0]) {
          throw Object.assign(new Error('User not found'), {
            status: 404,
            code: 'user_not_found',
          });
        }
        if (
          !isPlatformAdmin(req.user)
          && !(await hasContainedTenantScope(client, req.user.sub, targetUserId))
        ) {
          throw Object.assign(
            new Error('Cannot manage a user with memberships outside your tenant scope'),
            { status: 403, code: 'user_scope_not_contained' }
          );
        }
        const targetRow = target.rows[0];
        const targetElevated = targetRow.role === 'admin' || targetRow.role === 'PI';
        if (targetElevated && !isPlatformAdmin(req.user)) {
          throw Object.assign(
            new Error('Only platform administrator can manage this user'),
            { status: 403, code: 'platform_admin_required' }
          );
        }

        const updates = [];
        const values = [];
        let i = 1;
        if (req.body.role !== undefined) {
          if (!(await canManageRole(req.user, req.body.role, targetRow.email))) {
            throw Object.assign(
              new Error('Insufficient role to assign target role'),
              { status: 403, code: 'role_assignment_denied' }
            );
          }
          if (TENANT_SCOPED_STAFF_ROLES.has(req.body.role)) {
            const scopedMembership = await client.query(
              `SELECT 1
               FROM user_projects up
               INNER JOIN projects p ON p.id = up.project_id
               INNER JOIN user_organizations uo
                 ON uo.user_id = up.user_id
                AND uo.organization_id = p.organization_id
               WHERE up.user_id = $1
               LIMIT 1`,
              [targetUserId]
            );
            if (!scopedMembership.rows[0]) {
              throw Object.assign(
                new Error('Tenant-scoped staff require organization and project membership'),
                { status: 400, code: 'staff_membership_required' }
              );
            }
          }
          updates.push(`role = $${i++}`);
          values.push(req.body.role);
        }
        if (req.body.display_name !== undefined) {
          updates.push(`display_name = $${i++}`);
          values.push(req.body.display_name || null);
        }
        if (req.body.password !== undefined) {
          const passwordHash = await bcrypt.hash(req.body.password, 10);
          updates.push(`password_hash = $${i++}`);
          values.push(passwordHash);
        }
        if (updates.length === 0) {
          throw Object.assign(new Error('No fields to update'), {
            status: 400,
            code: 'no_fields_to_update',
          });
        }
        if (req.body.role !== undefined || req.body.password !== undefined) {
          updates.push('token_version = token_version + 1');
        }

        values.push(targetUserId);
        const result = await client.query(
          `UPDATE users
           SET ${updates.join(', ')}, updated_at = current_timestamp
           WHERE id = $${i}
           RETURNING id, email, role, display_name, created_at, updated_at`,
          values
        );
        return result.rows[0];
      }, { isolationLevel: 'SERIALIZABLE' });
      res.json(updatedUser);
    } catch (err) {
      if (err.status && err.code) {
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      if (err.code === '40001') {
        return res.status(409).json({
          error: 'User memberships changed concurrently; retry the request',
          code: 'user_update_conflict',
        });
      }
      console.error(err);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

module.exports = router;
