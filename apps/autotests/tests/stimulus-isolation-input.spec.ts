import { test, expect } from '@playwright/test';

const base = 'http://127.0.0.1:4173';
const participant = `${base}/apps/participant-web/mvp_with_precheck_1-updated.html`;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('project library hides stale files, hydrates late images, retries errors and rejects out-of-order responses', async ({ page }, testInfo) => {
  let failEight = true;
  let failPreview = false;
  let wrongProject = false;
  let version = 0;
  let holdSeven = false;
  let sevenPending = false;
  const releaseSeven: Array<() => void> = [];
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_selected_project_id', '99');
    localStorage.setItem('emocog_stimuli', JSON.stringify([
      { id: '99', apiStimulusId: 99, projectId: 99, name: 'Foreign project image', type: 'image', url: 'data:image/png;base64,foreign' },
      { id: 'legacy-foreign', name: 'Unscoped image', type: 'image', url: 'data:image/png;base64,legacy' }
    ]));
    localStorage.setItem('emocog_folders', JSON.stringify([{ id: 'foreign-folder', name: 'Foreign folder', stimuliIds: ['99'] }]));
  });
  await page.route('http://127.0.0.1:3000/**', async route => {
    const url = new URL(route.request().url());
    const headers = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true' };
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body });
    if (url.pathname === '/auth/me') return json({ id: 1, role: 'researcher', email: 'test@example.org' });
    if (url.pathname === '/auth/permissions') return json({});
    if (url.pathname === '/projects') return json([{ id: 7, name: 'A' }, { id: 8, name: 'B' }]);
    if (url.pathname === '/stimuli/folders') return json([]);
    if (url.pathname === '/stimuli') {
      const projectId = Number(url.searchParams.get('project_id'));
      if (projectId === 8 && failEight) return json({ error: 'Temporary failure' }, 503);
      if (projectId === 7 && holdSeven) {
        sevenPending = true;
        await new Promise<void>(resolve => { releaseSeven.push(resolve); });
      }
      const id = projectId === 7 ? 42 : 43;
      return json([{ id, project_id: wrongProject ? 99 : projectId, name: `Project ${projectId} image`, mime_type: 'image/png',
        size_bytes: image.length, metadata: {}, updated_at: `2026-10-02T12:00:0${version}.000Z`,
        content_available: true, content_url: `/stimuli/${id}/content` }]);
    }
    if (/^\/stimuli\/\d+\/content$/.test(url.pathname)) {
      if (failPreview) return json({ error: 'Temporary preview failure' }, 503);
      return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'image/png' }, body: image });
    }
    return json({ error: 'Not mocked' }, 404);
  });
  await page.goto(`${base}/apps/web/researcher.html#/stimuli`);
  await expect(page.locator('.stimulus-card[data-id="99"]')).toHaveCount(0);
  await expect(page.locator('.stimulus-card[data-id="legacy-foreign"]')).toHaveCount(0);
  await expect(page.getByText('Foreign folder', { exact: true })).toHaveCount(0);
  const loadedImage = (id: number) => page.locator(`.stimulus-card[data-id="${id}"] img`);
  await expect.poll(() => loadedImage(42).evaluateAll(elements => elements.some(el =>
    (el as HTMLImageElement).src.startsWith('blob:') && (el as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const switchProject = (id: number) => page.evaluate(id => {
    (window as any).setResearcherProjectSelection(id);
  }, id);
  await switchProject(8);
  await expect(page.locator('.stimulus-card[data-id="42"]')).toHaveCount(0);
  await expect(page.locator('[data-stimulus-library-status]')).toContainText('Файлы на сервере не удалены');
  failEight = false;
  await page.locator('[data-stimulus-library-status] button').click();
  await expect.poll(() => loadedImage(43).evaluateAll(elements => elements.some(el =>
    (el as HTMLImageElement).src.startsWith('blob:') && (el as HTMLImageElement).naturalWidth > 0))).toBe(true);

  failPreview = true;
  ++version;
  await page.evaluate(() => (window as any).syncProjectStimuliFromApi());
  await expect(page.locator('.stimulus-card[data-id="43"] .stim-retry-btn')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_stimuli') || '[]')
    .some((item: any) => item.apiStimulusId === 43))).toBe(true);
  failPreview = false;
  await page.locator('.stimulus-card[data-id="43"] .stim-retry-btn').click();
  await expect.poll(() => loadedImage(43).evaluateAll(elements => elements.some(el =>
    (el as HTMLImageElement).src.startsWith('blob:') && (el as HTMLImageElement).naturalWidth > 0))).toBe(true);

  wrongProject = true;
  expect(await page.evaluate(() => (window as any).syncProjectStimuliFromApi().then(() => false, () => true))).toBe(true);
  await expect(page.locator('.stimulus-card[data-id="43"]')).toHaveCount(0);
  wrongProject = false;
  await page.locator('[data-stimulus-library-status] button').click();
  await expect(loadedImage(43)).toBeVisible();

  holdSeven = true;
  await switchProject(7);
  await expect.poll(() => sevenPending).toBe(true);
  await page.evaluate(() => { (window as any).__pendingLibraryTest = (window as any).syncProjectStimuliFromApi(); });
  await expect.poll(() => releaseSeven.length).toBeGreaterThanOrEqual(2);
  await switchProject(8);
  await expect(loadedImage(43)).toBeVisible();
  releaseSeven.forEach(release => release());
  await page.evaluate(() => (window as any).__pendingLibraryTest);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('emocog_stimuli') || '[]')
    .filter((row: any) => row.apiStimulusId).map((row: any) => row.projectId))).toEqual([8]);
  await expect(page.locator('.stimulus-card[data-id="42"]')).toHaveCount(0);
  await page.reload();
  await expect(loadedImage(43)).toBeVisible();
  await expect(page.locator('.stimulus-card').first()).toHaveAttribute('data-id', '43');
  await expect(page.locator('.stimulus-card[data-id="42"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('project-library.png') });
});

test('builder authors and preserves all four response keys alongside legacy Space', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('emocog_protocol_step_draft', '3');
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{
      id: 'key-task', type: 'cognitive_task', label: 'Keyboard task', content: {
        taskType: 'simple_rt', rtMin: 100, rtWindow: 2000, trials: ['я', 'ч', 'б', 'ю', 'Space'].map(action => ({
          stimulusId: 'std_simple_black_square', action, duration: 1000, repetitions: 1
        }))
      }
    }]));
  });
  await page.goto(`${base}/apps/web/researcher.html?analyticsPreview=1#/experiments/builder`);
  await page.locator('.open-trials-btn').click();
  const selectors = page.locator('.t-action');
  const expected = ['KeyZ', 'KeyX', 'Comma', 'Period', 'space'];
  expect(await selectors.evaluateAll(items => items.map(el => (el as HTMLSelectElement).value))).toEqual(expected);
  await selectors.first().selectOption('Period');
  await page.locator('#trialSaveBtn').click();
  await expect(page.locator('#trialSaveBtn')).toHaveCount(0);
  await page.locator('.open-trials-btn').click();
  await expect(selectors.first()).toHaveValue('Period');
  expect(await selectors.evaluateAll(items => items.map(el => (el as HTMLSelectElement).value))).toEqual(['Period', ...expected.slice(1)]);
});

for (const [code, en, ru] of [['KeyZ', 'z', 'я'], ['KeyX', 'x', 'ч'], ['Comma', ',', 'б'], ['Period', '.', 'ю']]) {
  for (const layout of ['en', 'ru']) {
    test(`participant accepts ${code} in ${layout} layout with canonical correctness and timing`, async ({ page }) => {
      await page.goto(participant);
      await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
      await page.evaluate(async ({ action }) => {
        const shared = (window as any).__WECOG_STATE__;
        shared.runtime.sessionRuntime.policyShown = true;
        const { loadAndStartCognitiveTask } = await import(new URL('js/web-page/experimental_task-updated.js?v=20261006-3', location.href).href);
        await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: {
          version: 'v2-keyboard-regression', blocks: [{ id: 'key-task', type: 'cognitive_task', taskType: 'simple_rt',
            blockConfig: { useFixation: false, stimulusDuration: 5000, responseMode: 'keypress' },
            trials: [{ stimulusId: 'std_simple_black_square', action, duration: 5000 }]
          }]
        } });
      }, { action: ru });
      await page.locator('#cogStartBtn').click();
      await expect(page.locator('#cogShape')).toBeVisible();
      await page.waitForTimeout(180);
      if (layout === 'en') await page.keyboard.press(code);
      else await page.evaluate(({ code, key }) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
      }, { code, key: ru });
      await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
      const result = await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults[0]);
      expect(result).toMatchObject({ response: code, expectedResponse: code, correct: true });
      expect(result.rt).toBeGreaterThan(0);
    });
  }
}

for (const [action, key] of [['Space', 'Space'], ['arrow_left', 'ArrowLeft'], ['я', 'KeyX']]) {
  test(`participant records ${key} once for expected ${action} and ignores shortcuts and held keys`, async ({ page }) => {
    await page.goto(participant);
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async action => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      const { loadAndStartCognitiveTask } = await import(new URL('js/web-page/experimental_task-updated.js?v=20261006-3', location.href).href);
      await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: {
        version: '1.0.0', blocks: [{ id: 'key-edge', type: 'cognitive_task', taskType: 'simple_rt',
          blockConfig: { useFixation: false, stimulusDuration: 5000, responseMode: 'keypress' },
          trials: [{ stimulusId: 'std_simple_black_square', action, duration: 5000 }],
        }],
      } });
    }, action);
    await page.locator('#cogStartBtn').click();
    await expect(page.locator('#cogShape')).toBeVisible();
    await page.evaluate(() => {
      for (const flag of ['repeat', 'ctrlKey', 'altKey', 'metaKey', 'isComposing']) {
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'я', [flag]: true, bubbles: true }));
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));
    });
    await page.waitForTimeout(180);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(0);
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
    const result = await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults[0]);
    expect(result).toMatchObject({ response: key, correct: action !== 'я' });
    expect(result.rt).toBeGreaterThan(0);
  });
}
