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
            // Максимальная длительность dropout подряд (мс)
            maxConsecutiveDropout: options.maxConsecutiveDropout ?? 500,
            // Минимальное количество точек калибровки
            minCalibrationPoints: options.minCalibrationPoints ?? 9
        };
        
        // Веса для расчёта итогового score
        this.weights = {
            faceOkPct: 0.25,
            gazeValidPct: 0.30,
            dropoutPct: 0.15,
            poseStablePct: 0.20,
            illuminationOkPct: 0.10
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
     * Возвращает статус valid/invalid и причины брака
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
                threshold: this.thresholds.faceOkPct
            });
        }
        
        if (metrics.gaze_valid_pct < this.thresholds.gazeValidPct) {
            reasons.push({
                code: 'GAZE_VALIDITY_LOW',
                message: `Валидных точек взгляда ${metrics.gaze_valid_pct}% (требуется ${this.thresholds.gazeValidPct}%)`,
                metric: 'gaze_valid_pct',
                value: metrics.gaze_valid_pct,
                threshold: this.thresholds.gazeValidPct
            });
        }
        
        if (metrics.dropout_pct > this.thresholds.dropoutPct) {
            reasons.push({
                code: 'DROPOUT_HIGH',
                message: `Процент выпадений ${metrics.dropout_pct}% (максимум ${this.thresholds.dropoutPct}%)`,
                metric: 'dropout_pct',
                value: metrics.dropout_pct,
                threshold: this.thresholds.dropoutPct
            });
        }
        
        if (metrics.pose_stable_pct < this.thresholds.poseStablePct) {
            reasons.push({
                code: 'POSE_UNSTABLE',
                message: `Стабильная поза в ${metrics.pose_stable_pct}% кадров (требуется ${this.thresholds.poseStablePct}%)`,
                metric: 'pose_stable_pct',
                value: metrics.pose_stable_pct,
                threshold: this.thresholds.poseStablePct
            });
        }
        
        if (metrics.illumination_ok_pct < this.thresholds.illuminationOkPct) {
            reasons.push({
                code: 'ILLUMINATION_POOR',
                message: `Оптимальное освещение в ${metrics.illumination_ok_pct}% кадров (требуется ${this.thresholds.illuminationOkPct}%)`,
                metric: 'illumination_ok_pct',
                value: metrics.illumination_ok_pct,
                threshold: this.thresholds.illuminationOkPct
            });
        }
        
        // Проверка dropout подряд
        if (metrics.dropout_stats.max_consecutive_ms > this.thresholds.maxConsecutiveDropout) {
            reasons.push({
                code: 'CONSECUTIVE_DROPOUT_HIGH',
                message: `Максимальный dropout ${metrics.dropout_stats.max_consecutive_ms}мс (максимум ${this.thresholds.maxConsecutiveDropout}мс)`,
                metric: 'max_consecutive_dropout',
                value: metrics.dropout_stats.max_consecutive_ms,
                threshold: this.thresholds.maxConsecutiveDropout
            });
        }
        
        // Проверка калибровки
        if (!metrics.calibration_quality.is_complete) {
            reasons.push({
                code: 'CALIBRATION_INCOMPLETE',
                message: `Калибровка не завершена: ${metrics.calibration_quality.points_collected}/${metrics.calibration_quality.points_required} точек`,
                metric: 'calibration_completeness',
                value: metrics.calibration_quality.points_collected,
                threshold: metrics.calibration_quality.points_required
            });
        }
        
        // Проверка итогового score
        if (qcScore < this.thresholds.minQcScore) {
            reasons.push({
                code: 'QC_SCORE_LOW',
                message: `Общий QC score ${qcScore} (требуется ${this.thresholds.minQcScore})`,
                metric: 'qc_score',
                value: qcScore,
                threshold: this.thresholds.minQcScore
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
        
        const isValid = reasons.length === 0;
        
        return {
            isValid,
            status: isValid ? 'valid' : 'invalid',
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
        
        return {
            version: '1.0.0',
            generated_at: new Date().toISOString(),
            session: {
                id: qcResult.session_id,
                participant_id: qcResult.participant_id
            },
            summary: {
                qc_score: qcResult.qc_score,
                is_valid: qcResult.is_valid,
                status: qcResult.validation_status
            },
            metrics: {
                face_ok_pct: {
                    value: qcResult.metrics.face_ok_pct,
                    threshold: this.thresholds.faceOkPct,
                    passed: qcResult.metrics.face_ok_pct >= this.thresholds.faceOkPct,
                    description: 'Процент кадров с обнаруженным лицом'
                },
                gaze_valid_pct: {
                    value: qcResult.metrics.gaze_valid_pct,
                    threshold: this.thresholds.gazeValidPct,
                    passed: qcResult.metrics.gaze_valid_pct >= this.thresholds.gazeValidPct,
                    description: 'Процент валидных точек взгляда'
                },
                dropout_pct: {
                    value: qcResult.metrics.dropout_pct,
                    threshold: this.thresholds.dropoutPct,
                    passed: qcResult.metrics.dropout_pct <= this.thresholds.dropoutPct,
                    description: 'Процент выпадений сигнала'
                },
                pose_stable_pct: {
                    value: qcResult.metrics.pose_stable_pct,
                    threshold: this.thresholds.poseStablePct,
                    passed: qcResult.metrics.pose_stable_pct >= this.thresholds.poseStablePct,
                    description: 'Процент времени со стабильной позой'
                },
                illumination_ok_pct: {
                    value: qcResult.metrics.illumination_ok_pct,
                    threshold: this.thresholds.illuminationOkPct,
                    passed: qcResult.metrics.illumination_ok_pct >= this.thresholds.illuminationOkPct,
                    description: 'Процент времени с оптимальным освещением'
                }
            },
            calibration: qcResult.metrics.calibration_quality,
            tracking: qcResult.metrics.tracking_accuracy,
            dropout_stats: qcResult.metrics.dropout_stats,
            rejection_reasons: qcResult.rejection_reasons,
            warnings: qcResult.warnings
        };
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
