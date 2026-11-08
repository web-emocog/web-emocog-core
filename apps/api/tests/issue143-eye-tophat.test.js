const test = require('node:test');
const assert = require('node:assert/strict');
const { landmarksForGaze, changeEyelids } = require('./fixtures/gaze-topology');
const load = () => import('../../participant-web/js/gaze-tracker/eye-tophat-features.mjs');
const image = () => import('../../autotests/fixtures/issue143-eye-image.mjs');

test('horizontal closing preserves original edge darkness, fills narrow interior gaps and is extensive', async () => {
  const { horizontalClosing } = await load();
  const row = Float64Array.from([0,0,1,1,1,1,0,.2,1,1,1,1,0,0]);
  const closed = horizontalClosing(row, 2);
  assert.equal(closed[0], 0); assert.equal(closed.at(-1), 0);
  assert.equal(closed[6], 1); assert.equal(closed[7], 1);
  assert.ok(row.every((v,i) => closed[i] >= v));
  assert.deepEqual(horizontalClosing(closed,2), closed);
  assert.equal(horizontalClosing(Float64Array.from([1,NaN]),1), null);
  assert.equal(horizontalClosing(row,0), null);
});

test('top-hat keeps vertical eye information and never reads iris/lid coordinates as a center', async () => {
  const { extractRowPatch, EYE_TOPHAT_LENGTH } = await load(), { syntheticEyeImage } = await image();
  const f=landmarksForGaze(0,0),p=syntheticEyeImage(f,{gazeX:.2,gazeY:-.5});
  const a=extractRowPatch(p,f,'row_tophat'),b=extractRowPatch(syntheticEyeImage(f,{gazeX:.2,gazeY:.5}),f,'row_tophat');
  assert.equal(a.length,EYE_TOPHAT_LENGTH); assert.equal(a.length,320);
  assert.ok(a.every(Number.isFinite)); assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))>1);
  const changed=changeEyelids(f,{factor:.6,centerShift:.01});
  for(let i=468;i<478;i++)changed[i]={x:.8,y:.1};
  assert.deepEqual(extractRowPatch(p,changed,'row_tophat'),a);
});

test('top-hat requires this completed capture and reports missing pixels/iris rather than a stale patch', async () => {
  const { eyeTophatFeaturesForFrame, extractRowPatch }=await load(),{syntheticEyeImage}=await image();
  const { rememberFramePixels }=await import('../../participant-web/js/session-runtime/frame-pixels.mjs');
  const f=landmarksForGaze(0,0),p=syntheticEyeImage(f),frame={landmarks:f,frameSize:{width:640,height:480}};
  assert.equal(eyeTophatFeaturesForFrame(frame),null);
  rememberFramePixels(frame,p);assert.equal(eyeTophatFeaturesForFrame(frame).length,320);
  assert.equal(eyeTophatFeaturesForFrame({...frame}),null);
  frame.frameSize.width=641;assert.equal(eyeTophatFeaturesForFrame(frame),null);
  assert.equal(extractRowPatch(syntheticEyeImage(f,{irisVisible:false}),f,'row_tophat'),null);
  assert.equal(extractRowPatch({...p,data:p.data.slice(4)},f,'row_tophat'),null);
  assert.equal(extractRowPatch(p,landmarksForGaze(0,0,{leftShiftX:.6}),'row_tophat'),null);
});

test('top-hat explicit model shares the gate, is target/time blind and discards training rows', async () => {
  const { default: Tracker }=await import('../../participant-web/js/gaze-tracker/GazeTracker.js');
  const { extractRowPatch }=await load(),{syntheticEyeImage}=await image();
  const values=new WeakMap(),common={screenWidth:1470,screenHeight:956};
  const model=new Tracker({...common,experimentalEyePatch:{region:'tophat',frameWidth:640,frameHeight:480,readFeatures:f=>values.get(f)}});
  const baseline=new Tracker(common);
  for(const x of [-.8,-.4,0,.4,.8])for(const y of [-.8,-.4,0,.4,.8])for(let click=0;click<2;click++) {
    const f=landmarksForGaze(x,y);values.set(f,extractRowPatch(syntheticEyeImage(f,{gazeX:x,gazeY:y}),f,'row_tophat'));
    assert.equal(model.addCalibrationPoint(f,735+700*x,478+440*y),true);baseline.addCalibrationPoint(f,735+700*x,478+440*y);
  }
  assert.equal(model.calibrate(),true);assert.equal(baseline.calibrate(),true);
  assert.equal(model._calibrationData.length,0);
  assert.equal(model.getStatus().featureMethod,'eye_tophat_ridge.experimental.v1');
  assert.equal(model.getStatus().experimentalModel.featureCount,320);
  assert.equal(model.getCalibrationDiagnostics().independentTargetsUsed,0);
  assert.equal(model.getCalibrationDiagnostics().curve.length,5);
  const f=landmarksForGaze(.25,-.5);values.set(f,extractRowPatch(syntheticEyeImage(f,{gazeX:.25,gazeY:-.5}),f,'row_tophat'));
  const p=model.predict(f),b=baseline.predict(f),q=model.predict(f,{timestamp:240000,targetX:0,targetY:0});
  assert.equal(p.valid,b.valid);assert.equal(p.confidence,b.confidence);assert.deepEqual(p.ood,b.ood);
  assert.equal(q.rawX,p.rawX);assert.equal(q.rawY,p.rawY);
  values.delete(f);assert.equal(model.predict(f),null);model.reset();
  assert.equal(model.getCalibrationDiagnostics(),null);assert.equal(model._modelX,null);
  assert.equal(new Tracker().getStatus().featureMethod,'same_eye_iris.v2');
});

test('top-hat common calibration policy never substitutes different usable frames across models', async () => {
  const { commonTophatCalibrationFrames }=await import('../../autotests/manual/issue143-models.mjs');
  const f=[{full:[1],gradient_all:[2]},{full:[1],gradient_all:[2],tophat:[3]},{full:[1],tophat:[3]}];
  assert.deepEqual(commonTophatCalibrationFrames(f,(frame,key)=>frame[key]),[f[1]]);
});

test('negative image oracle: top-hat improves lid-shift error but not textured or nearly closed eyes', async () => {
  const { runRowPatchSynthetic }=await import('../../../scripts/reference-data/issue143-row-patch-synthetic.mjs');
  // One fit serves the fixed exploration matrix; no retuning on these targets.
  const rows=runRowPatchSynthetic();
  const model=(name,key)=>rows.find(r=>r.condition===name).models[key];
  assert.ok(model('lid_up','row_tophat').meanError<model('lid_up','old_patch').meanError*.1);
  assert.ok(model('texture','row_tophat').meanError>model('texture','old_patch').meanError);
  assert.ok(model('near_closed','row_tophat').meanError>model('near_closed','old_patch').meanError);
  assert.equal(model('iris_absent','row_tophat').accepted,0);
  assert.equal(model('iris_absent','row_tophat').meanError,null);
  assert.equal(model('missing_pixels','row_tophat').accepted,64);
  assert.equal(model('normal','row_tophat').truthOffscreen.inside,0);
});
