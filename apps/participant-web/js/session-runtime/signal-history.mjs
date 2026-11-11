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
    return { ...current, sampleCount: count('sampleCount'), validSampleCount: count('validSampleCount'),
        respMethodVersion: respirationMethods.size > 1 ? 'respiration_luma.mixed_versions'
            : respirationMethods.values().next().value || current.respMethodVersion || null,
        validRespSampleCount: count('validRespSampleCount'), rejectedSampleCount: count('rejectedSampleCount'),
        bpmMean: weighted('bpmMean', 'validSampleCount'), respRateMean: weighted('respRateMean', 'validRespSampleCount'),
        bpmMin: extreme('bpmMin', Math.min), bpmMax: extreme('bpmMax', Math.max),
        respRateMin: extreme('respRateMin', Math.min), respRateMax: extreme('respRateMax', Math.max) };
}
