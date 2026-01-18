/**
 * PreCheck Analyzer Module v2.0
 * Анализ лица через MediaPipe Face Landmarker
 * 
 * Возможности:
 * - 478 лэндмарок лица
 * - 52 blend shapes (мимика)
 * - Face transformation matrix (yaw/pitch/roll)
 * - Iris tracking
 * - EAR (Eye Aspect Ratio) для детекции морганий
 * 
 * @version 2.0.0 - MediaPipe Face Landmarker
 */

class PrecheckAnalyzer {
    constructor(options = {}) {
        this.isInitialized = false;
        this.faceLandmarker = null;
        this.videoStream = null;
        
        // История для анализа стабильности
        this.poseHistory = [];
        this.HISTORY_SIZE = 15;
        
        // Последние данные о лице
        this.lastResult = null;
        this.lastFaceTime = 0;
        
        // Пороговые значения (ISO 19794-5)
        this.thresholds = {
            illumination: {
                tooDark: options.illuminationTooDark ?? 30,
                tooBright: options.illuminationTooBright ?? 220,
                optimalMin: 50,
                optimalMax: 180
            },
            face: {
                minSize: options.faceMinSize ?? 5,    // % от кадра (уменьшено для комфорта)
                maxSize: options.faceMaxSize ?? 60,
                minConfidence: 0.5,
                validZone: {
                    minX: 0.15,
                    maxX: 0.85,
                    minY: 0.10,
                    maxY: 0.90
                }
            },
            pose: {
                maxYaw: options.maxYaw ?? 10,        // градусы (ужесточено с 15)
                maxPitch: options.maxPitch ?? 10,   // градусы (ужесточено с 15)
                maxRoll: options.maxRoll ?? 8,      // градусы (ужесточено с 10)
                stabilityThreshold: 0.05,           // 5% движения
                stabilityWindow: 500,               // мс
                // Новые пороги для центрирования глаз
                eyesCenterMaxDeviation: 0.15,       // максимальное отклонение от центра (15%)
                eyesCenterOptimalDeviation: 0.08    // идеальное отклонение (8%)
            },
            eyes: {
                earThreshold: 0.2,                  // порог моргания
                minOpenRatio: 0.25
            },
            // Новые пороги для проверки видимости лэндмарок
            landmarks: {
                minVisibleRatio: 0.95,              // минимум 95% точек должны быть видимы
                boundaryMargin: 0.02                // отступ от края кадра (2%)
            }
        };
        
        // Индексы лэндмарок MediaPipe Face Mesh
        this.LANDMARKS = {
            // Глаза (для EAR)
            LEFT_EYE: [362, 385, 387, 263, 373, 380],
            RIGHT_EYE: [33, 160, 158, 133, 153, 144],
            // Центры глаз (для центрирования)
            LEFT_EYE_CENTER: [468],   // центр левого iris
            RIGHT_EYE_CENTER: [473],  // центр правого iris
            // Iris
            LEFT_IRIS: [468, 469, 470, 471, 472],
            RIGHT_IRIS: [473, 474, 475, 476, 477],
            // Контур лица
            FACE_OVAL: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
            // Губы
            LIPS_OUTER: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
            LIPS_INNER: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78],
            // Брови
            LEFT_BROW: [276, 283, 282, 295, 285],
            RIGHT_BROW: [46, 53, 52, 65, 55],
            // Нос
            NOSE: [1, 2, 98, 327, 4, 5, 195, 197, 6],
            // Критические точки для проверки видимости (должны быть все видны)
            CRITICAL_POINTS: [
                // Глаза (углы)
                33, 133, 362, 263,
                // Брови (края)
                46, 55, 276, 285,
                // Нос (кончик и крылья)
                1, 4, 98, 327,
                // Губы (углы и центр)
                61, 291, 13, 14,
                // Контур лица (ключевые точки)
                10, 152, 234, 454
            ]
        };
        
        // Callbacks
        this.onInitialized = options.onInitialized || null;
        this.onError = options.onError || null;
        
        // Canvas для анализа освещения
        this._canvas = null;
        this._ctx = null;
        
        // Режим работы
        this.runningMode = "VIDEO";
    }

    /**
     * Инициализация MediaPipe Face Landmarker
     */
    async initialize() {
        if (this.isInitialized) return true;
        
        try {
            console.log('[PrecheckAnalyzer] Инициализация v2.0 (MediaPipe Face Landmarker)...');
            
            // Проверяем наличие MediaPipe
            if (typeof FilesetResolver === 'undefined' || typeof FaceLandmarker === 'undefined') {
                throw new Error('MediaPipe Vision не загружен. Добавьте скрипты в HTML.');
            }
            
            // Загружаем WASM модуль
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
            );
            
            // Создаём Face Landmarker
            this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                    delegate: "GPU"
                },
                runningMode: this.runningMode,
                numFaces: 1,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true
            });
            
            this.isInitialized = true;
            console.log('[PrecheckAnalyzer] MediaPipe Face Landmarker готов');
            
            if (this.onInitialized) {
                this.onInitialized();
            }
            
            return true;
            
        } catch (error) {
            console.error('[PrecheckAnalyzer] Ошибка инициализации:', error);
            if (this.onError) {
                this.onError(error);
            }
            return false;
        }
    }

    /**
     * Полный анализ кадра видео
     */
    async analyzeFrame(videoElement) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!videoElement || videoElement.readyState < 2) {
            return this._createErrorResult('Видео не готово');
        }

        const startTime = performance.now();
        
        try {
            const width = videoElement.videoWidth || 640;
            const height = videoElement.videoHeight || 480;
            
            // Создаём canvas для анализа освещения
            if (!this._canvas) {
                this._canvas = document.createElement('canvas');
                this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
            }
            this._canvas.width = width;
            this._canvas.height = height;
            this._ctx.drawImage(videoElement, 0, 0, width, height);
            const imageData = this._ctx.getImageData(0, 0, width, height);
            
            // Анализ освещения
            const illumination = this._analyzeIllumination(imageData);
            
            // Детекция лица через MediaPipe
            const timestamp = performance.now();
            const mpResults = this.faceLandmarker.detectForVideo(videoElement, timestamp);
            
            // Парсим результаты MediaPipe
            const faceData = this._parseFaceResults(mpResults, width, height);
            
            // Анализ глаз
            const eyes = this._analyzeEyes(mpResults, width, height);
            
            // Анализ позы
            const pose = this._analyzePose(mpResults);
            
            // Получаем landmarks для дополнительных проверок
            const landmarks = mpResults.faceLandmarks?.[0] || null;
            
            // Проверка видимости критических точек лица
            const visibility = this._checkLandmarksVisibility(landmarks);
            
            // Проверка центрирования глаз
            const eyesCentering = this._checkEyesCentering(landmarks);
            
            // Расширяем данные позы информацией о видимости и центрировании
            pose.visibility = visibility;
            pose.eyesCentering = eyesCentering;
            
            // Обновляем статус позы с учётом всех проверок
            if (faceData.detected) {
                if (!visibility.allVisible) {
                    pose.status = 'partial_face';
                    pose.issues = pose.issues || [];
                    pose.issues.push('partial_face');
                } else if (!eyesCentering.centered) {
                    pose.status = 'off_center';
                    pose.issues = pose.issues || [];
                    pose.issues.push('eyes_off_center');
                    if (eyesCentering.hint) {
                        pose.issues.push(...eyesCentering.hint);
                    }
                } else if (pose.isTilted) {
                    pose.status = 'tilted';
                }
            }
            
            // Добавляем в историю для стабильности
            if (faceData.detected && pose.yaw !== null) {
                this.poseHistory.push({
                    yaw: pose.yaw,
                    pitch: pose.pitch,
                    roll: pose.roll,
                    centerX: faceData.bbox?.x + faceData.bbox?.width / 2,
                    centerY: faceData.bbox?.y + faceData.bbox?.height / 2,
                    timestamp: Date.now()
                });
                if (this.poseHistory.length > this.HISTORY_SIZE) {
                    this.poseHistory.shift();
                }
                this.lastFaceTime = Date.now();
            }
            
            // Проверка стабильности
            const stability = this._checkStability();
            pose.isStable = stability.isStable;
            
            // Финальный статус позы (приоритет: partial_face > off_center > tilted > unstable > stable)
            if (pose.status !== 'partial_face' && pose.status !== 'off_center' && pose.status !== 'tilted') {
                pose.status = stability.isStable ? 'stable' : 'unstable';
            }
            
            // Анализ рта (для будущего использования)
            const mouth = this._analyzeMouth(mpResults);
            
            const analysisTime = performance.now() - startTime;
            
            this.lastResult = {
                illumination,
                face: faceData,
                pose,
                eyes,
                mouth,
                blendShapes: this._getBlendShapes(mpResults),
                landmarks,
                timestamp: Date.now(),
                frameSize: { width, height },
                analysisTime: Math.round(analysisTime)
            };

            return this.lastResult;
            
        } catch (error) {
            console.error('[PrecheckAnalyzer] Ошибка анализа:', error);
            return this._createErrorResult(error.message);
        }
    }

    /**
     * Парсинг результатов MediaPipe Face Landmarker
     */
    _parseFaceResults(mpResults, frameWidth, frameHeight) {
        if (!mpResults.faceLandmarks || mpResults.faceLandmarks.length === 0) {
            return {
                detected: false,
                confidence: 0,
                size: 0,
                status: 'not_found',
                bbox: null,
                issues: ['no_face']
            };
        }
        
        const landmarks = mpResults.faceLandmarks[0];
        const issues = [];
        
        // Вычисляем bounding box из лэндмарок
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const point of landmarks) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }
        
        const bbox = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
        
        // Размер лица в процентах от кадра
        const sizePercent = (bbox.width * bbox.height) * 100;
        
        // Центр лица
        const centerX = minX + bbox.width / 2;
        const centerY = minY + bbox.height / 2;
        
        // Проверка зоны
        const zone = this.thresholds.face.validZone;
        if (centerX < zone.minX || centerX > zone.maxX) {
            issues.push('out_of_zone_horizontal');
        }
        if (centerY < zone.minY || centerY > zone.maxY) {
            issues.push('out_of_zone_vertical');
        }
        
        // Проверка размера
        let sizeStatus = 'optimal';
        if (sizePercent < this.thresholds.face.minSize) {
            sizeStatus = 'too_small';
            issues.push('face_too_small');
        } else if (sizePercent > this.thresholds.face.maxSize) {
            sizeStatus = 'too_large';
            issues.push('face_too_large');
        }
        
        // Финальный статус
        let status = sizeStatus;
        if (issues.includes('out_of_zone_horizontal') || issues.includes('out_of_zone_vertical')) {
            status = 'out_of_zone';
        }
        
        const confidence = mpResults.faceBlendshapes?.[0]?.[0]?.score ?? 0.9;
        
        return {
            detected: true,
            confidence,
            size: Math.round(sizePercent * 10) / 10,
            status,
            bbox,
            issues,
            landmarkCount: landmarks.length
        };
    }

    /**
     * Анализ позы головы из Face Transformation Matrix
     */
    _analyzePose(mpResults) {
        if (!mpResults.facialTransformationMatrixes || mpResults.facialTransformationMatrixes.length === 0) {
            return {
                yaw: null,
                pitch: null,
                roll: null,
                isStable: false,
                status: 'no_face'
            };
        }
        
        const matrix = mpResults.facialTransformationMatrixes[0].data;
        
        // Извлекаем углы из матрицы трансформации
        // Matrix layout: [r11, r12, r13, tx, r21, r22, r23, ty, r31, r32, r33, tz, 0, 0, 0, 1]
        const r11 = matrix[0], r12 = matrix[1], r13 = matrix[2];
        const r21 = matrix[4], r22 = matrix[5], r23 = matrix[6];
        const r31 = matrix[8], r32 = matrix[9], r33 = matrix[10];
        
        // Вычисляем углы Эйлера
        const pitch = Math.asin(-r31) * (180 / Math.PI);
        const yaw = Math.atan2(r32, r33) * (180 / Math.PI);
        const roll = Math.atan2(r21, r11) * (180 / Math.PI);
        
        // Проверка превышения порогов
        const issues = [];
        if (Math.abs(yaw) > this.thresholds.pose.maxYaw) {
            issues.push('yaw_exceeded');
        }
        if (Math.abs(pitch) > this.thresholds.pose.maxPitch) {
            issues.push('pitch_exceeded');
        }
        if (Math.abs(roll) > this.thresholds.pose.maxRoll) {
            issues.push('roll_exceeded');
        }
        
        const isTilted = issues.length > 0;
        
        return {
            yaw: Math.round(yaw * 10) / 10,
            pitch: Math.round(pitch * 10) / 10,
            roll: Math.round(roll * 10) / 10,
            isStable: true,  // Будет обновлено после проверки стабильности
            isTilted,
            status: isTilted ? 'tilted' : 'stable',
            issues
        };
    }

    /**
     * Анализ глаз: EAR, позиция iris, открытость
     */
    _analyzeEyes(mpResults, frameWidth, frameHeight) {
        if (!mpResults.faceLandmarks || mpResults.faceLandmarks.length === 0) {
            return {
                left: { ear: 0, isOpen: false, iris: null },
                right: { ear: 0, isOpen: false, iris: null },
                gazeDirection: 'unknown'
            };
        }
        
        const landmarks = mpResults.faceLandmarks[0];
        
        // Вычисляем EAR для каждого глаза
        const leftEAR = this._calculateEAR(landmarks, this.LANDMARKS.LEFT_EYE);
        const rightEAR = this._calculateEAR(landmarks, this.LANDMARKS.RIGHT_EYE);
        
        // Позиции зрачков
        const leftIris = this._getIrisPosition(landmarks, this.LANDMARKS.LEFT_IRIS);
        const rightIris = this._getIrisPosition(landmarks, this.LANDMARKS.RIGHT_IRIS);
        
        // Определение открытости глаз
        const leftOpen = leftEAR > this.thresholds.eyes.earThreshold;
        const rightOpen = rightEAR > this.thresholds.eyes.earThreshold;
        
        // Направление взгляда (упрощённое)
        const gazeDirection = this._estimateGazeDirection(landmarks, leftIris, rightIris);
        
        return {
            left: {
                ear: Math.round(leftEAR * 1000) / 1000,
                isOpen: leftOpen,
                iris: leftIris,
                landmarks: this.LANDMARKS.LEFT_EYE.map(i => landmarks[i])
            },
            right: {
                ear: Math.round(rightEAR * 1000) / 1000,
                isOpen: rightOpen,
                iris: rightIris,
                landmarks: this.LANDMARKS.RIGHT_EYE.map(i => landmarks[i])
            },
            bothOpen: leftOpen && rightOpen,
            gazeDirection
        };
    }

    /**
     * Вычисление Eye Aspect Ratio (EAR)
     * EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
     */
    _calculateEAR(landmarks, eyeIndices) {
        const p = eyeIndices.map(i => landmarks[i]);
        
        // Вертикальные расстояния
        const v1 = this._distance(p[1], p[5]);
        const v2 = this._distance(p[2], p[4]);
        
        // Горизонтальное расстояние
        const h = this._distance(p[0], p[3]);
        
        if (h === 0) return 0;
        
        return (v1 + v2) / (2 * h);
    }

    /**
     * Расстояние между двумя точками
     */
    _distance(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dz = (p1.z || 0) - (p2.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Получение позиции зрачка
     */
    _getIrisPosition(landmarks, irisIndices) {
        if (!landmarks[irisIndices[0]]) return null;
        
        const center = landmarks[irisIndices[0]];
        const points = irisIndices.slice(1).map(i => landmarks[i]);
        
        // Вычисляем радиус как среднее расстояние от центра до краёв
        let radius = 0;
        for (const p of points) {
            radius += this._distance(center, p);
        }
        radius /= points.length;
        
        return {
            x: center.x,
            y: center.y,
            z: center.z,
            radius
        };
    }

    /**
     * Оценка направления взгляда
     */
    _estimateGazeDirection(landmarks, leftIris, rightIris) {
        if (!leftIris || !rightIris) return 'unknown';
        
        // Получаем центры глаз
        const leftEyeCenter = this._getCenter(this.LANDMARKS.LEFT_EYE.map(i => landmarks[i]));
        const rightEyeCenter = this._getCenter(this.LANDMARKS.RIGHT_EYE.map(i => landmarks[i]));
        
        // Смещение зрачков относительно центров глаз
        const leftOffsetX = leftIris.x - leftEyeCenter.x;
        const rightOffsetX = rightIris.x - rightEyeCenter.x;
        const avgOffsetX = (leftOffsetX + rightOffsetX) / 2;
        
        const leftOffsetY = leftIris.y - leftEyeCenter.y;
        const rightOffsetY = rightIris.y - rightEyeCenter.y;
        const avgOffsetY = (leftOffsetY + rightOffsetY) / 2;
        
        const threshold = 0.01;
        
        if (Math.abs(avgOffsetX) < threshold && Math.abs(avgOffsetY) < threshold) {
            return 'center';
        } else if (avgOffsetX < -threshold) {
            return 'left';
        } else if (avgOffsetX > threshold) {
            return 'right';
        } else if (avgOffsetY < -threshold) {
            return 'up';
        } else if (avgOffsetY > threshold) {
            return 'down';
        }
        
        return 'center';
    }

    /**
     * Центр набора точек
     */
    _getCenter(points) {
        const sum = points.reduce((acc, p) => ({
            x: acc.x + p.x,
            y: acc.y + p.y
        }), { x: 0, y: 0 });
        
        return {
            x: sum.x / points.length,
            y: sum.y / points.length
        };
    }

    /**
     * Анализ рта
     */
    _analyzeMouth(mpResults) {
        if (!mpResults.faceLandmarks || mpResults.faceLandmarks.length === 0) {
            return { isOpen: false, openRatio: 0 };
        }
        
        const landmarks = mpResults.faceLandmarks[0];
        
        // Верхняя и нижняя губа (центральные точки)
        const upperLip = landmarks[13];
        const lowerLip = landmarks[14];
        const leftCorner = landmarks[61];
        const rightCorner = landmarks[291];
        
        // Расстояние между губами
        const mouthHeight = this._distance(upperLip, lowerLip);
        const mouthWidth = this._distance(leftCorner, rightCorner);
        
        const openRatio = mouthWidth > 0 ? mouthHeight / mouthWidth : 0;
        const isOpen = openRatio > 0.1;
        
        return {
            isOpen,
            openRatio: Math.round(openRatio * 100) / 100,
            landmarks: this.LANDMARKS.LIPS_OUTER.map(i => landmarks[i])
        };
    }

    /**
     * Извлечение blend shapes из результатов MediaPipe
     * Blend shapes описывают мимику лица (52 параметра)
     */
    _getBlendShapes(mpResults) {
        if (!mpResults.faceBlendshapes || mpResults.faceBlendshapes.length === 0) {
            return null;
        }
        
        const blendshapesData = mpResults.faceBlendshapes[0];
        
        // MediaPipe возвращает массив объектов с categoryName и score
        // или объект с categories
        const categories = blendshapesData.categories || blendshapesData;
        
        if (!categories || !Array.isArray(categories)) {
            return null;
        }
        
        // Преобразуем в удобный формат { categoryName: score }
        const result = {};
        for (let i = 0; i < categories.length; i++) {
            const shape = categories[i];
            if (shape && shape.categoryName !== undefined) {
                result[shape.categoryName] = Math.round(shape.score * 1000) / 1000;
            }
        }
        
        return Object.keys(result).length > 0 ? result : null;
    }

    /**
     * Анализ освещения по данным изображения
     */
    _analyzeIllumination(imageData) {
        const data = imageData.data;
        let totalBrightness = 0;
        const pixelCount = data.length / 4;
        
        // Вычисляем среднюю яркость (luminance)
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // Формула luminance: 0.299*R + 0.587*G + 0.114*B
            const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
            totalBrightness += brightness;
        }
        
        const avgBrightness = totalBrightness / pixelCount;
        const normalizedValue = Math.round((avgBrightness / 255) * 100);
        
        let status = 'optimal';
        if (avgBrightness < this.thresholds.illumination.tooDark) {
            status = 'too_dark';
        } else if (avgBrightness > this.thresholds.illumination.tooBright) {
            status = 'too_bright';
        }
        
        return {
            value: normalizedValue,
            rawValue: Math.round(avgBrightness),
            status
        };
    }

    /**
     * Проверка стабильности позы головы
     */
    _checkStability() {
        if (this.poseHistory.length < 5) {
            return { isStable: false, reason: 'insufficient_data' };
        }
        
        // Берём последние N записей
        const recent = this.poseHistory.slice(-10);
        
        // Вычисляем стандартное отклонение для каждого параметра
        const calcStdDev = (values) => {
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const sqDiffs = values.map(v => Math.pow(v - mean, 2));
            return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
        };
        
        const yawStd = calcStdDev(recent.map(p => p.yaw));
        const pitchStd = calcStdDev(recent.map(p => p.pitch));
        const rollStd = calcStdDev(recent.map(p => p.roll));
        const centerXStd = calcStdDev(recent.map(p => p.centerX));
        const centerYStd = calcStdDev(recent.map(p => p.centerY));
        
        // Пороги стабильности
        const angleThreshold = 3;  // градусы
        const positionThreshold = 0.03;  // 3% от размера кадра
        
        const isStable = yawStd < angleThreshold && 
                        pitchStd < angleThreshold && 
                        rollStd < angleThreshold &&
                        centerXStd < positionThreshold &&
                        centerYStd < positionThreshold;
        
        return {
            isStable,
            metrics: {
                yawStd: Math.round(yawStd * 10) / 10,
                pitchStd: Math.round(pitchStd * 10) / 10,
                rollStd: Math.round(rollStd * 10) / 10,
                centerXStd: Math.round(centerXStd * 1000) / 1000,
                centerYStd: Math.round(centerYStd * 1000) / 1000
            }
        };
    }

    /**
     * Проверка видимости всех ключевых точек лица
     * Точки считаются невидимыми, если они выходят за пределы кадра
     */
    _checkLandmarksVisibility(landmarks) {
        if (!landmarks || landmarks.length === 0) {
            return {
                allVisible: false,
                visibleRatio: 0,
                missingPoints: [],
                status: 'no_landmarks'
            };
        }

        const margin = this.thresholds.landmarks.boundaryMargin;
        const criticalPoints = this.LANDMARKS.CRITICAL_POINTS;
        const missingPoints = [];
        let visibleCount = 0;

        // Проверяем критические точки
        for (const idx of criticalPoints) {
            const point = landmarks[idx];
            if (!point) {
                missingPoints.push({ index: idx, reason: 'missing' });
                continue;
            }

            // Точка видима, если она внутри кадра с отступом
            const isVisible = 
                point.x >= margin && 
                point.x <= (1 - margin) && 
                point.y >= margin && 
                point.y <= (1 - margin);

            if (isVisible) {
                visibleCount++;
            } else {
                missingPoints.push({ 
                    index: idx, 
                    reason: 'out_of_frame',
                    x: point.x,
                    y: point.y
                });
            }
        }

        const visibleRatio = visibleCount / criticalPoints.length;
        const allVisible = visibleRatio >= this.thresholds.landmarks.minVisibleRatio;

        return {
            allVisible,
            visibleRatio: Math.round(visibleRatio * 100) / 100,
            visibleCount,
            totalCritical: criticalPoints.length,
            missingPoints,
            status: allVisible ? 'all_visible' : 'partial_face'
        };
    }

    /**
     * Проверка центрирования глаз относительно центра экрана
     * Для eye-tracking важно, чтобы глаза были напротив камеры
     */
    _checkEyesCentering(landmarks) {
        if (!landmarks || landmarks.length === 0) {
            return {
                centered: false,
                deviation: 1,
                status: 'no_landmarks'
            };
        }

        // Получаем центры глаз (используем iris центры если доступны)
        const leftIrisCenter = landmarks[468];  // LEFT_IRIS center
        const rightIrisCenter = landmarks[473]; // RIGHT_IRIS center

        if (!leftIrisCenter || !rightIrisCenter) {
            return {
                centered: false,
                deviation: 1,
                status: 'no_iris'
            };
        }

        // Вычисляем центр между глазами
        const eyesCenterX = (leftIrisCenter.x + rightIrisCenter.x) / 2;
        const eyesCenterY = (leftIrisCenter.y + rightIrisCenter.y) / 2;

        // Отклонение от центра экрана (0.5, 0.5)
        const deviationX = eyesCenterX - 0.5;
        const deviationY = eyesCenterY - 0.5;
        const deviation = Math.sqrt(deviationX * deviationX + deviationY * deviationY);

        // Определяем статус
        const optimalThreshold = this.thresholds.pose.eyesCenterOptimalDeviation;
        const maxThreshold = this.thresholds.pose.eyesCenterMaxDeviation;

        let status, centered;
        if (deviation <= optimalThreshold) {
            status = 'optimal';
            centered = true;
        } else if (deviation <= maxThreshold) {
            status = 'acceptable';
            centered = true;
        } else {
            status = 'off_center';
            centered = false;
        }

        // Определяем направление смещения для подсказки пользователю
        let hint = null;
        if (!centered) {
            const hints = [];
            if (deviationX < -0.05) hints.push('move_right');
            if (deviationX > 0.05) hints.push('move_left');
            if (deviationY < -0.05) hints.push('move_down');
            if (deviationY > 0.05) hints.push('move_up');
            hint = hints;
        }

        return {
            centered,
            deviation: Math.round(deviation * 1000) / 1000,
            deviationX: Math.round(deviationX * 1000) / 1000,
            deviationY: Math.round(deviationY * 1000) / 1000,
            eyesCenter: {
                x: Math.round(eyesCenterX * 1000) / 1000,
                y: Math.round(eyesCenterY * 1000) / 1000
            },
            status,
            hint
        };
    }

    /**
     * Комплексная проверка позы для eye-tracking
     * Объединяет все проверки: наклон, видимость, центрирование
     */
    checkPoseQuality(precheckData) {
        if (!precheckData || !precheckData.landmarks) {
            return {
                quality: 'poor',
                score: 0,
                issues: ['no_face_data'],
                details: {}
            };
        }

        const issues = [];
        let score = 100;

        // 1. Проверка наклона головы
        const pose = precheckData.pose;
        if (pose.isTilted) {
            issues.push('head_tilted');
            score -= 30;
            
            if (pose.issues.includes('yaw_exceeded')) {
                issues.push(`yaw_${pose.yaw > 0 ? 'right' : 'left'}_${Math.abs(pose.yaw).toFixed(0)}deg`);
            }
            if (pose.issues.includes('pitch_exceeded')) {
                issues.push(`pitch_${pose.pitch > 0 ? 'down' : 'up'}_${Math.abs(pose.pitch).toFixed(0)}deg`);
            }
            if (pose.issues.includes('roll_exceeded')) {
                issues.push(`roll_${Math.abs(pose.roll).toFixed(0)}deg`);
            }
        }

        // 2. Проверка видимости лэндмарок
        const visibility = this._checkLandmarksVisibility(precheckData.landmarks);
        if (!visibility.allVisible) {
            issues.push('partial_face');
            score -= 25;
        }

        // 3. Проверка центрирования глаз
        const centering = this._checkEyesCentering(precheckData.landmarks);
        if (!centering.centered) {
            issues.push('eyes_off_center');
            if (centering.hint) {
                issues.push(...centering.hint);
            }
            score -= 20;
        } else if (centering.status !== 'optimal') {
            score -= 5; // небольшой штраф за неидеальное центрирование
        }

        // 4. Проверка стабильности
        if (!pose.isStable) {
            issues.push('head_unstable');
            score -= 15;
        }

        // 5. Проверка открытости глаз
        if (!precheckData.eyes?.bothOpen) {
            issues.push('eyes_closed');
            score -= 10;
        }

        // Определяем качество
        let quality;
        if (score >= 90) {
            quality = 'excellent';
        } else if (score >= 70) {
            quality = 'good';
        } else if (score >= 50) {
            quality = 'acceptable';
        } else {
            quality = 'poor';
        }

        return {
            quality,
            score: Math.max(0, score),
            issues,
            details: {
                pose: {
                    yaw: pose.yaw,
                    pitch: pose.pitch,
                    roll: pose.roll,
                    isTilted: pose.isTilted,
                    isStable: pose.isStable
                },
                visibility,
                centering,
                eyesOpen: precheckData.eyes?.bothOpen ?? false
            }
        };
    }

    /**
     * Создание результата с ошибкой
     */
    _createErrorResult(errorMessage) {
        return {
            error: true,
            errorMessage,
            illumination: { value: 0, status: 'error' },
            face: { detected: false, size: 0, status: 'error' },
            pose: { status: 'error', isStable: false },
            eyes: { left: { ear: 0, isOpen: false }, right: { ear: 0, isOpen: false } },
            mouth: { isOpen: false, openRatio: 0 },
            blendShapes: null,
            landmarks: null,
            timestamp: Date.now()
        };
    }

    /**
     * Сброс состояния анализатора
     */
    reset() {
        this.poseHistory = [];
        this.lastResult = null;
        this.lastFaceTime = 0;
    }

    /**
     * Проверка готовности к калибровке
     * Использует комплексную проверку позы
     */
    checkCalibrationReadiness(precheckData) {
        const issues = [];
        
        if (!precheckData) {
            return { ready: false, issues: ['no_data'], poseQuality: null };
        }
        
        // Проверка освещения
        if (precheckData.illumination?.status === 'too_dark') {
            issues.push('lighting_too_dark');
        } else if (precheckData.illumination?.status === 'too_bright') {
            issues.push('lighting_too_bright');
        }
        
        // Проверка лица
        if (!precheckData.face?.detected) {
            issues.push('face_not_detected');
        } else if (precheckData.face?.status === 'too_small') {
            issues.push('face_too_small');
        } else if (precheckData.face?.status === 'too_large') {
            issues.push('face_too_large');
        } else if (precheckData.face?.status === 'out_of_zone') {
            issues.push('face_out_of_zone');
        }
        
        // Комплексная проверка позы (новая логика)
        const poseQuality = this.checkPoseQuality(precheckData);
        
        // Добавляем проблемы из проверки позы
        if (poseQuality.quality === 'poor') {
            // Фильтруем только критические проблемы позы
            for (const issue of poseQuality.issues) {
                if (issue === 'head_tilted') issues.push('head_tilted');
                if (issue === 'partial_face') issues.push('partial_face_visible');
                if (issue === 'eyes_off_center') issues.push('eyes_not_centered');
                if (issue === 'head_unstable') issues.push('head_unstable');
                if (issue === 'eyes_closed') issues.push('eyes_closed');
            }
        }
        
        return {
            ready: issues.length === 0,
            issues,
            poseQuality
        };
    }
}