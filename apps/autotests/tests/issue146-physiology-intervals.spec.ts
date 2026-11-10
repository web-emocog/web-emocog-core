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
    const value = { published: true, bpm: 82, respRate: 14, respConf: .8,
      bpmMethodVersion: 'continuous_signals.v2', respMethodVersion: 'respiration_luma.log_peak.v2' };
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
  expect(before.data.blocks[0].heartRate).toEqual({ mean: 82, count: 5, observedMs: 1500, methodVersion: 'continuous_signals.v2' });
  expect(before.data.blocks[0].respiration.methodVersion).toBe('respiration_luma.log_peak.v2');
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
    data.physiologyIntervals.minutes.push({ ...row, startMs: 60000, endMs: 120000,
      heartRate: { mean: 83, count: 4, observedMs: 2000 },
      respiration: { mean: 9.375, count: 3, observedMs: 1800, methodVersion: 'respiration_luma.log_peak.v2' } });
    store.emit();
  });
  const panel = page.locator('#analyticsPhysiologyIntervals');
  await expect(panel).toContainText('Interval history is incomplete');
  await expect(panel.locator('[data-physiology-limitation]')).toContainText('only the covered part');
  await expect(panel.locator('[data-physiology-limitation]')).toContainText('brightness');
  await expect(page.locator('[data-respiration-limitation]')).toContainText('illumination');
  await panel.getByText('By minute').click();
  const minutes = panel.locator('[data-physiology-intervals="minutes"]');
  await expect(minutes.getByText('81 bpm')).toBeVisible();
  await expect(minutes.getByText('Estimates: 60 · Coverage: 50%')).toBeVisible();
  await expect(minutes.getByText('No data')).toBeVisible();
  await expect(minutes.getByText('Estimates: 3 · Coverage: 3%')).toBeVisible();
  await expect(minutes.getByText('9.4 breaths/min')).toBeVisible();
  await expect(minutes.locator('[data-interval-method]').filter({ hasText: 'respiration_luma.log_peak.v2' })).toBeVisible();
  await panel.getByText('By block and attempt').click();
  await expect(panel.getByText('Attempt 1 · Repeat required')).toBeVisible();
  await expect(panel.getByText('Attempt 2 · Accepted')).toBeVisible();
  await expect(panel.locator('[onerror]')).toHaveCount(0);
  await page.evaluate(() => { const w = window as any; w.setLang('ru'); w.EmocogAnalyticsProduction.store.emit(); });
  await panel.getByText('По блокам и попыткам').click();
  await expect(panel.getByText('Попытка 1 · Потребовался повтор')).toBeVisible();
  await expect(panel.locator('[data-physiology-limitation]')).toContainText('только покрытую часть');
  await expect(page.locator('[data-respiration-limitation]')).toContainText('освещения');
});

test('respiration peak refinement is identical in the browser engine and preserves publication gates', async ({ page }) => {
  await page.goto('/apps/participant-web/run_new.html');
  const result = await page.evaluate(async () => {
    const base = location.origin + '/lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/';
    const { estimateRespirationRate, RESPIRATION_METHOD_VERSION } = await import(base + 'signal/respiration.js?v=20261107-resp1');
    const { publishedRespiration } = await import(location.origin + '/apps/participant-web/js/session-runtime/continuous-bpm.js?v=20261107-resp2');
    const { RppgEngine } = await import(base + 'index.js?v=20261107-resp1');
    const { RppgEngine: Direct } = await import(base + 'RppgEngine.js?v=20261107-resp1');
    const estimate = estimateRespirationRate(Array.from({ length: 200 }, (_, i) => Math.sin(2 * Math.PI * 9 / 60 * i / 10)), 10);
    const features = { respRate: estimate.bpm, respConf: estimate.conf, respPublished: true };
    return { rate: estimate.bpm, confidence: estimate.conf, method: RESPIRATION_METHOD_VERSION,
      sameEngine: RppgEngine === Direct, fresh: publishedRespiration(features),
      held: publishedRespiration({ ...features, respHeld: true }),
      rejected: publishedRespiration({ ...features, respConf: .19 }) };
  });
  expect(result.method).toBe('respiration_luma.log_peak.v2');
  expect(result.sameEngine).toBe(true);
  expect(result.rate).toBeCloseTo(8.93324160235, 8);
  expect(result.confidence).toBeCloseTo(.38362911935, 8);
  expect(result.fresh).toBe(result.rate);
  expect(result.held).toBeNull();
  expect(result.rejected).toBeNull();
});
