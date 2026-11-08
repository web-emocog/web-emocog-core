// Explicit diagnostic mount only; never called by the participant flow.
// The local harness and authenticated developer page share this implementation.
import { createMatchedWindow, observeMatchedWindow, finishMatchedWindow } from './gaze-benchmark-summary.mjs?v=20261108-143m';
import { benchmarkMetadata, benchmarkFailureReason } from './gaze-benchmark-report.mjs?v=20261108-143m';
import { DiagnosticRun, SerialDiagnosticStage } from './diagnostic-run.mjs?v=20261104-4';
import { CALIBRATION_CAPTURE_VERSION, CALIBRATION_CLICKS, CALIBRATION_POSITIONS, CORRECTION_POSITIONS,
  BENCHMARK_POSITIONS, calibrationCapturePolicy, collectCalibrationClick, compareCalibrationClicks
} from '../../participant-web/js/gaze-tracker/calibration-capture.mjs?v=20261108-143l';
import { createValidationSamplingWindow, validationTargetCoverage } from '../../participant-web/js/gaze-tracker/validation-sampling.mjs';
import { fitValidationCorrection, assessCorrectionBenchmark } from '../../participant-web/js/gaze-tracker/validation-metrics.mjs';
import { createModelComparison, commonAppearanceCalibrationFrames, commonGradientCalibrationFrames, commonTophatCalibrationFrames, comparisonSignals, comparisonSignalKeys, comparisonPairs } from './gaze-benchmark-models.mjs?v=20261108-143m';
import { eyePatchFeaturesForFrame } from '../../participant-web/js/gaze-tracker/eye-patch-features.mjs?v=20261107-143';
import { eyeGradientFeaturesForFrame } from '../../participant-web/js/gaze-tracker/eye-gradient-features.mjs?v=20261107-143g';
import { eyeTophatFeaturesForFrame } from '../../participant-web/js/gaze-tracker/eye-tophat-features.mjs?v=20261108-143l';
export function mountGazeBenchmark({ mode: requestedMode = null, pose = false, temporal = false,
  cohort = false, canStart = () => false, authorize = null } = {}) {
if (cohort && (requestedMode !== 'tophat' || typeof authorize !== 'function')) {
  throw new TypeError('Developer benchmark requires explicit authorization and fixed candidates');
}
const axisMode = requestedMode === 'axis';
const appearanceMode = requestedMode === 'appearance';
const gradientMode = requestedMode === 'gradient';
const tophatMode = requestedMode === 'tophat';
const gradientPose = (gradientMode || tophatMode) && pose;
const gradientTemporal = (gradientMode || (cohort && tophatMode)) && !gradientPose && temporal;
const eyeImageMode = appearanceMode || gradientMode || tophatMode;
// Retain the short v7 by default. The longer check needs a separate explicit URL.
const intervalMs = gradientTemporal ? 240000 : tophatMode || gradientMode ? 0 : 240000;
const ablation = requestedMode === 'ablation' || axisMode || eyeImageMode;
const byId = id => document.getElementById(id);
const status = text => { byId('status').textContent = text; };
let run = null, report = null;
const modelStage = new SerialDiagnosticStage();
const protocol = gradientPose ? 'posture.v1' : gradientTemporal ? 'temporal.v1' : 'spatial.v1';

function metadata(owned, completed, reason = null) {
  return benchmarkMetadata({ protocol, completed, reason, runId: owned.runId,
    phase: owned.phase, elapsedMs: performance.now() - owned.startedAt,
    viewport: owned.viewport, camera: owned.camera, backend: owned.analyzer?.backend,
    frameCount: owned.count, frameErrors: owned.rejected,
    calibrationAttempts: owned.calibrationAttempts || 0, calibrationAccepted: owned.calibrationAccepted || 0,
    userAgent: navigator.userAgent, devicePixelRatio, viewportScale: globalThis.visualViewport?.scale });
}

function failureDiagnostics(owned) {
  // Keep descriptor shortages visible on failed devices too, not only on complete runs.
  return { eyeImageFrames: owned.gradientFrames ? { ...owned.gradientFrames } : null,
    cadence: owned.cadence ? { ...owned.cadence } : null,
    predictorErrors: owned.modelTiming ? Object.fromEntries(Object.entries(owned.modelTiming).map(([name, timing]) => [name, timing.errors])) : null,
    workerFallbackReason: owned.analyzer?.workerFallbackReason === 'worker_initialization_failed' ? 'worker_initialization_failed' : null,
    scope: 'bounded_technical_counts_only_no_incomplete_accuracy_estimate' };
}

function stop(message = 'Остановлено. Камера выключена.', reason = 'user_stop') {
  const owned = run; run = null;
  if (owned) {
    if (cohort && !report) {
      report = { version: 'gaze_benchmark.v1', benchmark: metadata(owned, false, reason),
        diagnostics: failureDiagnostics(owned),
        rawVideoStored: false, rawLandmarksStored: false, rawGazeStored: false };
      byId('result').textContent = JSON.stringify(report, null, 2); byId('download').hidden = false;
    }
    clearTimeout(owned.safetyTimer); owned.abort.abort(); owned.modelRun?.stop(); owned.observer?.stop(); owned.analyzer?.dispose();
    for (const track of owned.stream?.getTracks() || []) track.stop();
    owned.lastFrame = null; owned.lastPredictions = null; for (const tracker of Object.values(owned.trackers || {})) tracker.reset(); owned.collect = null;
    owned.eyePatchFeatures = null;
  }
  byId('video').srcObject = null;
  byId('target').hidden = true; byId('target').onclick = null;
  byId('target').style.opacity = '1';
  byId('poseStep').hidden = true; byId('poseContinue').onclick = null;
  delete document.body.dataset.posePhase;
  byId('calibrate').hidden = true; byId('stop').disabled = true;
  byId('start').disabled = !canStart(); document.body.classList.remove('running');
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
  const rect = target.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

async function start() {
  if (!canStart() || run || document.hidden) return;
  report = null; byId('download').hidden = true; byId('result').textContent = '';
  const owned = { abort: new AbortController(), lastFrame: null, busy: false, lastStart: -Infinity, count: 0, rejected: 0,
    phase: 'access', startedAt: performance.now(), runId: cohort ? crypto.randomUUID() : null,
    viewport: { width: innerWidth, height: innerHeight } };
  run = owned; byId('start').disabled = true; byId('stop').disabled = false;
  if (cohort) owned.safetyTimer = setTimeout(() => { if (run === owned) stop('Лимит времени запуска истёк. Камера выключена.', 'timeout'); }, 1200000);
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
    const [{ default: Analyzer }, { observeVideoFrames }, vision, { extractFeatureGroups }] = await deadline(Promise.all([
      import('../../participant-web/js/precheck-analyzer/PrecheckAnalyzer.js?v=20261104-4'),
      import('../../participant-web/js/session-runtime/video-frames.mjs?v=20261104-4'),
      import('../../participant-web/js/vendor/mediapipe/vision_bundle.mjs'),
      import('../../participant-web/js/gaze-tracker/features.js?v=20261108-143l'),
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
    owned.eyePatchFrames = { attempted: 0, available: 0, missing: 0, coreAvailable: 0, coreMissing: 0 };
    owned.gradientFrames = { attempted: 0, fullAvailable: 0, allAvailable: 0, lateralAvailable: 0,
      fullMissing: 0, allMissing: 0, lateralMissing: 0 };
    if (tophatMode) owned.gradientFrames = { attempted: 0, fullAvailable: 0, allAvailable: 0, tophatAvailable: 0,
      fullMissing: 0, allMissing: 0, tophatMissing: 0 };
    owned.eyePatchTiming = { frames: 0, totalMs: 0, maxMs: 0 };
    owned.featureTiming = {};
    owned.calibrationTiming = {};
    owned.trackers = createModelComparison(owned.viewport, owned.camera, tophatMode ? 'tophat' : gradientMode ? 'gradient' : appearanceMode ? 'appearance' : axisMode ? 'axis' : ablation,
      eyeImageMode ? (landmarks, region) => owned.eyePatchFeatures?.get(landmarks)?.[region] : null);
    owned.modelTiming = Object.fromEntries(Object.keys(owned.trackers).map(name => [name, { predictions: 0, totalMs: 0, maxMs: 0, errors: 0 }]));
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
        if (gradientMode || tophatMode) {
          const begun = performance.now();
          const extract = (name, factory) => {
            const started = performance.now(), value = factory(), elapsed = performance.now() - started;
            const timing = owned.featureTiming[name] ||= { frames: 0, totalMs: 0, maxMs: 0 };
            timing.frames++; timing.totalMs += elapsed; timing.maxMs = Math.max(timing.maxMs, elapsed);
            return value;
          };
          const full = extract('eye_patch', () => eyePatchFeaturesForFrame(frame)),
            gradient_all = extract('eye_gradient_all', () => eyeGradientFeaturesForFrame(frame, { support: 'all' })),
            extra = tophatMode ? extract('eye_tophat', () => eyeTophatFeaturesForFrame(frame))
              : extract('eye_gradient', () => eyeGradientFeaturesForFrame(frame));
          const elapsed = performance.now() - begun;
          owned.eyePatchTiming.frames++; owned.eyePatchTiming.totalMs += elapsed;
          owned.eyePatchTiming.maxMs = Math.max(owned.eyePatchTiming.maxMs, elapsed);
          owned.gradientFrames.attempted++;
          for (const [name, value] of [['full', full], ['all', gradient_all], [tophatMode ? 'tophat' : 'lateral', extra]])
            owned.gradientFrames[name + (value ? 'Available' : 'Missing')]++;
          if (full || gradient_all || extra) owned.eyePatchFeatures.set(frame.landmarks, {
            full, gradient_all, [tophatMode ? 'tophat' : 'gradient']: extra });
          else if (frame?.landmarks) owned.eyePatchFeatures.delete(frame.landmarks);
        } else if (appearanceMode) {
          const patchStarted = performance.now();
          owned.eyePatchFrames.attempted++;
          const full = eyePatchFeaturesForFrame(frame), core = eyePatchFeaturesForFrame(frame, { region: 'core' });
          const elapsed = performance.now() - patchStarted;
          owned.eyePatchTiming.frames++; owned.eyePatchTiming.totalMs += elapsed;
          owned.eyePatchTiming.maxMs = Math.max(owned.eyePatchTiming.maxMs, elapsed);
          if (full) owned.eyePatchFrames.available++; else owned.eyePatchFrames.missing++;
          if (core) owned.eyePatchFrames.coreAvailable++; else owned.eyePatchFrames.coreMissing++;
          if (full || core) owned.eyePatchFeatures.set(frame.landmarks, { full, core });
          else if (frame?.landmarks) owned.eyePatchFeatures.delete(frame.landmarks);
        }
        owned.lastFrame = frame;
        if (Number.isFinite(frame?.timestamp)) {
          const age = analyzerCompletedAt - frame.timestamp;
          if (age >= 0) { owned.latency.n++; owned.latency.totalMs += age; owned.latency.maxMs = Math.max(owned.latency.maxMs, age); }
        }
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
        const signals = ablation ? comparisonSignals(predictions) : { raw: predictions.baseline, corrected: predictions.baseline };
        if (owned.collect) {
          const groups = extractFeatureGroups(frame?.landmarks);
          observeMatchedWindow(owned.collect, frame?.timestamp, groups?.eye, signals, ablation ? groups : null);
        }
      } catch (_) { if (run === owned) owned.rejected++; }
      finally { owned.busy = false; }
    });
    byId('calibrate').hidden = false;
    owned.phase = 'ready';
    status('Проверьте освещение и положение головы. Нажмите «Начать калибровку». Камера продолжит работать, но preview будет скрыт.');
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
async function check(owned, positions = targets) {
  const rows = [];
  for (let index = 0; index < positions.length; index++) {
    const [x, y] = positions[index]; const target = position(x, y);
    status(`Проверка ${index + 1}/${positions.length}: смотрите точно в центр зелёной точки, не кликайте.`);
    await delay(1000, owned);
    const keys = ablation ? comparisonSignalKeys(owned.trackers) : { raw: ['rawX', 'rawY'], corrected: ['correctedX', 'correctedY'] };
    const collect = createMatchedWindow(target, performance.now(), Object.keys(keys), keys, owned.viewport,
      ablation ? comparisonPairs(owned.trackers) : [], ablation); owned.collect = collect;
    await delay(2000, owned); owned.collect = null;
    const result = finishMatchedWindow(collect, performance.now() - collect.since);
    rows.push({ targetIndex: index, targetPercent: { x, y }, ...result,
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
  const points = Object.fromEntries(Object.keys(owned.trackers).map(name => [name, []]));
  for (let i = 0; i < positions.length; i++) {
    const { x, y } = positions[i], target = position(x, y);
    status(`${label} ${i + 1}/${positions.length}: смотрите в центр зелёной точки, не кликайте.`);
    await delay(1000, owned);
    const windows = Object.fromEntries(Object.keys(owned.trackers).map(name => [name, {
      sampling: createValidationSamplingWindow({ monotonicStart: performance.now(), wallStart: Date.now() }), samples: []
    }]));
    // Exactly the production 60 polls at 33 ms after the same 1000 ms settle.
    for (let poll = 0; poll < 60; poll++) {
      await delay(33, owned);
      for (const [name, { sampling, samples }] of Object.entries(windows)) {
        const p = owned.lastPredictions?.[name], sx = raw ? p?.rawX : p?.correctedX, sy = raw ? p?.rawY : p?.correctedY;
        if (p?.valid && Number.isFinite(sx) && Number.isFinite(sy) && sampling.accept(p)) samples.push({
          gazeX: sx, gazeY: sy, targetX: target.x, targetY: target.y,
          rawX: p.rawX, rawY: p.rawY, correctedX: p.correctedX, correctedY: p.correctedY,
          displayX: p.displayX, displayY: p.displayY });
      }
    }
    for (const [name, { sampling, samples }] of Object.entries(windows)) points[name].push({
      pointIndex: i, targetX: target.x, targetY: target.y, samples, sampling: sampling.summary()
    });
  }
  return points;
}

async function calibrate() {
  const owned = run;
  if (!owned || owned.calibrating) return;
  if (appearanceMode && (!owned.eyePatchFrames.available || !owned.eyePatchFrames.coreAvailable)) {
    status('Изображение глаз текущего кадра пока недоступно. Проверьте лицо/свет и повторите «Начать калибровку». Камера включена.'); return;
  }
  if ((gradientMode || tophatMode) && (!owned.gradientFrames.fullAvailable || !owned.gradientFrames.allAvailable
    || !owned.gradientFrames[tophatMode ? 'tophatAvailable' : 'lateralAvailable'])) {
    status('Центр глаза в текущих изображениях пока не найден. Проверьте свет/лицо и повторите «Начать калибровку». Камера включена.'); return;
  }
  owned.calibrating = true; byId('calibrate').hidden = true; byId('video').hidden = true;
  owned.phase = 'calibration';
  document.body.classList.add('running'); byId('target').style.backgroundColor = '#DC2626';
  const clickSummaries = [], repeatability = [];
  try {
    for (let i = 0; i < CALIBRATION_POSITIONS.length; i++) {
      const pos = CALIBRATION_POSITIONS[i], target = position(pos.x, pos.y);
      let firstFeatures = null;
      for (let click = 0; click < CALIBRATION_CLICKS;) {
        status(`Калибровка ${i + 1}/25 — нажатие ${click + 1}/2. Смотрите в центр красного круга.`);
        await deadline(new Promise(resolve => { byId('target').onclick = () => { byId('target').onclick = null; resolve(); }; }), 60000, owned);
        byId('target').style.opacity = '0.5';
        const policy = calibrationCapturePolicy(pos);
        const captured = await collectCalibrationClick({ policy, getFrame: () => owned.lastFrame,
          onLandmarkCopy: eyeImageMode ? (frame, copy) => {
            const values = owned.eyePatchFeatures?.get(frame.landmarks);
            if (values) owned.eyePatchFeatures.set(copy, Object.fromEntries(Object.entries(values).map(([region, value]) => [region, value?.slice()])));
          } : null,
          isActive: () => run === owned && !owned.abort.signal.aborted && !document.hidden });
        if (run !== owned) { captured.frames.length = 0; throw new Error('cancelled'); }
        const patchFrames = eyeImageMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.full).length : null;
        const coreFrames = appearanceMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.core).length : null;
        const gradientFrames = gradientMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.gradient).length : null;
        const allGradientFrames = gradientMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.gradient_all).length : null;
        const tophatFrames = tophatMode ? captured.frames.filter(frame => owned.eyePatchFeatures.get(frame)?.tophat).length : null;
        const trainingFrames = tophatMode ? commonTophatCalibrationFrames(captured.frames,
          (frame, region) => owned.eyePatchFeatures.get(frame)?.[region]) : gradientMode ? commonGradientCalibrationFrames(captured.frames,
          (frame, region) => owned.eyePatchFeatures.get(frame)?.[region]) : appearanceMode ? commonAppearanceCalibrationFrames(captured.frames,
          (frame, region) => owned.eyePatchFeatures.get(frame)?.[region]) : captured.frames;
        const patchReady = !eyeImageMode || trainingFrames.length >= policy.minFrames;
        const added = captured.summary.accepted && patchReady ? Object.values(owned.trackers).map(tracker =>
          tracker.addAveragedCalibrationPoint(trainingFrames, target.x, target.y, { minFrames: policy.minFrames })) : [];
        if (added.some(Boolean) && !added.every(Boolean)) throw new Error('model_calibration_disagreement');
        const accepted = added.length > 0 && added.every(Boolean);
        const commonFrames = trainingFrames.length;
        captured.frames.length = 0;
        clickSummaries.push({ targetIndex: i, clickIndex: click, ...captured.summary, accepted,
          ...(appearanceMode ? { eyePatchUsableFrames: patchFrames, eyePatchCoreUsableFrames: coreFrames,
            eyePatchCommonUsableFrames: commonFrames } : {}),
          ...(gradientMode ? { eyePatchUsableFrames: patchFrames, gradientUsableFrames: gradientFrames,
            allGradientUsableFrames: allGradientFrames, commonEyeImageFrames: commonFrames } : {}),
          ...(tophatMode ? { eyePatchUsableFrames: patchFrames, tophatUsableFrames: tophatFrames,
            commonEyeImageFrames: commonFrames } : {}) });
        owned.calibrationAttempts = clickSummaries.length;
        if (accepted) owned.calibrationAccepted = (owned.calibrationAccepted || 0) + 1;
        if (clickSummaries.length > 200) throw new Error('calibration_retry_limit');
        byId('target').style.opacity = '1';
        if (!accepted) { status(eyeImageMode && !patchReady
          ? 'Недостаточно изображений глаз из тех же свежих кадров. Проверьте свет/лицо и повторите нажатие.'
          : 'Недостаточно свежих кадров с открытыми глазами. Повторите то же нажатие.'); continue; }
        if (click === 0) firstFeatures = captured.meanFeatures;
        else repeatability.push({ targetIndex: i, ...compareCalibrationClicks(firstFeatures, captured.meanFeatures) });
        click++;
      }
    }
    byId('target').onclick = null;
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
    if (!gradientPose) owned.phase = 'spatial_before';
    const before = gradientPose ? [] : await check(owned);
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
    const summary = { version: tophatMode ? 'issue143_eye_tophat.v10' : gradientPose ? 'issue143_eye_gradient_pose.v9' : gradientTemporal ? 'issue143_eye_gradient_temporal.v8' : gradientMode ? 'issue143_eye_gradient.v7' : appearanceMode ? 'issue143_eye_patch.v6' : axisMode ? 'issue143_axis_regularization.v5' : ablation ? 'issue143_factorial_geometry.v4' : 'issue143_production_calibration.v3',
      ...(ablation ? { models: modelReports, comparison: axisMode || eyeImageMode
        ? 'same_captures_common_baseline_gate_calibration_only_model_selection'
        : 'same_captures_common_baseline_gate_no_model_selection' }
        : { model: modelInfo(owned.trackers.baseline.getStatus()), correction: corrections.baseline }),
      calibration: { clicks: clickSummaries, repeatability },
      intervalMs, ...(gradientPose ? { temporalScope: 'posture_probe_not_long_interval_drift' }
        : gradientTemporal ? { temporalScope: 'same_targets_before_after_no_within_interval_accuracy', temporalGap }
        : gradientMode || tophatMode ? { temporalScope: 'spatial_only_no_drift_measurement' } : {}), viewport: owned.viewport,
      camera: owned.camera,
      backend: owned.analyzer.backend, frameCount: owned.count, frameErrors: owned.rejected,
      ...(ablation ? { cadence: owned.cadence } : {}),
      ...(appearanceMode ? { eyePatchFrames: { ...owned.eyePatchFrames }, eyePatchImagesStored: false, eyePatchFeaturesStored: false,
        calibrationFramePolicy: 'intersection_of_full_core_before_all_model_averages',
        eyePatchRuntimeMs: { frames: owned.eyePatchTiming.frames,
          mean: owned.eyePatchTiming.frames ? owned.eyePatchTiming.totalMs / owned.eyePatchTiming.frames : null,
          max: owned.eyePatchTiming.maxMs, scope: 'full_and_core_feature_extraction_only_not_inference_or_end_to_end' },
        eyePatchStorageScope: 'no_export_checkpoint_or_persistent_storage_transient_fit_only' } : {}),
      ...(gradientMode || tophatMode ? { eyeImageFrames: { ...owned.gradientFrames }, eyeImageStorageScope: 'transient_only_no_images_features_or_weights_in_export',
        calibrationFramePolicy: tophatMode ? 'intersection_of_full_gradient_all_tophat_before_all_model_averages'
          : 'intersection_of_full_gradient_all_gradient_before_all_model_averages',
        featureRuntimeMs: Object.fromEntries(Object.entries(owned.featureTiming).map(([name, timing]) => [name, {
          frames: timing.frames, mean: timing.frames ? timing.totalMs / timing.frames : null,
          max: timing.maxMs, scope: 'descriptor_extraction_only_not_camera_regression_or_end_to_end' }])),
        eyeImageRuntimeMs: { frames: owned.eyePatchTiming.frames,
          mean: owned.eyePatchTiming.frames ? owned.eyePatchTiming.totalMs / owned.eyePatchTiming.frames : null,
          max: owned.eyePatchTiming.maxMs, scope: 'all_three_eye_feature_extractors_not_camera_or_end_to_end' } } : {}),
      completedFrameAgeMs: { mean: owned.latency.n ? owned.latency.totalMs / owned.latency.n : null, max: owned.latency.maxMs,
        scope: 'capture_to_analyzer_result_not_display_latency' },
      ...(poseProbe ? { poseProbe } : { before, after }), rawVideoStored: false, rawLandmarksStored: false, rawGazeStored: false,
      limitation: poseProbe
        ? 'Standalone A-B-A posture probe. Head diagnostics are proxies, not measured pose. No long-interval drift or accuracy certification.'
        : 'Shared production calibration/correction, standalone analyzer, not the complete multimodal participant pipeline. No accuracy certification. Drift onset inside the uninterrupted interval is unknown.' };
    owned.phase = 'completed';
    report = cohort ? { ...summary, version: 'gaze_benchmark.v1', benchmark: metadata(owned, true) } : summary;
    stop('Проверка завершена. Камера выключена. Скачайте JSON-сводку. Это не автоматическое решение о валидности.');
    byId('result').textContent = JSON.stringify(report, null, 2); byId('download').hidden = false;
  } catch (error) { if (run === owned) stop('Проверка прервана: остановка, таймаут или недостаточно кадров. Камера выключена. Не используйте неполный результат как успешный.', benchmarkFailureReason(error)); }
}

byId('start').onclick = start; byId('calibrate').onclick = calibrate; byId('stop').onclick = () => stop();
byId('download').onclick = () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url;
  a.download = cohort ? `wecog-gaze-${protocol}-${report.benchmark.runId}.json` : tophatMode ? 'wecog-issue143-eye-tophat-v10.json' : gradientPose ? 'wecog-issue143-eye-gradient-pose-v9.json'
    : gradientTemporal ? 'wecog-issue143-eye-gradient-temporal-v8.json'
    : gradientMode ? 'wecog-issue143-eye-gradient-v7.json' : 'wecog-issue143-local-check.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
addEventListener('pagehide', () => stop());
addEventListener('keydown', event => { if (run && event.key === 'Escape') stop(); });
document.addEventListener('visibilitychange', () => { if (run && document.hidden) stop('Вкладка скрыта. Проверка остановлена, камера выключена.', 'page_hidden'); });
addEventListener('resize', () => { if (run?.calibrating) stop('Размер окна изменился. Тест остановлен, камеру выключили. Начните заново с неизменным окном.', 'viewport_changed'); });
globalThis.visualViewport?.addEventListener('resize', () => { if (run?.calibrating) stop('Масштаб или видимая область изменились. Нужна новая калибровка.', 'viewport_changed'); });
if (ablation) document.getElementById('modelDescription').textContent = 'Четыре варианта модели на одних кадрах: текущая/пиксельная геометрия × квадратичная/линейная формула. У всех одинаковая калибровка, confidence/head/OOD gate, отдельная коррекция. В JSON только сводки ошибок, усреднённых признаков радужек/головы и технических счётчиков — без видео, landmarks и покадровых рядов. Модель автоматически не выбирается; на API ничего не отправляется.';
if (axisMode) document.getElementById('modelDescription').textContent = 'Проверка регуляризации и формулы каждой оси: текущая модель, линейная, фиксированные λ 0.001/0.01/0.1/1 для обеих формул, смешанный X-quadratic/Y-linear и вариант с независимым выбором формулы и λ для X/Y только на калибровке. Всего 12 регрессий на одних кадрах одной камеры. На контрольных целях ничего не обучается. В JSON только агрегаты ошибок/признаков и кривые калибровочного CV, без видео, landmarks и покадровых рядов. На API ничего не отправляется.';
if (appearanceMode) document.getElementById('modelDescription').textContent = 'Четыре экспериментальных варианта: исходная iris-модель, раздельная формула X/Y и два варианта по изображениям глаз — полный patch и центральная область с меньшим влиянием периферии век. Устойчивость к векам не гарантирована. Один camera/MediaPipe кадр для всех, обработка только локальная. Fit только на калибровке, без подстройки по контрольным целям или времени. В памяти — текущие признаки и ограниченный калибровочный набор; набор удаляется после fit. JSON содержит только агрегаты, покрытие и CV-кривые, без изображений, patch-векторов, landmarks и покадровых рядов. Missing patch не заменяется старым прогнозом. Отправки на API нет.';
if (gradientMode || tophatMode) {
  document.getElementById('modelDescription').textContent = 'Сравнение: исходная модель, прежний полный eye-patch и два варианта с центром радужки по градиентам изображения. Все получают одни кадры одной камеры; общие eye/head gates не ослабляются. Fit только на калибровке, контрольные цели не обучают модель. Изображения, признаки и веса не сохраняются и не экспортируются; JSON содержит только сводки и counts. Есть известные ограничения при бликах и закрытии глаз. На API ничего не отправляется; автоматической приёмки нет.';
  document.getElementById('durationDescription').textContent = gradientPose
    ? 'После одной калибровки и проверки коррекции — три короткие серии по тем же пяти точкам: обычная посадка, чуть ниже и возврат. Положение камеры и окна не меняйте. Модель не переобучается; четырёхминутного интервала нет.'
    : gradientTemporal
    ? 'После калибровки и проверки коррекции — две проверки по тем же 9 точкам. Между ними 4 минуты без проверочных точек и без подстройки модели. Это отдельная диагностика примерно на 7–8 минут, не рабочий протокол.'
    : 'После 25 точек — подготовка и независимая проверка коррекции, затем одна проверка по 9 точкам. Без четырёхминутного интервала и повторной серии: около 2–3 минут плюс время на нажатия. Эта версия проверяет пространственную точность, а не длительный дрейф.';
}
if (tophatMode) byId('modelDescription').textContent = 'Локальное сравнение исходной модели, полного eye-patch, Gradient All и нового горизонтального black top-hat. Он подавляет широкие изменения яркости, но не гарантирует устойчивость к реальной посадке. Все обучаются на общих кадрах одной камеры, только на калибровке; head не обучается предсказывать цель. Есть известные failures при текстуре и почти закрытых глазах. Изображения, признаки и веса не экспортируются; на API ничего не отправляется.';
if (!canStart()) byId('start').disabled = true;
return { stop, clearReport() { report = null; byId('download').hidden = true; byId('result').textContent = ''; } };
}
