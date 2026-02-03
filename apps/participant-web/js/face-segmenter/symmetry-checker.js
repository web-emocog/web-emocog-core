// filepath: /Users/egorbulanov/Documents/GitHub/web-emocog-core/apps/participant-web/js/face-segmenter/symmetry-checker.js
/**
 * Symmetry Checker
 * 
 * Проверка симметрии видимости левой и правой стороны лица
 * 
 * @module face-segmenter/symmetry-checker
 * @version 1.2.0
 */

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

/**
 * Расширенная проверка симметрии с учётом всех областей лица
 * 
 * @param {Object} regions - результаты анализа областей
 * @param {Object} thresholds - пороговые значения
 * @returns {Object} детальный результат проверки симметрии
 */
export function checkSymmetryExtended(regions, thresholds) {
    // Базовая проверка
    const basic = checkSymmetry(regions, thresholds);
    
    // Расширенная проверка: сравнение skinRatio по областям
    const leftCheekSkin = regions.leftCheek?.faceSkinRatio ?? regions.leftCheek?.skinRatio ?? 0;
    const rightCheekSkin = regions.rightCheek?.faceSkinRatio ?? regions.rightCheek?.skinRatio ?? 0;
    const leftEyeSkin = regions.leftEye?.faceSkinRatio ?? regions.leftEye?.skinRatio ?? 0;
    const rightEyeSkin = regions.rightEye?.faceSkinRatio ?? regions.rightEye?.skinRatio ?? 0;
    
    // Асимметрия по skinRatio
    const cheekSkinAsymmetry = Math.abs(leftCheekSkin - rightCheekSkin);
    const eyeSkinAsymmetry = Math.abs(leftEyeSkin - rightEyeSkin);
    
    // Детекция частичной окклюзии (одна сторона видна хуже)
    const partialOcclusion = cheekSkinAsymmetry > 0.3 || eyeSkinAsymmetry > 0.3;
    
    // Определяем какая сторона хуже видна
    let worseSide = null;
    if (partialOcclusion) {
        const leftTotal = leftCheekSkin + leftEyeSkin;
        const rightTotal = rightCheekSkin + rightEyeSkin;
        worseSide = leftTotal < rightTotal ? 'left' : 'right';
    }
    
    // Проверка на окклюзию рукой (body_skin асимметрия)
    const leftBodySkin = (regions.leftCheek?.bodySkinRatio ?? 0) + (regions.leftEye?.bodySkinRatio ?? 0);
    const rightBodySkin = (regions.rightCheek?.bodySkinRatio ?? 0) + (regions.rightEye?.bodySkinRatio ?? 0);
    const handOcclusionSide = leftBodySkin > rightBodySkin + 0.1 ? 'left' : 
                             rightBodySkin > leftBodySkin + 0.1 ? 'right' : null;

    return {
        ...basic,
        extended: {
            cheekSkinAsymmetry: Math.round(cheekSkinAsymmetry * 100) / 100,
            eyeSkinAsymmetry: Math.round(eyeSkinAsymmetry * 100) / 100,
            partialOcclusion,
            worseSide,
            handOcclusionSide,
            details: {
                leftCheekSkin,
                rightCheekSkin,
                leftEyeSkin,
                rightEyeSkin,
                leftBodySkin: Math.round(leftBodySkin * 100) / 100,
                rightBodySkin: Math.round(rightBodySkin * 100) / 100
            }
        }
    };
}

export default checkSymmetry;
