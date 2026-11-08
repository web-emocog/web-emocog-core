// Artificial eye pixels only. Not a physical pose model or webcam acceptance.
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Tracker from '../../apps/participant-web/js/gaze-tracker/GazeTracker.js';
import { summarizeClickVectors, fitClickScatter } from './issue143-click-scatter.mjs';
import { landmarksForGaze } from '../../apps/api/tests/fixtures/gaze-topology.js';
import { syntheticEyeImage } from '../../apps/autotests/fixtures/issue143-eye-image.mjs';
import { extractEyePatchFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-patch-features.mjs';
const viewport={width:1470,height:956};
const conditions={normal:{},lid_up:{lidShift:-.04},lid_down:{lidShift:.04},large_lid:{lidShift:.08},
  partial:{aperture:.14},glare:{glare:250},contrast:{brightness:40,contrast:.5},true_gaze_jitter:{},
  outside_training_lid:{lidShift:.15}};
export function runScatterSynthetic(trainingOnly = null, conditionOnly = null) {
const out=[];
for(const training of ['no_variation','small_lid_variation'].filter(t => !trainingOnly || t === trainingOnly)) {
  const features=new WeakMap(), model=new Tracker({screenWidth:viewport.width,screenHeight:viewport.height,
    experimentalEyePatch:{frameWidth:640,frameHeight:480,readFeatures:f=>features.get(f)}});
  const rows=[],begun=performance.now();
  for(const x of [-.8,-.4,0,.4,.8])for(const y of [-.8,-.4,0,.4,.8])for(let click=0;click<2;click++) {
    const frames=[],vectors=[];
    for(let i=0;i<6;i++) {
      const face=landmarksForGaze(x,y), v=extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:x,gazeY:y,
        lidShift:training==='small_lid_variation'?(i-2.5)*.004:0}),face);
      features.set(face,v);frames.push(face);vectors.push(v);
    }
    model.addAveragedCalibrationPoint(frames,735+x*700,478+y*440,{minFrames:6});
    const clickScatter=summarizeClickVectors(vectors);
    rows.push({irisFeatures:[...clickScatter.mean,1],clickScatter,screenX:735+x*700,screenY:478+y*440});
  }
  if(!model.calibrate())throw Error('mean_fit_failed');
  const scatter=fitClickScatter(rows,new Array(120).fill(.05));
  if(!scatter)throw Error('scatter_fit_failed');
  const fitMs=performance.now()-begun;
  rows.length=0;
  const predict=vector=>({x:scatter.modelX[120]+vector.reduce((s,v,j)=>s+scatter.modelX[j]*(v-scatter.mean[j])/scatter.std[j],0),
    y:scatter.modelY[120]+vector.reduce((s,v,j)=>s+scatter.modelY[j]*(v-scatter.mean[j])/scatter.std[j],0)});
  for(const [condition,nuisance]of Object.entries(conditions)) {
    if (conditionOnly && condition !== conditionOnly) continue;
    const a={mean:0,scatter:0,n:0,offMean:0,offScatter:0,meanSpread:0,scatterSpread:0};
    for(const x of [-.65,-.2,.2,.65])for(const y of [-.65,-.2,.2,.65]) {
      const samples={mean:[],scatter:[]};
      for(let i=0;i<6;i++) {
        const dx=condition==='true_gaze_jitter'?.02*Math.sin(i*1.7):0;
        const dy=condition==='true_gaze_jitter'?.02*Math.cos(i*1.9):0;
        const face=landmarksForGaze(x+dx,y+dy),v=extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:x+dx,gazeY:y+dy,...nuisance}),face);
        if(!v)continue;
        features.set(face,v);const m=model.predict(face);
        if(!m?.valid)continue;
        const s=predict(v),p={mean:{x:m.rawX,y:m.rawY},scatter:s};a.n++;
        for(const name of ['mean','scatter']) {
          a[name]+=Math.hypot(p[name].x-(735+700*x),p[name].y-(478+440*y));samples[name].push(p[name]);
          if(p[name].x<0||p[name].x>1470||p[name].y<0||p[name].y>956)a[name==='mean'?'offMean':'offScatter']++;
        }
      }
      for(const name of ['mean','scatter']) {
        const p=samples[name];if(!p.length)continue;
        const mx=p.reduce((s,v)=>s+v.x,0)/p.length,my=p.reduce((s,v)=>s+v.y,0)/p.length;
        a[name+'Spread']+=p.reduce((s,v)=>s+(v.x-mx)**2+(v.y-my)**2,0);
      }
    }
    const off={mean:{outside:0,inside:0,missing:0},scatter:{outside:0,inside:0,missing:0}};
    for(const [x,y]of [[-1.4,-.2],[-1.4,.2],[1.4,-.2],[1.4,.2],[-.2,-1.4],[.2,-1.4],[-.2,1.4],[.2,1.4]]) {
      const face=landmarksForGaze(x,y),v=extractEyePatchFeatures(syntheticEyeImage(face,{gazeX:x,gazeY:y,...nuisance}),face);
      if(v)features.set(face,v);const m=model.predict(face);
      if(!m?.valid){off.mean.missing++;off.scatter.missing++;continue;}
      const p={mean:{x:m.rawX,y:m.rawY},scatter:predict(v)};
      for(const name of ['mean','scatter'])off[name][p[name].x<0||p[name].x>1470||p[name].y<0||p[name].y>956?'outside':'inside']++;
    }
    out.push({training,condition,attempts:96,accepted:a.n,meanError:a.mean/a.n,scatterError:a.scatter/a.n,
      meanSpread:Math.sqrt(a.meanSpread/a.n),scatterSpread:Math.sqrt(a.scatterSpread/a.n),
      offMean:a.offMean,offScatter:a.offScatter,offTruth:off,fitMs,
      meanLambda:model.getCalibrationDiagnostics().lambdaX,scatterLambda:scatter.lambda});
  }
}
return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify({version:'issue143_click_scatter_synthetic.v1',
    scope:'artificial_eye_images_only_not_head_motion_or_webcam_accuracy',results:runScatterSynthetic()},null,2));
}
