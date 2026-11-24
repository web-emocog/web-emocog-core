import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtlas, summarizeWindow, annotateObservations} from './engine.mjs';

const catalog = {
  version:'fixture/1',
  zones:[{id:'face'},{id:'left'},{id:'right'},{id:'jaw'}],
  channels:[
    {name:'_neutral',zone:'face',side:'none',actionUnit:null,proxy:'unmapped'},
    ...['Left','Right'].map(s => ({name:'mouthSmile' + s, zone:s.toLowerCase(), side:s.toLowerCase(),
      actionUnit:'AU12',proxy:'candidate'})),
    ...['Left','Right'].map(s => ({name:'jaw' + s,zone:'jaw',side:'midline',direction:s.toLowerCase(),
      actionUnit:null,proxy:'auxiliary'})),
    {name:'jawOpen',zone:'jaw',side:'midline',actionUnit:'AU26',proxy:'candidate'},
    {name:'browInnerUp',zone:'face',side:'bilateral',actionUnit:'AU1',proxy:'candidate'}
  ],
  anatomy:[{au:'AU12',action_ru:'угол рта'},{au:'AU01',action_ru:'подъём внутренней части бровей'}]
};
const options = {participantId:'P01', blockId:'B01', extractorId:'fixture-v1', inputMirrored:false};
const zones = {face:true,left:true,right:true,jaw:true};
const neutral = {_neutral:0,mouthSmileLeft:0.1,mouthSmileRight:0.34,jawLeft:0,jawRight:0,jawOpen:0,browInnerUp:0};
function frame(t, phase, values=neutral, rest={}) {
  return {timestampMs:t, phase, qualityOk:true, zoneQuality:zones, blendshapes:values, ...rest};
}
function calibrated(overrides={}, transform=event => event) {
  const atlas = createAtlas(catalog,{...options,...overrides});
  for (let t=0; t<5000;t+=50) atlas.observe(transform(frame(t,'neutral')));
  return atlas;
}
const get = (r,name) => r.observations.find(o => o.channel === name);

test('measured five seconds and individual side baselines, robust to one outlier',() => {
  const a = calibrated({},e => e.timestampMs === 400 ? {...e,blendshapes:{...neutral,mouthSmileLeft:1}} : e);
  assert.equal(a.readiness(4999).readyAny,false);
  assert.equal(a.readiness(5000).readyAll,true);
  const r = a.observe(frame(5000,'task',{...neutral,mouthSmileLeft:0.6}));
  assert.equal(r.status,'ok');
  assert.equal(get(r,'mouthSmileLeft').delta,0.5);
  assert.equal(get(r,'mouthSmileRight').delta,0);
  assert.equal(a.calibration().channels.mouthSmileLeft.mad,0);
  assert.equal(a.calibration().channels.mouthSmileLeft.n,100);
  assert.equal(r.observations.some(o => o.channel === '_neutral'),false);
  assert.equal(r.raw._neutral,0);
  const saved = a.calibration();
  assert.deepEqual(a.observe(frame(5050,'neutral')).reasons,['baseline_frozen']);
  assert.deepEqual(a.calibration(),saved);
});

test('mirrored pixels resolve anatomical sides and horizontal direction but preserve raw keys',() => {
  const a = calibrated({inputMirrored:true});
  const r = a.observe(frame(5000,'task',{...neutral,mouthSmileRight:0.5,jawRight:0.4}));
  assert.equal(get(r,'mouthSmileLeft').sourceChannel,'mouthSmileRight');
  assert.equal(get(r,'mouthSmileLeft').absolute,0.5);
  assert.equal(get(r,'mouthSmileLeft').baseline,0.34);
  assert.equal(r.raw.mouthSmileLeft,0.1);
  assert.equal(get(r,'jawLeft').absolute,0.4);
  assert.equal(get(r,'jawLeft').direction,'left');
});

test('orientation unknown abstains on side and directional metrics, retains central score',() => {
  const a = calibrated({inputMirrored:null});
  const r = a.observe(frame(5000,'task'));
  assert.equal(r.status,'partial');
  assert.equal(get(r,'jawLeft').delta,null);
  assert.ok(get(r,'jawLeft').reasons.includes('unknown_orientation'));
  assert.equal(get(r,'jawOpen').delta,0);
});

test('missing local QC, explicit exclusion and missing channel leave other observations intact',() => {
  const a = calibrated({enabledZones:['left','right','jaw']});
  const r = a.observe(frame(5000,'task',{jawLeft:0,jawRight:0,mouthSmileLeft:0.3,mouthSmileRight:0.7},
    {zoneQuality:{left:false,jaw:true}}));
  assert.deepEqual(get(r,'mouthSmileLeft').reasons,['zone_qc_failed']);
  assert.deepEqual(get(r,'mouthSmileRight').reasons,['zone_qc_unknown']);
  assert.deepEqual(get(r,'jawOpen').reasons,['missing_channel']);
  assert.equal(get(r,'jawLeft').delta,0);
  assert.equal(r.raw.mouthSmileRight,0.7);
});

test('no sufficient included neutral samples => raw and eligible absolute retained, delta withheld',() => {
  const a = calibrated({},e => ({...e,zoneQuality:{...zones,left:e.timestampMs % 250 === 0}}));
  const r = a.observe(frame(5000,'task'));
  assert.ok(get(r,'mouthSmileLeft').reasons.includes('neutral_count'));
  assert.equal(a.calibration().channels.mouthSmileLeft.n,20);
  assert.equal(get(r,'mouthSmileLeft').absolute,0.1);
  assert.equal(get(r,'mouthSmileLeft').delta,null);
  assert.equal(get(r,'mouthSmileRight').status,'ok');
});

test('burst plus long gap cannot constitute a neutral calibration',() => {
  const a = createAtlas(catalog, options);
  for (let i=0;i<30;i++) a.observe(frame(i*10,'neutral'));
  a.observe(frame(4950,'neutral'));
  const r = a.observe(frame(5000,'task'));
  assert.ok(get(r,'mouthSmileLeft').reasons.includes('neutral_gap'));
  assert.equal(r.status,'insufficient_data');
});

test('failed frame, duplicate keys, NaN, and wrong extractor never produce usable delta',() => {
  const a = calibrated();
  const r1 = a.observe(frame(5000,'task',neutral,{qualityOk:false}));
  assert.equal(r1.status,'insufficient_data');
  const input = {categories:[{categoryName:'jawOpen',score:0},{categoryName:'jawOpen',score:0.8},
    {categoryName:'jawLeft',score:NaN},{categoryName:'jawRight',score:0}]};
  const r2 = a.observe(frame(5050,'task',input));
  assert.deepEqual(get(r2,'jawOpen').reasons,['duplicate_channel']);
  assert.deepEqual(get(r2,'jawLeft').reasons,['invalid_score']);
  assert.equal(get(r2,'jawRight').delta,0);
  assert.deepEqual(a.observe(frame(5100,'task',neutral,{extractorId:'other'})).reasons,['extractor_changed']);
  assert.deepEqual(a.observe(frame(5000,'task')).reasons,['nonmonotonic_timestamp']);
});

test('windows respect cadence, half-open interval, missing zone frames and long gaps',() => {
  const a = calibrated();
  const rows = [];
  for (let t=5000;t<=7000;t+=50) rows.push(a.observe(frame(t,'task',neutral,
    {zoneQuality:{...zones,left:t < 5400 || t >= 5800}})));
  const w = summarizeWindow(rows,{endMs:6000,durationMs:1000});
  const left = w.channels.find(c => c.channel === 'mouthSmileLeft');
  assert.equal(left.n,12);
  assert.deepEqual(left.reasons,['window_count','window_gap']);
  assert.equal(w.channels.find(c => c.channel === 'jawOpen').medianDelta,0);
  assert.equal(w.channels.find(c => c.channel === 'jawOpen').n,20);
  assert.equal(summarizeWindow(rows,{endMs:7000,durationMs:2000}).channels[1].n,40);
  const sparse = rows.filter((r,i) => !(i%4));
  const slow = summarizeWindow(sparse,{endMs:6000,durationMs:1000,expectedFps:5});
  assert.equal(slow.channels.find(c=>c.channel==='jawOpen').nExpected,5);
});

test('catalog, participant and zone mismatches excluded',() => {
  assert.throws(() => createAtlas(catalog,{...options,enabledZones:['typo']}),/zone/);
  assert.throws(() => createAtlas(catalog,{...options,participantId:''}),/participant/);
  const a=calibrated(), b=calibrated({participantId:'P02'});
  const rec=a.observe(frame(5000,'task'));
  assert.throws(() => summarizeWindow([rec,b.observe(frame(5050,'task'))],{endMs:5500,durationMs:1000}),/Mixed/);
  assert.throws(() => annotateObservations(rec,{...catalog,version:'new'}),/mismatch/);
  assert.equal(annotateObservations(rec,catalog).find(o=>o.channel==='browInnerUp').anatomyReference.au,'AU01');
});

test('raw export survives disabled zones and data do not cross block boundary',() => {
  const a = createAtlas(catalog,{...options,enabledZones:[]});
  const r = a.observe(frame(100,'task'));
  assert.deepEqual(r.observations,[]);
  assert.equal(r.raw.jawOpen,0);
  const b = createAtlas(catalog,{...options,blockId:'B02'});
  const task = b.observe(frame(100,'task'));
  assert.equal(get(task,'jawOpen').delta,null);
  assert.ok(get(task,'jawOpen').reasons.includes('neutral_duration'));
});

test('study-specified neutral dispersion cutoff abstains only on unstable channels',() => {
  const a = calibrated({maxNeutralMadByChannel:{mouthSmileLeft:0.05}}, e => ({
    ...e, blendshapes:{...neutral,mouthSmileLeft:e.timestampMs % 100 === 0 ? 0.2 : 0.8}
  }));
  const r = a.observe(frame(5000,'task'));
  assert.equal(get(r,'mouthSmileLeft').delta,null);
  assert.deepEqual(get(r,'mouthSmileLeft').reasons,['neutral_dispersion']);
  assert.equal(a.calibration().channels.mouthSmileLeft.observedMedian,0.5);
  assert.ok(a.calibration().channels.mouthSmileLeft.mad > 0.29);
  assert.equal(get(r,'mouthSmileRight').delta,0);
});

test('annotation returns study contexts without declaring that a multi-AU pattern occurred',() => {
  const r=calibrated().observe(frame(5000,'task'));
  const reference={pattern:'AU06 + AU12',reaction:'study context'};
  const rows=annotateObservations(r,{...catalog,reactionEvidence:[reference]});
  assert.deepEqual(rows.find(o=>o.channel==='mouthSmileLeft').protocolReferences,[reference]);
  assert.deepEqual(rows.find(o=>o.channel==='jawLeft').protocolReferences,[]);
  assert.equal(r.observations.some(o=>o.emotion !== undefined),false);
});

test('1-Hz and 2-Hz window defaults respect a short window duration', () => {
  const engine = calibrated();
  const records = [engine.observe(frame(5000,'task')), engine.observe(frame(5500,'task'))];
  for (const expectedFps of [1, 2]) {
    const window = summarizeWindow(records,{endMs:6000,durationMs:1000,expectedFps});
    assert.equal(window.maxGapMs, 1000);
    assert.equal(window.status, 'ok');
  }
});
