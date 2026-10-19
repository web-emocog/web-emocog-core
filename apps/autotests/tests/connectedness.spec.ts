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

test('unspecified conditions remain distinct from all trials and legitimate placeholder-like names', async ({ page }) => {
  await page.evaluate(async () => {
    const production = (window as any).EmocogAnalyticsProduction;
    const load = production.api.sessionSummary;
    production.api.sessionSummary = async (...args: any[]) => {
      const result = await load(...args);
      result.data.connectedness.trials[0].condition = null;
      result.data.connectedness.trials[1].condition = '';
      result.data.connectedness.trials[2].condition = '__missing__';
      return result;
    };
    await production.store.loadSessionSummary();
  });
  const condition = page.locator('#connectednessCondition');
  await expect(condition.locator('option')).toHaveCount(4);
  await condition.selectOption({ label: 'Не указано' });
  await expect(page.locator('#connectednessResults tbody tr')).toHaveCount(2);
  await page.locator('#connectednessBlock').selectOption('rt');
  await expect(page.locator('#connectednessResults')).toContainText('не вычислено');
  await condition.selectOption('__missing__');
  await expect(page.locator('#connectednessResults tbody tr')).toHaveCount(1);
  await condition.selectOption('');
  await expect(page.locator('#connectednessResults tbody tr')).toHaveCount(5);
  await page.locator('#connectednessModule summary').click();
  await expect(page.locator('#connectednessModule details')).toContainText('ограничение отображения');
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

test('timeline, scatter plot, table and keyboard select the same trial and zoom follows it', async ({ page }) => {
  const timeline = page.getByRole('img', { name: 'Временная шкала стимулов и ответов' });
  await expect(page.locator('#connectednessPrevious')).toBeDisabled();
  await timeline.locator('[data-trial-index="2"]').click();
  await expect(page.locator('#connectednessTrial')).toHaveValue('2');
  await expect(page.locator('#connectednessTrialDetails h3')).toContainText('trial-2');
  await expect(page.locator('#connectednessResults tbody button[aria-pressed="true"]')).toContainText('trial-2');
  await page.locator('#connectednessZoom').selectOption('5000');
  await expect(timeline.locator('[data-trial-index]')).toHaveCount(1);
  await page.locator('#connectednessNext').click();
  await expect(page.locator('#connectednessTrial')).toHaveValue('3');
  await expect(timeline.locator('[aria-pressed="true"]')).toHaveAttribute('data-trial-index', '3');
  await page.locator('#connectednessPrevious').click();
  await page.locator('#connectednessZoom').selectOption('0');
  await timeline.locator('[data-trial-index="1"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#connectednessTrial')).toHaveValue('1');
  await timeline.locator('[data-trial-index="0"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#connectednessTrial')).toHaveValue('0');
  const plot = page.getByRole('img', { name: 'RT и выбранный сигнал' });
  await plot.locator('[data-trial-index="2"]').click();
  await expect(page.locator('#connectednessTrial')).toHaveValue('2');
  await expect(plot.locator('[data-trial-index="2"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#connectednessResults tbody button[data-trial-index="4"]').click();
  await expect(page.locator('#connectednessNext')).toBeDisabled();
  await expect(page.locator('#connectednessTrialDetails img')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#connectednessJson').click();
  const file = await (await downloadEvent).path();
  const result = JSON.parse(await readFile(file!, 'utf8'));
  expect(result.view.selectedTrialId).toContain('<img');
  expect(result.report.trials).toHaveLength(5);
});

test('respiration displays fresh event context, not short-window physiology correlations', async ({ page }) => {
  await page.evaluate(async () => {
    const api = (window as any).EmocogAnalyticsProduction;
    const load = api.api.sessionSummary;
    api.api.sessionSummary = async (...args: any[]) => {
      const response = await load(...args);
      response.data.connectedness.trials.forEach((trial: any, index: number) => {
        const metric = trial.windows.response.channels.respiration;
        Object.assign(metric, { value: 12 + index, n: 1, nValid: 1, validFraction: 1, maxGapMs: 100, status: 'observed' });
      });
      return response;
    };
    await api.store.loadSessionSummary();
  });
  await page.locator('#connectednessBlock').selectOption('rt');
  await page.locator('#connectednessCondition').selectOption('go');
  await page.locator('#connectednessChannel').selectOption('respiration');
  await expect(page.locator('#connectednessResults')).toContainText('ρ для коротких окон отключён');
  await expect(page.locator('#connectednessResults')).not.toContainText('ρ: 1.000');
  await expect(page.locator('#connectednessResults tbody tr').first()).toContainText('12.000');
  await expect(page.locator('#connectednessTrialDetails')).toContainText('не мгновенную реакцию');
  await page.locator('#connectednessTrial').selectOption('2');
  await expect(page.locator('#connectednessTrialDetails')).toContainText('14.000');
});

test('legacy reports without respiration stay interactive and mobile layout contains long identifiers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const api = (window as any).EmocogAnalyticsProduction, load = api.api.sessionSummary;
    api.api.sessionSummary = async (...args: any[]) => {
      const result = await load(...args);
      result.data.connectedness.trials.forEach((trial: any) => {
        trial.trialId = 'long-identifier-'.repeat(30);
        Object.values(trial.windows).forEach((period: any) => delete period.channels.respiration);
      });
      return result;
    };
    await api.store.loadSessionSummary();
  });
  await page.locator('#connectednessChannel').selectOption('respiration');
  await expect(page.locator('#connectednessResults tbody tr')).toHaveCount(5);
  await expect(page.locator('#connectednessTrialDetails')).toContainText('Нет данных');
  await page.locator('#connectednessNext').click();
  await expect(page.locator('#connectednessTrial')).toHaveValue('1');
  const widths = await page.locator('#connectednessModule').evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
});
