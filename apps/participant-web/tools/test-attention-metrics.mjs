import { existsSync, readFileSync } from 'node:fs';

const BASE_T0 = 1_700_000_000_000;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function approxBetween(value, min, max) {
    return Number.isFinite(value) && value >= min && value <= max;
}

function loadBuildAttentionMetrics() {
    const sourceUrl = new URL('../js/gaze-tracker/attention-metrics.js', import.meta.url);
    const source = readFileSync(sourceUrl, 'utf8');
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(moduleUrl).then(mod => mod.buildAttentionMetrics);
}

function buildEyeSignals({
    durationMs,
    fps = 30,
    baseEar = 0.36,
    closures = [],
    earFn = null,
    phase = 'tracking_test',
    startMs = BASE_T0,
    pupilFn = null
}) {
    const dt = Math.round(1000 / fps);
    const signals = [];

    for (let tRelMs = 0; tRelMs <= durationMs; tRelMs += dt) {
        let earAvg = typeof earFn === 'function'
            ? earFn(tRelMs, baseEar)
            : baseEar + Math.sin(tRelMs / 700) * 0.0015;
        if (typeof earFn !== 'function') {
            for (const closure of closures) {
                if (tRelMs >= closure.startMs && tRelMs <= (closure.startMs + closure.durationMs)) {
                    earAvg = closure.earAvg;
                    break;
                }
            }
        }

        const pupilProxy = typeof pupilFn === 'function' ? pupilFn(tRelMs / 1000) : null;
        signals.push({
            t: startMs + tRelMs,
            phase,
            earAvg,
            leftEAR: earAvg,
            rightEAR: earAvg,
            bothOpen: earAvg > baseEar * 0.8,
            pupilProxy: Number.isFinite(pupilProxy) ? pupilProxy : null
        });
    }

    return signals;
}

function buildGazeSignals({
    durationMs,
    fps = 30,
    phase = 'tracking_test',
    startMs = BASE_T0,
    screenWidth = 1920,
    screenHeight = 1080,
    pathFn = null
}) {
    const dt = Math.round(1000 / fps);
    const samples = [];
    const fallbackPath = t => ({ x: 960 + Math.sin(t / 400) * 2, y: 540 + Math.cos(t / 500) * 2 });

    for (let tRelMs = 0; tRelMs <= durationMs; tRelMs += dt) {
        const point = (typeof pathFn === 'function' ? pathFn(tRelMs) : fallbackPath(tRelMs)) || fallbackPath(tRelMs);
        samples.push({
            t: startMs + tRelMs,
            phase,
            x: point.x,
            y: point.y,
            onScreen: true,
            screenWidth,
            screenHeight
        });
    }

    return samples;
}

function logPass(name, extra = '') {
    const suffix = extra ? ` | ${extra}` : '';
    console.log(`PASS: ${name}${suffix}`);
}

async function run() {
    const buildAttentionMetrics = await loadBuildAttentionMetrics();

    // synthetic-1: no closures => no blink / no perclos episodes
    {
        const eyeSignals = buildEyeSignals({ durationMs: 12000 });
        const eyeTracking = buildGazeSignals({ durationMs: 12000 });
        const metrics = buildAttentionMetrics({ eyeSignals, eyeTracking });
        assert(metrics.global.blinkDynamics.blinkCount === 0, 'synthetic-1: blinkCount must be 0');
        assert(metrics.global.perclos.episodes.count === 0, 'synthetic-1: perclos episodes must be 0');
        logPass('synthetic-1');
    }

    // synthetic-2: one long deep closure with slow close + fast open => perclos=1, blink=0
    {
        const eyeSignals = buildEyeSignals({
            durationMs: 15000,
            phase: 'cognitive_stimulus',
            earFn: (tRelMs, baseEar) => {
                const noise = Math.sin(tRelMs / 700) * 0.0012;
                if (tRelMs < 3000 || tRelMs > 4700) return baseEar + noise;
                if (tRelMs <= 3600) {
                    const k = (tRelMs - 3000) / 600;
                    return (baseEar + noise) - (baseEar - 0.1) * k;
                }
                if (tRelMs <= 4200) {
                    return 0.1;
                }
                const k = (tRelMs - 4200) / 120;
                return 0.1 + (baseEar - 0.1) * k;
            }
        });
        const eyeTracking = buildGazeSignals({ durationMs: 15000, phase: 'cognitive_stimulus' });
        const metrics = buildAttentionMetrics({ eyeSignals, eyeTracking });
        assert(metrics.global.blinkDynamics.blinkCount === 0, 'synthetic-2: blinkCount must stay 0');
        assert(metrics.global.perclos.episodes.count === 1, 'synthetic-2: perclos episodes must be 1');
        assert(metrics.global.perclos.candidateCount >= 1, 'synthetic-2: perclos candidateCount must be >=1');
        assert(metrics.global.perclos.rejectedCount >= 0, 'synthetic-2: perclos rejectedCount must be finite');
        assert(metrics.global.perclos.criteria.minDurationMs === 800, 'synthetic-2: perclos criteria must expose minDurationMs=800');
        assert(metrics.global.perclos.criteria.minDeepDwellMs === 350, 'synthetic-2: perclos criteria must expose minDeepDwellMs=350');
        assert(metrics.global.perclos.criteria.maxRebounds === 0, 'synthetic-2: perclos criteria must expose maxRebounds=0');
        logPass('synthetic-2');
    }

    // synthetic-2b: regular blinks and shallow closures must not become perclos episodes
    {
        const closures = [
            { startMs: 3200, durationMs: 380, earAvg: 0.24 },
            { startMs: 7000, durationMs: 580, earAvg: 0.23 },
            { startMs: 10500, durationMs: 330, earAvg: 0.24 }
        ];
        const eyeSignals = buildEyeSignals({ durationMs: 15000, closures, phase: 'cognitive_stimulus' });
        const eyeTracking = buildGazeSignals({ durationMs: 15000, phase: 'cognitive_stimulus' });
        const metrics = buildAttentionMetrics({ eyeSignals, eyeTracking });
        assert(metrics.global.blinkDynamics.blinkCount === 3, 'synthetic-2b: blinkCount must be 3');
        assert(metrics.global.perclos.episodes.count === 0, 'synthetic-2b: perclos episodes must be 0');
        logPass('synthetic-2b');
    }

    // synthetic-2c: long flutter-like closure with rebounds must be rejected as perclos
    {
        const eyeSignals = buildEyeSignals({
            durationMs: 16000,
            phase: 'cognitive_stimulus',
            earFn: (tRelMs, baseEar) => {
                const noise = Math.sin(tRelMs / 650) * 0.001;
                if (tRelMs < 3000 || tRelMs > 4550) return baseEar + noise;
                if (tRelMs <= 3500) {
                    const k = (tRelMs - 3000) / 500;
                    return (baseEar + noise) - (baseEar - 0.1) * k;
                }
                if (tRelMs <= 3700) {
                    const k = (tRelMs - 3500) / 200;
                    return 0.1 + (0.3 - 0.1) * k;
                }
                if (tRelMs <= 3950) {
                    const k = (tRelMs - 3700) / 250;
                    return 0.3 - (0.3 - 0.1) * k;
                }
                if (tRelMs <= 4150) {
                    const k = (tRelMs - 3950) / 200;
                    return 0.1 + (0.3 - 0.1) * k;
                }
                if (tRelMs <= 4400) {
                    const k = (tRelMs - 4150) / 250;
                    return 0.3 - (0.3 - 0.1) * k;
                }
                const k = Math.min(1, (tRelMs - 4400) / 150);
                return 0.1 + (baseEar - 0.1) * k;
            }
        });
        const eyeTracking = buildGazeSignals({ durationMs: 16000, phase: 'cognitive_stimulus' });
        const metrics = buildAttentionMetrics({ eyeSignals, eyeTracking });
        const reasons = metrics.global.perclos.rejectReasons || {};
        assert(metrics.global.perclos.episodes.count === 0, 'synthetic-2c: perclos episodes must be 0');
        assert((reasons.oscillatory_rebounds || 0) > 0, 'synthetic-2c: rejectReasons must include oscillatory_rebounds');
        logPass('synthetic-2c', `oscillatory_rebounds=${reasons.oscillatory_rebounds || 0}`);
    }

    // scope-1: precheck blinks must not be counted in global (only tracking_test+)
    {
        const precheckEye = buildEyeSignals({
            durationMs: 8000,
            startMs: BASE_T0,
            phase: 'precheck',
            closures: [
                { startMs: 1000, durationMs: 280, earAvg: 0.24 },
                { startMs: 2800, durationMs: 260, earAvg: 0.24 },
                { startMs: 5000, durationMs: 300, earAvg: 0.23 }
            ]
        });
        const trackingEye = buildEyeSignals({
            durationMs: 12000,
            startMs: BASE_T0 + 9000,
            phase: 'tracking_test',
            closures: [{ startMs: 4500, durationMs: 380, earAvg: 0.24 }]
        });
        const precheckGaze = buildGazeSignals({ durationMs: 8000, startMs: BASE_T0, phase: 'precheck' });
        const trackingGaze = buildGazeSignals({ durationMs: 12000, startMs: BASE_T0 + 9000, phase: 'tracking_test' });

        const metrics = buildAttentionMetrics({
            eyeSignals: [...precheckEye, ...trackingEye],
            eyeTracking: [...precheckGaze, ...trackingGaze]
        });

        assert(metrics.global.blinkDynamics.blinkCount === 1, 'scope-1: global must count only tracking_test+ blinks');
        assert(metrics.global.meta.scopeStartPhase === 'tracking_test', 'scope-1: scopeStartPhase must be tracking_test');
        assert(metrics.global.meta.scopeFilterApplied === true, 'scope-1: scopeFilterApplied must be true');
        logPass('scope-1');
    }

    // scope-2: fallback when tracking_test phase is missing
    {
        const eyeSignals = buildEyeSignals({
            durationMs: 10000,
            phase: 'cognitive_instruction',
            closures: [{ startMs: 4200, durationMs: 350, earAvg: 0.23 }]
        });
        const eyeTracking = buildGazeSignals({ durationMs: 10000, phase: 'cognitive_instruction' });
        const metrics = buildAttentionMetrics({ eyeSignals, eyeTracking });

        assert(metrics.global.meta.scopeStartPhase === 'fallback_first_sample', 'scope-2: fallback phase expected');
        assert(metrics.global.meta.scopeFilterApplied === false, 'scope-2: fallback must not mark filter applied');
        assert(metrics.global.blinkDynamics.blinkCount === 1, 'scope-2: fallback must still compute blinks');
        logPass('scope-2');
    }

    // synthetic-3: explicit saccades + fixations
    {
        const eyeSignals = buildEyeSignals({ durationMs: 9000 });
        const eyeTracking = buildGazeSignals({
            durationMs: 9000,
            pathFn: t => {
                if (t < 2000) return { x: 960 + Math.sin(t / 120) * 2, y: 540 + Math.cos(t / 130) * 2 };
                if (t < 2100) return { x: 960 + (t - 2000) * 6.4, y: 540 - (t - 2000) * 2.4 };
                if (t < 4500) return { x: 1600 + Math.sin(t / 140) * 2, y: 300 + Math.cos(t / 110) * 2 };
                if (t < 4600) return { x: 1600 - (t - 4500) * 12, y: 300 + (t - 4500) * 5 };
                return { x: 400 + Math.sin(t / 100) * 2, y: 800 + Math.cos(t / 120) * 2 };
            }
        });
        const metrics = buildAttentionMetrics({ eyeSignals, eyeTracking });
        const sf = metrics.global.saccadesAndFixations;
        assert(sf.saccadeCount >= 2, 'synthetic-3: must detect saccades');
        assert(sf.fixationCount >= 2, 'synthetic-3: must detect fixations');
        assert(Number.isFinite(sf.fixationDispersion), 'synthetic-3: fixationDispersion must be finite');
        logPass('synthetic-3');
    }

    // synthetic-4: noisy fixation should not produce extreme micro-shift rate
    {
        const eyeSignals = buildEyeSignals({ durationMs: 30000 });
        const eyeTracking = buildGazeSignals({
            durationMs: 30000,
            pathFn: t => ({ x: 960 + Math.sin(t / 70) * 1.5, y: 540 + Math.cos(t / 80) * 1.5 })
        });
        const metrics = buildAttentionMetrics({ eyeSignals, eyeTracking });
        const micro = metrics.global.microShiftProxy;
        assert(micro.microShiftRatePerMin < 20, 'synthetic-4: microShiftRatePerMin must stay below 20');
        logPass('synthetic-4', `rate=${micro.microShiftRatePerMin}`);
    }

    // synthetic-5: hippus oscillation proxy should return dominant frequency near 0.4Hz
    {
        const eyeSignals = buildEyeSignals({
            durationMs: 12000,
            pupilFn: tSec => 0.2 + 0.01 * Math.sin(2 * Math.PI * 0.4 * tSec)
        });
        const eyeTracking = buildGazeSignals({ durationMs: 12000 });
        const metrics = buildAttentionMetrics({ eyeSignals, eyeTracking });
        const hippus = metrics.global.hippusProxy;
        assert(hippus.qualityFlag === true, 'synthetic-5: hippus qualityFlag must be true');
        assert(approxBetween(hippus.hippusDominantFreq, 0.3, 0.5), 'synthetic-5: dominant freq must be ~0.4Hz');
        logPass('synthetic-5', `freq=${hippus.hippusDominantFreq}`);
    }

    // regression: session_S-8JZL3C blink stays stable; strict perclos must not produce extreme 60s values
    {
        const regressionFile = '/Users/egorbulanov/Downloads/session_S-8JZL3C.json';
        if (!existsSync(regressionFile)) {
            console.log(`SKIP: regression (file not found: ${regressionFile})`);
        } else {
            const session = JSON.parse(readFileSync(regressionFile, 'utf8'));
            const metrics = buildAttentionMetrics(session);
            const blinkCount = metrics?.global?.blinkDynamics?.blinkCount;
            const perclosEpisodes = metrics?.global?.perclos?.episodes?.count;
            const perclos60Max = metrics?.global?.perclos?.windows?.['60s']?.maxPct;
            assert(blinkCount === 3, `regression: blinkCount expected 3, got ${blinkCount}`);
            assert(Number.isFinite(perclos60Max) && perclos60Max < 50, `regression: perclos60 max must be <50, got ${perclos60Max}`);
            assert(metrics?.global?.meta?.scopeStartPhase === 'tracking_test', 'regression: scope must start from tracking_test');
            logPass('regression-session_S-8JZL3C', `blink=${blinkCount}, perclosEpisodes=${perclosEpisodes}, perclos60Max=${perclos60Max}`);
        }
    }

    // regression: session_S-647ZSW must have no perclos episodes under strict dynamic model
    {
        const regressionFile = '/Users/egorbulanov/Downloads/session_S-647ZSW.json';
        if (!existsSync(regressionFile)) {
            console.log(`SKIP: regression (file not found: ${regressionFile})`);
        } else {
            const session = JSON.parse(readFileSync(regressionFile, 'utf8'));
            const metrics = buildAttentionMetrics(session);
            const blinkCount = metrics?.global?.blinkDynamics?.blinkCount;
            const perclosEpisodes = metrics?.global?.perclos?.episodes?.count;
            const perclos60Max = metrics?.global?.perclos?.windows?.['60s']?.maxPct;
            assert(perclosEpisodes === 0, `regression: perclos episodes expected 0, got ${perclosEpisodes}`);
            assert(Number.isFinite(perclos60Max) && perclos60Max < 25, `regression: perclos60 max must be <25, got ${perclos60Max}`);
            assert(Number.isFinite(blinkCount) && blinkCount >= 0, `regression: blinkCount must stay finite, got ${blinkCount}`);
            logPass('regression-session_S-647ZSW', `blink=${blinkCount}, perclosEpisodes=${perclosEpisodes}, perclos60Max=${perclos60Max}`);
        }
    }

    // regression scope: session_S-8SPZFQ should report post-calibration scope in meta
    {
        const regressionFile = '/Users/egorbulanov/Downloads/session_S-8SPZFQ.json';
        if (!existsSync(regressionFile)) {
            console.log(`SKIP: regression scope (file not found: ${regressionFile})`);
        } else {
            const session = JSON.parse(readFileSync(regressionFile, 'utf8'));
            const metrics = buildAttentionMetrics(session);
            assert(metrics?.global?.meta?.scopeStartPhase === 'tracking_test', 'regression scope: start phase must be tracking_test');
            assert(metrics?.global?.meta?.scopeFilterApplied === true, 'regression scope: filter must be applied');
            logPass('regression-session_S-8SPZFQ-scope', `startMs=${metrics?.global?.meta?.scopeStartMs}`);
        }
    }

    // regression: session_S-8TO0WC should have no perclos episodes (false positive fixed)
    {
        const regressionFile = '/Users/egorbulanov/Downloads/session_S-8TO0WC.json';
        if (!existsSync(regressionFile)) {
            console.log(`SKIP: regression (file not found: ${regressionFile})`);
        } else {
            const session = JSON.parse(readFileSync(regressionFile, 'utf8'));
            const metrics = buildAttentionMetrics(session);
            const blinkCount = metrics?.global?.blinkDynamics?.blinkCount;
            const perclosEpisodes = metrics?.global?.perclos?.episodes?.count;
            const rejectReasons = metrics?.global?.perclos?.rejectReasons || {};
            assert(blinkCount === 22, `regression: blinkCount expected 22, got ${blinkCount}`);
            assert(perclosEpisodes === 0, `regression: perclos episodes expected 0, got ${perclosEpisodes}`);
            assert(
                (rejectReasons.insufficient_deep_dwell || 0) > 0 || (rejectReasons.oscillatory_rebounds || 0) > 0,
                `regression: expected insufficient_deep_dwell or oscillatory_rebounds in rejectReasons, got ${JSON.stringify(rejectReasons)}`
            );
            logPass('regression-session_S-8TO0WC', `blink=${blinkCount}, perclosEpisodes=${perclosEpisodes}`);
        }
    }

    console.log('ALL TESTS PASSED');
}

run().catch(error => {
    console.error('FAILED:', error?.message || error);
    process.exitCode = 1;
});
