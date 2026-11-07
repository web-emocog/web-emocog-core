const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { landmarksForGaze, changeEyelids } = require('./fixtures/gaze-topology');
const load = file => import(pathToFileURL(path.resolve(__dirname,file)));
const root = '../../participant-web/js/';
const detector = () => load(root+'gaze-tracker/eye-gradient-features.mjs');
const image = () => load('../../autotests/fixtures/issue143-eye-image.mjs');

test('gradient centers add pixel information without depending on iris or eyelid landmarks', async () => {
  const { extractEyeGradientFeatures } = await detector(), { syntheticEyeImage } = await image();
  const face = landmarksForGaze(0,0);
  for (const [x,y] of [[0,0],[.6,.6],[-.6,-.6],[.6,-.6]]) {
    const pixels = syntheticEyeImage(face,{gazeX:x,gazeY:y});
    const f = extractEyeGradientFeatures(pixels,face);
    assert.equal(f.length,4); assert.ok(f.every(Number.isFinite));
    for (let eye=0;eye<2;eye++) assert.ok(Math.hypot(f[eye*2]-.36*x,f[eye*2+1]-.24*y)<.03);
    const changed = changeEyelids(landmarksForGaze(-.8,.8),{factor:.7,centerShift:.01});
    assert.deepEqual(f,extractEyeGradientFeatures(pixels,changed));
  }
});

test('gradient localization tolerates controlled lid/lighting changes without fitting their gaze labels', async () => {
  const { extractEyeGradientFeatures } = await detector(), { syntheticEyeImage } = await image();
  const face = landmarksForGaze(0,0);
  for (const support of ['all','lateral']) for (const [x,y] of [[.6,.6],[-.6,-.6]]) {
    const baseline = extractEyeGradientFeatures(syntheticEyeImage(face,{gazeX:x,gazeY:y}),face,{support});
    for (const nuisance of [{lidShift:.04},{lidShift:-.04},{lidShift:.08},{brightness:15,contrast:.8}]) {
      const f = extractEyeGradientFeatures(syntheticEyeImage(face,{gazeX:x,gazeY:y,...nuisance}),face,{support});
      assert.ok(f && Math.max(...f.map((v,i)=>Math.abs(v-baseline[i])))<.04);
    }
  }
});

test('gradient features require the exact completed pixel owner/geometry and do not fill missing eyes', async () => {
  const { extractEyeGradientFeatures,eyeGradientFeaturesForFrame } = await detector(), { syntheticEyeImage } = await image();
  const { rememberFramePixels } = await load(root+'session-runtime/frame-pixels.mjs');
  const landmarks = landmarksForGaze(0,0), pixels = syntheticEyeImage(landmarks);
  const frame = {landmarks,frameSize:{width:640,height:480}};
  assert.equal(eyeGradientFeaturesForFrame(frame),null);
  rememberFramePixels(frame,pixels); assert.equal(eyeGradientFeaturesForFrame(frame).length,4);
  assert.equal(eyeGradientFeaturesForFrame({...frame}),null);
  frame.frameSize.width=641;assert.equal(eyeGradientFeaturesForFrame(frame),null);
  assert.equal(extractEyeGradientFeatures({...pixels,data:pixels.data.slice(4)},landmarks),null);
  assert.equal(extractEyeGradientFeatures(pixels,landmarksForGaze(0,0,{leftShiftX:.5})),null);
  assert.equal(extractEyeGradientFeatures(pixels,landmarks,{support:'unknown'}),null);
});

test('flat and one-dimensional stripe images cannot identify a measured two-dimensional center', async () => {
  const { extractEyeGradientFeatures } = await detector();
  const landmarks=landmarksForGaze(0,0),width=640,height=480,data=new Uint8ClampedArray(width*height*4);
  data.fill(128);assert.equal(extractEyeGradientFeatures({data,width,height},landmarks),null);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)data[4*(y*width+x)+c]=y>215&&y<220?30:200;
  assert.equal(extractEyeGradientFeatures({data,width,height},landmarks),null);
});

test('negative control: lateral support is not a reliable repair for near-closed eye pixels', async () => {
  const { extractEyeGradientFeatures }=await detector(),{ syntheticEyeImage }=await image();
  const face=landmarksForGaze(0,0),pixels=syntheticEyeImage(face,{gazeX:.65,gazeY:-.65,aperture:.035});
  assert.equal(extractEyeGradientFeatures(pixels,face,{support:'all'}),null);
  const lateral=extractEyeGradientFeatures(pixels,face);
  assert.ok(lateral && Math.max(...lateral.map((v,i)=>Math.abs(v-(i%2?-.24*.65:.36*.65))))>.06);
  // Landmarks were deliberately kept open. Record this detector limitation,
  // do not conceal it by changing the shared baseline gate or calling it drift repair.
});

test('gradient regressions remain explicit, target blind and share iris/head gates without retaining training images', async () => {
  const { extractEyeGradientFeatures } = await detector(), { syntheticEyeImage } = await image();
  const { createModelComparison, commonGradientCalibrationFrames } = await load('../../autotests/manual/issue143-models.mjs');
  const values=new WeakMap(),models=createModelComparison({width:1470,height:956},{width:640,height:480},'gradient',
    (face,region)=>values.get(face)?.[region]);
  // Eight target groups/two clicks suffice for this lifecycle/gate unit test.
  // The separate benchmark uses all 25 targets; do not turn this into an FPS test.
  for(const x of [-.8,0,.8])for(const y of [-.8,0,.8])for(let i=0;i<2;i++) {
    if(x===0&&y===0)continue;
    const face=landmarksForGaze(x,y),pixels=syntheticEyeImage(face,{gazeX:x,gazeY:y});
    values.set(face,{gradient:extractEyeGradientFeatures(pixels,face),gradient_all:extractEyeGradientFeatures(pixels,face,{support:'all'}),full:new Array(120).fill(0).map((_,i)=>Math.sin(x*i+y))});
    for(const model of Object.values(models))assert.equal(model.addCalibrationPoint(face,735+700*x,478+440*y),true);
  }
  for(const model of Object.values(models))assert.equal(model.calibrate(),true);
  for(const name of ['eye_gradient','eye_gradient_all']) {
    const model=models[name];assert.equal(model._calibrationData.length,0);
    assert.equal(model.getStatus().predictor,'eye_gradient_ridge');
    assert.equal(model.getStatus().experimentalModel.featureCount,4);
    assert.equal(model.getCalibrationDiagnostics().basisX,'center_linear');
    assert.equal(model.getCalibrationDiagnostics().independentTargetsUsed,0);
    const face=landmarksForGaze(.3,-.4),pixels=syntheticEyeImage(face,{gazeX:.3,gazeY:-.4});
    const f=extractEyeGradientFeatures(pixels,face);values.set(face,{gradient:f,gradient_all:f});
    const a=models.baseline.predict(face),b=model.predict(face),c=model.predict(face,{targetX:9000,targetY:-5000,timestamp:900000});
    assert.equal(b.valid,a.valid);assert.equal(b.confidence,a.confidence);assert.deepEqual(b.ood,a.ood);
    assert.equal(b.rawX,c.rawX);assert.equal(b.rawY,c.rawY);
    for(const bad of [changeEyelids(face,{factor:.1}),landmarksForGaze(.3,-.4,{leftShiftX:.1})]) {
      values.set(bad,{gradient:f,gradient_all:f});const p=models.baseline.predict(bad),q=model.predict(bad);
      assert.equal(p.valid,q.valid);assert.equal(p.confidence,q.confidence);assert.deepEqual(p.ood,q.ood);
    }
    values.delete(face);assert.equal(model.predict(face),null);
    model.reset();assert.equal(model._modelX,null);assert.equal(model.getCalibrationDiagnostics(),null);
  }
  const a={},b={},c={};values.set(a,{full:[1],gradient:[2],gradient_all:[3]});values.set(b,{full:[1],gradient:[2]});
  values.set(c,{full:[1],gradient:[2],gradient_all:[3]});
  assert.deepEqual(commonGradientCalibrationFrames([a,b,c],(face,region)=>values.get(face)?.[region]),[a,c]);
});
