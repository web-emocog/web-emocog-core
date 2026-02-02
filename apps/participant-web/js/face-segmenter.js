/**
 * Face Segmenter Module v1.2 - Browser Wrapper
 * 
 * Этот файл служит обёрткой для обратной совместимости.
 * Основной код находится в папке ./face-segmenter/
 * 
 * @version 1.2.0
 * @requires @mediapipe/tasks-vision
 */

// Встроенный класс для browser (без ES modules)
class FaceSegmenter {
    constructor(options = {}) {
        this.isInitialized = false;
        this.imageSegmenter = null;
        this.runningMode = options.runningMode || "VIDEO";
        this.segmentationType = options.segmentationType || "selfie_multiclass";
        
        this.thresholds = {
            maskConfidence: options.maskConfidence ?? 0.5,
            // ПОВЫШЕНЫ пороги чтобы уменьшить ложные срабатывания
            minSkinVisibility: options.minSkinVisibility ?? 0.6,      // было 0.60
            minTotalFaceSkin: options.minTotalFaceSkin ?? 0.55,        // было 0.55
            hairOcclusionThreshold: options.hairOcclusionThreshold ?? 0.25,  // было 0.25
            handOcclusionThreshold: options.handOcclusionThreshold ?? 0.05,  // было 0.05
            globalHandThreshold: options.globalHandThreshold ?? 0.08,  // было 0.08 - ГЛАВНАЯ ПРОБЛЕМА
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
            console.log('[FaceSegmenter] Инициализация v1.2...');
            if (typeof FilesetResolver === 'undefined' || typeof ImageSegmenter === 'undefined') {
                throw new Error('MediaPipe Vision не загружен.');
            }
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
            );
            const modelPath = this.segmentationType === 'selfie_multiclass'
                ? "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"
                : "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
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
        if (!this.isInitialized) await this.initialize();
        if (!videoElement || videoElement.readyState < 2) {
            return this._createErrorResult('Видео не готово');
        }
        try {
            const width = videoElement.videoWidth || 640;
            const height = videoElement.videoHeight || 480;
            const timestamp = performance.now();
            const segResult = this.imageSegmenter.segmentForVideo(videoElement, timestamp);
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
            if (segResult.categoryMask) segResult.categoryMask.close();
            if (segResult.confidenceMasks) segResult.confidenceMasks.forEach(m => m.close());
            return this.lastResult;
        } catch (error) {
            return this._createErrorResult(error.message);
        }
    }

    // Методы анализа - упрощённые версии (полные в модуле)
    _analyzeMasks(segResult, w, h, landmarks) {
        const result = { hasData: false, classDistribution: {}, faceRegion: null };
        const mask = segResult.categoryMask;
        if (!mask) return result;
        result.hasData = true;
        const data = mask.getAsUint8Array();
        const mW = mask.width, mH = mask.height;
        result._rawMaskData = new Uint8Array(data);
        result._maskDimensions = { width: mW, height: mH };
        const counts = new Array(6).fill(0);
        for (let i = 0; i < data.length; i++) {
            if (data[i] < 6) counts[data[i]]++;
        }
        for (let i = 0; i < 6; i++) {
            result.classDistribution[this.CLASS_NAMES[i]] = {
                count: counts[i], ratio: counts[i] / data.length
            };
        }
        result.faceRegion = this._extractFaceRegion(data, mW, mH, landmarks, w, h);
        return result;
    }

    _extractFaceRegion(data, mW, mH, landmarks, fW, fH) {
        let box = { x: 0.2, y: 0.1, width: 0.6, height: 0.8 };
        if (landmarks && landmarks.length > 0) {
            let minX=1, maxX=0, minY=1, maxY=0;
            for (const p of landmarks) {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            const pad = 0.1;
            box = {
                x: Math.max(0, minX - (maxX-minX)*pad),
                y: Math.max(0, minY - (maxY-minY)*pad),
                width: Math.min(1, (maxX-minX)*(1+2*pad)),
                height: Math.min(1, (maxY-minY)*(1+2*pad))
            };
        }
        const sX = Math.floor(box.x*mW), eX = Math.floor((box.x+box.width)*mW);
        const sY = Math.floor(box.y*mH), eY = Math.floor((box.y+box.height)*mH);
        const stats = { totalPixels:0, faceSkin:0, hair:0, background:0, bodySkin:0, clothes:0, others:0 };
        for (let y=sY; y<eY; y++) {
            for (let x=sX; x<eX; x++) {
                const idx = y*mW+x;
                if (idx >= data.length) continue;
                stats.totalPixels++;
                const c = data[idx];
                if (c===3) stats.faceSkin++;
                else if (c===1) stats.hair++;
                else if (c===0) stats.background++;
                else if (c===2) stats.bodySkin++;
                else if (c===4) stats.clothes++;
                else stats.others++;
            }
        }
        const t = stats.totalPixels || 1;
        return {
            boundingBox: box, stats,
            ratios: {
                faceSkin: stats.faceSkin/t, hair: stats.hair/t,
                background: stats.background/t, bodySkin: stats.bodySkin/t,
                clothes: stats.clothes/t, others: stats.others/t,
                totalSkin: (stats.faceSkin+stats.bodySkin)/t,
                occlusion: (stats.hair+stats.others+stats.clothes)/t
            }
        };
    }

    _analyzeFaceRegionsVisibility(maskAnalysis, landmarks, fW, fH) {
        if (!maskAnalysis.hasData) {
            return { isComplete: false, score: 0, issues: ['no_data'], regions: {} };
        }
        const issues = [];
        let score = 100;
        const regions = {};
        let handDetected = false;
        
        if (maskAnalysis.faceRegion) {
            const bodyRatio = maskAnalysis.faceRegion.ratios.bodySkin;
            regions.globalBodySkinRatio = bodyRatio;
            if (bodyRatio >= this.thresholds.globalHandThreshold) {
                handDetected = true;
                issues.push('hand_on_face');
                score -= 30;
            }
            const skinRatio = maskAnalysis.faceRegion.ratios.faceSkin;
            regions.totalFaceSkinVisibility = skinRatio;
            if (skinRatio < this.thresholds.minTotalFaceSkin) {
                issues.push('low_skin_visibility');
                score -= 20;
            }
        }
        
        const uniqueIssues = [...new Set(issues)];
        const isComplete = score >= 70 && uniqueIssues.length === 0 && !handDetected;
        
        return {
            isComplete, score: Math.max(0, score),
            issues: uniqueIssues, regions,
            handDetected, thresholds: this.thresholds
        };
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

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FaceSegmenter;
}

// Browser global
if (typeof window !== 'undefined') {
    window.FaceSegmenter = FaceSegmenter;
}
