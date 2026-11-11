const { pool } = require('../db');
const { readIdentityConfig } = require('../config/identity');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('express-rate-limit');
const { createIdentityService } = require('../services/identity');
const { identityBoundary, identityRateLimitOptions, strictBody, endpoint } = require('../services/identity-http');

function createIdentityRouter(options = {}) {
  const config = options.config || readIdentityConfig();
  const service = createIdentityService({ pool: options.pool || pool, config });
  const router = identityBoundary(config);
  router.use(rateLimit(identityRateLimitOptions('auth', options)));
  router.get('/status', (req, res) => res.json({ enabled: true }));
  for (const [route, purpose] of [['/signup', 'signup'], ['/recovery', 'reset']]) {
    router.post(route, endpoint(async (req, res) => {
      strictBody(req, ['email']);
      await service.requestChallenge(purpose, req.body.email);
      res.status(202).json({ ok: true, message: 'If eligible, an email will arrive. Check your inbox or try again later.' });
    }));
  }
  router.post('/verification', options.requireAuth || requireAuth, endpoint(async (req, res) => {
    strictBody(req, []);
    await service.requestChallenge('verify', req.user.email, req.user.sub);
    res.status(202).json({ ok: true, message: 'If eligible, a verification email will arrive.' });
  }));
  router.post('/confirm', endpoint(async (req, res) => {
    strictBody(req, ['token', 'password', 'display_name']);
    res.json(await service.confirm(req.body));
  }));
  return router;
}

module.exports = createIdentityRouter();
module.exports.createIdentityRouter = createIdentityRouter;
