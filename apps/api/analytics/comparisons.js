const { quantile } = require('./metrics');

const COMPARISON_METRICS = new Set(['task.rt_mean_ms', 'task.rt_median_ms', 'task.accuracy_pct']);
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const participantId = row => Object.hasOwn(row, 'participant_key') ? row.participant_key : (row.participant_id || null);

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
  rows.forEach(row => {
    const id = participantId(row);
    if (!id) return;
    const key = String(id);
    if (!participants.has(key)) participants.set(key, []);
    const trials = row.features_payload?.cognitiveResults;
    if (Array.isArray(trials)) for (const trial of trials) if (trial && typeof trial === 'object') participants.get(key).push(trial);
  });
  const a = [], b = [], pairs = [], excluded = [];
  let observations = 0;
  const membersA = new Set(spec.referenceParticipantIds || []);
  const membersB = new Set(spec.comparisonParticipantIds || []);
  const selected = spec.design === 'paired' ? [...participants.keys()] : [...membersA, ...membersB];
  selected.forEach(id => {
    const trials = participants.get(id) || [];
    if (spec.design === 'paired') {
      const level = trial => spec.axis === 'condition' ? trial.condition : (trial.blockId ?? trial.block);
      const left = participantValue(trials.filter(trial => String(level(trial)) === spec.referenceId), spec.metricId);
      const right = participantValue(trials.filter(trial => String(level(trial)) === spec.comparisonId), spec.metricId);
      if (left.value == null || right.value == null) {
        excluded.push({ participantId: id, reason: left.value == null ? 'reference_data_missing' : 'comparison_data_missing' });
        return;
      }
      a.push(left.value); b.push(right.value);
      pairs.push({ participantId: id, reference: left.value, comparison: right.value, difference: right.value - left.value });
      observations += left.n + right.n;
    } else {
      const value = participantValue(trials, spec.metricId);
      if (value.value == null) { excluded.push({ participantId: id, reason: 'participant_data_missing' }); return; }
      (membersA.has(id) ? a : b).push(value.value);
      observations += value.n;
    }
  });
  const available = a.length > 0 && b.length > 0;
  const unidentifiedSessionCount = rows.filter(row => !participantId(row)).length;
  const left = average(a), right = average(b);
  return {
    comparisonId: 'custom', metricId: spec.metricId, design: spec.design,
    modelId: 'descriptive-participant-difference', modelVersion: '1.0.0',
    effectUnit: spec.metricId === 'task.accuracy_pct' ? 'pct' : 'ms',
    effectLabel: 'comparison minus reference',
    referenceLevel: spec.design === 'paired' ? spec.referenceId : 'A',
    comparisonLevel: spec.design === 'paired' ? spec.comparisonId : 'B',
    readiness: available ? 'available' : 'insufficient_data',
    reason: available ? 'descriptive_only' : (spec.design === 'paired' ? 'complete_pairs_missing' : 'group_data_missing'),
    formula: spec.design === 'paired' ? 'mean(participant_B - participant_A)' : 'mean(participant_B) - mean(participant_A)',
    effect: available ? right - left : null,
    reference: { nParticipants: a.length, mean: left, median: quantile(a, .5), values: a },
    comparison: { nParticipants: b.length, mean: right, median: quantile(b, .5), values: b },
    pairs, excludedParticipants: excluded, unidentifiedSessionCount,
    estimateCi95: { value: null, lower: null, upper: null, confidenceLevel: .95, method: 'not_computed' },
    pValueAdjusted: null, adjustmentMethod: 'not_computed',
    nParticipants: spec.design === 'paired' ? a.length : a.length + b.length,
    nObservations: observations,
    warnings: ['descriptive_only', 'no_inferential_statistics', ...(excluded.length ? ['participants_with_missing_data_excluded'] : []),
      ...(unidentifiedSessionCount ? ['sessions_without_participant_id_excluded'] : [])],
    readinessChecks: [{ id: 'participant_level_aggregation', status: 'pass', reason: null },
      { id: spec.design === 'paired' ? 'complete_pairs' : 'disjoint_groups', status: available ? 'pass' : 'blocked', reason: available ? null : 'insufficient_participants' }],
  };
}

module.exports = { COMPARISON_METRICS, participantId, buildDescriptiveComparison };
