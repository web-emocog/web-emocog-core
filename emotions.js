class EmotionAnalyzer {
    constructor() {
        this.emotionLabels = [
            'neutral',
            'happiness',
            'sadness',
            'anger',
            'fear',
            'surprise',
            'disgust'
        ];

        this.affectiveDimensions = {
            valence: 0,
            arousal: 0
        };

        this.emotionEvents = [];

        this.config = {
            fps: 10,
            confidenceThreshold: 0.5,
            smoothingWindow: 3,
            recordRawScores: true
        };

        this.isRunning = false;
        this.lastAnalysisTime = 0;
        this.smoothingBuffer = [];

        this.faceLandmarker = null;

        this.emotionSession = null;

        this.faceMask = null;

        console.log('[EmotionAnalyzer] Инициализирован');
    }

    /**
     * Инициализация модуля
     * @param {Object} faceLandmarker
     */
    async initialize(faceLandmarker) {
        try {
            console.log('[EmotionAnalyzer] Начало инициализации...');

            this.faceLandmarker = faceLandmarker;

            await this.loadEmotionModel();

            console.log('[EmotionAnalyzer] Инициализация завершена');
            return true;
        } catch (error) {
            console.error('[EmotionAnalyzer] Ошибка инициализации:', error);
            return false;
        }
    }

    async loadEmotionModel() {
        try {
            if (typeof ort === 'undefined') {
                console.warn('[EmotionAnalyzer] ONNX Runtime не загружен, используем fallback');
                this.useFallbackModel();
                return;
            }

            const modelPath = 'js/models/emotion-model.onnx';
          
            this.emotionSession = await ort.InferenceSession.create(modelPath, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });

            console.log('[EmotionAnalyzer] ONNX модель загружена');
        } catch (error) {
            console.warn('[EmotionAnalyzer] Не удалось загрузить ONNX модель, используем fallback:', error);
            this.useFallbackModel();
        }
    }

    useFallbackModel() {
        console.log('[EmotionAnalyzer] Используется fallback-модель на основе landmarks');
        this.emotionSession = 'fallback';
    }

    /**
     * Запуск анализа эмоций
     * @param {HTMLVideoElement} videoElement
     */
    start(videoElement) {
        if (this.isRunning) {
            console.warn('[EmotionAnalyzer] Уже запущен');
            return;
        }

        if (!this.faceLandmarker) {
            console.error('[EmotionAnalyzer] Face Landmarker не инициализирован');
            return;
        }

        this.isRunning = true;
        this.videoElement = videoElement;
        this.lastAnalysisTime = Date.now();

        console.log('[EmotionAnalyzer] ▶️ Запущен');

        this.analyzeLoop();
    }

    stop() {
        this.isRunning = false;
        console.log('[EmotionAnalyzer] ⏸️ Остановлен');
    }

    async analyzeLoop() {
        if (!this.isRunning) return;

        const now = Date.now();
        const timeSinceLastAnalysis = now - this.lastAnalysisTime;
        const targetInterval = 1000 / this.config.fps;

        if (timeSinceLastAnalysis >= targetInterval) {
            await this.analyzeFrame();
            this.lastAnalysisTime = now;
        }

        requestAnimationFrame(() => this.analyzeLoop());
    }

    async analyzeFrame() {
        try {
            if (!this.videoElement || this.videoElement.readyState < 2) {
                return;
            }

            let faceLandmarks = null;
        
            if (window.lastFaceLandmarks) {
                faceLandmarks = window.lastFaceLandmarks;
            } else {
                // Fallback
                this.recordEmotionEvent(null, 'no_landmarks');
                return;
            }

            if (!faceLandmarks || !faceLandmarks.faceLandmarks || faceLandmarks.faceLandmarks.length === 0) {
                // Лицо не обнаружено
                this.recordEmotionEvent(null, 'no_face');
                return;
            }

            // Первое обнаруженное лицо
            const landmarks = faceLandmarks.faceLandmarks[0];

            // Маска лица
            this.faceMask = this.generateFaceMask(landmarks);

            // Анализ эмоции
            let emotionScores;
            if (this.emotionSession === 'fallback') {
                // Fallback-метод на основе геометрии
                emotionScores = this.analyzeFallbackEmotion(landmarks);
            } else {
                // Использование ONNX модели
                emotionScores = await this.analyzeWithONNX(landmarks);
            }

            // Сглаживание результатов
            const smoothedScores = this.smoothEmotionScores(emotionScores);

            // Вычисление аффективных измерений
            this.updateAffectiveDimensions(smoothedScores);

            // Запись события
            this.recordEmotionEvent(smoothedScores, 'success');

        } catch (error) {
            console.error('[EmotionAnalyzer] Ошибка анализа кадра:', error);
        }
    }

    /**
     * @param {Array} landmarks - Landmarks лица от MediaPipe
     * @returns {Object} Scores для каждой эмоции
     */
    async analyzeWithONNX(landmarks) {
        // Для MVP используем fallback
        return this.analyzeFallbackEmotion(landmarks);
    }

    /**
     * Fallback-анализ эмоций на основе геометрии лица
     * 
     * @param {Array} landmarks - 478 точек лица от MediaPipe
     * @returns {Object} Scores для каждой эмоции
     */
    analyzeFallbackEmotion(landmarks) {
        const leftEyeTop = landmarks[159];
        const leftEyeBottom = landmarks[145];
        const rightEyeTop = landmarks[386];
        const rightEyeBottom = landmarks[374];
      
        const leftMouth = landmarks[61];
        const rightMouth = landmarks[291];
        const topLip = landmarks[13];
        const bottomLip = landmarks[14];
      
        const leftEyebrow = landmarks[70];
        const rightEyebrow = landmarks[300];
        const noseTip = landmarks[1];
        
        // Открытость глаз
        const leftEyeOpen = this.calculateDistance(leftEyeTop, leftEyeBottom);
        const rightEyeOpen = this.calculateDistance(rightEyeTop, rightEyeBottom);
        const eyeOpenness = (leftEyeOpen + rightEyeOpen) / 2;

        // Ширина рта
        const mouthWidth = this.calculateDistance(leftMouth, rightMouth);
      
        // Открытость рта
        const mouthOpen = this.calculateDistance(topLip, bottomLip);
      
        // Кривизна рта
        const mouthCurvature = (leftMouth.y + rightMouth.y) / 2 - topLip.y;

        // Положение бровей
        const eyebrowHeight = ((leftEyebrow.y + rightEyebrow.y) / 2 - noseTip.y);

        // Правила для эмоций (это будет упрощенная версия)
        const scores = {
            neutral: 0.3,
            happiness: 0,
            sadness: 0,
            anger: 0,
            fear: 0,
            surprise: 0,
            disgust: 0
        };

        // Счастье
        if (mouthWidth > 0.15 && mouthCurvature < -0.01) {
            scores.happiness = Math.min(1.0, mouthWidth * 3 + Math.abs(mouthCurvature) * 10);
            scores.neutral = Math.max(0, scores.neutral - scores.happiness);
        }

        // Грусть
        if (mouthCurvature > 0.005 && eyeOpenness < 0.02) {
            scores.sadness = Math.min(0.8, mouthCurvature * 50 + (0.03 - eyeOpenness) * 20);
            scores.neutral = Math.max(0, scores.neutral - scores.sadness);
        }

        // Удивление
        if (eyeOpenness > 0.03 && mouthOpen > 0.03 && eyebrowHeight < -0.05) {
            scores.surprise = Math.min(0.9, eyeOpenness * 15 + mouthOpen * 15);
            scores.neutral = Math.max(0, scores.neutral - scores.surprise);
        }

        // Гнев
        if (eyebrowHeight > -0.02 && mouthWidth < 0.12) {
            scores.anger = Math.min(0.7, (0.02 + eyebrowHeight) * 20);
            scores.neutral = Math.max(0, scores.neutral - scores.anger);
        } 

        // Страх
        if (eyeOpenness > 0.025 && mouthOpen > 0.015 && mouthOpen < 0.03) {
            scores.fear = Math.min(0.7, eyeOpenness * 12 + mouthOpen * 10);
            scores.neutral = Math.max(0, scores.neutral - scores.fear);
        }

        // Отвращение
        if (mouthCurvature > 0.003 && topLip.y < noseTip.y + 0.02) {
            scores.disgust = Math.min(0.6, mouthCurvature * 30);
            scores.neutral = Math.max(0, scores.neutral - scores.disgust);
        }

        // Нормализация скоров
        const total = Object.values(scores).reduce((sum, val) => sum + val, 0);
        if (total > 0) {
            for (let emotion in scores) {
                scores[emotion] = scores[emotion] / total;
            }
        }

        return scores;
    }

    // Евклидово расстояние
    calculateDistance(point1, point2) {
        const dx = point1.x - point2.x;
        const dy = point1.y - point2.y;
        const dz = (point1.z || 0) - (point2.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    // Сглаживание скоров
    smoothEmotionScores(scores) {
        // Буфер
        this.smoothingBuffer.push(scores);

        // Ограничение размера буфера
        if (this.smoothingBuffer.length > this.config.smoothingWindow) {
            this.smoothingBuffer.shift();
        }

        // Усреднение
        const smoothed = {};
        for (let emotion of this.emotionLabels) {
            const values = this.smoothingBuffer.map(s => s[emotion] || 0);
            smoothed[emotion] = values.reduce((sum, val) => sum + val, 0) / values.length;
        }

        return smoothed;
    }

    updateAffectiveDimensions(scores) {
        // Валентность
        const positiveEmotions = (scores.happiness || 0) + (scores.surprise || 0) * 0.5;
        const negativeEmotions = (scores.sadness || 0) + (scores.anger || 0) + 
                                (scores.fear || 0) + (scores.disgust || 0);
      
        this.affectiveDimensions.valence = positiveEmotions - negativeEmotions;

        // Активация
        const highArousal = (scores.anger || 0) + (scores.fear || 0) + (scores.surprise || 0);
        const lowArousal = (scores.sadness || 0) + (scores.neutral || 0);
      
        this.affectiveDimensions.arousal = highArousal / (highArousal + lowArousal + 0.001);
    }

    /**
     * Генерация маски лица для FACS-анализа
     * 
     * @param {Array} landmarks
     * @returns {Object}
     */
    generateFaceMask(landmarks) {
        // Определяем зоны лица для FACS (Action Units)
        const faceMask = {
            timestamp: Date.now(),
            zones: {
                // Верхняя часть лица
                forehead: this.extractZone(landmarks, [10, 338, 297, 332, 284, 251, 389, 356, 454]),
                leftEyebrow: this.extractZone(landmarks, [70, 63, 105, 66, 107]),
                rightEyebrow: this.extractZone(landmarks, [300, 293, 334, 296, 336]),
              
                // Средняя часть лица
                leftEye: this.extractZone(landmarks, [33, 160, 158, 133, 153, 144, 145, 159]),
                rightEye: this.extractZone(landmarks, [362, 385, 387, 263, 373, 380, 374, 386]),
                nose: this.extractZone(landmarks, [1, 2, 98, 327, 168, 6, 197, 195, 5]),
              
                // Нижняя часть лица
                upperLip: this.extractZone(landmarks, [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]),
                lowerLip: this.extractZone(landmarks, [146, 91, 181, 84, 17, 314, 405, 321, 375]),
                leftCheek: this.extractZone(landmarks, [116, 111, 117, 118, 119, 100, 47, 126]),
                rightCheek: this.extractZone(landmarks, [345, 340, 346, 347, 348, 329, 277, 355]),
                jaw: this.extractZone(landmarks, [172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, 389])
            },
          
            // Симметрия лица
            symmetry: this.calculateFaceSymmetry(landmarks)
        };

        return faceMask;
    }

    // Извлечение координат зоны лица
    extractZone(landmarks, indices) {
        return indices.map(idx => ({
            x: landmarks[idx].x,
            y: landmarks[idx].y,
            z: landmarks[idx].z || 0
        }));
    }

    // Вычисление симметрии лица
    calculateFaceSymmetry(landmarks) {
        // Центральная ось лица
        const noseTip = landmarks[1];
        const chin = landmarks[152];
      
        // Парные точки для сравнения
        const pairs = [
            [33, 263],    // Внутренние уголки глаз
            [61, 291],    // Уголки рта
            [234, 454],   // Скулы
            [127, 356]    // Челюсть
        ];

        let asymmetryScore = 0;
        for (let [leftIdx, rightIdx] of pairs) {
            const leftPoint = landmarks[leftIdx];
            const rightPoint = landmarks[rightIdx];
          
            // Расстояние от центральной оси
            const leftDist = Math.abs(leftPoint.x - noseTip.x);
            const rightDist = Math.abs(rightPoint.x - noseTip.x);
          
            // Разница в высоте
            const heightDiff = Math.abs(leftPoint.y - rightPoint.y);
          
            asymmetryScore += Math.abs(leftDist - rightDist) + heightDiff;
        }

        // Нормализация
        return Math.min(1.0, asymmetryScore / pairs.length);
    }

    // Запись события эмоции в буфер
    recordEmotionEvent(scores, status) {
        const event = {
            type: 'emotion',
            timestamp: Date.now(),
            status: status,
          
            // Raw scores для всех эмоций
            scores: scores || this.getDefaultScores(),
          
            // Аффективные измерения
            affective: {
                valence: this.affectiveDimensions.valence,
                arousal: this.affectiveDimensions.arousal
            },
          
            // Доминирующая эмоция
            dominant: scores ? this.getDominantEmotion(scores) : 'unknown',
          
            // Маска лица
            faceMask: this.faceMask ? {
                symmetry: this.faceMask.symmetry,
                zonesCount: Object.keys(this.faceMask.zones).length
            } : null
        };

        this.emotionEvents.push(event);

        // Ограничение размер буфера
        if (this.emotionEvents.length > 1000) {
            this.emotionEvents.shift();
        }

        // Отправка событий в глобальный обработчик
        if (window.sessionLogger) {
            window.sessionLogger.logEvent(event);
        }
    }

    // Получение доминирующей эмоции
    getDominantEmotion(scores) {
        let maxScore = 0;
        let dominant = 'neutral';
      
        for (let emotion in scores) {
            if (scores[emotion] > maxScore) {
                maxScore = scores[emotion];
                dominant = emotion;
            }
        }
      
        return maxScore > this.config.confidenceThreshold ? dominant : 'neutral';
    }

    // Дефолтные скоры
    getDefaultScores() {
        const scores = {};
        for (let emotion of this.emotionLabels) {
            scores[emotion] = emotion === 'neutral' ? 1.0 : 0.0;
        }
        return scores;
    }

    // Получение записанных событий
    getEvents() {
        return this.emotionEvents;
    }

    // Получение агрегированных метрик
    getAggregatedMetrics() {
        if (this.emotionEvents.length === 0) {
            return null;
        }

        // Фильтр успешных событий
        const validEvents = this.emotionEvents.filter(e => e.status === 'success');

        if (validEvents.length === 0) {
            return null;
        }

        // Агрегаты
        const metrics = {
            // Средние скоры по эмоциям
            meanScores: {},
          
            // Максимальные скоры
            maxScores: {},
          
            // Время выше порога для каждой эмоции
            timeAboveThreshold: {},
          
            // Вариативность
            variability: {},
            
            // Средние аффективные измерения
            meanValence: 0,
            meanArousal: 0,
          
            // Доминирующая эмоция за всю сессию
            dominantEmotion: '',
          
            // Процент времени с валидными данными
            validDataPct: (validEvents.length / this.emotionEvents.length) * 100
        };

        // Инициализация счетчика
        for (let emotion of this.emotionLabels) {
            metrics.meanScores[emotion] = 0;
            metrics.maxScores[emotion] = 0;
            metrics.timeAboveThreshold[emotion] = 0;
            metrics.variability[emotion] = [];
        }

        // Проход по всем событиям
        for (let event of validEvents) {
            for (let emotion of this.emotionLabels) {
                const score = event.scores[emotion] || 0;
              
                metrics.meanScores[emotion] += score;
                metrics.maxScores[emotion] = Math.max(metrics.maxScores[emotion], score);
                metrics.variability[emotion].push(score);
              
                if (score > this.config.confidenceThreshold) {
                    metrics.timeAboveThreshold[emotion] += 1 / this.config.fps; // секунды
                }
            }
          
            metrics.meanValence += event.affective.valence;
            metrics.meanArousal += event.affective.arousal;
        }

        // Усреднение
        const count = validEvents.length;
        for (let emotion of this.emotionLabels) {
            metrics.meanScores[emotion] /= count;
          
            // Вычисление стандартного отклонения
            const values = metrics.variability[emotion];
            const mean = metrics.meanScores[emotion];
            const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count;
            metrics.variability[emotion] = Math.sqrt(variance);
        }

        metrics.meanValence /= count;
        metrics.meanArousal /= count;

        // Доминирующия эмоция
        let maxMean = 0;
        for (let emotion of this.emotionLabels) {
            if (metrics.meanScores[emotion] > maxMean) {
                maxMean = metrics.meanScores[emotion];
                metrics.dominantEmotion = emotion;
            }
        }

        return metrics;
    }

    // Экспорт данных в JSON
    exportToJSON() {
        return {
            metadata: {
                version: '1.0',
                emotionLabels: this.emotionLabels,
                fps: this.config.fps,
                totalEvents: this.emotionEvents.length,
                exportTime: new Date().toISOString()
            },
            events: this.emotionEvents,
            aggregatedMetrics: this.getAggregatedMetrics()
        };
    }

    // Очистка данных
    clear() {
        this.emotionEvents = [];
        this.smoothingBuffer = [];
        this.faceMask = null;
        this.affectiveDimensions = { valence: 0, arousal: 0 };
        console.log('[EmotionAnalyzer] Данные очищены');
    }
}

// Экспорт для использования в других модулях
window.EmotionAnalyzer = EmotionAnalyzer;

console.log('[EmotionAnalyzer] Модуль загружен');
