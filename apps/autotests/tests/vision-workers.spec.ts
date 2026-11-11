import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test.beforeEach(async ({ page }) => {
  await page.goto('/apps/participant-web/js/precheck-analyzer/illumination.js');
});

test('local GL timing hooks preserve native readback and can be removed without retaining pixels', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/scripts/reference-data/profile-gl.mjs';
    const { installGlProfiler } = await import(modulePath);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2')!;
    const profile = installGlProfiler(window);
    try {
      gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      const pixels = new Uint8Array(4);
      profile.reset();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError(), measured = profile.read();
      profile.restore();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return { pixels: Array.from(pixels), error, measured, afterRestore: profile.read() };
    } finally { profile.restore(); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  });
  expect(result.pixels).toEqual([255, 0, 0, 255]);
  expect(result.error).toBe(0);
  expect(result.measured.readPixels.calls).toBe(1);
  expect(result.afterRestore).toEqual(result.measured);
  expect(Object.keys(result.measured.readPixels).sort()).toEqual(['calls', 'maxMs', 'totalMs']);
});

test('validation counts fresh captures, not timer polls, and requires every benchmark target', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/gaze-tracker/validation-sampling.mjs';
    const { createValidationSamplingWindow, validationTargetCoverage } = await import(modulePath);
    const window = createValidationSamplingWindow({ monotonicStart: 100, wallStart: 1000 });
    for (let tick = 0; tick < 60; tick++) window.accept({ frameTimestamp: 100 + Math.floor(tick / 2) * 67 });
    const stalled = createValidationSamplingWindow({ monotonicStart: 3000, wallStart: 4000 });
    for (let tick = 0; tick < 60; tick++) stalled.accept({ frameTimestamp: 100 });
    const points = [0, 1, 2, 3, 4].map(pointIndex => ({ pointIndex, samples: [{ gazeX: 10, gazeY: 20 }] }));
    return { slow: window.summary(), stalled: stalled.summary(),
      complete: validationTargetCoverage(points, 5), missing: validationTargetCoverage(points.slice(0, 4), 5) };
  });
  expect(result.slow).toMatchObject({ accepted: 30, duplicate: 30 });
  expect(result.stalled).toMatchObject({ accepted: 0, beforeWindow: 60 });
  expect(result.complete.complete).toBe(true);
  expect(result.missing).toMatchObject({ complete: false, missingTargetIndices: [4] });
});

test.describe('Mac worker segmentation', () => {
  test.use({ userAgent: async ({ browserName }, use) => {
    // Exercise each engine's production policy, not Chromium's CPU workaround
    // under a Firefox/WebKit engine with a substituted Chrome identity.
    const agents = {
      chromium: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/143.0.0.0 Safari/537.36',
      firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
      webkit: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15',
    };
    await use(agents[browserName]);
  } });
  test('reads real model masks with the engine-specific delegate and no main-thread fallback', async ({ page, browserName }) => {
    const result = await page.evaluate(async () => {
      const root = '/apps/participant-web/js/';
      const { FaceSegmenter } = await import(root + 'face-segmenter/FaceSegmenter.js');
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#bba08a'; context.fillRect(0, 0, 320, 240);
      const segmenter = new FaceSegmenter();
      try {
        const ready = await segmenter.initialize();
        const output = await segmenter.segmentFrame(context.getImageData(0, 0, 320, 240));
        return { ready, backend: segmenter.backend, delegate: segmenter.inferenceDelegate,
          hasData: output.maskAnalysis?.hasData === true, error: output.error || null,
          fallbackReason: segmenter.workerFallbackReason || null };
      } finally { segmenter.dispose(); }
    });
    expect(result).toEqual({ ready: true, backend: 'worker', delegate: browserName === 'chromium' ? 'CPU' : 'GPU',
      hasData: true, error: null, fallbackReason: null });
  });
});

test('real pinned face model runs in a Worker with identical no-face/lighting output', async ({ page }, info) => {
  if (info.project.name === 'chromium' && process.env.WECOG_NATIVE_GPU === '1') {
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return name;
    });
    expect(renderer).not.toMatch(/swiftshader|llvmpipe|software|llvm/i);
    await info.attach('page-webgl-renderer-not-worker-proof', { body: renderer, contentType: 'text/plain' });
  }
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker });
    const { PrecheckAnalyzer } = await import(root + 'precheck-analyzer/PrecheckAnalyzer.js');
    const { getFramePixels } = await import(root + 'session-runtime/frame-pixels.mjs');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    canvas.getContext('2d')!.fillStyle = '#808080'; canvas.getContext('2d')!.fillRect(0, 0, 640, 480);
    const analyzer = new PrecheckAnalyzer();
    const ready = await analyzer.initialize();
    const frame = await analyzer.analyzeFrame(canvas);
    const pixels = getFramePixels(frame);
    const result = { ready, backend: analyzer.backend, error: frame.error || null,
      faceDetected: frame.face.detected, lighting: frame.illumination,
      dimensions: frame.frameSize, pixelLength: pixels?.data.length,
      hasPixelsInJson: JSON.stringify(frame).includes('"data"'),
      fallbackReason: analyzer.workerFallbackReason || null };
    analyzer.dispose();
    return result;
  });
  expect(result.ready).toBe(true);
  expect(result.error).toBeNull();
  expect(result.faceDetected).toBe(false);
  expect(result.dimensions).toEqual({ width: 640, height: 480 });
  expect(result.pixelLength).toBe(640 * 480 * 4);
  expect(result.hasPixelsInJson).toBe(false);
  if (info.project.name === 'chromium') expect(result.backend).toBe('worker');
  await info.attach('backend', { body: JSON.stringify(result), contentType: 'application/json' });
});

test('worker unavailability falls back and keeps pixel and error contracts', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker });
    const { PrecheckAnalyzer } = await import(root + 'precheck-analyzer/PrecheckAnalyzer.js');
    const { getFramePixels } = await import(root + 'session-runtime/frame-pixels.mjs');
    const analyzer = new PrecheckAnalyzer({ worker: false });
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ready = await analyzer.initialize();
    const a = await analyzer.analyzeFrame(canvas);
    const b = await analyzer.analyzeFrame(canvas);
    const result = { ready, backend: analyzer.backend, sameCanvas: true,
      dimensions: b.frameSize, pixels: getFramePixels(b)?.data.length,
      sameLighting: JSON.stringify(a.illumination) === JSON.stringify(b.illumination) };
    analyzer.dispose(); return result;
  });
  expect(result).toMatchObject({ ready: true, backend: 'main', dimensions: { width: 320, height: 240 },
    pixels: 320 * 240 * 4, sameLighting: true });
});

test('same-frame segmentation preserves owned mask and QC output after releasing MediaPipe masks', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, ImageSegmenter: vision.ImageSegmenter });
    const { FaceSegmenter } = await import(root + 'face-segmenter/FaceSegmenter.js');
    const { analyzeMasks } = await import(root + 'face-segmenter/mask-analyzer.js');
    const { analyzeFaceRegionsVisibility } = await import(root + 'face-segmenter/region-analyzer.js');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 320, 240);
    gradient.addColorStop(0, '#bba08a'); gradient.addColorStop(1, '#304659');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 320, 240);
    const analyzer = new FaceSegmenter({ worker: false });
    let owned;
    try {
      if (!await analyzer.initialize()) throw new Error('segmenter_not_initialized');
      const actual = await analyzer.segmentFrame(canvas, null, 100);
      owned = analyzer.imageSegmenter.segmentForVideo(canvas, 200);
      const masks = analyzeMasks(owned, 320, 240, null);
      const visibility = analyzeFaceRegionsVisibility(masks, null, 320, 240, analyzer.thresholds);
      return { error: actual.error || null, hasData: actual.maskAnalysis?.hasData,
        sameMask: JSON.stringify(actual.maskAnalysis) === JSON.stringify(masks),
        sameVisibility: JSON.stringify(actual.faceVisibility) === JSON.stringify(visibility) };
    } finally {
      owned?.categoryMask?.close(); owned?.confidenceMasks?.forEach(mask => mask.close());
      analyzer.dispose();
    }
  });
  expect(result).toEqual({ error: null, hasData: true, sameMask: true, sameVisibility: true });
});

test('real auxiliary models use workers or a verified compatible fallback', async ({ page }, info) => {
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const { VisionWorkerClient } = await import(root + 'session-runtime/vision-worker-client.mjs');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const results = [];
    for (const task of ['segment', 'pose']) {
      if (task === 'segment') {
        const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
        Object.assign(window, { FilesetResolver: vision.FilesetResolver, ImageSegmenter: vision.ImageSegmenter });
        const { FaceSegmenter } = await import(root + 'face-segmenter/FaceSegmenter.js');
        const segmenter = new FaceSegmenter();
        try {
          const ready = await segmenter.initialize();
          const output = await segmenter.segmentFrame(canvas);
          results.push({ task, ok: ready && !output.error, error: output.error || null,
            inferenceDelegate: segmenter.inferenceDelegate,
            backend: segmenter.backend, fallbackReason: segmenter.workerFallbackReason || null });
        } finally { segmenter.dispose(); }
        continue;
      }
      const client = new VisionWorkerClient(task, { timeoutMs: 30000 });
      try {
        await client.start();
        const output = await client.analyze(canvas);
        results.push({ task, ok: true, error: output?.error || null, backend: 'worker', fallbackReason: null });
      } catch (error) { results.push({ task, ok: false, error: String(error), backend: 'failed', fallbackReason: null }); }
      finally { client.dispose(); }
    }
    return results;
  });
  await info.attach('workers', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.every(r => r.ok && !r.error)).toBe(true);
  for (const row of result) {
    if (row.task === 'segment' && row.backend === 'worker') {
      expect(['CPU', 'GPU']).toContain((row as any).inferenceDelegate);
    }
    if (row.backend !== 'worker') {
      expect(info.project.name).toBe('webkit');
      expect(row.task).toBe('segment');
      expect(row.backend).toBe('main');
      expect(row.fallbackReason).toBe('worker_initialization_failed');
    }
  }
});

test('blocked worker script falls back without changing the no-face contract', async ({ page }) => {
  await page.route('**/vision-worker.js*', route => route.abort());
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker });
    const { PrecheckAnalyzer } = await import(root + 'precheck-analyzer/PrecheckAnalyzer.js');
    const analyzer = new PrecheckAnalyzer();
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ready = await analyzer.initialize();
    const frame = await analyzer.analyzeFrame(canvas);
    const result = { ready, backend: analyzer.backend, error: frame.error || null, face: frame.face.detected };
    analyzer.dispose(); return result;
  });
  expect(result).toEqual({ ready: true, backend: 'main', error: null, face: false });
});

test('real face model starts on CPU after a GPU initialization failure, then releases the model', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker });
    const original = vision.FaceLandmarker.createFromOptions;
    const delegates: string[] = [];
    vision.FaceLandmarker.createFromOptions = async (files: any, options: any) => {
      delegates.push(options.baseOptions.delegate);
      if (options.baseOptions.delegate === 'GPU') throw new Error('Synthetic GPU initialization failure');
      return original.call(vision.FaceLandmarker, files, options);
    };
    const { PrecheckAnalyzer } = await import(root + 'precheck-analyzer/PrecheckAnalyzer.js?v=20261110-integration1');
    const analyzer = new PrecheckAnalyzer({ worker: false });
    try {
      const ready = await analyzer.initialize();
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const frame = await analyzer.analyzeFrame(canvas);
      return { ready, delegates, delegate: analyzer.inferenceDelegate, reason: analyzer.cpuFallbackReason,
        face: frame.face.detected, error: frame.error || null };
    } finally { analyzer.dispose(); vision.FaceLandmarker.createFromOptions = original; }
  });
  expect(result).toEqual({ ready: true, delegates: ['GPU', 'CPU'], delegate: 'CPU',
    reason: 'face_gpu_initialization_failed', face: false, error: null });
});

test('face runtime GPU loss retries once on CPU with the same capture clocks and no retry storm', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker });
    const original = vision.FaceLandmarker.createFromOptions;
    const delegates: string[] = [], timestamps: number[] = [];
    let closes = 0, cpuFails = false, sourceCanvas: HTMLCanvasElement;
    const inputPixels: number[] = [];
    vision.FaceLandmarker.createFromOptions = async (files: any, options: any) => {
      const delegate = options.baseOptions.delegate;
      delegates.push(delegate);
      if (delegate === 'GPU') return { detectForVideo() {
        // The camera/source can advance during model recovery, unlike the owned capture.
        sourceCanvas.getContext('2d')!.fillStyle = '#ffffff';
        sourceCanvas.getContext('2d')!.fillRect(0, 0, 320, 240);
        throw Error('synthetic_context_loss');
      }, close() { closes++; } };
      const model = await original.call(vision.FaceLandmarker, files, options);
      const detect = model.detectForVideo.bind(model), close = model.close.bind(model);
      model.detectForVideo = (input: any, timestamp: number) => {
        timestamps.push(timestamp);
        if (cpuFails) throw Error('synthetic_cpu_error');
        inputPixels.push(input.getContext('2d').getImageData(0, 0, 1, 1).data[0]);
        return detect(input, timestamp);
      };
      model.close = () => { closes++; close(); };
      return model;
    };
    const { PrecheckAnalyzer } = await import(root + 'precheck-analyzer/PrecheckAnalyzer.js?v=20261110-integration1');
    const analyzer = new PrecheckAnalyzer({ worker: false });
    try {
      await analyzer.initialize();
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      sourceCanvas = canvas;
      canvas.getContext('2d')!.fillStyle = '#000000'; canvas.getContext('2d')!.fillRect(0, 0, 320, 240);
      const frame = await analyzer.analyzeFrame(canvas, { timestamp: 1234, wallTimestamp: 5678 });
      cpuFails = true;
      const failures = [];
      for (let i = 0; i < 3; i++) failures.push(Boolean((await analyzer.analyzeFrame(canvas, { timestamp: 1300 + i })).error));
      return { delegates, timestamp: frame.timestamp, wallTimestamp: frame.wallTimestamp, timestamps,
        delegate: analyzer.inferenceDelegate, reason: analyzer.cpuFallbackReason, error: frame.error || null,
        failures, inputPixels, closesBeforeDispose: closes };
    } finally { analyzer.dispose(); vision.FaceLandmarker.createFromOptions = original; }
  });
  expect(result).toEqual({ delegates: ['GPU', 'CPU'], timestamp: 1234, wallTimestamp: 5678,
    timestamps: [1234, 1300, 1301, 1302], delegate: 'CPU', reason: 'face_gpu_inference_failed', error: null,
    failures: [true, true, true], inputPixels: [0], closesBeforeDispose: 2 });
});

test('unavailable face delegates produce technical failure without repeated model creation', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker });
    const original = vision.FaceLandmarker.createFromOptions;
    const attempts: string[] = [];
    vision.FaceLandmarker.createFromOptions = async (_files: any, options: any) => {
      attempts.push(options.baseOptions.delegate); throw Error('synthetic_no_graphics_backend');
    };
    const { PrecheckAnalyzer } = await import(root + 'precheck-analyzer/PrecheckAnalyzer.js?v=20261110-integration1');
    const analyzer = new PrecheckAnalyzer({ worker: false });
    try {
      const ready = await analyzer.initialize();
      const canvas = document.createElement('canvas');
      const errors = [];
      for (let i = 0; i < 4; i++) errors.push((await analyzer.analyzeFrame(canvas)).error);
      const beforeReset = attempts.length;
      analyzer.reset();
      await analyzer.initialize();
      return { ready, errors, attempts, beforeReset, backend: analyzer.backend };
    } finally { analyzer.dispose(); vision.FaceLandmarker.createFromOptions = original; }
  });
  expect(result).toEqual({ ready: false, errors: Array(4).fill('face_model_unavailable'),
    attempts: ['GPU', 'CPU', 'GPU', 'CPU'], beforeReset: 2, backend: 'failed' });
});

test('actual face task without any WebGL contexts either works on CPU or fails explicitly without repeated initialization', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const constructors = [HTMLCanvasElement, OffscreenCanvas];
    const originals = constructors.map(type => type.prototype.getContext);
    constructors.forEach((type: any, i) => {
      type.prototype.getContext = function(kind: string, ...args: any[]) {
        return /webgl/i.test(kind) ? null : originals[i].call(this, kind, ...args);
      };
    });
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker });
    const original = vision.FaceLandmarker.createFromOptions, attempts: string[] = [];
    vision.FaceLandmarker.createFromOptions = async (files: any, options: any) => {
      attempts.push(options.baseOptions.delegate); return original.call(vision.FaceLandmarker, files, options);
    };
    const { PrecheckAnalyzer } = await import(root + 'precheck-analyzer/PrecheckAnalyzer.js?v=20261110-integration1');
    const analyzer = new PrecheckAnalyzer({ worker: false });
    try {
      await analyzer.initialize();
      const canvas = document.createElement('canvas'), errors = [];
      for (let i = 0; i < 3; i++) errors.push((await analyzer.analyzeFrame(canvas)).error || null);
      return { attempts, errors, delegate: analyzer.inferenceDelegate, backend: analyzer.backend };
    } finally {
      analyzer.dispose(); vision.FaceLandmarker.createFromOptions = original;
      constructors.forEach((type: any, i) => { type.prototype.getContext = originals[i]; });
    }
  });
  expect(result.attempts).toEqual(['GPU', 'CPU']);
  if (result.backend === 'failed') {
    expect(result.errors.every(error => ['face_model_unavailable', 'face_inference_failed'].includes(error))).toBe(true);
  }
  else {
    expect(result.delegate).toBe('CPU');
    expect(result.errors).toEqual([null, null, null]);
  }
});

test('auxiliary main-thread fallback accepts the shared ImageData frame', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, ImageSegmenter: vision.ImageSegmenter });
    const { FaceSegmenter } = await import(root + 'face-segmenter/FaceSegmenter.js');
    const { ContinuousBodyPoseCollector } = await import(root + 'session-runtime/continuous-body-pose.js');
    const state = { sessionData: {}, runtime: {} }; const errors: string[] = [];
    const segmenter = new FaceSegmenter({ worker: false });
    const pose = new ContinuousBodyPoseCollector({ state, worker: false, onError: (error: Error) => errors.push(error.message) });
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const frame = canvas.getContext('2d')!.getImageData(0, 0, 320, 240);
    const segmentReady = await segmenter.initialize();
    const segmentation = await segmenter.segmentFrame(frame);
    const poseReady = await pose.start();
    await pose.process(frame);
    segmenter.dispose(); pose.stop();
    return { segmentReady, poseReady, hasMaskData: segmentation.maskAnalysis.hasData,
      segmentationError: segmentation.error || null, errors };
  });
  expect(result).toEqual({ segmentReady: true, poseReady: true, hasMaskData: true,
    segmentationError: null, errors: [] });
});

test('real auxiliary models reuse shared pixels without bitmap conversion and preserve same-image output', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/face-segmenter/FaceSegmenter.js?v=20261110-integration1';
    const { FaceSegmenter } = await import(modulePath);
    const clientPath = '/apps/participant-web/js/session-runtime/vision-worker-client.mjs?v=20261110-integration1';
    const { VisionWorkerClient } = await import(clientPath);
    const fixturePath = '/apps/autotests/tests/fixtures/face-visibility.mjs';
    const { faceVisibilityFixture } = await import(fixturePath);
    const { landmarks } = faceVisibilityFixture();
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 320, 240);
    gradient.addColorStop(0, '#bba08a'); gradient.addColorStop(1, '#304659');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 320, 240);
    const pixels = ctx.getImageData(0, 0, 320, 240);
    const bitmap = await createImageBitmap(pixels);
    const direct = new FaceSegmenter(), legacy = new FaceSegmenter();
    const directPose = new VisionWorkerClient('pose'), legacyPose = new VisionWorkerClient('pose');
    const nativeCapture = window.createImageBitmap;
    let captures = 0;
    try {
      if (!await direct.initialize() || !await legacy.initialize()) throw new Error('model_not_ready');
      window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
        captures++; return Reflect.apply(nativeCapture, window, args);
      }) as typeof createImageBitmap;
      const next = await direct.segmentFrame(pixels, landmarks, 100);
      const directCaptures = captures;
      const previous = await legacy.segmentFrame(bitmap, landmarks, 100);
      await directPose.start(); await legacyPose.start();
      const poseStart = captures;
      const poseNext = await directPose.analyze(pixels, { timestamp: 100 });
      const poseDirectCaptures = captures - poseStart;
      const posePrevious = await legacyPose.analyze(bitmap, { timestamp: 100 });
      const projection = (row: any) => ({ mask: row.maskAnalysis, visibility: row.faceVisibility,
        complete: row.isComplete, score: row.score, issues: row.issues, frameSize: row.frameSize });
      return { directBackend: direct.backend, legacyBackend: legacy.backend, directCaptures,
        totalCaptures: captures, poseDirectCaptures, poseEqual: JSON.stringify(poseNext) === JSON.stringify(posePrevious),
        byteLength: pixels.data.byteLength, errors: [next.error || null, previous.error || null],
        next: projection(next), previous: projection(previous) };
    } finally {
      window.createImageBitmap = nativeCapture;
      direct.dispose(); legacy.dispose(); bitmap.close();
      directPose.dispose(); legacyPose.dispose();
    }
  });
  expect(result).toMatchObject({ directBackend: 'worker', legacyBackend: 'worker',
    directCaptures: 0, poseDirectCaptures: 0, totalCaptures: 2, poseEqual: true,
    byteLength: 320 * 240 * 4, errors: [null, null] });
  expect(result.next).toEqual(result.previous);
});

test('slow inference leaves UI timers responsive in the worker, with unchanged derived values', async ({ page }, info) => {
  await page.bringToFront();
  const modelStub = `
    export const FilesetResolver = { forVisionTasks: async () => ({}) };
    export const FaceLandmarker = { createFromOptions: async () => ({
      detectForVideo() { const end = performance.now() + 35; while (performance.now() < end) {}
        return { faceLandmarks: [Array.from({ length: 478 }, (_, i) => ({
          x: .3 + (i % 20) * .02, y: .3 + Math.floor(i / 20) * .01, z: 0 }))],
          facialTransformationMatrixes: [{ data: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] }],
          faceBlendshapes: [{ categories: [{ categoryName: 'eyeBlinkLeft', score: .2 }] }] };
      }, close() {} }) };
  `;
  await page.route('**/vision_bundle.mjs', route => route.fulfill({ contentType: 'application/javascript', body: modelStub }));
  // Firefox does not consistently route dynamic imports made by a worker.
  // Replace only the model import; retain the real worker transport/analysis.
  const workerSource = readFileSync(path.resolve(__dirname, '../../participant-web/js/session-runtime/vision-worker.js'), 'utf8');
  await page.route('**/vision-worker.js*', route => route.fulfill({ contentType: 'application/javascript',
    body: workerSource.replace("'../vendor/mediapipe/vision_bundle.mjs'", JSON.stringify('data:text/javascript,' + encodeURIComponent(modelStub))) }));
  const result = await page.evaluate(async () => {
    const root = '/apps/participant-web/js/';
    const vision = await import(root + 'vendor/mediapipe/vision_bundle.mjs');
    Object.assign(window, { FilesetResolver: vision.FilesetResolver, FaceLandmarker: vision.FaceLandmarker });
    const { PrecheckAnalyzer } = await import(root + 'precheck-analyzer/PrecheckAnalyzer.js');
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
    const results = [];
    for (const worker of [false, true]) {
      const analyzer = new PrecheckAnalyzer({ worker }); await analyzer.initialize();
      let ticks = 0, lastTick = performance.now(); const gaps: number[] = [];
      const timer = setInterval(() => { const now = performance.now(); gaps.push(now - lastTick); lastTick = now; ticks++; }, 10);
      const start = performance.now(); const values = [];
      try {
        for (let i = 0; i < 12; i++) {
          const frame = await analyzer.analyzeFrame(canvas);
          values.push({ face: frame.face, lighting: frame.illumination, eyes: frame.eyes,
            pose: frame.pose, blendShapes: frame.blendShapes, error: frame.error || null });
        }
      } finally {
        clearInterval(timer); analyzer.dispose();
      }
      results.push({ worker, ticks, elapsedMs: performance.now() - start, values,
        visibility: document.visibilityState, maxGapMs: Math.max(performance.now() - lastTick, ...gaps) });
    }
    return results;
  });
  const timings = result.map(({ values, ...timing }) => timing);
  await info.attach('synthetic-responsiveness-timing', { body: JSON.stringify(timings), contentType: 'application/json' });
  console.log(`${info.project.name} synthetic responsiveness: ${JSON.stringify(timings)}`);
  expect(result[1].visibility).toBe('visible');
  expect(result[1].values).toEqual(result[0].values);
  expect(result[1].ticks).toBeGreaterThan(result[0].ticks);
  expect(result[1].ticks).toBeGreaterThan(5);
});

for (const kind of ['face', 'segment'] as const) for (const mode of ['throw', 'reject'] as const) {
  test(`${kind} Worker: ${mode} from the ready observer cannot spawn a fallback model or leak an exception`, async ({ page }) => {
    const errors: string[] = [];
    const workers: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('worker', worker => workers.push(worker.url()));
    const result = await page.evaluate(async ({ kind, mode }) => {
      const path = kind === 'face' ? '/apps/participant-web/js/precheck-analyzer/PrecheckAnalyzer.js?v=20261110-integration1'
        : '/apps/participant-web/js/face-segmenter/FaceSegmenter.js?v=20261110-integration1';
      const module = await import(path);
      const Analyzer = module.PrecheckAnalyzer || module.FaceSegmenter;
      const events: any[] = [];
      (window as any).WECOG_DEBUG = { enabled: true, log() {}, error: (...args: any[]) => {
        events.push(args); throw new Error('SYNTHETIC-PRIVATE-DIAGNOSTIC-SINK');
      } };
      let notifications = 0;
      const analyzer = new Analyzer({ onInitialized() {
        notifications++;
        if (mode === 'throw') throw new Error('SYNTHETIC-PRIVATE-INITIALIZED');
        return Promise.reject(new Error('SYNTHETIC-PRIVATE-INITIALIZED'));
      } });
      try {
        const ready = await analyzer.initialize();
        await Promise.resolve(); await Promise.resolve();
        return { ready, backend: analyzer.backend, notifications, allowed: analyzer.workerAllowed,
          fallback: analyzer.workerFallbackReason || null, initialized: analyzer.isInitialized, events };
      } finally { analyzer.dispose(); }
    }, { kind, mode });
    expect(result).toEqual({ ready: true, backend: 'worker', notifications: 1, allowed: true,
      fallback: null, initialized: true, events: [[kind, 'initialization:callback-failed', undefined]] });
    expect(workers).toHaveLength(1);
    expect(errors).toEqual([]);
    await expect.poll(() => page.workers().length).toBe(0);
  });
}

test('optional QC diagnostics preserve exact counters and summaries with disabled, enabled and throwing sinks', async ({ page }) => {
  const output = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/qc-metrics/index.js?v=20261110-integration1';
    const { QCMetrics } = await import(modulePath);
    const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
    const originalDateNow = Date.now, originalDebug = (window as any).WECOG_DEBUG;
    let time = 1000;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
    Date.now = () => 1700000000000 + time;
    const summaries: any[] = [], reports: any[] = [];
    try {
      for (const mode of ['off', 'on', 'throw']) {
        time = 1000;
        const events: any[] = [];
        (window as any).WECOG_DEBUG = { enabled: mode !== 'off', log: (...args: any[]) => {
          events.push(args); if (mode === 'throw') throw new Error('SYNTHETIC-PRIVATE-QC-SINK');
        } };
        const qc = new QCMetrics();
        try {
          qc.start({ useRealCameraFps: false });
          qc.setValidationData([{ gazeX: 10, gazeY: 10, targetX: 10, targetY: 10 },
            { gazeX: 20, gazeY: 20, targetX: 20, targetY: 20 },
            { gazeX: 30, gazeY: 30, targetX: 30, targetY: 30 }]);
          qc.setTrackingDeviationData([{ shapeX: 10, shapeY: 10, gazeX: 10, gazeY: 10 },
            { shapeX: 20, shapeY: 20, gazeX: 20, gazeY: 20 },
            { shapeX: 30, shapeY: 30, gazeX: 30, gazeY: 30 }]);
          for (let i = 0; i < 100; i++) {
            time += 50;
            qc.processFrame({ face: { detected: true, status: 'valid' }, pose: { status: 'stable' },
              eyes: { bothOpen: true }, illumination: { status: 'optimal' } }, { isComplete: true, score: 1 });
          }
          summaries.push({ counters: { ...qc._counters }, summary: qc.getSummary() });
        } finally { qc.stop(); }
        reports.push(events);
      }
      return { summaries, reports };
    } finally {
      Date.now = originalDateNow;
      if (originalNow) Object.defineProperty(performance, 'now', originalNow); else delete (performance as any).now;
      (window as any).WECOG_DEBUG = originalDebug;
    }
  });
  expect(output.summaries[0]).toEqual(output.summaries[1]);
  expect(output.summaries[0]).toEqual(output.summaries[2]);
  expect(output.reports[0]).toHaveLength(0);
  expect(output.reports[1].length).toBeGreaterThanOrEqual(3);
  expect(output.reports[2]).toEqual(output.reports[1]);
  expect(JSON.stringify(output.reports)).not.toContain('gazeX');
  expect(JSON.stringify(output.reports)).not.toContain('shapeX');
});
