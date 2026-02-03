/**
 * Eyes Analyzer
 * 
 * Анализ глаз: EAR, позиция iris, направление взгляда
 * 
 * @module precheck-analyzer/eyes-analyzer
 */

import { LANDMARKS } from './constants.js';
import { EYES_THRESHOLDS } from './thresholds.js';

/**
 * Анализ глаз: EAR, позиция iris, открытость
 * 
 * @param {Object} mpResults - результаты от MediaPipe
 * @param {number} frameWidth - ширина кадра
 * @param {number} frameHeight - высота кадра
 * @param {Object} thresholds - пороги для глаз
 * @returns {Object} данные о глазах
 */
export function analyzeEyes(mpResults, frameWidth, frameHeight, thresholds = EYES_THRESHOLDS) {
    if (!mpResults.faceLandmarks || mpResults.faceLandmarks.length === 0) {
        return {
            left: { ear: 0, isOpen: false, iris: null },
            right: { ear: 0, isOpen: false, iris: null },
            gazeDirection: 'unknown'
        };
    }
    
    const landmarks = mpResults.faceLandmarks[0];
    
    // Вычисляем EAR для каждого глаза
    const leftEAR = calculateEAR(landmarks, LANDMARKS.LEFT_EYE);
    const rightEAR = calculateEAR(landmarks, LANDMARKS.RIGHT_EYE);
    
    // Позиции зрачков
    const leftIris = getIrisPosition(landmarks, LANDMARKS.LEFT_IRIS);
    const rightIris = getIrisPosition(landmarks, LANDMARKS.RIGHT_IRIS);
    
    // Определение открытости глаз
    const leftOpen = leftEAR > thresholds.earThreshold;
    const rightOpen = rightEAR > thresholds.earThreshold;
    
    // Направление взгляда
    const gazeDirection = estimateGazeDirection(landmarks, leftIris, rightIris);
    
    return {
        left: {
            ear: Math.round(leftEAR * 1000) / 1000,
            isOpen: leftOpen,
            iris: leftIris
        },
        right: {
            ear: Math.round(rightEAR * 1000) / 1000,
            isOpen: rightOpen,
            iris: rightIris
        },
        bothOpen: leftOpen && rightOpen,
        gazeDirection
    };
}

/**
 * Вычисление Eye Aspect Ratio (EAR)
 * 
 * @param {Array} landmarks - все лэндмарки
 * @param {Array} eyeIndices - индексы точек глаза
 * @returns {number} EAR значение
 */
export function calculateEAR(landmarks, eyeIndices) {
    const p = eyeIndices.map(i => landmarks[i]);
    
    const v1 = distance(p[1], p[5]);
    const v2 = distance(p[2], p[4]);
    const h = distance(p[0], p[3]);
    
    if (h === 0) return 0;
    return (v1 + v2) / (2 * h);
}

/**
 * Расстояние между двумя точками
 * 
 * @param {Object} p1 - первая точка {x, y, z}
 * @param {Object} p2 - вторая точка {x, y, z}
 * @returns {number} расстояние
 */
export function distance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Получение позиции зрачка
 * 
 * @param {Array} landmarks - все лэндмарки
 * @param {Array} irisIndices - индексы точек iris
 * @returns {Object|null} позиция зрачка
 */
export function getIrisPosition(landmarks, irisIndices) {
    if (!landmarks[irisIndices[0]]) return null;
    
    const center = landmarks[irisIndices[0]];
    const points = irisIndices.slice(1).map(i => landmarks[i]);
    
    let radius = 0;
    for (const p of points) {
        radius += distance(center, p);
    }
    radius /= points.length;
    
    return { x: center.x, y: center.y, z: center.z, radius };
}

/**
 * Оценка направления взгляда
 * 
 * @param {Array} landmarks - все лэндмарки
 * @param {Object} leftIris - позиция левого зрачка
 * @param {Object} rightIris - позиция правого зрачка
 * @returns {string} направление взгляда
 */
export function estimateGazeDirection(landmarks, leftIris, rightIris) {
    if (!leftIris || !rightIris) return 'unknown';
    
    const leftEyeCenter = getCenter(LANDMARKS.LEFT_EYE.map(i => landmarks[i]));
    const rightEyeCenter = getCenter(LANDMARKS.RIGHT_EYE.map(i => landmarks[i]));
    
    const avgOffsetX = ((leftIris.x - leftEyeCenter.x) + (rightIris.x - rightEyeCenter.x)) / 2;
    const avgOffsetY = ((leftIris.y - leftEyeCenter.y) + (rightIris.y - rightEyeCenter.y)) / 2;
    
    const threshold = 0.01;
    
    if (Math.abs(avgOffsetX) < threshold && Math.abs(avgOffsetY) < threshold) {
        return 'center';
    } else if (avgOffsetX < -threshold) {
        return 'left';
    } else if (avgOffsetX > threshold) {
        return 'right';
    } else if (avgOffsetY < -threshold) {
        return 'up';
    } else if (avgOffsetY > threshold) {
        return 'down';
    }
    
    return 'center';
}

/**
 * Центр набора точек
 * 
 * @param {Array} points - массив точек
 * @returns {Object} центр {x, y}
 */
export function getCenter(points) {
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
}
