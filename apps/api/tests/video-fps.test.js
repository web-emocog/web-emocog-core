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
});
