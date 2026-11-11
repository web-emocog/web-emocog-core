/**
 * Face Segmenter Default Thresholds
 * 
 * Пороговые значения для анализа видимости лица
 * 
 * v1.3 - Области ограничены контуром лица, global body_skin только diagnostic.
 * Численные пороги v1.2 сохранены:
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
    // Это региональная эвристика перекрытия, не отдельный классификатор руки.
    handOcclusionThreshold: 0.05,
    
    // Legacy option для диагностических потребителей; сам по себе не бракует лицо.
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
export const REGION_THRESHOLDS = Object.freeze({
    forehead: Object.freeze({ minFaceSkin: 0.40, maxHair: 0.35, maxHand: 0.05 }),
    leftCheek: Object.freeze({ minFaceSkin: 0.45, maxHair: 0.20, maxHand: 0.05 }),
    rightCheek: Object.freeze({ minFaceSkin: 0.45, maxHair: 0.20, maxHand: 0.05 }),
    leftEye: Object.freeze({ minFaceSkin: 0.20, maxHair: 0.15, maxHand: 0.05 }),
    rightEye: Object.freeze({ minFaceSkin: 0.20, maxHair: 0.15, maxHand: 0.05 }),
    nose: Object.freeze({ minFaceSkin: 0.40, maxHair: 0.10, maxHand: 0.08 }),
    mouth: Object.freeze({ minFaceSkin: 0.35, maxHair: 0.10, maxHand: 0.08 }),
    chin: Object.freeze({ minFaceSkin: 0.30, maxHair: 0.20, maxHand: 0.10 })
});

const REGION_KEYS = { minFaceSkin: 'minSkinVisibility', maxHair: 'hairOcclusionThreshold',
    maxHand: 'handOcclusionThreshold' };

export function createSegmentThresholds(options = {}) {
    const thresholds = { ...DEFAULT_THRESHOLDS };
    for (const key of Object.keys(thresholds)) {
        const value = options[key];
        if (Number.isFinite(value) && value >= 0 && value <= 1) thresholds[key] = value;
    }
    thresholds.regions = {};
    for (const [name, defaults] of Object.entries(REGION_THRESHOLDS)) {
        const region = { ...defaults };
        for (const [key, globalKey] of Object.entries(REGION_KEYS)) {
            const global = options[globalKey], local = options.regions?.[name]?.[key];
            if (Number.isFinite(global) && global >= 0 && global <= 1) region[key] = global;
            if (Number.isFinite(local) && local >= 0 && local <= 1) region[key] = local;
        }
        thresholds.regions[name] = region;
    }
    return thresholds;
}

export function getAreaThresholds(areaName, baseThresholds = DEFAULT_THRESHOLDS) {
    const resolved = baseThresholds.regions ? baseThresholds : createSegmentThresholds(
        Object.fromEntries(Object.entries(baseThresholds).filter(([key, value]) => value !== DEFAULT_THRESHOLDS[key]))
    );
    return { ...(resolved.regions[areaName] || {
        minFaceSkin: resolved.minSkinVisibility, maxHair: resolved.hairOcclusionThreshold,
        maxHand: resolved.handOcclusionThreshold
    }) };
}
