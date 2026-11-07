// Controlled artificial eye images only. NOT a biological eye simulator,
// temporal drift model, hardware benchmark or real-camera acceptance.
import { performance } from 'node:perf_hooks';
import { landmarksForGaze } from '../../apps/api/tests/fixtures/gaze-topology.js';
import { syntheticEyeImage } from '../../apps/autotests/fixtures/issue143-eye-image.mjs';
import { extractEyePatchFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-patch-features.mjs';
import { createModelComparison } from '../../apps/autotests/manual/issue143-models.mjs';
const viewport = { width:1470,height:956 }, camera={width:640,height:480};
const conditions = ['normal','uninformative_landmark_y','brightness_contrast','lid_pixels_shift','lid_pixels_shift_up',
  'lid_pixels_shift_large','missing_pixels','measurement_jitter',
  'image_plane_translation','image_plane_roll','image_plane_scale'];
const results=[];
const round=v=>Math.round(v*1000)/1000;
for(const condition of conditions) {
  const features=new WeakMap();
  const models=createModelComparison(viewport,camera,'appearance',(face,region)=>features.get(face)?.[region]);
  const fitStart=performance.now();
  for(const x of [-.8,-.4,0,.4,.8]) for(const y of [-.8,-.4,0,.4,.8]) for(let click=0;click<2;click++) {
    const face=landmarksForGaze(x,condition==='uninformative_landmark_y'?0:y);
    const pixels=syntheticEyeImage(face,{gazeX:x,gazeY:y});
    features.set(face,{full:extractEyePatchFeatures(pixels,face),core:extractEyePatchFeatures(pixels,face,{region:'core'})});
    for(const model of Object.values(models)) if(!model.addCalibrationPoint(face,735+700*x,478+440*y)) throw Error('sample_rejected');
  }
  for(const model of Object.values(models)) if(!model.calibrate()) throw Error('fit_failed');
  const calibrationRuntimeMs=performance.now()-fitStart;
  const accum=Object.fromEntries(Object.keys(models).map(name=>[name,{n:0,accepted:0,offscreen:0,error:0,dx2:0,dy2:0,spread2:0,runtime:0}]));
  let extractionMs=0,gateDisagreements=0;
  for(const x of [-.65,-.2,.2,.65]) for(const y of [-.65,-.2,.2,.65]) {
    const points=Object.fromEntries(Object.keys(models).map(name=>[name,[]]));
    for(let i=0;i<8;i++) {
      const jx=condition==='measurement_jitter'?Math.sin(i*1.7)*.02:0;
      const jy=condition==='measurement_jitter'?Math.cos(i*1.9)*.02:0;
      let face=landmarksForGaze(x+jx,condition==='uninformative_landmark_y'?0:y+jy,
        condition==='image_plane_roll'?{roll:.03}:condition==='image_plane_scale'?{scale:1.03}:{});
      if(condition==='image_plane_translation')face=face.map(p=>({...p,x:p.x+.012,y:p.y-.008}));
      const pixels=syntheticEyeImage(face,{gazeX:x+jx,gazeY:y+jy,
        ...(condition==='brightness_contrast'?{brightness:15,contrast:.8}:{}),
        ...(condition.startsWith('lid_pixels_shift') ? {lidShift: condition.endsWith('large') ? .08 : condition.endsWith('up') ? -.04 : .04} : {})});
      const start=performance.now();
      const vector=condition==='missing_pixels'&&i%4===0?null:extractEyePatchFeatures(pixels,face);
      const core=condition==='missing_pixels'&&i%4===0?null:extractEyePatchFeatures(pixels,face,{region:'core'});
      extractionMs+=performance.now()-start; if(vector||core)features.set(face,{full:vector,core});
      const predictions={};
      for(const [name,model] of Object.entries(models)) {
        const a=accum[name],begun=performance.now(),p=model.predict(face,{timestamp:240000+i*33});
        a.runtime+=performance.now()-begun; a.n++; predictions[name]=p;
        if(!p?.valid)continue;
        a.accepted++; if(!p.onScreen)a.offscreen++;
        const dx=p.rawX-(735+x*700),dy=p.rawY-(478+y*440);
        a.error+=Math.hypot(dx,dy);a.dx2+=dx*dx;a.dy2+=dy*dy;points[name].push({x:p.rawX,y:p.rawY});
      }
      if(Object.values(predictions).some(p=>p&&p.valid!==predictions.baseline.valid))gateDisagreements++;
    }
    for(const [name,p] of Object.entries(points)) {
      if(!p.length)continue;
      const mx=p.reduce((s,v)=>s+v.x,0)/p.length,my=p.reduce((s,v)=>s+v.y,0)/p.length;
      accum[name].spread2+=p.reduce((s,v)=>s+(v.x-mx)**2+(v.y-my)**2,0);
    }
  }
  const specificity=Object.fromEntries(Object.keys(models).map(name=>[name,{correct:0,n:0}]));
  // Horizontal off-screen truth only; not a vertical-specificity claim.
  for(const x of [-1.5,1.5])for(const y of [-.2,.2]) {
    const face=landmarksForGaze(x,condition==='uninformative_landmark_y'?0:y);
    const pixels=syntheticEyeImage(face,{gazeX:x,gazeY:y});
    features.set(face,{full:extractEyePatchFeatures(pixels,face),core:extractEyePatchFeatures(pixels,face,{region:'core'})});
    for(const [name,model]of Object.entries(models)) {
      const p=model.predict(face);specificity[name].n++;if(!p?.valid||!p.onScreen)specificity[name].correct++;
    }
  }
  results.push({condition,calibrationRuntimeMs:round(calibrationRuntimeMs),meanPatchExtractionMs:round(extractionMs/128),gateDisagreements,
    models:Object.fromEntries(Object.entries(accum).map(([name,a])=>[name,{captures:a.n,accepted:a.accepted,
      meanRawErrorPx:a.accepted?round(a.error/a.accepted):null,rmsXPx:a.accepted?round(Math.sqrt(a.dx2/a.accepted)):null,
      rmsYPx:a.accepted?round(Math.sqrt(a.dy2/a.accepted)):null,
      withinTargetRmsSpreadPx:a.accepted?round(Math.sqrt(a.spread2/a.accepted)):null,
      missingFraction:1-a.accepted/a.n,offscreenFractionOfAccepted:a.accepted?a.offscreen/a.accepted:null,
      horizontalOffscreenSpecificity4Samples:specificity[name].correct/specificity[name].n,
      meanRegressionRuntimeMs:round(a.runtime/a.n),selection:models[name].getCalibrationDiagnostics(),
      ...(name.startsWith('eye_patch')?{trainingPatchRowsDiscarded:models[name]._calibrationData.length===0}:{})}]))});
}
console.log(JSON.stringify({version:'issue143_appearance_synthetic.v1',scope:'artificial_eye_images_only_not_webcam_accuracy_or_drift',
  nuisanceScope:'image_plane_2d_only_not_3d_head_motion_or_physiological_lid_motion',
  trainingTargets:25,clicksPerTarget:2,heldOutTargets:16,predictionsPerTarget:8,correction:'none_raw_only',results},null,2));
