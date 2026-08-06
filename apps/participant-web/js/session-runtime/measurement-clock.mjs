export function ensureMeasurementStart(sessionData, now = Date.now()) {
    if (!sessionData || typeof sessionData !== 'object') {
        throw new TypeError('sessionData is required');
    }

    const existing = Number(sessionData.startTime);
    if (Number.isFinite(existing) && existing > 0) {
        return existing;
    }

    const timestamp = Number(now);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        throw new TypeError('measurement start must be a positive timestamp');
    }

    sessionData.startTime = timestamp;
    return timestamp;
}
