/**
 * Unit tests for proxy metrics v1 contract (no DB).
 * Run: npm test
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildNotComputed,
  rowToProxyMetricsResponse,
  getSchemaDescriptor,
  RESERVED_METRIC_NAMES,
} = require('../proxy_metrics/contract');

describe('proxy_metrics contract', () => {
  it('buildNotComputed returns empty metrics and full missing list', () => {
    const r = buildNotComputed({ session_id: 'S1' });
    assert.equal(r.session_id, 'S1');
    assert.equal(r.status, 'not_computed');
    assert.deepEqual(r.metrics, {});
    assert.equal(r.missing_metrics.length, RESERVED_METRIC_NAMES.length);
    assert.equal(r.error, null);
  });

  it('rowToProxyMetricsResponse maps ingest scalars to partial without fake values', () => {
    const session = { session_id: 'S2', participant_id: 'P1', project_id: 1, protocol_id: 2 };
    const proxy = {
      session_id: 10,
      schema_version: 'proxy_metrics.v1',
      status: 'not_computed',
      metrics: {},
      missing_metrics: [],
      attention_score: 87,
      emotion_valence_mean: 0.12,
      mean_rt_ms: 420,
      omissions_pct: 3.5,
      payload: { qc_score: 72 },
      updated_at: new Date().toISOString(),
    };
    const r = rowToProxyMetricsResponse(session, proxy, null, null);
    assert.equal(r.status, 'partial');
    assert.equal(r.metrics.gaze_on_target_pct.value, 87);
    assert.equal(r.metrics.valence_mean.value, 0.12);
    assert.equal(r.metrics.rt_mean.value, 420);
    assert.ok(r.missing_metrics.includes('gaze_off_count'));
    assert.ok(!r.metrics.gaze_off_count);
  });

  it('schema descriptor documents contract', () => {
    const s = getSchemaDescriptor();
    assert.equal(s.schema_version, 'proxy_metrics.v1');
    assert.ok(s.statuses.includes('not_computed'));
    assert.ok(s.reserved_metric_names.includes('qc_score'));
  });

  it('rowToProxyMetricsResponse reads rt_features from session features payload', () => {
    const session = { session_id: 'S3', participant_id: 'P1', project_id: 1, protocol_id: 2 };
    const proxy = {
      session_id: 30,
      metrics: {},
      mean_rt_ms: null,
      omissions_pct: null,
      updated_at: new Date().toISOString(),
    };
    const features = {
      rt_features: {
        session_metrics: {
          rt_mean: { blocks: { b1: 410 } },
          rt_median: { blocks: { b1: 400 } },
        },
      },
    };
    const r = rowToProxyMetricsResponse(session, proxy, features, null);
    assert.equal(r.metrics.rt_mean.value, 410);
    assert.equal(r.metrics.rt_median.value, 400);
  });
});
