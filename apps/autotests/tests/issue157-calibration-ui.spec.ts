import { test, expect, type Page } from '@playwright/test';
import { landmarksForGaze } from '../../api/tests/fixtures/gaze-topology';

async function prepare(page: Page, fps: number) {
  await page.clock.install();
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.addInitScript(() => {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error('Physical capture forbidden'); };
  });
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.sessionRuntime);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(async ({ landmarks, fps }) => {
    const w = window as any;
    await w.GazeTrackerReady;
    // Model classic scrollbars: the scrollable preparation page is 17 px narrower.
    w.extraViewportWidth = 0;
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => ({
      width: innerWidth - ((document.querySelector('.container') as HTMLElement).style.display === 'none' ? 0 : 17) + w.extraViewportWidth,
      height: innerHeight, offsetLeft: 0, offsetTop: 0, scale: 1,
    }) });
    const s = w.__WECOG_STATE__;
    s.sessionData.precheck = { pass_fail: true };
    s.runtime.localAnalyzer = {};
    s.runtime.sessionRuntime.startContinuousModules = async () => true;
    s.runtime.sessionRuntime.isAnalysisRunning = () => true;
    s.runtime.sessionRuntime.stopContinuousModules = async () => {
      w.calibrationStopCalls = (w.calibrationStopCalls || 0) + 1;
      s.runtime.sessionRuntime.isAnalysisRunning = () => false;
    };
    if (fps) setInterval(() => {
      s.runtime.lastPrecheckResult = { timestamp: performance.now(), landmarks,
        eyes: { bothOpen: true }, pose: { status: 'stable', yaw: 0, pitch: 0, roll: 0 } };
    }, 1000 / fps);
    const moduleUrl = '/apps/participant-web/js/web-page/tests-updated.js?v=20261110-integration1';
    const module = await import(moduleUrl);
    w.calibrationPrepared = module.startCalibration();
  }, { landmarks: landmarksForGaze(0, 0), fps });
  await expect(page.locator('#calibrationIntro')).toBeVisible();
  await page.locator('#calibrationIntroStartBtn').evaluate((button: HTMLElement) => button.click());
  await page.evaluate(() => (window as any).calibrationPrepared);
}

for (const fps of [19, 30]) test(`classic-scrollbar transition accepts two distinct captures at ${fps} FPS`, async ({ page }) => {
  await prepare(page, fps);
  const point = page.locator('#fullscreenCalibPoint');
  const original = await point.evaluate((el: HTMLElement) => el.style.left);
  for (let click = 0; click < 2; click++) {
    await point.evaluate((el: HTMLElement) => el.click());
    await expect(point).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#calibrationCaptureStatus')).toBeVisible();
    await expect(page.locator('#calibrationCaptureStatus')).toContainText('Собираем кадры');
    await page.clock.runFor(2100);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(click + 1);
  }
  expect(await point.evaluate((el: HTMLElement) => el.style.left)).not.toBe(original);
});

test('a real viewport change rejects old geometry and requires an acknowledged new calibration', async ({ page }) => {
  await prepare(page, 30);
  await page.evaluate(() => { (window as any).extraViewportWidth = 20; });
  await page.locator('#fullscreenCalibPoint').evaluate((el: HTMLElement) => el.click());
  await expect(page.locator('#calibrationIntro')).toBeVisible();
  await expect(page.locator('#calibrationIntroText')).toContainText('Размер видимой области или масштаб изменился');
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(0);
  await expect(page.locator('#fullscreenCalibPoint')).toBeHidden();
  await page.locator('#calibrationIntroStartBtn').click();
  await expect(page.locator('#fullscreenCalibPoint')).toBeVisible();
  await page.locator('#fullscreenCalibPoint').evaluate((el: HTMLElement) => el.click());
  await page.clock.runFor(2100);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(1);
});

test('missing usable frames show an explanation after the bounded capture, without counting a click', async ({ page }) => {
  await prepare(page, 0);
  await page.locator('#fullscreenCalibPoint').evaluate((el: HTMLElement) => el.click());
  await page.clock.runFor(2100);
  await expect(page.locator('#calibInstructionText')).toContainText('Не хватило подходящих кадров');
  await expect(page.locator('#calibProgressText')).toContainText('(0/2)');
  await expect(page.locator('#calibrationRecoveryBtn')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(0);
});
