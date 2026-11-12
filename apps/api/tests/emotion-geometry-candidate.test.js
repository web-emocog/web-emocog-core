const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
let Candidate,measure,Legacy,Comparison,extract;
before(async()=>{
    const load=p=>import(pathToFileURL(path.resolve(__dirname,'../..',p)).href);
    ({GeometryEmotionAnalyzer:Candidate,measureEmotionGeometry:measure}=await load('web/developer/emotion-geometry-candidate.mjs'));
    ({EmotionComparison:Comparison}=await load('web/developer/emotion-comparison.mjs'));
    ({EmotionAnalyzer:Legacy}=await load('participant-web/js/emotion/emotion-analyzer.js'));
    ({extractActionUnits:extract}=await load('participant-web/js/emotion/au-extractor.js'));
});
function face(changes={}) {
    const lm=Array.from({length:468},()=>({x:.5,y:.5,z:0}));
    const points={234:[.3,.5],454:[.7,.5],10:[.5,.25],152:[.5,.75],
        33:[.4,.42],133:[.46,.42],362:[.54,.42],263:[.6,.42],
        159:[.43,.40],145:[.43,.44],386:[.57,.40],374:[.57,.44],
        61:[.44,.62],291:[.56,.62],13:[.5,.61],14:[.5,.63],0:[.5,.60],17:[.5,.65],18:[.5,.68],
        1:[.5,.55],2:[.5,.57],107:[.44,.37],336:[.56,.37],70:[.38,.37],300:[.62,.37],
        117:[.38,.52],346:[.62,.52],203:[.47,.57],423:[.53,.57],127:[.35,.65],356:[.65,.65]};
    for(const [i,p] of Object.entries({...points,...changes})) lm[i]={x:p[0],y:p[1],z:0};
    return lm;
}
function calibrated(Type=Candidate){const a=new Type(); for(let i=0;i<18;i++) a.analyzeLandmarks(face()); return a;}
function expression(a,lm){let s; for(let i=0;i<6;i++) s=a.analyzeLandmarks(lm); return s;}
test('legacy unclipped diagnostics retain the default extractor output',()=>{
    const f=face(); const raw=extract(f), pre=extract(f,null,{unclipped:true});
    assert.ok(pre.AU1>1); assert.equal(raw.AU1,1);
    for(const [au,v] of Object.entries(pre)) assert.equal(raw[au],Math.max(0,Math.min(1,v)));
});
test('unchanged neutral and small point jitter do not cause candidate expressions',()=>{
    const a=calibrated();
    for(let i=0;i<30;i++){
        const s=a.analyzeLandmarks(face({107:[.44,.37+(i%2 ? .00001 : -.00001)]}));
        assert.equal(s.status,'success');assert.equal(s.dominant,'neutral');
        assert.ok(Object.values(s.actionUnits).every(v=>v===0));
    }
});
test('raised brows and eyes remain responsive when legacy features are saturated',()=>{
    const f=face({107:[.44,.34],336:[.56,.34],70:[.38,.34],300:[.62,.34],159:[.43,.39],386:[.57,.39]});
    const old=expression(calibrated(Legacy),f), next=expression(calibrated(),f);
    for(const au of ['AU1','AU2','AU5']) {assert.equal(old.actionUnits[au],0);assert.ok(next.actionUnits[au]>.3);}
    assert.ok(next.rawActionUnits.AU5>1);
});
test('brow contraction activates AU4 and anger without changing classifier thresholds',()=>{
    const s=expression(calibrated(),face({107:[.47,.38],336:[.53,.38]}));
    assert.ok(s.actionUnits.AU4>.2);assert.equal(s.dominant,'anger');
});
test('lip corners are separable from symmetric lip opening',()=>{
    const open=expression(calibrated(),face({13:[.5,.58],14:[.5,.66]}));
    assert.equal(open.actionUnits.AU15,0);
    const sad=expression(calibrated(),face({107:[.44,.34],336:[.56,.34],61:[.44,.64],291:[.56,.64]}));
    assert.ok(sad.actionUnits.AU15>.1); assert.equal(sad.dominant,'sadness');
});
test('surprise and smile synthetic movements can reach their categories',()=>{
    const surprise=expression(calibrated(),face({107:[.44,.34],336:[.56,.34],70:[.38,.34],300:[.62,.34],
        159:[.43,.38],386:[.57,.38],13:[.5,.57],14:[.5,.67],17:[.5,.71]}));
    assert.equal(surprise.dominant,'surprise');
    const smile=expression(calibrated(),face({61:[.35,.59],291:[.65,.59]}));
    assert.equal(smile.dominant,'happiness');assert.ok(smile.valence>0);
});
test('AU10 and AU17 signs respond to upward lip and upper-chin motion, not jaw tip',()=>{
    assert.ok(expression(calibrated(),face({0:[.5,.59]})).actionUnits.AU10>.2);
    assert.equal(expression(calibrated(),face({0:[.5,.61]})).actionUnits.AU10,0);
    assert.ok(expression(calibrated(),face({18:[.5,.67]})).actionUnits.AU17>.2);
    assert.equal(expression(calibrated(),face({18:[.5,.69]})).actionUnits.AU17,0);
    assert.equal(expression(calibrated(),face({152:[.5,.80]})).actionUnits.AU17,0);
});
test('new geometry is invariant to translation, uniform scale and roll in normalized coordinates',()=>{
    const original=measure(face());
    const angle=.2,c=Math.cos(angle),s=Math.sin(angle);
    const moved=face().map(p=>({x:.1+.8*(p.x*c-p.y*s),y:.1+.8*(p.x*s+p.y*c),z:0}));
    const actual=measure(moved);
    for(const key of Object.keys(original)) assert.ok(Math.abs(actual[key]-original[key])<1e-10,key);
});
test('invalid geometry does not advance calibration and resets preserve no candidate baseline',t=>{
    t.mock.method(console,'error',()=>{});
    const a=new Candidate(); const f=face(); f[18].y=NaN;
    assert.equal(a.analyzeLandmarks(f).status,'invalid_landmarks');
    assert.equal(a.getCalibrationDiagnostics().frames,0);
    const degenerate=face({133:[.4,.42]});
    assert.equal(a.analyzeLandmarks(degenerate).status,'analysis_error');
    assert.equal(a.getCalibrationDiagnostics().frames,0);
    for(let i=0;i<18;i++) a.analyzeLandmarks(face());
    a.clear(); assert.equal(a.getCalibrationDiagnostics().ready,false);
    assert.equal(a.featureGeometry,null);
});
test('v2 uses the same accepted neutral frames for two distinct fixed baselines', async () => {
    const { NeutralCalibration } = await import('../../participant-web/js/emotion/neutral-calibration.mjs');
    const policy = {minSamples:25, minDurationMs:5000, intervalMs:200, timeoutMs:30000};
    const collector = new NeutralCalibration(policy);
    const comparison = new Comparison();
    const legacy = new Legacy();
    legacy.startSession(null, { explicitNeutral:true, requiredNeutralFrames:25 });
    comparison.attachNeutralCalibration(collector);
    collector.begin(0);
    const add = (at, lm) => collector.add({timestamp:at, face:{detected:true}, landmarks:lm}, at);
    const invalid = face(); invalid[10] = invalid[152];
    add(0, invalid);
    for (let i = 1; i <= 24; i++) add(i*200, face());
    assert.equal(collector.samples.length, 24);
    assert.equal(comparison.candidate.getCalibrationDiagnostics().ready, false);
    add(5000, face());
    assert.equal(collector.status, 'ready');
    legacy.setNeutralBaseline(collector.baseline, 25);
    const before = comparison.candidate.getCalibrationDiagnostics();
    assert.equal(before.frames, 25);
    assert.equal(before.requiredFrames, 25);
    assert.ok(before.baseline.AU10 < 0);
    assert.ok(collector.baseline.AU10 >= 0);
    const lm = face();
    comparison.record(legacy.analyzeLandmarks(lm), legacy.getCalibrationDiagnostics(), lm);
    assert.equal(comparison.snapshot().paired.commonValid, 1);
    assert.equal(comparison.beginTrial('smile_closed_mouth'), true);
    assert.deepEqual(comparison.candidate.getCalibrationDiagnostics().baseline, before.baseline);
});

test('paired trial summaries count shared frames, missingness and interruptions without retaining landmarks',()=>{
    let now=0;const c=new Comparison(()=>now),old=new Legacy();
    const record=lm=>{const r=old.analyzeLandmarks(lm);c.record(r,old.getCalibrationDiagnostics(),lm);};
    assert.equal(c.beginTrial('neutral'),false);
    for(let i=0;i<18;i++){now+=300;record(face());}
    assert.equal(c.beginTrial('neutral'),true);
    for(let i=0;i<4;i++){now+=300;record(face());}
    now+=300; const broken=face();broken[61].x=NaN;record(broken);
    now+=5000;
    const snap=c.snapshot(),t=snap.trials[0];
    assert.equal(t.status,'completed');assert.equal(t.commonValid,4);
    assert.equal(t.baseline.valid,4);assert.equal(t.candidate.missing,1);
    assert.equal(t.candidateMatchFraction,1);assert.equal(t.candidate.meanAU.AU4,0);
    assert.equal(snap.landmarks,undefined);assert.equal(snap.candidate.latest.geometry,null);
    const checkNoMesh=value=>{if(!value||typeof value!=='object') return;
        assert.ok(!('x' in value && 'y' in value)); assert.ok(!('landmarks' in value));
        Object.values(value).forEach(checkNoMesh);};
    checkNoMesh(snap);
    record(face());assert.equal(c.beginTrial('anger'),true);c.finishTrial();
    const interrupted=c.snapshot().trials[1];assert.equal(interrupted.status,'interrupted');
    assert.equal(interrupted.candidateMatchFraction,null);
    for (const expression of ['smile_closed_mouth', 'smile_open_mouth']) {
        assert.equal(c.beginTrial(expression), true);
        assert.equal(c.snapshot().trialActive.expression, expression);
        c.finishTrial();
        const trial = c.snapshot().trials.at(-1);
        assert.equal(trial.expression, expression);
        assert.equal(trial.expected, 'happiness');
    }
});

test('an expired trial with no common valid frames is saved as insufficient data', () => {
    let now = 0;
    const comparison = new Comparison(() => now);
    const legacy = calibrated(Legacy);
    const record = landmarks => comparison.record(
        legacy.analyzeLandmarks(landmarks), legacy.getCalibrationDiagnostics(), landmarks);
    for (let i = 0; i < 18; i++) record(face());
    assert.equal(comparison.beginTrial('neutral'), true);
    now += 5000;
    const [empty] = comparison.snapshot().trials;
    assert.equal(empty.attempts, 0);
    assert.equal(empty.commonValid, 0);
    assert.equal(empty.status, 'insufficient_data');
    assert.equal(empty.baselineMatchFraction, null);
    assert.equal(empty.candidateMatchFraction, null);

    record(face());
    assert.equal(comparison.beginTrial('neutral'), true);
    const broken = face();
    broken[61].x = NaN;
    record(broken);
    now += 5000;
    const [, missing] = comparison.snapshot().trials;
    assert.equal(missing.attempts, 1);
    assert.equal(missing.commonValid, 0);
    assert.equal(missing.status, 'insufficient_data');
});
