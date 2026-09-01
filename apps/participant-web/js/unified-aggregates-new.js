import { getEmotionSummary } from './emotion-stub-new.js';
import { SESSION_CONTRACT_VERSION } from './session-runtime/contracts.mjs';

/**
 * Формирование payload агрегатов для отправки на сервер (Фаза 0.1).
 * PII (user.email и др.) в meta.user не включаются — только interfaceLanguage и технические поля.
 * Сырые массивы (eyeTracking, eyeSignals, trackingTest, heatmaps) не включаются.
 * Фаза 1.4: добавлен блок emotion_summary (valence_mean, arousal_mean).
 */

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function clamp01(v) {
    return clamp(v, 0, 1);
}

function roundN(v, n = 2) {
    if (!Number.isFinite(v)) return null;
    const f = 10 ** n;
    return Math.round(v * f) / f;
}

function mean(nums) {
    if (!Array.isArray(nums) || nums.length === 0) return null;
    let s = 0;
    let c = 0;
    for (const v of nums) {
        if (!Number.isFinite(v)) continue;
        s += v;
        c++;
    }
    return c > 0 ? s / c : null;
}

const RAW_SERIES_KEYS = new Set([
    'landmarks',
    'samples',
    'values',
    'points',
    'benchmarkPoints',
    'trajectory',
    'blinks',
    'closureEvents',
    'fpsHistory',
    'durationsMs'
]);

/**
 * Keep scientific summaries while removing frame-level series. The full local
 * session can still be downloaded, but /ingest must stay below the route limit
 * and must never transport raw face landmarks.
 */
function compactMetricObject(value, depth = 0) {
    if (value == null || typeof value !== 'object') return value;
    if (depth > 8) return null;
    if (Array.isArray(value)) {
        if (value.length <= 32 && value.every(item => (
            item == null || ['string', 'number', 'boolean'].includes(typeof item)
        ))) {
            return value.slice();
        }
        return undefined;
    }

    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (Array.isArray(item)) {
            if (RAW_SERIES_KEYS.has(key) || item.some(entry => entry && typeof entry === 'object')) {
                out[`${key}Count`] = item.length;
                continue;
            }
            if (item.length <= 32) out[key] = item.slice();
            else out[`${key}Count`] = item.length;
            continue;
        }
        if (RAW_SERIES_KEYS.has(key) && item && typeof item === 'object') continue;
        const compacted = compactMetricObject(item, depth + 1);
        if (compacted !== undefined) out[key] = compacted;
    }
    return out;
}

function compactPrecheck(precheck) {
    return precheck && typeof precheck === 'object'
        ? compactMetricObject(precheck)
        : {};
}

function compactAttentionMetrics(metrics) {
    return metrics && typeof metrics === 'object'
        ? compactMetricObject(metrics)
        : null;
}

function compactBlinkSummary(summary) {
    return summary && typeof summary === 'object'
        ? compactMetricObject(summary)
        : null;
}

function compactPerclosSummary(summary) {
    return summary && typeof summary === 'object'
        ? compactMetricObject(summary)
        : null;
}

function compactGazeValidation(validation) {
    return validation && typeof validation === 'object'
        ? compactMetricObject(validation)
        : null;
}

function compactAudioSummary(summary) {
    if (!summary || typeof summary !== 'object') return null;
    return {
        ...summary,
        markers: Array.isArray(summary.markers)
            ? summary.markers.slice(0, 32).map(item => compactMetricObject(item))
            : [],
        windows: Array.isArray(summary.windows)
            ? summary.windows.slice(-360).map(item => compactMetricObject(item))
            : []
    };
}

function extractBlockOrder(events) {
    const list = Array.isArray(events) ? events : [];
    const starts = list
        .filter(e => e && e.type === 'block_start' && e.blockId != null && Number.isFinite(e.blockIndex))
        .map(e => ({
            blockId: String(e.blockId),
            blockType: e.blockType != null ? String(e.blockType) : null,
            blockIndex: Number(e.blockIndex)
        }));

    // Ensure stable order even if some blocks are missing from events for some reason.
    starts.sort((a, b) => a.blockIndex - b.blockIndex);
    const seen = new Set();
    const out = [];
    for (const s of starts) {
        if (seen.has(s.blockId)) continue;
        seen.add(s.blockId);
        out.push(s);
    }
    return out;
}

function buildBlocksFromSession(sessionData, emotion_summary) {
    const attentionPerBlock = sessionData?.attentionMetrics?.perBlock && typeof sessionData.attentionMetrics.perBlock === 'object'
        ? sessionData.attentionMetrics.perBlock
        : {};
    const cognitiveResults = Array.isArray(sessionData?.cognitiveResults) ? sessionData.cognitiveResults : [];
    const events = Array.isArray(sessionData?.events) ? sessionData.events : [];

    const blocksOrder = extractBlockOrder(events);
    const blocksById = new Map(blocksOrder.map(b => [b.blockId, b]));

    // Fallback: if we can't infer order from events, derive from attention metrics keys.
    const fallbackBlockIds = blocksOrder.length
        ? []
        : Object.keys(attentionPerBlock || {});

    const blockIds = blocksOrder.length
        ? blocksOrder.map(b => b.blockId)
        : fallbackBlockIds;

    if (!Array.isArray(blockIds) || blockIds.length === 0) return [];

    const valence = emotion_summary?.valence_mean ?? null;
    const arousalGlobal = emotion_summary?.arousal_mean ?? null;

    return blockIds.map((blockId) => {
        const att = attentionPerBlock?.[String(blockId)] || null;

        // attention/arousal: derive from perclos "meanPct" (0..100).
        const perclosMean60 = att?.perclos?.windows?.['60s']?.meanPct;
        const perclosMean30 = att?.perclos?.windows?.['30s']?.meanPct;
        const perclosMean = Number.isFinite(perclosMean60) ? perclosMean60
            : (Number.isFinite(perclosMean30) ? perclosMean30 : null);

        const attention = perclosMean != null ? clamp(100 - perclosMean, 0, 100) : null;
        const arousal = perclosMean != null ? clamp01(perclosMean / 100) : arousalGlobal;

        const blinks = att?.blinkDynamics?.blinkCount != null ? Number(att.blinkDynamics.blinkCount) : null;

        const trials = cognitiveResults.filter(r => String(r?.blockId) === String(blockId));
        const total = trials.length;
        const rtVals = trials
            .map(r => r?.rt)
            .filter(v => Number.isFinite(v));
        const rt = mean(rtVals);

        // omissions: "no response" rate in percent, to match analytics examples (~2-5 for typical trial counts).
        const omissionCount = trials.filter(r => r?.response == null).length;
        const omissionRatePct = total > 0 ? (omissionCount / total) * 100 : null;

        const blockInfo = blocksById.get(String(blockId));
        const name = (blockInfo?.blockType || blockId);

        return {
            name,
            attention: attention != null ? Math.round(attention) : null,
            arousal: arousal != null ? roundN(arousal, 3) : null,
            valence: valence != null ? roundN(valence, 3) : null,
            blinks: blinks != null ? Math.round(blinks) : null,
            rt: rt != null ? Math.round(rt) : null,
            omissions: omissionRatePct != null ? roundN(omissionRatePct, 2) : null
        };
    });
}

function buildBpmSummary(sessionData) {
    const provided = sessionData?.bpm_summary ?? sessionData?.bpmSummary ?? null;
    if (provided && typeof provided === 'object') {
        return { ...provided };
    }

    const bpmRoot = sessionData?.bpm && typeof sessionData.bpm === 'object' ? sessionData.bpm : null;
    const bpmDataRoot = sessionData?.bpmData && typeof sessionData.bpmData === 'object' ? sessionData.bpmData : null;
    const bpmRunsFromRoots = Array.isArray(bpmRoot?.runs)
        ? bpmRoot.runs
        : (Array.isArray(bpmDataRoot?.runs) ? bpmDataRoot.runs : []);
    const runs = Array.isArray(sessionData?.bpmRuns)
        ? sessionData.bpmRuns
        : bpmRunsFromRoots;

    const bpmMeanFromRoots = Number.isFinite(bpmRoot?.bpmMean)
        ? Number(bpmRoot.bpmMean)
        : (Number.isFinite(bpmDataRoot?.bpmMean) ? Number(bpmDataRoot.bpmMean) : null);
    const sampleCountFromRoots = Number.isFinite(bpmRoot?.sampleCount)
        ? Number(bpmRoot.sampleCount)
        : (Number.isFinite(bpmDataRoot?.sampleCount) ? Number(bpmDataRoot.sampleCount) : null);

    if (!runs.length) {
        return { runs: 0, sampleCount: sampleCountFromRoots ?? 0, bpmMean: bpmMeanFromRoots };
    }
    const last = runs[runs.length - 1] || {};
    const sampleCount = runs.reduce((acc, run) => acc + (Number.isFinite(run?.sampleCount) ? Number(run.sampleCount) : 0), 0);
    const means = runs.map(run => run?.bpmMean).filter(Number.isFinite);
    const bpmMean = means.length ? roundN(means.reduce((a, b) => a + b, 0) / means.length, 2) : bpmMeanFromRoots;
    return {
        runs: runs.length,
        sampleCount: sampleCount || (sampleCountFromRoots ?? 0),
        bpmMean,
        lastRun: {
            sampleCount: Number.isFinite(last?.sampleCount) ? Number(last.sampleCount) : null,
            bpmMean: Number.isFinite(last?.bpmMean) ? Number(last.bpmMean) : null,
            stopReason: last?.stopReason || null
        }
    };
}

function collectRespRatesFromSessionJson(sessionJson) {
    if (!sessionJson || typeof sessionJson !== 'object') return [];
    const samples = Array.isArray(sessionJson.samples) ? sessionJson.samples : [];
    return samples.map((s) => s?.resp_rate).filter(Number.isFinite);
}

function collectRespRates(sessionData) {
    const rates = [];
    const addRates = (list) => {
        for (const rate of list) {
            if (Number.isFinite(rate)) rates.push(rate);
        }
    };

    if (Array.isArray(sessionData?.respirationRuns)) {
        for (const run of sessionData.respirationRuns) {
            addRates(collectRespRatesFromSessionJson(run?.rppgSession));
        }
    }
    if (Array.isArray(sessionData?.bpmRuns)) {
        for (const run of sessionData.bpmRuns) {
            addRates(collectRespRatesFromSessionJson(run?.rppgSession));
        }
    }
    return rates;
}

function normalizeRespirationSummaryPayload(summary) {
    const respSampleCountRaw = summary?.resp_sample_count ?? summary?.validRespSampleCount ?? summary?.sampleCount;
    const respSampleCount = Number.isFinite(respSampleCountRaw)
        ? Math.max(0, Math.round(Number(respSampleCountRaw)))
        : 0;
    const respRateMean = roundN(
        Number.isFinite(summary?.resp_rate_mean) ? summary.resp_rate_mean : summary?.respRateMean,
        2
    );
    const respRateMin = roundN(
        Number.isFinite(summary?.resp_rate_min) ? summary.resp_rate_min : summary?.respRateMin,
        2
    );
    const respRateMax = roundN(
        Number.isFinite(summary?.resp_rate_max) ? summary.resp_rate_max : summary?.respRateMax,
        2
    );
    const respAvailable = typeof summary?.resp_available === 'boolean'
        ? summary.resp_available
        : (typeof summary?.respAvailable === 'boolean'
            ? summary.respAvailable
            : respSampleCount > 0);

    return {
        resp_rate_mean: respRateMean,
        resp_rate_min: respRateMin,
        resp_rate_max: respRateMax,
        resp_sample_count: respSampleCount,
        resp_available: Boolean(respAvailable)
    };
}

function buildRespirationSummary(sessionData) {
    const provided = sessionData?.respiration_summary ?? sessionData?.respirationSummary ?? null;
    if (provided && typeof provided === 'object') {
        return normalizeRespirationSummaryPayload(provided);
    }

    const respRates = collectRespRates(sessionData);
    if (!respRates.length) {
        return {
            resp_rate_mean: null,
            resp_rate_min: null,
            resp_rate_max: null,
            resp_sample_count: 0,
            resp_available: false
        };
    }

    return {
        resp_rate_mean: roundN(mean(respRates), 2),
        resp_rate_min: roundN(Math.min(...respRates), 2),
        resp_rate_max: roundN(Math.max(...respRates), 2),
        resp_sample_count: respRates.length,
        resp_available: true
    };
}

function buildRppgSummary(sessionData) {
    const provided = sessionData?.rppg_summary ?? sessionData?.rppgSummary ?? null;
    if (provided && typeof provided === 'object') {
        return { ...provided };
    }

    const rppgRoot = sessionData?.rppg && typeof sessionData.rppg === 'object' ? sessionData.rppg : null;
    if (rppgRoot) {
        return { ...rppgRoot };
    }

    const bpmRuns = Array.isArray(sessionData?.bpmRuns) ? sessionData.bpmRuns : [];
    let sampleCount = 0;
    for (const run of bpmRuns) {
        const sessionSamples = run?.rppgSession?.session?.samples;
        if (Number.isFinite(sessionSamples)) sampleCount += Number(sessionSamples);
        else if (Number.isFinite(run?.sampleCount)) sampleCount += Number(run.sampleCount);
    }

    return {
        runs: bpmRuns.length,
        sampleCount
    };
}

function buildEmotionSummaryPayload(sessionData, emotionSummary) {
    const source = sessionData?.emotion_summary ?? sessionData?.emotionSummary ?? null;
    const quality = source?.quality ?? emotionSummary?.quality ?? null;
    const confidence = source?.confidence ?? emotionSummary?.confidence ?? null;

    const summary = {
        valence_mean: emotionSummary?.valence_mean ?? null,
        arousal_mean: emotionSummary?.arousal_mean ?? null,
        n: Number.isFinite(emotionSummary?.n) ? Number(emotionSummary.n) : 0
    };

    // Keep the core block stable and append optional QC/ML reliability fields only when available.
    if (quality != null) summary.quality = quality;
    if (confidence != null) summary.confidence = confidence;

    return summary;
}

const INGEST_EVENT_TYPES = new Set([
    'block_start',
    'block_end',
    'phase_change',
    'session_finish_complete',
    'upload_attempt',
    'upload_success',
    'upload_failed',
    'upload_retry',
    'cognitive_task_start',
    'cognitive_task_complete',
    'cognitive_task_error',
    'invitation_auto_start_cognitive'
]);

export function trimEventsForIngest(events) {
    const list = Array.isArray(events) ? events : [];
    const filtered = list.filter((e) => e && (
        INGEST_EVENT_TYPES.has(e.type)
        || (e.schemaVersion === 'session_event.v1' && e.category !== 'input')
    ));
    const picked = filtered.length ? filtered : list;
    const limit = 250;
    if (picked.length <= limit) return picked;

    // Survey answers are research data, not disposable diagnostics. Keep every
    // response that fits the transport limit, then fill remaining slots with
    // the newest non-survey events while preserving chronological order.
    const requiredIndexes = [];
    picked.forEach((event, index) => {
        if (event?.type === 'survey_response') requiredIndexes.push(index);
    });
    const retainedRequired = requiredIndexes.slice(-limit);
    const selectedIndexes = new Set(retainedRequired);
    let remaining = limit - selectedIndexes.size;
    for (let index = picked.length - 1; index >= 0 && remaining > 0; index -= 1) {
        if (selectedIndexes.has(index)) continue;
        selectedIndexes.add(index);
        remaining--;
    }
    return picked.filter((_, index) => selectedIndexes.has(index));
}

function buildGazeAnalyticsPayload(sessionData) {
    const samples = Array.isArray(sessionData?.eyeTracking) ? sessionData.eyeTracking : [];
    const allPresentations = Array.isArray(sessionData?.heatmaps?.perStimulus)
        ? sessionData.heatmaps.perStimulus
        : [];
    const presentations = allPresentations.slice(0, 200).map(entry => ({
            blockId: entry.blockId ?? null,
            attempt: entry.attempt ?? null,
            trialId: entry.trialId ?? null,
            stimulusId: entry.stimulusId ?? null,
            stimulusName: entry.stimulusName ?? null,
            stimulusType: entry.stimulusType ?? null,
            stimulusVersion: entry.stimulusVersion || '1',
            presentationId: entry.presentationId || `${String(entry.blockId)}:${String(entry.attempt ?? 'attempt')}:${String(entry.trialId ?? 'trial')}:${String(entry.stimulusId)}`,
            intrinsicWidth: Number.isFinite(entry.intrinsicWidth) ? entry.intrinsicWidth : null,
            intrinsicHeight: Number.isFinite(entry.intrinsicHeight) ? entry.intrinsicHeight : null,
            grid: entry.grid || { width: 0, height: 0, values: [] },
            fixationPoints: Array.isArray(entry.fixationPoints) ? entry.fixationPoints : [],
            sampleCountTotal: Number(entry.sampleCountTotal || 0),
            sampleCountValid: Number(entry.sampleCountValid || 0),
            lowConfidenceCount: Number(entry.lowConfidenceCount || 0),
            offScreenCount: Number(entry.offScreenCount || 0),
            outsideStimulusCount: Number(entry.outsideStimulusCount || 0),
            validObservationDurationMs: Number(entry.validObservationDurationMs || 0),
            meanConfidence: Number.isFinite(entry.meanConfidence) ? entry.meanConfidence : null,
            algorithm: entry.algorithm || null
        }));
    const validSamples = samples.filter(sample => sample?.valid !== false
        && Number.isFinite(sample?.correctedX) && Number.isFinite(sample?.correctedY));
    const confidences = validSamples.map(sample => sample?.confidence).filter(Number.isFinite);
    const times = samples.map(sample => sample?.t).filter(Number.isFinite).sort((a, b) => a - b);
    const observationDurationMs = times.length > 1 ? Math.max(0, times[times.length - 1] - times[0]) : 0;
    const outsideStimulusCount = presentations.reduce((sum, entry) => sum + entry.outsideStimulusCount, 0);
    return {
        schemaVersion: 'gaze_analytics.v1',
        coordinateSpace: 'stimulus_normalized_0_1',
        summary: {
            sampleCountTotal: samples.length,
            sampleCountValid: validSamples.length,
            validFraction: samples.length ? roundN(validSamples.length / samples.length, 4) : null,
            lowConfidenceCount: samples.filter(sample => Number.isFinite(sample?.confidence) && sample.confidence < 0.65).length,
            offScreenCount: samples.filter(sample => sample?.onScreen === false).length,
            outsideStimulusCount,
            observationDurationMs: Math.round(observationDurationMs),
            meanConfidence: confidences.length ? roundN(mean(confidences), 4) : null,
            presentationCountTotal: allPresentations.length,
            presentationCountStored: presentations.length,
            presentationsTruncated: allPresentations.length > presentations.length
        },
        presentations
    };
}

export function buildAggregatesPayload(sessionData, options = {}) {
    if (!sessionData || typeof sessionData !== 'object') return null;
    const forIngest = options.forIngest === true;
    const u = sessionData.user || {};
    const sourceIds = (sessionData.ids && typeof sessionData.ids === 'object') ? sessionData.ids : {};
    const ids = {};
    if (sourceIds.session != null) ids.session = sourceIds.session;
    if (sourceIds.participant != null) ids.participant = sourceIds.participant;
    if (sourceIds.invitationCode != null) ids.invitationCode = sourceIds.invitationCode;
    const emotion_summary = getEmotionSummary(sessionData);
    const emotionSummaryPayload = buildEmotionSummaryPayload(sessionData, emotion_summary);
    const blocks = buildBlocksFromSession(sessionData, emotion_summary);
    const bpm_summary = buildBpmSummary(sessionData);
    const rppg_summary = buildRppgSummary(sessionData);
    const respiration_summary = buildRespirationSummary(sessionData);
    const gaze_analytics = buildGazeAnalyticsPayload(sessionData);
    return {
        schemaVersion: SESSION_CONTRACT_VERSION,
        ids,
        meta: {
            user: {
                interfaceLanguage: u.interfaceLanguage ?? null
            },
            tech: sessionData.tech ? { ...sessionData.tech } : {}
        },
        precheck: compactPrecheck(sessionData.precheck),
        qcSummary: sessionData.qcSummary ? { ...sessionData.qcSummary } : null,
        attentionMetrics: compactAttentionMetrics(sessionData.attentionMetrics),
        blink_summary: compactBlinkSummary(sessionData.blinkSummary),
        perclos_summary: compactPerclosSummary(sessionData.perclosSummary),
        body_pose_summary: sessionData.bodyPoseSummary ? { ...sessionData.bodyPoseSummary } : null,
        audio_summary: compactAudioSummary(sessionData.audioSummary),
        multimodal_summary: sessionData.multimodalSummary
            ? { ...sessionData.multimodalSummary }
            : null,
        multimodal_heatmap: sessionData.multimodalHeatmap
            ? { ...sessionData.multimodalHeatmap }
            : null,
        blocks,
        emotion_summary: emotionSummaryPayload,
        bpm_summary,
        rppg_summary,
        respiration_summary,
        ...(sessionData.experimentMeta && typeof sessionData.experimentMeta === 'object'
            ? { experimentMeta: { ...sessionData.experimentMeta } }
            : {}),
        cognitiveResults: Array.isArray(sessionData.cognitiveResults) ? [...sessionData.cognitiveResults] : [],
        gazeValidation: compactGazeValidation(sessionData.gazeValidation),
        gaze_analytics,
        events: forIngest
            ? trimEventsForIngest(sessionData.events)
            : (Array.isArray(sessionData.events) ? [...sessionData.events] : []),
        lifecycle: sessionData.lifecycle ? { ...sessionData.lifecycle } : null,
        startTime: sessionData.startTime ?? null,
        testHub: sessionData.testHub ? { ...sessionData.testHub } : null,
        gazeTests: sessionData.gazeTests ? { ...sessionData.gazeTests } : null
    };
}
