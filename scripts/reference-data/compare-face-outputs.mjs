// Local, matched-frame experiment. Never reads the camera or participant files.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAutomation } from './automation.mjs';
import { privateFile, verifyManifest, fingerprint, DATASET } from './reference.mjs';
import { MODEL_ASSETS } from '../../apps/participant-web/js/session-runtime/protocol-profile.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = await fs.realpath(process.env.WECOG_REFERENCE_ROOT);
if (root === repo || root.startsWith(repo + path.sep)) throw new Error('reference_inside_webroot');
const manifest = JSON.parse(await fs.readFile(await privateFile(root, 'local-manifest.json', 100000), 'utf8'));
await verifyManifest(root, manifest);
const model = await privateFile(repo, 'apps/participant-web/js/vendor/mediapipe/models/' + MODEL_ASSETS.face.file);
if ((await fingerprint(model)).sha256 !== MODEL_ASSETS.face.sha256) throw new Error('model_integrity_failed');
const clip = await privateFile(root, manifest.replay.path);
const frames = Number(process.env.WECOG_FACE_OUTPUT_FRAMES || 120);
const delegate = process.env.WECOG_FACE_OUTPUT_DELEGATE || 'auto';
if (!Number.isInteger(frames) || frames < 30 || frames > 600) throw new Error('invalid_frame_count');
if (!['auto', 'CPU'].includes(delegate)) throw new Error('invalid_delegate');
const { engines } = await loadAutomation(repo);
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
    '.task': 'application/octet-stream' };
const server = http.createServer(async (req, res) => {
    try {
        const origin = 'http://127.0.0.1:' + server.address().port;
        if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)
            || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return; }
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
        const url = new URL(req.url, origin);
        if (url.pathname === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><title>Local matched-frame comparison</title><video id="source" src="/clip.webm" muted preload="auto"></video>'); return;
        }
        const relative = decodeURIComponent(url.pathname.slice(1));
        let file, type;
        if (relative === 'clip.webm') { file = clip; type = 'video/webm'; }
        else {
            if (!relative.startsWith('apps/participant-web/js/') || !types[path.extname(relative)]) { res.writeHead(404).end(); return; }
            file = await privateFile(repo, relative, 32 * 1024 * 1024); type = types[path.extname(file)];
        }
        // The locked replay is small; serving it whole also avoids platform-specific range seeking.
        const content = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length });
        res.end(req.method === 'HEAD' ? undefined : content);
    } catch (_) { if (!res.headersSent) res.writeHead(404).end(); else res.destroy(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await engines.chromium.launch({ headless: false, channel: 'chromium' });
    const page = await browser.newPage({ permissions: [] });
    page.setDefaultTimeout(120000);
    await page.goto('http://127.0.0.1:' + server.address().port);
    const result = await page.evaluate(async ({ count, delegate }) => {
        const vision = await import('/apps/participant-web/js/vendor/mediapipe/vision_bundle.mjs');
        Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker });
        const { PrecheckAnalyzer } = await import('/apps/participant-web/js/precheck-analyzer/PrecheckAnalyzer.js');
        const video = document.querySelector('video');
        if (video.readyState < 2) await new Promise((resolve, reject) => {
            video.addEventListener('loadeddata', resolve, { once: true }); video.addEventListener('error', reject, { once: true });
        });
        video.pause();
        const full = new PrecheckAnalyzer({ worker: false }), core = new PrecheckAnalyzer({ worker: false, outputFaceBlendshapes: false });
        if (delegate === 'CPU') { full.cpuFallbackReason = core.cpuFallbackReason = 'diagnostic_forced_cpu'; }
        const times = { full: [], core: [] }, mismatches = new Set();
        const matrices = {};
        let faces = 0, sdkScoreFrames = 0;
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        try {
            if (!await full.initialize() || !await core.initialize()) throw new Error('model_unavailable');
            for (const [id, analyzer] of [['full', full], ['core', core]]) {
                const detect = analyzer.faceLandmarker.detectForVideo.bind(analyzer.faceLandmarker);
                analyzer.faceLandmarker.detectForVideo = (...args) => {
                    const result = detect(...args);
                    matrices[id] = JSON.stringify(result.facialTransformationMatrixes);
                    return result;
                };
            }
            for (let i = 0; i < count + 10; i++) {
                const time = (i + 1) / 15;
                if (!(time < video.duration)) throw new Error('reference_too_short');
                await new Promise(resolve => { video.addEventListener('seeked', resolve, { once: true }); video.currentTime = time; });
                ctx.drawImage(video, 0, 0, 640, 480);
                const capture = { timestamp: time * 1000, wallTimestamp: 100000 + time * 1000 };
                const results = {};
                for (const [id, analyzer] of i % 2 ? [['core', core], ['full', full]] : [['full', full], ['core', core]]) {
                    results[id] = await analyzer.analyzeFrame(canvas, capture);
                    if (results[id].error) throw new Error('inference_failed');
                    if (i >= 10) times[id].push(analyzer.lastFrameTiming.modelCallMs);
                }
                if (i < 10) continue;
                if (results.full.face.detected && results.core.face.detected) faces++;
                if (results.full.blendShapes && Object.keys(results.full.blendShapes).length >= 50) sdkScoreFrames++;
                if (matrices.full !== matrices.core) mismatches.add('facialTransformationMatrixes');
                for (const key of ['landmarks', 'face', 'eyes', 'pose', 'mouth', 'illumination', 'frameSize']) {
                    if (JSON.stringify(results.full[key]) !== JSON.stringify(results.core[key])) mismatches.add(key);
                }
            }
            const summary = values => {
                const sorted = [...values].sort((a, b) => a - b);
                return { samples: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length,
                    p95Ms: sorted[Math.ceil(.95 * sorted.length) - 1] };
            };
            return { frames: count, faces, sdkScoreFrames, mismatches: [...mismatches],
                delegates: { full: full.inferenceDelegate, core: core.inferenceDelegate },
                timings: { full: summary(times.full), core: summary(times.core) } };
        } finally { full.dispose(); core.dispose(); }
    }, { count: frames, delegate });
    console.log(JSON.stringify({ schemaVersion: 'face-output-comparison.v1', dataset: DATASET, model: MODEL_ASSETS.face, result,
        limitations: ['Matched local replay, not Windows/camera acceptance or scientific accuracy validation.',
            'Alternating inference order, same immutable frame; no throughput claim from these timings.'] }, null, 2));
    if (result.faces !== frames || result.sdkScoreFrames !== frames || result.mismatches.length) process.exitCode = 1;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
