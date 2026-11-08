/**
 * Константы GazeTracker
 * Индексы landmarks из MediaPipe Face Landmarker для отслеживания радужки и глаз.
 * 
 * @module gaze-tracker/constants
 */

// Индексы MediaPipe Face Landmarker (модель с 478 landmarks и радужкой)
export const LANDMARKS = {
    // Anatomical sides, SAME eye as its contour below. Mirroring the preview
    // does not swap MediaPipe landmark indices (LEFT iris ring is 474..477).
    LEFT_IRIS: [473, 474, 475, 476, 477],
    RIGHT_IRIS: [468, 469, 470, 471, 472],
    LEFT_IRIS_CENTER: 473,
    RIGHT_IRIS_CENTER: 468,

    // Опорные точки глаз для нормализации
    LEFT_EYE_INNER: 362,
    LEFT_EYE_OUTER: 263,
    LEFT_EYE_TOP: 386,
    LEFT_EYE_BOTTOM: 374,
    RIGHT_EYE_INNER: 133,
    RIGHT_EYE_OUTER: 33,
    RIGHT_EYE_TOP: 159,
    RIGHT_EYE_BOTTOM: 145,

    // Опорные точки лица для нормализации позы головы
    NOSE_TIP: 1,
    LEFT_EAR: 234,
    RIGHT_EAR: 454,
    FOREHEAD: 10,
    CHIN: 152
};

export const FEATURE_METHOD = 'same_eye_iris.v2';
export const EXPERIMENTAL_FEATURE_METHOD = 'corner_width_iris.experimental.v1';
export const CALIBRATION_SAMPLING = 'open_eye_calibration.v1';

// Минимально необходимое число landmarks (478 = полная модель с радужкой)
export const MIN_LANDMARKS = 478;

// Iris-only predictor: 11 признаков + bias. Head pose/translation is evaluated
// independently as a confidence/OOD nuisance channel.
export const FEATURE_SIZE = 12;

// Конфигурация по умолчанию.
// The UI collects 25 targets x 2 clicks. Sixteen rows keep the 12-column
// iris-only system identifiable in degraded/recovery scenarios.
export const DEFAULTS = {
    ridgeLambda: 0.001,
    ridgeLambdaCandidates: [0.001, 0.01, 0.1, 1],
    minCalibrationPoints: 16,
    minCutoffHz: 1.35,
    maxCutoffHz: 12,
    velocityGain: 5.5
};
