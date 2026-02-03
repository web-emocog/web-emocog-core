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
 * @param {Object} percentages - проценты метрик
 * @param {Object} thresholds - пороговые значения
 * @param {Object} weights - весовые коэффициенты
 * @returns {number} QC Score (0-100)
 */
export function computeQcScore(percentages, thresholds = DEFAULT_THRESHOLDS, weights = QC_WEIGHTS) {
    let score = 0;
    let totalWeight = 0;
    
    // Face visible
    const faceVisibleScore = clamp01(percentages.faceVisiblePct / thresholds.face_visible_pct_min);
    score += faceVisibleScore * weights.face_visible;
    totalWeight += weights.face_visible;
    
    // Face OK
    const faceOkScore = clamp01(percentages.faceOkPct / thresholds.face_ok_pct_min);
    score += faceOkScore * weights.face_ok;
    totalWeight += weights.face_ok;
    
    // Pose OK
    const poseOkScore = clamp01(percentages.poseOkPct / thresholds.pose_ok_pct_min);
    score += poseOkScore * weights.pose_ok;
    totalWeight += weights.pose_ok;
    
    // Illumination OK
    const illumScore = clamp01(percentages.illuminationOkPct / thresholds.illumination_ok_pct_min);
    score += illumScore * weights.illumination_ok;
    totalWeight += weights.illumination_ok;
    
    // Eyes open
    const eyesScore = clamp01(percentages.eyesOpenPct / thresholds.eyes_open_pct_min);
    score += eyesScore * weights.eyes_open;
    totalWeight += weights.eyes_open;
    
    // Occlusion (inverse - lower is better)
    const occlusionScore = clamp01(1 - percentages.occlusionPct / thresholds.occlusion_pct_max);
    score += occlusionScore * weights.occlusion;
    totalWeight += weights.occlusion;
    
    // Gaze valid
    const gazeValidScore = clamp01(percentages.gazeValidPct / thresholds.gaze_valid_pct_min);
    score += gazeValidScore * weights.gaze_valid;
    totalWeight += weights.gaze_valid;
    
    // Gaze on screen
    const gazeOnScreenScore = clamp01(percentages.gazeOnScreenPct / thresholds.gaze_on_screen_pct_min);
    score += gazeOnScreenScore * weights.gaze_on_screen;
    totalWeight += weights.gaze_on_screen;
    
    return Math.round((score / totalWeight) * 100);
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
    const qcScore = computeQcScore(percentages, thresholds);
    const durationMs = Date.now() - startTime;
    
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
        
        // FPS
        currentFps: fpsMonitor?.getCurrentFps() || 0,
        baselineFps: fpsMonitor?.getBaselineFps() || null,
        lowFpsPct: round1(percentages.lowFpsPct),
        
        // Gaze time
        gazeValidTimeMs: gazeState.validTimeMs,
        gazeOnScreenTimeMs: gazeState.onScreenTimeMs,
        
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
