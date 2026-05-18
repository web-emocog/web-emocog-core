/**
 * Illumination Analyzer
 * 
 * Анализ освещения кадра
 * 
 * @module precheck-analyzer/illumination
 */

import { ILLUMINATION_THRESHOLDS } from './thresholds.js';

/**
 * Вычисление средней яркости в прямоугольной ROI (или по всему кадру).
 * Внутренняя функция — не экспортируется.
 *
 * @param {ImageData} imageData
 * @param {{sx:number, sy:number, ex:number, ey:number}|null} roi - пиксельный
 *   прямоугольник [sx..ex) × [sy..ey). Если null — весь кадр.
 * @returns {{ avg:number, count:number }}
 */
function meanBrightnessInRect(imageData, roi) {
    const data = imageData.data;
    const width = imageData.width;
    let total = 0;
    let count = 0;

    if (roi) {
        for (let y = roi.sy; y < roi.ey; y++) {
            for (let x = roi.sx; x < roi.ex; x++) {
                const i = (y * width + x) * 4;
                total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                count++;
            }
        }
    } else {
        for (let i = 0; i < data.length; i += 4) {
            total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            count++;
        }
    }

    return { avg: count > 0 ? total / count : 0, count };
}

/**
 * Преобразует normalized landmarks (0..1) в пиксельный bbox.
 * Возвращает null если landmarks пусты или зона вырождается.
 */
function landmarksToPixelRoi(landmarks, frameWidth, frameHeight, padFrac = 0) {
    if (!landmarks || landmarks.length === 0) return null;
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const p of landmarks) {
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    if (maxX <= minX || maxY <= minY) return null;
    if (padFrac) {
        const dx = (maxX - minX) * padFrac;
        const dy = (maxY - minY) * padFrac;
        minX = Math.max(0, minX - dx);
        maxX = Math.min(1, maxX + dx);
        minY = Math.max(0, minY - dy);
        maxY = Math.min(1, maxY + dy);
    }
    const sx = Math.max(0, Math.floor(minX * frameWidth));
    const sy = Math.max(0, Math.floor(minY * frameHeight));
    const ex = Math.min(frameWidth, Math.ceil(maxX * frameWidth));
    const ey = Math.min(frameHeight, Math.ceil(maxY * frameHeight));
    return (ex > sx && ey > sy) ? { sx, sy, ex, ey } : null;
}

/**
 * Анализ освещения. Если переданы landmarks лица, считает яркость только
 * по face ROI (bounding box лэндмарок) — это устойчивее к тёмному/светлому
 * фону. Дополнительно возвращает яркость по eye ROI (комбинированный bbox
 * глазных лэндмарок), чтобы можно было поймать пересвет/затенение зоны взгляда
 * отдельно от общего лица.
 *
 * Если landmarks нет — fallback на полный кадр (старое поведение).
 *
 * @param {ImageData} imageData - данные изображения
 * @param {Object} thresholds - пороги освещения {tooDark, tooBright}
 * @param {Array|null} landmarks - 478 landmarks от FaceLandmarker (опционально)
 * @param {Object} eyeLandmarkIndices - {left:[...], right:[...]} индексы для eye ROI
 * @returns {Object} результат {value, rawValue, status, roi, faceValue?, eyeValue?}
 */
export function analyzeIllumination(imageData, thresholds = ILLUMINATION_THRESHOLDS, landmarks = null, eyeLandmarkIndices = null) {
    const width = imageData.width;
    const height = imageData.height;

    const faceRoi = landmarks ? landmarksToPixelRoi(landmarks, width, height, 0.05) : null;
    const primary = meanBrightnessInRect(imageData, faceRoi);
    const avgBrightness = primary.avg;
    const normalizedValue = Math.round((avgBrightness / 255) * 100);

    let status = 'optimal';
    if (avgBrightness < thresholds.tooDark) {
        status = 'too_dark';
    } else if (avgBrightness > thresholds.tooBright) {
        status = 'too_bright';
    }

    const result = {
        value: normalizedValue,
        rawValue: Math.round(avgBrightness),
        status,
        roi: faceRoi ? 'face' : 'full_frame'
    };

    // Дополнительно: eye ROI (если есть landmarks глаз) — диагностика контрового света
    // и пересветов на лбу/щёках. Не влияет на status, но полезен для UI/QC.
    if (faceRoi && landmarks && eyeLandmarkIndices) {
        const eyeLandmarks = [];
        const collect = (idx) => {
            const p = landmarks[idx];
            if (p) eyeLandmarks.push(p);
        };
        if (Array.isArray(eyeLandmarkIndices.left)) eyeLandmarkIndices.left.forEach(collect);
        if (Array.isArray(eyeLandmarkIndices.right)) eyeLandmarkIndices.right.forEach(collect);
        const eyeRoi = landmarksToPixelRoi(eyeLandmarks, width, height, 0.10);
        if (eyeRoi) {
            const eye = meanBrightnessInRect(imageData, eyeRoi);
            result.eyeValue = Math.round((eye.avg / 255) * 100);
            result.eyeRawValue = Math.round(eye.avg);
        }
    }

    return result;
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
