import {
    preloadMediaBlob, readMediaResponse, throwIfMediaAborted, mediaAbortError, withMediaAbort
} from './media-preload.mjs?v=20261109-issues2';

// Managed encoded bytes, including a conservative 3x download/Blob/hash workspace.
// Browser decoder/GPU memory is not observable or bounded by this counter.
export const DEFAULT_MEDIA_BUDGET_BYTES = 256 * 1024 * 1024;
const WORKSPACE_COPIES = 3;

export class MediaPreparationError extends Error {
    constructor(code, message) { super(message); this.name = 'MediaPreparationError'; this.code = code; this.recoverable = true; }
}

export function mediaContentKey(scope, row) {
    return JSON.stringify([scope, row.sourceUrl, row.version ?? null, row.sha256 ?? null, row.mimeType, row.sizeBytes ?? null]);
}

export function createMediaCache({
    scope, request, budgetBytes = DEFAULT_MEDIA_BUDGET_BYTES,
    probe = preloadMediaBlob, environment = globalThis, onChange = () => {}
}) {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0 || typeof request !== 'function') {
        throw new TypeError('Invalid media cache configuration');
    }
    const entries = new Map(), controllers = new Set();
    let closed = false, residentBytes = 0, workingBytes = 0, peakBytes = 0, clock = 0;
    let queue = Promise.resolve();
    const snapshot = () => ({ scope, closed, budgetBytes, residentBytes, workingBytes, peakBytes,
        entries: entries.size, pinnedEntries: [...entries.values()].filter(entry => entry.pins > 0).length });
    const changed = (change = null) => { peakBytes = Math.max(peakBytes, residentBytes + workingBytes); onChange(snapshot(), change); };
    const keyFor = row => mediaContentKey(scope, row);
    const remove = entry => {
        if (entry.pins) return;
        entries.delete(entry.key);
        residentBytes -= entry.bytes;
        environment.URL.revokeObjectURL(entry.url);
        changed({ key: entry.key, url: null });
    };
    const budgetError = () => new MediaPreparationError('media_budget_exceeded',
        'This block and its download workspace do not fit the local media budget. No trials have started. Retry after releasing other session media, or ask the researcher to provide a block that fits this device. Files will not be streamed during trials.');
    const roomFor = bytes => {
        if (residentBytes + bytes <= budgetBytes) return;
        for (const entry of [...entries.values()].filter(entry => !entry.pins).sort((a, b) => a.used - b.used)) {
            if (residentBytes + bytes <= budgetBytes) break;
            remove(entry);
        }
        if (residentBytes + bytes > budgetBytes) throw budgetError();
    };

    async function load(row, signal) {
        if (typeof row.sourceUrl !== 'string' || !row.sourceUrl.trim()) {
            throw new MediaPreparationError('media_source_missing', 'The stimulus file is unavailable in this publication.');
        }
        let allocation = 0, url = null;
        const account = bytes => {
            const next = bytes * WORKSPACE_COPIES;
            if (!Number.isSafeInteger(next)) throw budgetError();
            roomFor(next);
            allocation = workingBytes = next;
            changed();
        };
        try {
            throwIfMediaAborted(signal);
            const blob = await withMediaAbort(request(row.sourceUrl,
                { credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal },
                (response, requestSignal) => readMediaResponse(response, {
                    signal: requestSignal || signal, account,
                    maxBytes: Math.floor((budgetBytes - residentBytes) / WORKSPACE_COPIES), mimeType: row.mimeType
                }), 120000), signal);
            throwIfMediaAborted(signal);
            if (!blob.size) throw new MediaPreparationError('media_empty', 'The stimulus file is empty.');
            account(blob.size);
            if (row.sizeBytes != null && blob.size !== row.sizeBytes) {
                throw new MediaPreparationError('media_size_mismatch', 'The stimulus size differs from the pinned publication.');
            }
            if (row.sha256) {
                if (!/^[a-f\d]{64}$/i.test(row.sha256)) {
                    throw new MediaPreparationError('media_hash_invalid', 'The pinned stimulus hash is invalid.');
                }
                const digest = await environment.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
                throwIfMediaAborted(signal);
                const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
                if (actual !== row.sha256.toLowerCase()) {
                    throw new MediaPreparationError('media_hash_mismatch', 'The stimulus differs from the pinned publication.');
                }
            }
            url = await probe(blob, row.mimeType, { signal, environment });
            throwIfMediaAborted(signal);
            const entry = { key: keyFor(row), url, bytes: blob.size, pins: 1, used: ++clock };
            entries.set(entry.key, entry);
            residentBytes += entry.bytes;
            workingBytes -= allocation;
            allocation = 0;
            changed({ key: entry.key, url });
            url = null;
            return entry;
        } finally {
            if (url) environment.URL.revokeObjectURL(url);
            workingBytes -= allocation;
            changed();
        }
    }

    async function acquire(rows, signal) {
        if (closed) throw mediaAbortError();
        throwIfMediaAborted(signal);
        const unique = new Map(rows.map(row => [keyFor(row), row]));
        const held = new Map();
        const release = () => {
            for (const entry of held.values()) {
                entry.pins--;
                if (closed && !entry.pins) remove(entry);
            }
            held.clear();
            changed();
        };
        try {
            // Protect all reusable files before any eviction for this block.
            for (const [key] of unique) {
                const entry = entries.get(key);
                if (entry) { entry.pins++; entry.used = ++clock; held.set(key, entry); }
            }
            const minimum = [...unique].reduce((sum, [key, row]) => sum + (entries.get(key)?.bytes || row.sizeBytes || 0), 0);
            if (minimum > budgetBytes) throw budgetError();
            for (const [key, row] of [...unique].sort((a, b) => (b[1].sizeBytes || 0) - (a[1].sizeBytes || 0))) {
                throwIfMediaAborted(signal);
                if (!held.has(key)) held.set(key, await load(row, signal));
            }
            throwIfMediaAborted(signal);
            let released = false;
            changed();
            return {
                valid: () => !released && !closed,
                urlFor: row => !released && !closed ? held.get(keyFor(row))?.url || null : null,
                release() { if (!released) { released = true; release(); } }
            };
        } catch (error) { release(); throw error; }
    }

    return {
        scope, snapshot,
        whenIdle: () => queue,
        urls: () => [...entries.values()].map(entry => entry.url),
        peek(row) { return closed ? null : entries.get(keyFor(row))?.url || null; },
        prepare(rows, { signal } = {}) {
            const controller = new AbortController();
            const aborted = () => controller.abort();
            signal?.addEventListener('abort', aborted, { once: true });
            if (signal?.aborted || closed) controller.abort();
            controllers.add(controller);
            const result = queue.then(() => acquire(rows, controller.signal));
            queue = result.then(() => {}, () => {});
            return result.finally(() => {
                controllers.delete(controller);
                signal?.removeEventListener('abort', aborted);
            });
        },
        dispose() {
            closed = true;
            for (const controller of controllers) controller.abort();
            for (const entry of [...entries.values()]) remove(entry);
            changed();
        }
    };
}
