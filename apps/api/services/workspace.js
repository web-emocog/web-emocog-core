const crypto = require('node:crypto');
const { withTransaction } = require('../db/transaction');
const { enqueueMail } = require('./identity-mail');
const { IdentityError, canonicalEmail, text, tokenHash, makeToken, throttle } = require('./identity-security');

async function lockOrganization(client, id) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['workspace-org:' + id]);
}

async function verifiedResearcher(client, actor) {
  const r = await client.query('SELECT id,email,role,email_verified_at,token_version FROM users WHERE id=$1 FOR SHARE', [actor.sub]);
  const user = r.rows[0];
  if (!user || !user.email_verified_at || user.role !== 'researcher' || Number(user.token_version) !== actor.ver) {
    throw new IdentityError('verified_researcher_required', 403);
  }
  return user;
}

async function requireOrganizationOwner(client, organizationId, actorId) {
  const r = await client.query(`SELECT 1 FROM user_organizations
    WHERE organization_id=$1 AND user_id=$2 AND role='owner'`, [organizationId, actorId]);
  if (!r.rowCount) throw new IdentityError('workspace_not_found', 404);
}

function createWorkspaceService({ pool, config }) {
  async function list(actor) {
    const me = await pool.query('SELECT email_verified_at,role FROM users WHERE id=$1', [actor.sub]);
    const r = await pool.query(`SELECT o.id AS organization_id,o.name AS organization_name,uo.role AS organization_role,
      p.id AS project_id,p.name AS project_name,up.role AS project_role FROM user_organizations uo
      JOIN organizations o ON o.id=uo.organization_id
      LEFT JOIN projects p ON p.organization_id=o.id
        AND EXISTS (SELECT 1 FROM user_projects m WHERE m.project_id=p.id AND m.user_id=$1)
      LEFT JOIN user_projects up ON up.project_id=p.id AND up.user_id=$1
      WHERE uo.user_id=$1 ORDER BY o.id,p.id LIMIT 500`, [actor.sub]);
    return { email_verified: Boolean(me.rows[0]?.email_verified_at),
      self_service_eligible: me.rows[0]?.role === 'researcher', workspaces: r.rows };
  }

  async function create(actor, { organization_name, project_name }) {
    const organizationName = text(organization_name), projectName = text(project_name);
    return withTransaction(pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['workspace-user:' + actor.sub]);
      await verifiedResearcher(client, actor);
      const count = await client.query("SELECT count(*)::int AS count FROM user_organizations WHERE user_id=$1 AND role='owner'", [actor.sub]);
      if (count.rows[0].count >= 5) throw new IdentityError('workspace_limit_reached', 409);
      const o = await client.query('INSERT INTO organizations(name,slug) VALUES ($1,$2) RETURNING id,name,slug',
        [organizationName, 'org-' + crypto.randomUUID()]);
      const org = o.rows[0];
      const p = await client.query('INSERT INTO projects(organization_id,name,slug) VALUES ($1,$2,$3) RETURNING id,name,slug',
        [org.id, projectName, 'project-' + crypto.randomUUID()]);
      await client.query("INSERT INTO user_organizations(user_id,organization_id,role) VALUES ($1,$2,'owner')", [actor.sub, org.id]);
      await client.query("INSERT INTO user_projects(user_id,project_id,role) VALUES ($1,$2,'owner')", [actor.sub, p.rows[0].id]);
      return { organization: org, project: p.rows[0] };
    });
  }

  async function project(actor, organizationId, name) {
    const projectName = text(name);
    return withTransaction(pool, async client => {
      await lockOrganization(client, organizationId);
      await verifiedResearcher(client, actor);
      await requireOrganizationOwner(client, organizationId, actor.sub);
      const count = await client.query('SELECT count(*)::int AS count FROM projects WHERE organization_id=$1', [organizationId]);
      if (count.rows[0].count >= 100) throw new IdentityError('project_limit_reached', 409);
      const p = await client.query('INSERT INTO projects(organization_id,name,slug) VALUES ($1,$2,$3) RETURNING id,name,slug',
        [organizationId, projectName, 'project-' + crypto.randomUUID()]);
      await client.query("INSERT INTO user_projects(user_id,project_id,role) VALUES ($1,$2,'owner')", [actor.sub, p.rows[0].id]);
      return p.rows[0];
    });
  }

  async function invite(actor, organizationId, { email: inputEmail, project_id }) {
    const email = await canonicalEmail(inputEmail);
    return withTransaction(pool, async client => {
      await lockOrganization(client, organizationId);
      await verifiedResearcher(client, actor);
      await requireOrganizationOwner(client, organizationId, actor.sub);
      // Owners cannot invite to a project they do not explicitly belong to.
      const p = await client.query(`SELECT 1 FROM projects p JOIN user_projects up ON up.project_id=p.id
        WHERE p.id=$1 AND p.organization_id=$2 AND up.user_id=$3`, [project_id, organizationId, actor.sub]);
      if (!p.rowCount) throw new IdentityError('workspace_not_found', 404);
      if (!await throttle(client, config, 'invite:' + organizationId + ':' + email)) return;
      const count = await client.query(`SELECT count(*)::int AS count FROM workspace_invitations
        WHERE organization_id=$1 AND created_at > clock_timestamp()-interval '1 day'`, [organizationId]);
      if (count.rows[0].count >= 100) return;
      // Never expose whether this email exists or change the identity/global role.
      const existing = await client.query('SELECT role FROM users WHERE email=$1', [email]);
      if (existing.rows[0] && existing.rows[0].role !== 'researcher') return;
      const { token, hash } = makeToken(), id = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + config.inviteTtlSeconds * 1000);
      await client.query(`INSERT INTO workspace_invitations
        (id,organization_id,project_id,email,token_hash,created_by,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, organizationId, project_id, email, hash, actor.sub, expiresAt]);
      await enqueueMail(client, config, { email, token, purpose: 'invite', expiresAt, invitationId: id });
    });
  }

  async function accept(actor, token) {
    const hash = tokenHash(token);
    const lookup = await pool.query('SELECT organization_id FROM workspace_invitations WHERE token_hash=$1', [hash]);
    if (!lookup.rows[0]) throw new IdentityError('invalid_or_expired_invitation');
    return withTransaction(pool, async client => {
      const organizationId = lookup.rows[0].organization_id;
      await lockOrganization(client, organizationId);
      const user = await verifiedResearcher(client, actor);
      const r = await client.query(`SELECT i.* FROM workspace_invitations i JOIN projects p
        ON p.id=i.project_id AND p.organization_id=i.organization_id
        WHERE i.token_hash=$1 AND i.email=$2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > clock_timestamp() FOR UPDATE OF i`, [hash, user.email]);
      const invitation = r.rows[0];
      if (!invitation) throw new IdentityError('invalid_or_expired_invitation');
      // Revocation of the inviter's ownership also invalidates outstanding invites.
      await requireOrganizationOwner(client, organizationId, invitation.created_by);
      const inviterProject = await client.query('SELECT 1 FROM user_projects WHERE user_id=$1 AND project_id=$2',
        [invitation.created_by, invitation.project_id]);
      if (!inviterProject.rowCount) throw new IdentityError('invalid_or_expired_invitation');
      await client.query(`INSERT INTO user_organizations(user_id,organization_id,role) VALUES ($1,$2,'member')
        ON CONFLICT (user_id,organization_id) DO NOTHING`, [user.id, organizationId]);
      await client.query(`INSERT INTO user_projects(user_id,project_id,role) VALUES ($1,$2,'member')
        ON CONFLICT (user_id,project_id) DO NOTHING`, [user.id, invitation.project_id]);
      await client.query('UPDATE workspace_invitations SET accepted_at=clock_timestamp(),accepted_by=$1 WHERE id=$2', [user.id, invitation.id]);
      await client.query(`UPDATE identity_mail_outbox SET status='cancelled',payload_cipher=NULL,finished_at=clock_timestamp()
        WHERE invitation_id=$1 AND status='pending'`, [invitation.id]);
      return { ok: true, organization_id: organizationId, project_id: invitation.project_id };
    });
  }

  async function managed(actor, organizationId, action) {
    return withTransaction(pool, async client => {
      await lockOrganization(client, organizationId);
      await verifiedResearcher(client, actor);
      await requireOrganizationOwner(client, organizationId, actor.sub);
      return action(client);
    });
  }
  async function members(actor, organizationId) {
    return managed(actor, organizationId, async client => {
      const r = await client.query(`SELECT u.id,u.email,u.display_name,uo.role FROM user_organizations uo
        JOIN users u ON u.id=uo.user_id WHERE uo.organization_id=$1 ORDER BY u.id LIMIT 500`, [organizationId]);
      return r.rows;
    });
  }
  async function invitations(actor, organizationId) {
    return managed(actor, organizationId, async client => {
      const r = await client.query(`SELECT id,project_id,email,expires_at,accepted_at,revoked_at FROM workspace_invitations
        WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100`, [organizationId]);
      return r.rows;
    });
  }
  async function revoke(actor, organizationId, invitationId) {
    return managed(actor, organizationId, async client => {
      const r = await client.query(`UPDATE workspace_invitations SET revoked_at=clock_timestamp()
        WHERE id=$1 AND organization_id=$2 AND accepted_at IS NULL RETURNING id`, [invitationId, organizationId]);
      if (!r.rowCount) throw new IdentityError('invitation_not_found', 404);
      await client.query(`UPDATE identity_mail_outbox SET status='cancelled',payload_cipher=NULL,finished_at=clock_timestamp()
        WHERE invitation_id=$1 AND status='pending'`, [invitationId]);
    });
  }
  async function changeMember(actor, organizationId, userId, role) {
    if (![null, 'owner', 'member'].includes(role)) throw new IdentityError('invalid_membership_role');
    return managed(actor, organizationId, async client => {
      const r = await client.query(`SELECT uo.role,u.role AS global_role,u.email_verified_at FROM user_organizations uo
        JOIN users u ON u.id=uo.user_id WHERE uo.organization_id=$1 AND uo.user_id=$2 FOR UPDATE OF uo`, [organizationId, userId]);
      const target = r.rows[0];
      if (!target) throw new IdentityError('member_not_found', 404);
      if (role === 'owner' && (target.global_role !== 'researcher' || !target.email_verified_at)) throw new IdentityError('verified_researcher_required', 403);
      if (target.role === 'owner' && role !== 'owner') {
        const owners = await client.query("SELECT count(*)::int AS count FROM user_organizations WHERE organization_id=$1 AND role='owner'", [organizationId]);
        if (owners.rows[0].count <= 1) throw new IdentityError('last_owner_required', 409);
      }
      if (role !== 'owner') {
        const lastProjectOwner = await client.query(`SELECT 1 FROM user_projects up JOIN projects p ON p.id=up.project_id
          WHERE up.user_id=$1 AND up.role='owner' AND p.organization_id=$2 AND NOT EXISTS (
            SELECT 1 FROM user_projects other_up JOIN user_organizations other_uo
              ON other_uo.user_id=other_up.user_id AND other_uo.organization_id=p.organization_id
            WHERE other_up.project_id=p.id AND other_up.user_id<>$1 AND other_up.role='owner' AND other_uo.role='owner'
          ) LIMIT 1`, [userId, organizationId]);
        if (lastProjectOwner.rowCount) throw new IdentityError('last_project_owner_required', 409);
      }
      if (role === null) {
        await client.query('DELETE FROM user_projects WHERE user_id=$1 AND project_id IN (SELECT id FROM projects WHERE organization_id=$2)', [userId, organizationId]);
        await client.query('DELETE FROM user_organizations WHERE user_id=$1 AND organization_id=$2', [userId, organizationId]);
      } else {
        await client.query('UPDATE user_organizations SET role=$1 WHERE user_id=$2 AND organization_id=$3', [role, userId, organizationId]);
        // Ownership never implicitly adds memberships in other projects.
        await client.query(`UPDATE user_projects SET role=$1 WHERE user_id=$2
          AND project_id IN (SELECT id FROM projects WHERE organization_id=$3)`, [role, userId, organizationId]);
      }
    });
  }
  return { list, create, project, invite, accept, members, invitations, revoke, changeMember };
}

module.exports = { createWorkspaceService, requireOrganizationOwner, verifiedResearcher };
