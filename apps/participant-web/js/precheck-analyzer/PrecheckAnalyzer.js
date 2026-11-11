/**
 * PreCheck Analyzer Module v2.1
 * Анализ лица через MediaPipe Face Landmarker
 * 
 * @version 2.1.0
 * @requires @mediapipe/tasks-vision
 * @module precheck-analyzer/PrecheckAnalyzer
 */

import { LANDMARKS, EYE_LANDMARK_INDICES } from './constants.js';
import { createThresholds, HISTORY_SIZE } from './thresholds.js';
import { createFaceModel } from './face-model.mjs';
import { analyzeIllumination } from './illumination.js';
import { parseFaceResults, extractBlendShapes } from './face-parser.js';
import { analyzePose, checkStability, checkEyesCentering, addToHistory } from './pose-analyzer.js';
import { analyzeEyes } from './eyes-analyzer.js';
import { analyzeMouth } from './mouth-analyzer.js';
import { createAnalysisCanvas, rememberFramePixels } from '../session-runtime/frame-pixels.mjs';
import { VisionWorkerClient } from '../session-runtime/vision-worker-client.mjs?v=20261110-integration1';

import { participantDebug as dbg, participantDebugErrorOnce as dbgErrorOnce,
    notifyParticipantCallback, resetParticipantDiagnostics } from '../session-runtime/participant-diagnostic.mjs?v=20261110-integration1';

class PrecheckAnalyzer {
    constructor(options = {}) {
        this.isInitialized = false;
        this.faceLandmarker = null;
        this.videoStream = null;
        
        this.poseHistory = [];
        this.HISTORY_SIZE = HISTORY_SIZE;
        
        this.lastResult = null;
        this.lastFaceTime = 0;
        
        this.thresholds = createThresholds(options);
        this.LANDMARKS = LANDMARKS;
        
        this.onInitialized = options.onInitialized || null;
        this.onError = options.onError || null;
        
        this._canvas = null;
        this._ctx = null;
        this.runningMode = "VIDEO";
        this.workerAllowed = options.worker !== false;
        this.worker = null;
        this.initializing = null;
        this.generation = 0;
        this.backend = 'uninitialized';
        this.initializationFailed = false;
        this.inferenceFailures = 0;
    }

    async initialize() {
        if (this.isInitialized) return true;
        if (this.initializing) return this.initializing;
        this.initializing = this._initialize().finally(() => { this.initializing = null; });
        return this.initializing;
    }

    async _initialize() {
        const generation = this.generation;
        if (this.workerAllowed && VisionWorkerClient.supported()) {
            const worker = new VisionWorkerClient('face');
            this.worker = worker;
            try {
                const initialized = await worker.start({ thresholds: this.thresholds });
                if (generation !== this.generation) { worker.dispose(); return false; }
                this.backend = 'worker';
                this.inferenceDelegate = initialized?.inferenceDelegate || null;
                this.cpuFallbackReason = initialized?.delegateFallbackReason || null;
                this.isInitialized = true;
                notifyParticipantCallback(this.onInitialized, this, [], 'face', 'initialization:callback-failed');
                return true;
            } catch (_) {
                worker.dispose();
                if (generation !== this.generation) return false;
                this.worker = null;
                this.workerAllowed = false;
                this.workerFallbackReason = 'worker_initialization_failed';
            }
        }
        if (generation !== this.generation) return false;
        try {
            dbg('face', 'initialization:start');
            
            if (typeof FilesetResolver === 'undefined' || typeof FaceLandmarker === 'undefined') {
                throw new Error('MediaPipe Vision не загружен.');
            }
            
            const wasmRoot = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
            const vision = await FilesetResolver.forVisionTasks(wasmRoot);
            if (generation !== this.generation) return false;
            const modelPath = new URL(
                '../vendor/mediapipe/models/face_landmarker.task',
                import.meta.url
            ).href;
            
            const initialized = await createFaceModel(options => FaceLandmarker.createFromOptions(vision, options), {
                baseOptions: {
                    modelAssetPath: modelPath
                },
                runningMode: this.runningMode,
                ...(typeof document === 'undefined' ? { canvas: createAnalysisCanvas() } : {})
            }, () => generation === this.generation, Boolean(this.cpuFallbackReason));
            if (!initialized) return false;
            this.faceLandmarker = initialized.model;
            this.inferenceDelegate = initialized.delegate;
            this.cpuFallbackReason = this.cpuFallbackReason || initialized.fallbackReason;
            this.backend = 'main';
            this.isInitialized = true;
            this.initializationFailed = false;
            this.inferenceFailures = 0;
            dbg('face', 'initialization:ready');
            
            notifyParticipantCallback(this.onInitialized, this, [], 'face', 'initialization:callback-failed');
            return true;
            
        } catch (error) {
            if (generation !== this.generation) return false;
            this.initializationFailed = true;
            this.inferenceDelegate = null;
            this.backend = 'failed';
            dbgErrorOnce(this, 'face', 'initialization:failed');
            notifyParticipantCallback(this.onError, this, [error], 'face', 'error:callback-failed');
            return false;
        }
    }

    async analyzeFrame(videoElement, capture = {}) {
        const generation = this.generation;
        while (this.pendingFrame) await this.pendingFrame.catch(() => {});
        if (generation !== this.generation) return this._createErrorResult('Analysis interrupted');
        const pending = this._analyzeFrame(videoElement, capture);
        this.pendingFrame = pending;
        try { return await pending; }
        finally { if (this.pendingFrame === pending) this.pendingFrame = null; }
    }

    async _analyzeFrame(videoElement, capture = {}) {
        const generation = this.generation;
        if (!this.isInitialized && this.initializationFailed) return this._createErrorResult('face_model_unavailable');
        if (!this.isInitialized && !await this.initialize()) return this._createErrorResult('Analyzer unavailable');
        if (generation !== this.generation) return this._createErrorResult('Analysis interrupted');
        if (!videoElement || (videoElement.readyState !== undefined && videoElement.readyState < 2)) {
            return this._createErrorResult('Видео не готово');
        }

        if (this.worker) {
            const generation = this.generation;
            const worker = this.worker;
            try {
                const { frame, imageData } = await worker.analyze(videoElement, capture);
                if (generation !== this.generation) return this._createErrorResult('Analysis interrupted');
                if (['GPU', 'CPU'].includes(frame.inferenceDelegate)) this.inferenceDelegate = frame.inferenceDelegate;
                this.cpuFallbackReason = frame.delegateFallbackReason || this.cpuFallbackReason || null;
                this.lastResult = rememberFramePixels(frame, imageData);
                return this.lastResult;
            } catch (_) {
                if (generation !== this.generation || this.worker !== worker) return this._createErrorResult('Analysis interrupted');
                worker.dispose();
                this.worker = null;
                this.workerAllowed = false;
                this.workerFallbackReason = 'worker_runtime_failed';
                this.isInitialized = false;
                return this._createErrorResult('vision_worker_interrupted');
            }
        }

        const startTime = performance.now();
        const timestamp = capture.timestamp ?? startTime;
        const wallTimestamp = capture.wallTimestamp ?? Date.now();
        
        try {
            const width = videoElement.videoWidth || videoElement.width || 640;
            const height = videoElement.videoHeight || videoElement.height || 480;
            
            if (!this._canvas) {
                this._canvas = createAnalysisCanvas();
                this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
            }
            if (this._canvas.width !== width) this._canvas.width = width;
            if (this._canvas.height !== height) this._canvas.height = height;
            this._ctx.drawImage(videoElement, 0, 0, width, height);
            const imageData = this._ctx.getImageData(0, 0, width, height);

            // Сначала запускаем MediaPipe — нужны landmarks, чтобы illumination
            // считался по face ROI, а не по всему кадру (тёмный/светлый фон не должен
            // штрафовать пользователя при нормальном освещении лица).
            const mpResults = this.faceLandmarker.detectForVideo(videoElement, timestamp);

            const faceData = parseFaceResults(mpResults, width, height, this.thresholds.face);
            const eyes = analyzeEyes(mpResults, width, height, this.thresholds.eyes);
            const pose = analyzePose(mpResults, this.thresholds.pose);
            const landmarks = mpResults.faceLandmarks?.[0] || null;

            // Теперь — illumination по face ROI (если лицо найдено), иначе fallback на полный кадр.
            const illumination = analyzeIllumination(
                imageData,
                this.thresholds.illumination,
                landmarks,
                EYE_LANDMARK_INDICES
            );
            const eyesCentering = checkEyesCentering(landmarks, this.thresholds.pose);
            
            pose.eyesCentering = eyesCentering;
            
            if (faceData.detected) {
                if (!eyesCentering.centered) {
                    pose.status = 'off_center';
                    pose.issues = pose.issues || [];
                    pose.issues.push('eyes_off_center');
                    if (eyesCentering.hint) pose.issues.push(...eyesCentering.hint);
                } else if (pose.isTilted) {
                    pose.status = 'tilted';
                }
            }
            
            if (faceData.detected && pose.yaw !== null) {
                this.poseHistory = addToHistory(this.poseHistory, pose, faceData, this.HISTORY_SIZE);
                this.lastFaceTime = Date.now();
            }
            
            const stability = checkStability(this.poseHistory);
            pose.isStable = stability.isStable;
            
            if (pose.status !== 'off_center' && pose.status !== 'tilted') {
                pose.status = stability.isStable ? 'stable' : 'unstable';
            }
            
            const mouth = analyzeMouth(mpResults);
            const analysisTime = performance.now() - startTime;
            const blendShapes = extractBlendShapes(mpResults);

            this.lastResult = {
                illumination, face: faceData, pose, eyes, mouth,
                blendShapes,
                landmarks,
                timestamp,
                wallTimestamp,
                frameSize: { width, height },
                analysisTime: Math.round(analysisTime)
            };

            this.inferenceFailures = 0;
            return rememberFramePixels(this.lastResult, imageData);
            
        } catch (error) {
            if (this.inferenceDelegate === 'GPU' && !this.cpuFallbackReason && generation === this.generation) {
                // Context loss may happen after a successful warmup. Retry once
                // on CPU in the same worker, keeping the original capture clocks.
                this.cpuFallbackReason = 'face_gpu_inference_failed';
                try { this.faceLandmarker?.close(); } catch (_) {}
                this.faceLandmarker = null;
                this.isInitialized = false;
                // The 2D analysis canvas owns this capture already. A live
                // video may advance while the CPU model is being initialized.
                return this._analyzeFrame(this._canvas || videoElement, { ...capture, timestamp, wallTimestamp });
            }
            this.inferenceFailures++;
            if (this.inferenceFailures >= 3) {
                try { this.faceLandmarker?.close(); } catch (_) {}
                this.faceLandmarker = null;
                this.isInitialized = false;
                this.initializationFailed = true;
                this.backend = 'failed';
            }
            return this._createErrorResult('face_inference_failed');
        }
    }

    _createErrorResult(message) {
        return {
            illumination: { value: 0, status: 'unknown' },
            face: { detected: false, status: 'error', issues: [message] },
            pose: { yaw: null, pitch: null, roll: null, status: 'error' },
            eyes: { left: { isOpen: false }, right: { isOpen: false }, bothOpen: false },
            mouth: { isOpen: false },
            error: message,
            timestamp: performance.now(),
            wallTimestamp: Date.now()
        };
    }

    getLastResult() { return this.lastResult; }
    reset() {
        resetParticipantDiagnostics(this);
        this.generation++; this.worker?.reset(); this.lastResult = null; this.poseHistory = [];
        this.initializationFailed = false; this.inferenceFailures = 0;
    }
    dispose() {
        this.worker?.dispose(); this.worker = null;
        if (this.faceLandmarker) { this.faceLandmarker.close(); this.faceLandmarker = null; }
        this._canvas = null; this._ctx = null;
        this.isInitialized = false; this.reset();
    }
}

export default PrecheckAnalyzer;
export { PrecheckAnalyzer };
