/**
 * Mouth Analyzer
 * 
 * Анализ рта
 * 
 * @module precheck-analyzer/mouth-analyzer
 */

import { LANDMARKS } from './constants.js';
import { distance } from './eyes-analyzer.js';

/**
 * Анализ рта
 * 
 * @param {Object} mpResults - результаты от MediaPipe
 * @returns {Object} данные о рте
 */
export function analyzeMouth(mpResults) {
    if (!mpResults.faceLandmarks || mpResults.faceLandmarks.length === 0) {
        return { isOpen: false, openRatio: 0 };
    }
    
    const landmarks = mpResults.faceLandmarks[0];
    
    const upperLip = landmarks[LANDMARKS.UPPER_LIP];
    const lowerLip = landmarks[LANDMARKS.LOWER_LIP];
    const leftCorner = landmarks[LANDMARKS.LEFT_MOUTH_CORNER];
    const rightCorner = landmarks[LANDMARKS.RIGHT_MOUTH_CORNER];
    
    const mouthHeight = distance(upperLip, lowerLip);
    const mouthWidth = distance(leftCorner, rightCorner);
    
    const openRatio = mouthWidth > 0 ? mouthHeight / mouthWidth : 0;
    
    return {
        isOpen: openRatio > 0.1,
        openRatio: Math.round(openRatio * 100) / 100
    };
}
