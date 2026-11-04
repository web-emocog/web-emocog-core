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
    const timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid media probe timeout');
    if (!blob?.size) throw new Error('Stimulus preload returned an empty file');
    const expectedMime = String(declaredMimeType || '').toLowerCase();
    const actualMime = String(blob.type || expectedMime).toLowerCase();
    const kind = actualMime.startsWith('video/') || expectedMime.startsWith('video/') ? 'video' : 'image';
    if (actualMime && !actualMime.startsWith(`${kind}/`)) throw new Error(`Stimulus preload returned unexpected media type ${actualMime}`);
    const objectUrl = env.URL.createObjectURL(blob);
    let probe;
    try {
        probe = kind === 'video' ? env.document.createElement('video') : new env.Image();
        if (kind === 'video') { probe.muted = true; probe.playsInline = true; probe.preload = 'metadata'; }
        await new Promise((resolve, reject) => {
            let settled = false, decoding = false;
            const finish = error => {
                if (settled) return;
                settled = true;
                env.clearTimeout(timer);
                probe.onload = null; probe.onloadedmetadata = null; probe.onerror = null;
                if (error) reject(error); else resolve();
            };
            const timer = env.setTimeout(() => finish(new Error(`Stimulus ${kind} preparation timed out`)), timeoutMs);
            const ready = async () => {
                if (settled || decoding) return;
                decoding = true;
                try {
                    if (kind === 'image' && typeof probe.decode === 'function') await probe.decode();
                    finish();
                } catch (_) { finish(new Error(`Stimulus ${kind} could not be decoded`)); }
            };
            probe.onerror = () => finish(new Error(`Stimulus ${kind} could not be decoded`));
            if (kind === 'video') probe.onloadedmetadata = ready; else probe.onload = ready;
            try {
                probe.src = objectUrl;
                if (kind === 'video') probe.load();
                else if (probe.complete && probe.naturalWidth > 0) void ready();
            } catch (error) { finish(error); }
        });
        const width = kind === 'video' ? probe.videoWidth : probe.naturalWidth;
        const height = kind === 'video' ? probe.videoHeight : probe.naturalHeight;
        if (!(width > 0 && height > 0)) throw new Error(`Stimulus ${kind} has invalid dimensions`);
        return objectUrl;
    } catch (error) {
        env.URL.revokeObjectURL(objectUrl);
        throw error;
    } finally {
        if (probe) {
            probe.onload = null; probe.onloadedmetadata = null; probe.onerror = null;
            // Release only the temporary decoder; the caller still owns a successful Blob URL.
            try { if (kind === 'video') probe.pause(); } catch (_) {}
            try { probe.removeAttribute('src'); } catch (_) {}
            try { if (kind === 'video') probe.load(); } catch (_) {}
        }
    }
}
