/**
 * Validation
 * 
 * Валидация gaze данных
 * 
 * @module qc-metrics/validation
 */

import { average, stdDev } from './helpers.js';

/**
 * Создание состояния валидации
 */
export function createValidationState() {
    return {
        points: [],
        targetPoints: [],
        errors: [],
        isComplete: false
    };
}

/**
 * Установка данных валидации
 * 
 * Accepts both formats:
 *   - flat:   { gazeX, gazeY, targetX, targetY }  (from tests.js)
 *   - nested: { target: {x,y}, gaze: {x,y} }
 * 
 * @param {Object} state - текущее состояние
 * @param {Array} validationData - данные валидации
 * @returns {Object} обновлённое состояние
 */
export function setValidationData(state, validationData) {
    if (!Array.isArray(validationData) || validationData.length === 0) {
        return state;
    }
    
    const newState = { ...state };
    newState.points = validationData;
    newState.isComplete = true;
    
    // Вычисляем ошибки (поддерживаем оба формата)
    newState.errors = validationData.map(point => {
        let gazeX, gazeY, targetX, targetY;
        
        // Flat format: { gazeX, gazeY, targetX, targetY }
        if (point.gazeX != null && point.targetX != null) {
            gazeX = point.gazeX;
            gazeY = point.gazeY;
            targetX = point.targetX;
            targetY = point.targetY;
        }
        // Nested format: { target: {x,y}, gaze: {x,y} }
        else if (point.target && point.gaze) {
            gazeX = point.gaze.x;
            gazeY = point.gaze.y;
            targetX = point.target.x;
            targetY = point.target.y;
        }
        else {
            return null;
        }
        
        if (gazeX == null || gazeY == null || targetX == null || targetY == null) {
            return null;
        }
        
        const dx = gazeX - targetX;
        const dy = gazeY - targetY;
        return Math.sqrt(dx * dx + dy * dy);
    }).filter(e => e !== null);
    
    return newState;
}

/**
 * Получение метрик валидации
 * 
 * @param {Object} state - состояние валидации
 * @returns {Object} метрики
 */
export function getValidationMetrics(state) {
    if (!state.isComplete || state.errors.length === 0) {
        return {
            accuracyPx: null,
            precisionPx: null,
            accuracyPct: null,
            precisionPct: null,
            sampleCount: 0
        };
    }
    
    const screenDiag = Math.sqrt(
        Math.pow(window.innerWidth || 1920, 2) + 
        Math.pow(window.innerHeight || 1080, 2)
    );
    
    const accuracyPx = average(state.errors);
    const precisionPx = stdDev(state.errors);
    
    return {
        accuracyPx: Math.round(accuracyPx * 10) / 10,
        precisionPx: Math.round(precisionPx * 10) / 10,
        accuracyPct: Math.round((accuracyPx / screenDiag) * 1000) / 10,
        precisionPct: Math.round((precisionPx / screenDiag) * 1000) / 10,
        sampleCount: state.errors.length
    };
}

/**
 * Проверка попадания gaze в AOI (Area of Interest)
 * 
 * @param {Object} gazePoint - точка gaze {x, y}
 * @param {Object} aoi - область интереса {x, y, width, height}
 * @returns {boolean} попадает ли в AOI
 */
export function isGazeInAOI(gazePoint, aoi) {
    if (!gazePoint || !aoi) return false;
    
    return gazePoint.x >= aoi.x && 
           gazePoint.x <= aoi.x + aoi.width &&
           gazePoint.y >= aoi.y && 
           gazePoint.y <= aoi.y + aoi.height;
}

// ============================================================================
// TRACKING DEVIATION — отклонение gaze от позиции стимула во время теста
// ============================================================================

/**
 * Создание состояния tracking deviation
 */
export function createTrackingDeviationState() {
    return {
        errors: [],
        sampleCount: 0,
        validSampleCount: 0,
        isComplete: false
    };
}

/**
 * Установка данных tracking deviation
 * 
 * Принимает массив сэмплов из trackingTest[]:
 *   { shapeX, shapeY, gazeX, gazeY }
 * 
 * Вычисляет ошибку отклонения gaze от позиции фигуры (цели).
 * 
 * @param {Object} state - текущее состояние
 * @param {Array} trackingSamples - данные tracking test
 * @returns {Object} обновлённое состояние
 */
export function setTrackingDeviationData(state, trackingSamples) {
    if (!Array.isArray(trackingSamples) || trackingSamples.length === 0) {
        return state;
    }

    const newState = { ...state };
    newState.sampleCount = trackingSamples.length;
    newState.isComplete = true;

    const errors = [];
    for (const s of trackingSamples) {
        if (s.gazeX == null || s.gazeY == null ||
            s.shapeX == null || s.shapeY == null) {
            continue;
        }
        if (!Number.isFinite(s.gazeX) || !Number.isFinite(s.gazeY) ||
            !Number.isFinite(s.shapeX) || !Number.isFinite(s.shapeY)) {
            continue;
        }
        const dx = s.gazeX - s.shapeX;
        const dy = s.gazeY - s.shapeY;
        errors.push(Math.sqrt(dx * dx + dy * dy));
    }

    newState.errors = errors;
    newState.validSampleCount = errors.length;
    return newState;
}

/**
 * Получение метрик tracking deviation
 *
 * @param {Object} state - состояние tracking deviation
 * @param {Object} [options={}] - опции
 * @param {number|null} [options.validationAccuracyPx] - accuracy калибровки в пикселях (расширяет on-target радиус)
 * @param {number} [options.baseRadiusPct=0.15] - базовый радиус как доля диагонали экрана
 * @returns {Object} метрики (deviationPx, deviationPct, precisionPx, precisionPct, onTargetPct)
 */
export function getTrackingDeviationMetrics(state, options = {}) {
    if (!state.isComplete || state.errors.length === 0) {
        return {
            deviationPx: null,
            deviationPct: null,
            precisionPx: null,
            precisionPct: null,
            onTargetPct: null,
            sampleCount: 0,
            validSampleCount: 0
        };
    }

    const screenDiag = Math.sqrt(
        Math.pow(window.innerWidth || 1920, 2) +
        Math.pow(window.innerHeight || 1080, 2)
    );

    const deviationPx = average(state.errors);
    const precisionPx = stdDev(state.errors);

    // onTargetPct: % сэмплов с отклонением ≤ baseRadius + accuracyPx
    // baseRadius = 15% диагонали (~330px на 1080p)
    // accuracyPx = accuracy калибровки (физически неустранимая ошибка) — расширяет радиус
    const baseRadiusPct = options.baseRadiusPct ?? 0.15;
    const baseRadiusPx = screenDiag * baseRadiusPct;
    const accuracyPx = (options.validationAccuracyPx != null && Number.isFinite(options.validationAccuracyPx))
        ? options.validationAccuracyPx
        : 0;
    const onTargetRadiusPx = baseRadiusPx + accuracyPx;
    const onTargetCount = state.errors.filter(e => e <= onTargetRadiusPx).length;
    const onTargetPct = (onTargetCount / state.errors.length) * 100;

    return {
        deviationPx: Math.round(deviationPx * 10) / 10,
        deviationPct: Math.round((deviationPx / screenDiag) * 1000) / 10,
        precisionPx: Math.round(precisionPx * 10) / 10,
        precisionPct: Math.round((precisionPx / screenDiag) * 1000) / 10,
        onTargetPct: Math.round(onTargetPct * 10) / 10,
        sampleCount: state.sampleCount,
        validSampleCount: state.validSampleCount
    };
}
