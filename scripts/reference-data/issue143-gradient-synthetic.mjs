// Artificial images, NOT webcam accuracy, physiological occlusion or drift.
import { performance } from 'node:perf_hooks';
import { landmarksForGaze } from '../../apps/api/tests/fixtures/gaze-topology.js';
import { syntheticEyeImage } from '../../apps/autotests/fixtures/issue143-eye-image.mjs';
import { extractEyePatchFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-patch-features.mjs';
import { extractEyeGradientFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-gradient-features.mjs';
import { createModelComparison } from '../../apps/autotests/manual/issue143-models.mjs';
const viewport={width:1470,height:956}, camera={width:640,height:480}, results=[];
const round=v=>Math.round(v*1000)/1000;
const conditions={normal:{},uninformative_landmark_y:{},brightness_contrast:{brightness:15,contrast:.8},
  lid_pixels_shift:{lidShift:.04},lid_pixels_shift_up:{lidShift:-.04},lid_pixels_shift_large:{lidShift:.08},
  partial_aperture:{aperture:.14},near_closed:{aperture:.035},glare:{glare:250},texture:{texture:4},
  low_contrast:{contrast:.2,brightness:70},low_contrast_texture:{contrast:.2,brightness:70,texture:35},
  iris_absent:{irisVisible:false},missing_pixels:{},measurement_jitter:{},
  image_plane_translation:{},image_plane_roll:{},image_plane_scale:{}};
for(const [condition,nuisance]of Object.entries(conditions)) {
  const features=new WeakMap();
  const models=createModelComparison(viewport,camera,'gradient',(face,region)=>features.get(face)?.[region]);
  const extract=(face,pixels)=>({full:extractEyePatchFeatures(pixels,face),
    gradient_all:extractEyeGradientFeatures(pixels,face,{support:'all'}),gradient:extractEyeGradientFeatures(pixels,face)});
  const makeFace=(x,y,measurement=false)=>{
    let face=landmarksForGaze(x,condition==='uninformative_landmark_y'?0:y,
      measurement&&condition==='image_plane_roll'?{roll:.03}:measurement&&condition==='image_plane_scale'?{scale:1.03}:{});
    if(measurement&&condition==='image_plane_translation')face=face.map(p=>({...p,x:p.x+.012,y:p.y-.008}));
    return face;
  };
  const trainStart=performance.now();
  for(const x of [-.8,-.4,0,.4,.8])for(const y of [-.8,-.4,0,.4,.8])for(let click=0;click<2;click++) {
    const face=makeFace(x,y);features.set(face,extract(face,syntheticEyeImage(face,{gazeX:x,gazeY:y})));
    for(const model of Object.values(models))if(!model.addCalibrationPoint(face,735+700*x,478+440*y))throw Error('calibration_sample_rejected');
  }
  for(const model of Object.values(models))if(!model.calibrate())throw Error('calibration_failed');
  const calibrationRuntimeMs=performance.now()-trainStart;
  const totals=Object.fromEntries(Object.keys(models).map(name=>[name,{n:0,accepted:0,offscreen:0,error:0,dx2:0,dy2:0,spread2:0,runtime:0}]));
  let extractionMs=0,gateDisagreements=0;
  for(const x of [-.65,-.2,.2,.65])for(const y of [-.65,-.2,.2,.65]) {
    const points=Object.fromEntries(Object.keys(models).map(name=>[name,[]]));
    for(let i=0;i<8;i++) {
      const jx=condition==='measurement_jitter'?Math.sin(i*1.7)*.02:0,jy=condition==='measurement_jitter'?Math.cos(i*1.9)*.02:0;
      const face=makeFace(x+jx,y+jy,true),pixels=syntheticEyeImage(face,{gazeX:x+jx,gazeY:y+jy,...nuisance});
      const start=performance.now();
      if(!(condition==='missing_pixels'&&i%4===0))features.set(face,extract(face,pixels));
      extractionMs+=performance.now()-start;
      let baseline;
      for(const [name,model]of Object.entries(models)) {
        const a=totals[name],begun=performance.now(),p=model.predict(face,{timestamp:240000+i*33});
        a.runtime+=performance.now()-begun;a.n++;
        if(name==='baseline')baseline=p;else if(p&&p.valid!==baseline.valid)gateDisagreements++;
        if(!p?.valid)continue;
        a.accepted++;if(!p.onScreen)a.offscreen++;
        const dx=p.rawX-(735+700*x),dy=p.rawY-(478+440*y);
        a.error+=Math.hypot(dx,dy);a.dx2+=dx*dx;a.dy2+=dy*dy;points[name].push({x:p.rawX,y:p.rawY});
      }
    }
    for(const [name,p]of Object.entries(points))if(p.length) {
      const mx=p.reduce((s,v)=>s+v.x,0)/p.length,my=p.reduce((s,v)=>s+v.y,0)/p.length;
      totals[name].spread2+=p.reduce((s,v)=>s+(v.x-mx)**2+(v.y-my)**2,0);
    }
  }
  const off=Object.fromEntries(Object.keys(models).map(name=>[name,{samples:0,acceptedOffscreen:0,rejectedOrMissing:0,falseOnscreen:0}]));
  for(const [i,[x,y]]of [[-1.5,-.2],[-1.5,.2],[1.5,-.2],[1.5,.2],[-.2,-1.5],[.2,-1.5],[-.2,1.5],[.2,1.5]].entries()) {
    const face=makeFace(x,y,true),pixels=syntheticEyeImage(face,{gazeX:x,gazeY:y,...nuisance});
    if(!(condition==='missing_pixels'&&i%4===0))features.set(face,extract(face,pixels));
    for(const [name,model]of Object.entries(models)){const a=off[name],p=model.predict(face);a.samples++;
      if(!p?.valid)a.rejectedOrMissing++;else if(!p.onScreen)a.acceptedOffscreen++;else a.falseOnscreen++;}
  }
  results.push({condition,gateDisagreements,calibrationRuntimeMs:round(calibrationRuntimeMs),meanAllExtractionMs:round(extractionMs/128),
    models:Object.fromEntries(Object.entries(totals).map(([name,a])=>[name,{captures:a.n,accepted:a.accepted,
      meanRawErrorPx:a.accepted?round(a.error/a.accepted):null,rmsXPx:a.accepted?round(Math.sqrt(a.dx2/a.accepted)):null,
      rmsYPx:a.accepted?round(Math.sqrt(a.dy2/a.accepted)):null,
      withinTargetRmsSpreadPx:a.accepted?round(Math.sqrt(a.spread2/a.accepted)):null,
      missingFraction:1-a.accepted/a.n,offscreenFractionOfAccepted:a.accepted?a.offscreen/a.accepted:null,
      offscreenTruth:off[name],meanRegressionRuntimeMs:round(a.runtime/a.n),selection:models[name].getCalibrationDiagnostics()}]))});
}
console.log(JSON.stringify({version:'issue143_gradient_synthetic.v1',scope:'artificial_images_not_webcam_accuracy_or_drift',
  trainingTargets:25,clicksPerTarget:2,heldOutTargets:16,predictionsPerTarget:8,correction:'none_raw_only',results},null,2));
