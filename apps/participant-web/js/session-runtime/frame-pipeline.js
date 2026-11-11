import { extractEyeSignalSample } from '../web-page/eye-signal.js';
import { updateFromMetrics as updateQcOverlay } from '../qc-pause-overlay-new.js?v=20261103-1';
import { SessionQualityDetector } from './quality-detector.mjs?v=20261110-integration1';
import { ERROR_KINDS } from './contracts.mjs';
import { ContinuousBpmCollector } from './continuous-bpm.js?v=20261107-resp2';
import {
    appendEmotionSample,
    endEmotionSession,
    getEmotionSample,
    getEmotionSummary,
    setExplicitNeutralBaseline,
    startEmotionSession
} from '../emotion-stub-new.js?v=20261110-integration1';
import { NeutralCalibration } from '../emotion/neutral-calibration.mjs';
import { ContinuousBodyPoseCollector } from './continuous-body-pose.js?v=20261110-integration1';
import { getContentViewport } from '../gaze-tracker/viewport-coordinates.mjs';
import { updateHeadPoseGuide } from '../gaze-tracker/head-pose-guide.js?v=20261103-1';
import { getFramePixels } from './frame-pixels.mjs';
import { observeVideoFrames } from './video-frames.mjs?v=20261104-4';
import { resolveSignalProfile, frameBudget } from './protocol-profile.mjs?v=20261110-integration1';

const SAME_FRAME_RETRY_MS = 8;
const PRIMARY_STAGES = ['face', 'guideGazeEyes', 'emotionMultimodal', 'quality', 'bpm', 'auxiliaryDispatch'];

function recordTiming(stage, durationMs) {
    stage.frames++;
    stage.totalMs += durationMs;
    stage.maxMs = Math.max(stage.maxMs, durationMs);
}

const EMPTY_TASK_CONTEXT = Object.freeze({});

function frameContext(state) {
    const task = state.runtime.taskContext || EMPTY_TASK_CONTEXT;
    return { phase: state.runtime.currentPhase || null, blockId: task.blockId ?? null,
        trialId: task.trialId ?? null, presentationId: task.presentationId ?? null,
        stimulusId: task.stimulusId ?? null, attempt: task.attempt ?? null };
}

function isCurrentFrameContext(context, state) {
    const task = state.runtime.taskContext || EMPTY_TASK_CONTEXT;
    return context.phase === (state.runtime.currentPhase || null)
        && context.blockId === (task.blockId ?? null)
        && context.trialId === (task.trialId ?? null)
        && context.presentationId === (task.presentationId ?? null)
        && context.stimulusId === (task.stimulusId ?? null)
        && context.attempt === (task.attempt ?? null);
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
        this.profile = resolveSignalProfile(options.definition || this.state.runtime.invitationProtocolDefinition);
        this.schedule = this.profile.schedule;
        this.neutralCalibration = this.profile.emotionCalibration.method === 'explicit-neutral.v2'
            ? new NeutralCalibration(this.profile.emotionCalibration) : null;
        this.active = false;
        this.timeoutId = null;
        this.primaryBusy = false;
        this.primaryStartedAt = -Infinity;
        this.lastVideoTime = -1;
        this.videoFrameSequence = 0;
        this.videoFrameObserver = null;
        this.cameraFrames = 0;
        this.cameraWindowStarted = 0;
        this.cameraEmptySince = null;
        this.cameraStallReported = false;
        this.segmenterStride = this.schedule.segmenterStride;
        this.segmenterCounter = 0;
        this.lastSegmenterResult = null;
        this.lastSegmenterCapturedAt = 0;
        this.emotionStride = this.schedule.emotionStride;
        this.emotionCounter = 0;
        this.bodyPoseStride = this.schedule.bodyPoseStride;
        this.bodyPoseCounter = 0;
        this.auxiliaryTimer = null;
        this.auxiliaryBusy = false;
        this.lastAuxiliaryTask = null;
        this.lastChannelAt = { segment: -Infinity, pose: -Infinity, emotion: -Infinity };
        this.generation = 0;
        this.diagnostics = { version: 'frame_pipeline.v2', frames: 0, primaryMsTotal: 0,
            emotionFrames: 0, emotionValidFrames: 0,
            primaryMsMax: 0, auxiliaryDeferredFrames: 0, segmentFrames: 0, poseFrames: 0,
            segmentMsTotal: 0, poseMsTotal: 0, timingMethod: 'completed-primary-stages.v1',
            stages: Object.fromEntries(PRIMARY_STAGES.map(name => [name, { frames: 0, totalMs: 0, maxMs: 0 }])) };
        this.diagnosticsPublishedAt = null;
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
        this.lastChannelAt = { segment: -Infinity, pose: -Infinity, emotion: -Infinity };
        this.bodyPoseCounter = 0;
        this.lastSegmenterResult = null;
        this.lastVideoTime = -1;
        this.videoFrameSequence = 0;
        this.primaryBusy = false;
        this.primaryStartedAt = -Infinity;
        this.videoFrameObserver?.stop();
        this.cameraFrames = 0;
        this.cameraWindowStarted = performance.now();
        this.cameraEmptySince = null;
        this.diagnosticsPublishedAt = null;
        this.videoFrameObserver = observeVideoFrames(this.video, (_now, count) => {
            this.videoFrameSequence++;
            this.cameraFrames += count;
            this._requestFrame();
        });
        this.diagnostics.frameIdentityMethod = this.videoFrameObserver.method;
        this.qualityDetector.reset();
        this.neutralCalibration?.reset();
        startEmotionSession(this.state.sessionData?.ids?.session || null, { explicitNeutral: !!this.neutralCalibration,
            requiredNeutralFrames: this.profile.emotionCalibration.minSamples });
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
        clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(() => { this.timeoutId = null; void this._tick(); }, delayMs);
    }

    _requestFrame() {
        if (!this.active || this.primaryBusy) return;
        const delay = Math.max(0, this.schedule.targetIntervalMs - (performance.now() - this.primaryStartedAt));
        if (delay > 0) this._schedule(delay);
        else {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
            void this._tick();
        }
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
        if (!this.active || this.primaryBusy) return;
        this.primaryBusy = true;
        const generation = this.generation;
        const started = performance.now();
        let retryDelay = this.schedule.targetIntervalMs;
        let failedTick = false;
        try {
            this._publishCameraFps(started);
            const videoTime = this.videoFrameObserver
                ? (this.videoFrameSequence > 0 ? this.videoFrameSequence : -1) : getVideoTime(this.video);
            if (videoTime < 0 || videoTime === this.lastVideoTime) {
                retryDelay = SAME_FRAME_RETRY_MS;
                return;
            }
            this.lastVideoTime = videoTime;
            this.primaryStartedAt = started;

            const context = frameContext(this.state);
            const frame = await this.state.runtime.localAnalyzer.analyzeFrame(this.video);
            if (!this.active || generation !== this.generation) return;
            if (!isCurrentFrameContext(context, this.state)) {
                this.diagnostics.contextBoundaryFrames = (this.diagnostics.contextBoundaryFrames || 0) + 1;
                retryDelay = 0;
                return;
            }
            const faceDone = performance.now();
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
            const guideGazeEyesDone = performance.now();

            this._processEmotion(frame);
            const multimodalSample = this.controller.captureMultimodalFrame({ frame, gaze });
            const multimodalDone = performance.now();

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
            const qualityDone = performance.now();

            const hasLandmarks = Array.isArray(frame?.landmarks) && frame.landmarks.length >= 468;
            const sample = hasLandmarks
                ? this.bpm.process(this.video, frame.landmarks, frame.timestamp, getFramePixels(frame), frame.wallTimestamp)
                : null;
            this.controller.recordPhysiologyFrame?.(frame?.timestamp, sample, this.bpm.engine?.cfg, hasLandmarks);
            const bpmDone = performance.now();
            this._scheduleAuxiliary(frame, multimodalSample);
            const finished = performance.now();
            const elapsed = finished - started;
            this.diagnostics.frames++;
            this.diagnostics.primaryMsTotal += elapsed;
            this.diagnostics.primaryMsMax = Math.max(this.diagnostics.primaryMsMax, elapsed);
            const stages = this.diagnostics.stages;
            recordTiming(stages.face, faceDone - started);
            recordTiming(stages.guideGazeEyes, guideGazeEyesDone - faceDone);
            recordTiming(stages.emotionMultimodal, multimodalDone - guideGazeEyesDone);
            recordTiming(stages.quality, qualityDone - multimodalDone);
            recordTiming(stages.bpm, bpmDone - qualityDone);
            recordTiming(stages.auxiliaryDispatch, finished - bpmDone);
            this._publishDiagnostics(false, finished);
            if (this.analysisErrorReported && !frame?.error && !frame?.errorMessage) {
                this.analysisErrorReported = false;
                this.controller.resolveIssue('frame_pipeline_exception');
            }
        } catch (error) {
            if (!this.active || generation !== this.generation) return;
            failedTick = true;
            if (!this.analysisErrorReported) {
                this.analysisErrorReported = true;
                this.controller.reportIssue({
                    kind: ERROR_KINDS.TECHNICAL,
                    code: 'frame_pipeline_exception',
                    message: `Ошибка анализа видеопотока: ${error?.message || String(error)}`,
                    recoverable: true
                });
            }
        } finally {
            if (generation === this.generation) {
                this.primaryBusy = false;
                if (this.active) {
                    if (this.videoFrameObserver) {
                        // Keep only the latest pending frame; no polling loop racing the camera.
                        if (failedTick) this._schedule(this.schedule.targetIntervalMs);
                        else if (this.videoFrameSequence > 0 && this.videoFrameSequence !== this.lastVideoTime) this._requestFrame();
                        else this._schedule(1000); // Heartbeat still detects a completely stalled camera.
                    } else this._schedule(Math.max(0, retryDelay - (performance.now() - started)));
                }
            }
        }
    }

    _publishDiagnostics(force = false, now = performance.now()) {
        if (!force && this.diagnosticsPublishedAt !== null && now - this.diagnosticsPublishedAt < 1000) return;
        this.diagnosticsPublishedAt = now;
        if (!this.state.sessionData.tech) this.state.sessionData.tech = {};
        this.state.sessionData.tech.framePipeline = { ...this.diagnostics,
            profileId: this.profile.id, schedule: this.schedule,
            budget: frameBudget({ sourceFps: this.state.cameraFpsState?.currentFps,
                primaryMs: this.diagnostics.frames > 0 ? this.diagnostics.primaryMsTotal / this.diagnostics.frames : null,
                segmentMs: this.diagnostics.segmentFrames > 0 ? this.diagnostics.segmentMsTotal / this.diagnostics.segmentFrames : null,
                poseMs: this.diagnostics.poseFrames > 0 ? this.diagnostics.poseMsTotal / this.diagnostics.poseFrames : null,
                schedule: this.schedule }),
            // Only bounded timings/counts; no frames, landmarks or per-frame history.
            stages: Object.fromEntries(PRIMARY_STAGES.map(name => [name, { ...this.diagnostics.stages[name] }])),
            faceBackend: this.state.runtime.localAnalyzer?.backend || 'legacy_main',
            faceDelegate: this.state.runtime.localAnalyzer?.inferenceDelegate || null,
            faceDelegateFallbackReason: this.state.runtime.localAnalyzer?.cpuFallbackReason || null,
            segmentBackend: this.state.runtime.faceSegmenter?.backend || 'legacy_main',
            segmentDelegate: this.state.runtime.faceSegmenter?.inferenceDelegate || null,
            segmentDelegatePolicy: 'rgba-mask-readback.v2',
            segmentDelegateFallbackReason: this.state.runtime.faceSegmenter?.cpuFallbackReason || null,
            poseBackend: this.bodyPose.enabled ? this.bodyPose.backend : 'disabled',
            fallbackReasons: [this.state.runtime.localAnalyzer?.workerFallbackReason,
                this.state.runtime.faceSegmenter?.workerFallbackReason, this.bodyPose.workerFallbackReason].filter(Boolean),
            segmentStride: this.segmenterStride, bodyPoseStride: this.bodyPoseStride,
            emotionStride: this.emotionStride, schedulingMethod: this.schedule.emotionIntervalMs ? 'elapsed-time.v2' : 'frame-notification.v1' };
    }

    _currentSegmentation(now = performance.now()) {
        const age = now - this.lastSegmenterCapturedAt;
        return age >= 0 && age <= this.schedule.segmentMaxAgeMs ? this.lastSegmenterResult : null;
    }

    _scheduleAuxiliary(frame, multimodalSample) {
        if (frame?.error || frame?.errorMessage) return;
        this.segmenterCounter++;
        this.bodyPoseCounter++;
        const at = frame.timestamp;
        const segmentDue = (this.schedule.segmentIntervalMs
            ? Number.isFinite(at) && at - this.lastChannelAt.segment >= this.schedule.segmentIntervalMs
            : this.segmenterCounter >= this.segmenterStride)
            && this.state.runtime.faceSegmenter && Array.isArray(frame?.landmarks);
        const poseDue = (this.schedule.bodyPoseIntervalMs
            ? Number.isFinite(at) && at - this.lastChannelAt.pose >= this.schedule.bodyPoseIntervalMs
            : this.bodyPoseCounter >= this.bodyPoseStride) && this.bodyPose.ready;
        if (!segmentDue && !poseDue) return;
        if (this.auxiliaryBusy) { this.diagnostics.auxiliaryDeferredFrames++; return; }
        const task = poseDue && (!segmentDue || this.lastAuxiliaryTask === 'segment') ? 'pose' : 'segment';
        if (task === 'pose') this.bodyPoseCounter = 0;
        else this.segmenterCounter = 0;
        this.lastAuxiliaryTask = task;
        this.lastChannelAt[task] = at;
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
        if (this.schedule.emotionIntervalMs) {
            if (!Number.isFinite(frame.timestamp) || frame.timestamp - this.lastChannelAt.emotion < this.schedule.emotionIntervalMs) return;
        } else if (this.emotionCounter < this.emotionStride) return;
        this.emotionCounter = 0;
        this.lastChannelAt.emotion = frame.timestamp;
        this.diagnostics.emotionFrames++;
        if (this.neutralCalibration) {
            const calibration = this.neutralCalibration;
            const before = calibration.status;
            const snapshot = calibration.add(frame, performance.now(),
                (typeof document === 'undefined' || document.visibilityState !== 'hidden')
                && this._currentSegmentation()?.isComplete === true);
            this.state.runtime.emotionCalibration = snapshot;
            this.state.sessionData.tech.emotionCalibration = snapshot;
            if (before !== 'ready' && calibration.status === 'ready') {
                setExplicitNeutralBaseline(calibration.baseline, snapshot.acceptedSamples);
                calibration.baseline = null;
            }
            if (calibration.status !== 'ready') {
                this.state.runtime.lastEmotionSample = null;
                return;
            }
        }
        const sample = getEmotionSample(frame);
        if (!sample?.degraded) this.diagnostics.emotionValidFrames++;
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
        this.primaryBusy = false;
        clearTimeout(this.auxiliaryTimer);
        this.auxiliaryTimer = null;
        this.auxiliaryBusy = false;
        if (this.timeoutId) clearTimeout(this.timeoutId);
        this.timeoutId = null;
        this._publishDiagnostics(true);
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
