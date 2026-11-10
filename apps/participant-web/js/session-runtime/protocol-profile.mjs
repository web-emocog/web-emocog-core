export const PROTOCOL_PROFILE_ID = 'protocol_signals.v1';

export const FRAME_SCHEDULE = Object.freeze({
    targetIntervalMs: 33,
    segmenterStride: 3,
    emotionStride: 6,
    bodyPoseStride: 6,
    segmentMaxAgeMs: 1000
});

export const NEW_PROTOCOL_PROFILE_ID = 'protocol_signals.v2';
const LEGACY_PROFILE = Object.freeze({
    id: PROTOCOL_PROFILE_ID, schedule: FRAME_SCHEDULE, bodyMovementDefault: true,
    precheck: Object.freeze({ method: 'consecutive.v1', required: 15 }),
    emotionCalibration: Object.freeze({ method: 'automatic.v1', minSamples: 18 })
});
const CURRENT_PROFILE = Object.freeze({
    id: NEW_PROTOCOL_PROFILE_ID, bodyMovementDefault: false,
    schedule: Object.freeze({ ...FRAME_SCHEDULE, segmentIntervalMs: 500,
        emotionIntervalMs: 200, bodyPoseIntervalMs: 200 }),
    precheck: Object.freeze({ method: 'recent-window.v2', windowSize: 10, minSuccess: 8,
        recentSuccess: 2, minSpanMs: 2000, maxAgeMs: 8000, maxGapMs: 1500, maxResultAgeMs: 1000 }),
    emotionCalibration: Object.freeze({ method: 'explicit-neutral.v2', minSamples: 25,
        minDurationMs: 5000, intervalMs: 200, timeoutMs: 30000 })
});

export function resolveSignalProfile(definition = null) {
    const id = definition?.settings?.signalProfileId ?? definition?.signalProfileId;
    if (id == null || id === PROTOCOL_PROFILE_ID) return LEGACY_PROFILE;
    if (id === NEW_PROTOCOL_PROFILE_ID) return CURRENT_PROFILE;
    throw new Error('Unsupported signal profile');
}

export function protocolCameraConstraints() {
    return { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, min: 15 } } };
}

// Source cadence, ordered primary work and serialized auxiliary work are
// separate ceilings. More CPU cores cannot shorten an ordered model call.
export function frameBudget({ sourceFps, primaryMs, segmentMs = null, poseMs = null,
    schedule = FRAME_SCHEDULE } = {}) {
    const positive = value => Number.isFinite(value) && value > 0;
    const source = positive(sourceFps) ? sourceFps : null;
    const primary = positive(primaryMs) ? 1000 / primaryMs : null;
    const timed = Number.isFinite(schedule.segmentIntervalMs);
    const utilization = timed && positive(segmentMs)
        ? segmentMs / schedule.segmentIntervalMs + (positive(poseMs) ? poseMs / schedule.bodyPoseIntervalMs : 0) : null;
    const auxiliaryMs = timed ? (source !== null && utilization !== null ? utilization * 1000 / source : null)
        : positive(segmentMs) && positive(poseMs)
        ? segmentMs / schedule.segmenterStride + poseMs / schedule.bodyPoseStride : null;
    const schedulingFps = 1000 / schedule.targetIntervalMs;
    return {
        target30Ms: 1000 / 30,
        target25Ms: 1000 / 25,
        sourceFps: source,
        primaryCapacityFps: primary,
        auxiliaryDemandMsPerAnalyzedFrame: auxiliaryMs,
        primaryCeilingFps: source !== null && primary !== null ? Math.min(source, schedulingFps, primary) : null,
        auxiliaryUtilizationAtSource: source !== null && auxiliaryMs !== null ? source * auxiliaryMs / 1000 : null,
        auxiliaryUtilizationAtTarget: utilization,
        // Elapsed stages may overlap CPU/GPU resource queues. This is a bound,
        // not a prediction of delivered FPS or a model-accuracy pass.
        method: 'ordered_primary_budget.v1'
    };
}

export const MODEL_ASSETS = Object.freeze({
    face: Object.freeze({ file: 'face_landmarker.task', sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff' }),
    segment: Object.freeze({ file: 'selfie_multiclass_256x256.tflite', sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0' }),
    pose: Object.freeze({ file: 'pose_landmarker_lite.task', sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a' })
});
