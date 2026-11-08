const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { landmarksForGaze, changeEyelids } = require('./fixtures/gaze-topology');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/gaze-tracker', name)));

test('issue143: iris centers are normalized against the SAME anatomical eye', async () => {
  const { extractFeatureGroups } = await load('features.js');
  for (const x of [-.8, 0, .8]) for (const y of [-.8, 0, .8]) {
    const { iris } = extractFeatureGroups(landmarksForGaze(x, y));
    for (const [i, expected] of [[0, x], [1, y], [2, x], [3, y]]) {
      assert.ok(Math.abs(iris[i] - expected) < 1e-10, `feature ${i}: ${iris[i]} != ${expected}`);
    }
  }
});

test('issue143: independent eye translation cannot turn into iris motion', async () => {
  const { extractFeatureGroups } = await load('features.js');
  const reference = extractFeatureGroups(landmarksForGaze(.4, -.3));
  for (const pose of [{ leftShiftX: .008 }, { leftShiftY: .004 }, { scale: .9, roll: .05 }]) {
    const changed = extractFeatureGroups(landmarksForGaze(.4, -.3, pose));
    changed.iris.forEach((value, i) => assert.ok(Math.abs(value - reference.iris[i]) < 1e-10));
    assert.notDeepEqual(changed.head, reference.head);
  }
});

test('issue143: held-out screen grid stays target-blind under synthetic eye geometry change', async () => {
  const { default: GazeTracker } = await load('GazeTracker.js');
  const tracker = new GazeTracker({ screenWidth: 1470, screenHeight: 956 });
  for (const x of [-.8, -.4, 0, .4, .8]) for (const y of [-.8, -.4, 0, .4, .8]) {
    tracker.addCalibrationPoint(landmarksForGaze(x, y), 735 + x * 700, 478 + y * 440);
  }
  assert.equal(tracker.calibrate(), true);
  let timestamp = 0;
  for (const x of [-.9, -.6, .2, .9]) for (const y of [-.9, -.6, .2, .9]) {
    const baseline = tracker.predict(landmarksForGaze(x, y), { timestamp: ++timestamp });
    timestamp += 240000;
    const late = tracker.predict(landmarksForGaze(x, y, { leftShiftY: .004 }), { timestamp });
    assert.equal(late.valid, true);
    assert.ok(Math.hypot(late.rawX - baseline.rawX, late.rawY - baseline.rawY) <= 1);
    assert.ok(Math.hypot(late.rawX - (735 + x * 700), late.rawY - (478 + y * 440)) < 3);
    timestamp += 33;
    const irrelevantTarget = tracker.predict(landmarksForGaze(x, y), { targetX: 0, targetY: 0, timestamp });
    assert.equal(irrelevantTarget.rawX, baseline.rawX);
    assert.equal(irrelevantTarget.rawY, baseline.rawY);
  }
});

test('issue143: near-level eyes do not wrap head roll from +pi to -pi', async () => {
  const { extractFeatureGroups } = await load('features.js');
  const above = extractFeatureGroups(landmarksForGaze(0, 0, { leftShiftY: -.0001 }));
  const below = extractFeatureGroups(landmarksForGaze(0, 0, { leftShiftY: .0001 }));
  assert.ok(Math.abs(above.head[2] - below.head[2]) < .001);
  assert.ok(Math.abs(above.head[2]) < .001);
});

test('issue143: blink frames cannot train the calibration, including a one-eye closure', async () => {
  const { default: GazeTracker } = await load('GazeTracker.js');
  const tracker = new GazeTracker();
  for (const lids of [{ factor: .1 }, { leftFactor: .1 }, { rightFactor: .1 }]) {
    assert.equal(tracker.addCalibrationPoint(changeEyelids(landmarksForGaze(.4, .4), lids), 100, 200), false);
  }
  assert.equal(tracker.getStatus().calibrationPoints, 0);
});

test('issue143: averaging excludes blink outliers and requires the requested usable count', async () => {
  const { default: GazeTracker } = await load('GazeTracker.js');
  const open = Array.from({ length: 8 }, () => landmarksForGaze(.4, .4));
  const blink = Array.from({ length: 4 }, () => changeEyelids(landmarksForGaze(-.8, -.8), { factor: .1 }));
  const clean = new GazeTracker(), mixed = new GazeTracker();
  assert.equal(clean.addAveragedCalibrationPoint(open, 100, 200), true);
  assert.equal(mixed.addAveragedCalibrationPoint([...open, ...blink], 100, 200, { minFrames: 8 }), true);
  assert.deepEqual(mixed._calibrationData[0].irisFeatures, clean._calibrationData[0].irisFeatures);
  assert.equal(mixed.addAveragedCalibrationPoint([...open, ...blink], 100, 200, { minFrames: 9 }), false);
  assert.deepEqual(mixed.getStatus().calibrationFrames, { attempted: 24, accepted: 16, rejected: 8 });
});

test('issue143: diagnostic corner/width features are lid-invariant, while legacy geometry is not', async () => {
  const { extractFeatureGroups, extractCornerFeatureGroups } = await load('features.js');
  const face = landmarksForGaze(.4, .6);
  const lids = changeEyelids(face, { factor: .75, centerShift: .004 });
  assert.notDeepEqual(extractFeatureGroups(face).iris, extractFeatureGroups(lids).iris);
  assert.deepEqual(extractCornerFeatureGroups(face).iris, extractCornerFeatureGroups(lids).iris);
  assert.notDeepEqual(extractCornerFeatureGroups(face).eye, extractCornerFeatureGroups(lids).eye);
});

test('issue143: experimental geometry requires an explicit opt-in; defaults remain stable', async () => {
  const { default: GazeTracker } = await load('GazeTracker.js');
  assert.equal(new GazeTracker().getStatus().featureMethod, 'same_eye_iris.v2');
  const tracker = new GazeTracker({ experimentalGeometry: 'corner_width' });
  assert.equal(tracker.getStatus().featureMethod, 'corner_width_iris.experimental.v1');
  assert.throws(() => new GazeTracker({ experimentalGeometry: 'guessed' }));
  for (const x of [-.8, -.4, 0, .4, .8]) for (const y of [-.8, -.4, 0, .4, .8]) {
    tracker.addCalibrationPoint(landmarksForGaze(x, y), 960 + x * 800, 540 + y * 450);
  }
  assert.equal(tracker.calibrate(), true);
  const baseline = tracker.predict(landmarksForGaze(.2, .6));
  const changed = tracker.predict(changeEyelids(landmarksForGaze(.2, .6), { factor: .75, centerShift: .004 }));
  assert.equal(changed.valid, true);
  assert.equal(changed.rawX, baseline.rawX); assert.equal(changed.rawY, baseline.rawY);
  const blink = tracker.predict(changeEyelids(landmarksForGaze(.2, .6), { factor: .1 }));
  assert.equal(blink.valid, false); // The candidate does not turn closure into valid gaze.
  const irrelevantTarget = tracker.predict(landmarksForGaze(.2, .6), { targetX: 0, targetY: 0 });
  assert.equal(irrelevantTarget.rawX, baseline.rawX); assert.equal(irrelevantTarget.rawY, baseline.rawY);
});

test('issue143: matched summaries count missing/unique frames and compare common accepted frames only', async () => {
  const { createMatchedWindow, observeMatchedWindow, finishMatchedWindow } = await import(pathToFileURL(path.resolve(__dirname,
    '../../autotests/manual/issue143-summary.mjs')));
  const window = createMatchedWindow({ x: 100, y: 200 }, 10, ['baseline', 'candidate']);
  const eye = { leftEAR: .3, rightEAR: .3 };
  const baseline = { valid: true, onScreen: true, rawX: 110, rawY: 200 };
  const candidate = { valid: true, onScreen: true, rawX: 104, rawY: 200 };
  observeMatchedWindow(window, 9, eye, { baseline, candidate });
  observeMatchedWindow(window, 10, eye, { baseline, candidate });
  observeMatchedWindow(window, 10, eye, { baseline, candidate });
  observeMatchedWindow(window, 11, eye, { baseline, candidate: { valid: false, rejectionReason: 'low_confidence' } });
  observeMatchedWindow(window, 12, null, {});
  const summary = finishMatchedWindow(window, 2000);
  assert.equal(summary.analyzed, 3); assert.equal(summary.faceMissing, 1);
  assert.equal(summary.models.baseline.accepted, 2); assert.equal(summary.models.candidate.accepted, 1);
  assert.equal(summary.models.candidate.rejectionCounts.low_confidence, 1);
  assert.deepEqual(summary.paired, { accepted: 1, candidateMinusBaselineMeanErrorPx: -6 });
  assert.equal(summary.eyeAperture.meanLeftEAR, .3);
  assert.equal(summary.models.candidate.meanErrorPx, 4);
  assert.equal('target' in summary, false);
  assert.equal('rawX' in summary.models.baseline, false);
  const missing = finishMatchedWindow(createMatchedWindow({ x: 0, y: 0 }, 0, ['baseline', 'candidate']), 2000);
  assert.equal(missing.models.baseline.meanErrorPx, null); assert.equal(missing.paired.candidateMinusBaselineMeanErrorPx, null);
});
