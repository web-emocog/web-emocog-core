const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js', name)).href);
const library = name => import(pathToFileURL(path.resolve(__dirname, '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg', name)).href);
const sample = (i, patch = {}) => ({ t: 1000000 + i * 1000 / 30, tRelMs: i * 1000 / 30,
  correctedX: 500, correctedY: 350, valid: true, onScreen: true, confidence: .9,
  screenWidth: 1000, screenHeight: 700, blockId: 'main', attempt: 1, trialId: 'trial-1',
  stimulusId: 'std_simple_black_square', stimulusVersion: '1', stimulusType: 'image', phase: 'cognitive_stimulus',
  stimulusRect: { left: 100, top: 50, width: 800, height: 600, intrinsicWidth: 800, intrinsicHeight: 600,
    coordinateMappingVersion: 'media-content-rect.v1' }, ...patch });
const options = { gridWidth: 32, gridHeight: 18, screenWidth: 1000, screenHeight: 700 };

test('one-hour heatmaps preserve early stimuli with bounded raw storage and JSON recovery', async () => {
  const { appendGazeHistory, captureGazeHistory, buildSessionHeatmaps } = await load('session-runtime/gaze-history.mjs');
  let session = { ids: { session: 'one-hour' }, eyeTracking: [] }, runtime = {};
  const start = performance.now();
  for (let i = 0; i < 108000; i++) {
    const point = sample(i, { trialId: i < 54000 ? 'early' : 'late' });
    appendGazeHistory(session, runtime, point);
    session.eyeTracking.push(point);
    if (session.eyeTracking.length > 32000) session.eyeTracking.splice(0, 2000);
    if (i === 53999) {
      captureGazeHistory(session, runtime);
      session = JSON.parse(JSON.stringify(session)); runtime = {};
    }
  }
  captureGazeHistory(session, runtime);
  const result = buildSessionHeatmaps(session, runtime, options);
  assert.equal(result.accumulation.summary.sampleCountTotal, 108000);
  assert.equal(result.accumulation.summary.ignoredTimestamps, 0);
  assert.equal(result.perStimulus.length, 2);
  assert.equal(result.perStimulus[0].trialId, 'early');
  assert.ok(result.perStimulus.every(item => item.sampleCountTotal === 54000 && item.fixationPoints.length === 1));
  assert.ok(result.perStimulus.every(item => item.grid.values.some(v => v > 0)));
  assert.ok(session.eyeTracking.length <= 32000);
  assert.ok(JSON.stringify(session.heatmapState).length < 100000);
  console.log(`one-hour synthetic accumulation: ${Math.round(performance.now() - start)} ms; state ${JSON.stringify(session.heatmapState).length} bytes`);
});

test('streaming resume equals uninterrupted processing and finalization is idempotent', async () => {
  const { createHeatmapAccumulator, buildHeatmaps } = await load('web-page/heatmap.js');
  const points = Array.from({ length: 300 }, (_, i) => sample(i, { correctedX: i < 150 ? 300 : 600 }));
  let acc = createHeatmapAccumulator(options);
  points.slice(0, 110).forEach(acc.add);
  acc = createHeatmapAccumulator({}, JSON.parse(JSON.stringify(acc.snapshot())));
  points.slice(110).forEach(acc.add);
  const expected = buildHeatmaps(points, options);
  assert.deepEqual(acc.finalize(), expected);
  assert.deepEqual(acc.finalize(), expected);
  assert.equal(expected.perStimulus[0].fixationPoints.length, 2);
  // Independent constant-coordinate reference, not a second call to the accumulator.
  const first = expected.perStimulus[0].fixationPoints[0];
  assert.ok(Math.abs(first.x - .25) < 1e-12);
  assert.ok(Math.abs(first.durationMs - (33 + 149 * 1000 / 30)) < 1e-6);
});

test('heatmaps reject duplicate time, invalid gaze and single-point pseudo-fixations', async () => {
  const { createHeatmapAccumulator, buildHeatmaps } = await load('web-page/heatmap.js');
  const acc = createHeatmapAccumulator(options);
  acc.add(sample(0)); acc.add(sample(0)); acc.add(sample(-1)); acc.add(sample(1, { valid: false }));
  const result = acc.finalize();
  assert.equal(result.accumulation.summary.sampleCountTotal, 2);
  assert.equal(result.accumulation.summary.ignoredTimestamps, 2);
  assert.equal(result.perStimulus[0].fixationCountTotal, 0);
  const invalid = buildHeatmaps(Array.from({ length: 20 }, (_, i) => sample(i, { valid: false })), options);
  assert.ok(invalid.session.bins.flat().every(v => v === 0));
  assert.ok(invalid.perStimulus[0].grid.values.every(v => v === 0));
});

test('version, attempt and trial identities remain isolated; corrupt checkpoints fail closed', async () => {
  const { createHeatmapAccumulator } = await load('web-page/heatmap.js');
  const acc = createHeatmapAccumulator(options);
  [sample(0), sample(1, { attempt: 2 }), sample(2, { stimulusVersion: '2' }), sample(3, { trialId: 'other' })].forEach(acc.add);
  assert.equal(acc.finalize().perStimulus.length, 4);
  const before = acc.snapshot();
  const restored = createHeatmapAccumulator({}, before); restored.add(sample(4));
  assert.equal(before.summary.sampleCountTotal, 4);
  const corrupt = acc.snapshot(); corrupt.session.bins[0][0] = null;
  assert.throws(() => createHeatmapAccumulator({}, corrupt), /Corrupt/);
  assert.throws(() => createHeatmapAccumulator({ gridWidth: 1e9 }), /Invalid/);
});

test('new calibration quality affects future contributions without rescaling past observations', async () => {
  const { createHeatmapAccumulator } = await load('web-page/heatmap.js');
  let acc = createHeatmapAccumulator({ ...options, aoiRadiusPx: 10 });
  for (let i = 0; i < 60; i++) acc.add(sample(i));
  const first = acc.finalize().perStimulus[0].grid.values.reduce((sum, v) => sum + v, 0);
  acc.setValidationRmsPx(10);
  acc = createHeatmapAccumulator({}, JSON.parse(JSON.stringify(acc.snapshot())));
  for (let i = 60; i < 120; i++) acc.add(sample(i));
  const total = acc.finalize().perStimulus[0].grid.values.reduce((sum, v) => sum + v, 0);
  assert.ok(Math.abs((total - first) - 1000) < .002);
});

test('long fixation lists retain full density but refuse incomplete AOI statistics', async () => {
  const { buildHeatmaps } = await load('web-page/heatmap.js');
  const { buildHeatmapData, buildAoiRows } = require('../analytics/metrics');
  const points = Array.from({ length: 610 * 8 }, (_, i) => sample(i, { correctedX: Math.floor(i / 8) % 2 ? 700 : 300 }));
  const heatmaps = buildHeatmaps(points, options), presentation = heatmaps.perStimulus[0];
  assert.equal(presentation.fixationCountTotal, 610);
  assert.equal(presentation.fixationPoints.length, 500);
  assert.equal(presentation.fixationsTruncated, true);
  const row = { id: 1, participant_id: 'p', features_payload: { gaze_analytics: { schemaVersion: 'gaze_analytics.v1',
    presentations: [{ ...presentation, fixationPoints: presentation.fixationPoints }] } } };
  const query = { metricIds: ['aoi.dwell_time_ms'], filters: { blockIds: ['main'], stimulusIds: ['std_simple_black_square'], aoiIds: [] } };
  const map = buildHeatmapData(row, query);
  assert.equal(map.nFixations, 610);
  assert.equal(map.reason, 'gaze_fixations_truncated');
  const protocol = { definition: { blocks: [{ id: 'main', blockConfig: { aoiDefinitions: {
    std_simple_black_square: [{ id: 'target', shape: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]
  } } }] } };
  const metric = buildAoiRows(row, protocol, query)[0].metrics[0];
  assert.equal(metric.status, 'no_data');
  assert.equal(metric.reason, 'gaze_fixations_truncated');
});

test('aggregate packet uses cumulative gaze counts and explicitly marks the presentation cap', async () => {
  const { buildHeatmaps } = await load('web-page/heatmap.js');
  const { buildAggregatesPayload } = await load('unified-aggregates-new.js');
  const eyeTracking = Array.from({ length: 201 }, (_, i) => sample(i, { trialId: String(i) }));
  const heatmaps = buildHeatmaps(eyeTracking, options);
  const packet = buildAggregatesPayload({ ids: { session: 'long', participant: 'p' }, user: {}, heatmaps, eyeTracking: eyeTracking.slice(-1),
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' } }, { forIngest: true });
  const { validateSessionFeaturePayload } = require('../security/payload-policy');
  assert.deepEqual(validateSessionFeaturePayload(packet), []);
  assert.equal(packet.gaze_analytics.summary.sampleCountTotal, 201);
  assert.equal(packet.gaze_analytics.summary.presentationsTruncated, true);
  assert.equal(packet.gaze_analytics.presentations.length, 200);
  assert.equal(packet.heatmapState, undefined);
});

test('respiration publication refuses raw, held, low-confidence and malformed estimates', async () => {
  const { publishedRespiration } = await load('session-runtime/continuous-bpm.js');
  assert.equal(publishedRespiration({ respRate: 12, respConf: .8 }), 12);
  for (const feature of [{ respRateRaw: 12, respConf: .8 }, { respRate: 12, respConf: .1 },
    { respRate: 12, respConf: .8, respHeld: true }, { respRate: 12, respConf: .8, respPublished: false },
    { respRate: 80, respConf: .8 }, { respRate: NaN, respConf: 1 }]) assert.equal(publishedRespiration(feature), null);
});

test('maximum-context fixation details cannot make the standard gaze packet exceed ingest size', async () => {
  const { buildAggregatesPayload } = await load('unified-aggregates-new.js');
  const { validateSessionFeaturePayload } = require('../security/payload-policy');
  const fixationPoints = Array.from({ length: 500 }, (_, i) => ({ x: Math.sin(i) ** 2, y: Math.cos(i) ** 2,
    startMs: i * 300, durationMs: 200, signalConfidence: .9 }));
  const perStimulus = Array.from({ length: 200 }, (_, i) => ({ blockId: 'main', trialId: String(i),
    stimulusId: 'std_simple_black_square', presentationId: String(i), fixationPoints,
    fixationCountTotal: 500, grid: { width: 32, height: 18, values: Array(576).fill(1125.625) } }));
  const payload = buildAggregatesPayload({ ids: { session: 'bounded-gaze', participant: 'p' }, user: {},
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' }, heatmaps: { perStimulus } }, { forIngest: true });
  assert.ok(payload.gaze_analytics.presentations.reduce((n, entry) => n + entry.fixationPoints.length, 0) <= 4000);
  assert.ok(payload.gaze_analytics.presentations.every(entry => entry.fixationsTruncated && entry.fixationCountTotal === 500));
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 1750 * 1024);
  assert.equal(perStimulus[0].fixationPoints.length, 500);
  assert.deepEqual(validateSessionFeaturePayload(payload), []);
});

test('continuous physiology has bounded storage and fresh-only full-session statistics', async () => {
  const { ContinuousBpmCollector } = await load('session-runtime/continuous-bpm.js');
  let output = { published: true, bpmPublished: 80, confidence: .9, features: { respRate: 12, respConf: .9 } };
  const collector = new ContinuousBpmCollector();
  Object.assign(collector, { ready: true, canvas: {}, context: { drawImage() {}, getImageData() { return {}; } },
    engine: { update() { return output; } } });
  const frame = { videoWidth: 10, videoHeight: 10 }, landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  for (let i = 0; i < 8000; i++) collector.process(frame, landmarks, i * 500);
  output = { published: false, bpmPublished: 80, confidence: .1, publishReason: 'hold_last', features: { respRate: 12, respConf: .1 } };
  for (let i = 0; i < 20; i++) collector.process(frame, landmarks, (8000 + i) * 500);
  const result = collector.finalize();
  assert.equal(result.sampleCount, 8020);
  assert.equal(result.validSampleCount, 8000);
  assert.equal(result.validRespSampleCount, 8000);
  assert.equal(result.bpmMean, 80);
  assert.equal(result.respRateMean, 12);
  assert.equal(result.samples.length, 7200);
  assert.equal(result.samples.at(-1).held, true);
  assert.equal(result.samples.at(-1).published, false);
  assert.equal(result.samples.at(-1).respRate, null);
});

test('duplicate physiology frames are not new measurements and reporter never publishes held values', async () => {
  const { ContinuousBpmCollector } = await load('session-runtime/continuous-bpm.js');
  const { SessionReporter } = await library('session/SessionReporter.js');
  const collector = new ContinuousBpmCollector();
  Object.assign(collector, { ready: true, canvas: {}, context: { drawImage() {}, getImageData() { return {}; } },
    engine: { update() { return { published: true, bpmPublished: 80, confidence: .9 }; } } });
  const frame = { videoWidth: 10, videoHeight: 10 }, landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
  collector.process(frame, landmarks, 1000); collector.process(frame, landmarks, 1000); collector.process(frame, landmarks, 999);
  assert.equal(collector.snapshot().validSampleCount, 1);
  collector.finalize();
  assert.equal(collector.process(frame, landmarks, 1500), null);
  assert.equal(await collector.start(), false);
  assert.equal(collector.snapshot().validSampleCount, 1);
  const reporter = new SessionReporter({ maxSamples: 2 });
  reporter.push({ published: true, bpmPublished: 80 }, 1000);
  reporter.push({ published: false, bpmPublished: 180 }, 1500);
  assert.equal(reporter.finalize().range_bpm.published.count, 1);
  assert.equal(reporter.finalize().samples[1].bpm_published, null);
});

test('held high BPM cannot confirm a fresh elevated measurement', async () => {
  const { BpmPublicationGate } = await load('session-runtime/bpm-publication-gate.mjs');
  const gate = new BpmPublicationGate();
  for (let i = 0; i < 10; i++) assert.equal(gate.evaluate({ bpmPublished: 135, publishReason: 'hold_last', confidence: .9 }).held, true);
  assert.equal(gate.evaluate({ published: true, bpmPublished: 135, confidence: .9 }).accepted, false);
});

test('restored signal summaries are weighted by fresh samples, not by run count', async () => {
  const { combineSignalSummaries } = await load('session-runtime/signal-history.mjs');
  const result = combineSignalSummaries({ sampleCount: 100, validSampleCount: 90, bpmMean: 80,
    validRespSampleCount: 80, respRateMean: 12, respRateMin: 11, respRateMax: 13 },
  { sampleCount: 10, validSampleCount: 10, bpmMean: 100, validRespSampleCount: 10, respRateMean: 18, respRateMin: 17, respRateMax: 19 });
  assert.equal(result.sampleCount, 110); assert.equal(result.bpmMean, 82);
  assert.equal(result.respRateMean, (80 * 12 + 10 * 18) / 90);
  assert.equal(result.respRateMin, 11); assert.equal(result.respRateMax, 19);
});

test('resampling refuses short history, gaps, duplicate times and nonfinite samples', async () => {
  const { RppgEngine } = await library('RppgEngine.js');
  const engine = new RppgEngine();
  const points = Array.from({ length: 601 }, (_, i) => ({ tMs: i * 1000 / 30, x: Math.sin(i / 30) }));
  assert.equal(engine._resampleLinear(points, 0, 20000, 10).length, 200);
  assert.equal(engine._resampleLinear(points.slice(-30), 0, 20000, 10), null);
  assert.equal(engine._resampleLinear([points[0], points.at(-1)], 0, 20000, 10), null);
  assert.equal(engine._resampleLinear(points.filter(p => p.tMs < 9000 || p.tMs > 10000), 0, 20000, 10), null);
  assert.equal(engine._resampleLinear([points[0], points[0], ...points.slice(1)], 0, 20000, 10), null);
  assert.equal(engine._resampleLinear([{ tMs: 0, x: NaN }, ...points.slice(1)], 0, 20000, 10), null);
  const rsa = Array.from({ length: 41 }, (_, i) => ({ tMs: i * 500, x: 80 + Math.sin(i) }));
  assert.equal(engine._resampleLinear(rsa, 0, 20000, 10, 1000).length, 200);
  assert.equal(engine._resampleLinear(rsa, 0, 20000, 10), null);
  assert.equal(engine._resampleLinear(rsa.map(p => ({ ...p, tMs: p.tMs * 1.05 })), 0, 20000, 10, 1000).length, 200);
});

test('ideal respiration sinusoids stay within FFT-bin resolution; invalid input yields no estimate', async () => {
  const { estimateRespirationRate } = await library('signal/respiration.js');
  for (const fs of [6, 10, 20]) for (const rate of [9, 12, 18, 21]) {
    const signal = Array.from({ length: fs * 60 }, (_, i) => Math.sin(2 * Math.PI * rate / 60 * i / fs));
    const result = estimateRespirationRate(signal, fs);
    assert.ok(Math.abs(result.bpm - rate) <= 1.5, `${fs} Hz, ${rate}: ${result.bpm}`);
  }
  assert.equal(estimateRespirationRate(Array(200).fill(1), 10).conf, 0);
  assert.equal(estimateRespirationRate(Array(200).fill(NaN), 10).bpm, null);
  assert.equal(estimateRespirationRate(Array(200).fill(1), NaN).bpm, null);
});

test('ideal and deterministically noisy pulse sweeps at 15/30/60 FPS stay within spectral resolution', async () => {
  const { estimateHeartRate } = await library('signal/spectrum.js');
  for (const fs of [15, 30, 60]) for (let rate = 48; rate <= 168; rate += 4) for (const noise of [0, .15]) {
    const signal = Array.from({ length: fs * 20 }, (_, i) => Math.sin(2 * Math.PI * rate / 60 * i / fs)
      + noise * Math.sin(i * 12.9898 + rate));
    const result = estimateHeartRate(signal, fs, [.7, 3]);
    assert.ok(Math.abs(result.bpm - rate) <= 3, `${fs} FPS, ${rate}: ${result.bpm}`);
  }
  assert.equal(estimateHeartRate(Array(600).fill(NaN), 30, [.7, 3]).bpm, null);
  assert.equal(estimateHeartRate(Array(600).fill(1), 30, [.7, 3]).bpm, null);
});

test('large eye-signal history avoids argument-stack overflow and identifies rolling gaze coverage', async () => {
  const { buildAttentionMetrics } = await load('gaze-tracker/attention-metrics.js');
  const eyeSignals = Array.from({ length: 130000 }, (_, i) => ({ t: 1000 + 33 * i, phase: 'tracking_test',
    earAvg: .3, leftEAR: .3, rightEAR: .3, bothOpen: true }));
  const result = buildAttentionMetrics({ eyeSignals, eyeTracking: [], heatmapState: { summary: { sampleCountTotal: 130000 } } });
  assert.equal(result.sampleCounts.eyeSignals, 130000);
  assert.equal(result.coverage.gaze, 'retained_window');
  assert.equal(result.global.blinkDynamics.blinkCount, 0);
});
