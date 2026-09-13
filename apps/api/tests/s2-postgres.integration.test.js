const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const databaseUrl = process.env.S2_TEST_DATABASE_URL;

describe('S2-01 PostgreSQL integration', { skip: !databaseUrl }, () => {
  let pool;
  let app;
  let server;
  let baseUrl;
  let organizationId;
  let projectId;
  let protocolId;
  let staffUserId;
  let config;
  const createdUserIds = [];

  before(async () => {
    process.env.DATABASE_URL = databaseUrl;
    ({ pool } = require('../db'));
    config = require('../config');
    app = require('../app');
    const suffix = randomUUID().slice(0, 12);
    const organization = await pool.query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      [`S2 security ${suffix}`, `s2-security-${suffix}`]
    );
    organizationId = organization.rows[0].id;
    const project = await pool.query(
      `INSERT INTO projects (organization_id, name, slug)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [organizationId, `S2 project ${suffix}`, `s2-project-${suffix}`]
    );
    projectId = project.rows[0].id;
    const protocol = await pool.query(
      `INSERT INTO protocols (project_id, name, definition)
       VALUES ($1, $2, '{}'::jsonb)
       RETURNING id`,
      [projectId, `S2 protocol ${suffix}`]
    );
    protocolId = protocol.rows[0].id;

    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (pool) {
      await pool.query('DROP TRIGGER IF EXISTS s2_fail_proxy_write ON session_proxy_metrics');
      await pool.query('DROP FUNCTION IF EXISTS s2_fail_proxy_write()');
      if (organizationId) {
        await pool.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
      }
      if (staffUserId) {
        await pool.query('DELETE FROM users WHERE id = $1', [staffUserId]);
      }
      if (createdUserIds.length) {
        await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [createdUserIds]);
      }
    }
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
  });

  async function createInvitation(maxRuns = null) {
    const code = `S2${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const result = await pool.query(
      `INSERT INTO invitations (protocol_id, code, max_runs, expires_at)
       VALUES ($1, $2, $3, current_timestamp + interval '1 hour')
       RETURNING id, code, max_runs, used_runs`,
      [protocolId, code, maxRuns]
    );
    return result.rows[0];
  }

  function issueStaffToken(user) {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        ver: Number(user.token_version || 0),
      },
      config.jwt.secret,
      {
        algorithm: 'HS256',
        issuer: config.jwt.staffIssuer,
        audience: config.jwt.staffAudience,
        expiresIn: '10m',
      }
    );
  }

  async function issueToken(invitation, sessionId) {
    return fetch(`${baseUrl}/invitations/by-code/${invitation.code}/ingest-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    });
  }

  function payload(invitation, sessionId, participantId, completed = false, extra = {}) {
    return {
      schemaVersion: 'session_feature.v1',
      ids: {
        session: sessionId,
        participant: participantId,
        invitationCode: invitation.code,
      },
      meta: { user: { interfaceLanguage: 'ru' }, tech: {} },
      lifecycle: {
        schemaVersion: 'session_lifecycle.v1',
        state: completed ? 'completed' : 'running',
        status: completed ? 'completed' : 'in_progress',
        ...(completed
          ? {
            finishAttemptId: `finish-${sessionId}`,
            completedAt: Date.now(),
          }
          : {}),
      },
      events: [],
      ...extra,
    };
  }

  async function ingest(invitation, sessionId, participantId, token, completed = false, extra = {}) {
    return fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(completed ? { 'idempotency-key': `finish-${sessionId}` } : {}),
      },
      body: JSON.stringify(payload(invitation, sessionId, participantId, completed, extra)),
    });
  }

  it('rejects malformed admission without reserving a run or creating a session', async () => {
    const invitation = await createInvitation(1);
    const response = await fetch(
      `${baseUrl}/invitations/by-code/${invitation.code}/ingest-token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }
    );
    assert.equal(response.status, 400);

    const state = await pool.query(
      `SELECT i.used_runs,
              COUNT(s.id)::int AS session_count
       FROM invitations i
       LEFT JOIN sessions s ON s.invitation_id = i.id
       WHERE i.id = $1
       GROUP BY i.id`,
      [invitation.id]
    );
    assert.equal(state.rows[0].used_runs, 0);
    assert.equal(state.rows[0].session_count, 0);
  });

  it('returns 404 for an unknown code without creating an invitation', async () => {
    const beforeCount = await pool.query('SELECT COUNT(*)::int AS n FROM invitations');
    const response = await fetch(`${baseUrl}/invitations/by-code/UNKNOWN-S2-CODE`);
    const afterCount = await pool.query('SELECT COUNT(*)::int AS n FROM invitations');
    assert.equal(response.status, 404);
    assert.equal(afterCount.rows[0].n, beforeCount.rows[0].n);
    const oversized = await fetch(
      `${baseUrl}/invitations/by-code/${'A'.repeat(65)}`
    );
    assert.equal(oversized.status, 400);
  });

  it('serves only protocol-referenced participant stimulus metadata', async () => {
    const inserted = await pool.query(
      `INSERT INTO stimuli (project_id, name, mime_type, size_bytes, metadata)
       VALUES
         ($1, 'Referenced', 'image/png', 8, $2::jsonb),
         ($1, 'Foreign to protocol', 'image/png', 8, $3::jsonb)
       RETURNING id`,
      [
        projectId,
        JSON.stringify({
          content_path: 'missing-referenced.png',
          emotion: 'neutral',
          participant_email: 'must-not-leak@example.test',
        }),
        JSON.stringify({ content_path: 'missing-unreferenced.png' }),
      ]
    );
    const referencedId = inserted.rows[0].id;
    const unreferencedId = inserted.rows[1].id;
    await pool.query(
      `UPDATE protocols
       SET definition = $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify({
          blocks: [{ type: 'stimuli', params: { stimuli_ids: [`api:${referencedId}`] } }],
        }),
        protocolId,
      ]
    );
    try {
      const invitation = await createInvitation(2);
      const list = await fetch(
        `${baseUrl}/invitations/by-code/${invitation.code}/stimuli`
      );
      assert.equal(list.status, 200);
      const rows = await list.json();
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0].id), Number(referencedId));
      assert.equal(rows[0].metadata.emotion, 'neutral');
      assert.equal(rows[0].metadata.content_path, undefined);
      assert.equal(rows[0].metadata.participant_email, undefined);
      assert.match(rows[0].content_url, /\/content$/);

      const missingBinary = await fetch(`${baseUrl}${rows[0].content_url}`);
      assert.equal(missingBinary.status, 404);
      const unreferenced = await fetch(
        `${baseUrl}/invitations/by-code/${invitation.code}/stimuli/${unreferencedId}/content`
      );
      assert.equal(unreferenced.status, 404);
    } finally {
      await pool.query(
        `UPDATE protocols SET definition = '{}'::jsonb WHERE id = $1`,
        [protocolId]
      );
    }
  });

  it('creates a metadata-only stimulus through the authenticated HTTP route', async () => {
    const email = `s2-stimulus-admin-${randomUUID()}@example.test`;
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id, email, role, token_version`,
      [email, await bcrypt.hash('temporary-test-password', 4)]
    );
    createdUserIds.push(inserted.rows[0].id);
    const response = await fetch(`${baseUrl}/stimuli`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${issueStaffToken(inserted.rows[0])}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        project_id: projectId,
        name: 'Metadata-only stimulus',
        mime_type: 'text/plain',
        size_bytes: 12,
        metadata: { text: 'safe stimulus' },
      }),
    });
    assert.equal(response.status, 201);
    const stimulus = await response.json();
    assert.equal(stimulus.name, 'Metadata-only stimulus');
    assert.equal(stimulus.mime_type, 'text/plain');
    assert.equal(Number(stimulus.size_bytes), 12);
    assert.equal(stimulus.metadata.text, 'safe stimulus');
  });

  it('isolates projects, protocols and stimuli between researchers in the same organization', async () => {
    const suffix = randomUUID();
    const siblingProject = await pool.query(
      `INSERT INTO projects (organization_id, name, slug)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [organizationId, `Sibling project ${suffix}`, `sibling-${suffix}`]
    );
    const siblingProjectId = siblingProject.rows[0].id;
    const siblingProtocol = await pool.query(
      `INSERT INTO protocols (project_id, name, definition)
       VALUES ($1, $2, '{}'::jsonb)
       RETURNING id`,
      [siblingProjectId, `Sibling protocol ${suffix}`]
    );
    const stimuli = await pool.query(
      `INSERT INTO stimuli (project_id, name, mime_type, size_bytes, metadata)
       VALUES
         ($1, 'Owned stimulus', 'image/png', 8, '{}'::jsonb),
         ($2, 'Sibling stimulus', 'image/png', 8, '{}'::jsonb)
       RETURNING id, project_id`,
      [projectId, siblingProjectId]
    );
    const ownStimulusId = stimuli.rows.find(row => Number(row.project_id) === Number(projectId)).id;
    const siblingStimulusId = stimuli.rows.find(row => Number(row.project_id) === Number(siblingProjectId)).id;

    const researchers = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $3, 'researcher'), ($2, $3, 'researcher')
       RETURNING id, email, role, token_version
       ORDER BY id`,
      [
        `project-owner-${suffix}@example.test`,
        `project-sibling-${suffix}@example.test`,
        await bcrypt.hash('project-isolation-test-only', 4),
      ]
    );
    createdUserIds.push(...researchers.rows.map(row => row.id));
    const owner = researchers.rows[0];
    const sibling = researchers.rows[1];
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role)
       VALUES ($1, $3, 'member'), ($2, $3, 'member')`,
      [owner.id, sibling.id, organizationId]
    );
    await pool.query(
      `INSERT INTO user_projects (user_id, project_id, role)
       VALUES ($1, $3, 'researcher'), ($2, $4, 'researcher')`,
      [owner.id, sibling.id, projectId, siblingProjectId]
    );
    const ownerHeaders = {
      authorization: `Bearer ${issueStaffToken(owner)}`,
      'content-type': 'application/json',
    };
    const siblingHeaders = {
      authorization: `Bearer ${issueStaffToken(sibling)}`,
      'content-type': 'application/json',
    };

    try {
      const ownerProjectsResponse = await fetch(`${baseUrl}/projects`, { headers: ownerHeaders });
      assert.equal(ownerProjectsResponse.status, 200);
      const ownerProjects = await ownerProjectsResponse.json();
      assert.ok(ownerProjects.some(row => Number(row.id) === Number(projectId)));
      assert.ok(!ownerProjects.some(row => Number(row.id) === Number(siblingProjectId)));

      const siblingProjectsResponse = await fetch(`${baseUrl}/projects`, { headers: siblingHeaders });
      assert.equal(siblingProjectsResponse.status, 200);
      const siblingProjects = await siblingProjectsResponse.json();
      assert.ok(siblingProjects.some(row => Number(row.id) === Number(siblingProjectId)));
      assert.ok(!siblingProjects.some(row => Number(row.id) === Number(projectId)));

      const foreignProtocol = await fetch(`${baseUrl}/protocols/${siblingProtocol.rows[0].id}`, {
        headers: ownerHeaders,
      });
      assert.equal(foreignProtocol.status, 404);
      const foreignProtocolList = await fetch(
        `${baseUrl}/protocols?project_id=${siblingProjectId}`,
        { headers: ownerHeaders }
      );
      assert.equal(foreignProtocolList.status, 200);
      assert.deepEqual(await foreignProtocolList.json(), []);
      const foreignProtocolUpdate = await fetch(`${baseUrl}/protocols/${siblingProtocol.rows[0].id}`, {
        method: 'PATCH',
        headers: ownerHeaders,
        body: JSON.stringify({ name: 'Forbidden rename' }),
      });
      assert.equal(foreignProtocolUpdate.status, 404);

      const ownStimuliResponse = await fetch(`${baseUrl}/stimuli?project_id=${projectId}`, {
        headers: ownerHeaders,
      });
      assert.equal(ownStimuliResponse.status, 200);
      const ownStimuli = await ownStimuliResponse.json();
      assert.ok(ownStimuli.some(row => Number(row.id) === Number(ownStimulusId)));
      assert.ok(!ownStimuli.some(row => Number(row.id) === Number(siblingStimulusId)));
      const foreignStimuli = await fetch(`${baseUrl}/stimuli?project_id=${siblingProjectId}`, {
        headers: ownerHeaders,
      });
      assert.equal(foreignStimuli.status, 403);
      const foreignStimulusUpdate = await fetch(`${baseUrl}/stimuli/${siblingStimulusId}`, {
        method: 'PATCH',
        headers: ownerHeaders,
        body: JSON.stringify({ name: 'Forbidden stimulus rename' }),
      });
      assert.equal(foreignStimulusUpdate.status, 403);

      await pool.query(
        `UPDATE protocols SET definition = $1::jsonb WHERE id = $2`,
        [JSON.stringify({
          blocks: [{
            type: 'cognitive_task',
            trials: [
              { stimulusId: `api:${ownStimulusId}` },
              { stimulusId: `api:${siblingStimulusId}` },
            ],
          }],
        }), protocolId]
      );
      const invitation = await createInvitation(1);
      const participantStimuliResponse = await fetch(
        `${baseUrl}/invitations/by-code/${invitation.code}/stimuli`
      );
      assert.equal(participantStimuliResponse.status, 200);
      const participantStimuli = await participantStimuliResponse.json();
      assert.deepEqual(participantStimuli.map(row => Number(row.id)), [Number(ownStimulusId)]);
      const siblingContent = await fetch(
        `${baseUrl}/invitations/by-code/${invitation.code}/stimuli/${siblingStimulusId}/content`
      );
      assert.equal(siblingContent.status, 404);
    } finally {
      await pool.query(`UPDATE protocols SET definition = '{}'::jsonb WHERE id = $1`, [protocolId]);
      await pool.query('DELETE FROM projects WHERE id = $1', [siblingProjectId]);
      await pool.query('DELETE FROM stimuli WHERE id = $1', [ownStimulusId]);
    }
  });

  it('keeps invitation binding immutable and finish idempotent', async () => {
    const first = await createInvitation(3);
    const second = await createInvitation(3);
    const sessionId = `S-${randomUUID()}`;
    const firstTokenResponse = await issueToken(first, sessionId);
    const firstTokenReplay = await issueToken(first, sessionId);
    const secondTokenResponse = await issueToken(second, sessionId);
    assert.equal(firstTokenResponse.status, 200);
    assert.equal(firstTokenReplay.status, 200);
    assert.equal(secondTokenResponse.status, 409);
    const firstToken = (await firstTokenResponse.json()).token;
    assert.equal((await firstTokenReplay.json()).session_created, false);

    const initial = await ingest(first, sessionId, 'P-IDEMPOTENT', firstToken, true);
    assert.equal(initial.status, 200);
    const replay = await ingest(first, sessionId, 'P-IDEMPOTENT', firstToken, true);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).idempotent, true);

    const stored = await pool.query(
      `SELECT s.invitation_id,
              (SELECT COUNT(*)::int FROM session_features sf WHERE sf.session_id = s.id) AS features,
              (SELECT COUNT(*)::int FROM session_qc_summary sq WHERE sq.session_id = s.id) AS qc,
              (SELECT COUNT(*)::int FROM session_proxy_metrics sp WHERE sp.session_id = s.id) AS proxy
       FROM sessions s
       WHERE s.session_id = $1`,
      [sessionId]
    );
    assert.equal(Number(stored.rows[0].invitation_id), Number(first.id));
    assert.deepEqual(
      [stored.rows[0].features, stored.rows[0].qc, stored.rows[0].proxy],
      [1, 1, 1]
    );
    const usage = await pool.query(
      'SELECT id, used_runs FROM invitations WHERE id = ANY($1::int[]) ORDER BY id',
      [[first.id, second.id]]
    );
    const byId = new Map(usage.rows.map(row => [Number(row.id), row.used_runs]));
    assert.equal(byId.get(Number(first.id)), 1);
    assert.equal(byId.get(Number(second.id)), 0);
  });

  it('keeps a completed session without a replay key sealed', async () => {
    const invitation = await createInvitation(2);
    const sessionId = `S-${randomUUID()}`;
    await pool.query(
      `INSERT INTO sessions (
         session_id, participant_id, project_id, protocol_id, invitation_id,
         started_at, stopped_at
       ) VALUES ($1, $2, $3, $4, $5, current_timestamp, current_timestamp)`,
      [sessionId, 'P-SEALED', projectId, protocolId, invitation.id]
    );
    const tokenResponse = await issueToken(invitation, sessionId);
    assert.equal(tokenResponse.status, 200);
    const token = (await tokenResponse.json()).token;
    const response = await ingest(
      invitation,
      sessionId,
      'P-SEALED',
      token,
      true
    );
    assert.equal(response.status, 409);
    const stored = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM session_features sf WHERE sf.session_id = s.id) AS features,
         (SELECT COUNT(*)::int FROM session_qc_summary sq WHERE sq.session_id = s.id) AS qc,
         (SELECT COUNT(*)::int FROM session_proxy_metrics sp WHERE sp.session_id = s.id) AS proxy
       FROM sessions s
       WHERE s.session_id = $1`,
      [sessionId]
    );
    assert.deepEqual(
      [stored.rows[0].features, stored.rows[0].qc, stored.rows[0].proxy],
      [0, 0, 0]
    );
  });

  it('requires atomic tenant membership when creating staff accounts', async () => {
    const adminEmail = `s2-admin-${randomUUID()}@example.test`;
    const admin = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id, email, role, token_version`,
      [adminEmail, await bcrypt.hash('admin-password-test-only', 4)]
    );
    createdUserIds.push(admin.rows[0].id);
    const authorization = `Bearer ${issueStaffToken(admin.rows[0])}`;
    const targetEmail = `s2-unscoped-${randomUUID()}@example.test`;
    const unscoped = await fetch(`${baseUrl}/auth/users`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: targetEmail,
        password: 'temporary-password-123',
        role: 'researcher',
      }),
    });
    assert.equal(unscoped.status, 400);
    assert.equal((await unscoped.json()).code, 'staff_membership_required');
    const missing = await pool.query('SELECT 1 FROM users WHERE email = $1', [targetEmail]);
    assert.equal(missing.rows.length, 0);

    const scopedEmail = `s2-scoped-${randomUUID()}@example.test`;
    const scoped = await fetch(`${baseUrl}/auth/users`, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: scopedEmail,
        password: 'temporary-password-123',
        role: 'researcher',
        organization_ids: [organizationId],
        project_ids: [projectId],
      }),
    });
    assert.equal(scoped.status, 201);
    const scopedUser = await scoped.json();
    createdUserIds.push(scopedUser.id);
    const memberships = await pool.query(
      `SELECT
         EXISTS(
           SELECT 1 FROM user_organizations
           WHERE user_id = $1 AND organization_id = $2
         ) AS organization_member,
         EXISTS(
           SELECT 1 FROM user_projects
           WHERE user_id = $1 AND project_id = $3
         ) AS project_member`,
      [scopedUser.id, organizationId, projectId]
    );
    assert.equal(memberships.rows[0].organization_member, true);
    assert.equal(memberships.rows[0].project_member, true);

    const organizationAdminEmail = `s2-org-admin-${randomUUID()}@example.test`;
    const organizationAdmin = await fetch(`${baseUrl}/auth/users`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        email: organizationAdminEmail,
        password: 'temporary-password-123',
        role: 'org_admin',
        organization_ids: [organizationId],
        project_ids: [],
      }),
    });
    assert.equal(organizationAdmin.status, 201);
    const organizationAdminUser = await organizationAdmin.json();
    createdUserIds.push(organizationAdminUser.id);
    const adminMembership = await pool.query(
      `SELECT uo.role AS organization_role, up.role AS project_role
       FROM user_organizations uo
       INNER JOIN user_projects up ON up.user_id = uo.user_id AND up.project_id = $3
       WHERE uo.user_id = $1 AND uo.organization_id = $2`,
      [organizationAdminUser.id, organizationId, projectId]
    );
    assert.equal(adminMembership.rows[0].organization_role, 'admin');
    assert.equal(adminMembership.rows[0].project_role, 'org_admin');

    const atomicTarget = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'respondent')
       RETURNING id, token_version`,
      [
        `s2-atomic-admin-${randomUUID()}@example.test`,
        await bcrypt.hash('temporary-password-123', 4),
      ]
    );
    createdUserIds.push(atomicTarget.rows[0].id);
    const atomicUpdate = await fetch(
      `${baseUrl}/auth/users/${atomicTarget.rows[0].id}/memberships`,
      {
        method: 'PUT',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'org_admin',
          organization_ids: [organizationId],
          project_ids: [],
        }),
      }
    );
    assert.equal(atomicUpdate.status, 200);
    const atomicPayload = await atomicUpdate.json();
    assert.equal(atomicPayload.role, 'org_admin');
    assert.deepEqual(atomicPayload.organization_ids, [Number(organizationId)]);
    assert.equal(atomicPayload.project_ids.includes(Number(projectId)), true);
    const atomicStored = await pool.query(
      `SELECT u.role,
              u.token_version,
              uo.role AS organization_role,
              up.role AS project_role
       FROM users u
       INNER JOIN user_organizations uo
         ON uo.user_id = u.id AND uo.organization_id = $2
       INNER JOIN user_projects up
         ON up.user_id = u.id AND up.project_id = $3
       WHERE u.id = $1`,
      [atomicTarget.rows[0].id, organizationId, projectId]
    );
    assert.equal(atomicStored.rows[0].role, 'org_admin');
    assert.equal(atomicStored.rows[0].organization_role, 'admin');
    assert.equal(atomicStored.rows[0].project_role, 'org_admin');
    assert.equal(
      Number(atomicStored.rows[0].token_version),
      Number(atomicTarget.rows[0].token_version) + 1
    );
  });

  it('prevents PI account takeover across mixed tenant memberships', async () => {
    const pi = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'PI')
       RETURNING id, email, role, token_version`,
      [
        `s2-pi-${randomUUID()}@example.test`,
        await bcrypt.hash('pi-password-test-only', 4),
      ]
    );
    const targetPassword = 'target-password-test-only';
    const target = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'researcher')
       RETURNING id, email, role, token_version`,
      [
        `s2-mixed-scope-${randomUUID()}@example.test`,
        await bcrypt.hash(targetPassword, 4),
      ]
    );
    createdUserIds.push(pi.rows[0].id, target.rows[0].id);
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role)
       VALUES ($1, $3, 'member'), ($2, $3, 'member')`,
      [pi.rows[0].id, target.rows[0].id, organizationId]
    );
    await pool.query(
      `INSERT INTO user_projects (user_id, project_id, role)
       VALUES ($1, $3, 'PI'), ($2, $3, 'researcher')`,
      [pi.rows[0].id, target.rows[0].id, projectId]
    );

    const foreignOrganization = await pool.query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      ['Mixed-scope tenant', `mixed-scope-${randomUUID()}`]
    );
    try {
      const foreignProject = await pool.query(
        `INSERT INTO projects (organization_id, name, slug)
         VALUES ($1, 'Mixed-scope project', $2)
         RETURNING id`,
        [foreignOrganization.rows[0].id, `mixed-scope-project-${randomUUID()}`]
      );
      await pool.query(
        `INSERT INTO user_organizations (user_id, organization_id, role)
         VALUES ($1, $2, 'member')`,
        [target.rows[0].id, foreignOrganization.rows[0].id]
      );
      await pool.query(
        `INSERT INTO user_projects (user_id, project_id, role)
         VALUES ($1, $2, 'researcher')`,
        [target.rows[0].id, foreignProject.rows[0].id]
      );

      const response = await fetch(`${baseUrl}/auth/users/${target.rows[0].id}`, {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${issueStaffToken(pi.rows[0])}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password: 'attacker-controlled-password' }),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, 'user_scope_not_contained');

      const unchanged = await pool.query(
        'SELECT password_hash, token_version FROM users WHERE id = $1',
        [target.rows[0].id]
      );
      assert.equal(await bcrypt.compare(targetPassword, unchanged.rows[0].password_hash), true);
      assert.equal(Number(unchanged.rows[0].token_version), Number(target.rows[0].token_version));
    } finally {
      await pool.query(
        'DELETE FROM organizations WHERE id = $1',
        [foreignOrganization.rows[0].id]
      );
    }
  });

  it('grants developer as technical-only and strips tenant memberships', async () => {
    const adminEmail = `s2-developer-admin-${randomUUID()}@example.test`;
    const admin = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id, email, role, token_version`,
      [adminEmail, await bcrypt.hash('admin-password-test-only', 4)]
    );
    createdUserIds.push(admin.rows[0].id);
    const developerEmail = `s2-developer-${randomUUID()}@example.test`;
    const target = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'respondent')
       RETURNING id`,
      [developerEmail, await bcrypt.hash('temporary-test-password', 4)]
    );
    createdUserIds.push(target.rows[0].id);
    await pool.query(
      `INSERT INTO developer_access_emails (email, granted_by_user_id)
       VALUES ($1, $2)`,
      [developerEmail, admin.rows[0].id]
    );
    const authorization = `Bearer ${issueStaffToken(admin.rows[0])}`;
    try {
      await pool.query(
        `INSERT INTO user_organizations (user_id, organization_id, role)
         VALUES ($1, $2, 'member')`,
        [target.rows[0].id, organizationId]
      );
      await pool.query(
        `INSERT INTO user_projects (user_id, project_id, role)
         VALUES ($1, $2, 'researcher')`,
        [target.rows[0].id, projectId]
      );
      const granted = await fetch(`${baseUrl}/auth/grant-developer-access`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ email: developerEmail }),
      });
      assert.equal(granted.status, 200);
      assert.equal((await granted.json()).role, 'developer');
      const isolated = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM user_organizations WHERE user_id = $1) AS organizations,
           (SELECT COUNT(*)::int FROM user_projects WHERE user_id = $1) AS projects`,
        [target.rows[0].id]
      );
      assert.deepEqual(isolated.rows[0], { organizations: 0, projects: 0 });
    } finally {
      await pool.query('DELETE FROM developer_access_emails WHERE email = $1', [developerEmail]);
    }
  });

  it('rolls back ingest writes while retaining the admitted session and quota reservation', async () => {
    const invitation = await createInvitation(1);
    const sessionId = `S-${randomUUID()}`;
    const tokenResponse = await issueToken(invitation, sessionId);
    const token = (await tokenResponse.json()).token;

    await pool.query(`
      CREATE OR REPLACE FUNCTION s2_fail_proxy_write()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.participant_id = 'P-ROLLBACK' THEN
          RAISE EXCEPTION 'forced S2 proxy failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER s2_fail_proxy_write
      BEFORE INSERT OR UPDATE ON session_proxy_metrics
      FOR EACH ROW EXECUTE FUNCTION s2_fail_proxy_write();
    `);
    try {
      const response = await ingest(
        invitation,
        sessionId,
        'P-ROLLBACK',
        token,
        false
      );
      assert.equal(response.status, 500);
      const session = await pool.query(
        `SELECT s.participant_id,
                (SELECT COUNT(*)::int FROM session_features sf WHERE sf.session_id = s.id) AS features,
                (SELECT COUNT(*)::int FROM session_qc_summary sq WHERE sq.session_id = s.id) AS qc,
                (SELECT COUNT(*)::int FROM session_proxy_metrics sp WHERE sp.session_id = s.id) AS proxy
         FROM sessions s
         WHERE s.session_id = $1`,
        [sessionId]
      );
      const usage = await pool.query(
        'SELECT used_runs FROM invitations WHERE id = $1',
        [invitation.id]
      );
      assert.equal(session.rows.length, 1);
      assert.equal(session.rows[0].participant_id, null);
      assert.deepEqual(
        [session.rows[0].features, session.rows[0].qc, session.rows[0].proxy],
        [0, 0, 0]
      );
      assert.equal(usage.rows[0].used_runs, 1);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS s2_fail_proxy_write ON session_proxy_metrics');
      await pool.query('DROP FUNCTION IF EXISTS s2_fail_proxy_write()');
    }
  });

  it('never exceeds max_runs under parallel requests', async () => {
    const invitation = await createInvitation(5);
    const attempts = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const sessionId = `S-${randomUUID()}`;
        const tokenResponse = await issueToken(invitation, sessionId);
        if (tokenResponse.status !== 200) return { status: tokenResponse.status, sessionId };
        const token = (await tokenResponse.json()).token;
        const response = await ingest(
          invitation,
          sessionId,
          `P-CONCURRENT-${index}`,
          token,
          false
        );
        return { status: response.status, sessionId };
      })
    );
    const admitted = attempts.filter(attempt => attempt.status === 200);
    assert.equal(admitted.length, 5);
    assert.ok(attempts.every(attempt => [200, 410].includes(attempt.status)));

    const saturatedLookup = await fetch(
      `${baseUrl}/invitations/by-code/${invitation.code}`
    );
    assert.equal(saturatedLookup.status, 410);
    const admittedReloadLookup = await fetch(
      `${baseUrl}/invitations/by-code/${invitation.code}?session_id=${encodeURIComponent(admitted[0].sessionId)}`
    );
    assert.equal(admittedReloadLookup.status, 200);

    const usage = await pool.query(
      `SELECT i.used_runs, i.max_runs,
              COUNT(s.id)::int AS session_count
       FROM invitations i
       LEFT JOIN sessions s ON s.invitation_id = i.id
       WHERE i.id = $1
       GROUP BY i.id`,
      [invitation.id]
    );
    assert.equal(usage.rows[0].used_runs, 5);
    assert.equal(usage.rows[0].max_runs, 5);
    assert.equal(usage.rows[0].session_count, 5);
  });

  it('completes login -> project -> protocol -> invitation -> ingest -> analytics export over HTTP', async () => {
    const suffix = randomUUID().slice(0, 12);
    const email = `s2-full-flow-${suffix}@example.test`;
    const password = 'FullFlowTest2026!';
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id`,
      [email, await bcrypt.hash(password, 4)]
    );
    createdUserIds.push(inserted.rows[0].id);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    const authorization = `Bearer ${(await login.json()).token}`;

    let createdOrganizationId = null;
    try {
      const organizationResponse = await fetch(`${baseUrl}/organizations`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `Full flow ${suffix}`,
          slug: `full-flow-${suffix}`,
        }),
      });
      assert.equal(organizationResponse.status, 201);
      const organization = await organizationResponse.json();
      createdOrganizationId = organization.id;

      const projectResponse = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          organization_id: organization.id,
          name: `Full flow project ${suffix}`,
          slug: `full-flow-project-${suffix}`,
        }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json();

      const protocolResponse = await fetch(`${baseUrl}/protocols`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          name: `Full flow protocol ${suffix}`,
          definition: {
            version: '1.0.0',
            blocks: [{
              id: 'main',
              title: 'Main',
              trials: [{ id: 'trial-1', stimulusId: 'cat' }],
              blockConfig: {
                aoiSchemaVersion: '1.2',
                aoiDefinitions: {
                  cat: [{
                    id: 'face',
                    name: 'Face',
                    shape: 'rectangle',
                    points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }],
                    order: 1,
                    isTarget: true,
                    validityInterval: { startMs: 0, endMs: 1000 },
                  }],
                },
              },
            }],
          },
        }),
      });
      assert.equal(protocolResponse.status, 201);
      const protocol = await protocolResponse.json();

      const invitationResponse = await fetch(`${baseUrl}/invitations`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ protocol_id: protocol.id, max_runs: 1 }),
      });
      assert.equal(invitationResponse.status, 201);
      const invitation = await invitationResponse.json();
      assert.match(invitation.code, /^[A-Za-z0-9_-]{20,64}$/);

      const protocolListResponse = await fetch(
        `${baseUrl}/protocols?project_id=${encodeURIComponent(project.id)}`,
        { headers: { authorization } }
      );
      assert.equal(protocolListResponse.status, 200);
      const protocolList = await protocolListResponse.json();
      const publishedProtocol = protocolList.find(item => Number(item.id) === Number(protocol.id));
      assert.equal(publishedProtocol.invitation_code, invitation.code);
      assert.equal(publishedProtocol.invitation_expires_at, null);
      assert.equal(publishedProtocol.invitation_max_runs, 1);

      const publicLookup = await fetch(
        `${baseUrl}/invitations/by-code/${encodeURIComponent(invitation.code)}`
      );
      assert.equal(publicLookup.status, 200);
      const publicProtocol = await publicLookup.json();
      assert.equal(publicProtocol.project_id, project.id);
      assert.equal(publicProtocol.protocol_id, protocol.id);

      const sessionId = `S-FULL-${suffix}`;
      const tokenResponse = await fetch(
        `${baseUrl}/invitations/by-code/${encodeURIComponent(invitation.code)}/ingest-token`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        }
      );
      assert.equal(tokenResponse.status, 200);
      const ingestToken = (await tokenResponse.json()).token;

      const completed = await ingest(
        invitation,
        sessionId,
        `P-FULL-${suffix}`,
        ingestToken,
        true,
        {
          qcSummary: { qcScore: 95, validity: 'valid', failReasons: [] },
          cognitiveResults: [{
            blockId: 'main', trialId: 'trial-1', stimulusId: 'cat',
            response: 'Space', correct: true, rt: 410, qualityValid: true,
          }],
          gaze_analytics: {
            schemaVersion: 'gaze_analytics.v1',
            coordinateSpace: 'stimulus_normalized_0_1',
            summary: {
              sampleCountTotal: 10, sampleCountValid: 9, validFraction: 0.9,
              lowConfidenceCount: 1, offScreenCount: 0, outsideStimulusCount: 0,
              observationDurationMs: 1000, meanConfidence: 0.9,
            },
            presentations: [{
              blockId: 'main', trialId: 'trial-1', presentationId: 'presentation-1',
              stimulusId: 'cat', stimulusName: 'Cat', stimulusType: 'image',
              stimulusVersion: '1', intrinsicWidth: 800, intrinsicHeight: 600,
              grid: { width: 2, height: 2, values: [1, 0, 0, 0] },
              fixationPoints: [{
                x: 0.25, y: 0.25, startMs: 120, durationMs: 240,
                signalConfidence: 0.9,
              }],
              validObservationDurationMs: 1000,
              meanConfidence: 0.9,
            }],
          },
        }
      );
      assert.equal(completed.status, 200);

      const exhaustedLookup = await fetch(
        `${baseUrl}/invitations/by-code/${encodeURIComponent(invitation.code)}`
      );
      assert.equal(exhaustedLookup.status, 410);
      const exhaustedProtocolList = await fetch(
        `${baseUrl}/protocols?project_id=${encodeURIComponent(project.id)}`,
        { headers: { authorization } }
      );
      assert.equal(exhaustedProtocolList.status, 200);
      const exhaustedProtocol = (await exhaustedProtocolList.json())
        .find(item => Number(item.id) === Number(protocol.id));
      assert.equal(exhaustedProtocol.invitation_code, null);

      const snapshotResponse = await fetch(`${baseUrl}/analytics/v1/snapshots`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: '1.0', mode: 'group', analysisLevel: 'level_1',
          projectId: project.id, protocolId: protocol.id, protocolVersion: '1.0.0',
          metricIds: ['aoi.dwell_time_ms', 'task.accuracy_pct', 'viz.heatmap'],
          filters: {
            blockIds: ['main'], stimulusIds: ['cat'], qcMode: 'all',
            qcChannels: ['task', 'gaze'], includeIncompleteSessions: false,
          },
        }),
      });
      assert.equal(snapshotResponse.status, 201);
      const snapshot = await snapshotResponse.json();
      assert.equal(snapshot.includedSessionIds.length, 1);
      assert.equal(Number.isInteger(snapshot.includedSessionIds[0]), true);

      const exportResponse = await fetch(
        `${baseUrl}/analytics/v1/exports?snapshot_id=${snapshot.id}&format=json&content=both`,
        { headers: { authorization } }
      );
      assert.equal(exportResponse.status, 200);
      assert.equal(exportResponse.headers.get('x-analysis-snapshot-id'), snapshot.id);
      const exported = await exportResponse.json();
      assert.equal(exported.snapshot.id, snapshot.id);
      assert.equal(exported.snapshot.datasetHash, snapshot.datasetHash);
      assert.equal(exported.counts.sessions, 1);
      assert.ok(exported.summary.group.metrics.some(metric => (
        metric.metricId === 'aoi.dwell_time_ms' && metric.median === 240
      )));
    } finally {
      if (createdOrganizationId) {
        await pool.query('DELETE FROM organizations WHERE id = $1', [createdOrganizationId]);
      }
    }
  });

  it('uses an HttpOnly staff cookie with CSRF restored by /auth/me', async () => {
    const email = `s2-cookie-${randomUUID()}@example.test`;
    const password = 'cookie-password-test-only';
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id`,
      [email, await bcrypt.hash(password, 4)]
    );
    createdUserIds.push(inserted.rows[0].id);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-auth-transport': 'cookie',
      },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    const auth = await login.json();
    const setCookie = login.headers.get('set-cookie');
    assert.equal(auth.auth_transport, 'cookie');
    assert.equal(auth.token, undefined);
    assert.match(auth.csrf_token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(';', 1)[0];

    const current = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie },
    });
    assert.equal(current.status, 200);
    const currentUser = await current.json();
    assert.equal(currentUser.email, email);
    assert.equal(currentUser.csrf_token, auth.csrf_token);

    const protocolBody = {
      project_id: projectId,
      name: `Cookie protocol ${randomUUID()}`,
      definition: {
        version: '1.0.0',
        blocks: [{ id: 'main', blockConfig: {
          aoiSchemaVersion: '1.2',
          aoiDefinitions: { cat: [{
            id: 'face', name: 'Face', shape: 'rectangle',
            points: [{ x: 0.2, y: 0.2 }, { x: 0.7, y: 0.8 }],
            order: 1, isTarget: true,
            validityInterval: { startMs: 0, endMs: 1000 },
          }] },
        } }],
      },
    };
    const missingCsrf = await fetch(`${baseUrl}/protocols`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(protocolBody),
    });
    assert.equal(missingCsrf.status, 403);
    assert.equal((await missingCsrf.json()).code, 'csrf_token_invalid');

    const accepted = await fetch(`${baseUrl}/protocols`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-csrf-token': currentUser.csrf_token,
      },
      body: JSON.stringify(protocolBody),
    });
    assert.equal(accepted.status, 201);
    const acceptedProtocol = await accepted.json();
    assert.equal(acceptedProtocol.definition.blocks[0].blockConfig.aoiDefinitions.cat[0].id, 'face');

    const reloadedProtocol = await fetch(`${baseUrl}/protocols/${acceptedProtocol.id}`, {
      headers: { cookie },
    });
    assert.equal(reloadedProtocol.status, 200);
    const reloadedProtocolBody = await reloadedProtocol.json();
    assert.deepEqual(
      reloadedProtocolBody.definition.blocks[0].blockConfig.aoiDefinitions,
      protocolBody.definition.blocks[0].blockConfig.aoiDefinitions
    );

    const invalidAoi = await fetch(`${baseUrl}/protocols`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-csrf-token': currentUser.csrf_token,
      },
      body: JSON.stringify({
        ...protocolBody,
        name: `Invalid AOI protocol ${randomUUID()}`,
        definition: {
          version: '1.0.0',
          blocks: [{ id: 'main', blockConfig: {
            aoiSchemaVersion: '1.2',
            aoiDefinitions: { cat: [{
              id: 'face', shape: 'rectangle',
              points: [{ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.7 }],
              order: 1, validityInterval: { startMs: 0, endMs: 1000 },
            }] },
          } }],
        },
      }),
    });
    assert.equal(invalidAoi.status, 422);
    assert.equal((await invalidAoi.json()).code, 'protocol_aoi_invalid');
  });

  it('serves analytics snapshots and exports only inside tenant membership', async () => {
    await pool.query(
      `UPDATE protocols SET definition = $1::jsonb WHERE id = $2`,
      [JSON.stringify({
        version: '1.0.0',
        blocks: [{
          id: 'main',
          title: 'Main',
          blockConfig: {
            aoiSchemaVersion: '1.2',
            aoiDefinitions: {
              cat: [{
                id: 'face', name: 'Face', shape: 'rectangle',
                points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }],
                order: 1, isTarget: true,
                validityInterval: { startMs: 0, endMs: 1000 },
              }],
            },
          },
          trials: [{ id: 'trial-1', stimulusId: 'cat' }],
        }],
      }), protocolId]
    );
    const analyticsInvitation = await createInvitation(1);
    const analyticsSessionId = `S-ANALYTICS-${randomUUID()}`;
    const analyticsTokenResponse = await issueToken(analyticsInvitation, analyticsSessionId);
    assert.equal(analyticsTokenResponse.status, 200);
    const analyticsToken = (await analyticsTokenResponse.json()).token;
    const analyticsIngest = await ingest(
      analyticsInvitation,
      analyticsSessionId,
      'P-ANALYTICS',
      analyticsToken,
      true,
      {
        qcSummary: { qcScore: 92, validity: 'valid', failReasons: [] },
        cognitiveResults: [{
          blockId: 'main', trialId: 'trial-1', stimulusId: 'cat',
          response: 'Space', correct: true, rt: 410, qualityValid: true,
        }],
        gaze_analytics: {
          schemaVersion: 'gaze_analytics.v1',
          coordinateSpace: 'stimulus_normalized_0_1',
          summary: {
            sampleCountTotal: 20, sampleCountValid: 18, validFraction: 0.9,
            lowConfidenceCount: 1, offScreenCount: 1, outsideStimulusCount: 0,
            observationDurationMs: 1000, meanConfidence: 0.9,
          },
          presentations: [{
            blockId: 'main', trialId: 'trial-1', presentationId: 'presentation-1',
            stimulusId: 'cat', stimulusName: 'Cat', stimulusType: 'image',
            stimulusVersion: '1', intrinsicWidth: 800, intrinsicHeight: 600,
            grid: { width: 2, height: 2, values: [1, 0, 0, 0] },
            fixationPoints: [{ x: 0.25, y: 0.25, startMs: 120, durationMs: 240, signalConfidence: 0.9 }],
            validObservationDurationMs: 1000, meanConfidence: 0.9,
          }],
        },
      }
    );
    assert.equal(analyticsIngest.status, 200);

    const researcher = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'researcher')
       RETURNING id, email, role, token_version`,
      [`s2-analytics-${randomUUID()}@example.test`, await bcrypt.hash('analytics-password-test-only', 4)]
    );
    createdUserIds.push(researcher.rows[0].id);
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role)
       VALUES ($1, $2, 'member')`,
      [researcher.rows[0].id, organizationId]
    );
    await pool.query(
      `INSERT INTO user_projects (user_id, project_id, role)
       VALUES ($1, $2, 'researcher')`,
      [researcher.rows[0].id, projectId]
    );
    const authorization = `Bearer ${issueStaffToken(researcher.rows[0])}`;

    const options = await fetch(
      `${baseUrl}/analytics/v1/filter-options?project_id=${projectId}&protocol_id=${protocolId}`,
      { headers: { authorization } }
    );
    assert.equal(options.status, 200);
    const optionBody = await options.json();
    assert.ok(optionBody.aois.some(aoi => aoi.id === 'face'));

    const foreignOrganization = await pool.query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       RETURNING id`,
      ['Foreign analytics tenant', `foreign-analytics-${randomUUID()}`]
    );
    try {
      const foreignProject = await pool.query(
        `INSERT INTO projects (organization_id, name, slug)
         VALUES ($1, 'Foreign project', $2)
         RETURNING id`,
        [foreignOrganization.rows[0].id, `foreign-project-${randomUUID()}`]
      );
      const foreignProtocol = await pool.query(
        `INSERT INTO protocols (project_id, name, definition)
         VALUES ($1, 'Foreign protocol', '{}'::jsonb)
         RETURNING id`,
        [foreignProject.rows[0].id]
      );
      const denied = await fetch(
        `${baseUrl}/analytics/v1/filter-options?project_id=${foreignProject.rows[0].id}&protocol_id=${foreignProtocol.rows[0].id}`,
        { headers: { authorization } }
      );
      assert.equal(denied.status, 404);
    } finally {
      await pool.query('DELETE FROM organizations WHERE id = $1', [foreignOrganization.rows[0].id]);
    }

    const snapshotResponse = await fetch(`${baseUrl}/analytics/v1/snapshots`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: '1.0',
        mode: 'group',
        analysisLevel: 'level_1',
        projectId,
        protocolId,
        protocolVersion: '1.0.0',
        metricIds: ['aoi.dwell_time_ms', 'aoi.fixation_count', 'aoi.ttff_ms', 'viz.heatmap'],
        filters: {
          blockIds: ['main'],
          stimulusIds: ['cat'],
          qcMode: 'all',
          qcChannels: ['task', 'gaze'],
          includeIncompleteSessions: false,
        },
      }),
    });
    assert.equal(snapshotResponse.status, 201);
    const snapshot = await snapshotResponse.json();
    assert.match(snapshot.id, /^[0-9a-f-]{36}$/i);
    assert.equal(snapshot.includedSessionIds.length, 1);

    const groupSummary = await fetch(
      `${baseUrl}/analytics/v1/groups/summary?snapshot_id=${snapshot.id}`,
      { headers: { authorization } }
    );
    assert.equal(groupSummary.status, 200);
    const groupSummaryBody = await groupSummary.json();
    const dwell = groupSummaryBody.data.metrics.find(metric => (
      metric.metricId === 'aoi.dwell_time_ms' && metric.scope?.aoiId === 'face'
    ));
    assert.equal(dwell.status, 'computed');
    assert.equal(dwell.median, 240);

    const groupHeatmap = await fetch(
      `${baseUrl}/analytics/v1/groups/heatmap?snapshot_id=${snapshot.id}`,
      { headers: { authorization } }
    );
    assert.equal(groupHeatmap.status, 200);
    const heatmapBody = await groupHeatmap.json();
    assert.equal(heatmapBody.data.equalParticipantWeight, true);
    assert.equal(heatmapBody.data.nFixations, 1);

    const comparison = await fetch(
      `${baseUrl}/analytics/v1/comparisons/not-configured?snapshot_id=${snapshot.id}`,
      { headers: { authorization } }
    );
    assert.equal(comparison.status, 200);
    const comparisonBody = await comparison.json();
    assert.equal(comparisonBody.data.readiness, 'not_configured');
    assert.equal(comparisonBody.data.pValueAdjusted, null);
    assert.ok(Array.isArray(comparisonBody.data.readinessChecks));

    const exported = await fetch(
      `${baseUrl}/analytics/v1/exports?snapshot_id=${snapshot.id}&format=json&content=both`,
      { headers: { authorization } }
    );
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get('x-analysis-snapshot-id'), snapshot.id);
    const bundle = await exported.json();
    assert.equal(bundle.snapshot.id, snapshot.id);
    assert.equal(bundle.counts.sessions, snapshot.includedSessionIds.length);
    assert.equal(bundle.kind, 'analytics_export');
    assert.equal(bundle.content, 'both');
    assert.ok(bundle.summary.group.metrics.some(metric => metric.scope?.aoiId === 'face'));
    assert.ok(bundle.longData.some(metric => metric.metricId === 'aoi.dwell_time_ms'));
    assert.ok(bundle.dataDictionary.every(metric => Object.hasOwn(metric, 'description')));

    const summaryOnly = await fetch(
      `${baseUrl}/analytics/v1/exports?snapshot_id=${snapshot.id}&format=json&content=summary`,
      { headers: { authorization } }
    );
    assert.equal(summaryOnly.status, 200);
    const summaryOnlyBundle = await summaryOnly.json();
    assert.ok(summaryOnlyBundle.summary.group);
    assert.equal(summaryOnlyBundle.longData, null);
  });

  it('rejects a staff JWT immediately after role/password token version changes', async () => {
    const email = `s2-staff-${randomUUID()}@example.test`;
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id, email, role, token_version`,
      [email, await bcrypt.hash('temporary-test-password', 4)]
    );
    const staff = inserted.rows[0];
    staffUserId = staff.id;
    const token = jwt.sign(
      {
        sub: staff.id,
        email: staff.email,
        role: staff.role,
        ver: staff.token_version,
      },
      config.jwt.secret,
      {
        algorithm: 'HS256',
        issuer: config.jwt.staffIssuer,
        audience: config.jwt.staffAudience,
        expiresIn: '5m',
      }
    );
    const before = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(before.status, 200);

    await pool.query(
      `UPDATE users
       SET role = 'analyst', token_version = token_version + 1
       WHERE id = $1`,
      [staff.id]
    );
    const after = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(after.status, 401);
  });
});
