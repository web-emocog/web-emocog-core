const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { once } = require('node:events');

test('release path: admission, interrupted delivery, finish replay, scoped export and erasure', {
  skip: !process.env.S2_TEST_DATABASE_URL,
}, async t => {
  const db = new URL(process.env.S2_TEST_DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(db.hostname));
  assert.match(db.pathname, /_test$/);
  Object.assign(process.env, { DATABASE_URL: db.href, FORCE_HTTPS: 'false', NODE_ENV: 'test' });
  const app = require('../app');
  const { pool } = require('../db');
  const config = require('../config');
  const jwt = require('jsonwebtoken');
  const bcrypt = require('bcryptjs');
  const { buildAggregatesPayload } = await import('../../participant-web/js/unified-aggregates-new.js');
  const { createPresentationPlan, createPresentationRecord } = await import('../../participant-web/js/session-runtime/presentation-plan.mjs');
  const orgs = [], users = [], stamp = randomUUID(), sessionId = `S-${stamp}`;
  let server, base;
  async function start() {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
  t.after(async () => {
    await stop();
    await pool.query('DELETE FROM organizations WHERE id = ANY($1::int[])', [orgs]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [users]);
    await pool.query("DELETE FROM session_erasure_tombstones WHERE session_key_hash = encode(sha256(convert_to($1::text, 'UTF8')), 'hex')", [sessionId]);
    await pool.end();
  });
  async function principal(name, role, existingOrg = null, existingProject = null) {
    const org = existingOrg || (await pool.query('INSERT INTO organizations(name, slug) VALUES ($1,$2) RETURNING id',
      [name, randomUUID()])).rows[0].id;
    if (!existingOrg) orgs.push(org);
    const project = existingProject || (await pool.query('INSERT INTO projects(organization_id,name,slug) VALUES ($1,$2,$3) RETURNING id',
      [org, name, randomUUID()])).rows[0].id;
    const email = `${name}-${stamp}@example.test`;
    const password = 'Stage36-isolated-fixture-password';
    const user = (await pool.query('INSERT INTO users(email,password_hash,role) VALUES ($1,$2,$3) RETURNING id,token_version',
      [email, await bcrypt.hash(password, 4), role])).rows[0];
    users.push(user.id);
    await pool.query('INSERT INTO user_organizations(user_id,organization_id) VALUES ($1,$2)', [user.id, org]);
    await pool.query('INSERT INTO user_projects(user_id,project_id) VALUES ($1,$2)', [user.id, project]);
    const token = jwt.sign({ sub: user.id, email, role, ver: user.token_version }, config.jwt.secret,
      { algorithm: 'HS256', issuer: config.jwt.staffIssuer, audience: config.jwt.staffAudience, expiresIn: '10m' });
    return { token, org, project, email, password, id: user.id };
  }
  async function request(route, status, { method, token, body, headers } = {}) {
    const response = await fetch(base + route, { method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, status, `${method || 'request'} ${route.split('?')[0]}: ${JSON.stringify(data).slice(0, 1500)}`);
    return { data, headers: response.headers };
  }
  await start();
  const owner = await principal('owner', 'researcher');
  const foreign = await principal('foreign', 'researcher');
  const analyst = await principal('analyst', 'analyst', owner.org, owner.project);
  const good = { version: 'v2.0', blocks: [{ type: 'cognitive_task', id: 'rt', taskType: 'simple_rt',
    trials: [{ id: 't1', stimulusId: 'std_simple_black_square', duration: 1000 }] }, {
      id: 'declared-survey', type: 'survey', content: { title: 'Synthetic survey',
        questions: [{ id: 'choice', type: 'single', text: 'Choose', required: true,
          options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] }] }
    }] };
  const unsupported = { ...good, blocks: [{ type: 'cognitive_task', id: 'empty', taskType: 'simple_rt', trials: [] }] };
  const protocolBody = definition => ({ project_id: owner.project, name: 'Fixture-' + definition.blocks[0].id, definition });
  await request('/protocols', 422, { token: owner.token, body: protocolBody(unsupported) });
  const draft = (await request('/protocols', 201, { token: owner.token, body: { ...protocolBody(unsupported), save_mode: 'draft' } })).data;
  await request('/invitations', 422, { token: owner.token, body: { protocol_id: draft.id } });
  const protocol = (await request('/protocols', 201, { token: owner.token, body: protocolBody(good) })).data;
  const invite = (await request('/invitations', 201, { token: owner.token, body: { protocol_id: protocol.id } })).data;
  const admissionPath = `/invitations/by-code/${invite.code}/ingest-token`;
  const consent_receipt = { informedConsentVersion: 'informed-consent-v1.0', privacyPolicyVersion: 'privacy-policy-v1.0' };
  const admission = (await request(admissionPath, 200, { body: { session_id: sessionId, consent_receipt } })).data;
  const dbSession = (await pool.query('SELECT id FROM sessions WHERE session_id=$1', [sessionId])).rows[0].id;
  assert.equal((await pool.query('SELECT * FROM session_consent_receipts WHERE session_db_id=$1', [dbSession])).rowCount, 1);
  const block = { ...good.blocks[0], trials: [{ ...good.blocks[0].trials[0], stimulus: { stimulusId: 'std_simple_black_square' } }] };
  const plan = createPresentationPlan({ blocks: [block], seed: 42 });
  const make = (sequence, attempt) => createPresentationRecord(plan, { blockId: 'rt', planItemId: 'item:0:0',
    presentationId: `p-${sequence}`, sequence, attempt, epochMs: 2000 + 1000 * sequence, perfMs: 1000 * sequence, timeOriginMs: 2000 });
  plan.actual.push({ ...make(1, 1), status: 'completed', qualityValid: false });
  plan.actual.push({ ...make(2, 2), status: 'interrupted', deviations: ['page_reloaded'] });
  const row = (sequence, attempt, rt, valid) => ({ trialId: 't1', blockId: 'rt', stimulusId: 'std_simple_black_square',
    presentationId: `p-${sequence}`, attempt, rt, response: 'Space', correct: true, qualityValid: valid, qualityIssueCodes: valid ? [] : ['fps_low'] });
  const payload = (sequence, complete, results) => ({ ...buildAggregatesPayload({
    ids: { session: sessionId, invitationCode: invite.code, participant: 'synthetic-a' }, events: [], startTime: 2000,
    experimentMeta: { presentationPlan: plan }, cognitiveResults: results,
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: complete ? 'completed' : 'running', status: complete ? 'completed' : 'in_progress',
      ...(complete ? { finishAttemptId: `finish-${stamp}`, completedAt: Date.now() } : {}) }
  }, { forIngest: true }), delivery: { schemaVersion: 'session_delivery.v1', sequence, kind: complete ? 'final' : 'checkpoint' } });
  const checkpoint = payload(1, false, [row(1, 1, 100, false)]);
  const answer = (value = 'yes', blockId = 'declared-survey') => ({
    type: 'survey_response', eventId: 'survey-event', schemaVersion: 'session_event.v1',
    category: 'block', severity: 'info', timestamp: 4000, tRelMs: 2000,
    blockId, responseVersion: 'survey_response.v1', responseCount: 1,
    responses: [{ questionId: 'choice', responseType: 'single', value }]
  });
  const bad = structuredClone(checkpoint);
  bad.experimentMeta.presentationPlan.actual[0].hiddenPayload = { faceVideo: 'data:video/mp4;base64,Zm9v' };
  await request('/ingest', 422, { token: admission.token, body: bad });
  for (const events of [[answer('undeclared')], [answer('yes', 'different-survey')], [answer(), answer()]]) {
    await request('/ingest', 422, { token: admission.token, body: { ...checkpoint, events } });
  }
  assert.equal((await pool.query('SELECT 1 FROM session_features WHERE session_id=$1', [dbSession])).rowCount, 0);
  await request('/ingest', 200, { token: admission.token, body: checkpoint });
  await stop();
  await start();
  plan.actual.push({ ...make(3, 3), status: 'completed', qualityValid: true });
  const final = payload(2, true, [row(1, 1, 100, false), row(3, 3, 300, true)]);
  final.events.push(answer());
  await request('/ingest', 200, { token: admission.token, body: final });
  assert.equal((await request('/ingest', 200, { token: admission.token, body: final })).data.idempotent, true);
  assert.equal((await pool.query('SELECT * FROM session_features WHERE session_id=$1', [dbSession])).rowCount, 1);
  const exportPath = `/export/reproducibility?project_id=${owner.project}&protocol_id=${protocol.id}&session_db_id=${dbSession}`;
  for (const version of ['publication:2147483648', 'invitation:9999999999']) {
    await request(exportPath + '&protocol_version=' + version, 400, { token: owner.token });
  }
  await request(exportPath, 403, { token: foreign.token });
  await request(`/sessions/${dbSession}`, 404, { token: foreign.token });
  await request(`/sessions/${dbSession}`, 404, { token: foreign.token, method: 'DELETE' });
  await request(`/sessions/${dbSession}`, 403, { token: analyst.token, method: 'DELETE' });
  const exported = (await request(exportPath, 200, { token: analyst.token })).data;
  const { datasetSha256, ...exportedData } = exported;
  assert.equal(datasetSha256, createHash('sha256').update(JSON.stringify(exportedData)).digest('hex'));
  assert.equal(exportedData.selection.sessionDbId, dbSession);
  assert.equal(exported.sessions[0].qualityAssessment.independentlyValidated, false);
  const rt = exported.rows.filter(item => item.metric === 'task.rt_ms');
  assert.deepEqual(rt.map(x => [x.attempt, x.attempt_status, x.value]).sort((a,b) => a[0] - b[0]),
    [[1, 'excluded', 100], [2, 'incomplete', null], [3, 'accepted', 300]]);
  assert.ok(!JSON.stringify(exported).includes('synthetic-a'));
  await pool.query('DELETE FROM user_projects WHERE user_id=$1 AND project_id=$2', [analyst.id, owner.project]);
  await request(exportPath, 403, { token: analyst.token });
  const login = await request('/auth/login', 200, { headers: { 'X-Auth-Transport': 'cookie' },
    body: { email: owner.email, password: owner.password } });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  await request(`/sessions/${dbSession}`, 403, { method: 'DELETE', headers: { cookie } });
  const { createSnapshot } = require('../analytics/snapshots');
  let snapshotPid, candidatesLoaded, resumeCandidates;
  const loaded = new Promise(resolve => { candidatesLoaded = resolve; });
  const resume = new Promise(resolve => { resumeCandidates = resolve; });
  const snapshotPool = { connect: async () => {
    const client = await pool.connect(); snapshotPid = client.processID;
    return { query: async (...args) => {
      const result = await client.query(...args);
      if (typeof args[0] === 'string' && args[0].includes('FROM sessions s')) {
        candidatesLoaded(); await resume;
      }
      return result;
    }, release: () => client.release() };
  } };
  const snapshotQuery = { schemaVersion: '1.0', mode: 'session', analysisLevel: 'level_1',
    projectId: owner.project, protocolId: protocol.id,
    protocolVersion: invite.publication_version ? `publication:${invite.publication_version}` : `invitation:${invite.id}`,
    metricIds: ['physiology.bpm_mean'], filters: { participantIds: [], sessionIds: [sessionId], groupIds: [],
      conditionIds: [], blockIds: [], stimulusIds: [], aoiIds: [], qcMode: 'all', qcChannels: [],
      minValidFraction: null, minSignalConfidence: null, deviceClasses: [], dateFrom: null, dateTo: null,
      includeIncompleteSessions: true } };
  const pendingSnapshot = createSnapshot(snapshotPool, snapshotQuery, owner.id);
  let deletion;
  try {
    await Promise.race([loaded, new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Snapshot did not load its candidates')), 5000).unref();
    })]);
    deletion = request(`/sessions/${dbSession}`, 200,
      { method: 'DELETE', headers: { cookie, 'X-CSRF-Token': login.data.csrf_token } });
    let waiting = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      waiting = (await pool.query('SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS waiting',
        [snapshotPid])).rows[0].waiting;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true, 'erasure must wait until snapshot creation can commit');
    resumeCandidates();
    const snapshot = await pendingSnapshot;
    assert.deepEqual(snapshot.includedSessionIds, [dbSession]);
    assert.equal((await deletion).data.erased, true);
    assert.equal((await pool.query('SELECT 1 FROM analysis_snapshots WHERE id=$1', [snapshot.id])).rowCount, 0);
  } finally {
    resumeCandidates();
    await Promise.allSettled([pendingSnapshot, deletion].filter(Boolean));
  }
  assert.equal((await pool.query('SELECT 1 FROM session_features WHERE session_id=$1', [dbSession])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM session_consent_receipts WHERE session_db_id=$1', [dbSession])).rowCount, 0);
  assert.equal((await request(exportPath, 200, { token: owner.token })).data.counts.sessions, 0);
  await request(admissionPath, 410, { body: { session_id: sessionId, consent_receipt } });
  const replay = await fetch(base + '/ingest', { method: 'POST', headers: { authorization: `Bearer ${admission.token}`,
    'content-type': 'application/json' }, body: JSON.stringify(final) });
  assert.ok([404, 409, 410].includes(replay.status), 'erased sessions must not accept old ingest tokens');
  assert.equal((await pool.query('SELECT 1 FROM sessions WHERE session_id=$1', [sessionId])).rowCount, 0);
});
