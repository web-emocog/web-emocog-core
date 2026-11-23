import test from 'node:test';
import assert from 'node:assert/strict';
import { appendGazeHistory, captureGazeHistory, buildSessionHeatmaps } from '../../participant-web/js/session-runtime/gaze-history.mjs';
import { createHeatmapAccumulator } from '../../participant-web/js/web-page/heatmap.js';

const point = i => ({ t: 1000000 + i * 33, tRelMs: i * 33, correctedX: 300, correctedY: 200,
    screenWidth: 600, screenHeight: 400, confidence: .9, valid: true, onScreen: true,
    phase: 'cognitive_stimulus', blockId: 'passive', trialId: 'static', stimulusId: 'square', attempt: 1,
    stimulusRect: { left: 0, top: 0, width: 600, height: 400 } });
const session = () => ({ ids: { session: 'suffix-regression' }, eyeTracking: [] });

test('unchanged capture reads no historical timestamps and append capture visits only the suffix', () => {
    const data = session(), runtime = {};
    let historicalReads = 0;
    for (let i = 0; i < 9000; i++) {
        const sample = point(i), timestamp = sample.t;
        Object.defineProperty(sample, 't', { enumerable: true, get() { historicalReads++; return timestamp; } });
        appendGazeHistory(data, runtime, sample);
        data.eyeTracking.push(sample);
    }
    captureGazeHistory(data, runtime);
    const expected = structuredClone(data.heatmapState);
    historicalReads = 0;
    captureGazeHistory(data, runtime);
    assert.equal(historicalReads, 0);
    assert.deepEqual(data.heatmapState, expected);
    for (let i = 9000; i < 9150; i++) data.eyeTracking.push(point(i));
    captureGazeHistory(data, runtime);
    assert.equal(historicalReads, 0);
    assert.equal(data.heatmapState.summary.sampleCountTotal, 9150);
    assert.equal(data.heatmapState.summary.ignoredTimestamps, 0);
});

test('rolling-window eviction, array replacement and reload preserve the original accumulation', () => {
    let data = session(), runtime = {};
    for (let i = 0; i < 300; i++) {
        const sample = point(i);
        appendGazeHistory(data, runtime, sample);
        data.eyeTracking.push(sample);
    }
    captureGazeHistory(data, runtime);
    data.eyeTracking.splice(0, 250);
    for (let i = 300; i < 350; i++) data.eyeTracking.push(point(i));
    captureGazeHistory(data, runtime);
    assert.equal(data.heatmapState.summary.sampleCountTotal, 350);
    data.eyeTracking = [point(350), point(351), point(349)];
    captureGazeHistory(data, runtime);
    assert.equal(data.heatmapState.summary.sampleCountTotal, 352);
    data = JSON.parse(JSON.stringify(data)); runtime = {};
    data.eyeTracking.push(point(352));
    captureGazeHistory(data, runtime);
    const expected = createHeatmapAccumulator({ gridWidth: 32, gridHeight: 18 });
    for (let i = 0; i <= 352; i++) expected.add(point(i));
    assert.deepEqual(buildSessionHeatmaps(data, runtime), expected.finalize());
});

test('empty, replaced and new-session series do not reuse an incompatible cursor', () => {
    const data = session(), runtime = {};
    data.eyeTracking.push(point(0));
    captureGazeHistory(data, runtime);
    data.eyeTracking.length = 0;
    captureGazeHistory(data, runtime);
    data.eyeTracking.push(point(1));
    captureGazeHistory(data, runtime);
    assert.equal(data.heatmapState.summary.sampleCountTotal, 2);
    const next = { ids: { session: 'next' }, eyeTracking: [point(10)] };
    captureGazeHistory(next, runtime);
    assert.equal(next.heatmapState.summary.sampleCountTotal, 1);
    assert.equal(next.heatmapState.summary.lastT, point(10).t);
});
