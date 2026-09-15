const express = require('express');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');

function classifyRoute(pathname) {
  const path = String(pathname || '');
  if (path === '/auth' || path.startsWith('/auth/')) return 'auth';
  if (path === '/ingest' || path.startsWith('/ingest/')) return 'ingest';
  if (/^\/invitations\/by-code\/[^/]+(?:\/.*)?$/.test(path)) return 'ingest';
  return 'default';
}

function createSecurityHeaders(options = {}) {
  const hstsMaxAge = Number.isFinite(options.hstsMaxAge)
    ? options.hstsMaxAge
    : 31_536_000;
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', `max-age=${hstsMaxAge}; includeSubDomains`);
    }
    return next();
  };
}

function requireSecureTransport(req, res, next) {
  if (req.secure) return next();
  return res.status(426).json({
    error: 'HTTPS is required',
    code: 'https_required',
  });
}

function buildCorsOptions(allowedOrigins) {
  const allowlist = new Set((allowedOrigins || []).map(origin => String(origin).trim()));
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowlist.has(origin)) {
        return callback(null, true);
      }
      const error = new Error('Origin is not allowed');
      error.status = 403;
      error.code = 'cors_origin_denied';
      return callback(error);
    },
  };
}

function createRouteAwareJsonParser(bodyLimits) {
  const parsers = {
    auth: express.json({ limit: bodyLimits.auth, strict: true }),
    ingest: express.json({ limit: bodyLimits.ingest, strict: true }),
    default: express.json({ limit: bodyLimits.default, strict: true }),
  };
  return (req, res, next) => parsers[classifyRoute(req.path)](req, res, next);
}

function buildRouteRateLimitOptions(rateLimits, options = {}) {
  const windowMs = options.windowMs || 60_000;
  const limiterOptions = {
    windowMs,
    limit(req) {
      const configured = Number(rateLimits[classifyRoute(req.path)]);
      return Number.isSafeInteger(configured) && configured > 0 ? configured : 1;
    },
    keyGenerator(req) {
      const profile = classifyRoute(req.path);
      const address = req.ip || req.socket?.remoteAddress || 'unknown';
      const normalizedAddress = address === 'unknown' ? address : ipKeyGenerator(address);
      return `${profile}:${normalizedAddress}`;
    },
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    passOnStoreError: false,
    handler(req, res) {
      const resetTime = req.rateLimit?.resetTime;
      const resetAt = resetTime instanceof Date ? resetTime.getTime() : Date.now() + windowMs;
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests',
        code: 'rate_limit_exceeded',
        route_profile: classifyRoute(req.path),
        retry_after_seconds: retryAfter,
      });
    },
  };

  if (options.store) limiterOptions.store = options.store;
  if (options.validate !== undefined) limiterOptions.validate = options.validate;
  return limiterOptions;
}

function createRouteRateLimiter(rateLimits, options = {}) {
  return rateLimit(buildRouteRateLimitOptions(rateLimits, options));
}

module.exports = {
  classifyRoute,
  createSecurityHeaders,
  requireSecureTransport,
  buildCorsOptions,
  createRouteAwareJsonParser,
  buildRouteRateLimitOptions,
  createRouteRateLimiter,
};
