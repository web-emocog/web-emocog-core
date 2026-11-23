import { buildHeatmaps, createHeatmapAccumulator } from '../web-page/heatmap.js?v=20261122-validtime1';

export function validateGazeHistory(sessionData) {
    if (sessionData?.heatmapState) createHeatmapAccumulator({}, sessionData.heatmapState);
}

function history(sessionData, runtime, options = {}) {
    const id = sessionData.ids?.session || null;
    if (runtime.gazeHistory?.sessionId === id) {
        runtime.gazeHistory.accumulator.setValidationRmsPx(sessionData.gazeValidation?.metrics?.accuracyPx);
        return runtime.gazeHistory.accumulator;
    }
    const accumulator = createHeatmapAccumulator({ gridWidth: 32, gridHeight: 18,
        validationRmsPx: sessionData.gazeValidation?.metrics?.accuracyPx ?? null, ...options }, sessionData.heatmapState || null);
    if (!sessionData.heatmapState) for (const sample of sessionData.eyeTracking || []) accumulator.add(sample);
    accumulator.setValidationRmsPx(sessionData.gazeValidation?.metrics?.accuracyPx);
    runtime.gazeHistory = { sessionId: id, accumulator };
    return accumulator;
}

export function appendGazeHistory(sessionData, runtime, sample) {
    const accumulator = history(sessionData, runtime);
    const tracker = runtime.validTimeTrial;
    if (tracker) {
        const segment = tracker.startMs + tracker.segmentStart;
        if (runtime.gazeHistory.validTimeSegment !== segment) {
            accumulator.breakContinuity();
            runtime.gazeHistory.validTimeSegment = segment;
        }
    }
    accumulator.add(sample);
}

export function captureGazeHistory(sessionData, runtime) {
    if (!runtime.gazeHistory && !sessionData.heatmapState && !sessionData.eyeTracking?.length) return;
    const accumulator = history(sessionData, runtime);
    const last = accumulator.lastTimestamp();
    const samples = sessionData.eyeTracking || [];
    const cursor = runtime.gazeHistory.captureCursor;
    // Immutable append-only series need only the new suffix. Replacement or
    // retained-window eviction falls back to the original ordered scan.
    const appendOnly = cursor?.source === samples && samples.length >= cursor.count
        && (!cursor.count || (samples[0] === cursor.head && samples[cursor.count - 1] === cursor.tail));
    for (let index = appendOnly ? cursor.count : 0; index < samples.length; index++) {
        const sample = samples[index];
        if (sample.t > (last ?? -Infinity)) accumulator.add(sample);
    }
    runtime.gazeHistory.captureCursor = { source: samples, count: samples.length,
        head: samples[0], tail: samples.at(-1) };
    sessionData.heatmapState = accumulator.snapshot();
}

export function buildSessionHeatmaps(sessionData, runtime, options = {}) {
    if (runtime.gazeHistory || sessionData.heatmapState) {
        captureGazeHistory(sessionData, runtime);
        return history(sessionData, runtime, options).finalize();
    }
    return buildHeatmaps(sessionData.eyeTracking || [], options);
}

export function buildCheckpointHeatmaps(sessionData, options = {}) {
    return sessionData.heatmapState
        ? createHeatmapAccumulator(options, sessionData.heatmapState).finalize()
        : buildHeatmaps(sessionData.eyeTracking || [], options);
}
