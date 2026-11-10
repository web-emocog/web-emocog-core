const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('express-rate-limit');
const { readIdentityConfig } = require('../config/identity');
const { createWorkspaceService } = require('../services/workspace');
const { identityBoundary, identityRateLimitOptions, strictBody, endpoint, id } = require('../services/identity-http');
const { IdentityError } = require('../services/identity-security');

function createWorkspaceRouter(options = {}) {
  const config = options.config || readIdentityConfig();
  const service = createWorkspaceService({ pool: options.pool || pool, config });
  const router = identityBoundary(config);
  router.use(rateLimit(identityRateLimitOptions('default', options)));
  router.use(options.requireAuth || requireAuth);
  router.get('/', endpoint(async (req, res) => res.json(await service.list(req.user))));
  router.post('/organizations', endpoint(async (req, res) => {
    strictBody(req, ['organization_name', 'project_name']);
    res.status(201).json(await service.create(req.user, req.body));
  }));
  router.post('/organizations/:organizationId/projects', endpoint(async (req, res) => {
    strictBody(req, ['name']);
    res.status(201).json(await service.project(req.user, id(req.params.organizationId), req.body.name));
  }));
  router.get('/organizations/:organizationId/members', endpoint(async (req, res) =>
    res.json(await service.members(req.user, id(req.params.organizationId)))));
  router.get('/organizations/:organizationId/invitations', endpoint(async (req, res) =>
    res.json(await service.invitations(req.user, id(req.params.organizationId)))));
  router.post('/organizations/:organizationId/invitations', endpoint(async (req, res) => {
    strictBody(req, ['email', 'project_id']);
    await service.invite(req.user, id(req.params.organizationId), { email: req.body.email, project_id: id(req.body.project_id) });
    res.status(202).json({ ok: true, message: 'If eligible, an invitation will arrive.' });
  }));
  router.delete('/organizations/:organizationId/invitations/:invitationId', endpoint(async (req, res) => {
    if (!/^[a-f0-9-]{36}$/i.test(req.params.invitationId)) throw new IdentityError('invalid_id');
    await service.revoke(req.user, id(req.params.organizationId), req.params.invitationId);
    res.status(204).end();
  }));
  router.post('/invitations/accept', endpoint(async (req, res) => {
    strictBody(req, ['token']);
    res.json(await service.accept(req.user, req.body.token));
  }));
  router.patch('/organizations/:organizationId/members/:userId', endpoint(async (req, res) => {
    strictBody(req, ['role']);
    if (!['owner', 'member'].includes(req.body.role)) throw new IdentityError('invalid_membership_role');
    await service.changeMember(req.user, id(req.params.organizationId), id(req.params.userId), req.body.role);
    res.status(204).end();
  }));
  router.delete('/organizations/:organizationId/members/:userId', endpoint(async (req, res) => {
    await service.changeMember(req.user, id(req.params.organizationId), id(req.params.userId), null);
    res.status(204).end();
  }));
  return router;
}

module.exports = createWorkspaceRouter();
module.exports.createWorkspaceRouter = createWorkspaceRouter;
