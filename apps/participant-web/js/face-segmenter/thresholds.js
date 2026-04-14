/**
 * Face Segmenter Default Thresholds
 * 
 * Пороговые значения для анализа видимости лица
 * 
 * v1.2 - Улучшена детекция руки на лице:
 * - Снижены пороги handOcclusionThreshold до 0.05 (5%)
 * - Более агрессивная детекция body_skin в областях лица
 * - Добавлен глобальный анализ body_skin по всему лицу
 * 
 * v1.1 - Улучшена детекция окклюзий:
 * - body_skin в области лица теперь считается окклюзией (рука)
 * - Более строгие пороги для лба (волосы)
 * - Добавлен анализ аномального присутствия body_skin
 * 
 * @module face-segmenter/thresholds
 */

/**
 * Дефолтные пороговые значения
 */
export const DEFAULT_THRESHOLDS = {
    // Минимальная уверенность для маски
    maskConfidence: 0.5,
    
    // Минимальный процент видимой кожи лица в каждой области
    minSkinVisibility: 0.60,
    
    // Минимальный процент кожи для всего лица
    minTotalFaceSkin: 0.55,
    
    // Порог для определения окклюзии волосами
    hairOcclusionThreshold: 0.25,
    
    // Порог для определения окклюзии рукой (body_skin в области лица)
    // ВАЖНО: body_skin НЕ должно быть в области лица вообще!
    // Если > 5% области лица = body_skin, это рука
    handOcclusionThreshold: 0.05,
    
    // Глобальный порог body_skin для всего лица
    // Если > 8% всего лица = body_skin, точно рука
    globalHandThreshold: 0.08,
    
    // Допустимая асимметрия между левой и правой стороной
    maxAsymmetry: 0.30
};

/**
 * Пороги для конкретных областей лица
 * Возвращает настроенные пороги в зависимости от области
 * 
 * @param {string} areaName - название области (forehead, leftCheek, etc.)
 * @param {Object} baseThresholds - базовые пороги
 * @returns {Object} - пороги для области {minFaceSkin, maxHair, maxHand}
 */
export function getAreaThresholds(areaName, baseThresholds) {
    let minFaceSkinThreshold = baseThresholds.minSkinVisibility;
    let maxHairThreshold = baseThresholds.hairOcclusionThreshold;
    let maxHandThreshold = baseThresholds.handOcclusionThreshold;

    // Для разных областей разные пороги
    // v1.2: Значительно снижены пороги для body_skin (рука)
    switch (areaName) {
        case 'forehead':
            // Лоб часто закрыт волосами — более строгий порог для волос
            maxHairThreshold = 0.35;
            minFaceSkinThreshold = 0.40;
            maxHandThreshold = 0.05;  // Снижено с 0.10 — руки на лбу редки, но если есть — сразу детектим
            break;
        case 'leftCheek':
        case 'rightCheek':
            // Щёки критичны для трекинга — очень строгие пороги для руки
            minFaceSkinThreshold = 0.45;
            maxHairThreshold = 0.20;
            maxHandThreshold = 0.05;  // Снижено с 0.12 — даже 5% body_skin на щеке = рука
            break;
        case 'leftEye':
        case 'rightEye':
            // Глаза должны быть видимы
            minFaceSkinThreshold = 0.20;
            maxHairThreshold = 0.15;
            maxHandThreshold = 0.05;  // Снижено с 0.10
            break;
        case 'nose':
            // Нос обычно виден
            minFaceSkinThreshold = 0.40;
            maxHairThreshold = 0.10;
            maxHandThreshold = 0.08;  // Снижено с 0.15
            break;
        case 'mouth':
            // Рот может быть частично закрыт рукой
            minFaceSkinThreshold = 0.35;
            maxHairThreshold = 0.10;
            maxHandThreshold = 0.08;  // Снижено с 0.15
            break;
        case 'chin':
            // Подбородок может быть закрыт рукой
            minFaceSkinThreshold = 0.30;
            maxHairThreshold = 0.20;
            maxHandThreshold = 0.10;  // Снижено с 0.20
            break;
    }

    return {
        minFaceSkin: minFaceSkinThreshold,
        maxHair: maxHairThreshold,
        maxHand: maxHandThreshold
    };
}
