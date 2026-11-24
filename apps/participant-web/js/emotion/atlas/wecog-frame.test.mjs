import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWecogRecording, frameQuality } from './wecog-frame.mjs';

const catalog = JSON.parse(await readFile(new URL('./catalog.json', import.meta.url),'utf8'));
const options = {participantId:'P-test', blockId:'B-test', inputMirrored:false, enabledZones:['mouth_left','mouth_right']};
const modelFrame = (timestamp, smile = .23) => ({
    timestamp, frameSize:{width:640,height:480}, face:{detected:true,status:'optimal'},
    illumination:{status:'optimal'}, pose:{status:'stable',isTilted:false,yaw:0,pitch:0,roll:0},
    landmarks:Array.from({length:478},(_,i)=>({x:0.2 + 0.6*((i*31)%478)/478,y:0.2+0.6*((i*7)%478)/478})),
    blendShapes:Object.fromEntries(catalog.channels.map(c=>[c.name,c.name === 'mouthSmileLeft' ? smile : .1])),
    pixels:'MUST_NOT_BE_EXPORTED',
});

test('actual WECog frame contract: neutral → calibrated, sided expression → local export without mesh', () => {
    const recording = createWecogRecording(catalog, options);
    assert.equal(recording.startTask(0),false);
    for(let t=0;t<5000;t+=50) recording.observe(modelFrame(t),true,{visible:true,now:t+10});
    assert.equal(recording.startTask(5000),true);
    recording.observe(modelFrame(5000,.73),true,{visible:true,now:5010});
    recording.observe(modelFrame(5050,.73),false,{visible:true,now:5060});
    recording.stop('operator', 5090);
    const lines = recording.exportLines();
    assert.doesNotMatch(lines.join(''), /MUST_NOT_BE_EXPORTED|"landmarks"|"pixels"/);
    const header = JSON.parse(lines[0]), valid = JSON.parse(lines.at(-2)), invalid = JSON.parse(lines.at(-1));
    assert.equal(header.taskStartMs,5000); assert.equal(header.stopMs,5090);
    assert.equal(header.calibration.frozen,true); assert.equal(header.frameCount,102);
    assert.equal(valid.raw.mouthSmileLeft,.73);
    assert.ok(Math.abs(valid.observations.find(o=>o.channel==='mouthSmileLeft').delta-.5)<1e-9);
    assert.equal(valid.observations.find(o=>o.channel==='mouthSmileRight').delta,0);
    assert.equal(invalid.status,'insufficient_data');
    assert.ok(invalid.captureReasons.includes('segmentation_incomplete_or_stale'));
    assert.equal(recording.status(5110).latestBoxes,null);
});

test('unavailable position, illumination, pose, page and stale detection have explicit reasons', () => {
    const f = modelFrame(50);
    assert.deepEqual(frameQuality(f,true,true,51),[]);
    const reasons = frameQuality({...f, pose:{},illumination:{},face:{}},false,false,1280);
    for (const code of ['segmentation_incomplete_or_stale','page_hidden','face_missing','lighting','head_pose','timestamp_or_stale_frame'])
        assert.ok(reasons.includes(code));
});

test('stopped block ignores later frames, including new participant/session',()=>{
    const recording = createWecogRecording(catalog,options);
    recording.observe(modelFrame(0),true,{visible:true,now:1});
    recording.stop('camera_or_session_ended');
    recording.observe(modelFrame(50),true,{visible:true,now:55});
    assert.equal(recording.status(60).count,1);
    assert.equal(JSON.parse(recording.exportLines()[0]).stopReason,'camera_or_session_ended');
});

test('actual task interval is represented even during a complete tracking outage',()=>{
    const recording = createWecogRecording(catalog,{...options,neutralStartMs:20});
    recording.observe(modelFrame(0),true,{visible:true,now:30});  // pre-button capture
    for(let t=20;t<5020;t+=50) recording.observe(modelFrame(t),true,{visible:true,now:t+5});
    assert.equal(recording.startTask(5020),true);
    recording.observe(modelFrame(5000),true,{visible:true,now:5025}); // in-flight neutral frame
    recording.stop('operator',7020);
    const rows=recording.exportLines().map(JSON.parse);
    assert.deepEqual([rows[0].neutralStartMs,rows[0].taskStartMs,rows[0].stopMs],[20,5020,7020]);
    assert.equal(rows.length,101); // The late capture belongs to an already recorded sampling slot.
    assert.ok(rows.slice(1).every(row=>row.phase==='neutral'));
});

test('all required channels must have a baseline; an available opposite side is insufficient', () => {
    const recording = createWecogRecording(catalog,options);
    for(let t=0;t<5000;t+=50) {
        const frame=modelFrame(t); delete frame.blendShapes.mouthSmileRight;
        recording.observe(frame,true,{visible:true,now:t+1});
    }
    const ready=recording.status(5000).ready;
    assert.equal(ready.readyAny,true);
    assert.equal(ready.readyRequired,false);
    assert.equal(recording.startTask(5000),false);
    assert.ok(ready.channels.mouthSmileRight.reasons.includes('neutral_count'));
});

test('fixed capture slots retain at most one source frame and do not fabricate missed samples', () => {
    const recording=createWecogRecording(catalog,{...options,neutralStartMs:0,expectedFps:20});
    for(let t=0;t<1000;t+=10) recording.observe(modelFrame(t),true,{visible:true,now:t+1});
    assert.equal(recording.status(1000).count,20);
    recording.observe(modelFrame(2000),true,{visible:true,now:2001});
    assert.equal(recording.status(2001).count,21);
    recording.stop('operator',2002);
    const header=JSON.parse(recording.exportLines()[0]);
    assert.equal(header.samplingMethod,'capture-time-slots.v1');
    assert.equal(header.integrationBaseCommit,'6a9f73e');
    assert.ok(header.model.sha256);
});

test('slow stream can use an explicitly longer neutral window; negative delta is retained', () => {
    const recording=createWecogRecording(catalog,{...options,expectedFps:5,neutralDurationMs:10000});
    for(let t=0;t<=10000;t+=250) recording.observe(modelFrame(t,.5),true,{visible:true,now:t+1});
    assert.equal(recording.startTask(10001),true);
    recording.observe(modelFrame(10250,.1),true,{visible:true,now:10251});
    const sample=recording.status(10252).observations.find(o=>o.channel==='mouthSmileLeft');
    assert.ok(Math.abs(sample.delta+.4)<1e-9);
    recording.stop('operator',10253);
    assert.equal(recording.series('mouthSmileLeft').at(-1).delta,sample.delta);
});

test('failed calibration stops after bounded time and remains downloadable', () => {
    const recording=createWecogRecording(catalog,options);
    for(let t=0;t<=31000;t+=100) recording.observe(modelFrame(t),false,{visible:true,now:t+1});
    assert.equal(recording.status(31000).stopReason,'neutral_timeout');
    assert.ok(recording.exportLines().length>1);
});

test('a stalled camera cannot leave neutral collection waiting indefinitely', () => {
    const recording=createWecogRecording(catalog,{...options,neutralStartMs:100});
    assert.equal(recording.status(30100).stopReason,'neutral_timeout');
    assert.equal(JSON.parse(recording.exportLines()[0]).frameCount,0);
});
