/**
 * Face Parser
 * 
 * Парсинг результатов MediaPipe Face Landmarker
 * 
 * @module precheck-analyzer/face-parser
 */

import { FACE_THRESHOLDS } from './thresholds.js';

/**
 * Парсинг результатов MediaPipe Face Landmarker
 * 
 * @param {Object} mpResults - результаты от MediaPipe
 * @param {number} frameWidth - ширина кадра
 * @param {number} frameHeight - высота кадра
 * @param {Object} thresholds - пороги для лица
 * @returns {Object} данные о лице
 */
export function parseFaceResults(mpResults, frameWidth, frameHeight, thresholds = FACE_THRESHOLDS) {
    if (!mpResults.faceLandmarks || mpResults.faceLandmarks.length === 0) {
        return {
            detected: false,
            confidence: 0,
            size: 0,
            status: 'not_found',
            bbox: null,
            issues: ['no_face']
        };
    }
    
    const landmarks = mpResults.faceLandmarks[0];
    const issues = [];
    
    // Вычисляем bounding box из лэндмарок
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const point of landmarks) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
    }
    
    const bbox = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
    
    // Размер лица в процентах от кадра
    const sizePercent = (bbox.width * bbox.height) * 100;
    
    // Центр лица
    const centerX = minX + bbox.width / 2;
    const centerY = minY + bbox.height / 2;
    
    // Проверка зоны
    const zone = thresholds.validZone;
    if (centerX < zone.minX || centerX > zone.maxX) {
        issues.push('out_of_zone_horizontal');
    }
    if (centerY < zone.minY || centerY > zone.maxY) {
        issues.push('out_of_zone_vertical');
    }
    
    // Проверка размера
    let sizeStatus = 'optimal';
    if (sizePercent < thresholds.minSize) {
        sizeStatus = 'too_small';
        issues.push('face_too_small');
    } else if (sizePercent > thresholds.maxSize) {
        sizeStatus = 'too_large';
        issues.push('face_too_large');
    }
    
    // Финальный статус
    let status = sizeStatus;
    if (issues.includes('out_of_zone_horizontal') || issues.includes('out_of_zone_vertical')) {
        status = 'out_of_zone';
    }
    
    const confidence = mpResults.faceBlendshapes?.[0]?.[0]?.score ?? 0.9;
    
    return {
        detected: true,
        confidence,
        size: Math.round(sizePercent * 10) / 10,
        status,
        bbox,
        center: { x: centerX, y: centerY },
        issues,
        landmarkCount: landmarks.length
    };
}

/**
 * Извлечение blend shapes из результатов MediaPipe
 * 
 * @param {Object} mpResults - результаты от MediaPipe
 * @returns {Object|null} объект blend shapes или null
 */
export function extractBlendShapes(mpResults) {
    if (!mpResults.faceBlendshapes || mpResults.faceBlendshapes.length === 0) {
        return null;
    }
    
    const blendshapesData = mpResults.faceBlendshapes[0];
    const categories = blendshapesData.categories || blendshapesData;
    
    if (!categories || !Array.isArray(categories)) {
        return null;
    }
    
    const result = {};
    for (const shape of categories) {
        if (shape?.categoryName !== undefined) {
            result[shape.categoryName] = Math.round(shape.score * 1000) / 1000;
        }
    }
    
    return Object.keys(result).length > 0 ? result : null;
}
