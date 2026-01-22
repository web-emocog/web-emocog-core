/**
 * PreCheck Analyzer Module v2.1
 * Анализ лица через MediaPipe Face Landmarker
 * 
 * Возможности:
 * - 478 лэндмарок лица
 * - 52 blend shapes (мимика)
 * - Face transformation matrix (yaw/pitch/roll)
 * - Iris tracking
 * - EAR (Eye Aspect Ratio) для детекции морганий
 * 
 * Примечание: Проверка окклюзий (волосы, руки) выполняется через FaceSegmenter
 * 
 * @version 2.1.0 - Упрощённая версия без дублирования логики FaceSegmenter
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
                minSize: options.faceMinSize ?? 5,
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
                maxYaw: options.maxYaw ?? 10,
                maxPitch: options.maxPitch ?? 10,
                maxRoll: options.maxRoll ?? 8,
                stabilityThreshold: 0.05,
                stabilityWindow: 500,
                // Пороги для центрирования глаз
                eyesCenterMaxDeviation: 0.15,
                eyesCenterOptimalDeviation: 0.08
            },
            eyes: {
                earThreshold: 0.2,
                minOpenRatio: 0.25
            }
        };
        
        // Индексы лэндмарок MediaPipe Face Mesh (только необходимые)
        this.LANDMARKS = {
            // Глаза (для EAR)
            LEFT_EYE: [362, 385, 387, 263, 373, 380],
            RIGHT_EYE: [33, 160, 158, 133, 153, 144],
            // Iris (для центрирования и направления взгляда)
            LEFT_IRIS: [468, 469, 470, 471, 472],
            RIGHT_IRIS: [473, 474, 475, 476, 477],
            // Губы (для анализа рта)
            LIPS_OUTER: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
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
            console.log('[PrecheckAnalyzer] Инициализация v2.1 (MediaPipe Face Landmarker)...');
            
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
     * Примечание: для проверки окклюзий используйте FaceSegmenter отдельно
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
            
            // Проверка центрирования глаз (быстрая проверка по координатам)
            const eyesCentering = this._checkEyesCentering(landmarks);
            
            // Расширяем данные позы информацией о центрировании
            pose.eyesCentering = eyesCentering;
            
            // Обновляем статус позы с учётом центрирования
            if (faceData.detected) {
                if (!eyesCentering.centered) {
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
            
            // Финальный статус позы
            if (pose.status !== 'off_center' && pose.status !== 'tilted') {
                pose.status = stability.isStable ? 'stable' : 'unstable';
            }
            
            // Анализ рта
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
        const r11 = matrix[0], r21 = matrix[4], r31 = matrix[8];
        const r32 = matrix[9], r33 = matrix[10];
        
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
            isStable: true,
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
        
        // Направление взгляда
        const gazeDirection = this._estimateGazeDirection(landmarks, leftIris, rightIris);
        
        return {
            left: {
                ear: Math.round(leftEAR * 1000) / 1000,
                isOpen: leftOpen,
                iris: leftIris
            },
            right: {
                ear: Math.round(rightEAR * 1000) / 1000,
                isOpen: rightOpen,
                iris: rightIris
            },
            bothOpen: leftOpen && rightOpen,
            gazeDirection
        };
    }

    /**
     * Вычисление Eye Aspect Ratio (EAR)
     */
    _calculateEAR(landmarks, eyeIndices) {
        const p = eyeIndices.map(i => landmarks[i]);
        
        const v1 = this._distance(p[1], p[5]);
        const v2 = this._distance(p[2], p[4]);
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
        
        let radius = 0;
        for (const p of points) {
            radius += this._distance(center, p);
        }
        radius /= points.length;
        
        return { x: center.x, y: center.y, z: center.z, radius };
    }

    /**
     * Оценка направления взгляда
     */
    _estimateGazeDirection(landmarks, leftIris, rightIris) {
        if (!leftIris || !rightIris) return 'unknown';
        
        const leftEyeCenter = this._getCenter(this.LANDMARKS.LEFT_EYE.map(i => landmarks[i]));
        const rightEyeCenter = this._getCenter(this.LANDMARKS.RIGHT_EYE.map(i => landmarks[i]));
        
        const avgOffsetX = ((leftIris.x - leftEyeCenter.x) + (rightIris.x - rightEyeCenter.x)) / 2;
        const avgOffsetY = ((leftIris.y - leftEyeCenter.y) + (rightIris.y - rightEyeCenter.y)) / 2;
        
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
        const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        return { x: sum.x / points.length, y: sum.y / points.length };
    }

    /**
     * Анализ рта
     */
    _analyzeMouth(mpResults) {
        if (!mpResults.faceLandmarks || mpResults.faceLandmarks.length === 0) {
            return { isOpen: false, openRatio: 0 };
        }
        
        const landmarks = mpResults.faceLandmarks[0];
        
        const upperLip = landmarks[13];
        const lowerLip = landmarks[14];
        const leftCorner = landmarks[61];
        const rightCorner = landmarks[291];
        
        const mouthHeight = this._distance(upperLip, lowerLip);
        const mouthWidth = this._distance(leftCorner, rightCorner);
        
        const openRatio = mouthWidth > 0 ? mouthHeight / mouthWidth : 0;
        
        return {
            isOpen: openRatio > 0.1,
            openRatio: Math.round(openRatio * 100) / 100
        };
    }

    /**
     * Извлечение blend shapes из результатов MediaPipe
     */
    _getBlendShapes(mpResults) {
        if (!mpResults.faceBlendshapes || mpResults.faceBlendshapes.length === 0) {
            return null;
        }
        
        const blendshapesData = mpResults.faceBlendshapes[0];
        const categories = blendshapesData.categories || blendshapesData;
        
        if (!categories || !Array.isArray(categories)) {
            return null;
        }
        
        const result = {};
        for (const shape of categories) {
            if (shape?.categoryName !== undefined) {
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
        
        for (let i = 0; i < data.length; i += 4) {
            const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
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
        
        return { value: normalizedValue, rawValue: Math.round(avgBrightness), status };
    }

    /**
     * Проверка стабильности позы головы
     */
    _checkStability() {
        if (this.poseHistory.length < 5) {
            return { isStable: false, reason: 'insufficient_data' };
        }
        
        const recent = this.poseHistory.slice(-10);
        
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
        
        const angleThreshold = 3;
        const positionThreshold = 0.03;
        
        const isStable = yawStd < angleThreshold && 
                        pitchStd < angleThreshold && 
                        rollStd < angleThreshold &&
                        centerXStd < positionThreshold &&
                        centerYStd < positionThreshold;
        
        return { isStable, metrics: { yawStd, pitchStd, rollStd, centerXStd, centerYStd } };
    }

    /**
     * Создание результата с ошибкой
     */
    _createErrorResult(message) {
        return {
            illumination: { value: 0, rawValue: 0, status: 'unknown' },
            face: { detected: false, confidence: 0, size: 0, status: 'error', bbox: null, issues: ['error'] },
            pose: { yaw: null, pitch: null, roll: null, isStable: false, status: 'error', issues: ['error'] },
            eyes: { left: { ear: 0, isOpen: false, iris: null }, right: { ear: 0, isOpen: false, iris: null }, bothOpen: false, gazeDirection: 'unknown' },
            mouth: { isOpen: false, openRatio: 0 },
            blendShapes: null,
            landmarks: null,
            timestamp: Date.now(),
            frameSize: { width: 0, height: 0 },
            analysisTime: 0,
            error: message
        };
    }

    /**
     * Проверка центрирования глаз относительно центра кадра
     * (быстрая проверка по координатам, не требует сегментации)
     */
    _checkEyesCentering(landmarks) {
        if (!landmarks || landmarks.length < 478) {
            return { centered: false, deviation: { x: 0, y: 0 }, hint: ['no_landmarks'] };
        }

        const leftEyeCenter = landmarks[468];
        const rightEyeCenter = landmarks[473];

        if (!leftEyeCenter || !rightEyeCenter) {
            return { centered: false, deviation: { x: 0, y: 0 }, hint: ['no_eye_landmarks'] };
        }

        const eyesMidpoint = {
            x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
            y: (leftEyeCenter.y + rightEyeCenter.y) / 2
        };

        const deviationX = eyesMidpoint.x - 0.5;
        const deviationY = eyesMidpoint.y - 0.5;

        const maxDeviation = this.thresholds.pose.eyesCenterMaxDeviation;
        const optimalDeviation = this.thresholds.pose.eyesCenterOptimalDeviation;

        const isCenteredX = Math.abs(deviationX) <= maxDeviation;
        const isCenteredY = Math.abs(deviationY) <= maxDeviation;
        const centered = isCenteredX && isCenteredY;

        const hint = [];
        if (!isCenteredX) {
            hint.push(deviationX > 0 ? 'move_left' : 'move_right');
        }
        if (!isCenteredY) {
            hint.push(deviationY > 0 ? 'move_up' : 'move_down');
        }

        const totalDeviation = Math.sqrt(deviationX * deviationX + deviationY * deviationY);
        const quality = Math.max(0, Math.min(100, Math.round((1 - totalDeviation / maxDeviation) * 100)));

        return {
            centered,
            deviation: { x: Math.round(deviationX * 1000) / 1000, y: Math.round(deviationY * 1000) / 1000 },
            eyesMidpoint,
            quality,
            isOptimal: totalDeviation <= optimalDeviation,
            hint: hint.length > 0 ? hint : null
        };
    }

    /**
     * Проверка готовности условий для начала эксперимента
     * Примечание: для полной проверки используйте результаты FaceSegmenter
     * @param {Object} result - результат analyzeFrame
     * @param {Object} segmenterResult - результат FaceSegmenter.segmentFrame (опционально)
     */
    checkReadiness(result = null, segmenterResult = null) {
        const data = result || this.lastResult;
        
        if (!data) {
            return { ready: false, score: 0, issues: ['no_analysis_data'], details: {} };
        }

        const issues = [];
        let score = 100;

        // 1. Проверка освещения
        if (data.illumination.status === 'too_dark') {
            issues.push('illumination_too_dark');
            score -= 25;
        } else if (data.illumination.status === 'too_bright') {
            issues.push('illumination_too_bright');
            score -= 20;
        }

        // 2. Проверка лица
        if (!data.face.detected) {
            issues.push('face_not_detected');
            score -= 50;
        } else {
            if (data.face.status === 'too_small') {
                issues.push('face_too_small');
                score -= 15;
            } else if (data.face.status === 'too_large') {
                issues.push('face_too_large');
                score -= 10;
            } else if (data.face.status === 'out_of_zone') {
                issues.push('face_out_of_zone');
                score -= 15;
            }
        }

        // 3. Проверка позы
        if (data.pose.status === 'off_center') {
            issues.push('eyes_not_centered');
            score -= 20;
        } else if (data.pose.isTilted) {
            issues.push('head_tilted');
            score -= 15;
        }

        if (!data.pose.isStable) {
            issues.push('head_not_stable');
            score -= 10;
        }

        // 4. Проверка глаз
        if (!data.eyes.bothOpen) {
            issues.push('eyes_not_open');
            score -= 20;
        }

        // 5. Проверка окклюзий через FaceSegmenter (если передан)
        if (segmenterResult && !segmenterResult.isComplete) {
            const segIssues = segmenterResult.issues || [];
            
            if (segIssues.includes('left_side_occluded') || segIssues.includes('left_cheek_occluded')) {
                issues.push('left_side_occluded');
                score -= 20;
            }
            if (segIssues.includes('right_side_occluded') || segIssues.includes('right_cheek_occluded')) {
                issues.push('right_side_occluded');
                score -= 20;
            }
            if (segIssues.includes('hair_occlusion') || segIssues.includes('forehead_occluded')) {
                issues.push('face_occluded');
                score -= 15;
            }
        }

        const ready = score >= 70 && issues.length === 0;

        return {
            ready,
            score: Math.max(0, score),
            issues,
            details: {
                illumination: data.illumination,
                face: data.face,
                pose: data.pose,
                eyes: {
                    leftOpen: data.eyes.left.isOpen,
                    rightOpen: data.eyes.right.isOpen,
                    gazeDirection: data.eyes.gazeDirection
                },
                segmentation: segmenterResult ? {
                    isComplete: segmenterResult.isComplete,
                    score: segmenterResult.score,
                    issues: segmenterResult.issues
                } : null
            }
        };
    }

    /**
     * Генерация человекочитаемых рекомендаций
     */
    getRecommendations(result = null, segmenterResult = null) {
        const readiness = this.checkReadiness(result, segmenterResult);
        const recommendations = [];

        const issueMessages = {
            'no_analysis_data': 'Подождите, идёт анализ...',
            'illumination_too_dark': 'Увеличьте освещение или включите дополнительный свет',
            'illumination_too_bright': 'Уменьшите яркость света или отойдите от окна',
            'face_not_detected': 'Расположите лицо в центре кадра',
            'face_too_small': 'Приблизьтесь к камере',
            'face_too_large': 'Отодвиньтесь от камеры',
            'face_out_of_zone': 'Переместите лицо в центр кадра',
            'face_occluded': 'Уберите волосы с лица',
            'left_side_occluded': 'Левая сторона лица закрыта — уберите волосы',
            'right_side_occluded': 'Правая сторона лица закрыта — уберите волосы',
            'eyes_not_centered': 'Расположите глаза в центре кадра',
            'head_tilted': 'Держите голову прямо, смотрите в камеру',
            'head_not_stable': 'Держите голову неподвижно',
            'eyes_not_open': 'Откройте глаза и смотрите в камеру'
        };

        // Подсказки направления из eyesCentering
        if (readiness.details.pose?.eyesCentering?.hint) {
            const directionMessages = {
                'move_left': 'Сместитесь немного влево',
                'move_right': 'Сместитесь немного вправо',
                'move_up': 'Поднимите камеру или опустите голову',
                'move_down': 'Опустите камеру или поднимите голову'
            };
            
            for (const hint of readiness.details.pose.eyesCentering.hint) {
                if (directionMessages[hint]) {
                    recommendations.push(directionMessages[hint]);
                }
            }
        }

        for (const issue of readiness.issues) {
            if (issueMessages[issue]) {
                recommendations.push(issueMessages[issue]);
            }
        }

        return {
            ready: readiness.ready,
            score: readiness.score,
            recommendations: [...new Set(recommendations)]
        };
    }

    /**
     * Сброс истории
     */
    reset() {
        this.poseHistory = [];
        this.lastResult = null;
        this.lastFaceTime = 0;
    }

    /**
     * Освобождение ресурсов
     */
    dispose() {
        if (this.faceLandmarker) {
            this.faceLandmarker.close();
            this.faceLandmarker = null;
        }
        this._canvas = null;
        this._ctx = null;
        this.isInitialized = false;
        this.reset();
    }
}

// Экспорт для использования как модуль
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PrecheckAnalyzer;
}