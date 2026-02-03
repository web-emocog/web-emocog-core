/**
 * PreCheck Analyzer Thresholds
 * 
 * Пороговые значения для анализа (ISO 19794-5)
 * 
 * @module precheck-analyzer/thresholds
 */

/**
 * Пороги освещения
 */
export const ILLUMINATION_THRESHOLDS = {
    tooDark: 30,
    tooBright: 220,
    optimalMin: 50,
    optimalMax: 180
};

/**
 * Пороги для лица
 */
export const FACE_THRESHOLDS = {
    minSize: 5,        // % от кадра
    maxSize: 60,       // % от кадра
    minConfidence: 0.5,
    validZone: {
        minX: 0.15,
        maxX: 0.85,
        minY: 0.10,
        maxY: 0.90
    }
};

/**
 * Пороги для позы головы
 */
export const POSE_THRESHOLDS = {
    maxYaw: 10,        // градусы
    maxPitch: 10,      // градусы
    maxRoll: 8,        // градусы
    stabilityThreshold: 0.05,
    stabilityWindow: 500,  // ms
    // Пороги для центрирования глаз
    eyesCenterMaxDeviation: 0.15,
    eyesCenterOptimalDeviation: 0.08
};

/**
 * Пороги для глаз
 */
export const EYES_THRESHOLDS = {
    earThreshold: 0.2,    // Eye Aspect Ratio
    minOpenRatio: 0.25
};

/**
 * Размер истории для анализа стабильности
 */
export const HISTORY_SIZE = 15;

/**
 * Создание объекта порогов с пользовательскими значениями
 * @param {Object} options - пользовательские пороги
 * @returns {Object} объединённые пороги
 */
export function createThresholds(options = {}) {
    return {
        illumination: {
            tooDark: options.illuminationTooDark ?? ILLUMINATION_THRESHOLDS.tooDark,
            tooBright: options.illuminationTooBright ?? ILLUMINATION_THRESHOLDS.tooBright,
            optimalMin: ILLUMINATION_THRESHOLDS.optimalMin,
            optimalMax: ILLUMINATION_THRESHOLDS.optimalMax
        },
        face: {
            minSize: options.faceMinSize ?? FACE_THRESHOLDS.minSize,
            maxSize: options.faceMaxSize ?? FACE_THRESHOLDS.maxSize,
            minConfidence: FACE_THRESHOLDS.minConfidence,
            validZone: { ...FACE_THRESHOLDS.validZone }
        },
        pose: {
            maxYaw: options.maxYaw ?? POSE_THRESHOLDS.maxYaw,
            maxPitch: options.maxPitch ?? POSE_THRESHOLDS.maxPitch,
            maxRoll: options.maxRoll ?? POSE_THRESHOLDS.maxRoll,
            stabilityThreshold: POSE_THRESHOLDS.stabilityThreshold,
            stabilityWindow: POSE_THRESHOLDS.stabilityWindow,
            eyesCenterMaxDeviation: POSE_THRESHOLDS.eyesCenterMaxDeviation,
            eyesCenterOptimalDeviation: POSE_THRESHOLDS.eyesCenterOptimalDeviation
        },
        eyes: { ...EYES_THRESHOLDS }
    };
}
