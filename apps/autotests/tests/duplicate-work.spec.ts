import { test, expect } from '@playwright/test';

const entry = '/apps/participant-web/mvp_with_precheck_1-updated.html';
const root = '/apps/participant-web/js/';

test('participant startup loads one URL version of each module without starting sensors', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).sensorRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).sensorRequests++;
      throw new Error('Unexpected sensor request in module audit');
    };
  });
  await page.goto(entry);
  const result = await page.evaluate(async () => {
    await Promise.all(['PrecheckAnalyzerReady', 'FaceSegmenterReady', 'QCMetricsReady', 'GazeTrackerReady']
      .map(key => (window as any)[key]));
    const urls = new Map<string, Set<string>>();
    for (const resource of performance.getEntriesByType('resource')) {
      const url = new URL(resource.name);
      if (!url.pathname.startsWith('/apps/participant-web/js/') || !/\.m?js$/.test(url.pathname)
          || url.pathname.includes('/vendor/')) continue;
      if (!urls.has(url.pathname)) urls.set(url.pathname, new Set());
      urls.get(url.pathname)!.add(url.search);
    }
    return { modules: urls.size, duplicates: [...urls].filter(([, versions]) => versions.size > 1)
      .map(([path, versions]) => ({ path, versions: [...versions] })), requests: (window as any).sensorRequests };
  });
  console.log('module ownership audit:', JSON.stringify(result));
  expect(result.modules).toBeGreaterThan(30);
  expect(result.duplicates).toEqual([]);
  expect(result.requests).toBe(0);
});

test('concurrent precheck starts request one camera and release a cancelled late stream', async ({ page }) => {
  await page.goto(entry);
  const result = await page.evaluate(async root => {
    const module = await import(root + 'web-page/precheck-updated.js?v=20261110-integration1');
    const { state } = await import(root + 'web-page/state.js?v=20261025-1');
    let requests = 0, stopped = 0, release!: (stream: any) => void;
    navigator.mediaDevices.getUserMedia = () => { requests++; return new Promise(resolve => { release = resolve; }); };
    const first = module.startPreCheck(), second = module.startPreCheck(), third = module.startPreCheck();
    const shared = first === second && second === third;
    module.stopPreCheck();
    release({ getTracks: () => [{ stop() { stopped++; } }] });
    const outcomes = await Promise.all([first, second, third]);
    return { requests, stopped, shared, outcomes, running: state.flags.isPrecheckRunning, attached: !!state.runtime.cameraStream };
  }, root);
  expect(result).toEqual({ requests: 1, stopped: 1, shared: true, outcomes: [false, false, false], running: false, attached: false });
});

test('precheck has one loop and stale results cannot publish after stop/restart', async ({ page }) => {
  await page.goto(entry);
  const result = await page.evaluate(async root => {
    const module = await import(root + 'web-page/precheck-updated.js?v=20261110-integration1');
    const { state } = await import(root + 'web-page/state.js?v=20261025-1');
    const releases: Array<(frame: any) => void> = [];
    let analyses = 0, segmentations = 0;
    state.runtime.localAnalyzer = { reset() {}, analyzeFrame() {
      analyses++; return new Promise(resolve => releases.push(resolve));
    } };
    state.runtime.faceSegmenter = { segmentFrame: async () => { segmentations++; return {}; } };
    state.runtime.precheckData = { preserved: true };
    for (let i = 0; i < 50; i++) module.startContinuousAnalysis();
    const firstAnalyses = analyses;
    module.stopPreCheck(); module.startContinuousAnalysis();
    releases[0]({ landmarks: [] });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const history = state.runtime.precheckFramesHistory.length, preserved = state.runtime.precheckData.preserved;
    module.stopPreCheck(); releases[1]({ landmarks: [] });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    return { firstAnalyses, analyses, segmentations, history, preserved, running: state.flags.isPrecheckRunning,
      timerReleased: state.runtime.analysisFrameId == null };
  }, root);
  expect(result).toEqual({ firstAnalyses: 1, analyses: 2, segmentations: 0, history: 0, preserved: true, running: false, timerReleased: true });
});

test('calibration preparation is single-flight and a failed preparation permits retry', async ({ page }) => {
  await page.goto(entry);
  const result = await page.evaluate(async root => {
    const module = await import(root + 'web-page/tests-updated.js?v=20261112-emotion2');
    const { state } = await import(root + 'web-page/state.js?v=20261025-1');
    state.sessionData.precheck = { pass_fail: true };
    const original = (window as any).QCMetricsReady;
    let reject!: (error: Error) => void;
    const starts = () => state.sessionData.events.filter((event: any) => event.type === 'calibration_start').length;
    const before = starts();
    try {
      (window as any).QCMetricsReady = new Promise((_yes, no) => { reject = no; });
      const first = module.startCalibration(), second = module.startCalibration(), third = module.startCalibration();
      const shared = first === second && second === third;
      reject(new Error('Synthetic preparation failure'));
      const outcomes = (await Promise.allSettled([first, second, third])).map(item => item.status);
      const firstStarts = starts() - before;
      (window as any).QCMetricsReady = new Promise((_yes, no) => { reject = no; });
      const retry = module.startCalibration(), newPromise = retry !== first;
      reject(new Error('Synthetic retry failure')); await Promise.allSettled([retry]);
      return { shared, outcomes, firstStarts, totalStarts: starts() - before, newPromise };
    } finally { (window as any).QCMetricsReady = original; }
  }, root);
  expect(result).toEqual({ shared: true, outcomes: ['rejected', 'rejected', 'rejected'], firstStarts: 1, totalStarts: 2, newPromise: true });
});

test('precheck relinquishes analysis ownership without resetting the continuous analyzer', async ({ page }) => {
  await page.goto(entry);
  const result = await page.evaluate(async root => {
    const module = await import(root + 'web-page/precheck-updated.js?v=20261110-integration1');
    const { state } = await import(root + 'web-page/state.js?v=20261025-1');
    const runtime = state.runtime.sessionRuntime;
    const original = runtime.isAnalysisRunning;
    let release!: (frame: any) => void, entered!: () => void, resets = 0, continuous = false;
    const started = new Promise<void>(resolve => { entered = resolve; });
    runtime.isAnalysisRunning = () => continuous;
    state.runtime.localAnalyzer = { reset() { resets++; }, analyzeFrame: () => new Promise(resolve => { release = resolve; entered(); }) };
    state.runtime.faceSegmenter = { segmentFrame: async () => ({}) };
    try {
      module.startContinuousAnalysis(); await started; continuous = true; release({ landmarks: [] });
      for (let i = 0; i < 12; i++) await Promise.resolve();
      const running = state.flags.isPrecheckRunning;
      module.stopPreCheck();
      return { running, resets, history: state.runtime.precheckFramesHistory.length, timerReleased: state.runtime.analysisFrameId == null };
    } finally { runtime.isAnalysisRunning = original; }
  }, root);
  expect(result).toEqual({ running: false, resets: 0, history: 0, timerReleased: true });
});

test('precheck history does not keep WeakMap pixel buffers through historical frame keys', async ({ page }) => {
  await page.goto(entry);
  const result = await page.evaluate(async root => {
    const module = await import(root + 'web-page/precheck-updated.js?v=20261110-integration1');
    const { state } = await import(root + 'web-page/state.js?v=20261025-1');
    const pixels = await import(root + 'session-runtime/frame-pixels.mjs');
    const frame = { timestamp: 1, landmarks: [], face: { detected: false }, illumination: { value: 0 }, pose: {} };
    const image = new ImageData(8, 8); pixels.rememberFramePixels(frame, image);
    state.runtime.localAnalyzer = { reset() {}, analyzeFrame: async () => frame };
    state.runtime.faceSegmenter = { segmentFrame: async () => ({ isComplete: false, faceVisibility: {} }) };
    module.startContinuousAnalysis();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    module.stopPreCheck(); const history = state.runtime.precheckFramesHistory;
    return { count: history.length, copied: history[0] !== frame, sameTimestamp: history[0]?.timestamp === frame.timestamp,
      historyPixels: !!pixels.getFramePixels(history[0]), originalPixels: pixels.getFramePixels(frame) === image,
      timerReleased: state.runtime.analysisFrameId == null };
  }, root);
  expect(result).toEqual({ count: 1, copied: true, sameTimestamp: true, historyPixels: false, originalPixels: true, timerReleased: true });
});

for (const readiness of [0, 1]) test(`stopping precheck at readyState ${readiness} releases setup listeners and FPS callbacks`, async ({ page }) => {
  await page.goto(entry);
  const result = await page.evaluate(async ({ root, readiness }) => {
    const module = await import(root + 'web-page/precheck-updated.js?v=20261110-integration1');
    const video = document.getElementById('precheckVideo') as HTMLVideoElement;
    let stopped = 0, callbackId = 0;
    const callbacks = new Map<number, VideoFrameRequestCallback>(), handlers = new Set<any>(), timers = new Set<number>();
    const originalSet = window.setTimeout.bind(window), originalClear = window.clearTimeout.bind(window);
    const add = video.addEventListener.bind(video), remove = video.removeEventListener.bind(video);
    video.addEventListener = ((type: string, handler: any, options?: any) => { handlers.add(handler); add(type, handler, options); }) as any;
    video.removeEventListener = ((type: string, handler: any, options?: any) => { handlers.delete(handler); remove(type, handler, options); }) as any;
    window.setTimeout = ((callback: any, delay?: number, ...args: any[]) => {
      const id = originalSet(callback, delay, ...args); if (delay === 15000 || delay === 2000) timers.add(id); return id;
    }) as any;
    window.clearTimeout = ((id?: number) => { timers.delete(id!); originalClear(id); }) as any;
    Object.defineProperties(video, { srcObject: { configurable: true, writable: true, value: null },
      readyState: { configurable: true, value: readiness }, videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 } });
    video.play = async () => {};
    video.requestVideoFrameCallback = callback => { callbacks.set(callbackId, callback); return callbackId++; };
    video.cancelVideoFrameCallback = id => { callbacks.delete(id); };
    const track = { stop() { stopped++; }, getSettings: () => ({ width: 640, height: 480, frameRate: 30 }) };
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [track], getVideoTracks: () => [track] } as any);
    try {
      const pending = module.startPreCheck();
      for (let i = 0; i < 12; i++) await Promise.resolve();
      const sampling = callbacks.size;
      module.stopPreCheck(); const outcome = await pending;
      video.dispatchEvent(new Event('loadedmetadata'));
      return { outcome, stopped, sampling, callbacks: callbacks.size, handlers: handlers.size, timers: timers.size, attached: !!video.srcObject };
    } finally { module.stopPreCheck(); window.setTimeout = originalSet; window.clearTimeout = originalClear; }
  }, { root, readiness });
  expect(result).toEqual({ outcome: false, stopped: 1, sampling: readiness ? 1 : 0, callbacks: 0, handlers: 0, timers: 0, attached: false });
});

test('successful precheck reuses its camera and starts only one analysis loop', async ({ page }) => {
  await page.goto(entry);
  const result = await page.evaluate(async root => {
    const module = await import(root + 'web-page/precheck-updated.js?v=20261110-integration1');
    const { state } = await import(root + 'web-page/state.js?v=20261025-1');
    const video = document.getElementById('precheckVideo') as HTMLVideoElement;
    let requests = 0, stopped = 0, analyses = 0, callback: VideoFrameRequestCallback | null = null;
    const frameReleases: Array<(frame: any) => void> = [];
    Object.defineProperties(video, { srcObject: { configurable: true, writable: true, value: null },
      readyState: { configurable: true, value: 2 }, videoWidth: { configurable: true, value: 640 }, videoHeight: { configurable: true, value: 480 } });
    video.play = async () => {};
    video.requestVideoFrameCallback = fn => { callback = fn; return 0; };
    video.cancelVideoFrameCallback = () => { callback = null; };
    const track = { stop() { stopped++; }, getSettings: () => ({ width: 640, height: 480, frameRate: 30 }) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    navigator.mediaDevices.getUserMedia = async () => { requests++; return stream as any; };
    state.runtime.localAnalyzer = { reset() {}, analyzeFrame() { analyses++; return new Promise(resolve => frameReleases.push(resolve)); } };
    const outcome = await module.startPreCheck();
    const again = await module.startPreCheck();
    module.stopPreCheck();
    frameReleases[0]({}); for (let i = 0; i < 12; i++) await Promise.resolve();
    const reusedStream = video.srcObject === stream as any && state.runtime.cameraStream === stream;
    const result = { outcome, again, requests, analyses, stopped, reusedStream, callbacksReleased: callback === null };
    track.stop(); video.srcObject = null; state.runtime.cameraStream = null;
    return result;
  }, root);
  expect(result).toEqual({ outcome: true, again: true, requests: 1, analyses: 1, stopped: 0, reusedStream: true, callbacksReleased: true });
});

test('legacy gaze cannot fork after restart and hands over without clearing continuous gaze', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async root => {
    const { state } = await import(root + 'web-page/state.js?v=20261025-1');
    const loop = await import(root + 'gaze-tracker/gaze-tests/common/analysis-loop.js?v=20261112-emotion2');
    const video = document.createElement('video'); video.id = 'precheckVideo'; document.body.appendChild(video);
    Object.defineProperties(video, { srcObject: { value: {} }, readyState: { value: 2 }, currentTime: { value: 1 } });
    let continuous = false, updates = 0, resets = 0;
    const pending: Array<(frame: any) => void> = [], timers = new Set<number>();
    state.runtime.sessionRuntime = { isAnalysisRunning: () => continuous };
    state.runtime.localAnalyzer = { analyzeFrame: () => new Promise(resolve => pending.push(resolve)) };
    state.runtime.gazeTracker = { isCalibrated: () => true, predict: () => ({ x: 1, y: 2 }), resetSmoothingState() { resets++; } };
    (window as any).handleGazeUpdate = () => { updates++; };
    const originalSet = window.setTimeout.bind(window), originalClear = window.clearTimeout.bind(window);
    window.setTimeout = ((callback: any, delay?: number) => {
      const id = originalSet(() => { timers.delete(id); callback(); }, delay); timers.add(id); return id;
    }) as any;
    window.clearTimeout = ((id?: number) => { timers.delete(id!); originalClear(id); }) as any;
    try {
      loop.startGazeTestsAnalysisLoop(); await new Promise(resolve => originalSet(resolve, 20));
      loop.stopGazeTestsAnalysisLoop(); loop.startGazeTestsAnalysisLoop();
      pending[0]({ landmarks: [] }); for (let i = 0; i < 12; i++) await Promise.resolve();
      const staleUpdates = updates, restartTimers = timers.size;
      await new Promise(resolve => originalSet(resolve, 20));
      pending[1]({ landmarks: [] }); for (let i = 0; i < 12; i++) await Promise.resolve();
      const currentUpdates = updates, currentTimers = timers.size;
      state.runtime.currentGaze = { x: 900, y: 800 }; const beforeHandoff = resets;
      continuous = true; await new Promise(resolve => originalSet(resolve, 50));
      return { staleUpdates, restartTimers, currentUpdates, currentTimers, running: loop.isGazeTestsAnalysisLoopRunning(),
        timers: timers.size, handoffResets: resets - beforeHandoff, gaze: state.runtime.currentGaze };
    } finally { loop.stopGazeTestsAnalysisLoop(); window.setTimeout = originalSet; window.clearTimeout = originalClear; }
  }, root);
  expect(result).toEqual({ staleUpdates: 0, restartTimers: 1, currentUpdates: 1, currentTimers: 1,
    running: false, timers: 0, handoffResets: 0, gaze: { x: 900, y: 800 } });
});
