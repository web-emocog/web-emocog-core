import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadAutomation } from './automation.mjs';
import { verifyManifest, privateFile, fingerprint, DATASET } from './reference.mjs';
import { benchmarkPipeline } from './pipeline-benchmark-page.mjs';
import { profileFaceStages } from './profile-stages.mjs';
import { validateCameraFileMetadata } from './prepare-camera-file.mjs';
import { processCpuDelta } from './performance.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = await fs.realpath(process.env.WECOG_BASELINE_ROOT);
const dataRoot = await fs.realpath(process.env.WECOG_REFERENCE_ROOT);
if ([repo, baseline].some(root => dataRoot === root || dataRoot.startsWith(root + path.sep))) throw new Error('benchmark_data_inside_webroot');
const manifest = JSON.parse(await fs.readFile(await privateFile(dataRoot, 'local-manifest.json', 100000), 'utf8'));
await verifyManifest(dataRoot, manifest);
const clip = await privateFile(dataRoot, manifest.replay.path);
const locked = manifest.files.find(row => row.path === manifest.replay.path);
if (!locked) throw new Error('benchmark_video_not_locked');
const { engines, version } = await loadAutomation(repo, process.env.WECOG_REFERENCE_AUTOMATION_ROOT);
const browsers = (process.env.WECOG_PIPELINE_BROWSERS || 'chromium,firefox,webkit').split(',');
if (!browsers.length || browsers.some(key => !['chromium', 'firefox', 'webkit'].includes(key))) throw new Error('invalid_benchmark_browser');
const durationMs = Number(process.env.WECOG_PIPELINE_MEASURE_MS || 30000);
const warmupMs = Number(process.env.WECOG_PIPELINE_WARMUP_MS || 15000);
const repeats = Number(process.env.WECOG_PIPELINE_REPEATS || 2);
const captureMode = process.env.WECOG_PIPELINE_CAPTURE_MODE || 'automatic';
const fakeVideoPath = process.env.WECOG_PIPELINE_FAKE_VIDEO;
let fakeVideo = null;
if (fakeVideoPath) {
    if (browsers.some(key => key !== 'chromium') || !path.isAbsolute(fakeVideoPath)) throw new Error('invalid_benchmark_fake_video');
    const real = await privateFile(path.dirname(fakeVideoPath), path.basename(fakeVideoPath), 1024 * 1024 * 1024);
    const handle = await fs.open(real, 'r');
    try {
        const header = Buffer.alloc(256); await handle.read(header, 0, header.length, 0);
        if (!/^YUV4MPEG2 W640 H480 F\d+:\d+[^\n]* C420/.test(header.toString('ascii'))) throw new Error('invalid_benchmark_fake_video_header');
    } finally { await handle.close(); }
    const actual = await fingerprint(real);
    const metadata = JSON.parse(await fs.readFile(await privateFile(path.dirname(real), path.basename(real) + '.json', 10000), 'utf8'));
    validateCameraFileMetadata(metadata, locked, actual);
    fakeVideo = { path: real, ...actual, metadata };
}
const faceInput = process.env.WECOG_PIPELINE_FACE_INPUT || 'bitmap';
const faceCanvas = process.env.WECOG_PIPELINE_FACE_CANVAS || 'default';
const profileStages = process.env.WECOG_PIPELINE_PROFILE_STAGES === '1';
const collectCpu = process.env.WECOG_PIPELINE_COLLECT_CPU === '1';
const segmentDelegate = process.env.WECOG_PIPELINE_SEGMENT_DELEGATE || 'default';
if (!['default', 'GPU', 'CPU'].includes(segmentDelegate)) throw new Error('invalid_benchmark_segment_delegate');
if (collectCpu && browsers.some(key => key !== 'chromium')) throw new Error('invalid_benchmark_cpu_browser');
const baselineProfile = process.env.WECOG_BASELINE_PROFILE || 'v1';
if (!['v1', 'v2'].includes(baselineProfile)) throw new Error('invalid_benchmark_baseline_profile');
if (!['bitmap', 'imageData'].includes(faceInput) || !['default', 'compute'].includes(faceCanvas)) throw new Error('invalid_benchmark_face_options');
if (!['automatic', 'manual'].includes(captureMode)) throw new Error('invalid_benchmark_capture_mode');
if (fakeVideo && captureMode !== 'automatic') throw new Error('invalid_benchmark_fake_capture_mode');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3 || !Number.isFinite(durationMs) || durationMs < 5000 || durationMs > 30000
    || !Number.isFinite(warmupMs) || warmupMs < 8000 || warmupMs > 20000) throw new Error('invalid_benchmark_duration');
const variants = [
    baselineProfile === 'v2'
        ? { id: 'before-v2-no-body', root: baseline, profile: 'v2', body: false }
        : { id: 'develop-v1-body', root: baseline, profile: 'develop', body: true },
    { id: 'candidate-v1-body', root: repo, profile: 'v1', body: true },
    { id: 'candidate-v2-body', root: repo, profile: 'v2', body: true },
    { id: 'candidate-v2-no-body', root: repo, profile: 'v2', body: false }
];
const selected = process.env.WECOG_PIPELINE_VARIANTS?.split(',');
const chosen = selected ? variants.filter(row => selected.includes(row.id)) : variants;
if (!chosen.length || (selected && selected.length !== chosen.length)) throw new Error('invalid_benchmark_variant');
const permitted = ['apps/participant-web/js/', 'packages/shared/multimodal/', 'lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/'];
const exact = ['apps/participant-web/translations.js'];
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
    '.task': 'application/octet-stream', '.tflite': 'application/octet-stream' };
const sourceHash = async root => {
    const files = [...exact];
    const walk = async relative => {
        for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
            const next = path.join(relative, entry.name);
            if (entry.isDirectory()) await walk(next);
            else if (entry.isFile() && /\.(js|mjs)$/.test(entry.name)) files.push(next);
        }
    };
    for (const prefix of permitted) await walk(prefix);
    const hash = createHash('sha256');
    for (const file of files.sort()) { hash.update(file); hash.update(await fs.readFile(path.join(root, file))); }
    return hash.digest('hex');
};
const sourceHashes = { baseline: await sourceHash(baseline), candidate: await sourceHash(repo) };
const { MODEL_ASSETS } = await import('../../apps/participant-web/js/session-runtime/protocol-profile.mjs');
for (const root of [baseline, repo]) for (const model of Object.values(MODEL_ASSETS)) {
    const file = await privateFile(root, 'apps/participant-web/js/vendor/mediapipe/models/' + model.file);
    if ((await fingerprint(file)).sha256 !== model.sha256) throw new Error('benchmark_model_hash_mismatch');
}
let activeRoot = baseline;
const server = http.createServer(async (req, res) => {
    let opened;
    try {
        const origin = 'http://127.0.0.1:' + server.address().port;
        if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)
            || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return; }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
        const url = new URL(req.url, origin);
        if (url.pathname === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><meta charset="utf-8"><title>Local pipeline benchmark</title><video id="source" src="/clip.webm" muted width="320" height="240"></video><video id="camera" muted width="320" height="240"></video>');
            return;
        }
        let file, mime;
        if (url.pathname === '/clip.webm') { file = clip; mime = 'video/webm'; }
        else if (url.pathname === '/benchmark-performance.mjs') {
            file = path.join(repo, 'scripts/reference-data/performance.mjs'); mime = 'text/javascript';
        } else {
            const relative = decodeURIComponent(url.pathname.slice(1));
            if ((!permitted.some(prefix => relative.startsWith(prefix)) && !exact.includes(relative)) || !types[path.extname(relative)]) {
                res.writeHead(404).end(); return;
            }
            file = await privateFile(activeRoot, relative, 32 * 1024 * 1024);
            mime = types[path.extname(relative)];
        }
        opened = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const info = await opened.stat();
        const { size } = info;
        if (!info.isFile() || size > 256 * 1024 * 1024) throw new Error('invalid_benchmark_file');
        res.setHeader('Content-Type', mime);
        if (segmentDelegate !== 'default' && url.pathname === '/apps/participant-web/js/face-segmenter/delegate-policy.mjs') {
            const source = `export function segmentationDelegate() { return '${segmentDelegate}'; }`;
            res.setHeader('Content-Length', Buffer.byteLength(source));
            res.end(req.method === 'HEAD' ? undefined : source); return;
        }
        if ((profileStages || faceInput !== 'bitmap' || faceCanvas !== 'default')
            && url.pathname === '/apps/participant-web/js/precheck-analyzer/PrecheckAnalyzer.js') {
            const source = profileFaceStages(await opened.readFile('utf8'), faceInput, 'full', faceCanvas);
            res.setHeader('Content-Length', Buffer.byteLength(source));
            res.end(req.method === 'HEAD' ? undefined : source); return;
        }
        let start = 0, end = size - 1;
        if (req.headers.range) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
            start = Number(match?.[1]); end = match?.[2] ? Number(match[2]) : size - 1;
            if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end >= size) {
                res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end(); return;
            }
            res.writeHead(206, { 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
                'Content-Range': `bytes ${start}-${end}/${size}` });
        } else res.writeHead(200, { 'Content-Length': size });
        if (req.method === 'HEAD') res.end();
        else {
            const stream = opened.createReadStream({ start, end });
            opened = null;
            res.once('close', () => stream.destroy());
            stream.on('error', () => res.destroy()).pipe(res);
        }
    } catch (_) { if (!res.headersSent) res.writeHead(404).end(); else res.destroy(); }
    finally { await opened?.close(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const output = path.resolve(process.env.WECOG_PIPELINE_REPORT || path.join(repo, 'test-results/performance-ab/pipeline-comparison.json'));
let baselineCommit = null;
try { baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baseline, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
catch (_) { /* A local frozen source snapshot is identified by its content hash. */ }
const report = { schemaVersion: 'pipeline-comparison.v1', startedAt: new Date().toISOString(),
    machine: { platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, ramBytes: os.totalmem() },
    automationVersion: version, durationMs, warmupMs, repeats, captureMode, faceInput, faceCanvas,
    diagnosticInstrumentation: profileStages || faceInput !== 'bitmap' || faceCanvas !== 'default' || segmentDelegate !== 'default',
    collectCpu, segmentDelegate,
    sourceHashes, modelAssets: MODEL_ASSETS,
    harnessHashes: Object.fromEntries(await Promise.all(['compare-pipeline.mjs', 'pipeline-benchmark-page.mjs', 'performance.mjs'].map(async name =>
        [name, (await fingerprint(path.join(repo, 'scripts/reference-data', name))).sha256]))),
    baselineCommit, baselineProfile,
    source: { dataset: DATASET, sha256: locked.sha256, bytes: locked.bytes, input: 'same-640x480-canvas-MediaStream-from-locked-video',
        playbackRate: 1, physicalCamera: false,
        ...(fakeVideo ? { input: 'chromium-file-backed-fake-camera', fakeVideoSha256: fakeVideo.sha256,
            fakeVideoBytes: fakeVideo.bytes, fakeVideoProvenance: fakeVideo.metadata } : {}) }, runs: [], limitations: [
        'Not a scientific accuracy validation; no calibrated gaze; no physical keyboard RT.',
        'Common video-to-canvas-to-stream adapter adds overhead in every variant.',
        'Native browser builds under automation, not a test of installed Safari.',
        'Concurrent pending Worker requests demonstrate overlap, not OS CPU-core utilization.'
    ] };
const save = async () => { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
let browser;
let currentRun;
let page;
const debugValue = async expression => {
    let timer;
    try {
        return await Promise.race([page?.evaluate(expression).catch(() => null),
            new Promise(resolve => { timer = setTimeout(() => resolve(null), 2000); })]);
    } finally { clearTimeout(timer); }
};
try {
    for (const engine of browsers) for (let round = 0; round < repeats; round++) {
        const order = round % 2 ? [...chosen].reverse() : chosen;
        for (const variant of order) {
            currentRun = { engine, variant: variant.id, round: round + 1 };
            activeRoot = variant.root;
            browser = await engines[engine].launch({ headless: false, ...(engine === 'chromium' ? { channel: 'chromium' } : {}),
                ...(fakeVideo ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                    '--use-file-for-fake-video-capture=' + fakeVideo.path] } : {}) });
            const context = await browser.newContext({ permissions: [], viewport: { width: 900, height: 700 } });
            let blockedNetwork = 0;
            await context.route('**/*', route => route.request().url().startsWith(origin + '/')
                ? route.continue() : (blockedNetwork++, route.abort()));
            page = await context.newPage();
            const cpu = {};
            if (collectCpu) {
                const session = await browser.newBrowserCDPSession();
                await page.exposeFunction('__benchmarkSystemBoundary', async stage => {
                    if (!['start', 'end'].includes(stage) || cpu[stage]) throw new Error('benchmark_cpu_boundary_invalid');
                    cpu[stage] = (await session.send('SystemInfo.getProcessInfo')).processInfo;
                });
            }
            page.setDefaultTimeout(120000);
            await page.goto(origin); await page.bringToFront();
            let deadline;
            let result;
            try {
                result = await Promise.race([
                    page.evaluate(benchmarkPipeline, { profile: variant.profile, body: variant.body, warmupMs, durationMs, captureMode,
                        cameraInput: fakeVideo ? 'fake-file' : 'canvas' }),
                    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('benchmark_deadline')), 120000); })
                ]);
            } finally { clearTimeout(deadline); }
            if (blockedNetwork) throw new Error('benchmark_external_network_attempt');
            if (segmentDelegate !== 'default' && result.workers.segmentDelegate !== segmentDelegate) throw new Error('benchmark_requested_delegate_not_active');
            if (collectCpu) result.processCpu = processCpuDelta(cpu.start, cpu.end, result.elapsedMs);
            report.runs.push({ engine, browserVersion: browser.version(), variant: variant.id, round: round + 1, ...result });
            await browser.close(); browser = null;
            await save();
            console.log(JSON.stringify({ engine, variant: variant.id, round: round + 1, fps: result.analysisFps,
                cameraFps: result.cameraDeliveryFps, uiP95Ms: result.uiTimerLatenessMs.p95, errors: result.errors }));
        }
    }
    if (sourceHashes.baseline !== await sourceHash(baseline) || sourceHashes.candidate !== await sourceHash(repo)) {
        throw new Error('benchmark_source_changed_during_run');
    }
    report.completedAt = new Date().toISOString(); report.complete = true; await save();
} catch (error) {
    report.complete = false;
    report.completedAt = new Date().toISOString();
    report.failedRun = currentRun;
    report.failedPhase = await debugValue(() => window.__pipelineBenchmarkPhase || 'before_page_evaluation');
    report.invalidMeasurement = await debugValue(() => window.__pipelineBenchmarkFailure || null);
    report.failure = String(error.message).match(/\b((?:benchmark_|reference_|invalid_|unlocked_)[a-z_]+)\b/)?.[1] || 'benchmark_execution_failed';
    await save(); process.stderr.write(report.failure + '\n'); process.exitCode = 1;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
