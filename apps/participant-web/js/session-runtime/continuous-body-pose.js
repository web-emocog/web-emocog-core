/**
 * Session-wide upper-body posture and movement collector.
 *
 * MediaPipe Tasks Vision and Pose Landmarker are Apache-2.0 licensed. The
 * collector stores normalized kinematics, not video frames.
 */
import { VisionWorkerClient } from './vision-worker-client.mjs';

const MODEL_URL = new URL(
    '../vendor/mediapipe/models/pose_landmarker_lite.task',
    import.meta.url
).href;
const LANDMARK = Object.freeze({
    LEFT_SHOULDER: 11,
    RIGHT_SHOULDER: 12,
    LEFT_HIP: 23,
    RIGHT_HIP: 24
});
const SAMPLE_CAP = 3600;

function finite(value) {
    return Number.isFinite(value) ? Number(value) : null;
}

function mean(values) {
    const valid = values.filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function percentile(values, quantile) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function midpoint(a, b) {
    return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        z: (finite(a.z) ?? 0) / 2 + (finite(b.z) ?? 0) / 2
    };
}

function landmarkConfidence(point) {
    if (!point) return 0;
    const visibility = Number.isFinite(point.visibility) ? point.visibility : 1;
    const presence = Number.isFinite(point.presence) ? point.presence : 1;
    return Math.min(visibility, presence);
}

function phaseContext(state) {
    const task = state.runtime?.taskContext || {};
    return {
        phase: state.runtime?.currentPhase || null,
        blockId: task.blockId ?? null,
        trialId: task.trialId ?? null,
        stimulusId: task.stimulusId ?? null
    };
}

export function summarizeBodyPoseState(state, movementBursts = 0) {
    const samples = Array.isArray(state?.sessionData?.bodyPoseSamples)
        ? state.sessionData.bodyPoseSamples
        : [];
    const accumulator = state?.sessionData?.bodyPoseAccumulator;
    const count = Number.isFinite(accumulator?.n) ? accumulator.n : samples.length;
    const validCount = Number.isFinite(accumulator?.validCount)
        ? accumulator.validCount
        : samples.filter(sample => sample.valid).length;
    const validSamples = samples.filter(sample => sample.valid);
    const velocities = validSamples.map(sample => sample.movementVelocity);
    return {
        version: 'body_pose_mediapipe.v1',
        source: 'mediapipe_pose_landmarker_lite',
        enabled: accumulator?.enabled !== false,
        gamerMode: accumulator?.gamerMode === true,
        coordinateSpace: 'camera_normalized_torso_delta',
        sampleCount: count,
        validSampleCount: validCount,
        oodSampleCount: accumulator?.oodCount ?? samples.filter(sample => sample.ood).length,
        occludedSampleCount: accumulator?.occludedCount ?? 0,
        retainedSampleCount: samples.length,
        retainedValidSampleCount: validSamples.length,
        durationMs: Number.isFinite(accumulator?.startedAt)
            ? Math.max(0, (accumulator.updatedAt || accumulator.startedAt) - accumulator.startedAt)
            : (samples.length > 1 ? samples.at(-1).t - samples[0].t : 0),
        confidenceMean: validCount > 0 && Number.isFinite(accumulator?.confidenceSum)
            ? finite(accumulator.confidenceSum / validCount)
            : finite(mean(validSamples.map(sample => sample.confidence))),
        movementVelocityMean: validCount > 0 && Number.isFinite(accumulator?.movementVelocitySum)
            ? finite(accumulator.movementVelocitySum / validCount)
            : finite(mean(velocities)),
        movementVelocityP95: finite(percentile(velocities, 0.95)),
        movementVelocityP95Scope: 'retained_samples',
        movementBurstCount: accumulator?.movementBurstCount ?? movementBursts,
        torsoLeanAbsMeanDeg: validCount > 0 && Number.isFinite(accumulator?.torsoLeanAbsSum)
            ? finite(accumulator.torsoLeanAbsSum / validCount)
            : finite(mean(validSamples.map(sample => Math.abs(sample.torsoLeanDeg)))),
        shoulderRollAbsMeanDeg: validCount > 0 && Number.isFinite(accumulator?.shoulderRollAbsSum)
            ? finite(accumulator.shoulderRollAbsSum / validCount)
            : finite(mean(validSamples.map(sample => Math.abs(sample.shoulderRollDeg)))),
        rawVideoStored: false,
        rawLandmarksStored: false
    };
}

export class ContinuousBodyPoseCollector {
    constructor(options = {}) {
        const { state, onError, enabled, gamerMode, clock } = options;
        this.state = state;
        this.onError = onError || (() => {});
        this.onRecovered = options.onRecovered || (() => {});
        this.enabled = enabled !== false;
        this.gamerMode = gamerMode === true;
        this.clock = clock || null;
        this.landmarker = null;
        this.ready = false;
        this.initializing = null;
        this.closed = false;
        this.generation = 0;
        this.lastTimestamp = null;
        this.lastTorsoCenter = null;
        this.lastLandmarks = null;
        this.movementBursts = 0;
        this.inBurst = false;
        this.scaleBaseline = { count: 0, shoulderWidthSum: 0, torsoHeightSum: 0 };
        this.worker = null;
        this.workerAllowed = options.worker !== false;
        this.backend = 'uninitialized';
    }

    async start() {
        if (!this.enabled) {
            this.state.sessionData.bodyPoseSummary = {
                version: 'body_pose_mediapipe.v1',
                enabled: false,
                gamerMode: this.gamerMode,
                sampleCount: 0,
                validSampleCount: 0,
                rawVideoStored: false,
                rawLandmarksStored: false
            };
            return false;
        }
        if (this.ready) return true;
        if (this.initializing) return this.initializing;
        this.closed = false;
        this._beginInitialization();
        return this.initializing;
    }

    _beginInitialization(onReady = null) {
        const pending = this._initialize(this.generation).then(ready => {
            onReady?.(ready);
            return ready;
        }).finally(() => {
            if (this.initializing === pending) this.initializing = null;
        });
        this.initializing = pending;
        return pending;
    }

    async _initialize(generation = this.generation) {
        try {
            if (this.workerAllowed && VisionWorkerClient.supported()) {
                const worker = new VisionWorkerClient('pose');
                this.worker = worker;
                try {
                    await worker.start();
                    if (this.closed || generation !== this.generation) { worker.dispose(); return false; }
                    this.ready = true; this.backend = 'worker';
                    return true;
                } catch (_) {
                    worker.dispose();
                    if (this.closed || generation !== this.generation) return false;
                    this.worker = null; this.workerAllowed = false;
                    this.workerFallbackReason = 'worker_initialization_failed';
                }
            }
            if (this.closed || generation !== this.generation) return false;
            const { FilesetResolver, PoseLandmarker } = await import(
                '../vendor/mediapipe/vision_bundle.mjs'
            );
            const wasmRoot = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
            const vision = await FilesetResolver.forVisionTasks(wasmRoot);
            const options = delegate => ({
                baseOptions: {
                    modelAssetPath: MODEL_URL,
                    ...(delegate ? { delegate } : {})
                },
                runningMode: 'VIDEO',
                numPoses: 1,
                minPoseDetectionConfidence: 0.5,
                minPosePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
                outputSegmentationMasks: false
            });
            let landmarker;
            try {
                landmarker = await PoseLandmarker.createFromOptions(vision, options('GPU'));
            } catch (_) {
                landmarker = await PoseLandmarker.createFromOptions(vision, options(null));
            }
            if (this.closed || generation !== this.generation) { landmarker.close(); return false; }
            this.landmarker = landmarker;
            this.ready = true;
            this.backend = 'main';
            return this.ready;
        } catch (error) {
            if (this.closed || generation !== this.generation) return false;
            this.ready = false;
            this.onError(error);
            return false;
        }
    }

    process(video, timestamp = performance.now(), capturedContext = null) {
        if (!this.ready || this.closed || !video || (video.readyState !== undefined && video.readyState < 2)) return null;
        const context = { ...(capturedContext || { ...phaseContext(this.state), wallTime: Date.now() }),
            clockStamp: capturedContext?.clockStamp || this.clock?.now?.({ performanceNowMs: timestamp }) || null };
        if (this.worker) {
            const worker = this.worker;
            const generation = this.generation;
            return worker.analyze(video, { timestamp }).then(result => this.closed || generation !== this.generation
                ? null : this.consumeResult(result, timestamp, context))
                .catch(() => {
                    if (this.closed || generation !== this.generation || this.worker !== worker) return null;
                    worker.dispose(); this.worker = null; this.workerAllowed = false;
                    this.workerFallbackReason = 'worker_runtime_failed'; this.ready = false;
                    this.onError(new Error('vision_worker_interrupted'));
                    this._beginInitialization(ready => {
                        if (ready && !this.closed && generation === this.generation) this.onRecovered();
                    });
                    return null;
                });
        }
        return this.consumeResult(this.landmarker.detectForVideo(video, timestamp), timestamp, context);
    }

    consumeResult(result, timestamp, context) {
        const landmarks = result?.landmarks?.[0];
        if (!Array.isArray(landmarks) || landmarks.length <= LANDMARK.RIGHT_HIP) {
            this.state.runtime.lastBodyPoseSample = null;
            this._recordRejected('occluded');
            return null;
        }

        const leftShoulder = landmarks[LANDMARK.LEFT_SHOULDER];
        const rightShoulder = landmarks[LANDMARK.RIGHT_SHOULDER];
        const leftHip = landmarks[LANDMARK.LEFT_HIP];
        const rightHip = landmarks[LANDMARK.RIGHT_HIP];
        const confidence = mean([
            landmarkConfidence(leftShoulder),
            landmarkConfidence(rightShoulder),
            landmarkConfidence(leftHip),
            landmarkConfidence(rightHip)
        ]) ?? 0;
        if (confidence < 0.35) {
            this.state.runtime.lastBodyPoseSample = null;
            this._recordRejected('low_confidence');
            return null;
        }

        const shoulderCenter = midpoint(leftShoulder, rightShoulder);
        const hipCenter = midpoint(leftHip, rightHip);
        const torsoCenter = midpoint(shoulderCenter, hipCenter);
        const shoulderWidth = Math.max(
            Math.hypot(
                rightShoulder.x - leftShoulder.x,
                rightShoulder.y - leftShoulder.y
            ),
            1e-4
        );
        const torsoHeight = Math.max(
            Math.hypot(shoulderCenter.x - hipCenter.x, shoulderCenter.y - hipCenter.y),
            1e-4
        );
        if (confidence >= 0.5 && this.scaleBaseline.count < 30) {
            this.scaleBaseline.count += 1;
            this.scaleBaseline.shoulderWidthSum += shoulderWidth;
            this.scaleBaseline.torsoHeightSum += torsoHeight;
        }
        const referenceShoulderWidth = this.scaleBaseline.count >= 10
            ? this.scaleBaseline.shoulderWidthSum / this.scaleBaseline.count
            : null;
        const referenceTorsoHeight = this.scaleBaseline.count >= 10
            ? this.scaleBaseline.torsoHeightSum / this.scaleBaseline.count
            : null;
        const scaleRatio = referenceShoulderWidth && referenceTorsoHeight
            ? mean([shoulderWidth / referenceShoulderWidth, torsoHeight / referenceTorsoHeight])
            : 1;
        const ood = confidence < 0.5 || scaleRatio < 0.6 || scaleRatio > 1.65;
        const dtSec = Number.isFinite(this.lastTimestamp)
            ? Math.max((timestamp - this.lastTimestamp) / 1000, 1 / 120)
            : null;
        const translationVelocity = dtSec && this.lastTorsoCenter
            ? Math.hypot(
                torsoCenter.x - this.lastTorsoCenter.x,
                torsoCenter.y - this.lastTorsoCenter.y
            ) / dtSec
            : 0;
        const landmarkVelocity = dtSec && Array.isArray(this.lastLandmarks)
            ? mean([11, 12, 23, 24].map(index => Math.hypot(
                landmarks[index].x - this.lastLandmarks[index].x,
                landmarks[index].y - this.lastLandmarks[index].y
            ) / dtSec)) ?? 0
            : 0;
        const movementVelocity = Math.max(translationVelocity, landmarkVelocity);
        const isMovementBurst = !ood && movementVelocity >= 0.18;
        const startedMovementBurst = isMovementBurst && !this.inBurst;
        if (startedMovementBurst) this.movementBursts += 1;
        this.inBurst = isMovementBurst;

        const { wallTime, clockStamp: stamp, ...labels } = context;
        const sample = {
            t: wallTime,
            timeOriginMs: stamp?.timeOriginMs ?? null,
            monotonicMs: stamp?.monotonicMs ?? null,
            sessionTimeMs: stamp?.sessionTimeMs ?? null,
            tRelMs: Math.max(0, wallTime - (this.state.sessionData.startTime || wallTime)),
            ...labels,
            confidence: Math.round(confidence * 1000) / 1000,
            valid: !ood,
            ood,
            qc: {
                reason: ood ? 'pose_out_of_distribution' : null,
                baselineReady: this.scaleBaseline.count >= 10,
                scaleRatio: finite(scaleRatio)
            },
            torsoCenterX: finite(torsoCenter.x),
            torsoCenterY: finite(torsoCenter.y),
            translationVelocity: finite(translationVelocity),
            landmarkVelocity: finite(landmarkVelocity),
            movementVelocity: finite(movementVelocity),
            movementBurst: isMovementBurst,
            lateralLean: finite((shoulderCenter.x - hipCenter.x) / torsoHeight),
            shoulderRollDeg: finite(
                Math.atan2(
                    rightShoulder.y - leftShoulder.y,
                    rightShoulder.x - leftShoulder.x
                ) * 180 / Math.PI
            ),
            torsoLeanDeg: finite(
                Math.atan2(
                    shoulderCenter.x - hipCenter.x,
                    hipCenter.y - shoulderCenter.y
                ) * 180 / Math.PI
            ),
            forwardLeanProxy: finite((shoulderCenter.z - hipCenter.z) / shoulderWidth)
        };

        if (!Array.isArray(this.state.sessionData.bodyPoseSamples)) {
            this.state.sessionData.bodyPoseSamples = [];
        }
        if (!this.state.sessionData.bodyPoseAccumulator) {
            this.state.sessionData.bodyPoseAccumulator = {
                n: 0,
                startedAt: wallTime,
                updatedAt: wallTime,
                enabled: this.enabled,
                gamerMode: this.gamerMode,
                validCount: 0,
                oodCount: 0,
                occludedCount: 0,
                confidenceSum: 0,
                movementVelocitySum: 0,
                torsoLeanAbsSum: 0,
                shoulderRollAbsSum: 0,
                movementBurstCount: 0
            };
        }
        const accumulator = this.state.sessionData.bodyPoseAccumulator;
        accumulator.n += 1;
        accumulator.updatedAt = wallTime;
        if (sample.valid) accumulator.validCount += 1;
        if (sample.ood) accumulator.oodCount += 1;
        if (sample.valid) {
            accumulator.confidenceSum += sample.confidence;
            accumulator.movementVelocitySum += sample.movementVelocity;
            accumulator.torsoLeanAbsSum += Math.abs(sample.torsoLeanDeg);
            accumulator.shoulderRollAbsSum += Math.abs(sample.shoulderRollDeg);
        }
        if (startedMovementBurst) accumulator.movementBurstCount += 1;
        this.state.sessionData.bodyPoseSamples.push(sample);
        if (this.state.sessionData.bodyPoseSamples.length > SAMPLE_CAP) {
            this.state.sessionData.bodyPoseSamples.shift();
        }
        this.state.runtime.lastBodyPoseSample = sample;
        this.lastTimestamp = timestamp;
        this.lastTorsoCenter = torsoCenter;
        this.lastLandmarks = landmarks.map(point => ({ x: point.x, y: point.y }));
        return sample;
    }

    _recordRejected(reason) {
        if (!this.state.sessionData.bodyPoseAccumulator) {
            this.state.sessionData.bodyPoseAccumulator = {
                n: 0,
                startedAt: Date.now(),
                updatedAt: Date.now(),
                enabled: this.enabled,
                gamerMode: this.gamerMode,
                validCount: 0,
                oodCount: 0,
                occludedCount: 0,
                confidenceSum: 0,
                movementVelocitySum: 0,
                torsoLeanAbsSum: 0,
                shoulderRollAbsSum: 0,
                movementBurstCount: 0
            };
        }
        const accumulator = this.state.sessionData.bodyPoseAccumulator;
        accumulator.updatedAt = Date.now();
        accumulator.oodCount += 1;
        if (reason === 'occluded') accumulator.occludedCount += 1;
    }

    summary() {
        return summarizeBodyPoseState(this.state, this.movementBursts);
    }

    stop() {
        this.closed = true;
        this.generation++;
        this.initializing = null;
        this.worker?.dispose(); this.worker = null;
        this.ready = false;
        const summary = this.summary();
        this.state.sessionData.bodyPoseSummary = summary;
        this.state.runtime.lastBodyPoseSample = null;
        try {
            this.landmarker?.close?.();
        } catch (_) {}
        this.landmarker = null;
        return summary;
    }
}
