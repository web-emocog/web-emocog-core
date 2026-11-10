import { fetchWithDeadline, withRequestAbort } from './http.mjs?v=20261109-issues2';

// Bound the whole preparation, not only the fetch: decoded probes consume memory too.
export async function mapMediaPreloads(rows, mapper, concurrency = 3) {
    if (!Array.isArray(rows) || typeof mapper !== 'function'
        || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new TypeError('Invalid media preload configuration');
    const results = new Array(rows.length);
    let cursor = 0, failed = false, failure;
    const consume = async () => {
        while (!failed && cursor < rows.length) {
            const index = cursor++;
            try { results[index] = await mapper(rows[index], index); }
            catch (error) { if (!failed) { failed = true; failure = error; } }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, consume));
    if (failed) throw failure;
    return results;
}
export async function preloadMediaBlob(blob, declaredMimeType = '', options = {}) {
    const env = options.environment || globalThis;
    const signal = options.signal;
    throwIfMediaAborted(signal);
    const timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid media probe timeout');
    if (!blob?.size) throw new Error('Stimulus preload returned an empty file');
    const expectedMime = String(declaredMimeType || '').toLowerCase();
    const actualMime = String(blob.type || expectedMime).toLowerCase();
    const family = /^(image|video|audio)\//.exec(expectedMime || actualMime)?.[1];
    const kind = family || 'image';
    if (actualMime && !actualMime.startsWith(`${kind}/`)) throw new Error(`Stimulus preload returned unexpected media type ${actualMime}`);
    const objectUrl = env.URL.createObjectURL(blob);
    let probe;
    try {
        probe = kind !== 'image' ? env.document.createElement(kind) : new env.Image();
        if (kind !== 'image') { probe.muted = true; probe.playsInline = true; probe.preload = 'metadata'; }
        await new Promise((resolve, reject) => {
            let settled = false, decoding = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                env.clearTimeout(timer);
                signal?.removeEventListener('abort', aborted);
                probe.onload = null; probe.onloadedmetadata = null; probe.onerror = null;
                if (error) reject(error); else resolve();
            };
            const timer = env.setTimeout(() => finish(new Error(`Stimulus ${kind} preparation timed out`)), timeoutMs);
            const aborted = () => finish(mediaAbortError());
            signal?.addEventListener('abort', aborted, { once: true });
            const ready = async () => {
                if (settled || decoding) return;
                decoding = true;
                try {
                    if (kind === 'image' && typeof probe.decode === 'function') await probe.decode();
                    finish();
                } catch (_) { finish(new Error(`Stimulus ${kind} could not be decoded`)); }
            };
            probe.onerror = () => finish(new Error(`Stimulus ${kind} could not be decoded`));
            if (kind !== 'image') probe.onloadedmetadata = ready; else probe.onload = ready;
            try {
                probe.src = objectUrl;
                if (kind !== 'image') probe.load();
                else if (probe.complete && probe.naturalWidth > 0) void ready();
            } catch (error) { finish(error); }
        });
        const width = kind === 'video' ? probe.videoWidth : probe.naturalWidth;
        const height = kind === 'video' ? probe.videoHeight : probe.naturalHeight;
        if (kind === 'audio' && !(Number.isFinite(probe.duration) && probe.duration > 0)) throw new Error('Stimulus audio has invalid duration');
        if (kind !== 'audio' && !(width > 0 && height > 0)) throw new Error(`Stimulus ${kind} has invalid dimensions`);
        throwIfMediaAborted(signal);
        return objectUrl;
    } catch (error) {
        env.URL.revokeObjectURL(objectUrl);
        throw error;
    } finally {
        if (probe) {
            probe.onload = null; probe.onloadedmetadata = null; probe.onerror = null;
            // Release only the temporary decoder; the caller still owns a successful Blob URL.
            try { if (kind !== 'image') probe.pause(); } catch (_) {}
            try { probe.removeAttribute('src'); } catch (_) {}
            try { if (kind !== 'image') probe.load(); } catch (_) {}
        }
    }
}

export function mediaAbortError() {
    const error = new Error('Media preparation cancelled');
    error.name = 'AbortError';
    return error;
}

export function throwIfMediaAborted(signal) {
    if (signal?.aborted) throw mediaAbortError();
}

export function withMediaAbort(promise, signal) {
    return withRequestAbort(promise, signal);
}

// Share the same header/body/caller deadline as JSON requests.
export async function fetchMediaWithDeadline(url, options, read, timeoutMs = 30000) {
    return fetchWithDeadline(url, options, read, timeoutMs);
}

// Never call response.blob() on an unbounded remote file. Account incrementally
// and cancel the body as soon as the budget, scope, or deadline is exceeded.
export async function readMediaResponse(response, { signal, account, maxBytes, mimeType = '' }) {
    if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const error = new Error(`Stimulus preparation failed: HTTP ${response.status}`);
        error.httpStatus = response.status;
        throw error;
    }
    const reader = response.body?.getReader?.();
    if (!reader) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Bounded stimulus download is unavailable in this browser');
    }
    const chunks = [];
    let total = 0, complete = false;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
        const length = Number(response.headers.get('Content-Length'));
        if (Number.isFinite(length) && length > maxBytes) account(length);
        for (;;) {
            throwIfMediaAborted(signal);
            const { value, done } = await withMediaAbort(reader.read(), signal);
            throwIfMediaAborted(signal);
            if (done) break;
            total += value.byteLength;
            account(total);
            chunks.push(value);
        }
        const blob = new Blob(chunks, { type: response.headers.get('Content-Type') || mimeType });
        complete = true;
        return blob;
    } finally {
        signal?.removeEventListener('abort', cancel);
        chunks.length = 0;
        if (!complete) cancel();
        try { reader.releaseLock(); } catch (_) { /* Cancellation may still be settling a pending read. */ }
    }
}
