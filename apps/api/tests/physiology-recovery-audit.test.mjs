import test from 'node:test';
import assert from 'node:assert/strict';
import { PhysiologyIntervals } from '../../participant-web/js/session-runtime/physiology-intervals.mjs';
import { ContinuousBpmCollector } from '../../participant-web/js/session-runtime/continuous-bpm.js';
import { runSyntheticScenario } from '../../../scripts/long-session/physiology-fixtures.mjs';
import { createRequire } from 'node:module';
const { validatePhysiologyIntervals } = createRequire(import.meta.url)('../security/physiology-intervals.js');
const fresh = { bpm: 82, published: true, respRate: 14, respConf: .8, respPublished: true };
const clone = value => JSON.parse(JSON.stringify(value));

function collector() {
    let output;
    const c = new ContinuousBpmCollector();
    Object.assign(c, { ready: true, canvas: {}, context: {}, engine: { update: () => output } });
    return { c, frame: (t, value) => {
        output = value;
        return c.process(null, Array.from({ length: 478 }, () => ({ x: .5, y: .5 })), t,
            { width: 2, height: 2, data: new Uint8ClampedArray(16) }, 1800000000000 + t);
    } };
}

test('intervals reject held, rejected and low-confidence respiration even if a plausible number survives', () => {
    for (const invalid of [{ respHeld: true }, { respPublished: false }, { respConf: .19 }, { respConf: null }]) {
        const x = new PhysiologyIntervals();
        x.record(0, fresh, 0, 0); x.record(100, { ...fresh, ...invalid }, 0, 0);
        x.record(200, fresh, 0, 0);
        assert.deepEqual(x.snapshot().minutes[0].respiration, { mean: 14, count: 2, observedMs: 0 });
    }
});

for (const minutes of [40, 125]) test(`${minutes} minute physiology ledger survives JSON reload without duplicate minutes or attempts`, () => {
    const baseline = runSyntheticScenario(minutes), restored = runSyntheticScenario(minutes, true);
    assert.deepEqual(restored, baseline);
    assert.equal(restored.minutes.length, minutes);
    assert.deepEqual(validatePhysiologyIntervals(restored), []);
    assert.equal(restored.blocks.filter(b => b.status === 'interrupted').length, 1);
    const ids = restored.blocks.map(b => b.blockId + ':' + b.attempt);
    assert.equal(new Set(ids).size, ids.length);
    for (const row of restored.minutes) {
        assert.ok(row.heartRate.observedMs < 60000);
        assert.ok(row.respiration.observedMs < 60000);
    }
});

test('independent hand-calculated channel totals exclude the entire unknown span, not just excess gap time', () => {
    const x = new PhysiologyIntervals();
    for (const t of [0, 100, 200, 5000, 5100]) x.record(t, fresh, 0, 0);
    x.record(5200, { bpm: 82, published: false, held: true, respRate: 14, respHeld: true }, 0, 0);
    for (const t of [5300, 5400]) x.record(t, fresh, 0, 0);
    assert.deepEqual(x.snapshot(5500).minutes[0].heartRate, { mean: 82, count: 7, observedMs: 400 });
    assert.deepEqual(x.snapshot(5500).minutes[0].respiration, { mean: 14, count: 7, observedMs: 400 });
});

test('duplicate start delivery is idempotent and an invalid old attempt cannot interrupt a live block', () => {
    const x = new PhysiologyIntervals();
    x.beginBlock({ blockId: 'rt', attempt: 1 }, 0);
    x.record(100, fresh, 0, 0);
    x.beginBlock({ blockId: 'rt', attempt: 1 }, 150);
    x.record(200, fresh, 0, 0);
    x.endBlock('repeat_required', 250);
    x.beginBlock({ blockId: 'rt', attempt: 2 }, 300);
    x.beginBlock({ blockId: 'rt', attempt: 1 }, 350);
    x.record(400, fresh, 0, 0); x.record(500, fresh, 0, 0);
    x.endBlock('accepted', 600);
    const packet = x.snapshot();
    assert.deepEqual(packet.blocks.map(b => [b.attempt, b.status, b.heartRate.count, b.heartRate.observedMs]),
        [[1, 'repeat_required', 2, 100], [2, 'accepted', 2, 100]]);
    assert.deepEqual(validatePhysiologyIntervals(packet), []);
});

test('reload at a minute edge rejects replayed PTS and keeps an interrupted attempt separate', () => {
    const x = new PhysiologyIntervals();
    x.beginBlock({ blockId: 'rest', attempt: 1 }, 59000);
    x.record(59900, fresh, 0, 0); x.record(60000, fresh, 0, 0);
    const saved = clone(x.snapshot(60000));
    const resumed = new PhysiologyIntervals(saved);
    resumed.record(60000, fresh, 0, 0); // replay of the durable last estimate
    resumed.beginBlock({ blockId: 'rest', attempt: 2 }, 90000);
    resumed.record(90000, fresh, 0, 0); resumed.record(90100, fresh, 0, 0);
    resumed.endBlock('accepted', 90200);
    const packet = resumed.snapshot();
    assert.deepEqual(packet.minutes.map(r => [r.heartRate.count, r.heartRate.observedMs]), [[1, 100], [3, 100]]);
    assert.deepEqual(packet.blocks.map(b => [b.attempt, b.status]), [[1, 'interrupted'], [2, 'accepted']]);
    assert.deepEqual(validatePhysiologyIntervals(packet), []);
    assert.deepEqual(new PhysiologyIntervals(clone(packet)).snapshot(), packet);
});

test('malformed recovery does not silently repair overlapping blocks or counterfeit coverage', () => {
    const x = new PhysiologyIntervals();
    x.beginBlock({ blockId: 'a', attempt: 1 }, 0); x.record(0, fresh, 0, 0);
    x.record(100, fresh, 0, 0); x.endBlock('accepted', 200);
    const saved = clone(x.snapshot());
    for (const corrupt of [p => { p.minutes[0].heartRate.observedMs = 201; },
        p => { p.blocks.push({ ...p.blocks[0], attempt: 2 }); },
        p => { p.blocks[0].attempt = 0; }, p => { p.minutes[0].startMs = 1; },
        p => { p.minutes[0].respiration.count = 1.5; }]) {
        const invalid = clone(saved); corrupt(invalid);
        assert.throws(() => new PhysiologyIntervals(invalid), /Invalid physiology checkpoint/);
    }
});

test('confirmation cannot span a camera gap or a failed processing call', () => {
    const high = { published: true, bpmPublished: 135, confidence: .9 };
    for (const failure of ['gap', 'error']) {
        const { c, frame } = collector();
        for (let i = 0; i < 7; i++) assert.equal(frame(i * 100, high).published, false);
        if (failure === 'error') {
            c.engine.update = () => { throw new Error('injected'); };
            assert.equal(frame(700, high), null);
            c.engine.update = () => high;
        }
        assert.equal(frame(failure === 'gap' ? 10000 : 800, high).published, false);
    }
});

test('collector preserves rejected respiration as missing, and independent HR can still be fresh', () => {
    const { c, frame } = collector();
    const sample = frame(0, { published: true, bpmPublished: 82, confidence: .9,
        features: { respRate: 14, respConf: .9, respHeld: true, respPublished: false } });
    assert.equal(sample.published, true); assert.equal(sample.respRate, null);
    assert.equal(c.snapshot().validRespSampleCount, 0);
});
