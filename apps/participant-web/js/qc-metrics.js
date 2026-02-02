/**
 * QC Metrics Module v3.2 - Browser Wrapper
 * 
 * Этот файл служит обёрткой для обратной совместимости.
 * Основной код находится в папке ./qc-metrics/
 * 
 * ИЗМЕНЕНИЯ v3.2:
 * - Удалены неиспользуемые методы: setGazeScreenState(), setValidationData()
 * - Удалён неиспользуемый threshold: fps_camera_min
 * 
 * ИЗМЕНЕНИЯ v3.1:
 * - Разделение FPS: analysisFps (частота анализа) и cameraFps (реальный FPS камеры)
 * - setCameraFps() для передачи реального FPS камеры
 * - lowFps проверка теперь использует cameraFps
 * 
 * @version 3.2.0
 */

/**
 * ============================================================================
 * MIGRATION CHECKLIST (when gaze-tracker.js is ready):
 * ============================================================================
 * See ./qc-metrics/constants.js for full checklist
 * ============================================================================
 */

// Встроенный класс для browser
class QCMetrics {
    constructor(options = {}) {
        this.thresholds = {
            minDurationMs: 8000,
            face_visible_pct_min: 85,
            face_ok_pct_min: 85,
            pose_ok_pct_min: 85,
            illumination_ok_pct_min: 90,
            eyes_open_pct_min: 85,
            occlusion_pct_max: 20,
            gaze_valid_pct_min: 80,
            gaze_on_screen_pct_min: 85,
            gaze_accuracy_pct_max: 8,
            gaze_precision_pct_max: 4,
            fps_baseline_warmup_ms: 2000,
            fps_low_factor: 0.5,
            fps_low_abs_cap: 10,
            fps_low_abs_floor: 6,
            fps_absolute_min: 12, // Абсолютный минимум FPS камеры (ниже — всегда low)
            maxLowFpsTimeMs: 4000,
            maxConsecutiveLowFpsMs: 2000,
            pose_yaw_on_max: 20,
            pose_pitch_on_max: 18,
            pose_yaw_off_min: 35,
            pose_pitch_off_min: 30,
            maxConsecutiveDropoutMs: 1200,
            ...options
        };
        
        this._counters = this._createCounters();
        this._gazeState = { valid: false, onScreen: null, validTimeMs: 0, onScreenTimeMs: 0, hasData: false };
        this._validationState = { points: [], errors: [], isComplete: false };
        this._fpsHistory = [];        // История FPS анализа
        this._cameraFpsHistory = [];  // История FPS камеры
        this._currentFps = 0;         // Текущий FPS анализа (processFrame calls)
        this._cameraFps = 0;          // Реальный FPS камеры (передаётся извне)
        this._baselineFps = null;     // Baseline FPS камеры
        this._frameCount = 0;
        this._lastFpsTime = 0;
        this._startTime = 0;
        this._lastFrameTime = 0;
        this._isRunning = false;
        this._warmupComplete = false;
        
        this.onMetricsUpdate = options.onMetricsUpdate || null;
    }

    _createCounters() {
        return {
            totalFrames: 0, faceVisible: 0, faceOk: 0, poseOk: 0,
            illuminationOk: 0, eyesOpen: 0, occlusionDetected: 0,
            gazeValid: 0, gazeOnScreen: 0, gazeTotal: 0, // gazeTotal - общее число кадров когда был вызван addGazePoint
            lowFpsFrames: 0,
            consecutiveLowFpsMs: 0, maxConsecutiveLowFpsMs: 0, totalLowFpsMs: 0
        };
    }

    start() {
        this._startTime = Date.now();
        this._lastFrameTime = performance.now();
        this._lastFpsTime = this._lastFrameTime;
        this._isRunning = true;
        this._counters = this._createCounters();
        this._gazeState = { valid: false, onScreen: null, validTimeMs: 0, onScreenTimeMs: 0, hasData: false };
        this._fpsHistory = [];
        this._cameraFpsHistory = [];
        this._warmupComplete = false;
        this._baselineFps = null;
        this._cameraFps = 0;
        console.log('[QCMetrics] Started');
    }

    stop() {
        this._isRunning = false;
        console.log('[QCMetrics] Stopped');
    }

    /**
     * Устанавливает реальный FPS камеры (вызывается извне)
     * @param {number} fps - измеренный FPS камеры
     */
    setCameraFps(fps) {
        if (typeof fps !== 'number' || fps < 0) return;
        
        this._cameraFps = fps;
        this._cameraFpsHistory.push(fps);
        if (this._cameraFpsHistory.length > 60) this._cameraFpsHistory.shift();
        
        // Обновляем baseline на основе camera FPS
        if (!this._warmupComplete && this._cameraFpsHistory.length >= 3) {
            const sorted = [...this._cameraFpsHistory].sort((a, b) => b - a);
            this._baselineFps = sorted[Math.floor(sorted.length * 0.2)] || sorted[0];
            this._warmupComplete = true;
            console.log(`[QCMetrics] Camera baseline FPS: ${this._baselineFps}`);
        }
    }

    processFrame(precheckResult, segmenterResult = null) {
        if (!this._isRunning) return;
        
        const now = performance.now();
        const deltaMs = now - this._lastFrameTime;
        this._lastFrameTime = now;
        
        // FPS calculation (это FPS анализа, не камеры!)
        this._frameCount++;
        if (now - this._lastFpsTime >= 1000) {
            this._currentFps = Math.round((this._frameCount * 1000) / (now - this._lastFpsTime));
            this._fpsHistory.push(this._currentFps);
            if (this._fpsHistory.length > 60) this._fpsHistory.shift();
            this._frameCount = 0;
            this._lastFpsTime = now;
        }
        
        // lowFps теперь проверяет CAMERA FPS, а не analysis FPS
        const isLowFps = this._checkLowFps();
        const flags = this._computeFlags(precheckResult, segmenterResult);
        
        this._counters.totalFrames++;
        if (flags.faceVisible) this._counters.faceVisible++;
        if (flags.faceOk) this._counters.faceOk++;
        if (flags.poseOk) this._counters.poseOk++;
        if (flags.illuminationOk) this._counters.illuminationOk++;
        if (flags.eyesOpen) this._counters.eyesOpen++;
        if (flags.occlusionDetected) this._counters.occlusionDetected++;
        
        // ИСПРАВЛЕНО: gazeValid и gazeOnScreen НЕ считаем здесь
        // Они считаются только в addGazePoint() когда есть реальные данные взгляда
        
        if (isLowFps) {
            this._counters.lowFpsFrames++;
            this._counters.consecutiveLowFpsMs += deltaMs;
            this._counters.totalLowFpsMs += deltaMs;
            this._counters.maxConsecutiveLowFpsMs = Math.max(this._counters.maxConsecutiveLowFpsMs, this._counters.consecutiveLowFpsMs);
        } else {
            this._counters.consecutiveLowFpsMs = 0;
        }
        
        // Gaze time accumulation (только если hasData = true, т.е. был вызов addGazePoint)
        if (this._gazeState.hasData && this._gazeState.valid) {
            this._gazeState.validTimeMs += deltaMs;
            if (this._gazeState.onScreen === true) this._gazeState.onScreenTimeMs += deltaMs;
        }
        
        if (this.onMetricsUpdate) this.onMetricsUpdate(this.getCurrentMetrics());
    }

    _checkLowFps() {
        // Используем CAMERA FPS для проверки, а не analysis FPS
        const fpsToCheck = this._cameraFps > 0 ? this._cameraFps : this._currentFps;
        
        // Если FPS ещё не измерен — не считаем lowFps
        if (fpsToCheck === 0) return false;
        
        // Абсолютный минимум FPS — если ниже, всегда считаем low
        if (fpsToCheck < this.thresholds.fps_absolute_min) {
            return true;
        }
        
        // Если baseline ещё не вычислен — используем только абсолютный порог
        if (!this._baselineFps) {
            return false; // Уже проверили абсолютный минимум выше
        }
        
        // Относительный порог на основе baseline
        const threshold = Math.max(this.thresholds.fps_low_abs_floor, 
            Math.min(this.thresholds.fps_low_abs_cap, this._baselineFps * this.thresholds.fps_low_factor));
        return fpsToCheck < threshold;
    }

    _computeFlags(pr, sr) {
        const f = { faceVisible: false, faceOk: false, poseOk: false, illuminationOk: false, eyesOpen: false, occlusionDetected: false };
        if (!pr) return f;
        
        // === Occlusion detection (ИСПРАВЛЕНО - менее агрессивная логика) ===
        // Окклюзия только если FaceSegmenter ЯВНО детектирует руку или серьёзную проблему
        let isOccluded = false;
        if (sr && sr.faceVisibility) {
            // Проверяем только явную детекцию руки
            if (sr.faceVisibility.handDetected === true) {
                isOccluded = true;
            }
            // Или если есть критические issues (но НЕ low_skin_visibility - это часто ложное)
            const issues = sr.issues || sr.faceVisibility?.issues || [];
            if (Array.isArray(issues)) {
                const criticalIssues = issues.filter(i => 
                    i === 'hand_on_face' || 
                    i.includes('hand_occluded')
                );
                if (criticalIssues.length > 0) isOccluded = true;
            }
        }
        f.occlusionDetected = isOccluded;
        
        // === Face detection ===
        if (pr.face) {
            const faceDetected = pr.face.detected === true;
            const faceStatus = pr.face.status;
            const badStatuses = ['too_small', 'too_large', 'out_of_bounds', 'not_found'];
            
            // faceVisible НЕ зависит от окклюзии - лицо может быть видно даже с частичной окклюзией
            f.faceVisible = faceDetected;
            // faceOk учитывает окклюзию
            f.faceOk = faceDetected && !isOccluded && !badStatuses.includes(faceStatus);
        }
        
        // === Pose (LEGACY-compatible) ===
        if (pr.pose) {
            f.poseOk = (pr.pose.status === 'stable') || 
                       (pr.pose.isStable === true && pr.pose.isTilted !== true);
        }
        
        // === Illumination ===
        if (pr.illumination) f.illuminationOk = pr.illumination.status === 'optimal';
        
        // === Eyes ===
        if (pr.eyes) {
            const eyesBothOpen = pr.eyes.bothOpen ?? 
                ((pr.eyes.left?.open ?? true) && (pr.eyes.right?.open ?? true));
            f.eyesOpen = !!eyesBothOpen;
        }
        
        return f;
    }

    addGazePoint(gazeData, poseData, occluded = false) {
        // Увеличиваем счётчик вызовов addGazePoint
        this._counters.gazeTotal++;
        this._gazeState.hasData = true;
        
        // If face is occluded, gaze is invalid
        if (occluded) {
            this._gazeState.valid = false;
            this._gazeState.onScreen = null;
            return;
        }
        
        // ИСПРАВЛЕНО: Если нет данных взгляда — gaze невалиден
        if (!gazeData || gazeData.x == null || gazeData.y == null) {
            this._gazeState.valid = false;
            this._gazeState.onScreen = null;
            // НЕ увеличиваем gazeValid — данных нет
            return;
        }
        
        // Есть данные взгляда — увеличиваем счётчик
        this._counters.gazeValid++;
        this._gazeState.valid = true;
        
        // Проверяем onScreen
        if (poseData?.yaw != null && poseData?.pitch != null) {
            const absYaw = Math.abs(poseData.yaw), absPitch = Math.abs(poseData.pitch);
            if (absYaw > this.thresholds.pose_yaw_off_min || absPitch > this.thresholds.pose_pitch_off_min) {
                this._gazeState.onScreen = false;
                return;
            }
            if (absYaw < this.thresholds.pose_yaw_on_max && absPitch < this.thresholds.pose_pitch_on_max) {
                const w = window.innerWidth || 1920, h = window.innerHeight || 1080;
                const isOnScreen = gazeData.x >= 0 && gazeData.x <= w && gazeData.y >= 0 && gazeData.y <= h;
                this._gazeState.onScreen = isOnScreen;
                if (isOnScreen) this._counters.gazeOnScreen++;
                return;
            }
        }
        
        // Без данных позы — проверяем только координаты
        const w = window.innerWidth || 1920, h = window.innerHeight || 1080;
        const isOnScreen = gazeData.x >= 0 && gazeData.x <= w && gazeData.y >= 0 && gazeData.y <= h;
        this._gazeState.onScreen = isOnScreen;
        if (isOnScreen) this._counters.gazeOnScreen++;
    }

    getCurrentMetrics() {
        const t = this._counters.totalFrames || 1;
        // ИСПРАВЛЕНО: gazeValidPct считается от gazeTotal (сколько раз вызывали addGazePoint), а не от totalFrames
        const gazeTotal = this._counters.gazeTotal || 1;
        const gazeValid = this._counters.gazeValid || 0;
        
        const pcts = {
            faceVisiblePct: (this._counters.faceVisible / t) * 100,
            faceOkPct: (this._counters.faceOk / t) * 100,
            poseOkPct: (this._counters.poseOk / t) * 100,
            illuminationOkPct: (this._counters.illuminationOk / t) * 100,
            eyesOpenPct: (this._counters.eyesOpen / t) * 100,
            occlusionPct: (this._counters.occlusionDetected / t) * 100,
            // ИСПРАВЛЕНО: gazeValidPct = gazeValid / gazeTotal (только от вызовов addGazePoint)
            gazeValidPct: gazeTotal > 0 ? (gazeValid / gazeTotal) * 100 : 0,
            // gazeOnScreenPct считается от валидных точек взгляда
            gazeOnScreenPct: gazeValid > 0 ? (this._counters.gazeOnScreen / gazeValid) * 100 : 0,
            lowFpsPct: (this._counters.lowFpsFrames / t) * 100
        };
        const qcScore = this._computeQcScore(pcts);
        const r = v => Math.round(v * 10) / 10;
        return {
            durationMs: Date.now() - this._startTime,
            totalFrames: this._counters.totalFrames,
            qcScore,
            faceVisiblePct: r(pcts.faceVisiblePct),
            faceOkPct: r(pcts.faceOkPct),
            poseOkPct: r(pcts.poseOkPct),
            illuminationOkPct: r(pcts.illuminationOkPct),
            eyesOpenPct: r(pcts.eyesOpenPct),
            occlusionPct: r(pcts.occlusionPct),
            gazeValidPct: r(pcts.gazeValidPct),
            gazeOnScreenPct: r(pcts.gazeOnScreenPct),
            // FPS: теперь показываем оба значения
            currentFps: this._currentFps,      // FPS анализа
            cameraFps: this._cameraFps,        // Реальный FPS камеры
            baselineFps: this._baselineFps,
            lowFpsPct: r(pcts.lowFpsPct),
            gazeValidTimeMs: this._gazeState.validTimeMs,
            gazeOnScreenTimeMs: this._gazeState.onScreenTimeMs,
            gazeTotal: this._counters.gazeTotal, // Добавляем для отладки
            timestamp: Date.now()
        };
    }

    _computeQcScore(p) {
        const th = this.thresholds;
        // LEGACY-compatible weights (sum = 1.0)
        const w = {
            faceVis: 0.14,
            faceOk: 0.16,
            poseOk: 0.08,
            lightOk: 0.06,
            eyesOpen: 0.06,
            occlInv: 0.10,
            gazeValid: 0.14,
            gazeOn: 0.16,
            dropoutInv: 0.04,
            fpsOk: 0.06,
        };
        
        const clamp01 = v => Math.max(0, Math.min(1, v));
        const nPct = x => clamp01(x / 100);
        const nInvPct = x => clamp01(1 - x / 100);
        
        // Normalize metrics
        const faceVis = nPct(p.faceVisiblePct);
        const faceOk = nPct(p.faceOkPct);
        const poseOk = nPct(p.poseOkPct);
        const lightOk = nPct(p.illuminationOkPct);
        const eyesOpen = nPct(p.eyesOpenPct);
        const occlInv = nInvPct(p.occlusionPct);
        const gazeValid = nPct(p.gazeValidPct);
        const gazeOn = nPct(p.gazeOnScreenPct);
        const dropoutInv = nInvPct(100 - p.gazeValidPct); // dropout = 100 - valid
        
        // FPS score (approximation - legacy uses time-based)
        const fpsOk = nInvPct(p.lowFpsPct || 0);
        
        // Weighted average
        let score =
            faceVis * w.faceVis +
            faceOk * w.faceOk +
            poseOk * w.poseOk +
            lightOk * w.lightOk +
            eyesOpen * w.eyesOpen +
            occlInv * w.occlInv +
            gazeValid * w.gazeValid +
            gazeOn * w.gazeOn +
            dropoutInv * w.dropoutInv +
            fpsOk * w.fpsOk;
        
        // LEGACY hard penalties to avoid "high score but invalid" artifacts
        const durationMs = Date.now() - this._startTime;
        if (durationMs < th.minDurationMs) score *= 0.35;
        if (p.faceVisiblePct < th.face_visible_pct_min) score *= 0.6;
        if (p.faceOkPct < th.face_ok_pct_min) score *= 0.6;
        if (p.occlusionPct > th.occlusion_pct_max) score *= 0.7;
        if (p.gazeValidPct < th.gaze_valid_pct_min) score *= 0.7;
        if (p.gazeOnScreenPct < th.gaze_on_screen_pct_min) score *= 0.7;
        if (this._counters.totalLowFpsMs > th.maxLowFpsTimeMs) score *= 0.6;
        
        // Return as 0-1 (legacy) with 3 decimal places
        return Math.round(clamp01(score) * 1000) / 1000;
    }

    getSummary() {
        const m = this.getCurrentMetrics();
        const th = this.thresholds;
        const v = this._getValidationMetrics();
        const checks = {
            duration: m.durationMs >= th.minDurationMs,
            faceVisible: m.faceVisiblePct >= th.face_visible_pct_min,
            faceOk: m.faceOkPct >= th.face_ok_pct_min,
            poseOk: m.poseOkPct >= th.pose_ok_pct_min,
            illuminationOk: m.illuminationOkPct >= th.illumination_ok_pct_min,
            eyesOpen: m.eyesOpenPct >= th.eyes_open_pct_min,
            occlusion: m.occlusionPct <= th.occlusion_pct_max,
            gazeValid: m.gazeValidPct >= th.gaze_valid_pct_min,
            gazeOnScreen: m.gazeOnScreenPct >= th.gaze_on_screen_pct_min,
            lowFps: this._counters.totalLowFpsMs <= th.maxLowFpsTimeMs,
            consecutiveLowFps: this._counters.maxConsecutiveLowFpsMs <= th.maxConsecutiveLowFpsMs
        };
        if (v.accuracyPct !== null) {
            checks.gazeAccuracy = v.accuracyPct <= th.gaze_accuracy_pct_max;
            checks.gazePrecision = v.precisionPct <= th.gaze_precision_pct_max;
        }
        const passed = Object.values(checks).filter(x => x === true).length;
        return { ...m, validation: v, checks, passedChecks: passed, totalChecks: Object.keys(checks).length, overallPass: passed === Object.keys(checks).length, counters: { ...this._counters }, fpsHistory: [...this._fpsHistory], maxConsecutiveLowFpsMs: this._counters.maxConsecutiveLowFpsMs, totalLowFpsMs: this._counters.totalLowFpsMs };
    }

    _getValidationMetrics() {
        if (!this._validationState.isComplete || this._validationState.errors.length === 0) {
            return { accuracyPx: null, precisionPx: null, accuracyPct: null, precisionPct: null, sampleCount: 0 };
        }
        const e = this._validationState.errors;
        const avg = e.reduce((a, b) => a + b, 0) / e.length;
        const sqDiffs = e.map(v => Math.pow(v - avg, 2));
        const std = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / e.length);
        const diag = Math.sqrt(Math.pow(window.innerWidth || 1920, 2) + Math.pow(window.innerHeight || 1080, 2));
        return {
            accuracyPx: Math.round(avg * 10) / 10,
            precisionPx: Math.round(std * 10) / 10,
            accuracyPct: Math.round((avg / diag) * 1000) / 10,
            precisionPct: Math.round((std / diag) * 1000) / 10,
            sampleCount: e.length
        };
    }

    reset() {
        this._counters = this._createCounters();
        this._gazeState = { valid: false, onScreen: null, validTimeMs: 0, onScreenTimeMs: 0, hasData: false };
        this._validationState = { points: [], errors: [], isComplete: false };
        this._fpsHistory = [];
        this._cameraFpsHistory = [];
        this._currentFps = 0;
        this._cameraFps = 0;
        this._baselineFps = null;
        this._startTime = 0;
        this._lastFrameTime = 0;
        this._isRunning = false;
        this._warmupComplete = false;
    }

    isRunning() { return this._isRunning; }
}

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QCMetrics;
}

// Browser global
if (typeof window !== 'undefined') {
    window.QCMetrics = QCMetrics;
}