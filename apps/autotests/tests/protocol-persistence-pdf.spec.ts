import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const BASE = (process.env.EMOCOG_WEB_ORIGIN || 'http://127.0.0.1:4173') + '/apps/web/researcher.html?analyticsPreview=1';

test.beforeEach(async ({ page }, info) => {
  if (info.title.startsWith('real cookie API ')) return;
  // Preview reports are synthetic and must never contact a user's local API.
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({
    status: route.request().method() === 'OPTIONS' ? 204 : 401,
    headers: { 'Access-Control-Allow-Origin': new URL(BASE).origin, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token,X-Staff-User-ID', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' },
    body: route.request().method() === 'OPTIONS' ? '' : '{"error":"Synthetic unauthenticated preview"}'
  }));
});

test('instruction title updates immediately, and draft saves the complete builder state through API', async ({ page }) => {
  await page.goto(`${BASE}#/analytics/session-card`);
  await page.evaluate(() => {
    const w = window as any;
    localStorage.setItem('emocog_selected_project_id', '1');
    localStorage.setItem('emocog_my_experiments', JSON.stringify([{ id: 'draft-title', title: 'Draft', protocolId: 'draft-title', savedStep: 2,
      metadata: { title: 'Draft', protocolId: 'draft-title', estimatedDuration: '7 minutes' },
      blocks: [{ id: 'instruction', type: 'instruction', label: 'Old title', content: { title: 'Old title', text: 'Read', buttonText: 'Start' } }] }]));
    w.hasResearcherApiToken = () => true;
    w.apiPost = async (_path: string, payload: any) => {
      w.__savedDraft = payload;
      return { id: 501, project_id: 1, name: payload.name, definition: payload.definition, updated_at: new Date().toISOString() };
    };
    w.apiGet = async () => [];
    document.getElementById('view')!.replaceChildren(w.ExperimentBuilderView({ experimentId: 'draft-title', startStep: 2 }));
  });
  await page.locator('.proto-card .edit-btn').click();
  await page.locator('.proto-field[data-field="title"]').fill('Тренировочный блок');
  await expect(page.locator('.proto-card-title')).toHaveText('Тренировочный блок');
  await page.locator('#saveDraftGlobalBtn').click();
  await expect.poll(() => page.evaluate(() => (window as any).__savedDraft?.save_mode)).toBe('draft');
  const saved = await page.evaluate(() => (window as any).__savedDraft);
  expect(saved.definition.builderState.blocks[0].label).toBe('Тренировочный блок');
  expect(saved.definition.builderState.metadata.estimatedDuration).toBe('7 minutes');
  expect(saved.definition.builderState.savedStep).toBe(2);
});

test('failed publication retains the old link and edits; retry updates the same protocol, without duplicate creation', async ({ page }) => {
  await page.goto(`${BASE}#/analytics/session-card`);
  await page.evaluate(() => {
    const w = window as any;
    localStorage.setItem('emocog_selected_project_id', '1');
    const old = { id: 'published-edit', apiProtocolId: 502, projectId: 1, title: 'Revised protocol', protocolId: 'published-edit', status: 'active',
      invitationCode: 'previous-code', participantLink: 'http://127.0.0.1:4173/apps/participant-web/run_new.html?code=previous-code',
      metadata: { title: 'Revised protocol', protocolId: 'published-edit', estimatedDuration: '7 minutes', description: 'Edited' },
      blocks: [{ id: 'instruction', type: 'instruction', label: 'Changed instruction', content: { title: 'Changed instruction', text: 'Changed text', buttonText: 'Start' } }] };
    localStorage.setItem('emocog_my_experiments', JSON.stringify([old]));
    w.__patches = []; w.__creates = 0; w.__invitations = 0;
    w.hasResearcherApiToken = () => true;
    w.apiPatch = async (_path: string, payload: any) => { w.__patches.push(payload); return { id: 502, project_id: 1, updated_at: new Date().toISOString() }; };
    w.apiPost = async (path: string) => {
      if (path === '/protocols') { w.__creates++; throw new Error('Unexpected duplicate'); }
      if (++w.__invitations === 1) throw new Error('503 — invitation temporarily unavailable');
      return { code: 'new-published-code' };
    };
    document.getElementById('view')!.replaceChildren(w.ExperimentBuilderView({ experimentId: old.id, startStep: 8 }));
  });
  await page.locator('#finishSaveProtocolBtn').click();
  await expect(page.locator('#protocolSaveStatus')).toContainText(/прежн|previous/);
  await expect(page.locator('#participantLinkInput')).toHaveValue(/previous-code/);
  await expect(page.locator('#copyParticipantLinkBtn')).toBeEnabled();
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_my_experiments')!)[0]);
  expect(pending.pendingSync).toBe(true);
  expect(pending.blocks[0].content.text).toBe('Changed text');
  await page.locator('#finishSaveProtocolBtn').click();
  await expect(page.locator('#participantLinkInput')).toHaveValue(/new-published-code/);
  const writes = await page.evaluate(() => ({ patches: (window as any).__patches.length, creates: (window as any).__creates }));
  expect(writes).toEqual({ patches: 2, creates: 0 });
});

test('API deletion is awaited; a failed deletion does not remove a protocol from the list', async ({ page }) => {
  await page.goto(`${BASE}#/analytics/session-card`);
  await page.evaluate(() => {
    const w = window as any;
    localStorage.setItem('emocog_selected_project_id', '1');
    localStorage.setItem('emocog_my_experiments', JSON.stringify([{ id: 'delete-me', apiProtocolId: 503, projectId: 1, title: 'Delete me', status: 'draft', blocks: [] }]));
    w.hasResearcherApiToken = () => true;
    w.apiGet = async () => [{ id: 503, project_id: 1, name: 'Delete me', definition: { isDraft: true, blocks: [] }, updated_at: new Date().toISOString() }];
    w.__deletionCalls = 0;
    w.apiDelete = async () => { if (++w.__deletionCalls === 1) throw new Error('409 — Protocol has collected sessions and cannot be deleted'); w.apiGet = async () => []; };
    document.getElementById('view')!.replaceChildren(w.ExperimentsListView());
  });
  await expect(page.locator('.del-exp-btn')).toBeVisible();
  await page.locator('.del-exp-btn').click();
  await expect(page.locator('.exp-card')).toHaveCount(1);
  await expect(page.locator('.del-exp-btn')).toBeEnabled();
  await page.locator('.del-exp-btn').click();
  await expect(page.locator('.exp-card')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__deletionCalls)).toBe(2);
});

test('a new protocol retries publication without creating another database row', async ({ page }) => {
  await page.goto(`${BASE}#/analytics/session-card`);
  await page.evaluate(() => {
    const w = window as any;
    localStorage.setItem('emocog_selected_project_id', '1');
    localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify({ title: 'Brand new', protocolId: 'brand-new', estimatedDuration: '2 min' }));
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{ id: 'instruction', type: 'instruction', label: 'Instruction', content: { title: 'Instruction', text: 'Read', buttonText: 'Start' } }]));
    w.hasResearcherApiToken = () => true;
    w.__creates = 0; w.__patches = 0; w.__invitations = 0;
    w.apiPost = async (path: string) => {
      if (path === '/protocols') { w.__creates++; return { id: 504, project_id: 1, updated_at: new Date().toISOString() }; }
      if (++w.__invitations === 1) throw new Error('503 — retry');
      return { code: 'published-new' };
    };
    w.apiPatch = async () => { w.__patches++; return { id: 504, project_id: 1, updated_at: new Date().toISOString() }; };
    document.getElementById('view')!.replaceChildren(w.ExperimentBuilderView({ startStep: 8 }));
  });
  await page.locator('#finishSaveProtocolBtn').click();
  await expect(page.locator('#protocolSaveStatus')).toContainText('503');
  await page.locator('#finishSaveProtocolBtn').click();
  await expect(page.locator('#participantLinkInput')).toHaveValue(/published-new/);
  expect(await page.evaluate(() => ({ creates: (window as any).__creates, patches: (window as any).__patches }))).toEqual({ creates: 1, patches: 1 });
});

test('a fresh project member restores all draft settings from the API, not browser storage', async ({ page }) => {
  await page.goto(`${BASE}#/analytics/session-card`);
  await page.evaluate(() => {
    const w = window as any;
    localStorage.setItem('emocog_selected_project_id', '1');
    localStorage.removeItem('emocog_my_experiments');
    w.hasResearcherApiToken = () => true;
    w.apiGet = async () => [{ id: 505, project_id: 1, name: 'Colleague draft', definition: { isDraft: true, protocolId: 'peer-draft',
      settings: { persistence: { showBackupNotifications: false } }, builderState: {
      metadata: { title: 'Colleague draft', protocolId: 'peer-draft', estimatedDuration: '11 min' }, savedStep: 2, version: '1.2',
      sessionFeatureFlags: { photodiode: true }, analyticsPlan: { selectedMetricIds: ['task.rt_median_ms'] },
      blocks: [{ id: 'instruction', type: 'instruction', label: 'Shared instruction', content: { title: 'Shared instruction', text: 'Peer text' } }]
    } }, updated_at: new Date().toISOString() }];
    document.getElementById('view')!.replaceChildren(w.ExperimentsListView());
  });
  await expect(page.locator('.exp-card')).toContainText('Colleague draft');
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_my_experiments')!)[0]);
  expect(entry.status).toBe('draft');
  expect(entry.metadata.estimatedDuration).toBe('11 min');
  expect(entry.sessionFeatureFlags.photodiode).toBe(true);
  expect(entry.blocks[0].content.text).toBe('Peer text');
  expect(entry.version).toBe('1.2');
  expect(entry.persistenceSettings.showBackupNotifications).toBe(false);
});

test('saving directly from QC keeps edited thresholds in the project draft', async ({ page }) => {
  await page.goto(`${BASE}#/analytics/session-card`);
  await page.evaluate(() => {
    const w = window as any;
    localStorage.setItem('emocog_selected_project_id', '1');
    localStorage.setItem('emocog_my_experiments', JSON.stringify([{ id: 'qc-draft', title: 'QC draft', protocolId: 'qc-draft', blocks: [],
      metadata: { title: 'QC draft', protocolId: 'qc-draft', estimatedDuration: '2 min' }, qcThresholds: { gazeValid: { enabled: true, threshold: 77, hardStop: false } } }]));
    w.hasResearcherApiToken = () => true;
    w.apiGet = async () => [];
    w.apiPost = async (_path: string, payload: any) => { w.__savedDraft = payload; return { id: 510, project_id: 1, updated_at: new Date().toISOString() }; };
    document.getElementById('view')!.replaceChildren(w.ExperimentBuilderView({ experimentId: 'qc-draft', startStep: 6 }));
  });
  await expect(page.locator('.qc-range[data-key="gazeValid"]')).toHaveValue('77');
  await expect(page.locator('#protocolBackupNotificationsToggle')).toBeChecked();
  await page.locator('#protocolBackupNotificationsToggle').uncheck();
  await page.locator('#qcNext').click();
  await page.locator('#analyticsBackBtn').click();
  await expect(page.locator('#protocolBackupNotificationsToggle')).not.toBeChecked();
  await page.locator('.qc-range[data-key="gazeValid"]').fill('83');
  await page.locator('#saveDraftGlobalBtn').click();
  await expect.poll(() => page.evaluate(() => (window as any).__savedDraft?.definition.builderState.qcThresholds.gazeValid.threshold)).toBe(83);
  const publishedSettings = await page.evaluate(() => (window as any).__savedDraft.definition.settings.qualityControl);
  expect(publishedSettings.schemaVersion).toBe('protocol_quality.v1');
  expect(await page.evaluate(() => (window as any).__savedDraft.definition.settings.persistence.showBackupNotifications)).toBe(false);
  expect(publishedSettings.rules.gazeValid.threshold).toBe(83);
});

test('a failed local save is not overwritten by the server list refresh', async ({ page }) => {
  await page.goto(`${BASE}#/analytics/session-card`);
  await page.evaluate(() => {
    const w = window as any;
    localStorage.setItem('emocog_selected_project_id', '1');
    localStorage.setItem('emocog_my_experiments', JSON.stringify([{ id: 'pending', apiProtocolId: 511, projectId: 1, title: 'Unsynced changes',
      pendingSync: true, metadata: { title: 'Unsynced changes' }, blocks: [{ id: 'local', type: 'instruction', content: { text: 'Keep me' } }] }]));
    w.hasResearcherApiToken = () => true;
    w.apiGet = async () => [{ id: 511, project_id: 1, name: 'Old server title', definition: { blocks: [] }, updated_at: new Date().toISOString() }];
    document.getElementById('view')!.replaceChildren(w.ExperimentsListView());
  });
  await expect(page.locator('.exp-card')).toContainText('Unsynced changes');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_my_experiments')!)[0].blocks[0].content.text)).toBe('Keep me');
});

for (const tab of ['session-card', 'data-quality', 'connectedness', 'group-comparison']) {
  test(`downloads a real current-report PDF for ${tab} with the applied snapshot`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${BASE}#/analytics/${tab}`);
    await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
    await page.locator('#analyticsApplyFilters').click();
    const button = page.locator('#analyticsPdfDownload');
    await expect(button).toBeEnabled();
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    expect(download.suggestedFilename()).toContain(`-${tab}.pdf`);
    const file = info.outputPath(`${tab}.pdf`);
    await download.saveAs(file);
    const bytes = await readFile(file);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(10000);
    await expect(page.locator('#analyticsPdfStatus')).toContainText(/скачан|downloaded/);
    expect(errors).toEqual([]);
  });
}

test('PDF is not downloaded after a selection change during preparation', async ({ page }) => {
  await page.goto(`${BASE}#/analytics/session-card`);
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('#analyticsPdfDownload')).toBeEnabled();
  await page.evaluate(() => {
    const w = window as any;
    const api = w.EmocogAnalyticsProduction.api;
    const original = api.exportSnapshot;
    api.exportSnapshot = async (...args: any[]) => {
      const result = await original(...args);
      w.EmocogAnalyticsProduction.store.state.dirty = true;
      return result;
    };
  });
  const downloads: string[] = [];
  page.on('download', item => downloads.push(item.suggestedFilename()));
  await page.locator('#analyticsPdfDownload').click();
  await expect(page.locator('#analyticsPdfStatus')).toContainText(/изменились|changed/);
  expect(downloads).toEqual([]);
});

test('PDF export rejects backend export denial rather than using cached analytics', async ({ page }) => {
  await page.goto(`${BASE}#/analytics/session-card`);
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('#analyticsPdfDownload')).toBeEnabled();
  await page.evaluate(() => { (window as any).EmocogAnalyticsProduction.api.exportSnapshot = async () => { throw new Error('403 — Export access denied'); }; });
  const downloads: string[] = [];
  page.on('download', item => downloads.push(item.suggestedFilename()));
  await page.locator('#analyticsPdfDownload').click();
  await expect(page.locator('#analyticsPdfStatus')).toContainText('403');
  expect(downloads).toEqual([]);
});

test('real cookie API preserves published links and shares edited drafts with a second researcher', async ({ page, browser }) => {
  test.skip(process.env.RUN_RESEARCHER_CONTRACT !== '1', 'Requires the isolated API fixture');
  const projectId = process.env.EMOCOG_RESEARCHER_PROJECT_ID!;
  expect(projectId).toBeTruthy();
  const api = process.env.WECOG_AUDIT_API_BASE || 'http://127.0.0.1:3000';
  const url = BASE.replace('?analyticsPreview=1', '');
  async function authenticate(context: import('@playwright/test').BrowserContext, email: string) {
    const response = await context.request.post(`${api}/auth/login`, { headers: { 'X-Auth-Transport': 'cookie' }, data: { email, password: process.env.EMOCOG_RESEARCHER_PASSWORD || 'Researcher2026!' } });
    expect(response.ok(), await response.text()).toBe(true);
    const auth = await response.json();
    await context.addInitScript(({ auth, projectId, api }) => {
      localStorage.setItem('emocog_developer_auth', '1');
      localStorage.setItem('emocog_api_user', JSON.stringify(auth.user));
      localStorage.setItem('emocog_workspace_owner_v1', String(auth.user.id));
      localStorage.setItem('emocog_selected_project_id', projectId);
      localStorage.setItem('emocog_api_base', api);
      sessionStorage.setItem('emocog_csrf_token', auth.csrf_token);
    }, { auth, projectId, api });
    return auth;
  }
  const auth = await authenticate(page.context(), process.env.EMOCOG_RESEARCHER_EMAIL || 'local.researcher@wecog.test');
  const slug = `http-draft-${Date.now()}`;
  await page.addInitScript(({ slug }) => {
    localStorage.setItem('emocog_protocol_step_draft', '8');
    localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify({ title: slug, protocolId: slug, estimatedDuration: '2 min' }));
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{ id: 'instruction', type: 'instruction', label: 'Original instruction', content: { title: 'Original instruction', text: 'Original text', buttonText: 'Start' } }]));
  }, { slug });
  let protocolId: number | undefined;
  const peer = await browser.newContext();
  try {
    await page.goto(`${url}#/experiments/builder`);
    await page.locator('#finishSaveProtocolBtn').click();
    await expect(page.locator('#protocolSaveStatus')).toContainText(/успешно опубликован|published successfully/);
    const entry = await page.evaluate(slug => JSON.parse(localStorage.getItem('emocog_my_experiments')!).find((row: any) => row.protocolId === slug), slug);
    protocolId = entry.apiProtocolId;
    expect(protocolId).toBeGreaterThan(0);
    const invitationCode = entry.invitationCode;
    const exportCheck = await page.evaluate(async ({ projectId, protocolId }) => {
      const w = window as any;
      const snapshot = await w.apiPost('/analytics/v1/snapshots', { schemaVersion: '1.0', mode: 'group', analysisLevel: 'level_1',
        projectId: Number(projectId), protocolId, protocolVersion: 'v2.0_universal', metricIds: ['qc.valid_gaze_pct'],
        filters: { participantIds: [], sessionIds: [], groupIds: [], conditionIds: [], blockIds: [], stimulusIds: [], aoiIds: [],
          qcMode: 'all', qcChannels: ['task', 'gaze'], minValidFraction: null, minSignalConfidence: null, dateFrom: null, dateTo: null,
          deviceClasses: [], includeIncompleteSessions: true } });
      const result = await w.EmocogAnalyticsProduction.api.exportSnapshot({ snapshot, dirty: false,
        protocols: [{ id: protocolId, name: 'Real API export' }], query: { protocolId: String(protocolId) } }, 'json', 'both');
      const bundle = JSON.parse(await result.blob.text());
      return { snapshotId: snapshot.id, exportedId: bundle.snapshot.id, hash: snapshot.datasetHash, exportedHash: bundle.snapshot.datasetHash };
    }, { projectId, protocolId: protocolId! });
    expect(exportCheck.snapshotId).toBe(exportCheck.exportedId);
    expect(exportCheck.hash).toBe(exportCheck.exportedHash);
    await page.goto(`${url}#/experiments`);
    await page.locator(`.edit-exp-btn[data-id="${entry.id}"]`).click();
    await page.locator('.proto-card .edit-btn').click();
    await page.locator('.proto-field[data-field="title"]').fill('Edited shared instruction');
    await page.locator('#saveDraftGlobalBtn').click();
    await expect(page.locator('.exp-card').filter({ hasText: slug })).toContainText(/Черновик|Draft/);
    await authenticate(peer, process.env.EMOCOG_PEER_EMAIL || 'local.peer@wecog.test');
    const peerPage = await peer.newPage();
    await peerPage.goto(`${url}#/experiments`);
    const peerCard = peerPage.locator('.exp-card').filter({ hasText: slug });
    await expect(peerCard).toContainText(/Черновик|Draft/);
    await peerCard.locator('.edit-exp-btn').click();
    await expect(peerPage.locator('.proto-card-title')).toHaveText('Edited shared instruction');
    const invitation = await page.request.get(`${api}/invitations/by-code/${invitationCode}`);
    expect(invitation.ok()).toBe(true);
    const definition = (await invitation.json()).definition;
    expect(definition.blocks.find((block: any) => block.id === 'instruction').content.title).toBe('Original instruction');
    expect(definition.builderState).toBeUndefined();
    await peerPage.locator('.bstep[data-step="8"]').click();
    await peerPage.locator('#finishSaveProtocolBtn').click();
    await expect(peerPage.locator('#protocolSaveStatus')).toContainText(/Версия публикации: 2|Publication version: 2/);
    await expect(peerPage.locator('#participantLinkInput')).toHaveValue(entry.participantLink);
    const republished = await (await page.request.get(`${api}/invitations/by-code/${invitationCode}`)).json();
    expect(republished.code).not.toBe(invitationCode);
    expect(republished.publication_version).toBe(2);
    expect(republished.definition.blocks.find((block: any) => block.id === 'instruction').content.title).toBe('Edited shared instruction');
  } finally {
    if (protocolId) expect((await page.context().request.delete(`${api}/protocols/${protocolId}`, { headers: { 'X-CSRF-Token': auth.csrf_token } })).status()).toBe(204);
    await peer.close();
  }
});
