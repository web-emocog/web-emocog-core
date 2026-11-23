export const FRAME_HEADROOM = Object.freeze({ meanMs: 25, p95Ms: 30, p99Ms: 33, minSamples: 60 });

// Fixed-size, conservative 1 ms buckets. No frame history or pixels are retained.
export class FrameLatency {
    constructor() {
        this.buckets = new Float64Array(1002);
        this.samples = 0;
        this.totalMs = 0;
        this.maxMs = 0;
    }

    record(ms) {
        if (!Number.isFinite(ms) || ms < 0) return;
        this.buckets[Math.min(1001, Math.ceil(ms))]++;
        this.samples++;
        this.totalMs += ms;
        this.maxMs = Math.max(this.maxMs, ms);
    }

    percentile(fraction) {
        if (!this.samples) return null;
        const target = Math.ceil(this.samples * fraction);
        let count = 0;
        for (let i = 0; i < this.buckets.length; i++) {
            count += this.buckets[i];
            if (count >= target) return i === 1001 ? this.maxMs : i;
        }
        return this.maxMs;
    }

    snapshot() {
        return { samples: this.samples, meanMs: this.samples ? this.totalMs / this.samples : null,
            p95Ms: this.percentile(.95), p99Ms: this.percentile(.99), maxMs: this.samples ? this.maxMs : null };
    }
}

export function assessFrameHeadroom(summary, minSamples = FRAME_HEADROOM.minSamples) {
    if (!Number.isSafeInteger(minSamples) || minSamples < 1
        || !summary || !Number.isSafeInteger(summary.samples) || summary.samples < minSamples
        || !['meanMs', 'p95Ms', 'p99Ms'].every(key => Number.isFinite(summary[key]) && summary[key] >= 0)) return 'not_measured';
    return ['meanMs', 'p95Ms', 'p99Ms'].every(key => summary[key] <= FRAME_HEADROOM[key]) ? 'within_budget' : 'over_budget';
}
