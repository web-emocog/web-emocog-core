import { extractEyeSignalSample } from '../web-page/eye-signal.js';
import { updateFromMetrics as updateQcOverlay } from '../qc-pause-overlay-new.js';
import { SessionQualityDetector } from './quality-detector.mjs?v=20261025-1';
import { ERROR_KINDS } from './contracts.mjs';
import { ContinuousBpmCollector } from './continuous-bpm.js?v=20261025-1';
import {
    appendEmotionSample,
    endEmotionSession,
    getEmotionSample,
    getEmotionSummary,
    startEmotionSession
} from '../emotion-stub-new.js';
import { ContinuousBodyPoseCollector } from './continuous-body-pose.js?v=20261025-1';
import { getContentViewport } from '../gaze-tracker/viewport-coordinates.mjs';
import { updateHeadPoseGuide } from '../gaze-tracker/head-pose-guide.js?v=20261025-1';
import { getFramePixels } from './frame-pixels.mjs';
import { observeVideoFrames } from './video-frames.mjs';

const TARGET_INTERVAL_MS = 33;
const SAME_FRAME_RETRY_MS = 8;
const SEGMENT_MAX_AGE_MS = 1000;

function frameContext(state) {
    const task = state.runtime.taskContext || {};
    return { phase: state.runtime.currentPhase || null, blockId: task.blockId ?? null,
        trialId: task.trialId ?? null, stimulusId: task.stimulusId ?? null, attempt: task.attempt ?? null };
}

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
        this.videoFrameSequence = 0;
        this.videoFrameObserver = null;
        this.cameraFrames = 0;
        this.cameraWindowStarted = 0;
        this.cameraEmptySince = null;
        this.cameraStallReported = false;
        this.segmenterStride = 3;
        this.segmenterCounter = 0;
        this.lastSegmenterResult = null;
        this.lastSegmenterCapturedAt = 0;
        this.emotionStride = 6;
        this.emotionCounter = 0;
        this.bodyPoseStride = 6;
        this.bodyPoseCounter = 0;
        this.auxiliaryTimer = null;
        this.auxiliaryBusy = false;
        this.lastAuxiliaryTask = null;
        this.generation = 0;
        this.diagnostics = { version: 'frame_pipeline.v2', frames: 0, primaryMsTotal: 0,
            primaryMsMax: 0, auxiliaryDeferredFrames: 0, segmentFrames: 0, poseFrames: 0,
            segmentMsTotal: 0, poseMsTotal: 0 };
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
            onRecovered: () => {
                if (!this.active) return;
                this.controller.resolveIssue('body_pose_module_failed');
                this.controller.setModuleStatus('bodyPose', 'running');
            },
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
        this.generation++;
        const generation = this.generation;
        this.segmenterCounter = 0;
        this.bodyPoseCounter = 0;
        this.lastSegmenterResult = null;
        this.lastVideoTime = -1;
        this.videoFrameSequence = 0;
        this.videoFrameObserver?.stop();
        this.cameraFrames = 0;
        this.cameraWindowStarted = performance.now();
        this.cameraEmptySince = null;
        this.videoFrameObserver = observeVideoFrames(this.video, (_now, count) => {
            this.videoFrameSequence++;
            this.cameraFrames += count;
        });
        this.diagnostics.frameIdentityMethod = this.videoFrameObserver.method;
        this.qualityDetector.reset();
        startEmotionSession(this.state.sessionData?.ids?.session || null);
        this.controller.setModuleStatus('emotion', 'running');
        for (const track of this.video.srcObject.getVideoTracks?.() || []) {
            track.addEventListener('ended', this.boundTrackEnded);
        }
        this.bpm.start().then(ready => {
            if (this.active && generation === this.generation) {
                this.controller.setModuleStatus('bpm', ready ? 'running' : 'failed');
            }
        });
        this.controller.setModuleStatus('bodyPose', 'initializing');
        this.bodyPose.start().then(ready => {
            if (this.active && generation === this.generation) {
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

    _publishCameraFps(now) {
        if (!this.videoFrameObserver || now - this.cameraWindowStarted < 1000) return;
        const fps = Math.round(this.cameraFrames * 1000 / (now - this.cameraWindowStarted));
        const cameraState = this.state.cameraFpsState ||= {};
        cameraState.currentFps = fps;
        cameraState.method = this.videoFrameObserver.method;
        this.diagnostics.frameIdentityMethod = this.videoFrameObserver.method;
        this.state.runtime.qcMetrics?.setCameraFps?.(fps, {
            frames: this.cameraFrames, durationMs: now - this.cameraWindowStarted,
            method: this.videoFrameObserver.method
        });
        // No face result arrives during a camera stall, so the frame-based QC
        // detector alone cannot report this acquisition failure.
        if (this.active && this.cameraFrames === 0) {
            if (this.cameraEmptySince === null) this.cameraEmptySince = this.cameraWindowStarted;
            if (!this.cameraStallReported && now - this.cameraEmptySince >= this.qualityDetector.rules.low_fps.holdMs) {
                this.cameraStallReported = true;
                this.controller.reportIssue({ kind: ERROR_KINDS.TECHNICAL, code: 'camera_frames_stalled',
                    message: 'Камера перестала передавать новые кадры.', recoverable: true });
            }
        } else if (this.active && this.cameraFrames > 0) {
            this.cameraEmptySince = null;
            if (this.cameraStallReported) {
                this.cameraStallReported = false;
                this.controller.resolveIssue('camera_frames_stalled');
            }
        }
        this.cameraFrames = 0;
        this.cameraWindowStarted = now;
    }

    async _tick() {
        if (!this.active) return;
        const generation = this.generation;
        const started = performance.now();
        this._publishCameraFps(started);
        try {
            const videoTime = this.videoFrameObserver
                ? (this.videoFrameSequence > 0 ? this.videoFrameSequence : -1) : getVideoTime(this.video);
            if (videoTime < 0 || videoTime === this.lastVideoTime) {
                this._schedule(SAME_FRAME_RETRY_MS);
                return;
            }
            this.lastVideoTime = videoTime;

            const context = frameContext(this.state);
            const frame = await this.state.runtime.localAnalyzer.analyzeFrame(this.video);
            if (!this.active || generation !== this.generation) return;
            if (JSON.stringify(context) !== JSON.stringify(frameContext(this.state))) {
                this.diagnostics.contextBoundaryFrames = (this.diagnostics.contextBoundaryFrames || 0) + 1;
                this._schedule(0);
                return;
            }
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

            const eyeSignal = extractEyeSignalSample(frame, frame.wallTimestamp ?? Date.now());
            if (eyeSignal && window.handleEyeSignalUpdate) {
                window.handleEyeSignalUpdate(eyeSignal);
            }

            this._processEmotion(frame);
            const multimodalSample = this.controller.captureMultimodalFrame({ frame, gaze });

            const segmentation = this._currentSegmentation();
            if (!segmentation) this.diagnostics.segmentationUnavailableFrames = (this.diagnostics.segmentationUnavailableFrames || 0) + 1;
            if (this.state.runtime.qcMetrics?.isRunning?.()) {
                this.state.runtime.qcMetrics.processFrame(frame, segmentation);
                const metrics = this.state.runtime.qcMetrics.getCurrentMetrics();
                this.controller.updateProtocolQuality?.(metrics);
                updateQcOverlay(metrics, frame);
            }

            const qualityChanges = this.qualityDetector.update(
                frame,
                segmentation,
                Date.now(),
                { cameraFps: this.state.cameraFpsState?.currentFps }
            );
            for (const issue of qualityChanges.raised) this.controller.reportIssue(issue);
            for (const code of qualityChanges.resolved) this.controller.resolveIssue(code);

            if (Array.isArray(frame?.landmarks)) {
                this.bpm.process(this.video, frame.landmarks, frame.timestamp, getFramePixels(frame), frame.wallTimestamp);
            }
            this._scheduleAuxiliary(frame, multimodalSample);
            const elapsed = performance.now() - started;
            this.diagnostics.frames++;
            this.diagnostics.primaryMsTotal += elapsed;
            this.diagnostics.primaryMsMax = Math.max(this.diagnostics.primaryMsMax, elapsed);
            if (!this.state.sessionData.tech) this.state.sessionData.tech = {};
            this.state.sessionData.tech.framePipeline = { ...this.diagnostics,
                faceBackend: this.state.runtime.localAnalyzer.backend || 'legacy_main',
                segmentBackend: this.state.runtime.faceSegmenter?.backend || 'legacy_main',
                segmentDelegate: this.state.runtime.faceSegmenter?.inferenceDelegate || null,
                segmentDelegatePolicy: 'rgba-mask-readback.v2',
                segmentDelegateFallbackReason: this.state.runtime.faceSegmenter?.cpuFallbackReason || null,
                poseBackend: this.bodyPose.backend,
                fallbackReasons: [this.state.runtime.localAnalyzer.workerFallbackReason,
                    this.state.runtime.faceSegmenter?.workerFallbackReason, this.bodyPose.workerFallbackReason].filter(Boolean),
                segmentStride: this.segmenterStride, bodyPoseStride: this.bodyPoseStride,
                emotionStride: this.emotionStride };
            if (this.analysisErrorReported && !frame?.error && !frame?.errorMessage) {
                this.analysisErrorReported = false;
                this.controller.resolveIssue('frame_pipeline_exception');
            }
        } catch (error) {
            if (!this.active || generation !== this.generation) return;
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
        if (this.active && generation === this.generation) this._schedule(Math.max(0, TARGET_INTERVAL_MS - elapsed));
    }

    _currentSegmentation(now = performance.now()) {
        const age = now - this.lastSegmenterCapturedAt;
        return age >= 0 && age <= SEGMENT_MAX_AGE_MS ? this.lastSegmenterResult : null;
    }

    _scheduleAuxiliary(frame, multimodalSample) {
        this.segmenterCounter++;
        this.bodyPoseCounter++;
        const segmentDue = this.segmenterCounter >= this.segmenterStride
            && this.state.runtime.faceSegmenter && Array.isArray(frame?.landmarks);
        const poseDue = this.bodyPoseCounter >= this.bodyPoseStride && this.bodyPose.ready;
        if (!segmentDue && !poseDue) return;
        if (this.auxiliaryBusy) { this.diagnostics.auxiliaryDeferredFrames++; return; }
        const task = poseDue && (!segmentDue || this.lastAuxiliaryTask === 'segment') ? 'pose' : 'segment';
        if (task === 'pose') this.bodyPoseCounter = 0;
        else this.segmenterCounter = 0;
        this.lastAuxiliaryTask = task;
        this.auxiliaryBusy = true;
        const generation = this.generation;
        const source = getFramePixels(frame) || this.video;
        const taskContext = this.state.runtime.taskContext || {};
        const context = { blockId: taskContext.blockId ?? null, trialId: taskContext.trialId ?? null,
            stimulusId: taskContext.stimulusId ?? null, phase: this.state.runtime.currentPhase || null,
            wallTime: frame.wallTimestamp ?? Date.now(),
            clockStamp: this.controller.sessionClock?.now?.({ performanceNowMs: frame.timestamp }) || null };
        // Yield to keyboard/paint first; never queue old camera frames behind a model.
        this.auxiliaryTimer = setTimeout(async () => {
            this.auxiliaryTimer = null;
            const started = performance.now();
            try {
                if (!this.active || generation !== this.generation) return;
                if (task === 'pose') {
                    const body = await this.bodyPose.process(source, frame.timestamp, context);
                    if (this.active && generation === this.generation && body && multimodalSample) {
                        multimodalSample.body = { valid: body.valid !== false && body.ood !== true,
                            confidence: body.confidence, movementVelocity: body.movementVelocity,
                            movementBurst: body.movementBurst === true };
                    }
                } else {
                    const result = await this.state.runtime.faceSegmenter.segmentFrame(source, frame.landmarks, frame.timestamp);
                    if (this.active && generation === this.generation) {
                        this.lastSegmenterResult = result?.error ? null : result;
                        this.lastSegmenterCapturedAt = frame.timestamp;
                    }
                }
                if (this.active && generation === this.generation) {
                    this.diagnostics[`${task}Frames`]++;
                    this.diagnostics[`${task}MsTotal`] += performance.now() - started;
                }
            } catch (error) {
                if (task === 'pose') this._reportBodyPoseError(error);
            } finally {
                if (generation === this.generation) this.auxiliaryBusy = false;
            }
        }, 0);
    }

    _processEmotion(frame) {
        this.emotionCounter += 1;
        if (this.emotionCounter < this.emotionStride) return;
        this.emotionCounter = 0;
        const sample = getEmotionSample(frame);
        this.state.runtime.lastEmotionSample = sample?.degraded ? null : sample;
        appendEmotionSample(this.state, sample, frame.wallTimestamp ?? Date.now());
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
        this.controller.setModuleStatus('bodyPose', 'failed');
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
        this.videoFrameObserver?.stop();
        this.videoFrameObserver = null;
        this.generation++;
        clearTimeout(this.auxiliaryTimer);
        this.auxiliaryTimer = null;
        this.auxiliaryBusy = false;
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
