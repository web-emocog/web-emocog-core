import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === baseURL || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort();
  });
});

test('the participant runtime counts sparse estimates and preserves the interrupted interval on reload', async ({ page }) => {
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime?.initialized));
  const before = await page.evaluate(async () => {
    const state = (window as any).__WECOG_STATE__;
    const runtime = state.runtime.sessionRuntime;
    // Wait for initial IndexedDB discovery before writing the test session.
    await runtime.checkpoints.load();
    state.sessionData.ids = { session: 'synthetic-interval-reload' };
    state.sessionData.startTime = Date.now();
    runtime.restorePhysiologyIntervals();
    runtime.beginBlock({ id: 'synthetic-rt', type: 'cognitive_task' });
    const start = performance.now();
    const cfg = { windowSec: 0, respiration: { windowSec: 0 }, updateEveryMs: 500 };
    const value = { published: true, bpm: 82, respRate: 14 };
    for (let i = 0; i <= 30; i++) {
      runtime.recordPhysiologyFrame(start + i * 50, i % 10 === 0 ? value : null, cfg, true);
    }
    // Missing face breaks coverage even when the next estimate is on schedule.
    runtime.recordPhysiologyFrame(start + 1750, null, cfg, false);
    runtime.recordPhysiologyFrame(start + 2000, value, cfg, true);
    await runtime.saveCheckpoint();
    const packet = await runtime.checkpointBuilder.build(state.sessionData);
    return { data: packet.physiology_intervals, storage: runtime.checkpoints.lastPersistenceMode };
  });
  expect(before.storage).toBe('indexeddb');
  expect(before.data.blocks[0].status).toBe('in_progress');
  expect(before.data.blocks[0].heartRate).toEqual({ mean: 82, count: 5, observedMs: 1500 });
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__?.runtime?.sessionRuntime?.reloadRecovery?.repeatRequired)).toBe(true);
  const after = await page.evaluate(() => {
    const state = (window as any).__WECOG_STATE__;
    const runtime = state.runtime.sessionRuntime;
    runtime.capturePhysiologyIntervals();
    return state.sessionData.physiologyIntervals;
  });
  expect(after.blocks[0]).toEqual({ ...before.data.blocks[0], status: 'interrupted' });
  expect(after.minutes[0].heartRate).toEqual(before.data.minutes[0].heartRate);
});

test('the session shows coverage, missing measurements and separate attempts in both languages', async ({ page }) => {
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/analytics/session-card');
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.locator('#analyticsApplyFilters').click();
  await page.waitForFunction(() => (window as any).EmocogAnalyticsProduction?.store.state.summaryStatus === 'ready');
  await page.evaluate(() => {
    const w = window as any;
    w.setLang('en');
    const store = w.EmocogAnalyticsProduction.store;
    const data = store.state.summaryResponse.data;
    const row = { startMs: 0, endMs: 60000, heartRate: { mean: 81, count: 60, observedMs: 30000 },
      respiration: { mean: null, count: 0, observedMs: 0 } };
    const blockId = '<img src=x onerror="window.__physiologyXss=true">';
    data.physiologyIntervals = { schemaVersion: 'physiology_intervals.v1', throughMs: 120000, truncated: true, minutes: [row],
      blocks: [{ ...row, blockId, attempt: 1, status: 'repeat_required' },
        { ...row, startMs: 60000, endMs: 120000, blockId, attempt: 2, status: 'accepted' }] };
    store.emit();
  });
  const panel = page.locator('#analyticsPhysiologyIntervals');
  await expect(panel).toContainText('Interval history is incomplete');
  await panel.getByText('By minute').click();
  const minutes = panel.locator('[data-physiology-intervals="minutes"]');
  await expect(minutes.getByText('81 bpm')).toBeVisible();
  await expect(minutes.getByText('Estimates: 60 · Coverage: 50%')).toBeVisible();
  await expect(minutes.getByText('No data')).toBeVisible();
  await panel.getByText('By block and attempt').click();
  await expect(panel.getByText('Attempt 1 · Repeat required')).toBeVisible();
  await expect(panel.getByText('Attempt 2 · Accepted')).toBeVisible();
  await expect(panel.locator('[onerror]')).toHaveCount(0);
  await page.evaluate(() => { const w = window as any; w.setLang('ru'); w.EmocogAnalyticsProduction.store.emit(); });
  await panel.getByText('По блокам и попыткам').click();
  await expect(panel.getByText('Попытка 1 · Потребовался повтор')).toBeVisible();
});
