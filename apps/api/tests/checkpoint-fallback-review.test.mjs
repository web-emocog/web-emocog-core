import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionCheckpointStore, CheckpointConflictError } from '../../participant-web/js/session-runtime/checkpoint-store.mjs';

const SNAPSHOTS = 'session-checkpoints';
const CHUNKS = 'session-sample-chunks';
const ACTIVE = 'wecog_active_session_id';
const BACKUP = 'wecog_session_backup:';
const SESSION = 'fallback-review';
const clone = value => structuredClone(value);
const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

// Only the checkpoint store's IDB surface: asynchronous requests and atomic commit/abort.
// Separate store instances share committed data, just as separate tabs would.
function fakeIndexedDb() {
    let tables = new Map([[SNAPSHOTS, new Map()], [CHUNKS, new Map()]]);
    let nextChunkId = 1, failWrite = false;
    const quotaError = () => Object.assign(new Error('Synthetic quota failure'), { name: 'QuotaExceededError' });
    function transaction(mode) {
        const staged = clone(tables), fail = mode === 'readwrite' && failWrite;
        if (mode === 'readwrite') failWrite = false;
        let pending = 0, ended = false;
        const tx = {
            abort() {
                if (ended) return;
                ended = true;
                queueMicrotask(() => tx.onabort?.());
            },
            objectStore(name) {
                const table = staged.get(name);
                assert.ok(table, name);
                const selected = (index, key) => [...table.entries()].filter(([, row]) => index === 'sessionType'
                    ? row.sessionId === key[0] && row.sampleType === key[1] : row.sessionId === key);
                return {
                    get: key => request(() => clone(table.get(key))),
                    put: value => request(() => { table.set(value.sessionId, clone(value)); }),
                    add: value => request(() => {
                        const id = nextChunkId++;
                        table.set(id, { ...clone(value), id });
                    }),
                    delete: key => request(() => { table.delete(key); }),
                    index(index) {
                        return {
                            getAll: key => request(() => selected(index, key).map(([, row]) => clone(row))),
                            openCursor(key) {
                                const rows = selected(index, key);
                                let position = 0;
                                const cursorRequest = {};
                                const advance = () => request(() => {
                                    const row = rows[position++];
                                    return row ? { value: clone(row[1]), continue: advance,
                                        delete: () => request(() => { table.delete(row[0]); }) } : null;
                                }, cursorRequest);
                                return advance();
                            }
                        };
                    }
                };
            }
        };
        function finish() {
            setImmediate(() => {
                if (ended || pending) return;
                if (fail) { tx.error = quotaError(); tx.abort(); return; }
                ended = true;
                if (mode === 'readwrite') tables = staged;
                tx.oncomplete?.();
            });
        }
        function request(read, result = {}) {
            pending++;
            queueMicrotask(() => {
                try {
                    if (!ended) { result.result = read(); result.onsuccess?.(); }
                } catch (error) { tx.error = error; tx.abort(); }
                finally { pending--; finish(); }
            });
            return result;
        }
        finish();
        return tx;
    }
    return {
        open() {
            const request = {};
            queueMicrotask(() => {
                request.result = { close() {}, transaction: (_names, mode) => transaction(mode) };
                request.onsuccess();
            });
            return request;
        },
        failNextWrite() { failWrite = true; },
        snapshot: id => clone(tables.get(SNAPSHOTS).get(id)),
        chunks: id => clone([...tables.get(CHUNKS).values()].filter(row => row.sessionId === id))
    };
}

function source() {
    return { ids: { session: SESSION }, eyeSignals: [{ t: 1000 }, { t: 2000 }],
        eyeTracking: [{ t: 1200 }], cognitiveResults: [{ trialId: 'accepted', qualityValid: true, rt: 250 }],
        events: [{ type: 'accepted', timestamp: 2000 }], heatmapState: { count: 2 } };
}

async function primaryFallback() {
    const indexedDB = fakeIndexedDb(), sessionStorage = storage();
    const store = new SessionCheckpointStore({ indexedDB, sessionStorage });
    const data = source();
    for (let revision = 1; revision <= 7; revision++) {
        await store.save(SESSION, data, { state: 'instruction' });
        assert.equal(indexedDB.snapshot(SESSION).revision, revision);
    }
    data.cognitiveResults.push({ trialId: 'later-accepted', qualityValid: true, rt: 350 });
    indexedDB.failNextWrite();
    await store.save(SESSION, data, { state: 'completed' });
    assert.equal(store.lastPersistenceMode, 'session_storage_compact');
    assert.equal(indexedDB.snapshot(SESSION).revision, 7);
    return { indexedDB, sessionStorage, store, data };
}

test('compact save -> reload -> save preserves original missingness and accepted audit data', async () => {
    const sessionStorage = storage();
    const first = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    const data = source();
    data.pendingFinalUpload = { finishAttemptId: 'stable-finish', payload: {
        ids: { session: SESSION }, lifecycle: { status: 'completed', finishAttemptId: 'stable-finish' },
        cognitiveResults: clone(data.cognitiveResults)
    } };
    await first.save(SESSION, data, { state: 'completed' });
    const restored = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    const checkpoint = await restored.load();
    const original = clone(checkpoint.sessionData.storageRecovery);
    assert.equal(original.signalSeriesIncomplete, true);
    assert.deepEqual(original.omittedSeries.eyeSignals, { count: 2, firstTimestamp: 1000, lastTimestamp: 2000 });
    assert.deepEqual(checkpoint.sessionData.eyeSignals, []);
    await restored.save(SESSION, checkpoint.sessionData, checkpoint.machineSnapshot);
    const next = await restored.load();
    assert.deepEqual(next.sessionData.storageRecovery, original);
    assert.deepEqual(next.sessionData.experimentMeta.storageRecovery, original);
    for (const key of ['cognitiveResults', 'events', 'heatmapState', 'pendingFinalUpload']) {
        assert.deepEqual(next.sessionData[key], data[key], key);
    }
    assert.equal(data.eyeSignals.length, 2, 'source samples are not modified');
});

test('recovered omissions include new samples without counting repeated saves twice', async () => {
    const sessionStorage = storage();
    await new SessionCheckpointStore({ indexedDB: null, sessionStorage }).save(SESSION, source(), {});
    const store = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    const { sessionData } = await store.load();
    sessionData.eyeSignals.push({ t: 3000 }, { t: 4000 });
    for (let save = 0; save < 2; save++) {
        await store.save(SESSION, sessionData, {});
        const saved = JSON.parse(sessionStorage.getItem(BACKUP + SESSION));
        assert.deepEqual(saved.sessionData.storageRecovery.omittedSeries.eyeSignals,
            { count: 4, firstTimestamp: 1000, lastTimestamp: 4000 });
        assert.equal(saved.sessionData.storageRecovery.omittedSeries.eyeTracking.count, 1);
    }
    const reloaded = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    const next = await reloaded.load();
    await reloaded.save(SESSION, next.sessionData, {});
    assert.equal((await reloaded.load()).sessionData.storageRecovery.omittedSeries.eyeSignals.count, 4);
});

test('a cleared source buffer cannot erase missingness from the existing compact backup', async () => {
    const sessionStorage = storage();
    const store = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    const data = source();
    await store.save(SESSION, data, {});
    data.eyeSignals = [];
    data.eyeTracking = [];
    await store.save(SESSION, data, {});
    const checkpoint = await store.load();
    assert.equal(checkpoint.sessionData.storageRecovery.signalSeriesIncomplete, true);
    assert.deepEqual(checkpoint.sessionData.storageRecovery.omittedSeries.eyeSignals,
        { count: 2, firstTimestamp: 1000, lastTimestamp: 2000 });
});

test('empty compact snapshots do not invent missing signal history', async () => {
    const sessionStorage = storage();
    const data = { ids: { session: SESSION }, eyeSignals: [], events: [] };
    await new SessionCheckpointStore({ indexedDB: null, sessionStorage }).save(SESSION, data, {});
    const store = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    const checkpoint = await store.load();
    await store.save(SESSION, checkpoint.sessionData, {});
    const recovery = (await store.load()).sessionData.storageRecovery;
    assert.equal(recovery.signalSeriesIncomplete, false);
    assert.deepEqual(recovery.omittedSeries.eyeSignals, { count: 0, firstTimestamp: null, lastTimestamp: null });
});

for (const withCounts of [false, true]) test(`legacy metadata-only missingness survives resave (counts=${withCounts})`, async () => {
    const sessionStorage = storage();
    const recovery = { signalSeriesIncomplete: true, ...(withCounts ? {
        omittedSampleArrays: ['eyeSignals'], omittedSeries: { eyeSignals: { count: 9, firstTimestamp: 10, lastTimestamp: 90 } }
    } : {}) };
    sessionStorage.setItem(ACTIVE, SESSION);
    sessionStorage.setItem(BACKUP + SESSION, JSON.stringify({ schemaVersion: 3, sessionId: SESSION,
        sessionData: { ids: { session: SESSION }, eyeSignals: [], experimentMeta: { storageRecovery: recovery } },
        machineSnapshot: { state: 'instruction' } }));
    const store = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    const checkpoint = await store.load();
    await store.save(SESSION, checkpoint.sessionData, checkpoint.machineSnapshot);
    const saved = await store.load();
    assert.equal(saved.sessionData.storageRecovery.signalSeriesIncomplete, true);
    if (withCounts) assert.deepEqual(saved.sessionData.storageRecovery.omittedSeries.eyeSignals, recovery.omittedSeries.eyeSignals);
});

test('fallback after primary revision 7 survives reload/resave and clears the unchanged primary', async () => {
    const { indexedDB, sessionStorage, data } = await primaryFallback();
    const backup = JSON.parse(sessionStorage.getItem(BACKUP + SESSION));
    assert.equal(backup.primaryRevision, 7);
    const store = new SessionCheckpointStore({ indexedDB, sessionStorage });
    const checkpoint = await store.load();
    assert.equal(store.revisions.get(SESSION), 7);
    assert.deepEqual(checkpoint.sessionData.cognitiveResults, data.cognitiveResults);
    await store.save(SESSION, checkpoint.sessionData, checkpoint.machineSnapshot);
    assert.equal(JSON.parse(sessionStorage.getItem(BACKUP + SESSION)).primaryRevision, 7);
    await store.clear();
    assert.equal(indexedDB.snapshot(SESSION), undefined);
    assert.deepEqual(indexedDB.chunks(SESSION), []);
    assert.equal(sessionStorage.getItem(BACKUP + SESSION), null);
    assert.equal(sessionStorage.getItem(ACTIVE), null);
});

for (const timing of ['before reload', 'after reload']) test(`a separate writer's revision 8 is fenced (${timing})`, async () => {
    const { indexedDB, sessionStorage } = await primaryFallback();
    const store = new SessionCheckpointStore({ indexedDB, sessionStorage });
    if (timing === 'after reload') await store.load();
    const other = new SessionCheckpointStore({ indexedDB, sessionStorage: storage() });
    const checkpoint = await other.load(SESSION);
    checkpoint.sessionData.eyeSignals.push({ t: 9000 });
    checkpoint.sessionData.cognitiveResults.push({ trialId: 'other-tab', qualityValid: true, rt: 450 });
    await other.save(SESSION, checkpoint.sessionData, checkpoint.machineSnapshot);
    assert.equal(indexedDB.snapshot(SESSION).revision, 8);
    if (timing === 'before reload') await store.load();
    assert.equal(store.revisions.get(SESSION), 7, 'reload must not adopt a concurrent primary revision');
    const primary = indexedDB.snapshot(SESSION), chunks = indexedDB.chunks(SESSION);
    const backup = sessionStorage.getItem(BACKUP + SESSION);
    await assert.rejects(store.clear(), CheckpointConflictError);
    assert.deepEqual(indexedDB.snapshot(SESSION), primary);
    assert.deepEqual(indexedDB.chunks(SESSION), chunks);
    assert.equal(sessionStorage.getItem(BACKUP + SESSION), backup);
    assert.equal(sessionStorage.getItem(ACTIVE), SESSION);
});

test('a failed clear preserves both stores and can retry against the same revision', async () => {
    const { indexedDB, sessionStorage } = await primaryFallback();
    const store = new SessionCheckpointStore({ indexedDB, sessionStorage });
    await store.load();
    const primary = indexedDB.snapshot(SESSION), chunks = indexedDB.chunks(SESSION);
    indexedDB.failNextWrite();
    await assert.rejects(store.clear(), { name: 'QuotaExceededError' });
    assert.deepEqual(indexedDB.snapshot(SESSION), primary);
    assert.deepEqual(indexedDB.chunks(SESSION), chunks);
    assert.notEqual(sessionStorage.getItem(BACKUP + SESSION), null);
    assert.equal(sessionStorage.getItem(ACTIVE), SESSION);
    await store.clear();
    assert.equal(indexedDB.snapshot(SESSION), undefined);
    assert.equal(sessionStorage.getItem(ACTIVE), null);
});

test('a legacy fallback without a primary fence cannot clear an existing primary', async () => {
    const { indexedDB, sessionStorage } = await primaryFallback();
    const backup = JSON.parse(sessionStorage.getItem(BACKUP + SESSION));
    delete backup.primaryRevision;
    sessionStorage.setItem(BACKUP + SESSION, JSON.stringify(backup));
    const store = new SessionCheckpointStore({ indexedDB, sessionStorage });
    await store.load();
    await store.save(SESSION, (await store.load()).sessionData, {});
    assert.equal(JSON.parse(sessionStorage.getItem(BACKUP + SESSION)).primaryRevision, null);
    const primary = indexedDB.snapshot(SESSION);
    await assert.rejects(store.clear(), CheckpointConflictError);
    assert.deepEqual(indexedDB.snapshot(SESSION), primary);
    assert.equal(sessionStorage.getItem(ACTIVE), SESSION);
});

test('a fallback created without a primary can clear while the primary remains absent', async () => {
    const sessionStorage = storage(), indexedDB = fakeIndexedDb();
    await new SessionCheckpointStore({ indexedDB: null, sessionStorage }).save(SESSION, source(), {});
    const store = new SessionCheckpointStore({ indexedDB, sessionStorage });
    await store.load();
    await store.clear();
    assert.equal(sessionStorage.getItem(BACKUP + SESSION), null);
    assert.equal(sessionStorage.getItem(ACTIVE), null);
});

test('an unfenced fallback cannot clear a primary created later by another writer', async () => {
    const sessionStorage = storage(), indexedDB = fakeIndexedDb();
    await new SessionCheckpointStore({ indexedDB: null, sessionStorage }).save(SESSION, source(), {});
    const store = new SessionCheckpointStore({ indexedDB, sessionStorage });
    await store.load();
    const other = new SessionCheckpointStore({ indexedDB, sessionStorage: storage() });
    await other.save(SESSION, source(), {});
    assert.equal(indexedDB.snapshot(SESSION).revision, 1);
    await assert.rejects(store.clear(), CheckpointConflictError);
    assert.equal(indexedDB.snapshot(SESSION).revision, 1);
    assert.equal(sessionStorage.getItem(ACTIVE), SESSION);
});

test('a known legacy primary revision zero is distinct from an unknown fallback fence', async () => {
    const indexedDB = fakeIndexedDb(), sessionStorage = storage();
    await new Promise((resolve, reject) => {
        const request = indexedDB.open();
        request.onsuccess = () => {
            const tx = request.result.transaction([SNAPSHOTS], 'readwrite');
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
            tx.objectStore(SNAPSHOTS).put({ schemaVersion: 3, sessionId: SESSION,
                sessionData: source(), machineSnapshot: { state: 'instruction' } });
        };
    });
    const store = new SessionCheckpointStore({ indexedDB, sessionStorage });
    const checkpoint = await store.load(SESSION);
    assert.equal(store.revisions.get(SESSION), 0);
    indexedDB.failNextWrite();
    await store.save(SESSION, checkpoint.sessionData, checkpoint.machineSnapshot);
    assert.equal(JSON.parse(sessionStorage.getItem(BACKUP + SESSION)).primaryRevision, 0);
    const restored = new SessionCheckpointStore({ indexedDB, sessionStorage });
    await restored.load();
    assert.equal(restored.revisions.get(SESSION), 0);
    await restored.clear();
    assert.equal(indexedDB.snapshot(SESSION), undefined);
    assert.equal(sessionStorage.getItem(ACTIVE), null);
});

test('backup revision fencing still protects a newer compact write', async () => {
    const { indexedDB, sessionStorage } = await primaryFallback();
    const first = new SessionCheckpointStore({ indexedDB, sessionStorage });
    const second = new SessionCheckpointStore({ indexedDB, sessionStorage });
    await first.load();
    const checkpoint = await second.load();
    await second.save(SESSION, checkpoint.sessionData, checkpoint.machineSnapshot);
    const backup = sessionStorage.getItem(BACKUP + SESSION);
    await assert.rejects(first.clear(), CheckpointConflictError);
    assert.equal(indexedDB.snapshot(SESSION).revision, 7);
    assert.equal(sessionStorage.getItem(BACKUP + SESSION), backup);
});
