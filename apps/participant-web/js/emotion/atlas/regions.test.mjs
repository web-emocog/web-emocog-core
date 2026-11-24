import test from 'node:test';
import assert from 'node:assert/strict';
import { assessZones } from './regions.mjs';
import { mirrorIndex } from './mesh-mirror.mjs';

const catalog = {zones:[
  {id:'left',anchors:[291,308,375]}, {id:'right',anchors:[61,78,146]},
  {id:'both',anchors:[291,308,375,61,78,146],anchorGroups:[[291,308,375],[61,78,146]]}
]};
const points = Array(468).fill(null);
Object.entries({33:[.3,.35],263:[.7,.4],291:[.6,.62],308:[.56,.63],375:[.6,.65],61:[.31,.64],78:[.34,.66],146:[.33,.68]}).forEach(([i,[x,y]])=>points[i]={x,y});
const frame = {width:1280,height:720,inputMirrored:false};
test('physical mirroring preserves anatomical canonical positions and swaps display position',()=>{
  const m=points.map((_,i)=>{const p=points[mirrorIndex(i)];return p&&{x:1-p.x,y:p.y}});
  const a=assessZones(catalog,points,frame), b=assessZones(catalog,m,{...frame,inputMirrored:true});
  assert.equal(a.zones.both.polygons.length,2);
  for (const id of ['left','right','both']){
    assert.ok(b.zoneQuality[id]);
    for(const k of ['x','y'])assert.ok(Math.abs(a.zones[id].canonicalCentre[k]-b.zones[id].canonicalCentre[k])<1e-12);
    assert.ok(Math.abs(a.boxes[id].xMin-(1-b.boxes[id].xMax))<1e-12);
  }
});
test('individual regions abstain and leave visible opposite side intact',()=>{
  const bad=points.slice();bad[308]={x:1.1,y:.2};
  const r=assessZones(catalog,bad,frame);
  assert.deepEqual(r.zoneQuality,{left:false,right:true,both:false});
  assert.equal(r.reasons.left[0],'missing_or_outside_anchor');
});
test('unknown input parity, missing dimensions and invalid reference are recorded',()=>{
  assert.equal(assessZones(catalog,points,{...frame,inputMirrored:null}).reason,'unknown_input_parity');
  assert.equal(assessZones(catalog,points,{...frame,width:0}).reason,'missing_frame_dimensions');
  assert.equal(assessZones(catalog,[],frame).reason,'missing_eye_reference');
});
test('reference normalisation removes translations, in-plane rotation and uniform scale',()=>{
  const transformed=points.map(p=>{if(!p)return null;const x=(p.x-.5)*1280, y=(p.y-.5)*720;
    return {x:.48+(.8*(x*Math.cos(.2)-y*Math.sin(.2)))/1280,y:.54+(.8*(x*Math.sin(.2)+y*Math.cos(.2)))/720}});
  const a=assessZones(catalog,points,frame), b=assessZones(catalog,transformed,frame);
  for(const k of ['x','y'])assert.ok(Math.abs(a.zones.left.canonicalCentre[k]-b.zones.left.canonicalCentre[k])<1e-12);
  assert.throws(()=>assessZones(catalog,points,{...frame,zonePadding:{unknown:.2}}));
});
test('a collapsed subgroup invalidates a joint bilateral region',()=>{
  const bad=points.slice();
  for(const id of [291,308,375]) bad[id]={x:.6,y:.62};
  const r=assessZones(catalog,bad,frame);
  assert.deepEqual(r.zoneQuality,{left:false,right:true,both:false});
  assert.deepEqual(r.reasons.both,['collapsed_zone']);
});
