const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = file => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js', file)).href);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('mask delegates retain the measured Chromium/Mac CPU path and compatible Firefox/WebKit GPU readback', async () => {
  const { segmentationDelegate } = await load('face-segmenter/delegate-policy.mjs');
  assert.equal(segmentationDelegate({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' } }), 'GPU');
  assert.equal(segmentationDelegate({ navigator: { userAgent: 'Macintosh Chrome/143' } }), 'CPU');
  assert.equal(segmentationDelegate({ navigator: { userAgent: 'Macintosh Firefox/144' } }), 'GPU');
  assert.equal(segmentationDelegate({ document: {}, navigator: { userAgent: 'Macintosh' } }), 'GPU');
  assert.equal(segmentationDelegate({ navigator: { userAgent: 'Windows NT' } }), 'GPU');
  assert.equal(segmentationDelegate({ navigator: { userAgent: 'Linux' } }), 'GPU');
  assert.equal(segmentationDelegate({}), 'GPU');
});

test('pixel buffers never become enumerable session/checkpoint properties', async () => {
  const { rememberFramePixels, getFramePixels } = await load('session-runtime/frame-pixels.mjs');
  const frame = { timestamp: 100, face: { detected: true } };
  const data = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
  rememberFramePixels(frame, data);
  assert.equal(getFramePixels(frame), data);
  assert.equal(JSON.stringify(frame), '{"timestamp":100,"face":{"detected":true}}');
  assert.equal(getFramePixels(JSON.parse(JSON.stringify(frame))), undefined);
});

test('worker analyzer preserves explicitly supplied capture times', async () => {
  const { PrecheckAnalyzer } = await load('precheck-analyzer/PrecheckAnalyzer.js');
  const analyzer = new PrecheckAnalyzer(); analyzer.isInitialized = true;
  const capture = { timestamp: 100, wallTimestamp: 1000 };
  let received;
  analyzer.worker = { analyze: async (_source, context) => {
    received = context; return { frame: { ...context, face: { detected: false } }, imageData: null };
  }, dispose() {} };
  const frame = await analyzer.analyzeFrame({}, capture);
  assert.deepEqual(received, capture);
  assert.equal(frame.timestamp, 100); assert.equal(frame.wallTimestamp, 1000);
  analyzer.dispose();
});

test('face canvas dimensions change only on resize; identical pixels keep identical QC', async t => {
  const { PrecheckAnalyzer } = await load('precheck-analyzer/PrecheckAnalyzer.js');
  const { getFramePixels } = await load('session-runtime/frame-pixels.mjs');
  const previous = global.document;
  t.after(() => { if (previous === undefined) delete global.document; else global.document = previous; });
  let sizes = 0, reads = 0;
  let w = 0, h = 0;
  const canvas = { get width() { return w; }, set width(v) { sizes++; w = v; },
    get height() { return h; }, set height(v) { sizes++; h = v; },
    getContext() { return { drawImage() {}, getImageData() { reads++;
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(128) }; } }; } };
  global.document = { createElement: () => canvas };
  const analyzer = new PrecheckAnalyzer({ worker: false });
  analyzer.isInitialized = true;
  analyzer.faceLandmarker = { detectForVideo: () => ({ faceLandmarks: [] }), close() {} };
  const video = { videoWidth: 8, videoHeight: 6, readyState: 2 };
  const a = await analyzer.analyzeFrame(video, { timestamp: 100, wallTimestamp: 1000 });
  const b = await analyzer.analyzeFrame(video, { timestamp: 200, wallTimestamp: 1100 });
  assert.equal(sizes, 2);
  assert.equal(reads, 2);
  assert.deepEqual(a.illumination, b.illumination);
  assert.equal(b.timestamp, 200); assert.equal(b.wallTimestamp, 1100);
  assert.equal(getFramePixels(b).width, 8);
  const oldNow = Date.now; let wallNow = 10_000;
  t.after(() => { Date.now = oldNow; });
  Date.now = () => wallNow;
  analyzer.faceLandmarker.detectForVideo = () => { wallNow += 4000; return { faceLandmarks: [] }; };
  const delayed = await analyzer.analyzeFrame({ ...video, videoWidth: 10 });
  assert.equal(delayed.wallTimestamp, 10_000, 'slow inference cannot shift capture time');
  assert.equal(sizes, 3);
  analyzer.dispose();
});

test('rPPG consumes the same frame pixels without another readback; fallback still works', async () => {
  const { ContinuousBpmCollector } = await load('session-runtime/continuous-bpm.js');
  const collector = new ContinuousBpmCollector();
  const pixels = { width: 8, height: 6, data: new Uint8ClampedArray(192) };
  let reads = 0; const inputs = [];
  Object.assign(collector, { ready: true, canvas: { width: 8, height: 6 },
    context: { drawImage() {}, getImageData() { reads++; return pixels; } },
    engine: { update(input) { inputs.push(input); return null; } } });
  const landmarks = Array.from({ length: 478 }, () => Object.freeze({ x: .5, y: .5, z: 0 }));
  const video = { videoWidth: 8, videoHeight: 6 };
  collector.process(video, landmarks, 10, pixels);
  assert.equal(reads, 0); assert.equal(inputs[0].imageData, pixels);
  assert.equal(inputs[0].timestampMs, 10);
  assert.notEqual(inputs[0].landmarks[0], landmarks[0]);
  collector.process(video, landmarks, 20);
  assert.equal(reads, 1);
  collector.process(video, landmarks, 20, pixels);
  assert.equal(inputs.length, 2);
});

class FakeWorker {
  constructor() { this.messages = []; this.terminated = false; }
  postMessage(message) {
    this.messages.push(message);
    if (message.type === 'init') queueMicrotask(() => this.reply(message.id, true));
  }
  reply(id, result) { this.onmessage?.({ data: { id, result } }); }
  terminate() { this.terminated = true; }
}

test('worker has one in-flight frame, ignores stale replies, closes bitmaps and handles reset', async t => {
  const { VisionWorkerClient } = await load('session-runtime/vision-worker-client.mjs');
  const original = global.createImageBitmap; let closed = 0;
  t.after(() => { if (original === undefined) delete global.createImageBitmap; else global.createImageBitmap = original; });
  global.createImageBitmap = async () => ({ close() { closed++; } });
  const worker = new FakeWorker();
  const client = new VisionWorkerClient('face', { workerFactory: () => worker });
  await client.start();
  const pending = client.analyze({}, { timestamp: 123, wallTimestamp: 456 });
  await sleep(0);
  await assert.rejects(client.analyze({}), /unavailable/);
  client.reset(); assert.equal(worker.messages.at(-1).type, 'reset');
  worker.reply(999, 'stale'); assert.ok(client.pending);
  worker.reply(client.pending.id, { ok: true });
  assert.deepEqual(await pending, { ok: true });
  assert.equal(closed, 1);
  assert.equal(worker.messages[1].timestamp, 123);
  client.dispose(); assert.equal(worker.terminated, true);
});

test('hung/crashed workers terminate with bounded rejection, never leave a pending promise', async t => {
  const { VisionWorkerClient } = await load('session-runtime/vision-worker-client.mjs');
  const original = global.createImageBitmap;
  t.after(() => { if (original === undefined) delete global.createImageBitmap; else global.createImageBitmap = original; });
  global.createImageBitmap = async () => ({ close() {} });
  for (const mode of ['timeout', 'error', 'messageerror', 'dispose']) {
    const worker = new FakeWorker();
    const client = new VisionWorkerClient('face', { workerFactory: () => worker, timeoutMs: 15 });
    await client.start();
    const pending = client.analyze({});
    const rejected = assert.rejects(pending, /vision_worker/);
    await sleep(0);
    if (mode === 'error') worker.onerror();
    if (mode === 'messageerror') worker.onmessageerror();
    if (mode === 'dispose') client.dispose();
    await rejected;
    assert.equal(client.pending, null); assert.equal(worker.terminated, true);
  }
});


test('bitmap creation completing after disposal cannot post another frame', async t => {
  const { VisionWorkerClient } = await load('session-runtime/vision-worker-client.mjs');
  const original = global.createImageBitmap;
  t.after(() => { if (original === undefined) delete global.createImageBitmap; else global.createImageBitmap = original; });
  let release, closed = 0;
  global.createImageBitmap = () => new Promise(resolve => { release = resolve; });
  const worker = new FakeWorker(); const client = new VisionWorkerClient('face', { workerFactory: () => worker });
  await client.start(); const pending = client.analyze({});
  await Promise.resolve();
  const rejected = assert.rejects(pending, /closed/);
  client.dispose(); release({ close() { closed++; } }); await rejected;
  assert.equal(worker.messages.length, 1); assert.equal(closed, 1);
});

test('a hung bitmap capture also has a deadline and closes a late bitmap', async t => {
  const { VisionWorkerClient } = await load('session-runtime/vision-worker-client.mjs');
  const original = global.createImageBitmap;
  t.after(() => { if (original === undefined) delete global.createImageBitmap; else global.createImageBitmap = original; });
  let release, closed = 0;
  global.createImageBitmap = () => new Promise(resolve => { release = resolve; });
  const worker = new FakeWorker();
  const client = new VisionWorkerClient('face', { workerFactory: () => worker, timeoutMs: 15 });
  await client.start(); await assert.rejects(client.analyze({}), /vision_bitmap_timeout/);
  release({ close() { closed++; } }); await sleep(0);
  assert.equal(closed, 1); assert.equal(worker.messages.length, 1);
  assert.equal(client.capturePending, null); assert.equal(client.busy, false);
});

function bodyLandmarks() {
  const lm = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1, presence: 1 }));
  lm[11] = { ...lm[11], x: .4, y: .3 }; lm[12] = { ...lm[12], x: .6, y: .3 };
  lm[23] = { ...lm[23], x: .4, y: .7 }; lm[24] = { ...lm[24], x: .6, y: .7 };
  return lm;
}

test('late pose output keeps capture timestamp and trial labels instead of the current trial', async () => {
  const { ContinuousBodyPoseCollector } = await load('session-runtime/continuous-body-pose.js');
  const state = { sessionData: { startTime: 1000 }, runtime: { currentPhase: 'task', taskContext: { trialId: 'old' } } };
  let resolve;
  const collector = new ContinuousBodyPoseCollector({ state });
  let clockNow = 100;
  collector.clock = { now: () => ({ timeOriginMs: 1000, monotonicMs: 1000 + clockNow, sessionTimeMs: clockNow }) };
  collector.ready = true; collector.worker = { analyze: () => new Promise(r => { resolve = r; }) };
  const pending = collector.process({ width: 320 }, 100, { trialId: 'old', phase: 'task', wallTime: 1100 });
  state.runtime.taskContext.trialId = 'new';
  clockNow = 999;
  resolve({ landmarks: [bodyLandmarks()] });
  const sample = await pending;
  assert.equal(sample.trialId, 'old'); assert.equal(sample.t, 1100);
  assert.equal(sample.tRelMs, 100); assert.equal(sample.wallTime, undefined);
  assert.equal(sample.sessionTimeMs, 100); assert.equal(sample.monotonicMs, 1100);
  assert.equal(state.sessionData.bodyPoseSamples.length, 1);
});

test('stopped pose collector ignores a late worker result', async () => {
  const { ContinuousBodyPoseCollector } = await load('session-runtime/continuous-body-pose.js');
  const state = { sessionData: {}, runtime: {} }; let resolve;
  const collector = new ContinuousBodyPoseCollector({ state }); collector.ready = true;
  collector.worker = { analyze: () => new Promise(r => { resolve = r; }), dispose() {} };
  const pending = collector.process({ width: 320 }, 100);
  collector.stop(); resolve({ landmarks: [bodyLandmarks()] });
  assert.equal(await pending, null); assert.equal(state.sessionData.bodyPoseSamples, undefined);
});

test('a recovered pose fallback clears failure status rather than staying unavailable', async () => {
  const { ContinuousBodyPoseCollector } = await load('session-runtime/continuous-body-pose.js');
  let failures = 0, recoveries = 0;
  const collector = new ContinuousBodyPoseCollector({ state: { sessionData: {}, runtime: {} },
    onError: () => failures++, onRecovered: () => recoveries++ });
  collector.ready = true;
  collector.worker = { analyze: async () => { throw new Error('synthetic_worker_crash'); }, dispose() {} };
  collector._initialize = async () => { collector.ready = true; return true; };
  assert.equal(await collector.process({ width: 320 }, 100), null);
  await collector.initializing;
  assert.equal(failures, 1); assert.equal(recoveries, 1);
  assert.equal(collector.workerAllowed, false); assert.equal(collector.ready, true);
});

test('auxiliary work yields, has bounded backlog and gives both channels turns', async () => {
  const { SessionFramePipeline } = await load('session-runtime/frame-pipeline.js');
  const state = { sessionData: {}, runtime: { taskContext: { trialId: 'old' }, currentPhase: 'task' } };
  const calls = []; let resolve;
  state.runtime.faceSegmenter = { segmentFrame: () => { calls.push('segment');
    return new Promise(r => { resolve = r; }); } };
  const pipeline = new SessionFramePipeline({ state, controller: { featureFlags: {} }, video: {} });
  pipeline.active = true; pipeline.segmenterCounter = 3; pipeline.bodyPoseCounter = 6;
  pipeline.bodyPose.ready = true; pipeline.bodyPose.process = () => { calls.push('pose'); return null; };
  const frame = { landmarks: [], timestamp: 100, wallTimestamp: 1100 };
  pipeline._scheduleAuxiliary(frame, null);
  assert.deepEqual(calls, []);
  await sleep(5); assert.deepEqual(calls, ['segment']);
  for (let i = 0; i < 100; i++) pipeline._scheduleAuxiliary(frame, null);
  assert.deepEqual(calls, ['segment']); assert.equal(pipeline.diagnostics.auxiliaryDeferredFrames, 100);
  resolve({ score: 100 }); await sleep(5);
  pipeline._scheduleAuxiliary(frame, null); await sleep(5);
  assert.deepEqual(calls, ['segment', 'pose']);
  assert.equal(pipeline.diagnostics.poseFrames, 1);
  pipeline.active = false;
});

test('primary output crossing a trial boundary is skipped without stopping the frame loop', async () => {
  const { SessionFramePipeline } = await load('session-runtime/frame-pipeline.js');
  let release; const scheduled = [];
  const state = { sessionData: {}, runtime: { currentPhase: 'task', taskContext: { trialId: 'old' },
    localAnalyzer: { analyzeFrame: () => new Promise(resolve => { release = resolve; }) } } };
  const pipeline = new SessionFramePipeline({ state, controller: { featureFlags: {} },
    video: { readyState: 2, currentTime: 1 } });
  pipeline.active = true; pipeline._schedule = delay => scheduled.push(delay);
  const pending = pipeline._tick();
  state.runtime.taskContext.trialId = 'new'; release({ timestamp: 100 }); await pending;
  assert.equal(pipeline.diagnostics.contextBoundaryFrames, 1);
  assert.deepEqual(scheduled, [0]);
  assert.equal(state.runtime.lastPrecheckResult, undefined);
});

test('expired segmentation is not reused; freshness uses the capture monotonic clock', async () => {
  const { SessionFramePipeline } = await load('session-runtime/frame-pipeline.js');
  const pipeline = new SessionFramePipeline({ state: { sessionData: {}, runtime: {} }, controller: { featureFlags: {} }, video: {} });
  const mask = { issues: ['left_eye_hand_occluded'] };
  pipeline.lastSegmenterResult = mask; pipeline.lastSegmenterCapturedAt = 100;
  assert.equal(pipeline._currentSegmentation(200), mask);
  assert.equal(pipeline._currentSegmentation(1101), null);
  assert.equal(pipeline._currentSegmentation(50), null);
});

test('segmentation masks are released even when derived analysis throws', async () => {
  const { FaceSegmenter } = await load('face-segmenter/FaceSegmenter.js');
  const analyzer = new FaceSegmenter({ worker: false }); analyzer.isInitialized = true;
  let closed = 0;
  analyzer.imageSegmenter = { segmentForVideo: () => ({ categoryMask: {
    getAsUint8Array() { throw new Error('synthetic_mask_failure'); }, close() { closed++; } },
    confidenceMasks: [{ close() { closed++; } }] }), close() {} };
  const result = await analyzer.segmentFrame({ width: 10, height: 10 });
  assert.equal(result.error, 'synthetic_mask_failure'); assert.equal(closed, 2);
  analyzer.dispose();
});

test('unsupported GPU mask readback retries once inside the worker on CPU, after releasing masks', async () => {
  const { FaceSegmenter } = await load('face-segmenter/FaceSegmenter.js');
  const analyzer = new FaceSegmenter({ worker: false }); analyzer.isInitialized = true;
  analyzer.inferenceDelegate = 'GPU';
  const order = []; let inits = 0;
  analyzer.imageSegmenter = { segmentForVideo: () => ({ categoryMask: {
    getAsUint8Array() { throw new Error('synthetic_gpu_read_failure'); }, close() { order.push('mask'); } } }),
    close() { order.push('gpu'); } };
  analyzer.initialize = async () => {
    inits++; assert.deepEqual(order, ['mask', 'gpu']);
    analyzer.isInitialized = true; analyzer.inferenceDelegate = 'CPU';
    analyzer.imageSegmenter = { segmentForVideo(_source, t) {
      assert.equal(t, 42); return { categoryMask: { width: 2, height: 2,
        getAsUint8Array: () => new Uint8Array([3, 3, 3, 3]), close() {} } };
    }, close() {} }; return true;
  };
  const frame = await analyzer.segmentFrame({ width: 2, height: 2 }, null, 42);
  assert.equal(frame.error, undefined); assert.equal(frame.maskAnalysis.hasData, true);
  assert.equal(inits, 1); assert.equal(analyzer.inferenceDelegate, 'CPU');
  assert.equal(analyzer.cpuFallbackReason, 'gpu_mask_or_inference_failed');
  analyzer.dispose();
});

test('overlapping stage calls serialize instead of treating a busy worker as a failure', async () => {
  const { PrecheckAnalyzer } = await load('precheck-analyzer/PrecheckAnalyzer.js');
  const analyzer = new PrecheckAnalyzer(); analyzer.isInitialized = true;
  let release, calls = 0, disposed = 0;
  analyzer.worker = { analyze() { calls++; return new Promise(resolve => { release = resolve; }); },
    dispose() { disposed++; }, reset() {} };
  const a = analyzer.analyzeFrame({}); const b = analyzer.analyzeFrame({});
  assert.equal(calls, 1);
  release({ frame: { timestamp: 100 } }); await a;
  await Promise.resolve(); assert.equal(calls, 2);
  release({ frame: { timestamp: 200 } }); assert.equal((await b).timestamp, 200);
  assert.equal(disposed, 0); assert.equal(analyzer.workerFallbackReason, undefined);
  analyzer.dispose();
});

test('late errors from a reset face/segmentation worker cannot disable its replacement', async () => {
  const { PrecheckAnalyzer } = await load('precheck-analyzer/PrecheckAnalyzer.js');
  const { FaceSegmenter } = await load('face-segmenter/FaceSegmenter.js');
  for (const Analyzer of [PrecheckAnalyzer, FaceSegmenter]) {
    const analyzer = new Analyzer(); analyzer.isInitialized = true;
    let reject, disposed = 0;
    analyzer.worker = { analyze: () => new Promise((_resolve, r) => { reject = r; }), dispose() {}, reset() {} };
    const pending = Analyzer === PrecheckAnalyzer ? analyzer.analyzeFrame({}) : analyzer.segmentFrame({});
    analyzer.reset();
    const replacement = { dispose() { disposed++; }, reset() {} };
    analyzer.worker = replacement;
    reject(new Error('old_worker_terminated'));
    const frame = await pending;
    assert.ok(frame.error);
    assert.equal(analyzer.worker, replacement);
    assert.equal(analyzer.workerAllowed, true);
    assert.equal(analyzer.isInitialized, true);
    assert.equal(disposed, 0);
    analyzer.dispose();
  }
});

test('a restarted pose collector ignores both success and failure from its previous generation', async () => {
  const { ContinuousBodyPoseCollector } = await load('session-runtime/continuous-body-pose.js');
  for (const mode of ['success', 'failure']) {
    const state = { sessionData: {}, runtime: {} };
    let resolve, reject, failures = 0, disposed = 0;
    const collector = new ContinuousBodyPoseCollector({ state, onError: () => failures++ });
    collector.ready = true;
    collector.worker = { analyze: () => new Promise((r, j) => { resolve = r; reject = j; }), dispose() {} };
    const pending = collector.process({ width: 320 }, 100);
    collector.stop();
    const replacement = { dispose() { disposed++; } };
    collector._initialize = async () => { collector.worker = replacement; collector.ready = true; return true; };
    assert.equal(await collector.start(), true);
    if (mode === 'success') resolve({ landmarks: [bodyLandmarks()] });
    else reject(new Error('old_worker_terminated'));
    assert.equal(await pending, null);
    assert.equal(collector.worker, replacement);
    assert.equal(collector.ready, true);
    assert.equal(failures, 0); assert.equal(disposed, 0);
    assert.equal(state.sessionData.bodyPoseSamples, undefined);
    collector.stop();
  }
});

test('rPPG keeps captured pixels and timestamps even if decoding or the live video changes', async t => {
  const { ContinuousBpmCollector } = await load('session-runtime/continuous-bpm.js');
  const collector = new ContinuousBpmCollector();
  const originalNow = Date.now; let wallNow = 1000, input;
  Date.now = () => wallNow; t.after(() => { Date.now = originalNow; });
  Object.assign(collector, { ready: true, context: { drawImage() { throw Error('must not recapture a different frame'); } },
    publicationGate: { evaluate: () => ({ accepted: true, bpm: 70 }) },
    engine: { update(value) { input = value; wallNow += 5000; return { features: {} }; } } });
  const pixels = { width: 10, height: 8, data: new Uint8ClampedArray(320) };
  const landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  const first = collector.process({ videoWidth: 8, videoHeight: 6 }, landmarks, 100, pixels);
  assert.equal(first.t, 1000);
  assert.equal(input.imageData, pixels); assert.equal(input.frameW, 10); assert.equal(input.frameH, 8);
  const second = collector.process({ videoWidth: 8, videoHeight: 6 }, landmarks, 200, pixels, 1500);
  assert.equal(second.t, 1500);
});
