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

function summarizeWindows(windows) {
  const totals = Object.fromEntries(signals.map(key => [key,
    { accepted: 0, attempted: 0, offScreen: 0, error: 0, squaredError: 0,
      biasX: 0, biasY: 0, withinVariance: 0, targetError: 0, measuredTargets: 0 }]));
  const comparisons = Object.fromEntries(signals.filter(key => !key.startsWith('baseline.')).map(key => [key,
    { baseline: 'baseline.' + key.split('.').at(-1), candidate: key, commonAccepted: 0,
      delta: 0, betterTargets: 0, worseTargets: 0, tiedTargets: 0, measuredTargets: 0 }]));
  for (const window of windows) {
    requireValue(count(window?.analyzed) && Array.isArray(window.comparisons));
    for (const key of signals) {
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

export function summarizeGradientReport(report) {
  requireValue(report?.version === 'issue143_eye_gradient.v7'
    && report.temporalScope === 'spatial_only_no_drift_measurement' && report.intervalMs === 0
    && Array.isArray(report.before) && report.before.length === 9
    && new Set(report.before.map(w => w?.targetIndex)).size === 9
    && report.before.every(w => count(w?.targetIndex) && w.targetIndex < 9)
    && Array.isArray(report.after) && report.after.length === 0);
  const models = {};
  for (const name of names) {
    const m = report.models?.[name], c = m?.correction;
    requireValue(m && c && m.featureMethod === methods[names.indexOf(name)] && typeof c.selected === 'boolean'
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
  return { version: 'issue143_gradient_analysis.v1', sourceVersion: report.version,
    scope: 'single_run_spatial_only_not_drift_or_population_acceptance', models,
    before: summarizeWindows(report.before), after: summarizeWindows(report.after),
    // No invented zero drift or per-frame significance from one participant.
    driftAssessment: { available: false, reason: 'no_temporal_interval_or_after_targets' } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    requireValue(process.argv.length === 3);
    const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
    console.log(JSON.stringify(summarizeGradientReport(report), null, 2));
  } catch {
    // Do not echo arbitrary imported content, file paths or parse errors.
    console.error('Cannot analyze: expected one complete local issue143_eye_gradient.v7 JSON file.');
    process.exitCode = 1;
  }
}
