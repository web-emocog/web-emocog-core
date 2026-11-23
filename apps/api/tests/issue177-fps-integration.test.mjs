import test from 'node:test';
import assert from 'node:assert/strict';
import QCMetrics from '../../participant-web/js/qc-metrics/QCMetrics.js';
import { PassiveValidTime, validTimeFrameReasons } from '../../participant-web/js/session-runtime/passive-valid-time.mjs';
import timing from '../../shared/passive-valid-time.js';

const definition = { settings: { qualityControl: { schemaVersion: 'protocol_quality.v1', rules: {
    fpsStable: { enabled: true, hardStop: false, threshold: 23 }
} } } };

function run(rateAt, warmupMs = 0) {
    const descriptors = Object.fromEntries(['performance', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    let now = 0;
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
    Object.defineProperty(globalThis, 'document', { configurable: true,
        value: { getElementById: () => null, querySelectorAll: () => [] } });
    const qc = new QCMetrics();
    try {
        qc.start({ analysisFpsThreshold: 23 });
        const frame = { face: { detected: true }, pose: { isStable: true }, illumination: { status: 'optimal' } };
        const segmentation = { isComplete: true, faceVisibility: { isComplete: true } };
        const gaze = { valid: true, correctedX: 50, correctedY: 50, onScreen: true };
        const observe = () => {
            qc.addGazePoint(gaze, frame.pose);
            qc.processFrame(frame, segmentation);
            // Independently observed source delivery must never replace analysis throughput.
            qc._fpsMonitor.setCameraFps(30);
            return qc.getCurrentMetrics();
        };
        for (; now < warmupMs; now += 1000 / 16) observe();
        const startMs = now;
        const tracker = new PassiveValidTime({ startMs, targetMs: 180000 });
        let metrics;
        for (;;) {
            metrics = observe();
            tracker.observe(now, validTimeFrameReasons({ frame, segmentation, gaze, metrics, definition,
                viewport: { width: 100, height: 100 } }));
            if (tracker.done(now)) break;
            now = Math.min(startMs + tracker.maxDurationMs, now + 1000 / rateAt(now - startMs));
        }
        const result = tracker.snapshot(now, true);
        assert.equal(timing.validateResult(result), true);
        return { result, metrics, summary: qc.getSummary() };
    } finally {
        qc.stop();
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
}

test('real QC FPS windows allow a 180s target after short 29-to-16 FPS drops without lowering the published 23 FPS threshold', () => {
    const { result } = run(ms => ms >= 60000 && ms < 65000 || ms >= 120000 && ms < 122000 ? 16 : 29);
    assert.ok(result.acceptedMs >= 180000);
    assert.ok(result.actualMs > 187000 && result.actualMs < 192000);
    assert.equal(result.limitReached, false);
    assert.ok(result.excludedSegments.some(segment => segment.reasons.includes('protocol_qc_fpsStable')
        && segment.startMs < 65000 && segment.endMs > 60000));
    assert.equal(definition.settings.qualityControl.rules.fpsStable.threshold, 23);
});

test('a sustained 16 FPS analysis cannot pass a 23 FPS protocol even with a 30 FPS camera and zero legacy low-camera-FPS percentage', () => {
    const { result, metrics, summary } = run(() => 16);
    assert.equal(metrics.cameraFps, 30);
    assert.equal(metrics.analysisFps, 16);
    assert.equal(summary.lowFpsPct, 0);
    assert.ok(summary.analysisFps < 17);
    assert.equal(result.acceptedMs, 0);
    assert.equal(result.actualMs, 270000);
    assert.equal(result.limitReached, true);
});

test('recovery uses current measured FPS rather than a pretrial cumulative mean that is still below threshold', () => {
    const { result, summary } = run(() => 29, 180000);
    assert.ok(result.acceptedMs >= 180000);
    assert.ok(result.actualMs < 183000);
    assert.equal(result.limitReached, false);
    assert.ok(summary.analysisFps < 23);
});
