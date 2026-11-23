const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

describe('issue177: published valid-time policy at real HTTP ingest', { skip: !process.env.S2_TEST_DATABASE_URL }, () => {
  let pool, server, url, organizationId, projectId, userId, staff, uploads;
  const policy = { schemaVersion: 'passive_valid_time.v1', enabled: true, maxExtensionRatio: .5, minSegmentMs: 1000 };
  const consent = { informedConsentVersion: 'informed-consent-v1.0', privacyPolicyVersion: 'privacy-policy-v1.0' };
  async function request(route, method, body, token = staff) {
    return fetch(url + route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function admit(enabled = true) {
    const definition = { title: 'Synthetic passive timing', version: 'v2.0_universal', blocks: [
      { id: 'b', type: 'passive', content: { slideDuration: 2000, responseMode: 'none', useRT: false,
        ...(enabled ? { validTime: policy } : {}), slides: [{ stimulusId: 'std_simple_black_square', duration: 2000 }] } },
    ] };
    const created = await request('/protocols', 'POST', { project_id: projectId, name: `Synthetic passive timing ${randomUUID()}`, definition });
    assert.equal(created.status, 201, await created.clone().text());
    const protocol = await created.json();
    const publication = await request('/invitations', 'POST', { protocol_id: protocol.id });
    assert.equal(publication.status, 201, await publication.clone().text());
    const invitation = await publication.json(), sessionId = randomUUID();
    const admitted = await fetch(`${url}/invitations/by-code/${invitation.code}/ingest-token`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, consent_receipt: consent }) });
    assert.equal(admitted.status, 200, await admitted.clone().text());
    const token = (await admitted.json()).token;
    const result = { blockId: 'b', trialId: 't', stimulusId: 'std_simple_black_square', presentationId: 'p',
      attempt: 1, sourceTrialIndex: 0, presentationIndex: 1, onsetMs: 1000, responseMode: 'none',
      task_id: 'passive_viewing', qualityValid: true, qualityIssueCodes: [], qualityIssues: [],
      ...(enabled ? { validTime: { schemaVersion: 'passive_valid_time.v1', targetMs: 2000, acceptedMs: 2000,
        actualMs: 2000, maxDurationMs: 3000, extended: false, limitReached: false,
        acceptedSegments: [{ startMs: 0, endMs: 2000 }], excludedSegments: [] } } : {}) };
    const payload = { schemaVersion: 'session_feature.v1', ids: { session: sessionId, invitationCode: invitation.code },
      lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' }, events: [],
      delivery: { schemaVersion: 'session_delivery.v1', sequence: 1, kind: 'checkpoint' }, cognitiveResults: [result] };
    return { protocol, definition, invitation, token, payload, result, sessionId };
  }
  async function stored(sessionId) {
    return (await pool.query('SELECT sf.payload FROM session_features sf JOIN sessions s ON s.id=sf.session_id WHERE s.session_id=$1', [sessionId])).rows[0]?.payload;
  }
  before(async () => {
    process.env.DATABASE_URL = process.env.S2_TEST_DATABASE_URL;
    uploads = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-177-ingest-'));
    process.env.UPLOADS_ROOT = uploads;
    ({ pool } = require('../db'));
    const config = require('../config');
    organizationId = (await pool.query('INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id', ['Synthetic177', randomUUID()])).rows[0].id;
    projectId = (await pool.query('INSERT INTO projects(organization_id,name,slug) VALUES($1,$2,$3) RETURNING id', [organizationId, 'Synthetic177', randomUUID()])).rows[0].id;
    const user = (await pool.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING *',
      [`${randomUUID()}@test.invalid`, 'not-a-login-password', 'researcher'])).rows[0];
    userId = user.id;
    await pool.query('INSERT INTO user_organizations(user_id,organization_id) VALUES($1,$2)', [userId, organizationId]);
    await pool.query('INSERT INTO user_projects(user_id,project_id) VALUES($1,$2)', [userId, projectId]);
    staff = jwt.sign({ sub: userId, email: user.email, role: user.role, ver: 0 }, config.jwt.secret,
      { algorithm: 'HS256', issuer: config.jwt.staffIssuer, audience: config.jwt.staffAudience, expiresIn: '1h' });
    server = require('../app').listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (organizationId) await pool.query('DELETE FROM organizations WHERE id=$1', [organizationId]);
    if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.end();
    if (uploads) await fs.rm(uploads, { recursive: true, force: true });
  });

  it('accepts the immutable published policy after the draft changes and retains rejected physical time', async () => {
    const run = await admit();
    const draft = structuredClone(run.definition); delete draft.blocks[0].content.validTime;
    const changed = await request(`/protocols/${run.protocol.id}`, 'PATCH', { definition: draft, save_mode: 'draft' });
    assert.equal(changed.status, 200, await changed.clone().text());
    const failed = structuredClone(run.result);
    Object.assign(failed, { presentationId: 'failed', attempt: 2, qualityValid: false,
      qualityIssueCodes: ['valid_time_limit_reached'], qualityIssues: [{ code: 'valid_time_limit_reached', kind: 'quality' }] });
    Object.assign(failed.validTime, { acceptedMs: 1000, actualMs: 3027, extended: true, limitReached: true,
      acceptedSegments: [{ startMs: 0, endMs: 1000 }], excludedSegments: [
        { startMs: 1000, endMs: 3000, reasons: ['head_pose'] },
        { startMs: 3000, endMs: 3027, reasons: ['valid_time_deadline'] }] });
    run.payload.cognitiveResults.push(failed);
    const accepted = await request('/ingest', 'POST', run.payload, run.token);
    assert.equal(accepted.status, 200, await accepted.clone().text());
    assert.deepEqual((await stored(run.sessionId)).cognitiveResults, run.payload.cognitiveResults);
  });

  it('rejects missing metadata and spoofed totals without writing, then accepts the unchanged delivery sequence', async () => {
    const run = await admit();
    const omitted = structuredClone(run.payload); delete omitted.cognitiveResults[0].validTime;
    let response = await request('/ingest', 'POST', omitted, run.token);
    assert.equal(response.status, 422, await response.clone().text());
    assert.equal((await response.json()).code, 'valid_time_not_declared');
    assert.equal(await stored(run.sessionId), undefined);
    const spoofed = structuredClone(run.payload); spoofed.cognitiveResults[0].validTime.acceptedMs = 1;
    response = await request('/ingest', 'POST', spoofed, run.token);
    assert.equal(response.status, 422, await response.clone().text());
    assert.equal(await stored(run.sessionId), undefined);
    response = await request('/ingest', 'POST', run.payload, run.token);
    assert.equal(response.status, 200, await response.clone().text());
  });

  it('keeps old non-opted-in trials supported but rejects invented validTime on that publication', async () => {
    const run = await admit(false), invented = structuredClone(run.payload);
    invented.cognitiveResults[0].validTime = { schemaVersion: 'passive_valid_time.v1', targetMs: 2000, acceptedMs: 2000,
      actualMs: 2000, maxDurationMs: 3000, extended: false, limitReached: false,
      acceptedSegments: [{ startMs: 0, endMs: 2000 }], excludedSegments: [] };
    const rejected = await request('/ingest', 'POST', invented, run.token);
    assert.equal(rejected.status, 422, await rejected.clone().text());
    assert.equal(await stored(run.sessionId), undefined);
    const accepted = await request('/ingest', 'POST', run.payload, run.token);
    assert.equal(accepted.status, 200, await accepted.clone().text());
  });
});
