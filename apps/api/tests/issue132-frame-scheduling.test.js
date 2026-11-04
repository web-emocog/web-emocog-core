const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

for (const { fps, latency, minimum } of [
  { fps: 30, latency: 5, minimum: 175 }, { fps: 23, latency: 5, minimum: 130 },
  { fps: 15, latency: 5, minimum: 85 }, { fps: 30, latency: 80, minimum: 60 },
]) test(`issue132: ${fps} Hz source, ${latency} ms model, 4 ms late browser timers`, async t => {
  const { observeVideoFrames } = await import(pathToFileURL(path.resolve(__dirname,
    '../../participant-web/js/session-runtime/video-frames.mjs')).href);
  const profile = await import('../../participant-web/js/session-runtime/protocol-profile.mjs');
  const saved = { performance: global.performance, window: global.window,
    setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  let now = 0, sequence = 0, callback, processed = 0, concurrent = 0, peak = 0;
  const timers = new Map();
  global.window = {};
  global.performance = { now: () => now };
  global.setTimeout = (fn, delay = 0) => { const id = ++sequence; timers.set(id, { fn, at: now + delay + 4 }); return id; };
  global.clearTimeout = id => timers.delete(id);
  t.after(() => Object.assign(global, saved));
  // Run the real orchestrator with I/O adapters stubbed; no DOM/model inference.
  const context = vm.createContext({ performance: global.performance, setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout, window: {}, Date, observeVideoFrames, ...profile,
    ContinuousBpmCollector: class {}, ContinuousBodyPoseCollector: class {},
    SessionQualityDetector: class { reset() {} }, startEmotionSession() {}, endEmotionSession() {},
    getEmotionSummary() {}, updateHeadPoseGuide() {}, extractEyeSignalSample() { return null; } });
  const source = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js/session-runtime/frame-pipeline.js'), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace('export class SessionFramePipeline', 'class SessionFramePipeline');
  vm.runInContext(source + '\nglobalThis.Subject = SessionFramePipeline;', context);
  const SessionFramePipeline = context.Subject;
  const video = { readyState: 2, srcObject: { getVideoTracks: () => [] },
    requestVideoFrameCallback(fn) { callback = fn; return 1; }, cancelVideoFrameCallback() { callback = null; } };
  const state = { sessionData: {}, runtime: { localAnalyzer: { async analyzeFrame() {
    peak = Math.max(peak, ++concurrent);
    await new Promise(resolve => setTimeout(resolve, latency));
    concurrent--; processed++; return { timestamp: now };
  } } } };
  const pipeline = new SessionFramePipeline({ state, video, controller: { featureFlags: {},
    setModuleStatus() {}, captureMultimodalFrame() {}, resolveIssue() {}, reportIssue(error) { throw error; } } });
  pipeline.bpm = { start: async () => false, process() {}, finalize() {} };
  pipeline.bodyPose = { start: async () => false, enabled: false, stop() {} };
  pipeline._processEmotion = () => {};
  pipeline._scheduleAuxiliary = () => {};
  pipeline.qualityDetector.update = () => ({ raised: [], resolved: [] });
  await pipeline.start();
  for (let n = 1; n <= fps * 6; n++) timers.set(++sequence,
    { at: n * 1000 / fps + .5, fn: () => callback?.(now, { presentedFrames: n }) });
  while (timers.size) {
    const [id, next] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    if (next.at > 6500) break;
    timers.delete(id); now = next.at; next.fn();
    for (let n = 0; n < 10; n++) await Promise.resolve();
  }
  pipeline.stop();
  assert.equal(peak, 1, 'inference must stay single-flight');
  assert.ok(processed >= minimum, `Only ${processed}/${fps * 6} delivered frames analyzed`);
  assert.ok(processed <= fps * 6, 'no duplicate frame analysis');
  if (latency === 80) assert.ok(processed < 80, 'a slow model must not pretend to sustain 25 FPS');
  assert.equal(timers.size, 0, 'stop releases every pipeline timer');
  const published = state.sessionData.tech.framePipeline;
  assert.equal(published.frames, processed, 'stop flushes the final diagnostic counters');
  assert.equal(published.timingMethod, 'completed-primary-stages.v1');
  assert.equal(Object.keys(published.stages).length, 6, 'timings have constant memory, not per-frame history');
  let total = 0;
  for (const [name, stage] of Object.entries(published.stages)) {
    assert.equal(stage.frames, processed, `${name} tracks every completed frame`);
    assert.ok(stage.totalMs >= 0 && stage.maxMs >= 0 && stage.maxMs <= stage.totalMs);
    total += stage.totalMs;
    assert.notEqual(stage, pipeline.diagnostics.stages[name], 'published values must be detached');
  }
  assert.ok(Math.abs(total - published.primaryMsTotal) < 1e-6, 'stage durations partition primary elapsed time');
});

test('issue132: a failed camera-rate publication releases single-flight ownership without a synchronous retry loop', async () => {
  const { SessionFramePipeline } = await import(pathToFileURL(path.resolve(__dirname,
    '../../participant-web/js/session-runtime/frame-pipeline.js')).href);
  const scheduled = [], issues = [];
  const pipeline = new SessionFramePipeline({ state: { sessionData: {}, runtime: {} }, video: {},
    controller: { featureFlags: {}, reportIssue: issue => issues.push(issue.code) } });
  pipeline.active = true; pipeline.videoFrameObserver = {};
  pipeline.videoFrameSequence = 1; pipeline._schedule = delay => scheduled.push(delay);
  pipeline._publishCameraFps = () => { throw new Error('synthetic diagnostic failure'); };
  await pipeline._tick();
  assert.equal(pipeline.primaryBusy, false);
  assert.deepEqual(scheduled, [33]);
  assert.deepEqual(issues, ['frame_pipeline_exception']);
  pipeline._publishCameraFps = () => {}; pipeline.videoFrameSequence = 0;
  await pipeline._tick(); pipeline.active = false;
  assert.equal(pipeline.primaryBusy, false);
  assert.deepEqual(scheduled, [33, 1000]);
});

test('issue132: diagnostic snapshots are rate-limited, detached and flushed without an initialized analyzer', async () => {
  const { SessionFramePipeline } = await import(pathToFileURL(path.resolve(__dirname,
    '../../participant-web/js/session-runtime/frame-pipeline.js')).href);
  const state = { sessionData: {}, runtime: {} };
  const pipeline = new SessionFramePipeline({ state, video: {}, controller: { featureFlags: {} } });
  pipeline._publishDiagnostics(false, 0);
  const first = state.sessionData.tech.framePipeline;
  pipeline.diagnostics.frames++; pipeline.diagnostics.stages.face.totalMs = 5;
  pipeline._publishDiagnostics(false, 999);
  assert.equal(state.sessionData.tech.framePipeline, first);
  assert.equal(first.stages.face.totalMs, 0);
  pipeline._publishDiagnostics(false, 1000);
  assert.notEqual(state.sessionData.tech.framePipeline, first);
  assert.equal(state.sessionData.tech.framePipeline.stages.face.totalMs, 5);
  pipeline.diagnostics.frames++;
  pipeline.bodyPose.stop = () => null; pipeline.bpm.finalize = () => null;
  pipeline.stop();
  assert.equal(state.sessionData.tech.framePipeline.frames, 2, 'teardown always flushes current totals');
  const { validateSessionFeaturePayload } = require('../security/payload-policy');
  const payload = { schemaVersion: 'session_feature.v1', ids: { session: 'S-FPS', participant: 'P-FPS', invitationCode: 'local-fixture' },
    meta: { tech: state.sessionData.tech }, lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' }, events: [] };
  assert.deepEqual(validateSessionFeaturePayload(payload), [], 'bounded technical timings fit the existing ingest policy');
  payload.meta.tech.framePipeline.stages.face.rawLandmarks = [1, 2];
  assert.ok(validateSessionFeaturePayload(payload).some(error => error.keyword === 'rawMedia'), 'timing fields do not bypass the raw-media ban');
});
