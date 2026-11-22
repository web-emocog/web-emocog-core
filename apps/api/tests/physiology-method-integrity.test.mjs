import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MotionRespirationEstimator, resampleWindow } from '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/signal/respiration-motion.js';
import { combineSignalSummaries } from '../../participant-web/js/session-runtime/signal-history.mjs';

const require = createRequire(import.meta.url);
const { measurement } = require('../../shared/passive-metrics');
const { buildGroupSummary, buildSessionMetrics } = require('../analytics/metrics');
const { buildDescriptiveComparison } = require('../analytics/comparisons');
const { buildFeatureReport } = require('../analytics/extended-features');
const { intervalData, intervalExportRows } = require('../analytics/passive');
const LUMA = 'respiration_luma.log_peak.v2', MOTION = 'respiration_motion.consensus.v1';
const query = { metricIds: ['physiology.respiration_mean'], filters: { qcChannels: [] } };
const row = (id, method, value) => ({ id, session_id: `s${id}`, participant_id: `p${id}`, features_payload: {
  respiration_summary: { resp_available: true, resp_sample_count: 20, resp_rate_mean: value, methodVersion: method }
} });

test('motion windows reject a stale tail instead of filling seconds without measurements', () => {
  const points = Array.from({ length: 201 }, (_, i) => ({ t: i * 100, v: Math.sin(i / 10) }));
  const config = { windowSec: 20, fs: 10, maxGapMs: 1500 };
  assert.ok(resampleWindow(points, 20000, config));
  assert.equal(resampleWindow(points.slice(0, 191), 19000, config), null);
  assert.equal(resampleWindow(points, 25000, config), null);
  assert.equal(resampleWindow(points, 30000, config), null);
});

test('lost shoulders stop voting while current face measurements continue', () => {
  const estimator = new MotionRespirationEstimator();
  const image = { width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4).fill(160) };
  let before, after;
  for (let i = 0; i <= 900; i++) {
    const t = i * 1000 / 30, breath = Math.sin(2 * Math.PI * .2 * t / 1000);
    const face = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
    face[10] = { x: .5, y: .3 }; face[152] = { x: .5, y: .7 }; face[1] = { x: .5, y: .52 };
    face[33] = { x: .42, y: .45 }; face[263] = { x: .58, y: .45 };
    for (const index of [6, 168, 197, 195]) face[index] = { x: .5, y: .47 + .003 * breath };
    estimator.pushFace(t, face, image, image.width, image.height);
    if (t <= 20000) estimator.pushShoulders(t, { x: .3, y: .8 + .004 * breath }, { x: .7, y: .8 + .004 * breath });
    after = estimator.estimate(t);
    if (i === 600) before = after;
  }
  assert.equal(before.published, true);
  assert.equal(after.published, false);
  assert.equal(after.votes.third, null);
  assert.ok(after.agreeing < 2);
});

test('different physiology methods cannot produce a pooled group mean or interval', () => {
  const rows = [row(1, LUMA, 22), row(2, MOTION, 12)], before = structuredClone(rows);
  const [mixed] = buildGroupSummary(rows, query).metrics;
  assert.equal(mixed.mean, null); assert.equal(mixed.median, null);
  assert.equal(mixed.status, 'no_data'); assert.equal(mixed.reason, 'physiology_methods_mixed');
  assert.equal(mixed.estimateCi95.value, null); assert.equal(mixed.estimateCi95.lower, null);
  assert.equal(mixed.estimateCi95.upper, null);
  assert.deepEqual(rows, before);
  rows[0].features_payload.respiration_summary.methodVersion = MOTION;
  assert.equal(buildGroupSummary(rows, query).metrics[0].mean, 17);
  rows[0].features_payload.respiration_summary = { resp_sample_count: 0, resp_rate_mean: null, methodVersion: 'mixed_methods' };
  assert.equal(buildGroupSummary(rows, query).metrics[0].mean, 12);
});

test('mixed resumed summaries retain provenance and counts but not a fabricated average', () => {
  const old = { sampleCount: 10, validSampleCount: 5, bpmMean: 70, methodVersion: 'continuous_signals.v2',
    validRespSampleCount: 5, respRateMean: 22, respMethodVersion: LUMA };
  const current = { sampleCount: 10, validSampleCount: 5, bpmMean: 90, methodVersion: 'continuous_signals.v2.chrom',
    validRespSampleCount: 5, respRateMean: 12, respMethodVersion: MOTION };
  const combined = combineSignalSummaries(old, current);
  assert.equal(combined.validRespSampleCount, 10); assert.equal(combined.validSampleCount, 10);
  assert.equal(combined.bpmMean, null); assert.equal(combined.respRateMean, null);
  assert.match(combined.methodVersion, /mixed/); assert.match(combined.respMethodVersion, /mixed/);
  const packet = { respiration_summary: { resp_rate_mean: 17, resp_sample_count: 10, methodVersion: combined.respMethodVersion } };
  assert.equal(measurement(packet, 'physiology.respiration_mean').value, null);
});

test('a block selection cannot hide mixed method provenance in an accepted interval', () => {
  const source = row(1, MOTION, 12);
  source.features_payload.physiology_intervals = { schemaVersion: 'physiology_intervals.v1', minutes: [], blocks: [
    { blockId: 'b', status: 'accepted', startMs: 0, endMs: 60000,
      respiration: { mean: 17, count: 10, observedMs: 10000, methodVersion: 'mixed_methods' } }
  ] };
  const [metric] = buildSessionMetrics(source, { ...query, filters: { blockIds: ['b'] } });
  assert.equal(metric.value, null); assert.equal(metric.reason, 'physiology_methods_mixed');
  const intervals = intervalData(source, { filters: {} });
  assert.equal(intervals.blocks[0].respiration.mean, null);
  assert.equal(intervals.blocks[0].respiration.methodVersion, 'mixed_methods');
  const [exported] = intervalExportRows(intervals, query.metricIds, {});
  assert.equal(exported.value, null); assert.equal(exported.reason, 'physiology_methods_mixed');
  assert.equal(source.features_payload.physiology_intervals.blocks[0].respiration.mean, 17);
});

test('custom physiology comparisons abstain across methods and still work within one method', () => {
  const rows = [row(1, LUMA, 22), row(2, MOTION, 12)];
  const spec = { design: 'independent', metricId: 'physiology.respiration_mean', referenceParticipantIds: ['p1'], comparisonParticipantIds: ['p2'] };
  let result = buildDescriptiveComparison(rows, { comparison: spec });
  assert.equal(result.effect, null); assert.equal(result.reason, 'physiology_methods_mixed');
  rows[0].features_payload.respiration_summary.methodVersion = MOTION;
  result = buildDescriptiveComparison(rows, { comparison: spec });
  assert.equal(result.effect, -10); assert.equal(result.readiness, 'available');
});

test('extended physiology features do not pool methods into models or distribution cards', () => {
  const report = buildFeatureReport([row(1, LUMA, 22), row(2, MOTION, 12)]);
  const values = report.featureRows.filter(item => item.metricId.startsWith('physiology.'));
  assert.ok(values.length > 0);
  assert.ok(values.every(item => item.value === null));
  assert.ok(report.availability.limitations.some(message => message.includes('разных методов')));
});
