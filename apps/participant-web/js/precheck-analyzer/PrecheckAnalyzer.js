/**
 * PreCheck Analyzer Module v2.1
 * Анализ лица через MediaPipe Face Landmarker
 * 
 * @version 2.1.0
 * @requires @mediapipe/tasks-vision
 * @module precheck-analyzer/PrecheckAnalyzer
 */

import { LANDMARKS } from './constants.js';
import { createThresholds, HISTORY_SIZE } from './thresholds.js';
import { analyzeIllumination } from './illumination.js';
import { parseFaceResults, extractBlendShapes } from './face-parser.js';
import { analyzePose, checkStability, checkEyesCentering, addToHistory } from './pose-analyzer.js';
import { analyzeEyes } from './eyes-analyzer.js';
import { analyzeMouth } from './mouth-analyzer.js';

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
            console.log('[PrecheckAnalyzer] MediaPipe Face Landmarker готов');
            
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

        const startTime = performance.now();
        
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
            
            const illumination = analyzeIllumination(imageData, this.thresholds.illumination);
            
            const timestamp = performance.now();
            const mpResults = this.faceLandmarker.detectForVideo(videoElement, timestamp);
            
            const faceData = parseFaceResults(mpResults, width, height, this.thresholds.face);
            const eyes = analyzeEyes(mpResults, width, height, this.thresholds.eyes);
            const pose = analyzePose(mpResults, this.thresholds.pose);
            const landmarks = mpResults.faceLandmarks?.[0] || null;
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
            
            this.lastResult = {
                illumination, face: faceData, pose, eyes, mouth,
                blendShapes: extractBlendShapes(mpResults),
                landmarks, timestamp: Date.now(),
                frameSize: { width, height },
                analysisTime: Math.round(analysisTime)
            };

            return this.lastResult;
            
        } catch (error) {
            console.error('[PrecheckAnalyzer] Ошибка:', error);
            return this._createErrorResult(error.message);
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
            timestamp: Date.now()
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

export default PrecheckAnalyzer;
export { PrecheckAnalyzer };
