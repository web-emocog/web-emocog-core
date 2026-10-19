// Bound both connection establishment and body consumption. A successful header
// alone does not mean the response body has arrived.
export async function fetchWithDeadline(url, options, read, timeoutMs = 30000) {
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const error = new Error('Server response timed out');
            error.code = 'request_timeout';
            error.httpStatus = 408;
            reject(error);
            controller.abort();
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            Promise.resolve().then(async () => read(await fetch(url, { ...options, signal: controller.signal }), controller.signal)),
            expired
        ]);
    } finally {
        clearTimeout(timer);
    }
}
