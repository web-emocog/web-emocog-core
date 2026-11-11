export class PrecheckWindow {
    constructor(policy) { this.policy = policy; this.reset(); }
    reset() { this.samples = []; this.lastFrame = null; this.lastNow = null; }

    update({ frameId, capturedAt, now, passed, criticalFailure = false }) {
        const p = this.policy;
        if (!Number.isFinite(now) || !Number.isFinite(capturedAt)
            || capturedAt > now || now - capturedAt > p.maxResultAgeMs || criticalFailure) {
            this.reset();
            return this.snapshot(now);
        }
        if (this.lastNow !== null && (now < this.lastNow || now - this.lastNow > p.maxGapMs)) this.reset();
        this.samples = this.samples.filter(row => now - row.at <= p.maxAgeMs);
        if (Number.isFinite(frameId) && frameId >= 0 && frameId !== this.lastFrame) {
            if (this.lastFrame !== null && frameId < this.lastFrame) this.reset();
            this.samples.push({ at: capturedAt, passed: passed === true });
            this.samples = this.samples.slice(-p.windowSize);
            this.lastFrame = frameId;
            this.lastNow = now;
        }
        return this.snapshot(now);
    }

    snapshot(now) {
        const p = this.policy, rows = this.samples;
        const last = rows[rows.length - 1];
        const fresh = !!last && Number.isFinite(now) && now >= last.at && now - last.at <= p.maxResultAgeMs;
        const successes = rows.filter(row => row.passed).length;
        const spanMs = last ? last.at - rows[0].at : 0;
        return { method: p.method, samples: rows.length, successes, spanMs,
            passed: fresh && rows.length === p.windowSize && spanMs >= p.minSpanMs
                && successes >= p.minSuccess && rows.slice(-p.recentSuccess).every(row => row.passed) };
    }
}
