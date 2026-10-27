/**
 * Invokes rt_component analyzer (Python) and projects results to platform metric IDs.
 */
const { runNativeProcess } = require('../security/native-process');
const { RtScheduler, RtAnalysisError } = require('./scheduler');
const path = require('path');
const fs = require('fs');
const {
  RT_METRICS,
  getMetricValueFromAnalyzer,
  mapWebTaskToAnalyzer,
  resolveSelectedMetrics,
} = require('../../shared/rt-registry');
const { eventsToRtJsonl } = require('./event_adapter');

const ANALYZE_SCRIPT = path.resolve(__dirname, '../../../rt_component-/scripts/analyze_events_json.py');
const CONFIG_PATH = path.resolve(__dirname, '../../../rt_component-/examples/config_default.json');

function getPythonBin() {
  return process.env.RT_PYTHON || 'python3';
}

const scheduler = new RtScheduler();
const MAX_BYTES = 10 * 1024 * 1024;
let healthCache = null;

/** One bounded, single-flight Python probe per interpreter every 30 seconds. */
async function getRtAnalyzerHealth() {
  const python = getPythonBin();
  if (healthCache?.python === python && healthCache.expires > Date.now()) {
    return { ...await healthCache.promise };
  }
  const entry = { python, expires: Infinity };
  entry.promise = (async () => {
    const scriptExists = await fs.promises.access(ANALYZE_SCRIPT).then(() => true, () => false);
    const configExists = await fs.promises.access(CONFIG_PATH).then(() => true, () => false);
    let pythonVersion = null;
    let pythonOk = false;
    try {
      const result = await runNativeProcess(python, ['--version'], { timeoutMs: 2000, maxOutputBytes: 1024 });
      const version = (result.stdout || result.stderr).trim();
      pythonOk = /^Python \d+\.\d+(?:\.\d+)?[^\r\n]*$/.test(version);
      // Do not reflect arbitrary native stdout (paths, secrets) in a public probe.
      pythonVersion = pythonOk ? version.match(/^Python \d+\.\d+(?:\.\d+)?/)[0] : null;
    } catch (_) { /* Fixed health reasons below, never native stderr. */ }
    const available = pythonOk && scriptExists && configExists;
    return { available, python: path.basename(python), python_version: pythonVersion,
      script_path: path.basename(ANALYZE_SCRIPT), script_exists: scriptExists,
      config_path: path.basename(CONFIG_PATH), config_exists: configExists,
      reason: available ? null : [!pythonOk ? 'python_not_found' : null,
        !scriptExists ? 'analyzer_script_missing' : null,
        !configExists ? 'config_missing' : null].filter(Boolean).join(';') };
  })().finally(() => { entry.expires = Date.now() + 30_000; });
  healthCache = entry;
  return { ...await entry.promise };
}

async function pythonAvailable() {
  return (await getRtAnalyzerHealth()).available;
}

async function runAnalyzerBatch(jobs, python, { signal, remainingMs }) {
  if (!await fs.promises.access(ANALYZE_SCRIPT).then(() => true, () => false)) {
    return { error: 'analyzer_script_missing' };
  }
  const input = JSON.stringify({ jobs, config_path: CONFIG_PATH });
  if (Buffer.byteLength(input) > MAX_BYTES) throw new RtAnalysisError('input_limit');
  let output;
  try {
    output = await runNativeProcess(python, [ANALYZE_SCRIPT], { input,
      maxInputBytes: MAX_BYTES, maxOutputBytes: MAX_BYTES,
      timeoutMs: remainingMs(), signal, resourceLimits: true });
  } catch (error) {
    if (error.code === 'unavailable') return { error: 'analyzer_unavailable' };
    throw new RtAnalysisError(['timeout', 'cancelled', 'output_limit'].includes(error.code) ? error.code : 'failed');
  }
  try {
    const parsed = JSON.parse(output.stdout);
    if (!Array.isArray(parsed.jobs) || parsed.jobs.length !== jobs.length || parsed.jobs.some(job =>
      !job || !job.metrics || typeof job.metrics !== 'object' || Array.isArray(job.metrics)
      || !Number.isSafeInteger(job.n_trials) || job.n_trials < 0)) throw new Error('shape');
    return { jobs: parsed.jobs };
  } catch (_) {
    throw new RtAnalysisError('invalid_output');
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
  if (Number.isFinite(value)) {
    value = Math.round(value * 1e6) / 1e6;
  }
  return { value };
}

function prepareBlock(blockCtx, sessionEvents, cognitiveResults) {
  const taskType = blockCtx?.taskType || 'other';
  const selected = resolveSelectedMetrics(taskType, blockCtx?.selectedMetrics);
  const { events, analyzerTask } = eventsToRtJsonl(sessionEvents, cognitiveResults, blockCtx);
  return { events, analyzerTask, feature: {
    block_id: blockCtx?.blockId ?? null, rt_task: taskType, analyzer_task: analyzerTask,
    selected_metrics: selected, computed_metrics: {}, status: events.length ? 'pending' : 'no_events',
  } };
}

function finishBlock(prepared, run, error) {
  const feature = prepared.feature;
  if (!prepared.events.length) return feature;
  if (error) return { ...feature, status: 'analyzer_unavailable', error };
  const computed_metrics = {};
  for (const metricId of feature.selected_metrics) computed_metrics[metricId] = projectMetric(metricId, run.metrics);
  return { ...feature, computed_metrics, analyzer_meta: run.meta, status: 'ok' };
}

async function computeBlockRtFeatures(blockCtx, sessionEvents, cognitiveResults, options = {}) {
  const python = getPythonBin();
  return scheduler.run(async context => {
    const prepared = prepareBlock(blockCtx, sessionEvents, cognitiveResults);
    if (!prepared.events.length) return prepared.feature;
    const run = await runAnalyzerBatch([{ events: prepared.events, task: prepared.analyzerTask }], python, context);
    return finishBlock(prepared, run.jobs?.[0], run.error);
  }, options);
}

function extractProtocolBlocks(definition) {
  if (!definition || typeof definition !== 'object') return [];
  const blocks = Array.isArray(definition.blocks) ? definition.blocks : [];
  return blocks.filter((b) => {
    const t = String(b?.type || '').toLowerCase();
    return t === 'cognitive_task' || t === 'stimuli';
  });
}

async function computeSessionRtFeatures(payload, protocolDefinition, options = {}) {
  const python = getPythonBin();
  return scheduler.run(async context => {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const cognitiveResults = Array.isArray(payload?.cognitiveResults) ? payload.cognitiveResults : [];
    const protocolBlocks = extractProtocolBlocks(protocolDefinition);
    const prepared = [];
    let inputBytes = Buffer.byteLength(JSON.stringify({ jobs: [], config_path: CONFIG_PATH }));
    const append = block => {
      if (block.events.length) {
        inputBytes += Buffer.byteLength(JSON.stringify({ events: block.events, task: block.analyzerTask })) + 1;
        if (inputBytes > MAX_BYTES) throw new RtAnalysisError('input_limit');
      }
      prepared.push(block);
    };
    const rowsByBlock = new Map();
    const eventsByBlock = new Map();
    const unscopedRows = cognitiveResults.filter(row => row && row.blockId == null && row.block == null);
    for (const [rows, index] of [[cognitiveResults, rowsByBlock], [events, eventsByBlock]]) {
      for (const row of rows) {
        const id = String(index === rowsByBlock ? row?.blockId ?? row?.block : row?.blockId);
        if (!index.has(id)) index.set(id, []);
        index.get(id).push(row);
      }
    }
    if (protocolBlocks.length) {
      for (const [idx, pb] of protocolBlocks.entries()) {
        if (idx % 8 === 0) {
          await new Promise(resolve => setImmediate(resolve));
          if (context.signal.aborted) throw new RtAnalysisError('cancelled');
        }
        const blockId = pb.id || ('block_' + (idx + 1));
        const cfg = pb.blockConfig || {};
        const rows = rowsByBlock.get(String(blockId))
          || (protocolBlocks.length === 1 ? unscopedRows : []);
        append(prepareBlock({ blockId, taskType: pb.taskType || cfg.taskType || 'other',
          selectedMetrics: cfg.selected_metrics || pb.selected_metrics,
          rtWindowMs: cfg.rtWindow || cfg.rt_window || 2500, sessionId: payload?.ids?.session },
        eventsByBlock.get(String(blockId)) || [], rows));
      }
    } else if (cognitiveResults.length) {
      const byId = new Map();
      for (const row of cognitiveResults) {
        const id = String(row?.blockId ?? row?.block ?? 'default');
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(row);
      }
      for (const [blockId, rows] of byId) {
        await new Promise(resolve => setImmediate(resolve));
        if (context.signal.aborted) throw new RtAnalysisError('cancelled');
        append(prepareBlock({ blockId, taskType: 'other', selectedMetrics: null,
          rtWindowMs: 2500, sessionId: payload?.ids?.session }, events, rows));
      }
    }
    const jobs = prepared.filter(block => block.events.length).map(block => ({ events: block.events, task: block.analyzerTask }));
    const run = jobs.length ? await runAnalyzerBatch(jobs, python, context) : null;
    let index = 0;
    const blockFeatures = prepared.map(block => finishBlock(block,
      block.events.length ? run?.jobs?.[index++] : null, run?.error));
    const session_metrics = {};
    for (const block of blockFeatures) {
      for (const [metricId, entry] of Object.entries(block.computed_metrics)) {
        if (!session_metrics[metricId]) session_metrics[metricId] = { value: null, blocks: {} };
        if (entry && entry.value != null) {
          Object.defineProperty(session_metrics[metricId].blocks, String(block.block_id), {
            value: entry.value, enumerable: true, writable: true, configurable: true,
          });
        }
      }
    }
    return { schema_version: 'rt_features.v1', adapter_version: 'rt_event_adapter.v2', blocks: blockFeatures, session_metrics,
      python_available: run ? !run.error : await pythonAvailable() };
  }, options);
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
