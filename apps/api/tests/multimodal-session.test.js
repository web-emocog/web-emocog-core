const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function moduleUrl(relativePath) {
  return pathToFileURL(path.resolve(__dirname, '../../..', relativePath)).href;
}

const multimodalUrl = moduleUrl('packages/shared/multimodal/index.mjs');
const collectorUrl = moduleUrl('apps/participant-web/js/multimodal/session-collector.js');
const flagsUrl = moduleUrl('apps/participant-web/js/session-runtime/feature-flags.mjs');

function gazeSample(overrides = {}) {
  return {
    correctedX: 150,
    correctedY: 75,
    stimulusRect: { left: 100, top: 50, width: 200, height: 100 },
    screenWidth: 1000,
    screenHeight: 700,
    valid: true,
    onScreen: true,
    confidence: 0.9,
    monotonicMs: 1020,
    blockId: 'vpc',
    attempt: 1,
    trialId: 'trial-1',
    stimulusId: 'cat-1',
    ...overrides,
  };
}

test('monotonic clock never goes backwards and nearest alignment is bounded', async () => {
  const { createMonotonicClock, nearestSample } = await import(multimodalUrl);
  let now = 100;
  const performanceObject = { timeOrigin: 1000, now: () => now };
  const clock = createMonotonicClock({ performanceObject });
  assert.equal(clock.now().monotonicMs, 1100);
  now = 90;
  assert.equal(clock.now().monotonicMs, 1100);
  assert.equal(
    nearestSample([{ monotonicMs: 1050 }, { monotonicMs: 1190 }], 1100, 100).deltaMs,
    50
  );
  assert.equal(nearestSample([{ monotonicMs: 1300 }], 1100, 100), null);
});

test('multimodal heatmap aligns signals within 100ms in stimulus coordinates', async () => {
  const { buildMultimodalHeatmaps } = await import(multimodalUrl);
  const model = buildMultimodalHeatmaps({
    gazeSamples: [
      gazeSample(),
      gazeSample({ correctedX: 152, correctedY: 76, monotonicMs: 1140 }),
      gazeSample({ confidence: 0.1, monotonicMs: 1160 }),
    ],
    emotionSamples: [
      { monotonicMs: 1040, confidence: 0.8, valence: 0.5, arousal: 0.6 },
      { monotonicMs: 1130, confidence: 0.9, valence: 0.7, arousal: 0.5 },
    ],
  }, { gridWidth: 4, gridHeight: 4, maxAlignmentMs: 100 });
  const presentation = model.presentations[0];
  assert.equal(model.coordinateSpace, 'stimulus_normalized_0_1');
  assert.equal(presentation.sampleCount, 2);
  assert.equal(presentation.rejectedSampleCount, 1);
  assert.equal(presentation.layers.density.values[5], 1);
  assert.equal(presentation.layers.valence.noData, false);
  assert.ok(presentation.alignment.p95ErrorMs <= 100);
  assert.equal(presentation.qc.lowConfidenceExcluded, true);
});

test('missing or low-confidence emotion remains no-data instead of being imputed', async () => {
  const { buildMultimodalHeatmaps } = await import(multimodalUrl);
  const model = buildMultimodalHeatmaps({
    gazeSamples: [gazeSample()],
    emotionSamples: [
      { monotonicMs: 1020, confidence: 0.1, valence: 0.9, arousal: 0.9 },
    ],
  });
  const presentation = model.presentations[0];
  assert.equal(presentation.layers.valence.noData, true);
  assert.ok(presentation.layers.valence.values.every(value => value === null));
  assert.equal(presentation.alignment.matchedSampleCount, 0);
});

test('repeated attempts of one stimulus remain separate presentations', async () => {
  const { buildMultimodalHeatmaps } = await import(multimodalUrl);
  const model = buildMultimodalHeatmaps({
    gazeSamples: [
      gazeSample({ attempt: 1, monotonicMs: 1000 }),
      gazeSample({ attempt: 2, monotonicMs: 1100 }),
    ],
    emotionSamples: [],
  });
  assert.equal(model.presentationCountTotal, 2);
  assert.deepEqual(model.presentations.map(item => item.attempt), [1, 2]);
  assert.notEqual(model.presentations[0].presentationId, model.presentations[1].presentationId);
});

test('head movement collector applies baseline/OOD gates and stays bounded for 15 minutes', async () => {
  const { MultimodalSessionCollector } = await import(collectorUrl);
  let currentMs = 0;
  const clock = {
    now({ performanceNowMs } = {}) {
      currentMs = Number.isFinite(performanceNowMs) ? performanceNowMs : currentMs;
      return {
        timeOriginMs: 1000,
        monotonicMs: 1000 + currentMs,
        sessionTimeMs: currentMs,
      };
    },
    snapshot() {
      return { timeOriginMs: 1000, startedMonotonicMs: 1000, lastMonotonicMs: 1000 + currentMs };
    },
  };
  const state = {
    sessionData: {
      eyeTracking: [],
      emotionSamples: [],
      bodyPoseSummary: { enabled: true, rawVideoStored: false, rawLandmarksStored: false },
      events: [],
    },
    runtime: { currentPhase: 'trial', taskContext: {} },
  };
  const collector = new MultimodalSessionCollector({
    state,
    clock,
    enabled: true,
    bodyEnabled: true,
    gamerMode: true,
  });
  collector.start();
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (let index = 0; index <= 9000; index += 1) {
    collector.captureFrame({
      frame: {
        timestamp: index * 100,
        landmarks,
        face: { detected: true, confidence: 0.95 },
        pose: { yaw: index === 9000 ? 35 : 1, pitch: 0, roll: 0 },
      },
    });
  }
  const output = collector.stop();
  assert.equal(collector.accumulator.sampleCount, 9001);
  assert.equal(collector.headSamples.length, 1800);
  assert.ok(output.summary.head.oodSampleCount >= 1);
  assert.equal(output.summary.rawVideoStored, false);
  assert.equal(output.summary.rawLandmarksStored, false);
  assert.equal(output.summary.gamerMode, true);
});

test('protocol feature flags are explicit and raw audio debug capture cannot be enabled', async () => {
  const { resolveSessionFeatureFlags } = await import(flagsUrl);
  const defaults = resolveSessionFeatureFlags();
  assert.equal(defaults.audio, false);
  assert.equal(defaults.multimodal, true);
  const flags = resolveSessionFeatureFlags({
    settings: {
      featureFlags: {
        audio: true,
        multimodal: false,
        bodyMovement: false,
        gamerMode: true,
        audioDebugCapture: true,
      },
    },
  });
  assert.equal(flags.audio, true);
  assert.equal(flags.multimodal, false);
  assert.equal(flags.bodyMovement, false);
  assert.equal(flags.audioDebugCapture, false);
});
