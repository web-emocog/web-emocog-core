// Local-only functional replay. No camera permission, account, ingest or raw-data upload.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { DATASET, privateFile, verifyManifest } from './reference.mjs';
import { replayOptions } from './replay-options.mjs';
import { assessReplayPerformance } from './performance.mjs';
import { profileFaceStages } from './profile-stages.mjs';
import { profileWorkerGl } from './profile-gl.mjs';
import { loadAutomation } from './automation.mjs';

const options = replayOptions(process.env);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { engines, version: automationVersion } = await loadAutomation(repo, process.env.WECOG_REFERENCE_AUTOMATION_ROOT);
const dataRoot = process.env.WECOG_REFERENCE_ROOT;
let manifest = null, clip = null;
if (options.workload !== 'source' || options.sourceInput !== 'canvas') {
  if (!dataRoot) throw new Error('Set WECOG_REFERENCE_ROOT to the private, external dataset directory');
  const dataReal = await fs.realpath(dataRoot);
  if (dataReal === repo || dataReal.startsWith(repo + path.sep)) throw new Error('Keep face recordings outside the source/web directory');
  manifest = JSON.parse(await fs.readFile(await privateFile(dataRoot, 'local-manifest.json', 100000), 'utf8'));
  await verifyManifest(dataRoot, manifest);
  clip = await privateFile(dataRoot, manifest.replay.path);
  if (!manifest.files.some(f => f.path === manifest.replay.path)) throw new Error('unlocked_replay');
}
const observer = process.env.WECOG_OBSERVER_ROOT;
let observerRoot = null;
if (options.workload !== 'source') {
  if (!observer) throw new Error('Set WECOG_OBSERVER_ROOT to the local Observer pilot folder');
  observerRoot = await fs.realpath(path.join(observer, 'extension'));
}
const observerFiles = ['core.mjs', 'privacy.js', 'measurement.mjs', 'analysis.mjs', 'throughput.mjs'];
const servedSource = ['apps/participant-web/js/precheck-analyzer/', 'apps/participant-web/js/session-runtime/',
  'apps/participant-web/js/vendor/mediapipe/', 'apps/participant-web/js/gaze-tracker/',
  'apps/participant-web/js/emotion/', 'apps/participant-web/js/face-segmenter/',
  'apps/participant-web/js/qc-metrics/', 'scripts/reference-data/media-clock.mjs', 'scripts/reference-data/source-cadence.mjs',
  'apps/participant-web/js/emotion-stub-new.js', 'apps/participant-web/js/precheck-status.mjs',
  'apps/participant-web/js/qc-pause-overlay-new.js', 'scripts/reference-data/performance.mjs',
  'apps/participant-web/js/web-page/eye-signal.js', 'lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/'];
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.task': 'application/octet-stream', '.tflite': 'application/octet-stream' };
const server = http.createServer(async (req, res) => {
  try {
    const expectedOrigin = `http://127.0.0.1:${server.address().port}`;
    if (req.headers.host !== new URL(expectedOrigin).host
        || (req.headers.origin && req.headers.origin !== expectedOrigin)
        || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><meta charset="utf-8"><title>Local reference replay</title><video id="clip" muted width="640" height="480"${clip ? ' src="/clip.webm"' : ''}></video>`); return;
    }
    let file, type;
    if (pathname === '/clip.webm' && clip) { file = clip; type = 'video/webm'; }
    else if (pathname.startsWith('/source/')) {
      const relative = decodeURIComponent(pathname.slice(8));
      if (!servedSource.some(prefix => prefix.endsWith('/') ? relative.startsWith(prefix) : relative === prefix)
          || !types[path.extname(relative)]) throw new Error('not_found');
      file = await privateFile(repo, relative, 32 * 1024 * 1024); type = types[path.extname(relative)];
    } else if (observerRoot && pathname.startsWith('/observer/') && observerFiles.includes(pathname.slice(10))) {
      file = await privateFile(observerRoot, pathname.slice(10)); type = 'text/javascript';
    } else throw new Error('not_found');
    res.setHeader('Content-Type', type);
    if (pathname === '/source/apps/participant-web/js/face-segmenter/delegate-policy.mjs'
      && options.segmentDelegate !== 'default') {
      const source = `export function segmentationDelegate() { return '${options.segmentDelegate}'; }`;
      res.setHeader('Content-Length', Buffer.byteLength(source));
      res.end(req.method === 'HEAD' ? undefined : source); return;
    }
    if (pathname === '/source/apps/participant-web/js/precheck-analyzer/PrecheckAnalyzer.js') {
      const profiled = profileFaceStages(await fs.readFile(file, 'utf8'), options.faceInput, options.faceOutputs, options.faceCanvas);
      res.setHeader('Content-Length', Buffer.byteLength(profiled));
      res.end(req.method === 'HEAD' ? undefined : profiled); return;
    }
    const { size } = await fs.stat(file);
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = Number(match?.[1]), end = match?.[2] ? Number(match[2]) : size - 1;
      if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start || end >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return;
      }
      res.writeHead(206, { 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}` });
      if (req.method === 'HEAD') res.end(); else createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': size });
      if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    }
  } catch (_) { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await engines[options.browser].launch({ headless: options.headless,
    ...(options.browser === 'chromium' && options.chromiumMode === 'browser' ? { channel: 'chromium' } : {}),
    ...(options.browser === 'chromium' && options.renderer === 'software'
      ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}) });
  const context = await browser.newContext({ permissions: [], viewport: { width: 900, height: 700 } });
  let blockedNetwork = 0;
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : (blockedNetwork++, route.abort()));
  const page = await context.newPage();
  if (options.faceDelegate === 'CPU' || options.glProfile) {
    // Local diagnostic interposition only. Do not change the pinned vendor or
    // silently select another numerical backend in production.
    const workerSource = await fs.readFile(path.join(repo, 'apps/participant-web/js/session-runtime/vision-worker.js'), 'utf8');
    let source = workerSource;
    for (const [name, delegate] of [['FaceLandmarker', options.faceDelegate]]) {
      if (delegate === 'default') continue;
      const original = `${name}: vision.${name}`;
      assert.equal(source.split(original).length, 2, 'known delegate initialization');
      source = source.replace(original, `${name}: { createFromOptions: (files, opts) =>
        vision.${name}.createFromOptions(files, { ...opts, baseOptions: { ...opts.baseOptions, delegate: '${delegate}' } }) }`);
    }
    if (options.glProfile) source = profileWorkerGl(source);
    await page.route('**/session-runtime/vision-worker.js*', route => {
      if (new URL(route.request().url()).origin !== origin) { blockedNetwork++; return route.abort(); }
      return route.fulfill({ contentType: 'text/javascript', body: source });
    });
  }
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) console.error('Reference engine warning:', message.text().slice(0, 400));
  });
  page.on('response', response => {
    if (response.status() >= 400 && response.url().startsWith(origin + '/source/')) {
      console.error('Reference source unavailable:', new URL(response.url()).pathname, response.status());
    }
  });
  await page.goto(origin);
  const webgl = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { available: false, renderer: null };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { available: true, renderer };
  });
  for (const url of ['/.env', '/source/.env', '/source/apps/api/config.js', '/local-manifest.json',
    '/source/scripts/reference-data/automation.mjs', '/source/scripts/reference-data/profile-gl.mjs',
    '/source/apps/autotests/node_modules/playwright/index.js']) {
    assert.equal((await page.request.get(origin + url)).status(), 404);
  }
  if (!clip) assert.equal((await page.request.get(origin + '/clip.webm')).status(), 404);
  if (!observerRoot) assert.equal((await page.request.get(origin + '/observer/core.mjs')).status(), 404);
  assert.equal((await page.request.get(origin + '/clip.webm', { headers: { Origin: 'https://untrusted.example' } })).status(), 403);
  assert.equal((await page.request.get(origin + '/clip.webm', { headers: { Host: 'untrusted.example' } })).status(), 403);
  const result = await page.evaluate(async ({ playbackRate, workload, dispatch, sourceInput }) => {
    if (workload === 'source') {
      const { measureSourceCadence, measureSyntheticSourceCadence } = await import('/source/scripts/reference-data/source-cadence.mjs');
      if (sourceInput === 'canvas') return measureSyntheticSourceCadence(document.querySelector('#clip'));
      return { ...await measureSourceCadence(document.querySelector('#clip')), sourceInput: 'finite_file' };
    }
    const { distribution: summarize, fpsWindows, frameCadencePerformance } = await import('/source/scripts/reference-data/performance.mjs');
    const { nextMediaTimestamp, prepareFiniteVideo } = await import('/source/scripts/reference-data/media-clock.mjs');
    const { VisionWorkerClient } = await import('/source/apps/participant-web/js/session-runtime/vision-worker-client.mjs');
    const workerTimings = {};
    const capture = VisionWorkerClient.prototype._capture, request = VisionWorkerClient.prototype._request;
    for (const method of ['_capture', '_request']) {
      const original = method === '_capture' ? capture : request;
      VisionWorkerClient.prototype[method] = async function (...args) {
        const started = performance.now();
        const timed = method === '_capture' || args[0]?.type === 'frame';
        try { return await original.apply(this, args); }
        finally {
          if (timed) {
            const key = `${this.task}${method === '_capture' ? 'CaptureMs' : 'RoundTripMs'}`;
            const values = workerTimings[key] ||= [];
            if (values.length < 10000) values.push(performance.now() - started);
          }
        }
      };
    }
    const { PrecheckAnalyzer } = await import('/source/apps/participant-web/js/precheck-analyzer/index.js');
    const { getFramePixels } = await import('/source/apps/participant-web/js/session-runtime/frame-pixels.mjs');
    const { ContinuousBpmCollector } = await import('/source/apps/participant-web/js/session-runtime/continuous-bpm.js');
    const { extractEyeSignalSample } = await import('/source/apps/participant-web/js/web-page/eye-signal.js');
    const { buildAttentionMetrics } = await import('/source/apps/participant-web/js/gaze-tracker/attention-metrics.js');
    const { MeasurementBins } = await import('/observer/measurement.mjs');
    const { analyzeInterval } = await import('/observer/analysis.mjs');
    const { ThroughputWindow } = await import('/observer/throughput.mjs');
    const { observeVideoFrames } = await import('/source/apps/participant-web/js/session-runtime/video-frames.mjs');
    const analyzer = new PrecheckAnalyzer();
    if (!await analyzer.initialize() || analyzer.backend !== 'worker') throw new Error('replay_worker_required');
    const bpm = new ContinuousBpmCollector({ getFps: () => fps, onError: () => { failures++; } });
    let fps = 0, frames = 0, faceFrames = 0, failures = 0, lastT = null, gaps = 0;
    const measurements = new MeasurementBins(0, ['bpm', 'respiration']), eyes = [], video = document.querySelector('#clip');
    const frameRate = new ThroughputWindow(0);
    let auxiliary = null, emotion = null;
    const auxiliaryState = { sessionData: { startTime: 1 }, runtime: { currentPhase: 'reference_replay' } };
    if (workload === 'multimodal') {
      const vision = await import('/source/apps/participant-web/js/vendor/mediapipe/vision_bundle.mjs');
      Object.assign(window, { FilesetResolver: vision.FilesetResolver, ImageSegmenter: vision.ImageSegmenter, PoseLandmarker: vision.PoseLandmarker });
      const { SessionFramePipeline } = await import('/source/apps/participant-web/js/session-runtime/frame-pipeline.js');
      const { FaceSegmenter } = await import('/source/apps/participant-web/js/face-segmenter/FaceSegmenter.js');
      emotion = await import('/source/apps/participant-web/js/emotion-stub-new.js');
      const segmenter = new FaceSegmenter();
      auxiliaryState.runtime.faceSegmenter = segmenter;
      auxiliary = new SessionFramePipeline({ state: auxiliaryState, video, controller: { featureFlags: { bodyMovement: true },
        setModuleStatus() {}, resolveIssue() {}, reportIssue() { failures++; } } });
      if (!await segmenter.initialize()) throw new Error('reference_segment_init_failed');
      if (!await auxiliary.bodyPose.start()) throw new Error('reference_pose_init_failed');
      auxiliary.active = true; auxiliary.generation++;
      emotion.startEmotionSession('public-reference-replay');
    }
    // Slow offline playback reduces compute-driven frame dropping; all signal
    // clocks still use the ORIGINAL media PTS, never the slower wall clock.
    const phaseStarted = performance.now();
    const faceMs = [], analyzerMs = [], signalMs = [], totalMs = [], timerLatenessMs = [], completedAtMs = [];
    const stages = { pixels: [], inference: [], derived: [] };
    const callbackIntervalsMs = [], dispatchLagMs = [], analysisStartIntervalsMs = [];
    let presentationCallbacks = 0, callbacksWhileBusy = 0, lastCallbackAt = null;
    const glTotals = {};
    const initialClockTrace = [];
    let terminalFrameReplays = 0;
    let sourceFrames = 0, playbackStarted = null, playbackElapsedMs = null, playbackStartMediaTimeMs = null;
    let firstProcessedMediaTimeMs = null;
    let maxGapMs = 0, longTasks = 0, longTaskMs = 0;
    let sourceObserver = null;
    const longTaskObserver = typeof PerformanceObserver === 'function'
      && PerformanceObserver.supportedEntryTypes?.includes('longtask')
      ? new PerformanceObserver(list => { for (const entry of list.getEntries()) { longTasks++; longTaskMs += entry.duration; } }) : null;
    longTaskObserver?.observe({ entryTypes: ['longtask'] });
    let timerAt = performance.now();
    const uiTimer = setInterval(() => { const now = performance.now(); timerLatenessMs.push(Math.max(0, now - timerAt - 16)); timerAt = now; }, 16);
    let previousPublishedT = null;
    try {
      if (!await bpm.start()) throw new Error('replay_bpm_unavailable');
      const mediaPreparation = await prepareFiniteVideo(video);
      await new Promise((resolve, reject) => {
        let done = false, inFlight = false, ended = false, latest = null, lastFrame = null, scheduled = null, callbackId = null;
        let lastStarted = -Infinity;
        let nextDueAt = null;
        const schedule = delay => {
          if (done || inFlight || scheduled !== null) return;
          scheduled = setTimeout(() => { scheduled = null; void tick(); }, delay);
        };
        const complete = error => {
          if (done) return; done = true; clearTimeout(timer); video.pause();
          clearTimeout(scheduled); video.cancelVideoFrameCallback(callbackId);
          playbackElapsedMs = performance.now() - playbackStarted;
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => complete(new Error('replay_deadline')), 210000);
        video.onerror = () => complete(new Error('replay_decode_failed'));
        video.onended = () => { ended = true; if (!inFlight) {
          if (latest && latest.presentedFrames !== lastFrame) schedule(0); else complete();
        } };
        const tick = async () => {
          if (done) return;
          if (!latest || latest.presentedFrames === lastFrame) { if (ended) complete(); return; }
          const metadata = latest;
          lastFrame = metadata.presentedFrames;
          inFlight = true;
          const frameStarted = performance.now();
          dispatchLagMs.push(frameStarted - metadata.arrivedAt);
          if (Number.isFinite(lastStarted)) analysisStartIntervalsMs.push(frameStarted - lastStarted);
          lastStarted = frameStarted;
          if (dispatch === 'frame-deadline') nextDueAt = nextDueAt === null
            ? frameStarted + 33 : Math.max(nextDueAt + 33, frameStarted);
          try {
            let step;
            try { step = nextMediaTimestamp(lastT, metadata, video); }
            catch (error) {
              // Relative clocks/counters only, never video contents.
              throw new Error(`${error.message}:previous=${lastT},current=${metadata.mediaTime * 1000 + 1},presented=${lastFrame},processed=${frames},currentTime=${video.currentTime},duration=${video.duration},ended=${video.ended},endEvent=${ended},seeking=${video.seeking},initialTrace=${JSON.stringify(initialClockTrace)}`);
            }
            if (step.kind === 'terminal_replay') { terminalFrameReplays++; complete(); return; }
            const t = step.timestamp;
            if (firstProcessedMediaTimeMs === null) firstProcessedMediaTimeMs = t - 1;
            const gap = lastT === null ? 0 : t - lastT;
            maxGapMs = Math.max(maxGapMs, gap);
            frameRate.tick(t); fps = frameRate.read(t) ?? 0;
            if (gap > 250) gaps++;
            lastT = t;
            const frame = await analyzer.analyzeFrame(video, { timestamp: t, wallTimestamp: t });
            if (done) return;
            const faceCompleted = performance.now();
            faceMs.push(faceCompleted - frameStarted);
            if (Number.isFinite(frame.analysisTime)) analyzerMs.push(frame.analysisTime);
            for (const [key, values] of Object.entries(stages)) {
              if (Number.isFinite(frame.replayStageMs?.[key])) values.push(frame.replayStageMs[key]);
            }
            for (const [name, stats] of Object.entries(frame.replayGl || {})) {
              const row = glTotals[name] ||= { calls: 0, totalMs: 0, maxMs: 0 };
              row.calls += stats.calls; row.totalMs += stats.totalMs; row.maxMs = Math.max(row.maxMs, stats.maxMs);
            }
            frames++; if (frame.error) failures++;
            const face = frame.face?.detected === true && !frame.error;
            if (face) faceFrames++;
            const eye = face ? extractEyeSignalSample(frame, t) : null;
            if (eye && Number.isFinite(eye.earAvg)) eyes.push({ ...eye, t });
            const signal = face ? bpm.process(video, frame.landmarks, t, getFramePixels(frame), t) : null;
            signalMs.push(performance.now() - faceCompleted);
            const fresh = signal && signal.t !== previousPublishedT;
            if (signal) previousPublishedT = signal.t;
            measurements.push({ t, metrics: { face: face ? 1 : 0, ear: eye?.earAvg,
              bpm: fresh && signal.published && !signal.held ? signal.bpm : null,
              respiration: fresh ? signal.respRate : null }, gazeType: 'unknown' });
            measurements.pushPublications(t, { bpm: fresh && signal.published && !signal.held ? signal.bpm : null,
              respiration: fresh ? signal.respRate : null });
            if (auxiliary) { auxiliary._processEmotion(frame); auxiliary._scheduleAuxiliary(frame, null); }
            totalMs.push(performance.now() - frameStarted);
            completedAtMs.push(performance.now() - playbackStarted);
          } catch (error) { complete(error); }
          finally {
            inFlight = false;
            if (!done) {
              if (latest.presentedFrames !== lastFrame) schedule(dispatch === 'frame-deadline'
                ? Math.max(0, nextDueAt - performance.now()) : Math.max(0, 33 - (performance.now() - frameStarted)));
              else if (ended) complete();
            }
          }
        };
        const onPresented = (_now, metadata) => {
          if (done) return;
          const arrivedAt = performance.now();
          presentationCallbacks++;
          if (inFlight) callbacksWhileBusy++;
          if (lastCallbackAt !== null) callbackIntervalsMs.push(arrivedAt - lastCallbackAt);
          lastCallbackAt = arrivedAt;
          latest = { mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames, arrivedAt };
          if (initialClockTrace.length < 20) initialClockTrace.push({ mediaTime: metadata.mediaTime,
            presentedFrames: metadata.presentedFrames, currentTime: video.currentTime,
            presentationTime: metadata.presentationTime, expectedDisplayTime: metadata.expectedDisplayTime });
          callbackId = video.requestVideoFrameCallback(onPresented);
          // Match the production latest-frame, single-flight policy. Waiting for
          // another presentation after inference undercounts attainable throughput.
          if (dispatch !== 'timer' && !inFlight) {
            const remaining = dispatch === 'frame-deadline' ? Math.max(0, (nextDueAt ?? 0) - performance.now())
              : Math.max(0, 33 - (performance.now() - lastStarted));
            if (remaining === 0) {
              clearTimeout(scheduled); scheduled = null;
              void tick();
            } else schedule(remaining);
          } else schedule(0);
        };
        video.defaultPlaybackRate = video.playbackRate = playbackRate;
        video.play().then(() => {
          if (done) return;
          playbackStarted = performance.now();
          playbackStartMediaTimeMs = video.currentTime * 1000;
          sourceObserver = observeVideoFrames(video, (_now, count) => { sourceFrames += count; });
          callbackId = video.requestVideoFrameCallback(onPresented);
        }).catch(complete);
      });
      sourceObserver?.stop();
      if (auxiliary) {
        const deadline = performance.now() + 3000;
        while (auxiliary.auxiliaryBusy && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        if (auxiliary.auxiliaryBusy) throw new Error('reference_auxiliary_teardown_timeout');
      }
      const samples = measurements.drain(lastT || 0, true);
      const report = { meta: { id: 'public-reference-functional-replay', durationMs: lastT }, samples, events: [] };
      const analysis = analyzeInterval(report);
      const roundTrip = analyzeInterval(JSON.parse(JSON.stringify(report)));
      if (JSON.stringify(analysis) !== JSON.stringify(roundTrip)) throw new Error('aggregate_roundtrip_mismatch');
      const eyeSummary = buildAttentionMetrics({ eyeSignals: eyes }).global;
      return { frames, faceFrames, failures, gaps, mediaDurationMs: lastT, elapsedMs: performance.now() - phaseStarted,
        sourceClock: 'decoded_video_pts_not_processing_wall_time', backend: analyzer.backend,
        sourceClockDiagnostics: { method: 'finite_media_pts.v2', terminalFrameReplays,
          admission: 'prepare_then_play_promise_then_callbacks', preparation: mediaPreparation,
          playbackStartMediaTimeMs, firstProcessedMediaTimeMs },
        observer: analysis, web: bpm.finalize('reference_replay'),
        blinks: eyeSummary?.blinkDynamics?.blinkCount ?? eyeSummary?.blinkCount ?? null,
        perclos: { mean30sPct: eyeSummary?.perclos?.windows?.['30s']?.meanPct ?? null,
          mean60sPct: eyeSummary?.perclos?.windows?.['60s']?.meanPct ?? null,
          algorithmVersion: eyeSummary?.meta?.algorithmVersion ?? null, accuracyValidated: false },
        auxiliary: auxiliary ? { segmentBackend: auxiliaryState.runtime.faceSegmenter.backend,
          segmentDelegate: auxiliaryState.runtime.faceSegmenter.inferenceDelegate,
          segmentFallbackReason: auxiliaryState.runtime.faceSegmenter.workerFallbackReason || null,
          poseBackend: auxiliary.bodyPose.backend,
          poseFallbackReason: auxiliary.bodyPose.workerFallbackReason || null,
          segmentFrames: auxiliary.diagnostics.segmentFrames, poseFrames: auxiliary.diagnostics.poseFrames,
          deferredFrames: auxiliary.diagnostics.auxiliaryDeferredFrames,
          segmentMeanMs: auxiliary.diagnostics.segmentFrames ? auxiliary.diagnostics.segmentMsTotal / auxiliary.diagnostics.segmentFrames : null,
          poseMeanMs: auxiliary.diagnostics.poseFrames ? auxiliary.diagnostics.poseMsTotal / auxiliary.diagnostics.poseFrames : null,
          body: auxiliary.bodyPose.summary(), emotion: emotion.getEmotionSummary(auxiliaryState.sessionData), accuracyValidated: false } : null,
        offlinePlaybackRate: video.playbackRate,
        performance: { schemaVersion: 'replay_performance.v2', playbackElapsedMs,
          ...frameCadencePerformance({ sourceFrames, processedFrames: frames, elapsedMs: playbackElapsedMs,
            method: sourceObserver?.method ?? 'not_started', playbackQuality: sourceObserver?.playbackQuality,
            fallbackReason: sourceObserver?.fallbackReason }),
          processedWallFps: frames * 1000 / playbackElapsedMs,
          presentationCallbacks, callbacksWhileBusy, callbackWallFps: presentationCallbacks * 1000 / playbackElapsedMs,
          callbackIntervalsMs: summarize(callbackIntervalsMs), dispatchLagMs: summarize(dispatchLagMs),
          analysisStartIntervalsMs: summarize(analysisStartIntervalsMs),
          processedMediaFps: frames * 1000 / lastT, maxCaptureGapMs: maxGapMs,
          fpsWindows: fpsWindows(completedAtMs, playbackElapsedMs),
          workerTimings: Object.fromEntries(Object.entries(workerTimings).map(([key, values]) => [key, summarize(values)])),
          faceMs: summarize(faceMs), faceAnalyzerMs: summarize(analyzerMs), signalMs: summarize(signalMs), frameMs: summarize(totalMs),
          faceStagesMs: Object.fromEntries(Object.entries(stages).map(([key, values]) => [key, summarize(values)])),
          glCalls: glTotals,
          uiTimerLatenessMs: summarize(timerLatenessMs), longTaskSupported: !!longTaskObserver, longTasks, longTaskMs },
        roundTripEqual: true, rawCoordinatesSaved: false, accuracyValidated: false };
    } finally {
      VisionWorkerClient.prototype._capture = capture; VisionWorkerClient.prototype._request = request;
      clearInterval(uiTimer); longTaskObserver?.disconnect(); sourceObserver?.stop();
      if (auxiliary) {
        auxiliary.active = false; auxiliary.generation++;
        clearTimeout(auxiliary.auxiliaryTimer); auxiliary.bodyPose.stop();
        auxiliaryState.runtime.faceSegmenter.dispose(); auxiliary.bpm.finalize('reference_unused');
        emotion.endEmotionSession();
      }
      video.pause(); analyzer.dispose(); bpm.finalize('reference_cleanup');
    }
  }, options);
  assert.equal(blockedNetwork, 0, 'no attempted external data transfer');
  if (options.workload === 'source') {
    assert.ok(result.elapsedMs >= 19000 && result.callbacks > 0 && result.presented > 0, 'source control actually ran');
    const report = { method: 'wecog-source-cadence.v2', dataset: options.sourceInput === 'file' ? DATASET : null,
      environment: { browser: options.browser, browserVersion: browser.version(), automationVersion,
        platform: process.platform, arch: process.arch, run: options.run, headless: options.headless,
        chromiumMode: options.chromiumMode, webglProbe: webgl },
      ...result, blockedNetwork, accuracyStatus: 'not_scored',
      performanceAssessment: { status: 'not_applicable', reasons: ['source_only_no_analysis'] } };
    const out = path.join(repo, 'test-results/reference-data'); await fs.mkdir(out, { recursive: true });
    const filename = `mcd-source-${options.browser}-${options.chromiumMode}${options.headless ? '' : '-headed'}${options.sourceInput === 'canvas' ? '-canvas' : ''}-pw${automationVersion}-v2-run${options.run}.json`;
    await fs.writeFile(path.join(out, filename), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  } else {
  assert.ok(result.frames >= 100 && result.faceFrames > result.frames * .5, 'real face pipeline must actually run');
  assert.equal(result.failures, 0);
  if (options.workload === 'multimodal') {
    assert.ok(result.auxiliary.segmentFrames > 0 && result.auxiliary.poseFrames > 0, 'auxiliary models must actually process frames');
  }
  assert.equal(result.observer.metrics.bpm.n, result.web.validSampleCount, 'Observer must preserve every fresh BPM publication');
  assert.equal(result.observer.metrics.respiration.n, result.web.validRespSampleCount, 'Observer must preserve every fresh respiration publication');
  const report = { method: 'wecog-public-video-functional-replay.v9', dataset: DATASET,
    environment: { browser: options.browser, browserVersion: browser.version(), platform: process.platform,
      arch: process.arch, run: options.run, automationVersion, headless: options.headless,
      engineDistribution: options.browser === 'chromium' ? options.chromiumMode : options.headless ? 'playwright_headless' : 'playwright_headed',
      webglProbe: webgl,
      segmentDelegateOverride: options.segmentDelegate,
      faceDelegate: options.faceDelegate === 'CPU' ? 'CPU_requested_local_experiment_not_production_policy' : 'production_default_GPU',
      faceInput: options.faceInput === 'bitmap' ? 'production_bitmap' : 'imageData_local_experiment_not_production_policy',
      faceOutputs: options.faceOutputs,
      faceCanvas: options.faceCanvas,
      glProfile: options.glProfile,
      renderer: options.browser === 'chromium' && options.renderer === 'software' ? 'swiftshader_requested' : 'headless_default',
      scheduler: options.dispatch === 'frame-deadline' ? 'native_frame_deadline_single_flight_33ms_target'
        : options.dispatch === 'frame-ready' ? 'native_frame_ready_single_flight_33ms_cap' : 'single_flight_latest_frame_33ms_target',
      workload: options.workload === 'multimodal' ? 'face_eye_rppg_observer_plus_production_auxiliary_pose_segment_FACS'
        : 'worker_face_plus_eye_signal_plus_rppg_plus_observer_aggregation',
      notIncluded: ['personal_gaze_calibration', 'actual_RT_input', 'protocol_UI_and_persistence',
        ...(options.workload === 'signals' ? ['pose_worker', 'segmentation_worker', 'FACS'] : [])] },
    assessment: manifest.assessment, accuracyStatus: 'not_scored',
    reason: 'Capture timestamps differ from decoded frames; reference clock mapping is not independently verified.',
    unavailableReferences: ['gaze', 'respiration_waveform', 'FACS', 'keyboard_RT'], ...result,
    performanceAssessment: options.glProfile
      ? { status: 'not_applicable', reasons: ['profiling_overhead_not_performance_acceptance'] }
      : assessReplayPerformance(result),
    qualityWarnings: [!result.web.validSampleCount && 'no_fresh_bpm_publications', !result.web.validRespSampleCount && 'no_fresh_respiration_publications'].filter(Boolean) };
  const out = path.join(repo, 'test-results/reference-data'); await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'mcd-functional-replay.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const filename = `mcd-replay-${options.browser}-${options.renderer}-${options.workload}-${options.playbackRate}x${options.chromiumMode === 'browser' ? '-browser' : ''}${options.headless ? '' : '-headed'}${options.segmentDelegate !== 'default' ? '-segment' + options.segmentDelegate : ''}${options.faceDelegate === 'CPU' ? '-faceCPU' : ''}${options.faceInput === 'imageData' ? '-facePixels' : ''}${options.faceOutputs === 'used' ? '-usedOutputs' : ''}${options.faceCanvas === 'compute' ? '-computeCanvas' : ''}${options.glProfile ? '-glProfile' : ''}${options.dispatch === 'frame-ready' ? '-frameReady' : options.dispatch === 'frame-deadline' ? '-frameDeadline' : ''}-pw${automationVersion}-v9-run${options.run}.json`;
  await fs.writeFile(path.join(out, filename), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ frames: result.frames, faceFrames: result.faceFrames, gaps: result.gaps,
    bpmCoverage: result.observer.metrics.bpm.coverage, respirationCoverage: result.observer.metrics.respiration.coverage,
    bpmPublications: result.web.validSampleCount, respirationPublications: result.web.validRespSampleCount,
    offlinePlaybackRate: result.offlinePlaybackRate, qualityWarnings: report.qualityWarnings,
    performance: result.performance, performanceAssessment: report.performanceAssessment,
    bpmMean: result.web.bpmMean, respRateMean: result.web.respRateMean,
    blinks: result.blinks, environment: report.environment,
    auxiliary: result.auxiliary,
    accuracyStatus: report.accuracyStatus, roundTripEqual: result.roundTripEqual, output: path.join(out, 'mcd-functional-replay.json') }, null, 2));
  if (options.requirePerformance) assert.equal(report.performanceAssessment.status, 'pass',
    `reference_performance_failed:${report.performanceAssessment.reasons.join(',')}`);
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
