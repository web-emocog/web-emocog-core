import { test, expect } from '@playwright/test';

const participant = 'http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html';
const version = '20261019-5';

test('cumulative physiology survives reload and repeated snapshots cannot duplicate measurements', async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.sessionRuntime);
  const initial = await page.evaluate(async () => {
    const state = (window as any).__WECOG_STATE__;
    state.sessionData.ids.session = 'physiology-history';
    state.sessionData.continuousSignalState = { sampleCount: 100, validSampleCount: 90, bpmMean: 80,
      validRespSampleCount: 80, respRateMean: 12 };
    const runtime = state.runtime.sessionRuntime;
    runtime.framePipeline = { getBpmSnapshot: () => ({ ready: true, sampleCount: 10, validSampleCount: 10,
      bpmMean: 100, validRespSampleCount: 10, respRateMean: 18 }) };
    const first = runtime.getBpmSnapshot(), second = runtime.getBpmSnapshot();
    await runtime.saveCheckpoint();
    return { mean: first.bpmMean, count: first.validSampleCount, repeatedCount: second.validSampleCount };
  });
  expect(initial).toEqual({ mean: 82, count: 100, repeatedCount: 100 });
  await page.reload();
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.sessionData?.ids?.session === 'physiology-history');
  const resumed = await page.evaluate(async () => {
    const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
    runtime.framePipeline = { getBpmSnapshot: () => ({ ready: true, sampleCount: 5, validSampleCount: 5,
      bpmMean: 100, validRespSampleCount: 0, respRateMean: null }) };
    const result = runtime.getBpmSnapshot();
    await runtime.checkpoints.clear('physiology-history');
    return result;
  });
  expect(resumed.validSampleCount).toBe(105);
  expect(resumed.bpmMean).toBeCloseTo((82 * 100 + 100 * 5) / 105);
  expect(resumed.validRespSampleCount).toBe(90);
});

test('corrupt accumulated heatmap blocks unsafe recovery without erasing the stored session', async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto(participant);
  await page.evaluate(async version => {
    const { SessionCheckpointStore } = await import(new URL(`js/session-runtime/checkpoint-store.mjs?v=${version}`, location.href).href);
    await new SessionCheckpointStore().save('corrupt-history', { ids: { session: 'corrupt-history' },
      heatmapState: { schemaVersion: 'heatmap_accumulator.v1', options: {}, summary: {} } }, { state: 'running' });
  }, version);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__?.runtime?.sessionRuntime?.checkpointRestoreFailed)).toBe(true);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.sessionRuntime.checkpoints.getActiveSessionId())).toBe('corrupt-history');
});

for (const language of ['ru', 'en']) test(`truncated heatmap details are visibly labelled in ${language}`, async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/apps/web/researcher.html?analyticsPreview=1#/analytics/session-card');
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  if (language === 'en') await page.locator('#langEn').click();
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('.analytics-heatmap-canvas').first()).toBeVisible();
  await page.evaluate(() => {
    const production = (window as any).EmocogAnalyticsProduction;
    production.store.state.visualResponse.data.reason = 'gaze_presentations_truncated';
    production.store.state.visualResponse.data.contexts[0].heatmap.reason = 'gaze_fixations_truncated';
    production.store.emit();
  });
  await expect(page.getByRole('status').filter({ hasText: language === 'en' ? '200-presentation' : '200 показов' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: language === 'en' ? 'limited to 500' : 'сокращён до 500' })).toBeVisible();
});
