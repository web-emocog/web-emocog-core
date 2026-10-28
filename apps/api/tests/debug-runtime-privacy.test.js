const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js/web-page/debug-runtime.js'), 'utf8');

function harness({ allowed = true, enabled = true, search = '', brokenStorage = false } = {}) {
  const listeners = new Map(), logs = [];
  const global = { WECOG_ALLOW_DEBUG: allowed, innerWidth: 1200, innerHeight: 800,
    localStorage: { getItem() { if (brokenStorage) throw new Error('unavailable'); return enabled ? '1' : null; } },
    location: { search },
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); } };
  const context = vm.createContext({ window: global, URLSearchParams, console: Object.fromEntries(
    ['log', 'warn', 'error', 'info', 'table'].map(key => [key, (...args) => logs.push(JSON.stringify(args))])) });
  const evaluate = code => vm.runInContext(code, context);
  evaluate(source);
  return { global, logs, listeners, evaluate, reload: () => evaluate(source), api: () => global.WECOG_DEBUG };
}

test('debug requires both explicit build permission and user opt-in, including blocked storage', () => {
  for (const options of [{ allowed: false }, { allowed: false, search: '?debug=1' }, { enabled: false }]) {
    const h = harness(options);
    assert.equal(h.api().isEnabled(), false);
    assert.equal(h.logs.length, 0);
    h.api().log('test', 'disabled', { email: 'nobody@example.test' });
    assert.equal(h.api().exportJson().count, 0);
  }
  assert.equal(harness({ brokenStorage: true, search: '?debug=1' }).api().isEnabled(), true);
  assert.equal(harness({ brokenStorage: true }).api().isEnabled(), false);
});

test('all diagnostic exports and console paths omit credentials, answers, raw media and Error text', () => {
  const h = harness();
  h.evaluate(`
    const privatePayload = {
      email: 'synthetic@example.test', access_token: 'credential-fixture', sessionId: 'identity-fixture',
      rawData: [123456], imageData: { pixels: [1, 2] }, answers: { free: 'answer-fixture' },
      nested: { message: 'message-fixture', password: 'password-fixture', physicalCode: 'Space', fps: 29.8 },
      problem: new TypeError('error-fixture /private/secret.file'),
      details: 'failed https://example.test/?code=url-fixture',
      path: '/Users/example/private-path-fixture', auth: 'Bearer token-fixture',
      contact: '+7 (999) 123-45-67', address: 'synthetic@example.test'
    };
    window.WECOG_DEBUG.log('audit', 'safe', privatePayload);
    window.WECOG_DEBUG.pushTimeline('qc', privatePayload);
    window.WECOG_DEBUG.setRuntimeSnapshot(privatePayload);
    window.__WECOG_BPM_DIAG__ = privatePayload;
    window.__WECOG_STATE__ = { sessionData: { events: [{ type: 'rt', rtMs: 350, valid: true,
      answer: 'event-answer-fixture', participantId: 'event-identity-fixture' }],
      gazeValidation: { passed: true, metrics: { accuracyPx: 20 }, rawData: 'validation-fixture',
        samples: ['validation-samples-fixture'] } } };
  `);
  const bundle = h.api().exportDebugBundle();
  const exported = JSON.stringify(bundle) + h.logs.join('');
  for (const value of ['synthetic@example.test', 'credential-fixture', 'identity-fixture', 'answer-fixture',
    'message-fixture', 'password-fixture', 'error-fixture', 'url-fixture', 'private-path-fixture',
    'token-fixture', '123456', 'event-answer-fixture', 'event-identity-fixture', 'validation-fixture',
    'validation-samples-fixture', '999']) assert.ok(!exported.includes(value), value);
  assert.equal(bundle.privacyVersion, 'technical_only.v2');
  assert.equal(bundle.timelines.qc[0].nested.fps, 29.8);
  assert.equal(bundle.timelines.qc[0].nested.physicalCode, 'Space');
  assert.equal(bundle.timelines.qc[0].problem.errorType, 'TypeError');
  assert.deepEqual(JSON.parse(JSON.stringify(bundle.sessionEvents)), [{ type: 'rt', rtMs: 350, valid: true }]);
  assert.equal(bundle.calibrationMetrics.gazeValidation.metrics.accuracyPx, 20);
});

test('diagnostics copy inputs and outputs by value and clear every stored channel', () => {
  const h = harness(), api = h.api();
  const input = { camera: { fps: 30 } };
  api.log('audit', 'copy', input); api.pushTimeline('qc', input); api.setRuntimeSnapshot(input);
  api.setGazeCalibrationDiagnostics({ accuracyPx: 24, loocvPass: true, unknown: 'not-allowed' });
  api.setGazeCalibrationDiagnostics({ biasCorrectionStatus: 'fitted', affineStatus: { fitted: true } });
  api.recordGazeSample({ onScreen: false, clipped: true, correctedX: -1, correctedY: 900 });
  input.camera.fps = 99;
  const first = api.exportDebugBundle();
  first.timelines.qc[0].camera.fps = 88; first.debug.events.at(-1).data.camera.fps = 88;
  first.runtime.camera.fps = 88; api.find('copy')[0].data.camera.fps = 88;
  api.getGazeDiagnostics().edgeClips.left = 99;
  api.getGazeDiagnostics().affineStatus.fitted = false;
  const second = api.exportDebugBundle();
  assert.equal(second.timelines.qc[0].camera.fps, 30);
  assert.equal(second.runtime.camera.fps, 30);
  assert.equal(second.debug.events.at(-1).data.camera.fps, 30);
  assert.equal(second.gazeDiagnostics.edgeClips.left, 1);
  assert.equal(second.gazeDiagnostics.affineStatus.fitted, true);
  assert.equal(second.gazeDiagnostics.biasCorrectionStatus, 'fitted');
  assert.ok(!Object.hasOwn(second.gazeDiagnostics, 'unknown'));
  api.clear();
  const cleared = api.exportDebugBundle();
  assert.ok(Object.values(cleared.timelines).every(rows => rows.length === 0));
  assert.equal(cleared.runtime, null); assert.equal(cleared.debug.count, 0);
  assert.equal(cleared.gazeDiagnostics.totalSamples, 0);
  assert.equal(cleared.gazeDiagnostics.accuracyPx, null);
  assert.equal(cleared.gazeDiagnostics.loocvPass, null);
});

test('cycles, hostile accessors/proxies, oversized data and inherited channel names cannot break diagnostics', () => {
  const h = harness();
  h.evaluate(`
    let accessed = 0;
    const cyclic = []; cyclic.push(cyclic);
    const tricky = { cyclic, big: 1n, bytes: new Uint8Array([1, 2, 3]),
      huge: Array.from({ length: 1000 }, () => ({ description: 'x'.repeat(50000) })) };
    Object.defineProperty(tricky, 'accessor', { enumerable: true, get() { accessed++; throw new Error(); } });
    const err = new Error(); Object.defineProperty(err, 'name', { get() { accessed++; throw new Error(); } });
    tricky.error = err;
    tricky.proxy = new Proxy({}, { getPrototypeOf() { throw new Error(); } });
    window.WECOG_DEBUG.log('audit', 'bounded', tricky);
    ['__proto__', 'constructor', 'missing'].forEach(channel => window.WECOG_DEBUG.pushTimeline(channel, tricky));
    window.WECOG_DEBUG.setGazeCalibrationDiagnostics(tricky.proxy);
    window.__accessed = accessed;
  `);
  assert.equal(h.global.__accessed, 0);
  const json = JSON.stringify(h.api().exportDebugBundle());
  assert.ok(json.length < 60000);
  assert.ok(json.includes('[Circular]'));
  assert.ok(json.includes('[Accessor omitted]'));
  assert.ok(json.includes('[Uninspectable]'));
  assert.equal(h.api().exportDebugBundle().timelines.events.length, 3);
});

test('ring and timeline limits hold and caller timestamps cannot override capture metadata', () => {
  const h = harness(), api = h.api();
  for (let i = 0; i < 2100; i++) api.log('audit', 'bounded', { index: i });
  for (let i = 0; i < 700; i++) api.pushTimeline('qc', { index: i, ts: 'caller', relMs: -100 });
  const bundle = api.exportDebugBundle();
  assert.equal(bundle.debug.count, 2000);
  assert.equal(bundle.timelines.qc.length, 600);
  assert.equal(bundle.timelines.qc[0].index, 100);
  assert.notEqual(bundle.timelines.qc[0].ts, 'caller');
  assert.notEqual(bundle.timelines.qc[0].relMs, -100);
});

test('reloading/disposal removes error handlers, disables old APIs and clears old data', () => {
  const h = harness();
  let old;
  for (let i = 0; i < 100; i++) {
    old = h.api(); old.pushTimeline('qc', { fps: 30 }); h.reload();
    assert.equal(old.isEnabled(), false);
    assert.equal(old.exportDebugBundle().timelines.qc.length, 0);
    assert.equal(h.listeners.get('error').size, 1);
    assert.equal(h.listeners.get('unhandledrejection').size, 1);
  }
  h.api().dispose();
  assert.equal(h.listeners.get('error').size, 0);
  assert.equal(h.listeners.get('unhandledrejection').size, 0);
});

test('global errors and rejections keep technical type only, not free-form strings', () => {
  const h = harness();
  for (const callback of h.listeners.get('error')) callback({ message: 'message-fixture', filename: '/private/path-fixture',
    error: null, lineno: 12, colno: 3 });
  for (const callback of h.listeners.get('unhandledrejection')) callback({ reason: 'rejection-fixture' });
  const json = JSON.stringify(h.api().exportJson());
  for (const marker of ['message-fixture', 'path-fixture', 'rejection-fixture']) assert.ok(!json.includes(marker));
  assert.ok(json.includes('errorType'));
  assert.equal(h.api().find('global')[0].data.lineno, 12);
});

test('turning diagnostics off blocks writes and clears prior data before export', () => {
  const h = harness(), api = h.api();
  api.pushTimeline('keys', { physicalCode: 'Space' }); api.setRuntimeSnapshot({ fps: 30 });
  h.global.WECOG_ALLOW_DEBUG = false;
  const before = h.logs.length;
  api.log('test', 'disabled', { value: 1 }); api.setRuntimeSnapshot({ fps: 99 });
  api.setGazeCalibrationDiagnostics({ accuracyPx: 4 }); api.incrementEventLoss(2);
  const bundle = api.exportDebugBundle();
  assert.equal(h.logs.length, before); assert.equal(bundle.debug.enabled, false);
  assert.equal(bundle.timelines.keys.length, 0); assert.equal(bundle.runtime, null);
  assert.equal(bundle.gazeDiagnostics.accuracyPx, null); assert.equal(bundle.flags.eventLossCount, 0);
});

test('optional module diagnostics failing inspection do not break the diagnostic export', () => {
  const h = harness();
  h.evaluate(`
    Object.defineProperty(window, '__WECOG_BPM_DIAG__', { get() { throw new Error('private-fixture'); } });
    window.__WECOG_STATE__ = { sessionData: Object.defineProperty({}, 'gazeValidation', {
      get() { throw new Error('private-fixture'); }
    }) };
  `);
  const bundle = h.api().exportDebugBundle();
  assert.equal(bundle.bpmDiagnostics.unavailable, true);
  assert.equal(bundle.calibrationMetrics.gazeValidation.unavailable, true);
  assert.ok(!JSON.stringify(bundle).includes('private-fixture'));
});

test('a broken optional console sink cannot interrupt a task or discard diagnostic records', () => {
  const h = harness();
  h.evaluate(`
    for (const method of ['log', 'warn', 'error', 'info', 'table']) console[method] = () => { throw new Error('private-sink-fixture'); };
    for (const method of ['log', 'warn', 'error', 'mark']) window.WECOG_DEBUG[method]('fixture', method, { fps: 30 });
  `);
  assert.equal(h.api().dump('fixture').length, 4);
  assert.equal(h.api().find('fixture').length, 4);
  assert.ok(!JSON.stringify(h.api().exportJson()).includes('private-sink-fixture'));
});

test('a console integration mutating its payload cannot alter the stored diagnostic ring', () => {
  const h = harness();
  h.evaluate(`
    console.log = (_tag, data) => { data.fps = 99; };
    window.WECOG_DEBUG.log('fixture', 'console-copy', { fps: 30 });
  `);
  assert.equal(h.api().find('console-copy')[0].data.fps, 30);
});

test('canonical MediaPipe loader keeps a stable technical failure code, never raw exception data', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../participant-web/mvp_with_precheck_1-updated.html'), 'utf8');
  const findLoader = source => [...source.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => match[1])
    .find(script => script.includes("import('./js/vendor/mediapipe/vision_bundle.mjs')"));
  const loader = findLoader(html);
  assert.ok(loader);
  assert.equal(findLoader(html.replace(/<script>/gi, '<ScRiPt>').replace(/<\/script>/gi, '</SCRIPT>')), loader);
  const logs = [], global = {};
  vm.runInNewContext(loader.replace("import('./js/vendor/mediapipe/vision_bundle.mjs')", 'loadVision()'), {
    window: global, console: { error: (...values) => logs.push(values) },
    loadVision: async () => { throw new Error('private-fixture@example.test /private/secret?code=fixture'); }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(global.__WECOG_MEDIAPIPE_LOAD_ERROR__, 'mediapipe_runtime_load_failed');
  assert.equal(logs.length, 1); assert.ok(!JSON.stringify(logs).includes('fixture'));
  assert.equal(logs[0].length, 1);
  assert.match(html, /debug-runtime\.js\?v=20261027-1/);
  assert.match(html, /debug-hud\.js\?v=20261027-1/);
});
