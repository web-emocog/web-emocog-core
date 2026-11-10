// Artificial perturbations, not recordings, physiological head motion or drift.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { landmarksForGaze } from '../../apps/api/tests/fixtures/gaze-topology.js';
import { syntheticApertureLandmarks, syntheticEyeImage } from '../../apps/autotests/fixtures/issue143-eye-image.mjs';
import { extractEyePatchFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-patch-features.mjs';
import { extractEyeGradientFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-gradient-features.mjs';
import { extractRowPatch } from '../../apps/participant-web/js/gaze-tracker/eye-tophat-features.mjs';
import { createModelComparison } from '../../apps/web/developer/gaze-benchmark-models.mjs';
import { fitGradientMapping } from './issue143-gradient-mapping.mjs';
import { confirmEyeShapeCenters, fitEyeShapeCenters } from './issue143-eye-shape.mjs';
import { extractMaskedEyeCenters } from '../../apps/web/developer/gaze-eye-masked.mjs';
import { projectPatchRows } from '../../apps/web/developer/gaze-eye-patch-rows.mjs';

const viewport = { width: 1470, height: 956 }, camera = { width: 640, height: 480 };
const screen = (x, y) => ({ x: (x + 1) * viewport.width / 2, y: (y + 1) * viewport.height / 2 });
const outside = ({ x, y }) => x < 0 || x > viewport.width || y < 0 || y > viewport.height;
const shapeIds = ['eye_shape', 'eye_shape_local', 'eye_shape_local_observed', 'eye_shape_masked', 'eye_shape_masked_fine'];
const projectedIds = ['eye_patch_row_centered', 'eye_patch_row_soft'];
const ids = ['baseline', 'eye_patch', 'eye_gradient_all', 'eye_tophat', ...shapeIds, 'eye_shape_confirmed',
  'eye_shape_masked_pooled', 'eye_shape_masked_soft', ...projectedIds];
const conditions = {
  reference: {}, lid_up: { image: { lidShift: -.04 } }, lid_down: { image: { lidShift: .04 } },
  partial_lid: { image: { aperture: .14 } }, near_closed: { image: { aperture: .035 } },
  no_iris: { image: { irisVisible: false } }, glare: { image: { glare: 250 } },
  texture: { image: { texture: 20 } }, low_contrast: { image: { contrast: .3, brightness: 50 } },
  row_illumination: { image: { rowIllumination: 45 } },
  lid_with_row_illumination: { image: { rowIllumination: 45, aperture: .15, lidShift: .035, irisProfile: 'soft_oval' } },
  image_plane_roll_scale: { pose: { roll: .035, scale: .95 } },
  landmark_bias: { irisLandmarkBiasY: .28 },
  unfamiliar_iris_profile: { image: { irisProfile: 'soft_oval' } },
  combined: { image: { irisProfile: 'soft_oval', aperture: .17, lidShift: .035, contrast: .55, texture: 9 },
    pose: { roll: -.035, scale: .96 }, irisLandmarkBiasY: .21 },
  moving_texture: { image: { irisProfile: 'soft_oval', texture: 20 }, textureStep: .71 },
  no_iris_with_texture: { image: { irisVisible: false, texture: 20 }, textureStep: .71 },
  partial_mask_registration_error: { image: { aperture: .14, lidShift: .035, irisProfile: 'soft_oval', texture: 7 },
    mask: { maskShift: .035, maskScale: 1.15 }, irisLandmarkBiasY: .18 },
  partial_mask_jitter: { image: { aperture: .14, lidShift: -.025, irisProfile: 'soft_oval' },
    mask: { maskScale: 1.1 }, maskJitter: .035, irisLandmarkBiasY: .18 },
  missing_pixels: { missingEvery: 4 },
};
const offScreenCases = d => [[-d, -.2], [-d, .2], [d, -.2], [d, .2], [-.2, -d], [.2, -d], [-.2, d], [.2, d]];
const offScreenBands = { offScreenTruth: offScreenCases(1.25), nearOffScreenTruth: offScreenCases(1.06) };
const emptyOffScreenCounts = () => ({ predictedOffScreen: 0, falseOnScreen: 0, missing: 0 });
const divide = (sum, n) => n ? sum / n : null;
const mean = a => divide(a.reduce((sum, v) => sum + v, 0), a.length);

export function runEyeShapeSynthetic() {
  const features = new WeakMap();
  const models = createModelComparison(viewport, camera, 'tophat', (face, region) => features.get(face)?.[region]);
  models.eye_shape_masked_pooled = createModelComparison(viewport, camera, 'masked',
    (face, region) => features.get(face)?.[region]).eye_masked;
  models.eye_shape_masked_soft = createModelComparison(viewport, camera, 'masked',
    face => features.get(face)?.masked_soft).eye_masked;
  for (const id of projectedIds) {
    // Use the full patch's identical ridge/gate configuration. Only the
    // offline supplied intensity vector differs, not the fitted model family.
    models[id] = createModelComparison(viewport, camera, 'tophat',
      face => features.get(face)?.[id]).eye_patch;
  }
  const timings = {};
  const time = (name, fn) => {
    const start = performance.now(), value = fn(), elapsed = performance.now() - start;
    const record = timings[name] ??= { calls: 0, sumMs: 0, maxMs: 0 };
    record.calls++; record.sumMs += elapsed; record.maxMs = Math.max(record.maxMs, elapsed);
    return value;
  };
  const render = (x, y, options = {}, index = 0) => {
    const face = landmarksForGaze(x, y + (options.irisLandmarkBiasY || 0), options.pose);
    const pixels = options.missingEvery && index % options.missingEvery === 0 ? null
      : syntheticEyeImage(face, { gazeX: x, gazeY: y, ...camera, ...options.image, texturePhase: (options.textureStep || 0) * index });
    const vectors = { full: time('full_patch', () => extractEyePatchFeatures(pixels, face)),
      gradient_all: time('gradient_all', () => extractEyeGradientFeatures(pixels, face, { support: 'all' })),
      tophat: time('top_hat', () => extractRowPatch(pixels, face, 'row_tophat')) };
    vectors.eye_patch_row_centered = time('project_patch_rows', () => projectPatchRows(vectors.full));
    vectors.eye_patch_row_soft = time('soft_project_patch_rows', () => projectPatchRows(vectors.full, .25));
    const lids = syntheticApertureLandmarks(face, { ...camera, ...options.image, ...options.mask,
      maskShift: (options.mask?.maskShift || 0) + (options.maskJitter || 0) * Math.sin(index * 1.39) });
    const centers = { eye_shape: time('shape_fit_after_top_hat', () => fitEyeShapeCenters(vectors.tophat)),
      eye_shape_local: time('shape_local_fit_after_top_hat', () => fitEyeShapeCenters(vectors.tophat, 'local')),
      eye_shape_local_observed: time('shape_local_observed_fit_after_top_hat', () => fitEyeShapeCenters(vectors.tophat, 'local_observed')),
      eye_shape_masked: time('shape_masked_template', () => extractMaskedEyeCenters(pixels, face, lids)),
      eye_shape_masked_fine: time('shape_masked_template_fine', () => extractMaskedEyeCenters(pixels, face, lids, { fine: true })),
      eye_shape_masked_pooled: time('shape_masked_template_pooled', () => extractMaskedEyeCenters(pixels, face, lids, { pooledFit: true })),
      eye_shape_masked_soft: time('shape_masked_template_soft', () => extractMaskedEyeCenters(pixels, face, lids,
        { pooledFit: true, softSupport: true })) };
    vectors.masked = centers.eye_shape_masked_pooled;
    vectors.masked_soft = centers.eye_shape_masked_soft;
    features.set(face, vectors);
    return { face, vectors, centers };
  };
  const training = Object.fromEntries(shapeIds.map(id => [id, []]));
  for (const x of [-.84, -.42, 0, .42, .84]) for (const y of [-.84, -.42, 0, .42, .84]) for (let click = 0; click < 2; click++) {
    const { face, centers, vectors } = render(x + click * .008, y - click * .008);
    const target = screen(x, y);
    if (!Object.values(centers).every(Boolean) || !Object.values(vectors).every(Boolean)) throw new Error('incomplete_common_training_capture');
    for (const model of Object.values(models)) if (!model.addCalibrationPoint(face, target.x, target.y)) throw new Error('training_capture_rejected');
    for (const id of shapeIds) training[id].push({ centers: centers[id], screenX: target.x, screenY: target.y });
  }
  for (const model of Object.values(models)) if (!model.calibrate()) throw new Error('comparison_fit_failed');
  const shapes = Object.fromEntries(shapeIds.map(id => [id, fitGradientMapping(training[id], 'binocular_linear')]));
  if (!Object.values(shapes).every(Boolean)) throw new Error('shape_fit_failed');
  for (const id of shapeIds) training[id].length = 0;

  let timestamp = 0;
  const predict = (x, y, options, i) => {
    const { face, centers, vectors } = render(x, y, options, i);
    const context = { timestamp: timestamp += 33 };
    const p = Object.fromEntries(Object.entries(models).map(([name, model]) => [name, model.predict(face, context)]));
    const predictions = Object.fromEntries(Object.entries(p).map(([name, value]) => [name, value?.valid ? { x: value.rawX, y: value.rawY } : null]));
    for (const id of shapeIds) {
      const candidate = p.baseline?.valid && centers[id] ? shapes[id].predict(centers[id]) : null;
      predictions[id] = candidate ? { x: Math.round(candidate.x), y: Math.round(candidate.y) } : null;
    }
    // Confirmation is an inference-only ablation of the SAME fitted model.
    predictions.eye_shape_confirmed = confirmEyeShapeCenters(centers.eye_shape_local_observed, vectors.gradient_all)
      ? predictions.eye_shape_local_observed : null;
    return predictions;
  };
  const reference = {};
  const results = Object.entries(conditions).map(([condition, options]) => {
    const totals = Object.fromEntries(ids.map(id => [id, { n: 0, accepted: 0, offScreen: 0, error: [], edgeError: [],
      bottomError: [], spread2: 0, commonBaselineDelta: [], commonPatchDelta: [], commonShapeDelta: [], commonGradientDelta: [], targetBiasChanges: [],
      offScreenTruth: emptyOffScreenCounts(), nearOffScreenTruth: emptyOffScreenCounts() }]));
    const positions = [-.94, -.62, -.21, .23, .65, .94];
    for (const x of positions) for (const y of positions) {
      const target = screen(x, y), window = Object.fromEntries(ids.map(id => [id, []]));
      for (let i = 0; i < 6; i++) {
        const p = predict(x + .012 * Math.sin(i * 1.7), y + .012 * Math.cos(i * 1.9), options, i);
        const error = v => Math.hypot(v.x - target.x, v.y - target.y);
        for (const id of ids) {
          const t = totals[id], v = p[id]; t.n++;
          if (!v) continue;
          window[id].push(v); t.accepted++; t.offScreen += Number(outside(v));
          const e = error(v); t.error.push(e);
          if (Math.max(Math.abs(x), Math.abs(y)) === .94) t.edgeError.push(e);
          if (y === .94) t.bottomError.push(e);
          if (p.baseline) t.commonBaselineDelta.push(e - error(p.baseline));
          if (p.eye_patch) t.commonPatchDelta.push(e - error(p.eye_patch));
          if (p.eye_shape) t.commonShapeDelta.push(e - error(p.eye_shape));
          if (p.eye_gradient_all) t.commonGradientDelta.push(e - error(p.eye_gradient_all));
        }
      }
      for (const id of ids) {
        const samples = window[id], t = totals[id];
        if (!samples.length) continue;
        const mx = mean(samples.map(p => p.x)), my = mean(samples.map(p => p.y));
        t.spread2 += samples.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0);
        const key = `${id}:${x}:${y}`;
        if (condition === 'reference') reference[key] = my;
        else if (Number.isFinite(reference[key])) t.targetBiasChanges.push(my - reference[key]);
      }
    }
    for (const [band, coordinates] of Object.entries(offScreenBands)) coordinates.forEach(([x, y], i) => {
      const p = predict(x, y, options, i);
      for (const id of ids) totals[id][band][!p[id] ? 'missing' : outside(p[id]) ? 'predictedOffScreen' : 'falseOnScreen']++;
    });
    return { condition, models: Object.fromEntries(Object.entries(totals).map(([id, t]) => [id, {
      attempted: t.n, accepted: t.accepted, missing: t.n - t.accepted, offScreenOnScreenTruth: t.offScreen,
      meanErrorPx: mean(t.error), edgeMeanErrorPx: mean(t.edgeError), bottomMeanErrorPx: mean(t.bottomError),
      withinTargetRmsSpreadPx: t.accepted ? Math.sqrt(t.spread2 / t.accepted) : null,
      commonBaseline: { n: t.commonBaselineDelta.length, errorDeltaPx: mean(t.commonBaselineDelta) },
      commonPatch: { n: t.commonPatchDelta.length, errorDeltaPx: mean(t.commonPatchDelta) },
      commonShape: { n: t.commonShapeDelta.length, errorDeltaPx: mean(t.commonShapeDelta) },
      commonGradient: { n: t.commonGradientDelta.length, errorDeltaPx: mean(t.commonGradientDelta) },
      verticalChangeFromReference: { matchedTargets: t.targetBiasChanges.length, meanPx: mean(t.targetBiasChanges),
        meanAbsPx: mean(t.targetBiasChanges.map(Math.abs)) }, offScreenTruth: t.offScreenTruth, nearOffScreenTruth: t.nearOffScreenTruth,
    }])) };
  });
  return { version: 'issue143_eye_shape_synthetic.v5', scope: 'artificial_perturbations_no_webcam_or_temporal_claim',
    calibrationRows: 50, heldOutTargets: 36, samplesPerTarget: 6, shapeCalibration: shapes.eye_shape.diagnostics,
    localShapeCalibration: shapes.eye_shape_local.diagnostics, localObservedShapeCalibration: shapes.eye_shape_local_observed.diagnostics,
    maskedShapeCalibration: shapes.eye_shape_masked.diagnostics, fineMaskedShapeCalibration: shapes.eye_shape_masked_fine.diagnostics,
    pooledMaskedShapeCalibration: models.eye_shape_masked_pooled.getCalibrationDiagnostics(),
    apertureScope: 'fixture_only_simulated_lid_observation_not_gaze_labels; includes biased_and_jittered_observations',
    timingScope: 'local_extractor_only_including_missing_inputs_not_camera_latency_or_fps',
    extractionMs: Object.fromEntries(Object.entries(timings).map(([name, t]) => [name, {
      calls: t.calls, meanMs: t.sumMs / t.calls, maxMs: t.maxMs,
    }])), results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(runEyeShapeSynthetic(), null, 2));
}
