import { test, expect, Page } from '@playwright/test';

const participant = process.env.PAGE_URL || 'http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html';

test.beforeEach(async ({ page }) => {
  await page.route('**/auth/me', route => route.fulfill({
    status: 401,
    headers: { 'Access-Control-Allow-Origin': new URL(participant).origin, 'Access-Control-Allow-Credentials': 'true' },
    json: { error: 'Synthetic unauthenticated session' }
  }));
});

async function loadTask(page: Page, fixation = false, media = false) {
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  await page.evaluate(async ({ fixation, media }) => {
    const shared = (window as any).__WECOG_STATE__;
    shared.runtime.sessionRuntime.policyShown = true;
    shared.runtime.sessionRuntime.notifyBlockComplete = async () => true;
    if (media) {
      shared.runtime.invitationStimuliMap = { '42': {
        id: '42', name: 'Photodiode retry fixture', mime_type: 'image/png',
        metadata: { url: new URL('photodiode-fixture.png', location.href).href },
      } };
    }
    const pd = (window as any).Photodiode;
    const signal = pd.signal;
    (window as any).__pdCalls = [];
    pd.signal = (kind: string) => {
      const calls = (window as any).__pdCalls;
      const square = document.getElementById('cogShape')!;
      calls.push({ kind, at: performance.now(), shapeDisplay: square.style.display,
        fixationDisplay: document.getElementById('cogFixation')?.style.display });
      return signal(kind);
    };
    const task = await import(new URL('js/web-page/experimental_task-updated.js?v=20261008-2', location.href).href);
    await task.loadAndStartCognitiveTask({ autoFinishSession: false, protocol: {
      version: 'v2-photodiode-regression', blocks: [{ id: 'photodiode-task', type: 'cognitive_task', taskType: 'simple_rt',
        blockConfig: { useFixation: fixation, fixation: { duration: 650 }, stimulusDuration: 5000, responseMode: 'keypress' },
        trials: [media
          ? { stimulusId: '42', action: 'я', duration: 5000 }
          : { stimulusId: 'std_simple_black_square', action: 'я', duration: 5000 }] }],
    } });
  }, { fixation, media });
}

test('temporary local notice is opt-in and the square is hidden before the protocol', async ({ page }) => {
  await page.goto(participant);
  await expect(page.locator('#photodiodeTemporaryNotice')).toBeVisible();
  await expect(page.locator('#photodiodeTemporaryToggle')).not.toBeChecked();
  await expect(page.locator('#photodiode')).toBeHidden();
  await page.locator('#photodiodeTemporaryToggle').check();
  expect(await page.evaluate(() => (window as any).Photodiode.isEnabled())).toBe(true);
  await expect(page.locator('#photodiode')).toBeHidden();
  await page.locator('#participantLanguageSelect').selectOption('en');
  await expect(page.locator('#photodiodeTemporaryText')).toContainText('Temporary local feature');
  await expect(page.locator('#photodiodeTemporaryText')).not.toContainText('Временная');
});

test('normal experiments do not emit markers or change their data', async ({ page }) => {
  await page.goto(participant);
  await loadTask(page);
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
  await page.keyboard.press('KeyZ');
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__pdCalls.length)).toBe(0);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.experimentMeta.photodiode)).toBeUndefined();
  await expect(page.locator('#photodiode')).toBeHidden();
});

test('stimulus marker follows fixation and RT excludes the pre-task marker codes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${participant}?photodiode=1`);
  await expect(page.locator('#photodiodeTemporaryToggle')).toBeChecked();
  await loadTask(page, true);
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__pdCalls.filter((call: any) => call.kind === 'stimulus').length)).toBe(1);
  const marker = await page.evaluate(() => (window as any).__pdCalls.find((call: any) => call.kind === 'stimulus'));
  expect(marker.fixationDisplay).toBe('none');
  expect(marker.shapeDisplay).not.toBe('none');
  const interval = await page.evaluate(() => {
    const events = (window as any).__WECOG_STATE__.sessionData.events;
    const start = events.find((event: any) => event.type === 'trial_start');
    const onset = events.find((event: any) => event.type === 'stimulus_on');
    return { fixation: start.fixationDuration, elapsed: onset.timestamp - start.timestamp };
  });
  expect(interval.fixation).toBe(650);
  expect(interval.elapsed).toBeGreaterThanOrEqual(600);
  await page.waitForTimeout(120);
  await page.keyboard.press('KeyZ');
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
  const result = await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults[0]);
  expect(result).toMatchObject({ response: 'KeyZ', correct: true });
  // WebDriver latency is not RT. Verify the baseline against the actual decision clock.
  expect(result.decisionTimestampMs).toBeGreaterThan(marker.at);
  expect(Math.abs(result.rt - (result.decisionTimestampMs - marker.at))).toBeLessThan(30);
  await expect(page.locator('#photodiode')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.events
    .find((event: any) => event.type === 'photodiode_marker'))).toMatchObject({ status: 'emitted', timingValidated: false });
  expect(errors).toEqual([]);
});

test('failed media emits no stimulus marker and retry marks only the loaded image', async ({ page }) => {
  let available = false;
  await page.route('**/photodiode-fixture.png', async route => {
    if (!available) { await route.fulfill({ status: 404, body: '' }); return; }
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
  });
  await page.goto(`${participant}?photodiode=1`);
  await loadTask(page, false, true);
  await page.locator('#cogStartBtn').click();
  const retry = page.getByRole('button', { name: /Повторить загрузку|Retry loading/ });
  await expect(retry).toBeVisible();
  expect(await page.evaluate(() => (window as any).__pdCalls.filter((call: any) => call.kind === 'stimulus').length)).toBe(0);
  available = true;
  await retry.click();
  await expect(page.locator('#cogImage')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__pdCalls.filter((call: any) => call.kind === 'stimulus').length)).toBe(1);
  await page.keyboard.press('KeyZ');
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
});

test('start and finish codes settle without leaving an overlay or duplicate runs', async ({ page }) => {
  await page.goto(`${participant}?photodiode=1`);
  const result = await page.evaluate(async () => {
    const pd = (window as any).Photodiode;
    const started = await pd.begin();
    const first = pd.finish();
    const same = first === pd.finish();
    const ended = await first;
    return { same, startPulses: started.pulses, endPulses: ended.pulses, active: pd.isActive() };
  });
  expect(result).toEqual({ same: true, startPulses: 4, endPulses: 4, active: false });
  await expect(page.locator('#photodiode')).toBeHidden();
});
