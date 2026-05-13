class FaceMaskCollector {
    constructor() {
        // Конфигурация модуля
        this.config = {
            fps: 10,
            maxBufferSize: 5000,
            recordFullLandmarks: false,
            enableSymmetryTracking: true,
            enableMovementTracking: true,
            // Минимальное кол-во landmarks для валидной маски
            minLandmarksCount: 468,
            // Clamp для timeDelta при расчёте velocity (мс)
            minTimeDelta: 16,
            maxTimeDelta: 500,
            // Размер окна скользящего медианного сглаживания velocity
            velocitySmoothingWindow: 5
        };

        this.maskBuffer = [];

        // Метаданные сессии
        this.sessionMetadata = {
            startTime: null,
            endTime: null,
            totalMasks: 0,
            validMasks: 0,
            noFaceMasks: 0
        };

        this.isRunning = false;
        this.lastCollectionTime = 0;

        this.faceLandmarker = null;

        this.previousMask = null;

        // --- [FIX] Убрана зависимость от window.lastFaceLandmarks ---
        // Провайдер landmarks — внешняя функция, устанавливается через setLandmarksProvider()
        this._landmarksProvider = null;

        // --- [FIX] Хранение id RAF-кадра для явной отмены ---
        this._rafId = null;

        // --- [FIX] Инкрементальный счётчик размера буфера вместо JSON.stringify ---
        this._bufferSizeBytes = 0;

        // --- [FIX] Кольцевой буфер последних velocity для медианного сглаживания ---
        this._velocityWindow = [];

        console.log('[FaceMaskCollector] Модуль инициализирован');
    }

    // ─────────────────────────────────────────────
    //  Инициализация
    // ─────────────────────────────────────────────

    /**
     * Инициализация модуля
     * @param {Object} faceLandmarker
     */
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
     * [FIX] Устанавливает провайдер landmarks вместо чтения window.lastFaceLandmarks.
     * Провайдер — функция без аргументов, возвращающая объект с полем faceLandmarks[].
     * Пример: collector.setLandmarksProvider(() => myLandmarkerResult);
     * @param {() => Object|null} fn
     */
    setLandmarksProvider(fn) {
        if (typeof fn !== 'function') {
            console.error('[FaceMaskCollector] setLandmarksProvider ожидает функцию');
            return;
        }
        this._landmarksProvider = fn;
        console.log('[FaceMaskCollector] Провайдер landmarks установлен');
    }

    // ─────────────────────────────────────────────
    //  Управление жизненным циклом
    // ─────────────────────────────────────────────

    /**
     * Запуск сбора масок
     * @param {HTMLVideoElement} videoElement
     * @param {string} phase
     */
    start(videoElement, phase = 'precheck') {
        if (this.isRunning) {
            console.warn('[FaceMaskCollector] Уже запущен');
            return;
        }

        if (!this.faceLandmarker) {
            console.error('[FaceMaskCollector] Face Landmarker не инициализирован');
            return;
        }

        if (!this._landmarksProvider) {
            console.warn('[FaceMaskCollector] Провайдер landmarks не установлен — используй setLandmarksProvider()');
        }

        this.isRunning = true;
        this.videoElement = videoElement;
        this.currentPhase = phase;
        this.sessionMetadata.startTime = Date.now();
        this.lastCollectionTime = Date.now();

        console.log(`[FaceMaskCollector] ▶️ Запущен (фаза: ${phase})`);

        this._scheduleLoop();
    }

    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        this.sessionMetadata.endTime = Date.now();

        // --- [FIX] Явная отмена RAF ---
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        console.log('[FaceMaskCollector] ⏸️ Остановлен');
        console.log(`[FaceMaskCollector] Собрано масок: ${this.sessionMetadata.totalMasks} (валидных: ${this.sessionMetadata.validMasks})`);
    }

    /**
     * Изменение фазы сессии
     * @param {string} phase
     */
    setPhase(phase) {
        this.currentPhase = phase;
        console.log(`[FaceMaskCollector] Фаза изменена на: ${phase}`);
    }

    // ─────────────────────────────────────────────
    //  Цикл сбора
    // ─────────────────────────────────────────────

    /** [FIX] Планирует следующий кадр и сохраняет rafId */
    _scheduleLoop() {
        if (!this.isRunning) return;
        this._rafId = requestAnimationFrame(() => this._collectionLoop());
    }

    async _collectionLoop() {
        if (!this.isRunning) return;

        const now = Date.now();
        const timeSinceLastCollection = now - this.lastCollectionTime;
        const targetInterval = 1000 / this.config.fps;

        if (timeSinceLastCollection >= targetInterval) {
            await this.collectMask();
            this.lastCollectionTime = now;
        }

        // --- [FIX] Сохраняем id следующего кадра ---
        this._scheduleLoop();
    }

    async collectMask() {
        try {
            if (!this.videoElement || this.videoElement.readyState < 2) {
                return;
            }

            // --- [FIX] Получаем landmarks через провайдер, а не через window ---
            let faceLandmarks = null;

            if (this._landmarksProvider) {
                faceLandmarks = this._landmarksProvider();
            } else {
                // Обратная совместимость: fallback на window.lastFaceLandmarks
                faceLandmarks = window.lastFaceLandmarks ?? null;
            }

            if (!faceLandmarks) {
                this.recordMask(null, 'no_landmarks');
                return;
            }

            if (!faceLandmarks.faceLandmarks || faceLandmarks.faceLandmarks.length === 0) {
                this.recordMask(null, 'no_face');
                return;
            }

            const landmarks = faceLandmarks.faceLandmarks[0];

            // --- [FIX] Валидация структуры landmarks перед генерацией маски ---
            if (!this._validateLandmarks(landmarks)) {
                this.recordMask(null, 'invalid_landmarks');
                return;
            }

            const mask = this.generateMask(landmarks);
            this.recordMask(mask, 'success');

        } catch (error) {
            console.error('[FaceMaskCollector] Ошибка сбора маски:', error);
            this.recordMask(null, 'error');
        }
    }

    // ─────────────────────────────────────────────
    //  Валидация
    // ─────────────────────────────────────────────

    /**
     * [FIX] Проверяет структуру массива landmarks.
     * Убеждается, что массив достаточной длины и ключевые индексы существуют.
     * @param {Array} landmarks
     * @returns {boolean}
     */
    _validateLandmarks(landmarks) {
        if (!Array.isArray(landmarks)) return false;
        if (landmarks.length < this.config.minLandmarksCount) return false;

        // Ключевые индексы, используемые в calculateGeometry / calculateSymmetry
        const criticalIndices = [1, 10, 13, 14, 33, 61, 127, 145, 152, 159,
                                  234, 263, 291, 356, 374, 386, 454];

        for (const idx of criticalIndices) {
            const pt = landmarks[idx];
            if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number') {
                console.warn(`[FaceMaskCollector] Невалидная точка landmarks[${idx}]`);
                return false;
            }
        }

        return true;
    }

    // ─────────────────────────────────────────────
    //  Генерация маски
    // ─────────────────────────────────────────────

    /**
     * Генерация маски лица из landmarks
     * @param {Array} landmarks
     * @returns {Object}
     */
    generateMask(landmarks) {
        const timestamp = Date.now();

        // --- [FIX] "light record" — компактная структура для runtime-хранения ---
        // fullLandmarks добавляются только при включённом флаге (debug/export)
        const mask = {
            timestamp,
            phase: this.currentPhase,

            zones: this.extractFaceZones(landmarks),

            geometry: this.calculateGeometry(landmarks),

            symmetry: this.config.enableSymmetryTracking
                ? this.calculateSymmetry(landmarks)
                : null,

            movement: this.config.enableMovementTracking && this.previousMask
                ? this.calculateMovement(landmarks, timestamp)
                : null,

            fullLandmarks: this.config.recordFullLandmarks
                ? this.compressLandmarks(landmarks)
                : null
        };

        this.previousMask = {
            timestamp,
            landmarks
        };

        return mask;
    }

    // ─────────────────────────────────────────────
    //  Зоны и геометрия
    // ─────────────────────────────────────────────

    extractFaceZones(landmarks) {
        return {
            forehead:     this.getZoneCentroid(landmarks, [10, 338, 297, 332, 284, 251, 389, 356, 454]),
            leftEyebrow:  this.getZoneCentroid(landmarks, [70, 63, 105, 66, 107]),
            rightEyebrow: this.getZoneCentroid(landmarks, [300, 293, 334, 296, 336]),
            leftEye:      this.getZoneCentroid(landmarks, [33, 160, 158, 133, 153, 144, 145, 159]),
            rightEye:     this.getZoneCentroid(landmarks, [362, 385, 387, 263, 373, 380, 374, 386]),
            nose:         this.getZoneCentroid(landmarks, [1, 2, 98, 327, 168, 6, 197, 195, 5]),
            upperLip:     this.getZoneCentroid(landmarks, [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]),
            lowerLip:     this.getZoneCentroid(landmarks, [146, 91, 181, 84, 17, 314, 405, 321, 375]),
            leftCheek:    this.getZoneCentroid(landmarks, [116, 111, 117, 118, 119, 100, 47, 126]),
            rightCheek:   this.getZoneCentroid(landmarks, [345, 340, 346, 347, 348, 329, 277, 355]),
            jaw:          this.getZoneCentroid(landmarks, [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 389])
        };
    }

    getZoneCentroid(landmarks, indices) {
        let sumX = 0, sumY = 0, sumZ = 0;

        for (const idx of indices) {
            const pt = landmarks[idx];
            // [FIX] Пропускаем невалидные точки вместо исключения
            if (!pt) continue;
            sumX += pt.x;
            sumY += pt.y;
            sumZ += pt.z || 0;
        }

        const count = indices.length;
        return {
            x: +(sumX / count).toFixed(4),
            y: +(sumY / count).toFixed(4),
            z: +(sumZ / count).toFixed(4)
        };
    }

    calculateGeometry(landmarks) {
        const leftEyeTop    = landmarks[159];
        const leftEyeBottom = landmarks[145];
        const rightEyeTop   = landmarks[386];
        const rightEyeBottom= landmarks[374];
        const leftMouth     = landmarks[61];
        const rightMouth    = landmarks[291];
        const topLip        = landmarks[13];
        const bottomLip     = landmarks[14];
        const chin          = landmarks[152];
        const forehead      = landmarks[10];

        return {
            leftEyeOpenness:  +this.distance2D(leftEyeTop, leftEyeBottom).toFixed(4),
            rightEyeOpenness: +this.distance2D(rightEyeTop, rightEyeBottom).toFixed(4),
            mouthWidth:       +this.distance2D(leftMouth, rightMouth).toFixed(4),
            mouthOpenness:    +this.distance2D(topLip, bottomLip).toFixed(4),
            mouthCurvature:   +((leftMouth.y + rightMouth.y) / 2 - topLip.y).toFixed(4),
            faceHeight:       +this.distance2D(forehead, chin).toFixed(4),
            headTilt:         +this.calculateHeadTilt(landmarks).toFixed(4)
        };
    }

    calculateSymmetry(landmarks) {
        const noseTip = landmarks[1];

        const pairs = [
            [33, 263],
            [61, 291],
            [234, 454],
            [127, 356]
        ];

        let totalAsymmetry = 0;
        const pairAsymmetries = [];

        for (const [leftIdx, rightIdx] of pairs) {
            const leftPoint  = landmarks[leftIdx];
            const rightPoint = landmarks[rightIdx];

            // [FIX] Fallback: если точки отсутствуют — пропускаем пару
            if (!leftPoint || !rightPoint) {
                pairAsymmetries.push(null);
                continue;
            }

            const leftDist   = Math.abs(leftPoint.x  - noseTip.x);
            const rightDist  = Math.abs(rightPoint.x - noseTip.x);
            const heightDiff = Math.abs(leftPoint.y  - rightPoint.y);
            const asymmetry  = Math.abs(leftDist - rightDist) + heightDiff;

            pairAsymmetries.push(+asymmetry.toFixed(4));
            totalAsymmetry += asymmetry;
        }

        const validPairs = pairAsymmetries.filter(v => v !== null);

        return {
            overall: validPairs.length > 0
                ? +(totalAsymmetry / validPairs.length).toFixed(4)
                : 0,
            pairs: pairAsymmetries
        };
    }

    /**
     * [FIX] Принимает timestamp явно, чтобы избежать дрейфа Date.now() внутри метода
     * [FIX] Clamp timeDelta + медианное сглаживание velocity
     * @param {Array} landmarks
     * @param {number} timestamp
     */
    calculateMovement(landmarks, timestamp) {
        if (!this.previousMask || !this.previousMask.landmarks) {
            return null;
        }

        const prevLandmarks = this.previousMask.landmarks;

        // --- [FIX] Clamp timeDelta ---
        const rawDelta = timestamp - this.previousMask.timestamp;
        const timeDelta = Math.min(
            Math.max(rawDelta, this.config.minTimeDelta),
            this.config.maxTimeDelta
        );

        const keyPoints = [1, 33, 263, 61, 291, 152];

        let totalDisplacement = 0;
        let maxDisplacement   = 0;
        let validCount        = 0;

        for (const idx of keyPoints) {
            const current  = landmarks[idx];
            const previous = prevLandmarks[idx];

            // [FIX] Пропускаем невалидные точки
            if (!current || !previous) continue;

            const displacement = this.distance3D(current, previous);
            totalDisplacement += displacement;
            maxDisplacement    = Math.max(maxDisplacement, displacement);
            validCount++;
        }

        if (validCount === 0) return null;

        const avgDisplacement = totalDisplacement / validCount;
        const rawVelocity     = avgDisplacement / (timeDelta / 1000);

        // --- [FIX] Медианное сглаживание velocity ---
        const smoothedVelocity = this._smoothVelocity(rawVelocity);

        return {
            avgDisplacement: +avgDisplacement.toFixed(4),
            maxDisplacement: +maxDisplacement.toFixed(4),
            timeDelta,
            velocity: +smoothedVelocity.toFixed(4)
        };
    }

    /**
     * [FIX] Скользящая медиана velocity по окну velocitySmoothingWindow
     * @param {number} rawVelocity
     * @returns {number}
     */
    _smoothVelocity(rawVelocity) {
        this._velocityWindow.push(rawVelocity);

        if (this._velocityWindow.length > this.config.velocitySmoothingWindow) {
            this._velocityWindow.shift();
        }

        const sorted = [...this._velocityWindow].sort((a, b) => a - b);
        const mid    = Math.floor(sorted.length / 2);

        return sorted.length % 2 !== 0
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    calculateHeadTilt(landmarks) {
        const leftEye  = landmarks[33];
        const rightEye = landmarks[263];

        const dx = rightEye.x - leftEye.x;
        const dy = rightEye.y - leftEye.y;

        return Math.atan2(dy, dx);
    }

    compressLandmarks(landmarks) {
        return landmarks.map(point => ({
            x: +point.x.toFixed(4),
            y: +point.y.toFixed(4)
        }));
    }

    // ─────────────────────────────────────────────
    //  Вспомогательные методы расстояний
    // ─────────────────────────────────────────────

    distance2D(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    distance3D(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dz = (p1.z || 0) - (p2.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // ─────────────────────────────────────────────
    //  Буфер
    // ─────────────────────────────────────────────

    recordMask(mask, status) {
        const record = { status, data: mask };

        this.maskBuffer.push(record);

        // --- [FIX] Инкрементальная оценка размера буфера ---
        // Грубая оценка: ~200 байт на light-запись, ~50 байт на null-запись
        this._bufferSizeBytes += mask ? 200 : 50;

        this.sessionMetadata.totalMasks++;
        if (status === 'success') {
            this.sessionMetadata.validMasks++;
        } else if (status === 'no_face') {
            this.sessionMetadata.noFaceMasks++;
        }

        if (this.maskBuffer.length > this.config.maxBufferSize) {
            console.warn('[FaceMaskCollector] Буфер переполнен, удаляем старые маски');
            const removed = this.maskBuffer.shift();
            this._bufferSizeBytes -= removed?.data ? 200 : 50;
        }
    }

    getMasks() {
        return this.maskBuffer;
    }

    /**
     * Получение масок по фазе сессии
     * @param {string} phase - 'precheck', 'calibration', 'stimuli'
     */
    getMasksByPhase(phase) {
        return this.maskBuffer.filter(record =>
            record.status === 'success' && record.data.phase === phase
        );
    }

    // ─────────────────────────────────────────────
    //  Статистика и экспорт
    // ─────────────────────────────────────────────

    getAggregatedStats() {
        const validMasks = this.maskBuffer.filter(r => r.status === 'success');

        if (validMasks.length === 0) {
            return null;
        }

        const stats = {
            totalMasks:   this.sessionMetadata.totalMasks,
            validMasks:   this.sessionMetadata.validMasks,
            validDataPct: +(this.sessionMetadata.validMasks / this.sessionMetadata.totalMasks * 100).toFixed(2),

            avgGeometry: {
                leftEyeOpenness:  0,
                rightEyeOpenness: 0,
                mouthWidth:       0,
                mouthOpenness:    0,
                mouthCurvature:   0,
                headTilt:         0
            },

            avgSymmetry:         0,
            avgMovementVelocity: 0,
            phaseDistribution:   {}
        };

        let symmetrySum  = 0;
        let velocitySum  = 0;
        let velocityCount = 0;

        for (const record of validMasks) {
            const mask = record.data;

            for (const key in stats.avgGeometry) {
                stats.avgGeometry[key] += mask.geometry[key] || 0;
            }

            if (mask.symmetry) {
                symmetrySum += mask.symmetry.overall;
            }

            if (mask.movement?.velocity) {
                velocitySum += mask.movement.velocity;
                velocityCount++;
            }

            const phase = mask.phase || 'unknown';
            stats.phaseDistribution[phase] = (stats.phaseDistribution[phase] || 0) + 1;
        }

        const count = validMasks.length;
        for (const key in stats.avgGeometry) {
            stats.avgGeometry[key] = +(stats.avgGeometry[key] / count).toFixed(4);
        }

        stats.avgSymmetry         = +(symmetrySum / count).toFixed(4);
        stats.avgMovementVelocity = velocityCount > 0
            ? +(velocitySum / velocityCount).toFixed(4)
            : 0;

        return stats;
    }

    exportToJSON() {
        return {
            metadata: {
                version:       '1.0',
                collectorType: 'FaceMaskCollector',
                startTime:     new Date(this.sessionMetadata.startTime).toISOString(),
                endTime:       this.sessionMetadata.endTime
                                   ? new Date(this.sessionMetadata.endTime).toISOString()
                                   : null,
                duration:      this.sessionMetadata.endTime
                                   ? (this.sessionMetadata.endTime - this.sessionMetadata.startTime) / 1000
                                   : null,
                config: this.config,
                ...this.sessionMetadata
            },
            masks:           this.maskBuffer,
            aggregatedStats: this.getAggregatedStats()
        };
    }

    exportValidMasksOnly() {
        const validMasks = this.maskBuffer.filter(r => r.status === 'success');

        return {
            metadata: {
                version:    '1.0',
                totalMasks: validMasks.length,
                exportTime: new Date().toISOString()
            },
            masks: validMasks
        };
    }

    // ─────────────────────────────────────────────
    //  Утилиты
    // ─────────────────────────────────────────────

    clear() {
        this.maskBuffer      = [];
        this.previousMask    = null;
        this._bufferSizeBytes = 0;
        this._velocityWindow  = [];

        // --- [FIX] Отмена RAF при очистке ---
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }

        this.sessionMetadata = {
            startTime:   null,
            endTime:     null,
            totalMasks:  0,
            validMasks:  0,
            noFaceMasks: 0
        };

        console.log('[FaceMaskCollector] Буфер очищен');
    }

    /**
     * [FIX] Инкрементальная оценка размера — без JSON.stringify на всём буфере
     */
    getMemoryUsage() {
        return {
            bufferLength:    this.maskBuffer.length,
            bufferSizeMB:    (this._bufferSizeBytes / (1024 * 1024)).toFixed(2),
            maxBufferSize:   this.config.maxBufferSize
        };
    }
}

window.FaceMaskCollector = FaceMaskCollector;

console.log('[FaceMaskCollector] Модуль загружен');