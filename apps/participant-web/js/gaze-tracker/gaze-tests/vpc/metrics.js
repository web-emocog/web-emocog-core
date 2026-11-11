export const VPC_METRIC_VERSION = 'vpc_image_aoi.v2';
export const VPC_MAX_GAP_MS = 250;

function round(value, digits = 2) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function usableRect(rect) {
    return rect && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(rect[key]))
        && rect.width > 0 && rect.height > 0;
}

function inside(x, y, rect) {
    return x >= rect.left && x < rect.left + rect.width && y >= rect.top && y < rect.top + rect.height;
}

function region(sample, regions, viewport) {
    if (sample?.valid !== true || sample.onScreen !== true || sample.clipped === true
        || !Number.isFinite(sample.correctedX) || !Number.isFinite(sample.correctedY)) return null;
    const x = sample.correctedX, y = sample.correctedY;
    if (viewport && (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height)) return null;
    const familiar = inside(x, y, regions.familiar), novel = inside(x, y, regions.novel);
    return familiar && novel ? null : familiar ? 'familiar' : novel ? 'novel' : 'outside';
}

export function computePairLookMetrics({ samples, startMs, endMs, regions, viewport,
    layoutChanged = false, stimulusAvailable = true, minCoverageFraction = 0 }) {
    const windowValid = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
    const duration = windowValid ? endMs - startMs : 0;
    const inViewport = rect => viewport && (Number.isFinite(viewport.width) && Number.isFinite(viewport.height)
        && rect.left >= 0 && rect.top >= 0 && rect.left + rect.width <= viewport.width
        && rect.top + rect.height <= viewport.height);
    const regionsValid = usableRect(regions?.familiar) && usableRect(regions?.novel)
        && inViewport(regions.familiar) && inViewport(regions.novel);
    if (!Number.isFinite(minCoverageFraction) || minCoverageFraction < 0 || minCoverageFraction > 1) {
        throw new TypeError('Invalid VPC coverage policy');
    }
    let novel = 0, familiar = 0, outside = 0, gapCount = 0, rejectedIntervalCount = 0;
    // Keep invalid observations as barriers: filtering them first bridges lost tracking.
    const ordered = (samples || []).filter(sample => Number.isFinite(sample?.t)
        && sample.t >= startMs - VPC_MAX_GAP_MS && sample.t <= endMs + VPC_MAX_GAP_MS)
        .slice().sort((a, b) => a.t - b.t);
    if (windowValid && regionsValid && !layoutChanged && stimulusAvailable) {
        for (let i = 1; i < ordered.length; i++) {
            const previous = ordered[i - 1], current = ordered[i];
            const from = Math.max(startMs, previous.t), to = Math.min(endMs, current.t);
            if (to <= from) continue;
            const dt = current.t - previous.t;
            if (dt > VPC_MAX_GAP_MS) { gapCount++; continue; }
            const a = region(previous, regions, viewport), b = region(current, regions, viewport);
            // No inferred dwell across invalid samples, AOI crossings or uncovered gaps.
            if (a === null || a !== b) { rejectedIntervalCount++; continue; }
            if (a === 'novel') novel += to - from;
            else if (a === 'familiar') familiar += to - from;
            else outside += to - from;
        }
    }
    const look = novel + familiar, observed = look + outside;
    const coverage = duration ? look / duration : 0;
    const reason = !windowValid ? 'invalid_window' : !stimulusAvailable ? 'stimulus_unavailable'
        : layoutChanged ? 'layout_changed' : !regionsValid ? 'image_aoi_unavailable'
            : look <= 0 ? 'no_valid_observation' : coverage < minCoverageFraction ? 'insufficient_coverage' : null;
    return {
        methodVersion: VPC_METRIC_VERSION, coordinateSpace: 'content_viewport_css_px',
        regionDefinition: 'rendered_image_content_rect', gazeSignal: 'corrected',
        windowStartMs: startMs, windowEndMs: endMs, durationMs: duration,
        valid: reason === null, reason, suitability: 'research_only_not_validated',
        coveragePolicy: { minCoverageFraction, positiveObservationRequired: true, maxGapMs: VPC_MAX_GAP_MS },
        regions: regionsValid ? { familiar: { ...regions.familiar }, novel: { ...regions.novel } } : null,
        lookMsNovel: novel, lookMsFamiliar: familiar, validLookMs: look,
        outsideImageMs: outside, observedDurationMs: observed,
        unknownDurationMs: Math.max(0, duration - observed),
        coverageFraction: coverage, trackingCoverageFraction: duration ? observed / duration : 0,
        gapCount, rejectedIntervalCount,
        noveltyPreferencePct: reason === null ? round(100 * novel / look) : null
    };
}

export function summarizeVPCRun(trials = []) {
    const validTrials = trials.filter(item => item?.skipped !== true && item?.valid !== false
        && item?.metrics?.methodVersion === VPC_METRIC_VERSION && item.metrics.valid === true
        && item.metrics.validLookMs > 0 && Number.isFinite(item.metrics.noveltyPreferencePct)
        && ![item.familiarStimulus, item.novelStimulus].some(stimulus =>
            stimulus?.license === 'placeholder' || String(stimulus?.stimulusId || '').startsWith('local_placeholder:')));
    const totalLookMs = validTrials.reduce((sum, item) => sum + item.metrics.validLookMs, 0);
    const exclusionReasons = {};
    for (const trial of trials) {
        const reason = trial?.reason || trial?.metrics?.reason;
        if (reason) exclusionReasons[reason] = (exclusionReasons[reason] || 0) + 1;
    }
    return {
        methodVersion: VPC_METRIC_VERSION, trialCount: trials.length, validTrials: validTrials.length,
        skippedTrials: trials.filter(item => item?.skipped === true).length,
        invalidTrials: trials.length - validTrials.length,
        exclusionReasons,
        totalLookMs,
        meanNoveltyPreferencePct: validTrials.length
            ? round(validTrials.reduce((sum, item) => sum + item.metrics.noveltyPreferencePct, 0) / validTrials.length) : null,
        legacyUnscoredTrials: trials.filter(item => item?.methodVersion !== VPC_METRIC_VERSION
            && item?.metrics?.methodVersion !== VPC_METRIC_VERSION).length,
        suitability: 'research_only_not_validated'
    };
}
