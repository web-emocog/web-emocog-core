const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSessionFeaturePayload, requireSessionFeaturePayload } = require('../security/payload-policy');

test('#169 public event declarations match the strict ingest event fields', () => {
  const publicEvent = require('../../../packages/shared/contracts/session-event.v1.schema.json');
  const ingest = require('../../../packages/shared/contracts/session-feature-data.v1.schema.json');
  for (const key of ['targeted', 'stimulusName']) {
    assert.deepEqual(publicEvent.properties[key], ingest.properties.events.items.properties[key]);
    assert.ok(!publicEvent.required.includes(key));
  }
});

function packet(events = []) {
  return { schemaVersion: 'session_feature.v1', ids: { session: 'S-169-synthetic' },
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' }, events };
}
function event(type, details) {
  return { schemaVersion: 'session_event.v1', eventId: 'E-169-synthetic', sessionId: 'S-169-synthetic',
    type, category: 'technical', severity: 'warning', phase: 'calibration',
    timestamp: 2000, tRelMs: 1000, blockId: null, trialId: null, ...details };
}

test('#169 retained viewport-change events accept the producer boolean without rewriting the packet', () => {
  for (const targeted of [true, false]) {
    const body = packet([event('calibration_viewport_changed', { targeted })]);
    const before = JSON.stringify(body);
    assert.deepEqual(validateSessionFeaturePayload(body), []);
    assert.equal(JSON.stringify(body), before);
  }
});

test('#169 historical photodiode context keeps its nullable stimulus label', () => {
  for (const type of ['photodiode_marker_request', 'photodiode_marker'])
  for (const stimulusName of [null, 'Synthetic black square']) {
    const body = packet([event(type, { phase: 'task', stimulusName })]);
    const before = JSON.stringify(body);
    assert.deepEqual(validateSessionFeaturePayload(body), []);
    assert.equal(JSON.stringify(body), before);
  }
});

test('#169 resumed QC continuity remains typed and is accepted without changing measurements', () => {
  const body = { ...packet(), qcSummary: { analysisFps: 19.25, cameraFps: 30,
    overallPass: false, continuity: { schemaVersion: 'qc_continuity.v1', segmentCount: 2, historyComplete: true } } };
  const before = JSON.stringify(body);
  assert.deepEqual(validateSessionFeaturePayload(body), []);
  assert.equal(JSON.stringify(body), before);
});

test('#169 compatibility does not allow unknown keys, wrong types or raw measurement data', () => {
  for (const details of [{ targeted: 'true' }, { targeted: 1 }, { targeted: null },
    { stimulusName: {} }, { stimulusName: [] }, { stimulusName: 'x'.repeat(2001) },
    { arbitraryLegacyField: true }, { targeted: true, rawVideo: 'data:video/mp4;base64,cHJpdmF0ZQ==' }]) {
    assert.ok(validateSessionFeaturePayload(packet([event('calibration_viewport_changed', details)])).length);
  }
  for (const continuity of [{ schemaVersion: 'unknown', segmentCount: 1, historyComplete: true },
    { schemaVersion: 'qc_continuity.v1', segmentCount: 0, historyComplete: true },
    { schemaVersion: 'qc_continuity.v1', segmentCount: 1.5, historyComplete: true },
    { schemaVersion: 'qc_continuity.v1', segmentCount: 1, historyComplete: 'true' },
    { schemaVersion: 'qc_continuity.v1', segmentCount: 1, historyComplete: true, rawFrames: [] }]) {
    assert.ok(validateSessionFeaturePayload({ ...packet(), qcSummary: { continuity } }).length);
  }
});

test('#169 rejected compatibility fields do not disclose their values or weaken the closed event schema', () => {
  const body = packet([event('calibration_viewport_changed', { targeted: { privateValue: 'synthetic-private-marker' } })]);
  let status, reply;
  requireSessionFeaturePayload({ body }, { status(value) { status = value; return this; }, json(value) { reply = value; } },
    () => assert.fail('invalid event must not be ingested'));
  assert.equal(status, 422); assert.equal(reply.code, 'payload_schema_invalid');
  assert.doesNotMatch(JSON.stringify(reply), /synthetic-private-marker|privateValue/);
});

test('#169 an old retained packet survives 422, token refresh and idempotent retry without reload or rebuilding', async t => {
  const { sendSessionFeature } = await import('../../participant-web/js/session-runtime/ingest-transport.mjs');
  const previous = { fetch: global.fetch, sessionStorage: global.sessionStorage };
  t.after(() => Object.assign(global, previous));
  const body = packet([event('calibration_viewport_changed', { targeted: true }),
    { ...event('photodiode_marker_request', { stimulusName: null }), eventId: 'E-169-marker' }]);
  body.ids.invitationCode = 'INV-169-synthetic';
  body.lifecycle = { ...body.lifecycle, state: 'completed', status: 'completed',
    completedAt: '2026-01-01T00:00:05.000Z', finishAttemptId: 'finish-169-synthetic' };
  body.qcSummary = { overallPass: false, analysisFps: 19.25, cameraFps: 30,
    continuity: { schemaVersion: 'qc_continuity.v1', segmentCount: 2, historyComplete: true } };
  assert.deepEqual(validateSessionFeaturePayload(body), []);
  const wire = JSON.stringify(body), sent = [], storage = new Map();
  storage.set('wecog_ingest_token:S-169-synthetic:INV-169-synthetic', 'expired-synthetic-token');
  global.sessionStorage = { getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  let upgraded = false, expired = true, saved = false, tokenRequests = 0;
  const response = (status, json) => ({ ok: status >= 200 && status < 300, status,
    headers: { get: () => null }, json: async () => json });
  global.fetch = async (url, options) => {
    assert.ok(url.startsWith('https://api.wecog.test/'));
    if (url.endsWith('/ingest-token')) {
      assert.equal(url, 'https://api.wecog.test/invitations/by-code/INV-169-synthetic/ingest-token');
      assert.deepEqual(JSON.parse(options.body), { session_id: 'S-169-synthetic' });
      tokenRequests++;
      return response(200, { token: 'fresh-synthetic-token' });
    }
    assert.equal(url, 'https://api.wecog.test/ingest');
    sent.push(options.body);
    assert.equal(options.body, wire, 'retained bytes and measurements must not be reconstructed');
    assert.equal(options.headers['Idempotency-Key'], 'finish-169-synthetic');
    if (!upgraded) return response(422, { code: 'payload_schema_invalid' });
    if (expired) { expired = false; return response(401, { error: 'Unauthorized' }); }
    assert.equal(options.headers.Authorization, 'Bearer fresh-synthetic-token');
    const replay = saved; saved = true;
    return response(replay ? 200 : 201, { session_id: body.ids.session, ingested: true, idempotent: replay,
      idempotency_key: body.lifecycle.finishAttemptId, qc_validity: 'invalid', proxy_ready: false,
      lifecycle_status: 'completed', completed_at: body.lifecycle.completedAt });
  };
  const options = { apiBase: 'https://api.wecog.test', idempotencyKey: body.lifecycle.finishAttemptId,
    retries: 2, backoffMs: 0, sleep: async () => {} };
  const rejected = await sendSessionFeature(body, options);
  assert.equal(rejected.ok, false); assert.equal(rejected.status, 422);
  assert.equal(sent.length, 1, '422 must not cause a retry storm');
  assert.equal(saved, false); assert.equal(JSON.stringify(body), wire);
  upgraded = true;
  const accepted = await sendSessionFeature(body, options);
  assert.equal(accepted.ok, true); assert.equal(tokenRequests, 1);
  assert.equal(accepted.result.qc_validity, 'invalid', 'saving does not turn insufficient FPS into valid QC');
  const replay = await sendSessionFeature(body, options);
  assert.equal(replay.ok, true); assert.equal(replay.result.idempotent, true);
  assert.equal(sent.length, 4); assert.ok(sent.every(value => value === wire));
  assert.equal(JSON.stringify(body), wire);
});
