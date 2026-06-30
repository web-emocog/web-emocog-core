/**
 * Auth: регистрация, логин, JWT (Фаза 2.2).
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../db');
const config = require('../config');
const { requireAuth, requireRole, requirePlatformAdmin, ROLES, isBypassAdminEmail, isPlatformAdmin } = require('../middleware/auth');

const router = express.Router();
const PUBLIC_REGISTER_ROLE = 'researcher';
const LEAD_EMAILS = new Set((config.security?.projectLeadEmails || []).map((v) => String(v).toLowerCase()));
const ADMIN_EMAILS = new Set((config.security?.projectAdminEmails || []).map((v) => String(v).toLowerCase()));

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isProjectLeadEmail(email) {
  return !!email && LEAD_EMAILS.has(normalizeEmail(email));
}

function isProjectAdminEmail(email) {
  return !!email && ADMIN_EMAILS.has(normalizeEmail(email));
}

function getEffectiveRole(email, role) {
  if (isBypassAdminEmail(email) || isProjectAdminEmail(email)) return 'admin';
  return role;
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

const registerSchema = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('min 8 chars'),
  body('display_name').optional().trim().isLength({ max: 255 }),
];

const loginSchema = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
];

router.post(
  '/register',
  registerSchema,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { email, password, display_name } = req.body;
      // Public registration: researcher by default; configured lead emails may bootstrap as admin.
      const role = (isProjectAdminEmail(email) || isBypassAdminEmail(email)) ? 'admin' : PUBLIC_REGISTER_ROLE;
      const password_hash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role, display_name, created_at`,
        [email, password_hash, role, display_name || null]
      );
      const user = result.rows[0];
      const effectiveRole = getEffectiveRole(user.email, user.role);
      try {
        const defaultOrg = await pool.query('SELECT organization_id FROM projects WHERE id = 1 LIMIT 1');
        const orgId = defaultOrg.rows[0]?.organization_id;
        if (orgId) {
          await pool.query(
            `INSERT INTO user_organizations (user_id, organization_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, organization_id) DO NOTHING`,
            [user.id, orgId, effectiveRole]
          );
        }
      } catch (orgErr) {
        console.warn('[auth/register] default org link skipped:', orgErr.message);
      }
      const token = jwt.sign(
        { sub: user.id, email: user.email, role: effectiveRole, bypass_admin: isBypassAdminEmail(user.email) },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );
      res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          role: effectiveRole,
          display_name: user.display_name,
          bypass_admin: isBypassAdminEmail(user.email),
        },
        token,
      });
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
        'SELECT id, email, password_hash, role, display_name FROM users WHERE email = $1',
        [email]
      );
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const effectiveRole = getEffectiveRole(user.email, user.role);
      const token = jwt.sign(
        { sub: user.id, email: user.email, role: effectiveRole, bypass_admin: isBypassAdminEmail(user.email) },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );
      res.json({
        user: {
          id: user.id,
          email: user.email,
          role: effectiveRole,
          display_name: user.display_name,
          bypass_admin: isBypassAdminEmail(user.email),
        },
        token,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

router.get('/me', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, email, role, display_name, created_at FROM users WHERE id = $1',
      [req.user.sub]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'User not found' });
    const user = r.rows[0];
    const effectiveRole = getEffectiveRole(user.email, user.role);
    res.json({ ...user, role: effectiveRole, bypass_admin: isBypassAdminEmail(user.email) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/permissions', requireAuth, async (req, res) => {
  const isLead = isProjectLeadEmail(req.user?.email);
  const platformAdmin = isPlatformAdmin(req.user);
  const labElevated =
    platformAdmin ||
    req.user?.role === 'PI' ||
    isProjectAdminEmail(req.user?.email) ||
    isBypassAdminEmail(req.user?.email);
  res.json({
    is_project_lead: isLead,
    is_platform_admin: platformAdmin,
    is_admin: labElevated,
    can_open_admin_panel: platformAdmin,
    can_grant_developer: platformAdmin,
    can_grant_admin: platformAdmin,
    lead_emails_configured: LEAD_EMAILS.size,
    admin_emails_configured: ADMIN_EMAILS.size,
  });
});

router.patch(
  '/me/password',
  requireAuth,
  [
    body('currentPassword').isString().isLength({ min: 1 }),
    body('newPassword').isString().isLength({ min: 8 }),
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
         SET password_hash = $1, updated_at = current_timestamp
         WHERE id = $2`,
        [passwordHash, user.id]
      );

      res.json({ ok: true, message: 'Password updated' });
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
      const updated = await pool.query(
        `UPDATE users
         SET role = 'developer', updated_at = current_timestamp
         WHERE email = $1
         RETURNING id, email, role, display_name, created_at, updated_at`,
        [email]
      );
      if (!updated.rows[0]) {
        return res.status(404).json({ error: 'User with this email not found' });
      }
      res.json(updated.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to grant developer access' });
    }
  }
);

router.get(
  '/users',
  requireAuth,
  requireRole('admin', 'PI'),
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
         LEFT JOIN user_organizations uo ON uo.user_id = u.id
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
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('min 8 chars'),
    body('role').isIn(ROLES),
    body('display_name').optional().trim().isLength({ max: 255 }),
    body('organization_ids').optional().isArray(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password, role, display_name, organization_ids } = req.body;
      if (!(await canManageRole(req.user, role, email))) {
        return res.status(403).json({ error: 'Insufficient role to create this account type' });
      }

      const orgIds = Array.isArray(organization_ids)
        ? [...new Set(organization_ids.map((v) => parseInt(v, 10)).filter(Number.isInteger))]
        : [];
      if (orgIds.length > 0 && req.user.role !== 'admin' && req.user.role !== 'PI') {
        const access = await pool.query(
          'SELECT organization_id FROM user_organizations WHERE user_id = $1',
          [req.user.sub]
        );
        const allowed = new Set(access.rows.map((row) => row.organization_id));
        const denied = orgIds.filter((id) => !allowed.has(id));
        if (denied.length > 0) {
          return res.status(403).json({ error: 'Cannot assign user to organizations you do not belong to' });
        }
      }

      const password_hash = await bcrypt.hash(password, 10);
      const created = await pool.query(
        `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role, display_name, created_at`,
        [email, password_hash, role, display_name || null]
      );
      const user = created.rows[0];

      if (orgIds.length > 0) {
        for (const orgId of orgIds) {
          await pool.query(
            `INSERT INTO user_organizations (user_id, organization_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, organization_id) DO NOTHING`,
            [user.id, orgId, 'member']
          );
        }
      }

      res.status(201).json(user);
    } catch (err) {
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
  [
    param('id').isInt({ min: 1 }),
    body('role').optional().isIn(ROLES),
    body('display_name').optional().trim().isLength({ max: 255 }),
    body('password').optional().isLength({ min: 8 }).withMessage('min 8 chars'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const targetUserId = parseInt(req.params.id, 10);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ error: 'Invalid user id' });
      }
      const target = await pool.query('SELECT id, role, email FROM users WHERE id = $1', [targetUserId]);
      if (!target.rows[0]) return res.status(404).json({ error: 'User not found' });
      const targetRow = target.rows[0];
      const targetElevated = targetRow.role === 'admin' || targetRow.role === 'PI';
      if (targetElevated && !isPlatformAdmin(req.user)) {
        return res.status(403).json({ error: 'Only platform administrator can manage this user' });
      }

      const updates = [];
      const values = [];
      let i = 1;
      if (req.body.role !== undefined) {
        if (!(await canManageRole(req.user, req.body.role, targetRow.email))) {
          return res.status(403).json({ error: 'Insufficient role to assign target role' });
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
      if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

      values.push(targetUserId);
      const r = await pool.query(
        `UPDATE users
         SET ${updates.join(', ')}, updated_at = current_timestamp
         WHERE id = $${i}
         RETURNING id, email, role, display_name, created_at, updated_at`,
        values
      );
      res.json(r.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
);

module.exports = router;
