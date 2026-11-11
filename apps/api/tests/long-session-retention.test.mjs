import test from 'node:test';
import assert from 'node:assert/strict';
import { planSeries, restoreSeries } from '../../participant-web/js/session-runtime/long-session-retention.mjs';
import { LongSessionContinuity } from '../../participant-web/js/session-runtime/long-session-continuity.mjs';
import { SessionCheckpointStore } from '../../participant-web/js/session-runtime/checkpoint-store.mjs';
import { CheckpointBuilder } from '../../participant-web/js/session-runtime/checkpoint-builder.mjs';
import { assertFinalPayloadLimits, assertSessionSourceLimits } from '../../participant-web/js/session-runtime/long-session-build-limits.mjs';

for (const minutes of [40, 125]) test(`${minutes} minutes of 30 Hz immutable samples have linear writes and exact retained clocks`, () => {
    let previous, chunks = [], id = 0, written = 0;
    const samples = [], cap = 32000, epoch = 1800000000000;
    for (let frame = 0; frame < minutes * 60 * 30; frame++) {
        samples.push({ t: epoch + frame * 1000 / 30, monotonicMs: frame * 1000 / 30,
            x: frame % 1920, valid: frame % 17 !== 0 });
        if (samples.length > cap) samples.splice(0, 2001);
        if ((frame + 1) % 150 !== 0) continue;
        const plan = planSeries(samples, previous);
        chunks = chunks.filter(chunk => !plan.reset && chunk.to > plan.from);
        for (const chunk of plan.chunks) {
            written += chunk.samples.length;
            chunks.push({ ...chunk, sampleType: 'eyeTracking', id: ++id });
        }
        delete plan.chunks;
        previous = plan;
    }
    assert.equal(written, minutes * 60 * 30);
    assert.deepEqual(restoreSeries(chunks, previous, 'eyeTracking'), samples);
    assert.ok(chunks.length <= Math.ceil(cap / 150) + 1);
    assert.equal(previous.retention.sourceWindowEvictedCount + samples.length, written);
});

test('strict manifests reject count-matching holes, overlap, duplicates and unknown boundaries', () => {
    const chunk = { from: 0, to: 2, samples: [{ t: 1 }, { t: 2 }], sampleType: 'events' };
    assert.throws(() => restoreSeries([{ ...chunk, from: 1, to: 3 }], { from: 0, to: 2 }, 'events'), /incomplete/);
    assert.throws(() => restoreSeries([chunk, chunk], { from: 0, to: 2 }, 'events'), /overlapping/);
    assert.throws(() => restoreSeries([], { from: -1, to: 0 }, 'events'), /Invalid/);
});

test('nonoverlap rebase is explicit and empty-to-appended series is not a false reset', () => {
    const empty = planSeries([]);
    const first = planSeries([{ t: 1 }], empty);
    assert.equal(first.reset, false);
    const next = planSeries([{ t: 100 }], first);
    assert.equal(next.retention.rebaseCount, 1);
    assert.equal(next.retention.sourceWindowEvictedCount, 1);
    assert.equal(next.retention.lastReason, 'source_replaced_or_nonoverlapping_window');
});

test('background and sleep keep original timestamps and never infer valid capture coverage', () => {
    const clock = new LongSessionContinuity(null, 1000);
    clock.visibility(true, 2000);
    clock.tick(90000);
    const gap = clock.visibility(false, 120000);
    assert.equal(gap.durationMs, 118000);
    assert.equal(gap.sampleCoverage, 'not_inferred');
    assert.equal(clock.tick(125000), null);
    assert.equal(clock.tick(360000).durationMs, 235000);
    assert.equal(clock.snapshot.schedulerGapCount, 1);
    const restored = new LongSessionContinuity(clock.snapshot, 400000);
    assert.equal(restored.snapshot.knownBackgroundMs, 118000);
});

test('memory cache is bounded; no IndexedDB fallback claims durability', async () => {
    const store = new SessionCheckpointStore({ indexedDB: null, sessionStorage: null });
    for (let id = 0; id < 2; id++) await store.save(String(id), { ids: { session: String(id) }, eyeSignals: [{ t: id }] }, {});
    assert.equal(store.lastPersistenceMode, 'memory');
    await assert.rejects(store.save('2', {}, {}), /capacity reached/);
    assert.equal(store.memory.size, 2);
    assert.equal(store.lastPersistenceMode, null);
    const restored = await store.load('1');
    assert.equal(restored.sessionData.eyeSignals[0].t, 1);
});

test('compact recovery records exact omitted bounds but retains audit, aggregates and final payload verbatim', async () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const store = new SessionCheckpointStore({ indexedDB: null, sessionStorage: storage });
    const payload = { ids: { session: 'offline' }, lifecycle: { finishAttemptId: 'stable-key' },
        delivery: { kind: 'final', sequence: 8 }, startTime: 123456 };
    const data = { ids: payload.ids, pendingFinalUpload: { finishAttemptId: 'stable-key', payload },
        eyeSignals: [{ t: 123456 }, { t: 888888 }], cognitiveResults: [{ qualityValid: true, rt: 420 }],
        heatmapState: { counts: 999 }, emotionAccumulator: { n: 55 }, events: [{ timestamp: 999 }] };
    await store.save('offline', data, { state: 'completed' });
    const restored = await new SessionCheckpointStore({ indexedDB: null, sessionStorage: storage }).load('offline');
    assert.deepEqual(restored.sessionData.pendingFinalUpload.payload, payload);
    assert.deepEqual(restored.sessionData.heatmapState, data.heatmapState);
    assert.deepEqual(restored.sessionData.events, data.events);
    assert.deepEqual(restored.sessionData.cognitiveResults, data.cognitiveResults);
    assert.deepEqual(restored.sessionData.storageRecovery.omittedSeries.eyeSignals,
        { count: 2, firstTimestamp: 123456, lastTimestamp: 888888 });
    assert.equal(restored.sessionData.storageRecovery.signalSeriesIncomplete, true);
});

test('worker clone budget fails explicitly, without trimming source samples or results', async () => {
    const data = { ids: { session: 'large' }, eyeSignals: [{ t: 1 }, { t: 2 }], cognitiveResults: [{ rt: 9 }] };
    await assert.rejects(new CheckpointBuilder({ maxSourceSamples: 1 }).build(data), /resource_limit/);
    assert.equal(data.eyeSignals.length, 2);
    assert.equal(data.cognitiveResults.length, 1);
});

test('final resource guards reject oversized accepted results/bytes without deleting data', () => {
    const results = Array.from({ length: 5001 }, (_, i) => ({ trialId: i, qualityValid: true }));
    assert.throws(() => assertSessionSourceLimits({ cognitiveResults: results }), /cognitive_result_limit/);
    assert.throws(() => assertFinalPayloadLimits({ cognitiveResults: results }), /payload_item_limit/);
    const packet = { cognitiveResults: results.slice(0, 5000), metadata: 'x'.repeat(2048) };
    assert.throws(() => assertFinalPayloadLimits(packet, 1024), /payload_byte_limit/);
    assert.equal(packet.cognitiveResults.length, 5000);
    assert.equal(results.length, 5001);
});

test('competing compact writers and clear must load the latest backup first', async () => {
    const values = new Map();
    const sessionStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const store = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    const other = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    const data = { ids: { session: 'same' }, cognitiveResults: [{ rt: 1 }] };
    await store.save('same', data, {});
    await other.load('same');
    data.cognitiveResults.push({ rt: 2 });
    await store.save('same', data, {});
    await assert.rejects(other.save('same', data, {}), { name: 'CheckpointConflictError' });
    await assert.rejects(other.clear('same'), { name: 'CheckpointConflictError' });
    assert.equal((await store.load('same')).sessionData.cognitiveResults.length, 2);
});

test('background technical issue invalidates only the active attempt; accepted attempts survive snapshots', async () => {
    const { SessionStateMachine } = await import('../../participant-web/js/session-runtime/session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start(); machine.enterInstruction();
    machine.beginBlock({ blockId: 'accepted', blockType: 'cognitive' });
    const accepted = machine.completeBlock({ success: true }).block;
    machine.enterInstruction();
    machine.beginBlock({ blockId: 'interrupted', blockType: 'cognitive' });
    machine.reportIssue({ kind: 'technical', code: 'page_backgrounded', invalidatesBlock: true, recoverable: true });
    machine.resolveIssue('page_backgrounded');
    assert.equal(machine.currentBlock.invalid, true);
    const decision = machine.completeBlock({ success: true });
    assert.equal(decision.repeatRequired, true);
    const restored = new SessionStateMachine();
    restored.restore(machine.snapshot());
    assert.equal(accepted.invalid, false);
    assert.equal(restored.blockAttempts.get('accepted'), 1);
    assert.deepEqual(restored.repeatQueue.map(row => row.blockId), ['interrupted']);
});
