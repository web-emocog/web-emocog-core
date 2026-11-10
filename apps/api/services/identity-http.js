const express = require('express');
const { IdentityError } = require('./identity-security');
const httpConfig = require('../config');
const { pool } = require('../db');
const { ipKeyGenerator } = require('express-rate-limit');
const { PostgresRateStore } = require('../security/postgres-rate-store');
const { buildRouteRateLimitOptions } = require('../security/http-security');

function identityRateLimitOptions(profile, options = {}) {
  const limits = options.rateLimits || httpConfig.http.rateLimits;
  const shared = httpConfig.http.rateLimitStore === 'postgres';
  const settings = buildRouteRateLimitOptions(limits, shared
    ? { store: new PostgresRateStore(options.pool || pool, httpConfig.jwt.secret) } : {});
  settings.limit = limits[profile];
  settings.keyGenerator = req => `identity-router:${profile}:${ipKeyGenerator(req.ip || req.socket.remoteAddress)}`;
  return settings;
}

function identityBoundary(config) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    if (!config.enabled) return res.status(503).json({ error: 'Self-service is not configured', code: 'identity_disabled' });
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // Disallow simple cross-origin form posts even before a session exists.
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
    if (req.get('Sec-Fetch-Site') === 'cross-site' || (req.get('Origin') && !config.trustedOrigins.includes(req.get('Origin')))) {
      return res.status(403).json({ error: 'Origin denied', code: 'identity_origin_denied' });
    }
    next();
  });
  router.use(express.json({ limit: '8kb', strict: true }));
  return router;
}
function strictBody(req, allowed) {
  if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object'
    || Object.keys(req.body).some(k => !allowed.includes(k))) throw new IdentityError('invalid_request');
}
function id(value) {
  if (!/^[1-9]\d{0,9}$/.test(String(value)) || Number(value) > 2147483647) throw new IdentityError('invalid_id');
  return Number(value);
}
function endpoint(callback) {
  return async (req, res) => {
    try { await callback(req, res); }
    catch (error) {
      if (error instanceof IdentityError) return res.status(error.status).json({ error: error.code, code: error.code });
      // DB, crypto and SMTP faults must not include request/email/token/SQL details.
      return res.status(503).json({ error: 'Service temporarily unavailable', code: 'identity_unavailable' });
    }
  };
}
module.exports = { identityBoundary, identityRateLimitOptions, strictBody, id, endpoint };
