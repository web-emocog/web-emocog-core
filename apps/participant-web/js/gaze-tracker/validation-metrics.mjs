// Shared production/diagnostic validation math. Existing thresholds and trimming
// are unchanged. precisionPx is SD of radial ERROR, not fixation jitter.
import { applyResidualBiasCorrection, evaluateIndependentCorrectionBenchmark, evaluateResidualBiasLOOCV, fitResidualBias,
    shouldApplyResidualBiasCorrection } from './bias-correction.mjs';

export function calculateValidationMetrics(points, viewport) {
    if (!points || points.length === 0) {
        return {
            accuracyPx: Infinity,
            accuracyPct: Infinity,
            precisionPx: Infinity,
            precisionPct: Infinity,
            biasX: 0,
            biasY: 0,
            biasXPct: 0,
            biasYPct: 0,
            validSamples: 0,
            totalSamples: 0
        };
    }

    // Диагональ экрана в px — универсальный нормализатор
    const screenW = viewport.width;
    const screenH = viewport.height;
    const screenDiag = Math.sqrt(screenW * screenW + screenH * screenH);

    let allErrors = [];
    let allBiasX = [];
    let allBiasY = [];
    let totalSamples = 0;
    let validSamples = 0;

    points.forEach(pointData => {
        const samples = pointData.samples || [];
        totalSamples += samples.length;

        samples.forEach(s => {
            if (Number.isFinite(s.gazeX) && Number.isFinite(s.gazeY)) {
                validSamples++;
                const errorX = s.gazeX - s.targetX;
                const errorY = s.gazeY - s.targetY;
                const error = Math.sqrt(errorX * errorX + errorY * errorY);
                allErrors.push(error);
                allBiasX.push(errorX);
                allBiasY.push(errorY);
            }
        });
    });

    if (allErrors.length === 0) {
        return {
            accuracyPx: Infinity,
            accuracyPct: Infinity,
            precisionPx: Infinity,
            precisionPct: Infinity,
            biasX: 0,
            biasY: 0,
            biasXPct: 0,
            biasYPct: 0,
            validSamples: 0,
            totalSamples: totalSamples
        };
    }

    // Accuracy = средняя ошибка (mean error)
    const accuracyPx = allErrors.reduce((a, b) => a + b, 0) / allErrors.length;

    // Precision = стандартное отклонение ошибки
    const mean = accuracyPx;
    const squaredDiffs = allErrors.map(e => Math.pow(e - mean, 2));
    const precisionPx = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length);

    // Bias = систематическое смещение (средний вектор ошибки)
    const biasX = allBiasX.reduce((a, b) => a + b, 0) / allBiasX.length;
    const biasY = allBiasY.reduce((a, b) => a + b, 0) / allBiasY.length;

    // % от диагонали экрана — универсальная метрика
    const accuracyPct = (accuracyPx / screenDiag) * 100;
    const precisionPct = (precisionPx / screenDiag) * 100;
    const biasXPct = (biasX / screenW) * 100;
    const biasYPct = (biasY / screenH) * 100;

    return {
        accuracyPx: accuracyPx,
        accuracyPct: Math.round(accuracyPct * 10) / 10,   // % диагонали
        precisionPx: precisionPx,
        precisionPct: Math.round(precisionPct * 10) / 10,  // % диагонали
        biasX: biasX,
        biasY: biasY,
        biasXPct: Math.round(biasXPct * 10) / 10,          // % ширины
        biasYPct: Math.round(biasYPct * 10) / 10,          // % высоты
        validSamples: validSamples,
        totalSamples: totalSamples,
        validPct: totalSamples > 0 ? (validSamples / totalSamples * 100).toFixed(1) : '0.0',
        screenDiag: Math.round(screenDiag),
        screenSize: { width: screenW, height: screenH }
    };
}


export function filterValidationPointsForMetrics(points, keepRatio = 0.8) {
    const safeKeepRatio = Math.max(0.55, Math.min(0.95, keepRatio));
    let totalSamples = 0;
    let keptSamples = 0;
    const filteredPoints = (points || []).map(pointData => {
        const validSamples = (pointData?.samples || []).filter(sample =>
            Number.isFinite(sample?.gazeX) && Number.isFinite(sample?.gazeY)
        );
        totalSamples += validSamples.length;

        if (validSamples.length < 12) {
            keptSamples += validSamples.length;
            return {
                ...pointData,
                samples: validSamples
            };
        }

        const centerX = validSamples.reduce((acc, sample) => acc + sample.gazeX, 0) / validSamples.length;
        const centerY = validSamples.reduce((acc, sample) => acc + sample.gazeY, 0) / validSamples.length;
        const rankedByDistance = validSamples
            .map(sample => ({
                sample,
                dist: Math.hypot(sample.gazeX - centerX, sample.gazeY - centerY)
            }))
            .sort((a, b) => a.dist - b.dist);

        const keepCount = Math.max(10, Math.round(validSamples.length * safeKeepRatio));
        const filteredSamples = rankedByDistance.slice(0, keepCount).map(item => item.sample);
        keptSamples += filteredSamples.length;

        return {
            ...pointData,
            samples: filteredSamples
        };
    });

    return {
        points: filteredPoints,
        stats: {
            method: 'cluster_trim',
            keepRatio: safeKeepRatio,
            totalSamples,
            keptSamples,
            removedSamples: Math.max(0, totalSamples - keptSamples),
            keptPct: totalSamples > 0 ? Math.round((keptSamples / totalSamples) * 1000) / 10 : 0
        }
    };
}


// Correction targets only. Independent benchmark/test targets MUST NOT enter.
export function fitValidationCorrection(points, viewport) {
    const rawMetrics = calculateValidationMetrics(points, viewport);
    const filtered = filterValidationPointsForMetrics(points, 0.8);
    const filteredMetrics = calculateValidationMetrics(filtered.points, viewport);
    const correction = fitResidualBias(filtered.points, viewport);
    let postCalibrationCorrection = { fitted: false, applied: false, sampleFilter: filtered.stats };
    if (correction) {
        const correctedMetrics = calculateValidationMetrics(applyResidualBiasCorrection(filtered.points, correction), viewport);
        const loocv = evaluateResidualBiasLOOCV(filtered.points, viewport);
        postCalibrationCorrection = { fitted: true,
            applied: correctedMetrics.accuracyPx <= filteredMetrics.accuracyPx && shouldApplyResidualBiasCorrection(loocv),
            source: correction.source, sampleCount: correction.sampleCount, kind: correction.kind,
            offsetX: Math.round(correction.offsetX * 10) / 10, offsetY: Math.round(correction.offsetY * 10) / 10,
            trajectory: correction.trajectory, rawMetrics, filteredMetrics,
            correctedInSampleMetrics: correctedMetrics, loocv: loocv || { available: false } };
    }
    return { rawMetrics, filteredMetrics, postCalibrationCorrection, correction };
}

export function assessCorrectionBenchmark(points, viewport, correctionApplied) {
    const filteredBenchmark = filterValidationPointsForMetrics(points, 0.8);
    const correctedCandidatePoints = filteredBenchmark.points;
    const pointsForSignal = (xKey, yKey) => correctedCandidatePoints.map(point => ({ ...point,
        samples: point.samples.map(sample => ({ ...sample,
            gazeX: Number.isFinite(sample[xKey]) ? sample[xKey] : null,
            gazeY: Number.isFinite(sample[yKey]) ? sample[yKey] : null })) }));
    const baselinePoints = pointsForSignal('rawX', 'rawY');
    const rawMetrics = calculateValidationMetrics(baselinePoints, viewport);
    const correctedCandidateMetrics = calculateValidationMetrics(correctedCandidatePoints, viewport);
    const displayMetrics = calculateValidationMetrics(pointsForSignal('displayX', 'displayY'), viewport);
    const independentDecision = correctionApplied
        ? evaluateIndependentCorrectionBenchmark(rawMetrics, correctedCandidateMetrics)
        : { accepted: false, reason: 'correction_not_applied' };
    return { filteredBenchmark, correctedCandidatePoints, baselinePoints, rawMetrics,
        correctedCandidateMetrics, displayMetrics, independentDecision };
}
