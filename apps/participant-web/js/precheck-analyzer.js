/**
 * PreCheck Analyzer Module v2.1 - Browser Wrapper
 * 
 * Этот файл служит обёрткой для обратной совместимости.
 * Основной код находится в папке ./precheck-analyzer/
 * 
 * @version 2.1.0
 * @requires @mediapipe/tasks-vision
 */

// Встроенный класс для browser
class PrecheckAnalyzer {
    constructor(options = {}) {
        this.isInitialized = false;
        this.faceLandmarker = null;
        this.poseHistory = [];
        this.HISTORY_SIZE = 15;
        this.lastResult = null;
        this.lastFaceTime = 0;
        
        this.thresholds = {
            illumination: { tooDark: 30, tooBright: 220 },
            face: { minSize: 5, maxSize: 60, validZone: { minX: 0.15, maxX: 0.85, minY: 0.10, maxY: 0.90 } },
            pose: { maxYaw: 10, maxPitch: 10, maxRoll: 8, eyesCenterMaxDeviation: 0.15 },
            eyes: { earThreshold: 0.2 }
        };
        
        this.LANDMARKS = {
            LEFT_EYE: [362, 385, 387, 263, 373, 380],
            RIGHT_EYE: [33, 160, 158, 133, 153, 144],
            LEFT_IRIS: [468, 469, 470, 471, 472],
            RIGHT_IRIS: [473, 474, 475, 476, 477],
            LEFT_EYE_CENTER: 468,
            RIGHT_EYE_CENTER: 473,
            UPPER_LIP: 13,
            LOWER_LIP: 14,
            LEFT_MOUTH_CORNER: 61,
            RIGHT_MOUTH_CORNER: 291
        };
        
        this.onInitialized = options.onInitialized || null;
        this.onError = options.onError || null;
        this._canvas = null;
        this._ctx = null;
        this.runningMode = "VIDEO";
    }

    async initialize() {
        if (this.isInitialized) return true;
        try {
            console.log('[PrecheckAnalyzer] Инициализация v2.1...');
            if (typeof FilesetResolver === 'undefined' || typeof FaceLandmarker === 'undefined') {
                throw new Error('MediaPipe Vision не загружен.');
            }
            const vision = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
            );
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
            console.log('[PrecheckAnalyzer] Готов');
            if (this.onInitialized) this.onInitialized();
            return true;
        } catch (error) {
            console.error('[PrecheckAnalyzer] Ошибка:', error);
            if (this.onError) this.onError(error);
            return false;
        }
    }

    async analyzeFrame(videoElement) {
        if (!this.isInitialized) await this.initialize();
        if (!videoElement || videoElement.readyState < 2) {
            return this._createErrorResult('Видео не готово');
        }
        try {
            const width = videoElement.videoWidth || 640;
            const height = videoElement.videoHeight || 480;
            
            if (!this._canvas) {
                this._canvas = document.createElement('canvas');
                this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
            }
            this._canvas.width = width;
            this._canvas.height = height;
            this._ctx.drawImage(videoElement, 0, 0, width, height);
            const imageData = this._ctx.getImageData(0, 0, width, height);
            
            const illumination = this._analyzeIllumination(imageData);
            const timestamp = performance.now();
            const mpResults = this.faceLandmarker.detectForVideo(videoElement, timestamp);
            
            const faceData = this._parseFaceResults(mpResults, width, height);
            const eyes = this._analyzeEyes(mpResults);
            const pose = this._analyzePose(mpResults);
            const landmarks = mpResults.faceLandmarks?.[0] || null;
            
            if (faceData.detected && landmarks) {
                const centering = this._checkEyesCentering(landmarks);
                pose.eyesCentering = centering;
                if (!centering.centered) {
                    pose.status = 'off_center';
                    pose.issues = pose.issues || [];
                    pose.issues.push('eyes_off_center');
                }
            }
            
            const mouth = this._analyzeMouth(mpResults);
            
            this.lastResult = {
                illumination, face: faceData, pose, eyes, mouth,
                landmarks, timestamp: Date.now(),
                frameSize: { width, height }
            };
            return this.lastResult;
        } catch (error) {
            return this._createErrorResult(error.message);
        }
    }

    _analyzeIllumination(imageData) {
        const data = imageData.data;
        let total = 0;
        const count = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
            total += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        }
        const avg = total / count;
        let status = 'optimal';
        if (avg < this.thresholds.illumination.tooDark) status = 'too_dark';
        else if (avg > this.thresholds.illumination.tooBright) status = 'too_bright';
        return { value: Math.round((avg/255)*100), rawValue: Math.round(avg), status };
    }

    _parseFaceResults(mpResults, w, h) {
        if (!mpResults.faceLandmarks || mpResults.faceLandmarks.length === 0) {
            return { detected: false, status: 'not_found', issues: ['no_face'] };
        }
        const landmarks = mpResults.faceLandmarks[0];
        let minX=1, maxX=0, minY=1, maxY=0;
        for (const p of landmarks) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        const bbox = { x: minX, y: minY, width: maxX-minX, height: maxY-minY };
        const size = (bbox.width * bbox.height) * 100;
        return { detected: true, size: Math.round(size*10)/10, status: 'optimal', bbox, landmarkCount: landmarks.length };
    }

    _analyzePose(mpResults) {
        if (!mpResults.facialTransformationMatrixes?.length) {
            return { yaw: null, pitch: null, roll: null, status: 'no_face' };
        }
        const m = mpResults.facialTransformationMatrixes[0].data;
        const pitch = Math.asin(-m[8]) * (180/Math.PI);
        const yaw = Math.atan2(m[9], m[10]) * (180/Math.PI);
        const roll = Math.atan2(m[4], m[0]) * (180/Math.PI);
        const issues = [];
        if (Math.abs(yaw) > this.thresholds.pose.maxYaw) issues.push('yaw_exceeded');
        if (Math.abs(pitch) > this.thresholds.pose.maxPitch) issues.push('pitch_exceeded');
        if (Math.abs(roll) > this.thresholds.pose.maxRoll) issues.push('roll_exceeded');
        return {
            yaw: Math.round(yaw*10)/10, pitch: Math.round(pitch*10)/10, roll: Math.round(roll*10)/10,
            isStable: true, isTilted: issues.length > 0,
            status: issues.length > 0 ? 'tilted' : 'stable', issues
        };
    }

    _analyzeEyes(mpResults) {
        if (!mpResults.faceLandmarks?.length) {
            return { left: { isOpen: false }, right: { isOpen: false }, bothOpen: false };
        }
        const lm = mpResults.faceLandmarks[0];
        const calcEAR = (idx) => {
            const p = idx.map(i => lm[i]);
            const v1 = this._dist(p[1], p[5]);
            const v2 = this._dist(p[2], p[4]);
            const h = this._dist(p[0], p[3]);
            return h === 0 ? 0 : (v1 + v2) / (2 * h);
        };
        const leftEAR = calcEAR(this.LANDMARKS.LEFT_EYE);
        const rightEAR = calcEAR(this.LANDMARKS.RIGHT_EYE);
        const t = this.thresholds.eyes.earThreshold;
        return {
            left: { ear: Math.round(leftEAR*1000)/1000, isOpen: leftEAR > t },
            right: { ear: Math.round(rightEAR*1000)/1000, isOpen: rightEAR > t },
            bothOpen: leftEAR > t && rightEAR > t
        };
    }

    _checkEyesCentering(landmarks) {
        const left = landmarks[this.LANDMARKS.LEFT_EYE_CENTER];
        const right = landmarks[this.LANDMARKS.RIGHT_EYE_CENTER];
        if (!left || !right) return { centered: false, hint: ['no_landmarks'] };
        const midX = (left.x + right.x) / 2;
        const midY = (left.y + right.y) / 2;
        const devX = midX - 0.5, devY = midY - 0.5;
        const max = this.thresholds.pose.eyesCenterMaxDeviation;
        const centered = Math.abs(devX) <= max && Math.abs(devY) <= max;
        const hint = [];
        if (Math.abs(devX) > max) hint.push(devX > 0 ? 'move_left' : 'move_right');
        if (Math.abs(devY) > max) hint.push(devY > 0 ? 'move_up' : 'move_down');
        return { centered, deviation: { x: devX, y: devY }, hint: hint.length ? hint : null };
    }

    _analyzeMouth(mpResults) {
        if (!mpResults.faceLandmarks?.length) return { isOpen: false, openRatio: 0 };
        const lm = mpResults.faceLandmarks[0];
        const h = this._dist(lm[this.LANDMARKS.UPPER_LIP], lm[this.LANDMARKS.LOWER_LIP]);
        const w = this._dist(lm[this.LANDMARKS.LEFT_MOUTH_CORNER], lm[this.LANDMARKS.RIGHT_MOUTH_CORNER]);
        const ratio = w > 0 ? h / w : 0;
        return { isOpen: ratio > 0.1, openRatio: Math.round(ratio*100)/100 };
    }

    _dist(p1, p2) {
        const dx = p1.x - p2.x, dy = p1.y - p2.y, dz = (p1.z||0) - (p2.z||0);
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }

    _createErrorResult(msg) {
        return {
            illumination: { value: 0, status: 'unknown' },
            face: { detected: false, status: 'error', issues: [msg] },
            pose: { yaw: null, pitch: null, roll: null, status: 'error' },
            eyes: { left: { isOpen: false }, right: { isOpen: false }, bothOpen: false },
            mouth: { isOpen: false },
            error: msg, timestamp: Date.now()
        };
    }

    getLastResult() { return this.lastResult; }
    reset() { this.lastResult = null; this.poseHistory = []; }
    dispose() {
        if (this.faceLandmarker) { this.faceLandmarker.close(); this.faceLandmarker = null; }
        this._canvas = null; this._ctx = null;
        this.isInitialized = false; this.reset();
    }
}

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PrecheckAnalyzer;
}

// Browser global
if (typeof window !== 'undefined') {
    window.PrecheckAnalyzer = PrecheckAnalyzer;
}
