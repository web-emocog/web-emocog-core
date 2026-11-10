import { EmotionDiagnostics } from './emotion-diagnostics.mjs';
import { GeometryEmotionAnalyzer, GEOMETRY_METHOD } from './emotion-geometry-new-variant.mjs';

const labels=['neutral','happiness','sadness','anger','fear','surprise','disgust'];
export const expressionNames = new Map([
    ['neutral', 'Нейтральное лицо'],
    ['smile_closed_mouth', 'Улыбка (закрытый рот)'],
    ['smile_open_mouth', 'Улыбка (открытый рот)'],
    ['anger', 'Злость'],
    ['sadness', 'Грусть'],
    ['surprise', 'Удивление'],
    ['fear', 'Страх'],
    ['disgust', 'Отвращение'],
]);
const counts=()=>Object.fromEntries(labels.map(label=>[label,0]));
const aggregate=()=>({valid:0,missing:0,dominantCounts:counts(),auSum:{},auMin:{},auMax:{}});
const successful=s=>s?.status==='success'&&!s.degraded;

// No second camera/model loop: candidate consumes the same transient landmarks.
export class EmotionComparison extends EmotionDiagnostics {
    constructor(now=()=>performance.now()) {
        super(now);
        this.candidate=new GeometryEmotionAnalyzer();
        this.candidateDiagnostics=new EmotionDiagnostics(now);
        this.paired={attempts:0,commonValid:0,dominantAgreement:0,candidateMsTotal:0,candidateMsMax:0};
        this.trials=[];
        this.activeTrial=null;
    }

    record(sample, calibration, landmarks) {
        super.record(sample,calibration);
        const start=this.now();
        const candidate=landmarks == null ? {status:'missing_landmarks',degraded:true}
            : this.candidate.analyzeLandmarks(landmarks);
        const elapsed=this.now()-start;
        this.candidateDiagnostics.record(candidate,this.candidate.getCalibrationDiagnostics());
        this.paired.attempts++;
        this.paired.candidateMsTotal+=elapsed;
        this.paired.candidateMsMax=Math.max(this.paired.candidateMsMax,elapsed);
        if(successful(sample)&&successful(candidate)) {
            this.paired.commonValid++;
            if(sample.dominant===candidate.dominant) this.paired.dominantAgreement++;
        }
        this._finishExpired();
        if(this.activeTrial) {
            this.activeTrial.attempts++;
            for(const [key,value] of [['baseline',sample],['candidate',candidate]]) {
                const a=this.activeTrial[key];
                if(!successful(value)) { a.missing++; continue; }
                a.valid++; a.dominantCounts[value.dominant]++;
                for(const [au,v] of Object.entries(value.actionUnits)) {
                    a.auSum[au]=(a.auSum[au]??0)+v;
                    a.auMin[au]=Math.min(a.auMin[au]??Infinity,v);
                    a.auMax[au]=Math.max(a.auMax[au]??-Infinity,v);
                }
            }
            if(successful(sample)&&successful(candidate)) {
                const t=this.activeTrial;
                t.commonValid++;
                if(sample.dominant===t.expected) t.baselineMatches++;
                if(candidate.dominant===t.expected) t.candidateMatches++;
            }
        }
    }

    beginTrial(expression) {
        const expected = expression === 'smile_closed_mouth' || expression === 'smile_open_mouth'
            ? 'happiness' : expression;
        this._finishExpired();
        if(!labels.includes(expected)||this.activeTrial||this.trials.length>=30
            ||!this.latest?.calibration?.ready||!this.candidateDiagnostics.latest?.calibration?.ready
            ||this.latest?.status!=='success'||this.candidateDiagnostics.latest?.status!=='success'
            ||this.lastAt==null||this.now()-this.lastAt>1000) return false;
        this.activeTrial={expression,expected,startedAtMs:this.now(),durationMs:5000,attempts:0,
            commonValid:0,baselineMatches:0,candidateMatches:0,baseline:aggregate(),candidate:aggregate()};
        return true;
    }

    _finishExpired() {
        if(this.activeTrial && this.now()-this.activeTrial.startedAtMs>=this.activeTrial.durationMs) {
            this.finishTrial('completed');
        }
    }

    finishTrial(status='interrupted') {
        if(!this.activeTrial) return;
        const t=this.activeTrial;
        this.activeTrial=null;
        t.elapsedMs=this.now()-t.startedAtMs;
        delete t.startedAtMs;
        t.status=status;
        t.baselineMatchFraction=t.commonValid ? t.baselineMatches/t.commonValid : null;
        t.candidateMatchFraction=t.commonValid ? t.candidateMatches/t.commonValid : null;
        t.baselineFalsePositiveFraction=t.expected==='neutral'&&t.commonValid ? 1-t.baselineMatchFraction : null;
        t.candidateFalsePositiveFraction=t.expected==='neutral'&&t.commonValid ? 1-t.candidateMatchFraction : null;
        for(const key of ['baseline','candidate']) {
            const a=t[key];
            a.meanAU=a.valid ? Object.fromEntries(Object.entries(a.auSum).map(([au,v])=>[au,v/a.valid])) : null;
            delete a.auSum;
        }
        this.trials.push(t);
    }

    snapshot() {
        this._finishExpired();
        return {...super.snapshot(),schema:'emotion_comparison.v1',
            baselineMethod:'legacy_clipped_au.v1',candidateMethod:GEOMETRY_METHOD,
            candidate:this.candidateDiagnostics.snapshot(),paired:{...this.paired},
            trialActive:this.activeTrial ? {expression:this.activeTrial.expression,expected:this.activeTrial.expected,
                remainingMs:Math.max(0,this.activeTrial.durationMs-(this.now()-this.activeTrial.startedAtMs))} : null,
            trials:structuredClone(this.trials)};
    }
}
