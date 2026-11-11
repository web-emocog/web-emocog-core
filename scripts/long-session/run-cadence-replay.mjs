import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { RppgEngine } from '../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/RppgEngine.js';
import { ContinuousBpmCollector } from '../../apps/participant-web/js/session-runtime/continuous-bpm.js';
import { PhysiologyIntervals } from '../../apps/participant-web/js/session-runtime/physiology-intervals.mjs';
import { comparePublications } from '../reference-data/compare-publications.mjs';
import { runSyntheticScenario } from './physiology-fixtures.mjs';
const { validatePhysiologyIntervals } = createRequire(import.meta.url)('../../apps/api/security/physiology-intervals.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pause = () => new Promise(resolve => setImmediate(resolve));

export async function cadenceRun(mode, seconds = 120) {
    if (!['normal', 'load', 'replay', 'drop'].includes(mode) || !Number.isInteger(seconds) || seconds < 30 || seconds > 180) {
        throw new Error('invalid_cadence_fixture');
    }
    const collector = new ContinuousBpmCollector({ getFps: () => 30 });
    const engine = new RppgEngine({ algorithm: 'pos', mode: 'safe' });
    Object.assign(collector, { ready: true, canvas: {}, context: {}, engine });
    const width = 160, height = 120, pixels = new Uint8ClampedArray(width * height * 4);
    const image = { width, height, data: pixels };
    const landmarks = Array.from({ length: 478 }, (_, i) => ({
        x: .2 + .6 * (i % 22) / 21, y: .1 + .8 * Math.floor(i / 22) / 21, z: 0 }));
    const intervals = new PhysiologyIntervals(), publications = [], source = createHash('sha256');
    const started = performance.now();
    let frames = 0, emissions = 0, held = 0, rejected = 0;
    for (let i = 1; i <= seconds * 30; i++) {
        const t = i * 1000 / 30;
        if (mode === 'drop' && t >= 45000 && t < 50000) { intervals.breakContinuity(); continue; }
        const pulse = t / 1000 * 2 * Math.PI * 1.2, breath = 2 * Math.sin(t / 1000 * 2 * Math.PI * .2);
        const rgb = i % 137 === 0 ? [0, 0, 0] : [160 + 4 * Math.sin(pulse + .4) + breath,
            120 + 8 * Math.sin(pulse) + breath, 80 + 2 * Math.sin(pulse - .4) + breath];
        for (let k = 0; k < pixels.length; k += 4) {
            pixels[k] = rgb[0]; pixels[k + 1] = rgb[1]; pixels[k + 2] = rgb[2]; pixels[k + 3] = 255;
        }
        source.update(JSON.stringify([t, ...pixels.subarray(0, 4)]));
        const sample = collector.process(null, landmarks, t, image, 1800000000000 + t);
        frames++;
        if (sample) {
            emissions++; held += Number(sample.held); rejected += Number(!sample.published && !sample.held);
            publications.push({ ...sample, t });
            intervals.record(Math.round(t), sample, 10000, 20000, 750);
        }
        if (mode === 'load' && i % 150 === 0) {
            const until = performance.now() + 3;
            while (performance.now() < until) Math.sqrt(i);
            await pause();
        }
        if (mode === 'replay' && i % 37 === 0) await pause();
    }
    const summary = collector.finalize('synthetic_matched_pts');
    assert.ok(emissions > 30 && engine._colorProjection.capacity > 0, 'fixture must exercise actual ROI/estimation, not null-only calls');
    const packet = intervals.snapshot(seconds * 1000 + 1);
    assert.deepEqual(validatePhysiologyIntervals(packet), []);
    const compact = { bpmMean: summary.bpmMean, validSampleCount: summary.validSampleCount,
        respRateMean: summary.respRateMean, validRespSampleCount: summary.validRespSampleCount };
    return { mode, frames, emissions, held, rejected, wallMs: performance.now() - started,
        inputPtsAndPixelsHash: source.digest('hex'), outputHash: hash(publications),
        summary: compact, intervals: packet, publications };
}

export async function acceptance() {
    const accelerated = [];
    for (const minutes of [40, 125]) {
        const started = performance.now();
        const baseline = runSyntheticScenario(minutes), resumed = runSyntheticScenario(minutes, true);
        assert.deepEqual(resumed, baseline);
        assert.deepEqual(validatePhysiologyIntervals(resumed), []);
        accelerated.push({ minutes, sourceFrames: minutes * 60 * 30, wallMs: performance.now() - started,
            exactRecoveryParity: true, intervalHash: hash(resumed), bytes: Buffer.byteLength(JSON.stringify(resumed)),
            minutesRetained: resumed.minutes.length, attempts: resumed.blocks.map(b => ({ blockId: b.blockId, attempt: b.attempt, status: b.status })),
            channels: Object.fromEntries(['heartRate', 'respiration'].map(key => [key, {
                count: resumed.minutes.reduce((n, m) => n + m[key].count, 0),
                observedMs: resumed.minutes.reduce((n, m) => n + m[key].observedMs, 0)
            }])) });
    }
    const runs = [];
    for (const mode of ['normal', 'load', 'replay', 'drop']) runs.push(await cadenceRun(mode));
    const baseline = runs[0];
    for (const row of runs.slice(1, 3)) {
        assert.equal(row.inputPtsAndPixelsHash, baseline.inputPtsAndPixelsHash);
        assert.equal(row.outputHash, baseline.outputHash);
        assert.deepEqual(row.intervals, baseline.intervals);
    }
    const comparisons = runs.slice(1).map(row => ({ mode: row.mode,
        sameSourceFrames: row.inputPtsAndPixelsHash === baseline.inputPtsAndPixelsHash,
        exactOutputParity: row.outputHash === baseline.outputHash,
        exactCoverageParity: hash(row.intervals) === hash(baseline.intervals),
        heartRate: comparePublications(baseline.publications, row.publications, 'bpm', 0),
        respiration: comparePublications(baseline.publications, row.publications, 'respiration', 0) }));
    const paths = ['apps/participant-web/js/session-runtime/physiology-intervals.mjs',
        'apps/participant-web/js/session-runtime/continuous-bpm.js', 'scripts/long-session/physiology-fixtures.mjs',
        'scripts/long-session/run-cadence-replay.mjs'];
    return { schemaVersion: 'physiology_recovery_technical_evidence.v1', executedAt: new Date().toISOString(),
        machine: { platform: process.platform, arch: process.arch, node: process.version },
        sourceHashes: Object.fromEntries(await Promise.all(paths.map(async file => [file,
            createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')]))),
        physicalSensors: false, source: 'deterministic synthetic RGB and landmark geometry; unchanged engine defaults',
        accelerated, runs: runs.map(({ publications, intervals, ...row }) => ({ ...row, intervals })), comparisons,
        limitations: ['Matched PTS control verifies numerical repeatability, not real camera FPS or physiological accuracy.',
            'Synthetic geometry and pixels can be rejected by production quality gates; null is not zero or accuracy.',
            'Dropped-frame control intentionally has different input and is not required to match.',
            'Local accumulator/collector only; no HTTP/PG participant-to-analytics acceptance claimed.'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const report = await acceptance();
    const output = path.resolve(process.env.PHYSIOLOGY_REPORT || path.join(root, 'docs/reports/2026-11-06-physiology-cadence-recovery.json'));
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ output, accelerated: report.accelerated, comparisons: report.comparisons }, null, 2));
}
