/**
 * Region Analyzer
 * 
 * Анализ видимости конкретных областей лица
 * 
 * @module face-segmenter/region-analyzer
 */

import { CLASS_INDICES, LANDMARK_INDICES } from './constants.js';
import { getAreaThresholds } from './thresholds.js';

/**
 * Определение областей лица по лэндмаркам MediaPipe Face Mesh
 * 
 * @param {Array} landmarks - массив лэндмарок (478 точек)
 * @returns {Object} области лица с координатами
 */
export function defineFaceAreas(landmarks) {
    const getAreaBounds = (indices) => {
        const points = indices.map(i => landmarks[i]).filter(p => p);
        if (points.length === 0) return null;
        
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const p of points) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
        
        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
            points
        };
    };

    return {
        forehead: getAreaBounds(LANDMARK_INDICES.FOREHEAD),
        leftCheek: getAreaBounds(LANDMARK_INDICES.LEFT_CHEEK),
        rightCheek: getAreaBounds(LANDMARK_INDICES.RIGHT_CHEEK),
        leftEye: getAreaBounds(LANDMARK_INDICES.LEFT_EYE),
        rightEye: getAreaBounds(LANDMARK_INDICES.RIGHT_EYE),
        nose: getAreaBounds(LANDMARK_INDICES.NOSE),
        mouth: getAreaBounds(LANDMARK_INDICES.MOUTH),
        chin: getAreaBounds(LANDMARK_INDICES.CHIN)
    };
}

/**
 * Анализ видимости конкретной области лица (fallback без пиксельного анализа)
 * Проверяет, какой процент области покрыт кожей vs волосами/другим
 * 
 * @param {Object} maskAnalysis - результат анализа маски
 * @param {Object} areaBounds - границы области
 * @param {string} areaName - название области
 * @param {Object} thresholds - пороговые значения
 * @returns {Object} результат анализа видимости
 */
export function analyzeAreaVisibility(maskAnalysis, areaBounds, areaName, thresholds) {
    if (!areaBounds || !maskAnalysis.hasData) {
        return { isVisible: false, skinRatio: 0, hairRatio: 0, reason: 'no_data' };
    }

    // Если есть сохранённые данные маски, делаем точечный анализ
    if (maskAnalysis._rawMaskData && maskAnalysis._maskDimensions) {
        return analyzeAreaPixels(
            maskAnalysis._rawMaskData,
            maskAnalysis._maskDimensions,
            areaBounds,
            areaName,
            thresholds
        );
    }

    // Fallback: используем общие данные о соотношении классов
    const faceRegion = maskAnalysis.faceRegion;
    if (!faceRegion) {
        return { isVisible: false, skinRatio: 0, hairRatio: 0, reason: 'no_face_region' };
    }
    
    const skinRatio = faceRegion.ratios.faceSkin;
    const hairRatio = faceRegion.ratios.hair;
    
    // Определяем видимость на основе порогов
    const isCheekorForehead = ['leftCheek', 'rightCheek', 'forehead'].includes(areaName);
    const minSkin = isCheekorForehead 
        ? thresholds.minSkinVisibility 
        : thresholds.minSkinVisibility * 0.8;
    
    const isVisible = skinRatio >= minSkin && hairRatio < thresholds.hairOcclusionThreshold;

    return {
        isVisible,
        skinRatio: Math.round(skinRatio * 100) / 100,
        hairRatio: Math.round(hairRatio * 100) / 100,
        occlusionRatio: Math.round(faceRegion.ratios.occlusion * 100) / 100,
        bounds: areaBounds,
        areaName,
        reason: !isVisible ? (hairRatio >= thresholds.hairOcclusionThreshold ? 'hair_occlusion' : 'low_skin') : null
    };
}

/**
 * Точный пиксельный анализ конкретной области лица
 * 
 * @param {Uint8Array} maskData - данные категориальной маски
 * @param {Object} dimensions - размеры маски {width, height}
 * @param {Object} areaBounds - границы области {x, y, width, height, points}
 * @param {string} areaName - название области для логирования
 * @param {Object} thresholds - пороговые значения
 * @returns {Object} детальный результат анализа
 */
export function analyzeAreaPixels(maskData, dimensions, areaBounds, areaName, thresholds) {
    const { width: maskWidth, height: maskHeight } = dimensions;
    
    // Преобразуем нормализованные координаты в координаты маски
    const startX = Math.max(0, Math.floor(areaBounds.x * maskWidth));
    const endX = Math.min(maskWidth, Math.ceil((areaBounds.x + areaBounds.width) * maskWidth));
    const startY = Math.max(0, Math.floor(areaBounds.y * maskHeight));
    const endY = Math.min(maskHeight, Math.ceil((areaBounds.y + areaBounds.height) * maskHeight));

    // Счётчики классов для этой области
    const counts = {
        total: 0,
        faceSkin: 0,
        bodySkin: 0,
        hair: 0,
        background: 0,
        clothes: 0,
        others: 0
    };

    // Анализируем пиксели в прямоугольной области
    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const idx = y * maskWidth + x;
            if (idx >= maskData.length) continue;
            
            const classIdx = maskData[idx];
            counts.total++;
            
            switch (classIdx) {
                case CLASS_INDICES.FACE_SKIN:
                    counts.faceSkin++;
                    break;
                case CLASS_INDICES.BODY_SKIN:
                    counts.bodySkin++;
                    break;
                case CLASS_INDICES.HAIR:
                    counts.hair++;
                    break;
                case CLASS_INDICES.BACKGROUND:
                    counts.background++;
                    break;
                case CLASS_INDICES.CLOTHES:
                    counts.clothes++;
                    break;
                default:
                    counts.others++;
            }
        }
    }

    // Дополнительно: если есть точки лэндмарок, сэмплируем их
    if (areaBounds.points && areaBounds.points.length > 0) {
        const pointCounts = { faceSkin: 0, bodySkin: 0, hair: 0, other: 0, total: 0 };
        
        for (const point of areaBounds.points) {
            const px = Math.floor(point.x * maskWidth);
            const py = Math.floor(point.y * maskHeight);
            const pidx = py * maskWidth + px;
            
            if (pidx >= 0 && pidx < maskData.length) {
                pointCounts.total++;
                const classIdx = maskData[pidx];
                
                if (classIdx === CLASS_INDICES.FACE_SKIN) {
                    pointCounts.faceSkin++;
                } else if (classIdx === CLASS_INDICES.BODY_SKIN) {
                    // body_skin на лэндмарках лица = вероятно рука
                    pointCounts.bodySkin++;
                } else if (classIdx === CLASS_INDICES.HAIR) {
                    pointCounts.hair++;
                } else {
                    pointCounts.other++;
                }
            }
        }
        
        // Сохраняем результаты сэмплирования по лэндмаркам
        if (pointCounts.total > 0) {
            counts.landmarkFaceSkinRatio = pointCounts.faceSkin / pointCounts.total;
            counts.landmarkBodySkinRatio = pointCounts.bodySkin / pointCounts.total;
            counts.landmarkHairRatio = pointCounts.hair / pointCounts.total;
        }
    }

    // Вычисляем соотношения
    const total = counts.total || 1;
    
    // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ v1.1:
    // body_skin в области лица — это окклюзия (рука), НЕ видимая кожа лица!
    // Только face_skin считается видимой кожей лица
    const faceSkinRatio = counts.faceSkin / total;
    const bodySkinRatio = counts.bodySkin / total;
    const hairRatio = counts.hair / total;
    
    // Окклюзия = волосы + body_skin (рука) + одежда + другое
    const occlusionRatio = (counts.hair + counts.bodySkin + counts.clothes + counts.others) / total;
    
    // Получаем пороги для конкретной области
    const areaThresholds = getAreaThresholds(areaName, thresholds);

    // Определяем видимость
    // Область видима если:
    // 1. Достаточно face_skin
    // 2. Не слишком много волос
    // 3. Не слишком много body_skin (рука)
    const isVisible = faceSkinRatio >= areaThresholds.minFaceSkin && 
                      hairRatio < areaThresholds.maxHair && 
                      bodySkinRatio < areaThresholds.maxHand;
    
    // Определяем причину невидимости
    let reason = null;
    if (!isVisible) {
        if (bodySkinRatio >= areaThresholds.maxHand) {
            // Приоритет: рука на лице — самая частая проблема
            reason = 'hand_occlusion';
        } else if (hairRatio >= areaThresholds.maxHair) {
            reason = 'hair_occlusion';
        } else if (faceSkinRatio < areaThresholds.minFaceSkin) {
            if (occlusionRatio > 0.3) {
                reason = 'object_occlusion';
            } else if (counts.background / total > 0.3) {
                reason = 'out_of_frame';
            } else {
                reason = 'low_skin_visibility';
            }
        }
    }

    return {
        isVisible,
        faceSkinRatio: Math.round(faceSkinRatio * 100) / 100,
        bodySkinRatio: Math.round(bodySkinRatio * 100) / 100,  // Отдельно показываем body_skin
        hairRatio: Math.round(hairRatio * 100) / 100,
        occlusionRatio: Math.round(occlusionRatio * 100) / 100,
        backgroundRatio: Math.round((counts.background / total) * 100) / 100,
        bounds: {
            x: areaBounds.x,
            y: areaBounds.y,
            width: areaBounds.width,
            height: areaBounds.height
        },
        pixelCounts: counts,
        thresholds: areaThresholds,
        areaName,
        reason,
        // Для обратной совместимости
        skinRatio: Math.round(faceSkinRatio * 100) / 100,
        // Дополнительная инфа для отладки
        landmarkFaceSkinRatio: counts.landmarkFaceSkinRatio,
        landmarkBodySkinRatio: counts.landmarkBodySkinRatio,
        landmarkHairRatio: counts.landmarkHairRatio
    };
}

/**
 * Анализ видимости всех областей лица
 * 
 * @param {Object} maskAnalysis - результат анализа маски
 * @param {Array|null} faceLandmarks - лэндмарки лица
 * @param {number} frameWidth - ширина кадра
 * @param {number} frameHeight - высота кадра
 * @param {Object} thresholds - пороговые значения
 * @returns {Object} полный результат анализа видимости
 */
export function analyzeFaceRegionsVisibility(maskAnalysis, faceLandmarks, frameWidth, frameHeight, thresholds) {
    if (!maskAnalysis.hasData) {
        return {
            isComplete: false,
            score: 0,
            issues: ['no_segmentation_data'],
            regions: {}
        };
    }

    const issues = [];
    let score = 100;
    const regions = {};
    
    // Флаг для детекции руки на лице
    let handDetectedOnFace = false;
    
    // v1.2: ГЛОБАЛЬНАЯ ПРОВЕРКА body_skin по всему лицу
    // Если body_skin > globalHandThreshold в области лица — это точно рука
    if (maskAnalysis.faceRegion) {
        const globalBodySkinRatio = maskAnalysis.faceRegion.ratios.bodySkin;
        regions.globalBodySkinRatio = globalBodySkinRatio;
        
        if (globalBodySkinRatio >= thresholds.globalHandThreshold) {
            handDetectedOnFace = true;
            issues.push('hand_on_face');
            // Сильно снижаем score при глобальной детекции руки
            score -= 30;
            console.log(`[FaceSegmenter] Глобальная детекция руки: body_skin=${(globalBodySkinRatio * 100).toFixed(1)}% (порог ${thresholds.globalHandThreshold * 100}%)`);
        }
    }

    // Если есть лэндмарки, анализируем конкретные области
    if (faceLandmarks && faceLandmarks.length >= 468) {
        // Определяем области лица по лэндмаркам
        const faceAreas = defineFaceAreas(faceLandmarks);
        
        // Анализируем каждую область
        regions.forehead = analyzeAreaVisibility(maskAnalysis, faceAreas.forehead, 'forehead', thresholds);
        regions.leftCheek = analyzeAreaVisibility(maskAnalysis, faceAreas.leftCheek, 'leftCheek', thresholds);
        regions.rightCheek = analyzeAreaVisibility(maskAnalysis, faceAreas.rightCheek, 'rightCheek', thresholds);
        regions.leftEye = analyzeAreaVisibility(maskAnalysis, faceAreas.leftEye, 'leftEye', thresholds);
        regions.rightEye = analyzeAreaVisibility(maskAnalysis, faceAreas.rightEye, 'rightEye', thresholds);
        regions.nose = analyzeAreaVisibility(maskAnalysis, faceAreas.nose, 'nose', thresholds);
        regions.mouth = analyzeAreaVisibility(maskAnalysis, faceAreas.mouth, 'mouth', thresholds);
        regions.chin = analyzeAreaVisibility(maskAnalysis, faceAreas.chin, 'chin', thresholds);

        // Проверяем наличие руки на любой области лица (если ещё не детектирована глобально)
        if (!handDetectedOnFace) {
            const allRegions = [regions.forehead, regions.leftCheek, regions.rightCheek, 
                               regions.leftEye, regions.rightEye, regions.nose, 
                               regions.mouth, regions.chin];
            
            for (const region of allRegions) {
                if (region && region.reason === 'hand_occlusion') {
                    handDetectedOnFace = true;
                    break;
                }
            }
        }

        // Проверяем лоб
        if (!regions.forehead.isVisible) {
            if (regions.forehead.reason === 'hand_occlusion') {
                issues.push('forehead_hand_occluded');
            } else {
                issues.push('forehead_occluded');
            }
            score -= 15;
        }

        // Проверяем щёки (критично для eye-tracking)
        if (!regions.leftCheek.isVisible) {
            if (regions.leftCheek.reason === 'hand_occlusion') {
                issues.push('left_cheek_hand_occluded');
            } else {
                issues.push('left_cheek_occluded');
            }
            issues.push('left_side_occluded');
            score -= 20;
        }
        if (!regions.rightCheek.isVisible) {
            if (regions.rightCheek.reason === 'hand_occlusion') {
                issues.push('right_cheek_hand_occluded');
            } else {
                issues.push('right_cheek_occluded');
            }
            issues.push('right_side_occluded');
            score -= 20;
        }

        // Проверяем глаза
        if (!regions.leftEye.isVisible) {
            if (regions.leftEye.reason === 'hand_occlusion') {
                issues.push('left_eye_hand_occluded');
            } else {
                issues.push('left_eye_occluded');
            }
            score -= 15;
        }
        if (!regions.rightEye.isVisible) {
            if (regions.rightEye.reason === 'hand_occlusion') {
                issues.push('right_eye_hand_occluded');
            } else {
                issues.push('right_eye_occluded');
            }
            score -= 15;
        }
        
        // Добавляем общий issue для руки на лице (если ещё не добавлен)
        if (handDetectedOnFace && !issues.includes('hand_on_face')) {
            issues.push('hand_on_face');
        }

        // Проверяем симметрию
        const asymmetry = checkSymmetry(regions, thresholds);
        if (!asymmetry.isSymmetric) {
            if (!issues.some(i => i.includes('occluded'))) {
                issues.push('asymmetric_visibility');
                score -= 10;
            }
        }
        regions.symmetry = asymmetry;

    } else {
        // Анализируем на основе общей маски без лэндмарок
        const faceRegion = maskAnalysis.faceRegion;
        
        if (faceRegion) {
            // v1.2: НЕ считаем bodySkin как видимую кожу — это может быть рука!
            const faceSkinRatio = faceRegion.ratios.faceSkin;
            const bodySkinRatio = faceRegion.ratios.bodySkin;
            const hairRatio = faceRegion.ratios.hair;
            
            regions.overall = {
                faceSkinVisibility: faceSkinRatio,
                bodySkinRatio: bodySkinRatio,
                hairOcclusion: hairRatio,
                isVisible: faceSkinRatio >= thresholds.minTotalFaceSkin && 
                           bodySkinRatio < thresholds.globalHandThreshold
            };

            if (faceSkinRatio < thresholds.minTotalFaceSkin) {
                issues.push('insufficient_face_visibility');
                score -= 30;
            }

            if (hairRatio > thresholds.hairOcclusionThreshold) {
                issues.push('hair_occlusion');
                score -= 15;
            }
            
            // Проверка на руку без лэндмарок
            if (bodySkinRatio >= thresholds.globalHandThreshold && !handDetectedOnFace) {
                issues.push('hand_on_face');
                score -= 25;
            }
        }
    }

    // Проверяем общую видимость кожи лица из маски
    if (maskAnalysis.faceRegion) {
        // v1.2: Только face_skin считается видимой кожей лица
        const faceSkinRatio = maskAnalysis.faceRegion.ratios.faceSkin;
        regions.totalFaceSkinVisibility = faceSkinRatio;
        
        if (faceSkinRatio < thresholds.minTotalFaceSkin && !issues.includes('insufficient_face_visibility')) {
            issues.push('low_skin_visibility');
            score -= 20;
        }
    }

    // Убираем дубликаты
    const uniqueIssues = [...new Set(issues)];
    
    // v1.2: Более строгая проверка — если рука на лице, isComplete = false
    const isComplete = score >= 70 && uniqueIssues.length === 0 && !handDetectedOnFace;

    return {
        isComplete,
        score: Math.max(0, score),
        issues: uniqueIssues,
        regions,
        handDetected: handDetectedOnFace,
        thresholds
    };
}

/**
 * Проверка симметрии видимости левой и правой стороны лица
 * 
 * @param {Object} regions - результаты анализа областей
 * @param {Object} thresholds - пороговые значения
 * @returns {Object} результат проверки симметрии
 */
export function checkSymmetry(regions, thresholds) {
    const leftVisible = (regions.leftCheek?.isVisible ? 1 : 0) + (regions.leftEye?.isVisible ? 1 : 0);
    const rightVisible = (regions.rightCheek?.isVisible ? 1 : 0) + (regions.rightEye?.isVisible ? 1 : 0);
    
    const totalPossible = 2; // щека + глаз на каждой стороне
    const leftRatio = leftVisible / totalPossible;
    const rightRatio = rightVisible / totalPossible;
    
    const asymmetry = Math.abs(leftRatio - rightRatio);
    const isSymmetric = asymmetry <= thresholds.maxAsymmetry;
    
    let occludedSide = null;
    if (!isSymmetric) {
        occludedSide = leftRatio < rightRatio ? 'left' : 'right';
    }

    return {
        isSymmetric,
        asymmetry: Math.round(asymmetry * 100) / 100,
        leftVisibility: leftRatio,
        rightVisibility: rightRatio,
        occludedSide
    };
}
