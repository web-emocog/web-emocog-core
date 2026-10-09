import { test, expect, Page } from '@playwright/test';

const baseUrl = process.env.WECOG_TEST_BASE_URL || 'http://127.0.0.1:4173';
const deployedOrigin = 'https://photodiode.wecog.test';
const participantPath = '/apps/participant-web/mvp_with_precheck_1-updated.html';

async function openPublishedProtocol(page: Page, photodiode: boolean, query = '&photodiode=1') {
  await page.route(`${deployedOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/invitations/by-code/photodiode-fixture') {
      await route.fulfill({ json: { protocol_id: 9, project_id: 7, code: 'photodiode-fixture', definition: {
        version: 'v2.0_universal', settings: { featureFlags: { photodiode } },
        blocks: [{ id: 'rt', type: 'cognitive_task', taskType: 'simple_rt',
          blockConfig: { responseMode: 'keypress' },
          trials: [{ stimulusId: 'std_simple_black_square', action: 'я', duration: 5000 }] }]
      } } });
    } else if (url.pathname === '/api/invitations/by-code/photodiode-fixture/stimuli') {
      await route.fulfill({ json: [] });
    } else if (url.pathname.startsWith('/api/')) {
      await route.fulfill({ status: 404, json: { error: 'Synthetic endpoint' } });
    } else {
      const response = await route.fetch({ url: `${baseUrl}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    }
  });
  await page.goto(`${deployedOrigin}${participantPath}?code=photodiode-fixture${query}`);
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.invitationProtocolDefinition));
}

async function startLoadedTask(page: Page) {
  await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.runtime.sessionRuntime.policyShown = true;
    shared.runtime.sessionRuntime.notifyBlockComplete = async () => true;
    const { loadAndStartCognitiveTask } = await import(new URL(
      'js/web-page/experimental_task-updated.js?v=20261008-2', location.href).href);
    await loadAndStartCognitiveTask({ autoFinishSession: false });
  });
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
}

test('published enabled protocol works on a deployed hostname, without a participant override', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPublishedProtocol(page, true, '');
  await expect(page.locator('#photodiodeTemporaryNotice')).toBeVisible();
  await expect(page.locator('#photodiodeTemporaryToggle')).toBeChecked();
  await expect(page.locator('#photodiodeTemporaryToggle')).toBeDisabled();
  await expect(page.locator('#photodiode')).toBeHidden();
  await page.locator('#participantLanguageSelect').selectOption('en');
  await expect(page.locator('#photodiodeTemporaryText')).toContainText('enabled by the researcher');
  expect(await page.evaluate(() => (window as any).Photodiode.setEnabled(false))).toBe(true);
  await startLoadedTask(page);
  await expect(page.locator('#photodiode')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.experimentMeta.photodiode))
    .toMatchObject({ enabled: true, temporary: true, timingValidated: false, version: 'photodiode.temporary.v1' });
  await page.keyboard.press('KeyZ');
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
  await expect(page.locator('#photodiode')).toBeHidden();
  expect(errors).toEqual([]);
});

test('published disabled protocol ignores a participant query opt-in and emits no markers', async ({ page }) => {
  await openPublishedProtocol(page, false);
  await expect(page.locator('#photodiodeTemporaryNotice')).toBeHidden();
  expect(await page.evaluate(() => (window as any).Photodiode.setEnabled(true))).toBe(false);
  await startLoadedTask(page);
  await expect(page.locator('#photodiode')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.experimentMeta.photodiode)).toBeUndefined();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.events
    .filter((event: any) => event.type.startsWith('photodiode_')).length)).toBe(0);
});

test('researcher selection survives language, reload, draft save and reopen but not a new protocol', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('photodiode-builder-fixture')) return;
    localStorage.setItem('photodiode-builder-fixture', '1');
    localStorage.setItem('emocog_protocol_step_draft', '6');
    localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify({
      title: 'Photodiode draft fixture', protocolId: 'photodiode-draft-fixture', estimatedDuration: '2 min'
    }));
  });
  await page.goto(`${baseUrl}/apps/web/researcher.html?analyticsPreview=1#/experiments/builder`);
  const toggle = page.locator('#protocolPhotodiodeToggle');
  await expect(toggle).not.toBeChecked();
  await expect(toggle.locator('xpath=..')).toContainText(/временная функция|temporary feature/);
  await toggle.check();
  await page.evaluate(() => (window as any).setLang('en'));
  await expect(toggle).toBeChecked();
  await expect(toggle.locator('xpath=..')).toContainText('temporary feature');
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.locator('#saveDraftGlobalBtn').click();
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_my_experiments') || '[]')
    .find((item: any) => item.protocolId === 'photodiode-draft-fixture'));
  expect(draft.sessionFeatureFlags.photodiode).toBe(true);
  await page.evaluate((id: string) => { (window as any).ExperimentBuilderView({ experimentId: id, startStep: 6 }); }, draft.id);
  await expect(toggle).toBeChecked();
  await page.evaluate(() => (window as any).startNewExperimentBuilder());
  await page.locator('.bstep[data-step="6"]').click();
  await expect(toggle).not.toBeChecked();
});

test('mobile researcher control remains readable and supports keyboard selection', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('emocog_protocol_step_draft', '6'));
  await page.goto(`${baseUrl}/apps/web/researcher.html?analyticsPreview=1#/experiments/builder`);
  const toggle = page.locator('#protocolPhotodiodeToggle');
  await toggle.scrollIntoViewIfNeeded();
  await expect(toggle).toBeVisible();
  await expect(toggle.locator('xpath=..')).toContainText(/временная функция|temporary feature/);
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_session_features_draft') || '{}').photodiode)).toBe(true);
  const bounds = await toggle.evaluate(input => {
    const label = input.closest('label')!.getBoundingClientRect();
    const card = input.closest('[data-feature-status]')!.getBoundingClientRect();
    const text = input.closest('label')!.querySelector('span')!;
    return { labelRight: label.right, cardRight: card.right, textRight: text.getBoundingClientRect().right,
      textOverflow: text.scrollWidth - text.clientWidth };
  });
  expect(bounds.labelRight).toBeLessThanOrEqual(bounds.cardRight);
  expect(bounds.textRight).toBeLessThanOrEqual(bounds.cardRight);
  expect(bounds.textOverflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('photodiode-mobile.png') });
});

test('builder publishes the enabled flag as part of the API protocol definition', async ({ page }) => {
  let publishedDefinition: any;
  await page.route('http://127.0.0.1:3000/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/auth/me') return json({ id: 1, role: 'researcher', email: 'marker-fixture@example.test', csrf_token: 'synthetic-marker-csrf' });
    if (path === '/auth/permissions') return json({});
    if (path === '/projects') return json([{ id: 7, name: 'Synthetic marker project' }]);
    if (path === '/stimuli' || path === '/stimuli/folders') return json([]);
    if (path === '/protocols' && request.method() === 'POST') {
      publishedDefinition = request.postDataJSON().definition;
      return json({ id: 9, project_id: 7, definition: publishedDefinition }, 201);
    }
    if (path === '/invitations' && request.method() === 'POST') {
      return json({ id: 42, protocol_id: 9, code: 'synthetic-marker-code' }, 201);
    }
    return json({ error: 'Synthetic endpoint' }, 404);
  });
  await page.addInitScript(() => {
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_selected_project_id', '7');
    localStorage.setItem('emocog_protocol_step_draft', '6');
    localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify({
      title: 'Published marker fixture', protocolId: 'published-marker-fixture', estimatedDuration: '1 min'
    }));
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{
      id: 'rt', type: 'cognitive_task', label: 'RT', content: { taskType: 'simple_rt',
        trials: [{ stimulusId: 'std_simple_black_square', action: 'я', duration: 1000, repetitions: 1 }] }
    }, { id: 'final', type: 'final', label: 'Final' }]));
  });
  await page.goto(`${baseUrl}/apps/web/researcher.html?analyticsPreview=1#/experiments/builder`);
  await page.locator('#protocolPhotodiodeToggle').check();
  await page.locator('.bstep[data-step="8"]').click();
  await page.locator('#finishSaveProtocolBtn').click();
  await expect.poll(() => publishedDefinition?.settings?.featureFlags?.photodiode).toBe(true);
  await expect(page.locator('#protocolSaveStatus')).toContainText(/успешно опубликован|published successfully/);
});
