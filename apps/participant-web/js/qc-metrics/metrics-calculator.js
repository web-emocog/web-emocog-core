/**
 * Metrics Calculator
 * 
 * Расчёт QC Score и итоговых метрик
 * 
 * @module qc-metrics/metrics-calculator
 */

import { DEFAULT_THRESHOLDS, QC_WEIGHTS } from './constants.js';
import { round1, round3, clamp01 } from './helpers.js';
import { computePercentages } from './frame-analysis.js';
import { getValidationMetrics } from './validation.js';

/**
 * Вычисление QC Score
 * 
 * Returns 0-1 (LEGACY-compatible) with 3 decimal places.
 * Uses weighted average with hard penalties for critical failures.
 * 
 * @param {Object} percentages - проценты метрик
 * @param {Object} thresholds - пороговые значения
 * @param {Object} weights - весовые коэффициенты
 * @param {Object} counters - счётчики (для penalty checks)
 * @param {number} durationMs - длительность сессии
 * @returns {number} QC Score (0-1)
 */
export function computeQcScore(percentages, thresholds = DEFAULT_THRESHOLDS, weights = QC_WEIGHTS, counters = null, durationMs = 0) {
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
    const dropoutInv = nInvPct(100 - percentages.gazeValidPct); // dropout = 100 - valid
    const fpsOk = nInvPct(percentages.lowFpsPct || 0);
    
    // Weighted average
    let score =
        faceVis * weights.faceVis +
        faceOk * weights.faceOk +
        poseOk * weights.poseOk +
        lightOk * weights.lightOk +
        eyesOpen * weights.eyesOpen +
        occlInv * weights.occlInv +
        gazeValid * weights.gazeValid +
        gazeOn * weights.gazeOn +
        dropoutInv * weights.dropoutInv +
        fpsOk * weights.fpsOk;
    
    // LEGACY hard penalties to avoid "high score but invalid" artifacts
    if (durationMs > 0 && durationMs < thresholds.minDurationMs) score *= 0.35;
    if (percentages.faceVisiblePct < thresholds.face_visible_pct_min) score *= 0.6;
    if (percentages.faceOkPct < thresholds.face_ok_pct_min) score *= 0.6;
    if (percentages.occlusionPct > thresholds.occlusion_pct_max) score *= 0.7;
    if (percentages.gazeValidPct < thresholds.gaze_valid_pct_min) score *= 0.7;
    if (percentages.gazeOnScreenPct < thresholds.gaze_on_screen_pct_min) score *= 0.7;
    if (counters && counters.totalLowFpsMs > thresholds.maxLowFpsTimeMs) score *= 0.6;
    
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
 * @returns {Object} текущие метрики
 */
export function getCurrentMetrics(counters, gazeState, fpsMonitor, startTime, thresholds = DEFAULT_THRESHOLDS) {
    const percentages = computePercentages(counters);
    const durationMs = Date.now() - startTime;
    const qcScore = computeQcScore(percentages, thresholds, QC_WEIGHTS, counters, durationMs);
    
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
 * @param {Object} fpsMonitor - монитор FPS
 * @param {number} startTime - время начала
 * @param {Object} thresholds - пороги
 * @returns {Object} итоговый summary
 */
export function getSummary(counters, gazeState, validationState, fpsMonitor, startTime, thresholds = DEFAULT_THRESHOLDS) {
    const metrics = getCurrentMetrics(counters, gazeState, fpsMonitor, startTime, thresholds);
    const validation = getValidationMetrics(validationState);
    
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
    
    const passedChecks = Object.values(checks).filter(v => v === true).length;
    const totalChecks = Object.keys(checks).length;
    const overallPass = passedChecks === totalChecks;
    
    return {
        ...metrics,
        validation,
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
