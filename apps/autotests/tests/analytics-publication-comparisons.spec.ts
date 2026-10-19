import { test, expect } from '@playwright/test';

const base = 'http://127.0.0.1:4173/apps/web/researcher.html?analyticsPreview=1';

test('built-in square AOI uses the square content rather than its white viewport', async ({ page }) => {
  await page.goto(`${base}#/analytics/session-card`);
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    // @ts-expect-error classic-script application state
    stimuliList = [{ id: 'std_simple_black_square', name: 'Square', type: 'image', standard: true }];
    w.openAoiEditor('std_simple_black_square', { initialAois: w.EmocogAoiProtocol.standardAoisForStimulus('std_simple_black_square') });
  });
  const stage = await page.locator('#aoiStage').boundingBox();
  const shape = await page.locator('#aoiStandardPreview > div').boundingBox();
  expect(stage).not.toBeNull();
  expect(shape).not.toBeNull();
  expect(Math.abs(stage!.width / stage!.height - 1)).toBeLessThan(.01);
  expect(Math.abs(shape!.width - stage!.width)).toBeLessThan(4);
  expect(Math.abs(shape!.height - stage!.height)).toBeLessThan(4);
  await expect(page.locator('#aoiEnd')).not.toHaveValue('9007199254740991');
});

test('an explicitly selected session ignores stale dates and participant aliases', async ({ page }) => {
  await page.goto(`${base}#/analytics/session-card`);
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  const query = await page.evaluate(() => {
    const api = (window as any).EmocogAnalyticsProduction;
    const state = api.store.state;
    state.query.dateFrom = '2099-01-01';
    state.query.dateTo = '2099-01-01';
    state.sessions[0].participant_id = 'internal-uuid';
    state.sessions[0].participant_alias = 'different-alias';
    return api.buildAnalyticsQuery(state);
  });
  expect(query.filters.participantIds).toEqual([]);
  expect(query.filters.dateFrom).toBeNull();
  expect(query.filters.dateTo).toBeNull();
  expect(query.filters.sessionIds).toHaveLength(1);
  await expect(page.locator('#analyticsDateFrom')).toHaveCount(0);
});

test('a virtual square loads beneath the heatmap and AOI layers at a square aspect ratio', async ({ page }) => {
  await page.goto(`${base}#/analytics/session-card`);
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.locator('#analyticsApplyFilters').click();
  await page.waitForFunction(() => (window as any).EmocogAnalyticsProduction.store.state.visualResponse?.data?.contexts?.length);
  await page.evaluate(() => {
    const w = window as any;
    const store = w.EmocogAnalyticsProduction.store;
    const preview = w.StandardStimuli.standardStimulusPreview('std_simple_black_square');
    const stimulus = { id: 'std_simple_black_square', name: 'Black square', version: '1', type: 'image',
      contentUrl: preview.src, intrinsicWidth: preview.width, intrinsicHeight: preview.height };
    const context = store.state.visualResponse.data.contexts[0];
    context.stimulus = stimulus;
    context.heatmap.stimulus = stimulus;
    store.emit();
  });
  const image = page.locator('.analytics-stimulus-image').first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  const box = await image.boundingBox();
  expect(Math.abs(box!.width / box!.height - 1)).toBeLessThan(.01);
  expect(await image.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    context.drawImage(node, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  })).toEqual([2, 6, 23]);
  await expect(page.locator('.analytics-stimulus-fallback:visible')).toHaveCount(0);
  await expect(page.locator('.analytics-heatmap-canvas')).toBeVisible();
});

test('publication selection clears old AOI and comparison selections', async ({ page }) => {
  await page.goto(`${base}#/analytics/session-card`);
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.evaluate(() => {
    const api = (window as any).EmocogAnalyticsProduction;
    const store = api.store;
    store.state.protocols.find((row: any) => String(row.id) === store.state.query.protocolId).versions = [{ version: 'publication:2' }, { version: 'publication:1' }];
    store.state.query.protocolVersion = 'publication:2';
    store.state.query.aoiId = 'only-version-two';
    store.state.query.referenceParticipants = ['old-participant'];
    store.emit();
  });
  await expect(page.locator('#analyticsVersionFilter option')).toHaveCount(2);
  await page.locator('#analyticsVersionFilter').selectOption('publication:1');
  await expect.poll(() => page.evaluate(() => {
    const s = (window as any).EmocogAnalyticsProduction.store.state;
    return { version: s.query.protocolVersion, aoi: s.query.aoiId, members: s.query.referenceParticipants };
  })).toEqual({ version: 'publication:1', aoi: '', members: [] });
});

test('paired and independent comparisons are configurable without backend presets and reject overlapping groups', async ({ page }) => {
  await page.goto(`${base}#/analytics/group-comparison`);
  await expect(page.locator('.analytics-level[data-level="level-2"]')).toBeVisible();
  await page.locator('.analytics-level[data-level="level-2"]').click();
  await page.evaluate(() => {
    const store = (window as any).EmocogAnalyticsProduction.store;
    store.state.filterOptions.blocks = [{ id: 'practice', name_en: 'Practice', hasTrials: true }, { id: 'main', name_en: 'Main', hasTrials: true }];
    store.state.sessions = [{ id: 1, participant_id: 'one' }, { id: 2, participant_id: 'two' }, { id: 3, participant_id: 'three' }];
    store.emit();
  });
  await expect(page.locator('#analyticsComparisonDesigner')).toBeVisible();
  await page.locator('#analyticsReferenceLevel').selectOption('practice');
  await page.locator('#analyticsComparisonLevel').selectOption('main');
  await expect(page.locator('#analyticsApplyFilters')).toBeEnabled();
  const paired = await page.evaluate(() => {
    const api = (window as any).EmocogAnalyticsProduction;
    return api.buildAnalyticsQuery(api.store.state);
  });
  expect(paired.comparison).toEqual({ design: 'paired', metricId: 'task.rt_mean_ms', axis: 'block', referenceId: 'practice', comparisonId: 'main' });
  expect(paired.filters.blockIds).toEqual([]);
  await page.locator('#analyticsComparisonDesign').selectOption('independent');
  await page.locator('#analyticsReferenceParticipants').selectOption(['one', 'two']);
  await page.locator('#analyticsComparisonParticipants').selectOption(['two']);
  await expect(page.locator('#analyticsApplyFilters')).toBeDisabled();
  await page.locator('#analyticsComparisonParticipants').selectOption(['three']);
  await expect(page.locator('#analyticsApplyFilters')).toBeEnabled();
  const independent = await page.evaluate(() => {
    const api = (window as any).EmocogAnalyticsProduction;
    return api.buildAnalyticsQuery(api.store.state);
  });
  expect(independent.comparison.design).toBe('independent');
  expect(independent.comparison.referenceParticipantIds).toEqual(['one', 'two']);
  expect(independent.comparison.comparisonParticipantIds).toEqual(['three']);
});

test('comparison dashboard reports participant N, difference and missingness without invented inference', async ({ page }) => {
  await page.goto(`${base}#/analytics/group-comparison`);
  await expect(page.locator('.analytics-level[data-level="level-2"]')).toBeVisible();
  await page.locator('.analytics-level[data-level="level-2"]').click();
  await page.evaluate(async () => {
    const api = (window as any).EmocogAnalyticsProduction;
    const store = api.store;
    Object.assign(store.state.query, { comparisonId: 'custom', referenceLevel: 'practice', comparisonLevel: 'main' });
    api.api.comparison = async (_id: string, snapshot: any) => ({ contractVersion: '1.0', kind: 'model_result', snapshot,
      data: { modelId: 'descriptive-participant-difference', metricId: 'task.rt_mean_ms', design: 'paired',
        readiness: 'available', effectUnit: 'ms', effect: 100,
        reference: { nParticipants: 2, mean: 250 }, comparison: { nParticipants: 2, mean: 350 },
        nParticipants: 2, nObservations: 10, formula: 'mean(participant_B - participant_A)',
        excludedParticipants: [{ participantId: 'missing', reason: 'comparison_data_missing' }],
        pairs: [{ participantId: 'one', reference: 200, comparison: 300, difference: 100 }] }
    });
    await store.apply();
  });
  const dashboard = page.locator('#analyticsDescriptiveComparison');
  await expect(dashboard).toBeVisible();
  await expect(dashboard).toContainText('N=2');
  await expect(dashboard).toContainText('B − A');
  await expect(dashboard).toContainText('100');
  await expect(dashboard).toContainText(/не рассчитывались|not computed/);
  await expect(dashboard.locator('tbody tr')).toHaveCount(1);
  await expect(dashboard).not.toContainText(/adjusted p =|95% CI:/);
  await expect(page.locator('#analyticsPdfDownload')).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.locator('#analyticsPdfDownload').click();
  expect((await download).suggestedFilename()).toMatch(/group-comparison\.pdf$/);
});

test('authored instructions replace the response automatically in the builder and survive repeated key changes', async ({ page }) => {
  await page.goto(`${base}#/analytics/session-card`);
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    localStorage.setItem('emocog_my_experiments', JSON.stringify([{ id: 'automatic-response', title: 'Automatic response', savedStep: 2,
      metadata: { title: 'Automatic response', protocolId: 'automatic-response' },
      blocks: [
        { id: 'instructions', type: 'instruction', label: 'Custom RT', content: { titleRu: 'Custom RT', title: 'Custom RT', textRu: 'Нажмите Пробел. Не отвлекайтесь.', text: 'Нажмите Пробел. Не отвлекайтесь.' } },
        { id: 'task', type: 'cognitive_task', label: 'Task', content: { taskType: 'simple_rt', responseMode: 'keypress', rtMin: 100, rtWindow: 2000, trials: [{ stimulusId: 'std_simple_black_square', action: 'KeyD', duration: 1000, repetitions: 1 }] } }
      ] }]));
    document.getElementById('view')!.replaceChildren(w.ExperimentBuilderView({ experimentId: 'automatic-response', startStep: 2 }));
  });
  await page.locator('.proto-card .edit-btn').first().click();
  const text = page.locator('.proto-field[data-field="text"]');
  await expect(text).toHaveValue(/В \/ D/);
  await expect(text).not.toHaveValue(/Пробел|\{response\}/);
  await text.fill('Нажмите клавишу В / D. Не отвлекайтесь.');
  await page.locator('.bstep[data-step="3"]').click();
  await page.locator('.open-trials-btn').click();
  await page.locator('.t-action').first().selectOption('KeyM');
  await page.locator('#trialSaveBtn').click();
  await page.locator('.bstep[data-step="2"]').click();
  const edit = page.locator('.proto-card .edit-btn').first();
  if (!(await text.isVisible())) await edit.click();
  await expect(text).toHaveValue(/Ь \/ M/);
  await expect(text).toHaveValue(/Не отвлекайтесь/);
});
