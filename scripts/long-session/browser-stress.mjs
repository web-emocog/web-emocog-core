import { SessionCheckpointStore } from '/apps/participant-web/js/session-runtime/checkpoint-store.mjs';
import { CheckpointBuilder } from '/apps/participant-web/js/session-runtime/checkpoint-builder.mjs';
import { createHeatmapAccumulator } from '/apps/participant-web/js/web-page/heatmap.js?v=20261102-1';
import { LongSessionContinuity } from '/apps/participant-web/js/session-runtime/long-session-continuity.mjs';

const check = (value, message) => { if (!value) throw new Error(message); };
const equal = (a, b, message) => check(JSON.stringify(a) === JSON.stringify(b), message);
const dbName = label => `long-session-isolated-${label}-${crypto.randomUUID()}`;
const open = (name, version = 3, upgrade = null) => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade?.(request.result, request.transaction);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
});
const transaction = (db, stores, mode, fn) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('aborted'));
    fn(tx);
});
const remove = name => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve; request.onerror = () => reject(request.error);
});
const data = id => ({ ids: { session: id, participant: 'synthetic', invitationCode: 'local-only' },
    startTime: 1800000000000, eyeTracking: [], eyeSignals: [], emotionSamples: [], bodyPoseSamples: [], events: [],
    cognitiveResults: [{ trialId: 'accepted-before-reload', rt: 420, qualityValid: true }],
    emotionAccumulator: { n: 0, valenceSum: 0, arousalSum: 0 },
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'instruction', status: 'in_progress' } });

export async function accelerated(minutes) {
    const databaseName = dbName(minutes), id = `synthetic-${minutes}`, source = data(id);
    let store = new SessionCheckpointStore({ databaseName, sessionStorage: null });
    let heatmap = createHeatmapAccumulator({ gridWidth: 32, gridHeight: 18 });
    const count = minutes * 60 * 30, start = performance.now(), saves = [], before = await navigator.storage.estimate();
    const totals = { saves: 0, sampleRecordsWritten: 0, chunksWritten: 0, chunksPruned: 0 };
    const collect = () => { for (const key of Object.keys(totals)) totals[key] += store.stats[key]; };
    let reloadVerified = false;
    try {
        for (let frame = 0; frame < count; frame++) {
            const tRelMs = frame * 1000 / 30, t = source.startTime + tRelMs;
            const gaze = { t, tRelMs, monotonicMs: tRelMs, sessionTimeMs: tRelMs, timeOriginMs: source.startTime,
                x: 800 + frame % 50, y: 400, correctedX: 800 + frame % 50, correctedY: 400,
                valid: frame % 17 !== 0, onScreen: frame % 17 !== 0, confidence: .9,
                screenWidth: 1920, screenHeight: 1080, phase: 'tracking' };
            heatmap.add(gaze);
            source.eyeTracking.push(gaze);
            if (source.eyeTracking.length > 32000) source.eyeTracking.splice(0, source.eyeTracking.length - 30000);
            source.eyeSignals.push({ t, monotonicMs: tRelMs, sessionTimeMs: tRelMs, phase: 'tracking',
                leftEAR: frame % 120 < 4 ? .08 : .3, rightEAR: frame % 120 < 4 ? .08 : .3, bothOpen: frame % 120 >= 4 });
            if (frame % 6 === 0) {
                source.emotionSamples.push({ t, valence: .2, arousal: .4, confidence: .9 });
                source.bodyPoseSamples.push({ t, valid: true, confidence: .9, movementVelocity: .01 });
                if (source.emotionSamples.length > 7200) source.emotionSamples.shift();
                if (source.bodyPoseSamples.length > 7200) source.bodyPoseSamples.shift();
                source.emotionAccumulator.n++; source.emotionAccumulator.valenceSum += .2; source.emotionAccumulator.arousalSum += .4;
            }
            if (frame % 900 === 0) source.events.push({ eventId: `e-${frame}`, timestamp: t,
                type: 'synthetic_event', category: 'technical', severity: 'info' });
            if ((frame + 1) % 150 !== 0) continue;
            source.heatmapState = heatmap.snapshot();
            const at = performance.now();
            await store.save(id, source, { state: 'instruction' });
            saves.push(performance.now() - at);
            check(store.memory.size === 0, 'IndexedDB should not retain duplicate session snapshots');
            if (!reloadVerified && frame + 1 >= count / 2) {
                collect();
                store = new SessionCheckpointStore({ databaseName, sessionStorage: null });
                const restored = await store.load(id);
                equal(restored.sessionData.eyeSignals, source.eyeSignals, 'reload lost eye clocks or samples');
                equal(restored.sessionData.eyeTracking, source.eyeTracking, 'rolling gaze rebase mismatch');
                equal(restored.sessionData.cognitiveResults, source.cognitiveResults, 'accepted trial lost');
                equal(restored.sessionData.heatmapState, source.heatmapState, 'heatmap checkpoint changed');
                heatmap = createHeatmapAccumulator({}, restored.sessionData.heatmapState);
                reloadVerified = true;
            }
        }
        collect();
        const restored = await store.load(id);
        for (const key of ['eyeTracking', 'eyeSignals', 'emotionSamples', 'bodyPoseSamples', 'events', 'cognitiveResults']) {
            equal(restored.sessionData[key], source[key], `${key}: final restore mismatch`);
        }
        const finalMap = createHeatmapAccumulator({}, restored.sessionData.heatmapState).finalize();
        equal(finalMap, heatmap.finalize(), 'cumulative heatmap after reload is not exact');
        check(finalMap.accumulation.summary.sampleCountTotal === count, 'evicted gaze missing from aggregate');
        const expectedWrites = count * 2 + Math.ceil(count / 6) * 2 + Math.ceil(count / 900);
        check(totals.sampleRecordsWritten === expectedWrites, `nonlinear writes ${totals.sampleRecordsWritten} != ${expectedWrites}`);
        const buildAt = performance.now();
        const packet = await new CheckpointBuilder({ timeoutMs: 30000 }).build(restored.sessionData);
        check(!packet.experimentMeta?.backupScope, 'real aggregation worker failed or timed out');
        equal(packet.cognitiveResults, source.cognitiveResults, 'worker discarded accepted result');
        const buildMs = performance.now() - buildAt;
        packet.lifecycle = { ...packet.lifecycle, state: 'completed', status: 'completed',
            finishAttemptId: 'stable-final-key', completedAt: new Date(source.eyeSignals.at(-1).t).toISOString() };
        packet.delivery = { schemaVersion: 'session_delivery.v1', kind: 'final', sequence: 999 };
        source.pendingFinalUpload = { finishAttemptId: 'stable-final-key', payload: packet };
        await store.save(id, source, { state: 'completed' });
        const terminal = await new SessionCheckpointStore({ databaseName, sessionStorage: null }).load(id);
        equal(terminal.sessionData.pendingFinalUpload.payload, packet, 'offline final bytes/identity changed');
        const after = await navigator.storage.estimate();
        const sorted = saves.toSorted((a, b) => a - b);
        return { minutes, syntheticFrames: count, wallMs: performance.now() - start, reloadVerified,
            writes: totals, retainedCounts: Object.fromEntries(['eyeTracking', 'eyeSignals', 'emotionSamples', 'bodyPoseSamples', 'events'].map(key => [key, source[key].length])),
            saveMs: { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) },
            firstSaveMeanMs: saves.slice(0, 100).reduce((a, b) => a + b, 0) / 100,
            lastSaveMeanMs: saves.slice(-100).reduce((a, b) => a + b, 0) / 100,
            storageUsageDeltaBytes: (after.usage || 0) - (before.usage || 0),
            workerBuildMs: buildMs, finalPayloadBytes: new TextEncoder().encode(JSON.stringify(packet)).length,
            aggregateSampleCount: finalMap.accumulation.summary.sampleCountTotal,
            heapUsedBytes: performance.memory?.usedJSHeapSize ?? null };
    } finally { await remove(databaseName); }
}

export async function faults() {
    const name = dbName('faults'), id = 'faults', source = data(id);
    const store = new SessionCheckpointStore({ databaseName: name, sessionStorage: null });
    source.eyeSignals.push({ t: 10 });
    const results = [];
    try {
        await store.save(id, source, {});
        const stale = new SessionCheckpointStore({ databaseName: name, sessionStorage: null });
        await stale.load(id);
        source.eyeSignals.push({ t: 20 });
        await store.save(id, source, {});
        let conflict;
        try { await stale.save(id, source, {}); } catch (error) { conflict = error.name; }
        check(conflict === 'CheckpointConflictError', 'stale writer was not rejected');
        try { await stale.clear(id); throw new Error('stale clear succeeded'); }
        catch (error) { check(error.name === 'CheckpointConflictError', 'stale clear was not rejected'); }
        results.push('stale writer and stale clear rejected');

        let abortNext = true;
        const abortFactory = { open(...args) {
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
        const aborted = new SessionCheckpointStore({ databaseName: name, indexedDB: abortFactory, sessionStorage: null });
        await aborted.load(id);
        source.eyeSignals.push({ t: 30 });
        await aborted.save(id, source, {}).then(() => { throw new Error('abort unexpectedly saved'); }, () => {});
        equal((await store.load(id)).sessionData.eyeSignals, [{ t: 10 }, { t: 20 }], 'aborted transaction altered committed data');
        await aborted.save(id, source, {});
        equal((await store.load(id)).sessionData.eyeSignals, source.eyeSignals, 'retry lost uncommitted delta');
        results.push('real IDB transaction abort rolled back atomically; retry retained delta');

        const busyFactory = { open(...args) {
            const request = indexedDB.open(...args);
            request.addEventListener('success', () => {
                const db = request.result, original = db.transaction.bind(db);
                db.transaction = (...params) => {
                    const tx = original(...params);
                    if (params[1] === 'readwrite') {
                        const keepAlive = () => {
                            const read = tx.objectStore('session-checkpoints').get('keep-alive');
                            read.onsuccess = keepAlive;
                        };
                        keepAlive();
                    }
                    return tx;
                };
            });
            return request;
        } };
        const timed = new SessionCheckpointStore({ databaseName: name, indexedDB: busyFactory, sessionStorage: null, operationTimeoutMs: 20 });
        await timed.load(id);
        source.eyeSignals.push({ t: 40 });
        await timed.save(id, source, {}).then(() => { throw new Error('busy transaction unexpectedly completed'); }, () => {});
        equal((await store.load(id)).sessionData.eyeSignals, [{ t: 10 }, { t: 20 }, { t: 30 }], 'timeout committed a partial checkpoint');
        results.push('real busy IDB transaction times out and aborts without a partial commit');

        const concurrent = new SessionCheckpointStore({ databaseName: name, sessionStorage: null });
        await concurrent.load(id);
        await Promise.all([concurrent.save(id, source, {}), concurrent.save(id, source, {}), concurrent.clear(id)]);
        check(await concurrent.load(id) === null, 'clear raced an in-flight save');
        results.push('save/save/clear queue leaves no late resurrection');
    } finally { await remove(name); }

    const legacyName = dbName('legacy');
    try {
        const db = await open(legacyName, 2, db => {
            db.createObjectStore('session-checkpoints', { keyPath: 'sessionId' });
            db.createObjectStore('session-sample-chunks', { keyPath: 'id', autoIncrement: true }).createIndex('sessionId', 'sessionId');
        });
        await transaction(db, ['session-checkpoints', 'session-sample-chunks'], 'readwrite', tx => {
            for (const schemaVersion of [1, 2, 3]) {
                const sessionId = `v${schemaVersion}`, old = data(sessionId);
                old.eyeTracking = [{ t: 1234, x: 40 }]; old.eyeSignals = [{ t: 1234, leftEAR: .3 }];
                const snapshot = { schemaVersion, sessionId, sessionData: old, machineSnapshot: { state: 'instruction' } };
                if (schemaVersion === 3) {
                    snapshot.sampleCounts = { eyeTracking: 1, eyeSignals: 1 };
                    for (const sampleType of ['eyeTracking', 'eyeSignals']) {
                        tx.objectStore('session-sample-chunks').add({ sessionId, sampleType, from: 0, to: 1, samples: old[sampleType] });
                        old[sampleType] = [];
                    }
                }
                tx.objectStore('session-checkpoints').put(snapshot);
            }
        });
        db.close();
        for (const version of [1, 2, 3]) {
            const s = new SessionCheckpointStore({ databaseName: legacyName, sessionStorage: null });
            const saved = await s.load(`v${version}`);
            check(saved.sessionData.eyeSignals[0].t === 1234, 'legacy restore lost clock');
            await s.save(`v${version}`, saved.sessionData, saved.machineSnapshot);
            const migrated = await s.load(`v${version}`);
            check(migrated.schemaVersion === 4, 'legacy did not migrate');
            equal(migrated.sessionData.eyeSignals, saved.sessionData.eyeSignals, 'legacy migration duplicated or dropped data');
        }
        results.push('schemas 1/2 inline and 3 chunks restore and atomically migrate');
    } finally { await remove(legacyName); }
    return results;
}

export async function realtimeStart() {
    const name = dbName('realtime');
    globalThis.longSessionRealtime = { name, source: data('real-clock'), store: new SessionCheckpointStore({ databaseName: name }),
        continuity: new LongSessionContinuity(), started: performance.now(), last: null, ticks: 0, maxGap: 0, gaps: [], writes: [], errors: [] };
    const run = globalThis.longSessionRealtime;
    document.addEventListener('visibilitychange', () => {
        const hidden = document.visibilityState === 'hidden';
        const gap = run.continuity.visibility(hidden);
        if (gap) run.gaps.push(gap);
        run.source.experimentMeta = { runtimeContinuity: { ...run.continuity.snapshot } };
        run.writes.push(run.store.save('real-clock', run.source, { state: 'instruction' }).catch(e => run.errors.push(e.message)));
    });
    run.timer = setInterval(() => {
        const now = performance.now(), t = Date.now();
        const gap = run.continuity.tick(t, 33);
        if (gap) run.gaps.push(gap);
        run.source.experimentMeta = { runtimeContinuity: { ...run.continuity.snapshot } };
        if (run.last !== null) run.maxGap = Math.max(run.maxGap, now - run.last);
        run.last = now; run.ticks++;
        run.source.eyeSignals.push({ t, monotonicMs: now, timeOriginMs: performance.timeOrigin });
        if (run.ticks % 30 === 0) run.writes.push(run.store.save('real-clock', run.source, {}).catch(e => run.errors.push(e.message)));
    }, 33);
    return name;
}

export async function realtimeFinish() {
    const run = globalThis.longSessionRealtime;
    clearInterval(run.timer);
    await Promise.all(run.writes);
    await run.store.save('real-clock', run.source, {});
    const restored = await new SessionCheckpointStore({ databaseName: run.name }).load('real-clock');
    equal(restored.sessionData.eyeSignals, run.source.eyeSignals, 'real-time recovery changed original clocks');
    check(!run.errors.length, run.errors.join(';'));
    check(run.gaps.some(gap => gap.reason === 'scheduler_gap' && gap.durationMs >= 2500), 'real main-thread stall was not observed');
    const result = { wallMs: performance.now() - run.started, ticks: run.ticks, maxSchedulerGapMs: run.maxGap,
        observedTechnicalGaps: run.gaps, originalTimestampsPreserved: true, errors: run.errors };
    await remove(run.name);
    return result;
}

export async function quota(name) {
    const source = data('quota');
    // Incompressible data is required: Chromium compresses repeated strings in IDB.
    let diagnostic = '';
    for (let block = 0; block < 128; block++) {
        diagnostic += btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(65536))));
    }
    source.eyeSignals.push({ t: 10, diagnostic });
    source.heatmapState = { retained: 'sentinel-aggregate' };
    const store = new SessionCheckpointStore({ databaseName: name });
    // IDB may admit the transaction that crosses quota; the next commit must exercise rejection.
    for (let attempt = 0; attempt < 4; attempt++) {
        await store.save('quota', source, { state: 'instruction' });
        if (store.lastPersistenceMode === 'session_storage_compact') break;
        await navigator.storage.estimate();
        source.eyeSignals.push({ t: 20 + attempt, diagnostic });
    }
    const enforcedByBrowser = store.lastPersistenceMode === 'session_storage_compact';
    if (!enforcedByBrowser) {
        const factory = { open(...args) {
            const request = indexedDB.open(...args);
            request.addEventListener('success', () => {
                const db = request.result, original = db.transaction.bind(db);
                db.transaction = (...params) => {
                    const tx = original(...params);
                    if (params[1] !== 'readwrite') return tx;
                    const objectStore = tx.objectStore.bind(tx);
                    tx.objectStore = key => {
                        const target = objectStore(key);
                        if (key === 'session-sample-chunks') target.add = () => { throw new DOMException('Injected disk quota failure', 'QuotaExceededError'); };
                        return target;
                    };
                    return tx;
                };
            });
            return request;
        } };
        const injected = new SessionCheckpointStore({ databaseName: name, indexedDB: factory });
        await injected.load('quota');
        await injected.save('quota', source, { state: 'instruction' });
        check(injected.lastPersistenceMode === 'session_storage_compact', 'injected QuotaExceededError did not use explicit recovery');
    }
    const restored = await new SessionCheckpointStore({ databaseName: name }).load('quota');
    check(restored.sessionData.storageRecovery.omittedSeries.eyeSignals.count === source.eyeSignals.length, 'quota missingness lost');
    equal(restored.sessionData.cognitiveResults, source.cognitiveResults, 'quota lost accepted result');
    equal(restored.sessionData.heatmapState, source.heatmapState, 'quota lost heatmap');
    return { mode: 'session_storage_compact', quotaOverrideEnforcedByBrowser: enforcedByBrowser,
        faultInjectionRequired: !enforcedByBrowser, aggregatePreserved: true };
}

export async function seedRestart(name) {
    const store = new SessionCheckpointStore({ databaseName: name, sessionStorage: null }), source = data('restart');
    source.eyeSignals = [{ t: 1800000000010, monotonicMs: 10, timeOriginMs: 1800000000000 }];
    source.pendingFinalUpload = { finishAttemptId: 'restart-stable-key', payload: { schemaVersion: 'session_feature.v1',
        ids: source.ids, startTime: source.startTime, cognitiveResults: source.cognitiveResults,
        lifecycle: { state: 'completed', finishAttemptId: 'restart-stable-key', completedAt: '2027-01-15T08:00:00.010Z' },
        delivery: { kind: 'final', sequence: 42 } } };
    await store.save('restart', source, { state: 'completed' });
    return JSON.stringify(source.pendingFinalUpload);
}

export async function verifyRestart(name, expected) {
    const store = new SessionCheckpointStore({ databaseName: name, sessionStorage: null });
    const restored = await store.load('restart');
    check(JSON.stringify(restored.sessionData.pendingFinalUpload) === expected, 'browser restart altered final payload/key/sequence');
    check(restored.sessionData.eyeSignals[0].t === 1800000000010, 'browser restart retimed capture clock');
    await store.save('restart', restored.sessionData, restored.machineSnapshot);
    check(JSON.stringify((await store.load('restart')).sessionData.pendingFinalUpload) === expected, 'repeat persist changed final payload');
    await store.clear('restart');
    await remove(name);
    return { browserProcessRestart: true, finalPayloadKeySequenceAndTimestampsUnchanged: true };
}

export async function versionChange() {
    const name = dbName('versionchange');
    let upgrade;
    const factory = { open(...args) {
        const request = indexedDB.open(...args);
        request.addEventListener('success', () => {
            // Queue a genuine upgrade while the runtime owns the connection.
            if (!upgrade) upgrade = open(name, 4).then(db => db.close());
        });
        return request;
    } };
    const store = new SessionCheckpointStore({ databaseName: name, indexedDB: factory, sessionStorage: null });
    try {
        await store.save('version', data('version'), {});
        await Promise.race([upgrade, new Promise((_, reject) => setTimeout(() => reject(new Error('versionchange connection leaked')), 3000))]);
        await store.load('version').then(() => { throw new Error('downgrade unexpectedly opened'); }, error => check(error.name === 'VersionError', 'upgrade failure not explicit'));
        const db = await open(name, 4);
        let read;
        await transaction(db, ['session-checkpoints'], 'readonly', tx => { read = tx.objectStore('session-checkpoints').get('version'); });
        check(read.result.sessionData.cognitiveResults[0].qualityValid === true, 'versionchange discarded accepted data');
        db.close();
        return { upgradeCompletedWithoutBlockedLeak: true, downgradeExplicitlyFailed: true, committedCheckpointPreserved: true };
    } finally { await remove(name); }
}
