/**
 * QC Metrics Constants
 *
 * Пороговые значения и веса. Синхронизировано с production-обёрткой
 * qc-metrics.js v3.5.
 *
 * @module qc-metrics/constants
 */

/**
 * Дефолтные пороговые значения для QC
 */
export const DEFAULT_THRESHOLDS = {
    // session length
    minDurationMs: 8000,

    // instrument QC
    face_visible_pct_min: 85,
    face_ok_pct_min: 85,
    pose_ok_pct_min: 85,
    illumination_ok_pct_min: 92,
    eyes_open_pct_min: 85,
    occlusion_pct_max: 20,

    // gaze QC (computed on VALID gaze only)
    gaze_valid_pct_min: 80,
    gaze_on_screen_pct_min: 85,

    // gaze accuracy thresholds (from validation)
    // v2.2.0: relaxed from 8%/4% to 12%/6% — realistic for webcam iris tracking
    // Academic webcam eye-trackers achieve ~3-5° ≈ 5-10% diagonal in ideal conditions;
    // with edge/corner points, 12%/6% is a reasonable pass threshold
    gaze_accuracy_pct_max: 12, // previously 8
    gaze_precision_pct_max: 6, // previously 4

    // fps QC
    fps_baseline_warmup_ms: 2000,
    fps_low_factor: 0.5,
    fps_low_abs_cap: 10,
    fps_low_abs_floor: 6,
    fps_absolute_min: 12, // Абсолютный минимум FPS камеры (ниже — всегда low)
    maxLowFpsTimeMs: 4000,
    maxConsecutiveLowFpsMs: 2000,

    // pose thresholds (используются в addGazePoint для onScreen-инференса по позе)
    pose_yaw_on_max: 20,
    pose_pitch_on_max: 18,
    pose_yaw_off_min: 35,
    pose_pitch_off_min: 30,

    // dropout segments
    maxConsecutiveDropoutMs: 1200,

    // tracking deviation (отклонение взгляда от подвижной цели)
    tracking_on_target_base_radius_pct: 0.15,
    tracking_on_target_min_pct: 50
};

/**
 * ID видео элементов для поиска камеры
 * [LEGACY - DELETE "webgazerVideoFeed" when gaze-tracker.js ready]
 */
export const VIDEO_ELEMENT_IDS = [
    "precheckVideo",
    "webgazerVideoFeed",
    "video",
    "camera",
    "webcam"
];

/**
 * Весовые коэффициенты для QC Score (sum = 1.0).
 * Синхронизированы с production-обёрткой qc-metrics.js v3.5.
 */
export const QC_WEIGHTS = {
    faceVis: 0.12,
    faceOk: 0.14,
    poseOk: 0.14,
    lightOk: 0.10,
    eyesOpen: 0.06,
    occlInv: 0.08,
    gazeValid: 0.12,
    gazeOn: 0.12,
    gazeAccuracy: 0.06,
    fpsOk: 0.06,
};

/**
 * Множители «жёстких пенальти» для QC Score: при провале конкретной проверки
 * результат умножается на (1 - factor). Совпадают с обёрткой qc-metrics.js v3.5.
 */
export const QC_PENALTIES = {
    duration: 0.65,
    faceVisible: 0.40,
    faceOk: 0.40,
    poseOk: 0.45,
    illumination: 0.35,
    occlusion: 0.30,
    gazeValid: 0.30,
    gazeOnScreen: 0.30,
    gazeAccuracy: 0.25,
    lowFps: 0.40,
};

/**
 * Создание объекта порогов с пользовательскими значениями
 */
export function createThresholds(options = {}) {
    return { ...DEFAULT_THRESHOLDS, ...options };
}
