const express = require('express');

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

function createRouteRateLimiter(rateLimits, options = {}) {
  const windowMs = options.windowMs || 60_000;
  const now = options.now || (() => Date.now());
  const maxBuckets = options.maxBuckets || 10_000;
  const buckets = new Map();
  return (req, res, next) => {
    const profile = classifyRoute(req.path);
    const limit = rateLimits[profile];
    const key = `${profile}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    const timestamp = now();
    if (!buckets.has(key) && buckets.size >= maxBuckets) {
      // Keep memory bounded even if an attacker rotates source addresses.
      buckets.delete(buckets.keys().next().value);
    }
    let bucket = buckets.get(key);
    if (!bucket || timestamp >= bucket.resetAt) {
      bucket = { count: 0, resetAt: timestamp + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests',
        code: 'rate_limit_exceeded',
        route_profile: profile,
        retry_after_seconds: retryAfter,
      });
    }
    return next();
  };
}

module.exports = {
  classifyRoute,
  createSecurityHeaders,
  requireSecureTransport,
  buildCorsOptions,
  createRouteAwareJsonParser,
  createRouteRateLimiter,
};
