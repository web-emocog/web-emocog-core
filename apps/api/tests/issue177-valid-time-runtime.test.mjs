import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassiveValidTime, validTimeFrameReasons } from '../../participant-web/js/session-runtime/passive-valid-time.mjs';
import shared from '../../shared/passive-valid-time.js';

function simulate(targetMs, reasonsAt, endMs = targetMs * 1.5) {
    const tracker = new PassiveValidTime({ startMs: 10000, targetMs });
    for (let ms = 0; ms <= endMs; ms += 50) {
        tracker.observe(10000 + ms, reasonsAt(ms));
        if (tracker.done(10000 + ms)) return tracker.snapshot(10000 + ms, true);
    }
    throw new Error('bounded trial failed to finish');
}

test('180-second passive target survives short drops, preserving a full partition within 270s', () => {
    const result = simulate(180000, ms => ms >= 60000 && ms < 65000 || ms >= 120000 && ms < 122000 ? ['protocol_qc_fpsStable'] : []);
    assert.equal(result.acceptedMs, 180000);
    assert.equal(result.actualMs, 187100);
    assert.equal(result.extended, true);
    assert.equal(result.limitReached, false);
    assert.deepEqual(result.excludedSegments, [{ startMs: 59950, endMs: 60000, reasons: ['measurement_unobserved'] },
        { startMs: 60000, endMs: 65000, reasons: ['protocol_qc_fpsStable'] },
        { startMs: 119950, endMs: 120000, reasons: ['measurement_unobserved'] },
        { startMs: 120000, endMs: 122000, reasons: ['protocol_qc_fpsStable'] }]);
    assert.equal(shared.validateResult(result), true);
});

test('sustained 16 FPS does not become valid time when 25 FPS is required', () => {
    const result = simulate(180000, () => ['protocol_qc_fpsStable']);
    assert.equal(result.acceptedMs, 0);
    assert.equal(result.actualMs, 270000);
    assert.equal(result.limitReached, true);
});

test('subsecond islands are excluded, not accumulated into valid minutes', () => {
    const result = simulate(3000, ms => ms % 1000 < 750 ? [] : ['face_missing']);
    assert.equal(result.acceptedMs, 0);
    assert.ok(result.excludedSegments.some(row => row.reasons.includes('valid_time_segment_too_short')));
});

test('excessive fragmentation stops explicitly within bounded transport without truncating interval history', () => {
    const result = simulate(180000, ms => ms % 100 < 50 ? [] : ['face_missing']);
    assert.equal(result.acceptedMs, 0);
    assert.ok(result.actualMs < 270000);
    assert.ok(result.excludedSegments.length <= shared.MAX_SEGMENTS);
    assert.equal(result.excludedSegments.at(-1).endMs, result.actualMs);
    assert.equal(shared.validateResult(result), true);
});

test('stalled timers do not invent valid camera frames or hide actual elapsed time', () => {
    const tracker = new PassiveValidTime({ startMs: 0, targetMs: 2000 });
    tracker.observe(0, []);
    const result = tracker.snapshot(5000, true);
    assert.equal(result.actualMs, 5000);
    assert.equal(result.acceptedMs, 0);
    assert.equal(result.limitReached, true);
    assert.equal(shared.validateResult(result), true);
    assert.ok(result.excludedSegments.some(row => row.reasons.includes('measurement_gap')));
    assert.deepEqual(result.excludedSegments.at(-1), { startMs: 3000, endMs: 5000, reasons: ['valid_time_deadline'] });
});

test('provisional gaze commits only after a continuous second, and short islands are discarded', () => {
    const tracker = new PassiveValidTime({ startMs: 0, targetMs: 3000 });
    const committed = [];
    for (let ms = 0; ms <= 900; ms += 100) {
        tracker.deferGaze(ms, sample => committed.push(sample));
        tracker.observe(ms, []);
    }
    assert.deepEqual(committed, []);
    tracker.observe(950, ['face_missing']);
    for (let ms = 1000; ms <= 2000; ms += 100) {
        tracker.deferGaze(ms, sample => committed.push(sample));
        tracker.observe(ms, []);
    }
    assert.deepEqual(committed, [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000]);
    assert.equal(tracker.context(2000).segmentStartMs, 1000);
});

test('an observed five seconds never grows by extrapolating the last frame into a stall', () => {
    const tracker = new PassiveValidTime({ startMs: 0, targetMs: 10000 });
    for (let ms = 0; ms <= 5000; ms += 50) tracker.observe(ms, []);
    assert.equal(tracker.acceptedMs(5200), 5000);
    const result = tracker.snapshot(6000, true);
    assert.equal(result.acceptedMs, 5000);
    assert.equal(shared.validateResult(result), true);
    assert.ok(result.excludedSegments.some(row => row.startMs === 5000 && row.reasons.includes('measurement_gap')));
});

test('valid-time checks use fresh frame/gaze and current analysis FPS, not camera FPS or old cumulative percentages', () => {
    const input = { frame: { face: { detected: true }, pose: { isStable: true }, illumination: { status: 'optimal' } },
        segmentation: { isComplete: true, faceVisibility: { isComplete: true } },
        gaze: { valid: true, correctedX: 10, correctedY: 10 }, viewport: { width: 100, height: 100 },
        metrics: { analysisFps: 16, cameraFps: 29, gazeValidPct: 99 },
        definition: { settings: { qualityControl: { rules: { fpsStable: { enabled: true, threshold: 25 } } } } } };
    assert.deepEqual(validTimeFrameReasons(input), ['protocol_qc_fpsStable']);
    assert.deepEqual(validTimeFrameReasons({ ...input, metrics: { ...input.metrics, analysisFps: 29, gazeValidPct: 5 } }), []);
    assert.ok(validTimeFrameReasons({ ...input, gaze: null }).includes('protocol_qc_gazeValid'));
    assert.ok(validTimeFrameReasons({ ...input, segmentation: null }).includes('face_visibility_unavailable'));
    assert.ok(validTimeFrameReasons({ ...input, segmentation: { isComplete: false } }).includes('face_visibility_unavailable'));
});

test('partition validation rejects inflated time, overlaps, unknown fields and negative or oversized values', () => {
    const good = simulate(2000, () => []);
    assert.equal(shared.validateResult(good), true);
    assert.equal(shared.validateResult({ ...good, acceptedMs: 9999 }), false);
    assert.equal(shared.validateResult({ ...good, rawFrame: 'private' }), false);
    assert.equal(shared.validateResult({ ...good, acceptedSegments: [{ startMs: 0, endMs: 2000 }, { startMs: 1000, endMs: 2000 }] }), false);
    assert.equal(shared.validateResult({ ...good, actualMs: -1 }), false);
    assert.equal(shared.validateResult({ ...good, maxDurationMs: 4000 }), false);
});

test('a partial durable snapshot remains incomplete and restarting cannot inherit its accepted time', () => {
    const tracker = new PassiveValidTime({ startMs: 0, targetMs: 3000 });
    for (let ms = 0; ms <= 1500; ms += 50) tracker.observe(ms, []);
    const saved = tracker.snapshot(1500);
    assert.equal(saved.acceptedMs, 1500);
    assert.equal(saved.limitReached, false);
    const resumed = new PassiveValidTime({ startMs: 5000, targetMs: 3000 });
    assert.equal(resumed.acceptedMs(5000), 0);
    assert.equal(saved.acceptedMs, 1500);
});
