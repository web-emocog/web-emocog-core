// Local, read-only aggregation of bounded AOI reports. Never trust the supplied
// aggregates or treat a stopped run as a complete result.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AOI_PRESENTATIONS, AOI_PRESENTATION_MS, AOI_TRANSITION_MS, AOI_MAX_OVERRUN_MS, AOI_SIGNAL_KEYS,
  summarizeAoiBlock, validAoiFixationDiagnostics } from '../../apps/web/developer/gaze-continuous-aoi.mjs';

const count = n => Number.isSafeInteger(n) && n >= 0;
const nonnegative = n => Number.isFinite(n) && n >= 0;
const labels = ['target', 'other', 'outsideAoi', 'offScreen', 'missing'];
const paired = ['bothHit', 'onlyBaselineHit', 'onlyPatchHit', 'neitherHit'];
const sum = values => values.reduce((a, b) => a + b, 0);
const matches = ['all', 'early', 'late', 'lowerEarly', 'lowerLate'];
const browserNames = ['safari', 'chrome', 'edge', 'firefox'];
const platformNames = ['macos', 'windows', 'linux', 'ios', 'android'];
const failureReasons = ['user_stop', 'page_hidden', 'viewport_changed', 'camera_resized', 'camera_ended', 'access_denied',
  'sensor_policy_denied', 'camera_denied', 'camera_unavailable', 'timeout', 'model_unavailable', 'correction_coverage',
  'benchmark_coverage', 'aoi_timing_overrun', 'aoi_geometry', 'calibration_retry_limit', 'calibration_failed'];
const allowed = (values, value) => values.includes(value) ? value : 'unknown';

export function summarizeContinuousAoiReport(report) {
  const metadata = report?.benchmark, block = report?.aoiBlock;
  if (report?.version !== 'gaze_continuous_aoi.v1' || metadata?.protocol !== 'aoi-continuous.v1') {
    throw new Error('unsupported_aoi_report');
  }
  if (metadata.completed !== true || metadata.phase !== 'completed' || metadata.counters?.calibrationAccepted !== 50) {
    throw new Error('incomplete_aoi_report');
  }
  if (block?.version !== 'gaze_continuous_aoi_block.v1' || block.coordinateMappingVersion !== 'local-board-rect.v1'
    || block.nominalPresentationMs !== AOI_PRESENTATION_MS || block.transitionExcludedMs !== AOI_TRANSITION_MS
    || block.scheduledPresentations !== AOI_PRESENTATIONS.length || !Array.isArray(block.presentations)
    || block.presentations.length !== AOI_PRESENTATIONS.length || !nonnegative(block.durationMs)) throw new Error('invalid_aoi_block');
  const rows = block.presentations;
  for (const [i, row] of rows.entries()) {
    const expected = AOI_PRESENTATIONS[i];
    if (row?.presentation !== i + 1 || ['half', 'targetSide', 'band', 'inset'].some(key => row[key] !== expected[key])
      || !nonnegative(row.presentedMs) || row.presentedMs < AOI_PRESENTATION_MS - 1
      || row.presentedMs > AOI_PRESENTATION_MS + AOI_MAX_OVERRUN_MS
      || ![row.measured, row.outsideWindow, row.duplicate].every(count)) throw new Error('invalid_aoi_presentation');
    for (const signal of AOI_SIGNAL_KEYS) {
      const frames = row.signals?.[signal]?.frames, f = row.signals?.[signal]?.fixation;
      const values = labels.map(key => frames?.[key]);
      const dwell = ['targetDwellMs', 'otherDwellMs', 'outsideAoiDwellMs'].map(key => f?.[key]);
      if (!values.every(count) || sum(values) !== row.measured || !count(f?.fixationCount)
        || !nonnegative(f.validObservationMs) || f.validObservationMs > row.presentedMs
        || (f.truncated === true ? !dwell.every(d => d === null) || f.reachedTarget !== null
          : f.truncated !== false || !dwell.every(nonnegative) || sum(dwell) > f.validObservationMs + 1
            || typeof f.reachedTarget !== 'boolean' || f.reachedTarget !== (dwell[0] > 0))
        || !validAoiFixationDiagnostics(row.signals[signal].fixationDiagnostics, frames, f, row.presentedMs)) {
        throw new Error('invalid_aoi_signal');
      }
    }
    for (const type of ['raw', 'corrected']) {
      const p = row.pairs?.[type], values = paired.map(key => p?.[key]);
      const b = row.signals['baseline.' + type].frames, a = row.signals['eye_patch.' + type].frames;
      if (!count(p?.common) || !values.every(count) || sum(values) !== p.common
        || p.common > row.measured - Math.max(b.missing, a.missing)
        || p.common < row.measured - b.missing - a.missing
        || p.bothHit + p.onlyBaselineHit > b.target || p.bothHit + p.onlyPatchHit > a.target
        || ![p.baselineErrorSumPx, p.patchErrorSumPx].every(nonnegative)
        || (!p.common && (p.baselineErrorSumPx !== 0 || p.patchErrorSumPx !== 0))) throw new Error('invalid_aoi_pairs');
    }
  }
  if (block.durationMs + 1 < sum(rows.map(r => r.presentedMs))) throw new Error('invalid_aoi_duration');
  return { version: 'gaze_continuous_aoi_analysis.v1', durationMs: block.durationMs,
    scope: 'instructed_local_comparison_not_production_or_accuracy_certification',
    ...summarizeAoiBlock(rows) };
}

function correctedWindow(row) {
  const pair = row.pairs.corrected;
  return pair.common > 0 ? {
    baselineHit: (pair.bothHit + pair.onlyBaselineHit) / pair.common,
    patchHit: (pair.bothHit + pair.onlyPatchHit) / pair.common,
  } : null;
}

function summarizeReplicate(report) {
  const analysis = summarizeContinuousAoiReport(report);
  if (report.models?.baseline?.featureMethod !== 'same_eye_iris.v2'
    || report.models?.eye_patch?.featureMethod !== 'eye_patch_ridge.experimental.v1') throw new Error('unsupported_aoi_models');
  const rows = report.aoiBlock.presentations;
  const minCommon = Math.min(...rows.map(row => row.pairs.corrected.common));
  const { width, height } = report.benchmark.environment?.viewport ?? {};
  const diagonal = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? Math.hypot(width, height) : null;
  const percentDiagonal = px => Number.isFinite(diagonal) && diagonal > 0 && px !== null ? 100 * px / diagonal : null;
  const segments = Object.fromEntries(matches.map(name => {
    const { signals, pairs } = analysis[name];
    const baseline = signals['baseline.corrected'], patch = signals['eye_patch.corrected'];
    return [name, {
      comparableWindows: pairs.corrected.comparableWindows,
      commonFrames: pairs.corrected.common,
      hitDeltaPp: pairs.corrected.equalWindowTargetHitDelta === null ? null : 100 * pairs.corrected.equalWindowTargetHitDelta,
      baselineErrorPctDiagonal: percentDiagonal(pairs.corrected.equalWindowBaselineErrorPx),
      patchErrorPctDiagonal: percentDiagonal(pairs.corrected.equalWindowPatchErrorPx),
      missingDeltaPp: baseline.missingFraction === null ? null : 100 * (patch.missingFraction - baseline.missingFraction),
      baselineOffScreen: baseline.frames.offScreen, patchOffScreen: patch.frames.offScreen,
      baselineTargetDwell: baseline.targetDwellFractionOfValidObservation, patchTargetDwell: patch.targetDwellFractionOfValidObservation,
      baselineValidObservationMs: baseline.validObservationMs, patchValidObservationMs: patch.validObservationMs,
      baselineOtherDwellMs: baseline.otherDwellMs, patchOtherDwellMs: patch.otherDwellMs,
      ...(baseline.fixationDiagnostics ? { baselineFixationDiagnostics: baseline.fixationDiagnostics } : {}),
      ...(patch.fixationDiagnostics ? { patchFixationDiagnostics: patch.fixationDiagnostics } : {}),
    }];
  }));
  const pairedWindows = rows.map(correctedWindow);
  const improvedWindows = pairedWindows.filter(w => w && w.patchHit > w.baselineHit).length;
  const worsenedWindows = pairedWindows.filter(w => w && w.patchHit < w.baselineHit).length;
  const condition = w => `${w.targetSide}:${w.band}:${w.inset}`;
  const early = new Map(rows.filter(w => w.half === 'early').map(w => [condition(w), correctedWindow(w)]));
  const changes = rows.filter(w => w.half === 'late').flatMap(w => {
    const before = early.get(condition(w)), after = correctedWindow(w);
    return before && after ? [[after.baselineHit - before.baselineHit, after.patchHit - before.patchHit]] : [];
  });
  return { scoredWindows: pairedWindows.filter(Boolean).length, improvedWindows, worsenedWindows, minCommonFramesPerWindow: minCommon,
    // A floor for reading a comparison, not a camera/quality gate or a
    // reason to discard a run. Low-support runs remain visible.
    support: minCommon >= 20 ? 'all_windows_at_least_20_common_frames' : 'sparse_windows',
    matchedConditionChange: {
      conditions: changes.length,
      baselineLateMinusEarlyPp: changes.length ? 100 * sum(changes.map(x => x[0])) / changes.length : null,
      patchLateMinusEarlyPp: changes.length ? 100 * sum(changes.map(x => x[1])) / changes.length : null,
    },
    segments };
}

export function summarizeContinuousAoiReplicates(reports) {
  const seen = new Set();
  const runs = reports.map((report, i) => {
    const row = { input: i + 1 };
    const b = report?.benchmark;
    if (!report || typeof report !== 'object' || Array.isArray(report)) return { ...row, status: 'invalid' };
    if (report?.version !== 'gaze_continuous_aoi.v1' || b?.protocol !== 'aoi-continuous.v1') return { ...row, status: 'unsupported' };
    if (typeof b.runId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(b.runId)) return { ...row, status: 'invalid' };
    if (seen.has(b.runId)) return { ...row, status: 'duplicate_run' };
    const environment = { platform: allowed(platformNames, b.environment?.platform), browser: allowed(browserNames, b.environment?.browser) };
    if (b.completed === false) {
      seen.add(b.runId);
      return { ...row, environment, status: 'incomplete', reason: allowed(failureReasons, b.reason) };
    }
    try {
      const replicate = summarizeReplicate(report);
      seen.add(b.runId);
      return { ...row, environment, status: 'complete', ...replicate };
    } catch (error) {
      return { ...row, environment, status: error?.message === 'unsupported_aoi_models' ? 'unsupported' : 'invalid' };
    }
  });
  const counts = Object.fromEntries(['complete', 'incomplete', 'duplicate_run', 'invalid', 'unsupported']
    .map(status => [status, runs.filter(r => r.status === status).length]));
  return { version: 'gaze_continuous_aoi_replicates.v1', scope: 'per_run_not_unique_people_no_pooled_frames', counts, runs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, ...files] = process.argv.slice(2);
    const read = file => JSON.parse(readFileSync(file, 'utf8'));
    let result;
    if (mode === '--replicates' && files.length) {
      result = summarizeContinuousAoiReplicates(files.map(file => { try { return read(file); } catch (_) { return null; } }));
    } else if (mode && !mode.startsWith('--') && files.length === 0) result = summarizeContinuousAoiReport(read(mode));
    else throw new Error('expected_one_aoi_json');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    const reason = /^(?:unsupported|incomplete|invalid)_aoi_[a-z]+$/.test(error?.message) ? error.message : 'invalid_or_unreadable_aoi_json';
    process.stderr.write(`AOI report not aggregated: ${reason}\n`);
    process.exitCode = 1;
  }
}
