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
        totalSamples: 0,
        onScreenSamples: 0,
        weightedTotalMs: 0,    // суммарный взвешенный вклад (ms × qualityWeight)
        lastT: null,           // для расчёта dtMs внутри аккумулятора
        minT: Infinity,
        maxT: -Infinity
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
        if (!Number.isFinite(sample?.x) || !Number.isFinite(sample?.y)) continue;

        const t = Number.isFinite(sample?.t) ? sample.t : Date.now();
        const { screenWidth, screenHeight } = getSampleScreenSize(sample, fallbackW, fallbackH);
        const nx = clamp01(sample.x / screenWidth);
        const ny = clamp01(sample.y / screenHeight);
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
        const stimulusId = sample?.stimulusId ?? null;
        const stimulusType = sample?.stimulusType ?? null;
        const expectedResponse = sample?.expectedResponse ?? null;
        const isStimulusPhase = sample?.phase === 'cognitive_stimulus';

        if (isStimulusPhase && blockId != null && stimulusId != null) {
            const perStimulusKey = `${String(blockId)}::${String(stimulusId)}`;
            if (!perStimulusMap.has(perStimulusKey)) {
                perStimulusMap.set(perStimulusKey, {
                    meta: { blockId, stimulusId, stimulusType, expectedResponse },
                    acc: createAccumulator(width, height)
                });
            }
            const stimulusRef = perStimulusMap.get(perStimulusKey);
            const stimDt = nextDtMs(stimulusRef.acc, t);
            stimulusRef.acc.totalSamples++;
            updateTimeRange(stimulusRef.acc, t);
            if (onScreen) {
                stimulusRef.acc.onScreenSamples++;
                const contribution = stimDt * qualityWeight;
                stimulusRef.acc.weightedTotalMs += contribution;
                addPointToBins(stimulusRef.acc.bins, nx, ny, contribution);
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
        perStimulus.push(finalizeEntry(meta, acc, qualityWeight));
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
