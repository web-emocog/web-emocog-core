/**
 * Canonical authentication, role permissions and tenant-scope checks.
 *
 * `admin` is the internal platform bootstrap role. User-facing organization
 * administrators use `org_admin`; developers have technical UI access but no
 * tenant data permissions.
 */
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { pool } = require('../db');

const ROLES = Object.freeze([
  'admin',
  'org_admin',
  'PI',
  'researcher',
  'analyst',
  'assistant',
  'developer',
  'respondent',
]);

const OPERATIONS = Object.freeze({
  ORGANIZATION_READ: 'organization.read',
  ORGANIZATION_MANAGE: 'organization.manage',
  PROJECT_READ: 'project.read',
  PROJECT_CREATE: 'project.create',
  PROJECT_UPDATE: 'project.update',
  PROJECT_DELETE: 'project.delete',
  PROTOCOL_READ: 'protocol.read',
  PROTOCOL_WRITE: 'protocol.write',
  PROTOCOL_PUBLISH: 'protocol.publish',
  INVITATION_READ: 'invitation.read',
  INVITATION_WRITE: 'invitation.write',
  SESSION_READ: 'session.read',
  SESSION_WRITE: 'session.write',
  ANALYTICS_READ: 'analytics.read',
  EXPORT_READ: 'export.read',
  STIMULUS_READ: 'stimulus.read',
  STIMULUS_WRITE: 'stimulus.write',
  USER_MANAGE: 'user.manage',
  PLATFORM_ADMIN: 'platform.admin',
});

const ALL_NON_PLATFORM_OPERATIONS = Object.values(OPERATIONS)
  .filter(operation => operation !== OPERATIONS.PLATFORM_ADMIN);

const ROLE_OPERATIONS = Object.freeze({
  admin: new Set(Object.values(OPERATIONS)),
  org_admin: new Set(ALL_NON_PLATFORM_OPERATIONS),
  PI: new Set(ALL_NON_PLATFORM_OPERATIONS),
  researcher: new Set([
    OPERATIONS.ORGANIZATION_READ,
    OPERATIONS.PROJECT_READ,
    OPERATIONS.PROJECT_CREATE,
    OPERATIONS.PROJECT_UPDATE,
    OPERATIONS.PROJECT_DELETE,
    OPERATIONS.PROTOCOL_READ,
    OPERATIONS.PROTOCOL_WRITE,
    OPERATIONS.PROTOCOL_PUBLISH,
    OPERATIONS.INVITATION_READ,
    OPERATIONS.INVITATION_WRITE,
    OPERATIONS.SESSION_READ,
    OPERATIONS.SESSION_WRITE,
    OPERATIONS.ANALYTICS_READ,
    OPERATIONS.EXPORT_READ,
    OPERATIONS.STIMULUS_READ,
    OPERATIONS.STIMULUS_WRITE,
  ]),
  analyst: new Set([
    OPERATIONS.ORGANIZATION_READ,
    OPERATIONS.PROJECT_READ,
    OPERATIONS.PROTOCOL_READ,
    OPERATIONS.INVITATION_READ,
    OPERATIONS.SESSION_READ,
    OPERATIONS.ANALYTICS_READ,
    OPERATIONS.EXPORT_READ,
    OPERATIONS.STIMULUS_READ,
  ]),
  assistant: new Set([
    OPERATIONS.ORGANIZATION_READ,
    OPERATIONS.PROJECT_READ,
    OPERATIONS.PROTOCOL_READ,
    OPERATIONS.INVITATION_READ,
    OPERATIONS.SESSION_READ,
    OPERATIONS.SESSION_WRITE,
    OPERATIONS.STIMULUS_READ,
  ]),
  developer: new Set(),
  respondent: new Set(),
});

function isPlatformAdmin(user) {
  return Boolean(user) && user.role === 'admin';
}

function isOrganizationAdmin(user) {
  return Boolean(user) && user.role === 'org_admin';
}

function canRolePerform(role, operation) {
  return ROLE_OPERATIONS[role]?.has(operation) === true;
}

function authenticateBearerHeader(authorization) {
  const auth = authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      issuer: config.jwt.staffIssuer,
      audience: config.jwt.staffAudience,
    });
  } catch (_) {
    return null;
  }
}

function authenticateStaffToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      issuer: config.jwt.staffIssuer,
      audience: config.jwt.staffAudience,
    });
  } catch (_) {
    return null;
  }
}

function safeTokenMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function resolveCurrentStaffPrincipal(queryable, authorization, cookieToken = null) {
  const payload = authenticateBearerHeader(authorization) || authenticateStaffToken(cookieToken);
  if (!payload || !Number.isInteger(payload.ver) || payload.ver < 0) return null;
  const result = await queryable.query(
    `SELECT id, email, role, token_version
     FROM users
     WHERE id = $1`,
    [payload.sub]
  );
  const user = result.rows[0];
  if (!user || Number(user.token_version) !== payload.ver) return null;
  return {
    ...payload,
    sub: user.id,
    email: user.email,
    role: user.role,
    ver: Number(user.token_version),
  };
}

async function requireAuth(req, res, next) {
  try {
    const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
    const cookieToken = hasBearer ? null : req.cookies?.[config.auth.staffCookieName];
    const principal = await resolveCurrentStaffPrincipal(pool, req.headers.authorization, cookieToken);
    if (!principal) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid, expired, or revoked token',
      });
    }
    if (cookieToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = req.get('X-CSRF-Token');
      if (!safeTokenMatch(principal.csrf, csrf)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Missing or invalid CSRF token',
          code: 'csrf_token_invalid',
        });
      }
    }
    req.user = principal;
    req.authTransport = cookieToken ? 'cookie' : 'bearer';
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles.length ? allowedRoles : ROLES);
  return (req, res, next) => {
    if (isPlatformAdmin(req.user)) return next();
    if (!req.user?.role) {
      return res.status(403).json({ error: 'Forbidden', message: 'Role required' });
    }
    // Existing routes name the legacy PI lead role. `org_admin` is its explicit
    // user-facing successor and receives the same non-platform route surface.
    const organizationAdminAlias = isOrganizationAdmin(req.user) && allowed.has('PI');
    if (!allowed.has(req.user.role) && !organizationAdminAlias) {
      return res.status(403).json({ error: 'Forbidden', message: 'Insufficient role' });
    }
    return next();
  };
}

function requireOperation(operation) {
  return (req, res, next) => {
    if (isPlatformAdmin(req.user) || canRolePerform(req.user?.role, operation)) {
      return next();
    }
    return res.status(403).json({
      error: 'Forbidden',
      message: `Operation not permitted: ${operation}`,
      required_permission: operation,
    });
  };
}

function requirePlatformAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing user' });
  }
  if (isPlatformAdmin(req.user)) return next();
  return res.status(403).json({ error: 'Forbidden', message: 'Platform administrator required' });
}

async function hasOrganizationMembership(pool, organizationId, user) {
  if (!organizationId || !user) return false;
  if (isPlatformAdmin(user)) return true;
  const result = await pool.query(
    `SELECT 1
     FROM user_organizations
     WHERE user_id = $1 AND organization_id = $2`,
    [user.sub, organizationId]
  );
  return Boolean(result.rows[0]);
}

async function hasProjectMembership(pool, projectId, user) {
  if (!projectId || !user) return false;
  if (isPlatformAdmin(user)) return true;
  const organizationWide = isOrganizationAdmin(user);
  const result = await pool.query(
    `SELECT 1
     FROM projects p
     INNER JOIN user_organizations uo
       ON uo.organization_id = p.organization_id AND uo.user_id = $2
     ${organizationWide ? '' : `INNER JOIN user_projects up
       ON up.project_id = p.id AND up.user_id = $2`}
     WHERE p.id = $1`,
    [projectId, user.sub]
  );
  return Boolean(result.rows[0]);
}

async function hasProtocolMembership(pool, protocolId, user) {
  if (!protocolId || !user) return false;
  if (isPlatformAdmin(user)) return true;
  const organizationWide = isOrganizationAdmin(user);
  const result = await pool.query(
    `SELECT 1
     FROM protocols pr
     INNER JOIN projects p ON p.id = pr.project_id
     INNER JOIN user_organizations uo
       ON uo.organization_id = p.organization_id AND uo.user_id = $2
     ${organizationWide ? '' : `INNER JOIN user_projects up
       ON up.project_id = p.id AND up.user_id = $2`}
     WHERE pr.id = $1`,
    [protocolId, user.sub]
  );
  return Boolean(result.rows[0]);
}

async function hasSessionMembership(pool, sessionId, user) {
  if (!sessionId || !user) return false;
  if (isPlatformAdmin(user)) return true;
  const organizationWide = isOrganizationAdmin(user);
  const result = await pool.query(
    `SELECT 1
     FROM sessions s
     LEFT JOIN protocols pr ON pr.id = s.protocol_id
     INNER JOIN projects p ON p.id = COALESCE(s.project_id, pr.project_id)
     INNER JOIN user_organizations uo
       ON uo.organization_id = p.organization_id AND uo.user_id = $2
     ${organizationWide ? '' : `INNER JOIN user_projects up
       ON up.project_id = p.id AND up.user_id = $2`}
     WHERE (s.id::text = $1::text OR s.session_id = $1::text)`,
    [sessionId, user.sub]
  );
  return Boolean(result.rows[0]);
}

function buildPermissionSnapshot(user) {
  const role = isPlatformAdmin(user) ? 'admin' : user?.role;
  const operations = Object.values(OPERATIONS)
    .filter(operation => canRolePerform(role, operation));
  return {
    role: role || null,
    scope: role === 'admin'
      ? 'platform'
      : (role === 'developer' ? 'technical_only' : 'tenant_membership'),
    operations,
    is_platform_admin: role === 'admin',
  };
}

module.exports = {
  ROLES,
  OPERATIONS,
  ROLE_OPERATIONS,
  canRolePerform,
  authenticateBearerHeader,
  authenticateStaffToken,
  resolveCurrentStaffPrincipal,
  requireAuth,
  requireRole,
  requireOperation,
  requirePlatformAdmin,
  isPlatformAdmin,
  isOrganizationAdmin,
  hasOrganizationMembership,
  hasProjectMembership,
  hasProtocolMembership,
  hasSessionMembership,
  buildPermissionSnapshot,
};
