const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const moduleUrl = name => pathToFileURL(path.resolve(__dirname, '../../participant-web/js/session-runtime', name)).href;
const payload = { schemaVersion: 'session_feature.v1', ids: { session: 'audit-session', invitationCode: 'audit-code' }, events: [],
  lifecycle: { status: 'completed', state: 'completed', completedAt: '2026-10-18T12:00:00.000Z', finishAttemptId: 'audit-finish' } };
const ack = () => ({ session_id: 'audit-session', ingested: true, idempotent: false, idempotency_key: 'audit-finish',
  qc_validity: 'valid', proxy_ready: false, lifecycle_status: 'completed', completed_at: '2026-10-18T12:00:00.000Z' });

test('ingest acknowledgements must confirm the same session, lifecycle and finish key', async () => {
  const { validIngestAcknowledgement: valid } = await import(moduleUrl('ingest-transport.mjs'));
  assert.equal(valid(ack(), payload, 'audit-finish'), true);
  for (const body of [null, {}, { ok: true }, { ...ack(), ingested: false }, { ...ack(), session_id: 'other' },
    { ...ack(), lifecycle_status: 'in_progress' }, { ...ack(), idempotency_key: 'other' }, { ...ack(), completed_at: null },
    { ...ack(), completed_at: 'invalid' }, { ...ack(), proxy_ready: undefined }]) assert.equal(valid(body, payload, 'audit-finish'), false);
});

test('a stalled response body is bounded, not just the connection', async () => {
  const { fetchWithDeadline } = await import(moduleUrl('http.mjs'));
  const previous = global.fetch;
  let signal;
  global.fetch = async (_url, options) => { signal = options.signal; return { json: () => new Promise(() => {}) }; };
  try {
    await assert.rejects(fetchWithDeadline('https://test.invalid', {}, response => response.json(), 15), { code: 'request_timeout', httpStatus: 408 });
    assert.equal(signal.aborted, true);
  } finally { global.fetch = previous; }
});

test('a false HTTP success keeps the token and exact retry payload; reporting errors cannot undo a real acknowledgement', async () => {
  const { sendSessionFeature } = await import(moduleUrl('ingest-transport.mjs'));
  const oldFetch = global.fetch, oldStorage = global.sessionStorage;
  const values = new Map([['wecog_ingest_token:audit-session:audit-code', 'token']]);
  global.sessionStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let accepted = false;
  const sent = [];
  global.fetch = async (_url, options) => { sent.push(options.body); return { ok: true, status: 200, json: async () => accepted ? ack() : { ok: true } }; };
  const options = { apiBase: 'https://test.invalid', retries: 1, idempotencyKey: 'audit-finish' };
  try {
    const failed = await sendSessionFeature(payload, options);
    assert.equal(failed.ok, false); assert.equal(failed.code, 'ingest_ack_invalid');
    assert.equal(values.size, 1);
    accepted = true;
    const success = await sendSessionFeature(payload, { ...options, onAttempt: () => { throw new Error('UI error'); }, onSuccess: () => { throw new Error('UI error'); } });
    assert.equal(success.ok, true); assert.equal(values.size, 0); assert.equal(sent[0], sent[1]);
  } finally { global.fetch = oldFetch; global.sessionStorage = oldStorage; }
});

test('long Retry-After ends the foreground cycle instead of retrying early', async () => {
  const { sendSessionFeature } = await import(moduleUrl('ingest-transport.mjs'));
  const oldFetch = global.fetch, oldStorage = global.sessionStorage;
  global.sessionStorage = { getItem: () => 'token' };
  let requests = 0;
  global.fetch = async () => { requests++; return { ok: false, status: 429, headers: { get: () => '120' }, json: async () => ({ error: 'Busy' }) }; };
  try {
    const result = await sendSessionFeature(payload, { apiBase: 'https://test.invalid', retries: 4, idempotencyKey: 'audit-finish', sleep: () => { throw new Error('Must not retry early'); } });
    assert.equal(result.ok, false); assert.equal(result.retryAfterMs, 120000); assert.equal(requests, 1);
  } finally { global.fetch = oldFetch; global.sessionStorage = oldStorage; }
});

test('uploaded media descriptors follow the analytics schema and never invent a readable foreign file', () => {
  const { enrichStimulusDescriptor } = require('../analytics/v1-router');
  const schema = require('../../web/docs/analytics-contract/analytics-response-v1.schema.json').$defs.stimulusMeta;
  for (const [mime, type] of [['image/png', 'image'], ['video/mp4', 'video'], ['audio/wav', 'other']]) {
    const descriptor = enrichStimulusDescriptor({ id: '9', name: 'Media', intrinsicWidth: 200.4 }, new Map([['9', {
      name: 'Media', mime_type: mime, current_version_id: 'version-id', sha256: 'a'.repeat(64), metadata: { height: 300 }
    }]]));
    assert.equal(descriptor.type, type);
    assert.equal(descriptor.intrinsicWidth, 200);
    assert.equal(descriptor.intrinsicHeight, 300);
    assert.ok(schema.properties.type.enum.includes(descriptor.type));
    assert.ok(Object.keys(descriptor).every(key => Object.hasOwn(schema.properties, key)));
    assert.match(descriptor.contentUrl, /version=version-id/);
  }
  assert.equal(enrichStimulusDescriptor({ id: '9', contentUrl: '/foreign-file' }, new Map()).contentUrl, null);
});

test('visual protocols reject audio references before admission instead of trying to render them as images', async () => {
  const { inspectProtocolStimuli } = require('../stimuli/protocol-availability');
  const report = await inspectProtocolStimuli({ query: async () => ({ rows: [{ id: 3, name: 'Audio', mime_type: 'audio/wav', metadata: {} }] }) },
    1, { blocks: [{ type: 'cognitive_task', trials: [{ stimulusId: '3' }] }] });
  assert.equal(report.ok, false);
  assert.equal(report.unavailable[0].code, 'stimulus_media_type_unsupported');
});

test('IndexedDB open timeout uses a labelled compact backup; late success closes the abandoned connection', async () => {
  const { SessionCheckpointStore } = await import(moduleUrl('checkpoint-store.mjs'));
  const values = new Map();
  const request = {};
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const store = new SessionCheckpointStore({ indexedDB: { open: () => request }, sessionStorage: storage, operationTimeoutMs: 10 });
  await store.save('blocked-idb', { ids: { session: 'blocked-idb' }, cognitiveResults: [{ rt: 330 }], eyeTracking: [{ x: 1 }] }, {});
  assert.equal(store.lastPersistenceMode, 'session_storage_compact');
  const restored = await store.load();
  assert.equal(restored.sessionData.cognitiveResults[0].rt, 330);
  assert.deepEqual(restored.sessionData.eyeTracking, []);
  assert.equal(restored.sessionData.storageRecovery.compactCheckpoint, true);
  assert.equal(restored.sessionData.experimentMeta.storageRecovery.signalSeriesIncomplete, true);
  assert.ok(restored.sessionData.experimentMeta.storageRecovery.omittedSeries.includes('eyeTracking'));
  let closed = false;
  request.result = { close: () => { closed = true; } };
  request.onsuccess();
  assert.equal(closed, true);
});

test('stalled IndexedDB writes abort before fallback; reads cannot hang recovery forever', async () => {
  const { SessionCheckpointStore } = await import(moduleUrl('checkpoint-store.mjs'));
  let aborted = 0, closed = 0;
  const request = {};
  const db = { close: () => { closed++; }, transaction: () => ({
    abort: () => { aborted++; }, objectStore: () => ({ put() {}, get: () => ({}), index: () => ({ getAll: () => ({}) }) })
  }) };
  const indexedDB = { open: () => { setTimeout(() => { request.result = db; request.onsuccess(); }, 0); return request; } };
  const store = new SessionCheckpointStore({ indexedDB, sessionStorage: null, operationTimeoutMs: 10 });
  await assert.rejects(store.save('stalled', { ids: { session: 'stalled' } }, {}), /timed out/);
  await assert.rejects(store.load('stalled'), /timed out/);
  assert.equal(aborted, 2); assert.equal(closed, 2);
});

test('Retry-After also blocks the next automatic cycle or manual retry for the same session', async () => {
  const { sendSessionFeature } = await import(moduleUrl('ingest-transport.mjs'));
  const oldFetch = global.fetch, oldStorage = global.sessionStorage;
  global.sessionStorage = { getItem: () => 'token' };
  let requests = 0;
  global.fetch = async () => { requests++; return { ok: false, status: 503, headers: { get: () => '120' }, json: async () => ({ error: 'Busy' }) }; };
  try {
    const packet = { ...payload, ids: { ...payload.ids, session: 'cooldown-session' } };
    const options = { apiBase: 'https://test.invalid', retries: 1 };
    await sendSessionFeature(packet, options);
    const deferred = await sendSessionFeature(packet, options);
    assert.equal(deferred.attempt, 0); assert.equal(deferred.code, 'retry_after');
    assert.equal(deferred.status, 503); assert.ok(deferred.retryAfterMs > 0); assert.equal(requests, 1);
  } finally { global.fetch = oldFetch; global.sessionStorage = oldStorage; }
});

test('an asynchronous UI error cannot turn an acknowledged backup into a failed upload', async () => {
  const { SessionDelivery } = await import(moduleUrl('delivery.mjs'));
  let changes = 0;
  const state = { ids: { invitationCode: 'I' }, consent: { informed_consent: { accepted: true } } };
  const delivery = new SessionDelivery({ sessionData: state, build: async () => ({ lifecycle: {} }), send: async () => ({ ok: true }),
    changed: async () => { if (++changes > 1) throw new Error('UI failure'); } });
  assert.equal((await delivery.checkpoint()).ok, true);
  assert.equal(state.serverBackup.status, 'saved');
  state.admissionPending = true;
  assert.equal(await delivery.checkpoint(), null);
});
