import { buildInternalMask, extractActionUnits, validEmotionLandmarks } from './au-extractor.js?v=20261112-emotion1';

export function medianBaseline(samples) {
    return Object.fromEntries(Object.keys(samples[0]).map(key => {
        const values = samples.map(row => row[key]).sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        return [key, values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2];
    }));
}

export class NeutralCalibration {
    constructor(policy) { this.policy = policy; this.reset(); }
    reset() {
        this.startedAt = null; this.finishedAt = null; this.lastAt = -Infinity; this.lastFrame = null;
        this.samples = []; this.baseline = null; this.status = 'waiting';
    }
    begin(now) { this.reset(); this.startedAt = now; this.status = 'collecting'; }
    skip() { this.reset(); this.status = 'skipped'; }
    add(frame, now, visible = true) {
        if (this.status !== 'collecting') return this.snapshot(now);
        const elapsed = now - this.startedAt;
        if (!Number.isFinite(now) || elapsed < 0 || elapsed > this.policy.timeoutMs) {
            this.samples = []; this.status = 'timeout'; this.finishedAt = now;
            return this.snapshot(now);
        }
        const landmarks = frame?.landmarks;
        const valid = visible && !frame?.error && frame?.face?.detected === true
            && !['too_dark', 'too_bright'].includes(frame.illumination?.status)
            && !frame.pose?.isTilted
            && validEmotionLandmarks(landmarks)
            && Number.isFinite(frame.timestamp) && frame.timestamp <= now && now - frame.timestamp <= 1000;
        if (!valid || frame.timestamp === this.lastFrame || now - this.lastAt < this.policy.intervalMs) return this.snapshot(now);
        const au = extractActionUnits(landmarks, buildInternalMask(landmarks).geometry);
        if (!Object.values(au).every(value => Number.isFinite(value))) return this.snapshot(now);
        this.lastAt = now; this.lastFrame = frame.timestamp;
        this.samples.push(au);
        if (this.samples.length >= this.policy.minSamples && elapsed >= this.policy.minDurationMs) {
            // Median makes the neutral reference less sensitive to a brief blink.
            this.baseline = medianBaseline(this.samples);
            this.status = 'ready';
            this.finishedAt = now;
            this.acceptedSamples = this.samples.length;
            this.samples = [];
        }
        this.onAccepted?.(landmarks, this.snapshot(now));
        return this.snapshot(now);
    }
    snapshot(now) {
        return { method: this.policy.method, status: this.status,
            acceptedSamples: this.status === 'ready' ? this.acceptedSamples : this.samples.length,
            requiredSamples: this.policy.minSamples, minDurationMs: this.policy.minDurationMs,
            elapsedMs: this.startedAt === null || !Number.isFinite(now) ? 0 : Math.max(0, (this.finishedAt ?? now) - this.startedAt) };
    }
}
