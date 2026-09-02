/**
 * Proxy metrics v1 read contract (adapter only — no calculation).
 */
const SCHEMA_VERSION = 'proxy_metrics.v1';

const STATUSES = Object.freeze(['not_computed', 'partial', 'computed', 'failed']);

const RESERVED_METRIC_NAMES = Object.freeze([
  'gaze_on_target_pct',
  'gaze_off_count',
  'gaze_return_latency_mean',
  'blink_rate',
  'blink_long_frac',
  'valence_mean',
  'arousal_mean',
  'emotion_joy_share',
  'emotion_sadness_share',
  'rt_mean',
  'rt_sd',
  'rt_median',
  'omission_rate',
  'commission_rate',
  'speed_accuracy_index',
  'pose_ok_pct',
  'low_light_time',
  'face_lost_time',
  'face_visible_percent',
  'qc_score',
  'validity_class',
  'bpm_mean',
  'bpm_quality',
  'rppg_sample_count',
  'respiration_rate_mean',
  'respiration_available',
]);

function toFinite(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function metricEntry(value, opts = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const entry = { value };
  if (opts.unit) entry.unit = opts.unit;
  if (opts.confidence != null) entry.confidence = opts.confidence;
  if (opts.quality != null) entry.quality = opts.quality;
  if (opts.source_modalities) entry.source_modalities = opts.source_modalities;
  if (opts.window) entry.window = opts.window;
  if (opts.qc) entry.qc = opts.qc;
  if (opts.meta) entry.meta = opts.meta;
  return entry;
}

function putMetric(metrics, name, value, opts) {
  const entry = metricEntry(value, opts);
  if (entry) metrics[name] = entry;
}

function buildNotComputed(sessionMeta = {}) {
  return {
    session_id: sessionMeta.session_id || null,
    participant_id: sessionMeta.participant_id ?? null,
    project_id: sessionMeta.project_id ?? null,
    protocol_id: sessionMeta.protocol_id ?? null,
    computed_at: null,
    schema_version: SCHEMA_VERSION,
    status: 'not_computed',
    metrics: {},
    missing_metrics: [...RESERVED_METRIC_NAMES],
    error: null,
  };
}

function readJsonObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v;
}

/** Map ingest scalar row + payload into v1 metric entries (only stored values). */
function metricsFromProxyRow(proxyRow) {
  const metrics = {};
  if (!proxyRow) return metrics;

  const storedV1 = readJsonObject(proxyRow.metrics);
  if (Object.keys(storedV1).length > 0) {
    Object.entries(storedV1).forEach(([name, raw]) => {
      if (!raw || typeof raw !== 'object') return;
      if ('value' in raw) {
        putMetric(metrics, name, raw.value, {
          unit: raw.unit,
          confidence: raw.confidence,
          quality: raw.quality,
          source_modalities: raw.source_modalities,
          window: raw.window,
          qc: raw.qc,
          meta: raw.meta,
        });
      }
    });
    return metrics;
  }

  putMetric(metrics, 'gaze_on_target_pct', toFinite(proxyRow.attention_score), {
    unit: '%',
    source_modalities: ['attention', 'gaze'],
  });
  putMetric(metrics, 'valence_mean', toFinite(proxyRow.emotion_valence_mean), {
    source_modalities: ['emotion'],
  });
  putMetric(metrics, 'arousal_mean', toFinite(proxyRow.emotion_arousal_mean), {
    source_modalities: ['emotion'],
  });
  putMetric(metrics, 'rt_mean', toFinite(proxyRow.mean_rt_ms), {
    unit: 'ms',
    source_modalities: ['cognitive'],
  });
  putMetric(metrics, 'omission_rate', toFinite(proxyRow.omissions_pct), {
    unit: '%',
    source_modalities: ['cognitive'],
  });
  putMetric(metrics, 'blink_rate', toFinite(proxyRow.blink_count), {
    source_modalities: ['attention'],
    meta: { note: 'ingest stores blink_count; rate derivation not applied in API' },
  });
  putMetric(metrics, 'bpm_mean', toFinite(proxyRow.bpm_mean), {
    unit: 'bpm',
    source_modalities: ['rppg'],
  });
  putMetric(metrics, 'rppg_sample_count', toFinite(proxyRow.rppg_sample_count), {
    source_modalities: ['rppg'],
  });
  putMetric(metrics, 'respiration_rate_mean', toFinite(proxyRow.respiration_rate_mean), {
    source_modalities: ['respiration'],
  });
  putMetric(metrics, 'respiration_available', proxyRow.respiration_available === true, {
    source_modalities: ['respiration'],
  });

  const payload = readJsonObject(proxyRow.payload);
  if (toFinite(payload.qc_score) != null) {
    putMetric(metrics, 'qc_score', toFinite(payload.qc_score), { source_modalities: ['qc'] });
  }

  return metrics;
}

/** Read-only enrichment from SessionFeatures / QC JSON (no recompute). */
function enrichMetricsFromFeatures(metrics, featuresPayload, qcRow) {
  const p = readJsonObject(featuresPayload);
  const qcPayload = readJsonObject(qcRow && qcRow.payload);
  const qcSummary = readJsonObject(p.qcSummary || qcPayload);

  const emotion = readJsonObject(p.emotion_summary);
  putMetric(metrics, 'valence_mean', metrics.valence_mean?.value ?? toFinite(emotion.valence_mean), {
    unit: metrics.valence_mean?.unit,
    source_modalities: ['emotion'],
  });
  putMetric(metrics, 'arousal_mean', metrics.arousal_mean?.value ?? toFinite(emotion.arousal_mean), {
    source_modalities: ['emotion'],
  });

  const attGlobal = readJsonObject(p.attentionMetrics && p.attentionMetrics.global);
  const gazePct = toFinite(attGlobal.gazeValidPct) ??
    toFinite(attGlobal.gazeOnTargetPct) ??
    toFinite(attGlobal.attentionScore);
  if (gazePct != null && !metrics.gaze_on_target_pct) {
    putMetric(metrics, 'gaze_on_target_pct', gazePct, { unit: '%', source_modalities: ['gaze'] });
  }

  const qcMetrics = readJsonObject(qcSummary.metrics || qcSummary.percentages);
  putMetric(metrics, 'pose_ok_pct', toFinite(qcMetrics.poseOkPct), { unit: '%', source_modalities: ['qc'] });
  putMetric(metrics, 'face_visible_percent', toFinite(qcMetrics.faceVisiblePct), {
    unit: '%',
    source_modalities: ['qc'],
  });
  putMetric(metrics, 'gaze_on_target_pct', metrics.gaze_on_target_pct?.value ?? toFinite(qcMetrics.gazeValidPct), {
    unit: '%',
    source_modalities: ['qc', 'gaze'],
  });

  if (qcRow && qcRow.qc_score != null) {
    putMetric(metrics, 'qc_score', toFinite(qcRow.qc_score), { source_modalities: ['qc'] });
  }
  if (qcRow && qcRow.validity) {
    putMetric(metrics, 'validity_class', String(qcRow.validity), { source_modalities: ['qc'] });
  }

  const failReasons = Array.isArray(qcRow?.fail_reasons) ? qcRow.fail_reasons : [];
  if (failReasons.length) {
    metrics.reason_codes = metricEntry(failReasons.join(';'), {
      source_modalities: ['qc'],
      meta: { codes: failReasons },
    });
  }

  const rtFeatures = readJsonObject(p.rt_features);
  const sessionRt = readJsonObject(rtFeatures.session_metrics);
  Object.entries(sessionRt).forEach(([metricId, data]) => {
    if (!data || typeof data !== 'object') return;
    const blocks = readJsonObject(data.blocks);
    const vals = Object.values(blocks).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length || metrics[metricId]) return;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    putMetric(metrics, metricId, mean, { source_modalities: ['cognitive', 'rt_component'] });
  });
}

function deriveStatus(proxyRow, metrics) {
  if (!proxyRow) return 'not_computed';
  if (proxyRow.status && STATUSES.includes(proxyRow.status)) {
    if (proxyRow.status === 'not_computed' && Object.keys(metrics).length > 0) return 'partial';
    return proxyRow.status;
  }
  if (proxyRow.error) return 'failed';
  const storedV1 = readJsonObject(proxyRow.metrics);
  if (Object.keys(storedV1).length > 0) return 'computed';
  if (Object.keys(metrics).length > 0) return 'partial';
  return 'not_computed';
}

function listMissing(metrics) {
  return RESERVED_METRIC_NAMES.filter((name) => !metrics[name]);
}

function rowToProxyMetricsResponse(sessionRow, proxyRow, featuresPayload, qcRow) {
  const sessionMeta = {
    session_id: sessionRow.session_id,
    participant_id: sessionRow.participant_id,
    project_id: sessionRow.project_id,
    protocol_id: sessionRow.protocol_id,
  };

  if (!proxyRow) {
    return buildNotComputed(sessionMeta);
  }

  const metrics = metricsFromProxyRow(proxyRow);
  enrichMetricsFromFeatures(metrics, featuresPayload, qcRow);

  const status = deriveStatus(proxyRow, metrics);
  const missing = Array.isArray(proxyRow.missing_metrics) && proxyRow.missing_metrics.length
    ? proxyRow.missing_metrics
    : listMissing(metrics);

  return {
    session_id: sessionMeta.session_id,
    participant_id: proxyRow.participant_id ?? sessionMeta.participant_id ?? null,
    project_id: proxyRow.project_id ?? sessionMeta.project_id ?? null,
    protocol_id: proxyRow.protocol_id ?? sessionMeta.protocol_id ?? null,
    computed_at: proxyRow.computed_at || proxyRow.updated_at || null,
    schema_version: proxyRow.schema_version || SCHEMA_VERSION,
    status,
    metrics,
    missing_metrics: missing,
    error: proxyRow.error || null,
  };
}

function getSchemaDescriptor() {
  return {
    schema_version: SCHEMA_VERSION,
    statuses: [...STATUSES],
    reserved_metric_names: [...RESERVED_METRIC_NAMES],
    metric_value_shape: {
      value: 'number | string | boolean | null',
      unit: 'optional string',
      confidence: 'optional number 0..1',
      quality: 'optional number',
      source_modalities: 'optional string[]',
      window: 'optional { start_ms, end_ms, block_id }',
      qc: 'optional { valid, reason_codes[] }',
      meta: 'optional object',
    },
    fallback_when_missing_row: buildNotComputed({ session_id: '<session_id>' }),
    notes: [
      'Read-only API; ingest continues to write scalar session_proxy_metrics columns.',
      'status=partial when only ingest scalars/features are mapped; computed when metrics JSONB is populated by a future calculator.',
      'No synthetic metric values are generated by the API.',
    ],
  };
}

module.exports = {
  SCHEMA_VERSION,
  STATUSES,
  RESERVED_METRIC_NAMES,
  buildNotComputed,
  rowToProxyMetricsResponse,
  getSchemaDescriptor,
  listMissing,
  metricsFromProxyRow,
};
