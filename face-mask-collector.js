class FaceMaskCollector {
    constructor() {
        // Конфигурация модуля
        this.config = {
            fps: 10,
            maxBufferSize: 5000,
            recordFullLandmarks: false,
            enableSymmetryTracking: true,
            enableMovementTracking: true
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

        console.log('[FaceMaskCollector] Модуль инициализирован');
    }

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

        this.isRunning = true;
        this.videoElement = videoElement;
        this.currentPhase = phase;
        this.sessionMetadata.startTime = Date.now();
        this.lastCollectionTime = Date.now();

        console.log(`[FaceMaskCollector] ▶️ Запущен (фаза: ${phase})`);

        this.collectionLoop();
    }

    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        this.sessionMetadata.endTime = Date.now();
        
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

    async collectionLoop() {
        if (!this.isRunning) return;

        const now = Date.now();
        const timeSinceLastCollection = now - this.lastCollectionTime;
        const targetInterval = 1000 / this.config.fps;

        if (timeSinceLastCollection >= targetInterval) {
            await this.collectMask();
            this.lastCollectionTime = now;
        }

        requestAnimationFrame(() => this.collectionLoop());
    }

    async collectMask() {
      try {
          if (!this.videoElement || this.videoElement.readyState < 2) {
              return;
          }

          let faceLandmarks = null;
        
          if (window.lastFaceLandmarks) {
              faceLandmarks = window.lastFaceLandmarks;
          } else {
              this.recordMask(null, 'no_landmarks');
              return;
          }

          if (!faceLandmarks || !faceLandmarks.faceLandmarks || faceLandmarks.faceLandmarks.length === 0) {
              this.recordMask(null, 'no_face');
              return;
          }

          const landmarks = faceLandmarks.faceLandmarks[0];

          const mask = this.generateMask(landmarks);

          this.recordMask(mask, 'success');

      } catch (error) {
          console.error('[FaceMaskCollector] Ошибка сбора маски:', error);
          this.recordMask(null, 'error');
      }
    }


    /**
     * Генерация маски лица из landmarks
     * @param {Array} landmarks
     * @returns {Object}
     */
    generateMask(landmarks) {
        const mask = {
            timestamp: Date.now(),
            phase: this.currentPhase,
            
            zones: this.extractFaceZones(landmarks),
            
            geometry: this.calculateGeometry(landmarks),
            
            symmetry: this.config.enableSymmetryTracking ? 
                      this.calculateSymmetry(landmarks) : null,
            
            movement: this.config.enableMovementTracking && this.previousMask ? 
                      this.calculateMovement(landmarks) : null,
            
            fullLandmarks: this.config.recordFullLandmarks ? 
                           this.compressLandmarks(landmarks) : null
        };

        this.previousMask = {
            timestamp: mask.timestamp,
            landmarks: landmarks
        };

        return mask;
    }

    extractFaceZones(landmarks) {
        return {
            forehead: this.getZoneCentroid(landmarks, [10, 338, 297, 332, 284, 251, 389, 356, 454]),
            leftEyebrow: this.getZoneCentroid(landmarks, [70, 63, 105, 66, 107]),
            rightEyebrow: this.getZoneCentroid(landmarks, [300, 293, 334, 296, 336]),
            
            leftEye: this.getZoneCentroid(landmarks, [33, 160, 158, 133, 153, 144, 145, 159]),
            rightEye: this.getZoneCentroid(landmarks, [362, 385, 387, 263, 373, 380, 374, 386]),
            nose: this.getZoneCentroid(landmarks, [1, 2, 98, 327, 168, 6, 197, 195, 5]),
            
            upperLip: this.getZoneCentroid(landmarks, [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]),
            lowerLip: this.getZoneCentroid(landmarks, [146, 91, 181, 84, 17, 314, 405, 321, 375]),
            leftCheek: this.getZoneCentroid(landmarks, [116, 111, 117, 118, 119, 100, 47, 126]),
            rightCheek: this.getZoneCentroid(landmarks, [345, 340, 346, 347, 348, 329, 277, 355]),
            jaw: this.getZoneCentroid(landmarks, [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 389])
        };
    }

    getZoneCentroid(landmarks, indices) {
        let sumX = 0, sumY = 0, sumZ = 0;
        
        for (let idx of indices) {
            sumX += landmarks[idx].x;
            sumY += landmarks[idx].y;
            sumZ += landmarks[idx].z || 0;
        }
        
        const count = indices.length;
        return {
            x: +(sumX / count).toFixed(4),
            y: +(sumY / count).toFixed(4),
            z: +(sumZ / count).toFixed(4)
        };
    }

    calculateGeometry(landmarks) {
        const leftEyeTop = landmarks[159];
        const leftEyeBottom = landmarks[145];
        const rightEyeTop = landmarks[386];
        const rightEyeBottom = landmarks[374];
        const leftMouth = landmarks[61];
        const rightMouth = landmarks[291];
        const topLip = landmarks[13];
        const bottomLip = landmarks[14];
        const noseTip = landmarks[1];
        const chin = landmarks[152];
        const forehead = landmarks[10];

        return {
            leftEyeOpenness: +this.distance2D(leftEyeTop, leftEyeBottom).toFixed(4),
            rightEyeOpenness: +this.distance2D(rightEyeTop, rightEyeBottom).toFixed(4),
            
            mouthWidth: +this.distance2D(leftMouth, rightMouth).toFixed(4),
            mouthOpenness: +this.distance2D(topLip, bottomLip).toFixed(4),
            
            mouthCurvature: +((leftMouth.y + rightMouth.y) / 2 - topLip.y).toFixed(4),
            
            faceHeight: +this.distance2D(forehead, chin).toFixed(4),
            
            headTilt: +this.calculateHeadTilt(landmarks).toFixed(4)
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

        for (let [leftIdx, rightIdx] of pairs) {
            const leftPoint = landmarks[leftIdx];
            const rightPoint = landmarks[rightIdx];
            
            const leftDist = Math.abs(leftPoint.x - noseTip.x);
            const rightDist = Math.abs(rightPoint.x - noseTip.x);
            
            const heightDiff = Math.abs(leftPoint.y - rightPoint.y);
            
            const asymmetry = Math.abs(leftDist - rightDist) + heightDiff;
            pairAsymmetries.push(+asymmetry.toFixed(4));
            totalAsymmetry += asymmetry;
        }

        return {
            overall: +(totalAsymmetry / pairs.length).toFixed(4),
            pairs: pairAsymmetries
        };
    }

    calculateMovement(landmarks) {
        if (!this.previousMask || !this.previousMask.landmarks) {
            return null;
        }

        const prevLandmarks = this.previousMask.landmarks;
        const timeDelta = Date.now() - this.previousMask.timestamp;

        const keyPoints = [1, 33, 263, 61, 291, 152];

        let totalDisplacement = 0;
        let maxDisplacement = 0;

        for (let idx of keyPoints) {
            const current = landmarks[idx];
            const previous = prevLandmarks[idx];
            
            const displacement = this.distance3D(current, previous);
            totalDisplacement += displacement;
            maxDisplacement = Math.max(maxDisplacement, displacement);
        }

        const avgDisplacement = totalDisplacement / keyPoints.length;

        return {
            avgDisplacement: +avgDisplacement.toFixed(4),
            maxDisplacement: +maxDisplacement.toFixed(4),
            timeDelta: timeDelta,
            velocity: +(avgDisplacement / (timeDelta / 1000)).toFixed(4)
        };
    }

    calculateHeadTilt(landmarks) {
        const leftEye = landmarks[33];
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

    recordMask(mask, status) {
        const record = {
            status: status,
            data: mask
        };

        this.maskBuffer.push(record);

        this.sessionMetadata.totalMasks++;
        if (status === 'success') {
            this.sessionMetadata.validMasks++;
        } else if (status === 'no_face') {
            this.sessionMetadata.noFaceMasks++;
        }

        if (this.maskBuffer.length > this.config.maxBufferSize) {
            console.warn('[FaceMaskCollector] Буфер переполнен, удаляем старые маски');
            this.maskBuffer.shift();
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

    getAggregatedStats() {
        const validMasks = this.maskBuffer.filter(r => r.status === 'success');

        if (validMasks.length === 0) {
            return null;
        }

        const stats = {
            totalMasks: this.sessionMetadata.totalMasks,
            validMasks: this.sessionMetadata.validMasks,
            validDataPct: +(this.sessionMetadata.validMasks / this.sessionMetadata.totalMasks * 100).toFixed(2),
            
            avgGeometry: {
                leftEyeOpenness: 0,
                rightEyeOpenness: 0,
                mouthWidth: 0,
                mouthOpenness: 0,
                mouthCurvature: 0,
                headTilt: 0
            },
            
            avgSymmetry: 0,
            
            avgMovementVelocity: 0,
            
            phaseDistribution: {}
        };

        let symmetrySum = 0;
        let velocitySum = 0;
        let velocityCount = 0;

        for (let record of validMasks) {
            const mask = record.data;
            
            for (let key in stats.avgGeometry) {
                stats.avgGeometry[key] += mask.geometry[key] || 0;
            }
            
            if (mask.symmetry) {
                symmetrySum += mask.symmetry.overall;
            }
            
            if (mask.movement && mask.movement.velocity) {
                velocitySum += mask.movement.velocity;
                velocityCount++;
            }
            
            const phase = mask.phase || 'unknown';
            stats.phaseDistribution[phase] = (stats.phaseDistribution[phase] || 0) + 1;
        }

        const count = validMasks.length;
        for (let key in stats.avgGeometry) {
            stats.avgGeometry[key] = +(stats.avgGeometry[key] / count).toFixed(4);
        }
        
        stats.avgSymmetry = +(symmetrySum / count).toFixed(4);
        stats.avgMovementVelocity = velocityCount > 0 ? +(velocitySum / velocityCount).toFixed(4) : 0;

        return stats;
    }

    exportToJSON() {
        return {
            metadata: {
                version: '1.0',
                collectorType: 'FaceMaskCollector',
                startTime: new Date(this.sessionMetadata.startTime).toISOString(),
                endTime: this.sessionMetadata.endTime ? 
                         new Date(this.sessionMetadata.endTime).toISOString() : null,
                duration: this.sessionMetadata.endTime ? 
                          (this.sessionMetadata.endTime - this.sessionMetadata.startTime) / 1000 : null,
                config: this.config,
                ...this.sessionMetadata
            },
            masks: this.maskBuffer,
            aggregatedStats: this.getAggregatedStats()
        };
    }

    exportValidMasksOnly() {
        const validMasks = this.maskBuffer.filter(r => r.status === 'success');
        
        return {
            metadata: {
                version: '1.0',
                totalMasks: validMasks.length,
                exportTime: new Date().toISOString()
            },
            masks: validMasks
        };
    }

    clear() {
        this.maskBuffer = [];
        this.previousMask = null;
        this.sessionMetadata = {
            startTime: null,
            endTime: null,
            totalMasks: 0,
            validMasks: 0,
            noFaceMasks: 0
        };
        console.log('[FaceMaskCollector] Буфер очищен');
    }

    getMemoryUsage() {
        const bufferSize = JSON.stringify(this.maskBuffer).length;
        const bufferSizeMB = (bufferSize / (1024 * 1024)).toFixed(2);
        
        return {
            bufferLength: this.maskBuffer.length,
            bufferSizeMB: bufferSizeMB,
            maxBufferSize: this.config.maxBufferSize
        };
    }
}

window.FaceMaskCollector = FaceMaskCollector;

console.log('[FaceMaskCollector] Модуль загружен');
