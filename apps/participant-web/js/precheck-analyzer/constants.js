/**
 * PreCheck Analyzer Constants
 * 
 * Индексы лэндмарок MediaPipe Face Mesh
 * 
 * @module precheck-analyzer/constants
 */

/**
 * Индексы лэндмарок MediaPipe Face Mesh (478 точек)
 * Только необходимые для анализа
 */
export const LANDMARKS = {
    // Глаза (для EAR - Eye Aspect Ratio)
    LEFT_EYE: [362, 385, 387, 263, 373, 380],
    RIGHT_EYE: [33, 160, 158, 133, 153, 144],
    
    // Iris (для центрирования и направления взгляда)
    LEFT_IRIS: [468, 469, 470, 471, 472],
    RIGHT_IRIS: [473, 474, 475, 476, 477],
    
    // Центры глаз (для проверки центрирования)
    LEFT_EYE_CENTER: 468,
    RIGHT_EYE_CENTER: 473,
    
    // Губы (для анализа рта)
    LIPS_OUTER: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
    
    // Ключевые точки для рта
    UPPER_LIP: 13,
    LOWER_LIP: 14,
    LEFT_MOUTH_CORNER: 61,
    RIGHT_MOUTH_CORNER: 291
};

/**
 * Индексы лэндмарок для eye ROI illumination (LEFT_EYE + RIGHT_EYE).
 * Используется в analyzeIllumination() для расчёта яркости отдельно по зоне глаз.
 */
export const EYE_LANDMARK_INDICES = {
    left: LANDMARKS.LEFT_EYE,
    right: LANDMARKS.RIGHT_EYE
};

/**
 * Минимальное количество лэндмарок для полного анализа
 */
export const MIN_LANDMARKS_FULL = 478;

/**
 * Минимальное количество лэндмарок для базового анализа
 */
export const MIN_LANDMARKS_BASIC = 468;
