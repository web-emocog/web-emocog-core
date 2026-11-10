// Bound both connection establishment and body consumption. A successful header
// alone does not mean the response body has arrived.
export function requestAbortError() {
    const error = new Error('Request cancelled');
    error.name = 'AbortError';
    return error;
}

export function throwIfRequestAborted(signal) {
    if (signal?.aborted) throw requestAbortError();
}

export function withRequestAbort(promise, signal) {
    if (!signal) return Promise.resolve(promise);
    return new Promise((resolve, reject) => {
        const finish = (callback, value) => {
            signal.removeEventListener('abort', aborted);
            callback(value);
        };
        const aborted = () => finish(reject, requestAbortError());
        signal.addEventListener('abort', aborted, { once: true });
        Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
        if (signal.aborted) aborted();
    });
}

export async function waitForRequestDelay(ms, signal) {
    throwIfRequestAborted(signal);
    let timer;
    try {
        await withRequestAbort(new Promise(resolve => { timer = setTimeout(resolve, ms); }), signal);
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchWithDeadline(url, options = {}, read, timeoutMs = 30000) {
    if (typeof read !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError('Invalid request deadline or reader');
    }
    const controller = new AbortController();
    const signal = options?.signal;
    let expired = false, response;
    const cancelBody = () => {
        try { void response?.body?.cancel().catch(() => {}); } catch (_) { /* Reader may own the body. */ }
    };
    const aborted = () => { controller.abort(); cancelBody(); };
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => { expired = true; aborted(); }, timeoutMs);
    try {
        throwIfRequestAborted(controller.signal);
        return await withRequestAbort(Promise.resolve().then(async () => {
            throwIfRequestAborted(controller.signal);
            response = await fetch(url, { ...options, signal: controller.signal });
            if (controller.signal.aborted) { cancelBody(); throw requestAbortError(); }
            const value = await read(response, controller.signal);
            throwIfRequestAborted(controller.signal);
            return value;
        }), controller.signal);
    } catch (error) {
        if (expired) {
            const timeout = new Error('Server response timed out');
            timeout.code = 'request_timeout';
            timeout.httpStatus = 408;
            throw timeout;
        }
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
    }
}
