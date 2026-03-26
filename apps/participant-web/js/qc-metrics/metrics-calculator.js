/**
 * Metrics Calculator
 * 
 * Расчёт QC Score и итоговых метрик
 * 
 * @module qc-metrics/metrics-calculator
 */

import { DEFAULT_THRESHOLDS, QC_WEIGHTS, PENALTY_FACTORS } from './constants.js';
import { round1, round3, clamp01 } from './helpers.js';
import { computePercentages } from './frame-analysis.js';
import { getValidationMetrics, getTrackingDeviationMetrics } from './validation.js';

/**
 * Вычисление QC Score v3.5
 * 
 * Returns 0-1 with 3 decimal places.
 * 
 * ИЗМЕНЕНИЯ v3.5:
 * - ИСПРАВЛЕН баг: dropoutInv дублировал gazeValid (математически идентичны).
 *   Заменён на gazeAccuracy — плавный штраф по данным валидации.
 * - Hard penalties теперь используют PENALTY_FACTORS (разные по важности метрик).
 * - Добавлены hard penalties: illumination, poseOk, gazeAccuracy.
 * - Validation accuracy/precision теперь ВЛИЯЮТ на числовой qcScore,
 *   а не только на бинарные checks.
 * 
 * @param {Object} percentages - проценты метрик
 * @param {Object} thresholds - пороговые значения
 * @param {Object} weights - весовые коэффициенты
 * @param {Object} counters - счётчики (для penalty checks)
 * @param {number} durationMs - длительность сессии
 * @param {Object} validationMetrics - метрики валидации gaze (accuracyPct, precisionPct)
 * @returns {number} QC Score (0-1)
 */
export function computeQcScore(percentages, thresholds = DEFAULT_THRESHOLDS, weights = QC_WEIGHTS, counters = null, durationMs = 0, validationMetrics = null) {
    const nPct = x => clamp01(x / 100);
    const nInvPct = x => clamp01(1 - x / 100);
    
    // Normalize metrics
    const faceVis = nPct(percentages.faceVisiblePct);
    const faceOk = nPct(percentages.faceOkPct);
    const poseOk = nPct(percentages.poseOkPct);
    const lightOk = nPct(percentages.illuminationOkPct);
    const eyesOpen = nPct(percentages.eyesOpenPct);
    const occlInv = nInvPct(percentages.occlusionPct);
    const gazeValid = nPct(percentages.gazeValidPct);
    const gazeOn = nPct(percentages.gazeOnScreenPct);
    const fpsOk = nInvPct(percentages.lowFpsPct || 0);
    
    // === gazeAccuracy: плавный штраф по данным валидации ===
    // Если данных валидации нет — считаем нейтральным (1.0 = не штрафуем).
    // Если accuracy% > порога → плавно снижаем от 1.0 до 0.0.
    // Формула: 1 - clamp01((accuracy - threshold * 0.5) / (threshold * 1.5))
    //   - До 50% порога: score ≈ 1.0 (отлично)
    //   - На пороге: score ≈ 0.67
    //   - На 200% порога: score ≈ 0.0 (очень плохо)
    let gazeAccuracy = 1.0;
    if (validationMetrics && validationMetrics.accuracyPct !== null) {
        const accPct = validationMetrics.accuracyPct;
        const accThresh = thresholds.gaze_accuracy_pct_max;
        // Плавная шкала: от 0% ошибки (score=1) до 2× порога (score=0)
        gazeAccuracy = clamp01(1 - (accPct / (accThresh * 2)));
    }
    
    // Weighted average (sum of weights = 1.0)
    let score =
        faceVis * weights.faceVis +
        faceOk * weights.faceOk +
        poseOk * weights.poseOk +
        lightOk * weights.lightOk +
        eyesOpen * weights.eyesOpen +
        occlInv * weights.occlInv +
        gazeValid * weights.gazeValid +
        gazeOn * weights.gazeOn +
        gazeAccuracy * weights.gazeAccuracy +
        fpsOk * weights.fpsOk;
    
    // === Hard penalties (importance-based via PENALTY_FACTORS) ===
    // Формула: score *= (1 - factor). Чем выше factor, тем жёстче штраф.
    const pf = PENALTY_FACTORS;
    
    if (durationMs > 0 && durationMs < thresholds.minDurationMs) {
        score *= (1 - pf.duration);       // 0.35
    }
    if (percentages.faceVisiblePct < thresholds.face_visible_pct_min) {
        score *= (1 - pf.faceVisible);    // 0.60
    }
    if (percentages.faceOkPct < thresholds.face_ok_pct_min) {
        score *= (1 - pf.faceOk);         // 0.60
    }
    if (percentages.poseOkPct < thresholds.pose_ok_pct_min) {
        score *= (1 - pf.poseOk);         // 0.55 (самый жёсткий — rPPG critical)
    }
    if (percentages.illuminationOkPct < thresholds.illumination_ok_pct_min) {
        score *= (1 - pf.illumination);   // 0.65 (NEW — плохое освещение)
    }
    if (percentages.occlusionPct > thresholds.occlusion_pct_max) {
        score *= (1 - pf.occlusion);      // 0.70
    }
    if (percentages.gazeValidPct < thresholds.gaze_valid_pct_min) {
        score *= (1 - pf.gazeValid);      // 0.70
    }
    if (percentages.gazeOnScreenPct < thresholds.gaze_on_screen_pct_min) {
        score *= (1 - pf.gazeOnScreen);   // 0.70
    }
    // Gaze accuracy hard penalty (если данные валидации есть и превышают порог)
    if (validationMetrics && validationMetrics.accuracyPct !== null &&
        validationMetrics.accuracyPct > thresholds.gaze_accuracy_pct_max) {
        score *= (1 - pf.gazeAccuracy);   // 0.75 (NEW)
    }
    if (counters && counters.totalLowFpsMs > thresholds.maxLowFpsTimeMs) {
        score *= (1 - pf.lowFps);         // 0.60
    }
    
    // Return as 0-1 (legacy) with 3 decimal places
    return round3(clamp01(score));
}

/**
 * Получение текущих метрик
 * 
 * @param {Object} counters - счётчики инструментов
 * @param {Object} gazeState - состояние gaze
 * @param {Object} fpsMonitor - монитор FPS
 * @param {number} startTime - время начала сессии
 * @param {Object} thresholds - пороги
 * @param {Object} validationMetrics - метрики валидации (опционально, для qcScore)
 * @returns {Object} текущие метрики
 */
export function getCurrentMetrics(counters, gazeState, fpsMonitor, startTime, thresholds = DEFAULT_THRESHOLDS, validationMetrics = null) {
    const percentages = computePercentages(counters);
    const durationMs = Date.now() - startTime;
    const qcScore = computeQcScore(percentages, thresholds, QC_WEIGHTS, counters, durationMs, validationMetrics);
    
    return {
        durationMs,
        totalFrames: counters.totalFrames,
        qcScore,
        
        // Percentages
        faceVisiblePct: round1(percentages.faceVisiblePct),
        faceOkPct: round1(percentages.faceOkPct),
        poseOkPct: round1(percentages.poseOkPct),
        illuminationOkPct: round1(percentages.illuminationOkPct),
        eyesOpenPct: round1(percentages.eyesOpenPct),
        occlusionPct: round1(percentages.occlusionPct),
        gazeValidPct: round1(percentages.gazeValidPct),
        gazeOnScreenPct: round1(percentages.gazeOnScreenPct),
        
        // FPS: теперь показываем оба значения
        analysisFps: fpsMonitor?.getCurrentFps() || 0,     // FPS анализа (processFrame calls/sec)
        cameraFps: fpsMonitor?.getCameraFps?.() || 0,      // Реальный FPS камеры
        baselineFps: fpsMonitor?.getBaselineFps() || null,
        lowFpsPct: round1(percentages.lowFpsPct),
        
        // Gaze time
        gazeValidTimeMs: gazeState.validTimeMs,
        gazeOnScreenTimeMs: gazeState.onScreenTimeMs,
        gazeTotal: counters.gazeTotal || 0, // Для отладки
        
        timestamp: Date.now()
    };
}

/**
 * Получение итогового summary
 * 
 * @param {Object} counters - счётчики
 * @param {Object} gazeState - состояние gaze
 * @param {Object} validationState - состояние валидации
 * @param {Object} trackingDeviationState - состояние tracking deviation
 * @param {Object} fpsMonitor - монитор FPS
 * @param {number} startTime - время начала
 * @param {Object} thresholds - пороги
 * @returns {Object} итоговый summary
 */
export function getSummary(counters, gazeState, validationState, trackingDeviationState, fpsMonitor, startTime, thresholds = DEFAULT_THRESHOLDS) {
    const validation = getValidationMetrics(validationState);
    const trackingDeviation = getTrackingDeviationMetrics(
        trackingDeviationState || { errors: [], isComplete: false },
        {
            validationAccuracyPx: validation.accuracyPx,
            baseRadiusPct: thresholds.tracking_on_target_base_radius_pct
        }
    );
    // Передаём validation в getCurrentMetrics для учёта accuracy в qcScore
    const metrics = getCurrentMetrics(counters, gazeState, fpsMonitor, startTime, thresholds, validation);
    
    // Определяем pass/fail для каждой метрики
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
    
    // Добавляем проверки валидации если есть данные
    if (validation.accuracyPct !== null) {
        checks.gazeAccuracy = validation.accuracyPct <= thresholds.gaze_accuracy_pct_max;
        checks.gazePrecision = validation.precisionPct <= thresholds.gaze_precision_pct_max;
    }
    
    // Добавляем проверку tracking deviation если есть данные
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
        
        // Raw counters
        counters: { ...counters },
        
        // FPS details
        fpsHistory: fpsMonitor?.getHistory() || [],
        maxConsecutiveLowFpsMs: counters.maxConsecutiveLowFpsMs,
        totalLowFpsMs: counters.totalLowFpsMs
    };
}
