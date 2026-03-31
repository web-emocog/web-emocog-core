/**
 * Улучшенный EmotionAnalyzer с использованием FACS (Facial Action Coding System)
 * для более точного распознавания эмоций на основе геометрии лица
 */
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

        // Аффективные измерения
        this.affectiveDimensions = {
            valence: 0,
            arousal: 0
        };

        // Буфер событий эмоций
        this.emotionEvents = [];

        // Конфигурация
        this.config = {
            fps: 10,
            confidenceThreshold: 0.4,
            smoothingWindow: 5,
            recordRawScores: true,
            // Новые параметры для улучшенной классификации
            useActionUnits: true,
            useTemporalContext: true,
            temporalWindowSize: 10
        };

        // Состояние
        this.isRunning = false;
        this.lastAnalysisTime = 0;
        this.smoothingBuffer = [];
        this.temporalBuffer = [];
        this.faceLandmarker = null;
        this.emotionSession = null;
        this.faceMask = null;
        
        // Новые метрики для расширенного анализа
        this.emotionCategories = {
            positive: ['happiness', 'surprise'],
            neutral: ['neutral'],
            negative: ['sadness', 'anger', 'fear', 'disgust']
        };
        
        // Счетчики для категорий эмоций
        this.emotionCategoryCounts = {
            positive: 0,
            neutral: 0,
            negative: 0,
            total: 0
        };

        console.log('[EmotionAnalyzer] Инициализирован с улучшенным FACS-анализом');
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
                console.warn('[EmotionAnalyzer] ONNX Runtime не загружен, используем FACS-модель');
                this.useFACSModel();
                return;
            }

            const modelPath = 'js/models/emotion-model.onnx';
          
            this.emotionSession = await ort.InferenceSession.create(modelPath, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });

            console.log('[EmotionAnalyzer] ONNX модель загружена');
        } catch (error) {
            console.warn('[EmotionAnalyzer] Не удалось загрузить ONNX модель, используем FACS-модель:', error);
            this.useFACSModel();
        }
    }

    useFACSModel() {
        console.log('[EmotionAnalyzer] Используется улучшенная FACS-модель на основе Action Units');
        this.emotionSession = 'facs';
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
        
        // Сброс счетчиков категорий
        this.resetEmotionCategoryCounts();

        console.log('[EmotionAnalyzer] ▶️ Запущен (режим: внешние landmarks + FACS)');
    }

    stop() {
        this.isRunning = false;
        console.log('[EmotionAnalyzer] ⏸️ Остановлен');
    }

    /**
     * Обрабатывает landmarks, полученные извне (из основного цикла анализа)
     * @param {Array} landmarks - массив landmarks одного лица
     */
    processLandmarks(landmarks) {
        if (!this.isRunning || !landmarks || !Array.isArray(landmarks) || landmarks.length === 0) {
            this.recordEmotionEvent(null, 'no_landmarks');
            return;
        }

        try {
            // Генерируем маску лица и извлекаем Action Units
            const { faceMask, actionUnits } = this.extractFacialFeatures(landmarks);
            this.faceMask = faceMask;

            // Анализ эмоций на основе Action Units и геометрии лица
            const emotionScores = this.analyzeEmotionWithFACS(landmarks, actionUnits);

            // Добавляем в буфер для временного контекста
            this.addToTemporalBuffer(emotionScores);
            
            // Сглаживание с учетом временного контекста
            const smoothedScores = this.smoothEmotionScores(emotionScores);
            
            // Обновляем аффективные измерения
            const affectiveDimensions = this.calculateAffectiveDimensions(smoothedScores);
            this.affectiveDimensions = affectiveDimensions;
            
            // Определяем доминирующую эмоцию
            const dominantEmotion = this.getDominantEmotion(smoothedScores);
            
            // Обновляем счетчики категорий эмоций
            this.updateEmotionCategoryCount(dominantEmotion);

            // Запись события
            this.recordEmotionEvent({
                scores: smoothedScores,
                actionUnits: actionUnits,
                affective: affectiveDimensions,
                dominant: dominantEmotion,
                faceMask: {
                    symmetry: faceMask.symmetry,
                    zonesCount: Object.keys(faceMask.zones).length
                }
            }, 'success');

        } catch (error) {
            console.error('[EmotionAnalyzer] Ошибка обработки landmarks:', error);
            this.recordEmotionEvent(null, 'error');
        }
    }

    /**
     * Извлечение лицевых особенностей и Action Units из landmarks
     * @param {Array} landmarks - 478 точек лица от MediaPipe
     * @returns {Object} Маска лица и Action Units
     */
    extractFacialFeatures(landmarks) {
        // Генерируем маску лица с зонами
        const faceMask = this.generateFaceMask(landmarks);
        
        // Извлекаем Action Units по FACS
        const actionUnits = this.extractActionUnits(landmarks);
        
        return { faceMask, actionUnits };
    }

    /**
     * Извлечение Action Units (AU) по FACS
     * @param {Array} landmarks - 478 точек лица от MediaPipe
     * @returns {Object} Значения Action Units
     */
    extractActionUnits(landmarks) {
        // Ключевые точки для вычисления AU
        const leftEyeTop = landmarks[159];
        const leftEyeBottom = landmarks[145];
        const rightEyeTop = landmarks[386];
        const rightEyeBottom = landmarks[374];
        const leftMouth = landmarks[61];
        const rightMouth = landmarks[291];
        const topLip = landmarks[13];
        const bottomLip = landmarks[14];
        const noseTip = landmarks[1];
        const leftEyebrowOuter = landmarks[70];
        const leftEyebrowInner = landmarks[107];
        const rightEyebrowOuter = landmarks[300];
        const rightEyebrowInner = landmarks[336];
        const leftCheek = landmarks[117];
        const rightCheek = landmarks[346];
        const upperLipCenter = landmarks[0];
        const lowerLipCenter = landmarks[17];
        const leftNostril = landmarks[203];
        const rightNostril = landmarks[423];
        const chin = landmarks[152];
        const foreheadCenter = landmarks[10];

        // Вычисление нормализующего фактора для масштабирования
        const faceHeight = this.calculateDistance(foreheadCenter, chin);
        const faceWidth = this.calculateDistance(landmarks[234], landmarks[454]);
        const normFactor = Math.sqrt(faceHeight * faceHeight + faceWidth * faceWidth);

        // AU1: Внутренний подъем брови
        const leftBrowRaise = (noseTip.y - leftEyebrowInner.y) / normFactor;
        const rightBrowRaise = (noseTip.y - rightEyebrowInner.y) / normFactor;
        const au1 = Math.min(1.0, (leftBrowRaise + rightBrowRaise) * 5);

        // AU2: Внешний подъем брови
        const leftOuterBrowRaise = (noseTip.y - leftEyebrowOuter.y) / normFactor;
        const rightOuterBrowRaise = (noseTip.y - rightEyebrowOuter.y) / normFactor;
        const au2 = Math.min(1.0, (leftOuterBrowRaise + rightOuterBrowRaise) * 5);

        // AU4: Сведение бровей
        const browDistance = this.calculateDistance(leftEyebrowInner, rightEyebrowInner);
        const normalizedBrowDistance = browDistance / faceWidth;
        const au4 = Math.min(1.0, Math.max(0, 0.5 - normalizedBrowDistance * 3));

        // AU5: Поднятие верхнего века
        const leftEyeOpenness = this.calculateDistance(leftEyeTop, leftEyeBottom) / normFactor;
        const rightEyeOpenness = this.calculateDistance(rightEyeTop, rightEyeBottom) / normFactor;
        const au5 = Math.min(1.0, (leftEyeOpenness + rightEyeOpenness) * 15);

        // AU6: Поднятие щек (улыбка глазами)
        const leftCheekRaise = (leftCheek.y - leftEyeBottom.y) / normFactor;
        const rightCheekRaise = (rightCheek.y - rightEyeBottom.y) / normFactor;
        const au6 = Math.min(1.0, Math.max(0, 0.2 - (leftCheekRaise + rightCheekRaise) * 2));

        // AU7: Сужение век
        const au7 = Math.min(1.0, Math.max(0, 0.05 - (leftEyeOpenness + rightEyeOpenness) * 0.5) * 10);

        // AU9: Сморщивание носа
        const nostrilDistance = this.calculateDistance(leftNostril, rightNostril) / normFactor;
        const au9 = Math.min(1.0, Math.max(0, 0.15 - nostrilDistance * 3));

        // AU10: Поднятие верхней губы
        const upperLipRaise = (noseTip.y - upperLipCenter.y) / normFactor;
        const au10 = Math.min(1.0, Math.max(0, 0.1 - upperLipRaise) * 10);

        // AU12: Растяжение уголков губ (улыбка)
        const mouthWidth = this.calculateDistance(leftMouth, rightMouth) / faceWidth;
        const au12 = Math.min(1.0, Math.max(0, mouthWidth - 0.4) * 5);

        // AU15: Опускание уголков губ
        const mouthCornerHeight = ((leftMouth.y + rightMouth.y) / 2 - upperLipCenter.y) / normFactor;
        const au15 = Math.min(1.0, Math.max(0, mouthCornerHeight - 0.02) * 10);

        // AU17: Поднятие подбородка
        const chinRaise = (lowerLipCenter.y - chin.y) / normFactor;
        const au17 = Math.min(1.0, Math.max(0, 0.1 - chinRaise) * 10);

        // AU20: Растяжение губ по горизонтали
        const au20 = Math.min(1.0, Math.max(0, mouthWidth - 0.35) * 4);

        // AU23: Сжатие губ
        const lipTightness = this.calculateDistance(upperLipCenter, lowerLipCenter) / normFactor;
        const au23 = Math.min(1.0, Math.max(0, 0.05 - lipTightness) * 15);

        // AU25: Разделение губ
        const mouthOpen = this.calculateDistance(topLip, bottomLip) / normFactor;
        const au25 = Math.min(1.0, mouthOpen * 20);

        // AU26: Отвисание челюсти
        const jawDrop = this.calculateDistance(upperLipCenter, lowerLipCenter) / normFactor;
        const au26 = Math.min(1.0, Math.max(0, jawDrop - 0.03) * 10);

        // AU27: Широкое открытие рта
        const au27 = Math.min(1.0, Math.max(0, mouthOpen - 0.1) * 5);

        return {
            AU1: au1,  // Внутренний подъем брови
            AU2: au2,  // Внешний подъем брови
            AU4: au4,  // Сведение бровей
            AU5: au5,  // Поднятие верхнего века
            AU6: au6,  // Поднятие щек
            AU7: au7,  // Сужение век
            AU9: au9,  // Сморщивание носа
            AU10: au10, // Поднятие верхней губы
            AU12: au12, // Растяжение уголков губ (улыбка)
            AU15: au15, // Опускание уголков губ
            AU17: au17, // Поднятие подбородка
            AU20: au20, // Растяжение губ по горизонтали
            AU23: au23, // Сжатие губ
            AU25: au25, // Разделение губ
            AU26: au26, // Отвисание челюсти
            AU27: au27  // Широкое открытие рта
        };
    }

    /**
     * Анализ эмоций на основе FACS Action Units
     * @param {Array} landmarks - 478 точек лица от MediaPipe
     * @param {Object} actionUnits - Значения Action Units
     * @returns {Object} Scores для каждой эмоции
     */
    analyzeEmotionWithFACS(landmarks, actionUnits) {
        const scores = {
            neutral: 0.3,  // Базовый уровень нейтральности
            happiness: 0,
            sadness: 0,
            anger: 0,
            fear: 0,
            surprise: 0,
            disgust: 0
        };

        // Счастье: AU6 (поднятие щек) + AU12 (растяжение уголков губ)
        if (actionUnits.AU12 > 0.2) {
            scores.happiness = Math.min(1.0, actionUnits.AU12 * 0.8 + actionUnits.AU6 * 0.4);
            scores.neutral = Math.max(0, scores.neutral - scores.happiness * 0.7);
        }

        // Грусть: AU1 (внутренний подъем брови) + AU15 (опускание уголков губ) + AU17 (поднятие подбородка)
        if (actionUnits.AU1 > 0.2 && actionUnits.AU15 > 0.1) {
            scores.sadness = Math.min(0.9, actionUnits.AU1 * 0.3 + actionUnits.AU15 * 0.6 + actionUnits.AU17 * 0.3);
            scores.neutral = Math.max(0, scores.neutral - scores.sadness * 0.6);
        }

        // Гнев: AU4 (сведение бровей) + AU7 (сужение век) + AU23 (сжатие губ)
        if (actionUnits.AU4 > 0.2) {
            scores.anger = Math.min(0.9, actionUnits.AU4 * 0.7 + actionUnits.AU7 * 0.4 + actionUnits.AU23 * 0.3);
            scores.neutral = Math.max(0, scores.neutral - scores.anger * 0.7);
        }

        // Страх: AU1 (внутренний подъем брови) + AU2 (внешний подъем брови) + AU4 (сведение бровей) + AU5 (поднятие века) + AU20 (растяжение губ)
        if (actionUnits.AU5 > 0.3 && (actionUnits.AU1 > 0.2 || actionUnits.AU2 > 0.2)) {
            scores.fear = Math.min(0.8, actionUnits.AU1 * 0.3 + actionUnits.AU2 * 0.3 + actionUnits.AU4 * 0.2 + actionUnits.AU5 * 0.4 + actionUnits.AU20 * 0.2);
            scores.neutral = Math.max(0, scores.neutral - scores.fear * 0.6);
        }

        // Удивление: AU1 (внутренний подъем брови) + AU2 (внешний подъем брови) + AU5 (поднятие века) + AU26 (отвисание челюсти)
        if (actionUnits.AU5 > 0.4 && actionUnits.AU26 > 0.2) {
            scores.surprise = Math.min(1.0, actionUnits.AU1 * 0.3 + actionUnits.AU2 * 0.3 + actionUnits.AU5 * 0.5 + actionUnits.AU26 * 0.5);
            scores.neutral = Math.max(0, scores.neutral - scores.surprise * 0.8);
        }

        // Отвращение: AU9 (сморщивание носа) + AU10 (поднятие верхней губы) + AU15 (опускание уголков губ)
        if (actionUnits.AU9 > 0.2 || actionUnits.AU10 > 0.3) {
            scores.disgust = Math.min(0.8, actionUnits.AU9 * 0.7 + actionUnits.AU10 * 0.5 + actionUnits.AU15 * 0.2);
            scores.neutral = Math.max(0, scores.neutral - scores.disgust * 0.7);
        }

        // Учет дополнительных комбинаций AU для уточнения эмоций
        
        // Смешанная радость-удивление
        if (actionUnits.AU12 > 0.3 && actionUnits.AU5 > 0.3) {
            const mixScore = Math.min(0.7, actionUnits.AU12 * 0.5 + actionUnits.AU5 * 0.3);
            scores.happiness += mixScore * 0.6;
            scores.surprise += mixScore * 0.4;
            scores.neutral = Math.max(0, scores.neutral - mixScore * 0.5);
        }
        
        // Смешанный страх-удивление
        if (actionUnits.AU5 > 0.4 && actionUnits.AU1 > 0.3 && actionUnits.AU4 > 0.2) {
            const mixScore = Math.min(0.7, actionUnits.AU5 * 0.4 + actionUnits.AU1 * 0.3 + actionUnits.AU4 * 0.3);
            scores.fear += mixScore * 0.5;
            scores.surprise += mixScore * 0.5;
            scores.neutral = Math.max(0, scores.neutral - mixScore * 0.5);
        }
        
        // Смешанный гнев-отвращение
        if (actionUnits.AU4 > 0.3 && actionUnits.AU9 > 0.2) {
            const mixScore = Math.min(0.7, actionUnits.AU4 * 0.5 + actionUnits.AU9 * 0.5);
            scores.anger += mixScore * 0.5;
            scores.disgust += mixScore * 0.5;
            scores.neutral = Math.max(0, scores.neutral - mixScore * 0.5);
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

    /**
     * Добавляет скоры эмоций в буфер для временного контекста
     * @param {Object} scores - Скоры эмоций
     */
    addToTemporalBuffer(scores) {
        this.temporalBuffer.push({
            scores: scores,
            timestamp: Date.now()
        });
        
        // Ограничиваем размер буфера
        if (this.temporalBuffer.length > this.config.temporalWindowSize) {
            this.temporalBuffer.shift();
        }
    }

    /**
     * Сглаживание скоров эмоций с учетом временного контекста
     * @param {Object} currentScores - Текущие скоры эмоций
     * @returns {Object} Сглаженные скоры
     */
    smoothEmotionScores(currentScores) {
        // Добавляем текущие скоры в буфер сглаживания
        this.smoothingBuffer.push(currentScores);
        
        // Ограничиваем размер буфера
        if (this.smoothingBuffer.length > this.config.smoothingWindow) {
            this.smoothingBuffer.shift();
        }
        
        // Если включен временной контекст и есть достаточно данных
        if (this.config.useTemporalContext && this.temporalBuffer.length >= 3) {
            // Находим тренды изменения эмоций
            const trends = this.calculateEmotionTrends();
            
            // Базовое сглаживание
            const smoothed = this.basicSmoothing();
            
            // Применяем тренды для коррекции сглаженных значений
            for (let emotion of this.emotionLabels) {
                if (trends[emotion] > 0.1) {
                    // Усиливаем растущие эмоции
                    smoothed[emotion] = Math.min(1.0, smoothed[emotion] * (1 + trends[emotion] * 0.2));
                } else if (trends[emotion] < -0.1) {
                    // Ослабляем убывающие эмоции
                    smoothed[emotion] = Math.max(0, smoothed[emotion] * (1 + trends[emotion] * 0.1));
                }
            }
            
            // Повторная нормализация
            const total = Object.values(smoothed).reduce((sum, val) => sum + val, 0);
            if (total > 0) {
                for (let emotion in smoothed) {
                    smoothed[emotion] = smoothed[emotion] / total;
                }
            }
            
            return smoothed;
        } else {
            // Простое сглаживание без временного контекста
            return this.basicSmoothing();
        }
    }
    
    /**
     * Базовое сглаживание скоров эмоций
     * @returns {Object} Сглаженные скоры
     */
    basicSmoothing() {
        const smoothed = {};
        
        for (let emotion of this.emotionLabels) {
            // Взвешенное среднее с большим весом для недавних значений
            let weightedSum = 0;
            let weightSum = 0;
            
            for (let i = 0; i < this.smoothingBuffer.length; i++) {
                const weight = (i + 1); // Более новые значения имеют больший вес
                weightedSum += (this.smoothingBuffer[i][emotion] || 0) * weight;
                weightSum += weight;
            }
            
            smoothed[emotion] = weightSum > 0 ? weightedSum / weightSum : 0;
        }
        
        return smoothed;
    }
    
    /**
     * Вычисляет тренды изменения эмоций
     * @returns {Object} Тренды для каждой эмоции (-1 до 1)
     */
    calculateEmotionTrends() {
        const trends = {};
        
        if (this.temporalBuffer.length < 3) {
            // Недостаточно данных для расчета тренда
            for (let emotion of this.emotionLabels) {
                trends[emotion] = 0;
            }
            return trends;
        }
        
        // Берем последние 3 точки для линейного тренда
        const recent = this.temporalBuffer.slice(-3);
        
        for (let emotion of this.emotionLabels) {
            const values = recent.map(item => item.scores[emotion] || 0);
            
            // Простой линейный тренд
            const slope = (values[2] - values[0]) / 2;
            
            // Нормализуем до диапазона -1..1
            trends[emotion] = Math.max(-1, Math.min(1, slope * 5));
        }
        
        return trends;
    }

    /**
     * Вычисляет аффективные измерения (валентность и активация)
     * @param {Object} scores - Скоры эмоций
     * @returns {Object} Аффективные измерения
     */
    calculateAffectiveDimensions(scores) {
        // Валентность (приятность-неприятность)
        // Положительные эмоции: счастье, частично удивление
        // Отрицательные эмоции: грусть, гнев, страх, отвращение
        const positiveValence = scores.happiness + scores.surprise * 0.3;
        const negativeValence = scores.sadness * 0.7 + scores.anger * 0.9 + 
                               scores.fear * 0.8 + scores.disgust * 0.9;
        
        // Валентность от -1 (крайне неприятно) до 1 (крайне приятно)
        const valence = Math.max(-1, Math.min(1, positiveValence - negativeValence));
        
        // Активация (возбуждение-спокойствие)
        // Высокая активация: гнев, страх, удивление, счастье (частично)
        // Низкая активация: грусть, нейтральность
        const highArousal = scores.anger * 0.9 + scores.fear * 0.8 + 
                           scores.surprise * 0.8 + scores.happiness * 0.5;
        const lowArousal = scores.sadness * 0.7 + scores.neutral * 0.9 + scores.disgust * 0.3;
        
        // Активация от 0 (полное спокойствие) до 1 (крайнее возбуждение)
        const arousal = Math.max(0, Math.min(1, highArousal / (highArousal + lowArousal + 0.001)));
        
        return {
            valence: valence,
            arousal: arousal
        };
    }

    /**
     * Сбрасывает счетчики категорий эмоций
     */
    resetEmotionCategoryCounts() {
        this.emotionCategoryCounts = {
            positive: 0,
            neutral: 0,
            negative: 0,
            total: 0
        };
    }
    
    /**
     * Обновляет счетчики категорий эмоций
     * @param {string} emotion - Распознанная эмоция
     */
    updateEmotionCategoryCount(emotion) {
        this.emotionCategoryCounts.total++;
        
        for (let category in this.emotionCategories) {
            if (this.emotionCategories[category].includes(emotion)) {
                this.emotionCategoryCounts[category]++;
                break;
            }
        }
    }

    /**
     * Генерация маски лица для FACS-анализа
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
            [127, 356],   // Челюсть
            [70, 300],    // Внешние брови
            [107, 336]    // Внутренние брови
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

    // Евклидово расстояние
    calculateDistance(point1, point2) {
        const dx = point1.x - point2.x;
        const dy = point1.y - point2.y;
        const dz = (point1.z || 0) - (point2.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
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

    // Запись события эмоции в буфер
    recordEmotionEvent(data, status) {
        const event = {
            type: 'emotion',
            timestamp: Date.now(),
            status: status
        };
        
        if (status === 'success' && data) {
            event.scores = data.scores;
            event.affective = data.affective || this.affectiveDimensions;
            event.dominant = data.dominant;
            event.faceMask = data.faceMask;
            
            if (data.actionUnits && this.config.recordRawScores) {
                event.actionUnits = data.actionUnits;
            }
        } else {
            event.scores = this.getDefaultScores();
            event.affective = this.affectiveDimensions;
            event.dominant = 'unknown';
        }

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

    /**
     * Получение агрегированных метрик
     * @returns {Object} Агрегированные метрики
     */
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
            valence_mean: 0,
            arousal_mean: 0,
            
            // Доли категорий эмоций
            emotionCategoryPct: {
                positive: 0,
                neutral: 0,
                negative: 0
            },
          
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
          
            metrics.valence_mean += event.affective.valence;
            metrics.arousal_mean += event.affective.arousal;
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

        metrics.valence_mean /= count;
        metrics.arousal_mean /= count;

        // Доминирующая эмоция
        let maxMean = 0;
        for (let emotion of this.emotionLabels) {
            if (metrics.meanScores[emotion] > maxMean) {
                maxMean = metrics.meanScores[emotion];
                metrics.dominantEmotion = emotion;
            }
        }
        
        // Доли категорий эмоций
        const total = this.emotionCategoryCounts.total || 1;
        metrics.emotionCategoryPct = {
            positive: this.emotionCategoryCounts.positive / total * 100,
            neutral: this.emotionCategoryCounts.neutral / total * 100,
            negative: this.emotionCategoryCounts.negative / total * 100
        };

        return metrics;
    }

    // Экспорт данных в JSON
    exportToJSON() {
        const metrics = this.getAggregatedMetrics();
        
        return {
            metadata: {
                version: '1.1',
                emotionLabels: this.emotionLabels,
                fps: this.config.fps,
                totalEvents: this.emotionEvents.length,
                exportTime: new Date().toISOString()
            },
            events: this.config.recordRawScores ? this.emotionEvents : 
                   this.emotionEvents.map(e => {
                       // Удаляем actionUnits для экономии места
                       const { actionUnits, ...rest } = e;
                       return rest;
                   }),
            aggregatedMetrics: metrics,
            summary: metrics ? {
                valence_mean: metrics.valence_mean,
                arousal_mean: metrics.arousal_mean,
                positive_pct: metrics.emotionCategoryPct.positive,
                neutral_pct: metrics.emotionCategoryPct.neutral,
                negative_pct: metrics.emotionCategoryPct.negative,
                dominant_emotion: metrics.dominantEmotion
            } : null
        };
    }

    // Очистка данных
    clear() {
        this.emotionEvents = [];
        this.smoothingBuffer = [];
        this.temporalBuffer = [];
        this.faceMask = null;
        this.affectiveDimensions = { valence: 0, arousal: 0 };
        this.resetEmotionCategoryCounts();
        console.log('[EmotionAnalyzer] Данные очищены');
    }
}

// Экспорт для использования в других модулях
window.EmotionAnalyzer = EmotionAnalyzer;

console.log('[EmotionAnalyzer] Улучшенный модуль с FACS загружен');