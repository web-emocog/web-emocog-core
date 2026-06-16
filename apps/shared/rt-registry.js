/**
 * RT task + metric registry (researcher protocol, participant runtime, ingest, QC, proxy API).
 * Formulas live in rt_component-/src/rt_mvp/analyzer.py — this file only maps IDs and wiring.
 */

const RT_TASKS = Object.freeze({
  simple_rt: {
    task_id: 'simple_rt',
    analyzer_task: 'simple',
    display_name: { ru: 'Простая реакция', en: 'Simple RT' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'speed_accuracy_index', 'rt_outlier_frac'],
  },
  go_nogo: {
    task_id: 'go_nogo',
    analyzer_task: 'go_nogo',
    display_name: { ru: 'Go / No-Go', en: 'Go / No-Go' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'omission_rate', 'commission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'commission_rate', 'speed_accuracy_index', 'rt_outlier_frac'],
  },
  stroop: {
    task_id: 'stroop',
    analyzer_task: 'stroop',
    display_name: { ru: 'Stroop', en: 'Stroop' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'speed_accuracy_index', 'rt_outlier_frac'],
  },
  pvt: {
    task_id: 'pvt',
    analyzer_task: 'pvt',
    display_name: { ru: 'PVT', en: 'PVT' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'rt_outlier_frac'],
  },
  ax_cpt: {
    task_id: 'ax_cpt',
    analyzer_task: 'cpt',
    display_name: { ru: 'AX-CPT', en: 'AX-CPT' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'omission_rate', 'commission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'commission_rate', 'rt_outlier_frac'],
  },
  cpt: {
    task_id: 'cpt',
    analyzer_task: 'cpt',
    display_name: { ru: 'CPT', en: 'CPT' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'omission_rate', 'commission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'commission_rate', 'rt_outlier_frac'],
  },
  flanker: {
    task_id: 'flanker',
    analyzer_task: 'choice',
    display_name: { ru: 'Flanker', en: 'Flanker' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'speed_accuracy_index', 'rt_outlier_frac'],
  },
  nback_2: {
    task_id: 'nback_2',
    analyzer_task: 'choice',
    display_name: { ru: '2-back', en: '2-back' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'omission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'rt_outlier_frac'],
  },
  task_switching: {
    task_id: 'task_switching',
    analyzer_task: 'choice',
    display_name: { ru: 'Task switching', en: 'Task switching' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'omission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'rt_outlier_frac'],
  },
  other: {
    task_id: 'other',
    analyzer_task: 'simple',
    display_name: { ru: 'Другое', en: 'Other' },
    runtime_component: 'cognitive_task',
    default_metrics: ['rt_mean', 'omission_rate'],
    supported_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate', 'commission_rate', 'speed_accuracy_index', 'rt_outlier_frac'],
  },
});

const RT_METRICS = Object.freeze({
  rt_mean: {
    metric_id: 'rt_mean',
    aliases: ['mean_rt', 'mean_rt_ms'],
    display_name: { ru: 'Среднее RT', en: 'Mean RT' },
    analyzer_path: ['rt', 'mean_rt_ms'],
    aggregation_level: 'block',
    unit: 'ms',
    proxy_accessible: true,
    qc_dependencies: [],
  },
  rt_median: {
    metric_id: 'rt_median',
    aliases: ['median_rt', 'median_rt_ms'],
    display_name: { ru: 'Медиана RT', en: 'Median RT' },
    analyzer_path: ['rt', 'median_rt_ms'],
    aggregation_level: 'block',
    unit: 'ms',
    proxy_accessible: true,
    qc_dependencies: [],
  },
  rt_sd: {
    metric_id: 'rt_sd',
    aliases: ['rt_std', 'rt_std_ms'],
    display_name: { ru: 'SD RT', en: 'RT SD' },
    analyzer_path: ['rt', 'rt_std_ms'],
    aggregation_level: 'block',
    unit: 'ms',
    proxy_accessible: true,
    qc_dependencies: [],
  },
  omission_rate: {
    metric_id: 'omission_rate',
    aliases: ['omissions_pct'],
    display_name: { ru: 'Пропуски', en: 'Omission rate' },
    analyzer_path: ['rates', 'omission_rate'],
    aggregation_level: 'block',
    unit: 'ratio',
    proxy_accessible: true,
    qc_dependencies: ['omission_rate'],
    to_proxy_percent: true,
  },
  commission_rate: {
    metric_id: 'commission_rate',
    aliases: ['commission_error_rate'],
    display_name: { ru: 'Commission errors', en: 'Commission rate' },
    analyzer_path: ['rates', 'commission_error_rate'],
    aggregation_level: 'block',
    unit: 'ratio',
    proxy_accessible: true,
    qc_dependencies: ['commission_rate'],
    to_proxy_percent: true,
  },
  speed_accuracy_index: {
    metric_id: 'speed_accuracy_index',
    aliases: ['pearson_r_rt_correctness'],
    display_name: { ru: 'Speed–accuracy (r)', en: 'Speed–accuracy index' },
    analyzer_path: ['speed_accuracy', 'pearson_r_rt_correctness'],
    aggregation_level: 'block',
    unit: 'r',
    proxy_accessible: true,
    qc_dependencies: [],
  },
  rt_outlier_frac: {
    metric_id: 'rt_outlier_frac',
    display_name: { ru: 'Доля RT-выбросов', en: 'RT outlier fraction' },
    derived_from_trials: true,
    aggregation_level: 'block',
    unit: 'ratio',
    proxy_accessible: true,
    qc_dependencies: ['rt_outlier_frac'],
  },
});

const QC_REQUIRED_METRICS = Object.freeze(['omission_rate', 'commission_rate', 'rt_outlier_frac']);

function getTaskDef(taskType) {
  const t = String(taskType || 'other').toLowerCase();
  if (RT_TASKS[t]) return RT_TASKS[t];
  const analyzerKeys = ['simple', 'choice', 'go_nogo', 'stroop', 'pvt', 'cpt'];
  if (analyzerKeys.includes(t)) {
    const match = Object.values(RT_TASKS).find((def) => def.analyzer_task === t);
    if (match) return match;
  }
  return RT_TASKS.other;
}

function mapWebTaskToAnalyzer(taskType) {
  return getTaskDef(taskType).analyzer_task;
}

function resolveSelectedMetrics(taskType, selected) {
  const task = getTaskDef(taskType);
  const base = Array.isArray(selected) && selected.length ? selected : [...task.default_metrics];
  const allowed = new Set(task.supported_metrics);
  const out = new Set();
  for (const id of base) {
    if (allowed.has(id)) out.add(id);
  }
  for (const id of QC_REQUIRED_METRICS) {
    if (allowed.has(id)) out.add(id);
  }
  return [...out];
}

function getMetricValueFromAnalyzer(metrics, metricId) {
  const def = RT_METRICS[metricId];
  if (!def || !metrics) return null;
  if (def.derived_from_trials) return null;
  let cur = metrics;
  for (const key of def.analyzer_path || []) {
    if (!cur || typeof cur !== 'object') return null;
    cur = cur[key];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : null;
}

function listMetricCatalog() {
  return Object.values(RT_METRICS).map((m) => ({
    metric_id: m.metric_id,
    display_name: m.display_name,
    aggregation_level: m.aggregation_level,
    proxy_accessible: m.proxy_accessible,
  }));
}

function listTaskCatalog() {
  return Object.values(RT_TASKS).map((t) => ({
    task_id: t.task_id,
    display_name: t.display_name,
    supported_metrics: t.supported_metrics,
    default_metrics: t.default_metrics,
  }));
}

const api = {
  RT_TASKS,
  RT_METRICS,
  QC_REQUIRED_METRICS,
  getTaskDef,
  mapWebTaskToAnalyzer,
  resolveSelectedMetrics,
  getMetricValueFromAnalyzer,
  listMetricCatalog,
  listTaskCatalog,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.RtRegistry = api;
}
