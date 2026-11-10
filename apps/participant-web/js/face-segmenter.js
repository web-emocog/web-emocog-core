// Classic loader; consumers await the canonical module before constructing the model.
let segmentInlineDiagnostic;

class FaceSegmenterInline {
    constructor(options = {}) {
        this.isInitialized = false;
        this.initializationFailed = false;
        this.initializing = null;
        this.generation = 0;
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
        this.lastResult = null;
        this.onInitialized = options.onInitialized || null;
        this.onError = options.onError || null;
    }

    async initialize() {
        if (this.isInitialized) return true;
        if (this.initializing) return this.initializing;
        const attempt = this._initialize(this.generation);
        this.initializing = attempt;
        try { return await attempt; }
        finally { if (this.initializing === attempt) this.initializing = null; }
    }

    async _initialize(generation) {
        try {
            const [mask, region] = await Promise.all([
                import('./face-segmenter/mask-analyzer.js?v=20261104-4'),
                import('./face-segmenter/region-analyzer.js?v=20261110-integration1')
            ]);
            if (generation !== this.generation) return false;
            this.analysisCore = { ...mask, ...region };
            if (typeof FilesetResolver === 'undefined' || typeof ImageSegmenter === 'undefined') {
                throw new Error('MediaPipe Vision не загружен.');
            }
            const vision = await FilesetResolver.forVisionTasks(
                "js/vendor/mediapipe/wasm"
            );
            if (generation !== this.generation) return false;
            const modelPath = this.segmentationType === 'selfie_multiclass'
                ? "js/vendor/mediapipe/models/selfie_multiclass_256x256.tflite"
                : "js/vendor/mediapipe/models/selfie_segmenter.tflite";
            const model = await ImageSegmenter.createFromOptions(vision, {
                baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
                runningMode: this.runningMode,
                outputCategoryMask: true,
                outputConfidenceMasks: true
            });
            if (generation !== this.generation) { model.close(); return false; }
            this.imageSegmenter = model;
            this.isInitialized = true;
            this.initializationFailed = false;
            this._notify(this.onInitialized, [], 'initialization:callback-failed');
            return true;
        } catch (error) {
            if (generation !== this.generation) return false;
            this.initializationFailed = true;
            segmentInlineDiagnostic?.participantDebugErrorOnce(this, 'segment', 'initialization:failed');
            this._notify(this.onError, [error], 'error:callback-failed');
            return false;
        }
    }

    _notify(callback, args, event) {
        if (typeof callback !== 'function') return;
        void Promise.resolve().then(() => callback.apply(this, args)).catch(() => {
            segmentInlineDiagnostic?.participantDebugErrorOnce(this, 'segment', event);
        });
    }

    async segmentFrame(videoElement, faceLandmarks = null) {
        const generation = this.generation;
        if (!this.isInitialized && (this.initializationFailed || !await this.initialize())) {
            return this._createErrorResult('segment_model_unavailable');
        }
        if (generation !== this.generation) return this._createErrorResult('segment_analysis_interrupted');
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
        } catch (_) {
            segmentInlineDiagnostic?.participantDebugErrorOnce(this, 'segment', 'inference:failed');
            return this._createErrorResult('segment_inference_failed');
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
    reset() {
        this.generation++;
        this.initializing = null;
        this.initializationFailed = false;
        this.lastResult = null;
        segmentInlineDiagnostic?.resetParticipantDiagnostics(this);
    }
    dispose() {
        if (this.imageSegmenter) { this.imageSegmenter.close(); this.imageSegmenter = null; }
        this.isInitialized = false; this.reset();
    }
}

// CommonJS export (для node-тестов).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FaceSegmenterInline;
}

if (typeof window !== 'undefined') {
    window.FaceSegmenter = FaceSegmenterInline;
    window.FaceSegmenterReady = import('./face-segmenter/index.js?v=20261110-integration1')
        .then(module => {
            const Model = module.FaceSegmenter || module.default;
            if (typeof Model !== 'function') throw new Error('segment_export_missing');
            window.FaceSegmenter = Model;
            return 'module';
        })
        .catch(() => {
            void import('./session-runtime/participant-diagnostic.mjs?v=20261110-integration1').then(
                diagnostic => {
                    segmentInlineDiagnostic = diagnostic;
                    diagnostic.participantDebugError('segment', 'module:inline-fallback');
                },
                () => { /* Diagnostics are optional. */ }
            );
            return 'inline';
        });
}
