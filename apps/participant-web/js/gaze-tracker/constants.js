/**
 * Константы GazeTracker
 * Индексы landmarks из MediaPipe Face Landmarker для отслеживания радужки и глаз.
 * 
 * @module gaze-tracker/constants
 */

// Индексы MediaPipe Face Landmarker (модель с 478 landmarks и радужкой)
export const LANDMARKS = {
    // Точки landmarks радужки (по 5 точек на каждый глаз)
    LEFT_IRIS: [468, 469, 470, 471, 472],
    RIGHT_IRIS: [473, 474, 475, 476, 477],
    LEFT_IRIS_CENTER: 468,
    RIGHT_IRIS_CENTER: 473,

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

// Минимально необходимое число landmarks (478 = полная модель с радужкой)
export const MIN_LANDMARKS = 478;

// Размер вектора признаков (16 признаков + 1 bias = 17)
export const FEATURE_SIZE = 17;

// Конфигурация по умолчанию
export const DEFAULTS = {
    ridgeLambda: 0.001,
    smoothingFactor: 0.10,
    minCalibrationPoints: 4
};
