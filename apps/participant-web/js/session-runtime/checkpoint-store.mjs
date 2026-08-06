const DB_NAME = 'wecog-participant-runtime';
const DB_VERSION = 2;
const STORE_NAME = 'session-checkpoints';
const SAMPLE_STORE_NAME = 'session-sample-chunks';
const ACTIVE_SESSION_KEY = 'wecog_active_session_id';
const CHECKPOINT_SCHEMA_VERSION = 3;
const CHUNKED_ARRAY_KEYS = Object.freeze(['eyeTracking', 'eyeSignals']);
const OMIT_KEYS = /^(email|e-mail|phone|phoneNumber|ip|ipAddress|userAgent|authorization|accessToken|refreshToken|ingestToken|cookie|fullName|displayName)$/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function openDatabase(indexedDb) {
    return new Promise((resolve, reject) => {
        const request = indexedDb.open(DB_NAME, DB_VERSION);
        let settled = false;
        const rejectOnce = error => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        request.onerror = () => rejectOnce(
            request.error || new Error('IndexedDB open failed')
        );
        request.onblocked = () => rejectOnce(
            new Error('IndexedDB upgrade blocked by another tab')
        );
        request.onupgradeneeded = () => {
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
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
    });
}

export class SessionCheckpointStore {
    constructor(options = {}) {
        this.indexedDb = options.indexedDB || globalThis.indexedDB || null;
        this.sessionStorage = options.sessionStorage || globalThis.sessionStorage || null;
        this.memory = new Map();
        this.persistedSampleCounts = new Map();
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
            // IndexedDB checkpoint still works if sessionStorage is unavailable.
        }
    }

    async save(sessionId, sessionData, machineSnapshot) {
        if (!sessionId) return false;
        const normalizedSessionId = String(sessionId);
        const useChunks = Boolean(this.indexedDb);
        const compactSource = useChunks ? { ...(sessionData || {}) } : (sessionData || {});
        if (useChunks) {
            for (const key of CHUNKED_ARRAY_KEYS) delete compactSource[key];
        }
        const previousCounts = this.persistedSampleCounts.get(normalizedSessionId) || {};
        const nextCounts = {};
        const sampleChunks = [];
        for (const key of CHUNKED_ARRAY_KEYS) {
            const samples = Array.isArray(sessionData?.[key]) ? sessionData[key] : [];
            const previousCount = Number.isInteger(previousCounts[key])
                ? previousCounts[key]
                : 0;
            if (previousCount > samples.length) {
                throw new Error(`Checkpoint sample array ${key} was truncated`);
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
        const db = await openDatabase(this.indexedDb);
        try {
            await new Promise((resolve, reject) => {
                const transaction = db.transaction(
                    [STORE_NAME, SAMPLE_STORE_NAME],
                    'readwrite'
                );
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error || new Error('Checkpoint save failed'));
                transaction.onabort = () => reject(transaction.error || new Error('Checkpoint save aborted'));
                transaction.objectStore(STORE_NAME).put(checkpoint);
                const chunkStore = transaction.objectStore(SAMPLE_STORE_NAME);
                for (const chunk of sampleChunks) chunkStore.add(chunk);
            });
            this.persistedSampleCounts.set(normalizedSessionId, nextCounts);
        } finally {
            db.close();
        }
        return true;
    }

    async load(sessionId = this.getActiveSessionId()) {
        if (!sessionId) return null;
        const normalizedSessionId = String(sessionId);
        if (!this.indexedDb) return this.memory.get(normalizedSessionId) || null;
        const db = await openDatabase(this.indexedDb);
        try {
            const { checkpoint, chunks } = await new Promise((resolve, reject) => {
                const transaction = db.transaction(
                    [STORE_NAME, SAMPLE_STORE_NAME],
                    'readonly'
                );
                const checkpointRequest = transaction
                    .objectStore(STORE_NAME)
                    .get(normalizedSessionId);
                const chunksRequest = transaction
                    .objectStore(SAMPLE_STORE_NAME)
                    .index('sessionId')
                    .getAll(normalizedSessionId);
                transaction.oncomplete = () => resolve({
                    checkpoint: checkpointRequest.result || null,
                    chunks: chunksRequest.result || []
                });
                transaction.onerror = () => reject(
                    transaction.error || new Error('Checkpoint load failed')
                );
                transaction.onabort = () => reject(
                    transaction.error || new Error('Checkpoint load aborted')
                );
            });
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
        try {
            if (this.sessionStorage?.getItem(ACTIVE_SESSION_KEY) === normalizedSessionId) {
                this.sessionStorage.removeItem(ACTIVE_SESSION_KEY);
            }
        } catch (_) {}

        if (!this.indexedDb) return;
        const db = await openDatabase(this.indexedDb);
        try {
            await new Promise((resolve, reject) => {
                const transaction = db.transaction(
                    [STORE_NAME, SAMPLE_STORE_NAME],
                    'readwrite'
                );
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error || new Error('Checkpoint clear failed'));
                transaction.onabort = () => reject(transaction.error || new Error('Checkpoint clear aborted'));
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
