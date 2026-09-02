export const RESPONSE_MODES = Object.freeze({
    KEYPRESS: 'keypress',
    CLICK: 'click',
    POINTER_INTENT: 'pointer_intent',
    NONE: 'none'
});

export const POINTER_INTENT_THRESHOLD_VERSION = 'pointer_intent.v1';

const ALLOWED_MODES = new Set(Object.values(RESPONSE_MODES));
const DEFAULT_POINTER_POLICY = Object.freeze({
    baselineMinMs: 250,
    baseDeadZonePx: 4,
    noiseMultiplier: 3,
    displacementMultiplier: 2.5,
    minDisplacementPx: 12,
    minVelocityPxPerSec: 120,
    dwellMs: 50,
    maxBaselineSamples: 256
});

function finite(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return sorted[index];
}

function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function normalizeResponseMode(config = {}, trial = {}) {
    const explicit = String(trial.responseMode || config.responseMode || '').trim().toLowerCase();
    if (ALLOWED_MODES.has(explicit)) return explicit;

    const legacy = String(config.responseType || '').trim().toLowerCase();
    if (legacy === 'click' || legacy === 'mouse' || legacy === 'pointer') return RESPONSE_MODES.CLICK;
    if (legacy === 'none') return RESPONSE_MODES.NONE;

    const expected = String(trial.correctResponse || trial.action || '').trim().toLowerCase();
    if (expected === 'click' || expected === 'mouse_click') return RESPONSE_MODES.CLICK;
    if (expected === 'pointerintent' || expected === 'pointer_intent' || expected === 'mouse_intent') {
        return RESPONSE_MODES.POINTER_INTENT;
    }
    // Backward compatibility: old protocols accepted keypresses, including commissions in no-go trials.
    return RESPONSE_MODES.KEYPRESS;
}

export function responseValueForMode(mode, keyboardEvent = null) {
    if (mode === RESPONSE_MODES.CLICK) return 'Click';
    if (mode === RESPONSE_MODES.POINTER_INTENT) return 'PointerIntent';
    if (mode !== RESPONSE_MODES.KEYPRESS || !keyboardEvent?.code) return null;
    if (keyboardEvent.code === 'Space') return 'Space';
    if (String(keyboardEvent.code).startsWith('Arrow')) return keyboardEvent.code;
    return null;
}

export class RtResponseCollector {
    constructor(options = {}) {
        this.mode = normalizeResponseMode({ responseMode: options.mode });
        this.target = options.target || globalThis.document || null;
        this.now = options.now || (() => globalThis.performance.now());
        this.setTimer = options.setTimer || ((callback, delay) => globalThis.setTimeout(callback, delay));
        this.clearTimer = options.clearTimer || (timer => globalThis.clearTimeout(timer));
        this.policy = { ...DEFAULT_POINTER_POLICY, ...(options.pointerPolicy || {}) };
        this.devicePixelRatio = Math.max(1, finite(options.devicePixelRatio, globalThis.devicePixelRatio || 1));
        this.baselineStartedAt = null;
        this.baselinePoints = [];
        this.lastPoint = null;
        this.currentPoint = null;
        this.origin = null;
        this.onDecision = null;
        this.armedAt = null;
        this.decided = false;
        this.candidateTimer = null;
        this.sampleCount = 0;
        this.maxDisplacementPx = 0;
        this.peakVelocityPxPerSec = 0;
        this.thresholds = null;
        this.boundKeydown = event => this._onKeydown(event);
        this.boundPointerDown = event => this._onPointerDown(event);
        this.boundPointerMove = event => this._onPointerMove(event);
    }

    startBaseline() {
        if (this.mode !== RESPONSE_MODES.POINTER_INTENT || !this.target) return;
        this.baselineStartedAt = this.now();
        this.target.addEventListener('pointermove', this.boundPointerMove, true);
    }

    arm(onDecision) {
        this.onDecision = typeof onDecision === 'function' ? onDecision : null;
        this.armedAt = this.now();
        if (!this.target || this.mode === RESPONSE_MODES.NONE) return;
        if (this.mode === RESPONSE_MODES.KEYPRESS) {
            this.target.addEventListener('keydown', this.boundKeydown, true);
            return;
        }
        if (this.mode === RESPONSE_MODES.CLICK) {
            this.target.addEventListener('pointerdown', this.boundPointerDown, true);
            return;
        }
        if (this.mode === RESPONSE_MODES.POINTER_INTENT) {
            if (this.baselineStartedAt == null) this.startBaseline();
            this.origin = this._baselineCenter() || this.currentPoint;
            this.thresholds = this._pointerThresholds();
        }
    }

    _baselineCenter() {
        if (!this.baselinePoints.length) return null;
        return {
            x: median(this.baselinePoints.map(point => point.x)),
            y: median(this.baselinePoints.map(point => point.y)),
            t: this.baselinePoints[this.baselinePoints.length - 1].t
        };
    }

    _pointerThresholds() {
        const center = this._baselineCenter();
        const radii = center
            ? this.baselinePoints.map(point => Math.hypot(point.x - center.x, point.y - center.y))
            : [];
        const jitterP95Px = percentile(radii, 0.95);
        const deadZonePx = Math.max(
            this.policy.baseDeadZonePx * this.devicePixelRatio,
            jitterP95Px * this.policy.noiseMultiplier
        );
        return {
            version: POINTER_INTENT_THRESHOLD_VERSION,
            baselineDurationMs: this.baselineStartedAt == null ? 0 : Math.max(0, this.armedAt - this.baselineStartedAt),
            baselineSampleCount: this.baselinePoints.length,
            jitterP95Px,
            deadZonePx,
            displacementPx: Math.max(this.policy.minDisplacementPx, deadZonePx * this.policy.displacementMultiplier),
            velocityPxPerSec: this.policy.minVelocityPxPerSec,
            dwellMs: this.policy.dwellMs
        };
    }

    _pointFromEvent(event) {
        return {
            x: finite(event.clientX),
            y: finite(event.clientY),
            t: this.now()
        };
    }

    _onPointerMove(event) {
        if (event?.isTrusted === false) return;
        const point = this._pointFromEvent(event);
        this.currentPoint = point;
        if (this.armedAt == null) {
            if (this.baselinePoints.length < this.policy.maxBaselineSamples) this.baselinePoints.push(point);
            this.lastPoint = point;
            return;
        }
        if (this.mode !== RESPONSE_MODES.POINTER_INTENT || this.decided) return;
        this.sampleCount += 1;
        if (!this.origin) this.origin = point;
        const displacement = Math.hypot(point.x - this.origin.x, point.y - this.origin.y);
        const dtMs = this.lastPoint ? Math.max(1, point.t - this.lastPoint.t) : 1;
        const step = this.lastPoint ? Math.hypot(point.x - this.lastPoint.x, point.y - this.lastPoint.y) : 0;
        const velocity = (step / dtMs) * 1000;
        this.lastPoint = point;
        this.maxDisplacementPx = Math.max(this.maxDisplacementPx, displacement);
        this.peakVelocityPxPerSec = Math.max(this.peakVelocityPxPerSec, velocity);

        const overThreshold = displacement >= this.thresholds.displacementPx
            && velocity >= this.thresholds.velocityPxPerSec;
        if (!overThreshold) {
            if (displacement < this.thresholds.deadZonePx) this._clearCandidate();
            return;
        }
        if (this.candidateTimer) return;
        this.candidateTimer = this.setTimer(() => {
            this.candidateTimer = null;
            if (this.decided || !this.currentPoint || !this.origin) return;
            const sustainedDisplacement = Math.hypot(
                this.currentPoint.x - this.origin.x,
                this.currentPoint.y - this.origin.y
            );
            if (sustainedDisplacement < this.thresholds.displacementPx) return;
            this._decide('PointerIntent', 'pointer_intent');
        }, this.thresholds.dwellMs);
    }

    _onKeydown(event) {
        if (this.decided) return;
        const response = responseValueForMode(RESPONSE_MODES.KEYPRESS, event);
        if (!response) return;
        this._decide(response, 'keyboard');
    }

    _onPointerDown(event) {
        if (this.decided || event.button !== 0 || event?.isTrusted === false) return;
        this._decide('Click', 'click');
    }

    _clearCandidate() {
        if (!this.candidateTimer) return;
        this.clearTimer(this.candidateTimer);
        this.candidateTimer = null;
    }

    _decide(response, inputType) {
        if (this.decided) return;
        this.decided = true;
        const decisionTimestampMs = this.now();
        const decision = {
            response,
            inputType,
            responseMode: this.mode,
            rtMs: this.armedAt == null ? null : Math.max(0, decisionTimestampMs - this.armedAt),
            decisionTimestampMs,
            pointerSummary: this.pointerSummary(decisionTimestampMs)
        };
        const callback = this.onDecision;
        this.dispose();
        callback?.(decision);
    }

    pointerSummary(decisionTimestampMs = null) {
        if (this.mode !== RESPONSE_MODES.POINTER_INTENT) return null;
        return {
            thresholdVersion: POINTER_INTENT_THRESHOLD_VERSION,
            baselineSampleCount: this.baselinePoints.length,
            baselineDurationMs: this.thresholds?.baselineDurationMs ?? (
                this.baselineStartedAt == null ? 0 : Math.max(0, (this.armedAt || this.now()) - this.baselineStartedAt)
            ),
            jitterP95Px: this.thresholds?.jitterP95Px ?? null,
            deadZonePx: this.thresholds?.deadZonePx ?? null,
            displacementThresholdPx: this.thresholds?.displacementPx ?? null,
            velocityThresholdPxPerSec: this.thresholds?.velocityPxPerSec ?? null,
            dwellMs: this.thresholds?.dwellMs ?? null,
            pointerSampleCount: this.sampleCount,
            maxDisplacementPx: this.maxDisplacementPx,
            peakVelocityPxPerSec: this.peakVelocityPxPerSec,
            decisionTimestampMs
        };
    }

    dispose() {
        this._clearCandidate();
        if (!this.target) return;
        this.target.removeEventListener('keydown', this.boundKeydown, true);
        this.target.removeEventListener('pointerdown', this.boundPointerDown, true);
        this.target.removeEventListener('pointermove', this.boundPointerMove, true);
    }
}
