import { test, expect, Page } from '@playwright/test';

declare let stimuliList: any[];
declare let folders: any[];
declare let CURRENT_LANG: string;

const api = 'http://127.0.0.1:3000';
const policy = { schemaVersion: 'passive_valid_time.v1', enabled: true, maxExtensionRatio: .25, minSegmentMs: 1000 };
const passive = (extra: any = {}) => ({ id: 'passive', type: 'passive', label: 'Static viewing', content: {
  slideDuration: 12000, trials: [{ stimulusId: 'std_simple_black_square', duration: 12000, condition: 'original', repetitions: 1 }], ...extra
} });
const standard = { id: 'std_simple_black_square', type: 'shape', name: 'Static square' };
let mutations: { path: string; body: any }[];

test.beforeEach(async ({ page, baseURL }) => {
  mutations = [];
  await page.addInitScript(() => {
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_api_user', JSON.stringify({ id: 1, role: 'admin', email: 'builder-177@example.test' }));
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_selected_project_id', '7');
    (window as any).__mediaCalls177 = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__mediaCalls177++;
      throw new Error('Devices are forbidden in builder tests');
    };
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === baseURL) return route.continue();
    if (url.origin !== api) return route.abort();
    const headers = { 'Access-Control-Allow-Origin': baseURL!, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type,X-Staff-User-ID,X-CSRF-Token,X-Auth-Transport',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const write = !['GET', 'HEAD'].includes(request.method());
    if (write) mutations.push({ path: url.pathname, body: request.postDataJSON() });
    const fixtures: Record<string, any> = {
      '/auth/me': { id: 1, role: 'admin', email: 'builder-177@example.test', csrf_token: 'synthetic-only' },
      '/auth/permissions': { can_open_admin_panel: true, operations: [] },
      '/projects': [{ id: 7, name: 'Synthetic builder project' }],
      '/invitations': { code: 'synthetic-177', public_code: 'synthetic-177', publication_version: 1 }
    };
    const value = write && url.pathname.startsWith('/protocols')
      ? { id: 901, project_id: 7, updated_at: '2026-11-22T00:00:00Z', revision: 2 } : fixtures[url.pathname] ?? [];
    return route.fulfill({ status: 200, headers, json: value });
  });
  await page.goto('/apps/web/researcher.html#/overview');
  await expect(page.locator('.ov-proj-card')).toHaveCount(1);
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as any).__mediaCalls177)).toBe(0);
});

async function mount(page: Page, block: any, step = 3, lang = 'ru', stimuli: any[] = [standard]) {
  await page.evaluate(({ block, step, lang, stimuli }) => {
    CURRENT_LANG = lang;
    stimuliList = stimuli;
    folders = [];
    const metadata = { title: 'Passive valid-time test', protocolId: 'issue177-builder', estimatedDuration: '1 min', description: 'Synthetic test' };
    const entry = { id: 'issue177-builder', title: metadata.title, projectId: 7, status: 'draft', savedStep: step, metadata, blocks: [block] };
    localStorage.setItem('emocog_my_experiments', JSON.stringify([entry]));
    document.getElementById('view')!.replaceChildren((window as any).ExperimentBuilderView({ experimentId: entry.id, startStep: step }));
  }, { block, step, lang, stimuli });
}

async function savedBlock(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('emocog_protocol_blocks')!)[0]);
}

for (const lang of ['ru', 'en']) test(`#177 ${lang}: default off, bounded opt-in persists, disabling leaves policy absent`, async ({ page }) => {
  await mount(page, passive(), 3, lang);
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('#passiveValidTimeCb')).not.toBeChecked();
  await expect(page.locator('#passiveValidTimeCb')).toBeEnabled();
  await expect(page.locator('#passiveValidTimePercent')).toBeDisabled();
  await expect(page.locator('#passiveValidTimeHint')).toContainText(lang === 'ru' ? 'Выключено по умолчанию' : 'Off by default');
  await page.locator('#trialSaveBtn').click();
  expect((await savedBlock(page)).content.validTime).toBeUndefined();
  await page.locator('.open-trials-btn').click();
  await page.locator('#passiveValidTimeCb').check();
  await page.locator('#passiveValidTimePercent').fill('51');
  await page.locator('#trialSaveBtn').click();
  await expect(page.locator('#trialSaveBtn')).toBeVisible();
  expect((await savedBlock(page)).content.validTime).toBeUndefined();
  await page.locator('#passiveValidTimePercent').fill('25');
  await page.locator('#trialSaveBtn').click();
  const saved = await savedBlock(page);
  expect(saved.content.validTime).toEqual(policy);
  expect(saved.content.trials[0]).toMatchObject({ condition: 'original', duration: 12000, responseMode: 'none', action: '' });
  expect(saved.content.useRT).toBe(false);
  await mount(page, saved, 3, lang);
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('#passiveValidTimeCb')).toBeChecked();
  await expect(page.locator('#passiveValidTimePercent')).toHaveValue('25');
  await page.locator('#passiveValidTimeCb').uncheck();
  await page.locator('#trialSaveBtn').click();
  expect((await savedBlock(page)).content.validTime).toBeUndefined();
});

test('#177 cognitive, audio/video, mixed media and missing library files cannot opt in', async ({ page }) => {
  for (const scenario of [
    { block: { ...passive(), type: 'cognitive_task', content: { ...passive().content, taskType: 'simple_rt' } }, stimuli: [standard] },
    ...[['audio', 'audio/wav'], ['video', 'video/mp4'], ['image', 'image/gif']].map(([type, mimeType]) => ({
      block: passive({ trials: [...passive().content.trials, { stimulusId: '31', duration: 12000 }] }),
      stimuli: [standard, { id: '31', type, mimeType, name: 'Non-static or unverified media' }]
    })),
    { block: passive({ trials: [{ stimulusId: '31', duration: 12000 }] }),
      stimuli: [{ id: '31', type: 'image', mimeType: 'image/png', contentAvailable: false }] },
  ]) {
    await mount(page, scenario.block, 3, 'en', scenario.stimuli);
    await page.locator('.open-trials-btn').click();
    await expect(page.locator('#passiveValidTimeCb')).toBeDisabled();
    await expect(page.locator('#passiveValidTimeCb')).not.toBeChecked();
    await expect(page.locator('#passiveValidTimePercent')).toBeDisabled();
    await expect(page.locator('#passiveValidTimeHint')).toContainText('Unavailable');
    await page.locator('#trialCancelBtn').click();
  }
});

for (const mimeType of ['image/png', 'image/jpeg', 'image/bmp']) test(`#186 existing ${mimeType} without decoder metadata can request server verification`, async ({ page }) => {
  const block = passive({ trials: [{ stimulusId: '31', duration: 12000, condition: 'original' }] });
  const library = [{ id: '31', apiStimulusId: 31, type: 'image', mimeType, name: 'Existing synthetic image' }];
  await mount(page, block, 3, 'ru', library);
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('#passiveValidTimeCb')).toBeEnabled();
  await expect(page.locator('#passiveValidTimeHint')).toContainText('сервер автоматически проверит');
  await expect(page.locator('#passiveValidTimeHint')).not.toContainText('иначе используйте');
  await page.locator('#passiveValidTimeCb').check();
  await page.locator('#trialSaveBtn').click();
  const saved = await savedBlock(page);
  expect(saved.content.validTime).toEqual({ ...policy, maxExtensionRatio: .5 });
  await page.locator('.bstep[data-step="8"]').click();
  await page.locator('#finishSaveProtocolBtn').click();
  await page.locator('[data-preflight-continue]').click();
  await expect.poll(() => mutations.some(item => item.path === '/protocols')).toBe(true);
  const definition = mutations.find(item => item.path === '/protocols')!.body.definition;
  expect(definition.blocks.find((item: any) => item.id === 'passive').trials[0].stimulusId).toBe('31');
});

test('#177 canonical enabled copy can be disabled without resurrection after reopen', async ({ page }) => {
  const block = { ...passive(), blockConfig: { validTime: policy } };
  await mount(page, block);
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('#passiveValidTimeCb')).toBeChecked();
  await page.locator('#passiveValidTimeCb').uncheck();
  await page.locator('#trialSaveBtn').click();
  const saved = await savedBlock(page);
  expect(saved.content.validTime).toBeUndefined();
  expect(saved.blockConfig.validTime).toBeUndefined();
  await mount(page, saved);
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('#passiveValidTimeCb')).not.toBeChecked();
});

test('#177 preview indicates extension outside the task and preserves nominal timer/condition/RT', async ({ page }) => {
  await mount(page, passive({ validTime: policy }), 5, 'en');
  await page.locator('#runUserPreviewBtn').click();
  await expect(page.locator('[data-passive-valid-time-preview]')).toContainText('up to +25%');
  await expect(page.locator('[data-passive-valid-time-preview]')).toContainText('original timer');
  await expect(page.locator('#previewStage [data-passive-valid-time-preview]')).toHaveCount(0);
  await expect(page.locator('#previewStage').locator('..')).toContainText('12000 ms');
  await expect(page.locator('#previewStage').locator('..')).not.toContainText('Response:');
  await page.keyboard.press('q');
  await expect(page.locator('[data-passive-valid-time-preview]')).toBeVisible();
  await page.locator('#previewRunClose').click();
});

test('#177 builder publication serializes policy in both canonical locations, retaining the task condition', async ({ page }) => {
  await mount(page, passive({ validTime: policy }), 8, 'en');
  await page.locator('#finishSaveProtocolBtn').click();
  await expect(page.locator('[data-protocol-preflight]')).toContainText('25% longer');
  await page.locator('[data-preflight-continue]').click();
  await expect.poll(() => mutations.find(item => item.path === '/protocols')?.body?.definition?.blocks?.some((block: any) => block.id === 'passive')).toBe(true);
  const definition = mutations.find(item => item.path === '/protocols')!.body.definition;
  const published = definition.blocks.find((block: any) => block.id === 'passive');
  expect(published.blockConfig.validTime).toEqual(policy);
  expect(published.content.validTime).toEqual(policy);
  expect(published.trials[0]).toMatchObject({ condition: 'original', duration: 12000 });
});

test('#186 server publication errors explain the rejected block and retain the draft without issuing an invitation', async ({ page, baseURL }) => {
  await page.route(api + '/protocols', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    mutations.push({ path: '/protocols', body: route.request().postDataJSON() });
    return route.fulfill({ status: 422, headers: { 'Access-Control-Allow-Origin': baseURL!, 'Access-Control-Allow-Credentials': 'true' },
      json: { error: 'Protocol preflight failed', code: 'protocol_preflight_failed', preflight: {
        schemaVersion: 'protocol_preflight.v1', ok: false, warnings: [], duration: { plannedMaximumMs: 12000 },
        errors: [{ code: 'passive_valid_time_invalid', path: '/blocks/4/blockConfig/validTime',
          message: { ru: 'Выберите статичное изображение без анимации.', en: 'Choose a verified static image without animation.' } }]
      } } });
  });
  await mount(page, passive({ validTime: policy }), 8, 'en');
  await page.locator('#finishSaveProtocolBtn').click();
  await page.locator('[data-preflight-continue]').click();
  await expect(page.locator('[data-protocol-preflight]')).toContainText('Choose a verified static image');
  await expect(page.locator('#protocolSaveStatus')).not.toContainText('Protocol preflight failed');
  expect(mutations.filter(item => item.path === '/invitations')).toHaveLength(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_my_experiments')!).find((entry: any) => entry.id === 'issue177-builder'));
  expect(saved.status).toBe('draft');
});
