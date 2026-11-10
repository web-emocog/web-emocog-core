import { expect, test } from '@playwright/test';

const root = '/apps/participant-web/js/';
const loaders = [
  ['precheck-analyzer', 'PrecheckAnalyzer'],
  ['face-segmenter', 'FaceSegmenter'],
  ['qc-metrics', 'QCMetrics'],
  ['gaze-tracker', 'GazeTracker'],
] as const;

test.use({ permissions: [], trace: 'off', screenshot: 'off', video: 'off' });

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
});

test('participant page loads canonical classes without the retired face mask collector', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', req => requests.push(new URL(req.url()).pathname));
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  const result = await page.evaluate(async names => {
    const w = window as any;
    return Promise.all(names.map(async name => ({ kind: await w[name + 'Ready'], name: w[name].name })));
  }, loaders.map(([, name]) => name));
  expect(result).toEqual(loaders.map(([, name]) => ({ kind: 'module', name })));
  expect(requests.some(url => url.endsWith('/face-mask-collector.js'))).toBe(false);
});

for (const diagnosticMode of ['disabled', 'enabled', 'throws', 'unavailable']) {
  test(`classic model import failure stays recoverable with diagnostics ${diagnosticMode}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    for (const [file] of loaders) await page.route(`**/${file}/index.js*`, route => route.abort());
    if (diagnosticMode === 'unavailable') {
      await page.route('**/participant-diagnostic.mjs*', route => route.abort());
    }
    await page.goto('/apps/participant-web/tools/session-report.html');
    await page.evaluate(mode => {
      const w = window as any;
      w.classicModelEvents = [];
      w.WECOG_DEBUG = { enabled: mode !== 'disabled', error(...args: unknown[]) {
        w.classicModelEvents.push(args);
        if (mode === 'throws') throw new Error('SYNTHETIC-PRIVATE-SINK');
      } };
    }, diagnosticMode);
    for (const [file] of loaders) await page.addScriptTag({ url: root + file + '.js?v=20261110-integration1' });
    const hasDiagnostics = ['enabled', 'throws'].includes(diagnosticMode);
    if (hasDiagnostics) {
      await expect.poll(() => page.evaluate(() => (window as any).classicModelEvents.length)).toBe(4);
    }
    const result = await page.evaluate(async names => {
      const w = window as any;
      const kinds = await Promise.all(names.map(name => w[name + 'Ready']));
      w.FilesetResolver = { forVisionTasks: async () => ({}) };
      const initCalls = [0, 0], closed = [0, 0];
      let available = false;
      const newModel = (index: number) => async () => {
        initCalls[index]++;
        if (!available) throw new Error('SYNTHETIC-PRIVATE-INIT');
        return { close() { closed[index]++; },
          detectForVideo() { throw new Error('SYNTHETIC-PRIVATE-INFERENCE'); },
          segmentForVideo() { throw new Error('SYNTHETIC-PRIVATE-INFERENCE'); } };
      };
      w.FaceLandmarker = { createFromOptions: newModel(0) };
      w.ImageSegmenter = { createFromOptions: newModel(1) };
      let readyObservers = 0, errorObservers = 0;
      const options = {
        onInitialized() { readyObservers++; throw new Error('SYNTHETIC-PRIVATE-READY-OBSERVER'); },
        onError() { errorObservers++; return Promise.reject(new Error('SYNTHETIC-PRIVATE-ERROR-OBSERVER')); },
      };
      const face = new w.PrecheckAnalyzer(options), segment = new w.FaceSegmenter(options);
      const source = document.createElement('canvas');
      source.width = source.height = 2;
      const sample = async () => Promise.all([face.analyzeFrame(source), segment.segmentFrame(source)]);
      const errors = new Set();
      for (const pair of await Promise.all(Array.from({ length: 10 }, sample))) {
        for (const result of pair) errors.add(result.error);
      }
      for (let i = 0; i < 20; i++) for (const result of await sample()) errors.add(result.error);
      const failureCalls = [...initCalls];
      face.reset(); segment.reset(); available = true;
      const ready = await Promise.all([face.initialize(), segment.initialize()]);
      for (let i = 0; i < 20; i++) for (const result of await sample()) errors.add(result.error);
      face.dispose(); segment.dispose();
      const qc = new w.QCMetrics();
      qc.start();
      const qcRunning = qc.isRunning();
      qc.stop();
      let gazeUnavailable = false;
      try { new w.GazeTracker(); } catch (error) {
        gazeUnavailable = (error as Error).message === 'GazeTracker module is unavailable';
      }
      return { kinds, failureCalls, initCalls, closed, ready, readyObservers, errorObservers,
        errors: [...errors].sort(), qcRunning, gazeUnavailable, events: w.classicModelEvents };
    }, loaders.map(([, name]) => name));
    expect(result).toMatchObject({
      kinds: ['inline', 'inline', 'inline', 'unavailable'], failureCalls: [1, 1], initCalls: [2, 2],
      closed: [1, 1], ready: [true, true], readyObservers: 2, errorObservers: 2,
      errors: ['face_inference_failed', 'face_model_unavailable', 'segment_inference_failed', 'segment_model_unavailable'],
      qcRunning: true, gazeUnavailable: true,
    });
    expect(result.events).toHaveLength(hasDiagnostics ? 12 : 0);
    expect(new Set(result.events.map((event: unknown[]) => JSON.stringify(event))).size).toBe(result.events.length);
    expect(JSON.stringify(result.events)).not.toContain('SYNTHETIC-PRIVATE');
    expect(pageErrors).toEqual([]);
  });
}

test('a model that resolves after disposal is closed and cannot overwrite a new model', async ({ page }) => {
  for (const [file] of loaders.slice(0, 2)) await page.route(`**/${file}/index.js*`, route => route.abort());
  await page.goto('/apps/participant-web/tools/session-report.html');
  for (const [file] of loaders.slice(0, 2)) await page.addScriptTag({ url: root + file + '.js?v=20261110-integration1' });
  const result = await page.evaluate(async () => {
    const w = window as any;
    await Promise.all([w.PrecheckAnalyzerReady, w.FaceSegmenterReady]);
    w.FilesetResolver = { forVisionTasks: async () => ({}) };
    const runs = [];
    for (const [name, factory] of [['PrecheckAnalyzer', 'FaceLandmarker'], ['FaceSegmenter', 'ImageSegmenter']]) {
      let ready = 0, calls = 0, staleClosed = 0, freshClosed = 0;
      let releaseStale!: () => void, markStarted!: () => void;
      const started = new Promise<void>(resolve => { markStarted = resolve; });
      const stale = { close() { staleClosed++; } }, fresh = { close() { freshClosed++; } };
      w[factory] = { createFromOptions: async () => {
        if (++calls !== 1) return fresh;
        return new Promise(resolve => { releaseStale = () => resolve(stale); markStarted(); });
      } };
      const model = new w[name]({ onInitialized() { ready++; } });
      const first = model.initialize();
      await started;
      model.dispose();
      const second = await model.initialize();
      releaseStale();
      const firstResult = await first;
      const stillReady = model.isInitialized;
      model.dispose();
      runs.push({ ready, calls, staleClosed, freshClosed, second, firstResult, stillReady });
    }
    return runs;
  });
  expect(result).toEqual(Array(2).fill({
    ready: 1, calls: 2, staleClosed: 1, freshClosed: 1, second: true, firstResult: false, stillReady: true,
  }));
});
