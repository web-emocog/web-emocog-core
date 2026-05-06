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
        hasData: false, // true after first addGazePoint call
        // Track occlusion state for gaze validity
        _lastOccluded: false
    };
}

/**
 * Добавление gaze точки.
 *
 * Возвращает обновлённое состояние и булевы инкременты счётчиков
 * { gazeValidInc, gazeOnScreenInc } — чтобы вызывающий мог поднять
 * counters.gazeValid / counters.gazeOnScreen ровно по факту валидной точки.
 * Это устраняет P0-2 баг (раньше gazeValid/gazeOnScreen инкрементировались
 * в processFrame на каждый кадр, что давало проценты >100%).
 *
 * @param {Object} state - текущее состояние
 * @param {Object} gazeData - данные gaze {x, y, ...}
 * @param {Object} poseData - данные позы {yaw, pitch}
 * @param {Object} thresholds - пороги
 * @param {boolean} occluded - флаг окклюзии (опционально)
 * @returns {{ state: Object, gazeValidInc: boolean, gazeOnScreenInc: boolean }}
 */
export function addGazePoint(state, gazeData, poseData, thresholds = DEFAULT_THRESHOLDS, occluded = false) {
    const newState = { ...state };
    newState.totalGazePoints++;
    newState.hasData = true;
    newState._lastOccluded = occluded;

    // Окклюзия → gaze невалиден
    if (occluded) {
        newState.valid = false;
        newState.onScreen = null;
        return { state: newState, gazeValidInc: false, gazeOnScreenInc: false };
    }

    // Нет данных взгляда → невалиден
    if (!gazeData || gazeData.x == null || gazeData.y == null) {
        newState.valid = false;
        newState.onScreen = null;
        return { state: newState, gazeValidInc: false, gazeOnScreenInc: false };
    }

    // Есть данные → валиден
    newState.valid = true;
    newState.lastValidTime = Date.now();

    // Если трекер передал честный onScreen (по correctedX/correctedY ДО clamp), доверяем ему.
    // Иначе fallback — boundary-чек по координатам gazeData.x/y.
    const trackerOnScreen = (typeof gazeData.onScreen === 'boolean') ? gazeData.onScreen : null;

    const screenW = window.innerWidth || 1920;
    const screenH = window.innerHeight || 1080;
    const inBounds = trackerOnScreen !== null
        ? trackerOnScreen
        : (gazeData.x >= 0 && gazeData.x <= screenW &&
           gazeData.y >= 0 && gazeData.y <= screenH);

    if (poseData && poseData.yaw != null && poseData.pitch != null) {
        const absYaw = Math.abs(poseData.yaw);
        const absPitch = Math.abs(poseData.pitch);

        // Явно off-screen по позе — переопределяет любой флаг трекера.
        if (absYaw > thresholds.pose_yaw_off_min || absPitch > thresholds.pose_pitch_off_min) {
            newState.onScreen = false;
            return { state: newState, gazeValidInc: true, gazeOnScreenInc: false };
        }

        // В рамках on-max — доверяем флагу (от трекера или по координатам).
        if (absYaw < thresholds.pose_yaw_on_max && absPitch < thresholds.pose_pitch_on_max) {
            newState.onScreen = inBounds;
            return { state: newState, gazeValidInc: true, gazeOnScreenInc: inBounds };
        }
    }

    // Без явной позы — флаг трекера / boundary-чек.
    newState.onScreen = inBounds;
    return { state: newState, gazeValidInc: true, gazeOnScreenInc: inBounds };
}

/**
 * Инференс onScreen из позы и gaze данных.
 * Сохранён как вспомогательная функция для совместимости с index.js exports;
 * новая addGazePoint() инлайнит ту же логику + boundary-чек fallback.
 *
 * @param {Object} gazeData - данные gaze
 * @param {Object} poseData - данные позы
 * @param {Object} thresholds - пороги
 * @returns {Object} {valid, onScreen}
 */
export function inferOnScreenFromPoseAndGaze(gazeData, poseData, thresholds = DEFAULT_THRESHOLDS) {
    if (!gazeData || gazeData.x == null || gazeData.y == null) {
        return { valid: false, onScreen: null };
    }

    const screenW = window.innerWidth || 1920;
    const screenH = window.innerHeight || 1080;
    const inBounds = gazeData.x >= 0 && gazeData.x <= screenW &&
                     gazeData.y >= 0 && gazeData.y <= screenH;

    if (poseData && poseData.yaw != null && poseData.pitch != null) {
        const absYaw = Math.abs(poseData.yaw);
        const absPitch = Math.abs(poseData.pitch);
        if (absYaw > thresholds.pose_yaw_off_min || absPitch > thresholds.pose_pitch_off_min) {
            return { valid: true, onScreen: false };
        }
        if (absYaw < thresholds.pose_yaw_on_max && absPitch < thresholds.pose_pitch_on_max) {
            return { valid: true, onScreen: inBounds };
        }
    }

    return { valid: true, onScreen: inBounds };
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
    
    // Only accumulate if gaze data has been provided (hasData = true)
    if (!state.hasData) return newState;
    
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
