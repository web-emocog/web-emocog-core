// Runs only inside the local benchmark browser. No physical sensors or uploads.
export async function benchmarkPipeline({ profile, body, warmupMs, durationMs, captureMode = 'automatic', cameraInput = 'canvas' }) {
    window.__pipelineBenchmarkPhase = 'imports';
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker,
        ImageSegmenter: vision.ImageSegmenter, PoseLandmarker: vision.PoseLandmarker });
    const { PrecheckAnalyzer } = await import(root + 'precheck-analyzer/PrecheckAnalyzer.js');
    const { FaceSegmenter } = await import(root + 'face-segmenter/FaceSegmenter.js');
    const { SessionFramePipeline } = await import(root + 'session-runtime/frame-pipeline.js');
    const { QCMetrics } = await import(root + 'qc-metrics/index.js');
    const { MultimodalSessionCollector } = await import(root + 'multimodal/session-collector.js');
    const { createMonotonicClock } = await import('/packages/shared/multimodal/timebase.mjs');
    const { observeVideoFrames } = await import(root + 'session-runtime/video-frames.mjs?v=20261104-4');
    const { distribution, fpsWindows } = await import('/benchmark-performance.mjs');
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const source = document.querySelector('#source');
    const camera = document.querySelector('#camera');
    const mediaTime = () => cameraInput === 'fake-file' ? camera.currentTime : source.currentTime;
    const sourceEnded = () => cameraInput !== 'fake-file' && source.ended;
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const sourceCallbacks = { id: null };
    const probe = document.createElement('canvas').getContext('webgl2');
    const debug = probe?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? probe.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    let stream, pipeline, multimodal, qc, observer, timer, primingTimer, raf, running = true;
    const measurement = { active: false };
    const startedAt = performance.now();
    const active = { face: 0, segment: 0, pose: 0 };
    const maximum = { face: 0, segment: 0, pose: 0 };
    const work = { face: [], segment: [], pose: [] };
    const completed = [], lateness = [], inputLateness = [], pendingFrame = [];
    let hiddenTicks = 0, uiTicks = 0, renders = 0, sourceFrames = 0, decodedFaceFrames = 0;
    let overlapMs = 0, overlapAt = null;
    const errors = new Map(), statuses = {};
    const faceStages = { pixels: [], inference: [], derived: [] };
    const captures = { video: [], sharedPixels: [], other: [] };
    const nativeCapture = window.createImageBitmap;
    window.createImageBitmap = async function(source, ...options) {
        const at = performance.now();
        const key = source instanceof ImageData ? 'sharedPixels' : source instanceof HTMLVideoElement ? 'video' : 'other';
        try { return await nativeCapture.call(this, source, ...options); }
        finally { if (measurement.active) captures[key].push(performance.now() - at); }
    };
    const concurrency = () => {
        const now = performance.now();
        if (overlapAt !== null) overlapMs += now - overlapAt;
        overlapAt = measurement.active && active.face > 0 && active.segment + active.pose > 0 ? now : null;
    };
    const instrumented = [];
    const instrument = (client, task) => {
        if (!client || client.task !== task || typeof client._request !== 'function') throw new Error('benchmark_worker_client_unavailable');
        const request = client._request;
        instrumented.push([client, request]);
        client._request = async function(message, ...args) {
            if (message.type !== 'frame') return request.call(this, message, ...args);
            const at = performance.now();
            concurrency(); active[task]++; if (measurement.active) maximum[task] = Math.max(maximum[task], active[task]); concurrency();
            try { return await request.call(this, message, ...args); }
            finally {
                if (measurement.active) work[task].push(performance.now() - at);
                concurrency(); active[task]--; concurrency();
            }
        };
    };
    const analyzer = new PrecheckAnalyzer(), segmenter = new FaceSegmenter();
    const originalAnalyze = analyzer.analyzeFrame.bind(analyzer);
    analyzer.analyzeFrame = async (...args) => {
        const result = await originalAnalyze(...args);
        if (measurement.active && result.face?.detected) decodedFaceFrames++;
        if (measurement.active) for (const [name, values] of Object.entries(faceStages)) {
            if (Number.isFinite(result.replayStageMs?.[name])) values.push(result.replayStageMs[name]);
        }
        if (result.error) errors.set('face_result_error', (errors.get('face_result_error') || 0) + 1);
        return result;
    };
    let loopDone = null;
    try {
        window.__pipelineBenchmarkPhase = 'model_initialization';
        if (!await analyzer.initialize() || !await segmenter.initialize()) throw new Error('benchmark_models_unavailable');
        instrument(analyzer.worker, 'face'); instrument(segmenter.worker, 'segment');
        let deliver = () => {};
        if (cameraInput === 'fake-file') {
            source.removeAttribute('src'); source.load();
            // Only selected by the Node harness with Chromium's mandatory
            // fake-device + file-capture flags, never a participant option.
            stream = await navigator.mediaDevices.getUserMedia({ video: {
                width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, min: 15 }
            }, audio: false });
            camera.srcObject = stream;
        } else {
            window.__pipelineBenchmarkPhase = 'file_playback';
            await source.play();
            await new Promise(resolve => source.requestVideoFrameCallback(resolve));
            source.pause(); source.currentTime = 0;
            await Promise.race([new Promise(resolve => source.addEventListener('seeked', resolve, { once: true })), sleep(250)]);
            ctx.drawImage(source, 0, 0, 640, 480);
            stream = canvas.captureStream(captureMode === 'manual' ? 0 : 30);
            const track = stream.getVideoTracks()[0];
            if (captureMode === 'manual' && typeof track.requestFrame !== 'function') throw new Error('benchmark_manual_capture_unavailable');
            deliver = () => { if (captureMode === 'manual') track.requestFrame(); };
            camera.srcObject = stream;
            // Prime the canvas track before the timed part, including WebKit.
            primingTimer = setInterval(() => { deliver(); ctx.drawImage(source, 0, 0, 640, 480); }, 33);
            deliver(); ctx.drawImage(source, 0, 0, 640, 480);
        }
        window.__pipelineBenchmarkPhase = 'stream_playback';
        await camera.play();
        if (camera.readyState < 2) await new Promise(resolve => camera.addEventListener('loadeddata', resolve, { once: true }));
        clearInterval(primingTimer); primingTimer = null;
        const definition = { settings: { ...(profile === 'v2' ? { signalProfileId: 'protocol_signals.v2' } : {}),
            featureFlags: { bodyMovement: body, multimodal: true } } };
        const clock = createMonotonicClock();
        const state = { sessionData: { startTime: Date.now(), ids: { session: 'local-performance-comparison' }, events: [],
            tech: { cameraFPS: 30 } }, runtime: { invitationProtocolDefinition: definition,
            currentPhase: 'benchmark', taskContext: {}, sessionClock: clock, localAnalyzer: analyzer, faceSegmenter: segmenter } };
        qc = state.runtime.qcMetrics = new QCMetrics({ screenWidth: 900, screenHeight: 700 }); qc.start();
        multimodal = new MultimodalSessionCollector({ state, clock, bodyEnabled: body, enabled: true }); multimodal.start();
        const controller = { featureFlags: { bodyMovement: body, multimodal: true }, sessionClock: clock,
            setModuleStatus(key, status) { statuses[key] = status; },
            resolveIssue() {}, captureMultimodalFrame: frame => multimodal.captureFrame(frame),
            reportIssue(issue) {
                if (issue.kind === 'technical') errors.set(issue.code, (errors.get(issue.code) || 0) + 1);
            } };
        pipeline = new SessionFramePipeline({ state, controller, video: camera });
        const tick = pipeline._tick.bind(pipeline);
        pipeline._tick = async () => {
            const frames = pipeline.diagnostics.frames;
            const at = performance.now();
            await tick();
            if (measurement.active && pipeline.diagnostics.frames > frames) {
                completed.push(performance.now() - loopDone);
                pendingFrame.push(performance.now() - at);
            }
        };
        window.__pipelineBenchmarkPhase = 'pipeline_start';
        await pipeline.start();
        if (body) await pipeline.bodyPose.initializing;
        if (body) instrument(pipeline.bodyPose.worker, 'pose');
        const waitUntil = performance.now() + 35000;
        while (!pipeline.bpm.ready && performance.now() < waitUntil) await sleep(50);
        if (!pipeline.bpm.ready || (body && !pipeline.bodyPose.ready)) throw new Error('benchmark_signal_models_unavailable');
        const initializationMs = performance.now() - startedAt;
        const draw = () => {
            if (!running) return;
            ctx.drawImage(source, 0, 0, 640, 480);
            deliver();
            sourceCallbacks.id = source.requestVideoFrameCallback(draw);
        };
        if (cameraInput !== 'fake-file') sourceCallbacks.id = source.requestVideoFrameCallback(draw);
        pipeline.neutralCalibration?.begin(performance.now());
        if (cameraInput !== 'fake-file') await source.play();
        window.__pipelineBenchmarkPhase = 'warmup';
        await sleep(warmupMs);
        window.__pipelineBenchmarkFailure = {
            phase: 'warmup', frames: pipeline.diagnostics.frames, sourceTime: mediaTime(),
            neutral: pipeline.neutralCalibration?.snapshot(performance.now()) || null,
            lastFaceDetected: state.runtime.lastPrecheckResult?.face?.detected === true,
            segmentationComplete: pipeline.lastSegmenterResult?.isComplete === true,
            segmentationAgeMs: performance.now() - pipeline.lastSegmenterCapturedAt,
            errors: Object.fromEntries(errors)
        };
        if (sourceEnded() || document.visibilityState !== 'visible') throw new Error('benchmark_source_or_visibility_invalid');
        if (pipeline.neutralCalibration && pipeline.neutralCalibration.status !== 'ready') {
            throw new Error('benchmark_neutral_not_ready_' + pipeline.neutralCalibration.status);
        }
        if (analyzer.backend !== 'worker' || segmenter.backend !== 'worker' || (body && pipeline.bodyPose.backend !== 'worker')) {
            throw new Error('benchmark_not_worker_execution');
        }
        const before = structuredClone(pipeline.diagnostics);
        const beforeBpm = pipeline.bpm.snapshot();
        const beforeEmotion = state.sessionData.emotionSamples?.length || 0;
        const mediaStart = mediaTime();
        await window.__benchmarkSystemBoundary?.('start');
        loopDone = performance.now(); measurement.active = true;
        window.__pipelineBenchmarkPhase = 'measurement';
        observer = observeVideoFrames(camera, (_now, count) => { if (measurement.active) sourceFrames += count; });
        const render = () => { if (!running) return; if (measurement.active) renders++; raf = requestAnimationFrame(render); };
        raf = requestAnimationFrame(render);
        let previousUi = performance.now();
        const inputHandler = event => { if (measurement.active) inputLateness.push(Math.max(0, performance.now() - event.detail)); };
        document.addEventListener('benchmark-input', inputHandler);
        timer = setInterval(() => {
            if (!measurement.active) return;
            const now = performance.now();
            const scheduledAt = previousUi + 20;
            lateness.push(Math.max(0, now - scheduledAt)); previousUi = now;
            uiTicks++; if (document.visibilityState !== 'visible') hiddenTicks++;
            document.dispatchEvent(new CustomEvent('benchmark-input', { detail: scheduledAt }));
        }, 20);
        await sleep(durationMs);
        const endedAt = performance.now(), elapsedMs = endedAt - loopDone;
        concurrency(); overlapAt = null; measurement.active = false;
        clearInterval(timer); timer = null; observer.stop(); observer = null;
        document.removeEventListener('benchmark-input', inputHandler);
        await window.__benchmarkSystemBoundary?.('end');
        const after = pipeline.diagnostics;
        const bpm = pipeline.bpm.snapshot();
        const frames = after.frames - before.frames;
        const take = key => after[key] - before[key];
        const output = { elapsedMs, initializationMs, mediaElapsedMs: (mediaTime() - mediaStart) * 1000,
            analysisFps: frames * 1000 / elapsedMs, cameraDeliveryFps: sourceFrames * 1000 / elapsedMs,
            renderFps: renders * 1000 / elapsedMs, frames, faceFrames: decodedFaceFrames,
            faceCoverage: decodedFaceFrames / Math.max(1, frames), uiTicks, hiddenTicks,
            uiTimerLatenessMs: distribution(lateness), syntheticInputLatenessMs: distribution(inputLateness),
            primaryMs: distribution(pendingFrame), fpsWindows: fpsWindows(completed, elapsedMs),
            faceStagesMs: Object.fromEntries(Object.entries(faceStages).map(([name, values]) => [name, distribution(values)])),
            bitmapCaptures: Object.fromEntries(Object.entries(captures).map(([name, values]) => [name, distribution(values)])),
            workers: { face: analyzer.backend, segment: segmenter.backend, pose: pipeline.bodyPose.backend,
                faceDelegate: analyzer.inferenceDelegate || 'legacy_gpu',
                segmentDelegate: segmenter.inferenceDelegate, maxPending: maximum, overlapMs,
                roundTripMs: Object.fromEntries(Object.entries(work).map(([key, values]) => [key, distribution(values)])) },
            segmentHz: take('segmentFrames') * 1000 / elapsedMs, poseHz: take('poseFrames') * 1000 / elapsedMs,
            segmentMeanMs: take('segmentMsTotal') / Math.max(1, take('segmentFrames')),
            poseMeanMs: take('poseMsTotal') / Math.max(1, take('poseFrames')),
            emotionSamples: (state.sessionData.emotionSamples?.length || 0) - beforeEmotion,
            bpmSamples: bpm.validSampleCount - beforeBpm.validSampleCount,
            respirationSamples: bpm.validRespSampleCount - beforeBpm.validRespSampleCount,
            errors: Object.fromEntries(errors), neutralStatus: pipeline.neutralCalibration?.status || 'legacy_automatic',
            renderer, captureMode, cameraInput, cameraSettings: (() => {
                const settings = stream.getVideoTracks()[0].getSettings();
                return { width: settings.width, height: settings.height, frameRate: settings.frameRate };
            })(), liveCameraUsed: false, calibratedGazeEvaluated: false };
        window.__pipelineBenchmarkFailure = { ...output, sourceEnded: sourceEnded(),
            lastFrameIllumination: state.runtime.lastPrecheckResult?.illumination?.value ?? null };
        if (hiddenTicks || sourceEnded() || frames < 10 || decodedFaceFrames / frames < .5) {
            if (decodedFaceFrames / frames < .5 && cameraInput !== 'fake-file') {
                const direct = await analyzer.analyzeFrame(source);
                window.__pipelineBenchmarkFailure.directFileControl = {
                    faceDetected: direct.face?.detected === true, error: !!direct.error,
                    illumination: direct.illumination?.value ?? null
                };
            }
            throw new Error('benchmark_incomplete_measurement');
        }
        if (maximum.face !== 1 || maximum.segment !== 1 || maximum.pose !== (body ? 1 : 0)
            || Math.abs(work.face.length - frames) > 1) {
            throw new Error('benchmark_worker_ownership_not_confirmed');
        }
        return output;
    } finally {
        running = false; measurement.active = false;
        if (timer) clearInterval(timer);
        if (primingTimer) clearInterval(primingTimer);
        if (raf) cancelAnimationFrame(raf);
        if (sourceCallbacks.id !== null) source.cancelVideoFrameCallback(sourceCallbacks.id);
        observer?.stop(); pipeline?.stop('local_benchmark'); qc?.stop(); multimodal?.stop();
        analyzer.dispose(); segmenter.dispose(); stream?.getTracks().forEach(track => track.stop());
        camera.srcObject = null; source.pause();
        for (const [client, request] of instrumented) client._request = request;
        window.createImageBitmap = nativeCapture;
    }
}
