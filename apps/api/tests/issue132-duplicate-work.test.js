const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { protocolCameraConstraints } = require('../../participant-web/js/session-runtime/protocol-profile.mjs');

function load(file, context, exports) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js', file), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace(/\bexport /g, '');
  vm.runInContext(source + '\nglobalThis.subject = { ' + exports.join(', ') + ' };', context);
  return context.subject;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function precheckFixture(file = 'precheck-updated.js') {
  const nodes = new Map(), timers = new Map(), permissions = [];
  let timerId = 0, analyses = 0, resets = 0, stopped = 0;
  const frame = deferred();
  const node = id => {
    if (!nodes.has(id)) {
      const listeners = new Map();
      nodes.set(id, { id, listeners, style: { removeProperty() {} }, classList: { toggle() {} }, appendChild() {},
        addEventListener(type, fn) { listeners.set(type, fn); },
        removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); }, play: async () => {} });
    }
    return nodes.get(id);
  };
  const state = { flags: {}, runtime: { localAnalyzer: { reset() { resets++; }, analyzeFrame() { analyses++; return frame.promise; } },
    faceSegmenter: { segmentFrame: async () => ({ isComplete: true, faceVisibility: {} }) } }, sessionData: { tech: {} }, currentLang: 'en' };
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, state,
    translations: { en: {} }, window: {}, AbortController, DOMException, protocolCameraConstraints,
    getFramePixels: frame => frame?.fixturePixels,
    document: { getElementById: id => id === 'precheck-layout-fix-v1' ? {} : node(id), querySelector: node },
    navigator: { mediaDevices: { getUserMedia() { const request = deferred(); permissions.push(request); return request.promise; } } },
    resetHeadPoseReference() {}, setHeadPoseGuideMode() {},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    LOCAL_ANALYSIS_CONFIG: { FRAME_INTERVAL_MS: 33 },
    measureCameraFPS: async () => ({ fps: 30, frames: 60, duration: 2 }) });
  const subject = load('web-page/' + file, context, ['startPreCheck', 'stopPreCheck', 'startContinuousAnalysis']);
  const stream = () => {
    const track = { stop() { stopped++; }, getSettings: () => ({ width: 640, height: 480, frameRate: 30 }) };
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  return { subject, state, frame, node, permissions, timers, stream, get analyses() { return analyses; },
    get resets() { return resets; }, get stopped() { return stopped; } };
}

test('issue132: concurrent precheck starts share one permission request; stop releases late camera acquisition', async () => {
  const f = precheckFixture();
  const first = f.subject.startPreCheck(), second = f.subject.startPreCheck(), third = f.subject.startPreCheck();
  assert.equal(f.permissions.length, 1);
  assert.equal(first, second); assert.equal(first, third);
  f.subject.stopPreCheck();
  f.permissions[0].resolve(f.stream());
  assert.equal(await first, false);
  assert.equal(f.stopped, 1);
  assert.equal(f.analyses, 0);
  assert.equal(f.state.runtime.cameraStream, undefined);
  assert.equal(f.timers.size, 0);
});

test('issue132: a cancelled permission request cannot replace a newer precheck request', { timeout: 1000 }, async () => {
  const f = precheckFixture();
  const old = f.subject.startPreCheck(); f.subject.stopPreCheck();
  const current = f.subject.startPreCheck();
  f.permissions[0].resolve(f.stream()); await old;
  assert.equal(f.subject.startPreCheck(), current, 'old finally must not clear the new owner');
  assert.equal(f.permissions.length, 2);
  f.subject.stopPreCheck(); f.permissions[1].resolve(f.stream()); await current;
  assert.equal(f.stopped, 2); assert.equal(f.timers.size, 0);
});

test('issue132: precheck starts a single analysis loop and ignores a result after stop', async () => {
  const f = precheckFixture();
  f.subject.startContinuousAnalysis(); f.subject.startContinuousAnalysis();
  assert.equal(f.analyses, 1);
  f.subject.stopPreCheck(); f.frame.resolve({ landmarks: [], illumination: {} }); await drain();
  assert.equal(f.state.runtime.precheckData, undefined);
  assert.equal(f.state.runtime.precheckFramesHistory.length, 0);
  assert.equal(f.timers.size, 0);
});

for (const failure of ['timeout', 'error', 'play_timeout', 'play_failure']) test(`issue132: precheck video ${failure} releases camera and permits a clean retry`, async () => {
  const f = precheckFixture();
  if (failure.startsWith('play_')) {
    f.node('precheckVideo').readyState = 1;
    f.node('precheckVideo').play = failure === 'play_timeout'
      ? () => new Promise(() => {}) : async () => { throw new Error('Synthetic playback failure'); };
  }
  const pending = f.subject.startPreCheck();
  f.permissions[0].resolve(f.stream()); await drain();
  const video = f.node('precheckVideo');
  if (failure !== 'play_failure') {
    assert.equal(f.timers.size, 1);
    if (failure.endsWith('timeout')) [...f.timers.values()][0](); else video.listeners.get('error')();
  }
  assert.equal(await pending, false); assert.equal(f.stopped, 1);
  assert.equal(video.listeners.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.state.runtime.cameraStream, null);
  const retry = f.subject.startPreCheck();
  assert.equal(f.permissions.length, 2);
  f.subject.stopPreCheck(); f.permissions[1].resolve(f.stream()); await retry;
  assert.equal(f.stopped, 2);
});

test('issue132: stopping during metadata wait removes listeners and never starts analysis', async () => {
  const f = precheckFixture(); const pending = f.subject.startPreCheck();
  f.permissions[0].resolve(f.stream()); await drain();
  f.subject.stopPreCheck(); assert.equal(await pending, false);
  assert.equal(f.node('precheckVideo').listeners.size, 0);
  assert.equal(f.timers.size, 0); assert.equal(f.stopped, 1); assert.equal(f.analyses, 0);
});

test('issue132: successful precheck keeps its shared camera for calibration and ignores repeated starts', async () => {
  const f = precheckFixture(); f.node('precheckVideo').readyState = 1;
  const pending = f.subject.startPreCheck(), stream = f.stream(); f.permissions[0].resolve(stream);
  assert.equal(await pending, true);
  assert.equal(await f.subject.startPreCheck(), true);
  assert.equal(f.permissions.length, 1); assert.equal(f.analyses, 1);
  f.subject.stopPreCheck(); f.frame.resolve({}); await drain();
  assert.equal(f.stopped, 0, 'normal precheck/calibration handoff must not stop the shared camera');
  assert.equal(f.state.runtime.cameraStream, stream); assert.equal(f.node('precheckVideo').srcObject, stream);
  assert.equal(f.timers.size, 0); assert.equal(f.state.runtime.precheckFramesHistory.length, 0);
});

test('issue132: precheck retires when continuous analysis takes over without resetting its shared analyzer', async () => {
  const f = precheckFixture(); f.subject.startContinuousAnalysis();
  f.state.runtime.sessionRuntime = { isAnalysisRunning: () => true };
  f.frame.resolve({ landmarks: [] }); await drain();
  assert.equal(f.state.flags.isPrecheckRunning, false);
  assert.equal(f.timers.size, 0); assert.equal(f.state.runtime.precheckData, undefined);
  f.subject.stopPreCheck();
  assert.equal(f.resets, 0, 'cleanup is not allowed to reset the active continuous face analyzer');
  assert.equal(await f.subject.startPreCheck(), false); assert.equal(f.permissions.length, 0);
});

for (const file of ['precheck-updated.js', 'precheck.js']) test(`issue132: ${file} history retains derived values without retaining captured pixel buffers`, async () => {
  const { rememberFramePixels, getFramePixels } = await import(require('node:url').pathToFileURL(
    path.resolve(__dirname, '../../participant-web/js/session-runtime/frame-pixels.mjs')).href);
  const f = precheckFixture(file), frames = [];
  f.state.runtime.localAnalyzer.analyzeFrame = async () => {
    const frame = { timestamp: frames.length + 1, landmarks: [], illumination: {}, face: {}, pose: {} };
    rememberFramePixels(frame, { data: new Uint8ClampedArray(16), width: 2, height: 2 });
    frames.push(frame); return frame;
  };
  f.subject.startContinuousAnalysis(); await drain();
  for (let i = 0; i < 104; i++) {
    const [id, callback] = [...f.timers][0]; f.timers.delete(id); callback(); await drain();
  }
  f.subject.stopPreCheck();
  const history = f.state.runtime.precheckFramesHistory;
  assert.equal(history.length, 100); assert.equal(frames.length, 105);
  for (let i = 0; i < history.length; i++) {
    assert.notEqual(history[i], frames[i + 5]);
    assert.equal(history[i].timestamp, frames[i + 5].timestamp);
    assert.equal(history[i].landmarks, frames[i + 5].landmarks, 'derived features are preserved');
    assert.equal(getFramePixels(history[i]), undefined, 'history cannot keep the original frame key alive');
  }
  assert.ok(getFramePixels(frames[104]), 'the actual capture remains available to same-frame consumers');
  assert.equal(f.timers.size, 0);
});

test('precheck pairs segmentation with the same captured pixels and timestamp as the face result', async () => {
  const f = precheckFixture();
  const landmarks = [{ x: .5, y: .5 }];
  const pixels = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
  const calls = [];
  f.state.runtime.faceSegmenter.segmentFrame = async (...args) => {
    calls.push(args);
    return { isComplete: true, faceVisibility: {} };
  };
  f.subject.startContinuousAnalysis();
  f.frame.resolve({ timestamp: 123, landmarks, fixturePixels: pixels, illumination: {}, face: {}, pose: {} });
  await drain();
  f.subject.stopPreCheck();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], pixels);
  assert.equal(calls[0][1], landmarks);
  assert.equal(calls[0][2], 123);
});

function gazeFixture() {
  const timers = new Map(), pending = [], segmentResults = [];
  let sequence = 0, continuous = false, updates = 0;
  const state = { runtime: { localAnalyzer: { analyzeFrame() { const job = deferred(); pending.push(job); return job.promise; } },
    gazeTracker: { isCalibrated: () => true, predict: () => ({ x: 1, y: 2 }), resetSmoothingState() {} },
    faceSegmenter: { segmentFrame() { const job = deferred(); segmentResults.push(job); return job.promise; } } } };
  const video = { readyState: 2, currentTime: 1, srcObject: {} };
  const context = vm.createContext({ console, state, Date, performance: { now: () => 1 },
    document: { getElementById: () => video }, window: { handleGazeUpdate() { updates++; } },
    ANALYSIS_LOOP: { targetIntervalMs: 33, sameFrameRetryMs: 8, segmenterStride: 1 },
    isContinuousSessionAnalysisRunning: () => continuous, extractEyeSignalSample: () => null,
    setTimeout(fn) { timers.set(++sequence, fn); return sequence; }, clearTimeout: id => timers.delete(id) });
  const subject = load('gaze-tracker/gaze-tests/common/analysis-loop.js', context,
    ['startGazeTestsAnalysisLoop', 'stopGazeTestsAnalysisLoop', 'isGazeTestsAnalysisLoopRunning']);
  const tick = () => { const [id, fn] = [...timers][0]; timers.delete(id); return fn(); };
  return { subject, state, video, timers, pending, segmentResults, tick,
    set continuous(value) { continuous = value; }, get updates() { return updates; } };
}

test('issue132: a late gaze result cannot publish or fork timers after stop/restart', async () => {
  const f = gazeFixture(); f.subject.startGazeTestsAnalysisLoop();
  const oldTick = f.tick(); f.subject.stopGazeTestsAnalysisLoop(); f.subject.startGazeTestsAnalysisLoop();
  f.pending[0].resolve({ landmarks: [], pose: { yaw: 1 } }); await oldTick;
  assert.equal(f.state.runtime.lastPrecheckResult, undefined);
  assert.equal(f.updates, 0); assert.equal(f.timers.size, 1);
  const currentTick = f.tick(); f.pending[1].resolve({ landmarks: [], pose: { yaw: 2 } }); await currentTick;
  assert.equal(f.updates, 1); assert.equal(f.timers.size, 1);
  f.subject.stopGazeTestsAnalysisLoop();
  f.segmentResults[0]?.resolve({ obsolete: true }); await drain();
  assert.equal(f.timers.size, 0);
});

test('issue132: legacy gaze hands off to continuous analysis, including an in-flight result', async () => {
  const f = gazeFixture(); f.subject.startGazeTestsAnalysisLoop();
  const oldTick = f.tick(); f.continuous = true;
  f.pending[0].resolve({ landmarks: [] }); await oldTick;
  assert.equal(f.updates, 0); assert.equal(f.timers.size, 0);
  assert.equal(f.subject.isGazeTestsAnalysisLoopRunning(), false);
  assert.equal(f.subject.startGazeTestsAnalysisLoop(), true);
  assert.equal(f.timers.size, 0);
});

test('issue132: old segmentation cannot replace or unlock a new gaze run', async () => {
  const f = gazeFixture(); f.subject.startGazeTestsAnalysisLoop();
  let tick = f.tick(); f.pending[0].resolve({ landmarks: [] }); await tick;
  f.subject.stopGazeTestsAnalysisLoop(); f.subject.startGazeTestsAnalysisLoop();
  tick = f.tick(); f.pending[1].resolve({ landmarks: [] }); await tick;
  assert.equal(f.segmentResults.length, 2);
  f.segmentResults[0].resolve({ stale: true }); await drain();
  const masks = [];
  f.state.runtime.qcMetrics = { isRunning: () => true, processFrame(_frame, mask) { masks.push(mask); } };
  f.video.currentTime = 2;
  tick = f.tick(); f.pending[2].resolve({ landmarks: [] }); await tick;
  assert.equal(f.segmentResults.length, 2, 'old completion cannot release the current segmentation slot');
  assert.equal(masks[0], null, 'old mask is not current QC evidence');
  f.subject.stopGazeTestsAnalysisLoop(); f.segmentResults[1].resolve({ current: true }); await drain();
  assert.equal(f.timers.size, 0);
});

for (const file of ['tests-updated.js', 'tests.js']) {
  test(`issue132: ${file} uses one camera FPS owner when continuous analysis is running`, () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js/web-page', file), 'utf8');
    const body = source.slice(source.indexOf('export function startTrackingTest('), source.indexOf('\nexport function finishTrackingTest('))
      .replace('export function', 'function');
    for (const continuous of [true, false]) {
      let monitors = 0;
      const node = { style: {}, classList: { add() {} } };
      const context = vm.createContext({ console: { log() {} }, Date, Math, performance: { now: () => 1 },
        state: { flags: {}, runtime: { currentGaze: {} }, sessionData: { trackingTest: [] } },
        window: { innerWidth: 1000, innerHeight: 700 }, document: { getElementById: id => id === 'precheckVideo' ? { srcObject: {} } : node },
        isContinuousSessionAnalysisRunning: () => continuous, startCameraFpsMonitor() { monitors++; },
        setSessionPhase() {}, recordSessionEvent() {}, clearTaskContext() {}, hideQcOverlay() {}, resetFaceLostTimer() {},
        requestAnimationFrame() {}, setTimeout() {} });
      vm.runInContext(body + '\nstartTrackingTest();', context);
      assert.equal(monitors, continuous ? 0 : 1);
    }
  });
}
