/**
 * Invokes rt_component analyzer (Python) and projects results to platform metric IDs.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const {
  RT_METRICS,
  getMetricValueFromAnalyzer,
  mapWebTaskToAnalyzer,
  resolveSelectedMetrics,
} = require('../../shared/rt-registry');
const { eventsToRtJsonl } = require('./event_adapter');

const PYTHON = process.env.RT_PYTHON || 'python';
const ANALYZE_SCRIPT = path.resolve(__dirname, '../../../rt_component-/scripts/analyze_events_json.py');
const CONFIG_PATH = path.resolve(__dirname, '../../../rt_component-/examples/config_default.json');

function pythonAvailable() {
  try {
    const r = spawnSync(PYTHON, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0;
  } catch (_) {
    return false;
  }
}

/** Health probe for ops/CI — does not run a full analysis. */
function getRtAnalyzerHealth() {
  const scriptExists = fs.existsSync(ANALYZE_SCRIPT);
  const configExists = fs.existsSync(CONFIG_PATH);
  let pythonVersion = null;
  let pythonOk = false;
  if (pythonAvailable()) {
    const r = spawnSync(PYTHON, ['--version'], { encoding: 'utf8', timeout: 5000 });
    pythonOk = r.status === 0;
    pythonVersion = (r.stdout || r.stderr || '').trim() || null;
  }
  const available = pythonOk && scriptExists && configExists;
  return {
    available,
    python: PYTHON,
    python_version: pythonVersion,
    script_path: ANALYZE_SCRIPT,
    script_exists: scriptExists,
    config_path: CONFIG_PATH,
    config_exists: configExists,
    reason: available
      ? null
      : [
        !pythonOk ? 'python_not_found' : null,
        !scriptExists ? 'analyzer_script_missing' : null,
        !configExists ? 'config_missing' : null,
      ].filter(Boolean).join(';'),
  };
}

function runAnalyzer(events, analyzerTask) {
  if (!fs.existsSync(ANALYZE_SCRIPT)) {
    return { ok: false, error: 'analyzer_script_missing', metrics: null };
  }
  const stdin = JSON.stringify({
    events,
    task: analyzerTask,
    config_path: fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : null,
  });
  const r = spawnSync(PYTHON, [ANALYZE_SCRIPT], {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60000,
  });
  if (r.error) return { ok: false, error: String(r.error), metrics: null };
  if (r.status !== 0) {
    return { ok: false, error: (r.stderr || r.stdout || 'analyzer_failed').trim(), metrics: null };
  }
  try {
    const parsed = JSON.parse(r.stdout);
    return { ok: true, metrics: parsed.metrics, meta: parsed.meta, n_trials: parsed.n_trials };
  } catch (e) {
    return { ok: false, error: 'analyzer_json_parse_failed', metrics: null };
  }
}

function deriveRtOutlierFrac(analyzerMetrics) {
  const nValid = analyzerMetrics?.rt?.n_valid;
  const total = analyzerMetrics?.counts?.total_trials;
  if (!Number.isFinite(nValid) || !Number.isFinite(total) || total <= 0) return null;
  const invalidRt = total - nValid;
  return invalidRt / total;
}

function projectMetric(metricId, analyzerMetrics) {
  if (metricId === 'rt_outlier_frac') {
    const v = deriveRtOutlierFrac(analyzerMetrics);
    return v == null ? { value: null, reason: 'insufficient_data' } : { value: v };
  }
  const raw = getMetricValueFromAnalyzer(analyzerMetrics, metricId);
  if (raw == null) return { value: null, reason: 'insufficient_data' };
  const def = RT_METRICS[metricId];
  let value = raw;
  if (def && def.to_proxy_percent && def.unit === 'ratio') {
    value = raw * 100;
  }
  return { value };
}

function computeBlockRtFeatures(blockCtx, sessionEvents, cognitiveResults) {
  const taskType = blockCtx?.taskType || 'other';
  const selected = resolveSelectedMetrics(taskType, blockCtx?.selectedMetrics);
  const { events, analyzerTask } = eventsToRtJsonl(sessionEvents, cognitiveResults, blockCtx);

  if (!events.length) {
    return {
      block_id: blockCtx?.blockId ?? null,
      rt_task: taskType,
      analyzer_task: analyzerTask,
      selected_metrics: selected,
      computed_metrics: {},
      status: 'no_events',
    };
  }

  const run = runAnalyzer(events, analyzerTask);
  if (!run.ok) {
    return {
      block_id: blockCtx?.blockId ?? null,
      rt_task: taskType,
      analyzer_task: analyzerTask,
      selected_metrics: selected,
      computed_metrics: {},
      status: 'analyzer_unavailable',
      error: run.error,
    };
  }

  const computed_metrics = {};
  for (const metricId of selected) {
    computed_metrics[metricId] = projectMetric(metricId, run.metrics);
  }

  return {
    block_id: blockCtx?.blockId ?? null,
    rt_task: taskType,
    analyzer_task: analyzerTask,
    selected_metrics: selected,
    computed_metrics,
    analyzer_meta: run.meta,
    status: 'ok',
  };
}

function extractProtocolBlocks(definition) {
  if (!definition || typeof definition !== 'object') return [];
  const blocks = Array.isArray(definition.blocks) ? definition.blocks : [];
  return blocks.filter((b) => {
    const t = String(b?.type || '').toLowerCase();
    return t === 'cognitive_task' || t === 'stimuli';
  });
}

function computeSessionRtFeatures(payload, protocolDefinition) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const cognitiveResults = Array.isArray(payload?.cognitiveResults) ? payload.cognitiveResults : [];
  const protocolBlocks = extractProtocolBlocks(protocolDefinition);

  const blockFeatures = [];
  const byBlockId = new Map();

  if (protocolBlocks.length) {
    protocolBlocks.forEach((pb, idx) => {
      const blockId = pb.id || `block_${idx + 1}`;
      const cfg = pb.blockConfig || {};
      const taskType = pb.taskType || cfg.taskType || 'other';
      const rows = cognitiveResults.filter((r) => String(r?.blockId ?? r?.block) === String(blockId));
      const feat = computeBlockRtFeatures(
        {
          blockId,
          taskType,
          selectedMetrics: cfg.selected_metrics || pb.selected_metrics,
          rtWindowMs: cfg.rtWindow || cfg.rt_window || 2500,
          sessionId: payload?.ids?.session,
        },
        events,
        rows.length ? rows : cognitiveResults,
      );
      blockFeatures.push(feat);
      byBlockId.set(String(blockId), feat);
    });
  } else if (cognitiveResults.length) {
    const byId = new Map();
    cognitiveResults.forEach((r) => {
      const bid = String(r?.blockId ?? r?.block ?? 'default');
      if (!byId.has(bid)) byId.set(bid, []);
      byId.get(bid).push(r);
    });
    for (const [blockId, rows] of byId.entries()) {
      const feat = computeBlockRtFeatures(
        {
          blockId,
          taskType: 'other',
          selectedMetrics: null,
          rtWindowMs: 2500,
          sessionId: payload?.ids?.session,
        },
        events,
        rows,
      );
      blockFeatures.push(feat);
      byBlockId.set(blockId, feat);
    }
  }

  const session_metrics = {};
  for (const bf of blockFeatures) {
    if (!bf.computed_metrics) continue;
    for (const [metricId, entry] of Object.entries(bf.computed_metrics)) {
      if (!session_metrics[metricId]) session_metrics[metricId] = { value: null, blocks: {} };
      if (entry && entry.value != null) {
        session_metrics[metricId].blocks[bf.block_id] = entry.value;
      }
    }
  }

  return {
    schema_version: 'rt_features.v1',
    blocks: blockFeatures,
    session_metrics,
    python_available: pythonAvailable(),
  };
}

function mergeRtIntoProxyScalars(proxy, rtFeatures) {
  if (!rtFeatures || !rtFeatures.session_metrics) return proxy;
  const sm = rtFeatures.session_metrics;
  const meanBlockValues = (metricId) => {
    const b = sm[metricId]?.blocks;
    if (!b || typeof b !== 'object') return null;
    const vals = Object.values(b).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length) return null;
    return vals.reduce((a, c) => a + c, 0) / vals.length;
  };

  const rtMean = meanBlockValues('rt_mean');
  if (rtMean != null && proxy.mean_rt_ms == null) proxy.mean_rt_ms = Math.round(rtMean * 100) / 100;

  const omission = meanBlockValues('omission_rate');
  if (omission != null && proxy.omissions_pct == null) {
    const pct = omission <= 1 ? omission * 100 : omission;
    proxy.omissions_pct = Math.round(pct * 100) / 100;
  }

  return proxy;
}

function buildProxyMetricsJson(rtFeatures) {
  const metrics = {};
  if (!rtFeatures?.session_metrics) return metrics;
  for (const [metricId, data] of Object.entries(rtFeatures.session_metrics)) {
    const vals = data?.blocks ? Object.values(data.blocks) : [];
    const finite = vals.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!finite.length) continue;
    const value = finite.reduce((a, b) => a + b, 0) / finite.length;
    const def = RT_METRICS[metricId];
    metrics[metricId] = {
      value: Math.round(value * 1000) / 1000,
      unit: def?.unit === 'ms' ? 'ms' : (def?.unit === 'ratio' ? '%' : def?.unit),
      source_modalities: ['cognitive', 'rt_component'],
    };
  }
  return metrics;
}

module.exports = {
  computeSessionRtFeatures,
  computeBlockRtFeatures,
  mergeRtIntoProxyScalars,
  buildProxyMetricsJson,
  pythonAvailable,
  getRtAnalyzerHealth,
  mapWebTaskToAnalyzer,
  ANALYZE_SCRIPT,
  CONFIG_PATH,
};
