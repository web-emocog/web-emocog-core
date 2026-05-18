/**
 * Конфигурация API (Фаза 2).
 * В проде только HTTPS; в запросах не должно быть PII (см. README).
 */
require('../load-env');
const DEFAULT_JWT_SECRET = 'dev-secret-change-in-production-min-32';
const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const projectLeadEmails = String(process.env.PROJECT_LEAD_EMAILS || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);
const projectAdminEmails = String(process.env.PROJECT_ADMIN_EMAILS || '')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean);

if (
  nodeEnv === 'production' &&
  (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET === DEFAULT_JWT_SECRET ||
    process.env.JWT_SECRET.length < 32
  )
) {
  throw new Error(
    'JWT_SECRET: в production (NODE_ENV=production) задайте в apps/api/.env уникальную строку ≥32 символов. ' +
      'Нельзя оставлять пустым, значение по умолчанию из примера или короче 32 символов.'
  );
}

module.exports = {
  nodeEnv,
  port: parseInt(process.env.PORT, 10) || 3000,
  database: {
    url: process.env.DATABASE_URL || 'postgres://localhost:5432/emocog',
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  /** В продакшене приложение должно работать только по HTTPS (reverse proxy или TLS). */
  forceHttps: process.env.FORCE_HTTPS === 'true',
  security: {
    projectLeadEmails,
    projectAdminEmails,
  },
};
