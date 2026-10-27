// A timer tick is not a new camera measurement. No targets or coordinates enter
// this gate; missing/old/duplicate captures remain missing, never interpolated.
export function createValidationSamplingWindow({ monotonicStart, wallStart }) {
    if (![monotonicStart, wallStart].every(Number.isFinite)) throw new Error('invalid_validation_clock');
    const stats = { version: 'unique_capture.v1', attempted: 0, accepted: 0,
        duplicate: 0, beforeWindow: 0, missingTimestamp: 0, clockChanged: 0 };
    let clock = null, last = -Infinity;
    return {
        accept(prediction) {
            stats.attempted++;
            const kind = Number.isFinite(prediction?.frameTimestamp) ? 'monotonic'
                : Number.isFinite(prediction?.timestamp) ? 'wall' : null;
            if (!kind) { stats.missingTimestamp++; return false; }
            const timestamp = kind === 'monotonic' ? prediction.frameTimestamp : prediction.timestamp;
            if (clock && clock !== kind) { stats.clockChanged++; return false; }
            if (timestamp < (kind === 'monotonic' ? monotonicStart : wallStart)) {
                stats.beforeWindow++; return false;
            }
            if (timestamp <= last) { stats.duplicate++; return false; }
            clock = kind;
            last = timestamp;
            stats.accepted++;
            return true;
        },
        summary() { return { ...stats, clock }; }
    };
}

export function validationTargetCoverage(points, expectedTargets) {
    if (!Number.isSafeInteger(expectedTargets) || expectedTargets < 1 || expectedTargets > 9) {
        throw new Error('invalid_validation_targets');
    }
    const observed = new Set();
    for (const point of points || []) {
        if (Number.isInteger(point?.pointIndex) && point.pointIndex >= 0 && point.pointIndex < expectedTargets
            && point.samples?.some(sample => Number.isFinite(sample?.gazeX) && Number.isFinite(sample?.gazeY))) {
            observed.add(point.pointIndex);
        }
    }
    const missingTargetIndices = Array.from({ length: expectedTargets }, (_, i) => i).filter(i => !observed.has(i));
    return { version: 'target_coverage.v1', expectedTargets, observedTargets: observed.size,
        missingTargetIndices, complete: missingTargetIndices.length === 0 };
}
