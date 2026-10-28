import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test.use({ permissions: [], trace: 'off', screenshot: 'off', video: 'off' });
test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
});

for (const outside of [0, 2, 4, 5]) {
  test(`precheck accepts the same open face with outside class ${outside}; real in-face occlusion still blocks calibration`, async ({ page }) => {
    await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
    const result = await page.evaluate(async outside => {
      const root = '/apps/participant-web/js/';
      const fixturePath = '/apps/autotests/tests/fixtures/face-visibility.mjs';
      const { faceVisibilityFixture } = await import(fixturePath);
      const { analyzeMasks } = await import(root + 'face-segmenter/mask-analyzer.js?v=20261028-139');
      const { analyzeFaceRegionsVisibility } = await import(root + 'face-segmenter/region-analyzer.js?v=20261028-139');
      const { DEFAULT_THRESHOLDS } = await import(root + 'face-segmenter/thresholds.js');
      const precheck = await import(root + 'web-page/precheck-updated.js?v=20261025-1');
      const state = (window as any).__WECOG_STATE__;
      const one = (input: any) => {
        const mask = analyzeMasks(input, input.width, input.height, input.landmarks);
        const visibility = analyzeFaceRegionsVisibility(mask, input.landmarks, input.width, input.height, DEFAULT_THRESHOLDS);
        state.currentLang = 'ru';
        state.runtime.precheckData = { face: { detected: true, bbox: { height: .3 } },
          pose: { status: 'stable' }, visibility };
        state.runtime.successFrames = 1000;
        state.indicatorsStatus = { illumination: 'passed', face: 'passed', pose: 'passed', visibility: 'pending' };
        precheck.updateVisibilityIndicator(visibility); precheck.checkAllIndicators();
        return { passed: state.sessionData.precheck.pass_fail,
          buttonDisabled: (document.getElementById('startCalibBtn') as HTMLButtonElement).disabled,
          visibility: state.indicatorsStatus.visibility, reason: state.sessionData.precheck.fail_reason,
          issues: visibility.issues, method: visibility.method };
      };
      const good = one(faceVisibilityFixture({ outside }));
      const hand = one(faceVisibilityFixture({ outside, inside: 2 }));
      const missing = faceVisibilityFixture({ outside }); missing.landmarks = null;
      const unknown = one(missing);
      const recovery = one(faceVisibilityFixture({ outside }));
      return { good, hand, unknown, recovery };
    }, outside);
    expect(result.good).toMatchObject({ passed: true, buttonDisabled: false, visibility: 'passed', reason: null,
      issues: [], method: 'face_oval_regions.v1' });
    expect(result.recovery).toEqual(result.good);
    expect(result.hand).toMatchObject({ passed: false, buttonDisabled: true, visibility: 'failed', reason: 'visibility' });
    expect(result.hand.issues).toContain('left_eye_hand_occluded');
    expect(result.unknown).toMatchObject({ passed: false, buttonDisabled: true, issues: ['face_region_unavailable'] });
  });
}

test('real Worker messaging uses face-local mask evidence without sending its raw mask back to UI', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  const workerBase = baseURL + '/apps/participant-web/js/session-runtime/vision-worker.js';
  // Firefox does not consistently intercept worker subresource requests via page.route.
  // Run the production worker body, replacing only native inference and resolving its import URLs.
  const workerSource = readFileSync(path.resolve(__dirname, '../../participant-web/js/session-runtime/vision-worker.js'), 'utf8')
    .replace(/import\('([^']+)'\)/g, (_match, file) => `import(${JSON.stringify(file.includes('vision_bundle.mjs')
      ? baseURL + '/apps/autotests/tests/fixtures/vision-mask-runtime.mjs' : new URL(file, workerBase).href)})`);
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async workerSource => {
    const NativeWorker = window.Worker;
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const requested: string[] = [];
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) { requested.push(String(url)); super(workerUrl, options); }
    };
    const modulePath = '/apps/participant-web/js/face-segmenter/FaceSegmenter.js?v=20261028-139';
    const fixturePath = '/apps/autotests/tests/fixtures/face-visibility.mjs';
    const { FaceSegmenter } = await import(modulePath);
    const { faceVisibilityFixture } = await import(fixturePath);
    const fixture = faceVisibilityFixture(), canvas = document.createElement('canvas');
    canvas.width = fixture.width; canvas.height = fixture.height;
    const segmenter = new FaceSegmenter();
    try {
      const ready = await segmenter.initialize();
      const result = await segmenter.segmentFrame(canvas, fixture.landmarks, 100);
      return { ready, backend: segmenter.backend, raw: result.maskAnalysis?._rawMaskData,
        complete: result.isComplete, issues: result.issues, method: result.faceVisibility?.method,
        sampling: result.maskAnalysis?.faceRegion?.sampling, error: result.error || null, requested };
    } finally { segmenter.dispose(); window.Worker = NativeWorker; URL.revokeObjectURL(workerUrl); }
  }, workerSource);
  expect(result).toMatchObject({ ready: true, backend: 'worker', raw: null, complete: true, issues: [],
    method: 'face_oval_regions.v1', sampling: { method: 'face_oval_pixels.v1', inFrame: true }, error: null });
  expect(result.requested.some((url: string) => url.includes('vision-worker.js?v=20261028-139'))).toBe(true);
  expect(requests.some(url => url.includes('region-analyzer.js?v=20261028-139'))).toBe(true);
});

test('folder-loader failure uses the same corrected analysis in inline fallback, not the old global hand heuristic', async ({ page }) => {
  await page.route('**/face-segmenter/index.js*', route => route.abort());
  await page.goto('/apps/participant-web/tools/session-report.html');
  await page.addScriptTag({ url: '/apps/participant-web/js/face-segmenter.js?v=20261028-139' });
  const result = await page.evaluate(async () => {
    const w = window as any;
    const fixturePath = '/apps/autotests/tests/fixtures/face-visibility.mjs';
    const { faceVisibilityFixture } = await import(fixturePath);
    const fixture = faceVisibilityFixture(); let closed = 0;
    fixture.categoryMask.close = () => { closed++; };
    const kind = await w.FaceSegmenterReady;
    w.FilesetResolver = { forVisionTasks: async () => ({}) };
    w.ImageSegmenter = { createFromOptions: async () => ({ segmentForVideo: () => fixture, close() {} }) };
    const segmenter = new w.FaceSegmenter();
    try {
      const result = await segmenter.segmentFrame({ readyState: 2, videoWidth: fixture.width, videoHeight: fixture.height }, fixture.landmarks);
      return { kind, complete: result.isComplete, method: result.faceVisibility?.method, issues: result.issues, closed };
    } finally { segmenter.dispose(); }
  });
  expect(result).toEqual({ kind: 'inline', complete: true, method: 'face_oval_regions.v1', issues: [], closed: 1 });
});
