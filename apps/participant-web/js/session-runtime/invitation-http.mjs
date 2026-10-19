import { fetchWithDeadline } from './http.mjs?v=20261019-5';

// One bounded pool for invitation metadata and binaries. A 429 pauses the whole
// pool, not just one file, so queued files cannot amplify a rate-limit burst.
export function createInvitationRequestPool({
    concurrency = 3,
    retries = 2,
    maxWaitMs = 120000,
    fetchRequest = fetchWithDeadline,
    now = () => Date.now(),
    wait = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
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
            while (retryAt > now()) {
                const delay = retryAt - now();
                if (delay > maxWaitMs) throw rateLimitError(delay);
                await wait(delay);
            }
            try {
                return await fetchRequest(url, options, async response => {
                    if (response.status !== 429) return read(response);
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
                if (error?.httpStatus !== 429 || attempt >= retries || error.retryAfterMs > maxWaitMs) throw error;
            }
        }
    }

    function drain() {
        while (active < concurrency && queued.length) {
            const task = queued.shift();
            active++;
            perform(...task.args).then(task.resolve, task.reject).finally(() => {
                active--;
                drain();
            });
        }
    }

    return (url, options, read, timeoutMs) => new Promise((resolve, reject) => {
        queued.push({ args: [url, options, read, timeoutMs], resolve, reject });
        drain();
    });
}
