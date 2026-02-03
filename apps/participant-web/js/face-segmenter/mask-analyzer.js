/**
 * Mask Analyzer
 * 
 * Функции анализа масок сегментации MediaPipe
 * 
 * @module face-segmenter/mask-analyzer
 */

import { CLASS_INDICES, CLASS_NAMES } from './constants.js';

/**
 * Анализ масок сегментации
 * 
 * @param {Object} segmentationResult - результат сегментации от MediaPipe
 * @param {number} width - ширина кадра
 * @param {number} height - высота кадра
 * @param {Array|null} faceLandmarks - лэндмарки лица (опционально)
 * @returns {Object} результат анализа масок
 */
export function analyzeMasks(segmentationResult, width, height, faceLandmarks) {
    const result = {
        hasData: false,
        classDistribution: {},
        faceRegion: null,
        confidenceMap: null,
        // Сохраняем сырые данные для точного анализа областей
        _rawMaskData: null,
        _maskDimensions: null
    };

    // Получаем категориальную маску
    const categoryMask = segmentationResult.categoryMask;
    if (!categoryMask) {
        return result;
    }

    result.hasData = true;

    // Получаем данные маски
    const maskData = categoryMask.getAsUint8Array();
    const maskWidth = categoryMask.width;
    const maskHeight = categoryMask.height;

    // Сохраняем копию сырых данных для анализа областей
    result._rawMaskData = new Uint8Array(maskData);
    result._maskDimensions = { width: maskWidth, height: maskHeight };

    // Считаем распределение классов
    const classCounts = new Array(6).fill(0);
    const totalPixels = maskData.length;

    for (let i = 0; i < maskData.length; i++) {
        const classIdx = maskData[i];
        if (classIdx < classCounts.length) {
            classCounts[classIdx]++;
        }
    }

    // Формируем распределение
    for (let i = 0; i < classCounts.length; i++) {
        result.classDistribution[CLASS_NAMES[i]] = {
            count: classCounts[i],
            ratio: classCounts[i] / totalPixels
        };
    }

    // Определяем область лица на основе лэндмарок или центра кадра
    result.faceRegion = extractFaceRegion(maskData, maskWidth, maskHeight, faceLandmarks, width, height);

    // Получаем карту уверенности для кожи лица (если доступна)
    if (segmentationResult.confidenceMasks && segmentationResult.confidenceMasks.length > CLASS_INDICES.FACE_SKIN) {
        const faceSkinMask = segmentationResult.confidenceMasks[CLASS_INDICES.FACE_SKIN];
        if (faceSkinMask) {
            result.confidenceMap = {
                faceSkin: extractConfidenceStats(faceSkinMask, faceLandmarks, width, height)
            };
        }
    }

    return result;
}

/**
 * Извлечение и анализ области лица из маски
 * 
 * @param {Uint8Array} maskData - данные маски
 * @param {number} maskWidth - ширина маски
 * @param {number} maskHeight - высота маски
 * @param {Array|null} faceLandmarks - лэндмарки лица
 * @param {number} frameWidth - ширина кадра
 * @param {number} frameHeight - высота кадра
 * @returns {Object} статистика области лица
 */
export function extractFaceRegion(maskData, maskWidth, maskHeight, faceLandmarks, frameWidth, frameHeight) {
    // Определяем bounding box лица
    let faceBox;
    
    if (faceLandmarks && faceLandmarks.length > 0) {
        // Используем лэндмарки для определения области
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const point of faceLandmarks) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
        
        // Расширяем область на 10% для захвата волос по краям
        const padX = (maxX - minX) * 0.1;
        const padY = (maxY - minY) * 0.1;
        
        faceBox = {
            x: Math.max(0, minX - padX),
            y: Math.max(0, minY - padY),
            width: Math.min(1, maxX - minX + 2 * padX),
            height: Math.min(1, maxY - minY + 2 * padY)
        };
    } else {
        // Используем центральную область кадра
        faceBox = { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };
    }

    // Преобразуем координаты в координаты маски
    const startX = Math.floor(faceBox.x * maskWidth);
    const endX = Math.floor((faceBox.x + faceBox.width) * maskWidth);
    const startY = Math.floor(faceBox.y * maskHeight);
    const endY = Math.floor((faceBox.y + faceBox.height) * maskHeight);

    // Анализируем пиксели в области лица
    const regionStats = {
        totalPixels: 0,
        faceSkin: 0,
        hair: 0,
        background: 0,
        bodySkin: 0,
        clothes: 0,
        others: 0
    };

    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const idx = y * maskWidth + x;
            if (idx >= maskData.length) continue;
            
            const classIdx = maskData[idx];
            regionStats.totalPixels++;
            
            switch (classIdx) {
                case CLASS_INDICES.FACE_SKIN:
                    regionStats.faceSkin++;
                    break;
                case CLASS_INDICES.HAIR:
                    regionStats.hair++;
                    break;
                case CLASS_INDICES.BACKGROUND:
                    regionStats.background++;
                    break;
                case CLASS_INDICES.BODY_SKIN:
                    regionStats.bodySkin++;
                    break;
                case CLASS_INDICES.CLOTHES:
                    regionStats.clothes++;
                    break;
                default:
                    regionStats.others++;
            }
        }
    }

    // Вычисляем соотношения
    const total = regionStats.totalPixels || 1;
    
    return {
        boundingBox: faceBox,
        stats: regionStats,
        ratios: {
            faceSkin: regionStats.faceSkin / total,
            hair: regionStats.hair / total,
            background: regionStats.background / total,
            bodySkin: regionStats.bodySkin / total,
            clothes: regionStats.clothes / total,
            others: regionStats.others / total,
            // Общая видимость кожи (лицо + тело)
            totalSkin: (regionStats.faceSkin + regionStats.bodySkin) / total,
            // Окклюзия (волосы + другое)
            occlusion: (regionStats.hair + regionStats.others + regionStats.clothes) / total
        }
    };
}

/**
 * Извлечение статистики уверенности для маски
 * 
 * @param {Object} confidenceMask - маска уверенности от MediaPipe
 * @param {Array|null} faceLandmarks - лэндмарки лица
 * @param {number} frameWidth - ширина кадра
 * @param {number} frameHeight - высота кадра
 * @param {number} threshold - порог уверенности
 * @returns {Object} статистика уверенности
 */
export function extractConfidenceStats(confidenceMask, faceLandmarks, frameWidth, frameHeight, threshold = 0.5) {
    const data = confidenceMask.getAsFloat32Array();
    const width = confidenceMask.width;
    const height = confidenceMask.height;

    let sum = 0;
    let count = 0;
    let highConfCount = 0;

    // Если есть лэндмарки, анализируем только область лица
    if (faceLandmarks && faceLandmarks.length > 0) {
        for (const point of faceLandmarks) {
            const x = Math.floor(point.x * width);
            const y = Math.floor(point.y * height);
            const idx = y * width + x;
            
            if (idx >= 0 && idx < data.length) {
                const confidence = data[idx];
                sum += confidence;
                count++;
                if (confidence >= threshold) {
                    highConfCount++;
                }
            }
        }
    } else {
        // Анализируем весь кадр
        for (let i = 0; i < data.length; i++) {
            const confidence = data[i];
            sum += confidence;
            count++;
            if (confidence >= threshold) {
                highConfCount++;
            }
        }
    }

    return {
        averageConfidence: count > 0 ? sum / count : 0,
        highConfidenceRatio: count > 0 ? highConfCount / count : 0,
        sampledPoints: count
    };
}
