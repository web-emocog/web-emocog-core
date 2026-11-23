import { test, expect } from '@playwright/test';
const { validateSessionFeaturePayload } = require('../../api/security/payload-policy');

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === baseURL || ['blob:', 'data:'].includes(url.protocol) ? route.continue() : route.abort();
  });
});

test('attempt cards and exclusions retain identity, counts and literal labels in both languages', async ({ page }) => {
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/analytics/session-card');
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.locator('#analyticsApplyFilters').click();
  await page.waitForFunction(() => (window as any).EmocogAnalyticsProduction?.store.state.visualStatus === 'ready');
  await page.evaluate(() => {
    const w = window as any; w.setLang('en');
    const store = w.EmocogAnalyticsProduction.store, s = store.state;
    const base = s.visualResponse.data.contexts[0];
    const context = (attempt: number) => ({ ...base, presentationId: `synthetic-${attempt}`,
      attempt, trialId: 'original-trial', sourceTrialIndex: 8, presentationIndex: attempt,
      attemptStatus: attempt === 1 ? 'excluded' : 'accepted', includedInDefault: attempt === 2,
      qualityIssueCodes: attempt === 1 ? ['protocol_qc_gazeValid', 'page_reloaded', '<img src=x onerror="window.__attemptXss=true">'] : [] });
    s.visualResponse.data.contexts = [context(1), context(2)];
    s.summaryResponse.data.trialCounts = { valid: 1, excluded: 1, total: 2, interrupted: 1 };
    s.summaryResponse.data.metrics = s.summaryResponse.data.metrics.filter((metric: any) => !metric.metricId.startsWith('task.trial_count_'));
    s.summaryResponse.data.exclusions = [{ ...context(1), stimulusId: '10', reasonCode: 'protocol_qc_gazeValid', channel: 'task' }];
    store.emit();
  });
  const badges = page.locator('[data-attempt-status]');
  await expect(badges).toHaveCount(2);
  await expect(badges.nth(0)).toContainText('Excluded from default metrics');
  await expect(badges.nth(1)).toContainText('Attempt 2 (repeat)');
  await expect(page.locator('.ab-report-intro .ab-kpis > div').filter({ has: page.getByText('Eligible trials', { exact: true }) }).locator('dd')).toHaveText('1');
  await page.getByText('Trials and exclusion reasons', { exact: true }).click();
  await expect(page.locator('[data-interrupted-count]')).toHaveText('Interrupted: 1');
  await expect(page.locator('body')).toContainText('Trial 9');
  await expect(page.locator('body')).toContainText('Valid-gaze fraction is below the protocol threshold');
  await expect(page.locator('body')).toContainText('Attempt was interrupted by a page reload');
  await expect(page.locator('[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__attemptXss)).toBeUndefined();
  await page.evaluate(() => { const w = window as any; w.setLang('ru'); w.EmocogAnalyticsProduction.store.emit(); });
  await page.getByText('Пробы и причины исключений', { exact: true }).click();
  await expect(page.locator('[data-interrupted-count]')).toHaveText('Прерванные: 1');
  await expect(page.locator('[data-attempt-status="excluded"]')).toContainText('Исключена из итоговых метрик');
  await expect(page.locator('[data-attempt-status="excluded"]')).toContainText('Попытка прервана перезагрузкой страницы');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-attempt-status="accepted"]')).toContainText('Попытка 2 (повтор)');
});

test('checkpoints and final packets retain full QC counters rather than the current segment alone', async ({ page }) => {
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  const result = await page.evaluate(async () => {
    const s = (window as any).__WECOG_STATE__, runtime = s.runtime.sessionRuntime;
    const qcUrl = location.origin + '/apps/participant-web/js/qc-metrics/QCMetrics.js?v=20261122-validtime1';
    const { QCMetrics } = await import(qcUrl);
    const qc = new QCMetrics(); qc.start({ analysisFpsThreshold: 25 }); qc.stop();
    const summary = qc.getSummary(); summary.totalFrames = 17; summary.counters.totalFrames = 17;
    summary.continuity.segmentCount = 2;
    s.sessionData.ids = { session: 'synthetic-qc-checkpoint', participant: 'synthetic-participant' };
    s.runtime.qcMetrics = { getSummary: () => summary, getCurrentMetrics: () => { throw new Error('Current segment is not a restorable summary'); } };
    const saved = await runtime.saveCheckpoint();
    const checkpoint = await runtime.checkpoints.load();
    const packet = await runtime.delivery.build();
    return { saved, qc: checkpoint.sessionData.qcSummary, packet };
  });
  expect(result.saved).toBe(true);
  expect(result.qc.counters.totalFrames).toBe(17);
  expect(result.qc.continuity.segmentCount).toBe(2);
  expect(result.packet.qcSummary).toEqual(result.qc);
  expect(validateSessionFeaturePayload(result.packet)).toEqual([]);
});

test('a real timed protocol assigns a new presentation identity when the same trial loops', async ({ page }) => {
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  await page.evaluate(async () => {
    const s = (window as any).__WECOG_STATE__;
    s.runtime.sessionRuntime.policyShown = true;
    s.sessionData.ids.session = 'S-timed-loop-synthetic';
    s.sessionData.startTime = Date.now();
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
    const { loadAndStartCognitiveTask } = await import(moduleUrl);
    await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2', blocks: [{
      id: 'timed-loop', type: 'cognitive_task', blockConfig: { useFixation: false, stimulusDuration: 120,
        protocolDurationMs: 2400, showFeedback: false },
      trials: [{ stimulusId: 'std_simple_black_square', duration: 120, condition: 'passive_viewing' }],
    }] } });
  });
  await page.locator('#cogStartBtn').click();
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBeGreaterThan(1);
  const { rows, actual, payload } = await page.evaluate(async () => {
    const data = (window as any).__WECOG_STATE__.sessionData;
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => name.includes('/js/unified-aggregates-new.js'))!;
    const { buildAggregatesPayload } = await import(moduleUrl);
    return { rows: data.cognitiveResults, actual: data.experimentMeta.presentationPlan.actual,
      payload: buildAggregatesPayload(data, { forIngest: true }) };
  });
  expect(new Set(rows.map((row: any) => row.presentationId)).size).toBe(rows.length);
  expect(new Set(rows.map((row: any) => row.trialId)).size).toBe(1);
  expect(rows.every((row: any) => Number.isInteger(row.presentationIndex) && Number.isFinite(row.onsetMs) && row.onsetMs >= 0)).toBe(true);
  expect(rows.every((row: any, index: number) => index === 0 || row.onsetMs > rows[index - 1].onsetMs)).toBe(true);
  expect(actual.filter((row: any) => row.status === 'completed').map((row: any) => row.presentationId))
    .toEqual(rows.map((row: any) => row.presentationId));
  expect(validateSessionFeaturePayload(payload)).toEqual([]);
});
