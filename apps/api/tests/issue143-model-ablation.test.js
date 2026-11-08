const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { landmarksForGaze, changeEyelids } = require('./fixtures/gaze-topology');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/gaze-tracker', name)));
const manual = name => import(pathToFileURL(path.resolve(__dirname, '../../autotests/manual', name)));
const camera = { width: 640, height: 480 }, viewport = { width: 1470, height: 956 };
// A rotation in camera PIXELS, not in an anisotropically normalized square.
function rotatePixels(points, angle, { width, height } = camera) {
  return points.map(p => { const x = (p.x - .5) * width, y = (p.y - .5) * height;
    return { x: .5 + (x * Math.cos(angle) - y * Math.sin(angle)) / width,
      y: .5 + (x * Math.sin(angle) + y * Math.cos(angle)) / height }; });
}
async function models() { return (await manual('issue143-models.mjs')).createModelComparison(viewport, camera, true); }
function train(trackers) {
  for (const x of [-.8, -.4, 0, .4, .8]) for (const y of [-.8, -.4, 0, .4, .8]) {
    for (let click = 0; click < 2; click++) for (const tracker of Object.values(trackers)) {
      assert.equal(tracker.addAveragedCalibrationPoint([landmarksForGaze(x, y)], 735 + x * 700, 478 + y * 440), true);
    }
  }
  for (const tracker of Object.values(trackers)) assert.equal(tracker.calibrate(), true);
}

test('camera-pixel geometry is invariant to image-plane rotation on non-square captures', async () => {
  const { extractFeatureGroups, extractAblationFeatureGroups } = await load('features.js');
  for (const [width, height] of [[640, 480], [1280, 720], [480, 640]]) {
    const p = landmarksForGaze(.6, -.4), rotated = rotatePixels(p, .18, { width, height });
    const config = { geometry: 'camera_pixel', basis: 'quadratic', frameWidth: width, frameHeight: height };
    const before = extractAblationFeatureGroups(p, config), after = extractAblationFeatureGroups(rotated, config);
    before.iris.forEach((v, i) => assert.ok(Math.abs(v - after.iris[i]) < 1e-10));
    assert.ok(Math.abs(extractFeatureGroups(p).iris[0] - extractFeatureGroups(rotated).iris[0]) > .001);
    assert.deepEqual(after.gateIris, extractFeatureGroups(rotated).iris);
    assert.deepEqual(after.head, extractFeatureGroups(rotated).head);
    assert.deepEqual(after.eye, extractFeatureGroups(rotated).eye);
  }
});

test('ablation removes only the three nonlinear terms and preserves baseline gate inputs', async () => {
  const { extractFeatureGroups, extractAblationFeatureGroups } = await load('features.js');
  const p = landmarksForGaze(.3, .7), base = extractFeatureGroups(p);
  const config = { geometry: 'normalized', basis: 'linear', frameWidth: 640, frameHeight: 480 };
  const linear = extractAblationFeatureGroups(p, config);
  assert.deepEqual(linear.iris, [...base.iris.slice(0, 8), 1]);
  assert.deepEqual(linear.gateIris, base.iris);
  assert.equal(extractAblationFeatureGroups(p, { ...config, geometry: 'camera_pixel', frameWidth: 0 }), null);
});

test('experimental candidates require complete explicit camera configuration and never change defaults', async () => {
  const { default: Tracker } = await load('GazeTracker.js');
  assert.equal(new Tracker().getStatus().featureMethod, 'same_eye_iris.v2');
  for (const config of [null, {}, { geometry: 'camera_pixel', basis: 'linear' },
    { geometry: 'camera_pixel', basis: 'linear', frameWidth: -1, frameHeight: 480 },
    { geometry: 'camera_pixel', basis: 'saliency', frameWidth: 640, frameHeight: 480 }]) {
    assert.throws(() => new Tracker({ experimentalModel: config }), RangeError);
  }
  assert.throws(() => new Tracker({ experimentalGeometry: 'corner_width', experimentalModel: {
    geometry: 'camera_pixel', basis: 'linear', frameWidth: 640, frameHeight: 480 } }), RangeError);
  const config = { geometry: 'camera_pixel', basis: 'linear', frameWidth: 640, frameHeight: 480 };
  const tracker = new Tracker({ experimentalModel: config }); config.frameHeight = 720;
  assert.equal(tracker.getStatus().experimentalModel.frameHeight, 480);
});

test('four regressions share calibration counts, eye-confidence and head/iris OOD for identical captures', async () => {
  const trackers = await models(); train(trackers);
  for (const sample of [landmarksForGaze(.2, -.6), rotatePixels(landmarksForGaze(.4, .5), .07),
    landmarksForGaze(0, 0, { leftShiftX: .1 }), changeEyelids(landmarksForGaze(0, 0), { factor: .1 })]) {
    const predictions = Object.values(trackers).map(tracker => tracker.predict(sample));
    for (const p of predictions.slice(1)) {
      assert.equal(p.valid, predictions[0].valid); assert.equal(p.confidence, predictions[0].confidence);
      assert.deepEqual(p.ood, predictions[0].ood);
    }
  }
  for (const tracker of Object.values(trackers)) assert.deepEqual(tracker.getStatus().calibrationFrames, { attempted: 50, accepted: 50, rejected: 0 });
});

test('held-out synthetic targets stay target-blind for all candidates; elapsed time does not change predictions', async () => {
  const trackers = await models(); train(trackers);
  for (const tracker of Object.values(trackers)) for (const [x, y] of [[-.6, -.6], [.2, .2], [.6, -.2], [-.2, .6]]) {
    const face = landmarksForGaze(x, y);
    const a = tracker.predict(face, { timestamp: 1000 });
    const b = tracker.predict(face, { timestamp: 241000, targetX: -999, targetY: 99999, blockId: 'arbitrary', headX: .8 });
    assert.equal(a.rawX, b.rawX); assert.equal(a.rawY, b.rawY);
    assert.ok(Math.hypot(a.rawX - (735 + 700 * x), a.rawY - (478 + 440 * y)) < 3);
  }
});

test('a square camera makes normalized/pixel candidates identical, preventing an artificial comparison win', async () => {
  const { createModelComparison } = await manual('issue143-models.mjs');
  const trackers = createModelComparison(viewport, { width: 640, height: 640 }, true); train(trackers);
  for (const [a, b] of [['baseline', 'pixel_quadratic'], ['normalized_linear', 'pixel_linear']]) {
    const sample = rotatePixels(landmarksForGaze(.2, .4), .12, { width: 640, height: 640 });
    assert.deepEqual(trackers[a]._modelX, trackers[b]._modelX);
    assert.equal(trackers[a].predict(sample).rawY, trackers[b].predict(sample).rawY);
  }
});

test('factorial summaries compare only common frames and keep missingness separate', async () => {
  const { createMatchedWindow, observeMatchedWindow, finishMatchedWindow } = await manual('issue143-summary.mjs');
  const window = createMatchedWindow({ x: 100, y: 100 }, 0, ['baseline.raw', 'candidate.raw'], {}, viewport,
    [{ baseline: 'baseline.raw', candidate: 'candidate.raw' }]);
  const a = { valid: true, rawX: 120, rawY: 100, onScreen: true }, b = { ...a, rawX: 110 };
  observeMatchedWindow(window, 1, {}, { 'baseline.raw': a, 'candidate.raw': b });
  observeMatchedWindow(window, 2, {}, { 'baseline.raw': a });
  const result = finishMatchedWindow(window, 2000);
  assert.equal(result.comparisons[0].commonAccepted, 1);
  assert.equal(result.comparisons[0].candidateMinusBaselineMeanErrorPx, -10);
  assert.equal(result.models['candidate.raw'].attempted, 2);
  assert.equal(result.models['candidate.raw'].accepted, 1);
});

test('nuisance summaries stay bounded aggregates with unique captures and explicit unknowns', async () => {
  const { createMatchedWindow, observeMatchedWindow, finishMatchedWindow } = await manual('issue143-summary.mjs');
  const window = createMatchedWindow({ x: 100, y: 100 }, 0, ['baseline.raw'], {}, viewport, [], true);
  const { extractFeatureGroups } = await load('features.js');
  const groups = extractFeatureGroups(landmarksForGaze(.2, .3));
  observeMatchedWindow(window, 1, groups.eye, {}, groups);
  observeMatchedWindow(window, 1, groups.eye, {}, groups); // Duplicate cannot change aggregates.
  observeMatchedWindow(window, 2, null, {}, null);
  const result = finishMatchedWindow(window, 2000);
  assert.equal(result.baselineNuisance.frames, 1);
  assert.deepEqual(result.baselineNuisance.mean, [...groups.iris.slice(0, 4), ...groups.head]);
  assert.deepEqual(result.baselineNuisance.sd, new Array(11).fill(0));
  const empty = finishMatchedWindow(createMatchedWindow({ x: 0, y: 0 }, 0, [], {}, viewport, [], true), 0);
  assert.ok(empty.baselineNuisance.mean.every(v => v === null));
  for (const key of ['landmarks', 'samples', 'iris', 'head']) assert.equal(key in result.baselineNuisance, false);
});

test('smoothing reset, malformed inputs and frozen calibration metadata are safe for candidates', async () => {
  const trackers = await models(); train(trackers);
  for (const tracker of Object.values(trackers)) {
    const p = tracker.predict(landmarksForGaze(.3, -.2)); tracker.resetSmoothingState();
    assert.equal(tracker.predict(landmarksForGaze(.3, -.2)).rawX, p.rawX);
    assert.equal(tracker.predict([]), null);
    tracker.reset(); assert.equal(tracker.predict(landmarksForGaze(0, 0)), null);
  }
});

test('explicit normalized quadratic control exactly reproduces the default fit and predictions', async () => {
  const { default: Tracker } = await load('GazeTracker.js');
  const trackers = { baseline: new Tracker({ screenWidth: 1470, screenHeight: 956 }),
    control: new Tracker({ screenWidth: 1470, screenHeight: 956, experimentalModel: {
      geometry: 'normalized', basis: 'quadratic', frameWidth: 640, frameHeight: 480 } }) };
  train(trackers);
  assert.deepEqual(trackers.baseline._modelX, trackers.control._modelX);
  assert.deepEqual(trackers.baseline._modelY, trackers.control._modelY);
  for (const [x, y] of [[.5, .6], [-.3, .2], [.7, -.4]]) {
    const face = rotatePixels(landmarksForGaze(x, y), .08);
    const a = trackers.baseline.predict(face), b = trackers.control.predict(face);
    for (const key of ['rawX', 'rawY', 'valid', 'confidence']) assert.equal(a[key], b[key]);
  }
});

test('a linear candidate is not universally better: known nonlinear mapping remains measurable', async () => {
  const trackers = await models();
  for (const x of [-.8, -.4, 0, .4, .8]) for (const y of [-.8, -.4, 0, .4, .8]) {
    for (const tracker of Object.values(trackers)) tracker.addCalibrationPoint(
      landmarksForGaze(x, y), 735 + 500 * x + 140 * x * y, 478 + 350 * y + 100 * x * x);
  }
  for (const tracker of Object.values(trackers)) assert.equal(tracker.calibrate(), true);
  const errors = {};
  for (const [name, tracker] of Object.entries(trackers)) {
    const p = tracker.predict(landmarksForGaze(.6, -.6));
    errors[name] = Math.hypot(p.rawX - (735 + 500 * .6 + 140 * .6 * -.6), p.rawY - (478 - 350 * .6 + 100 * .6 * .6));
  }
  assert.ok(errors.baseline < 3);
  assert.ok(errors.normalized_linear > 20);
});
