/**
 * Wiring layer for existing runtime imports (tests-updated, experimental_task, gaze-tests).
 * Delegates to emotion/public-api.js; normalizes missing-data for legacy HUD/append callers.
 *
 * @module emotion-stub-new
 */

import {
    analyzer,
    getEmotionSample as getEmotionSampleFromModule,
    getEmotionSummary,
    appendEmotionSample,
    resetEmotionAnalyzerState,
} from './emotion/public-api.js?v=20261110-integration1';

export { getEmotionSummary, appendEmotionSample };

let lastValence = 0;
let lastArousal = 0;

export function startEmotionSession(sessionId = null, options = {}) {
    lastValence = 0;
    lastArousal = 0;
    analyzer.startSession(sessionId, options);
}

export function setExplicitNeutralBaseline(baseline, count) {
    analyzer.setNeutralBaseline(baseline, count);
}

export function endEmotionSession() {
    return analyzer.endSession();
}

/** Сброс hold-state и analyzer buffers (вызывать при finalize сессии). */
export function resetEmotionWiringState() {
    lastValence = 0;
    lastArousal = 0;
    resetEmotionAnalyzerState();
}

/**
 * @param {Object} [precheckResult]
 * @returns {{ valence: number, arousal: number, dominant?: string, scores?: object, degraded?: boolean }}
 */
export function getEmotionSample(precheckResult) {
    const sample = getEmotionSampleFromModule(precheckResult);

    if (sample?.missingData || !Number.isFinite(sample.valence) || !Number.isFinite(sample.arousal)) {
        return {
            ...sample,
            valence: lastValence,
            arousal: lastArousal,
            dominant: sample?.dominant === 'unknown' ? 'neutral' : (sample?.dominant || 'neutral'),
            degraded: true,
            staleHold: true,
        };
    }

    lastValence = sample.valence;
    lastArousal = sample.arousal;
    return sample;
}
