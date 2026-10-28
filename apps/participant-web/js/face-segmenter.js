/**
 * Face Segmenter Module v1.3 — Browser Wrapper / Loader
 *
 * Загрузка устроена так:
 *   1) Сразу синхронно объявляется inline-класс FaceSegmenterInline (упрощённая
 *      реализация ниже) и публикуется как window.FaceSegmenter — safety net
 *      для кода, который делает new FaceSegmenter() до резолва Promise (с warn).
 *   2) Параллельно стартует dynamic import() ./face-segmenter/index.js. При
 *      успехе window.FaceSegmenter переписывается на полную модульную версию
 *      с per-region/symmetry/visualization функциональностью.
 *   3) При ошибке загрузки папки остаёмся на inline-классе (console.error).
 *   4) Promise window.FaceSegmenterReady резолвится в 'module' | 'inline'.
 *      Новые потребители ждут его перед `new FaceSegmenter()`.
 *
 * Inline fallback сохраняет публичный API и использует те же чистые
 * mask/region-анализаторы, что и Worker/main-thread класс.
 *
 * @version 1.3.0
 * @requires @mediapipe/tasks-vision
 */

// Встроенный класс — fallback при сбое загрузки папки.
class FaceSegmenterInline {
    constructor(options = {}) {
        this.isInitialized = false;
        this.imageSegmenter = null;
        this.runningMode = options.runningMode || "VIDEO";
        this.segmentationType = options.segmentationType || "selfie_multiclass";
        
        this.thresholds = {
            maskConfidence: options.maskConfidence ?? 0.5,
            // Legacy numeric thresholds, unchanged; geometry is shared with the module.
            minSkinVisibility: options.minSkinVisibility ?? 0.6,      // было 0.60
            minTotalFaceSkin: options.minTotalFaceSkin ?? 0.55,        // было 0.55
            hairOcclusionThreshold: options.hairOcclusionThreshold ?? 0.25,  // было 0.25
            handOcclusionThreshold: options.handOcclusionThreshold ?? 0.05,  // было 0.05
            globalHandThreshold: options.globalHandThreshold ?? 0.08,
            maxAsymmetry: options.maxAsymmetry ?? 0.30
        };
        
        this.CLASS_INDICES = {
            BACKGROUND: 0, HAIR: 1, BODY_SKIN: 2,
            FACE_SKIN: 3, CLOTHES: 4, OTHERS: 5
        };
        
        this.CLASS_NAMES = ['background', 'hair', 'body_skin', 'face_skin', 'clothes', 'others'];
        this._maskCanvas = null;
        this._maskCtx = null;
        this.lastResult = null;
        this.onInitialized = options.onInitialized || null;
        this.onError = options.onError || null;
    }

    async initialize() {
        if (this.isInitialized) return true;
        try {
            const [mask, region] = await Promise.all([
                import('./face-segmenter/mask-analyzer.js?v=20261028-139'),
                import('./face-segmenter/region-analyzer.js?v=20261028-139')
            ]);
            this.analysisCore = { ...mask, ...region };
            console.log('[FaceSegmenter] Инициализация v1.3...');
            if (typeof FilesetResolver === 'undefined' || typeof ImageSegmenter === 'undefined') {
                throw new Error('MediaPipe Vision не загружен.');
            }
            const vision = await FilesetResolver.forVisionTasks(
                "js/vendor/mediapipe/wasm"
            );
            const modelPath = this.segmentationType === 'selfie_multiclass'
                ? "js/vendor/mediapipe/models/selfie_multiclass_256x256.tflite"
                : "js/vendor/mediapipe/models/selfie_segmenter.tflite";
            this.imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
                baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
                runningMode: this.runningMode,
                outputCategoryMask: true,
                outputConfidenceMasks: true
            });
            this._maskCanvas = document.createElement('canvas');
            this._maskCtx = this._maskCanvas.getContext('2d', { willReadFrequently: true });
            this.isInitialized = true;
            console.log(`[FaceSegmenter] Готов (${this.segmentationType})`);
            if (this.onInitialized) this.onInitialized();
            return true;
        } catch (error) {
            console.error('[FaceSegmenter] Ошибка:', error);
            if (this.onError) this.onError(error);
            return false;
        }
    }

    async segmentFrame(videoElement, faceLandmarks = null) {
        if (!this.isInitialized && !await this.initialize()) return this._createErrorResult('segmentation_unavailable');
        if (!videoElement || videoElement.readyState < 2) {
            return this._createErrorResult('Видео не готово');
        }
        let segResult;
        try {
            const width = videoElement.videoWidth || 640;
            const height = videoElement.videoHeight || 480;
            const timestamp = performance.now();
            segResult = this.imageSegmenter.segmentForVideo(videoElement, timestamp);
            const maskAnalysis = this._analyzeMasks(segResult, width, height, faceLandmarks);
            const faceVisibility = this._analyzeFaceRegionsVisibility(maskAnalysis, faceLandmarks, width, height);
            this.lastResult = {
                maskAnalysis, faceVisibility,
                isComplete: faceVisibility.isComplete,
                score: faceVisibility.score,
                issues: faceVisibility.issues,
                timestamp: Date.now(),
                frameSize: { width, height }
            };
            return this.lastResult;
        } catch (error) {
            return this._createErrorResult(error.message);
        } finally {
            segResult?.categoryMask?.close();
            segResult?.confidenceMasks?.forEach(mask => mask.close());
        }
    }

    // Inline fallback shares the same face-local evidence; no separate global-hand heuristic.
    _analyzeMasks(segResult, w, h, landmarks) {
        return this.analysisCore.analyzeMasks(segResult, w, h, landmarks);
    }

    _extractFaceRegion(data, mW, mH, landmarks, fW, fH) {
        return this.analysisCore.extractFaceRegion(data, mW, mH, landmarks, fW, fH);
    }

    _analyzeFaceRegionsVisibility(maskAnalysis, landmarks, fW, fH) {
        return this.analysisCore.analyzeFaceRegionsVisibility(maskAnalysis, landmarks, fW, fH, this.thresholds);
    }

    _createErrorResult(msg) {
        return {
            maskAnalysis: { hasData: false },
            faceVisibility: { isComplete: false, score: 0, issues: [msg], regions: {} },
            isComplete: false, score: 0, issues: [msg],
            error: msg, timestamp: Date.now()
        };
    }

    getLastResult() { return this.lastResult; }
    reset() { this.lastResult = null; }
    dispose() {
        if (this.imageSegmenter) { this.imageSegmenter.close(); this.imageSegmenter = null; }
        this._maskCanvas = null; this._maskCtx = null;
        this.isInitialized = false; this.reset();
    }
}

// CommonJS export (для node-тестов).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FaceSegmenterInline;
}

// Browser: loader-паттерн.
if (typeof window !== 'undefined') {
    let _faceSegmenterResolvedKind = null; // 'module' | 'inline' | null

    function FaceSegmenterProxy(...args) {
        if (_faceSegmenterResolvedKind === null) {
            console.warn(
                '[FaceSegmenter] sync use before Ready — using inline fallback. ' +
                'Update the consumer to `await window.FaceSegmenterReady` before `new FaceSegmenter()`.'
            );
        }
        return new FaceSegmenterInline(...args);
    }
    FaceSegmenterProxy.prototype = FaceSegmenterInline.prototype;

    window.FaceSegmenter = FaceSegmenterProxy;

    window.FaceSegmenterReady = (async () => {
        try {
            const mod = await import('./face-segmenter/index.js?v=20261028-139');
            const Cls = mod && (mod.FaceSegmenter || mod.default);
            if (typeof Cls !== 'function') {
                throw new Error('module did not export FaceSegmenter class');
            }
            window.FaceSegmenter = Cls;
            _faceSegmenterResolvedKind = 'module';
            console.info('[FaceSegmenter] folder version loaded');
            return 'module';
        } catch (e) {
            window.FaceSegmenter = FaceSegmenterInline;
            _faceSegmenterResolvedKind = 'inline';
            console.error('[FaceSegmenter] folder load failed, using inline fallback', e);
            return 'inline';
        }
    })();
}
