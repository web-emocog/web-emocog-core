import { createValidationSamplingWindow } from './validation-sampling.mjs';
import { extractFeatureGroups, confidenceFromFeatureGroups } from './features.js?v=20261108-143l';
import { MIN_GAZE_CONFIDENCE } from './signal-processing.mjs?v=20261106-143';

export const CALIBRATION_CAPTURE_VERSION = 'click_capture.v1';
export const CALIBRATION_CLICKS = 2;
export const CALIBRATION_POSITIONS = Object.freeze([8, 29, 50, 71, 92].flatMap((y, row) =>
    (row % 2 ? [92, 71, 50, 29, 8] : [8, 29, 50, 71, 92]).map(x => Object.freeze({ x, y }))));
export const CORRECTION_POSITIONS = Object.freeze([15, 50, 85].flatMap(y =>
    [15, 50, 85].map(x => Object.freeze({ x, y }))));
export const BENCHMARK_POSITIONS = Object.freeze([
    { x: 30, y: 22 }, { x: 70, y: 22 }, { x: 22, y: 70 }, { x: 78, y: 70 }, { x: 50, y: 63 }
].map(Object.freeze));

export function calibrationCapturePolicy({ x, y }) {
    if (![x, y].every(Number.isFinite) || x < 0 || x > 100 || y < 0 || y > 100) {
        throw new Error('invalid_calibration_target');
    }
    const extremeX = x <= 10 || x >= 90, extremeY = y <= 10 || y >= 90;
    const radial = Math.min(1, Math.hypot(x - 50, y - 50) / 70.71);
    const maxFrames = Math.round(12 + radial * 5 + (extremeX || extremeY ? 2 : 0) + (extremeX && extremeY ? 2 : 0));
    // Preserve the original FIRST-attempt limits. Repeated failed clicks no
    // longer relax pose, accept a closed eye or reduce the usable-frame minimum.
    return { maxFrames, minFrames: Math.max(6, Math.floor(maxFrames * 0.65)), timeoutMs: 2000,
        yawLimit: 12 + (extremeX ? 2 : 0), rollLimit: 10 + (extremeX ? 1 : 0),
        pitchLimit: 12 + (y >= 72.5 ? 8 : y <= 27.5 ? 4 : 0), allowOffCenter: y >= 72.5 };
}

export function assessCalibrationFrame(frame, policy, includeOverlaps = false) {
    const groups = extractFeatureGroups(frame?.landmarks);
    const gazeConfidenceRejected = Boolean(groups) && confidenceFromFeatureGroups(groups) < MIN_GAZE_CONFIDENCE;
    const precheckEyesRejected = frame?.eyes?.bothOpen === false || frame?.eyes?.left?.isOpen === false
        || frame?.eyes?.right?.isOpen === false;
    const eyesRejected = !groups || gazeConfidenceRejected || precheckEyesRejected;
    const pose = frame?.pose;
    const hasPose = (!eyesRejected || includeOverlaps) && [pose?.yaw, pose?.pitch, pose?.roll].every(Number.isFinite);
    const poseRejected = (!eyesRejected || includeOverlaps) && (pose?.status === 'error'
        || pose?.status === 'off_center' && !policy.allowOffCenter
        || hasPose && (Math.abs(pose.yaw) > policy.yawLimit || Math.abs(pose.pitch) > policy.pitchLimit || Math.abs(pose.roll) > policy.rollLimit)
        || pose?.status === 'tilted' && !hasPose);
    return { groups, eyesRejected, poseRejected, gazeConfidenceRejected, precheckEyesRejected };
}

export function createCalibrationCapture({ start, wallStart, policy, onLandmarkCopy = null, onFrameAssessment = null }) {
    if (onLandmarkCopy !== null && typeof onLandmarkCopy !== 'function') throw new Error('invalid_capture_copy_hook');
    const clock = createValidationSamplingWindow({ monotonicStart: start, wallStart });
    if (!Number.isInteger(policy?.minFrames) || policy.minFrames < 1
        || !Number.isInteger(policy?.maxFrames) || policy.maxFrames < policy.minFrames || policy.maxFrames > 30
        || !Number.isFinite(policy.timeoutMs) || policy.timeoutMs <= 0) throw new Error('invalid_capture_policy');
    let frames = [], features = [], sealed = false;
    const counts = { invalidEyes: 0, invalidPose: 0, outsideWindow: 0, interruptedRuns: 0 };
    const interrupt = () => { if (frames.length) counts.interruptedRuns++; frames = []; features = []; };
    return {
        observe(frame, now) {
            if (sealed || frames.length >= policy.maxFrames) return;
            // timestamp is the analyzer's MONOTONIC capture time, not arrival
            // time or Date.now(). Missing capture provenance cannot be invented.
            const timestamp = frame?.timestamp;
            if (!Number.isFinite(now) || now >= start + policy.timeoutMs
                || Number.isFinite(timestamp) && (timestamp > now || timestamp >= start + policy.timeoutMs)) {
                counts.outsideWindow++; return;
            }
            if (!clock.accept({ frameTimestamp: timestamp })) return;
            const assessment = assessCalibrationFrame(frame, policy, Boolean(onFrameAssessment));
            const { groups, eyesRejected, poseRejected } = assessment;
            onFrameAssessment?.(frame, assessment);
            if (eyesRejected) {
                counts.invalidEyes++; interrupt(); return;
            }
            if (poseRejected) {
                counts.invalidPose++; interrupt(); return;
            }
            // Own just a bounded calibration copy; do not retain the frame key
            // (which may own raw pixels in a WeakMap), image buffers or a stream.
            const copy = frame.landmarks.map(p => ({ x: p.x, y: p.y, z: p.z }));
            // Optional local experiment may associate derived features with the
            // copy via its OWN WeakMap. No pixels/frame object are retained here.
            onLandmarkCopy?.(frame, copy);
            frames.push(copy);
            features.push(groups.iris);
        },
        get full() { return frames.length >= policy.maxFrames; },
        finish({ cancelled = false } = {}) {
            if (sealed) throw new Error('capture_already_finished');
            sealed = true;
            const accepted = !cancelled && frames.length >= policy.minFrames;
            const meanFeatures = accepted ? features[0].map((_, i) => features.reduce((sum, f) => sum + f[i], 0) / features.length) : null;
            const result = { frames: accepted ? frames : [], meanFeatures,
                summary: { version: CALIBRATION_CAPTURE_VERSION, accepted, cancelled,
                    usableFrames: frames.length, minFrames: policy.minFrames, maxFrames: policy.maxFrames,
                    ...counts, sampling: clock.summary() } };
            frames = []; features = [];
            return result;
        }
    };
}

// Polls the existing pipeline's latest RESULT, never runs another camera or
// inference loop. The deadline also bounds stalls with no new camera frames.
export async function collectCalibrationClick({ getFrame, policy, isActive = () => true,
    onLandmarkCopy = null, onFrameAssessment = null,
    now = () => performance.now(), wallNow = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const start = now(), capture = createCalibrationCapture({ start, wallStart: wallNow(), policy, onLandmarkCopy, onFrameAssessment });
    while (isActive() && now() < start + policy.timeoutMs) {
        capture.observe(getFrame(), now());
        if (capture.full) break;
        await sleep(8);
    }
    return capture.finish({ cancelled: !isActive() });
}

// Diagnostic only, NOT an accuracy criterion and never a new fit target.
// Stored only in the local manual report, not participant ingest.
export function compareCalibrationClicks(first, second) {
    if (!Array.isArray(first) || first.length !== second?.length || !first.every(Number.isFinite) || !second.every(Number.isFinite)) return null;
    const delta = second.slice(0, -1).map((v, i) => v - first[i]);
    return { version: 'click_repeatability.v1', irisFeatureRmsDelta: Math.hypot(...delta) / Math.sqrt(delta.length) };
}
