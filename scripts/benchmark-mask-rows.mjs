// Synthetic CPU-stage comparison only: no camera, models, network or participant data.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { faceVisibilityFixture } from '../apps/autotests/tests/fixtures/face-visibility.mjs';
import * as mask from '../apps/participant-web/js/face-segmenter/mask-analyzer.js';
import * as region from '../apps/participant-web/js/face-segmenter/region-analyzer.js';
import { DEFAULT_THRESHOLDS } from '../apps/participant-web/js/face-segmenter/thresholds.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.env.WECOG_MASK_BASELINE;
const rounds = Number(process.env.WECOG_MASK_BENCH_ROUNDS || 360);
if (!/^[a-f\d]{40}$/.test(baseline || '') || !Number.isSafeInteger(rounds) || rounds < 60 || rounds > 3000)
    throw new Error('Set a full local WECOG_MASK_BASELINE commit and 60-3000 rounds');

async function previous(name) {
    const relative = `apps/participant-web/js/face-segmenter/${name}`;
    const source = execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8', maxBuffer: 100000 });
    const base = pathToFileURL(path.join(root, relative));
    const resolved = source.replace(/from\s+(['"])(\.\.?\/[^'"\n]+)\1/g,
        (_match, _quote, reference) => `from ${JSON.stringify(new URL(reference, base).href)}`);
    return import('data:text/javascript;base64,' + Buffer.from(resolved).toString('base64'));
}

const before = { mask: await previous('mask-analyzer.js'), region: await previous('region-analyzer.js') };
const candidate = { mask, region };
const cases = [];
for (const width of [79, 160, 256]) for (const roll of [0, -.25, .2]) for (const mirror of [false, true]) {
    const input = faceVisibilityFixture({ width, height: width + 11, roll, mirror });
    if (cases.length % 3) for (let i = 0; i < input.data.length; i++) input.data[i] = (i * 73 + cases.length) % 6;
    cases.push(input);
}

function run(implementation, input) {
    const analysis = implementation.mask.analyzeMasks({ categoryMask: input.categoryMask }, input.width, input.height, input.landmarks);
    return { distribution: analysis.classDistribution, face: analysis.faceRegion, confidence: analysis.confidenceMap,
        visibility: implementation.region.analyzeFaceRegionsVisibility(analysis, input.landmarks,
            input.width, input.height, DEFAULT_THRESHOLDS) };
}

const times = { before: [], candidate: [] };
for (let i = -36; i < rounds; i++) {
    const input = cases[((i % cases.length) + cases.length) % cases.length], results = {};
    for (const key of i % 2 ? ['candidate', 'before'] : ['before', 'candidate']) {
        const start = performance.now();
        results[key] = run(key === 'before' ? before : candidate, input);
        const elapsed = performance.now() - start;
        if (i >= 0) times[key].push(elapsed);
    }
    if (!isDeepStrictEqual(results.before, results.candidate)) throw new Error('mask_derived_results_changed');
}
function summary(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return { samples: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length,
        p95Ms: sorted[Math.ceil(.95 * values.length) - 1] };
}
console.log(JSON.stringify({ schemaVersion: 'mask_row_benchmark.v1', baseline,
    runtime: { platform: process.platform, arch: process.arch, node: process.version },
    cases: cases.length, rounds, sameDerivedResults: true, before: summary(times.before), candidate: summary(times.candidate),
    limitations: ['Synthetic masks and geometry, not human recordings.', 'Only CPU mask/region processing; inference is not timed.',
        'Not evidence of Windows camera FPS recovery or scientific accuracy.'] }, null, 2));
