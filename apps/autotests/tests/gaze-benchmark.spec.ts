import { test, expect, type Page } from '@playwright/test';
import { installGazeAccess } from '../fixtures/gaze-benchmark-auth';
import { landmarksForGaze } from '../../api/tests/fixtures/gaze-topology';
const url = '/apps/participant-web/tools/gaze-benchmark.html';

async function pendingCamera(page: Page) {
  await page.addInitScript(() => {
    const w = window as any; w.cameraRequests = 0; w.stoppedTracks = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => {
      w.cameraRequests++; return new Promise(resolve => { w.finishCamera = () => resolve({
        getTracks: () => [{ stop() { w.stoppedTracks++; } }] }); });
    } } });
  });
}

async function prepareCalibration(page: Page) {
  await installGazeAccess(page);
  await page.addInitScript(landmarks => {
    const w = window as any;
    w.calibrationLandmarks = landmarks; w.completedCaptures = 0; w.stoppedTracks = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({
      getTracks: () => [{ addEventListener() {}, stop() { w.stoppedTracks++; } }],
    }) } });
    Object.defineProperties(HTMLVideoElement.prototype, {
      srcObject: { configurable: true, get() { return (this as any).testStream; }, set(v) { (this as any).testStream = v; } },
      videoWidth: { configurable: true, get: () => 640 }, videoHeight: { configurable: true, get: () => 480 },
    });
    HTMLMediaElement.prototype.play = async () => {};
  }, landmarksForGaze(.2, -.3));
  await page.route('**/precheck-analyzer/PrecheckAnalyzer.js?*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import { rememberFramePixels } from '/apps/participant-web/js/session-runtime/frame-pixels.mjs';
    import { syntheticEyeImage } from '/apps/autotests/fixtures/issue143-eye-image.mjs';
    const landmarks = window.calibrationLandmarks, pixels = syntheticEyeImage(landmarks, { gazeX: .2, gazeY: -.3 });
    export default class Analyzer {
      async initialize() { return true; } dispose() {}
      async analyzeFrame() {
        window.completedCaptures++;
        return rememberFramePixels({ landmarks, timestamp: performance.now(), frameSize: { width: 640, height: 480 } }, pixels);
      }
    }` }));
  await page.route('**/session-runtime/video-frames.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export function observeVideoFrames(video, callback) {
      const id = setInterval(() => callback(performance.now()), 33);
      return { stop() { clearInterval(id); } };
    }` }));
  await page.goto(url);
  await expect(page.locator('#status')).toContainText('Доступ подтверждён');
  await page.locator('#consent').check(); await page.locator('#start').click();
  await expect(page.locator('#calibrate')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).completedCaptures)).toBeGreaterThan(0);
}

test('calibration starts when hiding the preview removes a classic scrollbar', async ({ playwright, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'Native classic scrollbar regression in Chromium');
  const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--disable-features=OverlayScrollbar,OverlayScrollbars'] });
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 1536, height: 826 }, deviceScaleFactor: 1.25 });
    await prepareCalibration(page);
    await page.addStyleTag({ content: '::-webkit-scrollbar { width: 15px } #instructions { min-height: 1800px }' });
    expect(await page.evaluate(() => innerWidth - visualViewport!.width)).toBeGreaterThan(0);
    await page.locator('#calibrate').click();
    // Let the browser deliver the native visualViewport resize, not just the click task.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#status')).toContainText('Калибровка 1/25');
    await expect(page.locator('#target')).toBeVisible();
    expect(await page.evaluate(() => visualViewport!.width)).toBe(1536);
    expect(await page.evaluate(() => (window as any).stoppedTracks)).toBe(0);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => (window as any).stoppedTracks)).toBe(1);
    expect(await page.evaluate(() => innerWidth - visualViewport!.width)).toBeGreaterThan(0);
  } finally { await browser.close(); }
});

test('calibration accepts unchanged geometry events but stops for a real resize', async ({ page }) => {
  await prepareCalibration(page);
  // The window can be resized while preview is open, before a single click is measured.
  await page.setViewportSize({ width: 1100, height: 750 });
  await page.locator('#calibrate').click();
  await expect(page.locator('#target')).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    visualViewport?.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('#status')).toContainText('Калибровка 1/25');
  await page.setViewportSize({ width: 1050, height: 720 });
  await expect(page.locator('#download')).toBeVisible();
  await expect(page.locator('#target')).toBeHidden();
  const { benchmark } = JSON.parse((await page.locator('#result').textContent())!);
  expect(benchmark).toMatchObject({ reason: 'viewport_changed', completed: false, phase: 'calibration',
    environment: { viewport: { width: 1100, height: 750 } } });
  expect(await page.evaluate(() => (window as any).stoppedTracks)).toBe(1);
});

test('a visual zoom change during calibration stops the camera and keeps the original scale in the report', async ({ page }) => {
  await prepareCalibration(page);
  await page.locator('#calibrate').click();
  await expect(page.locator('#target')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(visualViewport!, 'scale', { value: 1.25 });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('#download')).toBeVisible();
  await expect(page.locator('#target')).toBeHidden();
  const { benchmark } = JSON.parse((await page.locator('#result').textContent())!);
  expect(benchmark).toMatchObject({ reason: 'viewport_changed', completed: false, environment: { viewportScale: 1 } });
  expect(await page.evaluate(() => (window as any).stoppedTracks)).toBe(1);
});

test('developer benchmark requires explicit consent/start and Stop closes late camera without transmitting measurements', async ({ page }) => {
  await installGazeAccess(page); await pendingCamera(page);
  const writes: string[] = [];
  page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) writes.push(r.url()); });
  await page.goto(url);
  await expect(page.locator('#consent')).toBeVisible(); await expect(page.locator('#start')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
  await page.locator('#consent').check(); await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#start').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => (window as any).cameraRequests)).toBe(1);
  await expect(page.locator('#protocol')).toBeDisabled();
  await page.locator('#stop').click(); await page.evaluate(() => (window as any).finishCamera());
  await expect.poll(() => page.evaluate(() => (window as any).stoppedTracks)).toBeGreaterThan(0);
  const result = JSON.parse((await page.locator('#result').textContent())!);
  expect(result.version).toBe('gaze_benchmark.v1'); expect(result.benchmark.completed).toBe(false);
  expect(result.benchmark.reason).toBe('user_stop'); expect(result.benchmark.protocol).toBe('spatial.v1');
  expect(result.diagnostics.eyeImageFrames).toBeNull();
  expect(result.diagnostics.scope).toBe('bounded_technical_counts_only_no_incomplete_accuracy_estimate');
  expect(JSON.stringify(result)).not.toMatch(/synthetic@example|"(?:email|token|userAgent|deviceId|landmarks|pixels|weights|rawFrames)"\s*:/);
  await expect(page.locator('#download')).toBeVisible(); await expect(page.locator('#protocol')).toBeEnabled();
  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => (window as any).cameraRequests)).toBe(2);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    (window as any).finishCamera();
  });
  await expect.poll(() => page.evaluate(() => (window as any).stoppedTracks)).toBeGreaterThanOrEqual(2);
  const hidden = JSON.parse((await page.locator('#result').textContent())!);
  expect(hidden.benchmark.reason).toBe('page_hidden'); expect(hidden.benchmark.completed).toBe(false);
  expect(writes).toEqual([]);
});

for (const role of ['respondent', 'researcher', 'org_admin']) test(`developer benchmark denies ${role} before camera`, async ({ page }) => {
  await installGazeAccess(page, role); await pendingCamera(page);
  await page.goto(url); await expect(page).toHaveURL(/apps\/web\/researcher.html/);
  expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
});

test('role is revalidated on Start, not trusted from the initial page or local flags', async ({ page }) => {
  const account = await installGazeAccess(page); await pendingCamera(page); await page.goto(url);
  await expect(page.locator('#status')).toContainText('Доступ подтверждён'); account.role('respondent');
  await page.locator('#consent').check(); await page.locator('#start').click();
  await expect(page.locator('#download')).toBeVisible();
  const result = JSON.parse((await page.locator('#result').textContent())!);
  expect(result.benchmark.reason).toBe('access_denied'); expect(result.benchmark.completed).toBe(false);
  expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
});

test('developer AOI is an explicit program, requires consent and revalidates the account before the camera', async ({ page }) => {
  const access = await installGazeAccess(page, 'admin'); await pendingCamera(page);
  await page.goto(url + '?models=aoi-continuous');
  await expect(page.locator('#protocol')).toBeEnabled();
  await expect(page.locator('#protocol')).toHaveValue('spatial');
  await page.locator('#protocol').selectOption('aoi-continuous');
  await expect(page).toHaveURL(/\?protocol=aoi-continuous$/);
  await expect(page.locator('#modelDescription')).toContainText('обычный eye-patch');
  await expect(page.locator('#modelDescription')).not.toContainText('Четыре модели');
  await expect(page.locator('#status')).toContainText('Доступ подтверждён');
  await expect(page.locator('#start')).toBeDisabled();
  await expect(page.locator('#aoiBoard')).toBeHidden();
  expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
  access.role('researcher');
  await page.locator('#consent').check();
  await page.locator('#start').click();
  await expect(page.locator('#download')).toBeVisible();
  const report = JSON.parse((await page.locator('#result').textContent())!);
  expect(report).toMatchObject({ version: 'gaze_continuous_aoi.v1', benchmark: {
    protocol: 'aoi-continuous.v1', diagnosticSurface: 'developer_panel', completed: false, reason: 'access_denied' } });
  expect(report.aoiBlock).toBeUndefined();
  expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
});

for (const [name, protocol] of [['AOI', 'aoi-continuous'], ['eye-gate', 'eye-gate']]) {
  test(`opening the developer ${name} URL directly does not bypass role access`, async ({ page }) => {
    await installGazeAccess(page, 'researcher'); await pendingCamera(page);
    await page.goto(url + '?protocol=' + protocol);
    await expect(page).toHaveURL(/apps\/web\/researcher.html/);
    expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
  });
}

test('a different cookie account cannot inherit permission from the initial page', async ({ page }) => {
  const account = await installGazeAccess(page); await pendingCamera(page); await page.goto(url);
  await expect(page.locator('#status')).toContainText('Доступ подтверждён'); account.id('2');
  await page.locator('#consent').check(); await page.locator('#start').click();
  await expect(page.locator('#status')).toContainText('Аккаунт изменился');
  await expect(page.locator('#start')).toBeDisabled(); await expect(page.locator('#download')).toBeHidden();
  expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
});

test('missing staff cookie redirects to login without acquiring sensors', async ({ page }) => {
  await installGazeAccess(page); await pendingCamera(page);
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await page.goto(url); await expect(page).toHaveURL(/apps\/web\/developer\/login.html/);
  expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
});

test('missing diagnostic module fails visibly with no sensor request', async ({ page }) => {
  await installGazeAccess(page); await pendingCamera(page);
  await page.route('**/gaze-benchmark-page.mjs?*', route => route.abort());
  await page.goto(url); await expect(page.locator('#status')).toContainText('Не удалось загрузить диагностику');
  await expect(page.locator('#start')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
});

test('restarting while a native model is pending does not initialize two models in parallel', async ({ page }) => {
  await installGazeAccess(page);
  await page.addInitScript(() => {
    const w = window as any; w.initializations = []; w.closedModels = 0; w.stoppedTracks = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({
      getTracks: () => [{ addEventListener() {}, stop() { w.stoppedTracks++; } }] }) } });
    Object.defineProperties(HTMLVideoElement.prototype, {
      srcObject: { configurable: true, get() { return (this as any).testStream; }, set(v) { (this as any).testStream = v; } },
      videoWidth: { configurable: true, get: () => 640 }, videoHeight: { configurable: true, get: () => 480 }
    });
    HTMLMediaElement.prototype.play = async () => {};
  });
  await page.route('**/precheck-analyzer/PrecheckAnalyzer.js?*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export default class Analyzer {
      initialize() { return new Promise(resolve => window.initializations.push(resolve)); }
      dispose() { window.closedModels++; }
      async analyzeFrame() { return { timestamp: performance.now() }; }
    }` }));
  await page.goto(url); await expect(page.locator('#consent')).toBeVisible(); await page.locator('#consent').check();
  await page.locator('#start').click(); await expect.poll(() => page.evaluate(() => (window as any).initializations.length)).toBe(1);
  await page.locator('#stop').click(); await page.locator('#start').click();
  // Both native stages are pending, but only the old one may have been called.
  await expect(page.locator('#status')).toContainText('Подготовка');
  expect(await page.evaluate(() => (window as any).initializations.length)).toBe(1);
  await page.evaluate(() => (window as any).initializations[0](true));
  await expect.poll(() => page.evaluate(() => (window as any).initializations.length)).toBe(2);
  await page.evaluate(() => (window as any).initializations[1](true));
  await expect(page.locator('#calibrate')).toBeVisible(); await page.locator('#stop').click();
  expect(await page.evaluate(() => (window as any).stoppedTracks)).toBe(2);
});

test('sensor policy cannot be bypassed by the benchmark', async ({ page }) => {
  await installGazeAccess(page); await pendingCamera(page); await page.goto(url);
  await expect(page.locator('#consent')).toBeVisible();
  await page.evaluate(() => Object.defineProperty(document, 'permissionsPolicy', {
    configurable: true, value: { allowsFeature: () => false } }));
  await page.locator('#consent').check(); await page.locator('#start').click();
  await expect(page.locator('#download')).toBeVisible();
  const result = JSON.parse((await page.locator('#result').textContent())!);
  expect(result.benchmark.reason).toBe('sensor_policy_denied');
  expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
});

test('account block during camera permission stops late tracks and clears results from the previous owner', async ({ page }) => {
  await installGazeAccess(page); await pendingCamera(page); await page.goto(url);
  await expect(page.locator('#consent')).toBeVisible(); await page.locator('#consent').check(); await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => (window as any).cameraRequests)).toBe(1);
  await page.evaluate(() => { window.dispatchEvent(new Event('wecog:staffsessionblocked')); (window as any).finishCamera(); });
  await expect.poll(() => page.evaluate(() => (window as any).stoppedTracks)).toBeGreaterThan(0);
  await expect(page.locator('#start')).toBeDisabled(); await expect(page.locator('#download')).toBeHidden();
  await expect(page.locator('#result')).toBeEmpty();
});

test('developer benchmark keeps targets and Stop accessible on desktop/mobile without drawing a trail', async ({ page }, testInfo) => {
  await installGazeAccess(page); await pendingCamera(page);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.goto(url + '?protocol=posture');
    await expect(page.locator('#status')).toContainText('Доступ подтверждён');
    if (process.env.WECOG_ISSUE143_VISUAL_REVIEW === '1') await page.screenshot({ path: testInfo.outputPath(`gaze-start-${viewport.width}.png`), fullPage: true });
    await page.evaluate(() => {
      document.body.classList.add('running'); document.getElementById('status')!.textContent = 'Смотрите в центр точки.';
      document.getElementById('stop')!.removeAttribute('disabled');
    });
    for (const [x,y] of [[8,8],[92,8],[8,92],[92,92]]) {
      const atTarget = await page.locator('#target').evaluate((target: HTMLElement, [x,y]) => {
        target.hidden = false; target.style.left = x + '%'; target.style.top = y + '%';
        const box = target.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width/2, box.y + box.height/2)?.id;
      }, [x,y]);
      expect(atTarget).toBe('target');
    }
    await expect(page.locator('#instructions')).toBeHidden(); await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.locator('#target').evaluate(target => getComputedStyle(target).transitionDuration)).toBe('0s');
    if (process.env.WECOG_ISSUE143_VISUAL_REVIEW === '1') await page.screenshot({ path: testInfo.outputPath(`gaze-target-${viewport.width}.png`) });
    expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
  }
});

test('eye-gate reading cue stays beside the dot on desktop and narrow screens without acquiring sensors', async ({ page }, testInfo) => {
  await installGazeAccess(page); await pendingCamera(page);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(url + '?protocol=eye-gate');
    await expect(page.locator('#status')).toContainText('Доступ подтверждён');
    await page.evaluate(() => {
      document.body.classList.add('running'); document.body.dataset.eyeGateCue = 'prepare';
      document.getElementById('status')!.textContent = 'Мягко закройте глаза примерно на 2 секунды, затем откройте.';
      const target = document.getElementById('target')!;
      target.hidden = false; target.style.left = '50%'; target.style.top = '50%';
    });
    const dot = (await page.locator('#target').boundingBox())!;
    const hint = (await page.locator('#status').boundingBox())!;
    expect(hint.x).toBeGreaterThanOrEqual(0);
    expect(hint.x + hint.width).toBeLessThanOrEqual(viewport.width);
    expect(hint.y).toBeGreaterThan(0);
    expect(hint.y + hint.height).toBeLessThan(dot.y);
    expect(Math.abs(hint.x + hint.width / 2 - dot.x - dot.width / 2)).toBeLessThan(1);
    if (process.env.WECOG_ISSUE143_VISUAL_REVIEW === '1') {
      await page.screenshot({ path: testInfo.outputPath(`eye-gate-reading-${viewport.width}.png`) });
    }
    expect(await page.evaluate(() => (window as any).cameraRequests)).toBe(0);
  }
});
