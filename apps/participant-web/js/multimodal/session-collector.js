import {
    buildMultimodalHeatmaps,
    percentile
} from '../../../../packages/shared/multimodal/index.mjs';

export const MULTIMODAL_SESSION_VERSION = 'multimodal_session.v1';
const RETAINED_HEAD_SAMPLE_CAP = 1800;
const SAMPLE_INTERVAL_MS = 100;

function finite(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

function mean(values) {
    const valid = (values || []).filter(Number.isFinite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function faceConfidence(frame) {
    if (frame?.face?.detected === false || !Array.isArray(frame?.landmarks)) return 0;
    return finite(frame?.face?.confidence ?? frame?.face?.score ?? frame?.confidence) ?? 1;
}

function poseVector(frame) {
    const pose = frame?.pose || {};
    const yaw = finite(pose.yaw);
    const pitch = finite(pose.pitch);
    const roll = finite(pose.roll);
    if (yaw == null || pitch == null || roll == null) return null;
    return { yaw, pitch, roll };
}

function taskContext(state) {
    const task = state.runtime?.taskContext || {};
    return {
        phase: state.runtime?.currentPhase || null,
        blockId: task.blockId ?? null,
        attempt: task.attempt ?? null,
        trialId: task.trialId ?? null,
        stimulusId: task.stimulusId ?? null
    };
}

export class MultimodalSessionCollector {
    constructor(options = {}) {
        this.state = options.state;
        this.clock = options.clock;
        this.enabled = options.enabled !== false;
        this.bodyEnabled = options.bodyEnabled !== false;
        this.gamerMode = options.gamerMode === true;
        this.started = false;
        this.lastSampleMs = -Infinity;
        this.headSamples = [];
        this.baseline = { count: 0, yawSum: 0, pitchSum: 0, rollSum: 0 };
        this.accumulator = {
            sampleCount: 0,
            validHeadCount: 0,
            oodHeadCount: 0,
            confidenceSum: 0,
            yawAbsSum: 0,
            pitchAbsSum: 0,
            rollAbsSum: 0
        };
    }

    start() {
        this.started = this.enabled;
        this.state.sessionData.multimodal = {
            schemaVersion: MULTIMODAL_SESSION_VERSION,
            enabled: this.enabled,
            gamerMode: this.gamerMode,
            rawVideoStored: false,
            rawLandmarksStored: false,
            timebase: this.clock.snapshot()
        };
        return this.started;
    }

    captureFrame({ frame, gaze = null, body = null } = {}) {
        if (!this.started) return null;
        const stamp = this.clock.now({ performanceNowMs: finite(frame?.timestamp) });
        if (stamp.sessionTimeMs - this.lastSampleMs < SAMPLE_INTERVAL_MS) return null;
        this.lastSampleMs = stamp.sessionTimeMs;
        const pose = poseVector(frame);
        const confidence = faceConfidence(frame);
        if (pose && confidence >= 0.5 && this.baseline.count < 30) {
            this.baseline.count += 1;
            this.baseline.yawSum += pose.yaw;
            this.baseline.pitchSum += pose.pitch;
            this.baseline.rollSum += pose.roll;
        }
        const baselineReady = this.baseline.count >= 10;
        const reference = baselineReady ? {
            yaw: this.baseline.yawSum / this.baseline.count,
            pitch: this.baseline.pitchSum / this.baseline.count,
            roll: this.baseline.rollSum / this.baseline.count
        } : null;
        const delta = pose && reference ? {
            yaw: pose.yaw - reference.yaw,
            pitch: pose.pitch - reference.pitch,
            roll: pose.roll - reference.roll
        } : null;
        const ood = !pose
            || confidence < 0.5
            || (delta && (Math.abs(delta.yaw) > 20 || Math.abs(delta.pitch) > 15 || Math.abs(delta.roll) > 18));
        const sample = {
            schemaVersion: MULTIMODAL_SESSION_VERSION,
            timeOriginMs: stamp.timeOriginMs,
            monotonicMs: stamp.monotonicMs,
            sessionTimeMs: stamp.sessionTimeMs,
            ...taskContext(this.state),
            head: pose ? {
                confidence,
                valid: !ood,
                ood,
                yawDeltaDeg: finite(delta?.yaw),
                pitchDeltaDeg: finite(delta?.pitch),
                rollDeltaDeg: finite(delta?.roll)
            } : null,
            gaze: gaze?.valid !== false && Number.isFinite(gaze?.correctedX) && Number.isFinite(gaze?.correctedY)
                ? {
                    valid: gaze.onScreen !== false,
                    confidence: finite(gaze.confidence),
                    correctedX: gaze.correctedX,
                    correctedY: gaze.correctedY
                }
                : null,
            body: this.bodyEnabled && body ? {
                valid: body.valid !== false && body.ood !== true,
                confidence: finite(body.confidence),
                movementVelocity: finite(body.movementVelocity),
                movementBurst: body.movementBurst === true
            } : null
        };
        this.accumulator.sampleCount += 1;
        if (sample.head?.valid) {
            this.accumulator.validHeadCount += 1;
            this.accumulator.confidenceSum += sample.head.confidence;
            this.accumulator.yawAbsSum += Math.abs(sample.head.yawDeltaDeg || 0);
            this.accumulator.pitchAbsSum += Math.abs(sample.head.pitchDeltaDeg || 0);
            this.accumulator.rollAbsSum += Math.abs(sample.head.rollDeltaDeg || 0);
        } else {
            this.accumulator.oodHeadCount += 1;
        }
        this.headSamples.push(sample);
        if (this.headSamples.length > RETAINED_HEAD_SAMPLE_CAP) this.headSamples.shift();
        this.state.runtime.lastMultimodalSample = sample;
        return sample;
    }

    _summary() {
        const valid = this.headSamples.filter(sample => sample.head?.valid);
        const count = this.accumulator.validHeadCount;
        return {
            schemaVersion: MULTIMODAL_SESSION_VERSION,
            enabled: this.enabled,
            gamerMode: this.gamerMode,
            timebase: this.clock.snapshot(),
            head: {
                algorithmVersion: 'mediapipe_face_pose_delta.v1',
                sampleCount: this.accumulator.sampleCount,
                validSampleCount: count,
                oodSampleCount: this.accumulator.oodHeadCount,
                retainedSampleCount: this.headSamples.length,
                confidenceMean: count ? this.accumulator.confidenceSum / count : null,
                yawAbsMeanDeg: count ? this.accumulator.yawAbsSum / count : null,
                pitchAbsMeanDeg: count ? this.accumulator.pitchAbsSum / count : null,
                rollAbsMeanDeg: count ? this.accumulator.rollAbsSum / count : null,
                yawAbsP95Deg: percentile(valid.map(sample => Math.abs(sample.head.yawDeltaDeg)), 0.95),
                pitchAbsP95Deg: percentile(valid.map(sample => Math.abs(sample.head.pitchDeltaDeg)), 0.95),
                baselineSampleCount: this.baseline.count,
                coordinateSpace: 'camera_normalized_head_delta'
            },
            body: this.bodyEnabled
                ? { ...(this.state.sessionData.bodyPoseSummary || {}), featureGated: true }
                : { enabled: false, featureGated: true },
            eventCount: Array.isArray(this.state.sessionData.events)
                ? this.state.sessionData.events.length
                : 0,
            rawVideoStored: false,
            rawLandmarksStored: false,
            disclaimer: 'Head/body movement and engagement are research proxies, not clinical conclusions.'
        };
    }

    stop() {
        this.started = false;
        const summary = this._summary();
        const heatmap = this.enabled ? buildMultimodalHeatmaps({
            gazeSamples: this.state.sessionData.eyeTracking,
            emotionSamples: this.state.sessionData.emotionSamples
        }, {
            gridWidth: 16,
            gridHeight: 9,
            maxAlignmentMs: 100,
            maxPresentations: 50
        }) : null;
        this.state.sessionData.multimodalSummary = summary;
        this.state.sessionData.multimodalHeatmap = heatmap;
        this.state.runtime.lastMultimodalSample = null;
        return { summary, heatmap };
    }
}
