'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { buildFeatureReport } = require('./extended-features');
const stats = require('./extended-statistics');
// Units match persisted values; fractions/ratios are not percentages.
const METRICS = { 'rt.mean': ['Mean reaction time', 'ms'], 'rt.median': ['Median reaction time', 'ms'],
  'rt.cv': ['Reaction-time CV', 'ratio'], 'task.accuracy': ['Response accuracy', 'fraction'],
  'physiology.bpm': ['Heart rate', 'bpm'], 'physiology.respiration': ['Respiration', 'breaths/min'],
  'blink.rate': ['Blink rate', 'blinks/min'], 'face.valence': ['Facial valence proxy', 'index'],
  'body.velocity': ['Body movement', 'torso/s'], 'audio.pitch': ['Voice pitch', 'Hz'] };
const number = value => typeof value === 'number' && Number.isFinite(value);
const finiteValue = value => number(value) ? value : null;
const metric = (id, label, value, unit = '') => ({ id, label, value: finiteValue(value), unit });
const unavailable = (reason, method = null) => ({ status: 'unavailable', reason, method, p: null, pMethod: 'unavailable' });
const safe = operation => {
  try { return operation(); }
  catch (_) { return unavailable('statistics_calculation_failed'); }
};

function pairValues(participants, plan, metricId) {
  const a = [], b = [], rows = [];
  let missing = 0;
  const reference = new Set(plan.referenceParticipantIds || []), comparison = new Set(plan.comparisonParticipantIds || []);
  if (plan.design === 'independent' && [...reference].some(id => comparison.has(id))) {
    return { a, b, rows, missing, error: 'independent_groups_overlap' };
  }
  for (const person of participants) {
    if (plan.design === 'independent') {
      const inA = reference.has(String(person.id)), inB = comparison.has(String(person.id));
      if (!inA && !inB) continue;
      const value = person.metrics?.[metricId];
      if (!number(value)) { missing++; continue; }
      const target = inA ? a : b;
      target.push(value);
      rows.push({ participant: `Group ${inA ? 'A' : 'B'} participant ${target.length}`,
        reference: inA ? value : null, comparison: inB ? value : null, difference: null });
    } else {
      const left = person.conditions?.[plan.referenceId]?.[metricId];
      const right = person.conditions?.[plan.comparisonId]?.[metricId];
      if (!number(left) || !number(right)) { missing++; continue; }
      a.push(left); b.push(right);
      rows.push({ participant: `Participant ${a.length}`, reference: left, comparison: right,
        difference: finiteValue(right - left) });
    }
  }
  return { a, b, rows, missing, error: null };
}

function omnibusValues(participants, plan, metricId) {
  const levels = plan.levels, groups = levels.map(() => []), rows = [];
  let included = 0, missing = 0, overlapping = 0;
  for (const person of participants) {
    const values = levels.map(level => person.conditions?.[level]?.[metricId]);
    const available = values.map((value, index) => number(value) ? index : -1).filter(index => index >= 0);
    if (plan.design === 'paired') {
      if (available.length !== levels.length) { missing++; continue; }
      included++;
      values.forEach((value, index) => {
        groups[index].push(value);
        rows.push({ participant: `Participant ${included}`, level: levels[index], value });
      });
    } else {
      // Between-condition inference cannot reuse people in several groups.
      if (available.length > 1) { overlapping++; continue; }
      if (!available.length) { missing++; continue; }
      included++;
      const index = available[0]; groups[index].push(values[index]);
      rows.push({ participant: `Participant ${included}`, level: levels[index], value: values[index] });
    }
  }
  return { groups, rows, included, missing, overlapping, ns: groups.map(group => group.length) };
}

// Missing visits never slide into a different column. The feature layer must
// explicitly certify shared visit identities, comparability and retry exclusion.
function repeatValues(participants, metricId) {
  const eligible = participants.map(person => (person.sessions || []).filter(session => session.comparable?.eligible === true));
  const keys = new Set(), visits = new Set();
  for (const sessions of eligible) for (const session of sessions) {
    if (typeof session.comparable.key === 'string' && session.comparable.key
      && typeof session.comparable.visit === 'string' && session.comparable.visit) {
      keys.add(session.comparable.key); visits.add(session.comparable.visit);
    }
  }
  if (keys.size !== 1 || visits.size !== 2) return { configured: false, matrix: [], rows: [],
    missing: participants.length, reason: 'two_aligned_comparable_visits_required' };
  const order = [...visits].sort(), matrix = [], rows = [];
  let missing = 0;
  for (const sessions of eligible) {
    const selected = order.map(visit => sessions.filter(session => session.comparable.visit === visit));
    if (selected.some(matches => matches.length !== 1)
      || selected[0][0].sessionId === selected[1][0].sessionId
      || selected.some(([session]) => typeof session.sessionId !== 'string' || !session.sessionId
        || !number(session.metrics?.[metricId]))) { missing++; continue; }
    const values = selected.map(([session]) => session.metrics[metricId]);
    matrix.push(values);
    rows.push({ participant: `Participant ${matrix.length}`, referenceVisit: order[0], comparisonVisit: order[1],
      reference: values[0], comparison: values[1] });
  }
  return { configured: true, matrix, rows, missing, visits: order, reason: null };
}

function calculate(input) {
  const plan = input.plan || {};
  const report = buildFeatureReport(input.rows, { definition: input.definition, plan: { ...plan, filters: input.filters } });
  const participants = report.participants || [];
  const catalog = new Map((report.options?.metrics || []).map(item => [item.id, item]));
  const unit = id => catalog.get(id)?.unit || METRICS[id]?.[1] || '';
  const label = id => catalog.get(id)?.label || METRICS[id]?.[0] || id;
  const levels = Array.isArray(plan.levels) ? plan.levels : [];
  const multilevel = levels.length >= 3;
  const validLevels = levels.length <= 8 && levels.every(level => typeof level === 'string' && level)
    && new Set(levels).size === levels.length;
  const paired = plan.design !== 'independent';
  const pairConfigured = paired ? Boolean(plan.referenceId && plan.comparisonId && plan.referenceId !== plan.comparisonId)
    : Boolean(plan.referenceParticipantIds?.length && plan.comparisonParticipantIds?.length);
  const comparisonConfigured = multilevel ? validLevels : pairConfigured;
  const values = pairValues(participants, plan, plan.metricId);
  const selections = new Map();
  function testMetric(metricId) {
    if (!comparisonConfigured) return unavailable('comparison_not_configured');
    if (multilevel) {
      const data = omnibusValues(participants, plan, metricId);
      selections.set(metricId, data);
      const selection = { nParticipants: data.included, missingParticipants: data.missing, overlappingParticipants: data.overlapping,
        ns: data.ns, levels, completeCases: paired };
      if (data.overlapping) return { ...unavailable('independent_levels_overlap_participants', 'kruskal_wallis'), selection };
      return { ...safe(() => paired ? stats.friedman(data.groups) : stats.kruskal(data.groups)), selection };
    }
    const data = pairValues(participants, plan, metricId);
    if (data.error) return unavailable(data.error);
    return { ...safe(() => paired ? stats.pairedT(data.a, data.b) : stats.welchT(data.a, data.b)),
      selection: { missingParticipants: data.missing, nA: data.a.length, nB: data.b.length } };
  }
  const comparison = testMetric(plan.metricId);
  const effect = finiteValue(comparison.effect);
  const rows = multilevel ? selections.get(plan.metricId)?.rows || [] : values.rows;
  function add(id, title, result, metrics, selectedRows = [], chart = null, configured = comparisonConfigured) {
    const computed = result?.status === 'ok';
    report.modules.push({ id, title, status: computed ? 'computed' : configured ? 'no_data' : 'needs_configuration',
      reason: computed ? null : result?.reason || 'insufficient_participant_data', metrics,
      rows: selectedRows.slice(0, 500), chart, method: result?.method || null,
      pMethod: result?.pMethod || null, diagnostics: result || null,
      warnings: result?.warnings || [], assumptions: result?.assumptions || [] });
  }
  add('S1', 'Differences between conditions', comparison, multilevel
    ? [metric('statistic', 'Omnibus statistic', comparison.statistic), metric('p', 'p value', comparison.p),
      metric('participants', 'Included participants', comparison.selection?.nParticipants), metric('levels', 'Conditions', levels.length)]
    : [metric('difference', 'Mean difference B - A', effect, unit(plan.metricId)),
      metric('participantsA', 'Participants A', values.a.length), metric('participantsB', 'Participants B', values.b.length),
      metric('p', 'p value', comparison.p)], rows, multilevel ? { type: 'box', x: 'level', y: 'value' }
      : { type: 'paired', x: 'reference', y: 'comparison' });
  const ranked = multilevel ? comparison : !pairConfigured ? unavailable('comparison_not_configured')
    : values.error ? unavailable(values.error) : safe(() => paired ? stats.wilcoxon(values.a, values.b) : stats.mannWhitney(values.a, values.b));
  add('S2', 'Rank-based comparison', ranked, [metric('statistic', 'Rank statistic', ranked.statistic),
    metric('p', 'p value', ranked.p)], rows, multilevel ? { type: 'box', x: 'level', y: 'value' }
      : { type: 'box', x: 'reference', y: 'comparison' });
  const effectResult = multilevel ? unavailable('omnibus_has_no_pairwise_mean_effect', comparison.method) : comparison;
  add('S3', 'Effect and uncertainty', effectResult, multilevel
    ? [metric('kendallW', 'Descriptive within-person rank concordance', comparison.kendallW)]
    : [metric('effect', 'Mean difference B - A', effect, unit(plan.metricId)),
      metric('lower', '95% CI lower', comparison.ci95?.lower, unit(plan.metricId)),
      metric('upper', '95% CI upper', comparison.ci95?.upper, unit(plan.metricId)),
      metric('standardized', 'Standardized effect', comparison.effectSize?.value)], rows);
  const bootstrap = multilevel ? unavailable('bootstrap_requires_two_levels') : !pairConfigured
    ? unavailable('comparison_not_configured') : values.error ? unavailable(values.error)
      : safe(() => stats.bootstrapDifference(values.a, values.b, { paired, seed: plan.seed, iterations: plan.iterations }));
  add('S4', 'Participant bootstrap', bootstrap, [metric('effect', 'Mean difference B - A', bootstrap.effect, unit(plan.metricId)),
    metric('lower', 'Percentile 95% CI lower', bootstrap.ci95?.lower, unit(plan.metricId)),
    metric('upper', 'Percentile 95% CI upper', bootstrap.ci95?.upper, unit(plan.metricId))], rows);

  const correlationMethod = plan.method || 'spearman';
  const correlationConfigured = Boolean(plan.metricId && plan.secondMetricId && plan.metricId !== plan.secondMetricId
    && ['pearson', 'spearman'].includes(correlationMethod));
  const correlated = participants.filter(person => number(person.metrics?.[plan.metricId]) && number(person.metrics?.[plan.secondMetricId]));
  const correlation = correlationConfigured ? safe(() => stats[correlationMethod](
    correlated.map(person => person.metrics[plan.metricId]), correlated.map(person => person.metrics[plan.secondMetricId])))
    : unavailable('two_distinct_metrics_and_correlation_method_required');
  add('S5', 'Participant-level association', correlation,
    [metric(correlationMethod === 'pearson' ? 'r' : 'rho', 'Correlation coefficient', correlation.r ?? correlation.rho),
      metric('participants', 'Complete independent participant pairs', correlated.length), metric('p', 'p value', correlation.p)],
    correlated.map((person, index) => ({ participant: `Participant ${index + 1}`, x: person.metrics[plan.metricId], y: person.metrics[plan.secondMetricId] })),
    { type: 'scatter', x: 'x', y: 'y' }, correlationConfigured);

  const hypotheses = (plan.familyMetricIds || []).map(id => {
    const result = id === plan.metricId ? comparison : testMetric(id);
    return { id, p: finiteValue(result.p), effect: finiteValue(result.effect), reason: result.reason, method: result.method };
  });
  const adjusted = hypotheses.length ? safe(() => stats.adjustPValues(hypotheses.map(({ id, p }) => ({ id, p })), plan.correction || 'holm'))
    : unavailable('multiplicity_family_not_configured');
  const byId = new Map(hypotheses.map(item => [item.id, item]));
  const correctedRows = (adjusted.results || []).map(item => ({ ...item, label: label(item.id),
    effect: byId.get(item.id)?.effect ?? null, effectUnit: unit(item.id), testMethod: byId.get(item.id)?.method ?? null,
    testReason: byId.get(item.id)?.reason ?? null }));
  add('S6', 'Multiplicity control', adjusted, [metric('hypotheses', 'Prespecified family size', hypotheses.length),
    metric('available', 'Available p values', hypotheses.filter(item => number(item.p)).length)], correctedRows,
    { type: 'bar', x: 'label', y: 'pAdjusted' }, hypotheses.length > 0 && comparisonConfigured);

  const repeated = repeatValues(participants, plan.metricId);
  const reliability = !repeated.configured ? unavailable(repeated.reason, 'icc_a1_anova') : repeated.matrix.length < 3
    ? unavailable('icc_requires_three_complete_participants', 'icc_a1_anova') : safe(() => stats.reliability(repeated.matrix));
  reliability.selection = { visits: repeated.visits || [], nPeople: repeated.matrix.length, missingParticipants: repeated.missing };
  add('S7', 'Absolute-agreement repeat reliability', reliability, [metric('icc', 'ICC(A,1), single measurement', reliability.icc),
    metric('participants', 'Complete participants', repeated.matrix.length)], repeated.rows,
    { type: 'paired', x: 'reference', y: 'comparison' }, repeated.configured);

  const detection = report.modules.find(module => module.id === 'R8');
  if (detection?.status === 'computed') {
    const keys = ['hits', 'misses', 'falseAlarms', 'correctRejections'];
    const counts = Object.fromEntries(keys.map(key => [key, detection.metrics?.find(item => item.id === key)?.value]));
    const result = safe(() => stats.signalDetection(counts));
    detection.method = result.method; detection.diagnostics = result;
    detection.metrics.push(metric('dPrime', 'Pooled descriptive d-prime', result.dPrime), metric('criterion', 'Pooled descriptive criterion', result.criterion));
    detection.warnings = [...(result.warnings || []), 'pooled_trial_weighted_sdt_not_participant_mean_or_inference'];
    // Counts remain available even when SDT itself is unavailable.
    if (result.status !== 'ok') detection.reason = result.reason;
  }
  report.options ||= {};
  report.options.metrics = [...new Set([...Object.keys(METRICS), ...catalog.keys()])]
    .map(id => ({ id, label: label(id), unit: unit(id) }));
  report.schemaVersion = 'analytics-extensions.v1';
  report.methodVersion = 'analytics-extensions.2';
  report.plan = plan;
  report.counts = { participants: participants.length, sessions: (input.rows || []).length,
    computed: report.modules.filter(module => module.status === 'computed').length,
    needsConfiguration: report.modules.filter(module => module.status === 'needs_configuration').length };
  report.scope = { ...input.scope, filters: input.filters };
  report.inference = { unit: 'participant', causal: false,
    note: 'Trials do not replace participants; complete-case exclusions and model assumptions apply. No clinical validity is established.' };
  for (const module of report.modules) report.availability.moduleStatuses[module.id] = module.status;
  // The wire contract permits finite numbers or null, including diagnostic projections.
  return JSON.parse(JSON.stringify(report));
}

if (parentPort) {
  try { parentPort.postMessage({ ok: true, data: calculate(workerData) }); }
  catch (_) { parentPort.postMessage({ ok: false }); }
}
module.exports = { calculate };
