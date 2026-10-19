const DB_NAME = 'wecog-participant-runtime';
const DB_VERSION = 2;
const STORE_NAME = 'session-checkpoints';
const SAMPLE_STORE_NAME = 'session-sample-chunks';
const ACTIVE_SESSION_KEY = 'wecog_active_session_id';
const BACKUP_PREFIX = 'wecog_session_backup:';
const CHECKPOINT_SCHEMA_VERSION = 3;
const CHUNKED_ARRAY_KEYS = Object.freeze(['eyeTracking', 'eyeSignals']);
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
        result[key] = sanitizeCheckpointValue(item, seen);
    }
    seen.delete(value);
    return result;
}

export function buildCheckpointSessionData(sessionData) {
    return sanitizeCheckpointValue(sessionData || {});
}

function openDatabase(indexedDb, timeoutMs) {
    return new Promise((resolve, reject) => {
        const request = indexedDb.open(DB_NAME, DB_VERSION);
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

export class SessionCheckpointStore {
    constructor(options = {}) {
        const storage = name => { try { return globalThis[name] || null; } catch (_) { return null; } };
        this.indexedDb = Object.hasOwn(options, 'indexedDB') ? options.indexedDB : storage('indexedDB');
        this.sessionStorage = Object.hasOwn(options, 'sessionStorage') ? options.sessionStorage : storage('sessionStorage');
        this.memory = new Map();
        this.persistedSampleCounts = new Map();
        this.persistedSampleHeads = new Map();
        this.fallbackSessions = new Set();
        this.lastPersistenceMode = null;
        this.operationTimeoutMs = Number.isFinite(options.operationTimeoutMs)
            ? Math.max(10, Math.min(30000, options.operationTimeoutMs)) : 10000;
    }

    getActiveSessionId() {
        try {
            return this.sessionStorage?.getItem(ACTIVE_SESSION_KEY) || null;
        } catch (_) {
            return null;
        }
    }

    setActiveSessionId(sessionId) {
        if (!sessionId) return;
        try {
            this.sessionStorage?.setItem(ACTIVE_SESSION_KEY, String(sessionId));
        } catch (_) {
            // The caller must check the reference before claiming reload recovery.
        }
    }

    _saveBackup(sessionId, sessionData, machineSnapshot) {
        if (!this.sessionStorage) return false;
        const compact = { ...sessionData };
        const omitted = ['eyeTracking', 'eyeSignals', 'trackingTest', 'emotionSamples', 'bodyPoseSamples', 'emotionEvents'];
        for (const key of omitted) compact[key] = [];
        compact.storageRecovery = { compactCheckpoint: true, omittedSampleArrays: omitted };
        const backup = { schemaVersion: CHECKPOINT_SCHEMA_VERSION, sessionId: String(sessionId), savedAt: Date.now(),
            sessionData: buildCheckpointSessionData(compact), machineSnapshot: sanitizeCheckpointValue(machineSnapshot || {}) };
        try {
            this.sessionStorage.setItem(BACKUP_PREFIX + sessionId, JSON.stringify(backup));
            this.setActiveSessionId(sessionId);
            this.memory.set(String(sessionId), backup);
            this.fallbackSessions.add(String(sessionId));
            this.lastPersistenceMode = 'session_storage_compact';
            return true;
        } catch (_) { return false; }
    }

    async save(sessionId, sessionData, machineSnapshot) {
        if (!sessionId) return false;
        if (this.fallbackSessions.has(String(sessionId))) {
            if (this._saveBackup(sessionId, sessionData, machineSnapshot)) return true;
            throw new Error('Session backup storage is unavailable');
        }
        try {
            const saved = await this._savePrimary(sessionId, sessionData, machineSnapshot);
            if (!this.indexedDb && this.sessionStorage) {
                if (this._saveBackup(sessionId, sessionData, machineSnapshot)) return true;
                throw new Error('Session backup storage is unavailable');
            }
            this.lastPersistenceMode = this.indexedDb ? 'indexeddb' : 'memory';
            return saved;
        } catch (error) {
            if (this._saveBackup(sessionId, sessionData, machineSnapshot)) return true;
            throw error;
        }
    }

    async _savePrimary(sessionId, sessionData, machineSnapshot) {
        if (!sessionId) return false;
        const normalizedSessionId = String(sessionId);
        const useChunks = Boolean(this.indexedDb);
        const compactSource = useChunks ? { ...(sessionData || {}) } : (sessionData || {});
        if (useChunks) {
            for (const key of CHUNKED_ARRAY_KEYS) delete compactSource[key];
        }
        const previousCounts = this.persistedSampleCounts.get(normalizedSessionId) || {};
        const previousHeads = this.persistedSampleHeads.get(normalizedSessionId) || {};
        const nextCounts = {};
        const nextHeads = {};
        const resetTypes = new Set();
        const sampleChunks = [];
        for (const key of CHUNKED_ARRAY_KEYS) {
            const samples = Array.isArray(sessionData?.[key]) ? sessionData[key] : [];
            let previousCount = Number.isInteger(previousCounts[key])
                ? previousCounts[key]
                : 0;
            nextHeads[key] = samples.length ? JSON.stringify(samples[0]) : null;
            // Gaze uses a bounded rolling window. Rebase its chunks atomically
            // when the retained head moves, rather than treating retention as corruption.
            if (previousCount > samples.length || (previousCount > 0 && previousHeads[key] !== undefined && previousHeads[key] !== nextHeads[key])) {
                resetTypes.add(key);
                previousCount = 0;
            }
            nextCounts[key] = samples.length;
            if (useChunks && samples.length > previousCount) {
                sampleChunks.push({
                    sessionId: normalizedSessionId,
                    sampleType: key,
                    from: previousCount,
                    to: samples.length,
                    samples: sanitizeCheckpointValue(samples.slice(previousCount))
                });
            }
        }
        const checkpoint = {
            schemaVersion: CHECKPOINT_SCHEMA_VERSION,
            sessionId: normalizedSessionId,
            savedAt: Date.now(),
            sessionData: buildCheckpointSessionData(compactSource),
            machineSnapshot: sanitizeCheckpointValue(machineSnapshot || {}),
            sampleCounts: nextCounts
        };
        if (useChunks) {
            for (const key of CHUNKED_ARRAY_KEYS) checkpoint.sessionData[key] = [];
        }
        this.memory.set(checkpoint.sessionId, checkpoint);
        this.setActiveSessionId(checkpoint.sessionId);

        if (!this.indexedDb) {
            this.persistedSampleCounts.set(normalizedSessionId, nextCounts);
            return true;
        }
        const db = await openDatabase(this.indexedDb, this.operationTimeoutMs);
        try {
            await checkpointTransaction(db, 'readwrite', this.operationTimeoutMs, transaction => {
                transaction.objectStore(STORE_NAME).put(checkpoint);
                const chunkStore = transaction.objectStore(SAMPLE_STORE_NAME);
                const appendChunks = () => { for (const chunk of sampleChunks) chunkStore.add(chunk); };
                if (resetTypes.size) {
                    const cursorRequest = chunkStore.index('sessionId').openCursor(normalizedSessionId);
                    cursorRequest.onsuccess = () => {
                        const cursor = cursorRequest.result;
                        if (!cursor) { appendChunks(); return; }
                        if (resetTypes.has(cursor.value.sampleType)) cursor.delete();
                        cursor.continue();
                    };
                } else appendChunks();
            });
            this.persistedSampleCounts.set(normalizedSessionId, nextCounts);
            this.persistedSampleHeads.set(normalizedSessionId, nextHeads);
        } finally {
            db.close();
        }
        return true;
    }

    async load(sessionId = this.getActiveSessionId()) {
        if (!sessionId) return null;
        const normalizedSessionId = String(sessionId);
        try {
            const backup = JSON.parse(this.sessionStorage?.getItem(BACKUP_PREFIX + normalizedSessionId) || 'null');
            if (backup?.sessionId === normalizedSessionId && backup.sessionData?.ids?.session === normalizedSessionId) {
                if (!backup.sessionData.pendingFinalUpload?.payload && !backup.sessionData.finalizedPayload) {
                    backup.sessionData.experimentMeta = { ...(backup.sessionData.experimentMeta || {}),
                        storageRecovery: { method: 'session_storage_compact', signalSeriesIncomplete: true,
                            omittedSeries: ['eyeTracking', 'eyeSignals', 'trackingTest', 'emotionSamples', 'bodyPoseSamples', 'emotionEvents'] } };
                }
                this.fallbackSessions.add(normalizedSessionId);
                this.lastPersistenceMode = 'session_storage_compact';
                this.memory.set(normalizedSessionId, backup);
                return backup;
            }
        } catch (_) { /* The primary checkpoint remains independently readable. */ }
        if (!this.indexedDb) return this.memory.get(normalizedSessionId) || null;
        const db = await openDatabase(this.indexedDb, this.operationTimeoutMs);
        try {
            let checkpointRequest, chunksRequest;
            await checkpointTransaction(db, 'readonly', this.operationTimeoutMs, transaction => {
                checkpointRequest = transaction
                    .objectStore(STORE_NAME)
                    .get(normalizedSessionId);
                chunksRequest = transaction
                    .objectStore(SAMPLE_STORE_NAME)
                    .index('sessionId')
                    .getAll(normalizedSessionId);
            });
            const checkpoint = checkpointRequest.result || null, chunks = chunksRequest.result || [];
            if (!checkpoint) return null;
            if (checkpoint.schemaVersion >= 3) {
                const orderedChunks = [...chunks].sort((a, b) => a.id - b.id);
                for (const key of CHUNKED_ARRAY_KEYS) {
                    const samples = orderedChunks
                        .filter(chunk => chunk.sampleType === key)
                        .flatMap(chunk => Array.isArray(chunk.samples) ? chunk.samples : []);
                    const expected = Number(checkpoint.sampleCounts?.[key] || 0);
                    if (samples.length !== expected) {
                        throw new Error(`Checkpoint sample chunks incomplete for ${key}`);
                    }
                    checkpoint.sessionData[key] = samples;
                }
            }
            this.persistedSampleCounts.set(
                normalizedSessionId,
                Object.fromEntries(
                    CHUNKED_ARRAY_KEYS.map(key => [
                        key,
                        Array.isArray(checkpoint.sessionData?.[key])
                            ? checkpoint.sessionData[key].length
                            : 0
                    ])
                )
            );
            this.persistedSampleHeads.set(normalizedSessionId, Object.fromEntries(CHUNKED_ARRAY_KEYS.map(key => [
                key, checkpoint.sessionData?.[key]?.length ? JSON.stringify(checkpoint.sessionData[key][0]) : null
            ])));
            return checkpoint;
        } finally {
            db.close();
        }
    }

    async clear(sessionId = this.getActiveSessionId()) {
        if (!sessionId) return;
        const normalizedSessionId = String(sessionId);
        this.memory.delete(normalizedSessionId);
        this.persistedSampleCounts.delete(normalizedSessionId);
        this.persistedSampleHeads.delete(normalizedSessionId);
        this.fallbackSessions.delete(normalizedSessionId);
        try {
            this.sessionStorage?.removeItem(BACKUP_PREFIX + normalizedSessionId);
            if (this.sessionStorage?.getItem(ACTIVE_SESSION_KEY) === normalizedSessionId) {
                this.sessionStorage.removeItem(ACTIVE_SESSION_KEY);
            }
        } catch (_) {}

        if (!this.indexedDb) return;
        const db = await openDatabase(this.indexedDb, this.operationTimeoutMs);
        try {
            await checkpointTransaction(db, 'readwrite', this.operationTimeoutMs, transaction => {
                transaction.objectStore(STORE_NAME).delete(normalizedSessionId);
                const cursorRequest = transaction
                    .objectStore(SAMPLE_STORE_NAME)
                    .index('sessionId')
                    .openCursor(normalizedSessionId);
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor) return;
                    cursor.delete();
                    cursor.continue();
                };
            });
        } finally {
            db.close();
        }
    }
}
