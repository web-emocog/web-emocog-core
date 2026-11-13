const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = specifier => {
  const [file, query] = specifier.split('?');
  return import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js', file)).href + (query ? '?' + query : ''));
};

test('published definitions without a signal profile keep legacy scheduling and body collection', async () => {
  const { resolveSignalProfile } = await load('session-runtime/protocol-profile.mjs');
  const { resolveSessionFeatureFlags } = await load('session-runtime/feature-flags.mjs');
  const legacy = resolveSignalProfile();
  assert.equal(legacy.id, 'protocol_signals.v1');
  assert.equal(legacy.precheck.required, 15);
  assert.equal(legacy.schedule.segmentIntervalMs, undefined);
  assert.equal(resolveSessionFeatureFlags().bodyMovement, true);
  const settings = { signalProfileId: 'protocol_signals.v2' };
  assert.equal(resolveSessionFeatureFlags({ settings }).bodyMovement, false);
  assert.equal(resolveSessionFeatureFlags({ settings: { ...settings, featureFlags: { bodyMovement: true } } }).bodyMovement, true);
  assert.equal(resolveSignalProfile({ settings }).schedule.targetIntervalMs, legacy.schedule.targetIntervalMs);
  assert.throws(() => resolveSignalProfile({ settings: { signalProfileId: 'future' } }), /Unsupported/);
});

test('precheck admits 8/10 fresh successes, requires the last two and expires without fresh video', async () => {
  const { PrecheckWindow } = await load('session-runtime/precheck-window.mjs');
  const { resolveSignalProfile } = await load('session-runtime/protocol-profile.mjs');
  const window = new PrecheckWindow(resolveSignalProfile({ signalProfileId: 'protocol_signals.v2' }).precheck);
  const row = (i, passed = true, extra = {}) => window.update({
    frameId: i / 3, capturedAt: i * 300, now: i * 300, passed, ...extra
  });
  let status;
  for (let i = 0; i < 10; i++) status = row(i, ![3, 6].includes(i));
  assert.equal(status.passed, true);
  assert.equal(status.successes, 8);
  assert.equal(row(10, false).passed, false);
  assert.equal(row(11).passed, false);
  assert.equal(row(12).passed, false, 'three failures still remain in the last ten');
  assert.equal(row(13).passed, true);
  assert.equal(window.snapshot(6000).passed, false);
  assert.equal(row(14, true, { criticalFailure: true }).samples, 0);
  for (let i = 0; i < 100; i++) row(20);
  assert.equal(window.samples.length, 1, 'repeated video cannot fill the window');
  assert.equal(row(21, true, { capturedAt: 100 }).samples, 0);
  row(22); assert.equal(row(40).samples, 1, 'a large capture gap clears earlier evidence');
});

test('precheck does not pass on ten rapidly repeated polls or backward clocks', async () => {
  const { PrecheckWindow } = await load('session-runtime/precheck-window.mjs');
  const { resolveSignalProfile } = await load('session-runtime/protocol-profile.mjs');
  const gate = new PrecheckWindow(resolveSignalProfile({ signalProfileId: 'protocol_signals.v2' }).precheck);
  for (let i = 0; i < 10; i++) gate.update({ frameId: i, capturedAt: i * 10, now: i * 10, passed: true });
  assert.equal(gate.snapshot(90).passed, false);
  assert.equal(gate.update({ frameId: 0, capturedAt: 0, now: 0, passed: true }).samples, 1);
});

test('face CPU fallback preserves model options and cannot resurrect a cancelled initialization', async () => {
  const { createFaceModel } = await load('precheck-analyzer/face-model.mjs');
  const calls = [], model = { close() {} };
  const result = await createFaceModel(async options => {
    calls.push(options);
    if (options.baseOptions.delegate === 'GPU') throw new Error('GPU unavailable');
    return model;
  }, { baseOptions: { modelAssetPath: 'local.task' }, runningMode: 'VIDEO' });
  assert.equal(result.delegate, 'CPU');
  assert.equal(result.fallbackReason, 'face_gpu_initialization_failed');
  assert.deepEqual(calls[0], { ...calls[1], baseOptions: { ...calls[1].baseOptions, delegate: 'GPU' } });
  let current = true, closed = 0, attempts = 0;
  assert.equal(await createFaceModel(async () => { attempts++; current = false; throw Error('cancelled'); },
    { baseOptions: {} }, () => current), null);
  assert.equal(attempts, 1);
  current = true;
  assert.equal(await createFaceModel(async () => { current = false; return { close() { closed++; } }; },
    { baseOptions: {} }, () => current), null);
  assert.equal(closed, 1);
  await assert.rejects(createFaceModel(async () => { throw Error('no devices'); }, { baseOptions: {} }), /no devices/);
});

test('regional thresholds keep default evidence and apply explicit global and local overrides', async () => {
  const { createSegmentThresholds, getAreaThresholds, DEFAULT_THRESHOLDS, REGION_THRESHOLDS } = await load('face-segmenter/thresholds.js');
  assert.deepEqual(getAreaThresholds('leftEye', createSegmentThresholds()), { minFaceSkin: .2, maxHair: .15, maxHand: .05 });
  const config = createSegmentThresholds({ handOcclusionThreshold: .2, regions: { leftEye: { maxHand: .3 } } });
  assert.equal(getAreaThresholds('leftEye', config).maxHand, .3);
  assert.equal(getAreaThresholds('forehead', config).maxHand, .2);
  assert.equal(createSegmentThresholds({ handOcclusionThreshold: NaN }).handOcclusionThreshold, DEFAULT_THRESHOLDS.handOcclusionThreshold);
  assert.deepEqual(createSegmentThresholds(structuredClone(config)), config,
    'normalizing again in the Worker must preserve main-thread regional settings');
  const defaults = createSegmentThresholds();
  assert.deepEqual(defaults.regions, REGION_THRESHOLDS);
  assert.deepEqual(createSegmentThresholds(structuredClone(defaults)).regions, REGION_THRESHOLDS,
    'sending scalar defaults to the Worker must not overwrite regional defaults');
  const detached = getAreaThresholds('leftEye', defaults);
  detached.maxHand = 1;
  assert.equal(getAreaThresholds('leftEye', defaults).maxHand, .05);
});

function landmarks() {
  const rows = Array.from({ length: 468 }, () => ({ x: .5, y: .5, z: 0 }));
  Object.assign(rows[234], { x: .3 }); Object.assign(rows[454], { x: .7 });
  Object.assign(rows[10], { y: .2 }); Object.assign(rows[152], { y: .8 });
  return rows;
}

test('explicit neutral collection needs five seconds and 25 distinct usable samples, times out and retains no raw points', async () => {
  const { NeutralCalibration } = await load('emotion/neutral-calibration.mjs');
  const { resolveSignalProfile } = await load('session-runtime/protocol-profile.mjs');
  const collector = new NeutralCalibration(resolveSignalProfile({ signalProfileId: 'protocol_signals.v2' }).emotionCalibration);
  const frame = t => ({ timestamp: t, landmarks: landmarks(), face: { detected: true } });
  collector.begin(0);
  for (let i = 0; i < 24; i++) collector.add(frame(i * 200), i * 200);
  assert.equal(collector.status, 'collecting');
  collector.add(frame(4800), 4800); assert.equal(collector.status, 'collecting');
  collector.add(frame(5000), 5000);
  assert.equal(collector.status, 'ready');
  assert.equal(collector.snapshot(5000).acceptedSamples, 26);
  assert.equal(collector.snapshot(60000).elapsedMs, 5000);
  assert.equal(collector.samples.length, 0);
  assert.ok(!JSON.stringify(collector.snapshot(5000)).includes('landmarks'));
  collector.begin(0);
  for (let i = 0; i < 40; i++) collector.add(frame(100), 100);
  assert.equal(collector.samples.length, 1);
  collector.add({ ...frame(400), face: { detected: false } }, 400);
  collector.add(frame(600), 600, false);
  assert.equal(collector.samples.length, 1);
  assert.equal(collector.add(null, 31000).status, 'timeout');
  assert.equal(collector.samples.length, 0);
  collector.skip(); assert.equal(collector.status, 'skipped');
});

test('explicit mode never silently learns neutral from task expressions and the reference remains frozen', async () => {
  const { EmotionAnalyzer } = await load('emotion/emotion-analyzer.js');
  const analyzer = new EmotionAnalyzer();
  analyzer.startSession('synthetic', { explicitNeutral: true });
  for (let i = 0; i < 50; i++) assert.equal(analyzer.analyzeLandmarks(landmarks()).calibrationReady, false);
  analyzer._auBaseline = { AU1: .2 }; analyzer._auBaselineReady = true;
  for (let i = 0; i < 50; i++) analyzer._calibrateActionUnits({ AU1: .201 });
  assert.equal(analyzer._auBaseline.AU1, .2);
});

test('v2 auxiliary and emotion schedules are bounded by time, not delivered frame count, without catch-up bursts', async () => {
  const { SessionFramePipeline } = await load('session-runtime/frame-pipeline.js');
  const { frameBudget } = await load('session-runtime/protocol-profile.mjs');
  const sleep = () => new Promise(resolve => setTimeout(resolve, 2));
  const calls = [];
  const state = { sessionData: { tech: {} }, runtime: {
    invitationProtocolDefinition: { settings: { signalProfileId: 'protocol_signals.v2' } },
    faceSegmenter: { segmentFrame: async (_frame, _landmarks, at) => { calls.push(at); return { isComplete: true }; } }
  } };
  const pipeline = new SessionFramePipeline({ state, controller: { featureFlags: { bodyMovement: false } }, video: {} });
  pipeline.active = true;
  for (let i = 0; i < 30; i++) {
    const frame = { timestamp: i * 1000 / 30, landmarks: [], face: { detected: false } };
    pipeline._processEmotion(frame);
    pipeline._scheduleAuxiliary(frame, null);
    await sleep();
  }
  assert.equal(calls.length, 2);
  assert.equal(pipeline.diagnostics.emotionFrames, 5);
  assert.equal(pipeline.diagnostics.emotionValidFrames, 0);
  pipeline._scheduleAuxiliary({ timestamp: 10000, landmarks: [] }, null);
  await sleep();
  for (let i = 0; i < 50; i++) pipeline._scheduleAuxiliary({ timestamp: 10000, landmarks: [] }, null);
  await sleep();
  assert.equal(calls.length, 3);
  const budget = frameBudget({ sourceFps: 30, primaryMs: 20, segmentMs: 100, schedule: pipeline.schedule });
  assert.equal(budget.auxiliaryUtilizationAtTarget, .2);
  assert.equal(budget.primaryCeilingFps, 30);
  pipeline.active = false;
});

test('the actual pipeline publishes no calibration samples and commits only a complete explicit baseline', async t => {
  const { SessionFramePipeline } = await load('session-runtime/frame-pipeline.js');
  const { startEmotionSession } = await load('emotion-stub-new.js?v=20261112-emotion2');
  const nativePerformance = global.performance;
  let now = 0;
  Object.defineProperty(global, 'performance', { configurable: true, value: { now: () => now } });
  t.after(() => Object.defineProperty(global, 'performance', { configurable: true, value: nativePerformance }));
  const state = { sessionData: { tech: {} }, runtime: {
    invitationProtocolDefinition: { settings: { signalProfileId: 'protocol_signals.v2' } }
  } };
  const pipeline = new SessionFramePipeline({ state, controller: { featureFlags: { bodyMovement: false } }, video: {} });
  startEmotionSession('synthetic-explicit', { explicitNeutral: true });
  pipeline.neutralCalibration.begin(0);
  for (let i = 0; i <= 25; i++) {
    now = i * 200;
    pipeline.lastSegmenterResult = { isComplete: true };
    pipeline.lastSegmenterCapturedAt = now;
    pipeline._processEmotion({ timestamp: now, wallTimestamp: now + 1000, face: { detected: true }, landmarks: landmarks() });
    if (i < 25) assert.equal(state.sessionData.emotionSamples?.length || 0, 0);
  }
  assert.equal(state.sessionData.tech.emotionCalibration.status, 'ready');
  assert.equal(state.sessionData.emotionSamples.length, 1);
  assert.equal(state.sessionData.emotionSamples[0].degraded, false);
  assert.equal(pipeline.neutralCalibration.baseline, null);
});

test('v2 bounds slow auxiliary work, yields to primary work and ignores a stale generation', async () => {
  const { SessionFramePipeline } = await load('session-runtime/frame-pipeline.js');
  const sleep = () => new Promise(resolve => setTimeout(resolve, 5));
  let release, calls = 0;
  const state = { sessionData: { tech: {} }, runtime: {
    invitationProtocolDefinition: { settings: { signalProfileId: 'protocol_signals.v2' } },
    faceSegmenter: { segmentFrame: () => { calls++; return new Promise(resolve => { release = resolve; }); } }
  } };
  const pipeline = new SessionFramePipeline({ state, controller: { featureFlags: { bodyMovement: false } }, video: {} });
  pipeline.active = true;
  pipeline._scheduleAuxiliary({ timestamp: 100, landmarks: [], error: 'face_inference_failed' }, null);
  await sleep();
  assert.equal(calls, 0, 'a failed primary frame must not start auxiliary inference');
  pipeline._scheduleAuxiliary({ timestamp: 100, landmarks: [] }, null);
  assert.equal(calls, 0, 'dispatch yields before entering the auxiliary model');
  await sleep();
  assert.equal(calls, 1);
  for (let i = 0; i < 100; i++) pipeline._scheduleAuxiliary({ timestamp: 1000 + i, landmarks: [] }, null);
  assert.equal(calls, 1, 'no backlog of old frames');
  assert.equal(pipeline.primaryBusy, false, 'auxiliary ownership never claims the primary queue');
  pipeline.generation++;
  const current = pipeline.lastSegmenterResult = { marker: 'new-generation' };
  pipeline.auxiliaryBusy = true;
  release({ marker: 'old-generation' }); await sleep();
  assert.equal(pipeline.lastSegmenterResult, current);
  assert.equal(pipeline.auxiliaryBusy, true, 'old completion cannot release a new generation lock');
  assert.equal(pipeline.diagnostics.segmentFrames, 0);
  pipeline.active = false;
});

test('skipped neutral preparation does no repeated action-unit inference or fake sample append', async () => {
  const { SessionFramePipeline } = await load('session-runtime/frame-pipeline.js');
  const state = { sessionData: { tech: {} }, runtime: {
    invitationProtocolDefinition: { settings: { signalProfileId: 'protocol_signals.v2' } }
  } };
  const pipeline = new SessionFramePipeline({ state, controller: { featureFlags: { bodyMovement: false } }, video: {} });
  pipeline.neutralCalibration.skip();
  const points = landmarks();
  Object.defineProperty(points, '0', { get() { throw new Error('unexpected_landmark_processing_after_skip'); } });
  for (let i = 0; i < 200; i++) pipeline._processEmotion({ timestamp: i * 200, landmarks: points, face: { detected: true } });
  assert.equal(state.sessionData.emotionSamples, undefined);
  assert.equal(pipeline.diagnostics.emotionValidFrames, 0);
  assert.equal(state.runtime.lastEmotionSample, null);
});
