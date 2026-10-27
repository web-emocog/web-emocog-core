const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data', name)));

test('finite replay resets decoder position before admitting playback, without retiming accepted samples', async () => {
  const { prepareFiniteVideo } = await load('media-clock.mjs');
  class Video extends EventTarget {
    duration = 1; readyState = 2; seeking = false; loop = false; time = .5; paused = false;
    get currentTime() { return this.time; }
    set currentTime(value) {
      this.seeking = true;
      queueMicrotask(() => { this.time = value; this.seeking = false; this.dispatchEvent(new Event('seeked')); });
    }
    pause() { this.paused = true; }
  }
  const video = new Video(); await prepareFiniteVideo(video);
  assert.equal(video.currentTime, 0); assert.equal(video.paused, true); assert.equal(video.seeking, false);
  for (const options of [{ duration: Infinity }, { duration: 0 }, { loop: true }]) {
    await assert.rejects(prepareFiniteVideo(Object.assign(new Video(), options)), /invalid_reference_finite_video/);
  }
  const loading = new Video(); loading.readyState = 0;
  const prepared = prepareFiniteVideo(loading);
  loading.readyState = 2; loading.dispatchEvent(new Event('loadeddata')); await prepared;
  assert.equal(loading.currentTime, 0);
  const failed = new Video(); failed.readyState = 0;
  const rejected = prepareFiniteVideo(failed); failed.dispatchEvent(new Event('error'));
  await assert.rejects(rejected, /reference_video_prepare_failed/);
});

test('finite-file clock permits only a confirmed terminal replay, never mid-file reordering or seeking', async () => {
  const { nextMediaTimestamp } = await load('media-clock.mjs');
  const running = { currentTime: 2, duration: 60, ended: false, seeking: false };
  assert.deepEqual(nextMediaTimestamp(null, { mediaTime: 0 }, running), { kind: 'frame', timestamp: 1 });
  assert.deepEqual(nextMediaTimestamp(1, { mediaTime: .033 }, running), { kind: 'frame', timestamp: 34 });
  for (const playback of [running, { ...running, ended: true }, { ...running, currentTime: 60 },
    { ...running, currentTime: 60, duration: Infinity, ended: true }]) {
    assert.throws(() => nextMediaTimestamp(59000, { mediaTime: 0 }, playback), /non_monotonic_video_pts/);
    assert.throws(() => nextMediaTimestamp(34, { mediaTime: .033 }, playback), /non_monotonic_video_pts/);
  }
  const ended = { ...running, currentTime: 60, ended: true };
  assert.deepEqual(nextMediaTimestamp(59967, { mediaTime: 0 }, ended), { kind: 'terminal_replay', timestamp: null });
  assert.deepEqual(nextMediaTimestamp(59900, { mediaTime: 59.967 }, ended), { kind: 'frame', timestamp: 59968 });
  assert.throws(() => nextMediaTimestamp(59000, { mediaTime: 0 }, { ...ended, seeking: true }), /unexpected_seek/);
  for (const value of [undefined, null, '0', NaN, -1, Infinity]) {
    assert.throws(() => nextMediaTimestamp(null, { mediaTime: value }, running), /invalid_reference_media_clock/);
  }
});

test('diagnostic GL hooks preserve receivers, return values and errors without retaining arguments', async () => {
  const { installGlProfiler, profileWorkerGl } = await load('profile-gl.mjs');
  const secret = { pixels: 'must-not-be-retained' };
  const failure = new Error('synthetic');
  class GL {
    readPixels(value) { assert.equal(this, gl); assert.equal(value, secret); return secret; }
    getError() { throw failure; }
  }
  const gl = new GL(), original = GL.prototype.readPixels;
  let now = 0;
  const profile = installGlProfiler({ WebGLRenderingContext: GL, WebGL2RenderingContext: GL,
    performance: { now: () => now++ } });
  profile.reset();
  assert.equal(gl.readPixels(secret), secret);
  assert.throws(() => gl.getError(), error => error === failure);
  assert.deepEqual(profile.read(), { readPixels: { calls: 1, totalMs: 1, maxMs: 1 }, getError: { calls: 1, totalMs: 1, maxMs: 1 } });
  profile.read().readPixels.calls = 999;
  assert.equal(profile.read().readPixels.calls, 1);
  assert.equal(JSON.stringify(profile.read()).includes('must-not-be-retained'), false);
  profile.reset(); assert.deepEqual(profile.read(), {});
  profile.restore(); profile.restore(); assert.equal(GL.prototype.readPixels, original);
  const source = await fs.readFile(path.resolve(__dirname, '../../participant-web/js/session-runtime/vision-worker.js'), 'utf8');
  const generated = profileWorkerGl(source);
  assert.doesNotThrow(() => new Function(generated));
  assert.throws(() => profileWorkerGl('changed source'), /reference_gl_source_changed/);
});

test('isolated automation is explicit, versioned and does not load an unverified package', async () => {
  const { loadAutomation } = await load('automation.mjs');
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'wecog-fake-automation-'));
  try {
    const good = path.join(root, 'apps/autotests/node_modules/playwright');
    await fs.mkdir(good, { recursive: true });
    await fs.writeFile(path.join(good, 'package.json'), JSON.stringify({ name: 'playwright',
      version: '1.64.1', license: 'Apache-2.0', main: 'index.js' }));
    await fs.writeFile(path.join(good, 'index.js'), 'module.exports = { firefox: { launch() {} } };');
    // No Playwright dev dependency is required in the API-only CI job.
    const bundled = await loadAutomation(root);
    assert.equal(bundled.version, '1.64.1');
    assert.equal(typeof bundled.engines.firefox.launch, 'function');
    await assert.rejects(loadAutomation(root, '../relative'), /invalid_reference_automation_root/);
    for (const [index, bad] of [{ version: '../../escape' }, { name: 'wrong-package' }, { license: 'unknown' }].entries()) {
      const prefix = path.join(root, `bad${index}`), folder = path.join(prefix, 'node_modules/playwright');
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ name: 'playwright',
        version: '1.64.1', license: 'Apache-2.0', main: 'index.js', ...bad }));
      await fs.writeFile(path.join(folder, 'index.js'), 'throw new Error("must_not_execute_unverified_package");');
      await assert.rejects(loadAutomation(root, prefix), /invalid_reference_automation_package/);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
