import { SessionCheckpointStore } from '../../apps/participant-web/js/session-runtime/checkpoint-store.mjs';
import { newScenario, stepScenario, recoveryBoundary, finishScenario, runSyntheticScenario, clone } from './physiology-fixtures.mjs';
const equal = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('physiology_checkpoint_mismatch'); };
const remove = name => new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(name); r.onsuccess = resolve; r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('isolated_database_cleanup_blocked'));
});
const state = (id, data) => ({ ids: { session: id }, physiologyIntervals: data,
    events: [], cognitiveResults: [{ trialId: 'accepted-before-interruption', qualityValid: true, rt: 420 }],
    lifecycle: { state: 'running', status: 'in_progress' } });

export async function runPhysiologyBrowser(minutes) {
    const name = 'physiology-audit-' + crypto.randomUUID(), id = 'synthetic-' + minutes;
    let store = new SessionCheckpointStore({ databaseName: name, sessionStorage: null });
    const started = performance.now(), run = newScenario(minutes);
    let recovered = false, saves = 0, maxSaveMs = 0;
    const startUsage = await navigator.storage?.estimate?.();
    try {
        while (run.nextFrame < run.frameCount) {
            const t = stepScenario(run, run.nextFrame);
            if (run.nextFrame % 900 === 0 || (!recovered && run.nextFrame >= run.frameCount / 2 + 450)) {
                const data = state(id, run.accumulator.snapshot(t));
                const at = performance.now();
                await store.save(id, data, { state: 'running' }); saves++;
                maxSaveMs = Math.max(maxSaveMs, performance.now() - at);
                if (store.lastPersistenceMode !== 'indexeddb') throw new Error('durable_storage_not_exercised');
                if (!recovered && run.nextFrame >= run.frameCount / 2 + 450) {
                    store = new SessionCheckpointStore({ databaseName: name, sessionStorage: null });
                    const saved = await store.load(id);
                    equal(saved.sessionData.physiologyIntervals, data.physiologyIntervals);
                    equal(saved.sessionData.cognitiveResults, data.cognitiveResults);
                    recoveryBoundary(run, saved.sessionData.physiologyIntervals);
                    recovered = true;
                }
            }
        }
        const data = state(id, finishScenario(run));
        data.pendingFinalUpload = { finishAttemptId: 'synthetic-stable-key', payload: {
            ids: { session: id }, physiology_intervals: data.physiologyIntervals,
            delivery: { kind: 'final', sequence: 5 } } };
        await store.save(id, data, { state: 'completed' }); saves++;
        store = new SessionCheckpointStore({ databaseName: name, sessionStorage: null });
        const restored = await store.load(id);
        equal(restored.sessionData.physiologyIntervals, data.physiologyIntervals);
        equal(restored.sessionData.pendingFinalUpload, data.pendingFinalUpload);
        equal(data.physiologyIntervals, runSyntheticScenario(minutes));
        const endUsage = await navigator.storage?.estimate?.();
        return { minutes, frames: run.frameCount, saves, wallMs: performance.now() - started, maxSaveMs,
            reloadReconstructionExact: true, offlineFinalIdentityExact: true, baselineParity: true,
            intervalBytes: new TextEncoder().encode(JSON.stringify(data.physiologyIntervals)).length,
            retainedMinutes: data.physiologyIntervals.minutes.length, retainedAttempts: data.physiologyIntervals.blocks.length,
            storageUsageDeltaBytes: startUsage && endUsage ? endUsage.usage - startUsage.usage : null };
    } finally { await remove(name); }
}

export async function physiologyFaults() {
    const name = 'physiology-faults-' + crypto.randomUUID(), id = 'synthetic-faults';
    const store = new SessionCheckpointStore({ databaseName: name, sessionStorage: null });
    const run = newScenario(40);
    for (let i = 0; i < 1000; i++) stepScenario(run, i);
    const data = state(id, run.accumulator.snapshot(33333));
    try {
        await store.save(id, data, { state: 'running' });
        const stale = new SessionCheckpointStore({ databaseName: name, sessionStorage: null });
        await stale.load(id);
        const newer = clone(data); newer.events.push({ eventId: 'newer-save', timestamp: 33334 });
        await store.save(id, newer, { state: 'running' });
        let rejected = false;
        try { await stale.save(id, data, {}); } catch (e) { rejected = e.name === 'CheckpointConflictError'; }
        if (!rejected) throw new Error('stale_writer_overwrote_intervals');
        let abortNext = true;
        const factory = { open(...args) {
            const request = indexedDB.open(...args);
            request.addEventListener('success', () => {
                const db = request.result, original = db.transaction.bind(db);
                db.transaction = (...params) => {
                    const tx = original(...params);
                    if (params[1] === 'readwrite' && abortNext) { abortNext = false; queueMicrotask(() => tx.abort()); }
                    return tx;
                };
            });
            return request;
        } };
        const aborted = new SessionCheckpointStore({ databaseName: name, indexedDB: factory, sessionStorage: null });
        await aborted.load(id);
        const mutated = clone(newer); mutated.physiologyIntervals.minutes[0].heartRate.mean = 95;
        let failed = false;
        try { await aborted.save(id, mutated, {}); } catch (_) { failed = true; }
        if (!failed) throw new Error('injected_abort_did_not_fail');
        equal((await store.load(id)).sessionData.physiologyIntervals, newer.physiologyIntervals);
        await aborted.save(id, newer, {});
        equal((await store.load(id)).sessionData, (await aborted.load(id)).sessionData);
        const memory = new Map();
        const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
        const compact = new SessionCheckpointStore({ indexedDB: null, sessionStorage: storage });
        await compact.save(id, newer, {});
        const compactReload = new SessionCheckpointStore({ indexedDB: null, sessionStorage: storage });
        equal((await compactReload.load(id)).sessionData.physiologyIntervals, newer.physiologyIntervals);
        return { staleWriterRejected: true, abortedTransactionRolledBack: true, retryExact: true,
            compactFallbackPreservesIntervals: true, method: 'injected_storage_failure_not_actual_disk_exhaustion' };
    } finally { await remove(name); }
}
