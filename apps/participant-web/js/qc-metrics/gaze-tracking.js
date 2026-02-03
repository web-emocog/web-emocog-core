/**
 * Gaze Tracking
 * 
 * Функции работы с gaze данными
 * 
 * @module qc-metrics/gaze-tracking
 */

import { DEFAULT_THRESHOLDS } from './constants.js';

/**
 * Состояние gaze трекинга
 */
export function createGazeState() {
    return {
        valid: false,
        onScreen: null,
        lastValidTime: 0,
        validTimeMs: 0,
        onScreenTimeMs: 0,
        offScreenTimeMs: 0,
        totalGazePoints: 0,
        // Track occlusion state for gaze validity
        _lastOccluded: false
    };
}

/**
 * Установка состояния gaze от внешнего трекера
 * 
 * @param {Object} state - текущее состояние
 * @param {boolean} valid - валидность gaze
 * @param {boolean|null} onScreen - на экране или нет
 * @param {boolean} occluded - флаг окклюзии (опционально)
 * @returns {Object} обновлённое состояние
 */
export function setGazeScreenState(state, valid, onScreen, occluded = false) {
    // Gaze cannot be valid if face is occluded
    const actualValid = valid && !occluded;
    
    return {
        ...state,
        valid: actualValid,
        onScreen: actualValid ? onScreen : null,
        lastValidTime: actualValid ? Date.now() : state.lastValidTime,
        _lastOccluded: occluded
    };
}

/**
 * Добавление gaze точки (LEGACY - для WebGazer)
 * 
 * @param {Object} state - текущее состояние
 * @param {Object} gazeData - данные gaze {x, y, ...}
 * @param {Object} poseData - данные позы {yaw, pitch}
 * @param {Object} thresholds - пороги
 * @param {boolean} occluded - флаг окклюзии (опционально)
 * @returns {Object} обновлённое состояние
 */
export function addGazePoint(state, gazeData, poseData, thresholds = DEFAULT_THRESHOLDS, occluded = false) {
    const newState = { ...state };
    newState.totalGazePoints++;
    newState._lastOccluded = occluded;
    
    // If face is occluded, gaze is invalid
    if (occluded) {
        newState.valid = false;
        newState.onScreen = null;
        return newState;
    }
    
    // Определяем валидность и onScreen
    const { valid, onScreen } = inferOnScreenFromPoseAndGaze(gazeData, poseData, thresholds);
    
    newState.valid = valid;
    newState.onScreen = onScreen;
    
    if (valid) {
        newState.lastValidTime = Date.now();
    }
    
    return newState;
}

/**
 * Инференс onScreen из позы и gaze данных (LEGACY - для WebGazer)
 * 
 * @param {Object} gazeData - данные gaze
 * @param {Object} poseData - данные позы
 * @param {Object} thresholds - пороги
 * @returns {Object} {valid, onScreen}
 */
export function inferOnScreenFromPoseAndGaze(gazeData, poseData, thresholds = DEFAULT_THRESHOLDS) {
    // Если нет gaze данных — невалидно
    if (!gazeData || gazeData.x == null || gazeData.y == null) {
        return { valid: false, onScreen: null };
    }
    
    // Если есть поза, проверяем углы
    if (poseData && poseData.yaw != null && poseData.pitch != null) {
        const absYaw = Math.abs(poseData.yaw);
        const absPitch = Math.abs(poseData.pitch);
        
        // Явно off-screen по позе
        if (absYaw > thresholds.pose_yaw_off_min || absPitch > thresholds.pose_pitch_off_min) {
            return { valid: true, onScreen: false };
        }
        
        // Явно on-screen по позе
        if (absYaw < thresholds.pose_yaw_on_max && absPitch < thresholds.pose_pitch_on_max) {
            // Проверяем gaze координаты
            const screenW = window.innerWidth || 1920;
            const screenH = window.innerHeight || 1080;
            const inBounds = gazeData.x >= 0 && gazeData.x <= screenW &&
                            gazeData.y >= 0 && gazeData.y <= screenH;
            return { valid: true, onScreen: inBounds };
        }
    }
    
    // Неопределённо
    return { valid: true, onScreen: null };
}

/**
 * Аккумуляция времени gaze
 * 
 * @param {Object} state - текущее состояние
 * @param {number} deltaMs - прошедшее время
 * @returns {Object} обновлённое состояние
 */
export function accumulateGazeTime(state, deltaMs) {
    const newState = { ...state };
    
    if (state.valid) {
        newState.validTimeMs += deltaMs;
        
        if (state.onScreen === true) {
            newState.onScreenTimeMs += deltaMs;
        } else if (state.onScreen === false) {
            newState.offScreenTimeMs += deltaMs;
        }
    }
    
    return newState;
}
