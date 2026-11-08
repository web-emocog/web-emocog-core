// Read-only, local aggregate analysis. Never copy a participant export into git.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const names = ['baseline', 'eye_patch', 'eye_gradient_all', 'eye_gradient'];
const methods = ['same_eye_iris.v2', 'eye_patch_ridge.experimental.v1',
  'eye_gradient_all_iris.experimental.v1', 'eye_gradient_iris.experimental.v1'];
const signals = names.flatMap(name => [name + '.raw', name + '.corrected']);
const requireValue = condition => { if (!condition) throw new Error('invalid_gradient_summary'); };
const count = value => Number.isSafeInteger(value) && value >= 0;
const nonnegative = value => Number.isFinite(value) && value >= 0;
const ratio = (value, n) => n ? value / n : null;

function summarizeWindows(windows, signalNames = signals) {
  const totals = Object.fromEntries(signalNames.map(key => [key,
    { accepted: 0, attempted: 0, offScreen: 0, error: 0, squaredError: 0,
      biasX: 0, biasY: 0, withinVariance: 0, targetError: 0, measuredTargets: 0 }]));
  const comparisons = Object.fromEntries(signalNames.filter(key => !key.startsWith('baseline.')).map(key => [key,
    { baseline: 'baseline.' + key.split('.').at(-1), candidate: key, commonAccepted: 0,
      delta: 0, betterTargets: 0, worseTargets: 0, tiedTargets: 0, measuredTargets: 0 }]));
  for (const window of windows) {
    requireValue(count(window?.analyzed) && Array.isArray(window.comparisons));
    for (const key of signalNames) {
      const s = window.signals?.[key], t = totals[key];
      requireValue(s && count(s.accepted) && s.attempted === window.analyzed
        && s.accepted <= s.attempted && count(s.offScreen) && s.offScreen <= s.accepted);
      t.accepted += s.accepted; t.attempted += s.attempted; t.offScreen += s.offScreen;
      if (!s.accepted) continue;
      requireValue(nonnegative(s.meanErrorPx) && nonnegative(s.rmsErrorPx)
        && Number.isFinite(s.biasXPx) && Number.isFinite(s.biasYPx)
        && nonnegative(s.withinTargetSdXPx) && nonnegative(s.withinTargetSdYPx));
      t.error += s.accepted * s.meanErrorPx;
      t.squaredError += s.accepted * s.rmsErrorPx ** 2;
      t.biasX += s.accepted * s.biasXPx; t.biasY += s.accepted * s.biasYPx;
      // Pool within-target variance, not the variance of different target means.
      t.withinVariance += s.accepted * (s.withinTargetSdXPx ** 2 + s.withinTargetSdYPx ** 2);
      t.targetError += s.meanErrorPx; t.measuredTargets++;
    }
    for (const [key, p] of Object.entries(comparisons)) {
      const matching = window.comparisons.filter(c => c.baseline === p.baseline && c.candidate === key);
      requireValue(matching.length === 1);
      const c = matching[0], b = window.signals[p.baseline], s = window.signals[key];
      requireValue(count(c.commonAccepted) && c.commonAccepted <= Math.min(b.accepted, s.accepted)
        && c.commonAccepted >= Math.max(0, b.accepted + s.accepted - window.analyzed));
      if (!c.commonAccepted) continue;
      requireValue(Number.isFinite(c.candidateMinusBaselineMeanErrorPx));
      p.commonAccepted += c.commonAccepted;
      p.delta += c.commonAccepted * c.candidateMinusBaselineMeanErrorPx;
      p.measuredTargets++;
      if (c.candidateMinusBaselineMeanErrorPx < 0) p.betterTargets++;
      else if (c.candidateMinusBaselineMeanErrorPx > 0) p.worseTargets++;
      else p.tiedTargets++;
    }
  }
  return { targetCount: windows.length,
    signals: Object.fromEntries(Object.entries(totals).map(([key, t]) => [key, {
      accepted: t.accepted, attempted: t.attempted, missingFraction: t.attempted ? 1 - t.accepted / t.attempted : null,
      offScreen: t.offScreen, offScreenFractionOfAccepted: ratio(t.offScreen, t.accepted),
      sampleWeightedMeanErrorPx: ratio(t.error, t.accepted),
      equalTargetMeanErrorPx: ratio(t.targetError, t.measuredTargets),
      rmsErrorPx: t.accepted ? Math.sqrt(t.squaredError / t.accepted) : null,
      biasXPx: ratio(t.biasX, t.accepted), biasYPx: ratio(t.biasY, t.accepted),
      withinTargetRmsSpreadPx: t.accepted ? Math.sqrt(t.withinVariance / t.accepted) : null,
    }])),
    comparisons: Object.values(comparisons).map(p => ({ baseline: p.baseline, candidate: p.candidate,
      commonAccepted: p.commonAccepted, candidateMinusBaselineMeanErrorPx: ratio(p.delta, p.commonAccepted),
      betterTargets: p.betterTargets, worseTargets: p.worseTargets, tiedTargets: p.tiedTargets,
      measuredTargets: p.measuredTargets,
      // Marginal means above need not describe these same frames.
      commonAbsoluteErrorsStored: false,
    })) };
}

const completeTargets = (windows, n = 9) => Array.isArray(windows) && windows.length === n
  && new Set(windows.map(w => w?.targetIndex)).size === n
  && windows.every(w => count(w?.targetIndex) && w.targetIndex < n);

function targetChanges(before, after, n, signalNames = signals) {
  requireValue(completeTargets(before, n) && completeTargets(after, n));
  const afterByIndex = new Map(after.map(w => [w.targetIndex, w]));
  const targets = before.map(b => {
    const a = afterByIndex.get(b.targetIndex);
    requireValue(['x', 'y'].every(axis => nonnegative(b.targetPercent?.[axis])
      && b.targetPercent[axis] <= 100 && b.targetPercent[axis] === a.targetPercent?.[axis]));
    return [b.signals, a.signals];
  });
  return {
    scope: 'after_minus_before_equal_weight_matched_target_means_not_common_frames',
    withinIntervalAccuracyAvailable: false,
    signals: Object.fromEntries(signalNames.map(key => {
      const deltas = targets.filter(([b, a]) => b[key].accepted && a[key].accepted)
        .map(([b, a]) => ({ error: a[key].meanErrorPx - b[key].meanErrorPx,
          x: a[key].biasXPx - b[key].biasXPx, y: a[key].biasYPx - b[key].biasYPx }));
      const n = deltas.length;
      const errors = deltas.map(d => d.error).sort((a, b) => a - b);
      const avg = field => ratio(deltas.reduce((sum, d) => sum + d[field], 0), n);
      return [key, { matchedTargets: n, meanErrorDeltaPx: avg('error'),
        medianTargetErrorDeltaPx: n ? (errors[(n - 1) >> 1] + errors[n >> 1]) / 2 : null,
        meanBiasDeltaXPx: avg('x'), meanBiasDeltaYPx: avg('y'),
        worsenedTargets: deltas.filter(d => d.error > 0).length,
        shiftedLeftTargets: deltas.filter(d => d.x < 0).length,
        shiftedUpTargets: deltas.filter(d => d.y < 0).length }];
    })),
  };
}

function temporalSummary(before, after, gap, signalNames = signals) {
  requireValue(gap?.scope === 'interval_capture_counts_not_gaze_accuracy'
    && Number.isFinite(gap.elapsedMs) && gap.elapsedMs >= 240000
    && count(gap.completedCaptures) && count(gap.cameraNotifications));
  return {
    temporalGap: { elapsedMs: gap.elapsedMs, completedCaptures: gap.completedCaptures,
      cameraNotifications: gap.cameraNotifications, scope: 'interval_capture_counts_not_gaze_accuracy' },
    temporalComparison: targetChanges(before, after, 9, signalNames),
  };
}

function analyzeGradientReport(report) {
  const cohort = report?.version === 'gaze_benchmark.v1';
  if (cohort) requireValue(report.benchmark?.completed === true
    && ['spatial.v1', 'posture.v1', 'temporal.v1'].includes(report.benchmark.protocol));
  const temporal = report?.version === 'issue143_eye_gradient_temporal.v8' || (cohort && report.benchmark.protocol === 'temporal.v1');
  const tophat = report?.version === 'issue143_eye_tophat.v10' || cohort;
  const pose = report?.version === 'issue143_eye_gradient_pose.v9' || (tophat && Boolean(report.poseProbe));
  if (cohort) requireValue((report.benchmark.protocol === 'posture.v1') === pose);
  const modelNames = tophat ? [...names.slice(0, 3), 'eye_tophat'] : names;
  const modelMethods = tophat ? [...methods.slice(0, 3), 'eye_tophat_ridge.experimental.v1'] : methods;
  const signalNames = modelNames.flatMap(name => [name + '.raw', name + '.corrected']);
  requireValue(pose ? report.intervalMs === 0 && report.temporalScope === 'posture_probe_not_long_interval_drift'
    && report.poseProbe?.scope === 'instructed_posture_change_then_return_not_ground_truth_pose'
    && Array.isArray(report.poseProbe.stages) && report.poseProbe.stages.length === 3
    && report.poseProbe.stages.every((s, i) => s.id === ['natural','lowered','returned'][i] && completeTargets(s.rows, 5))
    : completeTargets(report?.before) && Array.isArray(report.after) && (temporal
    ? report.temporalScope === 'same_targets_before_after_no_within_interval_accuracy' && report.intervalMs === 240000
    : (report.version === 'issue143_eye_gradient.v7' || tophat) && report.temporalScope === 'spatial_only_no_drift_measurement'
      && report.intervalMs === 0 && report.after.length === 0));
  const models = {};
  for (const name of modelNames) {
    const m = report.models?.[name], c = m?.correction;
    requireValue(m && c && m.featureMethod === modelMethods[modelNames.indexOf(name)] && typeof c.selected === 'boolean'
      && nonnegative(m.ridgeLambda) && nonnegative(m.targetCvRmsPx)
      && [null, 'correction_not_applied', 'independent_benchmark_regression', 'independent_benchmark_unavailable']
        .includes(c.independentDecision?.reason ?? null)
      && (c.benchmarkRaw?.accuracyPx == null || nonnegative(c.benchmarkRaw.accuracyPx))
      && (c.loocv?.worsenedTargetCount == null || count(c.loocv.worsenedTargetCount)));
    models[name] = { featureMethod: m.featureMethod, ridgeLambda: m.ridgeLambda,
      calibrationTargetCvRmsPx: m.targetCvRmsPx,
      correctionSelected: c.selected, correctionDecision: c.independentDecision?.reason ?? null,
      independentTrimmedMeanErrorPx: c.benchmarkRaw?.accuracyPx ?? null,
      loocvWorsenedTargets: c.loocv?.worsenedTargetCount ?? null };
  }
  if (pose) {
    const stages = report.poseProbe.stages.map(stage => ({ id: stage.id, ...summarizeWindows(stage.rows, signalNames) }));
    return { version: tophat ? 'issue143_gradient_analysis.v4' : 'issue143_gradient_analysis.v3', sourceVersion: report.version,
      scope: 'single_run_instructed_posture_not_causal_proof_or_long_interval_acceptance', models, stages,
      changes: { loweredMinusNatural: targetChanges(report.poseProbe.stages[0].rows, report.poseProbe.stages[1].rows, 5, signalNames),
        returnedMinusNatural: targetChanges(report.poseProbe.stages[0].rows, report.poseProbe.stages[2].rows, 5, signalNames) } };
  }
  const phases = { before: summarizeWindows(report.before, signalNames), after: summarizeWindows(report.after, signalNames) };
  return temporal ? { version: 'issue143_gradient_analysis.v2', sourceVersion: report.version,
    scope: 'single_run_before_after_not_within_interval_accuracy_or_population_acceptance', models, ...phases,
    ...temporalSummary(report.before, report.after, report.temporalGap, signalNames) }
    : { version: tophat ? 'issue143_gradient_analysis.v4' : 'issue143_gradient_analysis.v1', sourceVersion: report.version,
      scope: 'single_run_spatial_only_not_drift_or_population_acceptance', models, ...phases,
      // No invented zero drift or per-frame significance from one participant.
      driftAssessment: { available: false, reason: 'no_temporal_interval_or_after_targets' } };
}

export function summarizeGradientReport(report) {
  const result = analyzeGradientReport(report);
  if (report?.version !== 'gaze_benchmark.v1') return result;
  result.version = 'gaze_benchmark_analysis.v1';
  const { width, height } = report.viewport || {};
  requireValue(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0);
  const diagonal = Math.hypot(width, height), percent = v => Number.isFinite(v) ? 100 * v / diagonal : null;
  const phases = result.stages || [{ id: 'before', ...result.before }, { id: 'after', ...result.after }];
  result.normalized = { unit: 'percent_of_viewport_diagonal_not_degrees_of_visual_angle',
    protocol: report.benchmark.protocol, phases: phases.filter(p => p.targetCount > 0).map(p => ({ id: p.id,
      signals: Object.fromEntries(Object.entries(p.signals).map(([key, s]) => [key, {
        equalTargetMeanError: percent(s.equalTargetMeanErrorPx), rmsError: percent(s.rmsErrorPx),
        withinTargetRmsSpread: percent(s.withinTargetRmsSpreadPx), biasX: percent(s.biasXPx), biasY: percent(s.biasYPx),
        missingFraction: s.missingFraction, offScreenFractionOfAccepted: s.offScreenFractionOfAccepted }])),
      comparisons: p.comparisons.map(c => ({ baseline: c.baseline, candidate: c.candidate,
        commonAccepted: c.commonAccepted, candidateMinusBaselineMeanError: percent(c.candidateMinusBaselineMeanErrorPx) })) })) };
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 3);
    const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
    console.log(JSON.stringify(summarizeGradientReport(report), null, 2));
  } catch {
    // Do not echo arbitrary imported content, file paths or parse errors.
    console.error('Cannot analyze: expected one complete issue143 gradient v7-v10 or developer gaze_benchmark.v1 JSON file.');
    process.exitCode = 1;
  }
}
