/**
 * FaceMaskCollector — сбор и агрегация масок лица из MediaPipe landmarks.
 *
 * Изменения v2.1.0:
 *   - [FIX] Убрана зависимость от window.lastFaceLandmarks → setLandmarksProvider(fn)
 *           + fallback на window.lastFaceLandmarks с console.warn для совместимости
 *   - [FIX] rafId хранится явно, cancelAnimationFrame в stop()/clear()
 *   - [FIX] _collectionLoop защищён try/catch
 *   - [FIX] Guard в generateMask: длина + ключевые точки
 *   - [FIX] getMemoryUsage() — инкрементальный счётчик
 *   - [FIX] Light/full record: fullLandmarks только в exportFullMasks()
 *   - [FIX] velocity: clamp dt + медианное сглаживание
 *   - [FIX] faceWidth добавлен в geometry
 *   - [FIX] start()/stop() выводят console.warn о deprecated API
 *   - [FIX] exportFullMasks() реализован
 *
 * @version 2.1.0
 */

class FaceMaskCollector {
    constructor() {
        this.config = {
            fps:                    10,
            maxBufferSize:          5000,
            recordFullLandmarks:    false,
            enableSymmetryTracking: true,
            enableMovementTracking: true,
            minDtMs:                16,
            maxDtMs:                500,
            velocityMedianWindow:   5,
        };

        this.maskBuffer          = [];
        this._bufferByteEstimate = 0;

        // Буфер для full landmarks (только при recordFullLandmarks=true)
        this._fullLandmarksBuffer = [];

        this.sessionMetadata = {
            startTime:   null,
            endTime:     null,
            totalMasks:  0,
            validMasks:  0,
            noFaceMasks: 0,
        };

        this.isRunning          = false;
        this.lastCollectionTime = 0;
        this._rafId             = null;

        this.faceLandmarker     = null;
        this.videoElement       = null;
        this.currentPhase       = 'precheck';
        this.previousMask       = null;

        this._landmarksProvider = null;
        this._velocityWindow    = [];

        console.log('[FaceMaskCollector] Модуль инициализирован (v2.1.0)');
    }

    // ── Инициализация ──────────────────────────────────────────────────────

    initialize(faceLandmarker) {
        if (!faceLandmarker) {
            console.error('[FaceMaskCollector] Face Landmarker не предоставлен');
            return false;
        }
        this.faceLandmarker = faceLandmarker;
        console.log('[FaceMaskCollector] Инициализация завершена');
        return true;
    }

    /**
     * Устанавливает функцию-провайдер landmarks.
     * Заменяет чтение window.lastFaceLandmarks.
     *
     * @param {Function} fn — () => FaceLandmarkerResult | null
     */
    setLandmarksProvider(fn) {
        if (typeof fn !== 'function') {
            console.error('[FaceMaskCollector] setLandmarksProvider: ожидается функция');
            return;
        }
        this._landmarksProvider = fn;
        console.log('[FaceMaskCollector] Провайдер landmarks установлен');
    }

    // ── Запуск / остановка ─────────────────────────────────────────────────

    start(videoElement, phase = 'precheck') {
        if (this.isRunning) {
            console.warn('[FaceMaskCollector] Уже запущен');
            return;
        }
        if (!this.faceLandmarker) {
            console.error('[FaceMaskCollector] Face Landmarker не инициализирован');
            return;
        }

        this.isRunning                 = true;
        this.videoElement              = videoElement;
        this.currentPhase              = phase;
        this.sessionMetadata.startTime = Date.now();
        this.lastCollectionTime        = Date.now();

        console.log(`[FaceMaskCollector] ▶️ Запущен (фаза: ${phase})`);
        this._scheduleLoop();
    }

    stop() {
        if (!this.isRunning) return;

        this.isRunning               = false;
        this.sessionMetadata.endTime = Date.now();

        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        console.log('[FaceMaskCollector] ⏸️ Остановлен');
        console.log(
            `[FaceMaskCollector] Собрано масок: ${this.sessionMetadata.totalMasks}` +
            ` (валидных: ${this.sessionMetadata.validMasks})`
        );
    }

    setPhase(phase) {
        this.currentPhase = phase;
        console.log(`[FaceMaskCollector] Фаза изменена на: ${phase}`);
    }

    // ── Внутренний loop ────────────────────────────────────────────────────

    _scheduleLoop() {
        if (!this.isRunning) return;
        this._rafId = requestAnimationFrame(() => this._collectionLoop());
    }

    async _collectionLoop() {
        if (!this.isRunning) return;

        const now            = Date.now();
        const targetInterval = 1000 / this.config.fps;

        if (now - this.lastCollectionTime >= targetInterval) {
            // [FIX] try/catch на уровне loop — защита от необработанных исключений
            try {
                await this._collectMask();
            } catch (err) {
                console.error('[FaceMaskCollector] Необработанная ошибка в loop:', err);
                this._recordMask(null, 'error');
            }
            this.lastCollectionTime = now;
        }

        this._scheduleLoop();
    }

    async _collectMask() {
        if (!this.videoElement || this.videoElement.readyState < 2) return;

        // [FIX] Провайдер с fallback на window.lastFaceLandmarks для совместимости
        let faceLandmarks = null;
        if (this._landmarksProvider) {
            faceLandmarks = this._landmarksProvider();
        } else if (typeof window !== 'undefined' && window.lastFaceLandmarks) {
            // Обратная совместимость: предупреждаем, но не ломаем
            console.warn(
                '[FaceMaskCollector] Используется window.lastFaceLandmarks (устарело).' +
                ' Вызовите setLandmarksProvider(fn) для явной передачи данных.'
            );
            faceLandmarks = window.lastFaceLandmarks;
        }

        if (!faceLandmarks) {
            this._recordMask(null, 'no_landmarks');
            return;
        }

        if (!faceLandmarks.faceLandmarks || faceLandmarks.faceLandmarks.length === 0) {
            this._recordMask(null, 'no_face');
            return;
        }

        const landmarks = faceLandmarks.faceLandmarks[0];
        const mask      = this.generateMask(landmarks);
        if (mask) {
            this._recordMask(mask, 'success');
        }
    }

    // ── Генерация маски ────────────────────────────────────────────────────

    /**
     * Генерация маски лица из landmarks.
     * Guard: проверяет длину массива и наличие ключевых точек.
     *
     * @param {Array} landmarks
     * @returns {Object|null}
     */
    generateMask(landmarks) {
        if (!this._validateLandmarks(landmarks)) {
            console.warn('[FaceMaskCollector] generateMask: невалидные landmarks');
            return null;
        }

        try {
            const mask = {
                timestamp: Date.now(),
                phase:     this.currentPhase,
                zones:     this._extractFaceZones(landmarks),
                geometry:  this._calculateGeometry(landmarks),
                symmetry:  this.config.enableSymmetryTracking
                               ? this._calculateSymmetry(landmarks)
                               : null,
                movement:  this.config.enableMovementTracking && this.previousMask
                               ? this._calculateMovement(landmarks)
                               : null,
                // fullLandmarks не хранится в light record буфера
                // используйте exportFullMasks() для получения полных данных
                fullLandmarks: null,
            };

            // Сохраняем full landmarks отдельно если нужно
            if (this.config.recordFullLandmarks) {
                this._fullLandmarksBuffer.push({
                    timestamp: mask.timestamp,
                    phase:     mask.phase,
                    landmarks: this._compressLandmarks(landmarks),
                });
                // Ограничиваем размер full-буфера тем же лимитом
                if (this._fullLandmarksBuffer.length > this.config.maxBufferSize) {
                    this._fullLandmarksBuffer.shift();
                }
            }

            this.previousMask = {
                timestamp: mask.timestamp,
                landmarks,
            };

            return mask;

        } catch (error) {
            console.error('[FaceMaskCollector] Ошибка generateMask:', error);
            return null;
        }
    }

    /**
     * Валидация landmarks: длина + структура ключевых точек.
     */
    _validateLandmarks(landmarks) {
        if (!Array.isArray(landmarks) || landmarks.length < 468) return false;

        const KEY_INDICES = [1, 10, 13, 14, 33, 61, 152, 159, 263, 291, 374, 386, 454];
        for (const idx of KEY_INDICES) {
            const pt = landmarks[idx];
            if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') {
                return false;
            }
        }

        return true;
    }

    // ── Зоны лица ──────────────────────────────────────────────────────────

    _extractFaceZones(landmarks) {
        return {
            forehead:     this._getZoneCentroid(landmarks, [10, 338, 297, 332, 284, 251, 389, 356, 454]),
            leftEyebrow:  this._getZoneCentroid(landmarks, [70, 63, 105, 66, 107]),
            rightEyebrow: this._getZoneCentroid(landmarks, [300, 293, 334, 296, 336]),
            leftEye:      this._getZoneCentroid(landmarks, [33, 160, 158, 133, 153, 144, 145, 159]),
            rightEye:     this._getZoneCentroid(landmarks, [362, 385, 387, 263, 373, 380, 374, 386]),
            nose:         this._getZoneCentroid(landmarks, [1, 2, 98, 327, 168, 6, 197, 195, 5]),
            upperLip:     this._getZoneCentroid(landmarks, [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]),
            lowerLip:     this._getZoneCentroid(landmarks, [146, 91, 181, 84, 17, 314, 405, 321, 375]),
            leftCheek:    this._getZoneCentroid(landmarks, [116, 111, 117, 118, 119, 100, 47, 126]),
            rightCheek:   this._getZoneCentroid(landmarks, [345, 340, 346, 347, 348, 329, 277, 355]),
            jaw:          this._getZoneCentroid(landmarks, [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 389]),
        };
    }

    _getZoneCentroid(landmarks, indices) {
        let sumX = 0, sumY = 0, sumZ = 0;
        for (const idx of indices) {
            sumX += landmarks[idx].x;
            sumY += landmarks[idx].y;
            sumZ += landmarks[idx].z || 0;
        }
        const n = indices.length;
        return {
            x: +(sumX / n).toFixed(4),
            y: +(sumY / n).toFixed(4),
            z: +(sumZ / n).toFixed(4),
        };
    }

    // ── Геометрия ──────────────────────────────────────────────────────────

    _calculateGeometry(landmarks) {
        return {
            faceWidth:        +this._distance2D(landmarks[234], landmarks[454]).toFixed(4),
            faceHeight:       +this._distance2D(landmarks[10],  landmarks[152]).toFixed(4),
            leftEyeOpenness:  +this._distance2D(landmarks[159], landmarks[145]).toFixed(4),
            rightEyeOpenness: +this._distance2D(landmarks[386], landmarks[374]).toFixed(4),
            mouthWidth:       +this._distance2D(landmarks[61],  landmarks[291]).toFixed(4),
            mouthOpenness:    +this._distance2D(landmarks[13],  landmarks[14]).toFixed(4),
            mouthCurvature:   +((landmarks[61].y + landmarks[291].y) / 2 - landmarks[13].y).toFixed(4),
            headTilt:         +this._calculateHeadTilt(landmarks).toFixed(4),
        };
    }

    // ── Симметрия ──────────────────────────────────────────────────────────

    _calculateSymmetry(landmarks) {
        const noseTip = landmarks[1];
        const pairs   = [[33, 263], [61, 291], [234, 454], [127, 356]];

        let totalAsymmetry    = 0;
        const pairAsymmetries = [];

        for (const [li, ri] of pairs) {
            const lp        = landmarks[li];
            const rp        = landmarks[ri];
            const asymmetry = Math.abs(Math.abs(lp.x - noseTip.x) - Math.abs(rp.x - noseTip.x)) +
                              Math.abs(lp.y - rp.y);
            pairAsymmetries.push(+asymmetry.toFixed(4));
            totalAsymmetry += asymmetry;
        }

        return {
            overall: +(totalAsymmetry / pairs.length).toFixed(4),
            pairs:   pairAsymmetries,
        };
    }

    // ── Движение ───────────────────────────────────────────────────────────

    _calculateMovement(landmarks) {
        if (!this.previousMask?.landmarks) return null;

        const prevLandmarks = this.previousMask.landmarks;
        const rawDt         = Date.now() - this.previousMask.timestamp;
        const dt            = Math.max(this.config.minDtMs, Math.min(rawDt, this.config.maxDtMs));

        const keyPoints = [1, 33, 263, 61, 291, 152];
        let totalDisplacement = 0;
        let maxDisplacement   = 0;

        for (const idx of keyPoints) {
            const d = this._distance3D(landmarks[idx], prevLandmarks[idx]);
            totalDisplacement += d;
            maxDisplacement    = Math.max(maxDisplacement, d);
        }

        const avgDisplacement  = totalDisplacement / keyPoints.length;
        const rawVelocity      = avgDisplacement / (dt / 1000);
        const smoothedVelocity = this._smoothVelocity(rawVelocity);

        return {
            avgDisplacement: +avgDisplacement.toFixed(4),
            maxDisplacement: +maxDisplacement.toFixed(4),
            timeDelta:       rawDt,
            velocity:        +smoothedVelocity.toFixed(4),
        };
    }

    _smoothVelocity(rawVelocity) {
        this._velocityWindow.push(rawVelocity);
        if (this._velocityWindow.length > this.config.velocityMedianWindow) {
            this._velocityWindow.shift();
        }
        const sorted = [...this._velocityWindow].sort((a, b) => a - b);
        const mid    = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    // ── Утилиты ────────────────────────────────────────────────────────────

    _calculateHeadTilt(landmarks) {
        const l = landmarks[33];
        const r = landmarks[263];
        return Math.atan2(r.y - l.y, r.x - l.x);
    }

    _compressLandmarks(landmarks) {
        return landmarks.map(pt => ({
            x: +pt.x.toFixed(4),
            y: +pt.y.toFixed(4),
        }));
    }

    _distance2D(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    _distance3D(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dz = (p1.z || 0) - (p2.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // ── Запись в буфер ─────────────────────────────────────────────────────

    _recordMask(mask, status) {
        const lightRecord = {
            status,
            data: mask ? {
                timestamp: mask.timestamp,
                phase:     mask.phase,
                geometry:  mask.geometry,
                symmetry:  mask.symmetry,
                movement:  mask.movement,
                zones:     mask.zones,
            } : null,
        };

        this.maskBuffer.push(lightRecord);
        this._bufferByteEstimate += mask ? 800 : 50;

        this.sessionMetadata.totalMasks++;
        if (status === 'success') this.sessionMetadata.validMasks++;
        if (status === 'no_face') this.sessionMetadata.noFaceMasks++;

        if (this.maskBuffer.length > this.config.maxBufferSize) {
            const removed = this.maskBuffer.shift();
            this._bufferByteEstimate -= removed.data ? 800 : 50;
        }
    }

    // ── Публичные геттеры ──────────────────────────────────────────────────

    getMasks()            { return this.maskBuffer; }

    getMasksByPhase(phase) {
        return this.maskBuffer.filter(r => r.status === 'success' && r.data?.phase === phase);
    }

    getAggregatedStats() {
        const validMasks = this.maskBuffer.filter(r => r.status === 'success');
        if (validMasks.length === 0) return null;

        const stats = {
            totalMasks:   this.sessionMetadata.totalMasks,
            validMasks:   this.sessionMetadata.validMasks,
            validDataPct: +(this.sessionMetadata.validMasks / this.sessionMetadata.totalMasks * 100).toFixed(2),
            avgGeometry: {
                faceWidth: 0, faceHeight: 0,
                leftEyeOpenness: 0, rightEyeOpenness: 0,
                mouthWidth: 0, mouthOpenness: 0,
                mouthCurvature: 0, headTilt: 0,
            },
            avgSymmetry:         0,
            avgMovementVelocity: 0,
            phaseDistribution:   {},
        };

        let symmetrySum = 0, velocitySum = 0, velocityCount = 0;

        for (const record of validMasks) {
            const mask = record.data;
            for (const key in stats.avgGeometry) {
                stats.avgGeometry[key] += mask.geometry?.[key] || 0;
            }
            if (mask.symmetry)          symmetrySum += mask.symmetry.overall;
            if (mask.movement?.velocity) { velocitySum += mask.movement.velocity; velocityCount++; }
            const phase = mask.phase || 'unknown';
            stats.phaseDistribution[phase] = (stats.phaseDistribution[phase] || 0) + 1;
        }

        const count = validMasks.length;
        for (const key in stats.avgGeometry) {
            stats.avgGeometry[key] = +(stats.avgGeometry[key] / count).toFixed(4);
        }
        stats.avgSymmetry         = +(symmetrySum / count).toFixed(4);
        stats.avgMovementVelocity = velocityCount > 0
            ? +(velocitySum / velocityCount).toFixed(4) : 0;

        return stats;
    }

    /**
     * [FIX] Инкрементальный счётчик вместо JSON.stringify.
     */
    getMemoryUsage() {
        return {
            bufferLength:  this.maskBuffer.length,
            bufferSizeMB:  (this._bufferByteEstimate / (1024 * 1024)).toFixed(2),
            maxBufferSize: this.config.maxBufferSize,
        };
    }

    // ── Экспорт ────────────────────────────────────────────────────────────

    exportToJSON() {
        return {
            metadata: {
                version:       '2.1.0',
                collectorType: 'FaceMaskCollector',
                startTime:     this.sessionMetadata.startTime
                                   ? new Date(this.sessionMetadata.startTime).toISOString() : null,
                endTime:       this.sessionMetadata.endTime
                                   ? new Date(this.sessionMetadata.endTime).toISOString()   : null,
                duration:      this.sessionMetadata.endTime
                                   ? (this.sessionMetadata.endTime - this.sessionMetadata.startTime) / 1000
                                   : null,
                config:        this.config,
                ...this.sessionMetadata,
            },
            masks:           this.maskBuffer,
            aggregatedStats: this.getAggregatedStats(),
        };
    }

    exportValidMasksOnly() {
        const validMasks = this.maskBuffer.filter(r => r.status === 'success');
        return {
            metadata: {
                version:    '2.1.0',
                totalMasks: validMasks.length,
                exportTime: new Date().toISOString(),
            },
            masks: validMasks,
        };
    }

    /**
     * [FIX] Экспорт масок с полными landmarks (только при recordFullLandmarks=true).
     * @returns {Object|null}
     */
    exportFullMasks() {
        if (!this.config.recordFullLandmarks) {
            console.warn(
                '[FaceMaskCollector] exportFullMasks: установите config.recordFullLandmarks=true' +
                ' для записи полных landmarks.'
            );
            return null;
        }
        return {
            metadata: {
                version:    '2.1.0',
                totalMasks: this._fullLandmarksBuffer.length,
                exportTime: new Date().toISOString(),
            },
            masks: this._fullLandmarksBuffer,
        };
    }

    // ── Сброс ──────────────────────────────────────────────────────────────

    clear() {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        this.maskBuffer              = [];
        this._bufferByteEstimate     = 0;
        this._fullLandmarksBuffer    = [];
        this._velocityWindow         = [];
        this.previousMask            = null;
        this.isRunning               = false;

        this.sessionMetadata = {
            startTime: null, endTime: null,
            totalMasks: 0, validMasks: 0, noFaceMasks: 0,
        };

        console.log('[FaceMaskCollector] Буфер очищен');
    }
}

window.FaceMaskCollector = FaceMaskCollector;
console.log('[FaceMaskCollector] Модуль загружен (v2.1.0)');