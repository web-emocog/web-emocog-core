const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { landmarksForGaze, changeEyelids } = require('./fixtures/gaze-topology');
const load = file => import(pathToFileURL(path.resolve(__dirname, file)));
const config = { geometry: 'normalized', basis: 'axis_mixed', frameWidth: 640, frameHeight: 480 };
const points = [-.8, -.4, 0, .4, .8].flatMap(x => [-.8, -.4, 0, .4, .8].map(y => ({ x, y })));

function add(tracker, transformY = y => y) {
  for (const { x, y } of points) for (let click = 0; click < 2; click++) {
    // A controlled nonlinear X mapping and linear Y. No recorded face data.
    tracker.addCalibrationPoint(landmarksForGaze(x, y), 735 + 500 * x + 140 * x * y, transformY(478 + 350 * y));
  }
  assert.equal(tracker.calibrate(), true);
}

test('fixed lambda controls isolate basis from regularization and never run CV', async () => {
  const { createModelComparison } = await load('../../autotests/manual/issue143-models.mjs');
  const models = createModelComparison({ width: 1470, height: 956 }, { width: 640, height: 480 }, 'axis');
  assert.equal(Object.keys(models).length, 12);
  for (const tracker of Object.values(models)) add(tracker);
  for (const [name, tracker] of Object.entries(models).filter(([name]) => name.includes('_lambda_'))) {
    const fixed = tracker.getCalibrationDiagnostics();
    assert.equal(fixed.policy, 'fixed'); assert.deepEqual(fixed.curve, []);
    const lambda = Number(name.split('_lambda_')[1].replace('p', '.'));
    assert.equal(fixed.lambdaX, lambda); assert.equal(fixed.lambdaY, lambda);
    assert.equal(tracker.getStatus().calibrationTargetCvRmsPx, null);
  }
});

test('mixed regression preserves nonlinear X while zeroing exactly the three nonlinear Y coefficients', async () => {
  const { default: Tracker } = await load('../../participant-web/js/gaze-tracker/GazeTracker.js');
  const mixed = new Tracker({ screenWidth: 1470, screenHeight: 956, experimentalModel: config }); add(mixed);
  const diagnostics = mixed.getCalibrationDiagnostics();
  assert.equal(diagnostics.policy, 'per_axis_target_group_cv');
  assert.equal(diagnostics.curve.length, 4); assert.equal(diagnostics.independentTargetsUsed, 0);
  assert.equal(mixed.getStatus().featureMethod, 'normalized_axis_mixed.experimental.v1');
  assert.deepEqual(mixed._modelY.slice(8, 11), [0, 0, 0]);
  assert.ok(Math.abs(mixed._modelX[10]) > 1);
  for (const { x, y } of [{ x: -.6, y: .2 }, { x: .6, y: -.6 }]) {
    const p = mixed.predict(landmarksForGaze(x, y));
    assert.ok(Math.hypot(p.rawX - (735 + 500 * x + 140 * x * y), p.rawY - (478 + 350 * y)) < 3);
  }
});

test('X and Y choose their own minimum on the grouped calibration CV curve', async () => {
  const { default: Tracker } = await load('../../participant-web/js/gaze-tracker/GazeTracker.js');
  const mixed = new Tracker({ experimentalModel: config });
  for (const { x, y } of points) for (let click = 0; click < 2; click++) {
    const jitterY = Math.sin(5 * x + 7 * y + click) * .08;
    mixed.addCalibrationPoint(landmarksForGaze(x, y + jitterY), 735 + 500 * x + 140 * x * y, 478 + 350 * y);
  }
  assert.equal(mixed.calibrate(), true);
  const d = mixed.getCalibrationDiagnostics();
  const minX = d.curve.reduce((best, row) => row.rmsXPx < best.rmsXPx ? row : best);
  const minY = d.curve.reduce((best, row) => row.rmsYPx < best.rmsYPx ? row : best);
  assert.equal(d.lambdaX, minX.lambda); assert.equal(d.lambdaY, minY.lambda);
  assert.ok(Math.abs(d.rmsXPx - minX.rmsXPx) < 1e-12);
  assert.ok(Math.abs(d.rmsYPx - minY.rmsYPx) < 1e-12);
});

test('changing Y labels cannot change the mixed X fit or its lambda', async () => {
  const { default: Tracker } = await load('../../participant-web/js/gaze-tracker/GazeTracker.js');
  const a = new Tracker({ experimentalModel: config }), b = new Tracker({ experimentalModel: config });
  add(a); add(b, y => 3 * y - 200);
  assert.equal(a.getCalibrationDiagnostics().lambdaX, b.getCalibrationDiagnostics().lambdaX);
  assert.deepEqual(a._modelX, b._modelX);
});

test('fixed mixed model equals separate X-quadratic and Y-linear controls with the same lambda', async () => {
  const { default: Tracker } = await load('../../participant-web/js/gaze-tracker/GazeTracker.js');
  for (const lambda of [.001, .01, .1, 1]) {
    const models = ['quadratic', 'linear', 'axis_mixed'].map(basis => new Tracker({
      ridgeLambda: lambda, experimentalModel: { ...config, basis } }));
    for (const tracker of models) add(tracker);
    assert.deepEqual(models[0]._modelX, models[2]._modelX);
    assert.deepEqual(models[1]._modelY.slice(0, 8), models[2]._modelY.slice(0, 8));
    assert.equal(models[1]._modelY[8], models[2]._modelY[11]);
  }
});

test('axis diagnostics are bounded copies without training rows/weights and clear on reset', async () => {
  const { default: Tracker } = await load('../../participant-web/js/gaze-tracker/GazeTracker.js');
  const mixed = new Tracker({ experimentalModel: config }); add(mixed);
  const copy = mixed.getCalibrationDiagnostics(); copy.curve[0].lambda = -1;
  assert.equal(mixed.getCalibrationDiagnostics().curve[0].lambda, .001);
  for (const key of ['samples', 'weights', 'modelX', 'modelY', 'targets', 'landmarks']) assert.equal(key in copy, false);
  mixed.reset(); assert.equal(mixed.getCalibrationDiagnostics(), null);
});

test('mixed prediction is target/time blind and shares confidence/head/iris gates with baseline', async () => {
  const { default: Tracker } = await load('../../participant-web/js/gaze-tracker/GazeTracker.js');
  const base = new Tracker(), mixed = new Tracker({ experimentalModel: config }); add(base); add(mixed);
  for (const face of [landmarksForGaze(.3, -.5), changeEyelids(landmarksForGaze(0, 0), { factor: .1 }),
    landmarksForGaze(0, 0, { leftShiftX: .1 })]) {
    const a = base.predict(face), b = mixed.predict(face, { timestamp: 240000, targetX: 1, targetY: 2 });
    const c = mixed.predict(face, { timestamp: 1, targetX: 10000, targetY: -999 });
    assert.equal(a.valid, b.valid); assert.equal(a.confidence, b.confidence); assert.deepEqual(a.ood, b.ood);
    assert.equal(b.rawX, c.rawX); assert.equal(b.rawY, c.rawY);
  }
});

test('per-axis basis and lambda are calibration-CV minima, not a forced linear Y', async () => {
  const { default: Tracker } = await load('../../participant-web/js/gaze-tracker/GazeTracker.js');
  const auto = new Tracker({ experimentalModel: { ...config, basis: 'axis_auto' } });
  for (const { x, y } of points) for (let click = 0; click < 2; click++) {
    auto.addCalibrationPoint(landmarksForGaze(x, y), 735 + 500 * x + 140 * x * y, 478 + 320 * y + 110 * y * y);
  }
  assert.equal(auto.calibrate(), true);
  const d = auto.getCalibrationDiagnostics();
  assert.equal(d.policy, 'per_axis_basis_target_group_cv');
  assert.equal(d.curve.length, 8); assert.equal(d.independentTargetsUsed, 0);
  assert.equal(d.basisX, 'quadratic'); assert.equal(d.basisY, 'quadratic');
  for (const axis of ['X', 'Y']) {
    const best = d.curve.reduce((a, b) => b[`rms${axis}Px`] < a[`rms${axis}Px`] ? b : a);
    assert.equal(d[`basis${axis}`], best.basis); assert.equal(d[`lambda${axis}`], best.lambda);
  }
  for (const { x, y } of [{ x: -.65, y: -.2 }, { x: .2, y: .65 }]) {
    const p = auto.predict(landmarksForGaze(x, y));
    assert.ok(Math.hypot(p.rawX - (735 + 500 * x + 140 * x * y), p.rawY - (478 + 320 * y + 110 * y * y)) < 2);
  }
});

test('per-axis automatic basis can select linear Y without changing nonlinear X or its shared gates', async () => {
  const { default: Tracker } = await load('../../participant-web/js/gaze-tracker/GazeTracker.js');
  const a = new Tracker({ experimentalModel: { ...config, basis: 'axis_auto' } });
  const b = new Tracker({ experimentalModel: { ...config, basis: 'axis_auto' } });
  add(a); add(b, y => 3 * y - 200);
  const d = a.getCalibrationDiagnostics();
  assert.equal(d.basisX, 'quadratic'); assert.equal(d.basisY, 'linear');
  assert.deepEqual(a._modelX, b._modelX);
  assert.equal(d.lambdaX, b.getCalibrationDiagnostics().lambdaX);
  const base = new Tracker(); add(base);
  for (const face of [landmarksForGaze(.3, -.5), changeEyelids(landmarksForGaze(0, 0), { factor: .1 }),
    landmarksForGaze(0, 0, { leftShiftX: .1 })]) {
    const p = a.predict(face), q = base.predict(face);
    assert.equal(p.valid, q.valid); assert.equal(p.confidence, q.confidence); assert.deepEqual(p.ood, q.ood);
    const late = a.predict(face, { timestamp: 240000, targetX: 10000, targetY: -999 });
    assert.equal(p.rawX, late.rawX); assert.equal(p.rawY, late.rawY);
  }
});
