import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameLatency, FRAME_HEADROOM, assessFrameHeadroom } from '../../participant-web/js/session-runtime/frame-latency.mjs';
import policy from '../security/payload-policy.js';
import fs from 'node:fs';
import vm from 'node:vm';

test('headroom reserves time below both the 40 ms QC ceiling and camera cadence', () => {
    assert.deepEqual(FRAME_HEADROOM, { meanMs: 25, p95Ms: 30, p99Ms: 33, minSamples: 60 });
    const fast = new FrameLatency(), marginal = new FrameLatency();
    for (let i = 0; i < 100; i++) { fast.record(24.8); marginal.record(37.77); }
    assert.equal(assessFrameHeadroom(fast.snapshot()), 'within_budget');
    assert.equal(assessFrameHeadroom(marginal.snapshot()), 'over_budget');
    assert.equal(assessFrameHeadroom({ samples: 60, meanMs: 24, p95Ms: 29, p99Ms: null }), 'not_measured');
});

test('bounded latency retains stalls, conservatively rounds percentiles and never fabricates empty data', () => {
    const h = new FrameLatency();
    assert.deepEqual(h.snapshot(), { samples: 0, meanMs: null, p95Ms: null, p99Ms: null, maxMs: null });
    assert.equal(assessFrameHeadroom(h.snapshot()), 'not_measured');
    for (const invalid of [null, undefined, NaN, Infinity, -1, '20']) h.record(invalid);
    assert.equal(h.samples, 0);
    for (let i = 0; i < 98; i++) h.record(20.1);
    h.record(832.8); h.record(4000.5);
    assert.equal(h.snapshot().p95Ms, 21);
    assert.equal(h.snapshot().p99Ms, 833);
    assert.equal(assessFrameHeadroom(h.snapshot()), 'over_budget');
    const size = h.buckets.byteLength;
    for (let i = 0; i < 100_000; i++) h.record(4000.5);
    assert.equal(h.buckets.byteLength, size);
    assert.equal(h.snapshot().p99Ms, 4000.5);
    const snapshot = h.snapshot(); snapshot.samples = -1;
    assert.equal(h.snapshot().samples, 100_100);
});

test('timing telemetry is an additive closed contract, not a scientific QC override', () => {
    const h = new FrameLatency(); h.record(20);
    const packet = { schemaVersion: 'session_feature.v1', ids: { session: 'synthetic-timing' },
        lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' },
        events: [], meta: { tech: { framePipeline: { faceTimings: { pixelDrawMs: { frames: 1, totalMs: 2, maxMs: 2 } },
            latency: { schemaVersion: 'frame_latency.v1', scope: 'completed_primary_frames', primary: h.snapshot(), headroom: 'not_measured' } } } } };
    assert.deepEqual(policy.validateSessionFeaturePayload(packet), []);
    const bad = structuredClone(packet); bad.meta.tech.framePipeline.latency.rawFrames = [];
    assert.ok(policy.validateSessionFeaturePayload(bad).length);
    const unknown = structuredClone(packet); unknown.meta.tech.framePipeline.latency.headroom = 'qc_passed';
    assert.ok(policy.validateSessionFeaturePayload(unknown).length);
    const legacy = structuredClone(packet); delete legacy.meta.tech.framePipeline.latency;
    assert.deepEqual(policy.validateSessionFeaturePayload(legacy), []);
});

test('a high delivered FPS alone cannot satisfy the latency headroom or long-run gate', async () => {
    const { assessPipelinePerformance, fpsWindows } = await import('../../../scripts/reference-data/performance.mjs');
    const good = { primaryMs: { n: 100, mean: 24, p95: 28, p99: 31, max: 40 },
        analysisFps: 29, cameraDeliveryFps: 30, uiTimerLatenessMs: { p95: 2 },
        fpsWindows: { longestBelow25RunMs: 0 }, faceCoverage: 1,
        workers: { face: 'worker', segment: 'worker' }, errors: {} };
    assert.equal(assessPipelinePerformance(good).status, 'pass');
    assert.deepEqual(assessPipelinePerformance({ ...good, primaryMs: { ...good.primaryMs, mean: 37.77 } }).reasons, ['primary_headroom']);
    assert.ok(assessPipelinePerformance({ ...good, primaryMs: { ...good.primaryMs, max: 833 } }).reasons.includes('primary_stall'));
    assert.equal(assessPipelinePerformance({ ...good, primaryMs: {} }).status, 'fail');
    assert.equal(assessPipelinePerformance({ ...good, errors: { model_failed: 1 } }).status, 'fail');
    assert.ok(assessPipelinePerformance({ ...good, faceCoverage: 0 }).reasons.includes('missing_face_workload'));
    assert.ok(assessPipelinePerformance({ ...good, workers: { face: 'main', segment: 'worker' } }).reasons.includes('main_thread_fallback'));
    const frames = Array.from({ length: 18_000 }, (_, i) => i * (1000 / 30));
    const long = fpsWindows(frames, 600_000);
    assert.equal(long.fullWindows, 600); assert.equal(long.longestBelow25RunMs, 0);
    assert.throws(() => fpsWindows([], 620_000), /invalid_performance_clock/);
    assert.throws(() => fpsWindows(Array(60_001).fill(0), 1000), /invalid_performance_clock/);
});

test('precheck warns about processing headroom without changing camera QC or admission', () => {
    const source = fs.readFileSync(new URL('../../participant-web/js/web-page/precheck-updated.js?v=20261124-load2', import.meta.url), 'utf8');
    const start = source.indexOf('function renderCameraCadence(');
    const end = source.indexOf('\nexport function startPreCheck', start);
    assert.ok(start >= 0 && end > start);
    const hint = { textContent: '', style: {} }, state = { currentLang: 'ru', runtime: {} };
    const check = { threshold: 25, fps: 30, low: false, blocked: false, pending: false };
    const context = vm.createContext({ FrameLatency, assessFrameHeadroom, state,
        precheckAnalysisRun: { faceTimes: Array(120).fill(37) },
        WecogProtocolQuality: { cameraCadence: () => check, describeFpsAdvice: () => 'camera advice' },
        document: { querySelector: () => ({}), getElementById: () => hint } });
    vm.runInContext(source.slice(start, end), context);
    assert.equal(context.renderCameraCadence(30), check, 'advisory returns unchanged camera decision');
    assert.match(hint.textContent, /не хватает запаса скорости/);
    assert.equal(check.blocked, false);
    state.currentLang = 'en'; context.renderCameraCadence(30);
    assert.match(hint.textContent, /too little speed headroom/);
    for (const times of [[], Array(7).fill(50), Array(120).fill(20)]) {
        context.precheckAnalysisRun.faceTimes = times;
        context.renderCameraCadence(30);
        assert.doesNotMatch(hint.textContent, /too little speed headroom/);
    }
    context.precheckAnalysisRun.faceTimes = Array(120).fill(37);
    check.fps = 15; check.low = true; check.blocked = true;
    assert.equal(context.renderCameraCadence(15), check);
    assert.match(hint.textContent, /camera advice/);
    assert.doesNotMatch(hint.textContent, /too little speed headroom/);
});
