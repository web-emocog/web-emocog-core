import { test, expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const { createSyntheticSessions, createProtocolDefinition } = require('../../api/scripts/seed-analytics-lab');
const { validatePlan } = require('../../api/analytics/extended-service');
const { calculate } = require('../../api/analytics/extended-worker');
const snapshot = { id: 'c7fd2332-fbd7-431e-bceb-c843ab8ddad7', datasetHash: 'synthetic-only' };
const initialPlan = { axis: 'condition', referenceId: 'congruent', comparisonId: 'incongruent',
  metricId: 'rt.mean', baselineBlockId: 'baseline', signalConditions: { signal: ['go'], noise: ['nogo'] },
  familyMetricIds: ['rt.mean', 'rt.median'], fastThresholdMs: 200, slowThresholdMs: 600 };
let rows: any[], definition: any;
test.beforeAll(async () => {
  // The producer is native ESM; let Node, not Playwright's TS require hook, load it.
  const records = JSON.parse(execFileSync(process.execPath, ['-e', `require(${JSON.stringify(require.resolve('../../api/scripts/seed-analytics-lab'))}).createSyntheticSessions().then(rows=>process.stdout.write(JSON.stringify(rows.map(row=>({sessionId:row.sessionId,participantId:row.participantId,sourceData:{startTime:row.sourceData.startTime},payload:row.payload})))));`],
    { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }));
  definition = createProtocolDefinition();
  rows = records.map((record: any, index: number) => ({ id: index + 1, session_id: record.sessionId,
    participant_id: record.participantId, participant_key: record.participantId,
    started_at: new Date(record.sourceData.startTime).toISOString(), stopped_at: new Date(record.sourceData.startTime + 240000).toISOString(),
    qc_validity: 'valid', features_payload: record.payload }));
});
async function mount(page: Page) {
  await page.route('**/analytics-explorer-harness', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body><main id="testHost"></main></body></html>' }));
  await page.route('**/analytics/v1/extensions/*', async route => {
    const body = route.request().postDataJSON();
    try {
      const data = calculate({ rows, definition, filters: {}, plan: validatePlan(body.plan), scope: { snapshotId: snapshot.id, datasetHash: snapshot.datasetHash } });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ kind: 'extension_report', snapshot, data }) });
    } catch (_) { await route.fulfill({ status: 422, contentType: 'application/json', body: '{"code":"analytics_extension_plan_invalid"}' }); }
  });
  await page.goto('/analytics-explorer-harness');
  await page.addStyleTag({ content: `:root{--text:#18382e;--muted:#52685e;--card-bg:#fff;--panel2:#f4f5ee;--stroke:#d9e0d7}body{margin:0;background:#f4f5ef;font-family:Atkinson,'Trebuchet MS',sans-serif}main{max-width:1380px;padding:24px;margin:auto}*{box-sizing:border-box}` });
  await page.addStyleTag({ url: '/apps/web/assets/analytics-explorer.css' });
  await page.addScriptTag({ url: '/apps/web/analytics-visualizations.js' });
  await page.addScriptTag({ url: '/apps/web/analytics-explorer-charts.js' });
  await page.addScriptTag({ url: '/apps/web/analytics-explorer.js' });
  await page.evaluate(({ snapshot, initialPlan }) => {
    const win = window as any;
    win.API_BASE = ''; win.apiRequestHeaders = () => ({ 'content-type': 'application/json' });
    win.WecogHttp = { json: async (url: string, init: any) => {
      const response = await fetch(url, init); if (!response.ok) throw Object.assign(new Error('Rejected'), { status: response.status }); return response.json();
    }, blob: async (url: string, init: any) => (await fetch(url, init)).blob() };
    win.testState = { snapshot, extendedPlan: initialPlan };
    win.WecogAnalyticsExplorer.mount(document.querySelector('#testHost'), win.testState);
  }, { snapshot, initialPlan });
  await expect(page.locator('.ax-ring-sector')).toHaveCount(40);
}
test('forty summaries, keyboard navigation, silhouette and chart drilling are usable', async ({ page }) => {
  await mount(page);
  await expect(page.locator('.ax-ring-value')).not.toHaveText('0');
  await page.locator('.ax-ring [data-preview-module=R2]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.ax-orbit-panel h3')).toHaveText('Быстрые и медленные ответы');
  await expect(page.locator('.ax-detail')).toHaveCount(0);
  await page.locator('[data-open-preview=R2]').click();
  await expect(page.locator('.ax-detail h3')).toHaveText('Быстрые и медленные ответы');
  await expect(page.locator('.ax-detail svg.ax-chart')).toHaveCount(1);
  await page.locator('.ax-detail [data-point]').first().click();
  await expect(page.locator('.ax-point-detail')).not.toHaveText(/Выберите/);
  await page.locator('[data-row-page="100"]').click();
  await expect(page.locator('.ax-table-page')).toContainText('101–200');
  await page.locator('.ax-table-wrap [data-point="100"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.ax-table-wrap [data-point="100"]')).toHaveClass('is-selected');
  await page.locator('.ax-hotspot[data-module=F1]').click();
  await expect(page.locator('.ax-detail h3')).toHaveText('Пульс и дыхание');
  await page.locator('[data-category=S]').first().click();
  await expect(page.locator('.ax-cards .ax-card')).toHaveCount(7);
});
test('sector explanations keep the ring stable and chart zoom and observation controls work locally', async ({ page }) => {
  await mount(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const panel = page.locator('.ax-orbit-panel');
  const ring = page.locator('.ax-ring');
  const button = await panel.locator('[data-open-preview]').elementHandle();
  const before = await panel.boundingBox(), ringBefore = await ring.boundingBox();
  for (const id of ['R2', 'S1', 'F1', 'G3']) {
    await page.locator(labelFor(id)).focus();
    expect(await panel.boundingBox()).toEqual(before);
    expect(await ring.boundingBox()).toEqual(ringBefore);
    expect(await button!.evaluate((node, id) => node.isConnected && node.getAttribute('data-open-preview') === id, id)).toBe(true);
  }
  function labelFor(id: string) { return '.ax-ring [data-preview-module=' + id + ']'; }
  await page.locator(labelFor('R2')).focus();
  await page.locator('[data-open-preview=R2]').click();
  const detail = page.locator('.ax-detail');
  await expect(detail.locator('.ax-histogram-observations')).toBeVisible();
  await detail.locator('[data-chart-dots]').uncheck();
  await expect(detail.locator('.ax-histogram-observations')).toBeHidden();
  await expect(detail.locator('.ax-histogram-bin').first()).toBeVisible();
  await detail.getByRole('button', { name: 'Увеличить график' }).click();
  await expect(detail.locator('.ax-plot-zoom-controls output')).toHaveText('125%');
  expect(await detail.locator('.ax-plot-viewport').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await detail.locator('.ax-table-wrap [data-point]').first().click();
  await expect(detail.locator('.ax-plot-zoom-controls output')).toHaveText('125%');
  await detail.getByRole('button', { name: 'Сбросить масштаб графика' }).click();
  await expect(detail.locator('.ax-plot-zoom-controls output')).toHaveText('100%');
});
test('settings calculate once and invalid pairs produce a useful recoverable error', async ({ page }) => {
  await mount(page); await page.locator('.ax-settings').evaluate((node: HTMLDetailsElement) => node.open = true);
  await page.locator('[name=referenceId]').selectOption('go'); await page.locator('[name=comparisonId]').selectOption('go');
  await page.locator('#axPlanForm .ax-primary').click(); await expect(page.locator('.ax-request-status')).toContainText('Проверьте настройки');
  await page.locator('[name=comparisonId]').selectOption('nogo');
  let requests = 0; page.on('request', request => { if (request.url().endsWith('/extensions/run')) requests++; });
  await page.locator('#axPlanForm .ax-primary').click();
  await expect(page.locator('.ax-ring-sector')).toHaveCount(40); expect(requests).toBe(1);
  await expect(page.locator('.ax-hero')).toBeVisible();
});
test('series selection never overlays different physiological measures or people', async ({ page }) => {
  await mount(page); await page.locator('.ax-hotspot[data-module=F3]').click();
  await expect(page.locator('.ax-detail [data-chart-series]')).toHaveCount(1);
  const options = page.locator('.ax-detail [data-chart-series] option');
  expect(await options.count()).toBeGreaterThan(2);
  await page.locator('.ax-detail [data-chart-series]').selectOption({ index: 1 });
  await expect(page.locator('.ax-detail h3')).toHaveText('Динамика сигналов');
  await expect(page.locator('.ax-detail svg')).toHaveCount(1);
});
test('small screens and dark theme retain bounded, readable interactive controls', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await mount(page);
  if (info.project.name === 'chromium') await page.screenshot({ path: '/tmp/wecog-analytics-explorer-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.ax-ring')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const orbit = await page.locator('.ax-ring').boundingBox();
  if (!orbit) throw new Error('Missing ring');
  const scale = Math.min(orbit.width, orbit.height) / 300, angle = -Math.PI / 2 + Math.PI / 7;
  await page.mouse.click(orbit.x + orbit.width / 2 + 110 * scale * Math.cos(angle), orbit.y + orbit.height / 2 + 110 * scale * Math.sin(angle));
  await expect(page.locator('.ax-orbit-panel h3')).toHaveText('Различия между условиями');
  await page.locator('[data-open-preview=S1]').click();
  await expect(page.locator('.ax-detail h3')).toHaveText('Различия между условиями');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  if (info.project.name === 'chromium') await page.screenshot({ path: '/tmp/wecog-analytics-explorer-mobile.png', fullPage: true });
  await page.addStyleTag({ content: ':root{--text:#ecf2e7;--muted:#b7c4b6;--card-bg:#19372e;--panel2:#244235;--stroke:#456052}body{background:#10291f}' });
  await expect(page.locator('.ax-detail')).toBeVisible();
  if (info.project.name === 'chromium') await page.screenshot({ path: '/tmp/wecog-analytics-explorer-dark.png', fullPage: true });
});
test('late responses do not repaint a changed selection', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { const win = window as any; win.testState.dirty = true; win.WecogAnalyticsExplorer.mount(document.querySelector('#testHost'), win.testState); });
  await expect(page.locator('.ax-ring')).toHaveCount(0);
});

test('real isolated lab signs in, loads forty sessions, and downloads its current chart', async ({ page }, info) => {
  test.setTimeout(150000);
  test.skip(!process.env.ANALYTICS_LAB_FIXTURE, 'Only the explicit synthetic lab may be used');
  const fixture = JSON.parse(readFileSync(process.env.ANALYTICS_LAB_FIXTURE!, 'utf8'));
  expect(fixture.synthetic).toBe(true); expect(fixture.status).toBe('complete');
  await page.goto('http://127.0.0.1:4212/apps/web/developer/login.html?portal=researcher');
  await page.locator('#login').fill(fixture.users.researcher.email);
  await page.locator('#password').fill(fixture.users.researcher.password);
  await page.locator('#form button[type=submit]').click();
  await expect(page).toHaveURL(/researcher\.html/, { timeout: 15000 });
  expect((await page.context().cookies('http://127.0.0.1:3012')).some(cookie => cookie.name === 'wecog_analytics_lab_session')).toBe(true);
  await page.goto('http://127.0.0.1:4212/apps/web/researcher.html#/analytics/group-comparison');
  await expect(page.locator('#analyticsApplyFilters')).toBeEnabled({ timeout: 15000 });
  if (await page.locator('#welcomeScreen').isVisible()) await page.locator('#wsEnterBtn').click();
  if (!page.url().endsWith('/analytics/group-comparison')) await page.goto('http://127.0.0.1:4212/apps/web/researcher.html#/analytics/group-comparison');
  await page.locator('#analyticsRefinement').evaluate((node: HTMLDetailsElement) => node.open = true);
  await page.getByRole('checkbox', { name: 'Задача', exact: true }).check();
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('#analyticsExplorer .ax-ring-sector')).toHaveCount(40, { timeout: 20000 });
  await expect(page.locator('.ax-heading p')).toContainText('40');
  await page.locator('.ax-sections [data-category=""]').click();
  await expect(page.locator('.ax-overview-plots svg.ax-chart')).toHaveCount(4);
  if (info.project.name === 'chromium') await page.locator('.ax-orbit').screenshot({ path: '/tmp/wecog-analytics-integrated-desktop.png' });
  await page.locator('.ax-ring [data-preview-module=R2]').focus(); await page.keyboard.press('Enter');
  await page.locator('[data-open-preview=R2]').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-export=png]').click();
  const png = await download;
  expect(png.suggestedFilename()).toBe('wecog-R2.png');
  await png.saveAs('/tmp/wecog-analytics-chart-' + info.project.name + '.png');
  const layout = await page.evaluate(() => {
    const capture = (window as any).EmocogAnalyticsPdf.capture(document.querySelector('#analyticsProductionBody'));
    return { titles: capture.figures.map((figure: any) => figure.caption),
      navigation: capture.figures.some((figure: any) => figure.node?.matches('.ax-ring,.ax-person')) };
  });
  expect(layout.navigation).toBe(false);
  expect(layout.titles).toContain('Распределение медиан реакции сессий');
  expect(layout.titles).toContain('Распределение оценок пульса');
  expect(layout.titles).toContain('Разброс результатов в выбранных условиях');
  await expect(page.locator('#analyticsPdfDownload')).toBeEnabled();
  const pdf = page.waitForEvent('download');
  await page.locator('.ax-actions [data-export=pdf]').click();
  const downloaded = await pdf;
  expect(downloaded.suggestedFilename()).toMatch(/\.pdf$/);
  await downloaded.saveAs('/tmp/wecog-analytics-report-' + info.project.name + '.pdf');
  await expect(page.locator('#chips')).not.toContainText('Данные API');
  const metric = page.locator('#abGroupMetric');
  await expect(metric).toBeVisible();
  const names = await metric.locator('option').allTextContents();
  expect(names.length).toBeGreaterThan(5);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toEqual([...names].sort(new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }).compare));
  await metric.selectOption({ index: 1 });
  const scrollPosition = () => page.evaluate(() => {
    let node = document.querySelector('#analyticsProductionBody'); let top = 0;
    for (; node; node = node.parentElement) top = Math.max(top, node.scrollTop);
    return top;
  });
  const before = await scrollPosition(); expect(before).toBeGreaterThan(100);
  await page.evaluate(() => {
    (window as any).savedExplorer = document.querySelector('#analyticsExplorer');
    (window as any).EmocogAnalyticsProduction.store.emit();
  });
  expect(await page.evaluate(() => (window as any).savedExplorer === document.querySelector('#analyticsExplorer'))).toBe(true);
  expect(Math.abs(await scrollPosition() - before)).toBeLessThan(3);
  await expect(page.locator('#abGroupMetric')).toHaveValue('1');
  await page.reload();
  await expect(page.locator('#analyticsExplorer .ax-detail h3')).toHaveText('Быстрые и медленные ответы', { timeout: 20000 });
  await expect(page.locator('#abGroupMetric')).toHaveValue('1');
  await expect.poll(scrollPosition).toBeGreaterThan(before - 3);
  expect(Math.abs(await scrollPosition() - before)).toBeLessThan(3);
  // Dirty calculation settings cannot leak an old-plan PDF through the legacy export button.
  await page.locator('.ax-settings').evaluate(node => (node as HTMLDetailsElement).open = true);
  await page.locator('#axPlanForm [name=fastThresholdMs]').fill('205');
  expect(await page.evaluate(() => {
    try { (window as any).EmocogAnalyticsPdf.capture(document.querySelector('#analyticsProductionBody')); return false; }
    catch (_) { return true; }
  })).toBe(true);
  await page.locator('[data-cancel-plan]').click();
  await page.getByRole('tab', { name: 'Сессия', exact: true }).click();
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('#analyticsSessionBlocks .ab-chart')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.ab-map,.ab-map-actions')).toHaveCount(0);
  await expect(page.locator('#analyticsPdfDownload')).toBeEnabled();
  await expect(page.locator('#analyticsExplorer .ax-ring')).toBeVisible();
  const initialMap = await page.locator('.analytics-heatmap-canvas').first().evaluate((node: HTMLCanvasElement) => {
    (window as any).retainedMapCanvas = node;
    const store = (window as any).EmocogAnalyticsProduction.store;
    (window as any).originalVisualResponse = store.state.visualResponse;
    const response = structuredClone(store.state.visualResponse);
    const grid = response.data.contexts[Number(node.dataset.visualIndex)].heatmap.grid;
    grid.values = grid.values.map((_: number, i: number) => i === 0 ? 1 : 0); grid.maxValue = 1;
    const png = node.toDataURL(); store.state.visualResponse = response; store.emit(); return png;
  });
  await expect.poll(() => page.locator('.analytics-heatmap-canvas').first().evaluate((node: HTMLCanvasElement) => node.toDataURL())).not.toBe(initialMap);
  expect(await page.locator('.analytics-heatmap-canvas').first().evaluate(node => node === (window as any).retainedMapCanvas)).toBe(true);
  await page.evaluate(() => { const win = window as any; win.EmocogAnalyticsProduction.store.state.visualResponse = win.originalVisualResponse; win.EmocogAnalyticsProduction.store.emit(); });
  await expect.poll(() => page.locator('.analytics-heatmap-canvas').first().evaluate((node: HTMLCanvasElement) => node.toDataURL())).toBe(initialMap);
  if (info.project.name === 'chromium') await page.locator('.analytics-heatmap-canvas').first().locator('..').screenshot({ path: '/tmp/wecog-analytics-map-site.png' });
  const sessionPDF = page.waitForEvent('download');
  await page.locator('.ax-actions [data-export=pdf]').click();
  await (await sessionPDF).saveAs('/tmp/wecog-analytics-session-report-' + info.project.name + '.pdf');
});

test('real lab search, editable views, and downloadable files remain separate', async ({ page }, info) => {
  test.setTimeout(90000);
  test.skip(!process.env.ANALYTICS_LAB_FIXTURE, 'Only the explicit synthetic lab may be used');
  const fixture = JSON.parse(readFileSync(process.env.ANALYTICS_LAB_FIXTURE!, 'utf8'));
  expect(fixture.synthetic).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:4212/apps/web/developer/login.html?portal=researcher');
  await page.locator('#login').fill(fixture.users.researcher.email);
  await page.locator('#password').fill(fixture.users.researcher.password);
  await page.locator('#form button[type=submit]').click();
  await expect(page).toHaveURL(/researcher\.html/, { timeout: 15000 });
  await page.goto('http://127.0.0.1:4212/apps/web/researcher.html#/analytics/group-comparison');
  await page.reload();
  await expect(page.locator('#welcomeScreen')).toBeHidden();
  await expect(page.locator('#analyticsApplyFilters')).toBeEnabled();
  await page.locator('#analyticsApplyFilters').click();
  const toggle = page.locator('#researcherSearchToggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.ax-overview-plots section').first().getByRole('button', { name: /Подробнее/ }).click();
  await expect(page.locator('.ax-detail')).toBeInViewport();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.locator('#researcherNavSearch').fill('сравнение групп');
  await expect(page.locator('#researcherSearchResults a')).toHaveCount(1);
  await expect(page.locator('#researcherSearchResults small')).toHaveCount(0);
  // Search also indexes the localised topic, independent of which report is open.
  await page.locator('#researcherNavSearch').fill('тепловые карты aoi');
  await expect(page.getByRole('option', { name: 'Тепловые карты взгляда' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#researcherSearchPanel')).toBeHidden();
  const workspace = page.locator('#analyticsGroupDistribution .ax-viz-editor');
  await workspace.locator('summary').click();
  await workspace.locator('[data-viz-size]').fill('6');
  await workspace.locator('[data-viz-add]').click();
  await workspace.locator('[data-viz-kind]').selectOption('clusters');
  if (await workspace.locator('[data-viz-add]').isDisabled()) {
    const metrics = page.locator('#abGroupMetric');
    await metrics.selectOption({ label: 'Медианное время реакции' });
    await workspace.locator('summary').click();
    await workspace.locator('[data-viz-kind]').selectOption('clusters');
  }
  await expect(workspace.locator('.ax-cluster-zone').first()).toBeVisible();
  await expect(workspace.locator('.ax-relative-density')).toBeVisible();
  await workspace.locator('[data-viz-density]').uncheck();
  await expect(workspace.locator('.ax-relative-density')).toHaveCount(0);
  await workspace.locator('[data-viz-density]').check();
  await workspace.locator('[data-viz-add]').click();
  const gallery = page.locator('.ax-viz-collection');
  await expect(gallery.locator('.ax-saved-chart')).toHaveCount(2);
  await expect(page.locator('#analyticsPdfDownload')).toBeHidden();
  const download = async (locator: ReturnType<Page['locator']>, filename: string) => {
    const event = page.waitForEvent('download');
    await locator.click();
    await (await event).saveAs(filename);
  };
  const base = '/tmp/wecog-report-custom-' + info.project.name;
  await download(gallery.locator('[data-ab-save-chart]').first(), base + '.png');
  await download(page.locator('.ax-actions [data-export=json]'), base + '.json');
  await download(page.locator('.ax-actions [data-export=csv]'), base + '.csv');
  const json = JSON.parse(readFileSync(base + '.json', 'utf8'));
  expect(json.overview.charts.map((row: any) => row.kind)).toEqual(['histogram','clusters']);
  expect(json.overview.charts.every((row: any) => row.bandwidth === 12)).toBe(true);
  expect(json.snapshot.id).toBeTruthy();
  expect(readFileSync(base + '.csv', 'utf8')).toMatch(/^\uFEFFУчастник,Сессий в выборке,/);
  expect(readFileSync(base + '.png').subarray(1,4).toString()).toBe('PNG');
  const captions = await page.evaluate(() => (window as any).EmocogAnalyticsPdf.capture(
    document.querySelector('#analyticsProductionBody')).figures.map((figure: any) => figure.caption));
  for (const chart of json.overview.charts) expect(captions).toContain(chart.caption);
  await download(page.locator('.ax-actions [data-export=pdf]'), base + '.pdf');
  expect(readFileSync(base + '.pdf').subarray(0, 4).toString()).toBe('%PDF');
});

test('a chart built from the paired comparison uses each difference once and saves its actual settings', async ({ page }) => {
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/analytics/group-comparison');
  await page.locator('.analytics-level[data-level="level-2"]').click();
  await page.evaluate(async () => {
    const api = (window as any).EmocogAnalyticsProduction;
    const store = api.store;
    Object.assign(store.state.query, { comparisonId: 'custom', referenceLevel: 'practice', comparisonLevel: 'main' });
    api.api.comparison = async (_id: string, snapshot: any) => ({ contractVersion: '1.0', kind: 'model_result', snapshot,
      data: { modelId: 'descriptive-participant-difference', metricId: 'task.rt_mean_ms', design: 'paired',
        readiness: 'available', effectUnit: 'ms', effect: 0, nParticipants: 3, nObservations: 6,
        reference: { nParticipants: 3, mean: 300 }, comparison: { nParticipants: 3, mean: 300 },
        excludedParticipants: [], pairs: [-20, 0, 20].map((difference, i) =>
          ({ participantId: String(i), reference: 300, comparison: 300 + difference, difference })) }
    });
    await store.apply();
  });
  const pair = page.locator('#analyticsDescriptiveComparison');
  await pair.getByText(/Таблица пар|Pair table/).click();
  const editor = pair.locator('.ax-table-chart');
  await editor.locator('summary').click();
  await editor.locator('[data-viz-column]').selectOption({ label: 'B − A' });
  await editor.locator('[data-viz-kind]').selectOption('clusters');
  const figures = editor.locator('[data-viz-preview] svg');
  await expect(figures.locator('circle title')).toHaveCount(3);
  expect((await figures.locator('circle title').allTextContents()).map(text => parseInt(text, 10))).toEqual([-20, 0, 20]);
  await editor.locator('[data-viz-add]').click();
  const chart = page.locator('.ax-viz-collection .ax-saved-chart');
  await expect(chart).toContainText('B − A');
  await expect(chart.locator('.ax-relative-density')).toHaveCount(1);
});


test('quality and associations have no repeated overview and ring explanations remain visible', async ({ page }) => {
  await mount(page);
  await page.locator('.ax-ring').evaluate(node => (window as any).originalRing = node);
  await page.locator('.ax-ring [data-preview-module=F1]').focus();
  await expect(page.locator('.ax-orbit-panel h3')).toHaveText('Пульс и дыхание');
  expect(await page.locator('.ax-ring').evaluate(node => node === (window as any).originalRing)).toBe(true);
  await expect(page.locator('.ax-ring-sector title')).toHaveCount(0);
  for (const tab of ['data-quality', 'connectedness']) {
    await page.evaluate(tab => (window as any).WecogAnalyticsExplorer.mount(document.querySelector('#testHost'), (window as any).testState, { tab }), tab);
    await expect(page.locator('.ax-cards')).toBeVisible();
    await expect(page.locator('.ax-hero,.ax-ring,.ax-person')).toHaveCount(0);
  }
});

test('group sectors preview on hover and open the chart immediately under the map', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => (window as any).WecogAnalyticsExplorer.mount(
    document.querySelector('#testHost'), (window as any).testState, { tab: 'group-comparison' }));
  const sector = page.locator('.ax-ring [data-preview-module=F1]');
  await expect(sector).toBeAttached();
  await sector.scrollIntoViewIfNeeded();
  const point = await sector.evaluate(node => {
    const box = node.getBoundingClientRect();
    for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) {
      const x = box.left + i * box.width / 20, y = box.top + j * box.height / 20;
      if (document.elementFromPoint(x, y) === node) return { x, y };
    }
    return null;
  });
  expect(point).not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
  await expect(page.locator('.ax-orbit-panel h3')).toHaveText('Пульс и дыхание');
  await expect(page.locator('.ax-detail')).toHaveCount(0);
  await sector.focus();
  await expect(sector).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ax-hero + .ax-detail h3')).toHaveText('Пульс и дыхание');
});

test('distributions and alphabetic selectors keep scroll and open settings stable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await mount(page);
  await page.locator('.ax-profile-key [data-module=F1]').click();
  await page.locator('.ax-detail').scrollIntoViewIfNeeded();
  await expect(page.locator('.ax-detail svg[data-chart=histogram]')).toHaveCount(1);
  expect(await page.locator('.ax-detail .ax-histogram-bin').evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number(node.getAttribute('data-count')), 0))).toBe(32); // Eight source sessions deliberately lack a valid pulse summary.
  const select = page.locator('.ax-detail [data-chart-series]');
  const labels = await select.locator('option').allTextContents();
  expect(labels).toEqual([...labels].sort(new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }).compare));
  const before = await page.evaluate(() => scrollY); expect(before).toBeGreaterThan(200);
  await select.selectOption({ index: 1 });
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
  await page.locator('.ax-detail [data-chart-kind]').selectOption('box');
  await expect(page.locator('.ax-detail svg[data-chart=box]')).toHaveCount(1);
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
  await page.locator('.ax-detail [data-chart-kind]').selectOption('bar');
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
  await page.locator('.ax-detail [data-point]').first().evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
  await expect(page.locator('.ax-point-detail')).not.toHaveText(/Выберите/);
  await page.locator('.ax-settings').evaluate(node => (node as HTMLDetailsElement).open = true);
  await page.locator('.ax-detail [data-point]').first().evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(await page.locator('.ax-settings').evaluate(node => (node as HTMLDetailsElement).open)).toBe(true);
});

test('very small probabilities remain nonzero and nonfinite values remain absent', async ({ page }) => {
  await mount(page);
  const formatted = await page.evaluate(() => {
    const h = (document.querySelector('#testHost') as any).__analyticsPdfSource.helpers;
    return [h.metricNumber({ id: 'p', value: 2.715731e-8 }), h.metricNumber({ id: 'p', value: .485731 }), h.num(NaN), h.num(null), h.num(0)];
  });
  expect(formatted).toEqual(['2,72 × 10^-8', '0,48573', '—', '—', '0']);
});
