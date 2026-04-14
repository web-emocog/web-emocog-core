/**
 * Модуль Gaze Tracker v2.3.0 - обертка для браузера
 * 
 * Модуль оценки направления взгляда на основе landmarks радужки из MediaPipe Face Landmarker.
 * Использует ridge-регрессию для калибровки: признаки радужки → координаты экрана.
 * 
 * v2.3.0: Улучшена сетка калибровки (18 точек, включая центр), усреднение по 12 кадрам,
 *          сглаживание 0.10 для сбалансированного профиля задержки/стабильности,
 *          динамические задержки фиксации.
 * 
 * v2.2.0: Расширение до 17-мерного вектора признаков с терминами взаимодействия iris×head
 *          для лучшей точности в углах и по краям. Требуется 32+ точек калибровки
 *          (сетка 4×4 × 2 клика = 32, переопределенная система для 17 признаков).
 *          λ=0.001, smoothing=0.10, z-score стандартизация.
 * 
 * v2.1.1: 13-мерный вектор признаков, z-score стандартизация, addAveragedCalibrationPoint().
 * 
 * @version 2.3.0
 * @requires PrecheckAnalyzer (для получения landmarks)
 */

class GazeTracker {
    constructor(options = {}) {
        // Состояние
        this._isCalibrated = false;
        this._isTracking = false;
        
        // Параметры ridge-регрессии
        // λ=0.001: легкая регуляризация, достаточная при 32+ точках калибровки для 17 признаков
        this._ridgeLambda = options.ridgeLambda ?? 0.001;
        
        // Калибровочные данные
        this._calibrationData = []; // { features: [...], screenX, screenY }
        
        // Модель (веса ridge-регрессии)
        this._modelX = null; // веса для предсказания X
        this._modelY = null; // веса для предсказания Y
        
        // Стандартизация признаков (вычисляется во время калибровки)
        this._featureMean = null; // среднее по каждому признаку (d)
        this._featureStd = null;  // стандартное отклонение по каждому признаку (d)
        
        // Сглаживание предсказаний
        // Сбалансированный профиль: ниже инерция при сохранении устойчивости к шуму
        this._smoothingFactor = options.smoothingFactor ?? 0.10;
        this._lastPrediction = null;

        // Посткалибровочная 2D-аффинная коррекция (по данным валидации)
        // Формат: x' = a*x + b*y + c; y' = d*x + e*y + f
        this._postCalibrationCorrection = null;
        
        // Размеры экрана
        this._screenW = options.screenWidth || window.innerWidth;
        this._screenH = options.screenHeight || window.innerHeight;
        
        // Индексы landmarks (MediaPipe Face Landmarker)
        this.LANDMARKS = {
            LEFT_IRIS: [468, 469, 470, 471, 472],
            RIGHT_IRIS: [473, 474, 475, 476, 477],
            LEFT_IRIS_CENTER: 468,
            RIGHT_IRIS_CENTER: 473,
            // Углы глаз для нормализации
            LEFT_EYE_INNER: 362,
            LEFT_EYE_OUTER: 263,
            LEFT_EYE_TOP: 386,
            LEFT_EYE_BOTTOM: 374,
            RIGHT_EYE_INNER: 133,
            RIGHT_EYE_OUTER: 33,
            RIGHT_EYE_TOP: 159,
            RIGHT_EYE_BOTTOM: 145,
            // Опорные точки лица для нормализации позы
            NOSE_TIP: 1,
            LEFT_EAR: 234,
            RIGHT_EAR: 454,
            FOREHEAD: 10,
            CHIN: 152
        };
        
        // Статистика
        this._stats = {
            totalPredictions: 0,
            calibrationPoints: 0,
            lastCalibrationTime: null,
            avgFeatureExtractionMs: 0
        };
        
        // Обработчики обратного вызова
        this.onGazeUpdate = options.onGazeUpdate || null;
        this.onCalibrationComplete = options.onCalibrationComplete || null;
        
        console.log('[GazeTracker] v2.3.0 создан (λ=' + this._ridgeLambda + ', smooth=' + this._smoothingFactor + ')');
    }
    
    // ========================================================================
    // ПУБЛИЧНЫЙ ИНТЕРФЕЙС
    // ========================================================================
    
    /**
     * Добавляет калибровочную точку.
     * Вызывается когда пользователь смотрит на известную позицию экрана.
     * @param {Array} landmarks - 478 landmarks из FaceLandmarker
     * @param {number} screenX - X координата точки на экране (px)
     * @param {number} screenY - Y координата точки на экране (px)
     * @returns {boolean} успешно ли добавлена
     */
    addCalibrationPoint(landmarks, screenX, screenY) {
        if (!landmarks || landmarks.length < 478) {
            console.warn('[GazeTracker] Недостаточно landmarks для калибровки');
            return false;
        }
        
        const features = this._extractFeatures(landmarks);
        if (!features) return false;
        
        this._calibrationData.push({
            features: features,
            screenX: screenX,
            screenY: screenY,
            timestamp: Date.now()
        });
        
        this._stats.calibrationPoints = this._calibrationData.length;
        return true;
    }
    
    /**
     * Добавляет калибровочную точку из предусреднённых фич нескольких фреймов.
     * Это предпочтительный метод — снижает шум детекции радужки.
     * 
     * @param {Array<Array>} landmarksArray - массив landmarks из нескольких фреймов
     * @param {number} screenX - X координата точки на экране (px)
     * @param {number} screenY - Y координата точки на экране (px)
     * @returns {boolean} успешно ли добавлена
     */
    addAveragedCalibrationPoint(landmarksArray, screenX, screenY) {
        if (!landmarksArray || landmarksArray.length === 0) {
            console.warn('[GazeTracker] Пустой массив landmarks для усреднения');
            return false;
        }
        
        // Извлекаем признаки из каждого кадра
        const allFeatures = [];
        for (const landmarks of landmarksArray) {
            if (!landmarks || landmarks.length < 478) continue;
            const features = this._extractFeatures(landmarks);
            if (features) allFeatures.push(features);
        }
        
        if (allFeatures.length === 0) {
            console.warn('[GazeTracker] Ни один фрейм не дал валидных фич');
            return false;
        }
        
        // Поэлементно усредняем признаки
        const d = allFeatures[0].length;
        const avgFeatures = new Array(d).fill(0);
        for (const f of allFeatures) {
            for (let j = 0; j < d; j++) {
                avgFeatures[j] += f[j];
            }
        }
        for (let j = 0; j < d; j++) {
            avgFeatures[j] /= allFeatures.length;
        }
        // Восстанавливаем bias строго в 1.0 (после усреднения мог сместиться)
        avgFeatures[d - 1] = 1.0;
        
        this._calibrationData.push({
            features: avgFeatures,
            screenX: screenX,
            screenY: screenY,
            timestamp: Date.now()
        });
        
        this._stats.calibrationPoints = this._calibrationData.length;
        console.log(`[GazeTracker] Усреднённая точка (${screenX.toFixed(0)}, ${screenY.toFixed(0)}) из ${allFeatures.length}/${landmarksArray.length} фреймов`);
        return true;
    }
    
    /**
     * Обучает модель на собранных калибровочных данных.
     * 
     * Конвейер:
     * 1. Собрать сырые признаки из калибровочных точек
     * 2. Вычислить среднее и std по каждому признаку (z-score стандартизация)
     * 3. Стандартизовать признаки: z = (x - mean) / std
     * 4. Добавить столбец bias (=1) ПОСЛЕ стандартизации
     * 5. Обучить ridge-регрессию на стандартизованных признаках
     * 
     * На этапе предсказания применяется та же стандартизация до скалярного произведения.
     * 
     * Требуется минимум 4 точки (рекомендуется 9+).
     * @returns {boolean} успешна ли калибровка
     */
    calibrate() {
        const n = this._calibrationData.length;
        if (n < 4) {
            console.warn(`[GazeTracker] Недостаточно точек для калибровки: ${n}/4`);
            return false;
        }
        
        try {
            // Сырые признаки (без bias: это последний элемент, его убираем)
            const rawFeatures = this._calibrationData.map(d => d.features);
            const d = rawFeatures[0].length; // включает bias в конце
            const dNoBias = d - 1;
            
            // 1. Вычисляем среднее и std по каждому признаку (без столбца bias)
            this._featureMean = new Array(dNoBias).fill(0);
            this._featureStd = new Array(dNoBias).fill(0);
            
            for (let j = 0; j < dNoBias; j++) {
                let sum = 0;
                for (let i = 0; i < n; i++) sum += rawFeatures[i][j];
                this._featureMean[j] = sum / n;
            }
            
            for (let j = 0; j < dNoBias; j++) {
                let sumSq = 0;
                for (let i = 0; i < n; i++) {
                    const diff = rawFeatures[i][j] - this._featureMean[j];
                    sumSq += diff * diff;
                }
                const std = Math.sqrt(sumSq / n);
                // Защита: если признак постоянный, ставим std=1, чтобы избежать деления на ноль
                this._featureStd[j] = std > 1e-8 ? std : 1.0;
            }
            
            console.log('[GazeTracker] Feature stats:', {
                mean: this._featureMean.map(v => v.toFixed(4)),
                std: this._featureStd.map(v => v.toFixed(4))
            });
            
            // 2. Стандартизуем признаки и добавляем bias
            const X = rawFeatures.map(f => {
                const z = new Array(dNoBias + 1); // +1 под bias
                for (let j = 0; j < dNoBias; j++) {
                    z[j] = (f[j] - this._featureMean[j]) / this._featureStd[j];
                }
                z[dNoBias] = 1.0; // bias после стандартизации
                return z;
            });
            
            const Yx = this._calibrationData.map(d => d.screenX);
            const Yy = this._calibrationData.map(d => d.screenY);
            
            // 3. Ridge-регрессия на стандартизованных признаках
            this._modelX = this._ridgeRegression(X, Yx, this._ridgeLambda);
            this._modelY = this._ridgeRegression(X, Yy, this._ridgeLambda);
            
            this._isCalibrated = true;
            this._stats.lastCalibrationTime = Date.now();
            this._lastPrediction = null;
            this._postCalibrationCorrection = null; // Сбрасываем старую коррекцию после новой калибровки
            
            // Диагностика: считаем остатки на обучающей выборке
            let trainErrorX = 0, trainErrorY = 0;
            for (let i = 0; i < n; i++) {
                const predX = this._dotProduct(X[i], this._modelX);
                const predY = this._dotProduct(X[i], this._modelY);
                trainErrorX += Math.abs(predX - Yx[i]);
                trainErrorY += Math.abs(predY - Yy[i]);
            }
            trainErrorX /= n;
            trainErrorY /= n;
            
            console.log(`[GazeTracker] Калибровка завершена (${n} точек), train MAE: X=${trainErrorX.toFixed(1)}px, Y=${trainErrorY.toFixed(1)}px`);
            console.log('[GazeTracker] Model weights X:', this._modelX.map(w => w.toFixed(2)));
            console.log('[GazeTracker] Model weights Y:', this._modelY.map(w => w.toFixed(2)));
            
            if (this.onCalibrationComplete) {
                this.onCalibrationComplete({ points: n, timestamp: Date.now(), trainMAE: { x: trainErrorX, y: trainErrorY } });
            }
            
            return true;
        } catch (e) {
            console.error('[GazeTracker] Ошибка калибровки:', e);
            return false;
        }
    }

    /**
     * Устанавливает посткалибровочную аффинную коррекцию (обычно после валидации взгляда).
     * @param {{matrixX:number[], matrixY:number[], source?:string}} correction
     * @returns {boolean}
     */
    setPostCalibrationCorrection(correction) {
        const matrixX = correction?.matrixX;
        const matrixY = correction?.matrixY;
        const valid = Array.isArray(matrixX) && matrixX.length === 3 &&
            Array.isArray(matrixY) && matrixY.length === 3 &&
            matrixX.every(Number.isFinite) && matrixY.every(Number.isFinite);
        if (!valid) {
            console.warn('[GazeTracker] Некорректная посткалибровочная коррекция');
            return false;
        }

        this._postCalibrationCorrection = {
            matrixX: [...matrixX],
            matrixY: [...matrixY],
            source: correction?.source || 'validation_affine',
            appliedAt: Date.now()
        };
        this._lastPrediction = null; // избегаем скачка сглаживания между старой/новой системой координат
        console.log('[GazeTracker] Посткалибровочная коррекция применена:', this._postCalibrationCorrection);
        return true;
    }

    /**
     * Сбрасывает посткалибровочную коррекцию.
     */
    clearPostCalibrationCorrection() {
        this._postCalibrationCorrection = null;
        this._lastPrediction = null;
    }
    
    /**
     * Предсказывает координаты взгляда на экране.
     * @param {Array} landmarks - 478 landmarks из FaceLandmarker
     * @returns {{ x: number, y: number, confidence: number } | null}
     */
    predict(landmarks) {
        if (!this._isCalibrated || !landmarks || landmarks.length < 478) {
            return null;
        }
        
        const t0 = performance.now();
        const rawFeatures = this._extractFeatures(landmarks);
        if (!rawFeatures) return null;
        
        // Применяем ту же стандартизацию, что и при калибровке
        const features = this._standardizeFeatures(rawFeatures);
        
        // Предсказание модели
        const modelX = this._dotProduct(features, this._modelX);
        const modelY = this._dotProduct(features, this._modelY);

        // Необязательная посткалибровочная аффинная коррекция
        let rawX = modelX;
        let rawY = modelY;
        if (this._postCalibrationCorrection) {
            const corrected = this._applyPostCalibrationCorrection(rawX, rawY);
            rawX = corrected.x;
            rawY = corrected.y;
        }
        
        // Ограничиваем границами экрана (с небольшим запасом для предсказаний у краев)
        rawX = Math.max(-50, Math.min(this._screenW + 50, rawX));
        rawY = Math.max(-50, Math.min(this._screenH + 50, rawY));
        
        // Сглаживание (экспоненциальное скользящее среднее)
        let x, y;
        if (this._lastPrediction && this._smoothingFactor > 0) {
            const s = this._smoothingFactor;
            x = s * this._lastPrediction.x + (1 - s) * rawX;
            y = s * this._lastPrediction.y + (1 - s) * rawY;
        } else {
            x = rawX;
            y = rawY;
        }
        
        // Финальное ограничение координат
        x = Math.max(0, Math.min(this._screenW, x));
        y = Math.max(0, Math.min(this._screenH, y));
        
        const result = {
            x: Math.round(x),
            y: Math.round(y),
            rawX: Math.round(rawX),
            rawY: Math.round(rawY),
            modelX: Math.round(modelX),
            modelY: Math.round(modelY),
            confidence: this._estimateConfidence(landmarks),
            timestamp: Date.now()
        };
        
        this._lastPrediction = result;
        this._stats.totalPredictions++;
        this._stats.avgFeatureExtractionMs = 
            (this._stats.avgFeatureExtractionMs * (this._stats.totalPredictions - 1) + 
            (performance.now() - t0)) / this._stats.totalPredictions;
        
        return result;
    }
    
    /**
     * Применяет z-score стандартизацию на основе статистики калибровки.
     * Сырой вектор признаков (последний элемент — bias=1.0) →
     * стандартизованный вектор с добавленным bias.
     * @param {number[]} rawFeatures - сырой вектор признаков из _extractFeatures
     * @returns {number[]} стандартизованные признаки + bias
     */
    _standardizeFeatures(rawFeatures) {
        const dNoBias = rawFeatures.length - 1; // последний элемент — bias
        const z = new Array(dNoBias + 1);
        for (let j = 0; j < dNoBias; j++) {
            z[j] = (rawFeatures[j] - this._featureMean[j]) / this._featureStd[j];
        }
        z[dNoBias] = 1.0; // bias
        return z;
    }

    _applyPostCalibrationCorrection(x, y) {
        if (!this._postCalibrationCorrection) return { x, y };
        const { matrixX, matrixY } = this._postCalibrationCorrection;
        return {
            x: matrixX[0] * x + matrixX[1] * y + matrixX[2],
            y: matrixY[0] * x + matrixY[1] * y + matrixY[2]
        };
    }
    
    /**
     * Запускает непрерывное отслеживание взгляда.
     * Требует PrecheckAnalyzer для получения landmarks.
     * @param {PrecheckAnalyzer} analyzer - инстанс PrecheckAnalyzer
     * @param {HTMLVideoElement} videoElement - элемент видео
     * @param {number} intervalMs - интервал предсказаний (мс), по умолчанию 33 (~30fps)
     * @returns {boolean}
     */
    startTracking(analyzer, videoElement, intervalMs = 33) {
        if (!this._isCalibrated) {
            console.warn('[GazeTracker] Нельзя начать tracking без калибровки');
            return false;
        }
        
        if (this._isTracking) {
            console.warn('[GazeTracker] Tracking уже запущен');
            return false;
        }
        
        this._isTracking = true;
        this._trackingAnalyzer = analyzer;
        this._trackingVideo = videoElement;
        
        const track = async () => {
            if (!this._isTracking) return;
            
            try {
                const result = await analyzer.analyzeFrame(videoElement);
                if (result && result.landmarks) {
                    const gaze = this.predict(result.landmarks);
                    if (gaze && this.onGazeUpdate) {
                        this.onGazeUpdate(gaze);
                    }
                }
            } catch (e) {
                // Игнорируем ошибки отдельных кадров
            }
            
            if (this._isTracking) {
                this._trackingTimerId = setTimeout(track, intervalMs);
            }
        };
        
        track();
        console.log(`[GazeTracker] Tracking запущен (${intervalMs}ms интервал)`);
        return true;
    }
    
    /**
     * Останавливает непрерывное отслеживание.
     */
    stopTracking() {
        this._isTracking = false;
        if (this._trackingTimerId) {
            clearTimeout(this._trackingTimerId);
            this._trackingTimerId = null;
        }
        this._trackingAnalyzer = null;
        this._trackingVideo = null;
        console.log('[GazeTracker] Tracking остановлен');
    }
    
    /**
     * Обновляет размеры экрана (при изменении размера окна).
     */
    updateScreenSize(width, height) {
        this._screenW = width || window.innerWidth;
        this._screenH = height || window.innerHeight;
    }
    
    /**
     * Возвращает состояние трекера.
     */
    getStatus() {
        return {
            isCalibrated: this._isCalibrated,
            isTracking: this._isTracking,
            calibrationPoints: this._stats.calibrationPoints,
            totalPredictions: this._stats.totalPredictions,
            lastCalibrationTime: this._stats.lastCalibrationTime,
            avgFeatureExtractionMs: Math.round(this._stats.avgFeatureExtractionMs * 100) / 100,
            postCalibrationCorrection: this._postCalibrationCorrection ? {
                enabled: true,
                source: this._postCalibrationCorrection.source,
                appliedAt: this._postCalibrationCorrection.appliedAt
            } : { enabled: false },
            screenSize: { width: this._screenW, height: this._screenH }
        };
    }
    
    /**
     * Полный сброс (калибровка, модель, данные).
     */
    reset() {
        this.stopTracking();
        this._isCalibrated = false;
        this._calibrationData = [];
        this._modelX = null;
        this._modelY = null;
        this._featureMean = null;
        this._featureStd = null;
        this._lastPrediction = null;
        this._postCalibrationCorrection = null;
        this._stats = {
            totalPredictions: 0,
            calibrationPoints: 0,
            lastCalibrationTime: null,
            avgFeatureExtractionMs: 0
        };
        console.log('[GazeTracker] Сброшен');
    }
    
    /**
     * Сбрасывает только калибровочные данные (не модель).
     */
    clearCalibrationData() {
        this._calibrationData = [];
        this._stats.calibrationPoints = 0;
    }
    
    /**
     * Проверяет, откалиброван ли трекер.
     */
    isCalibrated() {
        return this._isCalibrated;
    }
    
    /**
     * Проверяет, запущено ли отслеживание.
     */
    isTracking() {
        return this._isTracking;
    }
    
    // ========================================================================
    // ИЗВЛЕЧЕНИЕ ПРИЗНАКОВ
    // ========================================================================
    
    /**
     * Извлекает признаки из landmarks для ridge-регрессии.
     * 
     * v2.2.0 — 17 сырых признаков (стандартизуются при калибровке/предсказании):
     * 
     *   [0]  leftIrisNormX   — X левой радужки относительно центра левого глаза, нормирован по ширине глаза
     *   [1]  leftIrisNormY   — Y левой радужки относительно центра левого глаза, нормирован по высоте глаза
     *   [2]  rightIrisNormX  — X правой радужки относительно центра правого глаза, нормирован по ширине глаза
     *   [3]  rightIrisNormY  — Y правой радужки относительно центра правого глаза, нормирован по высоте глаза
     *   [4]  avgIrisX        — среднее нормированное X левой и правой радужки
     *   [5]  avgIrisY        — среднее нормированное Y левой и правой радужки
     *   [6]  yawProxy        — оценка yaw головы по расстояниям нос-уши
     *   [7]  pitchProxy      — оценка pitch головы по расстояниям нос-лоб/подбородок
     *   [8]  headX           — X центра головы в кадре (0..1)
     *   [9]  headY           — Y центра головы в кадре
     *   [10] leftEyeOpenness — коэффициент раскрытия левого глаза (EAR)
     *   [11] rightEyeOpenness— коэффициент раскрытия правого глаза (EAR)
     *   [12] irisX_x_yaw    — avgIrisX × yawProxy (взаимодействие: горизонтальный взгляд × поворот головы)
     *   [13] irisY_x_pitch  — avgIrisY × pitchProxy (взаимодействие: вертикальный взгляд × наклон головы)
     *   [14] irisX_x_headX  — avgIrisX × headX (взаимодействие: положение радужки × положение головы)
     *   [15] irisY_x_headY  — avgIrisY × headY (взаимодействие: положение радужки × положение головы)
     *   [16] bias            — 1.0 (убирается до стандартизации и добавляется после)
     * 
     * Термины взаимодействия описывают нелинейную зависимость между положением радужки
     * и позой головы, что особенно важно для углов и краев экрана.
     * 
     * @param {Array} landmarks - 478 landmarks MediaPipe
     * @returns {number[] | null} вектор признаков (17 элементов, последний — bias=1.0)
     */
    _extractFeatures(landmarks) {
        try {
            const LM = this.LANDMARKS;
            
            // Получаем ключевые точки
            const leftIris = landmarks[LM.LEFT_IRIS_CENTER];
            const rightIris = landmarks[LM.RIGHT_IRIS_CENTER];
            
            // Углы глаз
            const leftInner = landmarks[LM.LEFT_EYE_INNER];
            const leftOuter = landmarks[LM.LEFT_EYE_OUTER];
            const leftTop = landmarks[LM.LEFT_EYE_TOP];
            const leftBottom = landmarks[LM.LEFT_EYE_BOTTOM];
            
            const rightInner = landmarks[LM.RIGHT_EYE_INNER];
            const rightOuter = landmarks[LM.RIGHT_EYE_OUTER];
            const rightTop = landmarks[LM.RIGHT_EYE_TOP];
            const rightBottom = landmarks[LM.RIGHT_EYE_BOTTOM];
            
            if (!leftIris || !rightIris || !leftInner || !leftOuter || !rightInner || !rightOuter) {
                return null;
            }
            
            // Размеры глаз
            const leftEyeW = this._dist2d(leftInner, leftOuter);
            const leftEyeH = this._dist2d(leftTop, leftBottom);
            const rightEyeW = this._dist2d(rightInner, rightOuter);
            const rightEyeH = this._dist2d(rightTop, rightBottom);
            
            if (leftEyeW < 1e-6 || rightEyeW < 1e-6) return null;
            if (leftEyeH < 1e-6 || rightEyeH < 1e-6) return null;
            
            // Центры глаз
            const leftEyeCenterX = (leftInner.x + leftOuter.x) / 2;
            const leftEyeCenterY = (leftTop.y + leftBottom.y) / 2;
            const rightEyeCenterX = (rightInner.x + rightOuter.x) / 2;
            const rightEyeCenterY = (rightTop.y + rightBottom.y) / 2;
            
            // Нормализованные позиции радужки внутри глаза
            const leftNormX = (leftIris.x - leftEyeCenterX) / (leftEyeW / 2);
            const leftNormY = (leftIris.y - leftEyeCenterY) / (leftEyeH / 2);
            const rightNormX = (rightIris.x - rightEyeCenterX) / (rightEyeW / 2);
            const rightNormY = (rightIris.y - rightEyeCenterY) / (rightEyeH / 2);
            
            // Усредненная позиция радужки
            const avgIrisX = (leftNormX + rightNormX) / 2;
            const avgIrisY = (leftNormY + rightNormY) / 2;
            
            // Поза головы по landmarks
            const noseTip = landmarks[LM.NOSE_TIP];
            const leftEar = landmarks[LM.LEFT_EAR];
            const rightEar = landmarks[LM.RIGHT_EAR];
            const forehead = landmarks[LM.FOREHEAD];
            const chin = landmarks[LM.CHIN];
            
            const dLeft = this._dist2d(noseTip, leftEar);
            const dRight = this._dist2d(noseTip, rightEar);
            const yawProxy = (dLeft - dRight) / (dLeft + dRight + 1e-6);
            
            const dForehead = this._dist2d(noseTip, forehead);
            const dChin = this._dist2d(noseTip, chin);
            const pitchProxy = (dForehead - dChin) / (dForehead + dChin + 1e-6);
            
            // Позиция головы в кадре (0..1)
            const headX = (leftEyeCenterX + rightEyeCenterX) / 2;
            const headY = (leftEyeCenterY + rightEyeCenterY) / 2;
            
            // Раскрытие глаз (коэффициент аспектного отношения)
            const leftEAR = leftEyeH / leftEyeW;
            const rightEAR = rightEyeH / rightEyeW;
            
            // Термины взаимодействия (iris × поза головы) — описывают нелинейное поведение на краях/в углах
            const irisX_x_yaw = avgIrisX * yawProxy;
            const irisY_x_pitch = avgIrisY * pitchProxy;
            const irisX_x_headX = avgIrisX * headX;
            const irisY_x_headY = avgIrisY * headY;
            
            return [
                leftNormX,              // 0: X левой радужки
                leftNormY,              // 1: Y левой радужки
                rightNormX,             // 2: X правой радужки
                rightNormY,             // 3: Y правой радужки
                avgIrisX,               // 4: среднее X радужек
                avgIrisY,               // 5: среднее Y радужек
                yawProxy,               // 6: yaw головы
                pitchProxy,             // 7: pitch головы
                headX,                  // 8: X позиции головы в кадре
                headY,                  // 9: Y позиции головы в кадре
                leftEAR,                // 10: раскрытие левого глаза
                rightEAR,               // 11: раскрытие правого глаза
                irisX_x_yaw,           // 12: взаимодействие iris×yaw
                irisY_x_pitch,         // 13: взаимодействие iris×pitch
                irisX_x_headX,         // 14: взаимодействие iris×headX
                irisY_x_headY,         // 15: взаимодействие iris×headY
                1.0                     // 16: bias
            ];
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Оценивает уверенность предсказания (0-1).
     * Основана на качестве детекции iris и глаз.
     */
    _estimateConfidence(landmarks) {
        try {
            const LM = this.LANDMARKS;
            const leftIris = landmarks[LM.LEFT_IRIS_CENTER];
            const rightIris = landmarks[LM.RIGHT_IRIS_CENTER];
            const leftInner = landmarks[LM.LEFT_EYE_INNER];
            const leftOuter = landmarks[LM.LEFT_EYE_OUTER];
            const rightInner = landmarks[LM.RIGHT_EYE_INNER];
            const rightOuter = landmarks[LM.RIGHT_EYE_OUTER];
            const leftTop = landmarks[LM.LEFT_EYE_TOP];
            const leftBottom = landmarks[LM.LEFT_EYE_BOTTOM];
            const rightTop = landmarks[LM.RIGHT_EYE_TOP];
            const rightBottom = landmarks[LM.RIGHT_EYE_BOTTOM];
            
            // Проверяем EAR (если глаз закрыт → уверенность = 0)
            const leftEyeW = this._dist2d(leftInner, leftOuter);
            const leftEyeH = this._dist2d(leftTop, leftBottom);
            const rightEyeW = this._dist2d(rightInner, rightOuter);
            const rightEyeH = this._dist2d(rightTop, rightBottom);
            
            const leftEAR = leftEyeW > 0 ? leftEyeH / leftEyeW : 0;
            const rightEAR = rightEyeW > 0 ? rightEyeH / rightEyeW : 0;
            
            // Если глаза слишком закрыты
            if (leftEAR < 0.15 || rightEAR < 0.15) return 0.1;
            
            // Радужка должна быть внутри глаза
            const leftInBounds = leftIris.x >= Math.min(leftInner.x, leftOuter.x) &&
                                 leftIris.x <= Math.max(leftInner.x, leftOuter.x);
            const rightInBounds = rightIris.x >= Math.min(rightInner.x, rightOuter.x) &&
                                  rightIris.x <= Math.max(rightInner.x, rightOuter.x);
            
            let confidence = 0.5;
            if (leftInBounds) confidence += 0.2;
            if (rightInBounds) confidence += 0.2;
            if (leftEAR > 0.2) confidence += 0.05;
            if (rightEAR > 0.2) confidence += 0.05;
            
            return Math.min(1.0, confidence);
        } catch (e) {
            return 0.3;
        }
    }
    
    // ========================================================================
    // RIDGE-РЕГРЕССИЯ
    // ========================================================================
    
    /**
     * Ridge-регрессия: w = (X^T X + λI)^{-1} X^T y
     * @param {number[][]} X - матрица признаков (n × d), уже стандартизованных
     * @param {number[]} y - целевые значения (n)
     * @param {number} lambda - коэффициент регуляризации
     * @returns {number[]} веса (d)
     */
    _ridgeRegression(X, y, lambda) {
        const n = X.length;
        const d = X[0].length;
        
        // X^T X (d × d)
        const XtX = this._matMul(this._transpose(X), X);
        
        // + λI (но НЕ для столбца bias — интерсепт не регуляризуем)
        for (let i = 0; i < d; i++) {
            if (i < d - 1) { // пропускаем столбец bias
                XtX[i][i] += lambda;
            }
        }
        
        // X^T y (d × 1)
        const Xty = new Array(d).fill(0);
        for (let j = 0; j < d; j++) {
            for (let i = 0; i < n; i++) {
                Xty[j] += X[i][j] * y[i];
            }
        }
        
        // Решаем (X^T X + λI) w = X^T y
        const w = this._solveLinearSystem(XtX, Xty);
        return w;
    }
    
    /**
     * Транспонирование матрицы.
     */
    _transpose(M) {
        const rows = M.length;
        const cols = M[0].length;
        const T = [];
        for (let j = 0; j < cols; j++) {
            T[j] = new Array(rows);
            for (let i = 0; i < rows; i++) {
                T[j][i] = M[i][j];
            }
        }
        return T;
    }
    
    /**
     * Умножение матриц A (м×n) × B (n×p) → C (м×p).
     */
    _matMul(A, B) {
        const m = A.length;
        const n = A[0].length;
        const p = B[0].length;
        const C = [];
        for (let i = 0; i < m; i++) {
            C[i] = new Array(p).fill(0);
            for (let j = 0; j < p; j++) {
                for (let k = 0; k < n; k++) {
                    C[i][j] += A[i][k] * B[k][j];
                }
            }
        }
        return C;
    }
    
    /**
     * Решение системы Ax = b методом Гаусса с частичным выбором ведущего.
     */
    _solveLinearSystem(A, b) {
        const n = A.length;
        // Копируем для модификации на месте
        const M = A.map(row => [...row]);
        const rhs = [...b];
        
        // Прямой ход
        for (let col = 0; col < n; col++) {
            // Частичный выбор ведущего
            let maxRow = col;
            let maxVal = Math.abs(M[col][col]);
            for (let row = col + 1; row < n; row++) {
                if (Math.abs(M[row][col]) > maxVal) {
                    maxVal = Math.abs(M[row][col]);
                    maxRow = row;
                }
            }
            // Перестановка строк
            if (maxRow !== col) {
                [M[col], M[maxRow]] = [M[maxRow], M[col]];
                [rhs[col], rhs[maxRow]] = [rhs[maxRow], rhs[col]];
            }
            
            const pivot = M[col][col];
            if (Math.abs(pivot) < 1e-12) {
                console.warn('[GazeTracker] Вырожденная матрица в ridge regression');
                // Запасной вариант: возвращаем нули
                return new Array(n).fill(0);
            }
            
            for (let row = col + 1; row < n; row++) {
                const factor = M[row][col] / pivot;
                for (let j = col; j < n; j++) {
                    M[row][j] -= factor * M[col][j];
                }
                rhs[row] -= factor * rhs[col];
            }
        }
        
        // Обратный ход
        const x = new Array(n).fill(0);
        for (let row = n - 1; row >= 0; row--) {
            let sum = rhs[row];
            for (let j = row + 1; j < n; j++) {
                sum -= M[row][j] * x[j];
            }
            x[row] = sum / M[row][row];
        }
        
        return x;
    }
    
    // ========================================================================
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ========================================================================
    
    /**
     * Скалярное произведение двух векторов.
     */
    _dotProduct(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += a[i] * (b[i] || 0);
        }
        return sum;
    }
    
    /**
     * 2D расстояние между точками.
     */
    _dist2d(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

// Экспорт для CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GazeTracker;
}

// Глобальная переменная в браузере
if (typeof window !== 'undefined') {
    window.GazeTracker = GazeTracker;
}
