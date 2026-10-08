import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const pageUrl = 'http://127.0.0.1:4173/apps/web/researcher.html?analyticsPreview=1#/analytics/connectedness';
test.beforeEach(async ({ page }) => {
  await page.goto(pageUrl);
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  const source = await readFile(path.resolve(__dirname, '../../shared/rt-alignment.js'), 'utf8');
  await page.addScriptTag({ content: source });
  await page.evaluate(() => {
    const w = window as any;
    const events: any[] = [], gaze: any[] = [];
    for (let index = 0; index < 5; index++) {
      const timestamp = 10000 + index * 4000, trialId = index === 4 ? '<img src=x onerror=alert(1)>' : 'trial-' + index;
      events.push({ type: 'stimulus_on', timestamp, blockId: 'rt', trialId, stimulusId: 's', response_mode: 'keyboard', condition: 'go' });
      events.push({ type: 'response', timestamp: timestamp + 200 + index * 100, blockId: 'rt', trialId, responded: true, rtMs: 200 + index * 100 });
      events.push({ type: 'trial_end', timestamp: timestamp + 200 + index * 100, blockId: 'rt', trialId, correct: true, qualityValid: index !== 3 });
      for (let sample = 0; sample < 4; sample++) gaze.push({ t: timestamp + sample * 40, valid: sample <= index, correctedX: 100, correctedY: 200 });
    }
    w.EmocogAnalyticsProduction.api.sessionSummary = async (_id: number, snapshot: any) => ({ kind: 'session_summary', snapshot,
      data: { connectedness: { ...w.EmocogRtAlignment.build({ events, eyeTracking: gaze }), sessionId: 105, source: 'stored_event_windows' } } });
  });
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('#connectednessModule')).toBeVisible();
});

test('real trial windows render, rejected trials are excluded from pairs, labels are escaped and CSV matches snapshot', async ({ page }) => {
  await expect(page.locator('#connectednessResults')).toContainText('5');
  await expect(page.locator('#connectednessResults tbody tr')).toHaveCount(5);
  await expect(page.locator('#connectednessResults img')).toHaveCount(0);
  await page.locator('#connectednessBlock').selectOption('rt');
  await page.locator('#connectednessCondition').selectOption('go');
  await expect(page.locator('#connectednessResults')).toContainText('ρ: 1.000');
  await expect(page.getByRole('img', { name: 'Временная шкала стимулов и ответов' })).toBeVisible();
  await page.locator('#connectednessChannel').selectOption('bpm');
  await expect(page.locator('#connectednessResults')).toContainText('Нет данных');
  const downloaded = page.waitForEvent('download');
  await page.locator('#connectednessCsv').click();
  const download = await downloaded;
  const file = await download.path();
  expect(file).toBeTruthy();
  const csv = await readFile(file!, 'utf8');
  expect(csv).toContain('preview-snapshot-001');
  expect(csv).toContain('maxGapMs');
  expect(csv).toContain('trial-0');
});

test('snapshot race cannot show results from an earlier selection', async ({ page }) => {
  await page.evaluate(async () => {
    const production = (window as any).EmocogAnalyticsProduction;
    let release: (value: any) => void = () => {};
    production.api.createSnapshot = () => new Promise(resolve => { release = resolve; });
    const pending = production.store.apply();
    production.store.setFilter('includeIncompleteSessions', true);
    release({ id: 'stale-snapshot', datasetHash: 'wrong', queryEcho: {} });
    await pending;
  });
  await expect(page.locator('#connectednessModule')).toHaveCount(0);
  const state = await page.evaluate(() => ({ snapshot: (window as any).EmocogAnalyticsProduction.store.state.snapshot?.id,
    dirty: (window as any).EmocogAnalyticsProduction.store.state.dirty }));
  expect(state.snapshot).not.toBe('stale-snapshot');
  expect(state.dirty).toBe(true);
});

test('English labels and API failure state do not expose stale results or stack traces', async ({ page }) => {
  await page.locator('#langEn').click();
  await expect(page.getByRole('heading', { name: 'RT and synchronized signals' })).toBeVisible();
  await expect(page.locator('#connectednessAvailability')).toContainText('Participant video is not stored');
  await page.evaluate(async () => {
    const production = (window as any).EmocogAnalyticsProduction;
    production.api.sessionSummary = async () => { throw new Error('SECRET SQL stack trace'); };
    await production.store.loadSessionSummary();
  });
  await expect(page.getByText('Could not load connectedness')).toBeVisible();
  await expect(page.locator('#connectednessModule')).toHaveCount(0);
  await expect(page.getByText('SECRET SQL stack trace')).toHaveCount(0);
});
