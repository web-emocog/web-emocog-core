import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckpointBuilder } from '../../participant-web/js/session-runtime/checkpoint-builder.mjs';
import { createHeatmapAccumulator } from '../../participant-web/js/web-page/heatmap.js';
import { PassiveValidTime } from '../../participant-web/js/session-runtime/passive-valid-time.mjs';
import validTimeAnalytics from '../analytics/valid-time.js';

test('active backup does not clone 30/180/300 seconds of eye frames, while normal/final preparation preserves them', async () => {
    const original = globalThis.Worker;
    const sources = [];
    globalThis.Worker = class {
        postMessage(request) {
            sources.push(structuredClone(request.source));
            queueMicrotask(() => this.onmessage({ isTrusted: true, origin: '', data: {
                schemaVersion: 'checkpoint_response.v1', requestId: request.requestId,
                packet: { schemaVersion: 'session_feature.v1', ids: request.source.ids }
            } }));
        }
        terminate() {}
    };
    try {
        const builder = new CheckpointBuilder();
        for (const seconds of [30, 180, 300]) {
            const rows = Array.from({ length: seconds * 30 }, (_, index) => ({ t: index * 1000 / 30, x: index, phase: 'cognitive_stimulus' }));
            const data = { ids: { session: 'synthetic-long-passive' }, eyeTracking: rows, eyeSignals: rows,
                cognitiveResults: [{ trialId: 'one', qualityValid: false }],
                attentionMetrics: { stale: true }, blinkSummary: { stale: true }, perclosSummary: { stale: true } };
            await builder.build(data, null, { activeMeasurement: true });
            const source = sources.at(-1);
            assert.deepEqual(source.eyeTracking, []);
            assert.deepEqual(source.eyeSignals, []);
            assert.equal(source.activeMeasurementBackup, true);
            assert.equal(source.attentionMetrics, undefined);
            assert.equal(source.blinkSummary, undefined);
            assert.equal(source.experimentMeta.checkpointBuild.omittedSeries.eyeSignals.count, seconds * 30);
            assert.equal(source.experimentMeta.checkpointBuild.reason, 'active_measurement_summary');
            assert.equal(source.experimentMeta.checkpointBuild.signalSeriesIncomplete, true);
            assert.equal(data.eyeSignals.length, seconds * 30);
            assert.equal(data.eyeTracking, rows);
            assert.equal(data.experimentMeta, undefined);
        }
        await builder.build({ ids: { session: 'synthetic-long-passive' }, eyeSignals: [{ t: 1 }, { t: 2 }] });
        assert.deepEqual(sources.at(-1).eyeSignals, [{ t: 1 }, { t: 2 }]);
        assert.equal(sources.at(-1).activeMeasurementBackup, undefined);
    } finally { globalThis.Worker = original; }
});

test('capture-clock gaze remains usable after delayed inference and cannot cross excluded time', () => {
    const accumulator = createHeatmapAccumulator({ gridWidth: 2, gridHeight: 2 });
    accumulator.breakContinuity();
    const tracker = new PassiveValidTime({ startMs: 0, targetMs: 3000, onBreak: () => accumulator.breakContinuity() });
    for (let capture = 0; capture <= 2000; capture += 50) {
        const sample = { t: 10000 + capture, tRelMs: capture, correctedX: 50, correctedY: 50,
            screenWidth: 100, screenHeight: 100, valid: true, onScreen: true, phase: 'cognitive_stimulus',
            blockId: 'b', trialId: 't', presentationId: 'p', stimulusId: 's',
            stimulusRect: { left: 0, top: 0, width: 100, height: 100 } };
        tracker.deferGaze(sample, row => accumulator.add(row), capture);
        tracker.observe(capture, []);
        tracker.context(capture + 30);
    }
    const value = tracker.snapshot(2030, true);
    const presentation = accumulator.finalize().perStimulus[0];
    assert.equal(value.acceptedMs, 2000);
    const filtered = validTimeAnalytics.filterPresentation(presentation, { onsetMs: 0, validTime: value });
    assert.equal(filtered.validTimeReason, undefined);
    assert.equal(filtered.fixationCountTotal, 1);
    assert.equal(filtered.validObservationDurationMs, 2000);
    assert.equal(filtered.fixationPoints[0].startMs, 0);
});

test('a timer ahead of delayed capture does not retime QC evidence or count unobserved samples', () => {
    const tracker = new PassiveValidTime({ startMs: 0, targetMs: 3000 });
    for (let capture = 0; capture <= 2000; capture += 50) {
        tracker.context(capture + 30);
        tracker.observe(capture, []);
    }
    assert.equal(tracker.snapshot(2030).acceptedMs, 2000);
    assert.equal(tracker.snapshot(2030).acceptedSegments[0].startMs, 0);
});

test('a short excluded interval splits gaze fixations and adds no interpolated dwell time', () => {
    const accumulator = createHeatmapAccumulator({ gridWidth: 2, gridHeight: 2 });
    const add = t => accumulator.add({ t, tRelMs: t, x: 50, y: 50, correctedX: 50, correctedY: 50,
        screenWidth: 100, screenHeight: 100, valid: true, onScreen: true, phase: 'cognitive_stimulus',
        blockId: 'passive', trialId: 'one', presentationId: 'presentation-one', stimulusId: 'static',
        stimulusRect: { left: 0, top: 0, width: 100, height: 100 } });
    for (let t = 0; t <= 200; t += 50) add(t);
    const before = accumulator.finalize().perStimulus[0];
    accumulator.breakContinuity();
    add(250);
    const after = accumulator.finalize().perStimulus[0];
    assert.equal(after.validObservationDurationMs, before.validObservationDurationMs);
    for (let t = 300; t <= 450; t += 50) add(t);
    assert.equal(accumulator.finalize().perStimulus[0].validObservationDurationMs, before.validObservationDurationMs + 200);
    assert.equal(accumulator.finalize().perStimulus[0].fixationCountTotal, 2);
    const restored = createHeatmapAccumulator({}, JSON.parse(JSON.stringify(accumulator.snapshot()))).finalize();
    assert.equal(restored.perStimulus[0].fixationCountTotal, 2);
});
