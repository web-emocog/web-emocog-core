import { CHECKPOINT_SERIES, describeSeries, planSeries, restoreSeries } from './long-session-retention.mjs';

const DB_NAME = 'wecog-participant-runtime';
const DB_VERSION = 3;
const STORE_NAME = 'session-checkpoints';
const SAMPLE_STORE_NAME = 'session-sample-chunks';
const ACTIVE_SESSION_KEY = 'wecog_active_session_id';
const BACKUP_PREFIX = 'wecog_session_backup:';
const CHECKPOINT_SCHEMA_VERSION = 3;
const OMIT_KEYS = /^(email|e-mail|phone|phoneNumber|ip|ipAddress|userAgent|authorization|accessToken|refreshToken|ingestToken|cookie|fullName|displayName)$/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function matchesCheckpointInvitation(sessionData, search = '') {
    const requestedCode = new URLSearchParams(search).get('code')?.trim();
    return !requestedCode || sessionData?.ids?.invitationCode === requestedCode
        || sessionData?.experimentMeta?.invitationEntryCode === requestedCode;
}

function sanitizeCheckpointValue(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        return EMAIL_VALUE.test(value.trim()) ? '[redacted]' : value;
    }
    if (typeof value !== 'object') return value;
    if (seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
        const result = value.map(item => sanitizeCheckpointValue(item, seen));
        seen.delete(value);
        return result;
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (OMIT_KEYS.test(key)) continue;
        const safe = sanitizeCheckpointValue(item, seen);
        if (key === '__proto__') {
            Object.defineProperty(result, key, { value: safe, enumerable: true, configurable: true, writable: true });
        } else result[key] = safe;
    }
    seen.delete(value);
    return result;
}

export function buildCheckpointSessionData(sessionData) {
    return sanitizeCheckpointValue(sessionData || {});
}

function openDatabase(indexedDb, timeoutMs, databaseName = DB_NAME) {
    return new Promise((resolve, reject) => {
        const request = indexedDb.open(databaseName, DB_VERSION);
        let settled = false;
        const timeout = setTimeout(() => rejectOnce(new Error('IndexedDB open timed out')), timeoutMs);
        const rejectOnce = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
        };
        request.onerror = () => rejectOnce(
            request.error || new Error('IndexedDB open failed')
        );
        request.onblocked = () => rejectOnce(
            new Error('IndexedDB upgrade blocked by another tab')
        );
        request.onupgradeneeded = () => {
            if (settled) { request.transaction?.abort(); return; }
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
            }
            if (!db.objectStoreNames.contains(SAMPLE_STORE_NAME)) {
                const store = db.createObjectStore(SAMPLE_STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true
                });
                store.createIndex('sessionId', 'sessionId', { unique: false });
            }
            const chunks = request.transaction.objectStore(SAMPLE_STORE_NAME);
            if (!chunks.indexNames.contains('sessionType')) {
                chunks.createIndex('sessionType', ['sessionId', 'sampleType'], { unique: false });
            }
        };
        request.onsuccess = () => {
            if (settled) {
                request.result.close();
                return;
            }
            settled = true;
            clearTimeout(timeout);
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
    });
}

function checkpointTransaction(db, mode, timeoutMs, operation) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME, SAMPLE_STORE_NAME], mode);
        const timeout = setTimeout(() => {
            // Aborting prevents a late write from replacing a newer fallback.
            try { transaction.abort(); } catch (_) {}
            reject(new Error('Checkpoint transaction timed out'));
        }, timeoutMs);
        transaction.oncomplete = () => { clearTimeout(timeout); resolve(); };
        transaction.onerror = transaction.onabort = () => {
            clearTimeout(timeout);
            reject(transaction.error || new Error('Checkpoint transaction failed'));
        };
        try { operation(transaction); } catch (error) {
            clearTimeout(timeout);
            try { transaction.abort(); } catch (_) {}
            reject(error);
        }
    });
}

export class CheckpointConflictError extends Error {
    constructor() { super('Checkpoint changed in another store; reload before saving'); this.name = 'CheckpointConflictError'; }
}

export class SessionCheckpointStore {
    constructor(options = {}) {
        const storage = name => { try { return globalThis[name] || null; } catch (_) { return null; } };
        this.indexedDb = Object.hasOwn(options, 'indexedDB') ? options.indexedDB : storage('indexedDB');
        this.sessionStorage = Object.hasOwn(options, 'sessionStorage') ? options.sessionStorage : storage('sessionStorage');
        this.databaseName = options.databaseName || DB_NAME;
        this.memory = new Map();
        this.series = new Map();
        this.revisions = new Map();
        this.backupRevisions = new Map();
        this.fallbackSessions = new Set();
        this.operation = Promise.resolve();
        this.lastPersistenceMode = null;
        this.stats = { saves: 0, sampleRecordsWritten: 0, chunksWritten: 0, chunksPruned: 0, conflicts: 0, failures: 0 };
        this.operationTimeoutMs = Number.isFinite(options.operationTimeoutMs)
            ? Math.max(10, Math.min(30000, options.operationTimeoutMs)) : 10000;
    }

    // Serialize load/save/clear as well as writes: clear cannot race a late commit.
    _run(operation) {
        const pending = this.operation.then(operation);
        this.operation = pending.catch(() => {});
        return pending;
    }

    _remember(id, plans, revision) {
        this.series.delete(id);
        this.series.set(id, plans);
        this.revisions.set(id, revision);
        while (this.series.size > 2) {
            const oldest = this.series.keys().next().value;
            this.series.delete(oldest); this.revisions.delete(oldest);
            this.backupRevisions.delete(oldest);
            this.memory.delete(oldest); this.fallbackSessions.delete(oldest);
        }
        this.lastRetention = Object.fromEntries(Object.entries(plans).map(([key, plan]) => [key,
            { ...plan.retention, retainedCount: plan.count, firstTimestamp: plan.firstTimestamp ?? null,
                lastTimestamp: plan.lastTimestamp ?? null }]));
    }

    getActiveSessionId() {
        try { return this.sessionStorage?.getItem(ACTIVE_SESSION_KEY) || null; } catch (_) { return null; }
    }
    setActiveSessionId(sessionId) {
        if (!sessionId) return;
        try { this.sessionStorage?.setItem(ACTIVE_SESSION_KEY, String(sessionId)); } catch (_) {}
    }

    _saveBackup(sessionId, sessionData, machineSnapshot) {
        if (!this.sessionStorage) return false;
        const id = String(sessionId);
        let existing;
        try { existing = JSON.parse(this.sessionStorage.getItem(BACKUP_PREFIX + id) || 'null'); }
        catch (_) { return false; }
        if (existing && (!this.backupRevisions.has(id)
            || (existing.backupRevision || 0) !== this.backupRevisions.get(id))) throw new CheckpointConflictError();
        const compact = { ...sessionData };
        const recovered = { ...(compact.experimentMeta?.storageRecovery || {}), ...(compact.storageRecovery || {}) };
        const persisted = { ...(existing?.sessionData?.experimentMeta?.storageRecovery || {}),
            ...(existing?.sessionData?.storageRecovery || {}) };
        // Events and accepted results are audit data, not disposable sensor diagnostics.
        const omittedSamples = CHECKPOINT_SERIES.filter(key => key !== 'events' && (Array.isArray(compact[key])
            || recovered.omittedSeries?.[key] || persisted.omittedSeries?.[key]
            || recovered.omittedSampleArrays?.includes(key) || persisted.omittedSampleArrays?.includes(key)));
        const missingness = Object.fromEntries(omittedSamples.map(key => {
            const current = describeSeries(Array.isArray(compact[key]) ? compact[key] : []);
            const baseline = recovered.omittedSeries?.[key];
            const baselineCount = Number.isSafeInteger(baseline?.count) && baseline.count > 0 ? baseline.count : 0;
            // Source metadata is the reload baseline; the stored backup already includes
            // this page's samples and must not be added again on every periodic save.
            const combined = baselineCount ? {
                count: baselineCount + current.count,
                firstTimestamp: baseline.firstTimestamp ?? current.firstTimestamp,
                lastTimestamp: current.count ? current.lastTimestamp : baseline.lastTimestamp
            } : current;
            const previous = persisted.omittedSeries?.[key];
            return [key, previous?.count > combined.count ? previous : combined];
        }));
        for (const key of omittedSamples) compact[key] = [];
        compact.storageRecovery = { ...persisted, ...recovered, schemaVersion: 'checkpoint_recovery.v1',
            compactCheckpoint: true, signalSeriesIncomplete: recovered.signalSeriesIncomplete === true
                || persisted.signalSeriesIncomplete === true || omittedSamples.some(key => missingness[key].count > 0),
            omittedSampleArrays: omittedSamples, omittedSeries: missingness,
            aggregatePolicy: 'preserved_without_recomputation' };
        compact.experimentMeta = { ...(compact.experimentMeta || {}), storageRecovery: compact.storageRecovery };
        const backupRevision = (this.backupRevisions.get(id) || 0) + 1;
        const primaryRevision = this.revisions.get(id);
        const backup = { schemaVersion: CHECKPOINT_SCHEMA_VERSION, sessionId: id, savedAt: Date.now(), backupRevision,
            primaryRevision: primaryRevision ?? null,
            sessionData: buildCheckpointSessionData(compact), machineSnapshot: sanitizeCheckpointValue(machineSnapshot || {}) };
        try {
            this.sessionStorage.setItem(BACKUP_PREFIX + sessionId, JSON.stringify(backup));
            this.setActiveSessionId(sessionId);
            this._remember(id, this.series.get(id) || {}, primaryRevision);
            this.fallbackSessions.add(String(sessionId));
            this.backupRevisions.set(id, backupRevision);
            this.lastPersistenceMode = 'session_storage_compact';
            // No second in-memory copy of an IndexedDB or sessionStorage checkpoint.
            return true;
        } catch (_) { return false; }
    }

    save(sessionId, sessionData, machineSnapshot) {
        return this._run(async () => {
            if (!sessionId) return false;
            this.lastPersistenceMode = null;
            if (this.fallbackSessions.has(String(sessionId))) {
                if (this._saveBackup(sessionId, sessionData, machineSnapshot)) return true;
                throw new Error('Session backup storage is unavailable');
            }
            try {
                return await this._savePrimary(sessionId, sessionData, machineSnapshot);
            } catch (error) {
                this.stats.failures++;
                // A stale tab must never shadow a newer durable checkpoint with a backup.
                if (error instanceof CheckpointConflictError) { this.stats.conflicts++; throw error; }
                if (this._saveBackup(sessionId, sessionData, machineSnapshot)) return true;
                throw error;
            }
        });
    }

    async _savePrimary(sessionId, sessionData, machineSnapshot) {
        const id = String(sessionId), useChunks = Boolean(this.indexedDb);
        if (!useChunks) {
            if (this.sessionStorage) {
                if (this._saveBackup(sessionId, sessionData, machineSnapshot)) return true;
                throw new Error('Session backup storage is unavailable');
            }
            if (!this.memory.has(id) && this.memory.size >= 2) {
                throw new Error('Memory checkpoint capacity reached; durable storage is required for another session');
            }
            const checkpoint = { schemaVersion: 3, sessionId: id, savedAt: Date.now(),
                sessionData: buildCheckpointSessionData(sessionData), machineSnapshot: sanitizeCheckpointValue(machineSnapshot || {}) };
            this._remember(id, {}, 0);
            this.memory.set(id, checkpoint);
            this.lastPersistenceMode = 'memory';
            this.setActiveSessionId(id);
            return true;
        }
        const source = { ...(sessionData || {}) }, plans = {}, sampleChunks = [];
        const previous = this.series.get(id);
        for (const key of CHECKPOINT_SERIES) {
            const samples = Array.isArray(source[key]) ? source[key] : [];
            const plan = planSeries(samples, previous?.[key], {
                fingerprint: value => value === undefined ? null : JSON.stringify(sanitizeCheckpointValue(value)) });
            plan.firstTimestamp = describeSeries(samples).firstTimestamp;
            sampleChunks.push(...plan.chunks.map(chunk => ({ sessionId: id, sampleType: key,
                ...chunk, samples: sanitizeCheckpointValue(chunk.samples) })));
            delete plan.chunks;
            plans[key] = plan;
            if (Array.isArray(source[key])) source[key] = [];
        }
        const retention = Object.fromEntries(Object.entries(plans).map(([key, plan]) => [key,
            { ...plan.retention, retainedCount: plan.count, firstTimestamp: plan.firstTimestamp, lastTimestamp: plan.lastTimestamp }]));
        source.experimentMeta = { ...(source.experimentMeta || {}), checkpointRetention: retention };
        const revision = (this.revisions.get(id) || 0) + 1;
        const checkpoint = { schemaVersion: 4, sessionId: id, savedAt: Date.now(), revision,
            sessionData: buildCheckpointSessionData(source), machineSnapshot: sanitizeCheckpointValue(machineSnapshot || {}),
            sampleRanges: plans };
        const db = await openDatabase(this.indexedDb, this.operationTimeoutMs, this.databaseName);
        let conflict = false, pruned = 0, transactionFailure = null;
        try {
            await checkpointTransaction(db, 'readwrite', this.operationTimeoutMs, transaction => {
                const guard = operation => () => {
                    try { operation(); } catch (error) { transactionFailure = error; transaction.abort(); }
                };
                const snapshots = transaction.objectStore(STORE_NAME);
                const read = snapshots.get(id);
                read.onsuccess = guard(() => {
                    const expected = this.revisions.get(id);
                    if ((read.result && expected === undefined) || (read.result?.revision || 0) !== (expected || 0)) {
                        conflict = true; transaction.abort(); return;
                    }
                    snapshots.put(checkpoint);
                    const chunks = transaction.objectStore(SAMPLE_STORE_NAME);
                    // Each cursor visits only deleted prefix chunks and one retained boundary.
                    const pruning = Object.entries(plans).filter(([key, plan]) => plan.reset || plan.from !== previous?.[key]?.from);
                    let remaining = pruning.length;
                    const append = () => { for (const chunk of sampleChunks) chunks.add(chunk); };
                    if (!remaining) append();
                    const done = () => { if (--remaining === 0) append(); };
                    for (const [key, plan] of pruning) {
                        const request = chunks.index('sessionType').openCursor([id, key]);
                        request.onsuccess = guard(() => {
                            const cursor = request.result;
                            if (!cursor) { done(); return; }
                            if (plan.reset || cursor.value.to <= plan.from) {
                                cursor.delete(); pruned++; cursor.continue();
                            } else done();
                        });
                    }
                });
            });
            this._remember(id, plans, revision);
            this.stats.saves++;
            this.stats.chunksPruned += pruned;
            this.stats.chunksWritten += sampleChunks.length;
            this.stats.sampleRecordsWritten += sampleChunks.reduce((sum, chunk) => sum + chunk.samples.length, 0);
            this.setActiveSessionId(id);
            this.lastPersistenceMode = 'indexeddb';
            return true;
        } catch (error) { if (conflict) throw new CheckpointConflictError(); throw transactionFailure || error; }
        finally { db.close(); }
    }

    load(sessionId = this.getActiveSessionId()) { return this._run(() => this._load(sessionId)); }
    async _load(sessionId) {
        if (!sessionId) return null;
        const id = String(sessionId);
        try {
            const backup = JSON.parse(this.sessionStorage?.getItem(BACKUP_PREFIX + id) || 'null');
            if (backup?.sessionId === id && backup.sessionData?.ids?.session === id) {
                if (![1, 2, 3, 4].includes(backup.schemaVersion)) throw new Error('Unsupported backup schema; explicit recovery required');
                // Legacy v3 compact backups did not carry counts; preserve explicit unknown coverage.
                if (!backup.sessionData.pendingFinalUpload?.payload && !backup.sessionData.finalizedPayload) {
                    backup.sessionData.experimentMeta = { ...(backup.sessionData.experimentMeta || {}),
                        storageRecovery: backup.sessionData.storageRecovery || backup.sessionData.experimentMeta?.storageRecovery
                            || { method: 'session_storage_compact',
                            signalSeriesIncomplete: true, schemaVersion: 'checkpoint_recovery.legacy' } };
                }
                this.fallbackSessions.add(id);
                // Missing legacy fences stay unknown, never adopt the current primary.
                this._remember(id, {}, Number.isSafeInteger(backup.primaryRevision) && backup.primaryRevision >= 0
                    ? backup.primaryRevision : undefined);
                this.backupRevisions.set(id, backup.backupRevision || 0);
                this.lastPersistenceMode = 'session_storage_compact';
                return backup;
            }
        } catch (error) { if (error.message === 'Unsupported backup schema; explicit recovery required') throw error; }
        if (!this.indexedDb) return this.memory.get(id) || null;
        const db = await openDatabase(this.indexedDb, this.operationTimeoutMs, this.databaseName);
        try {
            let read, chunksRead;
            await checkpointTransaction(db, 'readonly', this.operationTimeoutMs, transaction => {
                read = transaction.objectStore(STORE_NAME).get(id);
                chunksRead = transaction.objectStore(SAMPLE_STORE_NAME).index('sessionId').getAll(id);
            });
            const checkpoint = read.result || null;
            if (!checkpoint) return null;
            if (![1, 2, 3, 4].includes(checkpoint.schemaVersion)) throw new Error('Unsupported checkpoint schema; explicit recovery required');
            const chunks = chunksRead.result || [];
            const plans = {};
            if (checkpoint.schemaVersion === 4) {
                for (const key of CHECKPOINT_SERIES) {
                    checkpoint.sessionData[key] = restoreSeries(chunks, checkpoint.sampleRanges[key], key);
                    plans[key] = { ...checkpoint.sampleRanges[key], reset: false };
                }
            } else if (checkpoint.schemaVersion === 3) {
                for (const key of ['eyeTracking', 'eyeSignals']) {
                    const expected = checkpoint.sampleCounts?.[key];
                    // Memory/legacy inline v3 snapshots have no chunk manifest.
                    if (expected === undefined) continue;
                    checkpoint.sessionData[key] = restoreSeries(chunks, { from: 0, to: expected }, key);
                }
            }
            // Old schemas rebase once on their next write, in the same transaction as v4.
            this._remember(id, plans, checkpoint.revision || 0);
            this.lastPersistenceMode = 'indexeddb';
            return checkpoint;
        } finally { db.close(); }
    }

    clear(sessionId = this.getActiveSessionId()) {
        return this._run(async () => {
            if (!sessionId) return;
            const id = String(sessionId);
            let backup;
            try { backup = JSON.parse(this.sessionStorage?.getItem(BACKUP_PREFIX + id) || 'null'); } catch (_) {}
            if (backup && (!this.backupRevisions.has(id)
                || (backup.backupRevision || 0) !== this.backupRevisions.get(id))) throw new CheckpointConflictError();
            if (this.indexedDb) {
                const db = await openDatabase(this.indexedDb, this.operationTimeoutMs, this.databaseName);
                let conflict = false;
                try {
                    await checkpointTransaction(db, 'readwrite', this.operationTimeoutMs, transaction => {
                        const snapshots = transaction.objectStore(STORE_NAME), read = snapshots.get(id);
                        read.onsuccess = () => {
                            const expected = this.revisions.get(id);
                            if (read.result && (expected === undefined || (read.result.revision || 0) !== expected)) {
                                conflict = true; transaction.abort(); return;
                            }
                            snapshots.delete(id);
                            const request = transaction.objectStore(SAMPLE_STORE_NAME).index('sessionId').openCursor(id);
                            request.onsuccess = () => {
                                const cursor = request.result;
                                if (cursor) { cursor.delete(); cursor.continue(); }
                            };
                        };
                    });
                } catch (error) { if (conflict) throw new CheckpointConflictError(); throw error; }
                finally { db.close(); }
            }
            this.memory.delete(id); this.series.delete(id); this.revisions.delete(id); this.fallbackSessions.delete(id);
            this.backupRevisions.delete(id);
            try {
                this.sessionStorage?.removeItem(BACKUP_PREFIX + id);
                if (this.getActiveSessionId() === id) this.sessionStorage.removeItem(ACTIVE_SESSION_KEY);
            } catch (_) {}
        });
    }
}
