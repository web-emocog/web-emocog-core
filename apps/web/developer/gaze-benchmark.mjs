// Explicit diagnostic mount only; never called by the participant flow.
// The local harness and authenticated developer page share this implementation.
import { createMatchedWindow, observeMatchedWindow, finishMatchedWindow } from './gaze-benchmark-summary.mjs?v=20261108-143m';
import { benchmarkMetadata, benchmarkFailureReason } from './gaze-benchmark-report.mjs?v=20261110-160';
import { createValidationAttemptRecorder, collectValidationTargets, calibrationRejection, countCalibrationRejection,
  recordMaskedCalibrationClick, summarizeLidSupportClick } from './gaze-benchmark-coverage.mjs?v=20261110-143s';
import { DiagnosticRun, SerialDiagnosticStage } from './diagnostic-run.mjs?v=20261104-4';
import { CALIBRATION_CAPTURE_VERSION, CALIBRATION_CLICKS, CALIBRATION_POSITIONS, CORRECTION_POSITIONS,
  BENCHMARK_POSITIONS, calibrationCapturePolicy, collectCalibrationClick, compareCalibrationClicks, assessCalibrationFrame
} from '../../participant-web/js/gaze-tracker/calibration-capture.mjs?v=20261110-160';
import { createValidationSamplingWindow, validationTargetCoverage } from '../../participant-web/js/gaze-tracker/validation-sampling.mjs';
import { fitValidationCorrection, assessCorrectionBenchmark } from '../../participant-web/js/gaze-tracker/validation-metrics.mjs';
import { getContentViewport, targetCenterInContentViewport } from '../../participant-web/js/gaze-tracker/viewport-coordinates.mjs';
import { createModelComparison, commonAppearanceCalibrationFrames, commonGradientCalibrationFrames, commonTophatCalibrationFrames,
  commonMaskedCalibrationFrames, commonNuisanceCalibrationFrames, comparisonSignals, comparisonSignalKeys, comparisonPairs } from './gaze-benchmark-models.mjs?v=20261110-143v';
import { eyePatchFeaturesForFrame } from '../../participant-web/js/gaze-tracker/eye-patch-features.mjs?v=20261107-143';
import { eyeGradientFeaturesForFrame } from '../../participant-web/js/gaze-tracker/eye-gradient-features.mjs?v=20261107-143g';
import { eyeTophatFeaturesForFrame } from '../../participant-web/js/gaze-tracker/eye-tophat-features.mjs?v=20261108-143l';
export function mountGazeBenchmark({ mode: requestedMode = null, pose = false, temporal = false,
  cohort = false, canStart = () => false, authorize = null } = {}) {
if (cohort && (!['tophat', 'aoi-continuous', 'eye-gate'].includes(requestedMode) || typeof authorize !== 'function')) {
  throw new TypeError('Developer benchmark requires explicit authorization and fixed candidates');
}
const axisMode = requestedMode === 'axis';
const appearanceMode = requestedMode === 'appearance';
const gradientMode = requestedMode === 'gradient';
const tophatMode = requestedMode === 'tophat';
const maskedMode = requestedMode === 'masked';
const lidSupportProbe = requestedMode === 'lid-support';
const aoiMode = requestedMode === 'aoi-continuous';
const eyeGateMode = requestedMode === 'eye-gate';
const geometryGateMode = requestedMode === 'nuisance-geometry';
const nuisanceGateMode = requestedMode === 'nuisance-gate' || geometryGateMode;
const nuisanceMode = requestedMode === 'nuisance' || nuisanceGateMode;
if ((maskedMode || lidSupportProbe || nuisanceMode || (aoiMode || eyeGateMode) && !cohort)
  && !['127.0.0.1', 'localhost', '[::1]'].includes(globalThis.location?.hostname)) {
  throw new TypeError('Experimental eye benchmark is available only on loopback');
}
const trioMode = gradientMode || tophatMode || maskedMode || nuisanceMode;
const controlRegion = nuisanceMode ? 'rows' : 'gradient_all';
const controlFrameLabel = nuisanceMode ? 'rows' : 'all';
const extraRegion = nuisanceMode ? 'nuisance' : maskedMode ? 'masked' : tophatMode ? 'tophat' : 'gradient';
const extraFrameLabel = gradientMode ? 'lateral' : extraRegion;
const commonCalibrationFrames = nuisanceMode ? commonNuisanceCalibrationFrames : maskedMode ? commonMaskedCalibrationFrames : tophatMode ? commonTophatCalibrationFrames
  : gradientMode ? commonGradientCalibrationFrames : appearanceMode ? commonAppearanceCalibrationFrames : null;
const exportTechnical = cohort || maskedMode || lidSupportProbe || nuisanceMode || aoiMode || eyeGateMode;
const reportVersion = eyeGateMode ? 'gaze_eye_gate_probe.v1' : aoiMode ? 'gaze_continuous_aoi.v1' : lidSupportProbe ? 'gaze_lid_support.v1' : 'gaze_benchmark.v1';
const probePositions = CALIBRATION_POSITIONS.filter(({ x, y }) => [8, 50, 92].includes(x) && [8, 50, 92].includes(y));
const probeMaxAttempts = 2;
const gradientPose = nuisanceMode || (gradientMode || tophatMode) && pose;
const gradientTemporal = (gradientMode || maskedMode || (cohort && tophatMode)) && !gradientPose && temporal;
const eyeImageMode = appearanceMode || trioMode || aoiMode;
// Retain the short v7 by default. The longer check needs a separate explicit URL.
const intervalMs = gradientTemporal ? 240000 : trioMode || aoiMode ? 0 : 240000;
const ablation = requestedMode === 'ablation' || axisMode || eyeImageMode;
const byId = id => document.getElementById(id);
const status = text => { byId('status').textContent = text; };
let run = null, report = null;
const modelStage = new SerialDiagnosticStage();
const protocol = eyeGateMode ? 'eye-gate.v1' : aoiMode ? 'aoi-continuous.v1' : gradientPose ? 'posture.v1' : gradientTemporal ? 'temporal.v1' : 'spatial.v1';
const clickRetryHints = {
  eye_signal: 'Не хватило устойчивых кадров с видимыми глазами. Моргните до нажатия и повторите его, глядя в центр точки естественно.',
  pose_signal: 'Не хватило кадров с устойчивым положением головы. Устройтесь удобно и повторите нажатие.',
  eye_and_pose_signal: 'Не хватило кадров с видимыми глазами и устойчивым положением головы. Устройтесь удобно и повторите нажатие.',
  insufficient_fresh_frames: 'Не хватило новых кадров. Подождите немного и повторите нажатие.',
  eye_descriptors: 'Не удалось выделить признаки глаз на общих кадрах. Проверьте свет и повторите нажатие.',
  tracker_rejected: 'Модель не приняла измерение. Повторите нажатие, глядя в центр точки.',
};

function metadata(owned, completed, reason = null) {
  return { ...benchmarkMetadata({ protocol, completed, reason, runId: owned.runId,
    phase: owned.phase, elapsedMs: performance.now() - owned.startedAt,
    viewport: owned.viewport, camera: owned.camera, backend: owned.analyzer?.backend,
    frameCount: owned.count, frameErrors: owned.rejected,
    calibrationAttempts: owned.calibrationAttempts || 0, calibrationAccepted: owned.calibrationAccepted || 0,
    userAgent: navigator.userAgent, devicePixelRatio: owned.geometry?.dpr ?? devicePixelRatio,
    viewportScale: owned.geometry?.scale ?? globalThis.visualViewport?.scale }),
    ...(maskedMode ? { modelSet: 'baseline_patch_gradient_masked.v1' } : {}),
    ...(nuisanceMode ? { modelSet: geometryGateMode ? 'baseline_patch_rows_nuisance_geometry.v1'
      : nuisanceGateMode ? 'baseline_patch_rows_nuisance_gate.v1' : 'baseline_patch_rows_nuisance.v1' } : {}),
    ...(lidSupportProbe ? { scope: 'paired_eye_descriptor_coverage_only_not_gaze_accuracy' } : {}),
    ...(eyeGateMode ? { scope: 'existing_eye_and_pose_gates_only_no_fit_or_gaze_accuracy',
      diagnosticSurface: cohort ? 'developer_panel' : 'loopback',
      limitations: ['instructions_not_independently_labelled_blinks', 'aggregate_only_not_threshold_replay'] } : {}),
    ...(aoiMode ? { scope: 'continuous_instructed_fixation_aoi_benchmark_not_participant_accuracy_certification',
      diagnosticSurface: cohort ? 'developer_panel' : 'loopback',
      limitations: ['instructed_fixation_not_independent_eye_tracker_ground_truth', 'single_diagnostic_block_not_production_session',
        'no_offscreen_ground_truth', 'not_free_viewing_aoi_reliability'] } : {}) };
}

function selectionDiagnostics(owned) {
  return geometryGateMode ? { geometryGate: owned.appearanceGateInfo }
    : nuisanceGateMode ? { appearanceGate: owned.appearanceGateInfo } : {};
}

function targetCoverageDiagnostics(owned) {
  return { version: 'gaze_target_coverage.v1', maxAttemptsPerValidationTarget: 2,
    calibrationRejections: Object.values(owned.calibrationRejections), validation: owned.validationDiagnostics,
    ...(owned.maskedCalibration ? { maskedCalibration: { version: 'gaze_masked_calibration_coverage.v1',
      missingCommonClicks: owned.maskedCalibration.missingCommonClicks, targets: Object.values(owned.maskedCalibration.targets),
      scope: 'control_accepted_clicks_only_not_accuracy' } } : {}) };
}

function failureDiagnostics(owned) {
  // Keep descriptor shortages visible on failed devices too, not only on complete runs.
  return { eyeImageFrames: aoiMode && owned.eyePatchFrames ? {
      attempted: owned.eyePatchFrames.attempted, available: owned.eyePatchFrames.available, missing: owned.eyePatchFrames.missing }
    : owned.gradientFrames ? { ...owned.gradientFrames } : null,
    cadence: owned.cadence ? { ...owned.cadence } : null,
    predictorErrors: owned.modelTiming ? Object.fromEntries(Object.entries(owned.modelTiming).map(([name, timing]) => [name, timing.errors])) : null,
    workerFallbackReason: owned.analyzer?.workerFallbackReason === 'worker_initialization_failed' ? 'worker_initialization_failed' : null,
    targetCoverage: targetCoverageDiagnostics(owned),
    ...(lidSupportProbe ? { lidSupport: { maxAttemptsPerClick: probeMaxAttempts,
      scheduledClicks: probePositions.length * CALIBRATION_CLICKS, targets: owned.lidSupportTargets } } : {}),
    ...(nuisanceMode ? { nuisanceCalibration: owned.nuisanceCalibration } : {}),
    ...(aoiMode ? { completedPresentations: owned.aoiCompleted || 0, expectedPresentations: owned.aoiModule?.AOI_PRESENTATIONS.length ?? 40 } : {}),
    ...(eyeGateMode ? { eyeGate: owned.eyeGate } : {}),
    ...selectionDiagnostics(owned),
    scope: 'bounded_technical_counts_only_no_incomplete_accuracy_estimate' };
}

function stop(message = 'Остановлено. Камера выключена.', reason = 'user_stop') {
  const owned = run; run = null;
  if (owned) {
    if (exportTechnical && !report) {
      report = { version: reportVersion, benchmark: metadata(owned, false, reason),
        diagnostics: failureDiagnostics(owned),
        rawVideoStored: false, rawLandmarksStored: false, rawGazeStored: false };
      byId('result').textContent = JSON.stringify(report, null, 2); byId('download').hidden = false;
    }
    clearTimeout(owned.safetyTimer); owned.abort.abort(); owned.modelRun?.stop(); owned.observer?.stop(); owned.analyzer?.dispose();
    for (const track of owned.stream?.getTracks() || []) track.stop();
    owned.lastFrame = null; owned.lastPredictions = null; for (const tracker of Object.values(owned.trackers || {})) tracker.reset(); owned.collect = null;
    owned.eyePatchFeatures = null;
    owned.maskedFrameReasons = null;
    owned.lidSupportFrames = null;
    owned.nuisanceProjector = null;
    owned.appearanceAnchors = null; owned.appearanceGate = null;
    owned.geometryAnchors = null;
    owned.aoiRecorder = null;
    owned.eyeGateCue = null;
    owned.confirmationTracker?.reset(); owned.confirmationTracker = null;
  }
  byId('video').srcObject = null;
  byId('target').hidden = true; byId('target').onclick = null;
  byId('target').style.opacity = '1';
  byId('poseStep').hidden = true; byId('poseContinue').onclick = null;
  if (aoiMode) { byId('aoiBoard').hidden = true; byId('poseContinue').textContent = 'Готово, показать точки'; }
  delete document.body.dataset.posePhase;
  delete document.body.dataset.eyeGateCue;
  byId('calibrate').hidden = true; byId('stop').disabled = true;
  byId('start').disabled = !canStart(); document.body.classList.remove('running');
  document.documentElement.classList.remove('gaze-benchmark-measuring');
  if (byId('protocol')) byId('protocol').disabled = false;
  if (byId('consent')) byId('consent').disabled = false;
  status(message);
}

function delay(ms, owned) {
  return new Promise((resolve, reject) => {
    const cancelled = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
    const timer = setTimeout(() => { owned.abort.signal.removeEventListener('abort', cancelled); resolve(); }, ms);
    owned.abort.signal.addEventListener('abort', cancelled, { once: true });
    if (owned.abort.signal.aborted) cancelled();
  });
}

async function deadline(promise, ms, owned) {
  let timer, cancelled;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('deadline')), ms);
      cancelled = () => reject(new DOMException('Stopped', 'AbortError'));
      owned.abort.signal.addEventListener('abort', cancelled, { once: true });
      if (owned.abort.signal.aborted) cancelled();
    })]);
  } finally { clearTimeout(timer); owned.abort.signal.removeEventListener('abort', cancelled); }
}

function position(x, y) {
  const target = byId('target'); target.style.left = `${x}%`; target.style.top = `${y}%`; target.hidden = false;
  return targetCenterInContentViewport(target);
}

function measurementGeometry() {
  return { ...getContentViewport(), windowWidth: innerWidth, windowHeight: innerHeight, dpr: devicePixelRatio };
}

function lockMeasurementGeometry(owned) {
  // Read layout AFTER hiding the preview and removing root scrollbars. Some
  // browsers deliver that resize in the next rendering step, after this click.
  const geometry = owned.geometry = measurementGeometry();
  owned.viewport = { width: geometry.width, height: geometry.height };
  const options = { signal: owned.abort.signal };
  const checkGeometry = () => {
    if (run !== owned) return;
    const current = measurementGeometry();
    if (Object.keys(geometry).some(key => geometry[key] !== current[key])) {
      stop('Размер окна, видимая область или масштаб изменились. Камера выключена; начните заново.', 'viewport_changed');
    }
  };
  addEventListener('resize', checkGeometry, options);
  globalThis.visualViewport?.addEventListener('resize', checkGeometry, options);
  globalThis.visualViewport?.addEventListener('scroll', checkGeometry, options);
  matchMedia(`(resolution: ${geometry.dpr}dppx)`).addEventListener('change', checkGeometry, options);
}

async function start() {
  if (!canStart() || run || document.hidden) return;
  report = null; byId('download').hidden = true; byId('result').textContent = '';
  const owned = { abort: new AbortController(), lastFrame: null, busy: false, lastStart: -Infinity, count: 0, rejected: 0,
    phase: 'access', startedAt: performance.now(), runId: exportTechnical ? crypto.randomUUID() : null,
    viewport: { width: innerWidth, height: innerHeight }, calibrationRejections: {}, validationDiagnostics: {} };
  if (maskedMode) owned.maskedCalibration = { missingCommonClicks: 0, targets: {} };
  if (lidSupportProbe) owned.lidSupportTargets = [];
  if (eyeGateMode) owned.eyeGate = { version: 'eye_gate_diagnostic.v1', captureVersion: CALIBRATION_CAPTURE_VERSION,
    scheduledClickSlots: 3 * probePositions.length * CALIBRATION_CLICKS, maxAttemptsPerClick: probeMaxAttempts,
    cues: [], conditions: [], scope: 'unchanged_gate_observation_only_no_accuracy' };
  if (nuisanceMode) owned.nuisanceCalibration = { version: 'gaze_paired_nuisance_calibration.v1', rank: null, stages: [] };
  if (nuisanceGateMode) owned.appearanceGateInfo = { version: geometryGateMode ? 'gaze_patch_geometry_gate.v1' : 'gaze_patch_appearance_gate.v1',
    available: false, confirmationAvailable: false };
  run = owned; byId('start').disabled = true; byId('stop').disabled = false;
  if (exportTechnical) owned.safetyTimer = setTimeout(() => { if (run === owned) stop('Лимит времени запуска истёк. Камера выключена.', 'timeout'); },
    lidSupportProbe ? 300000 : 1200000);
  if (byId('protocol')) byId('protocol').disabled = true;
  if (byId('consent')) byId('consent').disabled = true;
  byId('video').hidden = false;
  status('Ожидание разрешения камеры…');
  try {
    await deadline(authorize?.(owned.abort.signal), 15000, owned);
    if (run !== owned) return;
    const { protocolCameraConstraints, FRAME_SCHEDULE } = await import('../../participant-web/js/session-runtime/protocol-profile.mjs');
    if (run !== owned) return;
    owned.phase = 'camera_permission';
    const permission = navigator.mediaDevices.getUserMedia({ ...protocolCameraConstraints(), audio: false });
    permission.then(stream => { if (run !== owned) stream.getTracks().forEach(track => track.stop()); }, () => {});
    const stream = await deadline(permission, 30000, owned);
    if (run !== owned) { stream.getTracks().forEach(track => track.stop()); return; }
    owned.stream = stream;
    for (const track of stream.getTracks()) track.addEventListener('ended', () => {
      if (run === owned) stop('Камера отключена. Проверка остановлена; начните заново.', 'camera_ended');
    }, { once: true });
    const video = byId('video'); video.srcObject = stream;
    await deadline(video.play(), 15000, owned);
    owned.camera = { width: video.videoWidth, height: video.videoHeight };
    owned.phase = 'model_initialization';
    status('Подготовка локальной модели…');
    const [{ default: Analyzer }, { observeVideoFrames }, vision, { extractFeatureGroups }, maskedEye, patchRows,
      nuisanceFit, gateModule, geometryModule, aoiModule, eyeGateModule] = await deadline(Promise.all([
      import('../../participant-web/js/precheck-analyzer/PrecheckAnalyzer.js?v=20261104-4'),
      import('../../participant-web/js/session-runtime/video-frames.mjs?v=20261104-4'),
      import('../../participant-web/js/vendor/mediapipe/vision_bundle.mjs'),
      import('../../participant-web/js/gaze-tracker/features.js?v=20261108-143l'),
      maskedMode || lidSupportProbe ? import('./gaze-eye-masked.mjs?v=20261110-143r') : null,
      nuisanceMode ? import('./gaze-eye-patch-rows.mjs?v=20261110-143s') : null,
      nuisanceMode ? import('./gaze-eye-patch-nuisance.mjs?v=20261110-143s') : null,
      nuisanceGateMode ? import('./gaze-eye-patch-gate.mjs?v=20261110-143u') : null,
      geometryGateMode ? import('./gaze-eye-patch-geometry-gate.mjs?v=20261110-143u') : null,
      aoiMode ? Promise.all([import('./gaze-continuous-aoi.mjs?v=20261110-143v'),
        import('../../participant-web/js/web-page/heatmap.js?v=20261102-1')])
        .then(([aoi, heatmap]) => ({ ...aoi, createHeatmapAccumulator: heatmap.createHeatmapAccumulator })) : null,
      eyeGateMode ? import('./gaze-eye-gate-probe.mjs?v=20261110-160') : null,
    ]), 45000, owned);
    if (run !== owned) return;
    globalThis.FilesetResolver = vision.FilesetResolver; globalThis.FaceLandmarker = vision.FaceLandmarker;
    owned.analyzer = new Analyzer();
    owned.modelRun = new DiagnosticRun();
    await modelStage.request(owned.modelRun, async () => {
      if (!await owned.analyzer.initialize()) throw new Error('model');
      return owned.analyzer;
    }, { release: analyzer => analyzer.dispose(), timeoutMs: 45000 });
    if (run !== owned) return;
    owned.viewport = { width: innerWidth, height: innerHeight };
    const frameRate = stream.getVideoTracks?.()[0]?.getSettings?.().frameRate;
    owned.camera = { width: video.videoWidth, height: video.videoHeight,
      ...(Number.isFinite(frameRate) && frameRate > 0 ? { reportedFrameRate: frameRate } : {}) };
    owned.eyePatchFeatures = eyeImageMode ? new WeakMap() : null;
    if (nuisanceFit) owned.fitPatchNuisance = nuisanceFit.fitPatchNuisance;
    if (gateModule) owned.gateModule = gateModule;
    if (geometryModule) owned.geometryModule = geometryModule;
    if (aoiModule) owned.aoiModule = aoiModule;
    if (eyeGateModule) owned.createEyeGateProbeWindow = eyeGateModule.createEyeGateProbeWindow;
    if (maskedMode) owned.maskedFrameReasons = new WeakMap();
    if (lidSupportProbe) owned.lidSupportFrames = new WeakMap();
    owned.eyePatchFrames = { attempted: 0, available: 0, missing: 0, coreAvailable: 0, coreMissing: 0 };
    if (!lidSupportProbe && !eyeGateMode) owned.gradientFrames = { attempted: 0, fullAvailable: 0, [controlFrameLabel + 'Available']: 0,
      [extraFrameLabel + 'Available']: 0, fullMissing: 0, [controlFrameLabel + 'Missing']: 0, [extraFrameLabel + 'Missing']: 0 };
    if (nuisanceMode) owned.gradientFrames.nuisanceNotFitted = 0;
    owned.eyePatchTiming = { frames: 0, totalMs: 0, maxMs: 0 };
    owned.featureTiming = {};
    owned.calibrationTiming = {};
    owned.latency = { n: 0, totalMs: 0, maxMs: 0 };
    owned.cadence = { notifications: 0, sourceFrames: 0, busySkipped: 0, budgetSkipped: 0, method: null };
    owned.observer = observeVideoFrames(video, async (now, count = 1, method = 'unknown') => {
      if (run !== owned) return;
      owned.cadence.notifications++; owned.cadence.sourceFrames += count; owned.cadence.method = method;
      if (owned.busy) { owned.cadence.busySkipped++; return; }
      if (now - owned.lastStart < FRAME_SCHEDULE.targetIntervalMs) { owned.cadence.budgetSkipped++; return; }
      owned.busy = true; owned.lastStart = now;
      try {
        if (video.videoWidth !== owned.camera.width || video.videoHeight !== owned.camera.height) {
          stop('Размер кадра камеры изменился. Начните заново: калибровка больше не сопоставима.', 'camera_resized'); return;
        }
        const frame = await owned.analyzer.analyzeFrame(video);
        const analyzerCompletedAt = performance.now();
        if (run !== owned) return;
        if (frame?.frameSize && (frame.frameSize.width !== owned.camera.width || frame.frameSize.height !== owned.camera.height)) {
          stop('Размер проанализированного кадра изменился. Проверка остановлена; нужна новая калибровка.', 'camera_resized'); return;
        }
        owned.count++;
        if (lidSupportProbe && frame?.landmarks) {
          // Same captured frame and pixel owner for both methods. The probe
          // stores only descriptor availability and fixed failure codes.
          const control = Boolean(eyePatchFeaturesForFrame(frame)
            && eyeGradientFeaturesForFrame(frame, { support: 'all' }));
          owned.lidSupportFrames.set(frame.landmarks, control
            ? { ...maskedEye.measureLidSupportPair(frame), control } : { control });
        } else if (trioMode) {
          const begun = performance.now();
          const extract = (name, factory) => {
            const started = performance.now(), value = factory(), elapsed = performance.now() - started;
            const timing = owned.featureTiming[name] ||= { frames: 0, totalMs: 0, maxMs: 0 };
            timing.frames++; timing.totalMs += elapsed; timing.maxMs = Math.max(timing.maxMs, elapsed);
            return value;
          };
          const full = extract('eye_patch', () => eyePatchFeaturesForFrame(frame)),
            control = patchRows ? extract('eye_patch_rows', () => patchRows.projectPatchRows(full))
              : extract('eye_gradient_all', () => eyeGradientFeaturesForFrame(frame, { support: 'all' })),
            masked = maskedEye ? extract('eye_masked', () => maskedEye.measureMaskedEyeFrame(frame)) : null;
          if (masked && frame?.landmarks) owned.maskedFrameReasons.set(frame.landmarks, masked.reason);
          const extra = patchRows ? extract('eye_patch_nuisance', () => owned.nuisanceProjector?.project(control))
            : masked ? masked.centers : tophatMode ? extract('eye_tophat', () => eyeTophatFeaturesForFrame(frame))
            : extract('eye_gradient', () => eyeGradientFeaturesForFrame(frame));
          const elapsed = performance.now() - begun;
          owned.eyePatchTiming.frames++; owned.eyePatchTiming.totalMs += elapsed;
          owned.eyePatchTiming.maxMs = Math.max(owned.eyePatchTiming.maxMs, elapsed);
          owned.gradientFrames.attempted++;
          for (const [name, value] of [['full', full], [controlFrameLabel, control], [extraFrameLabel, extra]]) {
            if (nuisanceMode && name === 'nuisance' && !owned.nuisanceProjector) {
              owned.gradientFrames.nuisanceNotFitted++;
              continue;
            }
            owned.gradientFrames[name + (value ? 'Available' : 'Missing')]++;
          }
          if (full || control || extra) owned.eyePatchFeatures.set(frame.landmarks, {
            full, [controlRegion]: control, [extraRegion]: extra,
            ...(nuisanceGateMode ? { gradient_all: extract('eye_gradient_all', () => eyeGradientFeaturesForFrame(frame, { support: 'all' })) } : {}) });
          else if (frame?.landmarks) owned.eyePatchFeatures.delete(frame.landmarks);
        } else if (appearanceMode || aoiMode) {
          const patchStarted = performance.now();
          owned.eyePatchFrames.attempted++;
          const full = eyePatchFeaturesForFrame(frame), core = appearanceMode ? eyePatchFeaturesForFrame(frame, { region: 'core' }) : null;
          const elapsed = performance.now() - patchStarted;
          owned.eyePatchTiming.frames++; owned.eyePatchTiming.totalMs += elapsed;
          owned.eyePatchTiming.maxMs = Math.max(owned.eyePatchTiming.maxMs, elapsed);
          if (full) owned.eyePatchFrames.available++; else owned.eyePatchFrames.missing++;
          if (appearanceMode) { if (core) owned.eyePatchFrames.coreAvailable++; else owned.eyePatchFrames.coreMissing++; }
          if (full || core) owned.eyePatchFeatures.set(frame.landmarks, { full, core });
          else if (frame?.landmarks) owned.eyePatchFeatures.delete(frame.landmarks);
        }
        owned.lastFrame = frame;
        owned.eyeGateCue?.(frame);
        if (Number.isFinite(frame?.timestamp)) {
          const age = analyzerCompletedAt - frame.timestamp;
          if (age >= 0) { owned.latency.n++; owned.latency.totalMs += age; owned.latency.maxMs = Math.max(owned.latency.maxMs, age); }
        }
        if (!owned.trackers) return; // Preview checks descriptors, not gaze predictions.
        // Each regression sees the SAME completed inference. Never re-run
        // camera/MediaPipe per candidate; targets cannot enter predict context.
        const predictions = {};
        for (const [name, tracker] of Object.entries(owned.trackers)) {
          const begun = performance.now(), timing = owned.modelTiming[name], calibrated = tracker.isCalibrated();
          try { predictions[name] = tracker.predict(frame?.landmarks, { timestamp: frame?.timestamp, wallTimestamp: frame?.wallTimestamp }); }
          catch (_) { predictions[name] = null; timing.errors++; }
          const elapsed = performance.now() - begun;
          if (calibrated) { timing.predictions++; timing.totalMs += elapsed; timing.maxMs = Math.max(timing.maxMs, elapsed); }
        }
        owned.lastPredictions = predictions;
        if (aoiMode) owned.aoiRecorder?.observe(frame?.timestamp, predictions);
        const signals = ablation ? comparisonSignals(predictions) : { raw: predictions.baseline, corrected: predictions.baseline };
        if (owned.collect) {
          const groups = extractFeatureGroups(frame?.landmarks);
          const timestamp = frame?.timestamp;
          if (nuisanceGateMode && Number.isFinite(timestamp) && timestamp >= owned.collect.since && timestamp > owned.collect.lastFrame) {
            const input = geometryGateMode ? owned.geometryModule.readEyeCornerHeight(frame.landmarks)
              : owned.eyePatchFeatures.get(frame.landmarks)?.rows;
            const weight = owned.appearanceGate?.weight(input);
            const full = predictions.eye_patch, paired = predictions.eye_patch_nuisance;
            const limit = geometryGateMode ? .16 : null;
            const guarded = owned.gateModule.blendPatchRaw(full, paired, weight, owned.viewport, null, limit);
            let independent = null;
            if (guarded?.reason === 'boundary_guard' && owned.confirmationTracker) {
              try { independent = owned.confirmationTracker.predict(frame.landmarks, { timestamp, wallTimestamp: frame.wallTimestamp }); }
              catch (_) { owned.appearanceGateInfo.confirmationErrors++; }
            }
            const confirmed = independent ? owned.gateModule.blendPatchRaw(full, paired, weight, owned.viewport, independent, limit) : guarded;
            for (const [name, shadow] of [['eye_patch_adaptive.raw', guarded], ['eye_patch_adaptive_confirmed.raw', confirmed]]) {
              signals[name] = shadow ? { ...shadow, valid: true } : null;
              const counter = owned.collect.shadowActions[name];
              const reason = shadow?.reason || 'full_missing';
              counter[reason] = (counter[reason] || 0) + 1;
            }
          }
          observeMatchedWindow(owned.collect, frame?.timestamp, groups?.eye, signals, ablation ? groups : null);
        }
      } catch (_) { if (run === owned) owned.rejected++; }
      finally { owned.busy = false; }
    });
    byId('calibrate').hidden = false;
    owned.phase = 'ready';
    status(eyeGateMode ? 'Проверьте освещение и нажмите «Начать диагностику глаз».'
      : lidSupportProbe ? 'Сядьте удобно и нажмите «Начать короткую проверку».'
      : 'Проверьте освещение и положение головы. Нажмите «Начать калибровку». Камера продолжит работать, но preview будет скрыт.');
  } catch (error) { if (run === owned) stop('Не удалось подтвердить доступ или подготовить камеру/модель. Камера выключена; можно скачать техническую сводку.', benchmarkFailureReason(error)); }
}

const targets = [[30, 22], [70, 22], [22, 70], [78, 70], [50, 63], [12, 12], [88, 12], [12, 88], [88, 88]];
// Separate from all fit and independent correction-check targets.
const poseTargets = [[50, 56], [12, 12], [88, 12], [12, 88], [88, 88]];
const poseSteps = [
  ['natural', 'Останьтесь в той же удобной посадке, что при калибровке.'],
  ['lowered', 'Слегка опуститесь в кресле, не двигая камеру и не меняя окно. Не нужно специально наклонять или поворачивать голову.'],
  ['returned', 'Вернитесь к исходной удобной посадке. Не двигайте камеру и не меняйте окно.'],
];
// These are auxiliary CALIBRATION points: distinct from the standard grid,
// correction setup and both independent validation/measurement layouts.
const nuisanceAnchors = [[20, 20], [80, 20], [47, 44], [20, 80], [80, 80]];

async function awaitPosture(owned, instruction) {
  byId('target').hidden = true;
  byId('poseInstruction').textContent = instruction;
  byId('poseStep').hidden = false;
  const button = byId('poseContinue');
  try {
    await deadline(new Promise(resolve => { button.onclick = () => { button.onclick = null; resolve(); }; }), 60000, owned);
  } finally {
    if (run === owned) { button.onclick = null; byId('poseStep').hidden = true; }
  }
}

async function runContinuousAoiBlock(owned) {
  const { AOI_PRESENTATIONS, AOI_PRESENTATION_MS, AOI_TRANSITION_MS, AOI_MAX_OVERRUN_MS,
    aoiTrialLayout, insideAoiRectangle, createAoiTrialRecorder, summarizeAoiBlock, createHeatmapAccumulator } = owned.aoiModule;
  owned.phase = 'aoi_instruction';
  status('Калибровка и проверка коррекции завершены.');
  byId('poseContinue').textContent = 'Начать непрерывный блок';
  await awaitPosture(owned, 'Появятся две рамки и жёлтая точка. Смотрите в центр жёлтой точки, пока она не переместится. Не нажимайте на неё. Моргайте и сидите естественно. Все 40 показов пройдут подряд за 4 минуты. Не меняйте окно и положение камеры.');
  owned.phase = 'aoi_running';
  const boardElement = byId('aoiBoard'), leftElement = byId('aoiLeft'), rightElement = byId('aoiRight'), cue = byId('aoiCue');
  const presentations = [];
  const percent = value => (value * 100).toFixed(6) + '%';
  const place = (el, box) => Object.assign(el.style, { left: percent(box.left), top: percent(box.top),
    width: percent(box.right - box.left), height: percent(box.bottom - box.top) });
  const start = performance.now();
  boardElement.hidden = false;
  for (const trial of AOI_PRESENTATIONS) {
    const layout = aoiTrialLayout(trial);
    place(leftElement, layout.left); place(rightElement, layout.right);
    cue.style.left = percent(layout.cue.x); cue.style.top = percent(layout.cue.y);
    status(`Показ ${trial.index + 1}/${AOI_PRESENTATIONS.length} · Смотрите на жёлтую точку`);
    const bounds = boardElement.getBoundingClientRect(), viewport = getContentViewport();
    if (bounds.width <= 0 || bounds.height <= 0) throw new Error('aoi_geometry');
    const board = { left: bounds.left - viewport.offsetLeft, top: bounds.top - viewport.offsetTop,
      width: bounds.width, height: bounds.height, coordinateMappingVersion: 'local-board-rect.v1' };
    const normalize = el => {
      const r = el.getBoundingClientRect();
      return { left: (r.left - bounds.left) / bounds.width, right: (r.right - bounds.left) / bounds.width,
        top: (r.top - bounds.top) / bounds.height, bottom: (r.bottom - bounds.top) / bounds.height };
    };
    const geometry = { board, left: normalize(leftElement), right: normalize(rightElement) };
    const cueBounds = cue.getBoundingClientRect();
    const cueX = (cueBounds.left + cueBounds.width / 2 - bounds.left) / bounds.width;
    const cueY = (cueBounds.top + cueBounds.height / 2 - bounds.top) / bounds.height;
    if (!insideAoiRectangle(cueX, cueY, geometry[trial.targetSide])) throw new Error('aoi_geometry');
    geometry.cue = { x: cueX, y: cueY };
    const startedAt = performance.now();
    owned.aoiRecorder = createAoiTrialRecorder(trial, geometry, viewport, startedAt, createHeatmapAccumulator);
    // No intermediate wait for user input or recentering. The previous display
    // stays visible until replaced; the first 700 ms of each window are unscored.
    await delay(AOI_PRESENTATION_MS, owned);
    const presentedMs = performance.now() - startedAt;
    if (presentedMs > AOI_PRESENTATION_MS + AOI_MAX_OVERRUN_MS) throw new Error('aoi_timing_overrun');
    presentations.push(owned.aoiRecorder.finish(presentedMs));
    owned.aoiRecorder = null;
    owned.aoiCompleted = presentations.length;
  }
  boardElement.hidden = true;
  return { version: 'gaze_continuous_aoi_block.v1', scheduledPresentations: AOI_PRESENTATIONS.length,
    nominalPresentationMs: AOI_PRESENTATION_MS, transitionExcludedMs: AOI_TRANSITION_MS,
    durationMs: performance.now() - start, coordinateMappingVersion: 'local-board-rect.v1',
    scope: 'instructed_aoi_hits_and_participant_fixation_accumulator_not_production_aoi_acceptance',
    presentations, summary: summarizeAoiBlock(presentations) };
}

async function collectNuisanceAnchors(owned) {
  const means = { reference: [], alternate: [] };
  const geometry = geometryGateMode ? { reference: [], alternate: [] } : null;
  for (const [id, instruction] of [
    ['reference', 'Устройтесь удобно, как при обычной работе. Нажмите кнопку: появятся пять вспомогательных точек. Смотрите в центр, нажимать на точки не нужно.'],
    ['alternate', 'Сядьте чуть ниже, оставаясь в удобном положении. Не меняйте камеру и окно. Затем снова посмотрите на пять вспомогательных точек.'],
  ]) {
    owned.phase = 'nuisance_' + id;
    document.body.dataset.posePhase = 'nuisance_' + id;
    const stage = { id, targets: [] };
    owned.nuisanceCalibration.stages.push(stage);
    status('Вспомогательная калибровка. Камера включена, точек пока нет.');
    await awaitPosture(owned, instruction);
    if (run !== owned) return false;
    byId('target').style.backgroundColor = '#F59E0B';
    for (const [targetIndex, [x, y]] of nuisanceAnchors.entries()) {
      position(x, y);
      status(`Вспомогательная калибровка ${targetIndex + 1}/${nuisanceAnchors.length}: смотрите на жёлтую точку, не нажимайте.`);
      await delay(1000, owned);
      const policy = calibrationCapturePolicy({ x, y });
      const captured = await collectCalibrationClick({ policy, getFrame: () => owned.lastFrame,
        onLandmarkCopy: (frame, copy) => {
          const rows = owned.eyePatchFeatures?.get(frame.landmarks)?.rows;
          if (rows) owned.eyePatchFeatures.set(copy, { rows });
        }, isActive: () => run === owned && !owned.abort.signal.aborted && !document.hidden });
      if (run !== owned) { captured.frames.length = 0; return false; }
      const vectors = captured.frames.map(frame => owned.eyePatchFeatures.get(frame)?.rows).filter(Boolean);
      const mean = vectors.length >= policy.minFrames
        ? vectors[0].map((_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length) : null;
      means[id].push(mean);
      if (geometry) {
        const heights = captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.rows)
          .map(frame => owned.geometryModule.readEyeCornerHeight(frame)).filter(Number.isFinite);
        geometry[id].push(heights.length >= policy.minFrames ? owned.geometryModule.summarizeEyeCornerHeight(heights) : null);
      }
      stage.targets.push({ targetIndex, targetPercent: { x, y }, accepted: Boolean(mean), usable: vectors.length,
        minFrames: policy.minFrames, invalidEyes: captured.summary.invalidEyes, invalidPose: captured.summary.invalidPose });
      captured.frames.length = 0;
    }
  }
  const pairs = means.reference.map((first, i) => ({ first, second: means.alternate[i] }));
  // Do not fit an unbalanced subset of the auxiliary grid.
  if (!pairs.every(p => p.first && p.second)) {
    stop('Не хватило пригодных кадров на вспомогательных точках. Камера выключена. Скачайте техническую сводку.', 'nuisance_anchor_coverage');
    return false;
  }
  if (geometry) {
    owned.geometryAnchors = geometry.reference.map((first, i) => ({ first, second: geometry.alternate[i] }));
    if (!owned.geometryModule.fitPatchGeometryGate(owned.geometryAnchors, [], owned.appearanceGateInfo)) {
      stop('Положения головы недостаточно различимы. Проверка остановлена до красных точек. Скачайте техническую сводку.', 'geometry_anchor_overlap');
      return false;
    }
    owned.appearanceGateInfo.anchorScreenPassed = true;
  }
  owned.nuisanceProjector = owned.fitPatchNuisance(pairs);
  means.reference.length = 0; means.alternate.length = 0;
  if (nuisanceGateMode && !geometryGateMode && owned.nuisanceProjector) owned.appearanceAnchors = pairs;
  else pairs.length = 0;
  if (!owned.nuisanceProjector) {
    stop('Между двумя положениями не выделилось достаточно устойчивое изменение изображения. Камера выключена. Скачайте техническую сводку.', 'nuisance_no_direction');
    return false;
  }
  owned.nuisanceCalibration.rank = owned.nuisanceProjector.rank;
  owned.phase = 'nuisance_return';
  document.body.dataset.posePhase = 'nuisance_return';
  status('Перед обычной калибровкой вернитесь к исходной посадке.');
  await awaitPosture(owned, 'Вернитесь к исходной удобной посадке. Нажмите кнопку, чтобы начать 25 красных точек — по два клика на каждую.');
  if (run !== owned) return false;
  delete document.body.dataset.posePhase;
  byId('target').style.backgroundColor = '#DC2626';
  owned.phase = 'calibration';
  return true;
}
async function check(owned, positions = targets) {
  const rows = [];
  for (let index = 0; index < positions.length; index++) {
    const [x, y] = positions[index]; const target = position(x, y);
    status(`Проверка ${index + 1}/${positions.length}: смотрите точно в центр зелёной точки, не кликайте.`);
    await delay(1000, owned);
    const keys = ablation ? comparisonSignalKeys(owned.trackers) : { raw: ['rawX', 'rawY'], corrected: ['correctedX', 'correctedY'] };
    const pairs = ablation ? comparisonPairs(owned.trackers) : [];
    const shadowNames = nuisanceGateMode ? ['eye_patch_adaptive.raw', 'eye_patch_adaptive_confirmed.raw'] : [];
    for (const name of shadowNames) {
      keys[name] = ['rawX', 'rawY'];
      for (const baseline of ['baseline.raw', 'eye_patch.raw', 'eye_patch_nuisance.raw']) pairs.push({ baseline, candidate: name });
    }
    const collect = createMatchedWindow(target, performance.now(), Object.keys(keys), keys, owned.viewport,
      pairs, ablation); owned.collect = collect;
    if (nuisanceGateMode) collect.shadowActions = Object.fromEntries(shadowNames.map(name => [name, {}]));
    await delay(2000, owned); owned.collect = null;
    const result = finishMatchedWindow(collect, performance.now() - collect.since);
    rows.push({ targetIndex: index, targetPercent: { x, y }, ...result,
      ...(nuisanceGateMode ? { shadowActions: collect.shadowActions } : {}),
      signals: result.models, models: undefined,
      paired: ablation ? undefined : { accepted: result.paired.accepted, correctedMinusRawMeanErrorPx: result.paired.candidateMinusBaselineMeanErrorPx } });
  }
  byId('target').hidden = true;
  return rows;
}

async function runPoseProbe(owned) {
  const stages = [];
  for (const [id, instruction] of poseSteps) {
    owned.phase = 'pose_' + id;
    document.body.dataset.posePhase = id;
    byId('target').hidden = true;
    owned.collect = null;
    byId('poseInstruction').textContent = instruction + ' Когда будете готовы, нажмите кнопку. Если неудобно, остановите проверку.';
    byId('poseStep').hidden = false;
    status(`Посадка: этап ${stages.length + 1}/${poseSteps.length}. Камера включена, точек пока нет.`);
    const button = byId('poseContinue');
    try {
      await deadline(new Promise(resolve => { button.onclick = () => resolve(); }), 60000, owned);
    } finally {
      if (run === owned) { button.onclick = null; byId('poseStep').hidden = true; }
    }
    if (run !== owned) throw new Error('cancelled');
    stages.push({ id, rows: await check(owned, poseTargets) });
  }
  return { scope: 'instructed_posture_change_then_return_not_ground_truth_pose', stages };
}


async function validationSet(owned, positions, label, raw = false) {
  const modelNames = Object.keys(owned.trackers);
  const diagnostics = exportTechnical ? (owned.validationDiagnostics[owned.phase] = positions.map((pos, targetIndex) => ({
    targetIndex, targetPercent: { x: pos.x, y: pos.y }, attempts: [],
    selectedAttempt: Object.fromEntries(modelNames.map(name => [name, null])),
  }))) : null;
  return collectValidationTargets({ positions, modelNames, diagnostics, async measure(pointIndex, attempt) {
    const { x, y } = positions[pointIndex], target = position(x, y);
    status(`${attempt === 2 ? 'Повтор — ' : ''}${label} ${pointIndex + 1}/${positions.length}: смотрите в центр зелёной точки, не кликайте.`);
    await delay(1000, owned);
    const clock = { monotonicStart: performance.now(), wallStart: Date.now() };
    const recorder = diagnostics ? createValidationAttemptRecorder(modelNames, clock, raw) : null;
    const windows = Object.fromEntries(modelNames.map(name => [name, {
      sampling: createValidationSamplingWindow(clock), samples: []
    }]));
    // Exactly the production 60 polls at 33 ms after the same 1000 ms settle.
    for (let poll = 0; poll < 60; poll++) {
      await delay(33, owned);
      if (recorder) recorder.observe(owned.lastFrame, owned.lastPredictions, owned.eyePatchFeatures?.get(owned.lastFrame?.landmarks));
      for (const [name, { sampling, samples }] of Object.entries(windows)) {
        const p = owned.lastPredictions?.[name], sx = raw ? p?.rawX : p?.correctedX, sy = raw ? p?.rawY : p?.correctedY;
        if (p?.valid && Number.isFinite(sx) && Number.isFinite(sy) && sampling.accept(p)) samples.push({
          gazeX: sx, gazeY: sy, targetX: target.x, targetY: target.y,
          rawX: p.rawX, rawY: p.rawY, correctedX: p.correctedX, correctedY: p.correctedY,
          displayX: p.displayX, displayY: p.displayY });
      }
    }
    const measured = Object.fromEntries(Object.entries(windows).map(([name, { sampling, samples }]) => [name, {
      pointIndex, targetX: target.x, targetY: target.y, samples, sampling: sampling.summary(),
    }]));
    return { measured, summary: recorder ? { attempt, ...recorder.summary(measured) } : null };
  } });
}

async function calibrate() {
  const owned = run;
  if (!owned || owned.calibrating) return;
  if ((appearanceMode || aoiMode) && (!owned.eyePatchFrames.available || (appearanceMode && !owned.eyePatchFrames.coreAvailable))) {
    status('Изображение глаз текущего кадра пока недоступно. Проверьте лицо/свет и повторите «Начать калибровку». Камера включена.'); return;
  }
  if (trioMode && (!owned.gradientFrames.fullAvailable || !owned.gradientFrames[controlFrameLabel + 'Available']
    || (!maskedMode && !nuisanceMode && !owned.gradientFrames[extraFrameLabel + 'Available']))) {
    status('Центр глаза в текущих изображениях пока не найден. Проверьте свет/лицо и повторите «Начать калибровку». Камера включена.'); return;
  }
  owned.calibrating = true; byId('calibrate').hidden = true; byId('video').hidden = true;
  owned.phase = 'calibration';
  document.body.classList.add('running'); byId('target').style.backgroundColor = '#DC2626';
  document.documentElement.classList.add('gaze-benchmark-measuring');
  const clickSummaries = [], repeatability = [];
  try {
    lockMeasurementGeometry(owned);
    if (eyeGateMode) { await collectEyeGateProbe(owned); return; }
    if (lidSupportProbe) { await collectLidSupport(owned); return; }
    if (nuisanceMode && !await collectNuisanceAnchors(owned)) return;
    const readEye = (landmarks, region) => owned.eyePatchFeatures?.get(landmarks)?.[region];
    owned.trackers = createModelComparison(owned.viewport, owned.camera,
      nuisanceMode ? 'nuisance' : trioMode || appearanceMode || axisMode || aoiMode ? requestedMode : ablation, eyeImageMode ? readEye : null);
    const ordinaryRows = nuisanceGateMode ? [] : null;
    if (nuisanceGateMode) {
      owned.confirmationTracker = createModelComparison(owned.viewport, owned.camera, 'gradient', readEye).eye_gradient_all;
      owned.appearanceGateInfo.confirmationErrors = 0;
    }
    owned.modelTiming = Object.fromEntries(Object.keys(owned.trackers).map(name => [name, { predictions: 0, totalMs: 0, maxMs: 0, errors: 0 }]));
    for (let i = 0; i < CALIBRATION_POSITIONS.length; i++) {
      const pos = CALIBRATION_POSITIONS[i], target = position(pos.x, pos.y);
      let firstFeatures = null, retryHint = '';
      for (let click = 0; click < CALIBRATION_CLICKS;) {
        status(`Калибровка ${i + 1}/25 — нажатие ${click + 1}/2. ${retryHint || 'Смотрите в центр красного круга.'}`);
        await deadline(new Promise(resolve => { byId('target').onclick = () => { byId('target').onclick = null; resolve(); }; }), 60000, owned);
        byId('target').style.opacity = '0.5';
        const policy = calibrationCapturePolicy(pos);
        const captured = await collectCalibrationClick({ policy, getFrame: () => owned.lastFrame,
          onLandmarkCopy: eyeImageMode ? (frame, copy) => {
            const values = owned.eyePatchFeatures?.get(frame.landmarks);
            if (values) owned.eyePatchFeatures.set(copy, Object.fromEntries(Object.entries(values).map(([region, value]) => [region, value?.slice()])));
            if (maskedMode) owned.maskedFrameReasons.set(copy, owned.maskedFrameReasons.get(frame.landmarks));
          } : null,
          isActive: () => run === owned && !owned.abort.signal.aborted && !document.hidden });
        if (run !== owned) { captured.frames.length = 0; throw new Error('cancelled'); }
        const patchFrames = eyeImageMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.full).length : null;
        const coreFrames = appearanceMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.core).length : null;
        const gradientFrames = gradientMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.gradient).length : null;
        const allGradientFrames = gradientMode || maskedMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.gradient_all).length : null;
        const tophatFrames = tophatMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.tophat).length : null;
        const maskedFrames = maskedMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.masked).length : null;
        let trainingFrames = aoiMode ? captured.frames.filter(frame => readEye(frame, 'full'))
          : commonCalibrationFrames ? commonCalibrationFrames(captured.frames, readEye) : captured.frames;
        if (owned.confirmationTracker && captured.summary.accepted && trainingFrames.length >= policy.minFrames) {
          const sharedWithGradient = trainingFrames.filter(frame => readEye(frame, 'gradient_all'));
          if (sharedWithGradient.length >= policy.minFrames) trainingFrames = sharedWithGradient;
          else {
            owned.confirmationTracker.reset(); owned.confirmationTracker = null;
            owned.appearanceGateInfo.confirmationReason = 'insufficient_common_calibration_frames';
          }
        }
        const controlFrames = maskedMode ? captured.frames.filter(frame => {
          const values = owned.eyePatchFeatures.get(frame);
          return values?.full && values.gradient_all;
        }) : trainingFrames;
        const patchReady = !eyeImageMode || controlFrames.length >= policy.minFrames;
        const commonFrames = trainingFrames.length;
        // A candidate with missing matched rows may not grade this run, but
        // it must not force extra clicks. Finish collecting coverage at all
        // targets without silently training on different/easier subsets.
        const coverageOnly = maskedMode && (owned.maskedCalibration.missingCommonClicks > 0 || commonFrames < policy.minFrames);
        const added = captured.summary.accepted && patchReady && !coverageOnly ? Object.values(owned.trackers).map(tracker =>
          tracker.addAveragedCalibrationPoint(trainingFrames, target.x, target.y, { minFrames: policy.minFrames })) : [];
        if (added.some(Boolean) && !added.every(Boolean)) throw new Error('model_calibration_disagreement');
        const accepted = captured.summary.accepted && patchReady && (coverageOnly || (added.length > 0 && added.every(Boolean)));
        if (accepted && ordinaryRows) {
          if (geometryGateMode) {
            const heights = trainingFrames.map(frame => owned.geometryModule.readEyeCornerHeight(frame)).filter(Number.isFinite);
            ordinaryRows.push(heights.length >= policy.minFrames ? owned.geometryModule.summarizeEyeCornerHeight(heights) : null);
          } else {
            const rows = trainingFrames.map(frame => readEye(frame, 'rows'));
            ordinaryRows.push(rows[0].map((_, i) => rows.reduce((sum, row) => sum + row[i], 0) / rows.length));
          }
          if (owned.confirmationTracker && !owned.confirmationTracker.addAveragedCalibrationPoint(trainingFrames, target.x, target.y, { minFrames: policy.minFrames })) {
            owned.confirmationTracker.reset(); owned.confirmationTracker = null;
            owned.appearanceGateInfo.confirmationReason = 'confirmation_calibration_rejected';
          }
        }
        if (maskedMode && accepted) {
          const hadMissing = owned.maskedCalibration.missingCommonClicks > 0;
          recordMaskedCalibrationClick(owned.maskedCalibration, i, controlFrames, commonFrames, policy.minFrames,
            frame => owned.maskedFrameReasons.get(frame));
          if (!hadMissing && owned.maskedCalibration.missingCommonClicks) {
            for (const tracker of Object.values(owned.trackers)) tracker.reset();
          }
        }
        const failureReason = accepted ? null : calibrationRejection(captured.summary, patchReady);
        if (exportTechnical && failureReason) countCalibrationRejection(owned.calibrationRejections, i, failureReason, captured.summary);
        captured.frames.length = 0;
        clickSummaries.push({ targetIndex: i, clickIndex: click, ...captured.summary, accepted,
          ...(exportTechnical && failureReason ? { failureReason } : {}),
          ...(appearanceMode ? { eyePatchUsableFrames: patchFrames, eyePatchCoreUsableFrames: coreFrames,
            eyePatchCommonUsableFrames: commonFrames } : {}),
          ...(gradientMode ? { eyePatchUsableFrames: patchFrames, gradientUsableFrames: gradientFrames,
            allGradientUsableFrames: allGradientFrames, commonEyeImageFrames: commonFrames } : {}),
          ...(maskedMode ? { eyePatchUsableFrames: patchFrames, maskedUsableFrames: maskedFrames,
            allGradientUsableFrames: allGradientFrames, commonEyeImageFrames: commonFrames } : {}),
          ...(tophatMode ? { eyePatchUsableFrames: patchFrames, tophatUsableFrames: tophatFrames,
            commonEyeImageFrames: commonFrames } : {}),
          ...(nuisanceMode || aoiMode ? { eyePatchUsableFrames: patchFrames, commonEyeImageFrames: commonFrames } : {}) });
        owned.calibrationAttempts = clickSummaries.length;
        if (accepted) owned.calibrationAccepted = (owned.calibrationAccepted || 0) + 1;
        if (clickSummaries.length > 200) throw new Error('calibration_retry_limit');
        byId('target').style.opacity = '1';
        if (!accepted) { retryHint = clickRetryHints[failureReason]; continue; }
        retryHint = '';
        if (click === 0) firstFeatures = captured.meanFeatures;
        else repeatability.push({ targetIndex: i, ...compareCalibrationClicks(firstFeatures, captured.meanFeatures) });
        click++;
      }
    }
    byId('target').onclick = null;
    if (owned.maskedCalibration?.missingCommonClicks) {
      stop('Сбор данных калибровки завершён. Новая модель получила недостаточно общих кадров; проверка точности не запущена. Камера выключена. Скачайте техническую JSON-сводку.', 'masked_calibration_coverage');
      return;
    }
    if (nuisanceGateMode) {
      owned.appearanceGate = geometryGateMode
        ? owned.geometryModule.fitPatchGeometryGate(owned.geometryAnchors, ordinaryRows, owned.appearanceGateInfo)
        : owned.gateModule.fitPatchAppearanceGate(owned.appearanceAnchors, ordinaryRows, owned.appearanceGateInfo);
      owned.appearanceAnchors = null; owned.geometryAnchors = null; ordinaryRows.length = 0;
      if (!owned.appearanceGate) {
        stop(geometryGateMode
          ? 'Положение головы на красных точках пересеклось со второй посадкой. Камера выключена. Скачайте техническую сводку.'
          : 'Изображение при двух посадках недостаточно различимо для автоматического выбора. Камера выключена. Скачайте техническую сводку.',
        geometryGateMode ? 'geometry_gate_unavailable' : 'appearance_gate_unavailable');
        return;
      }
      owned.appearanceGateInfo.available = true;
      if (owned.confirmationTracker && !owned.confirmationTracker.calibrate()) {
        owned.confirmationTracker.reset(); owned.confirmationTracker = null;
        owned.appearanceGateInfo.confirmationReason = 'confirmation_fit_failed';
      }
      owned.appearanceGateInfo.confirmationAvailable = Boolean(owned.confirmationTracker);
    }
    for (const [name, tracker] of Object.entries(owned.trackers)) {
      const begun = performance.now(), fitted = tracker.calibrate();
      owned.calibrationTiming[name] = performance.now() - begun;
      if (!fitted) throw new Error('calibration');
    }
    byId('target').style.backgroundColor = '#10B981';
    // The same correction math and independent rollback decision as production.
    owned.phase = 'correction';
    const correctionPoints = await validationSet(owned, CORRECTION_POSITIONS, 'Подготовка коррекции', true);
    if (!Object.values(correctionPoints).every(points => validationTargetCoverage(points, 9).complete)) throw new Error('correction_coverage');
    const fits = {};
    for (const [name, tracker] of Object.entries(owned.trackers)) {
      const fitted = fitValidationCorrection(correctionPoints[name], owned.viewport);
      const applied = fitted.postCalibrationCorrection.applied && tracker.setPostCalibrationCorrection(fitted.correction);
      fits[name] = { fitted, applied };
    }
    owned.phase = 'independent';
    const benchmarkPoints = await validationSet(owned, BENCHMARK_POSITIONS, 'Независимая проверка коррекции');
    if (!Object.values(benchmarkPoints).every(points => validationTargetCoverage(points, 5).complete)) throw new Error('benchmark_coverage');
    const corrections = {};
    for (const [name, tracker] of Object.entries(owned.trackers)) {
      const { fitted, applied } = fits[name];
      const assessed = assessCorrectionBenchmark(benchmarkPoints[name], owned.viewport, applied);
      const selected = applied && assessed.independentDecision.accepted;
      if (!selected) tracker.clearPostCalibrationCorrection();
      corrections[name] = { fitted: fitted.postCalibrationCorrection.fitted, selected,
        offsetX: selected ? fitted.correction.offsetX : 0, offsetY: selected ? fitted.correction.offsetY : 0,
        loocv: fitted.postCalibrationCorrection.loocv, independentDecision: assessed.independentDecision,
        benchmarkRaw: assessed.rawMetrics, benchmarkCandidateCorrected: assessed.correctedCandidateMetrics,
        sampling: [...correctionPoints[name], ...benchmarkPoints[name]].map(p => p.sampling) };
      correctionPoints[name].length = 0; benchmarkPoints[name].length = 0;
      assessed.correctedCandidatePoints.length = 0; assessed.baselinePoints.length = 0;
    }
    const poseProbe = gradientPose ? await runPoseProbe(owned) : null;
    const aoiBlock = aoiMode ? await runContinuousAoiBlock(owned) : null;
    if (!gradientPose && !aoiMode) owned.phase = 'spatial_before';
    const before = gradientPose || aoiMode ? [] : await check(owned);
    let after = [], temporalGap = null;
    if (intervalMs) {
      owned.phase = 'interval';
      status('Непрерывный интервал 4 минуты. Переводите взгляд по экрану естественно, моргайте как обычно. Не меняйте окно и положение камеры. Камера включена. Затем точки появятся снова.');
      const started = performance.now(), captures = owned.count, notifications = owned.cadence.notifications;
      await delay(intervalMs, owned);
      if (gradientTemporal) temporalGap = { elapsedMs: performance.now() - started,
        completedCaptures: owned.count - captures, cameraNotifications: owned.cadence.notifications - notifications,
        scope: 'interval_capture_counts_not_gaze_accuracy' };
      owned.phase = 'spatial_after'; after = await check(owned);
    }
    const modelInfo = trackerStatus => ({ featureMethod: trackerStatus.featureMethod, calibrationSampling: trackerStatus.calibrationSampling,
        captureVersion: CALIBRATION_CAPTURE_VERSION, calibrationFrames: trackerStatus.calibrationFrames,
        clicksPerPoint: CALIBRATION_CLICKS, ridgeLambda: trackerStatus.selectedRidgeLambda,
        targetCvRmsPx: trackerStatus.calibrationTargetCvRmsPx,
        ...(trackerStatus.experimentalModel ? { experimentalModel: trackerStatus.experimentalModel, gateInputMethod: trackerStatus.gateInputMethod } : {}) });
    const modelReports = Object.fromEntries(Object.entries(owned.trackers).map(([name, tracker]) => [name, {
      ...modelInfo(tracker.getStatus()), correction: corrections[name],
      ...(axisMode || eyeImageMode ? { ridgeSelection: tracker.getCalibrationDiagnostics() } : {}),
      calibrationRuntimeMs: { total: owned.calibrationTiming[name], scope: 'synchronous_fit_and_cv_not_camera' },
      predictorRuntimeMs: { mean: owned.modelTiming[name].predictions ? owned.modelTiming[name].totalMs / owned.modelTiming[name].predictions : null,
        max: owned.modelTiming[name].maxMs, predictions: owned.modelTiming[name].predictions,
        errors: owned.modelTiming[name].errors, scope: 'calibrated_regression_only_not_camera_or_end_to_end' }
    }]));
    const summary = { version: aoiMode ? reportVersion : tophatMode ? 'issue143_eye_tophat.v10' : gradientPose ? 'issue143_eye_gradient_pose.v9' : gradientTemporal ? 'issue143_eye_gradient_temporal.v8' : gradientMode ? 'issue143_eye_gradient.v7' : appearanceMode ? 'issue143_eye_patch.v6' : axisMode ? 'issue143_axis_regularization.v5' : ablation ? 'issue143_factorial_geometry.v4' : 'issue143_production_calibration.v3',
      ...(ablation ? { models: modelReports, comparison: axisMode || eyeImageMode
        ? 'same_captures_common_baseline_gate_calibration_only_model_selection'
        : 'same_captures_common_baseline_gate_no_model_selection' }
        : { model: modelInfo(owned.trackers.baseline.getStatus()), correction: corrections.baseline }),
      calibration: { clicks: clickSummaries, repeatability },
      intervalMs, ...(gradientPose ? { temporalScope: 'posture_probe_not_long_interval_drift' }
        : gradientTemporal ? { temporalScope: 'same_targets_before_after_no_within_interval_accuracy', temporalGap }
        : trioMode ? { temporalScope: 'spatial_only_no_drift_measurement' } : {}), viewport: owned.viewport,
      camera: owned.camera,
      backend: owned.analyzer.backend, frameCount: owned.count, frameErrors: owned.rejected,
      ...(ablation ? { cadence: owned.cadence } : {}),
      ...(appearanceMode ? { eyePatchFrames: { ...owned.eyePatchFrames }, eyePatchImagesStored: false, eyePatchFeaturesStored: false,
        calibrationFramePolicy: 'intersection_of_full_core_before_all_model_averages',
        eyePatchRuntimeMs: { frames: owned.eyePatchTiming.frames,
          mean: owned.eyePatchTiming.frames ? owned.eyePatchTiming.totalMs / owned.eyePatchTiming.frames : null,
          max: owned.eyePatchTiming.maxMs, scope: 'full_and_core_feature_extraction_only_not_inference_or_end_to_end' },
        eyePatchStorageScope: 'no_export_checkpoint_or_persistent_storage_transient_fit_only' } : {}),
      ...(trioMode ? { eyeImageFrames: { ...owned.gradientFrames }, eyeImageStorageScope: 'transient_only_no_images_features_or_weights_in_export',
        calibrationFramePolicy: `intersection_of_full_${controlRegion}_${extraRegion}_before_all_model_averages`,
        featureRuntimeMs: Object.fromEntries(Object.entries(owned.featureTiming).map(([name, timing]) => [name, {
          frames: timing.frames, mean: timing.frames ? timing.totalMs / timing.frames : null,
          max: timing.maxMs, scope: 'descriptor_extraction_only_not_camera_regression_or_end_to_end' }])),
        eyeImageRuntimeMs: { frames: owned.eyePatchTiming.frames,
          mean: owned.eyePatchTiming.frames ? owned.eyePatchTiming.totalMs / owned.eyePatchTiming.frames : null,
          max: owned.eyePatchTiming.maxMs, scope: 'all_three_eye_feature_extractors_not_camera_or_end_to_end' } } : {}),
      completedFrameAgeMs: { mean: owned.latency.n ? owned.latency.totalMs / owned.latency.n : null, max: owned.latency.maxMs,
        scope: 'capture_to_analyzer_result_not_display_latency' },
      ...(aoiMode ? { aoiBlock, calibrationFramePolicy: 'shared_full_patch_frames',
        eyePatchFrames: { attempted: owned.eyePatchFrames.attempted, available: owned.eyePatchFrames.available, missing: owned.eyePatchFrames.missing } }
        : poseProbe ? { poseProbe } : { before, after }),
      ...(nuisanceMode ? { nuisanceCalibration: owned.nuisanceCalibration } : {}),
      ...selectionDiagnostics(owned),
      rawVideoStored: false, rawLandmarksStored: false, rawGazeStored: false,
      limitation: aoiMode ? 'Instructed AOI diagnostic, not independent eye-tracker ground truth or production analytics acceptance.'
        : poseProbe
        ? 'Standalone A-B-A posture probe. Head diagnostics are proxies, not measured pose. No long-interval drift or accuracy certification.'
        : 'Shared production calibration/correction, standalone analyzer, not the complete multimodal participant pipeline. No accuracy certification. Drift onset inside the uninterrupted interval is unknown.' };
    owned.phase = 'completed';
    report = exportTechnical ? { ...summary, version: reportVersion, benchmark: metadata(owned, true),
      diagnostics: { targetCoverage: targetCoverageDiagnostics(owned) } } : summary;
    stop('Проверка завершена. Камера выключена. Скачайте JSON-сводку. Это не автоматическое решение о валидности.');
    byId('result').textContent = JSON.stringify(report, null, 2); byId('download').hidden = false;
  } catch (error) {
    if (run !== owned) return;
    const reason = benchmarkFailureReason(error);
    const stage = reason === 'correction_coverage' ? 'подготовки коррекции' : reason === 'benchmark_coverage' ? 'независимой проверки коррекции' : null;
    stop(reason === 'aoi_timing_overrun'
      ? 'Таймер показа задержался: непрерывность блока не подтверждена. Камера выключена; скачайте техническую JSON-сводку.'
      : stage
      ? `Не удалось собрать пригодные измерения для всех точек ${stage}. Камера выключена; скачайте техническую JSON-сводку.`
      : 'Проверка прервана: остановка, таймаут или недостаточно кадров. Камера выключена. Не используйте неполный результат как успешный.', reason);
  }
}

async function collectLidSupport(owned) {
  for (const [targetIndex, pos] of probePositions.entries()) {
    const row = { targetIndex, targetPercent: { ...pos }, clicks: [] };
    owned.lidSupportTargets.push(row);
    position(pos.x, pos.y);
    for (let index = 0; index < CALIBRATION_CLICKS; index++) {
      const click = { clickIndex: index, attempts: [], accepted: false };
      row.clicks.push(click);
      for (let attempt = 1; attempt <= probeMaxAttempts; attempt++) {
        const hint = attempt === 1 ? 'Смотрите в центр красного круга.'
          : clickRetryHints[click.attempts.at(-1).failureReason];
        status(`Короткая проверка ${targetIndex + 1}/${probePositions.length} — нажатие ${index + 1}/2. ${hint}`);
        await deadline(new Promise(resolve => {
          byId('target').onclick = () => { byId('target').onclick = null; resolve(); };
        }), 40000, owned);
        byId('target').style.opacity = '.5';
        const policy = calibrationCapturePolicy(pos);
        const captured = await collectCalibrationClick({ policy, getFrame: () => owned.lastFrame,
          onLandmarkCopy: (frame, copy) => {
            const values = owned.lidSupportFrames?.get(frame.landmarks);
            if (values) owned.lidSupportFrames.set(copy, values);
          }, isActive: () => run === owned && !owned.abort.signal.aborted && !document.hidden });
        if (run !== owned) { captured.frames.length = 0; return; }
        const summary = summarizeLidSupportClick(captured.frames, policy.minFrames, frame => owned.lidSupportFrames.get(frame));
        captured.frames.length = 0;
        const accepted = captured.summary.accepted && summary.controlReady;
        const failureReason = accepted ? null : calibrationRejection(captured.summary, summary.controlReady);
        click.attempts.push({ ...summary, failureReason,
          gateWindowUsableFrames: captured.summary.usableFrames, invalidEyes: captured.summary.invalidEyes,
          invalidPose: captured.summary.invalidPose });
        owned.calibrationAttempts = (owned.calibrationAttempts || 0) + 1;
        byId('target').style.opacity = '1';
        if (accepted) {
          click.accepted = true;
          owned.calibrationAccepted = (owned.calibrationAccepted || 0) + 1;
          break;
        }
        countCalibrationRejection(owned.calibrationRejections, targetIndex, failureReason, captured.summary);
      }
    }
  }
  owned.phase = 'completed';
  report = { version: reportVersion, benchmark: metadata(owned, true), diagnostics: failureDiagnostics(owned),
    rawVideoStored: false, rawLandmarksStored: false, rawGazeStored: false };
  stop('Короткая проверка завершена. Камера выключена. Скачайте сводку JSON. Точность взгляда не оценивалась.');
  byId('result').textContent = JSON.stringify(report, null, 2); byId('download').hidden = false;
}

async function collectEyeGateProbe(owned) {
  owned.phase = 'eye_gate_reference';
  status('Сначала — контрольная серия 30 секунд, без кликов по точкам.');
  await awaitPosture(owned, 'Смотрите на центральную точку. Следуйте надписям над ней: обычный взгляд, один естественный морг по сигналу и короткое закрытие глаз. Если неудобно, остановите тест.');
  position(50, 50);
  byId('target').style.backgroundColor = '#F59E0B';
  document.body.dataset.eyeGateCue = 'active';
  const policy = calibrationCapturePolicy({ x: 50, y: 50 });
  const cues = [['neutral_reference', 5000, 'Смотрите в центр, лицо расслаблено.'],
    ...Array.from({ length: 3 }, () => [
      ['blink_cue', 2000, 'Моргните один раз сейчас.'], ['open_recovery', 3000, 'Снова смотрите в центр.'],
    ]).flat(),
    ['closed_cue', 2000, 'Мягко закройте глаза до следующей подсказки.'],
    ['open_recovery', 8000, 'Откройте глаза и смотрите в центр.']];
  for (const [index, [cue, durationMs, text]] of cues.entries()) {
    const stats = owned.createEyeGateProbeWindow();
    status(text);
    const since = performance.now();
    owned.eyeGateCue = frame => {
      if (frame?.timestamp >= since && frame.timestamp < since + durationMs) {
        stats.observe(frame, assessCalibrationFrame(frame, policy, true));
      }
    };
    await delay(durationMs, owned);
    owned.eyeGateCue = null;
    owned.eyeGate.cues.push({ index, cue, durationMs, observedDurationMs: performance.now() - since, ...stats.summary() });
  }
  delete document.body.dataset.eyeGateCue;
  for (const [condition, label, instruction] of [
    ['neutral', 'Нейтрально', 'Расслабьте лицо, держите глаза открытыми естественно.'],
    ['smile', 'Лёгкая улыбка', 'Слегка улыбнитесь, не заставляйте глаза открываться шире.'],
    ['squint', 'Лёгкий прищур', 'Слегка прищурьтесь, но не закрывайте глаза. Если неудобно, остановите тест.'],
  ]) {
    owned.phase = 'eye_gate_clicks';
    status(label + ' · 9 точек, по 2 принятых нажатия или максимум один повтор на попытку.');
    await awaitPosture(owned, instruction + ' На каждую красную точку нажимайте отдельно; моргайте до нажатия, не во время него.');
    const series = { condition, targets: [] };
    owned.eyeGate.conditions.push(series);
    byId('target').style.backgroundColor = '#DC2626';
    for (const [targetIndex, pos] of probePositions.entries()) {
      const target = { targetIndex, targetPercent: { ...pos }, clicks: [] };
      series.targets.push(target); position(pos.x, pos.y);
      for (let clickIndex = 0; clickIndex < CALIBRATION_CLICKS; clickIndex++) {
        const click = { clickIndex, attempts: [] };
        target.clicks.push(click);
        for (let attempt = 1; attempt <= probeMaxAttempts; attempt++) {
          status(`${label} · ${targetIndex + 1}/9 · нажатие ${clickIndex + 1}/2. ${attempt > 1 ? 'Не хватило кадров; повторите один раз естественно.' : 'Смотрите в центр.'}`);
          await deadline(new Promise(resolve => {
            byId('target').onclick = () => { byId('target').onclick = null; resolve(); };
          }), 40000, owned);
          byId('target').style.opacity = '.5';
          const stats = owned.createEyeGateProbeWindow();
          const captured = await collectCalibrationClick({ policy: calibrationCapturePolicy(pos),
            getFrame: () => owned.lastFrame, isActive: () => run === owned && !owned.abort.signal.aborted && !document.hidden,
            onFrameAssessment: (frame, assessment) => stats.observe(frame, assessment) });
          captured.frames.length = 0;
          if (run !== owned) return;
          byId('target').style.opacity = '1';
          owned.calibrationAttempts = (owned.calibrationAttempts || 0) + 1;
          click.attempts.push({ attempt, capture: captured.summary, ...stats.summary() });
          if (captured.summary.accepted) {
            owned.calibrationAccepted = (owned.calibrationAccepted || 0) + 1;
            break;
          }
        }
      }
    }
  }
  owned.phase = 'completed';
  report = { version: reportVersion, benchmark: metadata(owned, true), eyeGate: owned.eyeGate, cadence: owned.cadence,
    rawVideoStored: false, rawLandmarksStored: false, rawGazeStored: false };
  stop('Диагностика глаз завершена. Камера выключена. Скачайте сводку JSON. Точность взгляда не оценивалась.');
  byId('result').textContent = JSON.stringify(report, null, 2); byId('download').hidden = false;
}

byId('start').onclick = start; byId('calibrate').onclick = calibrate; byId('stop').onclick = () => stop();
byId('download').onclick = () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url;
  a.download = nuisanceMode ? `wecog-gaze-${geometryGateMode ? 'geometry-' : nuisanceGateMode ? 'adaptive-' : 'paired-'}posture.v1-${report.benchmark.runId}.json`
    : lidSupportProbe ? `wecog-gaze-lid-support.v1-${report.benchmark.runId}.json`
    : aoiMode ? `wecog-gaze-continuous-aoi.v1-${report.benchmark.runId}.json`
    : eyeGateMode ? `wecog-gaze-eye-gate.v1-${report.benchmark.runId}.json`
    : exportTechnical ? `wecog-gaze-${maskedMode ? 'masked-' : ''}${protocol}-${report.benchmark.runId}.json` : tophatMode ? 'wecog-issue143-eye-tophat-v10.json' : gradientPose ? 'wecog-issue143-eye-gradient-pose-v9.json'
    : gradientTemporal ? 'wecog-issue143-eye-gradient-temporal-v8.json'
    : gradientMode ? 'wecog-issue143-eye-gradient-v7.json' : 'wecog-issue143-local-check.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
addEventListener('pagehide', () => stop());
addEventListener('keydown', event => { if (run && event.key === 'Escape') stop(); });
document.addEventListener('visibilitychange', () => { if (run && document.hidden) stop('Вкладка скрыта. Проверка остановлена, камера выключена.', 'page_hidden'); });
if (ablation) document.getElementById('modelDescription').textContent = 'Четыре варианта модели на одних кадрах: текущая/пиксельная геометрия × квадратичная/линейная формула. У всех одинаковая калибровка, confidence/head/OOD gate, отдельная коррекция. В JSON только сводки ошибок, усреднённых признаков радужек/головы и технических счётчиков — без видео, landmarks и покадровых рядов. Модель автоматически не выбирается; на API ничего не отправляется.';
if (axisMode) document.getElementById('modelDescription').textContent = 'Проверка регуляризации и формулы каждой оси: текущая модель, линейная, фиксированные λ 0.001/0.01/0.1/1 для обеих формул, смешанный X-quadratic/Y-linear и вариант с независимым выбором формулы и λ для X/Y только на калибровке. Всего 12 регрессий на одних кадрах одной камеры. На контрольных целях ничего не обучается. В JSON только агрегаты ошибок/признаков и кривые калибровочного CV, без видео, landmarks и покадровых рядов. На API ничего не отправляется.';
if (appearanceMode) document.getElementById('modelDescription').textContent = 'Четыре экспериментальных варианта: исходная iris-модель, раздельная формула X/Y и два варианта по изображениям глаз — полный patch и центральная область с меньшим влиянием периферии век. Устойчивость к векам не гарантирована. Один camera/MediaPipe кадр для всех, обработка только локальная. Fit только на калибровке, без подстройки по контрольным целям или времени. В памяти — текущие признаки и ограниченный калибровочный набор; набор удаляется после fit. JSON содержит только агрегаты, покрытие и CV-кривые, без изображений, patch-векторов, landmarks и покадровых рядов. Missing patch не заменяется старым прогнозом. Отправки на API нет.';
if (trioMode) {
  document.getElementById('modelDescription').textContent = 'Сравнение: исходная модель, прежний полный eye-patch и два варианта с центром радужки по градиентам изображения. Все получают одни кадры одной камеры; общие eye/head gates не ослабляются. Fit только на калибровке, контрольные цели не обучают модель. Изображения, признаки и веса не сохраняются и не экспортируются; JSON содержит только сводки и counts. Есть известные ограничения при бликах и закрытии глаз. На API ничего не отправляется; автоматической приёмки нет.';
  document.getElementById('durationDescription').textContent = gradientPose
    ? 'После одной калибровки и проверки коррекции — три короткие серии по тем же пяти точкам: обычная посадка, чуть ниже и возврат. Положение камеры и окна не меняйте. Модель не переобучается; четырёхминутного интервала нет.'
    : gradientTemporal
    ? 'После калибровки и проверки коррекции — две проверки по тем же 9 точкам. Между ними 4 минуты без проверочных точек и без подстройки модели. Это отдельная диагностика примерно на 7–8 минут, не рабочий протокол.'
    : 'После 25 точек — подготовка и независимая проверка коррекции, затем одна проверка по 9 точкам. Без четырёхминутного интервала и повторной серии: около 2–3 минут плюс время на нажатия. Эта версия проверяет пространственную точность, а не длительный дрейф.';
}
if (tophatMode) byId('modelDescription').textContent = 'Локальное сравнение исходной модели, полного eye-patch, Gradient All и нового горизонтального black top-hat. Он подавляет широкие изменения яркости, но не гарантирует устойчивость к реальной посадке. Все обучаются на общих кадрах одной камеры, только на калибровке; head не обучается предсказывать цель. Есть известные failures при текстуре и почти закрытых глазах. Изображения, признаки и веса не экспортируются; на API ничего не отправляется.';
if (maskedMode) byId('modelDescription').textContent = 'Локальное сравнение четырёх моделей на одних кадрах: исходная, полный eye-patch, Gradient All и оценка центра глаза по видимой области между веками. Если только новой модели не хватит кадров, повторять точку не нужно: по завершении калибровки будет доступна техническая сводка без измерения точности. Сидите удобно; моргайте до нажатия. Изображения не сохраняются, на API ничего не отправляется.';
if (lidSupportProbe) {
  byId('calibrate').textContent = 'Начать короткую проверку';
  byId('modelDescription').textContent = 'Проверяем, на каких кадрах два варианта видят признаки глаза. Точность взгляда не измеряется. Изображения и координаты глаз не сохраняются и не отправляются.';
  byId('durationDescription').textContent = 'Девять красных точек, по два нажатия. Затем сразу JSON. Зелёных точек и четырёхминутного ожидания нет. Если контрольный сигнал не удалось получить после повтора, тест продолжится со следующего нажатия.';
}
if (nuisanceMode) {
  byId('modelDescription').textContent = 'Локально сравниваем четыре модели на одних кадрах. Только новая модель использует пары изображений одной цели при двух удобных положениях головы. Эти вспомогательные точки не участвуют в проверке точности. Видео и признаки не сохраняются и не отправляются.';
  byId('durationDescription').textContent = 'Две короткие серии вспомогательных точек без кликов, затем обычные 25 красных точек и три короткие проверки посадки. Двигайтесь естественно, не наклоняйтесь сильно. Четырёхминутного ожидания нет.';
}
if (nuisanceGateMode) byId('modelDescription').textContent = 'Сравниваем обычный и парный eye-patch и две автоматические оценки на тех же кадрах. Если две посадки неразличимы для автоматического выбора, тест сохранит техническую сводку. Видео и признаки не сохраняются и не отправляются.';
if (geometryGateMode) byId('modelDescription').textContent = 'Положение лица используется только для отдельной экспериментальной проверки посадки, а координаты взгляда вычисляются по изображению глаз. Если посадки недостаточно различимы на жёлтых точках, тест остановится до красных. Видео и признаки не сохраняются и не отправляются.';
if (aoiMode) {
  byId('modelDescription').textContent = 'Сравниваем текущую модель и обычный eye-patch на одних кадрах. Измеряем попадания и фиксации в заданных областях экрана. Видео, признаки и ряды координат не сохраняются и не отправляются.';
  byId('durationDescription').textContent = '25 красных точек по два клика, затем зелёные точки без кликов. После этого один непрерывный блок: 40 показов за 4 минуты, без дополнительных калибровок. Всего около 6–7 минут в зависимости от времени на клики.';
}
if (eyeGateMode) {
  byId('calibrate').textContent = 'Начать диагностику глаз';
  byId('modelDescription').textContent = 'Проверка причин отбрасывания кадров. Прогноз взгляда не обучается, рабочие пороги не меняются. Только агрегаты EAR, мимики, позы и кадров; без видео и автоматической отправки.';
  byId('durationDescription').textContent = '30 секунд контрольных сигналов без кликов. Затем три серии по 9 точек: нейтрально, лёгкая улыбка, лёгкий прищур. На каждую точку два отдельных нажатия, по одному возможному повтору.';
}
if (!canStart()) byId('start').disabled = true;
return { stop, clearReport() { report = null; byId('download').hidden = true; byId('result').textContent = ''; } };
}
