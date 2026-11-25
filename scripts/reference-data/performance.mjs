import { FRAME_HEADROOM, assessFrameHeadroom } from '../../apps/participant-web/js/session-runtime/frame-latency.mjs';

export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { n: sorted.length,
    mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
    p50: sorted.length ? sorted[Math.floor((sorted.length - 1) * .5)] : null,
    p95: sorted.length ? sorted[Math.floor((sorted.length - 1) * .95)] : null,
    p99: sorted.length ? sorted[Math.ceil(sorted.length * .99) - 1] : null,
    max: sorted.length ? sorted.at(-1) : null };
}

// DevTools CPU time includes every thread of each browser-owned process.
// Reject process churn instead of silently losing a process's consumed time.
export function processCpuDelta(before, after, elapsedMs) {
  const valid = rows => Array.isArray(rows) && rows.length > 0 && rows.every(row =>
    Number.isSafeInteger(row.id) && typeof row.type === 'string' && Number.isFinite(row.cpuTime) && row.cpuTime >= 0)
    && new Set(rows.map(row => row.id)).size === rows.length;
  if (!valid(before) || !valid(after) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return { status: 'not_measured' };
  const prior = new Map(before.map(row => [row.id, row]));
  if (before.length !== after.length || after.some(row => !prior.has(row.id)
    || prior.get(row.id).type !== row.type || prior.get(row.id).cpuTime > row.cpuTime)) return { status: 'process_set_changed' };
  const secondsByType = {};
  for (const row of after) secondsByType[row.type] = (secondsByType[row.type] || 0) + row.cpuTime - prior.get(row.id).cpuTime;
  const cpuSeconds = Object.values(secondsByType).reduce((a, b) => a + b, 0);
  return { status: 'measured', cpuSeconds, secondsByType, processCount: after.length,
    cpuCoreEquivalents: cpuSeconds * 1000 / elapsedMs,
    scope: 'browser_process_cpu_all_threads_not_gpu_utilization_or_whole_system' };
}

// Playback totals include drops; never relabel them as presented/inferred frames.
export function frameCadencePerformance({ sourceFrames, processedFrames, elapsedMs, method, playbackQuality, fallbackReason = null }) {
  if (![sourceFrames, processedFrames].every(n => Number.isSafeInteger(n) && n >= 0)
      || !Number.isFinite(elapsedMs) || elapsedMs <= 0) throw new Error('invalid_reference_frame_cadence');
  const quality = playbackQuality;
  const confirmedPlayback = method === 'decoded-frame-counter' && !fallbackReason
    && quality?.complete === true && quality.counterResets === 0
    && [quality.displayedFrames, quality.droppedFrames].every(n => Number.isSafeInteger(n) && n >= 0)
    && quality.displayedFrames + quality.droppedFrames === sourceFrames;
  const presentedFrames = method === 'video-frame-callback' && !fallbackReason ? sourceFrames
    : confirmedPlayback ? quality.displayedFrames : null;
  return { sourceFrames, sourceWallFps: sourceFrames * 1000 / elapsedMs,
    presentedFrames, presentedWallFps: presentedFrames === null ? null : presentedFrames * 1000 / elapsedMs,
    skippedPresentedFrames: presentedFrames !== null && processedFrames <= presentedFrames ? presentedFrames - processedFrames : null,
    frameIdentityMethod: method,
    frameCadence: { measurementVersion: 'video_cadence.v2', fallbackReason, playbackQuality: quality || null } };
}

// Include empty windows; a fast burst must not hide a stall. Exclude only the
// final partial second, whose duration is explicitly retained in the report.
export function fpsWindows(frameTimesMs, elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 610000
      || !Array.isArray(frameTimesMs) || frameTimesMs.length > 60000
      || frameTimesMs.some((t, i) => !Number.isFinite(t) || t < 0 || t > elapsedMs
        || (i > 0 && t < frameTimesMs[i - 1]))) throw new Error('invalid_performance_clock');
  const counts = Array(Math.floor(elapsedMs / 1000)).fill(0);
  for (const t of frameTimesMs) if (Math.floor(t / 1000) < counts.length) counts[Math.floor(t / 1000)]++;
  let streak = 0, longest = 0;
  for (const n of counts) { streak = n < 25 ? streak + 1 : 0; longest = Math.max(longest, streak); }
  return { windowMs: 1000, counts, fullWindows: counts.length,
    partialTailMs: elapsedMs - counts.length * 1000,
    distribution: distribution(counts), below25Windows: counts.filter(n => n < 25).length,
    longestBelow25RunMs: longest * 1000,
    interpretation: 'diagnostic_25fps_reference_not_protocol_qc_override' };
}

export function assessPipelinePerformance(result) {
  const p = result?.primaryMs;
  const headroom = assessFrameHeadroom({ samples: p?.n, meanMs: p?.mean, p95Ms: p?.p95, p99Ms: p?.p99 });
  const reasons = [];
  if (headroom !== 'within_budget') reasons.push(headroom === 'not_measured' ? 'missing_primary_latency' : 'primary_headroom');
  if (!Number.isFinite(p?.max) || p.max > 250) reasons.push('primary_stall');
  if (!Number.isFinite(result?.analysisFps) || result.analysisFps < 25) reasons.push('analysis_below_target');
  if (!Number.isFinite(result?.cameraDeliveryFps) || result.cameraDeliveryFps < 25) reasons.push('source_below_target');
  if (!Number.isFinite(result?.uiTimerLatenessMs?.p95) || result.uiTimerLatenessMs.p95 > 10) reasons.push('ui_timer_late');
  if (!Number.isFinite(result?.fpsWindows?.longestBelow25RunMs) || result.fpsWindows.longestBelow25RunMs >= 3000) reasons.push('sustained_analysis_drop');
  if (!Number.isFinite(result?.faceCoverage) || result.faceCoverage < .95) reasons.push('missing_face_workload');
  if (result?.workers?.face !== 'worker' || result?.workers?.segment !== 'worker') reasons.push('main_thread_fallback');
  if (!result?.errors || Object.values(result.errors).some(count => count > 0)) reasons.push('module_failure');
  return { status: reasons.length ? 'fail' : 'pass', reasons, headroomCriteria: FRAME_HEADROOM,
    scope: 'this_host_clip_engine_only_not_windows_or_scientific_acceptance' };
}

export function assessReplayPerformance(result) {
  const reasons = [], p = result?.performance;
  const criteria = { minAnalysisFps: 25, maxUiTimerP95Ms: 10, maxCaptureGapMs: 250,
    maxBelowTargetRunMs: 3000, maxSegmentMeanMs: 1000, requireWorkers: true };
  if (result?.offlinePlaybackRate !== 1) return { status: 'not_applicable', reasons: ['not_realtime'], criteria };
  if (!Number.isFinite(p?.processedWallFps) || !Number.isFinite(p?.presentedWallFps) || !Number.isFinite(p?.uiTimerLatenessMs?.p95)
      || !Number.isFinite(p?.maxCaptureGapMs) || !Number.isSafeInteger(p?.fpsWindows?.fullWindows)
      || p.fpsWindows.fullWindows <= 0 || !Number.isFinite(p.fpsWindows.longestBelow25RunMs)
      || (result.auxiliary && !Number.isFinite(result.auxiliary.segmentMeanMs))) {
    return { status: 'not_measured', reasons: ['missing_performance_evidence'], criteria };
  }
  if (!Number.isFinite(p.presentedWallFps) || p.presentedWallFps < criteria.minAnalysisFps) reasons.push('source_below_target');
  if (p.processedWallFps < criteria.minAnalysisFps) reasons.push('analysis_below_target');
  if (p.uiTimerLatenessMs.p95 > criteria.maxUiTimerP95Ms) reasons.push('ui_timer_late');
  if (p.maxCaptureGapMs > criteria.maxCaptureGapMs) reasons.push('capture_gap');
  if (p.fpsWindows.longestBelow25RunMs >= criteria.maxBelowTargetRunMs) reasons.push('sustained_analysis_drop');
  if (result.backend !== 'worker' || (result.auxiliary &&
      (result.auxiliary.segmentBackend !== 'worker' || result.auxiliary.poseBackend !== 'worker'))) reasons.push('main_thread_fallback');
  // Match the existing session pipeline's 1000 ms segmentation freshness cap;
  // a worker can respond successfully while its masks are already too old.
  if (result.auxiliary?.segmentMeanMs > criteria.maxSegmentMeanMs) reasons.push('segment_mean_exceeds_freshness_budget');
  if (result.failures !== 0) reasons.push('module_failure');
  return { status: reasons.length ? 'fail' : 'pass', reasons, criteria,
    scope: 'this_host_clip_engine_only_not_scientific_accuracy_or_protocol_qc_override' };
}
