/**
 * QC Metrics Module
 * Расчёт метрик качества сигналов для eye-tracking сессий
 * 
 * @version 1.0.0
 */

class QCMetrics {
    constructor(options = {}) {
        // Пороговые значения для метрик
        this.thresholds = {
            // Минимальный % кадров с обнаруженным лицом
            faceOkPct: options.faceOkPctMin ?? 90,
            // Минимальный % валидных точек взгляда
            gazeValidPct: options.gazeValidPctMin ?? 80,
            // Максимальный % выпадений (dropout)
            dropoutPct: options.dropoutPctMax ?? 10,
            // Минимальный % стабильной позы
            poseStablePct: options.poseStablePctMin ?? 85,
            // Минимальный % оптимального освещения
            illuminationOkPct: options.illuminationOkPctMin ?? 90,
            // Минимальный общий QC score для валидности
            minQcScore: options.minQcScore ?? 75,
            // Минимальный QC score для borderline
            borderlineQcScore: options.borderlineQcScore ?? 60,
            // Максимальная длительность dropout подряд (мс)
            maxConsecutiveDropout: options.maxConsecutiveDropout ?? 500,
            // Минимальное количество точек калибровки
            minCalibrationPoints: options.minCalibrationPoints ?? 9,
            
            // === НОВЫЕ ПОРОГИ v2.0 ===
            // Минимальный % кадров с открытыми глазами
            eyesOpenPct: options.eyesOpenPctMin ?? 85,
            // Нормальная частота морганий (раз/мин)
            blinkRateMin: options.blinkRateMin ?? 8,
            blinkRateMax: options.blinkRateMax ?? 30,
            // Максимальный % кадров с окклюзиями
            occlusionPct: options.occlusionPctMax ?? 15,
            // Максимальное время без лица (мс)
            maxFaceLostTime: options.maxFaceLostTime ?? 3000,
            // Максимальное время плохого освещения (мс)
            maxLowLightTime: options.maxLowLightTime ?? 5000,
            // Максимальный % пропущенных стимулов
            omissionRate: options.omissionRateMax ?? 20,
            // Максимальный % ложных срабатываний
            commissionRate: options.commissionRateMax ?? 15,
            // Максимальная доля RT выбросов
            rtOutlierFrac: options.rtOutlierFracMax ?? 0.15,
            // Минимальный % времени взгляда на экране
            gazeOnScreenPct: options.gazeOnScreenPctMin ?? 90
        };
        
        // Веса для расчёта итогового score
        this.weights = {
            // === Инструментальный QC (60%) ===
            faceOkPct: 0.15,
            gazeValidPct: 0.15,
            dropoutPct: 0.10,
            poseStablePct: 0.10,
            illuminationOkPct: 0.05,
            eyesOpenPct: 0.05,
            
            // === Поведенческий QC (25%) ===
            omissionRate: 0.10,
            commissionRate: 0.05,
            rtOutlierFrac: 0.05,
            gazeOnScreenPct: 0.05,
            
            // === Калибровка и точность (15%) ===
            calibrationQuality: 0.10,
            trackingAccuracy: 0.05
        };
        
        // === REAL-TIME TRACKING STATE ===
        this.frameMetrics = {
            // Счётчики кадров
            totalFrames: 0,
            faceOkFrames: 0,
            poseStableFrames: 0,
            illuminationOkFrames: 0,
            eyesOpenFrames: 0,
            occlusionFrames: 0,
            
            // Счётчики gaze
            totalGazePoints: 0,
            validGazePoints: 0,
            onScreenGazePoints: 0,
            
            // Временные метрики (мс)
            sessionStartTime: null,
            lastFrameTime: null,
            faceLostTime: 0,
            lowLightTime: 0,
            currentFaceLostStart: null,
            currentLowLightStart: null,
            
            // Морганиния
            blinkCount: 0,
            lastEyeState: 'open', // 'open' | 'closed'
            blinkTimestamps: [],
            
            // Поведенческие метрики
            stimulusEvents: [],     // { time, responded }
            responseEvents: [],     // { time, stimulusId }
            reactionTimes: [],      // RT в мс
            
            // Dropout tracking
            dropoutSegments: [],    // { start, end }
            currentDropoutStart: null
        };
        
        // Конфигурация экрана
        this.screenConfig = {
            width: options.screenWidth || (typeof window !== 'undefined' ? window.screen?.width : 1920),
            height: options.screenHeight || (typeof window !== 'undefined' ? window.screen?.height : 1080)
        };
    }

    /**
     * Покадровое обновление метрик в реальном времени
     * @param {number} frameTime - время кадра от начала сессии (мс)
     * @param {Object} frameData - данные текущего кадра
     * @returns {Object} текущее состояние всех метрик
     */
    updateFrameMetrics(frameTime, frameData) {
        const fm = this.frameMetrics;
        
        // Инициализация времени начала сессии
        if (fm.sessionStartTime === null) {
            fm.sessionStartTime = frameTime;
        }
        fm.lastFrameTime = frameTime;
        fm.totalFrames++;
        
        // === 1. Face detection ===
        const faceDetected = frameData.face?.detected === true;
        if (faceDetected) {
            fm.faceOkFrames++;
            // Закрываем период потери лица
            if (fm.currentFaceLostStart !== null) {
                fm.faceLostTime += frameTime - fm.currentFaceLostStart;
                fm.currentFaceLostStart = null;
            }
        } else {
            // Начинаем период потери лица
            if (fm.currentFaceLostStart === null) {
                fm.currentFaceLostStart = frameTime;
            }
        }
        
        // === 2. Pose stability ===
        if (frameData.pose?.isStable === true) {
            fm.poseStableFrames++;
        }
        
        // === 3. Illumination ===
        const illuminationOk = frameData.illumination?.status === 'optimal';
        if (illuminationOk) {
            fm.illuminationOkFrames++;
            // Закрываем период плохого освещения
            if (fm.currentLowLightStart !== null) {
                fm.lowLightTime += frameTime - fm.currentLowLightStart;
                fm.currentLowLightStart = null;
            }
        } else {
            // Начинаем период плохого освещения
            if (fm.currentLowLightStart === null) {
                fm.currentLowLightStart = frameTime;
            }
        }
        
        // === 4. Eyes open (EAR-based) ===
        const eyesOpen = this._checkEyesOpen(frameData);
        if (eyesOpen) {
            fm.eyesOpenFrames++;
            // Детекция моргания: переход closed → open
            if (fm.lastEyeState === 'closed') {
                fm.blinkCount++;
                fm.blinkTimestamps.push(frameTime);
            }
            fm.lastEyeState = 'open';
        } else {
            fm.lastEyeState = 'closed';
        }
        
        // === 5. Occlusion ===
        const hasOcclusion = frameData.occlusion?.detected === true || 
                            frameData.segmenter?.handOnFace === true ||
                            frameData.segmenter?.hairOcclusion === true;
        if (hasOcclusion) {
            fm.occlusionFrames++;
        }
        
        // === 6. Gaze tracking ===
        if (frameData.gaze) {
            fm.totalGazePoints++;
            const gazeValid = frameData.gaze.x !== null && frameData.gaze.y !== null;
            
            if (gazeValid) {
                fm.validGazePoints++;
                
                // Проверка на экране
                const onScreen = frameData.gaze.x >= 0 && 
                                frameData.gaze.x <= this.screenConfig.width &&
                                frameData.gaze.y >= 0 && 
                                frameData.gaze.y <= this.screenConfig.height;
                if (onScreen) {
                    fm.onScreenGazePoints++;
                }
                
                // Закрываем dropout
                if (fm.currentDropoutStart !== null) {
                    fm.dropoutSegments.push({
                        start: fm.currentDropoutStart,
                        end: frameTime,
                        duration: frameTime - fm.currentDropoutStart
                    });
                    fm.currentDropoutStart = null;
                }
            } else {
                // Начинаем dropout
                if (fm.currentDropoutStart === null) {
                    fm.currentDropoutStart = frameTime;
                }
            }
        }
        
        // Возвращаем текущие рассчитанные метрики
        return this.getCurrentMetrics();
    }
    
    /**
     * Проверка открыты ли глаза (по EAR или явному флагу)
     */
    _checkEyesOpen(frameData) {
        // Если есть явный флаг
        if (frameData.eyes?.open !== undefined) {
            return frameData.eyes.open;
        }
        // Если есть EAR (Eye Aspect Ratio)
        if (frameData.eyes?.ear !== undefined) {
            return frameData.eyes.ear > 0.2; // Порог EAR для открытых глаз
        }
        // По умолчанию считаем открытыми если лицо обнаружено
        return frameData.face?.detected === true;
    }
    
    /**
     * Получить текущие метрики на основе накопленных данных
     */
    getCurrentMetrics() {
        const fm = this.frameMetrics;
        const totalFrames = fm.totalFrames || 1;
        const totalGaze = fm.totalGazePoints || 1;
        const sessionDuration = (fm.lastFrameTime - fm.sessionStartTime) || 1;
        
        // Рассчитываем текущие проценты
        const metrics = {
            // Инструментальный QC
            face_ok_pct: Math.round((fm.faceOkFrames / totalFrames) * 1000) / 10,
            pose_stable_pct: Math.round((fm.poseStableFrames / totalFrames) * 1000) / 10,
            illumination_ok_pct: Math.round((fm.illuminationOkFrames / totalFrames) * 1000) / 10,
            eyes_open_pct: Math.round((fm.eyesOpenFrames / totalFrames) * 1000) / 10,
            occlusion_pct: Math.round((fm.occlusionFrames / totalFrames) * 1000) / 10,
            
            // Gaze метрики
            gaze_valid_pct: Math.round((fm.validGazePoints / totalGaze) * 1000) / 10,
            gaze_on_screen_pct: Math.round((fm.onScreenGazePoints / totalGaze) * 1000) / 10,
            dropout_pct: Math.round(((totalGaze - fm.validGazePoints) / totalGaze) * 1000) / 10,
            
            // Временные метрики
            face_lost_time_ms: fm.faceLostTime + (fm.currentFaceLostStart ? 
                (fm.lastFrameTime - fm.currentFaceLostStart) : 0),
            low_light_time_ms: fm.lowLightTime + (fm.currentLowLightStart ? 
                (fm.lastFrameTime - fm.currentLowLightStart) : 0),
            
            // Моргания
            blink_count: fm.blinkCount,
            blink_rate_per_min: sessionDuration > 0 ? 
                Math.round((fm.blinkCount / (sessionDuration / 60000)) * 10) / 10 : 0,
            
            // Счётчики
            total_frames: fm.totalFrames,
            total_gaze_points: fm.totalGazePoints,
            session_duration_ms: sessionDuration,
            
            // Dropout статистика
            dropout_count: fm.dropoutSegments.length,
            max_dropout_ms: fm.dropoutSegments.length > 0 ? 
                Math.max(...fm.dropoutSegments.map(d => d.duration)) : 0
        };
        
        // Рассчитываем текущий QC score
        metrics.current_qc_score = this._calculateRealtimeQcScore(metrics);
        
        return metrics;
    }
    
    /**
     * Расчёт QC score в реальном времени
     */
    _calculateRealtimeQcScore(metrics) {
        const dropoutNorm = 100 - metrics.dropout_pct;
        const occlusionNorm = 100 - metrics.occlusion_pct;
        
        const score = 
            metrics.face_ok_pct * this.weights.faceOkPct +
            metrics.gaze_valid_pct * this.weights.gazeValidPct +
            dropoutNorm * this.weights.dropoutPct +
            metrics.pose_stable_pct * this.weights.poseStablePct +
            metrics.illumination_ok_pct * this.weights.illuminationOkPct +
            metrics.eyes_open_pct * this.weights.eyesOpenPct +
            metrics.gaze_on_screen_pct * this.weights.gazeOnScreenPct;
        
        return Math.round(score * 10) / 10;
    }

    // === МЕТОДЫ ДЛЯ ПОВЕДЕНЧЕСКИХ МЕТРИК ===
    
    /**
     * Регистрация события стимула
     * @param {number} time - время появления стимула (мс)
     * @param {string} stimulusId - ID стимула
     * @param {string} stimulusType - тип: 'target' | 'nontarget'
     */
    registerStimulusEvent(time, stimulusId, stimulusType = 'target') {
        this.frameMetrics.stimulusEvents.push({
            time,
            stimulusId,
            stimulusType,
            responded: false,
            responseTime: null
        });
    }
    
    /**
     * Регистрация события ответа пользователя
     * @param {number} time - время ответа (мс)
     * @param {string} stimulusId - ID стимула на который ответ (опционально)
     */
    registerResponseEvent(time, stimulusId = null) {
        const fm = this.frameMetrics;
        
        fm.responseEvents.push({ time, stimulusId });
        
        // Связываем с последним стимулом если не указан ID
        if (stimulusId === null && fm.stimulusEvents.length > 0) {
            // Ищем последний неотвеченный target стимул
            for (let i = fm.stimulusEvents.length - 1; i >= 0; i--) {
                const stim = fm.stimulusEvents[i];
                if (!stim.responded && stim.stimulusType === 'target') {
                    stim.responded = true;
                    stim.responseTime = time;
                    const rt = time - stim.time;
                    fm.reactionTimes.push(rt);
                    break;
                }
            }
        } else if (stimulusId) {
            // Ищем конкретный стимул по ID
            const stim = fm.stimulusEvents.find(s => s.stimulusId === stimulusId && !s.responded);
            if (stim) {
                stim.responded = true;
                stim.responseTime = time;
                const rt = time - stim.time;
                fm.reactionTimes.push(rt);
            }
        }
    }
    
    /**
     * Получить поведенческие метрики
     */
    getBehavioralMetrics() {
        const fm = this.frameMetrics;
        
        // Omission rate: % target стимулов без ответа
        const targetStimuli = fm.stimulusEvents.filter(s => s.stimulusType === 'target');
        const missedTargets = targetStimuli.filter(s => !s.responded);
        const omissionRate = targetStimuli.length > 0 
            ? Math.round((missedTargets.length / targetStimuli.length) * 1000) / 10 
            : 0;
        
        // Commission rate: % ответов на nontarget стимулы
        const nontargetStimuli = fm.stimulusEvents.filter(s => s.stimulusType === 'nontarget');
        const falseAlarms = nontargetStimuli.filter(s => s.responded);
        const commissionRate = nontargetStimuli.length > 0 
            ? Math.round((falseAlarms.length / nontargetStimuli.length) * 1000) / 10 
            : 0;
        
        // RT статистика
        const rtStats = this._calculateRTStats(fm.reactionTimes);
        
        return {
            omission_rate: omissionRate,
            commission_rate: commissionRate,
            total_stimuli: fm.stimulusEvents.length,
            target_stimuli: targetStimuli.length,
            nontarget_stimuli: nontargetStimuli.length,
            missed_targets: missedTargets.length,
            false_alarms: falseAlarms.length,
            total_responses: fm.responseEvents.length,
            rt_stats: rtStats
        };
    }
    
    /**
     * Расчёт статистики времени реакции
     */
    _calculateRTStats(reactionTimes) {
        if (!reactionTimes || reactionTimes.length === 0) {
            return {
                mean: null,
                median: null,
                std: null,
                min: null,
                max: null,
                outlier_count: 0,
                outlier_frac: 0
            };
        }
        
        const sorted = [...reactionTimes].sort((a, b) => a - b);
        const n = sorted.length;
        
        // Mean
        const mean = sorted.reduce((a, b) => a + b, 0) / n;
        
        // Median
        const median = n % 2 === 0 
            ? (sorted[n/2 - 1] + sorted[n/2]) / 2 
            : sorted[Math.floor(n/2)];
        
        // Standard deviation
        const squaredDiffs = sorted.map(x => Math.pow(x - mean, 2));
        const std = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / n);
        
        // Outliers (>3σ от медианы)
        const outlierThreshold = 3 * std;
        const outliers = sorted.filter(rt => Math.abs(rt - median) > outlierThreshold);
        
        return {
            mean: Math.round(mean),
            median: Math.round(median),
            std: Math.round(std),
            min: sorted[0],
            max: sorted[n - 1],
            outlier_count: outliers.length,
            outlier_frac: Math.round((outliers.length / n) * 1000) / 1000
        };
    }

    /**
     * Сброс накопленных метрик (для новой сессии)
     */
    reset() {
        this.frameMetrics = {
            totalFrames: 0,
            faceOkFrames: 0,
            poseStableFrames: 0,
            illuminationOkFrames: 0,
            eyesOpenFrames: 0,
            occlusionFrames: 0,
            totalGazePoints: 0,
            validGazePoints: 0,
            onScreenGazePoints: 0,
            sessionStartTime: null,
            lastFrameTime: null,
            faceLostTime: 0,
            lowLightTime: 0,
            currentFaceLostStart: null,
            currentLowLightStart: null,
            blinkCount: 0,
            lastEyeState: 'open',
            blinkTimestamps: [],
            stimulusEvents: [],
            responseEvents: [],
            reactionTimes: [],
            dropoutSegments: [],
            currentDropoutStart: null
        };
    }

    // === УПРОЩЁННЫЕ МЕТОДЫ ДЛЯ ИНТЕГРАЦИИ С HTML ===
    
    /**
     * Добавить точку взгляда (упрощённый метод для HTML интеграции)
     * @param {number|null} x - координата X взгляда
     * @param {number|null} y - координата Y взгляда  
     * @param {number} timestamp - время от начала сессии (мс)
     * @param {boolean} faceDetected - обнаружено ли лицо
     */
    addGazePoint(x, y, timestamp, faceDetected = true) {
        const fm = this.frameMetrics;
        
        // Инициализация времени начала
        if (fm.sessionStartTime === null) {
            fm.sessionStartTime = 0;
        }
        fm.lastFrameTime = timestamp;
        fm.totalFrames++;
        
        // Face detection
        if (faceDetected) {
            fm.faceOkFrames++;
            if (fm.currentFaceLostStart !== null) {
                fm.faceLostTime += timestamp - fm.currentFaceLostStart;
                fm.currentFaceLostStart = null;
            }
        } else {
            if (fm.currentFaceLostStart === null) {
                fm.currentFaceLostStart = timestamp;
            }
        }
        
        // Gaze tracking
        fm.totalGazePoints++;
        const gazeValid = x !== null && y !== null;
        
        if (gazeValid) {
            fm.validGazePoints++;
            
            // Проверка на экране
            const onScreen = x >= 0 && x <= this.screenConfig.width &&
                            y >= 0 && y <= this.screenConfig.height;
            if (onScreen) {
                fm.onScreenGazePoints++;
            }
            
            // Закрываем dropout
            if (fm.currentDropoutStart !== null) {
                fm.dropoutSegments.push({
                    start: fm.currentDropoutStart,
                    end: timestamp,
                    duration: timestamp - fm.currentDropoutStart
                });
                fm.currentDropoutStart = null;
            }
        } else {
            // Начинаем dropout
            if (fm.currentDropoutStart === null) {
                fm.currentDropoutStart = timestamp;
            }
        }
    }
    
    /**
     * Получить упрощённый QC summary (для HTML интеграции)
     * @returns {Object} упрощённый QC отчёт
     */
    getSummary() {
        const fm = this.frameMetrics;
        const totalPoints = fm.totalGazePoints || 1;
        const totalFrames = fm.totalFrames || 1;
        
        // Рассчитываем базовые метрики
        const validGazePercent = (fm.validGazePoints / totalPoints) * 100;
        const faceDetectedPercent = (fm.faceOkFrames / totalFrames) * 100;
        const onScreenPercent = fm.validGazePoints > 0 
            ? (fm.onScreenGazePoints / fm.validGazePoints) * 100 
            : 0;
        const dropoutPercent = ((totalPoints - fm.validGazePoints) / totalPoints) * 100;
        
        // Определяем passed/failed
        const issues = [];
        
        if (fm.totalGazePoints < 50) {
            issues.push('insufficient_data');
        }
        if (validGazePercent < this.thresholds.gazeValidPct) {
            issues.push('low_valid_gaze');
        }
        if (faceDetectedPercent < this.thresholds.faceOkPct) {
            issues.push('low_face_detection');
        }
        if (onScreenPercent < this.thresholds.gazeOnScreenPct) {
            issues.push('high_offscreen');
        }
        
        const sessionDuration = fm.lastFrameTime - (fm.sessionStartTime || 0);
        if (sessionDuration < 5000) { // минимум 5 секунд
            issues.push('short_duration');
        }
        
        const passed = issues.length === 0;
        
        return {
            passed,
            issues,
            metrics: {
                totalPoints: fm.totalGazePoints,
                validGazePoints: fm.validGazePoints,
                validGazePercent: Math.round(validGazePercent * 10) / 10,
                faceDetectedPercent: Math.round(faceDetectedPercent * 10) / 10,
                onScreenPercent: Math.round(onScreenPercent * 10) / 10,
                dropoutPercent: Math.round(dropoutPercent * 10) / 10,
                sessionDurationMs: sessionDuration,
                dropoutCount: fm.dropoutSegments.length,
                maxDropoutMs: fm.dropoutSegments.length > 0 
                    ? Math.max(...fm.dropoutSegments.map(d => d.duration)) 
                    : 0
            },
            timestamp: Date.now()
        };
    }

    /**
     * Расчёт всех QC-метрик для сессии
     * @param {Object} sessionData - данные сессии
     * @returns {Object} QC summary
     */
    calculateMetrics(sessionData) {
        const precheckFrames = sessionData.precheckFrames || [];
        const eyeTrackingData = sessionData.eyeTracking || [];
        const trackingTestData = sessionData.trackingTest || [];
        const calibrationData = sessionData.calibration || {};
        
        // Расчёт отдельных метрик
        const metrics = {
            // 1. Процент кадров с обнаруженным лицом
            face_ok_pct: this._calculateFaceOkPct(precheckFrames),
            
            // 2. Процент валидных точек взгляда
            gaze_valid_pct: this._calculateGazeValidPct(eyeTrackingData),
            
            // 3. Процент выпадений (dropout)
            dropout_pct: this._calculateDropoutPct(eyeTrackingData),
            
            // 4. Процент стабильной позы
            pose_stable_pct: this._calculatePoseStablePct(precheckFrames),
            
            // 5. Процент оптимального освещения
            illumination_ok_pct: this._calculateIlluminationOkPct(precheckFrames),
            
            // 6. Метрики калибровки
            calibration_quality: this._calculateCalibrationQuality(calibrationData),
            
            // 7. Метрики теста слежения
            tracking_accuracy: this._calculateTrackingAccuracy(trackingTestData),
            
            // 8. Статистика dropout
            dropout_stats: this._calculateDropoutStats(eyeTrackingData),
            
            // 9. Видимость шеи (необязательно)
            neck_visible_pct: this._calculateNeckVisiblePct(precheckFrames)
        };
        
        // Расчёт итогового QC score
        const qcScore = this._calculateQcScore(metrics);
        
        // Определение валидности и причин брака
        const validation = this._validateSession(metrics, qcScore);
        
        return {
            metrics,
            qc_score: qcScore,
            is_valid: validation.isValid,
            validation_status: validation.status,
            rejection_reasons: validation.reasons,
            warnings: validation.warnings,
            timestamp: Date.now(),
            session_id: sessionData.ids?.session || null,
            participant_id: sessionData.ids?.participant || null
        };
    }

    /**
     * 1. Процент кадров с обнаруженным лицом
     * Формула: (кадры с face.detected=true / всего кадров) * 100
     */
    _calculateFaceOkPct(frames) {
        if (!frames || frames.length === 0) return 0;
        
        const faceOkCount = frames.filter(f => f.face?.detected === true).length;
        return Math.round((faceOkCount / frames.length) * 100 * 10) / 10;
    }

    /**
     * 2. Процент валидных точек взгляда
     * Формула: (точки с x,y !== null и в пределах экрана / всего точек) * 100
     */
    _calculateGazeValidPct(gazeData) {
        if (!gazeData || gazeData.length === 0) return 0;
        
        const screenW = window.screen?.width || 1920;
        const screenH = window.screen?.height || 1080;
        
        const validCount = gazeData.filter(point => {
            return point.x !== null && 
                   point.y !== null && 
                   point.x >= 0 && point.x <= screenW &&
                   point.y >= 0 && point.y <= screenH;
        }).length;
        
        return Math.round((validCount / gazeData.length) * 100 * 10) / 10;
    }

    /**
     * 3. Процент выпадений (dropout)
     * Формула: (точки с x=null или y=null / всего точек) * 100
     */
    _calculateDropoutPct(gazeData) {
        if (!gazeData || gazeData.length === 0) return 100;
        
        const dropoutCount = gazeData.filter(point => 
            point.x === null || point.y === null
        ).length;
        
        return Math.round((dropoutCount / gazeData.length) * 100 * 10) / 10;
    }

    /**
     * 4. Процент стабильной позы
     * Формула: (кадры с pose.isStable=true / всего кадров) * 100
     */
    _calculatePoseStablePct(frames) {
        if (!frames || frames.length === 0) return 0;
        
        const stableCount = frames.filter(f => f.pose?.isStable === true).length;
        return Math.round((stableCount / frames.length) * 100 * 10) / 10;
    }

    /**
     * 5. Процент оптимального освещения
     * Формула: (кадры с illumination.status='optimal' / всего кадров) * 100
     */
    _calculateIlluminationOkPct(frames) {
        if (!frames || frames.length === 0) return 0;
        
        const optimalCount = frames.filter(f => 
            f.illumination?.status === 'optimal'
        ).length;
        
        return Math.round((optimalCount / frames.length) * 100 * 10) / 10;
    }

    /**
     * 6. Качество калибровки
     * Формула: (успешных точек калибровки / требуемых точек) * 100
     */
    _calculateCalibrationQuality(calibrationData) {
        const pointsCollected = calibrationData.pointsCollected || 0;
        const pointsRequired = calibrationData.pointsRequired || this.thresholds.minCalibrationPoints;
        
        const completeness = Math.min(100, Math.round((pointsCollected / pointsRequired) * 100));
        
        return {
            completeness,
            points_collected: pointsCollected,
            points_required: pointsRequired,
            is_complete: pointsCollected >= pointsRequired
        };
    }

    /**
     * 7. Точность слежения за фигурами
     * Формула: средняя евклидова дистанция между позицией фигуры и взглядом
     */
    _calculateTrackingAccuracy(trackingData) {
        if (!trackingData || trackingData.length === 0) {
            return { accuracy: 0, avg_distance: null, valid_samples: 0 };
        }
        
        let totalDistance = 0;
        let validSamples = 0;
        
        trackingData.forEach(sample => {
            if (sample.gazeX !== null && sample.gazeY !== null) {
                const dx = sample.shapeX - sample.gazeX;
                const dy = sample.shapeY - sample.gazeY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                totalDistance += distance;
                validSamples++;
            }
        });
        
        if (validSamples === 0) {
            return { accuracy: 0, avg_distance: null, valid_samples: 0 };
        }
        
        const avgDistance = totalDistance / validSamples;
        
        // Нормализуем к шкале 0-100 (где 100 = идеально)
        // Считаем что 200px дистанция = 0% точности
        const maxAcceptableDistance = 200;
        const accuracy = Math.max(0, Math.round((1 - avgDistance / maxAcceptableDistance) * 100));
        
        return {
            accuracy,
            avg_distance: Math.round(avgDistance),
            valid_samples: validSamples,
            total_samples: trackingData.length
        };
    }

    /**
     * 8. Статистика dropout
     * Вычисляет максимальную и среднюю длительность dropout
     */
    _calculateDropoutStats(gazeData) {
        if (!gazeData || gazeData.length === 0) {
            return { max_consecutive_ms: 0, avg_consecutive_ms: 0, dropout_count: 0 };
        }
        
        const dropouts = [];
        let currentDropoutStart = null;
        let currentDropoutDuration = 0;
        
        for (let i = 0; i < gazeData.length; i++) {
            const point = gazeData[i];
            const isDropout = point.x === null || point.y === null;
            
            if (isDropout) {
                if (currentDropoutStart === null) {
                    currentDropoutStart = point.t;
                }
            } else {
                if (currentDropoutStart !== null) {
                    const duration = point.t - currentDropoutStart;
                    dropouts.push(duration);
                    currentDropoutStart = null;
                }
            }
        }
        
        // Если последняя точка была dropout
        if (currentDropoutStart !== null && gazeData.length > 0) {
            const lastPoint = gazeData[gazeData.length - 1];
            dropouts.push(lastPoint.t - currentDropoutStart);
        }
        
        if (dropouts.length === 0) {
            return { max_consecutive_ms: 0, avg_consecutive_ms: 0, dropout_count: 0 };
        }
        
        const maxConsecutive = Math.max(...dropouts);
        const avgConsecutive = Math.round(dropouts.reduce((a, b) => a + b, 0) / dropouts.length);
        
        return {
            max_consecutive_ms: maxConsecutive,
            avg_consecutive_ms: avgConsecutive,
            dropout_count: dropouts.length
        };
    }

    /**
     * 9. Процент видимости шеи (необязательный)
     */
    _calculateNeckVisiblePct(frames) {
        if (!frames || frames.length === 0) return 0;
        
        const neckVisibleCount = frames.filter(f => f.neck?.visible === true).length;
        return Math.round((neckVisibleCount / frames.length) * 100 * 10) / 10;
    }

    /**
     * Расчёт итогового QC score
     * Формула: взвешенная сумма нормализованных метрик
     */
    _calculateQcScore(metrics) {
        // Нормализуем dropout (инвертируем, т.к. меньше = лучше)
        const dropoutNormalized = 100 - metrics.dropout_pct;
        
        const score = 
            metrics.face_ok_pct * this.weights.faceOkPct +
            metrics.gaze_valid_pct * this.weights.gazeValidPct +
            dropoutNormalized * this.weights.dropoutPct +
            metrics.pose_stable_pct * this.weights.poseStablePct +
            metrics.illumination_ok_pct * this.weights.illuminationOkPct;
        
        return Math.round(score * 10) / 10;
    }

    /**
     * Валидация сессии
     * Возвращает статус valid/borderline/invalid и причины брака
     */
    _validateSession(metrics, qcScore) {
        const reasons = [];
        const warnings = [];
        
        // Проверка обязательных метрик
        if (metrics.face_ok_pct < this.thresholds.faceOkPct) {
            reasons.push({
                code: 'FACE_DETECTION_LOW',
                message: `Лицо обнаружено только в ${metrics.face_ok_pct}% кадров (требуется ${this.thresholds.faceOkPct}%)`,
                metric: 'face_ok_pct',
                value: metrics.face_ok_pct,
                threshold: this.thresholds.faceOkPct,
                severity: metrics.face_ok_pct < 70 ? 'critical' : 'warning'
            });
        }
        
        if (metrics.gaze_valid_pct < this.thresholds.gazeValidPct) {
            reasons.push({
                code: 'GAZE_VALIDITY_LOW',
                message: `Валидных точек взгляда ${metrics.gaze_valid_pct}% (требуется ${this.thresholds.gazeValidPct}%)`,
                metric: 'gaze_valid_pct',
                value: metrics.gaze_valid_pct,
                threshold: this.thresholds.gazeValidPct,
                severity: metrics.gaze_valid_pct < 60 ? 'critical' : 'warning'
            });
        }
        
        if (metrics.dropout_pct > this.thresholds.dropoutPct) {
            reasons.push({
                code: 'DROPOUT_HIGH',
                message: `Процент выпадений ${metrics.dropout_pct}% (максимум ${this.thresholds.dropoutPct}%)`,
                metric: 'dropout_pct',
                value: metrics.dropout_pct,
                threshold: this.thresholds.dropoutPct,
                severity: metrics.dropout_pct > 30 ? 'critical' : 'warning'
            });
        }
        
        if (metrics.pose_stable_pct < this.thresholds.poseStablePct) {
            reasons.push({
                code: 'POSE_UNSTABLE',
                message: `Стабильная поза в ${metrics.pose_stable_pct}% кадров (требуется ${this.thresholds.poseStablePct}%)`,
                metric: 'pose_stable_pct',
                value: metrics.pose_stable_pct,
                threshold: this.thresholds.poseStablePct,
                severity: metrics.pose_stable_pct < 60 ? 'critical' : 'warning'
            });
        }
        
        if (metrics.illumination_ok_pct < this.thresholds.illuminationOkPct) {
            reasons.push({
                code: 'ILLUMINATION_POOR',
                message: `Оптимальное освещение в ${metrics.illumination_ok_pct}% кадров (требуется ${this.thresholds.illuminationOkPct}%)`,
                metric: 'illumination_ok_pct',
                value: metrics.illumination_ok_pct,
                threshold: this.thresholds.illuminationOkPct,
                severity: metrics.illumination_ok_pct < 60 ? 'critical' : 'warning'
            });
        }
        
        // Проверка dropout подряд
        if (metrics.dropout_stats.max_consecutive_ms > this.thresholds.maxConsecutiveDropout) {
            reasons.push({
                code: 'CONSECUTIVE_DROPOUT_HIGH',
                message: `Максимальный dropout ${metrics.dropout_stats.max_consecutive_ms}мс (максимум ${this.thresholds.maxConsecutiveDropout}мс)`,
                metric: 'max_consecutive_dropout',
                value: metrics.dropout_stats.max_consecutive_ms,
                threshold: this.thresholds.maxConsecutiveDropout,
                severity: metrics.dropout_stats.max_consecutive_ms > 1000 ? 'critical' : 'warning'
            });
        }
        
        // Проверка калибровки
        if (!metrics.calibration_quality.is_complete) {
            reasons.push({
                code: 'CALIBRATION_INCOMPLETE',
                message: `Калибровка не завершена: ${metrics.calibration_quality.points_collected}/${metrics.calibration_quality.points_required} точек`,
                metric: 'calibration_completeness',
                value: metrics.calibration_quality.points_collected,
                threshold: metrics.calibration_quality.points_required,
                severity: 'critical'
            });
        }
        
        // Предупреждения (не влияют на валидность)
        if (metrics.neck_visible_pct < 50) {
            warnings.push({
                code: 'NECK_VISIBILITY_LOW',
                message: `Шея видна только в ${metrics.neck_visible_pct}% кадров`,
                metric: 'neck_visible_pct',
                value: metrics.neck_visible_pct
            });
        }
        
        if (metrics.tracking_accuracy.accuracy < 50 && metrics.tracking_accuracy.valid_samples > 0) {
            warnings.push({
                code: 'TRACKING_ACCURACY_LOW',
                message: `Точность слежения ${metrics.tracking_accuracy.accuracy}%`,
                metric: 'tracking_accuracy',
                value: metrics.tracking_accuracy.accuracy
            });
        }
        
        // Определение статуса на основе severity и qcScore
        const criticalReasons = reasons.filter(r => r.severity === 'critical');
        const warningReasons = reasons.filter(r => r.severity === 'warning');
        
        let status;
        let isValid;
        
        if (criticalReasons.length > 0 || qcScore < this.thresholds.borderlineQcScore) {
            status = 'invalid';
            isValid = false;
        } else if (warningReasons.length > 0 || qcScore < this.thresholds.minQcScore) {
            status = 'borderline';
            isValid = false;
        } else {
            status = 'valid';
            isValid = true;
        }
        
        return {
            isValid,
            status,
            reasons,
            warnings
        };
    }

    /**
     * Генерация QC summary в формате JSON
     * @param {Object} sessionData - данные сессии
     * @returns {Object} полный QC отчёт
     */
    generateSummary(sessionData) {
        const qcResult = this.calculateMetrics(sessionData);
        const realtimeMetrics = this.getCurrentMetrics();
        const behavioralMetrics = this.getBehavioralMetrics();
        
        return {
            version: '2.0.0',
            generated_at: new Date().toISOString(),
            
            // === Идентификаторы сессии ===
            session: {
                id: qcResult.session_id,
                participant_id: qcResult.participant_id,
                duration_ms: realtimeMetrics.session_duration_ms,
                total_frames: realtimeMetrics.total_frames,
                total_gaze_points: realtimeMetrics.total_gaze_points
            },
            
            // === Общий результат ===
            summary: {
                qc_score: qcResult.qc_score,
                is_valid: qcResult.is_valid,
                status: qcResult.validation_status, // 'valid' | 'borderline' | 'invalid'
                recommendation: this._getRecommendation(qcResult.validation_status)
            },
            
            // === Инструментальный QC ===
            instrumental_qc: {
                face_ok_pct: {
                    value: qcResult.metrics.face_ok_pct,
                    threshold: this.thresholds.faceOkPct,
                    passed: qcResult.metrics.face_ok_pct >= this.thresholds.faceOkPct,
                    formula: '(кадры с face.detected=true / всего кадров) × 100'
                },
                gaze_valid_pct: {
                    value: qcResult.metrics.gaze_valid_pct,
                    threshold: this.thresholds.gazeValidPct,
                    passed: qcResult.metrics.gaze_valid_pct >= this.thresholds.gazeValidPct,
                    formula: '(точки с x,y ≠ null и в пределах экрана / всего точек) × 100'
                },
                dropout_pct: {
                    value: qcResult.metrics.dropout_pct,
                    threshold: this.thresholds.dropoutPct,
                    passed: qcResult.metrics.dropout_pct <= this.thresholds.dropoutPct,
                    formula: '(точки с x=null или y=null / всего точек) × 100'
                },
                pose_stable_pct: {
                    value: qcResult.metrics.pose_stable_pct,
                    threshold: this.thresholds.poseStablePct,
                    passed: qcResult.metrics.pose_stable_pct >= this.thresholds.poseStablePct,
                    formula: '(кадры с pose.isStable=true / всего кадров) × 100'
                },
                illumination_ok_pct: {
                    value: qcResult.metrics.illumination_ok_pct,
                    threshold: this.thresholds.illuminationOkPct,
                    passed: qcResult.metrics.illumination_ok_pct >= this.thresholds.illuminationOkPct,
                    formula: '(кадры с illumination.status="optimal" / всего кадров) × 100'
                },
                eyes_open_pct: {
                    value: realtimeMetrics.eyes_open_pct,
                    threshold: this.thresholds.eyesOpenPct,
                    passed: realtimeMetrics.eyes_open_pct >= this.thresholds.eyesOpenPct,
                    formula: '(кадры с EAR > 0.2 / всего кадров) × 100'
                },
                occlusion_pct: {
                    value: realtimeMetrics.occlusion_pct,
                    threshold: this.thresholds.occlusionPct,
                    passed: realtimeMetrics.occlusion_pct <= this.thresholds.occlusionPct,
                    formula: '(кадры с окклюзией / всего кадров) × 100'
                },
                face_lost_time_ms: {
                    value: realtimeMetrics.face_lost_time_ms,
                    threshold: this.thresholds.maxFaceLostTime,
                    passed: realtimeMetrics.face_lost_time_ms <= this.thresholds.maxFaceLostTime,
                    formula: 'Σ(время без лица) в мс'
                },
                low_light_time_ms: {
                    value: realtimeMetrics.low_light_time_ms,
                    threshold: this.thresholds.maxLowLightTime,
                    passed: realtimeMetrics.low_light_time_ms <= this.thresholds.maxLowLightTime,
                    formula: 'Σ(время с плохим освещением) в мс'
                },
                gaze_on_screen_pct: {
                    value: realtimeMetrics.gaze_on_screen_pct,
                    threshold: this.thresholds.gazeOnScreenPct,
                    passed: realtimeMetrics.gaze_on_screen_pct >= this.thresholds.gazeOnScreenPct,
                    formula: '(точки в пределах экрана / валидных точек) × 100'
                }
            },
            
            // === Поведенческий QC ===
            behavioral_qc: {
                omission_rate: {
                    value: behavioralMetrics.omission_rate,
                    threshold: this.thresholds.omissionRate,
                    passed: behavioralMetrics.omission_rate <= this.thresholds.omissionRate,
                    formula: '(пропущенные target стимулы / всего target стимулов) × 100'
                },
                commission_rate: {
                    value: behavioralMetrics.commission_rate,
                    threshold: this.thresholds.commissionRate,
                    passed: behavioralMetrics.commission_rate <= this.thresholds.commissionRate,
                    formula: '(ответы на nontarget / всего nontarget) × 100'
                },
                rt_outlier_frac: {
                    value: behavioralMetrics.rt_stats.outlier_frac,
                    threshold: this.thresholds.rtOutlierFrac,
                    passed: behavioralMetrics.rt_stats.outlier_frac <= this.thresholds.rtOutlierFrac,
                    formula: '(RT выбросы > 3σ от медианы / всего RT) × 100'
                },
                rt_stats: behavioralMetrics.rt_stats,
                stimulus_stats: {
                    total: behavioralMetrics.total_stimuli,
                    targets: behavioralMetrics.target_stimuli,
                    nontargets: behavioralMetrics.nontarget_stimuli,
                    missed: behavioralMetrics.missed_targets,
                    false_alarms: behavioralMetrics.false_alarms
                }
            },
            
            // === Blink метрики ===
            blink_metrics: {
                count: realtimeMetrics.blink_count,
                rate_per_min: realtimeMetrics.blink_rate_per_min,
                rate_normal: realtimeMetrics.blink_rate_per_min >= this.thresholds.blinkRateMin && 
                            realtimeMetrics.blink_rate_per_min <= this.thresholds.blinkRateMax,
                normal_range: `${this.thresholds.blinkRateMin}-${this.thresholds.blinkRateMax} раз/мин`
            },
            
            // === Калибровка ===
            calibration: qcResult.metrics.calibration_quality,
            
            // === Точность слежения ===
            tracking: qcResult.metrics.tracking_accuracy,
            
            // === Dropout статистика ===
            dropout_stats: {
                ...qcResult.metrics.dropout_stats,
                max_allowed_ms: this.thresholds.maxConsecutiveDropout
            },
            
            // === Причины брака и предупреждения ===
            rejection_reasons: qcResult.rejection_reasons,
            warnings: qcResult.warnings,
            
            // === Формула итогового QC Score ===
            qc_score_formula: {
                description: 'Взвешенная сумма нормализованных метрик',
                weights: this.weights,
                formula: 'Σ(metric_i × weight_i), где dropout инвертирован'
            }
        };
    }
    
    /**
     * Получить рекомендацию на основе статуса
     */
    _getRecommendation(status) {
        switch (status) {
            case 'valid':
                return 'Данные пригодны для анализа';
            case 'borderline':
                return 'Данные могут использоваться с осторожностью. Рекомендуется ручная проверка';
            case 'invalid':
                return 'Данные не пригодны для анализа. Требуется повторная сессия';
            default:
                return 'Статус неизвестен';
        }
    }
}

// Экспорт для использования в HTML
if (typeof window !== 'undefined') {
    window.QCMetrics = QCMetrics;
}

// ES Module export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QCMetrics;
}
