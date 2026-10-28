const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../web/developer/diagnostic-run.mjs')).href;
const load = () => import(moduleUrl);
const flush = () => new Promise(resolve => setImmediate(resolve));

test('diagnostic cancellation releases a late native result once and cannot start new work', async () => {
  const { DiagnosticRun } = await load(), run = new DiagnosticRun();
  let resolve, releases = 0, calls = 0;
  const pending = run.wait(() => new Promise(done => { resolve = done; }), { release: () => { releases++; } });
  await flush();
  run.stop(); run.stop();
  await assert.rejects(pending, { code: 'diagnostic_cancelled' });
  resolve({}); await flush();
  assert.equal(releases, 1);
  assert.throws(() => run.wait(() => { calls++; }), { code: 'diagnostic_cancelled' });
  assert.equal(calls, 0);
  assert.equal(run.cleanups.size, 0);
});

test('stage deadline is bounded and a late success after timeout still disposes its resource', async () => {
  const { DiagnosticRun } = await load(), run = new DiagnosticRun();
  let resolve, releases = 0;
  await assert.rejects(run.wait(() => new Promise(done => { resolve = done; }), {
    timeoutMs: 10, release: () => { releases++; }
  }), { code: 'diagnostic_timeout' });
  resolve({}); await flush();
  assert.equal(releases, 1);
  run.stop();
  assert.equal(releases, 1);
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 60001]) {
    const valid = new DiagnosticRun();
    assert.throws(() => valid.wait(() => {}, { timeoutMs }), TypeError);
    valid.stop();
  }
});

test('successful acquisitions remain owned through the await gap and one cleanup cannot block another', async () => {
  const { DiagnosticRun } = await load(), run = new DiagnosticRun();
  let releases = 0, called = 0;
  const value = await run.wait(() => ({ id: 1 }), { release: () => { releases++; throw new Error('fixture'); } });
  assert.deepEqual(value, { id: 1 });
  run.onStop(() => { called++; });
  const unregister = run.onStop(() => { throw new Error('must have been unregistered'); });
  unregister(); run.stop(); run.stop();
  run.onStop(() => { called++; });
  assert.equal(releases, 1); assert.equal(called, 2);
  assert.equal(run.cleanups.size, 0);
});

test('a synchronous stage blocking the timer cannot publish a resource after its wall-time deadline', async () => {
  const { DiagnosticRun } = await load(), run = new DiagnosticRun();
  let released = 0;
  await assert.rejects(run.wait(() => {
    const end = performance.now() + 20;
    while (performance.now() < end) { /* Deliberate short main-thread stall, no sensors. */ }
    return {};
  }, { timeoutMs: 5, release: () => { released++; } }), { code: 'diagnostic_timeout' });
  assert.equal(run.signal.aborted, true); assert.equal(released, 1);
});

test('a delayed factory is not called when its deadline expired before the first microtask', async () => {
  const { DiagnosticRun } = await load(), run = new DiagnosticRun();
  let calls = 0;
  const pending = run.wait(() => { calls++; }, { timeoutMs: 5 });
  const end = performance.now() + 20;
  while (performance.now() < end) { /* Simulate unrelated synchronous work before the factory. */ }
  await assert.rejects(pending, { code: 'diagnostic_timeout' });
  assert.equal(calls, 0); assert.equal(run.signal.aborted, true);
});

test('synchronous and late asynchronous native failures are observed without resurrecting a run', async () => {
  const { DiagnosticRun } = await load();
  const run = new DiagnosticRun();
  await assert.rejects(run.wait(() => { throw new Error('synthetic native failure'); }), /synthetic native/);
  let reject;
  const pending = run.wait(() => new Promise((_, fail) => { reject = fail; }));
  await flush(); run.stop();
  await assert.rejects(pending, { code: 'diagnostic_cancelled' });
  reject(new Error('late synthetic error')); await flush();
  assert.equal(run.cleanups.size, 0);
});

test('cancelled queued stages never multiply native initialization and the next live run recovers', async () => {
  const { DiagnosticRun, SerialDiagnosticStage } = await load(), stage = new SerialDiagnosticStage();
  let resolve, nativeCalls = 0, releases = 0;
  const first = new DiagnosticRun();
  const old = stage.request(first, () => { nativeCalls++; return new Promise(done => { resolve = done; }); }, {
    release: () => { releases++; }
  });
  await flush(); first.stop();
  await assert.rejects(old, { code: 'diagnostic_cancelled' });
  const nativeWork = stage.pending;
  for (let i = 0; i < 100; i++) {
    const run = new DiagnosticRun();
    const queued = stage.request(run, () => { nativeCalls++; return {}; });
    await flush(); run.stop();
    await assert.rejects(queued, { code: 'diagnostic_cancelled' });
    assert.equal(stage.waiters.size, 0);
    assert.equal(stage.pending, nativeWork);
  }
  assert.equal(nativeCalls, 1);
  const latest = new DiagnosticRun();
  const current = stage.request(latest, () => { nativeCalls++; return { id: 'new' }; }, { release: () => { releases++; } });
  resolve({ id: 'old' });
  assert.deepEqual(await current, { id: 'new' });
  latest.stop(); await flush();
  assert.equal(nativeCalls, 2); assert.equal(releases, 2); assert.equal(stage.pending, null);
});

test('a serial timeout releases the late resource before another native initialization begins', async () => {
  const { DiagnosticRun, SerialDiagnosticStage } = await load(), stage = new SerialDiagnosticStage();
  const old = new DiagnosticRun(), latest = new DiagnosticRun();
  let resolve, released = false;
  await assert.rejects(stage.request(old, () => new Promise(done => { resolve = done; }), {
    timeoutMs: 10, release: () => { released = true; }
  }), { code: 'diagnostic_timeout' });
  assert.equal(old.signal.aborted, true);
  const next = stage.request(latest, () => { assert.equal(released, true); return 'current'; });
  resolve({}); assert.equal(await next, 'current'); latest.stop();
});

class Video extends EventTarget {
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  listeners = new Map();
  addEventListener(type, listener, options) {
    this.listeners.set(type, listener); super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.delete(type); super.removeEventListener(type, listener, options);
  }
}

test('diagnostic video readiness requires real dimensions and always removes its listeners', async () => {
  const { DiagnosticRun, waitForDiagnosticVideo } = await load();
  for (const finish of ['ready', 'error', 'cancel', 'timeout']) {
    const run = new DiagnosticRun(), video = new Video();
    const pending = waitForDiagnosticVideo(video, run, { timeoutMs: finish === 'timeout' ? 20 : 1000 });
    await flush();
    video.dispatchEvent(new Event('loadeddata'));
    assert.equal(video.listeners.size, 3);
    if (finish === 'ready') {
      video.readyState = 2; video.videoWidth = 320; video.videoHeight = 240;
      video.dispatchEvent(new Event('loadeddata')); await pending;
    } else if (finish === 'error') {
      video.dispatchEvent(new Event('error'));
      await assert.rejects(pending, { code: 'diagnostic_video_failed' });
    } else if (finish === 'cancel') {
      run.stop(); await assert.rejects(pending, { code: 'diagnostic_cancelled' });
    } else await assert.rejects(pending, { code: 'diagnostic_timeout' });
    assert.equal(video.listeners.size, 0);
    run.stop();
  }
});
