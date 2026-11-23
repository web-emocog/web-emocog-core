import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ContinuousBpmCollector } from '../../participant-web/js/session-runtime/continuous-bpm.js';
import { PhysiologyIntervals } from '../../participant-web/js/session-runtime/physiology-intervals.mjs';
import { RppgEngine } from '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/RppgEngine.js';
import { MotionRespirationEstimator } from '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/signal/respiration-motion.js';
import { SessionReporter } from '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/session/SessionReporter.js';

const require = createRequire(import.meta.url);
const { validatePhysiologyIntervals } = require('../security/physiology-intervals');
const epoch = 1800000000000;

function fixture(config = {}) {
    let output = { published: true, bpmPublished: 80, bpmSmoothed: 80, confidence: .9,
        features: { respRate: 12, respConf: .9, respPublished: true } };
    const engines = [];
    class Engine {
        constructor(cfg) { this.cfg = structuredClone(cfg); this.frames = []; engines.push(this); }
        update(input) { this.frames.push(input.timestampMs); return output; }
    }
    const collector = new ContinuousBpmCollector();
    const motion = { resets: 0, faces: [], shoulders: [],
        reset() { this.resets++; this.faces = []; this.shoulders = []; },
        pushFace(t) { this.faces.push(t); },
        pushShoulders(t) { this.shoulders.push(t); return true; },
        estimate() { return { published: true, rate: 12, conf: .9 }; } };
    Object.assign(collector, { ready: true, startedAt: epoch,
        engine: new Engine({ windowSec: 10, respiration: { windowSec: 20 }, ...config }),
        reporter: new SessionReporter({ maxSamples: 7200 }), context: {}, motionRespiration: motion });
    const landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .5 }));
    const pixels = { width: 10, height: 10 };
    const feed = t => collector.process(null, landmarks, t, pixels, epoch + t);
    const run = (start, end) => { let sample; for (let t = start; t <= end; t += 100) sample = feed(t); return sample; };
    return { collector, engines, motion, feed, run, setOutput(value) { output = value; } };
}

test('normal context leaves early publication, engine, statistics and reporter behavior unchanged', () => {
    const x = fixture();
    x.collector.setValidTimeContext(null);
    const sample = x.feed(0);
    assert.equal(sample.bpm, 80);
    assert.equal(sample.respRate, 12);
    x.collector.setValidTimeContext(null);
    x.feed(1000);
    assert.equal(x.engines.length, 1);
    assert.equal(x.motion.resets, 0);
    assert.equal(x.collector.snapshot().validSampleCount, 2);
    assert.equal(x.collector.reporter.finalize().samples.length, 2);
});

test('opt-in warmup suppresses eager engine outputs until full fresh windows per channel', () => {
    const x = fixture();
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 1000 });
    assert.equal(x.feed(999), null);
    assert.equal(x.feed(1000), null);
    x.run(1100, 10900);
    assert.equal(x.feed(10999), null);
    assert.equal(x.collector.sampleCount, 0);
    assert.equal(x.collector.reporter.finalize().samples.length, 0);
    const heartOnly = x.feed(11000);
    assert.equal(heartOnly.published, true);
    assert.equal(heartOnly.bpm, 80);
    assert.equal(heartOnly.respRate, null);
    assert.equal(heartOnly.respConf, 0);
    x.run(11100, 20900);
    assert.equal(x.feed(20999).respRate, null);
    assert.equal(x.collector.snapshot().validRespSampleCount, 0);
    const both = x.feed(21000);
    assert.equal(both.respRate, 12);
    assert.equal(x.collector.snapshot().validRespSampleCount, 1);
    assert.ok(x.collector.reporter.finalize().samples.slice(0, -1).every(row => row.resp_rate === null));
});

test('invalid QC excludes frames, shoulders, sample counts and reporter history; resume starts fresh', () => {
    const x = fixture();
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 0 });
    x.run(0, 20000);
    assert.equal(x.collector.recordShoulders(20000, {}, {}), true);
    const before = x.collector.snapshot(), reporterCount = x.collector.reporter.finalize().samples.length;
    x.collector.setValidTimeContext({ allowed: false, segmentStartMs: null });
    const resetCount = x.engines.length;
    assert.equal(x.collector.reporter._lastPublished, null);
    for (const t of [20100, 20500, 21000]) {
        x.collector.setValidTimeContext({ allowed: false, segmentStartMs: null });
        assert.equal(x.feed(t), null);
        assert.equal(x.collector.recordShoulders(t, {}, {}), false);
    }
    assert.equal(x.engines.length, resetCount);
    assert.equal(x.engines.at(-1).frames.length, 0);
    assert.equal(x.motion.faces.length, 0);
    assert.equal(x.motion.shoulders.length, 0);
    assert.equal(x.collector.lastSample, null);
    assert.equal(x.collector.sampleCount, before.sampleCount);
    assert.equal(x.collector.reporter.finalize().samples.length, reporterCount);
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 22000 });
    assert.equal(x.collector.recordShoulders(21000, {}, {}), false);
    x.run(22000, 31900);
    assert.equal(x.collector.sampleCount, before.sampleCount);
    assert.equal(x.feed(32000).bpm, 80);
    assert.equal(x.collector.respStats.n, before.validRespSampleCount);
    x.run(32100, 41900);
    assert.equal(x.feed(42000).respRate, 12);
    assert.equal(x.collector.respStats.n, before.validRespSampleCount + 1);
    assert.equal(x.collector.snapshot().bpmMean, 80);
    assert.equal(x.collector.snapshot().respRateMean, 12);
});

test('segment changes, camera gaps and opt-in exit reset once without clearing overall statistics', () => {
    const x = fixture();
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 0 });
    x.run(0, 20000);
    const before = x.collector.snapshot();
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 20000 });
    const count = x.engines.length;
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 20000 });
    assert.equal(x.engines.length, count);
    x.run(20100, 30000);
    assert.equal(x.collector.sampleCount, before.sampleCount);
    assert.equal(x.feed(30100).bpm, 80);
    assert.equal(x.feed(31000), null);
    assert.equal(x.engines.length, count + 1);
    assert.deepEqual(x.engines.at(-1).frames, [31000]);
    x.run(31100, 40900);
    assert.equal(x.feed(41000).bpm, 80);
    assert.equal(x.collector.respStats.n, before.validRespSampleCount);
    x.collector.setValidTimeContext(null);
    const exitCount = x.engines.length;
    x.collector.setValidTimeContext(null);
    assert.equal(x.engines.length, exitCount);
    assert.equal(x.feed(42000), null);
    x.run(42100, 51900);
    assert.equal(x.feed(52000).bpm, 80);
    assert.equal(x.collector.bpmStats.n, before.validSampleCount + 3);
});

test('warmup begins with actual accepted capture, not an old or malformed context timestamp', () => {
    const x = fixture();
    for (const segmentStartMs of [null, NaN, -1]) {
        x.collector.setValidTimeContext({ allowed: true, segmentStartMs });
        assert.equal(x.feed(100000), null);
    }
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 0 });
    x.run(100000, 109900);
    assert.equal(x.collector.sampleCount, 0);
    assert.equal(x.feed(110000).bpm, 80);
    assert.equal(x.feed(110000), null);
    assert.equal(x.feed(109000), null);
});

test('HR and RR gating are independent and never shorten configured windows', () => {
    const x = fixture({ windowSec: 30, respiration: { windowSec: 25 } });
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 0 });
    x.run(0, 24900);
    const respirationOnly = x.feed(25000);
    assert.equal(respirationOnly.bpm, null);
    assert.equal(respirationOnly.published, false);
    assert.equal(respirationOnly.respRate, 12);
    assert.equal(x.collector.bpmStats.n, 0);
    assert.equal(x.collector.reporter.finalize().samples[0].bpm_smoothed, null);
    x.run(25100, 29900);
    assert.equal(x.feed(30000).bpm, 80);
});

test('real engine reset preserves settings and clears ROI, motion, smoothing and publication state', () => {
    const x = fixture();
    const engine = new RppgEngine({ algorithm: 'chrom', windowSec: 12, respiration: { windowSec: 23 },
        bpmSmoothing: { historySize: 9 }, sampleStep: 5 });
    engine._bpmSeries.push({ tMs: 1000, x: 99 });
    engine._bpmHist.push(99);
    engine.state.forehead.rgb.push({ tMs: 1000, r: 1, g: 2, b: 3 });
    x.collector.engine = engine;
    x.collector.motionRespiration = new MotionRespirationEstimator({ windowSec: 24 });
    x.collector.motionRespiration._push('bridge', 1000, 1);
    x.collector.publicationGate.evaluate({ published: true, bpmPublished: 135, confidence: .9 });
    x.collector.setValidTimeContext({ allowed: false, segmentStartMs: null });
    assert.notEqual(x.collector.engine, engine);
    assert.deepEqual(x.collector.engine.cfg, engine.cfg);
    assert.equal(x.collector.engine.algorithm, 'chrom');
    assert.deepEqual(x.collector.engine._bpmSeries, []);
    assert.deepEqual(x.collector.engine._bpmHist, []);
    assert.deepEqual(x.collector.engine.state.forehead.rgb, []);
    assert.deepEqual(x.collector.motionRespiration.series.bridge, []);
    assert.equal(x.collector.motionRespiration.cfg.windowSec, 24);
    assert.deepEqual(x.collector.publicationGate.cautionValues, []);
});

test('publication confirmations and reporter hold cannot cross excluded segments', () => {
    const x = fixture();
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 0 });
    x.run(0, 10000);
    x.setOutput({ published: true, bpmPublished: 135, bpmSmoothed: 135, confidence: .9 });
    x.run(10100, 10700);
    assert.equal(x.collector.publicationGate.cautionValues.length, 7);
    x.collector.setValidTimeContext({ allowed: false, segmentStartMs: null });
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 11000 });
    x.run(11000, 20900);
    const first = x.feed(21000);
    assert.equal(first.published, false);
    assert.equal(x.collector.publicationGate.cautionValues.length, 1);
    assert.equal(x.collector.reporter.finalize().samples.at(-1).bpm_hold, null);
    const result = x.collector.finalize();
    x.collector.setValidTimeContext(null);
    assert.equal(x.feed(22000), null);
    assert.equal(result.bpmMean, 80);
    assert.equal(result.rppgSession.range_bpm.published.count, 1);
});

test('processing failures restart fresh capture without changing accepted statistics', () => {
    const x = fixture();
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 0 });
    x.run(0, 20000);
    const before = x.collector.snapshot(), engineCount = x.engines.length;
    x.engines.at(-1).update = () => { throw new Error('synthetic_processing_failure'); };
    assert.equal(x.feed(20100), null);
    assert.equal(x.engines.length, engineCount + 1);
    x.run(20200, 30100);
    assert.equal(x.collector.sampleCount, before.sampleCount);
    assert.equal(x.feed(30200).bpm, 80);
    assert.equal(x.collector.respStats.n, before.validRespSampleCount);
});

test('an unavailable engine reset fails closed rather than reusing contaminated state', () => {
    const x = fixture(), failures = [];
    x.collector.onError = error => failures.push(error.message);
    const previous = x.collector.engine;
    x.collector.engine = { cfg: previous.cfg, update: input => previous.update(input) };
    x.collector.setValidTimeContext({ allowed: true, segmentStartMs: 0 });
    assert.equal(x.collector.ready, false);
    assert.equal(x.collector.engine, null);
    assert.equal(x.feed(10000), null);
    assert.equal(x.collector.sampleCount, 0);
    assert.deepEqual(failures, ['physiology_engine_reset_unavailable']);
});

test('interval exclusion ignores even published samples and never bridges excluded time after recovery', () => {
    const x = new PhysiologyIntervals();
    x.beginBlock({ blockId: 'passive', attempt: 1 }, 0);
    const sample = { bpm: 80, published: true, respRate: 12, respConf: .9 };
    x.record(20000, sample, 10000, 20000);
    x.record(20100, sample, 10000, 20000);
    x.record(20200, { ...sample, bpm: 150, respRate: 23 }, 10000, 20000, 250, false);
    x.record(20300, sample, 10000, 20000);
    x.record(20400, sample, 10000, 20000);
    const saved = x.snapshot(20500);
    assert.equal(saved.minutes[0].heartRate.count, 4);
    assert.equal(saved.minutes[0].heartRate.mean, 80);
    assert.equal(saved.minutes[0].heartRate.observedMs, 200);
    assert.equal(saved.blocks[0].respiration.mean, 12);
    assert.equal(saved.blocks[0].respiration.observedMs, 200);
    assert.deepEqual(validatePhysiologyIntervals(saved), []);
    const restored = new PhysiologyIntervals(JSON.parse(JSON.stringify(saved)));
    restored.record(21000, sample, 10000, 20000);
    assert.equal(restored.snapshot().minutes[0].heartRate.observedMs, 200);
});
