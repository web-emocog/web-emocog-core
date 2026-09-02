/**
 * QC Metrics Module v3.5 — Browser Wrapper / Loader
 *
 * Загрузка устроена так:
 *   1) Сразу синхронно объявляется inline-класс QCMetricsInline (полная реализация
 *      ниже), и он публикуется в window.QCMetrics — это safety net для legacy-кода,
 *      который делает new QCMetrics() сразу при загрузке страницы (с предупреждением
 *      console.warn о sync use).
 *   2) Параллельно запускается dynamic import() ES-модуля ./qc-metrics/index.js.
 *      Если папка успешно загрузилась и экспортирует класс QCMetrics —
 *      window.QCMetrics ПЕРЕзаписывается на модульную версию.
 *   3) Если папка повреждена или не загрузилась — остаёмся на inline-классе и
 *      ругаемся в консоль (console.error).
 *   4) Состояние загрузки доступно как Promise window.QCMetricsReady,
 *      резолвящийся в 'module' или 'inline'. Все НОВЫЕ потребители ОБЯЗАНЫ
 *      делать `await window.QCMetricsReady` перед `new QCMetrics()`.
 *
 * Inline-копия здесь поддерживается как точная функциональная копия модульной
 * версии (тот же публичный API, та же формула QC Score). При расхождении
 * источником истины считается папка ./qc-metrics/.
 *
 * @version 3.5.0
 */

// Встроенный класс — fallback при сбое загрузки папки.
class QCMetricsInline {
    constructor(options = {}) {
        this.thresholds = {
            minDurationMs: 8000,
            face_visible_pct_min: 85,
            face_ok_pct_min: 85,
            pose_ok_pct_min: 85,
            illumination_ok_pct_min: 92,
            eyes_open_pct_min: 85,
            occlusion_pct_max: 20,
            gaze_valid_pct_min: 80,
            gaze_on_screen_pct_min: 85,
            // gaze accuracy thresholds (from validation)
            // v2.2.0: relaxed from 8%/4% to 12%/6% — realistic for webcam iris tracking
            // Academic webcam eye-trackers achieve ~3-5° ≈ 5-10% diagonal in ideal conditions;
            // with edge/corner points, 12%/6% is a reasonable pass threshold
            gaze_accuracy_pct_max: 12, // previously 8
            gaze_precision_pct_max: 6, // previously 4
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
            tracking_on_target_base_radius_pct: 0.15,
            tracking_on_target_min_pct: 50,
            ...options
        };
        
        this._counters = this._createCounters();
        this._gazeState = { valid: false, onScreen: null, validTimeMs: 0, onScreenTimeMs: 0, hasData: false };
        this._validationState = { points: [], errors: [], isComplete: false };
        this._trackingDeviationState = { errors: [], sampleCount: 0, validSampleCount: 0, isComplete: false };
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
        this._validationState = { points: [], errors: [], isComplete: false };
        this._trackingDeviationState = { errors: [], sampleCount: 0, validSampleCount: 0, isComplete: false };
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

        // Если трекер уже посчитал честный onScreen (по correctedX/correctedY ДО clamp),
        // используем его. Поза при этом может ещё ужесточить решение (off-screen по углам).
        const trackerOnScreen = (typeof gazeData.onScreen === 'boolean') ? gazeData.onScreen : null;

        // Поза: если задана, проверяем явные off/on-screen диапазоны.
        if (poseData?.yaw != null && poseData?.pitch != null) {
            const absYaw = Math.abs(poseData.yaw), absPitch = Math.abs(poseData.pitch);
            if (absYaw > this.thresholds.pose_yaw_off_min || absPitch > this.thresholds.pose_pitch_off_min) {
                this._gazeState.onScreen = false;
                return;
            }
            if (absYaw < this.thresholds.pose_yaw_on_max && absPitch < this.thresholds.pose_pitch_on_max) {
                let isOnScreen;
                if (trackerOnScreen !== null) {
                    isOnScreen = trackerOnScreen;
                } else {
                    const w = window.innerWidth || 1920, h = window.innerHeight || 1080;
                    isOnScreen = gazeData.x >= 0 && gazeData.x <= w && gazeData.y >= 0 && gazeData.y <= h;
                }
                this._gazeState.onScreen = isOnScreen;
                if (isOnScreen) this._counters.gazeOnScreen++;
                return;
            }
        }

        // Без данных позы — приоритет честному флагу от трекера; иначе boundary-чек.
        let isOnScreen;
        if (trackerOnScreen !== null) {
            isOnScreen = trackerOnScreen;
        } else {
            const w = window.innerWidth || 1920, h = window.innerHeight || 1080;
            isOnScreen = gazeData.x >= 0 && gazeData.x <= w && gazeData.y >= 0 && gazeData.y <= h;
        }
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
            analysisFps: this._currentFps,     // FPS анализа (processFrame calls/sec)
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
        const clamp01 = v => Math.max(0, Math.min(1, v));
        const nPct = x => clamp01(x / 100);
        const nInvPct = x => clamp01(1 - x / 100);

        const w = {
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

        const pf = {
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

        const faceVis = nPct(p.faceVisiblePct);
        const faceOk = nPct(p.faceOkPct);
        const poseOk = nPct(p.poseOkPct);
        const lightOk = nPct(p.illuminationOkPct);
        const eyesOpen = nPct(p.eyesOpenPct);
        const occlInv = nInvPct(p.occlusionPct);
        const gazeValid = nPct(p.gazeValidPct);
        const gazeOn = nPct(p.gazeOnScreenPct);
        const fpsOk = nInvPct(p.lowFpsPct || 0);

        const v = this._getValidationMetrics();
        let gazeAccuracy = 1.0;
        if (v.accuracyPct !== null) {
            const accThresh = th.gaze_accuracy_pct_max;
            gazeAccuracy = clamp01(1 - (v.accuracyPct / (accThresh * 2)));
        }

        let score =
            faceVis * w.faceVis +
            faceOk * w.faceOk +
            poseOk * w.poseOk +
            lightOk * w.lightOk +
            eyesOpen * w.eyesOpen +
            occlInv * w.occlInv +
            gazeValid * w.gazeValid +
            gazeOn * w.gazeOn +
            gazeAccuracy * w.gazeAccuracy +
            fpsOk * w.fpsOk;

        const durationMs = Date.now() - this._startTime;
        if (durationMs < th.minDurationMs) score *= (1 - pf.duration);
        if (p.faceVisiblePct < th.face_visible_pct_min) score *= (1 - pf.faceVisible);
        if (p.faceOkPct < th.face_ok_pct_min) score *= (1 - pf.faceOk);
        if (p.poseOkPct < th.pose_ok_pct_min) score *= (1 - pf.poseOk);
        if (p.illuminationOkPct < th.illumination_ok_pct_min) score *= (1 - pf.illumination);
        if (p.occlusionPct > th.occlusion_pct_max) score *= (1 - pf.occlusion);
        if (p.gazeValidPct < th.gaze_valid_pct_min) score *= (1 - pf.gazeValid);
        if (p.gazeOnScreenPct < th.gaze_on_screen_pct_min) score *= (1 - pf.gazeOnScreen);
        if (v.accuracyPct !== null && v.accuracyPct > th.gaze_accuracy_pct_max) {
            score *= (1 - pf.gazeAccuracy);
        }
        if (this._counters.totalLowFpsMs > th.maxLowFpsTimeMs) score *= (1 - pf.lowFps);

        return Math.round(clamp01(score) * 1000) / 1000;
    }

    getSummary() {
        const m = this.getCurrentMetrics();
        const th = this.thresholds;
        const v = this._getValidationMetrics();
        const td = this._getTrackingDeviationMetrics({
            validationAccuracyPx: v.accuracyPx,
            baseRadiusPct: th.tracking_on_target_base_radius_pct
        });
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
        if (td.onTargetPct !== null) {
            checks.trackingOnTarget = td.onTargetPct >= th.tracking_on_target_min_pct;
        }
        const passed = Object.values(checks).filter(x => x === true).length;
        return { ...m, validation: v, trackingDeviation: td, checks, passedChecks: passed, totalChecks: Object.keys(checks).length, overallPass: passed === Object.keys(checks).length, counters: { ...this._counters }, fpsHistory: [...this._fpsHistory], maxConsecutiveLowFpsMs: this._counters.maxConsecutiveLowFpsMs, totalLowFpsMs: this._counters.totalLowFpsMs };
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

    setTrackingDeviationData(samples) {
        if (!Array.isArray(samples) || samples.length === 0) {
            console.warn('[QCMetrics] setTrackingDeviationData: нет данных');
            return;
        }
        const errors = [];
        for (const s of samples) {
            if (s.gazeX != null && s.gazeY != null && s.shapeX != null && s.shapeY != null &&
                Number.isFinite(s.gazeX) && Number.isFinite(s.gazeY) &&
                Number.isFinite(s.shapeX) && Number.isFinite(s.shapeY)) {
                const dx = s.gazeX - s.shapeX;
                const dy = s.gazeY - s.shapeY;
                errors.push(Math.sqrt(dx * dx + dy * dy));
            }
        }
        if (errors.length < 5) {
            console.warn('[QCMetrics] setTrackingDeviationData: недостаточно валидных точек:', errors.length);
            return;
        }
        this._trackingDeviationState = {
            errors,
            sampleCount: samples.length,
            validSampleCount: errors.length,
            isComplete: true
        };
        console.log(`[QCMetrics] Tracking deviation data set: ${errors.length} valid samples of ${samples.length}`);
    }

    _getTrackingDeviationMetrics(options = {}) {
        const st = this._trackingDeviationState;
        if (!st.isComplete || st.errors.length === 0) {
            return { deviationPx: null, deviationPct: null, precisionPx: null, precisionPct: null, onTargetPct: null, sampleCount: 0, validSampleCount: 0 };
        }
        const e = st.errors;
        const avg = e.reduce((a, b) => a + b, 0) / e.length;
        const sqDiffs = e.map(v => Math.pow(v - avg, 2));
        const std = Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / e.length);
        const diag = Math.sqrt(Math.pow(window.innerWidth || 1920, 2) + Math.pow(window.innerHeight || 1080, 2));
        const baseRadiusPx = diag * (options.baseRadiusPct ?? 0.15);
        const accuracyPx = (options.validationAccuracyPx != null && Number.isFinite(options.validationAccuracyPx))
            ? options.validationAccuracyPx
            : 0;
        const onTargetRadiusPx = baseRadiusPx + accuracyPx;
        const onTargetCount = e.filter(err => err <= onTargetRadiusPx).length;
        const onTargetPct = (onTargetCount / e.length) * 100;
        return {
            deviationPx: Math.round(avg * 10) / 10,
            deviationPct: Math.round((avg / diag) * 1000) / 10,
            precisionPx: Math.round(std * 10) / 10,
            precisionPct: Math.round((std / diag) * 1000) / 10,
            onTargetPct: Math.round(onTargetPct * 10) / 10,
            sampleCount: st.sampleCount,
            validSampleCount: st.validSampleCount
        };
    }

    reset() {
        this._counters = this._createCounters();
        this._gazeState = { valid: false, onScreen: null, validTimeMs: 0, onScreenTimeMs: 0, hasData: false };
        this._validationState = { points: [], errors: [], isComplete: false };
        this._trackingDeviationState = { errors: [], sampleCount: 0, validSampleCount: 0, isComplete: false };
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

    /**
     * Принимает результаты валидации точности gaze.
     * Вызывается из tests.js после завершения этапа валидации.
     * Заполняет _validationState, чтобы getSummary() включал accuracy/precision checks.
     * 
     * @param {Array<{gazeX: number, gazeY: number, targetX: number, targetY: number}>} samples
     */
    setValidationData(samples) {
        if (!Array.isArray(samples) || samples.length === 0) {
            console.warn('[QCMetrics] setValidationData: нет данных');
            return;
        }

        const errors = [];
        for (const s of samples) {
            if (s.gazeX != null && s.gazeY != null && s.targetX != null && s.targetY != null) {
                const dx = s.gazeX - s.targetX;
                const dy = s.gazeY - s.targetY;
                errors.push(Math.sqrt(dx * dx + dy * dy));
            }
        }

        if (errors.length < 3) {
            console.warn('[QCMetrics] setValidationData: недостаточно валидных точек:', errors.length);
            return;
        }

        this._validationState = {
            points: samples,
            errors: errors,
            isComplete: true
        };

        console.log(`[QCMetrics] Validation data set: ${errors.length} points`);
    }

    resetGazeAvailability() {
        this._counters.gazeTotal = 0;
        this._counters.gazeValid = 0;
        this._counters.gazeOnScreen = 0;
        this._gazeState = {
            valid: false,
            onScreen: null,
            validTimeMs: 0,
            onScreenTimeMs: 0,
            hasData: false
        };
    }
}

// CommonJS export (для тестов под node)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QCMetricsInline;
}

// Browser: loader-паттерн.
// Сначала publish'им inline-класс СИНХРОННО как safety net — старый код,
// который делает new QCMetrics() до резолва Promise, не упадёт, но получит
// console.warn, чтобы было видно непереведённые точки потребления.
if (typeof window !== 'undefined') {
    let _qcMetricsResolvedKind = null; // 'module' | 'inline' | null (ещё не решено)

    // Класс-прокси: до резолва выводит предупреждение и инстанцирует inline.
    // После резолва window.QCMetrics ПЕРЕзаписывается реальным классом
    // (модульным или inline), и прокси больше не используется для новых вызовов.
    function QCMetricsProxy(...args) {
        if (_qcMetricsResolvedKind === null) {
            console.warn(
                '[QCMetrics] sync use before Ready — using inline fallback. ' +
                'Update the consumer to `await window.QCMetricsReady` before `new QCMetrics()`.'
            );
        }
        return new QCMetricsInline(...args);
    }
    QCMetricsProxy.prototype = QCMetricsInline.prototype;

    window.QCMetrics = QCMetricsProxy;

    // Фоновая загрузка модульной версии.
    window.QCMetricsReady = (async () => {
        try {
            const mod = await import('./qc-metrics/index.js');
            const Cls = mod && (mod.QCMetrics || mod.default);
            if (typeof Cls !== 'function') {
                throw new Error('module did not export QCMetrics class');
            }
            window.QCMetrics = Cls;
            _qcMetricsResolvedKind = 'module';
            console.info('[QCMetrics] folder version loaded');
            return 'module';
        } catch (e) {
            window.QCMetrics = QCMetricsInline;
            _qcMetricsResolvedKind = 'inline';
            console.error('[QCMetrics] folder load failed, using inline fallback', e);
            return 'inline';
        }
    })();
}
