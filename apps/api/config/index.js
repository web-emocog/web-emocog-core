/**
 * Конфигурация API (Фаза 2).
 * В проде только HTTPS; в запросах не должно быть PII (см. README).
 */
require('../load-env');
const DEFAULT_JWT_SECRET = 'dev-secret-change-in-production-min-32';
const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const path = require('path');

function csv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function nonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

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
  port: positiveInt(process.env.PORT, 3000, 65_535),
  database: {
    url: process.env.DATABASE_URL || 'postgres://localhost:5432/emocog',
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
    ingestExpiresIn: process.env.INGEST_TOKEN_EXPIRES_IN || '15m',
    staffIssuer: 'wecog-api',
    staffAudience: 'wecog-staff',
  },
  auth: {
    staffCookieName: process.env.STAFF_SESSION_COOKIE || 'wecog_staff_session',
  },
  /** Production fails closed if TLS/proxy forwarding is not configured correctly. */
  forceHttps: nodeEnv === 'production' || process.env.FORCE_HTTPS === 'true',
  http: {
    trustProxyHops: nonNegativeInt(process.env.TRUST_PROXY_HOPS, 0),
    corsOrigins: csv(process.env.CORS_ORIGINS || (
      nodeEnv === 'production'
        ? 'https://wecog.ru'
        : 'http://localhost:3000,http://localhost:4173,http://localhost:8080,http://127.0.0.1:4173,http://127.0.0.1:8080'
    )),
    bodyLimits: {
      auth: process.env.AUTH_BODY_LIMIT || '32kb',
      ingest: process.env.INGEST_BODY_LIMIT || '2mb',
      default: process.env.DEFAULT_BODY_LIMIT || '256kb',
    },
    rateLimits: {
      auth: positiveInt(process.env.AUTH_RATE_LIMIT_PER_MINUTE, 20),
      ingest: positiveInt(process.env.INGEST_RATE_LIMIT_PER_MINUTE, 60),
      default: positiveInt(process.env.DEFAULT_RATE_LIMIT_PER_MINUTE, 300),
    },
  },
  storage: {
    uploadsRoot: path.resolve(
      process.env.UPLOADS_ROOT || path.join(__dirname, '..', 'uploads')
    ),
    maxUploadBytes: positiveInt(process.env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024),
    conversion: {
      maxDocumentBytes: positiveInt(process.env.MAX_DOCUMENT_BYTES, 50 * 1024 * 1024),
      maxPages: positiveInt(process.env.MAX_DOCUMENT_PAGES, 100, 500),
      timeoutMs: positiveInt(process.env.DOCUMENT_CONVERSION_TIMEOUT_MS, 45_000, 300_000),
      dpi: positiveInt(process.env.DOCUMENT_CONVERSION_DPI, 150, 300),
      maxConcurrent: positiveInt(process.env.DOCUMENT_CONVERSION_CONCURRENCY, 2, 16),
      libreOfficeBin: process.env.LIBREOFFICE_BIN || 'soffice',
      pdfInfoBin: process.env.PDFINFO_BIN || 'pdfinfo',
      pdfToPpmBin: process.env.PDFTOPPM_BIN || 'pdftoppm',
    },
  },
};
