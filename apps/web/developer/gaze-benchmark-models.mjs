// Diagnostic comparisons only: no factory is called by participant production flow.
import Tracker from '../../participant-web/js/gaze-tracker/GazeTracker.js?v=20261110-143s';
import { DEFAULTS } from '../../participant-web/js/gaze-tracker/constants.js?v=20261106-143';

// All compared regressions must average exactly the same calibration captures.
// Checking separate counts is insufficient when missing subsets differ.
export function commonAppearanceCalibrationFrames(frames, readEyeFeatures) {
  return frames.filter(frame => readEyeFeatures(frame, 'full') && readEyeFeatures(frame, 'core'));
}

export function commonGradientCalibrationFrames(frames, readEyeFeatures) {
  return frames.filter(frame => ['full', 'gradient', 'gradient_all'].every(region => readEyeFeatures(frame, region)));
}

export function commonTophatCalibrationFrames(frames, readEyeFeatures) {
  return frames.filter(frame => ['full', 'gradient_all', 'tophat'].every(region => readEyeFeatures(frame, region)));
}

export function commonMaskedCalibrationFrames(frames, readEyeFeatures) {
  return frames.filter(frame => ['full', 'gradient_all', 'masked'].every(region => readEyeFeatures(frame, region)));
}

export function commonNuisanceCalibrationFrames(frames, readEyeFeatures) {
  return frames.filter(frame => ['full', 'rows', 'nuisance'].every(region => readEyeFeatures(frame, region)));
}

export function createModelComparison(viewport, camera, ablation = false, readEyeFeatures = null) {
  if (![false, true, 'axis', 'appearance', 'gradient', 'tophat', 'masked', 'nuisance', 'aoi-continuous'].includes(ablation)) throw new RangeError('Unknown local model comparison');
  const options = { screenWidth: viewport.width, screenHeight: viewport.height };
  const models = { baseline: new Tracker(options) };
  if (ablation === 'aoi-continuous') {
    if (typeof readEyeFeatures !== 'function') throw new RangeError('Missing local eye feature reader');
    models.eye_patch = new Tracker({ ...options, experimentalEyePatch: { region: 'full',
      readFeatures: face => readEyeFeatures(face, 'full'), frameWidth: camera.width, frameHeight: camera.height } });
    return models;
  }
  if (ablation === 'nuisance') {
    if (typeof readEyeFeatures !== 'function') throw new RangeError('Missing local eye feature reader');
    for (const [name, region] of [['eye_patch', 'full'], ['eye_patch_rows', 'rows'], ['eye_patch_nuisance', 'nuisance']]) {
      models[name] = new Tracker({ ...options, experimentalEyePatch: { region,
        readFeatures: face => readEyeFeatures(face, region), frameWidth: camera.width, frameHeight: camera.height } });
    }
    return models;
  }
  if (['gradient', 'tophat', 'masked'].includes(ablation)) {
    if (typeof readEyeFeatures !== 'function') throw new RangeError('Missing local eye feature reader');
    for (const [name, region] of [['eye_patch', 'full'], ['eye_gradient_all', 'gradient_all'],
      ablation === 'masked' ? ['eye_masked', 'masked'] : ablation === 'tophat' ? ['eye_tophat', 'tophat'] : ['eye_gradient', 'gradient']]) {
      models[name] = new Tracker({ ...options, experimentalEyePatch: { region,
        readFeatures: face => readEyeFeatures(face, region), frameWidth: camera.width, frameHeight: camera.height } });
    }
    return models;
  }
  if (ablation === 'appearance') {
    if (typeof readEyeFeatures !== 'function') throw new RangeError('Missing local eye feature reader');
    models.axis_auto = new Tracker({ ...options, experimentalModel: { geometry: 'normalized', basis: 'axis_auto',
      frameWidth: camera.width, frameHeight: camera.height } });
    models.eye_patch = new Tracker({ ...options, experimentalEyePatch: { readFeatures: face => readEyeFeatures(face, 'full'),
      frameWidth: camera.width, frameHeight: camera.height } });
    models.eye_patch_core = new Tracker({ ...options, experimentalEyePatch: { region: 'core',
      readFeatures: face => readEyeFeatures(face, 'core'), frameWidth: camera.width, frameHeight: camera.height } });
    return models;
  }
  if (ablation === 'axis') {
    const add = (name, basis, ridgeLambda) => { models[name] = new Tracker({ ...options,
      ...(ridgeLambda === undefined ? {} : { ridgeLambda }), experimentalModel: {
        geometry: 'normalized', basis, frameWidth: camera.width, frameHeight: camera.height
      } }); };
    add('linear_auto', 'linear');
    for (const basis of ['quadratic', 'linear']) for (const lambda of DEFAULTS.ridgeLambdaCandidates) {
      add(`${basis}_lambda_${String(lambda).replace('.', 'p')}`, basis, lambda);
    }
    add('axis_mixed', 'axis_mixed');
    add('axis_auto', 'axis_auto');
    return models;
  }
  if (ablation) for (const [name, geometry, basis] of [
    ['pixel_quadratic', 'camera_pixel', 'quadratic'],
    ['normalized_linear', 'normalized', 'linear'],
    ['pixel_linear', 'camera_pixel', 'linear'],
  ]) models[name] = new Tracker({ ...options, experimentalModel: {
    geometry, basis, frameWidth: camera.width, frameHeight: camera.height
  } });
  return models;
}

export function comparisonSignals(predictions) {
  return Object.fromEntries(Object.entries(predictions).flatMap(([name, gaze]) =>
    [[`${name}.raw`, gaze], [`${name}.corrected`, gaze]]));
}

export function comparisonSignalKeys(models) {
  return Object.fromEntries(Object.keys(models).flatMap(name => [
    [`${name}.raw`, ['rawX', 'rawY']], [`${name}.corrected`, ['correctedX', 'correctedY']]
  ]));
}

export function comparisonPairs(models) {
  const pairs = Object.keys(models).filter(name => name !== 'baseline').flatMap(name =>
    ['raw', 'corrected'].map(signal => ({ baseline: `baseline.${signal}`, candidate: `${name}.${signal}` })));
  const candidate = models.eye_masked ? 'eye_masked' : models.eye_patch_nuisance ? 'eye_patch_nuisance' : null;
  if (candidate) for (const name of ['eye_patch', models.eye_masked ? 'eye_gradient_all' : 'eye_patch_rows']) {
    for (const signal of ['raw', 'corrected']) pairs.push({ baseline: `${name}.${signal}`, candidate: `${candidate}.${signal}` });
  }
  return pairs;
}
