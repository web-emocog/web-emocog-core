const { quantile } = require('./metrics');
const { passiveMetric } = require('./passive');
const { COMPARISON_METRICS } = require('./query');
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const participantId = row => Object.hasOwn(row, 'participant_key') ? row.participant_key : (row.participant_id || null);

function describe(values) {
  const mean = average(values);
  return {
    mean, median: quantile(values, .5), q1: quantile(values, .25), q3: quantile(values, .75),
    sd: values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) : null,
  };
}

// NIST t(0.975) table. Use the next lower tabulated df for fractional or large df.
const T95 = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
function exploratoryRtInterval(effect, spec, a, b, differences) {
  const none = reason => ({ estimate: { value: null, lower: null, upper: null, confidenceLevel: .95, method: 'not_computed' }, warning: reason });
  if (spec.metricId === 'task.accuracy_pct') return none('interval_not_supported_for_accuracy');
  if (spec.metricId.startsWith('physiology.')) return none('physiology_comparison_descriptive_only');
  if (a.nParticipants < 3 || b.nParticipants < 3) return none('interval_requires_three_participants_per_side');
  const paired = spec.design === 'paired';
  const vA = a.sd ** 2 / a.nParticipants;
  const vB = b.sd ** 2 / b.nParticipants;
  const variance = paired ? differences.sd ** 2 / a.nParticipants : vA + vB;
  if (!Number.isFinite(variance) || variance <= 0) return none('interval_variability_unavailable');
  const df = paired ? a.nParticipants - 1
    : 1 / ((vA / variance) ** 2 / (a.nParticipants - 1) + (vB / variance) ** 2 / (b.nParticipants - 1));
  const critical = df >= 100 ? 1.984 : df >= 80 ? 1.990 : df >= 60 ? 2.000 : df >= 40 ? 2.021 : T95[Math.min(30, Math.max(1, Math.floor(df)))];
  const margin = critical * Math.sqrt(variance);
  if (![effect - margin, effect + margin].every(Number.isFinite)) return none('interval_variability_unavailable');
  return { estimate: { value: effect, lower: effect - margin, upper: effect + margin, confidenceLevel: .95,
    method: paired ? 'paired_t_nist_table_exploratory_v1' : 'welch_t_nist_table_exploratory_v1' },
    warning: 'exploratory_interval_assumptions_not_verified' };
}

function participantPhysiology(rows, metricId, blockId) {
  const values = rows.map(row => passiveMetric(metricId, row, { filters: {
    blockIds: blockId == null ? [] : [blockId], stimulusIds: [], conditionIds: [], aoiIds: [],
  } })).filter(metric => metric.status === 'computed' && Number.isFinite(metric.value));
  return { value: average(values.map(metric => metric.value)),
    n: values.reduce((sum, metric) => sum + metric.nObservations, 0) };
}

function participantValue(trials, metricId) {
  const valid = trials.filter(trial => trial && typeof trial === 'object' && trial.qualityValid !== false);
  if (metricId === 'task.accuracy_pct') {
    const scored = valid.filter(trial => typeof trial.correct === 'boolean');
    return { value: scored.length ? scored.filter(trial => trial.correct).length / scored.length * 100 : null, n: scored.length };
  }
  const rt = valid.filter(trial => trial.correct === true && typeof trial.rt === 'number' && Number.isFinite(trial.rt) && trial.rt >= 0).map(trial => trial.rt);
  return { value: metricId === 'task.rt_median_ms' ? quantile(rt, .5) : average(rt), n: rt.length };
}

function buildDescriptiveComparison(rows, query) {
  const spec = query.comparison;
  const participants = new Map();
  const participantRows = new Map();
  const physiology = spec.metricId.startsWith('physiology.');
  rows.forEach(row => {
    const id = participantId(row);
    if (!id) return;
    const key = String(id);
    if (!participants.has(key)) { participants.set(key, []); participantRows.set(key, []); }
    participantRows.get(key).push(row);
    const trials = row.features_payload?.cognitiveResults;
    if (Array.isArray(trials)) for (const trial of trials) if (trial && typeof trial === 'object') participants.get(key).push(trial);
  });
  const a = [], b = [], pairs = [], excluded = [];
  let observationsA = 0, observationsB = 0;
  const membersA = new Set(spec.referenceParticipantIds || []);
  const membersB = new Set(spec.comparisonParticipantIds || []);
  const selected = spec.design === 'paired' ? [...participants.keys()] : [...membersA, ...membersB];
  selected.forEach(id => {
    const trials = participants.get(id) || [];
    if (spec.design === 'paired') {
      const level = trial => spec.axis === 'condition' ? trial.condition : (trial.blockId ?? trial.block);
      const left = physiology ? participantPhysiology(participantRows.get(id), spec.metricId, spec.referenceId)
        : participantValue(trials.filter(trial => String(level(trial)) === spec.referenceId), spec.metricId);
      const right = physiology ? participantPhysiology(participantRows.get(id), spec.metricId, spec.comparisonId)
        : participantValue(trials.filter(trial => String(level(trial)) === spec.comparisonId), spec.metricId);
      if (left.value == null || right.value == null) {
        excluded.push({ participantId: id, reason: left.value == null ? 'reference_data_missing' : 'comparison_data_missing' });
        return;
      }
      a.push(left.value); b.push(right.value);
      pairs.push({ participantId: id, reference: left.value, comparison: right.value, difference: right.value - left.value });
      observationsA += left.n;
      observationsB += right.n;
    } else {
      const value = physiology ? participantPhysiology(participantRows.get(id) || [], spec.metricId, null) : participantValue(trials, spec.metricId);
      if (value.value == null) { excluded.push({ participantId: id, reason: 'participant_data_missing' }); return; }
      (membersA.has(id) ? a : b).push(value.value);
      if (membersA.has(id)) observationsA += value.n;
      else observationsB += value.n;
    }
  });
  const available = a.length > 0 && b.length > 0;
  const unidentifiedSessionCount = rows.filter(row => !participantId(row)).length;
  const reference = { nParticipants: a.length, nObservations: observationsA, ...describe(a), values: a };
  const comparison = { nParticipants: b.length, nObservations: observationsB, ...describe(b), values: b };
  const effect = available ? comparison.mean - reference.mean : null;
  const pairedDifferences = spec.design === 'paired' ? describe(pairs.map(pair => pair.difference)) : null;
  const { estimate, warning } = exploratoryRtInterval(effect, spec, reference, comparison, pairedDifferences);
  return {
    comparisonId: 'custom', metricId: spec.metricId, design: spec.design,
    modelId: 'descriptive-participant-difference', modelVersion: '1.2.0',
    effectUnit: spec.metricId === 'task.accuracy_pct' ? 'pct' : spec.metricId === 'physiology.bpm_mean' ? 'bpm'
      : spec.metricId === 'physiology.respiration_mean' ? 'breaths/min' : 'ms',
    effectLabel: 'comparison minus reference',
    referenceLevel: spec.design === 'paired' ? spec.referenceId : 'A',
    comparisonLevel: spec.design === 'paired' ? spec.comparisonId : 'B',
    readiness: available ? 'available' : 'insufficient_data',
    reason: available ? 'descriptive_only' : (spec.design === 'paired' ? 'complete_pairs_missing' : 'group_data_missing'),
    formula: (spec.design === 'paired' ? 'mean(participant_B - participant_A)' : 'mean(participant_B) - mean(participant_A)')
      + (physiology ? '; participant_value = mean(session_estimates); accepted_block_attempts_only_for_paired_design' : ''),
    effect, reference, comparison, pairedDifferences,
    pairs, excludedParticipants: excluded, unidentifiedSessionCount,
    estimateCi95: estimate,
    pValueAdjusted: null, adjustmentMethod: 'not_computed',
    nParticipants: spec.design === 'paired' ? a.length : a.length + b.length,
    nObservations: observationsA + observationsB,
    warnings: ['descriptive_only', 'no_hypothesis_test', warning, ...(excluded.length ? ['participants_with_missing_data_excluded'] : []),
      ...(unidentifiedSessionCount ? ['sessions_without_participant_id_excluded'] : [])],
    readinessChecks: [{ id: 'participant_level_aggregation', status: 'pass', reason: null },
      { id: spec.design === 'paired' ? 'complete_pairs' : 'disjoint_groups', status: available ? 'pass' : 'blocked', reason: available ? null : 'insufficient_participants' }],
  };
}

module.exports = { COMPARISON_METRICS, participantId, buildDescriptiveComparison };
