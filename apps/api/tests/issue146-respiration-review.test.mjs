import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { estimateRespirationRate, RESPIRATION_METHOD_VERSION } from '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/signal/respiration.js';
import { combineSignalSummaries } from '../../participant-web/js/session-runtime/signal-history.mjs';
import { buildAggregatesPayload } from '../../participant-web/js/unified-aggregates-new.js';
import { ContinuousBpmCollector } from '../../participant-web/js/session-runtime/continuous-bpm.js';

const require = createRequire(import.meta.url);
const { measurement, definitions } = require('../../shared/passive-metrics');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const { buildExportBundle } = require('../analytics/metrics');
const { exportCsv } = require('../analytics/v1-router');
const { METRIC_CATALOG } = require('../analytics/query');
const wave = (rate, fs, seconds, phase = 0) => Array.from({ length: fs * seconds },
  (_, i) => Math.sin(2 * Math.PI * rate / 60 * i / fs + phase));

test('20 s and 60 s off-bin synthetic sweeps reduce quantization without claiming extra spectral resolution', () => {
  for (const seconds of [20, 60]) {
    let absoluteError = 0, count = 0;
    for (const fs of [6, 10, 20]) for (let rate = 7; rate <= 23; rate += .25) for (const phase of [0, .7, 2]) {
      const result = estimateRespirationRate(wave(rate, fs, seconds, phase), fs);
      const error = Math.abs(result.bpm - rate);
      assert.ok(error < (seconds === 20 ? .44 : .009), `${seconds} s, ${fs} Hz, ${rate}, phase ${phase}: ${result.bpm}`);
      absoluteError += error; count++;
    }
    assert.equal(count, 585);
    assert.ok(absoluteError / count < (seconds === 20 ? .065 : .0025));
  }
});

test('peak refinement preserves the old confidence, peak ratio and SNR on fixed synthetic inputs', () => {
  const expected = [
    [9, .3836291193497216, 1.5609056651914996, 8.323242057834525],
    [12, .5804435107954778, 1.8633932613647437, 8.29738731200498],
    [18, .1559382136167748, 1.271687034080634, 7.874556537594267],
    [21, .6740122837934805, 2.027109841939062, 8.75691238791859],
  ];
  for (const [rate, conf, ratio, snr] of expected) {
    const result = estimateRespirationRate(wave(rate, 10, 20), 10);
    for (const [actual, baseline] of [[result.conf, conf], [result.peakRatio, ratio], [result.snrDb, snr]]) {
      assert.ok(Math.abs(actual - baseline) < 1e-12);
    }
  }
});

test('stationary synthetic respiration remains bounded with deterministic broadband noise', () => {
  for (const fs of [6, 10, 20]) for (const rate of [9, 12, 18, 21]) for (const seconds of [20, 60]) {
    let seed = 1234;
    const signal = wave(rate, fs, seconds).map(value => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return value + .3 * (2 * seed / 2 ** 32 - 1);
    });
    const result = estimateRespirationRate(signal, fs);
    assert.ok(Math.abs(result.bpm - rate) < .15, `${fs} Hz, ${seconds} s, ${rate}: ${result.bpm}`);
    assert.ok(result.conf >= 0 && result.conf <= 1);
  }
});

test('flat, corrupt, short and invalid-band inputs do not create publishable breathing', () => {
  for (const signal of [Array(200).fill(0), Array(200).fill(42)]) {
    assert.equal(estimateRespirationRate(signal, 10).conf, 0);
  }
  for (const signal of [[], [1, 2], Array(200).fill(NaN), Array(200).fill(Infinity)]) {
    assert.equal(estimateRespirationRate(signal, 10).bpm, null);
  }
  for (const band of [[0, .4], [.4, .1], [.1, 5]]) assert.equal(estimateRespirationRate(wave(12, 10, 20), 10, band).bpm, null);
  for (const rate of [6, 6.1, 23.9, 24]) for (const phase of [0, 2]) {
    const result = estimateRespirationRate(wave(rate, 10, 20, phase), 10);
    assert.ok(result.bpm >= 6 && result.bpm <= 24);
  }
});

test('brightness alone can still generate a confident peak: interpolation is not an artifact detector', () => {
  const lumaOnly = wave(9, 10, 20).map(x => 128 + 10 * x);
  const result = estimateRespirationRate(lumaOnly, 10);
  assert.ok(result.conf > .20);
  assert.ok(Math.abs(result.bpm - 9) < .1);
  const definition = definitions.find(item => item.id === 'physiology.respiration_mean');
  assert.match(definition.description.en, /illumination/);
});

test('respiration uses its own method, including legacy and mixed-version recovery, not the HR version', () => {
  const summary = { validRespSampleCount: 2, respRateMean: 12, respRateMin: 12, respRateMax: 12,
    sampleCount: 2, validSampleCount: 2, bpmMean: 80, methodVersion: 'continuous_signals.v2', respMethodVersion: RESPIRATION_METHOD_VERSION };
  const old = { ...summary }; delete old.respMethodVersion;
  for (const [previous, current, method] of [
    [{}, summary, RESPIRATION_METHOD_VERSION], [summary, summary, RESPIRATION_METHOD_VERSION],
    [old, summary, 'respiration_luma.mixed_versions'], [old, { ...summary, validRespSampleCount: 0 }, 'legacy_summary'],
  ]) {
    const combined = combineSignalSummaries(previous, current);
    assert.equal(combined.respMethodVersion, method);
    const packet = buildAggregatesPayload({ ids: { session: 'synthetic-resp-method' }, continuousSignalState: combined,
      lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed',
        finishAttemptId: 'synthetic-finish', completedAt: 2000 } }, { forIngest: true });
    assert.deepEqual(validateSessionFeaturePayload(packet), []);
    assert.equal(packet.respiration_summary.methodVersion, method);
    assert.equal(measurement(packet, 'physiology.respiration_mean').methodVersion, method);
    assert.equal(packet.bpm_summary.methodVersion, 'continuous_signals.v2');
    const suitability = packet.quality_assessment.suitability.find(item => item.channel === 'respiration');
    assert.ok(suitability.reasons.includes('respiration_lighting_confound_unchecked'));
  }
  assert.equal(measurement({ respiration_summary: { resp_rate_mean: 12, resp_sample_count: 2 },
    bpm_summary: { methodVersion: 'not-the-respiration-method' } }, 'physiology.respiration_mean').methodVersion, 'legacy_summary');
});

test('collector snapshots and terminal output preserve the engine respiratory method', () => {
  const collector = new ContinuousBpmCollector();
  Object.assign(collector, { ready: true, canvas: {}, context: {}, engine: { update: () => ({
    bpm: null, confidence: 0, features: { respRate: 12, respConf: .8, respPublished: true, respMethodVersion: RESPIRATION_METHOD_VERSION },
  }) } });
  collector.process(null, Array.from({ length: 478 }, () => ({ x: .5, y: .5 })), 100,
    { width: 2, height: 2, data: new Uint8ClampedArray(16) }, 1800000000000);
  assert.equal(collector.snapshot().respMethodVersion, RESPIRATION_METHOD_VERSION);
  assert.equal(collector.snapshot().validRespSampleCount, 1);
  assert.equal(collector.snapshot().validSampleCount, 0);
  assert.equal(collector.finalize().respMethodVersion, RESPIRATION_METHOD_VERSION);
});

test('developer and participant load the same version of the signal pipeline and profile', () => {
  const source = file => readFileSync(new URL(file, import.meta.url), 'utf8');
  const diagnostic = source('../../web/developer/protocol-diagnostic.mjs');
  const runtime = source('../../participant-web/js/session-runtime/index.js');
  const pipeline = source('../../participant-web/js/session-runtime/frame-pipeline.js');
  for (const [name, other] of [['frame-pipeline.js', runtime], ['protocol-profile.mjs', pipeline], ['feature-flags.mjs', runtime]]) {
    const version = text => text.match(new RegExp(name.replaceAll('.', '\\.') + "\\?v=([^'\"]+)"))?.[1];
    assert.ok(version(diagnostic), name);
    assert.equal(version(diagnostic), version(other), name);
  }
});

test('analytics export retains the respiratory method and lighting limitation without rewriting old data', () => {
  const features_payload = { respiration_summary: { resp_rate_mean: 12, resp_sample_count: 2,
    resp_available: true, methodVersion: RESPIRATION_METHOD_VERSION } };
  const saved = structuredClone(features_payload);
  const snapshot = { id: 'synthetic-snap', datasetHash: 'synthetic-hash',
    queryEcho: { mode: 'session', metricIds: ['physiology.respiration_mean'], filters: {} }, versions: {},
    includedParticipantIds: ['synthetic'], includedSessionIds: [1] };
  const bundle = buildExportBundle({ snapshot, sessionRows: [{ id: 1, participant_id: 'synthetic', features_payload }],
    protocol: { definition: { blocks: [] } } }, 'both');
  assert.equal(bundle.longData[0].algorithm.version, RESPIRATION_METHOD_VERSION);
  assert.match(bundle.dataDictionary[0].description.en, /illumination/);
  assert.match(exportCsv(bundle), /illumination/);
  assert.match(exportCsv(bundle), /respiration_luma\.log_peak\.v2/);
  assert.deepEqual(METRIC_CATALOG.metrics.find(item => item.id === 'physiology.respiration_mean').description,
    definitions.find(item => item.id === 'physiology.respiration_mean').description);
  assert.deepEqual(features_payload, saved);
});
