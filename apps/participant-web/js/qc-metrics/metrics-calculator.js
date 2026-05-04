/**
 * Metrics Calculator
 *
 * Расчёт QC Score и итоговых метрик.
 * Формула синхронизирована с production-обёрткой qc-metrics.js v3.5.
 *
 * @module qc-metrics/metrics-calculator
 */

import { DEFAULT_THRESHOLDS, QC_WEIGHTS, QC_PENALTIES } from './constants.js';
import { round1, round3, clamp01 } from './helpers.js';
import { computePercentages } from './frame-analysis.js';
import { getValidationMetrics, getTrackingDeviationMetrics } from './validation.js';

/**
 * Вычисление QC Score (0-1, 3 знака после запятой).
 *
 * Формула: взвешенная сумма нормализованных метрик с per-penalty штрафами
 * за провал отдельных проверок. Совпадает с qc-metrics.js v3.5.
 *
 * @param {Object} percentages
 * @param {Object} thresholds
 * @param {Object} weights
 * @param {Object} counters
 * @param {number} durationMs
 * @param {Object} validation - результат getValidationMetrics() (для gazeAccuracy)
 * @returns {number}
 */
export function computeQcScore(
    percentages,
    thresholds = DEFAULT_THRESHOLDS,
    weights = QC_WEIGHTS,
    counters = null,
    durationMs = 0,
    validation = null
) {
    const nPct = x => clamp01(x / 100);
    const nInvPct = x => clamp01(1 - x / 100);

    const faceVis = nPct(percentages.faceVisiblePct);
    const faceOk = nPct(percentages.faceOkPct);
    const poseOk = nPct(percentages.poseOkPct);
    const lightOk = nPct(percentages.illuminationOkPct);
    const eyesOpen = nPct(percentages.eyesOpenPct);
    const occlInv = nInvPct(percentages.occlusionPct);
    const gazeValid = nPct(percentages.gazeValidPct);
    const gazeOn = nPct(percentages.gazeOnScreenPct);
    const fpsOk = nInvPct(percentages.lowFpsPct || 0);

    let gazeAccuracy = 1.0;
    if (validation && validation.accuracyPct !== null) {
        const accThresh = thresholds.gaze_accuracy_pct_max;
        gazeAccuracy = clamp01(1 - (validation.accuracyPct / (accThresh * 2)));
    }

    let score =
        faceVis * weights.faceVis +
        faceOk * weights.faceOk +
        poseOk * weights.poseOk +
        lightOk * weights.lightOk +
        eyesOpen * weights.eyesOpen +
        occlInv * weights.occlInv +
        gazeValid * weights.gazeValid +
        gazeOn * weights.gazeOn +
        gazeAccuracy * (weights.gazeAccuracy || 0) +
        fpsOk * weights.fpsOk;

    // Hard penalties: умножение на (1 - factor) при провале конкретной проверки.
    if (durationMs > 0 && durationMs < thresholds.minDurationMs) {
        score *= (1 - QC_PENALTIES.duration);
    }
    if (percentages.faceVisiblePct < thresholds.face_visible_pct_min) {
        score *= (1 - QC_PENALTIES.faceVisible);
    }
    if (percentages.faceOkPct < thresholds.face_ok_pct_min) {
        score *= (1 - QC_PENALTIES.faceOk);
    }
    if (percentages.poseOkPct < thresholds.pose_ok_pct_min) {
        score *= (1 - QC_PENALTIES.poseOk);
    }
    if (percentages.illuminationOkPct < thresholds.illumination_ok_pct_min) {
        score *= (1 - QC_PENALTIES.illumination);
    }
    if (percentages.occlusionPct > thresholds.occlusion_pct_max) {
        score *= (1 - QC_PENALTIES.occlusion);
    }
    if (percentages.gazeValidPct < thresholds.gaze_valid_pct_min) {
        score *= (1 - QC_PENALTIES.gazeValid);
    }
    if (percentages.gazeOnScreenPct < thresholds.gaze_on_screen_pct_min) {
        score *= (1 - QC_PENALTIES.gazeOnScreen);
    }
    if (validation && validation.accuracyPct !== null &&
        validation.accuracyPct > thresholds.gaze_accuracy_pct_max) {
        score *= (1 - QC_PENALTIES.gazeAccuracy);
    }
    if (counters && counters.totalLowFpsMs > thresholds.maxLowFpsTimeMs) {
        score *= (1 - QC_PENALTIES.lowFps);
    }

    return round3(clamp01(score));
}

/**
 * Получение текущих метрик.
 */
export function getCurrentMetrics(counters, gazeState, fpsMonitor, startTime, thresholds = DEFAULT_THRESHOLDS, validationState = null) {
    const percentages = computePercentages(counters);
    const durationMs = Date.now() - startTime;
    const validation = validationState ? getValidationMetrics(validationState) : null;
    const qcScore = computeQcScore(percentages, thresholds, QC_WEIGHTS, counters, durationMs, validation);

    return {
        durationMs,
        totalFrames: counters.totalFrames,
        qcScore,

        faceVisiblePct: round1(percentages.faceVisiblePct),
        faceOkPct: round1(percentages.faceOkPct),
        poseOkPct: round1(percentages.poseOkPct),
        illuminationOkPct: round1(percentages.illuminationOkPct),
        eyesOpenPct: round1(percentages.eyesOpenPct),
        occlusionPct: round1(percentages.occlusionPct),
        gazeValidPct: round1(percentages.gazeValidPct),
        gazeOnScreenPct: round1(percentages.gazeOnScreenPct),

        analysisFps: fpsMonitor?.getCurrentFps() || 0,
        cameraFps: fpsMonitor?.getCameraFps?.() || 0,
        baselineFps: fpsMonitor?.getBaselineFps() || null,
        lowFpsPct: round1(percentages.lowFpsPct),

        gazeValidTimeMs: gazeState.validTimeMs,
        gazeOnScreenTimeMs: gazeState.onScreenTimeMs,
        gazeTotal: counters.gazeTotal || 0,

        timestamp: Date.now()
    };
}

/**
 * Получение итогового summary с трекинг-девиацией и accuracy/precision проверками.
 */
export function getSummary(counters, gazeState, validationState, trackingDeviationState, fpsMonitor, startTime, thresholds = DEFAULT_THRESHOLDS) {
    const metrics = getCurrentMetrics(counters, gazeState, fpsMonitor, startTime, thresholds, validationState);
    const validation = getValidationMetrics(validationState);
    const trackingDeviation = getTrackingDeviationMetrics(trackingDeviationState, {
        validationAccuracyPx: validation.accuracyPx,
        baseRadiusPct: thresholds.tracking_on_target_base_radius_pct
    });

    const checks = {
        duration: metrics.durationMs >= thresholds.minDurationMs,
        faceVisible: metrics.faceVisiblePct >= thresholds.face_visible_pct_min,
        faceOk: metrics.faceOkPct >= thresholds.face_ok_pct_min,
        poseOk: metrics.poseOkPct >= thresholds.pose_ok_pct_min,
        illuminationOk: metrics.illuminationOkPct >= thresholds.illumination_ok_pct_min,
        eyesOpen: metrics.eyesOpenPct >= thresholds.eyes_open_pct_min,
        occlusion: metrics.occlusionPct <= thresholds.occlusion_pct_max,
        gazeValid: metrics.gazeValidPct >= thresholds.gaze_valid_pct_min,
        gazeOnScreen: metrics.gazeOnScreenPct >= thresholds.gaze_on_screen_pct_min,
        lowFps: counters.totalLowFpsMs <= thresholds.maxLowFpsTimeMs,
        consecutiveLowFps: counters.maxConsecutiveLowFpsMs <= thresholds.maxConsecutiveLowFpsMs
    };

    if (validation.accuracyPct !== null) {
        checks.gazeAccuracy = validation.accuracyPct <= thresholds.gaze_accuracy_pct_max;
        checks.gazePrecision = validation.precisionPct <= thresholds.gaze_precision_pct_max;
    }
    if (trackingDeviation.onTargetPct !== null) {
        checks.trackingOnTarget = trackingDeviation.onTargetPct >= thresholds.tracking_on_target_min_pct;
    }

    const passedChecks = Object.values(checks).filter(v => v === true).length;
    const totalChecks = Object.keys(checks).length;
    const overallPass = passedChecks === totalChecks;

    return {
        ...metrics,
        validation,
        trackingDeviation,
        checks,
        passedChecks,
        totalChecks,
        overallPass,

        counters: { ...counters },

        fpsHistory: fpsMonitor?.getHistory() || [],
        maxConsecutiveLowFpsMs: counters.maxConsecutiveLowFpsMs,
        totalLowFpsMs: counters.totalLowFpsMs
    };
}
