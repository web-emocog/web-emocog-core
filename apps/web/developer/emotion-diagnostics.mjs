// Bounded, derived-only diagnostics. Counts actual analyzer calls, not UI refreshes.
export class EmotionDiagnostics {
    constructor(now = () => performance.now()) {
        this.now = now;
        this.started = null;
        this.lastAt = null;
        this.counts = { attempts: 0, success: 0, calibrating: 0, missing: 0 };
        this.reasons = {};
        this.latest = null;
    }

    record(sample, calibration) {
        const now = this.now();
        this.started ??= now;
        this.lastAt = now;
        this.counts.attempts++;
        const status = sample.status || 'unknown';
        const success = status === 'success' && !sample.degraded;
        this.counts[success ? 'success' : status === 'calibrating' ? 'calibrating' : 'missing']++;
        this.reasons[status] = (this.reasons[status] || 0) + 1;
        this.latest = {
            status, calibration,
            geometry: sample.geometry ?? null,
            unclippedGeometry: sample.unclippedGeometry ?? null,
            legacyUnclippedAU: sample.legacyUnclippedAU ?? null,
            rawAU: sample.rawActionUnits ?? null,
            adjustedAU: success ? sample.actionUnits : null,
            rawScores: success ? sample.rawScores : null,
            smoothedScores: success ? sample.modelScores : null,
            publishedScores: success ? sample.scores : null,
            dominant: success ? sample.dominant : null,
            valence: success ? sample.valence : null,
            arousal: success ? sample.arousal : null,
        };
    }

    snapshot() {
        const now = this.now();
        const elapsed = this.started == null ? 0 : now - this.started;
        return structuredClone({ schema: 'emotion_diagnostic.v1',
            counts: this.counts, statuses: this.reasons,
            // Mean cadence from first attempt to now, including stalls; not camera FPS.
            attemptHzSinceFirst: this.counts.attempts > 1 && elapsed > 0
                ? (this.counts.attempts - 1) * 1000 / elapsed : null,
            lastAttemptAgeMs: this.lastAt == null ? null : now - this.lastAt,
            latest: this.latest });
    }
}
