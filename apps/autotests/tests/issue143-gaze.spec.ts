import { test, expect, type Page } from '@playwright/test';
import { landmarksForGaze } from '../../api/tests/fixtures/gaze-topology';
import { installGazeAccess } from '../fixtures/gaze-benchmark-auth';

const manualModes = ['', 'ablation', 'axis', 'appearance', 'gradient', 'gradient-temporal', 'gradient-pose', 'tophat', 'tophat-pose', 'masked-temporal', 'lid-support', 'nuisance', 'nuisance-gate', 'nuisance-geometry'];
const manualUrl = (mode: string) => '/apps/autotests/manual/issue143-gaze.html'
  + (mode === 'tophat-pose' ? '?models=tophat&pose=1' : mode.startsWith('gradient-pose') ? '?models=gradient&pose=1'
    : mode === 'gradient-temporal' ? '?models=gradient&temporal=1' : mode.startsWith('masked-') ? '?models=masked&temporal=1'
      : mode.startsWith('nuisance-geometry') ? '?models=nuisance-geometry' : mode.startsWith('nuisance-gate') ? '?models=nuisance-gate'
        : mode.startsWith('nuisance') ? '?models=nuisance' : mode.startsWith('aoi-continuous') ? '?models=aoi-continuous' : mode ? '?models=' + mode : '');

async function openProductionCalibration(page: Page, beforeStart?: () => Promise<void>) {
  await page.clock.install({ time: new Date('2026-11-06T12:00:00Z') });
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.sessionRuntime);
  await beforeStart?.();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(async landmarks => {
    await (window as any).GazeTrackerReady;
    const state = (window as any).__WECOG_STATE__;
    state.sessionData.precheck = { pass_fail: true };
    state.runtime.localAnalyzer = {};
    state.runtime.sessionRuntime.startContinuousModules = async () => true;
    state.runtime.sessionRuntime.isAnalysisRunning = () => true;
    (window as any).captureFixtureTimer = setInterval(() => {
      state.runtime.lastPrecheckResult = { timestamp: performance.now(), landmarks,
        eyes: { bothOpen: !(window as any).rejectCalibrationFrames }, pose: { status: 'stable', yaw: 0, pitch: 0, roll: 0 } };
    }, 33);
    const moduleUrl = '/apps/participant-web/js/web-page/tests-updated.js?v=20261110-integration1';
    const module = await import(moduleUrl);
    (window as any).calibrationPrepared = module.startCalibration();
  }, landmarksForGaze(0, 0));
  await expect(page.locator('#calibrationIntro')).toBeVisible();
}

async function acknowledgeProductionCalibration(page: Page) {
  await page.locator('#calibrationIntroStartBtn').evaluate((button: HTMLElement) => button.click());
  await expect(page.locator('#fullscreenCalibPoint')).toBeVisible();
}

test('production calibration counts two fresh click captures and ignores a queued double-click', async ({ page }) => {
  await openProductionCalibration(page);
  await acknowledgeProductionCalibration(page);
  const before = await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => [point.style.left, point.style.top]);
  await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => { point.click(); point.click(); });
  await page.clock.runFor(1200);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(1);
  await expect(page.locator('#calibProgressText')).toContainText('(1/2)');
  expect(await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => [point.style.left, point.style.top])).toEqual(before);
  await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => point.click());
  await page.clock.runFor(1200);
  await expect(page.locator('#calibProgressText')).toContainText('(0/2)');
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(2);
  // An in-flight capture must not publish training/UI into a later phase.
  await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => point.click());
  await page.evaluate(() => { (window as any).__WECOG_STATE__.runtime.currentPhase = 'instruction'; });
  await page.clock.runFor(2200);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(2);
  await page.evaluate(() => clearInterval((window as any).captureFixtureTimer));
});

test('production calibration accepts the first point after a native classic scrollbar disappears', async ({ playwright, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'Requires native classic scrollbars in Chromium');
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--disable-features=OverlayScrollbar,OverlayScrollbars'] });
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1536, height: 826 }, deviceScaleFactor: 1.25 });
    await openProductionCalibration(page, async () => {
      await page.addStyleTag({ content: '::-webkit-scrollbar { width: 15px } .container { min-height: 1800px }' });
      expect(await page.evaluate(() => innerWidth - visualViewport!.width)).toBeGreaterThan(0);
    });
    await acknowledgeProductionCalibration(page);
    expect(await page.evaluate(() => {
      const tracker = (window as any).__WECOG_STATE__.runtime.gazeTracker;
      return [visualViewport!.width, tracker.getStatus().screenSize.width];
    })).toEqual([1536, 1536]);
    const point = page.locator('#fullscreenCalibPoint');
    const box = (await point.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(point).toHaveCSS('opacity', '0.5');
    await page.clock.runFor(1200);
    await expect(page.locator('#calibProgressText')).toContainText('(1/2)');
    await point.evaluate((el: HTMLElement) => el.click());
    await page.clock.runFor(1200);
    await expect(page.locator('#calibProgressText')).toContainText('(0/2)');
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(2);
  } finally { await browser.close(); }
});

test('production calibration explains a real viewport resize and discards only the interrupted calibration', async ({ page }) => {
  await openProductionCalibration(page);
  await acknowledgeProductionCalibration(page);
  const point = page.locator('#fullscreenCalibPoint');
  await page.evaluate(() => {
    const shared = (window as any).__WECOG_STATE__;
    (window as any).trackerBeforeResize = shared.runtime.gazeTracker;
    window.dispatchEvent(new Event('resize')); // late event with unchanged geometry
  });
  await point.evaluate((el: HTMLElement) => el.click());
  await page.clock.runFor(1200);
  await expect(page.locator('#calibProgressText')).toContainText('(1/2)');
  await point.evaluate((el: HTMLElement) => el.click()); // interrupt this capture
  await page.setViewportSize({ width: 1010, height: 760 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect(page.locator('#calibrationIntro')).toBeVisible();
  await expect(page.locator('#calibrationIntroText')).toContainText(/масштаб изменился|zoom changed/i);
  await expect(point).toBeHidden();
  await page.clock.runFor(2200);
  expect(await page.evaluate(() => {
    const w = window as any, shared = w.__WECOG_STATE__;
    return [w.trackerBeforeResize.getStatus().calibrationPoints, shared.runtime.gazeTracker.getStatus().calibrationPoints,
      shared.sessionData.events.filter((e: any) => e.type === 'calibration_viewport_changed').length];
  })).toEqual([1, 0, 1]);
  await acknowledgeProductionCalibration(page);
  await point.evaluate((el: HTMLElement) => el.click());
  await page.clock.runFor(1200);
  await expect(page.locator('#calibProgressText')).toContainText('(1/2)');
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().screenSize)).toEqual({ width: 1010, height: 760 });
});

test('production calibration explains an insufficient capture and lets the participant retry the same click', async ({ page }) => {
  await openProductionCalibration(page);
  await acknowledgeProductionCalibration(page);
  const point = page.locator('#fullscreenCalibPoint');
  await page.evaluate(() => { (window as any).rejectCalibrationFrames = true; });
  await point.evaluate((el: HTMLElement) => el.click());
  await page.clock.runFor(2200);
  await expect(page.locator('#calibInstructionText')).toContainText(/Не хватило подходящих кадров|not enough usable frames/);
  await expect(page.locator('#calibProgressText')).toContainText('(0/2)');
  await expect(point).toHaveCSS('opacity', '1');
  await page.evaluate(() => { (window as any).rejectCalibrationFrames = false; });
  await point.evaluate((el: HTMLElement) => el.click());
  await page.clock.runFor(1200);
  await expect(page.locator('#calibProgressText')).toContainText('(1/2)');
  await expect(page.locator('#calibInstructionText')).not.toContainText(/Не хватило подходящих кадров|not enough usable frames/);
});

test('developer eye-gate probe exports three conditions, controlled cues and bounded failures', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'Virtual-clock complete diagnostic in WebKit');
  await installGazeAccess(page);
  const writes: string[] = [];
  page.on('request', req => { if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) writes.push(req.url()); });
  await page.clock.install({ time: new Date('2026-11-10T12:00:00Z') });
  await page.addInitScript(landmarks => {
    const w = window as any;
    w.eyeGateLandmarks = landmarks; w.eyeGateStops = 0; w.eyeGateCameraRequests = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      w.eyeGateCameraRequests++;
      return { getTracks: () => [{ addEventListener() {}, stop() { w.eyeGateStops++; } }] };
    } } });
    Object.defineProperties(HTMLVideoElement.prototype, {
      srcObject: { configurable: true, get() { return (this as any).testStream; }, set(stream) { (this as any).testStream = stream; } },
      videoWidth: { configurable: true, get: () => 640 }, videoHeight: { configurable: true, get: () => 480 }
    });
    HTMLVideoElement.prototype.play = async () => {};
  }, landmarksForGaze(0, 0));
  await page.route('**/precheck-analyzer/PrecheckAnalyzer.js?*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export default class Analyzer {
      backend = 'synthetic_oracle'; async initialize() { return true; } dispose() {}
      async analyzeFrame() {
        const closed = window.eyeGateReject || document.getElementById('status').textContent.includes('Мягко закройте');
        return { timestamp: performance.now(), wallTimestamp: Date.now(), landmarks: window.eyeGateLandmarks,
          eyes: { bothOpen: !closed, left: { ear: closed ? .17 : .24, isOpen: !closed } },
          pose: { status: 'stable' }, blendShapes: { eyeBlinkLeft: closed ? .8 : .01, unused: 'PRIVATE_SENTINEL' } };
      }
    }` }));
  await page.route('**/session-runtime/video-frames.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export function observeVideoFrames(video, callback) {
      const id = setInterval(() => callback(performance.now()), 33);
      return { stop() { clearInterval(id); } };
    }` }));
  await page.goto('/apps/participant-web/tools/gaze-benchmark.html?protocol=eye-gate');
  await expect(page.locator('#status')).toContainText('Доступ подтверждён');
  await expect(page.locator('#start')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).eyeGateCameraRequests)).toBe(0);
  await page.locator('#consent').check();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const click = (selector: string) => page.locator(selector).evaluate((el: HTMLElement) => el.click());
  await click('#start');
  await expect(page.locator('#calibrate')).toHaveText('Начать диагностику глаз');
  await expect(page.locator('#calibrate')).toBeVisible();
  await click('#calibrate');
  await expect(page.locator('#poseContinue')).toBeVisible();
  await click('#poseContinue');
  await page.clock.runFor(30000);
  for (let condition = 0; condition < 3; condition++) {
    await expect(page.locator('#poseContinue')).toBeVisible();
    await click('#poseContinue');
    for (let slot = 0; slot < 18; slot++) {
      if (condition === 2 && slot === 0) {
        await page.evaluate(() => { (window as any).eyeGateReject = true; });
        for (let repeat = 0; repeat < 2; repeat++) { await click('#target'); await page.clock.runFor(2100); }
        await page.evaluate(() => { (window as any).eyeGateReject = false; });
      } else {
        await click('#target');
        await page.clock.runFor(1000);
      }
    }
  }
  await expect(page.locator('#download')).toBeVisible();
  await expect(page.locator('#target')).toBeHidden();
  const text = (await page.locator('#result').textContent())!;
  const report = JSON.parse(text);
  expect(report.benchmark).toMatchObject({ protocol: 'eye-gate.v1', completed: true, diagnosticSurface: 'developer_panel',
    counters: { calibrationAttempts: 55, calibrationAccepted: 53 } });
  expect(report.eyeGate.scheduledClickSlots).toBe(54);
  expect(report.eyeGate.cues.reduce((ms: number, cue: any) => ms + cue.durationMs, 0)).toBe(30000);
  const closed = report.eyeGate.cues.find((cue: any) => cue.cue === 'closed_cue');
  expect(closed.counts.precheckEyesRejected).toBeGreaterThan(10);
  expect(report.eyeGate.conditions.map((s: any) => s.condition)).toEqual(['neutral', 'smile', 'squint']);
  expect(report.eyeGate.conditions.every((s: any) => s.targets.length === 9)).toBe(true);
  const failure = report.eyeGate.conditions[2].targets[0].clicks[0];
  expect(failure.attempts).toHaveLength(2);
  expect(failure.attempts.every((a: any) => !a.capture.accepted && a.counts.precheckEyesRejected > 0)).toBe(true);
  expect(report.models).toBeUndefined();
  expect(text).not.toMatch(/PRIVATE_SENTINEL|"(?:landmarks|pixels|rawX|correctedX|timestamp)"\s*:/);
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => (window as any).eyeGateStops)).toBe(1);
  const downloading = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`wecog-gaze-eye-gate.v1-${report.benchmark.runId}.json`);
  await download.cancel();
});

for (const mode of manualModes) test(`local manual ${mode || 'default'} check never asks for the camera automatically and Stop releases a late stream`, async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).testCameraRequests = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => {
      (window as any).testCameraRequests++;
      return new Promise(resolve => { (window as any).resolveTestStream = resolve; });
    } } });
  });
  const calls: string[] = [];
  page.on('request', request => { if (/\/api\/|\/ingest|:3000/.test(request.url())) calls.push(request.url()); });
  await page.goto(manualUrl(mode));
  if(mode==='gradient'||mode==='tophat')await expect(page.locator('#durationDescription')).toContainText('Без четырёхминутного интервала');
  if(mode==='gradient-temporal')await expect(page.locator('#durationDescription')).toContainText('4 минуты без проверочных точек');
  if(mode==='gradient-pose'||mode==='tophat-pose')await expect(page.locator('#durationDescription')).toContainText('обычная посадка, чуть ниже и возврат');
  expect(await page.evaluate(() => (window as any).testCameraRequests)).toBe(0);
  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => (window as any).testCameraRequests)).toBe(1);
  await page.locator('#stop').click();
  await page.evaluate(() => {
    (window as any).stoppedTracks = 0;
    (window as any).resolveTestStream({ getTracks: () => [{ stop() { (window as any).stoppedTracks++; } }] });
  });
  await expect.poll(() => page.evaluate(() => (window as any).stoppedTracks)).toBeGreaterThan(0);
  await expect(page.locator('#target')).toBeHidden();
  await expect(page.locator('#calibrate')).toBeHidden();
  await expect(page.locator('#start')).toBeEnabled();
  expect(calls).toEqual([]);
});

test('manual target is unobscured on desktop/mobile and instructions stay off the measurement background', async ({ page }, testInfo) => {
  for (const mode of manualModes) for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(manualUrl(mode));
    await page.evaluate(() => {
      document.body.classList.add('running');
      document.getElementById('status')!.textContent = 'Калибровка 1/25 — нажатие 1/2. Смотрите в центр красного круга.';
      const target = document.getElementById('target')!;
      target.hidden = false; target.style.left = '92%'; target.style.top = '8%';
    });
    await expect(page.locator('#instructions')).toBeHidden();
    for (const [x, y] of [[92, 8], [8, 92]]) {
      await page.locator('#target').evaluate((target: HTMLElement, [x, y]) => {
        target.style.left = `${x}%`; target.style.top = `${y}%`;
      }, [x, y]);
      expect(await page.locator('#target').evaluate(target => {
        const rect = target.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id;
      })).toBe('target');
      const targetBox = (await page.locator('#target').boundingBox())!;
      const statusBox = (await page.locator('#status').boundingBox())!;
      expect(targetBox.x < statusBox.x + statusBox.width && targetBox.x + targetBox.width > statusBox.x
        && targetBox.y < statusBox.y + statusBox.height && targetBox.y + targetBox.height > statusBox.y).toBe(false);
    }
    if (process.env.WECOG_ISSUE143_VISUAL_REVIEW === '1') {
      await page.screenshot({ path: testInfo.outputPath(`manual-${mode || 'v3'}-${viewport.width}.png`) });
    }
  }
});

test('eye patch features use only their completed frame pixels without a camera in every engine', async ({ page }) => {
  await page.goto('/apps/autotests/manual/issue143-gaze.html');
  const result=await page.evaluate(async landmarks=>{
    // Browser-served ESM URLs, not TypeScript/Node module resolution paths.
    const urls = ['/apps/participant-web/js/gaze-tracker/eye-patch-features.mjs?v=20261107-143',
      '/apps/participant-web/js/session-runtime/frame-pixels.mjs', '/apps/autotests/fixtures/issue143-eye-image.mjs',
      '/apps/participant-web/js/gaze-tracker/eye-gradient-features.mjs?v=20261107-143g',
      '/apps/participant-web/js/gaze-tracker/eye-tophat-features.mjs?v=20261110-integration1'];
    const [{ eyePatchFeaturesForFrame }, { rememberFramePixels }, { syntheticEyeImage }, { eyeGradientFeaturesForFrame }, { eyeTophatFeaturesForFrame }] = await Promise.all(urls.map(url => import(url)));
    const frame={landmarks,frameSize:{width:640,height:480}};
    const missing=eyePatchFeaturesForFrame(frame);
    const gradientMissing=eyeGradientFeaturesForFrame(frame);
    rememberFramePixels(frame,syntheticEyeImage(landmarks,{gazeX:.2,gazeY:-.3}));
    const vector=eyePatchFeaturesForFrame(frame)!;
    const gradient=eyeGradientFeaturesForFrame(frame);
    const tophat=eyeTophatFeaturesForFrame(frame);
    return {missing,length:vector.length,finite:vector.every(Number.isFinite), gradientMissing,
      gradientLength:gradient.length,gradientFinite:gradient.every(Number.isFinite),
      tophatLength:tophat.length,tophatFinite:tophat.every(Number.isFinite),tophatOtherCapture:eyeTophatFeaturesForFrame({...frame}),
      otherCapture:eyePatchFeaturesForFrame({...frame}),gradientOtherCapture:eyeGradientFeaturesForFrame({...frame})};
  },landmarksForGaze(.2,-.3));
  expect(result).toEqual({missing:null,length:120,finite:true,otherCapture:null,
    gradientMissing:null,gradientLength:4,gradientFinite:true,gradientOtherCapture:null,
    tophatLength:320,tophatFinite:true,tophatOtherCapture:null});
});

test('local check initializes the vendored model with synthetic video and tears it down', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Synthetic canvas capture smoke; not a real-camera accuracy test');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#888'; context.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(15);
      const timer = setInterval(() => context.fillRect(0, 0, 640, 480), 67);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
      (window as any).syntheticTestStream = stream;
      return stream;
    } } });
  });
  await page.goto('/apps/autotests/manual/issue143-gaze.html');
  await page.locator('#start').click();
  await expect(page.locator('#calibrate')).toBeVisible({ timeout: 40000 });
  await page.locator('#stop').click();
  expect(await page.evaluate(() => (window as any).syntheticTestStream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await expect(page.locator('#target')).toBeHidden();
  await page.evaluate(() => {
    const target = document.getElementById('target')!;
    target.hidden = false; target.style.left = '92%'; target.style.top = '8%';
  });
  expect(await page.evaluate(() => {
    const point = document.getElementById('target')!.getBoundingClientRect();
    return document.elementFromPoint(point.left + point.width / 2, point.top + point.height / 2)?.id;
  })).toBe('target'); // The Stop control must not cover the edge calibration point.
});

for (const mode of [...manualModes, 'nuisance-geometry-overlap', 'nuisance-geometry-red-overlap',
  'nuisance-gate-no-confirmation', 'nuisance-identical-anchors', 'masked-coverage-only', 'gradient-pose-stop', 'gradient-pose-timeout', 'developer-spatial', 'developer-posture', 'developer-temporal',
  'developer-spatial-retry', 'developer-spatial-coverage-failure', 'developer-spatial-independent-failure',
  'aoi-continuous', 'aoi-continuous-stop', 'aoi-continuous-overrun', 'developer-aoi-continuous']) test(`manual ${mode || 'v3'} ${mode.includes('aoi-continuous')
    ? 'exercises uninterrupted AOI timing and aggregates' : mode.endsWith('-stop') || mode.endsWith('-timeout') ? 'cleans up during a posture prompt' : 'exercises calibration and validation with a synthetic oracle'}`, async ({ page, browserName }) => {
  const cohort = mode.startsWith('developer-');
  const masked = mode.startsWith('masked-');
  const maskedCoverageOnly = mode === 'masked-coverage-only';
  const lidSupport = mode === 'lid-support';
  const aoi = mode.includes('aoi-continuous');
  const nuisance = mode.startsWith('nuisance'), identicalAnchors = mode === 'nuisance-identical-anchors';
  const geometry = mode.startsWith('nuisance-geometry'), anchorOverlap = mode === 'nuisance-geometry-overlap';
  const redOverlap = mode === 'nuisance-geometry-red-overlap';
  const adaptive = geometry || mode.startsWith('nuisance-gate'), noConfirmation = mode === 'nuisance-gate-no-confirmation';
  const program = aoi ? 'aoi-continuous' : nuisance ? 'posture' : cohort || masked ? mode.split('-')[1] : null;
  const recoverCoverage = mode === 'developer-spatial-retry';
  const failCorrection = mode.endsWith('-coverage-failure'), failIndependent = mode.endsWith('-independent-failure');
  const ablation = mode !== '';
  const tophat = mode.startsWith('tophat') || cohort;
  const pose = nuisance || mode.startsWith('gradient-pose') || mode === 'tophat-pose' || mode === 'developer-posture', temporal = mode === 'gradient-temporal' || mode === 'developer-temporal' || masked, gradient = mode === 'gradient' || temporal || pose || tophat || lidSupport || aoi;
  test.skip(aoi && cohort ? !['chromium', 'webkit'].includes(browserName)
    : temporal || pose || tophat || aoi ? browserName !== 'webkit' : browserName !== 'chromium' && !(gradient && browserName === 'webkit'),
    'Functional clock oracle only; the full gradient temporal/posture checks run in WebKit. Not webcam accuracy.');
  // Functional virtual-clock replay executes every capture, including the 4-min gap.
  // This is a harness wall-time budget, not a relaxed camera/FPS/accuracy threshold.
  test.setTimeout(temporal || aoi ? 240000 : 120000);
  await page.clock.install({ time: new Date('2026-11-06T12:00:00Z') });
  const coordinates = [8, 29, 50, 71, 92].flatMap(y => [8, 29, 50, 71, 92].map(x => [x, y]))
    .concat([15, 50, 85].flatMap(y => [15, 50, 85].map(x => [x, y])))
    .concat([[30,22],[70,22],[22,70],[78,70],[50,63],[50,56],[12,12],[88,12],[12,88],[88,88]])
    .concat([[20,20],[80,20],[47,44],[20,80],[80,80]])
    .concat(aoi ? [16,33,50,67,84].flatMap(y => [15,34,66,85].map(x => [x,y])) : []);
  await page.addInitScript(fixtures => {
    (window as any).oracleFixtures = fixtures;
    (window as any).oracleStopped = 0;
    (window as any).oraclePersistenceWrites = 0;
    const setItem = Storage.prototype.setItem, openDb = IDBFactory.prototype.open;
    Storage.prototype.setItem = function(...args) { (window as any).oraclePersistenceWrites++; return setItem.apply(this, args); };
    IDBFactory.prototype.open = function(...args) { (window as any).oraclePersistenceWrites++; return openDb.apply(this, args); };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({
      getTracks: () => [{ addEventListener() {}, stop() { (window as any).oracleStopped++; } }]
    }) } });
    Object.defineProperties(HTMLVideoElement.prototype, {
      srcObject: { configurable: true, get() { return (this as any).testStream; }, set(stream) { (this as any).testStream = stream; } },
      videoWidth: { configurable: true, get: () => 640 }, videoHeight: { configurable: true, get: () => 480 }
    });
    HTMLVideoElement.prototype.play = async () => {};
  }, Object.fromEntries(coordinates.map(([x, y]) => [`${x}:${y}`, landmarksForGaze((x - 50) / 50, (y - 50) / 50)])));
  // Ground-truth target generates SYNTHETIC INPUT in this test only. The real
  // predictor is unchanged and never receives the target as context.
  await page.route('**/precheck-analyzer/PrecheckAnalyzer.js?*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import { rememberFramePixels } from '/apps/participant-web/js/session-runtime/frame-pixels.mjs';
    import { syntheticApertureLandmarks, syntheticEyeImage } from '/apps/autotests/fixtures/issue143-eye-image.mjs';
    let imageKey, artificialPixels;
    export default class Analyzer {
      backend = 'synthetic_oracle'; async initialize() { return true; } dispose() {}
      async analyzeFrame() {
        const board = document.getElementById('aoiBoard');
        const target = board && !board.hidden ? document.getElementById('aoiCue') : document.getElementById('target');
        const key = parseFloat(target.style.left) + ':' + parseFloat(target.style.top);
        const source = window.oracleFixtures[key] || window.oracleFixtures['50:50'];
        // Artificial capture translation, not a model input or a physical pose claim.
        const lowered = document.body.dataset.posePhase === 'lowered';
        const alt = ${nuisance && !identicalAnchors} && (lowered || document.body.dataset.posePhase === 'nuisance_alternate');
        const anchorShift = ${geometry && !anchorOverlap} && document.body.dataset.posePhase === 'nuisance_alternate';
        const redShift = ${redOverlap} && key === '50:50' && document.getElementById('status').textContent.startsWith('Калибровка ');
        const landmarks = ${masked || lidSupport} ? syntheticApertureLandmarks(source)
          : lowered || anchorShift || redShift ? source.map(p => ({...p, y: p.y + .015})) : source;
        const frame = { timestamp: performance.now(), wallTimestamp: Date.now(), landmarks, frameSize: { width:640,height:480 },
          eyes: { bothOpen: !window.oracleRejectClick }, pose: { status: 'stable', yaw: 0, pitch: 0, roll: 0 } };
        ${mode === 'appearance' || gradient ? `
          ${recoverCoverage || failCorrection || failIndependent ? `
          const status = document.getElementById('status').textContent;
          // Drop candidate descriptors for one target, but preserve valid baseline frames.
          if (status.includes(${JSON.stringify(failIndependent ? 'Независимая проверка коррекции 3/5' : 'Подготовка коррекции 7/9')})
              && (${!recoverCoverage} || !status.startsWith('Повтор'))) return frame;
          ` : ''}
          // Only the artificial generator reuses its ONE unchanged image.
          // Every 33 ms callback still creates a new capture owner/timestamp;
          // the actual feature extractor/predictor executes on every capture.
          const sceneKey = key + ':' + lowered + ':' + alt + ':' + anchorShift + ':' + redShift;
          if (imageKey !== sceneKey) {
            imageKey = sceneKey; artificialPixels = syntheticEyeImage(landmarks, {
              gazeX:(parseFloat(target.style.left)||50)/50-1,gazeY:(parseFloat(target.style.top)||50)/50-1,
              ...(alt ? { aperture: .19, lidShift: .032 } : {}) });
          }
          return rememberFramePixels(frame, artificialPixels);` : 'return frame;'}
      }
    }` }));
  await page.route('**/session-runtime/video-frames.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export function observeVideoFrames(video, callback) {
      const id = setInterval(() => callback(performance.now()), 33);
      return { stop() { clearInterval(id); } };
    }` }));
  if (noConfirmation) {
    await page.route('**/eye-gradient-features.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
      export * from '/apps/participant-web/js/gaze-tracker/eye-gradient-features.mjs';
      export function eyeGradientFeaturesForFrame() { return null; }
    ` }));
  }
  if (maskedCoverageOnly) {
    await page.route('**/gaze-eye-masked.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
      import { measureMaskedEyeFrame as measure } from '/apps/web/developer/gaze-eye-masked.mjs';
      export function measureMaskedEyeFrame(frame) {
        const target = document.getElementById('target');
        if (target.hidden || (target.style.left === '50%' && target.style.top === '92%')) {
          return { centers: null, reason: 'insufficient_visible_rows' };
        }
        return measure(frame);
      }
    ` }));
  }
  if (lidSupport) {
    await page.route('**/gaze-eye-masked.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
      import { measureLidSupportPair as measure } from '/apps/web/developer/gaze-eye-masked.mjs';
      export function measureLidSupportPair(frame) {
        const target = document.getElementById('target'), result = measure(frame);
        return target.style.left === '50%' && target.style.top === '92%'
          ? { ...result, hard: 'insufficient_visible_rows' } : result;
      }
    ` }));
  }
  if (cohort) await installGazeAccess(page);
  await page.goto(cohort ? '/apps/participant-web/tools/gaze-benchmark.html?protocol=' + program : manualUrl(mode));
  if (cohort) {
    await page.locator('#consent').check();
    await expect(page.locator('#start')).toBeEnabled();
  }
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const initialWrites = await page.evaluate(() => (window as any).oraclePersistenceWrites);
  await page.locator('#start').evaluate((button: HTMLElement) => button.click());
  await expect(page.locator('#calibrate')).toBeVisible();
  if (mode === 'appearance' || gradient) await page.clock.runFor(1000);
  await page.locator('#calibrate').evaluate((button: HTMLElement) => button.click());
  if (nuisance) {
    for (const phase of ['reference', 'alternate']) {
      await expect(page.locator('body')).toHaveAttribute('data-pose-phase', 'nuisance_' + phase);
      await expect(page.locator('#target')).toBeHidden();
      await page.locator('#poseContinue').evaluate((button: HTMLElement) => button.click());
      await page.clock.runFor(12000);
    }
    if (identicalAnchors || anchorOverlap) {
      await expect(page.locator('#download')).toBeVisible();
      const report = JSON.parse((await page.locator('#result').textContent())!);
      expect(report.benchmark).toMatchObject({ completed: false, phase: 'nuisance_alternate',
        reason: anchorOverlap ? 'geometry_anchor_overlap' : 'nuisance_no_direction', counters: { calibrationAttempts: 0 } });
      expect(report.diagnostics.nuisanceCalibration.rank).toBeNull();
      if (anchorOverlap) expect(report.diagnostics.geometryGate.failureReason).toBe('overlapping_geometry_range');
      expect(report.models).toBeUndefined();
      expect(await page.evaluate(() => (window as any).oracleStopped)).toBe(1);
      return;
    }
    await expect(page.locator('body')).toHaveAttribute('data-pose-phase', 'nuisance_return');
    await page.locator('#poseContinue').evaluate((button: HTMLElement) => button.click());
    await expect(page.locator('#status')).toContainText('Калибровка 1/25');
  }
  if (lidSupport) {
    // The first click slot cannot get past the unmodified eye gate. Only one
    // retry is allowed; the probe then advances without labelling it accepted.
    await page.evaluate(() => { (window as any).oracleRejectClick = true; });
    for (let i = 0; i < 2; i++) {
      await page.locator('#target').evaluate((point: HTMLElement) => point.click());
      await page.clock.runFor(2200);
    }
    await expect(page.locator('#status')).toContainText('1/9 — нажатие 2/2');
    await page.evaluate(() => { (window as any).oracleRejectClick = false; });
    for (let i = 0; i < 17; i++) {
      await page.locator('#target').evaluate((point: HTMLElement) => point.click());
      await page.clock.runFor(1000);
    }
    await expect(page.locator('#download')).toBeVisible();
    await expect(page.locator('#target')).toBeHidden();
    await expect(page.locator('#status')).toContainText('Точность взгляда не оценивалась');
    const report = JSON.parse((await page.locator('#result').textContent())!);
    expect(report.version).toBe('gaze_lid_support.v1');
    expect(report.benchmark).toMatchObject({ completed: true, scope: 'paired_eye_descriptor_coverage_only_not_gaze_accuracy',
      counters: { calibrationAttempts: 19, calibrationAccepted: 17 } });
    expect(report.models).toBeUndefined();
    expect(report.before).toBeUndefined();
    expect(report.temporalGap).toBeUndefined();
    const probe = report.diagnostics.lidSupport;
    expect(probe.scheduledClicks).toBe(18);
    expect(probe.targets).toHaveLength(9);
    expect(probe.targets[0].clicks[0]).toMatchObject({ accepted: false,
      attempts: [{ failureReason: 'eye_signal' }, { failureReason: 'eye_signal' }] });
    const lower = probe.targets.find((r: any) => r.targetPercent.x === 50 && r.targetPercent.y === 92);
    for (const c of lower.clicks) {
      expect(c.attempts).toHaveLength(1);
      expect(c).toMatchObject({ accepted: true, attempts: [{ hardReady: false, softReady: true }] });
      expect(c.attempts[0].pairs.softOnly).toBe(c.attempts[0].controlFrames);
    }
    expect(await page.evaluate(() => (window as any).oracleStopped)).toBe(1);
    expect(await page.evaluate(() => (window as any).oraclePersistenceWrites)).toBe(initialWrites);
    expect(JSON.stringify(report)).not.toMatch(/"(?:centers|landmarks|pixels|weights|featureVectors)"\s*:/);
    const downloading = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`wecog-gaze-lid-support.v1-${report.benchmark.runId}.json`);
    await download.cancel();
    return;
  }
  for (let click = 0; click < 50; click++) {
    if (recoverCoverage && click === 40) {
      await page.evaluate(() => { (window as any).oracleRejectClick = true; });
      await page.locator('#target').evaluate((point: HTMLElement) => point.click());
      await page.clock.runFor(2200);
      await expect(page.locator('#status')).toContainText('21/25 — нажатие 1/2. Не хватило устойчивых кадров с видимыми глазами');
      await page.evaluate(() => { (window as any).oracleRejectClick = false; });
    }
    await page.locator('#target').evaluate((point: HTMLElement) => point.click());
    await page.clock.runFor(1000);
  }
  if (aoi) {
    await page.clock.runFor(50000);
    await expect(page.locator('#poseContinue')).toHaveText('Начать непрерывный блок');
    await expect(page.locator('#target')).toBeHidden();
    await expect(page.locator('#aoiBoard')).toBeHidden();
    if (mode.endsWith('-overrun')) await page.evaluate(() => {
      const original = window.setTimeout;
      window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: any[]) =>
        original(handler, ms === 6000 ? 6600 : ms, ...args)) as typeof window.setTimeout;
    });
    await page.locator('#poseContinue').evaluate((button: HTMLElement) => button.click());
    await expect(page.locator('#aoiBoard')).toBeVisible();
    await expect(page.locator('#poseContinue')).toBeHidden();
    await expect(page.locator('#status')).toContainText('Показ 1/40');
    await page.clock.runFor(5999);
    await expect(page.locator('#status')).toContainText('Показ 1/40');
    if (mode.endsWith('-overrun')) await page.clock.runFor(701);
    else {
      await page.clock.runFor(1);
      await expect(page.locator('#status')).toContainText('Показ 2/40');
      await expect(page.locator('#aoiBoard')).toBeVisible();
      await expect(page.locator('#download')).toBeHidden();
      if (mode.endsWith('-stop')) await page.locator('#stop').evaluate((button: HTMLElement) => button.click());
      else {
        await page.clock.runFor(228000);
        await expect(page.locator('#status')).toContainText('Показ 40/40');
        await expect(page.locator('#target')).toBeHidden();
        await expect(page.locator('#poseContinue')).toBeHidden();
        await page.clock.runFor(6000);
      }
    }
    await expect(page.locator('#download')).toBeVisible();
    await expect(page.locator('#aoiBoard')).toBeHidden();
    const report = JSON.parse((await page.locator('#result').textContent())!);
    const complete = !mode.endsWith('-stop') && !mode.endsWith('-overrun');
    expect(report.version).toBe('gaze_continuous_aoi.v1');
    expect(report.benchmark).toMatchObject({ protocol: 'aoi-continuous.v1', diagnosticSurface: cohort ? 'developer_panel' : 'loopback',
      completed: complete, phase: complete ? 'completed' : 'aoi_running',
      counters: { calibrationAccepted: 50 } });
    expect(await page.evaluate(() => (window as any).oracleStopped)).toBe(1);
    expect(await page.evaluate(() => (window as any).oraclePersistenceWrites)).toBe(initialWrites);
    expect(JSON.stringify(report)).not.toMatch(/"(?:fixationPoints|landmarks|pixels|weights|featureVectors|rawX|correctedX)"\s*:/);
    if (!complete) {
      expect(report.aoiBlock).toBeUndefined();
      expect(report.benchmark.reason).toBe(mode.endsWith('-overrun') ? 'aoi_timing_overrun' : 'user_stop');
      expect(report.diagnostics.completedPresentations).toBe(mode.endsWith('-overrun') ? 0 : 1);
      return;
    }
    expect(Object.keys(report.models)).toEqual(['baseline', 'eye_patch']);
    expect(report.aoiBlock).toMatchObject({ scheduledPresentations: 40, nominalPresentationMs: 6000, durationMs: 240000 });
    expect(report.aoiBlock.presentations).toHaveLength(40);
    expect(report.aoiBlock.presentations.every((p: any) => p.measured > 150 && p.pairs.corrected.common > 150)).toBe(true);
    const { summarizeContinuousAoiReport, summarizeContinuousAoiReplicates } = await import('../../../scripts/reference-data/issue143-summarize-continuous-aoi.mjs');
    const recomputed = summarizeContinuousAoiReport({ ...report, aoiBlock: { ...report.aoiBlock, summary: {} } });
    expect(recomputed.all).toEqual(report.aoiBlock.summary.all);
    expect(() => summarizeContinuousAoiReport({ ...report, benchmark: { ...report.benchmark, completed: false } }))
      .toThrow('incomplete_aoi_report');
    const invalid = structuredClone(report);
    invalid.aoiBlock.presentations[0].pairs.corrected.onlyPatchHit += 10000;
    expect(() => summarizeContinuousAoiReport(invalid)).toThrow('invalid_aoi_pairs');
    const incomplete = { version: report.version, benchmark: { ...report.benchmark, completed: false,
      runId: '9c23270e-64d7-44d2-b204-f3c306877164', reason: 'viewport_changed' } };
    const replicates = summarizeContinuousAoiReplicates([invalid, report, report, incomplete, null]);
    expect(replicates.counts).toEqual({ complete: 1, incomplete: 1, duplicate_run: 1, invalid: 2, unsupported: 0 });
    expect(replicates.runs[1]).toMatchObject({ scoredWindows: 40, support: 'all_windows_at_least_20_common_frames',
      matchedConditionChange: { conditions: 20 } });
    expect(replicates.runs[3]).toMatchObject({ status: 'incomplete', reason: 'viewport_changed' });
    expect(JSON.stringify(replicates)).not.toContain(report.benchmark.runId);
    for (const half of ['early', 'late']) {
      const row = report.aoiBlock.summary[half];
      expect(row.presentations).toBe(20);
      expect(row.pairs.corrected.comparableWindows).toBe(20);
      for (const signal of ['baseline.corrected', 'eye_patch.corrected']) {
        expect(row.signals[signal].equalWindowTargetHitFraction).toBeGreaterThan(.8);
        expect(row.signals[signal].targetDwellFractionOfValidObservation).toBeGreaterThan(.8);
      }
    }
    const downloading = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`wecog-gaze-continuous-aoi.v1-${report.benchmark.runId}.json`);
    await download.cancel();
    return;
  }
  if (redOverlap) {
    await expect(page.locator('#download')).toBeVisible();
    const report = JSON.parse((await page.locator('#result').textContent())!);
    expect(report.benchmark).toMatchObject({ completed: false, phase: 'calibration', reason: 'geometry_gate_unavailable' });
    expect(report.diagnostics.geometryGate).toMatchObject({ available: false, anchorScreenPassed: true,
      failureReason: 'overlapping_geometry_range' });
    expect(report.models).toBeUndefined();
    expect(await page.evaluate(() => (window as any).oracleStopped)).toBe(1);
    return;
  }
  if (maskedCoverageOnly) {
    await expect(page.locator('#status')).toContainText('проверка точности не запущена');
    await expect(page.locator('#download')).toBeVisible();
    await expect(page.locator('#target')).toBeHidden();
    const report = JSON.parse((await page.locator('#result').textContent())!);
    expect(report.benchmark).toMatchObject({ completed: false, phase: 'calibration', reason: 'masked_calibration_coverage',
      counters: { calibrationAccepted: 50, calibrationAttempts: 50 } });
    const coverage = report.diagnostics.targetCoverage;
    expect(coverage.calibrationRejections).toEqual([]);
    expect(coverage.maskedCalibration.missingCommonClicks).toBe(2);
    expect(coverage.maskedCalibration.targets).toHaveLength(25);
    const lower = coverage.maskedCalibration.targets[22];
    expect(lower).toMatchObject({ targetIndex: 22, acceptedControlClicks: 2, commonFrames: 0, clicksWithEnoughCommonFrames: 0,
      rejectionCounts: { insufficient_visible_rows: lower.controlFrames } });
    expect(lower.controlFrames).toBeGreaterThan(0);
    expect(report.models).toBeUndefined();
    expect(report.before).toBeUndefined();
    expect(await page.evaluate(() => (window as any).oracleStopped)).toBe(1);
    return;
  }
  if (pose) {
    await page.clock.runFor(50000);
    for (const phase of ['natural', 'lowered', 'returned']) {
      await expect(page.locator('body')).toHaveAttribute('data-pose-phase', phase);
      await expect(page.locator('#poseContinue')).toBeVisible();
      await expect(page.locator('#target')).toBeHidden();
      await expect(page.locator('#download')).toBeHidden();
      if (mode.endsWith('-stop') || mode.endsWith('-timeout')) {
        if (mode.endsWith('-stop')) await page.locator('#stop').evaluate((button: HTMLElement) => button.click());
        await page.clock.runFor(61000);
        await expect(page.locator('#poseContinue')).toBeHidden();
        await expect(page.locator('#target')).toBeHidden();
        await expect(page.locator('#download')).toBeHidden();
        await expect(page.locator('#start')).toBeEnabled();
        expect(await page.evaluate(() => (window as any).oracleStopped)).toBe(1);
        return;
      }
      await page.locator('#poseContinue').evaluate((button: HTMLElement) => { button.click(); button.click(); });
      await page.clock.runFor(16000);
    }
  } else if (temporal) {
    await page.clock.runFor(80000);
    await expect(page.locator('#status')).toContainText('Непрерывный интервал 4 минуты');
    await expect(page.locator('#target')).toBeHidden();
    await expect(page.locator('#download')).toBeHidden();
    await page.clock.runFor(260000);
  } else await page.clock.runFor(gradient ? 100000 : 340000);
  await expect(page.locator('#download')).toBeVisible();
  const report = JSON.parse((await page.locator('#result').textContent())!);
  expect(report.version).toBe(cohort || masked || nuisance ? 'gaze_benchmark.v1' : tophat ? 'issue143_eye_tophat.v10' : pose ? 'issue143_eye_gradient_pose.v9' : temporal ? 'issue143_eye_gradient_temporal.v8' : gradient ? 'issue143_eye_gradient.v7' : mode === 'appearance' ? 'issue143_eye_patch.v6' : mode === 'axis' ? 'issue143_axis_regularization.v5' : ablation ? 'issue143_factorial_geometry.v4' : 'issue143_production_calibration.v3');
  if (cohort || masked || nuisance) {
    const coverage = report.diagnostics.targetCoverage;
    expect(coverage.version).toBe('gaze_target_coverage.v1');
    expect(coverage.maxAttemptsPerValidationTarget).toBe(2);
    const affected = coverage.validation[failIndependent ? 'independent' : 'correction'][failIndependent ? 2 : 6];
    const unaffected = coverage.validation.correction[0];
    expect(unaffected.attempts).toHaveLength(1);
    expect(affected.attempts).toHaveLength(recoverCoverage || failCorrection || failIndependent ? 2 : 1);
    if (recoverCoverage || failCorrection || failIndependent) {
      expect(affected.attempts[0].models.baseline.acceptedSamples).toBeGreaterThan(0);
      expect(affected.attempts[0].models.eye_patch.acceptedSamples).toBe(0);
      expect(affected.attempts[0].models.eye_patch.rejectionCounts.missing_eye_descriptor).toBeGreaterThan(0);
      expect(affected.selectedAttempt.baseline).toBe(1);
    }
    if (failCorrection || failIndependent) {
      expect(report.benchmark.completed).toBe(false);
      expect(report.benchmark.phase).toBe(failIndependent ? 'independent' : 'correction');
      expect(report.benchmark.reason).toBe(failIndependent ? 'benchmark_coverage' : 'correction_coverage');
      expect(affected.selectedAttempt.eye_patch).toBeNull();
      expect(affected.attempts[1].models.eye_patch.acceptedSamples).toBe(0);
      expect(report.models).toBeUndefined();
      expect(report.before).toBeUndefined();
      await expect(page.locator('#status')).toContainText(failIndependent ? 'независимой проверки коррекции' : 'подготовки коррекции');
      await expect(page.locator('#target')).toBeHidden();
      expect(await page.evaluate(() => (window as any).oracleStopped)).toBe(1);
      return;
    }
    if (recoverCoverage) {
      expect(affected.selectedAttempt.eye_patch).toBe(2);
      expect(affected.attempts[1].models.eye_patch.acceptedSamples).toBeGreaterThan(0);
      expect(coverage.calibrationRejections).toEqual([expect.objectContaining({ targetIndex: 20, rejectedClicks: 1, reasons: { eye_signal: 1 } })]);
    }
    expect(report.benchmark.completed).toBe(true);
    expect(report.benchmark.protocol).toBe(program + '.v1');
    if (masked) {
      expect(report.benchmark.modelSet).toBe('baseline_patch_gradient_masked.v1');
      expect(coverage.maskedCalibration.missingCommonClicks).toBe(0);
      expect(coverage.maskedCalibration.targets).toHaveLength(25);
      const { summarizeGradientReport } = await import('../../../scripts/reference-data/issue143-summarize-gradient.mjs');
      const summary = summarizeGradientReport(report);
      expect(summary.models.eye_masked.featureMethod).toBe('eye_masked_center.experimental.v1');
      expect(summary.temporalComparison.signals['eye_masked.raw'].matchedTargets).toBe(9);
      expect(summary.after.comparisons).toContainEqual(expect.objectContaining({
        baseline: 'eye_gradient_all.raw', candidate: 'eye_masked.raw', commonAccepted: expect.any(Number) }));
    }
    if (nuisance) {
      expect(report.benchmark.modelSet).toBe(geometry ? 'baseline_patch_rows_nuisance_geometry.v1'
        : adaptive ? 'baseline_patch_rows_nuisance_gate.v1' : 'baseline_patch_rows_nuisance.v1');
      const calibration = report.nuisanceCalibration;
      expect(calibration.rank).toBeGreaterThan(0);
      expect(calibration.stages.map((stage: any) => stage.id)).toEqual(['reference', 'alternate']);
      for (const s of calibration.stages) {
        expect(s.targets).toHaveLength(5);
        expect(s.targets.every((t: any) => t.accepted && t.usable >= t.minFrames)).toBe(true);
      }
      const { summarizeGradientReport } = await import('../../../scripts/reference-data/issue143-summarize-gradient.mjs');
      const summary = summarizeGradientReport(report);
      expect(summary.stages).toHaveLength(3);
      expect(summary.stages?.[0].comparisons).toContainEqual(expect.objectContaining({
        baseline: 'eye_patch_rows.raw', candidate: 'eye_patch_nuisance.raw', commonAccepted: expect.any(Number) }));
      if (adaptive) {
        expect(geometry ? report.geometryGate : report.appearanceGate).toMatchObject({ available: true, confirmationAvailable: !noConfirmation });
        if (geometry) {
          expect(report.geometryGate).toMatchObject({ anchorScreenPassed: true, separatedAlternatePairs: 5 });
          expect(summary.selectionChannel).toBe('separate_eye_corner_height');
        }
        const lower = summary.stages?.[1];
        expect(lower?.comparisons).toContainEqual(expect.objectContaining({
          baseline: 'eye_patch.raw', candidate: 'eye_patch_adaptive.raw', commonAccepted: expect.any(Number) }));
        expect(lower?.shadowActions?.['eye_patch_adaptive.raw'].blended
          + lower?.shadowActions?.['eye_patch_adaptive.raw'].boundary_guard
          + lower?.shadowActions?.['eye_patch_adaptive.raw'].eye_disagreement).toBeGreaterThan(0);
        if (noConfirmation) expect(lower?.shadowActions?.['eye_patch_adaptive_confirmed.raw'].confirmed_inside).toBe(0);
        else expect(summary.confirmationAvailable).toBe(true);
      }
    }
    expect(report.benchmark.counters.calibrationAccepted).toBe(50);
    const writes = await page.evaluate(() => (window as any).oraclePersistenceWrites);
    expect(writes).toBe(initialWrites);
    expect(JSON.stringify(report)).not.toMatch(/synthetic@example|"(?:email|token|userAgent|deviceId)"\s*:/);
  }
  expect(report.calibration.clicks).toHaveLength(recoverCoverage ? 51 : 50);
  expect(report.calibration.repeatability).toHaveLength(25);
  if (ablation) {
    if (mode === 'axis') {
      expect(Object.keys(report.models)).toHaveLength(12);
      expect(report.models.axis_mixed.ridgeSelection.policy).toBe('per_axis_target_group_cv');
      expect(report.models.axis_mixed.ridgeSelection.curve).toHaveLength(4);
      expect(report.models.axis_auto.ridgeSelection.policy).toBe('per_axis_basis_target_group_cv');
      expect(report.models.axis_auto.ridgeSelection.curve).toHaveLength(8);
      expect(report.models.baseline.ridgeSelection.policy).toBe('joint_xy_target_group_cv');
      expect(report.models.quadratic_lambda_0p01.ridgeSelection.lambdaX).toBe(.01);
    } else if (nuisance) {
      expect(Object.keys(report.models)).toEqual(['baseline', 'eye_patch', 'eye_patch_rows', 'eye_patch_nuisance']);
      expect(report.models.eye_patch_nuisance.featureMethod).toBe('eye_patch_paired_nuisance.experimental.v1');
      expect(report.eyeImageFrames.nuisanceNotFitted).toBeGreaterThan(0);
      expect(report.eyeImageFrames.nuisanceMissing).toBe(0);
      expect(report.calibrationFramePolicy).toBe('intersection_of_full_rows_nuisance_before_all_model_averages');
      expect(report.intervalMs).toBe(0);
    } else if (gradient) {
      expect(Object.keys(report.models)).toEqual(['baseline','eye_patch','eye_gradient_all',masked?'eye_masked':tophat?'eye_tophat':'eye_gradient']);
      if (masked) {
        expect(report.models.eye_masked.featureMethod).toBe('eye_masked_center.experimental.v1');
        expect(report.models.eye_masked.experimentalModel.featureCount).toBe(2);
        expect(report.models.eye_masked.ridgeSelection.curve).toHaveLength(5);
        expect(report.eyeImageFrames.maskedMissing).toBe(0);
      } else if(tophat) {
        expect(report.models.eye_tophat.featureMethod).toBe('eye_tophat_ridge.experimental.v1');
        expect(report.models.eye_tophat.experimentalModel.featureCount).toBe(320);
        expect(report.models.eye_tophat.ridgeSelection.curve).toHaveLength(5);
        if (recoverCoverage) expect(report.eyeImageFrames.tophatMissing).toBeGreaterThan(0);
        else expect(report.eyeImageFrames.tophatMissing).toBe(0);
      } else {
        expect(report.models.eye_gradient.featureMethod).toBe('eye_gradient_iris.experimental.v1');
        expect(report.models.eye_gradient.experimentalModel.featureCount).toBe(4);
        expect(report.models.eye_gradient.ridgeSelection.curve).toHaveLength(5);
        expect(report.eyeImageFrames.lateralMissing).toBe(0);
      }
      expect(report.models.eye_gradient_all.featureMethod).toBe('eye_gradient_all_iris.experimental.v1');
      expect(report.eyeImageRuntimeMs.frames).toBeGreaterThan(0);
      if (recoverCoverage) expect(report.eyeImageFrames.allMissing).toBeGreaterThan(0);
      else expect(report.eyeImageFrames.allMissing).toBe(0);
      expect(report.calibrationFramePolicy).toBe(`intersection_of_full_gradient_all_${masked ? 'masked' : tophat ? 'tophat' : 'gradient'}_before_all_model_averages`);
      expect(report.calibration.clicks.filter((p: any) => p.accepted).every((p:any)=>p.commonEyeImageFrames>=p.minFrames)).toBe(true);
      expect(report.intervalMs).toBe(temporal ? 240000 : 0);
      expect(report.temporalScope).toBe(pose ? 'posture_probe_not_long_interval_drift'
        : temporal ? 'same_targets_before_after_no_within_interval_accuracy' : 'spatial_only_no_drift_measurement');
      if (temporal) {
        expect(report.temporalGap.elapsedMs).toBe(240000);
        expect(report.temporalGap.completedCaptures).toBeGreaterThan(7000);
        expect(report.temporalGap.cameraNotifications).toBeGreaterThanOrEqual(report.temporalGap.completedCaptures);
        expect(report.temporalGap.scope).toBe('interval_capture_counts_not_gaze_accuracy');
        expect(report.after.map((r: any) => r.targetPercent)).toEqual(report.before.map((r: any) => r.targetPercent));
      }
      expect(report.eyeImageStorageScope).toBe('transient_only_no_images_features_or_weights_in_export');
    } else if (mode === 'appearance') {
      expect(Object.keys(report.models)).toEqual(['baseline','axis_auto','eye_patch','eye_patch_core']);
      expect(report.models.eye_patch.featureMethod).toBe('eye_patch_ridge.experimental.v1');
      expect(report.models.eye_patch.ridgeSelection.curve).toHaveLength(5);
      expect(report.models.eye_patch_core.featureMethod).toBe('eye_patch_core_ridge.experimental.v1');
      expect(report.models.eye_patch_core.experimentalModel.featureCount).toBe(24);
      expect(report.eyePatchFrames.missing).toBe(0);
      expect(report.eyePatchRuntimeMs.frames).toBeGreaterThan(0);
      expect(Number.isFinite(report.models.eye_patch.calibrationRuntimeMs.total)).toBe(true);
      expect(report.calibrationFramePolicy).toBe('intersection_of_full_core_before_all_model_averages');
      expect(report.eyePatchImagesStored || report.eyePatchFeaturesStored).toBe(false);
      expect(report.calibration.clicks.every((p:any)=>p.eyePatchUsableFrames>=p.minFrames && p.eyePatchCoreUsableFrames>=p.minFrames
        && p.eyePatchCommonUsableFrames>=p.minFrames)).toBe(true);
    } else expect(Object.keys(report.models)).toEqual(['baseline', 'pixel_quadratic', 'normalized_linear', 'pixel_linear']);
    expect(report.comparison).toBe(mode === 'axis' || mode === 'appearance' || gradient
      ? 'same_captures_common_baseline_gate_calibration_only_model_selection'
      : 'same_captures_common_baseline_gate_no_model_selection');
    expect(Object.values(report.models).every((model: any) => model.clicksPerPoint === 2 && model.calibrationFrames.accepted > 0 && model.predictorRuntimeMs.errors === 0)).toBe(true);
    const checkedRows=pose?report.poseProbe.stages.flatMap((stage: any) => stage.rows)
      : gradient?[...report.before,...report.after]:report.after;
    expect(checkedRows.every((row: any) => Object.entries(row.signals).every(([name,s]: any) =>
      name.startsWith('eye_') ? Number.isFinite(s.meanErrorPx) : s.meanErrorPx < 10))).toBe(true);
    expect(checkedRows.every((row: any) => row.comparisons.length === (mode === 'axis' ? 22 : adaptive ? 16 : masked || nuisance ? 10 : 6) && row.comparisons.every((p: any) => p.commonAccepted > 40))).toBe(true);
    expect(checkedRows.every((row: any) => row.baselineNuisance.frames > 40 && row.baselineNuisance.mean.length === 11 && !row.baselineNuisance.samples)).toBe(true);
  } else {
    expect(report.model.clicksPerPoint).toBe(2);
    expect(report.after.every((row: any) => row.signals.raw.meanErrorPx < 10 && row.signals.corrected.meanErrorPx < 10)).toBe(true);
  }
  if (pose) {
    expect(report.before).toBeUndefined(); expect(report.after).toBeUndefined();
    expect(report.poseProbe.scope).toBe('instructed_posture_change_then_return_not_ground_truth_pose');
    const stages = report.poseProbe.stages;
    expect(stages.map((stage: any) => stage.id)).toEqual(['natural', 'lowered', 'returned']);
    const positions = [[50,56],[12,12],[88,12],[12,88],[88,88]].map(([x,y]) => ({ x,y }));
    for (const stage of stages) expect(stage.rows.map((row: any) => row.targetPercent)).toEqual(positions);
    for (let i = 0; i < 5; i++) {
      const eyeMidY = (stage: number) => {
        const n = stages[stage].rows[i].baselineNuisance;
        return n.mean[n.fields.indexOf('eyeMidY')];
      };
      expect(eyeMidY(1) - eyeMidY(0)).toBeCloseTo(.015, 8);
      expect(eyeMidY(2)).toBeCloseTo(eyeMidY(0), 8);
    }
    await expect(page.locator('#poseContinue')).toBeHidden();
  } else {
    expect(report.before).toHaveLength(9); expect(report.after).toHaveLength(gradient && !temporal ? 0 : 9);
  }
  expect(report.rawVideoStored || report.rawLandmarksStored || report.rawGazeStored).toBe(false);
  expect(JSON.stringify(report)).not.toMatch(/"(?:landmarks|pixels|irisFeatures|headFeatures|weights|modelX|modelY|featureVectors)"\s*:/);
  if (!cohort) expect(await page.evaluate(() => (window as any).oraclePersistenceWrites)).toBe(0);
  expect(await page.evaluate(() => (window as any).oracleStopped)).toBeGreaterThan(0);
  await expect(page.locator('#target')).toBeHidden();
  if (gradient) {
    const downloading=page.waitForEvent('download');
    await page.locator('#download').evaluate((button:HTMLElement)=>button.click());
    const download=await downloading;
    if (cohort || masked || nuisance) expect(download.suggestedFilename()).toBe(`wecog-gaze-${masked ? 'masked-' : geometry ? 'geometry-' : adaptive ? 'adaptive-' : nuisance ? 'paired-' : ''}${report.benchmark.protocol}-${report.benchmark.runId}.json`);
    else expect(download.suggestedFilename()).toBe(tophat ? 'wecog-issue143-eye-tophat-v10.json' : pose ? 'wecog-issue143-eye-gradient-pose-v9.json'
      : temporal ? 'wecog-issue143-eye-gradient-temporal-v8.json' : 'wecog-issue143-eye-gradient-v7.json');
    await download.cancel();
  }
});

test('canonical live QC sees corrected off-screen predictions without a display point exactly once', async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => (window as any).handleGazeUpdate && (window as any).GazeTracker);
  const result = await page.evaluate(async () => {
    await (window as any).GazeTrackerReady;
    const state = (window as any).__WECOG_STATE__;
    state.flags.isRecording = false;
    const points: any[] = [];
    state.runtime.qcMetrics = { isRunning: () => true, addGazePoint: (point: any) => points.push(point) };
    state.runtime.gazeTracker = { isCalibrated: () => true };
    for (const gaze of [
      { valid: true, correctedX: 80, correctedY: 90, displayX: 10, displayY: 20, onScreen: true },
      { valid: true, correctedX: innerWidth + 100, correctedY: 90, displayX: null, displayY: null, onScreen: false },
      { valid: false, correctedX: 80, correctedY: 90, displayX: 10, displayY: 20, onScreen: true },
    ]) (window as any).handleGazeUpdate(gaze);
    return { points, method: state.sessionData.tech.gazeQcSignalMethod, outsideX: innerWidth + 100 };
  });
  expect(result.points).toEqual([{ x: 80, y: 90, onScreen: true }, { x: result.outsideX, y: 90, onScreen: false }, null]);
  expect(result.method).toBe('corrected_validity.v1');
});

test('canonical loader uses anatomical eye pairing and persists feature provenance without camera', async ({ page }) => {
  const failures: string[] = [];
  page.on('requestfailed', request => failures.push(new URL(request.url()).pathname + ': ' + request.failure()?.errorText));
  page.on('pageerror', error => failures.push(error.message));
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  const fixture = [-.8, -.4, 0, .4, .8].flatMap(x => [-.8, -.4, 0, .4, .8].map(y => ({
    points: landmarksForGaze(x, y), targetX: 735 + x * 700, targetY: 478 + y * 440,
  })));
  const predicted = landmarksForGaze(.6, -.6, { leftShiftY: .004 });
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  try {
    await page.waitForFunction(() => (window as any).handleGazeUpdate && (window as any).GazeTracker, undefined, { timeout: 15000 });
  } catch (error) { throw new Error('Canonical startup failed: ' + JSON.stringify(failures) + '; ' + String(error)); }
  const result = await page.evaluate(async ({ fixture, predicted }) => {
    await (window as any).GazeTrackerReady;
    const tracker = new (window as any).GazeTracker({ screenWidth: 1470, screenHeight: 956 });
    fixture.forEach(row => tracker.addCalibrationPoint(row.points, row.targetX, row.targetY));
    if (!tracker.calibrate()) throw new Error('Synthetic calibration failed');
    const gaze = tracker.predict(predicted, { timestamp: 240000 });
    (window as any).handleGazeUpdate(gaze);
    return { valid: gaze.valid, rawX: gaze.rawX, rawY: gaze.rawY,
      method: (window as any).__WECOG_STATE__.sessionData.tech.gazeFeatureMethod,
      statusMethod: tracker.getStatus().featureMethod,
      calibrationSampling: (window as any).__WECOG_STATE__.sessionData.tech.gazeCalibrationSampling };
  }, { fixture, predicted });
  expect(result.valid).toBe(true);
  expect(result.rawX).toBeCloseTo(1155, 0);
  expect(result.rawY).toBeCloseTo(214, 0);
  expect(result.method).toBe('same_eye_iris.v2');
  expect(result.statusMethod).toBe(result.method);
  expect(result.calibrationSampling).toBe('open_eye_calibration.v1');
});

for (const language of ['ru', 'en']) test(`spatial accuracy caveat is visible beside AOI/QC in ${language}`, async ({ page }, testInfo) => {
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/analytics/session-card');
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  if (language === 'en') await page.locator('#langEn').click();
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('.analytics-heatmap-canvas').first()).toBeVisible();
  await expect(page.locator('[data-gaze-spatial-qc]').first()).toContainText(language === 'en' ? 'Gaze validation error' : 'Ошибка проверки взгляда');
  await page.evaluate(() => {
    const production = (window as any).EmocogAnalyticsProduction;
    const channels = production.store.state.summaryResponse.data.qcChannels;
    channels.find(channel => channel.channel === 'gaze').spatialAccuracy = {
      version: 'gaze_spatial_qc.v1', validationStatus: 'passed', meanErrorPx: 148.4, meanErrorPct: 8.8,
      radialErrorSdPx: 80.6, scope: 'pre_session_only', driftStatus: 'not_measured', aoiSuitability: 'not_established',
    };
    production.store.emit();
  });
  await expect(page.locator('[data-gaze-spatial-qc]').first()).toContainText('148.4 px (8.8%)');
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/analytics/data-quality');
  await page.locator('#analyticsApplyFilters').click();
  const caveat = page.locator('[data-gaze-spatial-qc]').first();
  await caveat.locator('summary').click();
  await expect(caveat.locator('p').last()).toBeVisible();
  await expect(caveat).toContainText(language === 'en' ? 'drift during the task was not measured' : 'сдвиг во время задания не измерялся');
  const pdfText = await page.evaluate(() => {
    const body = document.getElementById('analyticsProductionBody')!;
    const progress = document.createElement('span'); progress.setAttribute('role', 'status');
    progress.textContent = 'TRANSIENT_PROGRESS_NOT_IN_PDF'; body.appendChild(progress);
    const text = (window as any).EmocogAnalyticsPdf.capture(body).text;
    progress.remove(); return text;
  });
  expect(pdfText).toContain(language === 'en' ? 'drift during the task was not measured' : 'сдвиг во время задания не измерялся');
  expect(pdfText).not.toContain('TRANSIENT_PROGRESS_NOT_IN_PDF');
  if (process.env.WECOG_ISSUE143_VISUAL_REVIEW === '1') {
    await page.locator('[data-gaze-spatial-qc]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('spatial-qc.png') });
  }
  if (process.env.WECOG_ISSUE143_PDF_REVIEW === '1' && language === 'ru' && testInfo.project.name === 'webkit') {
    const download = page.waitForEvent('download');
    await page.locator('#analyticsPdfDownload').click();
    await (await download).saveAs(testInfo.outputPath('spatial-qc.pdf'));
  }
});
