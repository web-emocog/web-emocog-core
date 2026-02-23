const ATTENTION_ALGO_VERSION = '2.3.0';
const TRACKING_START_PHASE = 'tracking_test';

const DEFAULTS = Object.freeze({
    baselineWindowMs: 2000,
    baselinePercentile: 0.6,
    warmupMs: 500,
    closeThresholdRel: 0.88,
    openThresholdRel: 0.94,
    minConfirmFrames: 2,
    blinkCloseThresholdRel: 0.9,
    blinkOpenThresholdRel: 0.94,
    blinkMinConfirmFrames: 2,
    blinkMergeGapMs: 180,
    blinkMinMs: 70,
    blinkMaxMs: 700,
    perclosMinDurationMs: 800,
    perclosMinDepthRel: 0.35,
    perclosMinDeepDwellMs: 350,
    perclosMaxRebounds: 0,
    perclosReboundHighRel: 0.8,
    perclosReboundLowRel: 0.45,
    perclosMaxClosureSpeed: 4.0,
    perclosMinOpeningSpeed: 1.5,
    perclosNoBlinkOverlap: true,
    perclosWindowsMs: [30000, 60000],
    maxEyeIntervalMs: 250,
    maxGazeIntervalMs: 250,
    saccadeVelocityThreshold: 1.2,
    minFixationDurationMs: 80,
    microShiftMinAmp: 0.003,
    microShiftMaxAmp: 0.012,
    microShiftMinVelocity: 0.25,
    microShiftMaxVelocity: 0.9,
    microShiftMinDurationMs: 40,
    microShiftMaxDurationMs: 240,
    microShiftMinIntervals: 2,
    microShiftMaxIntervals: 6,
    incompleteAmplitudeThreshold: 0.4,
    hippusMinSamples: 32,
    hippusQualityMinSamples: 120,
    hippusStdMin: 1e-4,
    hippusDetrendWindow: 15,
    hippusMinFreq: 0.1,
    hippusMaxFreq: 2.0,
    hippusFreqStep: 0.05
});

function percentile(values, p) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) return sorted[0];
    const idx = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * p));
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const t = idx - lo;
    return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function mean(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const sum = values.reduce((acc, v) => acc + v, 0);
    return sum / values.length;
}

function stdDev(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const avg = mean(values);
    if (!Number.isFinite(avg)) return null;
    const sq = values.reduce((acc, v) => acc + ((v - avg) * (v - avg)), 0);
    return Math.sqrt(sq / values.length);
}

function toFiniteNumber(v, fallback = null) {
    return Number.isFinite(v) ? v : fallback;
}

function withDurationMs(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
    return Math.max(0, endMs - startMs);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clamp01(v) {
    return clamp(v, 0, 1);
}

function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function pickScopeStartMs(eyeSignals, gazeSamples) {
    const trackingTimestamps = [
        ...(eyeSignals || [])
            .filter(sample => sample?.phase === TRACKING_START_PHASE && Number.isFinite(sample?.t))
            .map(sample => sample.t),
        ...(gazeSamples || [])
            .filter(sample => sample?.phase === TRACKING_START_PHASE && Number.isFinite(sample?.t))
            .map(sample => sample.t)
    ];

    if (trackingTimestamps.length > 0) {
        return {
            scopeStartPhase: TRACKING_START_PHASE,
            scopeStartMs: Math.min(...trackingTimestamps),
            scopeFilterApplied: true
        };
    }

    const fallbackTimestamps = [
        ...(eyeSignals || []).filter(sample => Number.isFinite(sample?.t)).map(sample => sample.t),
        ...(gazeSamples || []).filter(sample => Number.isFinite(sample?.t)).map(sample => sample.t)
    ];

    return {
        scopeStartPhase: 'fallback_first_sample',
        scopeStartMs: fallbackTimestamps.length > 0 ? Math.min(...fallbackTimestamps) : null,
        scopeFilterApplied: false
    };
}

function filterPostCalibrationSamples(eyeSignals, gazeSamples) {
    const scope = pickScopeStartMs(eyeSignals, gazeSamples);
    const startMs = scope.scopeStartMs;
    if (!scope.scopeFilterApplied || !Number.isFinite(startMs)) {
        return {
            eyeSignals: Array.isArray(eyeSignals) ? eyeSignals : [],
            gazeSamples: Array.isArray(gazeSamples) ? gazeSamples : [],
            scope
        };
    }

    return {
        eyeSignals: (eyeSignals || []).filter(sample => !Number.isFinite(sample?.t) || sample.t >= startMs),
        gazeSamples: (gazeSamples || []).filter(sample => !Number.isFinite(sample?.t) || sample.t >= startMs),
        scope
    };
}

function buildRelativeSignal(samples, valueKey, config) {
    const sorted = (samples || [])
        .filter(s => Number.isFinite(s?.t) && Number.isFinite(s?.[valueKey]))
        .sort((a, b) => a.t - b.t);

    const out = [];
    const windowSamples = [];
    let left = 0;

    for (const sample of sorted) {
        const t = sample.t;
        const ear = sample[valueKey];

        windowSamples.push({ t, ear });
        while (left < windowSamples.length && (t - windowSamples[left].t) > config.baselineWindowMs) {
            left++;
        }

        const active = windowSamples.slice(left);
        const activeEars = active.map(item => item.ear);
        const baselineEar = toFiniteNumber(percentile(activeEars, config.baselinePercentile), ear);
        const observedMs = active.length > 0 ? withDurationMs(active[0].t, t) : 0;
        const baselineReady = observedMs >= config.warmupMs;
        const relativeOpenness = baselineReady && Number.isFinite(baselineEar)
            ? ear / Math.max(baselineEar, 1e-6)
            : null;

        out.push({
            ...sample,
            baselineEar,
            baselineReady,
            relativeOpenness
        });
    }

    return out;
}

function buildRelativeEyeSignal(samples, config) {
    return buildRelativeSignal(samples, 'earAvg', config);
}

function detectClosureEvents(relativeSamples, config) {
    const events = [];
    let state = 'open';
    let closeStreak = 0;
    let openStreak = 0;
    let previousRelative = null;

    let candidateStartMs = null;
    let candidatePreOpen = null;
    let minRelative = Infinity;
    let minRelativeTimeMs = null;

    for (let i = 0; i < relativeSamples.length; i++) {
        const sample = relativeSamples[i];
        const rel = sample.relativeOpenness;
        const t = sample.t;
        if (!Number.isFinite(t) || !Number.isFinite(rel)) continue;

        if (state === 'open') {
            if (rel <= config.closeThresholdRel) {
                closeStreak++;
                if (closeStreak === 1) {
                    candidateStartMs = t;
                    candidatePreOpen = Number.isFinite(previousRelative) ? previousRelative : config.openThresholdRel;
                    minRelative = rel;
                    minRelativeTimeMs = t;
                } else if (rel < minRelative) {
                    minRelative = rel;
                    minRelativeTimeMs = t;
                }

                if (closeStreak >= config.minConfirmFrames) {
                    state = 'closed';
                    openStreak = 0;
                }
            } else {
                closeStreak = 0;
                candidateStartMs = null;
                candidatePreOpen = null;
                minRelative = Infinity;
                minRelativeTimeMs = null;
            }
        } else {
            if (rel < minRelative) {
                minRelative = rel;
                minRelativeTimeMs = t;
            }

            if (rel >= config.openThresholdRel) {
                openStreak++;
            } else {
                openStreak = 0;
            }

            if (openStreak >= config.minConfirmFrames && Number.isFinite(candidateStartMs)) {
                const endMs = t;
                const startMs = candidateStartMs;
                const durationMs = withDurationMs(startMs, endMs);
                const minRel = Number.isFinite(minRelative) ? minRelative : rel;
                const minTime = Number.isFinite(minRelativeTimeMs) ? minRelativeTimeMs : startMs;
                const preOpenRel = Number.isFinite(candidatePreOpen) ? candidatePreOpen : config.openThresholdRel;
                const postOpenRel = rel;
                const downDt = Math.max(1, withDurationMs(startMs, minTime));
                const upDt = Math.max(1, withDurationMs(minTime, endMs));
                const amplitude = clamp01((preOpenRel - minRel) / Math.max(preOpenRel, 1e-6));
                const closureSpeed = (Math.max(0, preOpenRel - minRel) / downDt) * 1000;
                const openingSpeed = (Math.max(0, postOpenRel - minRel) / upDt) * 1000;
                const isBlink = durationMs >= config.blinkMinMs && durationMs <= config.blinkMaxMs;
                const incomplete = amplitude < config.incompleteAmplitudeThreshold;

                events.push({
                    startMs,
                    endMs,
                    durationMs,
                    minRelativeOpenness: round(minRel, 6),
                    preOpenRelative: round(preOpenRel, 6),
                    postOpenRelative: round(postOpenRel, 6),
                    amplitude: round(amplitude, 6),
                    closureSpeed: round(closureSpeed, 6),
                    openingSpeed: round(openingSpeed, 6),
                    isBlink,
                    incomplete
                });

                state = 'open';
                closeStreak = 0;
                openStreak = 0;
                candidateStartMs = null;
                candidatePreOpen = null;
                minRelative = Infinity;
                minRelativeTimeMs = null;
            }
        }

        previousRelative = rel;
    }

    return events;
}

function summarizeBothOpenInEvent(relativeSamples, startMs, endMs) {
    let totalSamples = 0;
    let knownSamples = 0;
    let bothOpenFalseSamples = 0;
    let bothOpenTrueSamples = 0;

    for (const sample of relativeSamples || []) {
        if (!Number.isFinite(sample?.t)) continue;
        if (sample.t < startMs || sample.t > endMs) continue;
        totalSamples += 1;
        if (sample.bothOpen === false) {
            knownSamples += 1;
            bothOpenFalseSamples += 1;
        } else if (sample.bothOpen === true) {
            knownSamples += 1;
            bothOpenTrueSamples += 1;
        }
    }

    return {
        totalSamples,
        knownSamples,
        bothOpenFalseSamples,
        bothOpenTrueSamples,
        bothOpenFalsePct: knownSamples > 0 ? round((bothOpenFalseSamples / knownSamples) * 100, 2) : null
    };
}

function summarizePerclosDynamicsForEvent(relativeSamples, startMs, endMs, config) {
    const segment = (relativeSamples || [])
        .filter(sample =>
            Number.isFinite(sample?.t)
            && sample.t >= startMs
            && sample.t <= endMs
            && Number.isFinite(sample?.relativeOpenness)
        )
        .sort((a, b) => a.t - b.t);

    if (segment.length < 2) {
        return {
            deepDwellMs: 0,
            rebounds: 0
        };
    }

    let deepDwellMs = 0;
    let rebounds = 0;
    let seenPrimaryLow = false;
    let recoveredAfterLow = false;

    for (let i = 1; i < segment.length; i++) {
        const prev = segment[i - 1];
        const curr = segment[i];
        const dtMs = curr.t - prev.t;
        if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > config.maxEyeIntervalMs) continue;

        const rel = curr.relativeOpenness;
        if (rel <= config.perclosMinDepthRel) {
            deepDwellMs += dtMs;
        }

        if (!seenPrimaryLow) {
            if (rel <= config.perclosReboundLowRel) {
                seenPrimaryLow = true;
            }
            continue;
        }

        if (!recoveredAfterLow) {
            if (rel >= config.perclosReboundHighRel) {
                recoveredAfterLow = true;
            }
            continue;
        }

        if (rel <= config.perclosReboundLowRel) {
            rebounds += 1;
            recoveredAfterLow = false;
        }
    }

    return {
        deepDwellMs,
        rebounds
    };
}

function classifyPerclosEvents(closureEvents, relativeSamples, config) {
    const rejectReasons = {};
    const events = [];
    let candidateCount = 0;
    let rejectedCount = 0;

    for (const event of closureEvents || []) {
        candidateCount += 1;
        const reasons = [];

        if (!(event.durationMs >= config.perclosMinDurationMs)) {
            reasons.push('too_short');
        }
        if (!(event.minRelativeOpenness <= config.perclosMinDepthRel)) {
            reasons.push('not_deep_enough');
        }
        const perclosDynamics = summarizePerclosDynamicsForEvent(relativeSamples, event.startMs, event.endMs, config);

        if (!(event.closureSpeed <= config.perclosMaxClosureSpeed)) {
            reasons.push('closure_too_fast');
        }
        if (!(event.openingSpeed >= config.perclosMinOpeningSpeed)) {
            reasons.push('opening_too_slow');
        }
        if (!(perclosDynamics.deepDwellMs >= config.perclosMinDeepDwellMs)) {
            reasons.push('insufficient_deep_dwell');
        }
        if (!(perclosDynamics.rebounds <= config.perclosMaxRebounds)) {
            reasons.push('oscillatory_rebounds');
        }
        if (config.perclosNoBlinkOverlap && event.isBlink === true) {
            reasons.push('blink_overlap');
        }

        const bothOpenDiagnostics = summarizeBothOpenInEvent(relativeSamples, event.startMs, event.endMs);
        const isPerclosEpisode = reasons.length === 0;

        if (!isPerclosEpisode) {
            rejectedCount += 1;
            for (const reason of reasons) {
                rejectReasons[reason] = (rejectReasons[reason] || 0) + 1;
            }
        }

        events.push({
            ...event,
            isPerclosEpisode,
            perclosRejectReasons: reasons,
            deepDwellMs: perclosDynamics.deepDwellMs,
            rebounds: perclosDynamics.rebounds,
            bothOpenFalsePct: bothOpenDiagnostics.bothOpenFalsePct,
            bothOpenDiagnostics
        });
    }

    return {
        events,
        candidateCount,
        rejectedCount,
        rejectReasons
    };
}

function getBlinkDetectionConfig(config) {
    return {
        ...config,
        closeThresholdRel: Number.isFinite(config.blinkCloseThresholdRel) ? config.blinkCloseThresholdRel : config.closeThresholdRel,
        openThresholdRel: Number.isFinite(config.blinkOpenThresholdRel) ? config.blinkOpenThresholdRel : config.openThresholdRel,
        minConfirmFrames: Number.isFinite(config.blinkMinConfirmFrames) ? config.blinkMinConfirmFrames : config.minConfirmFrames
    };
}

function pickBlinkRepresentative(group) {
    if (!Array.isArray(group) || group.length === 0) return null;
    const sorted = [...group].sort((a, b) => {
        const aAmp = Number.isFinite(a?.amplitude) ? a.amplitude : -Infinity;
        const bAmp = Number.isFinite(b?.amplitude) ? b.amplitude : -Infinity;
        if (bAmp !== aAmp) return bAmp - aAmp;
        const aMin = Number.isFinite(a?.minRelativeOpenness) ? a.minRelativeOpenness : Infinity;
        const bMin = Number.isFinite(b?.minRelativeOpenness) ? b.minRelativeOpenness : Infinity;
        if (aMin !== bMin) return aMin - bMin;
        return (a?.startMs || 0) - (b?.startMs || 0);
    });
    const best = sorted[0];
    const sourceEyes = [...new Set(group.map(event => event?.sourceEye).filter(Boolean))];
    return {
        ...best,
        sourceEyes,
        sourceEye: sourceEyes.length === 1 ? sourceEyes[0] : 'merged'
    };
}

function mergeBlinkEvents(rawBlinkEvents, config) {
    const events = (rawBlinkEvents || [])
        .filter(event => event?.isBlink === true)
        .sort((a, b) => ((a.startMs + a.endMs) / 2) - ((b.startMs + b.endMs) / 2));

    if (events.length === 0) return [];

    const merged = [];
    let group = [events[0]];
    let lastMid = (events[0].startMs + events[0].endMs) / 2;

    const gap = Number.isFinite(config?.blinkMergeGapMs) ? config.blinkMergeGapMs : 180;

    for (let i = 1; i < events.length; i++) {
        const event = events[i];
        const mid = (event.startMs + event.endMs) / 2;
        if ((mid - lastMid) <= gap) {
            group.push(event);
            lastMid = mid;
            continue;
        }

        const representative = pickBlinkRepresentative(group);
        if (representative) merged.push(representative);
        group = [event];
        lastMid = mid;
    }

    const tail = pickBlinkRepresentative(group);
    if (tail) merged.push(tail);
    return merged;
}

function detectBlinkEventsDualEye(sortedEye, config) {
    const blinkConfig = getBlinkDetectionConfig(config);
    const channels = ['leftEAR', 'rightEAR'];
    const perEyeEvents = [];

    for (const channel of channels) {
        const relative = buildRelativeSignal(sortedEye, channel, blinkConfig);
        if (!Array.isArray(relative) || relative.length === 0) continue;
        const events = detectClosureEvents(relative, blinkConfig)
            .filter(event => event.isBlink === true)
            .map(event => ({
                ...event,
                sourceEye: channel
            }));
        perEyeEvents.push(...events);
    }

    if (perEyeEvents.length === 0) {
        const relativeAvg = buildRelativeEyeSignal(sortedEye, blinkConfig);
        const avgEvents = detectClosureEvents(relativeAvg, blinkConfig)
            .filter(event => event.isBlink === true)
            .map(event => ({
                ...event,
                sourceEye: 'earAvg'
            }));
        return {
            blinkEvents: avgEvents,
            rawBlinkEvents: avgEvents,
            detectionConfig: blinkConfig
        };
    }

    const merged = mergeBlinkEvents(perEyeEvents, blinkConfig);
    return {
        blinkEvents: merged,
        rawBlinkEvents: perEyeEvents,
        detectionConfig: blinkConfig
    };
}

function markClosedSamples(relativeSamples, closureEvents) {
    if (!Array.isArray(relativeSamples) || relativeSamples.length === 0) return [];
    if (!Array.isArray(closureEvents) || closureEvents.length === 0) {
        return relativeSamples.map(sample => ({ ...sample, isClosed: false }));
    }

    const events = [...closureEvents].sort((a, b) => a.startMs - b.startMs);
    let idx = 0;
    return relativeSamples.map(sample => {
        while (idx < events.length && Number.isFinite(events[idx].endMs) && events[idx].endMs < sample.t) {
            idx++;
        }
        const event = events[idx];
        const isClosed = !!event && sample.t >= event.startMs && sample.t <= event.endMs;
        return {
            ...sample,
            isClosed
        };
    });
}

function computeSlidingPERCLOS(samples, windowMs, config) {
    if (!Array.isArray(samples) || samples.length < 2) {
        return { windowMs, values: [], mean: null, max: null };
    }

    const values = [];
    const queue = [];
    let observedMs = 0;
    let closedMs = 0;

    for (let i = 1; i < samples.length; i++) {
        const prev = samples[i - 1];
        const curr = samples[i];
        const dtMs = curr.t - prev.t;
        if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > config.maxEyeIntervalMs) continue;

        const interval = {
            endMs: curr.t,
            observedMs: dtMs,
            closedMs: curr.isClosed ? dtMs : 0
        };

        queue.push(interval);
        observedMs += interval.observedMs;
        closedMs += interval.closedMs;

        while (queue.length > 0 && (curr.t - queue[0].endMs) > windowMs) {
            const head = queue.shift();
            observedMs -= head.observedMs;
            closedMs -= head.closedMs;
        }

        const perclosPct = observedMs > 0 ? (closedMs / observedMs) * 100 : 0;
        values.push({
            t: curr.t,
            perclosPct: round(perclosPct, 2)
        });
    }

    const series = values.map(v => v.perclosPct).filter(Number.isFinite);
    return {
        windowMs,
        values,
        mean: toFiniteNumber(mean(series), null),
        max: series.length > 0 ? Math.max(...series) : null
    };
}

function summarizePerclosEpisodes(events, eyeDurationMs) {
    const episodes = (events || []).filter(event => event.isPerclosEpisode);
    const durations = episodes.map(event => event.durationMs).filter(Number.isFinite);
    const ratePerMin = eyeDurationMs > 0 ? (episodes.length / eyeDurationMs) * 60000 : 0;
    const bothOpenFalsePctSeries = episodes
        .map(event => event?.bothOpenDiagnostics?.bothOpenFalsePct)
        .filter(Number.isFinite);
    const bothOpenKnownSamplesSeries = episodes
        .map(event => event?.bothOpenDiagnostics?.knownSamples)
        .filter(Number.isFinite);

    return {
        count: episodes.length,
        ratePerMin: round(ratePerMin, 2),
        durationsMs: durations,
        meanDurationMs: round(mean(durations) || 0, 2),
        maxDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
        bothOpenDiagnostics: {
            meanBothOpenFalsePct: round(mean(bothOpenFalsePctSeries) || 0, 2),
            maxBothOpenFalsePct: bothOpenFalsePctSeries.length > 0 ? Math.max(...bothOpenFalsePctSeries) : 0,
            meanKnownSamplesPerEpisode: round(mean(bothOpenKnownSamplesSeries) || 0, 2)
        }
    };
}

function summarizeBlinks(closureEvents, blinkEvents, eyeDurationMs, config, blinkDetectionConfig = null) {
    const blinks = Array.isArray(blinkEvents) ? blinkEvents : [];
    const durations = blinks.map(b => b.durationMs);
    const amplitudes = blinks.map(b => b.amplitude);
    const closureSpeeds = blinks.map(b => b.closureSpeed);
    const openingSpeeds = blinks.map(b => b.openingSpeed);
    const incompleteCount = blinks.filter(b => b.incomplete).length;
    const blinkRatePerMin = eyeDurationMs > 0 ? (blinks.length / eyeDurationMs) * 60000 : 0;

    return {
        blinkCount: blinks.length,
        blinkRatePerMin: round(blinkRatePerMin, 2),
        durationMs: {
            mean: round(mean(durations) || 0, 2),
            p50: round(percentile(durations, 0.5) || 0, 2),
            p90: round(percentile(durations, 0.9) || 0, 2)
        },
        amplitude: {
            mean: round(mean(amplitudes) || 0, 3),
            p50: round(percentile(amplitudes, 0.5) || 0, 3),
            p90: round(percentile(amplitudes, 0.9) || 0, 3)
        },
        closureSpeed: {
            mean: round(mean(closureSpeeds) || 0, 3)
        },
        openingSpeed: {
            mean: round(mean(openingSpeeds) || 0, 3)
        },
        incompleteBlinkRate: blinks.length > 0 ? round((incompleteCount / blinks.length) * 100, 1) : 0,
        incompleteAmplitudeThreshold: config.incompleteAmplitudeThreshold,
        blinkDetection: {
            mode: 'dual_eye_merge',
            closeThresholdRel: blinkDetectionConfig?.closeThresholdRel ?? config.closeThresholdRel,
            openThresholdRel: blinkDetectionConfig?.openThresholdRel ?? config.openThresholdRel,
            minConfirmFrames: blinkDetectionConfig?.minConfirmFrames ?? config.minConfirmFrames,
            mergeGapMs: config.blinkMergeGapMs
        },
        blinks,
        closureEvents: closureEvents || []
    };
}

function getGazePoints(gazeSamples) {
    return (gazeSamples || [])
        .filter(s => Number.isFinite(s?.x) && Number.isFinite(s?.y) && Number.isFinite(s?.t))
        .sort((a, b) => a.t - b.t);
}

function getNormalizedGaze(sample) {
    const fallbackWidth = typeof window !== 'undefined' ? window.innerWidth || 1 : 1;
    const fallbackHeight = typeof window !== 'undefined' ? window.innerHeight || 1 : 1;
    const sw = Number.isFinite(sample?.screenWidth) && sample.screenWidth > 0 ? sample.screenWidth : fallbackWidth;
    const sh = Number.isFinite(sample?.screenHeight) && sample.screenHeight > 0 ? sample.screenHeight : fallbackHeight;
    return {
        nx: clamp01(sample.x / sw),
        ny: clamp01(sample.y / sh)
    };
}

function computeSaccadeFixationMetrics(gazeSamples, config) {
    const points = getGazePoints(gazeSamples).filter(s => s.onScreen !== false);
    if (points.length < 2) {
        return {
            gazeDurationMs: 0,
            saccadeRatePerMin: 0,
            saccadeCount: 0,
            peakSaccadeVelocity: 0,
            fixationCount: 0,
            fixationMeanDurationMs: 0,
            fixationDispersion: 0,
            intervals: []
        };
    }

    const intervals = [];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const dtMs = b.t - a.t;
        if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > config.maxGazeIntervalMs) continue;

        const pa = getNormalizedGaze(a);
        const pb = getNormalizedGaze(b);
        const dx = pb.nx - pa.nx;
        const dy = pb.ny - pa.ny;
        const dist = Math.hypot(dx, dy);
        const vel = dist / (dtMs / 1000);
        const isSaccade = vel >= config.saccadeVelocityThreshold;

        intervals.push({
            startMs: a.t,
            endMs: b.t,
            durationMs: dtMs,
            distanceNorm: dist,
            velocity: vel,
            isSaccade,
            nx: pb.nx,
            ny: pb.ny
        });
    }

    const saccades = intervals.filter(i => i.isSaccade);
    const peakSaccadeVelocity = saccades.length > 0 ? Math.max(...saccades.map(s => s.velocity)) : 0;

    const fixationSegments = [];
    let current = [];
    for (const interval of intervals) {
        if (interval.isSaccade) {
            if (current.length > 0) fixationSegments.push(current);
            current = [];
        } else {
            current.push(interval);
        }
    }
    if (current.length > 0) fixationSegments.push(current);

    const filteredFixations = fixationSegments
        .map(segment => {
            const durationMs = segment.reduce((acc, interval) => acc + interval.durationMs, 0);
            const xs = segment.map(interval => interval.nx);
            const ys = segment.map(interval => interval.ny);
            const dispersion = (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys));
            return { durationMs, dispersion };
        })
        .filter(fixation => fixation.durationMs >= config.minFixationDurationMs);

    const gazeDurationMs = withDurationMs(points[0].t, points[points.length - 1].t);
    const saccadeRatePerMin = gazeDurationMs > 0 ? (saccades.length / gazeDurationMs) * 60000 : 0;

    return {
        gazeDurationMs,
        saccadeRatePerMin: round(saccadeRatePerMin, 2),
        saccadeCount: saccades.length,
        peakSaccadeVelocity: round(peakSaccadeVelocity, 3),
        fixationCount: filteredFixations.length,
        fixationMeanDurationMs: round(mean(filteredFixations.map(fixation => fixation.durationMs)) || 0, 2),
        fixationDispersion: round(mean(filteredFixations.map(fixation => fixation.dispersion)) || 0, 4),
        intervals
    };
}

function computeMicroShiftProxy(intervals, gazeDurationMs, config) {
    if (!Array.isArray(intervals) || intervals.length === 0) {
        return {
            microShiftRatePerMin: 0,
            microShiftCount: 0,
            microShiftAmplitude: 0
        };
    }

    const events = [];
    let currentEvent = null;

    function flushCurrentEvent() {
        if (!currentEvent) return;
        const durationMs = withDurationMs(currentEvent.startMs, currentEvent.endMs);
        if (
            currentEvent.intervalCount >= config.microShiftMinIntervals
            && currentEvent.intervalCount <= config.microShiftMaxIntervals
            && durationMs >= config.microShiftMinDurationMs
            && durationMs <= config.microShiftMaxDurationMs
        ) {
            events.push({
                startMs: currentEvent.startMs,
                endMs: currentEvent.endMs,
                durationMs,
                peakAmplitudeNorm: currentEvent.peakAmplitudeNorm
            });
        }
        currentEvent = null;
    }

    for (const interval of intervals) {
        const amp = interval.distanceNorm;
        const vel = interval.velocity;
        const isCandidate = interval.isSaccade === false
            && amp >= config.microShiftMinAmp
            && amp <= config.microShiftMaxAmp
            && vel >= config.microShiftMinVelocity
            && vel < config.microShiftMaxVelocity;

        if (!isCandidate) {
            flushCurrentEvent();
            continue;
        }

        if (!currentEvent) {
            currentEvent = {
                startMs: interval.startMs,
                endMs: interval.endMs,
                intervalCount: 1,
                peakAmplitudeNorm: amp
            };
        } else {
            currentEvent.endMs = interval.endMs;
            currentEvent.intervalCount += 1;
            currentEvent.peakAmplitudeNorm = Math.max(currentEvent.peakAmplitudeNorm, amp);
        }
    }
    flushCurrentEvent();

    const ratePerMin = gazeDurationMs > 0 ? (events.length / gazeDurationMs) * 60000 : 0;
    const ampMean = mean(events.map(event => event.peakAmplitudeNorm)) || 0;
    return {
        microShiftRatePerMin: round(ratePerMin, 2),
        microShiftCount: events.length,
        microShiftAmplitude: round(ampMean, 4)
    };
}

function detrendMovingAverage(values, win = 15) {
    if (!Array.isArray(values) || values.length === 0) return [];
    const out = [];
    let sum = 0;
    const queue = [];
    for (let i = 0; i < values.length; i++) {
        const value = values[i];
        queue.push(value);
        sum += value;
        if (queue.length > win) sum -= queue.shift();
        const avg = sum / queue.length;
        out.push(value - avg);
    }
    return out;
}

function spectralStats(timesMs, signal, minFreq = 0.1, maxFreq = 2.0, step = 0.05) {
    if (!Array.isArray(timesMs) || !Array.isArray(signal) || timesMs.length !== signal.length || signal.length < 64) {
        return { dominantFreq: null, bandPower: null };
    }

    const n = signal.length;
    let maxPower = -Infinity;
    let dominantFreq = null;
    let bandPower = 0;

    for (let f = minFreq; f <= maxFreq + 1e-9; f += step) {
        let re = 0;
        let im = 0;
        for (let i = 0; i < n; i++) {
            const tSec = timesMs[i] / 1000;
            const phi = 2 * Math.PI * f * tSec;
            re += signal[i] * Math.cos(phi);
            im -= signal[i] * Math.sin(phi);
        }
        const power = (re * re + im * im) / (n * n);
        if (power > maxPower) {
            maxPower = power;
            dominantFreq = f;
        }
        if (f >= 0.1 && f <= 1.0) {
            bandPower += power;
        }
    }

    return {
        dominantFreq: Number.isFinite(dominantFreq) ? round(dominantFreq, 3) : null,
        bandPower: Number.isFinite(bandPower) ? round(bandPower, 8) : null
    };
}

function computeHippusProxy(eyeSignals, config) {
    const samples = (eyeSignals || [])
        .filter(s => Number.isFinite(s?.t) && Number.isFinite(s?.pupilProxy))
        .sort((a, b) => a.t - b.t);

    if (samples.length === 0) {
        return {
            hippusStd: 0,
            hippusBandPower: null,
            hippusDominantFreq: null,
            qualityFlag: false,
            qualityReason: 'missing_pupil_proxy'
        };
    }

    if (samples.length < config.hippusMinSamples) {
        return {
            hippusStd: 0,
            hippusBandPower: null,
            hippusDominantFreq: null,
            qualityFlag: false,
            qualityReason: 'insufficient_samples'
        };
    }

    const times = samples.map(s => s.t);
    const values = samples.map(s => s.pupilProxy);
    const detrended = detrendMovingAverage(values, config.hippusDetrendWindow);
    const hippusStd = stdDev(detrended) || 0;
    const spectrum = spectralStats(times, detrended, config.hippusMinFreq, config.hippusMaxFreq, config.hippusFreqStep);
    const qualityFlag = samples.length >= config.hippusQualityMinSamples
        && hippusStd > config.hippusStdMin
        && Number.isFinite(spectrum.dominantFreq);

    let qualityReason = null;
    if (!qualityFlag) {
        if (samples.length < config.hippusQualityMinSamples) {
            qualityReason = 'short_signal';
        } else if (!(hippusStd > config.hippusStdMin)) {
            qualityReason = 'low_variability';
        } else {
            qualityReason = 'spectrum_unstable';
        }
    }

    return {
        hippusStd: round(hippusStd, 6),
        hippusBandPower: spectrum.bandPower,
        hippusDominantFreq: spectrum.dominantFreq,
        qualityFlag,
        qualityReason
    };
}

function buildSubsetMeta(config, scopeMeta = null) {
    return {
        algorithmVersion: ATTENTION_ALGO_VERSION,
        baselineWindowMs: config.baselineWindowMs,
        baselinePercentile: config.baselinePercentile,
        warmupMs: config.warmupMs,
        closeThresholdRel: config.closeThresholdRel,
        openThresholdRel: config.openThresholdRel,
        minConfirmFrames: config.minConfirmFrames,
        blinkCloseThresholdRel: config.blinkCloseThresholdRel,
        blinkOpenThresholdRel: config.blinkOpenThresholdRel,
        blinkMinConfirmFrames: config.blinkMinConfirmFrames,
        blinkMergeGapMs: config.blinkMergeGapMs,
        blinkMinMs: config.blinkMinMs,
        blinkMaxMs: config.blinkMaxMs,
        perclosEpisodeMinMs: config.perclosMinDurationMs,
        perclosCriteria: {
            minDurationMs: config.perclosMinDurationMs,
            minDepthRel: config.perclosMinDepthRel,
            minDeepDwellMs: config.perclosMinDeepDwellMs,
            maxRebounds: config.perclosMaxRebounds,
            reboundHighRel: config.perclosReboundHighRel,
            reboundLowRel: config.perclosReboundLowRel,
            maxClosureSpeed: config.perclosMaxClosureSpeed,
            minOpeningSpeed: config.perclosMinOpeningSpeed,
            noBlinkOverlap: config.perclosNoBlinkOverlap
        },
        perclosWindowsMs: config.perclosWindowsMs,
        microShift: {
            minAmp: config.microShiftMinAmp,
            maxAmp: config.microShiftMaxAmp,
            minVelocity: config.microShiftMinVelocity,
            maxVelocity: config.microShiftMaxVelocity,
            minDurationMs: config.microShiftMinDurationMs,
            maxDurationMs: config.microShiftMaxDurationMs
        },
        scopeStartPhase: scopeMeta?.scopeStartPhase ?? null,
        scopeStartMs: Number.isFinite(scopeMeta?.scopeStartMs) ? scopeMeta.scopeStartMs : null,
        scopeFilterApplied: scopeMeta?.scopeFilterApplied === true
    };
}

function computeMetricsForSubset(eyeSignals, gazeSamples, config = DEFAULTS, scopeMeta = null) {
    const sortedEye = (eyeSignals || [])
        .filter(s => Number.isFinite(s?.t) && Number.isFinite(s?.earAvg))
        .sort((a, b) => a.t - b.t);
    const eyeDurationMs = sortedEye.length > 1 ? withDurationMs(sortedEye[0].t, sortedEye[sortedEye.length - 1].t) : 0;

    const relativeSamples = buildRelativeEyeSignal(sortedEye, config);
    const rawClosureEvents = detectClosureEvents(relativeSamples, config);
    const perclosClassification = classifyPerclosEvents(rawClosureEvents, relativeSamples, config);
    const closureEvents = perclosClassification.events;
    const perclosEvents = closureEvents.filter(event => event.isPerclosEpisode);
    const markedSamples = markClosedSamples(relativeSamples, perclosEvents);
    const perclos30 = computeSlidingPERCLOS(markedSamples, config.perclosWindowsMs[0], config);
    const perclos60 = computeSlidingPERCLOS(markedSamples, config.perclosWindowsMs[1], config);
    const perclosEpisodes = summarizePerclosEpisodes(closureEvents, eyeDurationMs);
    const blinkDetection = detectBlinkEventsDualEye(sortedEye, config);
    const blinkSummary = summarizeBlinks(
        closureEvents,
        blinkDetection.blinkEvents,
        eyeDurationMs,
        config,
        blinkDetection.detectionConfig
    );

    const saccFix = computeSaccadeFixationMetrics(gazeSamples || [], config);
    const gazeDurationMs = saccFix.gazeDurationMs;
    const micro = computeMicroShiftProxy(saccFix.intervals, gazeDurationMs, config);
    const hippus = computeHippusProxy(sortedEye, config);

    return {
        sampleCount: sortedEye.length,
        durationMs: eyeDurationMs,
        eyeDurationMs,
        gazeDurationMs,
        meta: buildSubsetMeta(config, scopeMeta),
        perclos: {
            closedThresholdNorm: config.closeThresholdRel,
            closedThresholdRel: config.closeThresholdRel,
            openThresholdRel: config.openThresholdRel,
            criteria: {
                minDurationMs: config.perclosMinDurationMs,
                minDepthRel: config.perclosMinDepthRel,
                minDeepDwellMs: config.perclosMinDeepDwellMs,
                maxRebounds: config.perclosMaxRebounds,
                reboundHighRel: config.perclosReboundHighRel,
                reboundLowRel: config.perclosReboundLowRel,
                maxClosureSpeed: config.perclosMaxClosureSpeed,
                minOpeningSpeed: config.perclosMinOpeningSpeed,
                noBlinkOverlap: config.perclosNoBlinkOverlap
            },
            candidateCount: perclosClassification.candidateCount,
            rejectedCount: perclosClassification.rejectedCount,
            rejectReasons: { ...perclosClassification.rejectReasons },
            windows: {
                '30s': {
                    meanPct: perclos30.mean,
                    maxPct: perclos30.max,
                    values: perclos30.values
                },
                '60s': {
                    meanPct: perclos60.mean,
                    maxPct: perclos60.max,
                    values: perclos60.values
                }
            },
            episodes: perclosEpisodes
        },
        blinkDynamics: {
            ...blinkSummary
        },
        saccadesAndFixations: {
            saccadeRatePerMin: saccFix.saccadeRatePerMin,
            saccadeCount: saccFix.saccadeCount,
            peakVelocity: saccFix.peakSaccadeVelocity,
            fixationCount: saccFix.fixationCount,
            fixationMeanDurationMs: saccFix.fixationMeanDurationMs,
            fixationDispersion: saccFix.fixationDispersion
        },
        microShiftProxy: micro,
        hippusProxy: hippus
    };
}

function uniq(values) {
    return [...new Set(values)];
}

export function buildAttentionMetrics(sessionData) {
    const rawEyeSignals = Array.isArray(sessionData?.eyeSignals) ? sessionData.eyeSignals : [];
    const rawGazeSamples = Array.isArray(sessionData?.eyeTracking) ? sessionData.eyeTracking : [];
    const filtered = filterPostCalibrationSamples(rawEyeSignals, rawGazeSamples);
    const eyeSignals = filtered.eyeSignals;
    const gazeSamples = filtered.gazeSamples;
    const scopeMeta = filtered.scope;
    const global = computeMetricsForSubset(eyeSignals, gazeSamples, DEFAULTS, scopeMeta);

    const phases = uniq([
        ...eyeSignals.map(s => s?.phase).filter(Boolean),
        ...gazeSamples.map(s => s?.phase).filter(Boolean)
    ]);
    const perPhase = {};
    for (const phase of phases) {
        perPhase[phase] = computeMetricsForSubset(
            eyeSignals.filter(s => s?.phase === phase),
            gazeSamples.filter(s => s?.phase === phase),
            DEFAULTS,
            scopeMeta
        );
    }

    const blocks = uniq([
        ...eyeSignals.map(s => s?.blockId).filter(v => v != null),
        ...gazeSamples.map(s => s?.blockId).filter(v => v != null)
    ]);
    const perBlock = {};
    for (const blockId of blocks) {
        perBlock[String(blockId)] = computeMetricsForSubset(
            eyeSignals.filter(s => s?.blockId === blockId),
            gazeSamples.filter(s => s?.blockId === blockId),
            DEFAULTS,
            scopeMeta
        );
    }

    const focus = {
        cognitiveStimulus: computeMetricsForSubset(
            eyeSignals.filter(s => s?.phase === 'cognitive_stimulus'),
            gazeSamples.filter(s => s?.phase === 'cognitive_stimulus'),
            DEFAULTS,
            scopeMeta
        )
    };

    return {
        version: ATTENTION_ALGO_VERSION,
        computedAt: Date.now(),
        scope: 'research_only',
        windows: ['30s', '60s'],
        sampleCounts: {
            eyeSignals: eyeSignals.length,
            gazeSamples: gazeSamples.length
        },
        rawSampleCounts: {
            eyeSignals: rawEyeSignals.length,
            gazeSamples: rawGazeSamples.length
        },
        scopeStartPhase: scopeMeta.scopeStartPhase,
        scopeStartMs: scopeMeta.scopeStartMs,
        scopeFilterApplied: scopeMeta.scopeFilterApplied,
        global,
        perPhase,
        perBlock,
        focus
    };
}
