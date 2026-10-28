const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = file => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js', file)).href);

test('camera FPS cannot overwrite analysis throughput, history or baseline', async t => {
  const { VideoFpsMonitor } = await load('qc-metrics/fps-monitor.js');
  const previous = global.performance; let now = 0;
  global.performance = { now: () => now }; t.after(() => { global.performance = previous; });
  const monitor = new VideoFpsMonitor(); monitor.start();
  for (let i = 1; i <= 40; i++) { now = i * 100; monitor.tick(); }
  assert.equal(monitor.getCurrentFps(), 10);
  const history = monitor.getHistory(), baseline = monitor.getBaselineFps();
  monitor.setCameraFps(30);
  assert.equal(monitor.getCameraFps(), 30); assert.equal(monitor.getCurrentFps(), 10);
  assert.deepEqual(monitor.getHistory(), history); assert.equal(monitor.getBaselineFps(), baseline);
  monitor.setCameraFps(NaN); assert.equal(monitor.getCameraFps(), 30);
  now += 3000; assert.equal(monitor.getCameraFps(), 0);
  monitor.start(); assert.equal(monitor.getCurrentFps(), 0); assert.deepEqual(monitor.getHistory(), []);
  monitor.stop();
});

test('video frame callbacks, not a moving media clock, identify frames; cancellation closes the loop', async () => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  let callback, cancelled = false; const counts = [];
  const video = { readyState: 2, currentTime: 0, requestVideoFrameCallback(fn) { callback = fn; return 12; },
    cancelVideoFrameCallback(id) { assert.equal(id, 12); cancelled = true; } };
  const observer = observeVideoFrames(video, (_now, delta) => counts.push(delta));
  video.currentTime = .8; assert.deepEqual(counts, []);
  callback(100, { presentedFrames: 1 }); callback(150, { presentedFrames: 1 });
  callback(200, { presentedFrames: 4 });
  assert.deepEqual(counts, [1, 3]); observer.stop(); assert.ok(cancelled);
  callback(250, { presentedFrames: 5 }); assert.deepEqual(counts, [1, 3]);
});

test('fallback counts decoded frames and labels media-time-only estimates', async t => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  const oldRaf = global.requestAnimationFrame, oldCancel = global.cancelAnimationFrame;
  let callback, cancelled;
  global.requestAnimationFrame = fn => { callback = fn; return 123; };
  global.cancelAnimationFrame = id => { cancelled = id; };
  t.after(() => { global.requestAnimationFrame = oldRaf; global.cancelAnimationFrame = oldCancel; });
  let frames = 0, count = 0;
  const video = { readyState: 2, currentTime: 0, getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }) };
  const observer = observeVideoFrames(video, (_now, delta) => { count += delta; });
  video.currentTime = 1; callback(100); assert.equal(count, 0);
  frames = 3; callback(200); assert.equal(count, 3);
  observer.stop(); assert.equal(cancelled, 123);
  delete video.getVideoPlaybackQuality;
  const estimated = observeVideoFrames(video, () => {});
  assert.equal(estimated.method, 'media-time-estimate'); estimated.stop();
  frames = 0;
  video.getVideoPlaybackQuality = () => ({ totalVideoFrames: frames });
  const inert = observeVideoFrames(video, () => {});
  video.currentTime = 2;
  callback(performance.now() + 1100);
  assert.equal(inert.method, 'media-time-estimate'); inert.stop();
});

test('session pipeline reports live camera throughput even outside tracking-test screens', async () => {
  const { SessionFramePipeline } = await load('session-runtime/frame-pipeline.js');
  const received = [];
  const state = { sessionData: {}, runtime: { qcMetrics: { setCameraFps: fps => received.push(fps) } } };
  const pipeline = new SessionFramePipeline({ state, controller: { featureFlags: {} }, video: {} });
  pipeline.videoFrameObserver = { method: 'video-frame-callback' };
  pipeline.cameraWindowStarted = 0; pipeline.cameraFrames = 30;
  pipeline._publishCameraFps(1000);
  assert.equal(state.cameraFpsState.currentFps, 30);
  pipeline._publishCameraFps(2000);
  assert.deepEqual(received, [30, 0]);
  assert.equal(state.cameraFpsState.method, 'video-frame-callback');
});

test('a decoded counter that freezes after startup cannot stop the analysis loop forever', async t => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  const old = { raf: global.requestAnimationFrame, cancel: global.cancelAnimationFrame, performance: global.performance };
  let callback, now = 0, frames = 0, delivered = 0;
  global.performance = { now: () => now };
  global.requestAnimationFrame = fn => { callback = fn; return 1; };
  global.cancelAnimationFrame = () => {};
  t.after(() => { global.requestAnimationFrame = old.raf; global.cancelAnimationFrame = old.cancel; global.performance = old.performance; });
  const video = { readyState: 2, currentTime: 0, getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }) };
  const observer = observeVideoFrames(video, (_now, count) => { delivered += count; });
  frames = 1; video.currentTime = .1; now = 100; callback(now);
  assert.equal(delivered, 1);
  now = 1300; callback(now);
  assert.equal(observer.method, 'decoded-frame-counter', 'a paused video is not a faulty counter');
  now = 1400; video.currentTime = .2; callback(now);
  assert.equal(observer.method, 'media-time-estimate');
  assert.equal(delivered, 2);
  observer.stop();
});

test('a camera freeze is reported without a new analyzed frame and is resolved only on actual delivery', async () => {
  const { SessionFramePipeline } = await load('session-runtime/frame-pipeline.js');
  const issues = [], resolved = [];
  const pipeline = new SessionFramePipeline({ state: { sessionData: {}, runtime: {} }, video: {},
    controller: { featureFlags: {}, reportIssue: issue => issues.push(issue), resolveIssue: code => resolved.push(code) } });
  pipeline.active = true;
  pipeline.videoFrameObserver = { method: 'video-frame-callback' };
  for (const now of [1000, 2000]) pipeline._publishCameraFps(now);
  assert.equal(issues.length, 0);
  pipeline._publishCameraFps(3000); pipeline._publishCameraFps(4000);
  assert.equal(issues.length, 1); assert.equal(issues[0].code, 'camera_frames_stalled');
  assert.equal(resolved.length, 0);
  pipeline.cameraFrames = 30; pipeline._publishCameraFps(5000);
  assert.deepEqual(resolved, ['camera_frames_stalled']);
  pipeline.active = false;
});

test('FPS diagnostics distinguish missing, measured, stale and stopped windows without mixing channels', async t => {
  const { VideoFpsMonitor } = await load('qc-metrics/fps-monitor.js');
  const previous = global.performance; let now = 0;
  global.performance = { now: () => now }; t.after(() => { global.performance = previous; });
  const monitor = new VideoFpsMonitor(); monitor.start();
  assert.equal(monitor.getDiagnostics().analysis.status, 'no_data');
  assert.equal(monitor.getDiagnostics().analysis.fps, null);
  for (let i = 1; i <= 20; i++) { now = i * 100; monitor.tick(); }
  monitor.setCameraFps(30, { frames: 30, durationMs: 1000, method: 'video-frame-callback' });
  const measured = monitor.getDiagnostics();
  assert.equal(measured.schemaVersion, 'fps_diagnostics.v1');
  assert.deepEqual(measured.analysis, { status: 'measured', fps: 10, lastWindowFps: 10,
    method: 'completed-analysis-frames', frames: 10, durationMs: 1000,
    startAfterMs: 1000, endAfterMs: 2000, ageMs: 0 });
  assert.equal(measured.camera.fps, 30);
  assert.equal(measured.camera.method, 'video-frame-callback');
  assert.equal(measured.camera.frames, 30);
  now += 3000;
  assert.equal(monitor.getDiagnostics().analysis.status, 'stale');
  assert.equal(monitor.getDiagnostics().analysis.fps, null);
  assert.equal(monitor.getDiagnostics().analysis.lastWindowFps, 10);
  assert.equal(monitor.getDiagnostics().camera.status, 'stale');
  monitor.stop();
  const stopped = monitor.getDiagnostics(); now += 100000;
  assert.equal(stopped.running, false);
  assert.deepEqual(monitor.getDiagnostics(), stopped, 'finalized windows must not age after stop');
  monitor.start();
  assert.equal(monitor.getDiagnostics().analysis.status, 'no_data');
  assert.equal(monitor.getDiagnostics().camera.status, 'no_data');
  monitor.setCameraFps(0);
  assert.equal(monitor.getDiagnostics().camera.status, 'measured');
  assert.equal(monitor.getDiagnostics().camera.fps, 0, 'measured zero is not missing');
  monitor.stop();
});

test('a non-finite decoded counter falls back only after the media clock advances', async t => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  const old = { raf: global.requestAnimationFrame, cancel: global.cancelAnimationFrame, performance: global.performance };
  let callback, now = 0, frames = 1, delivered = 0;
  global.performance = { now: () => now };
  global.requestAnimationFrame = fn => { callback = fn; return 1; };
  global.cancelAnimationFrame = () => {};
  t.after(() => { global.requestAnimationFrame = old.raf; global.cancelAnimationFrame = old.cancel; global.performance = old.performance; });
  const video = { readyState: 2, currentTime: 0, getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }) };
  const observer = observeVideoFrames(video, () => delivered++);
  frames = NaN; now = 1200; callback(now);
  assert.equal(observer.method, 'decoded-frame-counter', 'a paused video is not evidence of counter failure');
  video.currentTime = .1; now = 1300; callback(now);
  assert.equal(observer.method, 'media-time-estimate');
  assert.equal(delivered, 1);
  observer.stop();
});

test('a decoded counter that becomes available after startup cannot poison frame counts with NaN', async t => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  const oldRaf = global.requestAnimationFrame, oldCancel = global.cancelAnimationFrame;
  let callback, frames = NaN; const counts = [];
  global.requestAnimationFrame = fn => { callback = fn; return 1; };
  global.cancelAnimationFrame = () => {};
  t.after(() => { global.requestAnimationFrame = oldRaf; global.cancelAnimationFrame = oldCancel; });
  const video = { readyState: 2, currentTime: 0, getVideoPlaybackQuality: () => ({ totalVideoFrames: frames }) };
  const observer = observeVideoFrames(video, (_now, count) => counts.push(count));
  frames = 3; callback(performance.now() + 50);
  frames = 4; callback(performance.now() + 100);
  assert.deepEqual(counts, [1, 1]);
  assert.equal(observer.method, 'decoded-frame-counter');
  observer.stop();
});

test('live and final QC retain serializable FPS provenance alongside legacy numeric fields', async t => {
  const { VideoFpsMonitor } = await load('qc-metrics/fps-monitor.js');
  const { getCurrentMetrics, getSummary } = await load('qc-metrics/metrics-calculator.js');
  const { createInstrumentCounters } = await load('qc-metrics/frame-analysis.js');
  const { createGazeState } = await load('qc-metrics/gaze-tracking.js');
  const { createValidationState, createTrackingDeviationState } = await load('qc-metrics/validation.js');
  const previous = global.performance; let now = 0;
  global.performance = { now: () => now }; t.after(() => { global.performance = previous; });
  const monitor = new VideoFpsMonitor(); monitor.start();
  for (let i = 1; i <= 10; i++) { now = i * 100; monitor.tick(); }
  const counters = createInstrumentCounters(), gaze = createGazeState();
  const current = getCurrentMetrics(counters, gaze, monitor, Date.now() - 1000);
  assert.equal(current.analysisFps, 10);
  assert.equal(current.fpsDiagnostics.analysis.frames, 10);
  monitor.stop();
  const summary = getSummary(counters, gaze, createValidationState(), createTrackingDeviationState(), monitor, Date.now() - 1000);
  assert.equal(summary.fpsDiagnostics.running, false);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.fpsDiagnostics)), summary.fpsDiagnostics);
  const { validateSessionFeaturePayload } = require('../security/payload-policy');
  assert.deepEqual(validateSessionFeaturePayload({ schemaVersion: 'session_feature.v1',
    ids: { session: 'synthetic-fps' }, events: [],
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' }, qcSummary: summary }), []);
  monitor.start();
  for (const method of ['decoded-frame-counter', 'video-callback-count']) {
    monitor.setCameraFps(10, { frames: 10, durationMs: 1000, method });
    const summary = getSummary(counters, gaze, createValidationState(), createTrackingDeviationState(), monitor, Date.now() - 1000);
    assert.equal(summary.fpsDiagnostics.camera.method, method);
    assert.deepEqual(validateSessionFeaturePayload({ schemaVersion: 'session_feature.v1',
      ids: { session: 'synthetic-fps' }, events: [],
      lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' }, qcSummary: summary }), []);
  }
  monitor.stop();
});

test('file cadence counts source frames, reports drops separately and ignores inflated compositor metadata', async () => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  let callback, total = 100, dropped = 10; const counts = [];
  const video = { readyState: 2, currentTime: 0, src: 'fixture.webm', srcObject: null,
    getVideoPlaybackQuality: () => ({ totalVideoFrames: total, droppedVideoFrames: dropped }),
    requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() {} };
  const observer = observeVideoFrames(video, (_now, delta) => counts.push(delta));
  const now = performance.now();
  callback(now, { presentedFrames: 1000 });
  total += 3; dropped += 1; callback(now + 100, { presentedFrames: 1010 });
  callback(now + 200, { presentedFrames: 1110 });
  total += 3; callback(now + 300, { presentedFrames: 1200 });
  assert.deepEqual(counts, [3, 3]);
  assert.deepEqual(observer.playbackQuality, { complete: true, counterResets: 0, droppedFrames: 1, displayedFrames: 5 });
  assert.equal(observer.method, 'decoded-frame-counter'); assert.equal(observer.fallbackReason, null);
  observer.stop(); total++; callback(now + 400, { presentedFrames: 1210 }); assert.deepEqual(counts, [3, 3]);
});

test('file seek/reload counter reset cannot manufacture a cumulative frame burst', async () => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  let callback, total = 200; const counts = [];
  const video = { readyState: 2, currentTime: 5, src: 'fixture.webm',
    getVideoPlaybackQuality: () => ({ totalVideoFrames: total, droppedVideoFrames: 0 }),
    requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() {} };
  const observer = observeVideoFrames(video, (_now, delta) => counts.push(delta));
  total = 201; callback(performance.now(), { presentedFrames: 300 });
  total = 1; video.currentTime = 0; callback(performance.now(), { presentedFrames: 301 });
  total = 2; callback(performance.now(), { presentedFrames: 302 });
  assert.deepEqual(counts, [1, 1, 1]);
  assert.deepEqual(observer.playbackQuality, { complete: false, counterResets: 1, droppedFrames: null, displayedFrames: null });
  observer.stop();
});

test('native live MediaStream never uses a potentially inert playback counter', async () => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  let callback, reads = 0; const counts = [];
  const video = { readyState: 2, currentTime: 0, src: 'old-file.webm', srcObject: {},
    getVideoPlaybackQuality() { reads++; return { totalVideoFrames: 0, droppedVideoFrames: 0 }; },
    requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() {} };
  const observer = observeVideoFrames(video, (_now, delta) => counts.push(delta));
  callback(performance.now(), { presentedFrames: 2 }); callback(performance.now(), { presentedFrames: 5 });
  assert.deepEqual(counts, [1, 3]); assert.equal(reads, 0); assert.equal(observer.method, 'video-frame-callback'); observer.stop();
});

for (const failure of ['throws', 'invalid', 'stalled']) test(`file ${failure} counter falls back to callback counts, not inflated presented deltas`, async () => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  let callback, total = 1; const counts = [];
  const video = { readyState: 2, currentTime: 0, src: 'fixture.webm',
    getVideoPlaybackQuality() {
      if (failure === 'throws') throw new Error('fixture');
      return { totalVideoFrames: total, droppedVideoFrames: failure === 'invalid' ? -1 : 0 };
    }, requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() {} };
  const observer = observeVideoFrames(video, (_now, delta) => counts.push(delta));
  const now = performance.now();
  callback(now, { presentedFrames: 10 });
  assert.equal(observer.method, failure === 'stalled' ? 'decoded-frame-counter' : 'video-callback-count');
  video.currentTime = .1; callback(now + 1200, { presentedFrames: 200 });
  callback(now + 1300, { presentedFrames: 400 });
  const before = counts.length;
  callback(now + 1400, { presentedFrames: 400 }); callback(now + 1500, {});
  assert.equal(counts.length, before + 2);
  assert.ok(counts.every(count => count === 1));
  assert.equal(observer.method, 'video-callback-count');
  assert.equal(observer.fallbackReason, failure === 'stalled' ? 'playback_counter_stalled' : 'playback_counter_unavailable');
  observer.stop();
});

test('a reset dropped-frame counter cannot report a complete playback-quality window', async () => {
  const { observeVideoFrames } = await load('session-runtime/video-frames.mjs');
  let callback, total = 200, dropped = 20;
  const video = { readyState: 2, currentTime: 0, src: 'fixture.webm',
    getVideoPlaybackQuality: () => ({ totalVideoFrames: total, droppedVideoFrames: dropped }),
    requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() {} };
  const observer = observeVideoFrames(video, () => {});
  total++; dropped = 0; callback(performance.now(), { presentedFrames: 1 });
  assert.equal(observer.playbackQuality.complete, false);
  assert.equal(observer.playbackQuality.displayedFrames, null);
  observer.stop();
});

test('invalid FPS observation windows reject before scheduling any video callbacks', async () => {
  const { measureVideoFps } = await load('session-runtime/video-frames.mjs');
  let callbacks = 0;
  const video = { requestVideoFrameCallback() { callbacks++; } };
  for (const duration of [NaN, Infinity, -1, 0, 1.5, 2147483648, '2000']) {
    await assert.rejects(measureVideoFps(video, duration), /Invalid FPS sampling duration/);
  }
  assert.equal(callbacks, 0);
});
