/**
 * Face Segmenter Module v1.2
 * Проверка видимости областей лица через MediaPipe Image Segmenter
 * 
 * Использует модель Selfie Segmenter для точной сегментации:
 * - Маска лица/человека (foreground vs background)
 * - Мультикласс: skin, hair, clothes, background и др.
 * 
 * Преимущества перед анализом по лэндмаркам:
 * - Точная пиксельная маска области лица
 * - Детекция окклюзий (волосы, руки, предметы)
 * - Независимость от точности лэндмарок на закрытых областях
 * 
 * v1.2 - Улучшена детекция руки на лице:
 * - Снижены пороги handOcclusionThreshold до 0.05 (5%)
 * - Более агрессивная детекция body_skin в областях лица
 * - Добавлен глобальный анализ body_skin по всему лицу
 * 
 * v1.1 - Улучшена детекция окклюзий:
 * - body_skin в области лица теперь считается окклюзией (рука)
 * - Более строгие пороги для лба (волосы)
 * - Добавлен анализ аномального присутствия body_skin
 * 
 * @version 1.2.0
 * @requires @mediapipe/tasks-vision
 * @module face-segmenter/FaceSegmenter
 */

import { CLASS_INDICES, CLASS_NAMES } from './constants.js';
import { DEFAULT_THRESHOLDS } from './thresholds.js';
import { analyzeMasks } from './mask-analyzer.js';
import { analyzeFaceRegionsVisibility } from './region-analyzer.js';
import { createVisualizationMask } from './visualization.js';

class FaceSegmenter {
    constructor(options = {}) {
        this.isInitialized = false;
        this.imageSegmenter = null;
        
        // Режим работы
        this.runningMode = options.runningMode || "VIDEO";
        
        // Тип сегментации
        // 'selfie' - бинарная маска человек/фон
        // 'selfie_multiclass' - мультиклассовая (skin, hair, body, clothes, etc.)
        this.segmentationType = options.segmentationType || "selfie_multiclass";
        
        // Пороговые значения (мержим с дефолтными)
        this.thresholds = {
            ...DEFAULT_THRESHOLDS,
            maskConfidence: options.maskConfidence ?? DEFAULT_THRESHOLDS.maskConfidence,
            minSkinVisibility: options.minSkinVisibility ?? DEFAULT_THRESHOLDS.minSkinVisibility,
            minTotalFaceSkin: options.minTotalFaceSkin ?? DEFAULT_THRESHOLDS.minTotalFaceSkin,
            hairOcclusionThreshold: options.hairOcclusionThreshold ?? DEFAULT_THRESHOLDS.hairOcclusionThreshold,
            handOcclusionThreshold: options.handOcclusionThreshold ?? DEFAULT_THRESHOLDS.handOcclusionThreshold,
            globalHandThreshold: options.globalHandThreshold ?? DEFAULT_THRESHOLDS.globalHandThreshold,
            maxAsymmetry: options.maxAsymmetry ?? DEFAULT_THRESHOLDS.maxAsymmetry
        };
        
        // Константы класса (для обратной совместимости)
        this.CLASS_INDICES = CLASS_INDICES;
        this.CLASS_NAMES = CLASS_NAMES;
        
        // Canvas для обработки масок
        this._maskCanvas = null;
        this._maskCtx = null;
        
        // Последний результат сегментации
        this.lastResult = null;
        
        // Callbacks
        this.onInitialized = options.onInitialized || null;
        this.onError = options.onError || null;
    }

    /**
     * Инициализация MediaPipe Image Segmenter
     */
    async initialize() {
        if (this.isInitialized) return true;
        
        try {
            console.log('[FaceSegmenter] Инициализация v1.2 (MediaPipe Image Segmenter)...');
            
            // Проверяем наличие MediaPipe
            if (typeof FilesetResolver === 'undefined' || typeof ImageSegmenter === 'undefined') {
                throw new Error('MediaPipe Vision не загружен. Добавьте скрипты в HTML.');
            }
            
            // Загружаем WASM модуль
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
            );
            
            // Выбираем модель в зависимости от типа сегментации
            const modelPath = this.segmentationType === 'selfie_multiclass'
                ? "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"
                : "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
            
            // Создаём Image Segmenter
            this.imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: modelPath,
                    delegate: "GPU"
                },
                runningMode: this.runningMode,
                outputCategoryMask: true,
                outputConfidenceMasks: true
            });
            
            // Создаём canvas для обработки масок
            this._maskCanvas = document.createElement('canvas');
            this._maskCtx = this._maskCanvas.getContext('2d', { willReadFrequently: true });
            
            this.isInitialized = true;
            console.log(`[FaceSegmenter] MediaPipe Image Segmenter готов (${this.segmentationType})`);
            
            if (this.onInitialized) {
                this.onInitialized();
            }
            
            return true;
            
        } catch (error) {
            console.error('[FaceSegmenter] Ошибка инициализации:', error);
            if (this.onError) {
                this.onError(error);
            }
            return false;
        }
    }

    /**
     * Сегментация кадра видео
     * @param {HTMLVideoElement} videoElement - видео элемент
     * @param {Object} faceLandmarks - лэндмарки лица от Face Landmarker (опционально)
     * @returns {Object} результат сегментации с анализом видимости областей
     */
    async segmentFrame(videoElement, faceLandmarks = null) {
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
            
            // Выполняем сегментацию
            const timestamp = performance.now();
            const segmentationResult = this.imageSegmenter.segmentForVideo(videoElement, timestamp);
            
            // Обрабатываем маски
            const maskAnalysis = analyzeMasks(segmentationResult, width, height, faceLandmarks);
            
            // Анализируем видимость областей лица
            const faceVisibility = analyzeFaceRegionsVisibility(maskAnalysis, faceLandmarks, width, height, this.thresholds);
            
            const analysisTime = performance.now() - startTime;
            
            this.lastResult = {
                maskAnalysis,
                faceVisibility,
                isComplete: faceVisibility.isComplete,
                score: faceVisibility.score,
                issues: faceVisibility.issues,
                timestamp: Date.now(),
                frameSize: { width, height },
                analysisTime: Math.round(analysisTime)
            };

            // Освобождаем ресурсы маски
            if (segmentationResult.categoryMask) {
                segmentationResult.categoryMask.close();
            }
            if (segmentationResult.confidenceMasks) {
                segmentationResult.confidenceMasks.forEach(mask => mask.close());
            }

            return this.lastResult;
            
        } catch (error) {
            console.error('[FaceSegmenter] Ошибка сегментации:', error);
            return this._createErrorResult(error.message);
        }
    }

    /**
     * Создание маски визуализации для отладки
     * @param {Object} segmentationResult - результат сегментации
     * @param {number} width - ширина
     * @param {number} height - высота
     * @returns {ImageData} - данные изображения с визуализацией маски
     */
    createVisualizationMask(segmentationResult, width, height) {
        return createVisualizationMask(segmentationResult, width, height, this._maskCtx);
    }

    /**
     * Создание результата ошибки
     */
    _createErrorResult(message) {
        return {
            maskAnalysis: { hasData: false },
            faceVisibility: {
                isComplete: false,
                score: 0,
                issues: [message],
                regions: {}
            },
            isComplete: false,
            score: 0,
            issues: [message],
            error: message,
            timestamp: Date.now()
        };
    }

    /**
     * Получение последнего результата сегментации
     */
    getLastResult() {
        return this.lastResult;
    }

    /**
     * Сброс состояния
     */
    reset() {
        this.lastResult = null;
    }

    /**
     * Освобождение ресурсов
     */
    dispose() {
        if (this.imageSegmenter) {
            this.imageSegmenter.close();
            this.imageSegmenter = null;
        }
        this._maskCanvas = null;
        this._maskCtx = null;
        this.isInitialized = false;
        this.reset();
    }
}

export default FaceSegmenter;
export { FaceSegmenter };
