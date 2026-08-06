import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const BASE = process.env.EMOCOG_WEB_URL || 'http://127.0.0.1:4173';
const researcher = (route: string) => `${BASE}/researcher.html?analyticsPreview=1#/${route}`;

test.beforeEach(async ({ page }) => {
  await page.goto(researcher('analytics/session-card'));
  await page.evaluate(() => {
    localStorage.removeItem('emocog_analytics_query_draft_v1');
    localStorage.removeItem('emocog_analytics_plan_draft');
  });
  await page.reload();
  await expect(page.locator('#analyticsProjectFilter')).toBeVisible();
});

test('AOI remains block-scoped when training and main share one stimulus', async ({ page }) => {
  await page.evaluate(() => {
    // @ts-expect-error application globals
    stimuliList = [{ id: 'shared-stimulus', name: 'Shared stimulus', type: 'image', url: '' }];
    // @ts-expect-error application test state
    window.__trainingAois = [];
    // @ts-expect-error application test state
    window.__mainAois = [];
    // @ts-expect-error application global
    openAoiEditor('shared-stimulus', {
      initialAois: [],
      // @ts-expect-error application test state
      onPersist: (aois: unknown[]) => { window.__mainAois = JSON.parse(JSON.stringify(aois)); }
    });
  });
  await page.locator('#aoiRect').click();
  const stage = page.locator('#aoiSvg');
  const box = await stage.boundingBox();
  if (!box) throw new Error('AOI stage has no bounding box');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.65, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#aoiName')).toBeVisible();
  await page.locator('#aoiName').fill('Main target');
  await page.locator('#aoiTarget').check();
  await page.locator('#aoiSave').click();
  const scoped = await page.evaluate(() => ({
    // @ts-expect-error application test state
    training: window.__trainingAois,
    // @ts-expect-error application test state
    main: window.__mainAois
  }));
  expect(scoped.training).toEqual([]);
  expect(scoped.main).toHaveLength(1);
  expect(scoped.main[0]).toMatchObject({ name: 'Main target', shape: 'rectangle', isTarget: true });
  for (const point of scoped.main[0].points) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(1);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(1);
  }
});

test('analytics plan preserves training/main overrides', async ({ page }) => {
  const result = await page.evaluate(() => {
    const blocks = [
      { id: 'training', type: 'cognitive_task', content: { useAOI: false, aoiDefinitions: {} } },
      { id: 'main', type: 'cognitive_task', content: { useAOI: true, aoiDefinitions: { shared: [{ id: 'aoi-1' }] } } }
    ];
    // @ts-expect-error application global
    const api = window.EmocogAnalyticsPlan;
    const plan = api.normalizePlan({
      schemaVersion: '1.0',
      defaultPackages: ['data_quality', 'task_performance'],
      selectedMetricIds: ['task.accuracy_pct'],
      blockOverrides: {
        training: { packages: ['data_quality'], selectedMetricIds: ['qc.valid_gaze_pct'] },
        main: { packages: ['data_quality', 'aoi_attention'], selectedMetricIds: ['qc.valid_gaze_pct', 'aoi.dwell_time_ms'] }
      }
    }, blocks);
    api.save('e2e-plan', plan, blocks);
    return api.load('e2e-plan', blocks);
  });
  expect(result.blockOverrides.training.selectedMetricIds).not.toContain('aoi.dwell_time_ms');
  expect(result.blockOverrides.main.selectedMetricIds).toContain('aoi.dwell_time_ms');
});

test('completed session shows AOI/heatmap, stays aligned after resize, and exports the same snapshot', async ({ page }) => {
  await page.locator('details > summary').first().click();
  await page.locator('#analyticsBlockFilter').selectOption('main-block');
  await page.locator('#analyticsStimulusFilter').selectOption('stimulus-42');
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('.analytics-heatmap-canvas')).toBeVisible();
  await expect(page.getByText('Целевая область').first()).toBeVisible();
  await expect(page.getByText(/Взгляд \/ AOI/).first()).toBeVisible();
  const snapshot = await page.evaluate(() => {
    // @ts-expect-error application global
    const state = window.EmocogAnalyticsProduction.store.state;
    return { id: state.snapshot.id, hash: state.snapshot.datasetHash, qcMode: state.snapshot.queryEcho.filters.qcMode };
  });
  const canvas = page.locator('.analytics-heatmap-canvas');
  const before = await canvas.boundingBox();
  await page.setViewportSize({ width: 980, height: 760 });
  await page.waitForTimeout(150);
  const after = await canvas.boundingBox();
  expect(before && after && before.width).not.toBe(after && after.width);
  expect(after && after.width).toBeGreaterThan(0);
  await page.locator('#analyticsOpenExport').click();
  await expect(page.getByText(snapshot.id, { exact: true })).toBeVisible();
  await page.locator('#analyticsExportFormat').selectOption('json');
  await page.locator('#analyticsExportContent').selectOption('both');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#analyticsExportDownload').click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Export download path is unavailable');
  const bundle = JSON.parse(await readFile(path, 'utf8'));
  expect(bundle.snapshot.id).toBe(snapshot.id);
  expect(bundle.snapshot.datasetHash).toBe(snapshot.hash);
  expect(bundle.snapshot.queryEcho.filters.qcMode).toBe(snapshot.qcMode);
  expect(bundle.counts.sessions).toBe(1);
  expect(bundle.longData.some((row: { value: unknown; status: string }) => row.value === null && row.status !== 'computed')).toBeTruthy();
  expect(bundle.longData.every((row: { value: unknown; status: string }) => row.value !== null || row.status !== 'computed')).toBeTruthy();
  expect(bundle.dataDictionary.length).toBeGreaterThan(0);
  const csv = await page.evaluate(() => {
    // @ts-expect-error application global
    const api = window.EmocogAnalyticsProduction;
    return api.exportBundleCsv(api.buildExportBundle(api.store.state, 'both'));
  });
  expect(csv).toContain('rowType,snapshotId,datasetHash');
  expect(csv).toContain('dictionary');
  expect(csv).not.toContain('undefined');
});

test('group N and export N match; Russian and English status text is available', async ({ page }) => {
  await page.goto(researcher('analytics/group-comparison'));
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.getByText('Состав выборки')).toBeVisible();
  const counts = await page.evaluate(() => {
    // @ts-expect-error application global
    const state = window.EmocogAnalyticsProduction.store.state;
    // @ts-expect-error application global
    const api = window.EmocogAnalyticsProduction;
    const bundle = api.buildExportBundle(state, 'both');
    api.validateExportBundle(bundle, state);
    return bundle.counts;
  });
  expect(counts).toEqual({ participants: 12, sessions: 12, observations: 288 });
  await page.locator('#langEn').click();
  await expect(page.getByText('Sample composition')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Group' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.analytics-heatmap-canvas')).toHaveAttribute('role', 'img');
});
