const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const quality = require('../../shared/protocol-quality');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const moduleUrl = name => pathToFileURL(path.resolve(__dirname, '../../participant-web/js/session-runtime', name)).href;
const policy = rules => ({ settings: { qualityControl: { schemaVersion: 'protocol_quality.v1', rules } } });
const rule = (threshold, hardStop = false) => ({ enabled: true, threshold, hardStop });

test('protocol QC validates bounded rules and keeps missing measurements distinct from failures', () => {
  const definition = policy({ gazeValid: rule(80), fpsStable: rule(20), lighting: { ...rule(60), enabled: false } });
  assert.equal(quality.validate(definition), true);
  const report = quality.evaluate(definition, { gazeValidPct: 79, analysisFps: 21, gazeTotal: 10 });
  assert.deepEqual(report.failed, ['gazeValid']);
  assert.deepEqual(report.missing, []);
  assert.equal(report.checks.lighting.status, 'disabled');
  assert.equal(quality.evaluate(definition, { gazeValidPct: 100, gazeTotal: 0 }).checks.gazeValid.status, 'no_data');
  for (const rules of [{ fpsStable: rule(61) }, { faceDetected: rule(-1) }, { unknown: rule(1) }, { gazeValid: rule(NaN) }]) {
    assert.equal(quality.validate(policy(rules)), false);
  }
  assert.equal(quality.evaluate({}, {}), null);
  assert.equal(quality.validate(policy([])), false);
  assert.equal(quality.validate(policy(true)), false);
  assert.equal(quality.evaluate(definition, { gazeValidPct: 101, gazeTotal: 1 }).checks.gazeValid.status, 'no_data');
});

test('delivery contract rejects malformed, oversized and contradictory checkpoint sequences', () => {
  const payload = { schemaVersion: 'session_feature.v1', ids: { session: 'seq' }, events: [], lifecycle: {
    schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress'
  }, delivery: { schemaVersion: 'session_delivery.v1', sequence: 1, kind: 'checkpoint' } };
  assert.deepEqual(validateSessionFeaturePayload(payload), []);
  for (const sequence of [0, -1, .5, '1', 2147483648]) assert.ok(validateSessionFeaturePayload({ ...payload, delivery: { ...payload.delivery, sequence } }).length);
  assert.ok(validateSessionFeaturePayload({ ...payload, delivery: { ...payload.delivery, kind: 'final' } }).length);
  assert.ok(validateSessionFeaturePayload({ ...payload, delivery: { ...payload.delivery, token: 'secret' } }).length);
});

test('backup notifications can be muted without disabling persistence or QC', () => {
  assert.equal(quality.showBackupNotifications({}), true);
  const definition = { settings: { persistence: { showBackupNotifications: false } } };
  assert.equal(quality.validate(definition), true);
  assert.equal(quality.showBackupNotifications(definition), false);
  for (const persistence of [false, [], null, {}, { showBackupNotifications: 'false' }, { showBackupNotifications: false, disabled: true }]) {
    assert.equal(quality.validate({ settings: { persistence } }), false);
  }
});

test('protocol QC explains the measured value and threshold without changing acceptance or echoing arbitrary input', () => {
  const definition = policy({ fpsStable: rule(25) });
  const check = quality.evaluate(definition, { analysisFps: 14.25 }).checks.fpsStable;
  assert.equal(check.status, 'failed');
  assert.equal(check.hardStop, false, 'hardStop false does not disable QC');
  assert.match(quality.describeCheck('fpsStable', check, 'ru'), /FPS анализа: 14\.3 FPS; требуется не менее 25 FPS/);
  assert.match(quality.describeCheck('fpsStable', check, 'en'), /Analysis FPS: 14\.3 FPS; required minimum 25 FPS/);
  for (const key of ['gazeValid', 'faceDetected', 'lighting']) {
    assert.match(quality.describeCheck(key, { value: 70, threshold: 80 }), /70%; required minimum 80%/);
  }
  assert.match(quality.describeCheck('fpsStable', { value: null, threshold: 25 }), /no measurement/);
  assert.equal(quality.describeCheck('<script>', { value: '<script>', threshold: 25 }), 'Quality metric: no measurement');
  assert.equal(quality.evaluate(definition, { analysisFps: 25 }).checks.fpsStable.status, 'passed');
});

test('heatmap enrichment renders virtual stimuli in content coordinates, without a library file', () => {
  const { enrichStimulusDescriptor } = require('../analytics/v1-router');
  const square = enrichStimulusDescriptor({ id: 'std_simple_black_square', version: '1', contentUrl: null }, new Map());
  assert.match(square.contentUrl, /^data:image\/svg\+xml/);
  assert.equal(square.intrinsicWidth, square.intrinsicHeight);
  assert.equal(square.type, 'image');
  assert.equal(Number.isInteger(enrichStimulusDescriptor({ id: 'std_simple_black_square', intrinsicWidth: 320.5, intrinsicHeight: 320.5 }, new Map()).intrinsicWidth), true);
  assert.match(decodeURIComponent(square.contentUrl), /fill="#020617"/);
  const circle = enrichStimulusDescriptor({ id: 'std_go_green_circle' }, new Map());
  assert.match(decodeURIComponent(circle.contentUrl), /<ellipse/);
  assert.equal(enrichStimulusDescriptor({ id: 'std_not_known', contentUrl: null }, new Map()).contentUrl, null);
  assert.equal(enrichStimulusDescriptor({ id: '9999', contentUrl: '/foreign-file' }, new Map()).contentUrl, null);
  assert.equal(enrichStimulusDescriptor({ id: 'std_stroop_red_blue', contentUrl: null }, new Map()).contentUrl, null);
  assert.match(decodeURIComponent(enrichStimulusDescriptor({ id: 'std_stroop_red_blue' }, new Map(), 'en').contentUrl), />RED<\/text>/);
});

test('checkpoint delivery deduplicates callers, keeps final sequence monotonic and never dispatches after finish', async () => {
  const { SessionDelivery } = await import(moduleUrl('delivery.mjs'));
  const state = { ids: { session: 'S', invitationCode: 'I' }, consent: { informed_consent: { accepted: true } } };
  const packets = [];
  let accept;
  const gate = new Promise(resolve => { accept = resolve; });
  const delivery = new SessionDelivery({ sessionData: state, build: async () => ({ ids: state.ids, events: [], lifecycle: {} }),
    send: async packet => { packets.push(packet); await gate; return { ok: true }; } });
  const a = delivery.checkpoint(), b = delivery.checkpoint();
  assert.equal(a, b);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(packets.length, 1);
  assert.equal(packets[0].lifecycle.status, 'in_progress');
  assert.equal(delivery.finish().sequence, 2);
  accept(); await a;
  await delivery.checkpoint();
  assert.equal(packets.length, 1);
  assert.notEqual(state.serverBackup?.status, 'saved');
});

test('offline checkpoint failure retains previous acknowledgement and retries a newer cumulative snapshot', async () => {
  const { SessionDelivery } = await import(moduleUrl('delivery.mjs'));
  const state = { ids: { invitationCode: 'I' }, consent: { informed_consent: { accepted: true } }, deliverySequence: 7,
    serverBackup: { status: 'saved', lastSuccessAt: 100 } };
  const packets = [];
  let online = false;
  const delivery = new SessionDelivery({ sessionData: state, now: () => 200, build: async () => ({ lifecycle: {} }),
    changed: backup => { state.serverBackup = backup; }, send: async packet => { packets.push(packet); return { ok: online }; } });
  await delivery.checkpoint();
  assert.equal(state.serverBackup.lastSuccessAt, 100);
  assert.equal(state.serverBackup.status, 'failed');
  online = true; await delivery.checkpoint();
  assert.equal(state.serverBackup.lastSuccessAt, 200);
  assert.equal(packets[1].delivery.sequence, 9);
});

test('storage, network, permission, expiry and schema errors have distinct safe messages', async () => {
  const { persistenceErrorCode, persistenceMessage } = await import(moduleUrl('persistence-ui.mjs'));
  assert.equal(persistenceErrorCode({}, 'local'), 'local');
  assert.equal(persistenceErrorCode({}), 'network');
  assert.equal(persistenceErrorCode({ status: 403 }), 'permission');
  assert.equal(persistenceErrorCode({ status: 410 }), 'expired');
  assert.equal(persistenceErrorCode({ status: 422 }), 'invalid');
  assert.equal(persistenceErrorCode({ status: 503 }), 'server');
  for (const lang of ['ru', 'en']) assert.notEqual(persistenceMessage('local', lang), persistenceMessage('network', lang));
});

test('blocked storage getters cannot crash checkpoint initialization', async () => {
  const { SessionCheckpointStore } = await import(moduleUrl('checkpoint-store.mjs'));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  try {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    const store = new SessionCheckpointStore({ indexedDB: null });
    assert.equal(store.sessionStorage, null);
    await store.save('memory-only', { ids: { session: 'memory-only' } }, {});
    assert.equal(store.lastPersistenceMode, 'memory');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else delete globalThis.sessionStorage;
  }
});
