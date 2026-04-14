/**
 * GazeTracker — версия ES-модуля
 * 
 * Оценка взгляда по радужке с использованием landmarks MediaPipe Face Landmarker
 * и калибровки на основе ridge-регрессии.
 * 
 * v2.2.0: Расширен до 17-мерного вектора признаков с терминами взаимодействия iris×head
 *          для лучшей точности в углах и по краям. Требует 32+ калибровочных точек
 *          (сетка 4×4 × 2 клика = 32, переопределённая система для 17 признаков).
 *          λ=0.001, smoothing=0.10, z-score стандартизация.
 * 
 * v2.1.1: 13-мерный вектор признаков (без взаимодействий), λ=0.001, smoothing=0.10,
 *          z-score стандартизация, addAveragedCalibrationPoint() для усреднения по нескольким кадрам.
 * 
 * @module gaze-tracker/GazeTracker
 * @version 2.2.0
 * @license MIT
 */

import { LANDMARKS, MIN_LANDMARKS, DEFAULTS } from './constants.js';
import { extractFeatures, estimateConfidence } from './features.js';
import { ridgeRegression, dotProduct } from './ridge.js';

export default class GazeTracker {
    constructor(options = {}) {
        this._isCalibrated = false;
        this._isTracking = false;

        this._ridgeLambda = options.ridgeLambda ?? DEFAULTS.ridgeLambda;
        this._calibrationData = [];
        this._modelX = null;
        this._modelY = null;

        // Стандартизация признаков (вычисляется при калибровке)
        this._featureMean = null;
        this._featureStd = null;

        this._smoothingFactor = options.smoothingFactor ?? DEFAULTS.smoothingFactor;
        this._lastPrediction = null;
        this._postCalibrationCorrection = null;

        this._screenW = options.screenWidth || (typeof window !== 'undefined' ? window.innerWidth : 1920);
        this._screenH = options.screenHeight || (typeof window !== 'undefined' ? window.innerHeight : 1080);

        this.LANDMARKS = LANDMARKS;

        this._stats = {
            totalPredictions: 0,
            calibrationPoints: 0,
            lastCalibrationTime: null,
            avgFeatureExtractionMs: 0
        };

        this.onGazeUpdate = options.onGazeUpdate || null;
        this.onCalibrationComplete = options.onCalibrationComplete || null;

        this._trackingTimerId = null;
        this._trackingAnalyzer = null;
        this._trackingVideo = null;
    }

    // ========== ПУБЛИЧНЫЙ ИНТЕРФЕЙС ==========

    addCalibrationPoint(landmarks, screenX, screenY) {
        if (!landmarks || landmarks.length < MIN_LANDMARKS) {
            return false;
        }
        const features = extractFeatures(landmarks);
        if (!features) return false;

        this._calibrationData.push({ features, screenX, screenY, timestamp: Date.now() });
        this._stats.calibrationPoints = this._calibrationData.length;
        return true;
    }

    /**
     * Добавляет калибровочную точку из заранее усреднённых признаков нескольких кадров.
     * Предпочтительный метод — снижает шум детекции радужки.
     * 
     * @param {Array<Array>} landmarksArray - массив landmarks из нескольких кадров
     * @param {number} screenX - X-координата точки на экране (px)
     * @param {number} screenY - Y-координата точки на экране (px)
     * @returns {boolean} успешно ли добавлена точка
     */
    addAveragedCalibrationPoint(landmarksArray, screenX, screenY) {
        if (!landmarksArray || landmarksArray.length === 0) {
            return false;
        }

        const allFeatures = [];
        for (const landmarks of landmarksArray) {
            if (!landmarks || landmarks.length < MIN_LANDMARKS) continue;
            const features = extractFeatures(landmarks);
            if (features) allFeatures.push(features);
        }

        if (allFeatures.length === 0) return false;

        // Поэлементное усреднение признаков
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
        // Восстанавливаем bias строго в 1.0
        avgFeatures[d - 1] = 1.0;

        this._calibrationData.push({ features: avgFeatures, screenX, screenY, timestamp: Date.now() });
        this._stats.calibrationPoints = this._calibrationData.length;
        return true;
    }

    /**
     * Обучает модель на собранных калибровочных данных.
     * 
     * Конвейер:
     * 1. Вычислить среднее и std по каждому признаку (z-score стандартизация)
     * 2. Стандартизовать признаки: z = (x - mean) / std
     * 3. Добавить bias-столбец (=1) ПОСЛЕ стандартизации
     * 4. Обучить ridge-регрессию на стандартизованных признаках
     */
    calibrate() {
        const n = this._calibrationData.length;
        if (n < DEFAULTS.minCalibrationPoints) {
            console.warn(`[GazeTracker] Not enough points: ${n}/${DEFAULTS.minCalibrationPoints}`);
            return false;
        }
        try {
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
                this._featureStd[j] = std > 1e-8 ? std : 1.0;
            }

            // 2. Стандартизуем признаки и добавляем bias
            const X = rawFeatures.map(f => {
                const z = new Array(dNoBias + 1);
                for (let j = 0; j < dNoBias; j++) {
                    z[j] = (f[j] - this._featureMean[j]) / this._featureStd[j];
                }
                z[dNoBias] = 1.0; // bias после стандартизации
                return z;
            });

            const Yx = this._calibrationData.map(d => d.screenX);
            const Yy = this._calibrationData.map(d => d.screenY);

            // 3. Ridge-регрессия на стандартизованных признаках
            this._modelX = ridgeRegression(X, Yx, this._ridgeLambda);
            this._modelY = ridgeRegression(X, Yy, this._ridgeLambda);

            this._isCalibrated = true;
            this._stats.lastCalibrationTime = Date.now();
            this._lastPrediction = null;
            this._postCalibrationCorrection = null;

            // Диагностика: считаем остатки на обучающей выборке
            let trainErrorX = 0, trainErrorY = 0;
            for (let i = 0; i < n; i++) {
                const predX = dotProduct(X[i], this._modelX);
                const predY = dotProduct(X[i], this._modelY);
                trainErrorX += Math.abs(predX - Yx[i]);
                trainErrorY += Math.abs(predY - Yy[i]);
            }
            trainErrorX /= n;
            trainErrorY /= n;

            console.log(`[GazeTracker] Калибровка завершена (${n} точек), train MAE: X=${trainErrorX.toFixed(1)}px, Y=${trainErrorY.toFixed(1)}px`);

            if (this.onCalibrationComplete) {
                this.onCalibrationComplete({ points: n, timestamp: Date.now(), trainMAE: { x: trainErrorX, y: trainErrorY } });
            }
            return true;
        } catch (e) {
            console.error('[GazeTracker] Ошибка калибровки:', e);
            return false;
        }
    }

    setPostCalibrationCorrection(correction) {
        const matrixX = correction?.matrixX;
        const matrixY = correction?.matrixY;
        const valid = Array.isArray(matrixX) && matrixX.length === 3 &&
            Array.isArray(matrixY) && matrixY.length === 3 &&
            matrixX.every(Number.isFinite) && matrixY.every(Number.isFinite);
        if (!valid) return false;

        this._postCalibrationCorrection = {
            matrixX: [...matrixX],
            matrixY: [...matrixY],
            source: correction?.source || 'validation_affine',
            appliedAt: Date.now()
        };
        this._lastPrediction = null;
        return true;
    }

    clearPostCalibrationCorrection() {
        this._postCalibrationCorrection = null;
        this._lastPrediction = null;
    }

    predict(landmarks) {
        if (!this._isCalibrated || !landmarks || landmarks.length < MIN_LANDMARKS) {
            return null;
        }
        const t0 = performance.now();
        const rawFeatures = extractFeatures(landmarks);
        if (!rawFeatures) return null;

        // Применяем ту же стандартизацию, что и при калибровке
        const features = this._standardizeFeatures(rawFeatures);

        const modelX = dotProduct(features, this._modelX);
        const modelY = dotProduct(features, this._modelY);
        let rawX = modelX;
        let rawY = modelY;
        if (this._postCalibrationCorrection) {
            const corrected = this._applyPostCalibrationCorrection(rawX, rawY);
            rawX = corrected.x;
            rawY = corrected.y;
        }

        rawX = Math.max(-50, Math.min(this._screenW + 50, rawX));
        rawY = Math.max(-50, Math.min(this._screenH + 50, rawY));

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
            confidence: estimateConfidence(landmarks),
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
     * Применяет z-score стандартизацию с использованием статистики калибровки.
     * @param {number[]} rawFeatures - сырой вектор признаков (последний элемент — bias=1.0)
     * @returns {number[]} стандартизованные признаки + bias
     */
    _standardizeFeatures(rawFeatures) {
        const dNoBias = rawFeatures.length - 1;
        const z = new Array(dNoBias + 1);
        for (let j = 0; j < dNoBias; j++) {
            z[j] = (rawFeatures[j] - this._featureMean[j]) / this._featureStd[j];
        }
        z[dNoBias] = 1.0;
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

    startTracking(analyzer, videoElement, intervalMs = 33) {
        if (!this._isCalibrated) return false;
        if (this._isTracking) return false;

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
            } catch (e) { /* игнорируем ошибки отдельных кадров */ }

            if (this._isTracking) {
                this._trackingTimerId = setTimeout(track, intervalMs);
            }
        };

        track();
        return true;
    }

    stopTracking() {
        this._isTracking = false;
        if (this._trackingTimerId) {
            clearTimeout(this._trackingTimerId);
            this._trackingTimerId = null;
        }
        this._trackingAnalyzer = null;
        this._trackingVideo = null;
    }

    updateScreenSize(width, height) {
        this._screenW = width || window.innerWidth;
        this._screenH = height || window.innerHeight;
    }

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
    }

    clearCalibrationData() {
        this._calibrationData = [];
        this._stats.calibrationPoints = 0;
    }

    isCalibrated() { return this._isCalibrated; }
    isTracking() { return this._isTracking; }
}
