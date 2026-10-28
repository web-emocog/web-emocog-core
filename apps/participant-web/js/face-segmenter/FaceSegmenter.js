/**
 * Face Segmenter Module v1.3
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
 * v1.3 - face_oval_regions.v1: neck/background outside the face cannot veto precheck.
 * Численные пороги v1.2 сохранены:
 * - Снижены пороги handOcclusionThreshold до 0.05 (5%)
 * - Более агрессивная детекция body_skin в областях лица
 * - Добавлен глобальный анализ body_skin по всему лицу
 * 
 * v1.1 - Улучшена детекция окклюзий:
 * - body_skin в области лица теперь считается окклюзией (рука)
 * - Более строгие пороги для лба (волосы)
 * - Добавлен анализ аномального присутствия body_skin
 * 
 * @version 1.3.0
 * @requires @mediapipe/tasks-vision
 * @module face-segmenter/FaceSegmenter
 */

import { CLASS_INDICES, CLASS_NAMES } from './constants.js?v=20261025-1';
import { DEFAULT_THRESHOLDS } from './thresholds.js';
import { analyzeMasks } from './mask-analyzer.js?v=20261028-139';
import { analyzeFaceRegionsVisibility } from './region-analyzer.js?v=20261028-139';
import { createVisualizationMask } from './visualization.js';
import { createAnalysisCanvas } from '../session-runtime/frame-pixels.mjs';
import { VisionWorkerClient } from '../session-runtime/vision-worker-client.mjs?v=20261028-139';
import { segmentationDelegate } from './delegate-policy.mjs';
import { MaskReader } from './mask-reader.mjs';

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
        this.workerAllowed = options.worker !== false;
        this.worker = null;
        this.initializing = null;
        this.generation = 0;
        this.backend = 'uninitialized';
        this.inferenceDelegate = null;
        this.maskReader = new MaskReader();
    }

    /**
     * Инициализация MediaPipe Image Segmenter
     */
    async initialize() {
        if (this.isInitialized) return true;
        if (this.initializing) return this.initializing;
        this.initializing = this._initialize().finally(() => { this.initializing = null; });
        return this.initializing;
    }

    async _initialize() {
        const generation = this.generation;
        if (this.workerAllowed && VisionWorkerClient.supported()) {
            const worker = new VisionWorkerClient('segment');
            this.worker = worker;
            try {
                const initialized = await worker.start({ ...this.thresholds, segmentationType: this.segmentationType, runningMode: this.runningMode });
                if (generation !== this.generation) { worker.dispose(); return false; }
                this.isInitialized = true;
                this.backend = 'worker';
                this.inferenceDelegate = ['CPU', 'GPU'].includes(initialized?.inferenceDelegate) ? initialized.inferenceDelegate : null;
                this.cpuFallbackReason = initialized?.delegateFallbackReason || null;
                this.onInitialized?.();
                return true;
            } catch (_) {
                worker.dispose();
                if (generation !== this.generation) return false;
                this.worker = null; this.workerAllowed = false;
                this.workerFallbackReason = 'worker_initialization_failed';
            }
        }
        if (generation !== this.generation) return false;
        try {
            console.log('[FaceSegmenter] Инициализация v1.3 (MediaPipe Image Segmenter)...');
            
            // Проверяем наличие MediaPipe
            if (typeof FilesetResolver === 'undefined' || typeof ImageSegmenter === 'undefined') {
                throw new Error('MediaPipe Vision не загружен. Добавьте скрипты в HTML.');
            }
            
            // Загружаем WASM модуль
            const wasmRoot = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
            const vision = await FilesetResolver.forVisionTasks(wasmRoot);
            
            // Выбираем модель в зависимости от типа сегментации
            const modelPath = this.segmentationType === 'selfie_multiclass'
                ? new URL(
                    '../vendor/mediapipe/models/selfie_multiclass_256x256.tflite',
                    import.meta.url
                ).href
                : new URL(
                    '../vendor/mediapipe/models/selfie_segmenter.tflite',
                    import.meta.url
                ).href;
            
            // Создаём Image Segmenter
            let delegate = this.cpuFallbackReason ? 'CPU' : segmentationDelegate();
            const create = selected => ImageSegmenter.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: modelPath,
                    delegate: selected
                },
                runningMode: this.runningMode,
                outputCategoryMask: true,
                outputConfidenceMasks: true,
                ...(typeof document === 'undefined' ? { canvas: createAnalysisCanvas() } : {})
            });
            let segmenter;
            try { segmenter = await create(delegate); }
            catch (error) {
                if (delegate !== 'GPU' || generation !== this.generation) throw error;
                delegate = 'CPU';
                this.cpuFallbackReason = 'gpu_initialization_failed';
                segmenter = await create(delegate);
            }
            
            if (generation !== this.generation) { segmenter.close(); return false; }
            this.imageSegmenter = segmenter;
            this.inferenceDelegate = delegate;
            // Создаём canvas для обработки масок
            this._maskCanvas = createAnalysisCanvas();
            this._maskCtx = this._maskCanvas.getContext('2d', { willReadFrequently: true });
            
            this.isInitialized = true;
            this.backend = 'main';
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
    async segmentFrame(videoElement, faceLandmarks = null, captureTimestamp = performance.now()) {
        const generation = this.generation;
        while (this.pendingFrame) await this.pendingFrame.catch(() => {});
        if (generation !== this.generation) return this._createErrorResult('Segmentation interrupted');
        const pending = this._segmentFrame(videoElement, faceLandmarks, captureTimestamp);
        this.pendingFrame = pending;
        try { return await pending; }
        finally { if (this.pendingFrame === pending) this.pendingFrame = null; }
    }

    async _segmentFrame(videoElement, faceLandmarks, captureTimestamp) {
        const generation = this.generation;
        if (!this.isInitialized && !await this.initialize()) return this._createErrorResult('Segmenter unavailable');
        if (generation !== this.generation) return this._createErrorResult('Segmentation interrupted');

        if (!videoElement || (videoElement.readyState !== undefined && videoElement.readyState < 2)) {
            return this._createErrorResult('Видео не готово');
        }
        if (this.worker) {
            const generation = this.generation;
            const worker = this.worker;
            try {
                const result = await worker.analyze(videoElement, { landmarks: faceLandmarks, timestamp: captureTimestamp });
                if (generation !== this.generation) return this._createErrorResult('Segmentation interrupted');
                this.lastResult = result;
                if (['CPU', 'GPU'].includes(result.inferenceDelegate)) this.inferenceDelegate = result.inferenceDelegate;
                this.cpuFallbackReason = result.delegateFallbackReason || null;
                return result;
            } catch (_) {
                if (generation !== this.generation || this.worker !== worker) return this._createErrorResult('Segmentation interrupted');
                worker.dispose(); this.worker = null; this.workerAllowed = false;
                this.isInitialized = false; this.workerFallbackReason = 'worker_runtime_failed';
                this.inferenceDelegate = null;
                return this._createErrorResult('vision_worker_interrupted');
            }
        }

        const startTime = performance.now();
        let segmentationResult;
        try {
            const width = videoElement.videoWidth || videoElement.width || 640;
            const height = videoElement.videoHeight || videoElement.height || 480;
            
            // Выполняем сегментацию
            const timestamp = captureTimestamp;
            segmentationResult = this.imageSegmenter.segmentForVideo(videoElement, timestamp);
            
            // Обрабатываем маски
            const maskAnalysis = analyzeMasks(segmentationResult, width, height, faceLandmarks, this.maskReader);
            
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

            return this.lastResult;
            
        } catch (error) {
            if (this.inferenceDelegate === 'GPU' && !this.cpuFallbackReason && generation === this.generation) {
                // Release every owned mask before closing its GL context. Retry
                // once on CPU inside the same worker, preserving capture time.
                segmentationResult?.categoryMask?.close();
                segmentationResult?.confidenceMasks?.forEach(mask => mask.close());
                segmentationResult = null;
                this.maskReader.dispose();
                this.imageSegmenter.close(); this.imageSegmenter = null;
                this.isInitialized = false;
                this.cpuFallbackReason = 'gpu_mask_or_inference_failed';
                return await this._segmentFrame(videoElement, faceLandmarks, captureTimestamp);
            }
            console.error('[FaceSegmenter] Ошибка сегментации:', error);
            return this._createErrorResult(error.message);
        } finally {
            segmentationResult?.categoryMask?.close();
            segmentationResult?.confidenceMasks?.forEach(mask => mask.close());
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
        this.generation++;
        this.worker?.reset();
        this.lastResult = null;
    }

    /**
     * Освобождение ресурсов
     */
    dispose() {
        this.worker?.dispose(); this.worker = null;
        this.maskReader.dispose();
        if (this.imageSegmenter) {
            this.imageSegmenter.close();
            this.imageSegmenter = null;
        }
        this._maskCanvas = null;
        this._maskCtx = null;
        this.isInitialized = false;
        this.inferenceDelegate = null;
        this.reset();
    }
}

export default FaceSegmenter;
export { FaceSegmenter };
