/**
 * Auth & RBAC middleware (Фаза 2.2).
 * Роли: admin, PI, researcher, analyst, assistant, developer, respondent.
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

const ROLES = ['admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer', 'respondent'];
const STATIC_BYPASS_ADMIN_EMAILS = ['braziliya@mail.ru', 'uskovauv@gmail.com'];
const CONFIG_BYPASS_EMAILS = Array.isArray(config.security?.projectAdminEmails) ? config.security.projectAdminEmails : [];
const BYPASS_ADMIN_EMAILS = new Set(
  [...STATIC_BYPASS_ADMIN_EMAILS, ...CONFIG_BYPASS_EMAILS].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
);

function isBypassAdminEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return !!normalized && BYPASS_ADMIN_EMAILS.has(normalized);
}

/**
 * Платформенный администратор: роль admin в БД/JWT или жёсткий bypass по email.
 * PI и developer сюда не входят (нет полного bypass и нет права выдавать admin/developer allowlist).
 */
function isPlatformAdmin(user) {
  if (!user) return false;
  if (user.bypass_admin === true) return true;
  return user.role === 'admin';
}

/**
 * Только платформенный админ (после requireAuth).
 */
function requirePlatformAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing user' });
  }
  if (isPlatformAdmin(req.user)) return next();
  return res.status(403).json({ error: 'Forbidden', message: 'Platform administrator required' });
}

/**
 * Проверяет JWT в заголовке Authorization: Bearer <token> и кладёт payload в req.user.
 */
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid token' });
  }
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    if (isBypassAdminEmail(payload?.email)) {
      payload.role = 'admin';
      payload.bypass_admin = true;
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}

/**
 * Требует одну из переданных ролей. Вызывать после requireAuth.
 */
function requireRole(...allowedRoles) {
  const set = new Set(allowedRoles.length ? allowedRoles : ROLES);
  return (req, res, next) => {
    if (req.user && req.user.bypass_admin === true) {
      return next();
    }
    if (!req.user || !req.user.role) {
      return res.status(403).json({ error: 'Forbidden', message: 'Role required' });
    }
    if (!set.has(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Insufficient role' });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requirePlatformAdmin,
  ROLES,
  isBypassAdminEmail,
  isPlatformAdmin,
};
