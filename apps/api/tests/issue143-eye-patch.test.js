const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { landmarksForGaze, changeEyelids } = require('./fixtures/gaze-topology');
const load = file => import(pathToFileURL(path.resolve(__dirname, file)));
const root = '../../participant-web/js/';
const eye = () => load(root + 'gaze-tracker/eye-patch-features.mjs');
const image = () => load('../../autotests/fixtures/issue143-eye-image.mjs');
const points = [-.8, -.4, 0, .4, .8].flatMap(x => [-.8, -.4, 0, .4, .8].map(y => ({ x, y })));

test('eye appearance has 120 finite local features and changes with pixels even when landmarks do not', async () => {
  const { extractEyePatchFeatures, EYE_PATCH_LENGTH } = await eye();
  const { syntheticEyeImage } = await image(); const face = landmarksForGaze(0, 0);
  const a = extractEyePatchFeatures(syntheticEyeImage(face, { gazeY: -.7 }), face);
  const b = extractEyePatchFeatures(syntheticEyeImage(face, { gazeY: .7 }), face);
  assert.equal(a.length, EYE_PATCH_LENGTH); assert.equal(a.length, 120); assert.ok(a.every(Number.isFinite));
  assert.ok(Math.hypot(...a.map((v,i)=>v-b[i])) > 1);
  assert.ok(Math.abs(a.slice(0,60).reduce((s,v)=>s+v,0)) < 1e-10);
  // No live pixel buffer, landmarks, target or time is returned.
  assert.ok(a.every(v => typeof v === 'number')); assert.equal(a.buffer, undefined);
});

test('crop does not depend on lid landmarks and approximately cancels uniform brightness/contrast', async () => {
  const { extractEyePatchFeatures } = await eye(); const { syntheticEyeImage } = await image();
  const face = landmarksForGaze(.2, -.3), pixels = syntheticEyeImage(face, { gazeX: .2, gazeY: -.3 });
  const a = extractEyePatchFeatures(pixels, face);
  assert.deepEqual(a, extractEyePatchFeatures(pixels, changeEyelids(face, { factor: .7, centerShift: .004 })));
  const b = extractEyePatchFeatures(syntheticEyeImage(face, { gazeX: .2, gazeY: -.3, contrast: .8, brightness: 15 }), face);
  assert.ok(Math.max(...a.map((v,i)=>Math.abs(v-b[i]))) < .05);
});

test('missing pixels, mismatched capture, flat image and unavailable eyes fail closed without padding', async () => {
  const { extractEyePatchFeatures, eyePatchFeaturesForFrame } = await eye();
  const { syntheticEyeImage } = await image(); const face = landmarksForGaze(0, 0), pixels = syntheticEyeImage(face);
  const { rememberFramePixels } = await load(root + 'session-runtime/frame-pixels.mjs');
  const frame = { landmarks: face, frameSize: { width: 640, height: 480 } };
  assert.equal(eyePatchFeaturesForFrame(frame), null);
  rememberFramePixels(frame, pixels); assert.equal(eyePatchFeaturesForFrame(frame).length, 120);
  assert.equal(eyePatchFeaturesForFrame({ ...frame }), null); // Same landmarks/size, different capture owner.
  frame.frameSize.width = 641; assert.equal(eyePatchFeaturesForFrame(frame), null);
  assert.equal(extractEyePatchFeatures({ ...pixels, data: pixels.data.slice(4) }, face), null);
  assert.equal(extractEyePatchFeatures({ ...pixels, data: new Uint8ClampedArray(pixels.data.length) }, face), null);
  assert.equal(extractEyePatchFeatures(pixels, landmarksForGaze(0, 0, { leftShiftX: .4 })), null);
  assert.equal(extractEyePatchFeatures(pixels, []), null);
});

test('dual ridge matches the existing primal ridge with an unpenalized intercept', async () => {
  const { ridgeRegression, ridgeRegressionDual, dotProduct } = await load(root + 'gaze-tracker/ridge.js');
  for (const [n, d] of [[12, 4], [8, 20], [50, 120]]) {
    const matrix = Array.from({ length: n }, (_,i)=>[...Array.from({ length: d }, (_,j)=>Math.sin(i*1.3+j*.2)+j*.01),1]);
    const y = matrix.map((r,i)=>300+15*r[0]-70*r[1]+Math.sin(i));
    for (const lambda of [.01,.1,1,10]) {
      const a=ridgeRegression(matrix,y,lambda), b=ridgeRegressionDual(matrix,y,lambda);
      for (const row of matrix) assert.ok(Math.abs(dotProduct(row,a)-dotProduct(row,b)) < 1e-6);
      assert.ok(Math.abs(dotProduct([...new Array(d).fill(0),1],a)-b[d]) < 1e-6);
    }
  }
  assert.equal(ridgeRegressionDual([[1,1],[2,1]],[1,2],0),null);
});

test('appearance model is explicit, uses the same gate, has calibration-only CV and discards training patch rows', async () => {
  const { default: Tracker } = await load(root + 'gaze-tracker/GazeTracker.js');
  const { extractEyePatchFeatures } = await eye(); const { syntheticEyeImage } = await image();
  const features = new WeakMap(), baseline = new Tracker({ screenWidth:1470,screenHeight:956 });
  let retainedAtCompletion = null;
  const model = new Tracker({ screenWidth:1470,screenHeight:956,
    onCalibrationComplete: () => { retainedAtCompletion = model._calibrationData.length; }, experimentalEyePatch: {
    frameWidth:640,frameHeight:480,readFeatures: face=>features.get(face) } });
  for (const {x,y} of points) for(let click=0;click<2;click++) {
    const face=landmarksForGaze(x,y); features.set(face,extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:x,gazeY:y}),face));
    assert.equal(model.addCalibrationPoint(face,735+x*700,478+y*440),true);
    baseline.addCalibrationPoint(face,735+x*700,478+y*440);
  }
  assert.equal(model.addCalibrationPoint(landmarksForGaze(0,0),0,0),false); // Bounded at 50 rows.
  assert.equal(model.calibrate(),true); assert.equal(baseline.calibrate(),true);
  assert.equal(model.getStatus().featureMethod,'eye_patch_ridge.experimental.v1');
  assert.equal(model.getCalibrationDiagnostics().curve.length,5);
  assert.equal(model.getCalibrationDiagnostics().independentTargetsUsed,0);
  assert.equal(model._calibrationData.length,0); assert.equal(model.getStatus().calibrationPoints,50);
  assert.equal(retainedAtCompletion,0); // Cleanup precedes any callback.
  const face=landmarksForGaze(.3,-.5); features.set(face,extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:.3,gazeY:-.5}),face));
  const a=baseline.predict(face), b=model.predict(face);
  assert.equal(a.confidence,b.confidence); assert.deepEqual(a.ood,b.ood); assert.equal(a.valid,b.valid);
  const c=model.predict(face,{targetX:1,targetY:1000,timestamp:240000});
  assert.equal(b.rawX,c.rawX); assert.equal(b.rawY,c.rawY);
  for(const bad of [changeEyelids(face,{factor:.1}),landmarksForGaze(.3,-.5,{leftShiftX:.1})]) {
    features.set(bad,features.get(face).slice());
    const p=baseline.predict(bad),q=model.predict(bad);
    assert.equal(p.valid,q.valid);assert.equal(p.confidence,q.confidence);assert.deepEqual(p.ood,q.ood);
  }
  features.delete(face); assert.equal(model.predict(face),null); // Never reuse the previous patch/prediction.
  assert.equal(model.addCalibrationPoint(face,0,0),false);
  const status=JSON.stringify(model.getStatus()); assert.equal(status.includes('readFeatures'),false);
  assert.equal(status.includes('data'),false); model.reset(); assert.equal(model.getCalibrationDiagnostics(),null);
  assert.equal(new Tracker().getStatus().featureMethod,'same_eye_iris.v2');
  for(const option of [null,{}, {readFeatures:()=>[],frameWidth:0,frameHeight:480}]) {
    assert.throws(()=>new Tracker({experimentalEyePatch:option}),RangeError);
  }
});

test('appearance calibration uses the intersection of full/core frames for every model, never different subsets', async () => {
  const { commonAppearanceCalibrationFrames } = await load('../../autotests/manual/issue143-models.mjs');
  const frames = Array.from({ length: 5 }, () => ({})), values = new WeakMap();
  values.set(frames[0], { full: [1], core: [2] });
  values.set(frames[1], { full: [1] });
  values.set(frames[2], { core: [2] });
  values.set(frames[3], { full: [3], core: [4] });
  const common = commonAppearanceCalibrationFrames(frames, (frame, region) => values.get(frame)?.[region]);
  assert.deepEqual(common, [frames[0], frames[3]]);
  assert.equal(frames.length, 5); // No mutation or feature/pixel copy.
  assert.ok(common.every(frame => frames.includes(frame)));
});

test('negative control: eye-patch regression can be badly wrong under lid-pixel shift despite an unchanged baseline gate', async () => {
  const { default: Tracker } = await load(root + 'gaze-tracker/GazeTracker.js');
  const { extractEyePatchFeatures } = await eye(); const { syntheticEyeImage } = await image();
  const features=new WeakMap(), model=new Tracker({screenWidth:1470,screenHeight:956,experimentalEyePatch:{
    frameWidth:640,frameHeight:480,readFeatures:face=>features.get(face)}});
  for(const {x,y}of points)for(let click=0;click<2;click++) {
    const face=landmarksForGaze(x,y); features.set(face,extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:x,gazeY:y}),face));
    model.addCalibrationPoint(face,735+700*x,478+440*y);
  }
  assert.equal(model.calibrate(),true);
  const face=landmarksForGaze(.2,.2);
  features.set(face,extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:.2,gazeY:.2}),face));
  const normal=model.predict(face);
  features.set(face,extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:.2,gazeY:.2,lidShift:.04}),face));
  const shifted=model.predict(face);
  assert.equal(normal.valid,shifted.valid); assert.deepEqual(normal.ood,shifted.ood);
  assert.ok(Math.hypot(shifted.rawX-875,shifted.rawY-566)>100);
  // This known limitation blocks promotion. Do not "fix" it by fitting targets
  // from the independent check or ignoring the failed predictions.
});

test('central support is a separate 24-feature ablation, not a promise of invariance to all lid changes', async () => {
  const { extractEyePatchFeatures } = await eye(); const { syntheticEyeImage } = await image();
  const face=landmarksForGaze(.2,.2), normal=syntheticEyeImage(face,{gazeX:.2,gazeY:.2});
  const core=extractEyePatchFeatures(normal,face,{region:'core'});
  assert.equal(core.length,24); assert.ok(core.every(Number.isFinite));
  const mild=extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:.2,gazeY:.2,lidShift:.04}),face,{region:'core'});
  const large=extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:.2,gazeY:.2,lidShift:.08}),face,{region:'core'});
  assert.deepEqual(core,mild); assert.notDeepEqual(core,large);
  assert.equal(extractEyePatchFeatures(normal,face,{region:'unknown'}),null);
});
