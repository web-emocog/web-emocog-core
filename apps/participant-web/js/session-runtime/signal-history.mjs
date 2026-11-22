import '../../../shared/passive-metrics.js?v=20261122-integrity1';

export function combineSignalSummaries(previous = {}, current = {}) {
    const count = key => Math.max(0, previous[key] || 0) + Math.max(0, current[key] || 0);
    const weighted = (key, nKey) => {
        const items = [previous, current].filter(item => Number.isFinite(item[key]) && item[nKey] > 0);
        const n = items.reduce((sum, item) => sum + item[nKey], 0);
        return n ? items.reduce((sum, item) => sum + item[key] * item[nKey], 0) / n : null;
    };
    const extreme = (key, reducer) => {
        const values = [previous[key], current[key]].filter(Number.isFinite);
        return values.length ? reducer(...values) : null;
    };
    const respirationMethods = new Set([previous, current]
        .filter(item => item.validRespSampleCount > 0)
        .map(item => item.respMethodVersion || 'legacy_summary'));
    const heartMethods = new Set([previous, current].filter(item => item.validSampleCount > 0)
        .map(item => item.methodVersion || 'legacy_summary'));
    const mixedHeart = globalThis.EmocogPassiveMetrics.hasMixedMethods(heartMethods);
    const mixedRespiration = globalThis.EmocogPassiveMetrics.hasMixedMethods(respirationMethods);
    return { ...current, sampleCount: count('sampleCount'), validSampleCount: count('validSampleCount'),
        methodVersion: mixedHeart ? 'continuous_signals.mixed_methods'
            : heartMethods.values().next().value || current.methodVersion || null,
        respMethodVersion: respirationMethods.size > 1 ? 'respiration_luma.mixed_versions'
            : respirationMethods.values().next().value || current.respMethodVersion || null,
        validRespSampleCount: count('validRespSampleCount'), rejectedSampleCount: count('rejectedSampleCount'),
        bpmMean: mixedHeart ? null : weighted('bpmMean', 'validSampleCount'),
        respRateMean: mixedRespiration ? null : weighted('respRateMean', 'validRespSampleCount'),
        bpmMin: mixedHeart ? null : extreme('bpmMin', Math.min), bpmMax: mixedHeart ? null : extreme('bpmMax', Math.max),
        respRateMin: mixedRespiration ? null : extreme('respRateMin', Math.min), respRateMax: mixedRespiration ? null : extreme('respRateMax', Math.max) };
}
