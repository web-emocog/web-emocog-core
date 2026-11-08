// Exploration on artificial images: no webcam data, no production promotion.
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Tracker from '../../apps/participant-web/js/gaze-tracker/GazeTracker.js';
import { extractEyeGradientFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-gradient-features.mjs';
import { landmarksForGaze } from '../../apps/api/tests/fixtures/gaze-topology.js';
import { syntheticEyeImage } from '../../apps/autotests/fixtures/issue143-eye-image.mjs';
import { createMatchedWindow, finishMatchedWindow, observeMatchedWindow } from '../../apps/autotests/manual/issue143-summary.mjs';
import { fitGradientMapping } from './issue143-gradient-mapping.mjs';

const viewport = { width: 1470, height: 956 }, camera = { width: 640, height: 480 };
const methods = ['v7_gradient_all', 'binocular_linear', 'binocular_quadratic'];
const pairs = methods.slice(1).map(candidate => ({ baseline: methods[0], candidate }));
const tests = [-.94, -.57, -.19, .22, .65, .94];
const train = [-.84, -.42, 0, .42, .84];
const offscreen = [[-1.18, -.19], [-1.18, .22], [1.18, -.19], [1.18, .22],
  [-.19, -1.18], [.22, -1.18], [-.19, 1.18], [.22, 1.18]];
const screen = (x, y) => ({ x: (x + 1) * viewport.width / 2, y: (y + 1) * viewport.height / 2 });
const angular = (value, gain, offset) => (Math.atan(gain * (value + offset)) - Math.atan(gain * offset)) / Math.atan(gain);
const render = (x, y, { projection, pose = {}, image = {}, jitter = 0, step = 0, verticalShift = 0,
  oneEyeShift = 0, missing = false } = {}) => {
  const face = landmarksForGaze(x, y, pose);
  if (missing) return { face, centers: null, extractionMs: 0 };
  const gx = (projection ? angular(x, 1.35, -.2) : x) + jitter * Math.sin(step * 1.7);
  const gy = (projection ? angular(y, 1.6, .36) : y) + jitter * Math.cos(step * 1.9) + verticalShift;
  const pixels = syntheticEyeImage(face, { gazeX: gx, gazeY: gy, ...camera, ...image });
  const start = performance.now();
  const centers = extractEyeGradientFeatures(pixels, face, { support: 'all' });
  if (centers && oneEyeShift) centers[1] += oneEyeShift;
  return { face, centers, extractionMs: performance.now() - start };
};

const conditions = [
  ['linear_reference', false, {}],
  ['angular_projection', true, {}],
  ['projection_jitter', true, { jitter: .035 }],
  ['projection_partial_lid', true, { image: { aperture: .16, lidShift: .04 } }],
  ['projection_glare', true, { image: { glare: 250 } }],
  ['projection_image_plane_roll_scale', true, { pose: { roll: .035, scale: .97 } }],
  ['projection_vertical_image_shift', true, { verticalShift: .13 }],
  ['projection_one_eye_descriptor_shift', true, { oneEyeShift: .07 }],
  ['projection_missing_pixels', true, { missingEvery: 4 }],
];

const rounded = v => Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
const divide = (a, n) => n ? a / n : null;
const newTotal = () => ({ accepted: 0, attempted: 0, offScreen: 0, weightedError: 0, weightedSpread2: 0,
  edge: { accepted: 0, weightedError: 0 }, worstTargetMeanErrorPx: null,
  biasX: 0, biasY: 0, commonAccepted: 0, commonErrorDelta: 0,
  truthOffScreen: { attempted: 0, missing: 0, predictedOffScreen: 0, falseOnScreen: 0 } });

export function runSyntheticMappingComparison(only = null) {
  return conditions.filter(([name]) => only === null || name === only).map(([condition, projection, nuisance]) => {
    const byFace = new WeakMap(), rows = [];
    const v7 = new Tracker({ screenWidth: viewport.width, screenHeight: viewport.height,
      experimentalEyePatch: { region: 'gradient_all', frameWidth: camera.width, frameHeight: camera.height,
        readFeatures: face => byFace.get(face) } });
    for (const x of train) for (const y of train) for (let click = 0; click < 2; click++) {
      const f = render(x, y, { projection, jitter: .008, step: rows.length });
      const target = screen(x, y);
      if (!f.centers) throw new Error('artificial_calibration_crop_missing');
      byFace.set(f.face, f.centers);
      if (!v7.addCalibrationPoint(f.face, target.x, target.y)) throw new Error('v7_calibration_capture_rejected');
      rows.push({ centers: f.centers, screenX: target.x, screenY: target.y });
    }
    if (!v7.calibrate()) throw new Error('v7_fit_failed');
    const fitStarted = performance.now();
    const fitted = Object.fromEntries(methods.slice(1).map(method => [method, fitGradientMapping(rows, method)]));
    const candidateFitTotalMs = performance.now() - fitStarted;
    if (!Object.values(fitted).every(Boolean)) throw new Error('candidate_fit_failed');
    rows.length = 0;

    const totals = Object.fromEntries(methods.map(name => [name, newTotal()]));
    let captures = 0, extracted = 0, extractionMs = 0, candidatePredictMs = 0, candidatePredictions = 0;
    const predict = (x, y, step) => {
      const f = render(x, y, { projection, ...nuisance, step,
        missing: Boolean(nuisance.missingEvery && step % nuisance.missingEvery === 0) });
      if (f.centers) byFace.set(f.face, f.centers);
      extractionMs += f.extractionMs; if (f.extractionMs > 0) extracted++;
      const p = v7.predict(f.face, { timestamp: ++captures * 33 });
      const predictions = { v7_gradient_all: p };
      for (const [method, model] of Object.entries(fitted)) {
        if (!p?.valid) { predictions[method] = p; continue; }
        const started = performance.now(), mapped = model.predict(f.centers);
        candidatePredictMs += performance.now() - started; candidatePredictions++;
        if (!mapped) throw new Error('candidate_disagreed_on_finite_features');
        predictions[method] = { valid: true, rawX: Math.round(mapped.x), rawY: Math.round(mapped.y) };
      }
      return predictions;
    };
    for (const x of tests) for (const y of tests) {
      const edge = Math.abs(x) === .94 || Math.abs(y) === .94;
      const window = createMatchedWindow(screen(x, y), 0, methods, {}, viewport, pairs);
      for (let sample = 0; sample < 6; sample++) {
        observeMatchedWindow(window, captures + 1, null, predict(x, y, sample));
      }
      const summary = finishMatchedWindow(window, 198);
      for (const [method, result] of Object.entries(summary.models)) {
        const t = totals[method], n = result.accepted;
        t.accepted += n; t.attempted += result.attempted; t.offScreen += result.offScreen;
        if (!n) continue;
        t.weightedError += n * result.meanErrorPx;
        t.weightedSpread2 += n * (result.withinTargetSdXPx ** 2 + result.withinTargetSdYPx ** 2);
        t.biasX += n * result.biasXPx; t.biasY += n * result.biasYPx;
        t.worstTargetMeanErrorPx = Math.max(t.worstTargetMeanErrorPx ?? 0, result.meanErrorPx);
        if (edge) { t.edge.accepted += n; t.edge.weightedError += n * result.meanErrorPx; }
      }
      for (const p of summary.comparisons) {
        totals[p.candidate].commonAccepted += p.commonAccepted;
        if (p.commonAccepted) totals[p.candidate].commonErrorDelta += p.commonAccepted * p.candidateMinusBaselineMeanErrorPx;
      }
    }
    for (const [i, [x, y]] of offscreen.entries()) {
      for (const [method, p] of Object.entries(predict(x, y, i))) {
        const t = totals[method].truthOffScreen; t.attempted++;
        if (!p?.valid) t.missing++;
        else if (p.rawX < 0 || p.rawX > viewport.width || p.rawY < 0 || p.rawY > viewport.height) t.predictedOffScreen++;
        else t.falseOnScreen++;
      }
    }
    const result = { condition, candidateFitTotalMs: rounded(candidateFitTotalMs),
      meanGradientExtractionMs: rounded(divide(extractionMs, extracted)),
      meanCandidateMappingMs: rounded(divide(candidatePredictMs, candidatePredictions)),
      methods: Object.fromEntries(Object.entries(totals).map(([method, t]) => [method, {
        attempted: t.attempted, accepted: t.accepted, missing: t.attempted - t.accepted, offScreen: t.offScreen,
        meanErrorPx: rounded(divide(t.weightedError, t.accepted)),
        edgeMeanErrorPx: rounded(divide(t.edge.weightedError, t.edge.accepted)),
        worstTargetMeanErrorPx: rounded(t.worstTargetMeanErrorPx),
        withinTargetRmsSpreadPx: t.accepted ? rounded(Math.sqrt(t.weightedSpread2 / t.accepted)) : null,
        biasXPx: rounded(divide(t.biasX, t.accepted)), biasYPx: rounded(divide(t.biasY, t.accepted)),
        ...(method === methods[0] ? {} : { commonAccepted: t.commonAccepted,
          candidateMinusV7MeanErrorPx: rounded(divide(t.commonErrorDelta, t.commonAccepted)) }),
        truthOffScreen: t.truthOffScreen,
        calibration: method === methods[0] ? v7.getCalibrationDiagnostics() : fitted[method].diagnostics,
      }])) };
    v7.reset();
    return result;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify({ version: 'issue143_gradient_mapping_synthetic.v1',
    scope: 'artificial_inputs_fixed_calibration_no_real_drift_or_camera_latency',
    calibrationTargets: 25, clicksPerTarget: 2, heldOutTargets: 36, samplesPerTarget: 6,
    signal: 'raw_only', gate: 'exactly_shared_v7_gradient_all', timingScope: 'extraction_or_mapping_only',
    results: runSyntheticMappingComparison() }, null, 2));
}
