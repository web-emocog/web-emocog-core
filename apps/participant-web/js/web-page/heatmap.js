const DEFAULT_GRID_WIDTH = 96;
const DEFAULT_GRID_HEIGHT = 54;

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

function addPointToBins(bins, nx, ny) {
    const height = bins.length;
    const width = bins[0]?.length || 0;
    if (width === 0 || height === 0) return;

    const xIdx = Math.min(width - 1, Math.max(0, Math.floor(nx * width)));
    const yIdx = Math.min(height - 1, Math.max(0, Math.floor(ny * height)));
    bins[yIdx][xIdx] += 1;
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

function finalizeEntry(meta, acc) {
    return {
        ...meta,
        sampleCount: acc.totalSamples,
        onScreenPct: acc.totalSamples > 0 ? Math.round((acc.onScreenSamples / acc.totalSamples) * 1000) / 10 : 0,
        normMethod: 'screen_xy_0_1',
        bins: acc.bins,
        timeRangeMs: finalizeTimeRange(acc)
    };
}

export function buildHeatmaps(samples, options = {}) {
    const width = Number.isFinite(options.gridWidth) ? options.gridWidth : DEFAULT_GRID_WIDTH;
    const height = Number.isFinite(options.gridHeight) ? options.gridHeight : DEFAULT_GRID_HEIGHT;
    const fallbackW = Number.isFinite(options.screenWidth) ? options.screenWidth : window.innerWidth || 1;
    const fallbackH = Number.isFinite(options.screenHeight) ? options.screenHeight : window.innerHeight || 1;

    const perStimulusMap = new Map();
    const perBlockMap = new Map();
    const sessionAcc = createAccumulator(width, height);

    for (const sample of samples || []) {
        if (!Number.isFinite(sample?.x) || !Number.isFinite(sample?.y)) continue;

        const t = Number.isFinite(sample?.t) ? sample.t : Date.now();
        const { screenWidth, screenHeight } = getSampleScreenSize(sample, fallbackW, fallbackH);
        const nx = clamp01(sample.x / screenWidth);
        const ny = clamp01(sample.y / screenHeight);
        const onScreen = sample?.onScreen === true;

        sessionAcc.totalSamples++;
        updateTimeRange(sessionAcc, t);
        if (onScreen) {
            sessionAcc.onScreenSamples++;
            addPointToBins(sessionAcc.bins, nx, ny);
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
            stimulusRef.acc.totalSamples++;
            updateTimeRange(stimulusRef.acc, t);
            if (onScreen) {
                stimulusRef.acc.onScreenSamples++;
                addPointToBins(stimulusRef.acc.bins, nx, ny);
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
            blockRef.acc.totalSamples++;
            updateTimeRange(blockRef.acc, t);
            if (onScreen) {
                blockRef.acc.onScreenSamples++;
                addPointToBins(blockRef.acc.bins, nx, ny);
            }
        }
    }

    const perStimulus = [];
    for (const { meta, acc } of perStimulusMap.values()) {
        perStimulus.push(finalizeEntry(meta, acc));
    }

    const perBlock = [];
    for (const { meta, acc } of perBlockMap.values()) {
        perBlock.push(finalizeEntry(meta, acc));
    }

    return {
        version: '1.0.0',
        grid: { width, height },
        normMethod: 'screen_xy_0_1',
        perStimulus,
        perBlock,
        session: finalizeEntry({ blockId: null, stimulusId: null }, sessionAcc)
    };
}
