function finite(value) {
    return Number.isFinite(value) ? Number(value) : null;
}

function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rms(values) {
    return values.length
        ? Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)
        : null;
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
    return sorted[Math.max(0, index)];
}

function rounded(value) {
    return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

export function computePerTargetMedians(points) {
    const result = [];
    for (const pointData of points || []) {
        const valid = (pointData?.samples || []).filter(sample =>
            Number.isFinite(sample?.gazeX)
            && Number.isFinite(sample?.gazeY)
            && Number.isFinite(sample?.targetX)
            && Number.isFinite(sample?.targetY)
        );
        if (!valid.length) continue;
        result.push({
            medianGazeX: median(valid.map(sample => sample.gazeX)),
            medianGazeY: median(valid.map(sample => sample.gazeY)),
            targetX: valid[0].targetX,
            targetY: valid[0].targetY,
            n: valid.length
        });
    }
    return result;
}

function correctionErrors(medians, offsetX, offsetY) {
    return medians.map(point => ({
        raw: Math.hypot(
            point.medianGazeX - point.targetX,
            point.medianGazeY - point.targetY
        ),
        corrected: Math.hypot(
            point.medianGazeX + offsetX - point.targetX,
            point.medianGazeY + offsetY - point.targetY
        )
    }));
}

export function fitResidualBiasFromMedians(medians, viewport = {}) {
    if (!Array.isArray(medians) || medians.length < 3) return null;
    const width = finite(viewport.width) || 1920;
    const height = finite(viewport.height) || 1080;
    const maxOffsetX = Math.max(24, width * 0.18);
    const maxOffsetY = Math.max(24, height * 0.18);
    let offsetX = 0;
    let offsetY = 0;
    const residuals = [];
    const trajectory = [];

    for (const point of medians) {
        residuals.push({
            x: point.targetX - point.medianGazeX,
            y: point.targetY - point.medianGazeY
        });
        const nextX = Math.max(
            -maxOffsetX,
            Math.min(maxOffsetX, residuals.reduce((sum, item) => sum + item.x, 0) / residuals.length)
        );
        const nextY = Math.max(
            -maxOffsetY,
            Math.min(maxOffsetY, residuals.reduce((sum, item) => sum + item.y, 0) / residuals.length)
        );
        const before = rms(residuals.map(item => Math.hypot(item.x - offsetX, item.y - offsetY)));
        const after = rms(residuals.map(item => Math.hypot(item.x - nextX, item.y - nextY)));
        if (Number.isFinite(after) && (!Number.isFinite(before) || after <= before + 1e-9)) {
            offsetX = nextX;
            offsetY = nextY;
        }
        trajectory.push({
            targetCount: residuals.length,
            offsetX: rounded(offsetX),
            offsetY: rounded(offsetY),
            rmsBeforePx: rounded(before),
            rmsAfterPx: rounded(after)
        });
    }

    return {
        kind: 'residual_bias',
        source: 'validation_residual_bias_loocv',
        offsetX,
        offsetY,
        targetCount: medians.length,
        sampleCount: medians.reduce((sum, point) => sum + (point.n || 0), 0),
        trajectory,
        viewport: { width, height }
    };
}

export function fitResidualBias(points, viewport = {}) {
    return fitResidualBiasFromMedians(computePerTargetMedians(points), viewport);
}

export function applyResidualBiasCorrection(points, correction) {
    const offsetX = finite(correction?.offsetX);
    const offsetY = finite(correction?.offsetY);
    if (offsetX == null || offsetY == null) return points || [];
    return (points || []).map(pointData => ({
        ...pointData,
        samples: (pointData?.samples || []).map(sample => {
            if (!Number.isFinite(sample?.gazeX) || !Number.isFinite(sample?.gazeY)) return sample;
            return {
                ...sample,
                gazeX: Math.round(sample.gazeX + offsetX),
                gazeY: Math.round(sample.gazeY + offsetY)
            };
        })
    }));
}

export function evaluateResidualBiasLOOCV(points, viewport = {}) {
    const medians = computePerTargetMedians(points);
    if (medians.length < 4) return null;
    const heldOut = [];
    for (let index = 0; index < medians.length; index += 1) {
        const fit = fitResidualBiasFromMedians(
            medians.filter((_, candidate) => candidate !== index),
            viewport
        );
        if (!fit) continue;
        const [errors] = correctionErrors([medians[index]], fit.offsetX, fit.offsetY);
        heldOut.push(errors);
    }
    if (heldOut.length !== medians.length) return null;
    const rawErrors = heldOut.map(item => item.raw);
    const correctedErrors = heldOut.map(item => item.corrected);
    const worsenedTargetCount = heldOut.filter(
        item => item.corrected > item.raw + 1
    ).length;
    const rawRms = rms(rawErrors);
    const correctedRms = rms(correctedErrors);
    return {
        rawTargetRmsPx: rounded(rawRms),
        loocvRmsHeldOutPx: rounded(correctedRms),
        rawTargetMedianPx: rounded(median(rawErrors)),
        loocvMedianHeldOutPx: rounded(median(correctedErrors)),
        rawTargetP95Px: rounded(percentile(rawErrors, 0.95)),
        loocvP95HeldOutPx: rounded(percentile(correctedErrors, 0.95)),
        rmsGainPx: rounded(rawRms - correctedRms),
        worsenedTargetCount,
        targetCount: medians.length
    };
}

export function shouldApplyResidualBiasCorrection(loocv) {
    if (
        !loocv
        || loocv.targetCount < 5
        || !Number.isFinite(loocv.rawTargetRmsPx)
        || !Number.isFinite(loocv.loocvRmsHeldOutPx)
    ) return false;
    const requiredGain = Math.max(2, loocv.rawTargetRmsPx * 0.01);
    return loocv.loocvRmsHeldOutPx <= loocv.rawTargetRmsPx - requiredGain
        && loocv.loocvMedianHeldOutPx <= loocv.rawTargetMedianPx
        && loocv.loocvP95HeldOutPx <= loocv.rawTargetP95Px
        && loocv.worsenedTargetCount === 0;
}

export function evaluateIndependentCorrectionBenchmark(rawMetrics, correctedMetrics) {
    const rawAccuracy = finite(rawMetrics?.accuracyPx);
    const correctedAccuracy = finite(correctedMetrics?.accuracyPx);
    const rawPrecision = finite(rawMetrics?.precisionPx);
    const correctedPrecision = finite(correctedMetrics?.precisionPx);
    const rawBias = Math.hypot(
        finite(rawMetrics?.biasX) ?? Infinity,
        finite(rawMetrics?.biasY) ?? Infinity
    );
    const correctedBias = Math.hypot(
        finite(correctedMetrics?.biasX) ?? Infinity,
        finite(correctedMetrics?.biasY) ?? Infinity
    );
    if (
        rawAccuracy == null
        || correctedAccuracy == null
        || rawPrecision == null
        || correctedPrecision == null
        || !Number.isFinite(rawBias)
        || !Number.isFinite(correctedBias)
    ) {
        return { accepted: false, reason: 'independent_benchmark_unavailable' };
    }
    const requiredAccuracyGainPx = Math.max(1, rawAccuracy * 0.005);
    const precisionTolerancePx = Math.max(1, rawPrecision * 0.03);
    const accepted = correctedAccuracy <= rawAccuracy - requiredAccuracyGainPx
        && correctedPrecision <= rawPrecision + precisionTolerancePx
        && correctedBias <= rawBias;
    return {
        accepted,
        reason: accepted ? null : 'independent_benchmark_regression',
        requiredAccuracyGainPx: rounded(requiredAccuracyGainPx),
        accuracyGainPx: rounded(rawAccuracy - correctedAccuracy),
        precisionDeltaPx: rounded(correctedPrecision - rawPrecision),
        biasGainPx: rounded(rawBias - correctedBias)
    };
}
