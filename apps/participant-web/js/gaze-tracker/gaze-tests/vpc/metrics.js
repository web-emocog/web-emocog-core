function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const k = 10 ** digits;
    return Math.round(value * k) / k;
}

export function computePairLookMetrics({ samples, startMs, endMs, screenMidX, novelSide }) {
    const valid = (samples || [])
        .filter(sample => Number.isFinite(sample?.t) && sample.onScreen !== false)
        .sort((a, b) => a.t - b.t);

    let lookMsNovel = 0;
    let lookMsFamiliar = 0;

    for (let i = 1; i < valid.length; i++) {
        const prev = valid[i - 1];
        const curr = valid[i];
        if (!Number.isFinite(curr.x)) continue;

        let dt = curr.t - prev.t;
        if (!Number.isFinite(dt) || dt <= 0) continue;
        if (dt > 250) dt = 250;

        const gazeSide = curr.x < screenMidX ? 'left' : 'right';
        if (gazeSide === novelSide) {
            lookMsNovel += dt;
        } else {
            lookMsFamiliar += dt;
        }
    }

    const validLookMs = Math.max(0, lookMsNovel + lookMsFamiliar);
    const noveltyPreferencePct = validLookMs > 0 ? (lookMsNovel / validLookMs) * 100 : null;

    return {
        windowStartMs: startMs,
        windowEndMs: endMs,
        lookMsNovel: round(lookMsNovel, 1) || 0,
        lookMsFamiliar: round(lookMsFamiliar, 1) || 0,
        validLookMs: round(validLookMs, 1) || 0,
        noveltyPreferencePct: round(noveltyPreferencePct, 2)
    };
}

export function summarizeVPCRun(trials) {
    const validTrials = (trials || []).filter(item => item?.skipped !== true && Number.isFinite(item?.metrics?.validLookMs));
    const noveltyValues = validTrials
        .map(item => item?.metrics?.noveltyPreferencePct)
        .filter(Number.isFinite);

    const totalLookMs = validTrials
        .map(item => item?.metrics?.validLookMs)
        .filter(Number.isFinite)
        .reduce((sum, value) => sum + value, 0);

    const meanNoveltyPreferencePct = noveltyValues.length > 0
        ? noveltyValues.reduce((sum, value) => sum + value, 0) / noveltyValues.length
        : null;

    return {
        trialCount: (trials || []).length,
        validTrials: validTrials.length,
        skippedTrials: Math.max(0, (trials || []).length - validTrials.length),
        totalLookMs: round(totalLookMs, 1) || 0,
        meanNoveltyPreferencePct: round(meanNoveltyPreferencePct, 2)
    };
}
