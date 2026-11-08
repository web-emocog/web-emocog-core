import { test, expect, type Page } from '@playwright/test';
import { installGazeAccess } from '../fixtures/gaze-benchmark-auth';
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
