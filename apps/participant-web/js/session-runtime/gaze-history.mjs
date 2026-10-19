import { buildHeatmaps, createHeatmapAccumulator } from '../web-page/heatmap.js?v=20261019-5';

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
    history(sessionData, runtime).add(sample);
}

export function captureGazeHistory(sessionData, runtime) {
    if (!runtime.gazeHistory && !sessionData.heatmapState && !sessionData.eyeTracking?.length) return;
    const accumulator = history(sessionData, runtime);
    const last = accumulator.lastTimestamp();
    for (const sample of sessionData.eyeTracking || []) if (sample.t > (last ?? -Infinity)) accumulator.add(sample);
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
