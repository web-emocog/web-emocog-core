const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js/photodiode.js'), 'utf8');

function harness(hostname = '127.0.0.1', search = '?photodiode=1') {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const listeners = new Map();
  const colors = [];
  const square = { hidden: true, style: {} };
  Object.defineProperty(square.style, 'backgroundColor', {
    set(color) { colors.push({ now, color }); },
  });
  const document = { hidden: false, documentElement: { lang: 'en' },
    getElementById: id => id === 'photodiode' ? square : null,
    addEventListener: (name, fn) => listeners.set(name, fn) };
  const window = { location: { hostname, search },
    addEventListener: (name, fn) => listeners.set(name, fn) };
  vm.runInNewContext(source, { window, document, URLSearchParams,
    performance: { now: () => now },
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  async function advance(ms) {
    const until = now + ms;
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await Promise.resolve();
    }
    now = until;
    await Promise.resolve();
  }
  return { pd: window.Photodiode, square, document, colors, timers, listeners, advance };
}

test('photodiode is opt-in and restricted to loopback hosts', async () => {
  for (const hostname of ['wecog.ru', '127.0.0.1.example.test', '192.168.1.2', '']) {
    const h = harness(hostname);
    assert.equal(h.pd.setEnabled(true), false);
    assert.equal((await h.pd.begin()).status, 'disabled');
    assert.equal(h.square.hidden, true);
    assert.equal(h.timers.size, 0);
  }
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(harness(hostname, '').pd.isEnabled(), false);
    assert.equal(harness(hostname).pd.isEnabled(), true);
  }
});

test('published protocol explicitly enables the temporary feature on deployed hosts', async () => {
  for (const hostname of ['wecog.ru', 'localhost', '192.168.1.2']) {
    const h = harness(hostname, '?code=fixture&photodiode=1');
    assert.equal(h.pd.isEnabled(), false);
    assert.equal(h.pd.setEnabled(true), false);
    assert.equal(h.pd.configureProtocol({ settings: { featureFlags: { photodiode: true } } }), true);
    assert.equal(h.pd.setEnabled(false), true);
    const started = h.pd.begin();
    await h.advance(800);
    assert.equal((await started).status, 'emitted');
    h.listeners.get('wecog:session-phase-change')({ detail: { phase: 'gaze_validation' } });
    assert.equal(h.square.hidden, true);
    assert.equal(h.pd.isEnabled(), true);
  }
});

test('disabled, missing or malformed protocol flags cannot be overridden by the URL', async () => {
  for (const value of [false, undefined, null, 'true', 1, {}, []]) {
    const h = harness('localhost', '?code=fixture&photodiode=1');
    assert.equal(h.pd.configureProtocol({ settings: { featureFlags: { photodiode: value } } }), false);
    assert.equal(h.pd.setEnabled(true), false);
    assert.equal((await h.pd.begin()).status, 'disabled');
    assert.equal(h.timers.size, 0);
    assert.equal(h.square.hidden, true);
  }
});

test('loading a different or failed invitation clears previous protocol flashes and selection', async () => {
  const h = harness('wecog.ru', '?code=fixture');
  h.pd.configureProtocol({ settings: { featureFlags: { photodiode: true } } });
  const started = h.pd.begin();
  h.pd.configureProtocol(null);
  assert.equal((await started).status, 'cancelled');
  assert.equal(h.timers.size, 0);
  assert.equal(h.pd.isEnabled(), false);
  assert.equal(h.pd.setEnabled(true), false);
  assert.equal(h.square.hidden, true);
});

test('serializes start/task/stage codes without dropping or interleaving pulses', async () => {
  const h = harness();
  const start = h.pd.begin();
  const task = h.pd.signal('task');
  const stage = h.pd.signal('stage');
  await h.advance(1800);
  assert.equal((await start).pulses, 4);
  assert.equal((await task).emittedAtMs, 800);
  assert.equal((await stage).emittedAtMs, 1400);
  assert.equal(h.colors.filter(value => value.color === '#fff').length, 9);
  assert.equal(h.timers.size, 0);
});

test('does not issue a late queued stimulus marker or accept unknown codes', async () => {
  const h = harness();
  assert.equal((await h.pd.signal('stimulus')).status, 'inactive');
  h.pd.begin();
  assert.equal((await h.pd.signal('stimulus')).status, 'busy');
  assert.equal((await h.pd.signal('__proto__')).status, 'unknown_kind');
  await h.advance(800);
  const stimulus = h.pd.signal('stimulus');
  assert.equal(h.colors.at(-1).now, 800);
  await h.advance(200);
  assert.equal((await stimulus).status, 'emitted');
});

test('finish is idempotent and hides the square without delaying a caller', async () => {
  const h = harness();
  h.pd.begin();
  await h.advance(800);
  const finish = h.pd.finish();
  assert.equal(h.pd.finish(), finish);
  await h.advance(800);
  assert.equal((await finish).pulses, 4);
  assert.equal(h.pd.isActive(), false);
  assert.equal(h.square.hidden, true);
  assert.equal((await h.pd.finish()).status, 'inactive');
});

test('stop settles pending codes and cancels all callbacks', async () => {
  const h = harness();
  const start = h.pd.begin();
  const stage = h.pd.signal('stage');
  h.listeners.get('pagehide')();
  assert.equal((await start).status, 'cancelled');
  assert.equal((await stage).status, 'cancelled');
  assert.equal(h.timers.size, 0);
  assert.equal(h.square.hidden, true);
  await h.advance(5000);
  assert.equal(h.colors.filter(value => value.color === '#fff').length, 1);
});

test('an old cancelled finish cannot stop a new run', async () => {
  const h = harness();
  h.pd.begin();
  await h.advance(800);
  const ending = h.pd.finish();
  h.pd.stop();
  const beginning = h.pd.begin();
  await Promise.resolve();
  assert.equal(h.pd.isActive(), true);
  await h.advance(800);
  assert.equal((await ending).status, 'cancelled');
  assert.equal((await beginning).status, 'emitted');
});

test('hidden tabs do not emit or accumulate timers', async () => {
  const h = harness();
  h.pd.begin();
  h.document.hidden = true;
  h.listeners.get('visibilitychange')();
  assert.equal((await h.pd.begin()).status, 'hidden');
  assert.equal(h.square.hidden, true);
  assert.equal(h.timers.size, 0);
});

test('consent, registration, precheck and calibration cancel the overlay but preserve opt-in', async () => {
  for (const phase of ['consent', 'registration', 'precheck', 'fullscreen_calibration', 'gaze_validation']) {
    const h = harness();
    const started = h.pd.begin();
    h.listeners.get('wecog:session-phase-change')({ detail: { phase } });
    assert.equal((await started).status, 'cancelled');
    assert.equal(h.square.hidden, true);
    assert.equal(h.pd.isActive(), false);
    assert.equal(h.pd.isEnabled(), true);
    assert.equal(h.timers.size, 0);
  }
});

test('temporary marker provenance survives the typed final ingest without raw media', async () => {
  const { pathToFileURL } = require('node:url');
  const { buildAggregatesPayload } = await import(pathToFileURL(path.resolve(
    __dirname, '../../participant-web/js/unified-aggregates-new.js')).href);
  const { createSessionEvent } = await import(pathToFileURL(path.resolve(
    __dirname, '../../participant-web/js/session-runtime/contracts.mjs')).href);
  const { validateSessionFeaturePayload } = require('../security/payload-policy');
  const payload = buildAggregatesPayload({
    ids: { session: 'photodiode-test', participant: 'synthetic-participant', invitationCode: 'synthetic-invitation' },
    startTime: Date.now(),
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed',
      completedAt: '2026-10-07T00:00:00.000Z', finishAttemptId: 'photodiode-finish',
      currentBlock: null, repeatQueue: [], activeIssues: [], modules: {} },
    experimentMeta: { photodiode: { version: 'photodiode.local.v1', enabled: true,
      temporary: true, timingValidated: false, pulseMs: 100, gapMs: 100 } },
    events: [createSessionEvent({ type: 'photodiode_marker', category: 'technical',
      blockId: 'block-1', trialId: 'trial-1', status: 'emitted', kind: 'stimulus',
      pulses: 1, emittedAtMs: 500, completedAtMs: 700, timingValidated: false })],
  }, { forIngest: true });
  assert.deepEqual(validateSessionFeaturePayload(payload), []);
  assert.equal(payload.experimentMeta.photodiode.temporary, true);
  assert.equal(payload.events[0].status, 'emitted');
  assert.equal(payload.events[0].blockId, 'block-1');
  assert.equal(payload.events[0].category, 'technical');
});
