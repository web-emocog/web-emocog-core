import * as shared from '../../../shared/passive-valid-time.js?v=20261122-validtime1';
import { computeFrameFlags } from '../qc-metrics/frame-analysis.js?v=20261025-1';
import { qcGazeSignal } from '../gaze-tracker/qc-signal.mjs';

const api = shared.default || globalThis.WecogPassiveValidTime;
export const RECOVERABLE_VALID_TIME_CODES = new Set(['protocol_qc_fpsStable', 'protocol_qc_gazeValid',
    'protocol_qc_faceDetected', 'protocol_qc_lighting', 'face_missing', 'head_pose', 'face_occluded', 'low_light', 'low_fps']);
const same = (a, b) => a.join('|') === b.join('|');

export function validTimeFrameReasons({ frame, segmentation, gaze, metrics, definition, viewport, issues = [] }) {
    const flags = computeFrameFlags(frame, segmentation);
    const reasons = [];
    if (!frame || frame.error || frame.errorMessage) reasons.push('frame_analysis_failed');
    if (!flags.faceVisible) reasons.push('face_missing');
    if (!flags.poseOk) reasons.push('head_pose');
    if (!segmentation?.faceVisibility || segmentation.isComplete !== true
        || segmentation.faceVisibility.isComplete !== true) reasons.push('face_visibility_unavailable');
    if (flags.occlusionDetected) reasons.push('face_occluded');
    if (!qcGazeSignal(gaze, viewport)) reasons.push('protocol_qc_gazeValid');
    if (['too_dark', 'too_bright', 'dark', 'bright', 'error'].includes(String(frame?.illumination?.status || '').toLowerCase())) reasons.push('low_light');
    const rules = definition?.settings?.qualityControl?.rules || {};
    if (rules.lighting?.enabled && !flags.illuminationOk) reasons.push('protocol_qc_lighting');
    if (rules.fpsStable?.enabled && (!Number.isFinite(metrics?.analysisFps) || metrics.analysisFps < rules.fpsStable.threshold)) reasons.push('protocol_qc_fpsStable');
    if (Number.isFinite(metrics?.cameraFps) && metrics.cameraFps > 0 && metrics.cameraFps < 12) reasons.push('low_fps');
    for (const issue of issues) if (issue.invalidatesBlock !== false && !RECOVERABLE_VALID_TIME_CODES.has(issue.code)) reasons.push(issue.code);
    return [...new Set(reasons)].sort();
}

// All boundaries use the presentation's monotonic clock, never wall time.
export class PassiveValidTime {
    constructor({ startMs, targetMs, maxExtensionRatio = .5, minSegmentMs = 1000, onBreak = () => {} }) {
        if (!Number.isFinite(startMs) || !Number.isSafeInteger(targetMs) || targetMs < 1000
            || targetMs * (1 + maxExtensionRatio) > api.MAX_MS || minSegmentMs !== 1000
            || !Number.isFinite(maxExtensionRatio) || maxExtensionRatio < 0 || maxExtensionRatio > .5) throw new Error('valid_time_config_invalid');
        this.startMs = startMs;
        this.targetMs = targetMs;
        this.maxDurationMs = Math.floor(targetMs * (1 + maxExtensionRatio));
        this.minSegmentMs = minSegmentMs;
        this.onBreak = onBreak;
        this.through = 0;
        this.segmentStart = 0;
        this.reasons = ['qc_unobserved'];
        this.acceptedSegments = [];
        this.excludedSegments = [];
        this.acceptedClosedMs = 0;
        this.lastFrame = null;
        this.pendingGaze = [];
        this.queuedGaze = [];
        this.closed = false;
    }
    relative(now) { return Math.max(0, Math.floor(now - this.startMs)); }
    _closeSegment(end) {
        const start = this.segmentStart;
        if (end <= start) return;
        const observedEnd = this.reasons.length ? end : Math.max(start, Math.min(end, this.lastFrame ?? start));
        if (!this.reasons.length && observedEnd - start >= this.minSegmentMs) {
            this.acceptedSegments.push({ startMs: start, endMs: observedEnd });
            this.acceptedClosedMs += observedEnd - start;
            const pending = this.pendingGaze; this.pendingGaze = [];
            for (const item of pending) item.commit(item.sample);
        } else if (observedEnd > start) {
            this.excludedSegments.push({ startMs: start, endMs: observedEnd,
                reasons: this.reasons.length ? [...this.reasons] : ['valid_time_segment_too_short'] });
        }
        if (observedEnd < end) this.excludedSegments.push({ startMs: observedEnd, endMs: end, reasons: ['measurement_unobserved'] });
        if (this.acceptedSegments.length + this.excludedSegments.length >= api.MAX_SEGMENTS - 4) this.overflow = true;
        this.segmentStart = end;
    }
    _setReasons(reasons, at) {
        reasons = [...new Set(reasons)].sort();
        if (same(reasons, this.reasons)) return;
        this._closeSegment(at);
        if (reasons.length) { this.pendingGaze = []; this.onBreak(at); }
        this.reasons = reasons;
    }
    advance(now) {
        if (this.closed) return this.through;
        const end = Math.max(this.through, this.relative(now));
        const freshUntil = this.lastFrame === null ? this.through : this.lastFrame + 250;
        if (end > freshUntil && !this.reasons.length) this._setReasons(['measurement_gap'], Math.max(this.segmentStart, this.lastFrame ?? this.segmentStart));
        if (end >= this.maxDurationMs) this._setReasons(['valid_time_deadline'], Math.max(this.segmentStart, this.maxDurationMs));
        this.through = end;
        return end;
    }
    observe(now, reasons) {
        if (this.closed) return;
        const at = this.relative(now);
        if (!Number.isFinite(now) || now < this.startMs || at < this.segmentStart
            || (this.lastFrame !== null && at <= this.lastFrame) || at > this.maxDurationMs) {
            this.queuedGaze = []; return;
        }
        if (this.lastFrame !== null && at - this.lastFrame > 250 && !this.reasons.length) {
            this._setReasons(['measurement_gap'], this.lastFrame);
        }
        this.through = Math.max(this.through, at);
        this._setReasons(this.overflow ? ['valid_time_segment_limit'] : reasons, at);
        this.lastFrame = at;
        if (!this.reasons.length) {
            this.pendingGaze.push(...this.queuedGaze.filter(item => !Number.isFinite(item.captureMs)
                || item.captureMs >= this.startMs + this.segmentStart && item.captureMs <= now));
            if (at - this.segmentStart >= this.minSegmentMs) {
                const pending = this.pendingGaze; this.pendingGaze = [];
                for (const item of pending) item.commit(item.sample);
            } else if (this.pendingGaze.length > 256) {
                this.overflow = true;
                this._setReasons(['valid_time_segment_limit'], at);
            }
        }
        this.queuedGaze = [];
        if (at === this.maxDurationMs) this._setReasons(['valid_time_deadline'], at);
    }
    deferGaze(sample, commit, captureMs = null) {
        if (!this.closed && this.queuedGaze.length < 16) this.queuedGaze.push({ sample, commit, captureMs });
    }
    context(now) {
        this.advance(now);
        return { allowed: !this.reasons.length, segmentStartMs: !this.reasons.length ? this.startMs + this.segmentStart : null };
    }
    acceptedMs(now) {
        const end = this.advance(now);
        const observedEnd = Math.min(end, this.lastFrame ?? this.segmentStart);
        return this.acceptedClosedMs + (!this.reasons.length && observedEnd - this.segmentStart >= this.minSegmentMs ? observedEnd - this.segmentStart : 0);
    }
    done(now) { return this.acceptedMs(now) >= this.targetMs || this.relative(now) >= this.maxDurationMs || this.overflow === true; }
    snapshot(now, close = false) {
        const end = this.advance(now);
        if (close && !this.closed) {
            this._closeSegment(end);
            this.pendingGaze = []; this.queuedGaze = [];
            this.closed = true;
        }
        const accepted = [...this.acceptedSegments];
        const excluded = [...this.excludedSegments];
        if (!this.closed && end > this.segmentStart) {
            const observedEnd = this.reasons.length ? end : Math.max(this.segmentStart, Math.min(end, this.lastFrame ?? this.segmentStart));
            if (!this.reasons.length && observedEnd - this.segmentStart >= this.minSegmentMs) accepted.push({ startMs: this.segmentStart, endMs: observedEnd });
            else if (observedEnd > this.segmentStart) excluded.push({ startMs: this.segmentStart, endMs: observedEnd,
                reasons: this.reasons.length ? [...this.reasons] : ['valid_time_segment_too_short'] });
            if (observedEnd < end) excluded.push({ startMs: observedEnd, endMs: end, reasons: ['measurement_unobserved'] });
        }
        const acceptedMs = accepted.reduce((sum, segment) => sum + segment.endMs - segment.startMs, 0);
        const result = { schemaVersion: api.VERSION, targetMs: this.targetMs, acceptedMs, actualMs: end,
            maxDurationMs: this.maxDurationMs, extended: end > this.targetMs,
            limitReached: end >= this.maxDurationMs && acceptedMs < this.targetMs, acceptedSegments: accepted, excludedSegments: excluded };
        if (!api.validateResult(result)) throw new Error('valid_time_result_invalid');
        return result;
    }
}
