const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
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

  it('refuses destructive migration down for private metadata-only items and divergent invitation snapshots', async () => {
    let downSql;
    require('../migrations/1699000000017_stimulus_versions').down({ sql: sql => { downSql = sql; } });
    const client = await pool.connect();
    try {
      const { checkReleaseCompatibility } = require('../scripts/check-release-compatibility');
      assert.equal(await checkReleaseCompatibility(client), true);
      await client.query('BEGIN');
      await client.query('INSERT INTO pgmigrations(name,run_on) VALUES($1,current_timestamp)', [`future-contract-${randomUUID()}`]);
      await assert.rejects(checkReleaseCompatibility(client), /newer API/);
      await client.query('ROLLBACK');
      assert.equal(Number((await client.query('SELECT count(*) FROM stimulus_versions')).rows[0].count), 0);
      for (const kind of ['private-item', 'private-folder', 'snapshot']) {
        await client.query('BEGIN');
        if (kind === 'private-item') await client.query("INSERT INTO stimuli(project_id,name,visibility) VALUES($1,'Private metadata-only','private')", [projectId]);
        if (kind === 'private-folder') await client.query("INSERT INTO stimulus_folders(project_id,name,visibility) VALUES($1,'Private folder','private')", [projectId]);
        if (kind === 'snapshot') await client.query("INSERT INTO invitations(protocol_id,code,protocol_definition) VALUES($1,$2,'{\"blocks\":[{\"id\":\"snapshot\"}]}'::jsonb)", [protocolId, randomUUID()]);
        await assert.rejects(client.query(downSql), /coordinated pre-migration backup/);
        await client.query('ROLLBACK');
        assert.ok((await client.query("SELECT column_name FROM information_schema.columns WHERE table_name='stimuli' AND column_name='visibility'")).rowCount);
      }
    } finally { await client.query('ROLLBACK'); client.release(); }
  });

  it('enforces the HTTP access matrix and reserves project deletion for tenant leads', async () => {
    const foreignOrg = (await pool.query("INSERT INTO organizations(name,slug) VALUES('Foreign role fixture',$1) RETURNING id", [randomUUID()])).rows[0].id;
    const foreignProject = (await pool.query("INSERT INTO projects(organization_id,name,slug) VALUES($1,'Foreign role project',$2) RETURNING id", [foreignOrg, randomUUID()])).rows[0].id;
    try {
      for (const role of ['admin', 'org_admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer', 'respondent']) {
        const user = (await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING *',
          [`role-${randomUUID()}@example.test`, 'synthetic-no-login', role])).rows[0];
        createdUserIds.push(user.id);
        await pool.query("INSERT INTO user_organizations(user_id,organization_id,role) VALUES($1,$2,'member')", [user.id, organizationId]);
        await pool.query("INSERT INTO user_projects(user_id,project_id,role) VALUES($1,$2,'researcher')", [user.id, projectId]);
        const headers = { authorization: `Bearer ${issueStaffToken(user)}`, 'content-type': 'application/json' };
        assert.equal((await fetch(`${baseUrl}/stimuli?project_id=${projectId}`, { headers })).status,
          ['developer', 'respondent'].includes(role) ? 403 : 200, role + ' read');
        assert.equal((await fetch(`${baseUrl}/stimuli?project_id=${foreignProject}`, { headers })).status,
          role === 'admin' ? 200 : 403, role + ' foreign scope');
        const write = await fetch(`${baseUrl}/stimuli`, { method: 'POST', headers,
          body: JSON.stringify({ project_id: projectId, name: 'Role write fixture', metadata: {} }) });
        assert.equal(write.status, ['admin', 'org_admin', 'PI', 'researcher'].includes(role) ? 201 : 403, role + ' write');
        const disposable = (await pool.query("INSERT INTO projects(organization_id,name,slug) VALUES($1,'Delete role fixture',$2) RETURNING id", [organizationId, randomUUID()])).rows[0].id;
        await pool.query("INSERT INTO user_projects(user_id,project_id,role) VALUES($1,$2,'researcher')", [user.id, disposable]);
        const deletion = await fetch(`${baseUrl}/projects/${disposable}`, { method: 'DELETE', headers });
        const allowed = ['admin', 'org_admin', 'PI'].includes(role);
        assert.equal(deletion.status, allowed ? 204 : 403, role + ' delete');
        assert.equal((await pool.query('SELECT 1 FROM projects WHERE id=$1', [disposable])).rowCount, allowed ? 0 : 1);
      }
      assert.equal((await fetch(`${baseUrl}/stimuli?project_id=${projectId}`)).status, 401);
    } finally { await pool.query('DELETE FROM organizations WHERE id=$1', [foreignOrg]); }
  });

  it('keeps personal media private and published media immutable after sharing, replacement and protocol edits', async () => {
    const suffix = randomUUID();
    const users = (await pool.query(`INSERT INTO users (email, password_hash, role)
      VALUES ($1, $3, 'researcher'), ($2, $3, 'researcher') RETURNING id, email, role, token_version`,
    [`media-owner-${suffix}@example.test`, `media-peer-${suffix}@example.test`, await bcrypt.hash('local-media-test-only', 4)])).rows;
    createdUserIds.push(...users.map(user => user.id));
    for (const user of users) {
      await pool.query("INSERT INTO user_organizations(user_id, organization_id, role) VALUES($1, $2, 'member')", [user.id, organizationId]);
      await pool.query("INSERT INTO user_projects(user_id, project_id, role) VALUES($1, $2, 'researcher')", [user.id, projectId]);
    }
    const [owner, peer] = users.map(user => ({ authorization: `Bearer ${issueStaffToken(user)}` }));
    const request = (url, headers, data, method = 'POST') => fetch(baseUrl + url, {
      method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(data),
    });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    // A corrupt pre-upgrade file has no validated version; both publication and admission must reject it.
    const legacyPath = `legacy-corrupt-${suffix}.png`;
    const legacyAbsolute = path.join(config.storage.uploadsRoot, 'stimuli', legacyPath);
    await fs.promises.writeFile(legacyAbsolute, png.subarray(0, 8));
    try {
      const legacy = (await pool.query(`INSERT INTO stimuli(project_id,name,mime_type,size_bytes,metadata,created_by,visibility)
        VALUES($1,'Legacy corrupt image','image/png',8,$2::jsonb,$3,'private') RETURNING id`,
      [projectId, JSON.stringify({ content_path: legacyPath }), users[0].id])).rows[0];
      const legacyDefinition = { blocks: [{ id: 'legacy', trials: [{ stimulusId: String(legacy.id) }] }] };
      const draft = (await pool.query('INSERT INTO protocols(project_id,name,definition) VALUES($1,$2,$3::jsonb) RETURNING id',
        [projectId, `Legacy corrupt ${suffix}`, JSON.stringify(legacyDefinition)])).rows[0];
      const publish = await request('/invitations', owner, { protocol_id: draft.id });
      assert.equal(publish.status, 422, await publish.clone().text());
      const legacyInvitation = (await pool.query('INSERT INTO invitations(protocol_id,code,max_runs) VALUES($1,$2,1) RETURNING *',
        [draft.id, `LEGACY-${suffix}`])).rows[0];
      const failedSession = `S-LEGACY-CORRUPT-${suffix}`;
      assert.equal((await issueToken(legacyInvitation, failedSession)).status, 409);
      assert.equal((await pool.query('SELECT used_runs FROM invitations WHERE id=$1', [legacyInvitation.id])).rows[0].used_runs, 0);
      assert.equal((await pool.query('SELECT 1 FROM sessions WHERE session_id=$1', [failedSession])).rowCount, 0);
      assert.equal((await pool.query('SELECT 1 FROM stimulus_versions WHERE stimulus_id=$1', [legacy.id])).rowCount, 0);
    } finally { await fs.promises.unlink(legacyAbsolute); }
    const uploadFile = (url, headers, bytes, mime = 'image/png', extra = {}) => {
      const form = new FormData();
      form.append('project_id', String(projectId));
      form.append('file', new Blob([bytes], { type: mime }), 'local-media-test' + (mime === 'image/png' ? '.png' : '.mp4'));
      for (const [key, value] of Object.entries(extra)) form.append(key, String(value));
      return fetch(baseUrl + url, { method: 'POST', headers, body: form });
    };
    const forged = await uploadFile('/stimuli/upload', owner, png, 'image/png', { created_by: users[1].id });
    assert.equal(forged.status, 422);
    const wav = Buffer.alloc(44 + 1600);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
    const audio = await uploadFile('/stimuli/upload', owner, wav, 'audio/wav');
    assert.equal(audio.status, 201, await audio.clone().text());
    const audioRow = await audio.json();
    const audioVersion = (await pool.query('SELECT media_info,sha256,preview_status FROM stimulus_versions WHERE id=$1', [audioRow.current_version_id])).rows[0];
    assert.equal(audioVersion.preview_status, 'unsupported');
    assert.equal(audioVersion.media_info.validated_sha256, audioVersion.sha256);
    assert.equal((await uploadFile('/stimuli/upload', owner, wav.subarray(0, 12), 'audio/wav')).status, 422);
    const truncated = await uploadFile('/stimuli/upload', owner, png.subarray(0, 8));
    assert.equal(truncated.status, 422, await truncated.clone().text());
    assert.ok(['media_decode_failed', 'media_dimensions_invalid'].includes((await truncated.json()).code));
    const folderResponse = await request('/stimuli/folders', owner, { project_id: projectId, name: 'Personal folder' });
    assert.equal(folderResponse.status, 201);
    const folder = await folderResponse.json();
    const uploaded = await uploadFile('/stimuli/upload', owner, png, 'image/png', {
      folder_id: folder.id, metadata: JSON.stringify({ emotion: 'happy', label: 'Original label',
        researcher_note: 'PRIVATE RESEARCH NOTES', participant_email: 'private-person@example.test' }),
    });
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const stimulus = await uploaded.json();
    assert.equal(stimulus.visibility, 'private');
    assert.equal(stimulus.created_by, users[0].id);
    assert.match(stimulus.current_version_id, /^[0-9a-f-]{36}$/);
    assert.equal(stimulus.metadata.content_path, undefined);
    const list = async headers => (await (await fetch(`${baseUrl}/stimuli?project_id=${projectId}`, { headers })).json());
    assert.ok((await list(owner)).some(row => row.id === stimulus.id));
    assert.ok(!(await list(peer)).some(row => row.id === stimulus.id));
    assert.ok(!(await (await fetch(`${baseUrl}/stimuli/folders?project_id=${projectId}`, { headers: peer })).json()).some(row => row.id === folder.id));
    for (const url of [stimulus.content_url, stimulus.preview_url]) assert.equal((await fetch(baseUrl + url, { headers: peer })).status, 403);
    assert.equal((await uploadFile(`/stimuli/${stimulus.id}/content`, peer, png)).status, 403);
    assert.equal((await request(`/stimuli/${stimulus.id}`, peer, { visibility: 'project' }, 'PATCH')).status, 403);

    const definition = { version: '1.0.0', blocks: [{ id: 'main', trials: [{ id: 'trial-1', stimulusId: String(stimulus.id) }] }] };
    const deniedProtocol = await request('/protocols', peer, { project_id: projectId, name: 'Private ID must not publish', definition });
    assert.equal(deniedProtocol.status, 422);
    const saved = await request('/protocols', owner, { project_id: projectId, name: `Pinned ${suffix}`, definition });
    assert.equal(saved.status, 201, await saved.clone().text());
    const protocol = await saved.json();
    const oldVersion = protocol.definition.mediaManifest[String(stimulus.id)].versionId;
    assert.equal(oldVersion, stimulus.current_version_id);
    assert.equal((await request('/invitations', peer, { protocol_id: protocol.id })).status, 422);
    for (const url of [`/protocols/${protocol.id}`, `/protocols?project_id=${projectId}`]) {
      const text = await (await fetch(baseUrl + url, { headers: peer })).text();
      assert.ok(!text.includes('PRIVATE RESEARCH NOTES') && !text.includes('private-person@example.test'));
    }
    const stored = (await pool.query('SELECT definition FROM protocols WHERE id = $1', [protocol.id])).rows[0];
    assert.equal(stored.definition.mediaManifest[String(stimulus.id)].metadata.researcher_note, 'PRIVATE RESEARCH NOTES');
    const inviteResponse = await request('/invitations', owner, { protocol_id: protocol.id });
    assert.equal(inviteResponse.status, 201, await inviteResponse.clone().text());
    const invitation = await inviteResponse.json();
    const publicDefinition = await (await fetch(`${baseUrl}/invitations/by-code/${invitation.code}`)).text();
    assert.ok(!publicDefinition.includes('PRIVATE RESEARCH NOTES') && !publicDefinition.includes('private-person@example.test'));
    // A historical publication grant never authorizes another publication of private media.
    assert.equal((await request('/invitations', peer, { protocol_id: protocol.id })).status, 422);
    const rejectedImageReplacement = await uploadFile(`/stimuli/${stimulus.id}/content`, owner, png.subarray(0, 8));
    assert.equal(rejectedImageReplacement.status, 422);
    assert.deepEqual(Buffer.from(await (await fetch(baseUrl + stimulus.content_url, { headers: owner })).arrayBuffer()), png);
    assert.equal((await request(`/stimuli/${stimulus.id}`, owner, {
      metadata: { emotion: 'sad', label: 'Edited label' },
    }, 'PATCH')).status, 200);
    const originalDescriptors = await (await fetch(`${baseUrl}/invitations/by-code/${invitation.code}/stimuli`)).json();
    assert.equal(originalDescriptors[0].metadata.emotion, 'happy');
    assert.equal(originalDescriptors[0].metadata.label, 'Original label');
    const participantMedia = async invite => {
      const rows = await (await fetch(`${baseUrl}/invitations/by-code/${invite.code}/stimuli`)).json();
      return Buffer.from(await (await fetch(baseUrl + rows[0].content_url)).arrayBuffer());
    };
    assert.deepEqual(await participantMedia(invitation), png);
    assert.equal((await fetch(baseUrl + stimulus.content_url, { headers: peer })).status, 200);
    assert.ok(!(await list(peer)).some(row => row.id === stimulus.id));
    assert.equal((await request(`/stimuli/${stimulus.id}`, owner, { visibility: 'project' }, 'PATCH')).status, 200);
    assert.ok((await list(peer)).some(row => row.id === stimulus.id));
    const sharedInviteResponse = await request('/invitations', peer, { protocol_id: protocol.id });
    assert.equal(sharedInviteResponse.status, 201, await sharedInviteResponse.clone().text());
    assert.equal((await request(`/stimuli/${stimulus.id}`, peer, { visibility: 'private' }, 'PATCH')).status, 403);
    assert.equal((await request(`/stimuli/${stimulus.id}`, owner, { visibility: 'private' }, 'PATCH')).status, 200);
    assert.ok(!(await list(peer)).some(row => row.id === stimulus.id));
    assert.equal((await request('/invitations', peer, { protocol_id: protocol.id })).status, 422);

    const originalFile = path.join(config.storage.uploadsRoot, 'stimuli',
      (await pool.query('SELECT content_path FROM stimulus_versions WHERE id = $1', [oldVersion])).rows[0].content_path);
    const unavailableSession = `S-UNAVAILABLE-${randomUUID()}`;
    const quotaBefore = Number((await pool.query('SELECT used_runs FROM invitations WHERE id = $1', [invitation.id])).rows[0].used_runs);
    for (const damage of ['missing', 'corrupt']) {
      if (damage === 'missing') await fs.promises.rename(originalFile, originalFile + '.held');
      else await fs.promises.writeFile(originalFile, png.subarray(0, 8));
      try {
        const denied = await issueToken(invitation, unavailableSession);
        assert.equal(denied.status, 409, await denied.clone().text());
        assert.equal((await denied.json()).code, 'invitation_stimulus_unavailable');
        assert.equal(Number((await pool.query('SELECT used_runs FROM invitations WHERE id = $1', [invitation.id])).rows[0].used_runs), quotaBefore);
        assert.equal((await pool.query('SELECT 1 FROM sessions WHERE session_id = $1', [unavailableSession])).rowCount, 0);
      } finally {
        if (damage === 'missing') await fs.promises.rename(originalFile + '.held', originalFile);
        else await fs.promises.writeFile(originalFile, png);
      }
    }

    const pngChunk = (type, data) => {
      const content = Buffer.concat([Buffer.from(type), data]);
      let crc = 0xffffffff;
      for (const byte of content) {
        crc ^= byte;
        for (let bit = 0; bit < 8; ++bit) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
      const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
      return Buffer.concat([length, content, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    const replacement = Buffer.concat([png.subarray(0, 8), pngChunk('IHDR', header),
      pngChunk('IDAT', require('node:zlib').deflateSync(Buffer.from([0, 255, 0, 0, 255]))), pngChunk('IEND', Buffer.alloc(0))]);
    const replaced = await uploadFile(`/stimuli/${stimulus.id}/content`, owner, replacement);
    assert.equal(replaced.status, 200, await replaced.clone().text());
    const latest = await replaced.json();
    assert.notEqual(latest.current_version_id, oldVersion);
    assert.deepEqual(await participantMedia(invitation), png);
    assert.deepEqual(Buffer.from(await (await fetch(baseUrl + stimulus.content_url, { headers: owner })).arrayBuffer()), png);
    assert.deepEqual(Buffer.from(await (await fetch(baseUrl + latest.content_url, { headers: owner })).arrayBuffer()), replacement);
    assert.equal((await fetch(baseUrl + latest.content_url, { headers: peer })).status, 403);
    await assert.rejects(pool.query("UPDATE stimulus_versions SET sha256 = repeat('0', 64) WHERE id = $1", [oldVersion]), /Immutable media version/);
    await assert.rejects(pool.query("UPDATE invitations SET protocol_definition = '{}'::jsonb WHERE id = $1", [invitation.id]), /Published invitation/);

    const patched = await request(`/protocols/${protocol.id}`, owner, { definition }, 'PATCH');
    assert.equal(patched.status, 200, await patched.clone().text());
    const newInvite = await request('/invitations', owner, { protocol_id: protocol.id });
    assert.equal(newInvite.status, 201);
    const latestInvitation = await newInvite.json();
    const newDescriptors = await (await fetch(`${baseUrl}/invitations/by-code/${latestInvitation.code}/stimuli`)).json();
    assert.equal(newDescriptors[0].metadata.emotion, 'sad');
    assert.deepEqual(await participantMedia(latestInvitation), replacement);
    assert.deepEqual(await participantMedia(invitation), png);
    assert.equal((await fetch(`${baseUrl}/stimuli/${stimulus.id}`, { method: 'DELETE', headers: owner })).status, 409);

    const sessionId = `S-PINNED-${randomUUID()}`;
    const admission = await issueToken(invitation, sessionId);
    assert.equal(admission.status, 200);
    const token = (await admission.json()).token;
    const ingested = await ingest(invitation, sessionId, 'P-PINNED', token, true, {
      gaze_analytics: { schemaVersion: 'gaze_analytics.v1', coordinateSpace: 'stimulus_normalized_0_1',
        presentations: [{ blockId: 'main', trialId: 'trial-1', presentationId: 'pinned-presentation',
          stimulusId: String(stimulus.id), stimulusVersion: oldVersion, stimulusType: 'image',
          grid: { width: 2, height: 2, values: [1, 0, 0, 0] }, fixationPoints: [], validObservationDurationMs: 1000 }] },
    });
    assert.equal(ingested.status, 200, await ingested.clone().text());
    const snapshotResponse = await request('/analytics/v1/snapshots', owner, {
      schemaVersion: '1.0', mode: 'session', analysisLevel: 'level_1', projectId, protocolId: protocol.id,
      protocolVersion: '1.0.0', metricIds: ['viz.heatmap'], filters: { sessionIds: [sessionId], stimulusIds: [String(stimulus.id)], qcMode: 'all', qcChannels: ['task', 'gaze'] },
    });
    assert.equal(snapshotResponse.status, 201, await snapshotResponse.clone().text());
    const snapshot = await snapshotResponse.json();
    const heatmapResponse = await fetch(`${baseUrl}/analytics/v1/sessions/${sessionId}/heatmap?snapshot_id=${snapshot.id}`, { headers: peer });
    assert.equal(heatmapResponse.status, 200, await heatmapResponse.clone().text());
    const heatmap = await heatmapResponse.json();
    assert.equal(heatmap.data.stimulus.version, oldVersion);
    assert.match(heatmap.data.stimulus.contentUrl, new RegExp(oldVersion));
    assert.deepEqual(Buffer.from(await (await fetch(baseUrl + heatmap.data.stimulus.contentUrl, { headers: peer })).arrayBuffer()), png);

    const newSessionId = `S-PINNED-${randomUUID()}`;
    const newAdmission = await issueToken(latestInvitation, newSessionId);
    assert.equal(newAdmission.status, 200);
    assert.equal((await ingest(latestInvitation, newSessionId, 'P-PINNED-NEW', (await newAdmission.json()).token, true, {
      gaze_analytics: { schemaVersion: 'gaze_analytics.v1', coordinateSpace: 'stimulus_normalized_0_1',
        presentations: [{ blockId: 'main', trialId: 'trial-1', presentationId: 'new-presentation',
          stimulusId: String(stimulus.id), stimulusVersion: latest.current_version_id, stimulusType: 'image',
          grid: { width: 2, height: 2, values: [0, 1, 0, 0] }, fixationPoints: [], validObservationDurationMs: 1000 }] },
    })).status, 200);
    const groupSnapshotResponse = await request('/analytics/v1/snapshots', owner, {
      schemaVersion: '1.0', mode: 'group', analysisLevel: 'level_1', projectId, protocolId: protocol.id,
      protocolVersion: '1.0.0', metricIds: ['viz.heatmap'], filters: { sessionIds: [sessionId, newSessionId],
        blockIds: ['main'], stimulusIds: [String(stimulus.id)], qcMode: 'all', qcChannels: ['task', 'gaze'] },
    });
    assert.equal(groupSnapshotResponse.status, 201, await groupSnapshotResponse.clone().text());
    const groupSnapshot = await groupSnapshotResponse.json();
    const mixedHeatmapResponse = await fetch(`${baseUrl}/analytics/v1/groups/heatmap?snapshot_id=${groupSnapshot.id}`, { headers: owner });
    assert.equal(mixedHeatmapResponse.status, 200);
    const mixedHeatmap = await mixedHeatmapResponse.json();
    assert.equal(mixedHeatmap.data.status, 'no_data');
    assert.equal(mixedHeatmap.data.reason, 'stimulus_versions_mixed');
    assert.equal(mixedHeatmap.data.stimulus.contentUrl, null);
    assert.deepEqual(mixedHeatmap.data.grid.values, []);

    let downSql;
    require('../migrations/1699000000017_stimulus_versions').down({ sql: value => { downSql = value; } });
    await assert.rejects(pool.query(downSql), /Media versions exist/);

    const invalidVideo = await uploadFile('/stimuli/upload', owner, Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'), 'video/mp4');
    assert.equal(invalidVideo.status, 422, await invalidVideo.clone().text());
    assert.equal((await invalidVideo.json()).code, 'media_decode_failed');
    const video = await uploadFile('/stimuli/upload', owner, fs.readFileSync(path.join(__dirname, 'fixtures/stimulus-video.mp4')), 'video/mp4');
    assert.equal(video.status, 201, await video.clone().text());
    const videoRow = await video.json();
    const rejectedReplacement = await uploadFile(`/stimuli/${videoRow.id}/content`, owner,
      Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex'), 'video/mp4');
    assert.equal(rejectedReplacement.status, 422);
    assert.equal((await list(owner)).find(row => row.id === videoRow.id).current_version_id, videoRow.current_version_id);
    assert.equal((await fetch(baseUrl + videoRow.content_url, { headers: owner })).status, 200);
    assert.equal((await uploadFile(`/stimuli/${videoRow.id}/content`, owner, png, 'image/png', { current_version_id: oldVersion })).status, 422);
    const poster = await fetch(baseUrl + videoRow.preview_url, { headers: owner });
    assert.equal(poster.status, 200, await poster.clone().text());
    assert.match(poster.headers.get('content-type'), /^image\/jpeg/);
    const mediaInfo = (await list(owner)).find(row => row.id === videoRow.id).media_info;
    assert.equal(mediaInfo.intrinsic_width, 640);
    assert.equal(mediaInfo.intrinsic_height, 360);
    assert.equal(mediaInfo.codec, 'h264');
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

    const ownerEmail = `project-owner-${suffix}@example.test`;
    const siblingEmail = `project-sibling-${suffix}@example.test`;
    const researchers = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $3, 'researcher'), ($2, $3, 'researcher')
       RETURNING id, email, role, token_version`,
      [
        ownerEmail,
        siblingEmail,
        await bcrypt.hash('project-isolation-test-only', 4),
      ]
    );
    createdUserIds.push(...researchers.rows.map(row => row.id));
    const owner = researchers.rows.find(row => row.email === ownerEmail);
    const sibling = researchers.rows.find(row => row.email === siblingEmail);
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
      for (const suffix of ['content', 'preview']) {
        const foreignBinary = await fetch(`${baseUrl}/stimuli/${siblingStimulusId}/${suffix}`, { headers: ownerHeaders });
        assert.equal(foreignBinary.status, 403);
      }
      const foreignDelete = await fetch(`${baseUrl}/stimuli/${siblingStimulusId}`, { method: 'DELETE', headers: ownerHeaders });
      assert.equal(foreignDelete.status, 403);
      const foreignFolders = await fetch(`${baseUrl}/stimuli/folders?project_id=${siblingProjectId}`, { headers: ownerHeaders });
      assert.equal(foreignFolders.status, 403);

      // Exercise real multipart storage and SQL reconstruction, not a browser cache.
      const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
      const mp4Bytes = fs.readFileSync(path.join(__dirname, 'fixtures/stimulus-video.mp4'));
      for (const [name, type, bytes] of [['persist.png', 'image/png', imageBytes], ['persist.mp4', 'video/mp4', mp4Bytes]]) {
        const form = new FormData();
        form.append('project_id', String(projectId));
        form.append('file', new Blob([bytes], { type }), name);
        const uploaded = await fetch(`${baseUrl}/stimuli/upload`, {
          method: 'POST', headers: { authorization: ownerHeaders.authorization }, body: form
        });
        assert.equal(uploaded.status, 201, await uploaded.clone().text());
        const row = await uploaded.json();
        try {
          const dbRow = (await pool.query('SELECT project_id, metadata FROM stimuli WHERE id = $1', [row.id])).rows[0];
          assert.equal(Number(dbRow.project_id), Number(projectId));
          assert.ok(dbRow.metadata.content_path);
          const freshList = await (await fetch(`${baseUrl}/stimuli?project_id=${projectId}`, { headers: ownerHeaders })).json();
          assert.equal(freshList.find(item => item.id === row.id).content_available, true);
          const content = await fetch(`${baseUrl}${row.content_url}`, { headers: ownerHeaders });
          assert.equal(content.status, 200);
          assert.deepEqual(Buffer.from(await content.arrayBuffer()), bytes);
          const forbidden = await fetch(`${baseUrl}${row.content_url}`, { headers: siblingHeaders });
          assert.equal(forbidden.status, 403);
          if (type === 'video/mp4') {
            const partial = await fetch(`${baseUrl}${row.content_url}`, { headers: { ...ownerHeaders, range: 'bytes=0-7' } });
            assert.equal(partial.status, 206);
            assert.equal(partial.headers.get('content-range'), `bytes 0-7/${bytes.length}`);
            assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(0, 8));
          }
        } finally {
          const deleted = await fetch(`${baseUrl}/stimuli/${row.id}`, { method: 'DELETE', headers: ownerHeaders });
          assert.equal(deleted.status, 204);
        }
      }

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

  it('persists researcher photodiode settings and pins them to each published invitation', async () => {
    const user = await passwordResearcher('PhotodiodeFixtureOnly2026!');
    const headers = { authorization: `Bearer ${issueStaffToken(user)}`, 'content-type': 'application/json' };
    const definition = {
      version: 'v2.0_universal', settings: { featureFlags: { photodiode: true } },
      blocks: [{ id: 'rt', type: 'cognitive_task', taskType: 'simple_rt',
        trials: [{ stimulusId: 'std_simple_black_square', action: 'я', duration: 1000 }] }],
    };
    const created = await fetch(`${baseUrl}/protocols`, { method: 'POST', headers,
      body: JSON.stringify({ project_id: projectId, name: `Photodiode ${randomUUID()}`, definition }) });
    assert.equal(created.status, 201, await created.clone().text());
    const protocol = await created.json();
    assert.equal(protocol.definition.settings.featureFlags.photodiode, true);
    assert.equal((await pool.query('SELECT definition FROM protocols WHERE id=$1', [protocol.id]))
      .rows[0].definition.settings.featureFlags.photodiode, true);
    const publish = async () => {
      const response = await fetch(`${baseUrl}/invitations`, { method: 'POST', headers,
        body: JSON.stringify({ protocol_id: protocol.id }) });
      assert.equal(response.status, 201, await response.clone().text());
      return response.json();
    };
    const enabledInvite = await publish();
    const updated = await fetch(`${baseUrl}/protocols/${protocol.id}`, { method: 'PATCH', headers,
      body: JSON.stringify({ definition: { ...definition, settings: { featureFlags: { photodiode: false } } } }) });
    assert.equal(updated.status, 200, await updated.clone().text());
    const disabledInvite = await publish();
    for (const [invitation, enabled] of [[enabledInvite, true], [disabledInvite, false]]) {
      const response = await fetch(`${baseUrl}/invitations/by-code/${invitation.code}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).definition.settings.featureFlags.photodiode, enabled);
      assert.equal((await pool.query('SELECT protocol_definition FROM invitations WHERE id=$1', [invitation.id]))
        .rows[0].protocol_definition.settings.featureFlags.photodiode, enabled);
    }
    const outsider = (await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'researcher') RETURNING *",
      [`photodiode-outsider-${randomUUID()}@example.test`, user.password_hash])).rows[0];
    createdUserIds.push(outsider.id);
    const unauthorized = await fetch(`${baseUrl}/protocols/${protocol.id}`, { method: 'PATCH',
      headers: { authorization: `Bearer ${issueStaffToken(outsider)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ definition }) });
    assert.ok([403, 404].includes(unauthorized.status));
    assert.equal((await pool.query('SELECT definition FROM protocols WHERE id=$1', [protocol.id]))
      .rows[0].definition.settings.featureFlags.photodiode, false);
  });

  it('completes login -> project -> protocol -> invitation -> ingest -> analytics export over HTTP', async () => {
    const suffix = randomUUID().slice(0, 12);
    const stimulusId = 'std_emo_happy_01';
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
              trials: [{ id: 'trial-1', stimulusId }],
              blockConfig: {
                aoiSchemaVersion: '1.2',
                aoiDefinitions: {
                  [stimulusId]: [{
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
            blockId: 'main', trialId: 'trial-1', stimulusId,
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
              stimulusId, stimulusName: 'Happy face', stimulusType: 'image',
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
            blockIds: ['main'], stimulusIds: [stimulusId], qcMode: 'all',
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

  async function passwordResearcher(password) {
    const user = (await pool.query(
      "INSERT INTO users(email,password_hash,role) VALUES($1,$2,'researcher') RETURNING *",
      [`s2-password-${randomUUID()}@example.test`, await bcrypt.hash(password, 4)]
    )).rows[0];
    createdUserIds.push(user.id);
    await pool.query("INSERT INTO user_organizations(user_id,organization_id,role) VALUES($1,$2,'member')", [user.id, organizationId]);
    await pool.query("INSERT INTO user_projects(user_id,project_id,role) VALUES($1,$2,'researcher')", [user.id, projectId]);
    return user;
  }

  async function passwordLogin(user, password, cookie = false) {
    return fetch(`${baseUrl}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { 'x-auth-transport': 'cookie' } : {}) },
      body: JSON.stringify({ email: user.email, password }),
    });
  }

  it('persists self-service passwords, rejects invalid requests and rotates cookie/CSRF while revoking old sessions', async () => {
    const initial = 'InitialPassword2026!';
    const changed = ' НовыйПароль2026! ';
    const user = await passwordResearcher(initial);
    const other = await passwordResearcher(initial);
    const login = await passwordLogin(user, initial, true);
    assert.equal(login.status, 200);
    const auth = await login.json();
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': auth.csrf_token };
    const change = body => fetch(`${baseUrl}/auth/me/password`, { method: 'PATCH', headers, body: JSON.stringify(body) });
    const noCsrf = await fetch(`${baseUrl}/auth/me/password`, {
      method: 'PATCH', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: initial, newPassword: changed }),
    });
    assert.equal(noCsrf.status, 403);
    for (const [body, code] of [
      [{ currentPassword: 'wrong-password', newPassword: changed }, 'current_password_invalid'],
      [{ currentPassword: initial, newPassword: 'short123' }, 'password_validation_failed'],
      [{ currentPassword: initial, newPassword: '\u0430'.repeat(37) }, 'password_validation_failed'],
      [{ currentPassword: initial, newPassword: '😀'.repeat(19) }, 'password_validation_failed'],
      [{ currentPassword: initial, newPassword: { secret: changed } }, 'password_validation_failed'],
      [{ currentPassword: initial, newPassword: initial }, 'password_unchanged'],
    ]) {
      const response = await change(body);
      assert.equal(response.status, 400);
      const rejected = await response.json();
      assert.equal(rejected.code, code);
      assert.equal(rejected.errors, undefined);
      assert.equal(JSON.stringify(rejected).includes(initial), false);
      assert.equal(JSON.stringify(rejected).includes(changed), false);
    }
    const unchanged = (await pool.query('SELECT password_hash,token_version FROM users WHERE id=$1', [user.id])).rows[0];
    assert.equal(unchanged.password_hash, user.password_hash);
    assert.equal(unchanged.token_version, user.token_version);
    const oldBearer = issueStaffToken(user);
    const accepted = await change({ currentPassword: initial, newPassword: changed, user_id: other.id, role: 'admin' });
    assert.equal(accepted.status, 200);
    const refreshed = await accepted.json();
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.auth_transport, 'cookie');
    assert.equal(refreshed.user.id, user.id);
    assert.equal(refreshed.user.role, 'researcher');
    assert.notEqual(refreshed.csrf_token, auth.csrf_token);
    assert.equal(refreshed.token, undefined);
    const newCookie = accepted.headers.get('set-cookie').split(';', 1)[0];
    assert.notEqual(newCookie, cookie);
    const updated = (await pool.query('SELECT password_hash,token_version FROM users WHERE id=$1', [user.id])).rows[0];
    assert.equal(await bcrypt.compare(changed, updated.password_hash), true);
    assert.equal(await bcrypt.compare(initial, updated.password_hash), false);
    assert.equal(updated.token_version, user.token_version + 1);
    assert.equal((await pool.query('SELECT password_hash FROM users WHERE id=$1', [other.id])).rows[0].password_hash, other.password_hash);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { cookie } })).status, 401);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${oldBearer}` } })).status, 401);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { cookie: newCookie } })).status, 200);
    assert.equal((await passwordLogin(user, initial)).status, 401);
    assert.equal((await passwordLogin(user, changed.trim())).status, 401);
    assert.equal((await passwordLogin(user, changed)).status, 200);
    const nextBody = JSON.stringify({ currentPassword: changed, newPassword: changed });
    assert.equal((await fetch(`${baseUrl}/auth/me/password`, {
      method: 'PATCH', headers: { ...headers, cookie: newCookie }, body: nextBody,
    })).status, 403);
    const freshCsrf = await fetch(`${baseUrl}/auth/me/password`, {
      method: 'PATCH', headers: { ...headers, cookie: newCookie, 'x-csrf-token': refreshed.csrf_token }, body: nextBody,
    });
    assert.equal(freshCsrf.status, 400);
    assert.equal((await freshCsrf.json()).code, 'password_unchanged');
  });

  it('upgrades a legacy short password and accepts two successive changes with the exact byte boundaries', async () => {
    const initial = 'legacy8!';
    const first = 'a'.repeat(12);
    const second = 'я'.repeat(36);
    const user = await passwordResearcher(initial);
    const initialLogin = await passwordLogin(user, initial);
    assert.equal(initialLogin.status, 200);
    const oldToken = (await initialLogin.json()).token;
    const firstChange = await fetch(`${baseUrl}/auth/me/password`, {
      method: 'PATCH', headers: { authorization: `Bearer ${oldToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: initial, newPassword: first }),
    });
    assert.equal(firstChange.status, 200);
    const bearerResult = await firstChange.json();
    assert.equal(bearerResult.ok, true);
    assert.equal(bearerResult.token, undefined);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${oldToken}` } })).status, 401);
    assert.equal((await passwordLogin(user, initial)).status, 401);
    const firstLogin = await passwordLogin(user, first, true);
    assert.equal(firstLogin.status, 200);
    const firstAuth = await firstLogin.json();
    const cookie = firstLogin.headers.get('set-cookie').split(';', 1)[0];
    const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': firstAuth.csrf_token };
    const tooLong = await fetch(`${baseUrl}/auth/me/password`, {
      method: 'PATCH', headers, body: JSON.stringify({ currentPassword: first, newPassword: second + 'я' }),
    });
    assert.equal(tooLong.status, 400);
    assert.equal((await tooLong.json()).code, 'password_validation_failed');
    const secondChange = await fetch(`${baseUrl}/auth/me/password`, {
      method: 'PATCH', headers, body: JSON.stringify({ currentPassword: first, newPassword: second }),
    });
    assert.equal(secondChange.status, 200);
    const refreshed = await secondChange.json();
    assert.notEqual(refreshed.csrf_token, firstAuth.csrf_token);
    assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { cookie } })).status, 401);
    assert.equal((await passwordLogin(user, first)).status, 401);
    assert.equal((await passwordLogin(user, second)).status, 200);
    const stored = (await pool.query('SELECT password_hash,token_version FROM users WHERE id=$1', [user.id])).rows[0];
    assert.equal(stored.token_version, user.token_version + 2);
    assert.equal(await bcrypt.compare(second, stored.password_hash), true);
  });

  it('does not overwrite a concurrent administrator reset or role change', async () => {
    const initial = 'ConcurrentInitial2026!';
    const requested = 'RequestedPassword2026!';
    const reset = 'AdminResetPassword2026!';
    for (const action of ['reset', 'role']) {
      const user = await passwordResearcher(initial);
      const login = await passwordLogin(user, initial);
      assert.equal(login.status, 200);
      const token = (await login.json()).token;
      const resetHash = await bcrypt.hash(reset, 4);
      const originalQuery = pool.query;
      let changed = false;
      // Inject a fixture-only account mutation after authentication and the
      // password read, but before the self-service compare-and-swap update.
      pool.query = async function(sql, values) {
        const result = await originalQuery.call(this, sql, values);
        if (typeof sql === 'string' && sql.startsWith('SELECT id, email, password_hash FROM users WHERE') && values?.[0] === user.id) {
          if (action === 'reset') {
            await originalQuery.call(this, 'UPDATE users SET password_hash=$1,token_version=token_version+1 WHERE id=$2', [resetHash, user.id]);
          } else {
            await originalQuery.call(this, "UPDATE users SET role='analyst',token_version=token_version+1 WHERE id=$1", [user.id]);
          }
          changed = true;
        }
        return result;
      };
      let response;
      try {
        response = await fetch(`${baseUrl}/auth/me/password`, {
          method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ currentPassword: initial, newPassword: requested }),
        });
      } finally { pool.query = originalQuery; }
      assert.equal(changed, true);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'password_change_conflict');
      const stored = (await pool.query('SELECT password_hash,role,token_version FROM users WHERE id=$1', [user.id])).rows[0];
      assert.equal(stored.token_version, user.token_version + 1);
      assert.equal(stored.role, action === 'reset' ? 'researcher' : 'analyst');
      assert.equal(await bcrypt.compare(requested, stored.password_hash), false);
      assert.equal((await passwordLogin(user, requested)).status, 401);
      assert.equal((await passwordLogin(user, action === 'reset' ? reset : initial)).status, 200);
      assert.equal((await fetch(`${baseUrl}/auth/me`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
    }
  });

  it('allows only one of two overlapping password changes to succeed', async () => {
    const initial = 'ConcurrentInitial2026!';
    const user = await passwordResearcher(initial);
    const login = await passwordLogin(user, initial);
    assert.equal(login.status, 200);
    const token = (await login.json()).token;
    const candidates = ['ConcurrentFirst2026!', 'ConcurrentSecond2026!'];
    const originalQuery = pool.query;
    let arrived = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const timeout = setTimeout(release, 5000);
    // Hold only these fixture updates until both requests have verified the old
    // password. This reproduces the overwrite race without relying on timing.
    pool.query = async function(sql, values) {
      if (typeof sql === 'string' && sql.includes('SET password_hash = $1') && values?.[1] === user.id) {
        arrived += 1;
        if (arrived === 2) release();
        await gate;
      }
      return originalQuery.call(this, sql, values);
    };
    let responses;
    try {
      responses = await Promise.all(candidates.map(newPassword => fetch(`${baseUrl}/auth/me/password`, {
        method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: initial, newPassword }),
      })));
    } finally {
      release();
      clearTimeout(timeout);
      pool.query = originalQuery;
    }
    assert.equal(arrived, 2);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
    const winner = responses.findIndex(response => response.status === 200);
    assert.equal((await responses[1 - winner].json()).code, 'password_change_conflict');
    const updated = (await pool.query('SELECT password_hash,token_version FROM users WHERE id=$1', [user.id])).rows[0];
    assert.equal(updated.token_version, user.token_version + 1);
    assert.equal(await bcrypt.compare(candidates[winner], updated.password_hash), true);
    assert.equal(await bcrypt.compare(candidates[1 - winner], updated.password_hash), false);
    assert.equal((await passwordLogin(user, candidates[winner])).status, 200);
    assert.equal((await passwordLogin(user, candidates[1 - winner])).status, 401);
    assert.equal((await passwordLogin(user, initial)).status, 401);
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

    const wrongAccount = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie, 'X-Staff-User-ID': String(auth.user.id + 1) },
    });
    assert.equal(wrongAccount.status, 409);
    assert.equal((await wrongAccount.json()).code, 'staff_account_changed');
    const sameAccount = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie, 'X-Staff-User-ID': String(auth.user.id) },
    });
    assert.equal(sameAccount.status, 200);
    const wrongAccountWrite = await fetch(`${baseUrl}/protocols`, {
      method: 'POST', headers: { cookie, 'X-Staff-User-ID': String(auth.user.id + 1),
        'X-CSRF-Token': auth.csrf_token, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(wrongAccountWrite.status, 409);
    assert.equal((await wrongAccountWrite.json()).code, 'staff_account_changed');

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
              std_emo_neutral_01: [{
                id: 'face', name: 'Face', shape: 'rectangle',
                points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }],
                order: 1, isTarget: true,
                validityInterval: { startMs: 0, endMs: 1000 },
              }],
            },
          },
          trials: [{ id: 'trial-1', stimulusId: 'std_emo_neutral_01' }],
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
        rt_alignment: require('../../shared/rt-alignment').build({
          events: [
            { type: 'stimulus_on', blockId: 'main', trialId: 'trial-1', stimulusId: 'std_emo_neutral_01', timestamp: 1000, response_mode: 'keyboard' },
            { type: 'response', blockId: 'main', trialId: 'trial-1', timestamp: 1410, responded: true, rtMs: 410 },
            { type: 'trial_end', blockId: 'main', trialId: 'trial-1', timestamp: 1410, qualityValid: true, correct: true }
          ], eyeTracking: [{ t: 1200, valid: true, correctedX: 0.2, correctedY: 0.3 }]
        }),
        cognitiveResults: [{
          blockId: 'main', trialId: 'trial-1', stimulusId: 'std_emo_neutral_01',
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
            stimulusId: 'std_emo_neutral_01', stimulusName: 'Neutral face', stimulusType: 'image',
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
          stimulusIds: ['std_emo_neutral_01'],
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

    const connectednessSummary = await fetch(
      `${baseUrl}/analytics/v1/sessions/${snapshot.includedSessionIds[0]}/summary?snapshot_id=${snapshot.id}`,
      { headers: { authorization } }
    );
    assert.equal(connectednessSummary.status, 200);
    const connectednessData = (await connectednessSummary.json()).data.connectedness;
    assert.equal(connectednessData.source, 'stored_event_windows');
    assert.equal(connectednessData.trials[0].rtMs, 410);
    assert.equal(connectednessData.trials[0].windows.response.channels.gaze.value, 1);
    const outsider = await pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'researcher') RETURNING id, email, role, token_version`,
      [`s2-analytics-outsider-${randomUUID()}@example.test`, await bcrypt.hash('outsider-test-password', 4)]
    );
    createdUserIds.push(outsider.rows[0].id);
    await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1, $2, 'member')`, [outsider.rows[0].id, organizationId]);
    const outsiderSummary = await fetch(
      `${baseUrl}/analytics/v1/sessions/${snapshot.includedSessionIds[0]}/summary?snapshot_id=${snapshot.id}`,
      { headers: { authorization: `Bearer ${issueStaffToken(outsider.rows[0])}` } }
    );
    assert.equal(outsiderSummary.status, 404);
    const notIncluded = await fetch(
      `${baseUrl}/analytics/v1/sessions/99999999/summary?snapshot_id=${snapshot.id}`,
      { headers: { authorization } }
    );
    assert.equal(notIncluded.status, 404);

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
