import { fetchWithDeadline, throwIfRequestAborted, requestAbortError,
    withRequestAbort, waitForRequestDelay } from './http.mjs?v=20261110-integration1';

export function pinnedInvitationContentUrl(base, code, id, advertisedPath) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(code)
        || !/^[1-9]\d{0,9}$/.test(String(id)) || Number(id) > 2147483647) return null;
    const path = `/invitations/by-code/${encodeURIComponent(code)}/stimuli/${id}/content`;
    // The server advertises a relative route, not a redirect or a URL selected by the stimulus.
    return advertisedPath === path ? base + path : null;
}

// One bounded pool for invitation metadata and binaries. A 429 pauses the whole
// pool, not just one file, so queued files cannot amplify a rate-limit burst.
export function createInvitationRequestPool({
    concurrency = 3,
    retries = 2,
    maxWaitMs = 120000,
    fetchRequest = fetchWithDeadline,
    now = () => Date.now(),
    wait = null
} = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8
        || !Number.isInteger(retries) || retries < 0 || retries > 8
        || !Number.isFinite(maxWaitMs) || maxWaitMs < 0) throw new TypeError('Invalid invitation queue limits');
    let active = 0;
    let retryAt = 0;
    const queued = [];

    function rateLimitError(delay) {
        const error = new Error('Invitation requests are temporarily rate limited');
        error.httpStatus = 429;
        error.retryAfterMs = delay;
        return error;
    }

    async function perform(url, options, read, timeoutMs) {
        for (let attempt = 0; ; attempt++) {
            throwIfRequestAborted(options?.signal);
            while (retryAt > now()) {
                const delay = retryAt - now();
                if (delay > maxWaitMs) throw rateLimitError(delay);
                await (wait ? withRequestAbort(wait(delay), options?.signal)
                    : waitForRequestDelay(delay, options?.signal));
                throwIfRequestAborted(options?.signal);
            }
            try {
                return await fetchRequest(url, options, async (response, signal) => {
                    throwIfRequestAborted(options?.signal);
                    if (response.status !== 429) return read(response, signal);
                    const header = response.headers.get('Retry-After');
                    const seconds = header === null || header.trim() === '' ? NaN : Number(header);
                    const date = header ? Date.parse(header) : NaN;
                    const delay = Number.isFinite(seconds) && seconds >= 0
                        ? Math.ceil(seconds * 1000)
                        : (Number.isFinite(date) ? Math.max(0, date - now()) : 1000);
                    retryAt = Math.max(retryAt, now() + Math.max(250, delay));
                    // Release the error body/connection before waiting for the next window.
                    await response.body?.cancel().catch(() => {});
                    throw rateLimitError(retryAt - now());
                }, timeoutMs);
            } catch (error) {
                throwIfRequestAborted(options?.signal);
                if (error?.httpStatus !== 429 || attempt >= retries || error.retryAfterMs > maxWaitMs) throw error;
            }
        }
    }

    function drain() {
        while (active < concurrency && queued.length) {
            const task = queued.shift();
            task.removeAbort();
            if (task.args[1]?.signal?.aborted) { task.reject(requestAbortError()); continue; }
            active++;
            perform(...task.args).then(task.resolve, task.reject).finally(() => {
                active--;
                drain();
            });
        }
    }

    return (url, options, read, timeoutMs) => new Promise((resolve, reject) => {
        const signal = options?.signal;
        if (signal?.aborted) { reject(requestAbortError()); return; }
        const task = { args: [url, options, read, timeoutMs], resolve, reject,
            removeAbort: () => signal?.removeEventListener('abort', aborted) };
        const aborted = () => {
            const index = queued.indexOf(task);
            if (index >= 0) queued.splice(index, 1);
            task.removeAbort();
            reject(requestAbortError());
        };
        signal?.addEventListener('abort', aborted, { once: true });
        queued.push(task);
        drain();
    });
}
