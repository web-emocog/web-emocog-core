// Artificial pixels only, not camera/eye/head physiology or acceptance data.
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Tracker from '../../apps/participant-web/js/gaze-tracker/GazeTracker.js';
import { landmarksForGaze } from '../../apps/api/tests/fixtures/gaze-topology.js';
import { syntheticEyeImage } from '../../apps/autotests/fixtures/issue143-eye-image.mjs';
import { extractEyePatchFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-patch-features.mjs';
import { ridgeRegressionDual, dotProduct } from '../../apps/participant-web/js/gaze-tracker/ridge.js';
import { extractRowPatch } from '../../apps/participant-web/js/gaze-tracker/eye-tophat-features.mjs';

const lambdas=[.01,.1,1,10,100];
function fit(rows,lambda) {
  const d=rows[0].v.length,n=rows.length;
  const mean=rows[0].v.map((_,j)=>rows.reduce((s,r)=>s+r.v[j],0)/n);
  const std=mean.map((m,j)=>Math.max(.05,Math.sqrt(rows.reduce((s,r)=>s+(r.v[j]-m)**2,0)/n)));
  const normalize=v=>[...v.map((x,j)=>(x-mean[j])/std[j]),1],matrix=rows.map(r=>normalize(r.v));
  const wx=ridgeRegressionDual(matrix,rows.map(r=>r.x),lambda),wy=ridgeRegressionDual(matrix,rows.map(r=>r.y),lambda);
  return v=>({x:dotProduct(normalize(v),wx),y:dotProduct(normalize(v),wy)});
}
function select(rows) {
  let best=null;const curve=[];
  for(const lambda of lambdas) {
    let squared=0,n=0;
    for(const group of [...new Set(rows.map(r=>r.group))]) {
      const predict=fit(rows.filter(r=>r.group!==group),lambda);
      for(const r of rows.filter(r=>r.group===group)){const p=predict(r.v);squared+=(p.x-r.x)**2+(p.y-r.y)**2;n++;}
    }
    const error=Math.sqrt(squared/n);curve.push({lambda,error});
    if(!best||error<best.error)best={lambda,error};
  }
  return {predict:fit(rows,best.lambda),lambda:best.lambda,cvRms:best.error};
}
const conditions={normal:{},lid_up:{lidShift:-.04},lid_down:{lidShift:.04},large_lid:{lidShift:.08},
  partial:{aperture:.14},near_closed:{aperture:.035},iris_absent:{irisVisible:false},
  glare:{glare:250},contrast:{contrast:.5,brightness:40},texture:{texture:20},true_gaze_jitter:{},
  image_translation:{},image_roll:{},image_scale:{},missing_pixels:{}};
export function runRowPatchSynthetic(only=null) {
  const features=new WeakMap(),old=new Tracker({screenWidth:1470,screenHeight:956,
    experimentalEyePatch:{frameWidth:640,frameHeight:480,readFeatures:f=>features.get(f)}});
  const topFeatures=new WeakMap(),tophat=new Tracker({screenWidth:1470,screenHeight:956,
    experimentalEyePatch:{region:'tophat',frameWidth:640,frameHeight:480,readFeatures:f=>topFeatures.get(f)}});
  const rows={dense_raw:[],row_contrast:[],row_tophat:[]};
  for(const x of [-.8,-.4,0,.4,.8])for(const y of [-.8,-.4,0,.4,.8])for(let click=0;click<2;click++) {
    const face=landmarksForGaze(x,y),pixels=syntheticEyeImage(face,{gazeX:x,gazeY:y});
    features.set(face,extractEyePatchFeatures(pixels,face));old.addCalibrationPoint(face,735+x*700,478+y*440);
    topFeatures.set(face,extractRowPatch(pixels,face,'row_tophat'));
    if(!tophat.addCalibrationPoint(face,735+x*700,478+y*440))throw Error('tophat_training_capture_rejected');
    for(const key of Object.keys(rows))rows[key].push({v:extractRowPatch(pixels,face,key==='dense_raw'?'raw':key),group:x+':'+y,x:735+x*700,y:478+y*440});
  }
  if(!old.calibrate()||!tophat.calibrate())throw Error('tracker_fit_failed');
  const fitted=Object.fromEntries(Object.entries(rows).map(([key,r])=>[key,select(r)]));
  const results=[];
  for(const [condition,nuisance]of Object.entries(conditions).filter(([name])=>!only||name===only)) {
    const totals=Object.fromEntries(['old_patch',...Object.keys(rows)].map(key=>[key,{attempts:0,accepted:0,error:0,spread2:0,off:0,
      truthOffscreen:{inside:0,outside:0,missing:0}}]));
    let extractionMs=0,gateDisagreements=0;
    const predict=(x,y,i)=>{
      const dx=condition==='true_gaze_jitter'?.02*Math.sin(i*1.7):0,dy=condition==='true_gaze_jitter'?.02*Math.cos(i*1.9):0;
      let face=landmarksForGaze(x+dx,y+dy,condition==='image_roll'?{roll:.03}:condition==='image_scale'?{scale:1.03}:{});
      if(condition==='image_translation')face=face.map(p=>({...p,x:p.x+.012,y:p.y-.008}));
      const pixels=condition==='missing_pixels'&&i%4===0?null:syntheticEyeImage(face,{gazeX:x+dx,gazeY:y+dy,...nuisance});
      const begun=performance.now(),vectors={old_patch:extractEyePatchFeatures(pixels,face),
        dense_raw:extractRowPatch(pixels,face,'raw'),row_contrast:extractRowPatch(pixels,face),
        row_tophat:extractRowPatch(pixels,face,'row_tophat')};
      extractionMs+=performance.now()-begun;
      if(vectors.old_patch)features.set(face,vectors.old_patch);
      if(vectors.row_tophat)topFeatures.set(face,vectors.row_tophat);
      const reference=old.predict(face),predictions={old_patch:reference?.valid?{x:reference.rawX,y:reference.rawY}:null};
      for(const key of Object.keys(fitted))predictions[key]=reference?.valid&&vectors[key]?fitted[key].predict(vectors[key]):null;
      const actual=tophat.predict(face);
      if(reference&&actual&&(reference.valid!==actual.valid||reference.confidence!==actual.confidence
        ||JSON.stringify(reference.ood)!==JSON.stringify(actual.ood)))gateDisagreements++;
      if(actual?.valid&&predictions.row_tophat) {
        if(Math.round(predictions.row_tophat.x)!==actual.rawX||Math.round(predictions.row_tophat.y)!==actual.rawY)
          throw Error('offline_and_tracker_fit_disagree');
      }
      predictions.row_tophat=actual?.valid?{x:actual.rawX,y:actual.rawY}:null;
      return predictions;
    };
    for(const x of [-.65,-.2,.2,.65])for(const y of [-.65,-.2,.2,.65]) {
      const captures=Object.fromEntries(Object.keys(totals).map(k=>[k,[]]));
      for(let i=0;i<6;i++)for(const [key,p]of Object.entries(predict(x,y,i))) {
        const t=totals[key];t.attempts++;if(!p)continue;
        t.accepted++;t.error+=Math.hypot(p.x-(735+x*700),p.y-(478+y*440));captures[key].push(p);
        if(p.x<0||p.x>1470||p.y<0||p.y>956)t.off++;
      }
      for(const [key,ps]of Object.entries(captures))if(ps.length) {
        const mx=ps.reduce((s,p)=>s+p.x,0)/ps.length,my=ps.reduce((s,p)=>s+p.y,0)/ps.length;
        totals[key].spread2+=ps.reduce((s,p)=>s+(p.x-mx)**2+(p.y-my)**2,0);
      }
    }
    for(const [i,[x,y]]of [[-1.4,-.2],[-1.4,.2],[1.4,-.2],[1.4,.2],[-.2,-1.4],[.2,-1.4],[-.2,1.4],[.2,1.4]].entries())
      for(const [key,p]of Object.entries(predict(x,y,i)))totals[key].truthOffscreen[p?(p.x<0||p.x>1470||p.y<0||p.y>956?'outside':'inside'):'missing']++;
    results.push({condition,meanExtractionMs:extractionMs/104,gateDisagreements,
      models:Object.fromEntries(Object.entries(totals).map(([key,t])=>[key,{accepted:t.accepted,attempts:t.attempts,
        meanError:t.accepted?t.error/t.accepted:null,spread:t.accepted?Math.sqrt(t.spread2/t.accepted):null,
        offscreen:t.off,truthOffscreen:t.truthOffscreen,
        lambda:key==='old_patch'?old.getCalibrationDiagnostics().lambdaX:key==='row_tophat'?tophat.getCalibrationDiagnostics().lambdaX:fitted[key].lambda}]))});
  }
  return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify({version:'issue143_row_patch_synthetic.v1',scope:'artificial_images_not_webcam_acceptance',results:runRowPatchSynthetic()},null,2));
