/**
 * Illumination Analyzer
 * 
 * Анализ освещения кадра
 * 
 * @module precheck-analyzer/illumination
 */

import { ILLUMINATION_THRESHOLDS } from './thresholds.js';

/**
 * Анализ освещения по данным изображения
 * 
 * @param {ImageData} imageData - данные изображения
 * @param {Object} thresholds - пороги освещения
 * @returns {Object} результат анализа {value, rawValue, status}
 */
export function analyzeIllumination(imageData, thresholds = ILLUMINATION_THRESHOLDS) {
    const data = imageData.data;
    let totalBrightness = 0;
    const pixelCount = data.length / 4;
    
    for (let i = 0; i < data.length; i += 4) {
        // Формула яркости: 0.299*R + 0.587*G + 0.114*B
        const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        totalBrightness += brightness;
    }
    
    const avgBrightness = totalBrightness / pixelCount;
    const normalizedValue = Math.round((avgBrightness / 255) * 100);
    
    let status = 'optimal';
    if (avgBrightness < thresholds.tooDark) {
        status = 'too_dark';
    } else if (avgBrightness > thresholds.tooBright) {
        status = 'too_bright';
    }
    
    return {
        value: normalizedValue,
        rawValue: Math.round(avgBrightness),
        status
    };
}

/**
 * Проверка контрастности изображения
 * 
 * @param {ImageData} imageData - данные изображения
 * @returns {Object} результат {contrast, isGood}
 */
export function analyzeContrast(imageData) {
    const data = imageData.data;
    let min = 255, max = 0;
    
    for (let i = 0; i < data.length; i += 4) {
        const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        min = Math.min(min, brightness);
        max = Math.max(max, brightness);
    }
    
    const contrast = max - min;
    
    return {
        contrast: Math.round(contrast),
        min: Math.round(min),
        max: Math.round(max),
        isGood: contrast > 50  // Минимальный контраст
    };
}
