/**
 * Heatmap builder — time-weighted и quality-weighted.
 *
 * Что считаем:
 *  - bins[y][x] += dtMs × qualityWeight  (вместо простого `+= 1`)
 *
 *    dtMs        — интервал между текущим и предыдущим sample (внутри одного
 *                  аккумулятора), clamp'ится в [0, 100] чтобы паузы / переключения
 *                  фаз не раздували bin'ы. Для самой первой точки используется
 *                  fallback 33ms (~30fps).
 *    qualityWeight = 1 / (1 + (validationRmsPx / aoiRadiusPx)²)
 *      — приближается к 1 при низкой ошибке валидации, падает к 0 при большой.
 *      Если validationRmsPx неизвестен, qualityWeight = 1 (т.е. чисто
 *      time-weighted).
 *
 * Зачем это:
 *  - Простой sample-count даёт несоразмерное влияние участникам с высоким FPS.
 *    Time-weighting делает heatmap'ы сравнимыми между разными FPS.
 *  - Quality-weighting штрафует сессии с плохой калибровкой, чтобы их шум
 *    не доминировал в агрегатах.
 *
 * Зависимость от Phase 3, шаг 1: используем sample.onScreen (честный, посчитан
 * gaze-tracker'ом ДО clamp). Off-screen / clipped sample не вносят вклад в bins.
 *
 * Schema-совместимость: финальный `bins` остаётся 2D-массивом чисел, как раньше,
 * только теперь это веса (ms × quality), а не counts. Для совместимости добавлены
 * поля `weightedTotalMs`, `qualityWeight`, чтобы потребитель мог нормировать.
 */

const DEFAULT_GRID_WIDTH = 96;
const DEFAULT_GRID_HEIGHT = 54;

const MAX_DT_MS = 100;        // верхняя граница dtMs — обрезает паузы между фазами
const FALLBACK_DT_MS = 33;    // первая точка аккумулятора — ~30fps
const DEFAULT_AOI_DIVISOR = 50; // aoiRadius = min(screenW, screenH) / 50 ≈ 22px на 1080p

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function createBins(width, height) {
    const bins = new Array(height);
    for (let y = 0; y < height; y++) {
        bins[y] = new Array(width).fill(0);
    }
    return bins;
}

function addPointToBins(bins, nx, ny, contribution) {
    const height = bins.length;
    const width = bins[0]?.length || 0;
    if (width === 0 || height === 0) return;

    const xIdx = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
    const yIdx = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));
    bins[yIdx][xIdx] += contribution;
}

function getSampleScreenSize(sample, fallbackW, fallbackH) {
    const sw = Number.isFinite(sample?.screenWidth) ? sample.screenWidth : fallbackW;
    const sh = Number.isFinite(sample?.screenHeight) ? sample.screenHeight : fallbackH;
    return {
        screenWidth: Number.isFinite(sw) && sw > 0 ? sw : 1,
        screenHeight: Number.isFinite(sh) && sh > 0 ? sh : 1
    };
}

function createAccumulator(width, height) {
    return {
        bins: createBins(width, height),
        stimulusBins: createBins(width, height),
        fixation: null,
        fixations: [],
        fixationCount: 0,
        totalSamples: 0,
        onScreenSamples: 0,
        validSamples: 0,
        lowConfidenceSamples: 0,
        offScreenSamples: 0,
        outsideStimulusSamples: 0,
        validObservationDurationMs: 0,
        confidenceSum: 0,
        confidenceCount: 0,
        weightedTotalMs: 0,    // суммарный взвешенный вклад (ms × qualityWeight)
        lastT: null,           // для расчёта dtMs внутри аккумулятора
        minT: null,
        maxT: null
    };
}

function fixationResult(group) {
    return group && group.durationMs >= 100 && group.lastT - group.firstT >= 100 ? {
        x: group.wx / group.weight, y: group.wy / group.weight,
        startMs: group.startMs, durationMs: group.durationMs,
        signalConfidence: group.confidenceCount ? group.confidenceSum / group.confidenceCount : null
    } : null;
}

function appendFixationPoint(acc, point, qualityWeight) {
    let group = acc.fixation;
    if (group && (point.t - group.lastT > 100
        || Math.hypot(point.x - group.x / group.count, point.y - group.y / group.count) > 0.04)) {
        const result = fixationResult(group);
        if (result) {
            acc.fixationCount++;
            addPointToBins(acc.stimulusBins, result.x, result.y, group.qualityWeightedMs);
            if (acc.fixations.length < 500) acc.fixations.push(result);
        }
        group = null;
    }
    if (!group) group = { x: 0, y: 0, wx: 0, wy: 0, count: 0, weight: 0, durationMs: 0,
        startMs: point.tRelMs, firstT: point.t, lastT: point.t, qualityWeightedMs: 0, confidenceSum: 0, confidenceCount: 0 };
    const weight = Math.max(1, point.dtMs || 0);
    group.x += point.x; group.y += point.y; group.count++;
    group.wx += point.x * weight; group.wy += point.y * weight; group.weight += weight;
    group.durationMs += point.dtMs; group.lastT = point.t;
    group.qualityWeightedMs += point.dtMs * qualityWeight;
    if (Number.isFinite(point.confidence)) { group.confidenceSum += point.confidence; group.confidenceCount++; }
    acc.fixation = group;
    if (Number.isFinite(point.confidence)) { acc.confidenceSum += point.confidence; acc.confidenceCount++; }
}

function flattenRoundedBins(bins) {
    return bins.flatMap(row => row.map(value => Math.round(value * 1000) / 1000));
}

function finalizeStimulusEntry(meta, acc, qualityWeight, width, height) {
    const pending = fixationResult(acc.fixation);
    const bins = acc.stimulusBins.map(row => [...row]);
    if (pending) addPointToBins(bins, pending.x, pending.y, acc.fixation.qualityWeightedMs);
    return {
        ...finalizeEntry(meta, acc, qualityWeight),
        coordinateSpace: 'stimulus_normalized_0_1',
        grid: {
            width,
            height,
            values: flattenRoundedBins(bins)
        },
        fixationPoints: [...acc.fixations, ...(fixationResult(acc.fixation) ? [fixationResult(acc.fixation)] : [])].slice(0, 500),
        fixationCountTotal: acc.fixationCount + (fixationResult(acc.fixation) ? 1 : 0),
        fixationsTruncated: acc.fixationCount + (fixationResult(acc.fixation) ? 1 : 0) > 500,
        sampleCountTotal: acc.totalSamples,
        sampleCountValid: acc.validSamples,
        lowConfidenceCount: acc.lowConfidenceSamples,
        offScreenCount: acc.offScreenSamples,
        outsideStimulusCount: acc.outsideStimulusSamples,
        validObservationDurationMs: Math.round(acc.validObservationDurationMs),
        meanConfidence: acc.confidenceCount ? acc.confidenceSum / acc.confidenceCount : null,
        algorithm: {
            id: 'idt-fixation-heatmap',
            version: '1.2.0',
            parameters: { dispersionNorm: 0.04, minDurationMs: 100, maxGapMs: 100,
                qualityWeighting: 'latest_validated_segment',
                ...(meta.coordinateMappingVersion ? { coordinateMappingVersion: meta.coordinateMappingVersion } : {}) }
        }
    };
}

function updateTimeRange(acc, t) {
    if (!Number.isFinite(t)) return;
    if (acc.minT === null || t < acc.minT) acc.minT = t;
    if (acc.maxT === null || t > acc.maxT) acc.maxT = t;
}

function finalizeTimeRange(acc) {
    const hasRange = Number.isFinite(acc.minT) && Number.isFinite(acc.maxT);
    if (!hasRange) {
        return { start: null, end: null, durationMs: 0 };
    }
    return {
        start: acc.minT,
        end: acc.maxT,
        durationMs: Math.max(0, acc.maxT - acc.minT)
    };
}

function finalizeEntry(meta, acc, qualityWeight) {
    return {
        ...meta,
        sampleCount: acc.totalSamples,
        onScreenPct: acc.totalSamples > 0 ? Math.round((acc.onScreenSamples / acc.totalSamples) * 1000) / 10 : 0,
        weightedTotalMs: Math.round(acc.weightedTotalMs * 10) / 10,
        qualityWeight: acc.validObservationDurationMs > 0
            ? Math.round(acc.weightedTotalMs / acc.validObservationDurationMs * 1000) / 1000 : null,
        normMethod: 'screen_xy_0_1',
        weighting: 'time_quality_v1',
        bins: acc.bins,
        timeRangeMs: finalizeTimeRange(acc)
    };
}

/**
 * Расчёт dt в ms для текущей точки относительно последней в аккумуляторе.
 * Для первой точки возвращает FALLBACK_DT_MS. Clamp [0, MAX_DT_MS].
 */
function nextDtMs(acc, t) {
    if (!Number.isFinite(t)) return FALLBACK_DT_MS;
    if (acc.lastT === null) {
        acc.lastT = t;
        return FALLBACK_DT_MS;
    }
    const raw = t - acc.lastT;
    acc.lastT = t;
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.min(MAX_DT_MS, raw);
}

/**
 * @param {Array} samples - sessionData.eyeTracking[]
 * @param {Object} [options]
 * @param {number} [options.gridWidth=96]
 * @param {number} [options.gridHeight=54]
 * @param {number} [options.screenWidth] - fallback если sample.screenWidth не задан
 * @param {number} [options.screenHeight] - fallback
 * @param {number} [options.validationRmsPx] - RMS validation accuracy в пикселях.
 *   Если не задан → qualityWeight = 1 (только time-weighting).
 * @param {number} [options.aoiRadiusPx] - эталонный радиус AOI для нормализации
 *   качества. По умолчанию min(screenW, screenH) / 50.
 */
export function createHeatmapAccumulator(options = {}, saved = null) {
    if (saved && saved.schemaVersion !== 'heatmap_accumulator.v1') throw new Error('Unsupported heatmap checkpoint');
    options = saved?.options || options;
    const width = Number.isFinite(options.gridWidth) ? options.gridWidth : DEFAULT_GRID_WIDTH;
    const height = Number.isFinite(options.gridHeight) ? options.gridHeight : DEFAULT_GRID_HEIGHT;
    const fallbackW = Number.isFinite(options.screenWidth) ? options.screenWidth : (typeof window !== 'undefined' ? window.innerWidth : 1920);
    const fallbackH = Number.isFinite(options.screenHeight) ? options.screenHeight : (typeof window !== 'undefined' ? window.innerHeight : 1080);

    const aoiRadiusPx = Number.isFinite(options.aoiRadiusPx) && options.aoiRadiusPx > 0
        ? options.aoiRadiusPx
        : Math.max(1, Math.min(fallbackW, fallbackH) / DEFAULT_AOI_DIVISOR);

    let qualityWeight = 1;
    function setValidationRmsPx(value) {
        if (!Number.isFinite(value) || value < 0) return;
        options = { ...options, validationRmsPx: value };
        const ratio = value / aoiRadiusPx;
        qualityWeight = 1 / (1 + ratio * ratio);
    }
    setValidationRmsPx(options.validationRmsPx);

    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 128 || height > 128) throw new Error('Invalid heatmap grid');
    if (saved) validateCheckpoint(saved, width, height);
    const perStimulusMap = new Map(saved ? structuredClone(saved.perStimulus) : []);
    const perBlockMap = new Map(saved ? structuredClone(saved.perBlock) : []);
    if (perStimulusMap.size > 2000 || perBlockMap.size > 200) throw new Error('Heatmap checkpoint exceeds context limits');
    const sessionAcc = saved ? structuredClone(saved.session) : createAccumulator(width, height);
    const summary = saved ? { ...saved.summary } : { sampleCountTotal: 0, sampleCountValid: 0, lowConfidenceCount: 0,
        offScreenCount: 0, confidenceSum: 0, confidenceCount: 0, firstT: null, lastT: null, ignoredTimestamps: 0, omittedPresentations: 0 };

    function add(sample) {
        const analysisX = Number.isFinite(sample?.correctedX) ? sample.correctedX : sample?.x;
        const analysisY = Number.isFinite(sample?.correctedY) ? sample.correctedY : sample?.y;
        const t = sample?.t;
        if (!Number.isFinite(t) || (summary.lastT !== null && t <= summary.lastT)) { summary.ignoredTimestamps++; return; }
        summary.sampleCountTotal++;
        if (summary.firstT === null) summary.firstT = t;
        summary.lastT = t;
        const validSignal = sample?.valid !== false && sample?.onScreen === true
            && Number.isFinite(analysisX) && Number.isFinite(analysisY);
        if (sample?.onScreen === false) summary.offScreenCount++;
        if (Number.isFinite(sample?.confidence) && sample.confidence < 0.65) summary.lowConfidenceCount++;
        if (validSignal) {
            summary.sampleCountValid++;
            if (Number.isFinite(sample?.confidence)) { summary.confidenceSum += sample.confidence; summary.confidenceCount++; }
        }
        if (!Number.isFinite(analysisX) || !Number.isFinite(analysisY)) return;
        const { screenWidth, screenHeight } = getSampleScreenSize(sample, fallbackW, fallbackH);
        const nx = clamp01(analysisX / screenWidth);
        const ny = clamp01(analysisY / screenHeight);
        // Phase 3, шаг 1: trust honest onScreen flag from gaze-tracker.
        const onScreen = sample?.onScreen === true;

        const sessionDt = nextDtMs(sessionAcc, t);
        sessionAcc.totalSamples++;
        updateTimeRange(sessionAcc, t);
        if (onScreen) sessionAcc.onScreenSamples++;
        if (validSignal) {
            const contribution = sessionDt * qualityWeight;
            sessionAcc.validObservationDurationMs += sessionDt;
            sessionAcc.weightedTotalMs += contribution;
            addPointToBins(sessionAcc.bins, nx, ny, contribution);
        }

        const blockId = sample?.blockId ?? null;
        const attempt = sample?.attempt ?? null;
        const trialId = sample?.trialId ?? null;
        const stimulusId = sample?.stimulusId ?? null;
        const stimulusType = sample?.stimulusType ?? null;
        const expectedResponse = sample?.expectedResponse ?? null;
        const isStimulusPhase = sample?.phase === 'cognitive_stimulus';

        if (isStimulusPhase && blockId != null && stimulusId != null) {
            const attemptKey = String(attempt ?? 'attempt');
            const perStimulusKey = JSON.stringify([blockId, attempt, trialId, stimulusId, sample?.stimulusVersion || '1']);
            if (!perStimulusMap.has(perStimulusKey) && perStimulusMap.size >= 2000) { summary.omittedPresentations++; return; }
            if (!perStimulusMap.has(perStimulusKey)) {
                perStimulusMap.set(perStimulusKey, {
                    meta: {
                        blockId,
                        attempt,
                        trialId,
                        stimulusId,
                        stimulusName: sample?.stimulusName ?? null,
                        stimulusType,
                        expectedResponse,
                        stimulusVersion: sample?.stimulusVersion || '1',
                        intrinsicWidth: sample?.stimulusRect?.intrinsicWidth ?? null,
                        intrinsicHeight: sample?.stimulusRect?.intrinsicHeight ?? null,
                        coordinateMappingVersion: sample?.stimulusRect?.coordinateMappingVersion ?? null,
                        presentationStartMs: Number.isFinite(sample?.tRelMs) ? sample.tRelMs : t,
                        presentationId: `${String(blockId)}:${attemptKey}:${String(trialId ?? 'trial')}:${String(stimulusId)}`
                    },
                    acc: createAccumulator(width, height)
                });
            }
            const stimulusRef = perStimulusMap.get(perStimulusKey);
            const stimDt = nextDtMs(stimulusRef.acc, t);
            stimulusRef.acc.totalSamples++;
            updateTimeRange(stimulusRef.acc, t);
            if (!onScreen) stimulusRef.acc.offScreenSamples++;
            if (Number.isFinite(sample?.confidence) && sample.confidence < 0.65) {
                stimulusRef.acc.lowConfidenceSamples++;
            }
            const valid = validSignal;
            if (valid) {
                stimulusRef.acc.validSamples++;
                stimulusRef.acc.validObservationDurationMs += stimDt;
            }
            if (onScreen) stimulusRef.acc.onScreenSamples++;
            if (valid) {
                const contribution = stimDt * qualityWeight;
                stimulusRef.acc.weightedTotalMs += contribution;
                addPointToBins(stimulusRef.acc.bins, nx, ny, contribution);
            }
            const rect = sample?.stimulusRect;
            const hasRect = rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)
                && Number.isFinite(rect.width) && rect.width > 0
                && Number.isFinite(rect.height) && rect.height > 0;
            if (valid && hasRect) {
                const stimulusX = (analysisX - rect.left) / rect.width;
                const stimulusY = (analysisY - rect.top) / rect.height;
                if (stimulusX >= 0 && stimulusX <= 1 && stimulusY >= 0 && stimulusY <= 1) {
                    appendFixationPoint(stimulusRef.acc, {
                        x: stimulusX,
                        y: stimulusY,
                        t,
                        tRelMs: Math.max(0, (Number.isFinite(sample?.tRelMs) ? sample.tRelMs : t)
                            - stimulusRef.meta.presentationStartMs),
                        dtMs: stimDt,
                        confidence: Number.isFinite(sample?.confidence) ? sample.confidence : null
                    }, qualityWeight);
                } else {
                    stimulusRef.acc.outsideStimulusSamples++;
                }
            } else if (valid) {
                stimulusRef.acc.outsideStimulusSamples++;
            }
        }

        if (isStimulusPhase && blockId != null) {
            if (!perBlockMap.has(blockId) && perBlockMap.size >= 200) return;
            if (!perBlockMap.has(blockId)) {
                perBlockMap.set(blockId, {
                    meta: { blockId },
                    acc: createAccumulator(width, height)
                });
            }
            const blockRef = perBlockMap.get(blockId);
            const blockDt = nextDtMs(blockRef.acc, t);
            blockRef.acc.totalSamples++;
            updateTimeRange(blockRef.acc, t);
            if (onScreen) blockRef.acc.onScreenSamples++;
            if (validSignal) {
                const contribution = blockDt * qualityWeight;
                blockRef.acc.validObservationDurationMs += blockDt;
                blockRef.acc.weightedTotalMs += contribution;
                addPointToBins(blockRef.acc.bins, nx, ny, contribution);
            }
        }
    }

    function finalize() {
        const perStimulus = [];
        for (const { meta, acc } of perStimulusMap.values()) {
            perStimulus.push(finalizeStimulusEntry(meta, acc, qualityWeight, width, height));
        }

        const perBlock = [];
        for (const { meta, acc } of perBlockMap.values()) {
            perBlock.push(finalizeEntry(meta, acc, qualityWeight));
        }

        return {
            version: '1.2.0',
            accumulation: { method: 'streaming_heatmap.v1', summary: { ...summary } },
            grid: { width, height },
            normMethod: 'screen_xy_0_1',
            weighting: 'time_quality_v1',
            qualityWeight: Math.round(qualityWeight * 1000) / 1000,
            validationRmsPx: Number.isFinite(options.validationRmsPx) ? options.validationRmsPx : null,
            aoiRadiusPx: Math.round(aoiRadiusPx * 10) / 10,
            perStimulus,
            perBlock,
            session: finalizeEntry({ blockId: null, stimulusId: null }, sessionAcc, qualityWeight)
        };
    }

    function snapshot() {
        return structuredClone({ schemaVersion: 'heatmap_accumulator.v1', options: { ...options, gridWidth: width, gridHeight: height,
            screenWidth: fallbackW, screenHeight: fallbackH }, perStimulus: [...perStimulusMap], perBlock: [...perBlockMap], session: sessionAcc, summary });
    }
    return { add, finalize, snapshot, setValidationRmsPx, lastTimestamp: () => summary.lastT };
}

export function buildHeatmaps(samples, options = {}) {
    const accumulator = createHeatmapAccumulator(options);
    for (const sample of samples || []) accumulator.add(sample);
    return accumulator.finalize();
}

function validateCheckpoint(saved, width, height) {
    const gridValid = grid => Array.isArray(grid) && grid.length === height
        && grid.every(row => Array.isArray(row) && row.length === width && row.every(v => Number.isFinite(v) && v >= 0));
    const accValid = acc => acc && gridValid(acc.bins) && gridValid(acc.stimulusBins)
        && Array.isArray(acc.fixations) && acc.fixations.length <= 500
        && ['fixationCount', 'totalSamples', 'confidenceCount', 'weightedTotalMs'].every(key => Number.isFinite(acc[key]) && acc[key] >= 0)
        && (!acc.fixation || ['x', 'y', 'wx', 'wy', 'count', 'weight', 'durationMs', 'qualityWeightedMs', 'startMs', 'firstT', 'lastT', 'confidenceSum', 'confidenceCount']
            .every(key => Number.isFinite(acc.fixation[key])))
        && acc.fixations.every(point => ['x', 'y', 'startMs', 'durationMs'].every(key => Number.isFinite(point[key])));
    const entriesValid = (entries, max) => Array.isArray(entries) && entries.length <= max
        && entries.every(entry => Array.isArray(entry) && entry.length === 2 && entry[1]?.meta && accValid(entry[1].acc));
    if (!saved.summary || !Number.isFinite(saved.summary.sampleCountTotal)
        || ![saved.summary.firstT, saved.summary.lastT].every(t => t === null || Number.isFinite(t))
        || !accValid(saved.session) || !entriesValid(saved.perStimulus, 2000) || !entriesValid(saved.perBlock, 200)) {
        throw new Error('Corrupt heatmap checkpoint');
    }
}
