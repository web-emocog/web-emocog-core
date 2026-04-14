/**
 * Pose Analyzer
 * 
 * Анализ позы головы и стабильности
 * 
 * @module precheck-analyzer/pose-analyzer
 */

import { POSE_THRESHOLDS, HISTORY_SIZE } from './thresholds.js';
import { LANDMARKS, MIN_LANDMARKS_FULL } from './constants.js';

/**
 * Анализ позы головы из Face Transformation Matrix
 * 
 * @param {Object} mpResults - результаты от MediaPipe
 * @param {Object} thresholds - пороги для позы
 * @returns {Object} данные о позе
 */
export function analyzePose(mpResults, thresholds = POSE_THRESHOLDS) {
    if (!mpResults.facialTransformationMatrixes || mpResults.facialTransformationMatrixes.length === 0) {
        return {
            yaw: null,
            pitch: null,
            roll: null,
            isStable: false,
            status: 'no_face'
        };
    }
    
    const matrix = mpResults.facialTransformationMatrixes[0].data;
    
    // Извлекаем углы из матрицы трансформации
    const r11 = matrix[0], r21 = matrix[4], r31 = matrix[8];
    const r32 = matrix[9], r33 = matrix[10];
    
    // Вычисляем углы Эйлера
    const pitch = Math.asin(-r31) * (180 / Math.PI);
    const yaw = Math.atan2(r32, r33) * (180 / Math.PI);
    const roll = Math.atan2(r21, r11) * (180 / Math.PI);
    
    // Проверка превышения порогов
    const issues = [];
    if (Math.abs(yaw) > thresholds.maxYaw) {
        issues.push('yaw_exceeded');
    }
    if (Math.abs(pitch) > thresholds.maxPitch) {
        issues.push('pitch_exceeded');
    }
    if (Math.abs(roll) > thresholds.maxRoll) {
        issues.push('roll_exceeded');
    }
    
    const isTilted = issues.length > 0;
    
    return {
        yaw: Math.round(yaw * 10) / 10,
        pitch: Math.round(pitch * 10) / 10,
        roll: Math.round(roll * 10) / 10,
        isStable: true,
        isTilted,
        status: isTilted ? 'tilted' : 'stable',
        issues
    };
}

/**
 * Проверка стабильности позы головы
 * 
 * @param {Array} poseHistory - история позиций
 * @returns {Object} результат проверки стабильности
 */
export function checkStability(poseHistory) {
    if (poseHistory.length < 5) {
        return { isStable: false, reason: 'insufficient_data' };
    }
    
    const recent = poseHistory.slice(-10);
    
    const calcStdDev = (values) => {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const sqDiffs = values.map(v => Math.pow(v - mean, 2));
        return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
    };
    
    const yawStd = calcStdDev(recent.map(p => p.yaw));
    const pitchStd = calcStdDev(recent.map(p => p.pitch));
    const rollStd = calcStdDev(recent.map(p => p.roll));
    const centerXStd = calcStdDev(recent.map(p => p.centerX));
    const centerYStd = calcStdDev(recent.map(p => p.centerY));
    
    const angleThreshold = 3;
    const positionThreshold = 0.03;
    
    const isStable = yawStd < angleThreshold && 
                    pitchStd < angleThreshold && 
                    rollStd < angleThreshold &&
                    centerXStd < positionThreshold &&
                    centerYStd < positionThreshold;
    
    return { 
        isStable, 
        metrics: { yawStd, pitchStd, rollStd, centerXStd, centerYStd } 
    };
}

/**
 * Проверка центрирования глаз относительно центра кадра
 * 
 * @param {Array} landmarks - лэндмарки лица
 * @param {Object} thresholds - пороги для позы
 * @returns {Object} результат проверки центрирования
 */
export function checkEyesCentering(landmarks, thresholds = POSE_THRESHOLDS) {
    if (!landmarks || landmarks.length < MIN_LANDMARKS_FULL) {
        return { centered: false, deviation: { x: 0, y: 0 }, hint: ['no_landmarks'] };
    }

    const leftEyeCenter = landmarks[LANDMARKS.LEFT_EYE_CENTER];
    const rightEyeCenter = landmarks[LANDMARKS.RIGHT_EYE_CENTER];

    if (!leftEyeCenter || !rightEyeCenter) {
        return { centered: false, deviation: { x: 0, y: 0 }, hint: ['no_eye_landmarks'] };
    }

    const eyesMidpoint = {
        x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
        y: (leftEyeCenter.y + rightEyeCenter.y) / 2
    };

    const deviationX = eyesMidpoint.x - 0.5;
    const deviationY = eyesMidpoint.y - 0.5;

    const maxDeviation = thresholds.eyesCenterMaxDeviation;
    const optimalDeviation = thresholds.eyesCenterOptimalDeviation;

    const isCenteredX = Math.abs(deviationX) <= maxDeviation;
    const isCenteredY = Math.abs(deviationY) <= maxDeviation;
    const centered = isCenteredX && isCenteredY;

    const hint = [];
    if (!isCenteredX) {
        hint.push(deviationX > 0 ? 'move_left' : 'move_right');
    }
    if (!isCenteredY) {
        hint.push(deviationY > 0 ? 'move_up' : 'move_down');
    }

    const totalDeviation = Math.sqrt(deviationX * deviationX + deviationY * deviationY);
    const quality = Math.max(0, Math.min(100, Math.round((1 - totalDeviation / maxDeviation) * 100)));

    return {
        centered,
        deviation: { 
            x: Math.round(deviationX * 1000) / 1000, 
            y: Math.round(deviationY * 1000) / 1000 
        },
        eyesMidpoint,
        quality,
        isOptimal: totalDeviation <= optimalDeviation,
        hint: hint.length > 0 ? hint : null
    };
}

/**
 * Добавление позы в историю
 * 
 * @param {Array} history - массив истории
 * @param {Object} pose - данные позы
 * @param {Object} faceData - данные о лице
 * @param {number} maxSize - максимальный размер истории
 * @returns {Array} обновлённая история
 */
export function addToHistory(history, pose, faceData, maxSize = HISTORY_SIZE) {
    const newHistory = [...history];
    
    newHistory.push({
        yaw: pose.yaw,
        pitch: pose.pitch,
        roll: pose.roll,
        centerX: faceData.bbox?.x + faceData.bbox?.width / 2,
        centerY: faceData.bbox?.y + faceData.bbox?.height / 2,
        timestamp: Date.now()
    });
    
    if (newHistory.length > maxSize) {
        newHistory.shift();
    }
    
    return newHistory;
}
