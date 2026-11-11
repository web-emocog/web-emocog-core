const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../participant-web');
const load = name => import(pathToFileURL(path.join(root, 'js', name)).href);
const vpc = () => load('gaze-tracker/gaze-tests/vpc/metrics.js');
const regions = { familiar: { left: 100, top: 100, width: 100, height: 100 },
  novel: { left: 400, top: 100, width: 100, height: 100 } };
const point = (t, changes = {}) => ({ t, valid: true, onScreen: true, correctedX: 450, correctedY: 150, ...changes });
const options = samples => ({ samples, startMs: 0, endMs: 1000, regions, viewport: { width: 600, height: 400 } });

test('shoulder axis has no endpoint-order discontinuity; mirror and vertical conventions are explicit', async () => {
  const { shoulderAxisRollDeg } = await load('session-runtime/continuous-body-pose.js');
  for (const [a,b,angle] of [
    [{ x:.3,y:.3 },{ x:.7,y:.3 },0], [{ x:.7,y:.3 },{ x:.3,y:.3 },0],
    [{ x:.3,y:.3 },{ x:.5,y:.5 },45], [{ x:.5,y:.5 },{ x:.3,y:.3 },45],
    [{ x:.7,y:.3 },{ x:.5,y:.5 },-45], [{ x:.3,y:.3 },{ x:.3,y:.7 },-90],
    [{ x:.3,y:.7 },{ x:.3,y:.3 },-90],
  ]) assert.ok(Math.abs(shoulderAxisRollDeg(a,b) - angle) < 1e-9);
  assert.equal(shoulderAxisRollDeg({ x:0,y:0 },{ x:0,y:0 }), null);
  assert.equal(shoulderAxisRollDeg({ x:NaN,y:0 },{ x:0,y:0 }), null);
});

test('collector computes horizontal shoulders as zero and does not mix restored legacy roll sums', async () => {
  const { ContinuousBodyPoseCollector, summarizeBodyPoseState, BODY_POSE_VERSION } = await load('session-runtime/continuous-body-pose.js');
  const state = { runtime: {}, sessionData: { startTime: 1000, bodyPoseAccumulator: {
    n:10, validCount:10, shoulderRollAbsSum:1800, confidenceSum:10,
    movementVelocitySum:0, torsoLeanAbsSum:0, startedAt:0, updatedAt:1000 } } };
  assert.equal(summarizeBodyPoseState(state).version, 'body_pose_mediapipe.v1');
  assert.equal(summarizeBodyPoseState(state).shoulderRollAbsMeanDeg, 180);
  const landmarks = Array.from({ length:33 },()=>({ x:0,y:0,z:0,visibility:1,presence:1 }));
  Object.assign(landmarks[11],{ x:.7,y:.3 }); Object.assign(landmarks[12],{ x:.3,y:.3 });
  Object.assign(landmarks[23],{ x:.65,y:.7 }); Object.assign(landmarks[24],{ x:.35,y:.7 });
  const collector = new ContinuousBodyPoseCollector({ state });
  const sample = collector.consumeResult({ landmarks:[landmarks] },1000,{ wallTime:1000 });
  assert.equal(sample.valid,true); assert.equal(sample.shoulderRollDeg,0);
  const summary = collector.summary();
  assert.equal(summary.version,BODY_POSE_VERSION); assert.equal(summary.validSampleCount,11);
  assert.equal(summary.shoulderRollSampleCount,1); assert.equal(summary.shoulderRollLegacySampleCount,10);
  assert.equal(summary.shoulderRollAbsMeanDeg,0);
  assert.equal(state.sessionData.bodyPoseAccumulator.shoulderRollAbsSum,1800);
  assert.deepEqual(summarizeBodyPoseState(JSON.parse(JSON.stringify(state))),summary);
});

test('VPC uses corrected image AOI, not display coordinates or half of the screen', async () => {
  const { computePairLookMetrics: calc } = await vpc();
  const result = calc(options([point(0,{x:150,displayX:150}),point(100,{x:150,displayX:150})]));
  assert.equal(result.validLookMs,100); assert.equal(result.noveltyPreferencePct,100);
  assert.equal(result.unknownDurationMs,900); assert.equal(result.coverageFraction,.1);
  const outside = calc(options([point(0,{correctedY:250}),point(100,{correctedY:250})]));
  assert.equal(outside.valid,false); assert.equal(outside.validLookMs,0); assert.equal(outside.outsideImageMs,100);
  assert.equal(outside.noveltyPreferencePct,null);
});

test('unmeasurable new shoulder axes remain null, not zero or mislabeled legacy samples', async () => {
  const { ContinuousBodyPoseCollector, summarizeBodyPoseState, BODY_POSE_VERSION } = await load('session-runtime/continuous-body-pose.js');
  const state = { runtime:{}, sessionData:{} };
  assert.equal(summarizeBodyPoseState(state).version,BODY_POSE_VERSION);
  const collector = new ContinuousBodyPoseCollector({ state });
  collector.consumeResult({},0,{wallTime:1000});
  assert.equal(collector.summary().version,BODY_POSE_VERSION);
  const landmarks = Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:1,presence:1}));
  const sample = collector.consumeResult({landmarks:[landmarks]},100,{wallTime:1100});
  assert.equal(sample.shoulderRollDeg,null);
  assert.equal(collector.summary().shoulderRollAbsMeanDeg,null);
  assert.equal(collector.summary().shoulderRollSampleCount,0);
  assert.equal(collector.summary().shoulderRollLegacySampleCount,0);
});

test('VPC rejects empty and isolated observations; a five-second gap contributes no dwell', async () => {
  const { computePairLookMetrics: calc } = await vpc();
  for (const samples of [[],[point(0)], [point(0),point(5000)]]) {
    const result = calc({ ...options(samples),endMs:10000 });
    assert.equal(result.valid,false); assert.equal(result.validLookMs,0);
    assert.equal(result.noveltyPreferencePct,null); assert.equal(result.unknownDurationMs,10000);
  }
  assert.equal(calc(options([point(0),point(250)])).validLookMs,250);
  assert.equal(calc(options([point(0),point(251)])).validLookMs,0);
});

test('VPC never bridges invalid, off-screen, clipped, legacy or missing corrected observations', async () => {
  const { computePairLookMetrics: calc } = await vpc();
  for (const changes of [{ valid:false },{ onScreen:false },{ clipped:true },{ correctedX:null },
    { correctedY:NaN },{ correctedX:-1 },{ valid:undefined },{ onScreen:undefined }]) {
    const result = calc(options([point(0),point(100,changes),point(200)]));
    assert.equal(result.validLookMs,0,JSON.stringify(changes));
    assert.equal(result.unknownDurationMs,1000);
  }
  const crossing = calc(options([point(0),point(100,{correctedX:150}),point(200,{correctedX:150})]));
  assert.equal(crossing.lookMsFamiliar,100); assert.equal(crossing.lookMsNovel,0);
});

test('VPC clips intervals to the actual window and does not extrapolate from the last point', async () => {
  const { computePairLookMetrics: calc } = await vpc();
  const result = calc({ ...options([point(150),point(-50),point(50),point(50),point(2000)]),endMs:100 });
  assert.equal(result.validLookMs,100); assert.equal(result.observedDurationMs,100);
  assert.equal(result.unknownDurationMs,0);
  const boundary = calc(options([point(0,{correctedX:500}),point(100,{correctedX:500})]));
  assert.equal(boundary.validLookMs,0);
  const small = calc({ ...options([point(0),point(.001)]),endMs:100000 });
  assert.equal(small.valid,true); assert.ok(small.validLookMs > 0); assert.ok(small.coverageFraction > 0);
  assert.equal(JSON.parse(JSON.stringify(small)).coverageFraction,small.coverageFraction);
});

test('VPC layout or stimulus failure invalidates results, without a fabricated preference', async () => {
  const { computePairLookMetrics: calc } = await vpc();
  for (const [extra,reason] of [[{layoutChanged:true},'layout_changed'],[{stimulusAvailable:false},'stimulus_unavailable'],
    [{regions:null},'image_aoi_unavailable'],[{viewport:null},'image_aoi_unavailable'],
    [{viewport:{width:300,height:300}},'image_aoi_unavailable']]) {
    const result = calc({ ...options([point(0),point(100)]), ...extra });
    assert.equal(result.reason,reason); assert.equal(result.noveltyPreferencePct,null);
  }
  const result = calc({ ...options([point(0),point(100)]), minCoverageFraction:.5 });
  assert.equal(result.reason,'insufficient_coverage'); assert.equal(result.coverageFraction,.1);
  assert.throws(()=>calc({ ...options([]),minCoverageFraction:NaN }));
});

test('VPC time accounting conserves every window under deterministic gaps, duplicates and AOI crossings', async () => {
  const {computePairLookMetrics:calc} = await vpc();
  let seed = 42;
  const random = () => ((seed = (Math.imul(seed,1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let run = 0; run < 100; run++) {
    const samples = [];
    let t = -100;
    while (t < 1200) {
      samples.push(point(t,{correctedX:[150,450,250][Math.floor(random()*3)],valid:random()>.2}));
      t += Math.floor(random()*400);
    }
    const before = JSON.stringify(samples);
    const result = calc(options(samples));
    assert.equal(JSON.stringify(samples),before);
    assert.ok(result.validLookMs >= 0 && result.validLookMs <= 1000);
    assert.ok(Math.abs(result.validLookMs + result.outsideImageMs + result.unknownDurationMs - 1000) < 1e-9);
    assert.equal(result.valid,result.validLookMs > 0);
    assert.ok(result.coverageFraction >= 0 && result.coverageFraction <= 1);
    if (result.valid) assert.ok(result.noveltyPreferencePct >= 0 && result.noveltyPreferencePct <= 100);
    else assert.equal(result.noveltyPreferencePct,null);
  }
});

test('VPC run summary excludes placeholders, legacy values and zero-coverage trials', async () => {
  const { computePairLookMetrics: calc, summarizeVPCRun, VPC_METRIC_VERSION } = await vpc();
  const metrics = calc(options([point(0),point(100)]));
  const trial = { methodVersion:VPC_METRIC_VERSION, skipped:false, metrics };
  const summary = summarizeVPCRun([trial,{...trial,skipped:true},{...trial,valid:false},
    {...trial,novelStimulus:{stimulusId:'local_placeholder:lion'}},
    {skipped:false,metrics:{validLookMs:0,noveltyPreferencePct:null}}]);
  assert.equal(summary.validTrials,1); assert.equal(summary.invalidTrials,4); assert.equal(summary.skippedTrials,1);
  assert.equal(summary.totalLookMs,100); assert.equal(summary.legacyUnscoredTrials,1);
  assert.equal(summarizeVPCRun([]).meanNoveltyPreferencePct,null);
  const small = calc({...options([point(0),point(.001)]),endMs:100000});
  const smallSummary = summarizeVPCRun([{...trial,metrics:small}]);
  assert.equal(smallSummary.validTrials,1); assert.ok(smallSummary.totalLookMs > 0);
});

test('each existing local VPC asset matches its manifest size and SHA-256', async () => {
  const { FELIDAE_SPECIES_POOLS } = await load('gaze-tracker/gaze-tests/vpc/manifest-felidae.js');
  for (const entry of Object.values(FELIDAE_SPECIES_POOLS).flat()) {
    const bytes = await fs.readFile(path.join(root,entry.url));
    assert.equal(bytes.length,entry.sizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  }
});

test('VPC loader returns an explicit failure, never creates a synthetic stimulus, and releases a successful lease', async () => {
  const { pickLoadableStimulusFromPool } = await load('gaze-tracker/gaze-tests/vpc/fallback.js');
  const entry = { stimulusId:'lion:test', url:'/image.jpg', sizeBytes:1, sha256:'a'.repeat(64) };
  const failed = await pickLoadableStimulusFromPool([entry],new Set(),{cache:{ prepare:async()=>{throw new Error('offline');} }});
  assert.equal(failed.stimulus,null); assert.equal(failed.reason,'stimulus_unavailable');
  let releases=0;
  const loaded = await pickLoadableStimulusFromPool([entry],new Set(),{cache:{
    prepare:async()=>({urlFor:()=>'blob:synthetic',release(){releases++;}}) }});
  assert.equal(loaded.stimulus.sourceUrl,entry.url); assert.equal(loaded.stimulus.sha256,entry.sha256);
  loaded.release(); loaded.release(); assert.equal(releases,1);
  const placeholder = await pickLoadableStimulusFromPool([{...entry,license:'placeholder'}],new Set(),{
    cache:{prepare(){assert.fail('A placeholder must not be loaded');}} });
  assert.equal(placeholder.stimulus,null);
});

test('new method versions and VPC exclusions survive final aggregate transport without Blob URLs', async () => {
  const { computePairLookMetrics, summarizeVPCRun, VPC_METRIC_VERSION } = await vpc();
  const { buildAggregatesPayload } = await load('unified-aggregates-new.js');
  const trials = [{ methodVersion:VPC_METRIC_VERSION, skipped:false, valid:false,
    metrics:computePairLookMetrics(options([])) }];
  const summary = { version:'body_pose_mediapipe.v2',shoulderRollMethod:'camera_normalized_axis_modulo_180.v2',
    shoulderRollSampleCount:1,shoulderRollLegacySampleCount:10,shoulderRollAbsMeanDeg:0 };
  const packet = buildAggregatesPayload({ ids:{session:'METRIC-TEST',participant:'SYNTHETIC',invitationCode:'TEST'},
    startTime:1000, lifecycle:{ schemaVersion:'session_lifecycle.v1',state:'completed',status:'completed',
      finishAttemptId:'metric-finish',completedAt:10000 },
    bodyPoseSummary:summary, gazeTests:{ vpcRuns:[{ methodVersion:VPC_METRIC_VERSION,
      trials,summary:summarizeVPCRun(trials) }] } }, { forIngest:true });
  const wire = JSON.parse(JSON.stringify(packet));
  assert.deepEqual(wire.body_pose_summary,summary);
  assert.equal(wire.gazeTests.vpcRuns[0].summary.validTrials,0);
  assert.equal(wire.gazeTests.vpcRuns[0].trials[0].metrics.noveltyPreferencePct,null);
  const validation = require('../security/payload-policy').validateSessionFeaturePayload(wire);
  assert.deepEqual(validation,[]);
});
