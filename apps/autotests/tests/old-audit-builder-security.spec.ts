import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

declare let stimuliList: any[];
declare let folders: any[];

const marker = '</textarea><img src=x onerror="window.__builderXss=true"> & "quotes" <svg onload="window.__builderXss=true">';
const attribute = '\" autofocus onfocus="window.__builderXss=true" data-injected="yes';
const api = 'http://127.0.0.1:3000';
const sourcePath = path.resolve(__dirname, '../../web/researcher-builder.js');
const metadata = { title: marker, protocolId: 'builder-security', estimatedDuration: '2 min', description: marker };
const task = (label = marker, content: any = {}) => ({ id: 'audit-task', type: 'cognitive_task', label,
  content: { taskType: 'simple_rt', useRT: false, trials: [{ stimulusId: 'std_simple_black_square', duration: 1000, repetitions: 1 }], ...content } });
let fixtures: Map<string, any>, mutations: { path: string; body: any }[], invitationFails: boolean;

test.beforeEach(async ({ page, baseURL }) => {
  fixtures = new Map([
    ['/auth/me', { id: 1, role: 'admin', email: 'builder-audit@example.test', csrf_token: 'synthetic-only' }],
    ['/auth/permissions', { can_open_admin_panel: true, operations: [] }],
    ['/projects', [{ id: 7, name: 'Synthetic builder project' }]],
  ]);
  mutations = []; invitationFails = false;
  await page.addInitScript(() => {
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_api_user', JSON.stringify({ id: 1, role: 'admin', email: 'builder-audit@example.test' }));
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_selected_project_id', '7');
    // A failing stub proves no test started a physical device, even if permission was denied.
    (window as any).__builderMediaCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__builderMediaCalls++;
      throw new Error('Physical media forbidden in builder security tests');
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
    const isWrite = !['GET', 'HEAD'].includes(request.method());
    if (isWrite) mutations.push({ path: url.pathname, body: request.postDataJSON() });
    if (url.pathname === '/invitations' && isWrite && invitationFails) {
      return route.fulfill({ status: 503, headers, json: { error: marker } });
    }
    const value = isWrite && url.pathname.startsWith('/protocols')
      ? { id: 901, project_id: 7, updated_at: '2026-11-06T01:00:00Z', revision: 2 }
      : fixtures.get(url.pathname) ?? [];
    return route.fulfill({ status: 200, headers, json: value });
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as any).__builderMediaCalls)).toBe(0);
});

async function open(page: Page) {
  await page.goto('/apps/web/researcher.html#/overview');
  await expect(page.locator('#view')).toBeVisible();
  // The real startup sync owns the library until it has fetched the initial
  // project. Do not let its late response replace this test's in-memory rows.
  await expect(page.locator('.ov-proj-card')).toHaveCount(1);
}

async function mount(page: Page, blocks: any[], step: number, extra: any = {}, stimuli: any[] = [], folderRows: any[] = []) {
  await page.evaluate(({ blocks, step, extra, stimuli, folderRows, metadata }) => {
    const w = window as any;
    stimuliList = stimuli;
    folders = folderRows;
    const entry = { id: 'audit-builder', title: metadata.title, projectId: 7, status: 'draft', savedStep: step, metadata, blocks, ...extra };
    localStorage.setItem('emocog_my_experiments', JSON.stringify([entry]));
    document.getElementById('view')!.replaceChildren(w.ExperimentBuilderView({ experimentId: entry.id, startStep: step }));
  }, { blocks, step, extra, stimuli, folderRows, metadata });
}

async function inertInputs(page: Page) {
  await expect(page.locator('#view [onerror], #view [onload], #view [onfocus], #view [data-injected], #previewStage [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__builderXss)).toBeUndefined();
}

test('API definition -> persisted metadata/block title -> live preview header stays literal', async ({ page }) => {
  fixtures.set('/protocols', [{ id: 901, project_id: 7, name: marker, definition: {
    isDraft: true, protocolId: 'builder-security', estimatedDuration: marker, description: marker,
    builderState: { savedStep: 0, metadata: { ...metadata, title: attribute }, blocks: [task()] }
  } }]);
  await page.goto('/apps/web/researcher.html#/experiments');
  await expect(page.locator('.edit-exp-btn')).toHaveCount(1);
  await page.locator('.edit-exp-btn').click();
  await page.locator('.bstep[data-step="0"]').click();
  await expect(page.locator('#metaTitle')).toHaveValue(attribute);
  await expect(page.locator('#metaDescription')).toHaveValue(marker);
  await page.locator('#metaTitle').dispatchEvent('focus');
  await page.locator('.bstep[data-step="5"]').click();
  await page.locator('#runUserPreviewBtn').click();
  await expect(page.locator('#previewStage')).toBeVisible();
  await expect(page.locator('#previewRunClose').locator('..').locator('..')).toContainText(marker);
  await inertInputs(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#previewStage')).toHaveCount(0);
});

test('unknown imported block type also stays literal in the running preview header', async ({ page }) => {
  await open(page);
  await mount(page, [{ id: attribute, type: marker, content: {} }], 5);
  await page.locator('#runUserPreviewBtn').click();
  await expect(page.locator('#previewStage')).toContainText(marker);
  await inertInputs(page);
  await page.locator('#previewRunClose').click();
});

test('metadata, block and folder IDs round-trip through attributes, editors and trial modal', async ({ page }) => {
  await open(page);
  const sid = 'stimulus-' + attribute, fid = 'folder-' + attribute;
  const block = task(marker, { stimuliSource: 'folder', stimuliFolder: fid, feedbackCorrect: attribute,
    showFeedback: true, trials: [{ stimulusId: sid, condition: attribute, action: 'KeyQ', duration: attribute, repetitions: attribute }],
    fixationDuration: attribute, rtMin: attribute, rtWindow: attribute });
  block.id = 'block-' + attribute;
  await mount(page, [block], 2, { metadata: { ...metadata, title: attribute, protocolId: attribute, estimatedDuration: attribute } },
    [{ id: sid, type: 'text', name: marker }], [{ id: fid, name: marker, stimuliIds: [sid] }]);
  await expect(page.locator('.proto-card')).toHaveAttribute('data-id', block.id);
  await page.locator('.edit-btn').click();
  await expect(page.locator('.proto-label-input')).toHaveValue(marker);
  await expect(page.locator('[data-field="stimuliFolder"]')).toHaveValue(fid);
  await page.locator('.bstep[data-step="3"]').click();
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('.t-condition')).toHaveValue(attribute);
  await expect(page.locator('.t-stimulus')).toHaveValue(sid);
  await expect(page.locator('#autoGenFolder')).toHaveValue(fid);
  await expect(page.locator('#fbCorr')).toHaveValue(attribute);
  await expect(page.locator('.t-action')).toHaveValue('KeyQ');
  await expect(page.locator('input[autofocus]')).toHaveCount(0);
  await inertInputs(page);
  await page.locator('.t-duration').fill('1234');
  await page.locator('.t-reps').fill('2');
  await page.locator('#trialSaveBtn').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_protocol_blocks')!)[0]);
  expect(saved.content.trials[0]).toMatchObject({ stimulusId: sid, condition: attribute, duration: 1234, repetitions: 2 });
});

test('media URL schemes are rejected at AOI thumbnails and preview strips without interpreting attributes', async ({ page }) => {
  await open(page);
  const unsafe = ['javascript:window.__builderXss=true', 'java\nscript:window.__builderXss=true',
    'data:text/html,<svg onload="window.__builderXss=true">', 'file:///etc/passwd',
    'https://user:password@example.test/secret', 'blob:https://foreign.example.test/synthetic'];
  const stimuli: any[] = ['image', 'slides', 'video', 'audio'].flatMap(type => unsafe.map((url, index) => ({
    id: `${type}-${index}`, type, name: marker, url
  })));
  // Exercise the preview URL override as well as the regular metadata URL.
  stimuli[0]._previewObjectUrl = unsafe[0];
  const trials = stimuli.map(s => ({ stimulusId: s.id, duration: 1000 }));
  await mount(page, [task(marker, { useAOI: true, trials })], 4, {}, stimuli);
  await expect(page.locator('.builder-aoi-card')).toHaveCount(stimuli.length);
  await expect(page.locator('#builderAoiBlocks img, #builderAoiBlocks video, #builderAoiBlocks audio')).toHaveCount(0);
  await inertInputs(page);
  await page.locator('.bstep[data-step="5"]').click();
  await expect(page.locator('#view img, #view video, #view audio')).toHaveCount(0);
  await inertInputs(page);
});

test('#156 library sorting is numeric by default and can switch to newest first', async ({ page }) => {
  fixtures.set('/stimuli', [
    { id: 810, name: 'page_10.jpg', created_at: '2026-11-09T02:00:00Z' },
    { id: 802, name: 'page_2.jpg', created_at: '2026-11-09T01:00:00Z' },
  ].map(item => ({ ...item, mime_type: 'image/jpeg', project_id: 7, visibility: 'project', content_available: false })));
  await open(page);
  await page.goto('/apps/web/researcher.html#/stimuli');
  const cards = page.locator('#stimuliGallery .stimulus-card[data-id="802"], #stimuliGallery .stimulus-card[data-id="810"]');
  const order = () => cards.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.id));
  await expect.poll(order).toEqual(['802', '810']);
  await page.locator('#stimulusLibrarySort').selectOption('recent');
  await expect.poll(order).toEqual(['810', '802']);
});

test('#156 generation and bulk timing preserve manual order, unselected fields, and randomization', async ({ page }) => {
  await open(page);
  const stimuli = ['20', '2', '10'].map(id => ({ id, type: 'text', name: 'page_' + id }));
  const folder = { id: 'pages', name: 'Pages', stimuliIds: ['20', '2', '10', 'unavailable'] };
  await mount(page, [{ id: 'passive', type: 'passive', content: { slideDuration: 4500, trials: [
    { stimulusId: '20', duration: 2500, repetitions: 4 },
  ] } }], 3, {}, stimuli, [folder]);
  await page.locator('.open-trials-btn').click();
  await page.locator('#autoGenFolder').selectOption('pages');
  await page.locator('#autoGenBtn').click();
  const values = (selector: string) => page.locator(selector).evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value));
  await expect.poll(() => values('.t-stimulus')).toEqual(['20', '2', '10', '20']);
  await expect.poll(() => values('.t-duration')).toEqual(['2500', '4500', '4500', '4500']);
  await page.locator('#selectAllTrials').check();
  await page.locator('.trial-select').first().uncheck();
  await page.locator('#bulkTrialDuration').fill('0');
  await page.locator('#applyBulkTiming').click();
  await expect.poll(() => values('.t-duration')).toEqual(['2500', '4500', '4500', '4500']);
  await page.locator('#bulkTrialDuration').fill('5000');
  await page.locator('#applyBulkTiming').click();
  await expect.poll(() => values('.t-duration')).toEqual(['2500', '5000', '5000', '5000']);
  await expect.poll(() => values('.t-reps')).toEqual(['4', '1', '1', '1']);
  await page.locator('#bulkTrialDuration').fill('');
  await page.locator('#bulkTrialRepetitions').fill('3');
  await page.locator('#applyBulkTiming').click();
  await expect(page.locator('#trialRandomizeCb')).not.toBeChecked();
  await page.locator('#trialSaveBtn').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_protocol_blocks')!)[0].content);
  expect(saved.randomize).toBe(false);
  expect(saved.trials.map((trial: any) => [trial.stimulusId, trial.duration, trial.repetitions]))
    .toEqual([['20', 2500, 4], ['2', 5000, 3], ['10', 5000, 3], ['20', 5000, 3]]);
});

test('#156 AOI copy and interval apply stay in the current block and preserve list position', async ({ page }) => {
  await open(page);
  const ids = [...Array.from({ length: 30 }, (_, index) => String(index + 901)), '__proto__'];
  const stimuli = ids.map(id => ({ id, type: 'text', name: id }));
  stimuli.push({ id: 'sound', type: 'audio', name: 'Audio' });
  const trials = [...ids, 'sound'].map(id => ({ stimulusId: id, duration: 5000 }));
  await mount(page, [task('Main', { useAOI: true, trials }), { ...task('Training', { useAOI: true, trials: [trials[1]] }), id: 'training' }],
    4, {}, stimuli, [{ id: 'aoi-test-folder', name: marker, stimuliIds: ['902', '__proto__', 'sound', 'not-in-block'] }]);
  const list = page.locator('#builderAoiBlocks');
  await list.locator('.builder-aoi-edit[data-stimulus-id="901"]').click();
  await page.locator('#aoiRect').click();
  const box = (await page.locator('#aoiSvg').boundingBox())!;
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .6);
  await page.mouse.up();
  await expect(page.locator('#aoiEnd')).toHaveValue('');
  await expect(page.locator('#aoiIntervalHint')).toContainText('Действует весь показ');
  await expect(page.locator('#aoiSizeHint')).toContainText(/\d+ × \d+ px/);
  await expect(page.locator('#aoiSizeHint')).toContainText('на устройстве участника');
  await page.locator('#aoiBatch summary').click();
  await expect(page.locator('[data-aoi-batch-target][value="sound"]')).toHaveCount(0);
  await expect(page.locator('#aoiBatchFolder option').last()).toContainText(marker);
  await page.locator('#aoiBatchFolder').selectOption('0');
  await expect(page.locator('[data-aoi-batch-target]:checked')).toHaveCount(2);
  await expect(page.locator('[data-aoi-batch-target][value="902"]')).toBeChecked();
  await expect(page.locator('[data-aoi-batch-target][value="__proto__"]')).toBeChecked();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#aoiCopySelected').click();
  const definitions = async () => JSON.parse(await page.evaluate(() => localStorage.getItem('emocog_protocol_blocks')!))
    .map((block: any) => block.content.aoiDefinitions || {});
  expect((await definitions())[0]['902']).toBeUndefined();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#aoiCopySelected').click();
  const copied = await definitions();
  expect(copied[0]['902']).toEqual(copied[0]['901']);
  // Check ownership before crossing the browser automation serializer.
  expect(await page.evaluate(() => Object.prototype.hasOwnProperty.call(
    JSON.parse(localStorage.getItem('emocog_protocol_blocks')!)[0].content.aoiDefinitions, '__proto__'))).toBe(true);
  expect(copied[0]['__proto__']).toEqual(copied[0]['901']);
  expect(copied[1]['902']).toBeUndefined();
  await page.locator('#aoiEnd').fill('1000');
  await expect(page.locator('#aoiIntervalHint')).toContainText('не весь показ (5000 мс)');
  await page.locator('#aoiApplyInterval').click();
  const timed = await definitions();
  expect(timed[0]['902'][0]).toEqual({ ...copied[0]['902'][0], validityInterval: { startMs: 0, endMs: 1000 } });
  await page.locator('#aoiEnd').fill('-5');
  await page.locator('#aoiSaveNext').click();
  await expect(page.locator('#aoiEnd')).toHaveValue('-5');
  await page.locator('#aoiEnd').fill('');
  await page.locator('#aoiSaveNext').click();
  await expect(page.locator('#aoiEnd')).toHaveValue('1000');
  await page.locator('#aoiPrevious').click();
  await expect(page.locator('#aoiEnd')).toHaveValue('');
  const scroll = await list.evaluate(node => { node.scrollTop = 600; return node.scrollTop; });
  expect(scroll).toBeGreaterThan(0);
  await page.locator('#aoiClose').click();
  expect(await list.evaluate(node => node.scrollTop)).toBe(scroll);
  await expect(page.locator('#aoiStepNext')).toBeEnabled();
  await inertInputs(page);
});

test('#156 invalid settings never leak into the source block, and implicit RT defaults can be saved', async ({ page }) => {
  await open(page);
  await mount(page, [task('RT', { useRT: true, rtMin: 100, rtWindow: 1000, trials: [
    { stimulusId: 'std_simple_black_square', duration: 2000 },
  ] })], 3, {}, [{ id: 'std_simple_black_square', type: 'shape', name: 'Square' }]);
  await page.locator('.open-trials-btn').click();
  await page.locator('.t-duration').fill('3200');
  await page.locator('#rtMinInput').fill('900');
  await page.locator('#rtWindowInput').fill('200');
  await page.locator('#trialSaveBtn').click();
  await expect(page.locator('#trialSaveBtn')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#trialCancelBtn').click();
  await page.locator('.open-trials-btn').click();
  await expect(page.locator('.t-duration')).toHaveValue('2000');
  await expect(page.locator('#rtMinInput')).toHaveValue('100');
  await page.locator('#rtMinInput').fill('');
  await page.locator('#rtWindowInput').fill('');
  await page.locator('#trialSaveBtn').click();
  await expect(page.locator('#trialSaveBtn')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_protocol_blocks')!)[0].content.trials[0]))
    .toMatchObject({ duration: 2000, repetitions: 1 });
});

test('#156 only omitted AOI intervals default to the full presentation', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(() => {
    const normalize = (window as any).normalizeAoi;
    const aoi = { shape: 'rectangle', points: [{ x: .1, y: .1 }, { x: .5, y: .5 }] };
    return {
      omitted: normalize(aoi, 'test').validityInterval,
      existing: normalize({ ...aoi, validityInterval: { startMs: 0, endMs: 1000 } }, 'test').validityInterval,
      invalid: [0, -1, .5, '1000junk', '', false].map(endMs => normalize({ ...aoi, validityInterval: { startMs: 0, endMs } }, 'test')),
      invalidStart: normalize({ ...aoi, validityInterval: { startMs: -1, endMs: 1000 } }, 'test'),
    };
  });
  expect(result.omitted).toEqual({ startMs: 0, endMs: Number.MAX_SAFE_INTEGER });
  expect(result.existing).toEqual({ startMs: 0, endMs: 1000 });
  expect(result.invalid).toEqual(Array(6).fill(null));
  expect(result.invalidStart).toBeNull();
});

test('#156 storage failure keeps the AOI editor open and does not partly change other stimuli', async ({ page }) => {
  await open(page);
  const aoi = { id: 'zone', name: 'Zone', shape: 'rectangle', points: [{ x: .1, y: .1 }, { x: .5, y: .5 }],
    order: 1, validityInterval: { startMs: 0, endMs: 1000 } };
  await mount(page, [task('Main', { useAOI: true,
    trials: ['901', '902'].map(stimulusId => ({ stimulusId, duration: 5000 })),
    aoiDefinitions: { '901': [aoi], '902': [aoi] },
  })], 4, {}, ['901', '902'].map(id => ({ id, type: 'text', name: id })));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.builder-aoi-edit[data-stimulus-id="901"]').click();
  await page.locator('#aoiSave').click();
  await page.locator('#aoiEnd').fill('2000');
  const failWrite = async (after: number) => page.evaluate(after => {
    const w = window as any;
    w.originalStorageWrite ||= Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'emocog_protocol_blocks' && ++writes === after) throw new DOMException('Synthetic quota', 'QuotaExceededError');
      return w.originalStorageWrite.call(this, key, value);
    };
  }, after);
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('emocog_protocol_blocks')!)[0].content.aoiDefinitions);
  await failWrite(1);
  await page.locator('#aoiSaveNext').click();
  await expect(page.locator('#aoiEnd')).toHaveValue('2000');
  expect((await read())['901'][0].validityInterval.endMs).toBe(1000);
  await page.locator('#aoiBatch summary').click();
  await page.locator('[data-aoi-batch-target][value="902"]').check();
  await failWrite(2);
  await page.locator('#aoiApplyInterval').click();
  expect((await read())['901'][0].validityInterval.endMs).toBe(2000);
  expect((await read())['902'][0].validityInterval.endMs).toBe(1000);
  await page.evaluate(() => { Storage.prototype.setItem = (window as any).originalStorageWrite; });
  await page.locator('#aoiApplyInterval').click();
  expect((await read())['902'][0].validityInterval.endMs).toBe(2000);
  await page.locator('#aoiSaveNext').click();
  await expect(page.locator('#aoiEnd')).toHaveValue('2000');
  expect(errors).toEqual([]);
});

test('survey text/IDs and imported QC thresholds cannot create HTML attributes or handler code', async ({ page }) => {
  await open(page);
  await mount(page, [{ id: 'survey', type: 'survey', label: marker, content: {
    schemaVersion: 'protocol_survey.v1', title: marker, description: marker, submitButtonText: marker,
    questions: [{ id: attribute, text: marker, type: 'single', required: true,
      options: [{ id: 'first-' + attribute, label: marker }, { id: 'second-' + attribute, label: attribute }] }]
  } }], 2, { qcThresholds: { gazeValid: { enabled: true, threshold: attribute, hardStop: false } } });
  await page.locator('.edit-btn').click();
  await expect(page.locator('.survey-title-field')).toHaveValue(marker);
  await expect(page.locator('.survey-description-field')).toHaveValue(marker);
  const normalizedId = 'autofocus_onfocus_window___builderXss_true_data-injected_yes';
  await expect(page.locator('.survey-question-editor')).toHaveAttribute('data-question-id', normalizedId);
  await expect(page.locator('.survey-question-text')).toHaveValue(marker);
  await expect(page.locator('.survey-option-row').first()).toHaveAttribute('data-option-id', 'first-_' + normalizedId);
  await expect(page.locator('.survey-option-label').first()).toHaveValue(marker);
  await inertInputs(page);
  await page.locator('.bstep[data-step="6"]').click();
  const range = page.locator('.qc-range[data-key="gazeValid"]');
  await expect(range).toHaveValue('70');
  // The remaining inline handler interpolates a source-owned unit, never a threshold or title.
  await expect(range).toHaveAttribute('oninput', "this.nextElementSibling.textContent=this.value+'%'");
  await range.fill('77');
  await expect(range.locator('..')).toContainText('77%');
  await inertInputs(page);
});

test('safe HTTP, relative, data and owned blob media still render with literal names', async ({ page, baseURL }) => {
  await open(page);
  const stimuli = await page.evaluate(({ marker, attribute, baseURL }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>';
    return [
      { id: 'owned', type: 'image', name: attribute, _previewObjectUrl: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) },
      { id: 'data', type: 'slides', name: marker, src: 'data:image/svg+xml,' + encodeURIComponent(svg) },
      { id: 'relative', type: 'image', name: marker, url: './audit-image.png?a=1&b=2' },
      { id: 'http', type: 'video', name: marker, url: baseURL + '/audit-video.mp4?a=1&b=2' },
      { id: 'https', type: 'audio', name: marker, url: 'https://media.example.test/audit.wav?a=1&b=2' },
      { id: 'quoted', type: 'image', name: marker, url: baseURL + '/audit.png?name=' + attribute },
      { id: 'std_emo_happy_01', type: 'shape', name: marker }
    ];
  }, { marker, attribute, baseURL });
  const trials = stimuli.map(s => ({ stimulusId: s.id, duration: 1000 }));
  await mount(page, [task(marker, { useAOI: true, trials })], 4, {}, stimuli);
  const cards = page.locator('.builder-aoi-card');
  await expect.poll(() => cards.nth(0).locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(cards.nth(0).locator('img')).toHaveAttribute('alt', attribute);
  await expect.poll(() => cards.nth(1).locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(cards.nth(2).locator('img')).toHaveAttribute('src', baseURL + '/apps/web/audit-image.png?a=1&b=2');
  await expect(cards.nth(3).locator('video')).toHaveAttribute('src', baseURL + '/audit-video.mp4?a=1&b=2');
  await expect(cards.nth(4).locator('audio')).toHaveAttribute('src', 'https://media.example.test/audit.wav?a=1&b=2');
  await expect(cards.nth(6).locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await inertInputs(page);
});

for (const importer of ['showImportInterface', 'renderStep2']) {
  test(`dormant ${importer}: JSON counts cannot trust a non-array trials.length`, async ({ page }) => {
    // Neither importer has a current UI caller. Expose only a test hook, not a product API.
    const source = readFileSync(sourcePath, 'utf8');
    const marker = '  renderStepper();\n  renderCanvas();\n  return root;';
    expect(source.split(marker)).toHaveLength(2);
    await page.route('**/researcher-builder.js*', route => route.fulfill({ contentType: 'application/javascript',
      body: source.replace(marker, `  root.__oldAuditImport = ${importer};\n${marker}`) }));
    await open(page);
    await mount(page, [], 0);
    await page.evaluate(() => (document.querySelector('#view > div') as any).__oldAuditImport());
    const json = { title: attribute, blocks: [
      { id: attribute, type: 'cognitive_task', trials: { length: '<img src=x onerror="window.__builderXss=true">' } },
      { id: 'valid', type: 'cognitive_task', trials: [{ condition: attribute }, {}] },
      { id: 'unknown', type: attribute, trials: [] }
    ] };
    await page.locator('#imp_file').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    await expect(page.locator('#imp_info')).toBeVisible();
    await page.locator('#imp_start_btn').click();
    await expect(page.locator('#imp_open_btn')).toBeVisible();
    await expect(page.locator('#imp_result')).toContainText(attribute);
    await expect(page.locator('#imp_result [style*="font-size:20px"]')).toHaveText(['3', '2']);
    await inertInputs(page);
  });
}

test('trial feedback remains literal and response keys still advance the preview', async ({ page }) => {
  await open(page);
  await mount(page, [task('Feedback task', { useRT: true, showFeedback: true, feedbackCorrect: marker,
    trials: [{ stimulusId: 'std_simple_black_square', action: 'KeyQ', duration: 60000, repetitions: 1 }] })], 5,
    {}, [{ id: 'std_simple_black_square', type: 'shape', name: attribute }]);
  await page.locator('#runUserPreviewBtn').click();
  await page.keyboard.press('q');
  await expect(page.locator('#previewStage')).toContainText(marker);
  await inertInputs(page);
  await page.locator('#previewRunClose').click();
});

test('invalid imported task cannot bypass blocking publication preflight', async ({ page }) => {
  await open(page);
  await mount(page, [task(marker, { taskType: attribute })], 8);
  await page.locator('#finishSaveProtocolBtn').click();
  await expect(page.locator('[data-protocol-preflight="errors"]')).toBeVisible();
  await expect(page.locator('[data-preflight-continue]')).toHaveCount(0);
  expect(mutations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-protocol-preflight]')).toHaveCount(0);
  await expect(page.locator('#finishSaveProtocolBtn')).toBeEnabled();
  await inertInputs(page);
});

test('preflight cancel, API failure and retry preserve literal payloads and the stable publication link', async ({ page, baseURL }) => {
  fixtures.set('/invitations', { public_code: attribute, publication_version: marker });
  await open(page);
  await mount(page, [task()], 8, { apiProtocolId: 901, invitationCode: 'previous-code', publishVerifiedAt: '2026-11-05',
    participantLink: baseURL + '/apps/participant-web/run_new.html?code=previous-code' });
  await page.locator('#finishSaveProtocolBtn').click();
  await expect(page.locator('[data-protocol-preflight]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(mutations).toEqual([]);
  invitationFails = true;
  await page.locator('#finishSaveProtocolBtn').click();
  await page.locator('[data-preflight-continue]').click();
  await expect(page.locator('#protocolSaveStatus')).toContainText(/Error:|Ошибка:/);
  await expect(page.locator('#participantLinkInput')).toHaveValue(/previous-code/);
  await inertInputs(page);
  invitationFails = false;
  await page.locator('#finishSaveProtocolBtn').click();
  await page.locator('[data-preflight-continue]').click();
  const link = baseURL + '/apps/participant-web/run_new.html?code=' + encodeURIComponent(attribute);
  await expect(page.locator('#participantLinkInput')).toHaveValue(link);
  await expect(page.locator('#protocolSaveStatus')).toContainText(marker);
  const protocols = mutations.filter(m => m.path === '/protocols/901');
  expect(protocols).toHaveLength(2);
  expect(mutations.filter(m => m.path === '/protocols')).toHaveLength(0);
  for (const write of protocols) {
    expect(write.body.name).toBe(marker);
    expect(write.body.definition.description).toBe(marker);
    expect(write.body.definition.builderState.blocks[0].label).toBe(marker);
  }
  await inertInputs(page);
  await page.evaluate(() => {
    document.getElementById('view')!.replaceChildren((window as any).ExperimentBuilderView({ experimentId: 'audit-builder', startStep: 8 }));
  });
  await expect(page.locator('#participantLinkInput')).toHaveValue(link);
  await expect(page.locator('#protocolSaveStatus')).toContainText(marker);
  await inertInputs(page);
});

test('preflight warning paths/messages remain text and keyboard controls still cancel and confirm', async ({ page }) => {
  await open(page);
  await page.evaluate(marker => {
    (window as any).__preflightResult = 'pending';
    void (window as any).confirmProtocolPreflight({ ok: true, errors: [],
      warnings: [{ path: marker, message: { ru: marker, en: marker } }], duration: { plannedMaximumMs: 1000 } }, 'en')
      .then((result: boolean) => { (window as any).__preflightResult = result; });
  }, marker);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.locator('li')).toHaveText(marker);
  await expect(dialog.locator('[onerror], [onload]')).toHaveCount(0);
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('[data-preflight-continue]')).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__preflightResult)).toBe(true);
  await inertInputs(page);
});
