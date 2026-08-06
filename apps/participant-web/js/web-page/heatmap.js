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
        stimulusPoints: [],
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
        minT: Infinity,
        maxT: -Infinity
    };
}

function detectFixations(points, options = {}) {
    const dispersionNorm = Number.isFinite(options.dispersionNorm) ? options.dispersionNorm : 0.04;
    const minDurationMs = Number.isFinite(options.minDurationMs) ? options.minDurationMs : 100;
    const maxGapMs = Number.isFinite(options.maxGapMs) ? options.maxGapMs : 100;
    const sorted = (points || []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
        .slice().sort((a, b) => a.t - b.t);
    const fixations = [];
    let group = [];

    function flush() {
        if (!group.length) return;
        const durationMs = group.reduce((sum, point) => sum + (Number.isFinite(point.dtMs) ? point.dtMs : 0), 0);
        if (durationMs >= minDurationMs) {
            const weight = group.reduce((sum, point) => sum + Math.max(1, point.dtMs || 0), 0);
            fixations.push({
                x: group.reduce((sum, point) => sum + point.x * Math.max(1, point.dtMs || 0), 0) / weight,
                y: group.reduce((sum, point) => sum + point.y * Math.max(1, point.dtMs || 0), 0) / weight,
                startMs: group[0].tRelMs,
                durationMs,
                signalConfidence: meanFinite(group.map(point => point.confidence))
            });
        }
        group = [];
    }

    for (const point of sorted) {
        if (!group.length) {
            group.push(point);
            continue;
        }
        const previous = group[group.length - 1];
        const cx = group.reduce((sum, item) => sum + item.x, 0) / group.length;
        const cy = group.reduce((sum, item) => sum + item.y, 0) / group.length;
        const distance = Math.hypot(point.x - cx, point.y - cy);
        if (point.t - previous.t <= maxGapMs && distance <= dispersionNorm) group.push(point);
        else {
            flush();
            group.push(point);
        }
    }
    flush();
    return fixations.slice(0, 500);
}

function meanFinite(values) {
    const finite = values.filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function flattenRoundedBins(bins) {
    return bins.flatMap(row => row.map(value => Math.round(value * 1000) / 1000));
}

function finalizeStimulusEntry(meta, acc, qualityWeight, width, height) {
    return {
        ...finalizeEntry(meta, acc, qualityWeight),
        coordinateSpace: 'stimulus_normalized_0_1',
        grid: {
            width,
            height,
            values: flattenRoundedBins(acc.stimulusBins)
        },
        fixationPoints: detectFixations(acc.stimulusPoints),
        sampleCountTotal: acc.totalSamples,
        sampleCountValid: acc.validSamples,
        lowConfidenceCount: acc.lowConfidenceSamples,
        offScreenCount: acc.offScreenSamples,
        outsideStimulusCount: acc.outsideStimulusSamples,
        validObservationDurationMs: Math.round(acc.validObservationDurationMs),
        meanConfidence: meanFinite(acc.stimulusPoints.map(point => point.confidence)),
        algorithm: {
            id: 'idt-fixation-heatmap',
            version: '1.0.0',
            parameters: { dispersionNorm: 0.04, minDurationMs: 100, maxGapMs: 100 }
        }
    };
}

function updateTimeRange(acc, t) {
    if (!Number.isFinite(t)) return;
    if (t < acc.minT) acc.minT = t;
    if (t > acc.maxT) acc.maxT = t;
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
        qualityWeight: Math.round(qualityWeight * 1000) / 1000,
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
export function buildHeatmaps(samples, options = {}) {
    const width = Number.isFinite(options.gridWidth) ? options.gridWidth : DEFAULT_GRID_WIDTH;
    const height = Number.isFinite(options.gridHeight) ? options.gridHeight : DEFAULT_GRID_HEIGHT;
    const fallbackW = Number.isFinite(options.screenWidth) ? options.screenWidth : (typeof window !== 'undefined' ? window.innerWidth : 1920);
    const fallbackH = Number.isFinite(options.screenHeight) ? options.screenHeight : (typeof window !== 'undefined' ? window.innerHeight : 1080);

    const aoiRadiusPx = Number.isFinite(options.aoiRadiusPx) && options.aoiRadiusPx > 0
        ? options.aoiRadiusPx
        : Math.max(1, Math.min(fallbackW, fallbackH) / DEFAULT_AOI_DIVISOR);

    let qualityWeight = 1;
    if (Number.isFinite(options.validationRmsPx) && options.validationRmsPx >= 0) {
        const ratio = options.validationRmsPx / aoiRadiusPx;
        qualityWeight = 1 / (1 + ratio * ratio);
    }

    const perStimulusMap = new Map();
    const perBlockMap = new Map();
    const sessionAcc = createAccumulator(width, height);

    for (const sample of samples || []) {
        const analysisX = Number.isFinite(sample?.correctedX) ? sample.correctedX : sample?.x;
        const analysisY = Number.isFinite(sample?.correctedY) ? sample.correctedY : sample?.y;
        if (!Number.isFinite(analysisX) || !Number.isFinite(analysisY)) continue;

        const t = Number.isFinite(sample?.t) ? sample.t : Date.now();
        const { screenWidth, screenHeight } = getSampleScreenSize(sample, fallbackW, fallbackH);
        const nx = clamp01(analysisX / screenWidth);
        const ny = clamp01(analysisY / screenHeight);
        // Phase 3, шаг 1: trust honest onScreen flag from gaze-tracker.
        const onScreen = sample?.onScreen === true;

        const sessionDt = nextDtMs(sessionAcc, t);
        sessionAcc.totalSamples++;
        updateTimeRange(sessionAcc, t);
        if (onScreen) {
            sessionAcc.onScreenSamples++;
            const contribution = sessionDt * qualityWeight;
            sessionAcc.weightedTotalMs += contribution;
            addPointToBins(sessionAcc.bins, nx, ny, contribution);
        }

        const blockId = sample?.blockId ?? null;
        const trialId = sample?.trialId ?? null;
        const stimulusId = sample?.stimulusId ?? null;
        const stimulusType = sample?.stimulusType ?? null;
        const expectedResponse = sample?.expectedResponse ?? null;
        const isStimulusPhase = sample?.phase === 'cognitive_stimulus';

        if (isStimulusPhase && blockId != null && stimulusId != null) {
            const perStimulusKey = `${String(blockId)}::${String(trialId ?? 'trial')}::${String(stimulusId)}`;
            if (!perStimulusMap.has(perStimulusKey)) {
                perStimulusMap.set(perStimulusKey, {
                    meta: {
                        blockId,
                        trialId,
                        stimulusId,
                        stimulusName: sample?.stimulusName ?? null,
                        stimulusType,
                        expectedResponse,
                        stimulusVersion: '1',
                        intrinsicWidth: sample?.stimulusRect?.intrinsicWidth ?? null,
                        intrinsicHeight: sample?.stimulusRect?.intrinsicHeight ?? null,
                        presentationStartMs: Number.isFinite(sample?.tRelMs) ? sample.tRelMs : t,
                        presentationId: `${String(blockId)}:${String(trialId ?? 'trial')}:${String(stimulusId)}`
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
            const valid = sample?.valid !== false && onScreen;
            if (valid) {
                stimulusRef.acc.validSamples++;
                stimulusRef.acc.validObservationDurationMs += stimDt;
            }
            if (onScreen) {
                stimulusRef.acc.onScreenSamples++;
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
                    const contribution = stimDt * qualityWeight;
                    addPointToBins(stimulusRef.acc.stimulusBins, stimulusX, stimulusY, contribution);
                    stimulusRef.acc.stimulusPoints.push({
                        x: stimulusX,
                        y: stimulusY,
                        t,
                        tRelMs: Math.max(0, (Number.isFinite(sample?.tRelMs) ? sample.tRelMs : t)
                            - stimulusRef.meta.presentationStartMs),
                        dtMs: stimDt,
                        confidence: Number.isFinite(sample?.confidence) ? sample.confidence : null
                    });
                } else {
                    stimulusRef.acc.outsideStimulusSamples++;
                }
            } else if (valid) {
                stimulusRef.acc.outsideStimulusSamples++;
            }
        }

        if (isStimulusPhase && blockId != null) {
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
            if (onScreen) {
                blockRef.acc.onScreenSamples++;
                const contribution = blockDt * qualityWeight;
                blockRef.acc.weightedTotalMs += contribution;
                addPointToBins(blockRef.acc.bins, nx, ny, contribution);
            }
        }
    }

    const perStimulus = [];
    for (const { meta, acc } of perStimulusMap.values()) {
        perStimulus.push(finalizeStimulusEntry(meta, acc, qualityWeight, width, height));
    }

    const perBlock = [];
    for (const { meta, acc } of perBlockMap.values()) {
        perBlock.push(finalizeEntry(meta, acc, qualityWeight));
    }

    return {
        version: '1.1.0',
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
