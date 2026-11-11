// Scheduler gaps are technical observations, not estimates of missing camera frames.
export class LongSessionContinuity {
    constructor(saved = null, now = Date.now()) {
        this.snapshot = { schemaVersion: 'runtime_continuity.v1', backgroundCount: 0,
            schedulerGapCount: 0, knownBackgroundMs: 0, maxSchedulerGapMs: 0, ...saved };
        this.lastTick = now;
    }
    visibility(hidden, now = Date.now()) {
        if (hidden) {
            if (this.snapshot.backgroundStartedAt == null) {
                this.snapshot.backgroundStartedAt = now;
                this.snapshot.backgroundCount++;
            }
            return null;
        }
        const start = this.snapshot.backgroundStartedAt;
        this.snapshot.backgroundStartedAt = null;
        this.lastTick = now;
        if (start == null) return null;
        const gap = { reason: 'page_backgrounded', startTimestamp: start, endTimestamp: now,
            durationMs: Math.max(0, now - start), sampleCoverage: 'not_inferred' };
        this.snapshot.knownBackgroundMs += gap.durationMs;
        this.snapshot.lastGap = gap;
        return gap;
    }
    tick(now = Date.now(), expectedIntervalMs = 5000) {
        const previous = this.lastTick;
        this.lastTick = now;
        if (now - previous <= expectedIntervalMs * 3 || this.snapshot.backgroundStartedAt != null) return null;
        const gap = { reason: 'scheduler_gap', startTimestamp: previous, endTimestamp: now,
            durationMs: now - previous, sampleCoverage: 'not_inferred' };
        this.snapshot.schedulerGapCount++;
        this.snapshot.maxSchedulerGapMs = Math.max(this.snapshot.maxSchedulerGapMs, gap.durationMs);
        this.snapshot.lastGap = gap;
        return gap;
    }
}
