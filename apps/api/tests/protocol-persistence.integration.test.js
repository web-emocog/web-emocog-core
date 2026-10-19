const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

describe('Protocol persistence and project boundaries', { skip: !process.env.S2_TEST_DATABASE_URL }, () => {
  let pool, server, url, organizationId, projectId, config, uploads;
  const users = [];
  const tokens = {};
  const definition = title => ({ title, protocolId: randomUUID(), blocks: [{ id: 'instruction', type: 'instruction', content: { title, text: 'Read this', buttonText: 'Start' } }] });
  async function request(route, method = 'GET', body, user = 'researcher') {
    return fetch(url + route, { method, headers: { authorization: `Bearer ${tokens[user]}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function create(name, options = {}) {
    const response = await request('/protocols', 'POST', { project_id: projectId, name, definition: definition(name), ...options });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  }
  before(async () => {
    process.env.DATABASE_URL = process.env.S2_TEST_DATABASE_URL;
    uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-protocol-persistence-'));
    process.env.UPLOADS_ROOT = uploads;
    ({ pool } = require('../db'));
    config = require('../config');
    organizationId = (await pool.query('INSERT INTO organizations(name, slug) VALUES($1,$2) RETURNING id', ['Persistence', randomUUID()])).rows[0].id;
    projectId = (await pool.query('INSERT INTO projects(organization_id,name,slug) VALUES($1,$2,$3) RETURNING id', [organizationId, 'Project', randomUUID()])).rows[0].id;
    for (const [key, role, member] of [['researcher', 'researcher', true], ['peer', 'researcher', true], ['outsider', 'researcher', false], ['assistant', 'assistant', true], ['analyst', 'analyst', true]]) {
      const user = (await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING *', [`${randomUUID()}@test.invalid`, 'not-a-login-password', role])).rows[0];
      users.push(user.id);
      await pool.query('INSERT INTO user_organizations(user_id,organization_id) VALUES($1,$2)', [user.id, organizationId]);
      if (member) await pool.query('INSERT INTO user_projects(user_id,project_id) VALUES($1,$2)', [user.id, projectId]);
      tokens[key] = jwt.sign({ sub: user.id, email: user.email, role, ver: 0 }, config.jwt.secret,
        { algorithm: 'HS256', issuer: config.jwt.staffIssuer, audience: config.jwt.staffAudience, expiresIn: '1h' });
    }
    server = require('../app').listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (organizationId) await pool.query('DELETE FROM organizations WHERE id=$1', [organizationId]);
    if (users.length) await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [users]);
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (uploads) await fs.rm(uploads, { recursive: true, force: true });
  });
  it('persists ordered intermediate results, seals final data and evaluates the pinned QC policy server-side', async () => {
    const base = definition('Resilience');
    base.settings = { qualityControl: { schemaVersion: 'protocol_quality.v1', rules: {
      gazeValid: { enabled: true, threshold: 90, hardStop: false }
    } } };
    const created = await request('/protocols', 'POST', { project_id: projectId, name: 'Resilience', definition: base });
    assert.equal(created.status, 201);
    const protocol = await created.json();
    const invitation = await (await request('/invitations', 'POST', { protocol_id: protocol.id })).json();
    const sessionId = randomUUID();
    const token = await (await fetch(url + `/invitations/by-code/${invitation.code}/ingest-token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId })
    })).json();
    const send = (sequence, completed = false, overrides = {}) => fetch(url + '/ingest', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.token}`,
        ...(completed ? { 'idempotency-key': 'finish-resilience' } : {}) },
      body: JSON.stringify({ schemaVersion: 'session_feature.v1', ids: { session: sessionId, participant: 'resilient-participant', invitationCode: invitation.code },
        events: [], delivery: { schemaVersion: 'session_delivery.v1', sequence, kind: completed ? 'final' : 'checkpoint' },
        lifecycle: { schemaVersion: 'session_lifecycle.v1', state: completed ? 'completed' : 'running', status: completed ? 'completed' : 'in_progress',
          ...(completed ? { finishAttemptId: 'finish-resilience', completedAt: Date.now() } : {}) },
        cognitiveResults: [{ rt: 420, correct: true, blockId: 'main' }],
        qcSummary: { gazeValidPct: 80, gazeTotal: 100, overallPass: true, checks: { duration: true }, protocolQc: { failed: [] } }, ...overrides })
    });
    assert.equal((await send(2)).status, 200);
    let row = (await pool.query('SELECT s.stopped_at,sf.payload FROM sessions s JOIN session_features sf ON sf.session_id=s.id WHERE s.session_id=$1', [sessionId])).rows[0];
    assert.equal(row.stopped_at, null);
    assert.equal(row.payload.cognitiveResults[0].rt, 420);
    assert.deepEqual(row.payload.qcSummary.protocolQc.failed, ['gazeValid']);
    assert.equal((await send(1, false, { cognitiveResults: [] })).status, 409);
    assert.equal((await (await send(2)).json()).idempotent, true);
    assert.equal((await send(2, false, { cognitiveResults: [] })).status, 409);
    assert.equal((await request(`/protocols/${protocol.id}`, 'PATCH', { definition: { ...base, settings: {} }, save_mode: 'draft' })).status, 200);
    const final = await send(3, true, { experimentMeta: { protocolTermination: { reason: 'quality_stopped' } } });
    assert.equal(final.status, 200);
    assert.equal((await final.json()).qc_validity, 'invalid');
    assert.equal((await send(4)).status, 409);
    assert.equal((await send(3, true)).status, 200);
    row = (await pool.query('SELECT sf.payload FROM sessions s JOIN session_features sf ON sf.session_id=s.id WHERE s.session_id=$1', [sessionId])).rows[0];
    assert.equal(row.payload.delivery.sequence, 3);
    assert.equal(row.payload.lifecycle.status, 'completed');
    const sessions = await (await request(`/sessions?project_id=${projectId}&protocol_id=${protocol.id}`)).json();
    assert.equal(sessions.find(item => item.session_id === sessionId).session_status, 'aborted');
    assert.deepEqual(await (await request(`/sessions?project_id=${projectId}&protocol_id=${protocol.id}&include_incomplete=false`)).json(), []);
    assert.deepEqual(await (await request(`/sessions?project_id=${projectId}`, 'GET', undefined, 'outsider')).json(), []);
    const invalidPolicy = await request('/protocols', 'POST', { project_id: projectId, name: 'Invalid QC',
      definition: { ...base, settings: { qualityControl: { schemaVersion: 'protocol_quality.v1', rules: { fpsStable: { enabled: true, threshold: 1000, hardStop: true } } } } } });
    assert.equal(invalidPolicy.status, 422);
    const forbidden = await fetch(url + '/ingest', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.outsider}` }, body: JSON.stringify(row.payload) });
    assert.equal(forbidden.status, 401);
  });

  it('shares incomplete drafts with project members, but never publishes them or exposes them outside the project', async () => {
    const draft = definition('Incomplete draft');
    draft.blocks.push({ id: 'survey', type: 'survey', content: { questions: [{ id: 'unfinished', text: '', type: 'single', options: [] }] } });
    draft.builderState = { metadata: { title: 'Incomplete draft', estimatedDuration: '7 min' }, savedStep: 2, blocks: draft.blocks };
    const saved = await create('Incomplete draft', { definition: draft, save_mode: 'draft' });
    assert.equal(saved.definition.isDraft, true);
    const peer = await request(`/protocols?project_id=${projectId}`, 'GET', undefined, 'peer');
    assert.equal(peer.status, 200);
    assert.deepEqual((await peer.json()).find(row => row.id === saved.id).definition.builderState, draft.builderState);
    const outsider = await request(`/protocols/${saved.id}`, 'GET', undefined, 'outsider');
    assert.equal(outsider.status, 404);
    assert.deepEqual(await (await request(`/protocols?project_id=${projectId}`, 'GET', undefined, 'outsider')).json(), []);
    assert.equal((await request('/invitations', 'POST', { protocol_id: saved.id })).status, 422);
    assert.equal((await request(`/protocols/${saved.id}`, 'PATCH', { name: 'Not allowed' }, 'assistant')).status, 403);
    assert.equal((await request(`/protocols/${saved.id}`, 'DELETE', undefined, 'analyst')).status, 403);
    assert.equal((await request(`/protocols/${saved.id}`, 'DELETE', undefined, 'outsider')).status, 404);
    assert.equal((await request('/protocols/not-an-id', 'DELETE')).status, 400);
  });
  it('preserves old invitation snapshots when saving drafts and rejects stale saves/publications', async () => {
    const saved = await create('Original');
    const invitationResponse = await request('/invitations', 'POST', { protocol_id: saved.id, expected_updated_at: saved.updated_at });
    assert.equal(invitationResponse.status, 201);
    const invitation = await invitationResponse.json();
    const edited = { ...saved.definition, title: 'Changed', builderState: { metadata: { title: 'Changed' } } };
    const update = await request(`/protocols/${saved.id}`, 'PATCH', { name: 'Changed', definition: edited, save_mode: 'draft', expected_revision: saved.revision });
    assert.equal(update.status, 200);
    assert.equal((await request(`/protocols/${saved.id}`, 'PATCH', { name: 'Overwrite', expected_updated_at: saved.updated_at })).status, 409);
    const stalePublish = await request('/invitations', 'POST', { protocol_id: saved.id, expected_updated_at: saved.updated_at });
    assert.equal(stalePublish.status, 409);
    const participant = await fetch(`${url}/invitations/by-code/${invitation.code}`);
    assert.equal(participant.status, 200);
    const original = await participant.json();
    assert.equal(original.definition.title, 'Original');
    assert.equal(original.protocol_name, 'Original');
    assert.equal(original.definition.builderState, undefined);
    const draftRow = (await (await request(`/protocols?project_id=${projectId}`)).json()).find(row => row.id === saved.id);
    assert.equal(draftRow.has_unpublished_changes, true);
    assert.equal(draftRow.invitation_code, invitation.code);
    assert.equal((await request(`/protocols/${saved.id}`, 'DELETE')).status, 204);
    assert.equal((await fetch(`${url}/invitations/by-code/${invitation.code}`)).status, 404);
  });
  it('deletes the database protocol and its unused invitation references, freeing stimuli', async () => {
    const folder = path.join(uploads, 'stimuli');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, 'sample.txt'), 'A stimulus');
    const userId = users[0];
    const stimulus = (await pool.query(`INSERT INTO stimuli(project_id,name,mime_type,size_bytes,metadata,created_by,visibility)
      VALUES($1,'Sample','text/plain',10,$2::jsonb,$3,'project') RETURNING id`, [projectId, JSON.stringify({ content_path: 'sample.txt' }), userId])).rows[0];
    const draft = definition('Disposable');
    draft.blocks.push({ type: 'passive', trials: [{ stimulusId: String(stimulus.id) }] });
    const saved = await create('Disposable', { definition: draft, save_mode: 'draft' });
    assert.equal((await request(`/stimuli/${stimulus.id}`, 'DELETE')).status, 409);
    assert.equal((await request(`/protocols/${saved.id}`, 'DELETE')).status, 204);
    assert.equal((await request(`/protocols/${saved.id}`)).status, 404);
    assert.ok(!(await (await request(`/protocols?project_id=${projectId}`)).json()).some(row => row.id === saved.id));
    assert.equal((await request(`/stimuli/${stimulus.id}`, 'DELETE')).status, 204);
    await assert.rejects(fs.stat(path.join(folder, 'sample.txt')), { code: 'ENOENT' });
  });
  it('keeps one public URL across versions, pins admitted sessions, and never publishes a draft', async () => {
    const saved = await create('Stable link original');
    const first = await (await request('/invitations', 'POST', { protocol_id: saved.id, max_runs: 1 })).json();
    assert.equal(first.public_code, first.code);
    assert.equal(first.publication_version, 1);
    const sessionId = randomUUID();
    const admit = async code => fetch(`${url}/invitations/by-code/${code}/ingest-token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId })
    });
    assert.equal((await admit(first.code)).status, 200);
    const update = await request(`/protocols/${saved.id}`, 'PATCH', { name: 'Stable link edited',
      definition: { ...saved.definition, title: 'Stable link edited' }, save_mode: 'draft' });
    assert.equal(update.status, 200);
    assert.equal((await (await fetch(`${url}/invitations/by-code/${first.public_code}?session_id=${sessionId}`)).json()).definition.title, 'Stable link original');
    assert.equal((await request('/invitations', 'POST', { protocol_id: saved.id })).status, 422);
    const valid = await request(`/protocols/${saved.id}`, 'PATCH', { definition: { ...saved.definition, title: 'Stable link edited' }, save_mode: 'publish' });
    assert.equal(valid.status, 200);
    const second = await (await request('/invitations', 'POST', { protocol_id: saved.id })).json();
    assert.notEqual(second.code, first.code);
    assert.equal(second.public_code, first.public_code);
    assert.equal(second.publication_version, 2);
    const latest = await (await fetch(`${url}/invitations/by-code/${first.public_code}`)).json();
    assert.equal(latest.code, second.code);
    assert.equal(latest.definition.title, 'Stable link edited');
    assert.equal(latest.publication_version, 2);
    const resumed = await (await fetch(`${url}/invitations/by-code/${first.public_code}?session_id=${sessionId}`)).json();
    assert.equal(resumed.code, first.code);
    assert.equal(resumed.definition.title, 'Stable link original');
    assert.equal((await admit(first.code)).status, 200);
    assert.equal((await admit(second.code)).status, 409);
    assert.equal((await request(`/invitations/${first.id}`, 'DELETE')).status, 409);
    const staff = (await (await request(`/protocols?project_id=${projectId}`)).json()).find(row => row.id === saved.id);
    assert.equal(staff.invitation_code, first.public_code);
    assert.equal(staff.publication_version, 2);
    assert.equal(staff.has_unpublished_changes, false);
    assert.equal((await request('/invitations', 'POST', { protocol_id: saved.id }, 'outsider')).status, 403);
    assert.equal((await request('/invitations', 'POST', { protocol_id: saved.id }, 'assistant')).status, 403);
    await assert.rejects(pool.query('UPDATE invitations SET protocol_definition = $1 WHERE id = $2', ['{}', first.id]), /Published invitation definition cannot be changed/);
  });

  it('persists passive signals through canonical ingest and exposes only scoped snapshot summaries and exports', async () => {
    const protocol = await create('Passive signal ingest');
    const invitation = await (await request('/invitations', 'POST', { protocol_id: protocol.id })).json();
    const uuid = randomUUID();
    const admission = await fetch(`${url}/invitations/by-code/${invitation.code}/ingest-token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: uuid })
    });
    assert.equal(admission.status, 200);
    const token = (await admission.json()).token;
    const ids = { session: uuid, participant: 'synthetic-passive', invitationCode: invitation.code };
    const payload = { schemaVersion: 'session_feature.v1', ids, events: [],
      delivery: { schemaVersion: 'session_delivery.v1', sequence: 1, kind: 'final' },
      lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed',
        finishAttemptId: 'finish-passive', completedAt: Date.now() },
      bpm_summary: { bpmMean: 80, validSampleCount: 30, methodVersion: 'continuous_signals.v2' },
      respiration_summary: { resp_rate_mean: 12, resp_sample_count: 20, resp_available: true },
      blink_summary: { blinkCount: 0, blinkRatePerMin: 0 },
      attentionMetrics: { sampleCounts: { eyeSignals: 1800 }, global: { eyeDurationMs: 60000 } },
      perclos_summary: { windows: { '60s': { meanPct: 0 } } },
      body_pose_summary: { enabled: true, validSampleCount: 300, retainedValidSampleCount: 40,
        movementVelocityMean: .1, movementVelocityP95: .3 },
      emotion_summary: { n: 50, valence_mean: 0, arousal_mean: .2 } };
    const ingest = await fetch(url + '/ingest', { method: 'POST', headers: { 'content-type': 'application/json',
      authorization: `Bearer ${token}`, 'idempotency-key': 'finish-passive' }, body: JSON.stringify(payload) });
    assert.equal(ingest.status, 200, await ingest.clone().text());
    const row = (await pool.query('SELECT id FROM sessions WHERE session_id=$1', [uuid])).rows[0];
    const query = { schemaVersion: '1.0', mode: 'session', analysisLevel: 'level_1', projectId,
      protocolId: protocol.id, protocolVersion: 'publication:1',
      metricIds: require('../../shared/passive-metrics').definitions.map(item => item.id),
      filters: { sessionIds: [row.id], qcMode: 'all', qcChannels: [], includeIncompleteSessions: false } };
    const snapshotResponse = await request('/analytics/v1/snapshots', 'POST', query);
    assert.equal(snapshotResponse.status, 201, await snapshotResponse.clone().text());
    const snapshot = await snapshotResponse.json();
    assert.deepEqual(snapshot.includedSessionIds, [row.id]);
    const endpoint = `/analytics/v1/sessions/${row.id}/summary?snapshot_id=${snapshot.id}`;
    const response = await request(endpoint);
    assert.equal(response.status, 200);
    const metrics = (await response.json()).data.metrics;
    assert.equal(metrics.length, 9);
    assert.ok(metrics.every(metric => metric.status === 'computed'));
    assert.equal(metrics.find(metric => metric.metricId === 'physiology.respiration_mean').value, 12);
    assert.equal(metrics.find(metric => metric.metricId === 'blink.count').value, 0);
    const exported = await (await request(`/analytics/v1/exports?snapshot_id=${snapshot.id}`)).json();
    assert.equal(exported.summary.session.metrics.find(metric => metric.metricId === 'physiology.bpm_mean').value, 80);
    assert.equal((await request(endpoint, 'GET', undefined, 'outsider')).status, 404);
    assert.equal((await request(`/analytics/v1/exports?snapshot_id=${snapshot.id}`, 'GET', undefined, 'outsider')).status, 404);
  });

  it('renders the built-in square in session, AOI and group heatmaps without a database media file', async () => {
    const id = 'std_simple_black_square';
    const aois = require('../../web/aoi-protocol').standardAoisForStimulus(id);
    const source = { ...definition('Virtual heatmap'), blocks: [{ id: 'main', type: 'cognitive_task', taskType: 'simple_rt',
      blockConfig: { aoiSchemaVersion: '1.2', aoiDefinitions: { [id]: aois } }, trials: [{ stimulusId: id, action: 'Space', duration: 1000 }] }] };
    const protocol = await create('Virtual heatmap', { definition: source });
    const invitation = await (await request('/invitations', 'POST', { protocol_id: protocol.id })).json();
    const uuid = randomUUID();
    const session = (await pool.query(`INSERT INTO sessions(session_id,project_id,protocol_id,invitation_id,participant_id)
      VALUES($1,$2,$3,$4,'virtual-participant') RETURNING id`, [uuid, projectId, protocol.id, invitation.id])).rows[0];
    await pool.query('INSERT INTO session_features(session_id,payload) VALUES($1,$2::jsonb)', [session.id, JSON.stringify({
      gaze_analytics: { schemaVersion: 'gaze_analytics.v1', presentations: [{ presentationId: 'square-one', blockId: 'main', stimulusId: id, stimulusType: 'shape',
        intrinsicWidth: 320, intrinsicHeight: 320, validObservationDurationMs: 200,
        fixationPoints: [{ x: .5, y: .5, durationMs: 200, startMs: 0 }], grid: { width: 1, height: 1, values: [1] } }] }
    })]);
    const query = { schemaVersion: '1.0', mode: 'session', analysisLevel: 'level_1', projectId, protocolId: protocol.id,
      protocolVersion: 'publication:1', metricIds: ['viz.heatmap', 'aoi.dwell_time_ms'],
      filters: { sessionIds: [session.id], blockIds: ['main'], stimulusIds: [id], qcMode: 'all', qcChannels: [], includeIncompleteSessions: true } };
    const snapshot = await (await request('/analytics/v1/snapshots', 'POST', query)).json();
    assert.deepEqual(snapshot.includedSessionIds, [session.id]);
    for (const route of [`sessions/${session.id}/visuals`, `sessions/${session.id}/aoi`, `sessions/${session.id}/heatmap`, 'groups/heatmap']) {
      const response = await request(`/analytics/v1/${route}?snapshot_id=${snapshot.id}`);
      assert.equal(response.status, 200, await response.clone().text());
      const data = (await response.json()).data;
      const stimulus = data.contexts ? data.contexts[0].stimulus : data.stimulus;
      assert.equal(stimulus.id, id);
      assert.equal(stimulus.intrinsicWidth, stimulus.intrinsicHeight);
      assert.match(decodeURIComponent(stimulus.contentUrl), /fill="#020617"/);
    }
    assert.equal((await request(`/analytics/v1/sessions/${session.id}/visuals?snapshot_id=${snapshot.id}`, 'GET', undefined, 'outsider')).status, 404);
  });

  it('serializes concurrent publications, preserves the link, and exposes only the latest version', async () => {
    const saved = await create('Concurrent publication');
    const first = await (await request('/invitations', 'POST', { protocol_id: saved.id })).json();
    const responses = await Promise.all(Array.from({ length: 3 }, () => request('/invitations', 'POST', { protocol_id: saved.id, expected_revision: saved.revision })));
    for (const response of responses) assert.equal(response.status, 201, await response.clone().text());
    const versions = await Promise.all(responses.map(response => response.json()));
    assert.deepEqual(versions.map(row => row.publication_version).sort(), [2, 3, 4]);
    assert.ok(versions.every(row => row.public_code === first.public_code));
    const latest = await (await fetch(`${url}/invitations/by-code/${first.public_code}`)).json();
    assert.equal(latest.publication_version, 4);
    const deleted = versions.find(row => row.id === latest.invitation_id);
    assert.equal((await request(`/invitations/${deleted.id}`, 'DELETE')).status, 204);
    assert.equal((await fetch(`${url}/invitations/by-code/${first.public_code}`)).status, 404);
    assert.equal((await request(`/protocols/${saved.id}`, 'DELETE')).status, 204);
  });
  it('loads each version with its own media and custom response, including after a new publication', async () => {
    const stimuli = [];
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    for (const name of ['Old stimulus', 'New stimulus']) {
      const file = randomUUID() + '.png';
      await fs.mkdir(path.join(uploads, 'stimuli'), { recursive: true });
      await fs.writeFile(path.join(uploads, 'stimuli', file), png);
      stimuli.push((await pool.query(`INSERT INTO stimuli(project_id,name,mime_type,size_bytes,metadata,created_by,visibility)
        VALUES($1,$2,'image/png',$3,$4::jsonb,$5,'project') RETURNING id`, [projectId, name, png.length, JSON.stringify({ content_path: file }), users[0]])).rows[0]);
    }
    const firstDefinition = definition('Media version one');
    firstDefinition.blocks.push({ type: 'cognitive_task', taskType: 'simple_rt',
      trials: [{ stimulusId: String(stimuli[0].id), action: 'KeyD', duration: 1000 }] });
    const saved = await create('Media version one', { definition: firstDefinition });
    const first = await (await request('/invitations', 'POST', { protocol_id: saved.id })).json();
    const sessionId = randomUUID();
    assert.equal((await fetch(`${url}/invitations/by-code/${first.code}/ingest-token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId })
    })).status, 200);
    const secondDefinition = { ...firstDefinition, blocks: [{ type: 'cognitive_task', taskType: 'simple_rt',
      trials: [{ stimulusId: String(stimuli[1].id), action: 'KeyM', duration: 1000 }] }] };
    assert.equal((await request(`/protocols/${saved.id}`, 'PATCH', { definition: secondDefinition })).status, 200);
    const second = await (await request('/invitations', 'POST', { protocol_id: saved.id })).json();
    for (const [entry, stimulus, action] of [
      [first.public_code + '?session_id=' + sessionId, stimuli[0], 'KeyD'],
      [first.public_code, stimuli[1], 'KeyM']
    ]) {
      const loaded = await (await fetch(`${url}/invitations/by-code/${entry}`)).json();
      assert.equal(loaded.definition.blocks.find(block => block.type === 'cognitive_task').trials[0].action, action);
      const media = await (await fetch(`${url}/invitations/by-code/${loaded.code}/stimuli`)).json();
      assert.deepEqual(media.map(row => row.id), [stimulus.id]);
      assert.deepEqual(Buffer.from(await (await fetch(url + media[0].content_url)).arrayBuffer()), png);
      const otherId = stimuli.find(row => row.id !== stimulus.id).id;
      assert.equal((await fetch(`${url}/invitations/by-code/${loaded.code}/stimuli/${otherId}/content`)).status, 404);
    }
    assert.equal(second.public_code, first.public_code);
  });
  it('isolates analytics by immutable publication and calculates both descriptive designs with tenant checks', async () => {
    const makeDefinition = version => ({ ...definition('Analytics version ' + version), version: 'v2.0_universal',
      blocks: [{ id: 'rt-' + version, type: 'cognitive_task', taskType: 'simple_rt',
        trials: [{ stimulusId: 'std_simple_black_square', action: 'KeyD', condition: 'a', duration: 1000 },
          { stimulusId: 'std_simple_black_square', action: 'KeyF', condition: 'b', duration: 1000 }] }] });
    const saved = await create('Versioned analytics', { definition: makeDefinition(1) });
    const first = await (await request('/invitations', 'POST', { protocol_id: saved.id })).json();
    const sessions = [];
    async function addSession(invitation, participant, offset = 0) {
      const uuid = randomUUID();
      const admission = await fetch(`${url}/invitations/by-code/${invitation.code}/ingest-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: uuid }) });
      assert.equal(admission.status, 200, await admission.clone().text());
      const row = (await pool.query('UPDATE sessions SET participant_id=$1, stopped_at=current_timestamp WHERE session_id=$2 RETURNING id', [participant, uuid])).rows[0];
      await pool.query('INSERT INTO session_features(session_id,payload) VALUES($1,$2)', [row.id, { ids: { participantAlias: 'same-alias' }, cognitiveResults: [
        { blockId: 'rt-1', condition: 'a', rt: 200 + offset, correct: true, qualityValid: true },
        { blockId: 'rt-1', condition: 'b', rt: 400 + offset, correct: true, qualityValid: true }
      ] }]);
      sessions.push(row.id);
      return row.id;
    }
    const s1 = await addSession(first, 'person-a');
    const s2 = await addSession(first, 'person-b', 100);
    const query = { schemaVersion: '1.0', mode: 'session', analysisLevel: 'level_1', projectId, protocolId: saved.id,
      protocolVersion: 'publication:1', metricIds: ['task.rt_mean_ms'], filters: { sessionIds: [s1], qcMode: 'all', qcChannels: ['task'], includeIncompleteSessions: true } };
    const snapshot = await (await request('/analytics/v1/snapshots', 'POST', query)).json();
    assert.deepEqual(snapshot.includedSessionIds, [s1]);
    assert.equal((await request(`/analytics/v1/sessions/${s1}/summary?snapshot_id=${snapshot.id}`)).status, 200);
    assert.equal((await request(`/protocols/${saved.id}`, 'PATCH', { definition: makeDefinition(2) })).status, 200);
    const second = await (await request('/invitations', 'POST', { protocol_id: saved.id })).json();
    const s3 = await addSession(second, 'person-new');
    const versions = (await (await request(`/protocols?project_id=${projectId}`)).json()).find(row => row.id === saved.id).versions;
    assert.deepEqual(versions.map(row => row.version), ['publication:2', 'publication:1']);
    const filtered = await (await request(`/sessions?project_id=${projectId}&protocol_id=${saved.id}&protocol_version=publication:1`)).json();
    assert.deepEqual(filtered.map(row => row.id).sort(), [s1,s2].sort());
    const options = await (await request(`/analytics/v1/filter-options?project_id=${projectId}&protocol_id=${saved.id}&protocol_version=publication:1`)).json();
    assert.equal(options.blocks[0].id, 'rt-1');
    assert.equal((await request(`/analytics/v1/sessions/${s1}/summary?snapshot_id=${snapshot.id}`)).status, 200, 'new publication does not invalidate historical snapshot');
    assert.equal((await request('/analytics/v1/snapshots', 'POST', { ...query, protocolVersion: 'v2.0_universal' })).status, 409);
    const wrong = await (await request('/analytics/v1/snapshots', 'POST', { ...query, filters: { ...query.filters, sessionIds: [s3] } })).json();
    assert.deepEqual(wrong.includedSessionIds, []);
    assert.equal(wrong.excludedSessions[0].reasonCode, 'protocol_version_filter');
    assert.equal((await request(`/analytics/v1/sessions/${s3}/summary?snapshot_id=${snapshot.id}`)).status, 404);
    const group = { ...query, mode: 'group', analysisLevel: 'level_2', filters: { ...query.filters, sessionIds: [] },
      comparison: { design: 'paired', axis: 'condition', metricId: 'task.rt_mean_ms', referenceId: 'a', comparisonId: 'b' } };
    const paired = await (await request('/analytics/v1/snapshots', 'POST', group)).json();
    const comparison = await request(`/analytics/v1/comparisons/custom?snapshot_id=${paired.id}`);
    assert.equal(comparison.status, 200, await comparison.clone().text());
    assert.deepEqual((await comparison.json()).data.effect, 200);
    const exportResponse = await request(`/analytics/v1/exports?snapshot_id=${paired.id}`);
    assert.equal(exportResponse.status, 200);
    const exported = await exportResponse.json();
    assert.equal(exported.comparison.nParticipants, 2, 'identical display aliases never merge participants');
    assert.equal(exported.comparison.pValueAdjusted, null);
    assert.equal((await request(`/analytics/v1/exports?snapshot_id=${paired.id}`, 'GET', undefined, 'outsider')).status, 404);
    const independent = { ...group, comparison: { design: 'independent', metricId: 'task.rt_mean_ms', referenceParticipantIds: ['person-a'], comparisonParticipantIds: ['person-b'] } };
    const independentSnapshot = await (await request('/analytics/v1/snapshots', 'POST', independent)).json();
    const independentResult = await (await request(`/analytics/v1/comparisons/custom?snapshot_id=${independentSnapshot.id}`)).json();
    assert.equal(independentResult.data.effect, 100);
    assert.equal((await request('/analytics/v1/snapshots', 'POST', { ...independent, comparison: { ...independent.comparison, comparisonParticipantIds: ['person-new'] } })).status, 422);
    assert.equal((await request('/analytics/v1/snapshots', 'POST', { ...independent, comparison: { ...independent.comparison, comparisonParticipantIds: ['person-a'] } })).status, 422);
    assert.equal((await request(`/sessions?protocol_version=publication:999999999999`)).status, 400);
  });
  it('never deletes protocol/session bindings after a participant has started', async () => {
    const saved = await create('Has results');
    const session = randomUUID();
    await pool.query('INSERT INTO sessions(session_id,project_id,protocol_id) VALUES($1,$2,$3)', [session, projectId, saved.id]);
    const response = await request(`/protocols/${saved.id}`, 'DELETE');
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'protocol_has_sessions');
    assert.equal((await pool.query('SELECT protocol_id FROM sessions WHERE session_id=$1', [session])).rows[0].protocol_id, saved.id);
  });

  it('backfills existing public links and versions and verifies migration up/down/up in an isolated schema', async () => {
    const migration = require('../migrations/1699000000018_protocol_publications');
    let up, down;
    migration.up({ sql: value => { up = value; } });
    migration.down({ sql: value => { down = value; } });
    const client = await pool.connect();
    const schema = 'publication_' + randomUUID().replaceAll('-', '');
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}, pg_catalog`);
      await client.query(`CREATE TABLE protocols(id integer PRIMARY KEY);
        CREATE TABLE invitations(id integer PRIMARY KEY, protocol_id integer REFERENCES protocols(id), code varchar(64),
          created_at timestamptz, expires_at timestamptz, max_runs integer, used_runs integer DEFAULT 0);
        INSERT INTO protocols VALUES(1),(2);
        INSERT INTO invitations(id,protocol_id,code,created_at,expires_at) VALUES
          (1,1,'older-active',current_timestamp - interval '3 days',NULL),
          (2,1,'latest-active',current_timestamp - interval '2 days',NULL),
          (3,1,'expired',current_timestamp - interval '1 day',current_timestamp - interval '1 hour'),
          (4,2,'exhausted',current_timestamp,NULL);
        UPDATE invitations SET max_runs=1,used_runs=1 WHERE id=4;`);
      await client.query(up);
      const rows = (await client.query('SELECT * FROM protocol_publications ORDER BY protocol_id')).rows;
      assert.equal(rows[0].code, 'latest-active');
      assert.equal(rows[0].invitation_id, 2);
      assert.equal(rows[0].version, 3);
      assert.equal(rows[1].code, 'exhausted');
      await client.query(down);
      await client.query(up);
      await client.query('UPDATE protocol_publications SET invitation_id=3 WHERE protocol_id=1');
      await client.query('SAVEPOINT rollback_guard');
      await assert.rejects(client.query(down), /Stable links have been published/);
      await client.query('ROLLBACK TO SAVEPOINT rollback_guard');
      assert.equal((await client.query('SELECT count(*) FROM protocol_publications')).rows[0].count, '2');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('rejects a colleague pinning private media through an incomplete draft', async () => {
    const stimulus = (await pool.query(`INSERT INTO stimuli(project_id,name,mime_type,metadata,created_by,visibility)
      VALUES($1,'Private','image/png','{}'::jsonb,$2,'private') RETURNING id`, [projectId, users[0]])).rows[0];
    const draft = { ...definition('Private draft'), blocks: [{ type: 'passive', trials: [{ stimulusId: stimulus.id }] }] };
    const peer = await request('/protocols', 'POST', { project_id: projectId, name: 'Unauthorized draft', definition: draft, save_mode: 'draft' }, 'peer');
    assert.equal(peer.status, 422);
    assert.equal((await peer.json()).code, 'protocol_stimulus_access_denied');
    const saved = await create('Private draft', { definition: draft, save_mode: 'draft' });
    assert.equal((await request(`/protocols/${saved.id}`, 'DELETE')).status, 204);
    await pool.query('DELETE FROM stimuli WHERE id=$1', [stimulus.id]);
  });

  it('serializes protocol deletion with participant admission without a deadlock or orphan session', async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const saved = await create('Concurrent ' + attempt);
      const invitation = await (await request('/invitations', 'POST', { protocol_id: saved.id, expected_revision: saved.revision })).json();
      const sessionId = randomUUID();
      const [admission, deletion] = await Promise.all([
        fetch(`${url}/invitations/by-code/${invitation.code}/ingest-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session_id: sessionId }) }),
        request(`/protocols/${saved.id}`, 'DELETE')
      ]);
      assert.ok([200, 404].includes(admission.status), await admission.clone().text());
      assert.ok([204, 409].includes(deletion.status), await deletion.clone().text());
      if (admission.status === 200) {
        assert.equal(deletion.status, 409);
        assert.equal((await pool.query('SELECT protocol_id FROM sessions WHERE session_id=$1', [sessionId])).rows[0].protocol_id, saved.id);
      } else assert.equal(deletion.status, 204);
    }
  });
});
