const LEFT_EYE_OUTER = 362;
const LEFT_EYE_INNER = 263;
const RIGHT_EYE_OUTER = 33;
const RIGHT_EYE_INNER = 133;

function distance3d(a, b) {
    if (!a || !b) return null;
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    const dz = (a.z || 0) - (b.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function finiteOrNull(v) {
    return Number.isFinite(v) ? v : null;
}

function finiteMean(values) {
    const valid = (values || []).filter(Number.isFinite);
    if (valid.length === 0) return null;
    return valid.reduce((acc, value) => acc + value, 0) / valid.length;
}

function getEyeWidth(landmarks, idxA, idxB) {
    if (!Array.isArray(landmarks)) return null;
    const value = distance3d(landmarks[idxA], landmarks[idxB]);
    return Number.isFinite(value) && value > 0 ? value : null;
}

export function extractEyeSignalSample(precheckResult, fallbackTimestamp = Date.now()) {
    if (!precheckResult) return null;

    const eyes = precheckResult.eyes || {};
    const landmarks = Array.isArray(precheckResult.landmarks) ? precheckResult.landmarks : null;

    const leftEAR = finiteOrNull(eyes?.left?.ear);
    const rightEAR = finiteOrNull(eyes?.right?.ear);
    const earAvg = finiteMean([leftEAR, rightEAR]);

    const leftIrisRadius = finiteOrNull(eyes?.left?.iris?.radius);
    const rightIrisRadius = finiteOrNull(eyes?.right?.iris?.radius);
    const leftEyeWidth = getEyeWidth(landmarks, LEFT_EYE_OUTER, LEFT_EYE_INNER);
    const rightEyeWidth = getEyeWidth(landmarks, RIGHT_EYE_OUTER, RIGHT_EYE_INNER);

    const normalizedRadii = [];
    if (Number.isFinite(leftIrisRadius) && Number.isFinite(leftEyeWidth) && leftEyeWidth > 1e-6) {
        normalizedRadii.push(leftIrisRadius / leftEyeWidth);
    }
    if (Number.isFinite(rightIrisRadius) && Number.isFinite(rightEyeWidth) && rightEyeWidth > 1e-6) {
        normalizedRadii.push(rightIrisRadius / rightEyeWidth);
    }

    const pupilProxy = finiteMean(normalizedRadii);
    const hasAnySignal = [
        leftEAR,
        rightEAR,
        earAvg,
        leftIrisRadius,
        rightIrisRadius,
        leftEyeWidth,
        rightEyeWidth,
        pupilProxy
    ].some(Number.isFinite);

    if (!hasAnySignal && typeof eyes?.bothOpen !== 'boolean') {
        return null;
    }

    return {
        t: Number.isFinite(precheckResult.timestamp) ? precheckResult.timestamp : fallbackTimestamp,
        leftEAR,
        rightEAR,
        earAvg,
        bothOpen: eyes?.bothOpen === true,
        leftIrisRadius,
        rightIrisRadius,
        leftEyeWidth,
        rightEyeWidth,
        pupilProxy
    };
}
