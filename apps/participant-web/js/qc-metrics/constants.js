/**
 * QC Metrics Constants
 * 
 * Пороговые значения и MIGRATION CHECKLIST
 * 
 * @module qc-metrics/constants
 */

/**
 * ============================================================================
 * MIGRATION CHECKLIST (when gaze-tracker.js is ready):
 * ============================================================================
 * 
 * ▸ STEP 1: IN THIS FILE (qc-metrics.js)
 * --------------------------------------
 * 1. DELETE method: addGazePoint()
 * 2. DELETE method: _inferOnScreenFromPoseAndGaze()
 * 3. DELETE thresholds: pose_yaw_on_max, pose_pitch_on_max, pose_yaw_off_min, pose_pitch_off_min
 * 4. UPDATE videoElementIdCandidates: remove "webgazerVideoFeed", add gaze-tracker video id
 * 5. KEEP method: setGazeScreenState() — this is the API for gaze-tracker.js
 * 
 * ▸ STEP 2: IN HTML (mvp_with_precheck_1.html)
 * --------------------------------------------
 * 1. REMOVE script: <script src="https://webgazer.cs.brown.edu/webgazer.js"></script>
 * 2. ADD script:    <script src="js/gaze-tracker.js"></script>
 * 
 * ▸ STEP 3: REQUIRED gaze-tracker.js API
 * --------------------------------------
 * gaze-tracker.js MUST export these methods:
 * 
 * interface GazeTracker {
 *   init(options: { videoElementId?: string }): Promise<void>;
 *   startCalibration(): Promise<void>;
 *   getScreenState(): { valid: boolean; onScreen: boolean | null; };
 *   stop(): void;
 * }
 * 
 * ============================================================================
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
    illumination_ok_pct_min: 90,
    eyes_open_pct_min: 85,
    occlusion_pct_max: 20,

    // gaze QC (computed on VALID gaze only)
    gaze_valid_pct_min: 80,
    gaze_on_screen_pct_min: 85,

    // gaze accuracy thresholds (from validation)
    gaze_accuracy_pct_max: 8,
    gaze_precision_pct_max: 4,

    // fps QC
    fps_baseline_warmup_ms: 2000,
    fps_low_factor: 0.5,
    fps_low_abs_cap: 10,
    fps_low_abs_floor: 6,
    maxLowFpsTimeMs: 4000,
    maxConsecutiveLowFpsMs: 2000,

    // [LEGACY - DELETE when gaze-tracker.js ready]
    pose_yaw_on_max: 20,
    pose_pitch_on_max: 18,
    pose_yaw_off_min: 35,
    pose_pitch_off_min: 30,

    // dropout segments
    maxConsecutiveDropoutMs: 1200
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
 * Весовые коэффициенты для QC Score
 */
export const QC_WEIGHTS = {
    face_visible: 0.15,
    face_ok: 0.15,
    pose_ok: 0.15,
    illumination_ok: 0.10,
    eyes_open: 0.10,
    occlusion: 0.05,
    gaze_valid: 0.15,
    gaze_on_screen: 0.15
};

/**
 * Создание объекта порогов с пользовательскими значениями
 */
export function createThresholds(options = {}) {
    return { ...DEFAULT_THRESHOLDS, ...options };
}
