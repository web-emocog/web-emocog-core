function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function finiteDistance(distance) {
    return Number.isFinite(distance?.rmsZ) && Number.isFinite(distance?.peakZ);
}

export function scalePointBetweenViewports(point, fromViewport, toViewport) {
    if (
        !Number.isFinite(point?.x)
        || !Number.isFinite(point?.y)
        || !Number.isFinite(fromViewport?.width)
        || !Number.isFinite(fromViewport?.height)
        || !Number.isFinite(toViewport?.width)
        || !Number.isFinite(toViewport?.height)
        || fromViewport.width <= 0
        || fromViewport.height <= 0
        || toViewport.width <= 0
        || toViewport.height <= 0
    ) return null;
    return {
        x: point.x * (toViewport.width / fromViewport.width),
        y: point.y * (toViewport.height / fromViewport.height)
    };
}

export class AdaptiveGazeFilter {
    constructor(options = {}) {
        this.minCutoffHz = options.minCutoffHz ?? 1.35;
        this.maxCutoffHz = options.maxCutoffHz ?? 12;
        this.velocityGain = options.velocityGain ?? 5.5;
        this.reset();
    }

    reset() {
        this.lastInput = null;
        this.lastOutput = null;
    }

    update(point, timestampMs, viewport) {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
        const timestamp = Number.isFinite(timestampMs) ? timestampMs : Date.now();
        if (!this.lastInput || !this.lastOutput) {
            this.lastInput = { x: point.x, y: point.y, timestamp };
            this.lastOutput = { x: point.x, y: point.y };
            return { x: point.x, y: point.y, alpha: 1, velocityViewportPerSec: 0 };
        }

        const dtSec = clamp((timestamp - this.lastInput.timestamp) / 1000, 1 / 120, 0.25);
        const diagonal = Math.max(1, Math.hypot(viewport?.width || 1, viewport?.height || 1));
        // Velocity is measured from consecutive corrected inputs, never from
        // the lagging display output. This prevents a stale path from feeding
        // back into the smoothing gain.
        const velocity = Math.hypot(
            point.x - this.lastInput.x,
            point.y - this.lastInput.y
        ) / diagonal / dtSec;
        const cutoff = clamp(
            this.minCutoffHz + this.velocityGain * velocity,
            this.minCutoffHz,
            this.maxCutoffHz
        );
        const alpha = 1 - Math.exp(-2 * Math.PI * cutoff * dtSec);
        const x = this.lastOutput.x + alpha * (point.x - this.lastOutput.x);
        const y = this.lastOutput.y + alpha * (point.y - this.lastOutput.y);
        this.lastInput = { x: point.x, y: point.y, timestamp };
        this.lastOutput = { x, y };
        return { x, y, alpha, velocityViewportPerSec: velocity };
    }
}

export function fitDistribution(vectors, stdFloors = []) {
    if (!Array.isArray(vectors) || vectors.length === 0) return null;
    const width = Array.isArray(vectors[0]) ? vectors[0].length : 0;
    if (
        width === 0
        || !vectors.every(vector =>
            Array.isArray(vector)
            && vector.length === width
            && vector.every(Number.isFinite)
        )
    ) return null;
    const mean = new Array(width).fill(0);
    for (const vector of vectors) {
        for (let i = 0; i < width; i++) mean[i] += vector[i];
    }
    for (let i = 0; i < width; i++) mean[i] /= vectors.length;

    const std = new Array(width).fill(0);
    for (const vector of vectors) {
        for (let i = 0; i < width; i++) {
            const delta = vector[i] - mean[i];
            std[i] += delta * delta;
        }
    }
    for (let i = 0; i < width; i++) {
        std[i] = Math.max(
            Math.sqrt(std[i] / vectors.length),
            Number.isFinite(stdFloors[i]) ? stdFloors[i] : 1e-4
        );
    }
    return { mean, std };
}

export function distributionDistance(vector, distribution) {
    if (
        !Array.isArray(vector)
        || !distribution
        || vector.length === 0
        || vector.length !== distribution.mean?.length
        || vector.length !== distribution.std?.length
        || !vector.every(Number.isFinite)
        || !distribution.mean.every(Number.isFinite)
        || !distribution.std.every(value => Number.isFinite(value) && value > 0)
    ) {
        return { rmsZ: Infinity, peakZ: Infinity };
    }
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < vector.length; i++) {
        const z = Math.abs((vector[i] - distribution.mean[i]) / distribution.std[i]);
        const bounded = Math.min(z, 12);
        sum += bounded * bounded;
        peak = Math.max(peak, bounded);
    }
    return {
        rmsZ: Math.sqrt(sum / Math.max(1, vector.length)),
        peakZ: peak
    };
}

export function evaluateGazeGate({ baseConfidence, irisDistance, headDistance }) {
    if (
        !Number.isFinite(baseConfidence)
        || !finiteDistance(irisDistance)
        || !finiteDistance(headDistance)
    ) {
        return {
            accepted: false,
            confidence: 0,
            rejectionReason: 'invalid_feature_distribution',
            ood: {
                irisRmsZ: Number.isFinite(irisDistance?.rmsZ) ? irisDistance.rmsZ : null,
                irisPeakZ: Number.isFinite(irisDistance?.peakZ) ? irisDistance.peakZ : null,
                headRmsZ: Number.isFinite(headDistance?.rmsZ) ? headDistance.rmsZ : null,
                headPeakZ: Number.isFinite(headDistance?.peakZ) ? headDistance.peakZ : null
            }
        };
    }
    const irisRms = irisDistance?.rmsZ ?? Infinity;
    const headRms = headDistance?.rmsZ ?? Infinity;
    const irisPeak = irisDistance?.peakZ ?? Infinity;
    const headPeak = headDistance?.peakZ ?? Infinity;
    const oodPenalty = Math.exp(
        -0.06 * (irisRms ** 2)
        -0.015 * (headRms ** 2)
    );
    const confidence = clamp(baseConfidence * oodPenalty, 0, 1);

    let rejectionReason = null;
    if (headRms > 7 || headPeak > 11) rejectionReason = 'head_out_of_distribution';
    else if (irisRms > 5.5 || irisPeak > 10) rejectionReason = 'iris_out_of_distribution';
    else if (confidence < 0.28) rejectionReason = 'low_confidence';

    return {
        accepted: rejectionReason === null,
        confidence,
        rejectionReason,
        ood: {
            irisRmsZ: irisRms,
            irisPeakZ: irisPeak,
            headRmsZ: headRms,
            headPeakZ: headPeak
        }
    };
}
