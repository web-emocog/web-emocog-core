// Immutable sample series only. Mutable accepted results stay in the atomic snapshot.
export const CHECKPOINT_SERIES = Object.freeze([
    'eyeTracking', 'eyeSignals', 'emotionSamples', 'bodyPoseSamples',
    'emotionEvents', 'events', 'trackingTest'
]);
export const RETENTION_VERSION = 'checkpoint_retention.v1';
export const SAMPLE_CHUNK_SIZE = 512;

const fingerprint = value => value === undefined ? null : JSON.stringify(value);
const timestamp = sample => sample?.t ?? sample?.timestamp ?? sample?.time;

export function describeSeries(samples) {
    return { count: samples.length, firstTimestamp: timestamp(samples[0]) ?? null,
        lastTimestamp: timestamp(samples.at(-1)) ?? null };
}

export function planSeries(samples, previous = null, { fingerprint: boundaryFingerprint = fingerprint } = {}) {
    const head = boundaryFingerprint(samples[0]);
    let offset = 0, reset = !previous, reason = previous ? null : 'initial_snapshot';
    if (previous) {
        if (!previous.count) offset = previous.to;
        else if (previous.count && head === previous.head && samples.length >= previous.count
            && boundaryFingerprint(samples[previous.count - 1]) === previous.tail) offset = previous.from;
        else if (previous.count && samples.length) {
            // Rolling buffers have increasing capture clocks. Locate the old tail in O(log n),
            // not a full retained-window rewrite after every source shift().
            const target = previous.lastTimestamp;
            let lo = 0, hi = samples.length;
            if (typeof target === 'number' && Number.isFinite(target)) {
                while (lo < hi) {
                    const mid = (lo + hi) >>> 1;
                    if (timestamp(samples[mid]) < target) lo = mid + 1;
                    else hi = mid;
                }
                while (lo < samples.length && timestamp(samples[lo]) === target
                    && boundaryFingerprint(samples[lo]) !== previous.tail) lo++;
            } else lo = samples.length;
            if (lo < samples.length && boundaryFingerprint(samples[lo]) === previous.tail) offset = previous.to - lo - 1;
            else { reset = true; reason = 'source_replaced_or_nonoverlapping_window'; }
        } else { reset = true; reason = 'source_cleared'; }
    }
    if (reset) offset = previous?.to || 0;
    const from = offset, to = offset + samples.length;
    const appendFrom = reset ? from : previous.to;
    const chunks = [];
    for (let cursor = appendFrom; cursor < to; cursor += SAMPLE_CHUNK_SIZE) {
        const end = Math.min(to, cursor + SAMPLE_CHUNK_SIZE);
        chunks.push({ from: cursor, to: end, samples: samples.slice(cursor - from, end - from) });
    }
    const removed = reset ? (previous?.count || 0) : Math.max(0, from - previous.from);
    const old = previous?.retention || {};
    const retention = { schemaVersion: RETENTION_VERSION, sourceWindowEvictedCount: (old.sourceWindowEvictedCount || 0) + removed,
        rebaseCount: (old.rebaseCount || 0) + (reset && previous ? 1 : 0),
        lastReason: reason || (removed ? 'source_retained_window_advanced' : old.lastReason || null),
        unobservedBetweenCheckpointsPossible: old.unobservedBetweenCheckpointsPossible === true
            || Boolean(previous && reset && samples.length),
        // This describes persistence coverage, not sample validity or an estimate of absent frames.
        coverage: removed || old.sourceWindowEvictedCount ? 'source_retained_window' : 'observed_source_series',
        snapshotAggregatesUnchanged: true };
    return { from, to, count: samples.length, head, tail: boundaryFingerprint(samples.at(-1)),
        lastTimestamp: timestamp(samples.at(-1)) ?? null, retention, reset, chunks };
}

export function restoreSeries(chunks, range, key) {
    if (!range || !Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to)
        || range.from < 0 || range.to < range.from) throw new Error(`Invalid checkpoint range for ${key}`);
    const result = [];
    let next = range.from;
    for (const chunk of chunks) {
        if (chunk.sampleType !== key || chunk.to <= range.from) continue;
        if (!Array.isArray(chunk.samples) || chunk.to - chunk.from !== chunk.samples.length
            || chunk.from > next || chunk.to <= next || chunk.to > range.to) {
            throw new Error(`Checkpoint sample chunks incomplete or overlapping for ${key}`);
        }
        const start = Math.max(next, chunk.from);
        for (let index = start - chunk.from; index < chunk.samples.length; index++) result.push(chunk.samples[index]);
        next = chunk.to;
    }
    if (next !== range.to) throw new Error(`Checkpoint sample chunks incomplete for ${key}`);
    return result;
}
