import { extractEyeSignalSample } from '../web-page/eye-signal.js';
import { updateFromMetrics as updateQcOverlay } from '../qc-pause-overlay-new.js';
import { SessionQualityDetector } from './quality-detector.mjs';
import { ERROR_KINDS } from './contracts.mjs';
import { ContinuousBpmCollector } from './continuous-bpm.js';
import {
    appendEmotionSample,
    endEmotionSession,
    getEmotionSample,
    getEmotionSummary,
    startEmotionSession
} from '../emotion-stub-new.js';
import { ContinuousBodyPoseCollector } from './continuous-body-pose.js';
import { getContentViewport } from '../gaze-tracker/viewport-coordinates.mjs';
import { updateHeadPoseGuide } from '../gaze-tracker/head-pose-guide.js?v=20260909-1';

const TARGET_INTERVAL_MS = 33;
const SAME_FRAME_RETRY_MS = 8;

function getVideoTime(video) {
    if (!video || video.readyState < 2) return -1;
    return Number.isFinite(video.currentTime) ? video.currentTime : -1;
}

export class SessionFramePipeline {
    constructor(options) {
        this.state = options.state;
        this.controller = options.controller;
        this.video = options.video;
        this.active = false;
        this.timeoutId = null;
        this.lastVideoTime = -1;
        this.segmenterStride = 3;
        this.segmenterCounter = 0;
        this.segmenterInFlight = false;
        this.lastSegmenterResult = null;
        this.emotionStride = 6;
        this.emotionCounter = 0;
        this.bodyPoseStride = 6;
        this.bodyPoseCounter = 0;
        this.qualityDetector = new SessionQualityDetector();
        this.bpmErrorReported = false;
        this.analysisErrorReported = false;
        this.bpm = new ContinuousBpmCollector({
            getFps: () => {
                const fps = this.state.sessionData?.tech?.cameraFPS;
                return Number.isFinite(fps) && fps > 0 ? fps : 30;
            },
            onError: error => this._reportBpmError(error),
            onRecovered: () => this._recoverBpm()
        });
        this.bodyPose = new ContinuousBodyPoseCollector({
            state: this.state,
            onError: error => this._reportBodyPoseError(error),
            enabled: this.controller.featureFlags?.bodyMovement !== false,
            gamerMode: this.controller.featureFlags?.gamerMode === true,
            clock: this.controller.sessionClock
        });
        this.boundTrackEnded = () => {
            this.controller.reportIssue({
                kind: ERROR_KINDS.TECHNICAL,
                code: 'camera_track_ended',
                message: 'Камера перестала передавать изображение.',
                recoverable: true
            });
        };
    }

    async start() {
        if (this.active) return true;
        if (!this.video?.srcObject || !this.state.runtime.localAnalyzer) {
            return false;
        }
        this.active = true;
        this.lastVideoTime = -1;
        this.qualityDetector.reset();
        startEmotionSession(this.state.sessionData?.ids?.session || null);
        this.controller.setModuleStatus('emotion', 'running');
        for (const track of this.video.srcObject.getVideoTracks?.() || []) {
            track.addEventListener('ended', this.boundTrackEnded);
        }
        this.bpm.start().then(ready => {
            if (this.active) {
                this.controller.setModuleStatus('bpm', ready ? 'running' : 'failed');
            }
        });
        this.controller.setModuleStatus('bodyPose', 'initializing');
        this.bodyPose.start().then(ready => {
            if (this.active) {
                this.controller.setModuleStatus(
                    'bodyPose',
                    ready ? 'running' : (this.bodyPose.enabled ? 'failed' : 'disabled')
                );
            }
        });
        this._schedule(0);
        return true;
    }

    isRunning() {
        return this.active;
    }

    _schedule(delayMs) {
        if (!this.active) return;
        this.timeoutId = setTimeout(() => this._tick(), delayMs);
    }

    async _tick() {
        if (!this.active) return;
        const started = performance.now();
        try {
            const videoTime = getVideoTime(this.video);
            if (videoTime < 0 || videoTime === this.lastVideoTime) {
                this._schedule(SAME_FRAME_RETRY_MS);
                return;
            }
            this.lastVideoTime = videoTime;

            const frame = await this.state.runtime.localAnalyzer.analyzeFrame(this.video);
            if (!this.active) return;
            this.state.runtime.lastPrecheckResult = frame;
            updateHeadPoseGuide(frame);
            this.state.runtime.lastPoseData = frame?.pose
                ? {
                    yaw: frame.pose.yaw ?? null,
                    pitch: frame.pose.pitch ?? null,
                    roll: frame.pose.roll ?? null
                }
                : null;

            let gaze = null;
            if (
                this.state.runtime.gazeTracker?.isCalibrated?.()
                && Array.isArray(frame?.landmarks)
            ) {
                const viewport = getContentViewport();
                this.state.runtime.gazeTracker.updateScreenSize(
                    viewport.width,
                    viewport.height
                );
                gaze = this.state.runtime.gazeTracker.predict(frame.landmarks, {
                    timestamp: frame.timestamp,
                    wallTimestamp: frame.wallTimestamp,
                    pose: frame.pose,
                    frameSize: frame.frameSize
                });
                if (gaze && window.handleGazeUpdate) window.handleGazeUpdate(gaze);
            } else if (window.handleGazeUpdate) {
                window.handleGazeUpdate(null);
            }

            const eyeSignal = extractEyeSignalSample(frame, Date.now());
            if (eyeSignal && window.handleEyeSignalUpdate) {
                window.handleEyeSignalUpdate(eyeSignal);
            }

            this._processEmotion(frame);
            const body = this._processBodyPose();
            this.controller.captureMultimodalFrame({ frame, gaze, body });
            this._scheduleSegmentation(frame);

            if (this.state.runtime.qcMetrics?.isRunning?.()) {
                this.state.runtime.qcMetrics.processFrame(frame, this.lastSegmenterResult);
                const metrics = this.state.runtime.qcMetrics.getCurrentMetrics();
                updateQcOverlay(metrics, frame);
            }

            const qualityChanges = this.qualityDetector.update(
                frame,
                this.lastSegmenterResult,
                Date.now(),
                { cameraFps: this.state.cameraFpsState?.currentFps }
            );
            for (const issue of qualityChanges.raised) this.controller.reportIssue(issue);
            for (const code of qualityChanges.resolved) this.controller.resolveIssue(code);

            if (Array.isArray(frame?.landmarks)) {
                this.bpm.process(this.video, frame.landmarks, performance.now());
            }
            if (this.analysisErrorReported && !frame?.error && !frame?.errorMessage) {
                this.analysisErrorReported = false;
                this.controller.resolveIssue('frame_pipeline_exception');
            }
        } catch (error) {
            if (!this.active) return;
            if (!this.analysisErrorReported) {
                this.analysisErrorReported = true;
                this.controller.reportIssue({
                    kind: ERROR_KINDS.TECHNICAL,
                    code: 'frame_pipeline_exception',
                    message: `Ошибка анализа видеопотока: ${error?.message || String(error)}`,
                    recoverable: true
                });
            }
        }

        const elapsed = performance.now() - started;
        this._schedule(Math.max(0, TARGET_INTERVAL_MS - elapsed));
    }

    _scheduleSegmentation(frame) {
        this.segmenterCounter += 1;
        if (this.segmenterCounter < this.segmenterStride) return;
        this.segmenterCounter = 0;
        if (
            this.segmenterInFlight
            || !this.state.runtime.faceSegmenter
            || !Array.isArray(frame?.landmarks)
        ) {
            return;
        }
        this.segmenterInFlight = true;
        this.state.runtime.faceSegmenter.segmentFrame(this.video, frame.landmarks)
            .then(result => {
                if (this.active) this.lastSegmenterResult = result;
            })
            .catch(() => {
                // Face visibility is also checked by MediaPipe landmarks; a single
                // segmenter failure must not invalidate the whole block.
            })
            .finally(() => {
                this.segmenterInFlight = false;
            });
    }

    _processEmotion(frame) {
        this.emotionCounter += 1;
        if (this.emotionCounter < this.emotionStride) return;
        this.emotionCounter = 0;
        const sample = getEmotionSample(frame);
        this.state.runtime.lastEmotionSample = sample?.degraded ? null : sample;
        appendEmotionSample(this.state, sample, Date.now());
    }

    _processBodyPose() {
        this.bodyPoseCounter += 1;
        if (this.bodyPoseCounter < this.bodyPoseStride) return null;
        this.bodyPoseCounter = 0;
        return this.bodyPose.process(this.video, performance.now());
    }

    _reportBpmError(error) {
        if (!this.active || this.bpmErrorReported) return;
        this.bpmErrorReported = true;
        this.controller.reportIssue({
            kind: ERROR_KINDS.TECHNICAL,
            code: 'bpm_module_failed',
            message: `Модуль BPM недоступен: ${error?.message || String(error)}`,
            recoverable: true,
            invalidatesBlock: false
        });
        this.controller.setModuleStatus('bpm', 'failed');
    }

    _recoverBpm() {
        if (!this.active || !this.bpmErrorReported) return;
        this.bpmErrorReported = false;
        this.controller.resolveIssue('bpm_module_failed');
        this.controller.setModuleStatus('bpm', 'running');
    }

    _reportBodyPoseError(error) {
        if (!this.active) return;
        this.controller.reportIssue({
            kind: ERROR_KINDS.TECHNICAL,
            code: 'body_pose_module_failed',
            message: `Модуль анализа корпуса недоступен: ${error?.message || String(error)}`,
            recoverable: false,
            invalidatesBlock: false
        });
    }

    getBpmSnapshot() {
        return this.bpm.snapshot();
    }

    stop(reason = 'session_finish') {
        if (!this.active && this.bpm.finalized) return null;
        this.active = false;
        if (this.timeoutId) clearTimeout(this.timeoutId);
        this.timeoutId = null;
        for (const track of this.video?.srcObject?.getVideoTracks?.() || []) {
            track.removeEventListener('ended', this.boundTrackEnded);
        }
        this.state.sessionData.bodyPoseSummary = this.bodyPose.stop();
        this.state.sessionData.emotionSummary = {
            ...getEmotionSummary(this.state.sessionData),
            lifecycle: endEmotionSession()
        };
        this.state.runtime.lastEmotionSample = null;
        return this.bpm.finalize(reason);
    }
}
