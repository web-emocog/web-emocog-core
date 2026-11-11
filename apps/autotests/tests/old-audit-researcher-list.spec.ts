import { test, expect, Page } from '@playwright/test';

const researcher = '/apps/web/researcher.html';
const api = 'http://127.0.0.1:3000';
const project = 'Duplicate project name';
const user = { id: 701, role: 'researcher', email: 'synthetic@example.test', csrf_token: 'synthetic-csrf' };
const protocol = (name: string, projectId = 7, id = 42) => ({
  id, project_id: projectId, name, definition: {}, invitation_code: 'synthetic-key',
});

async function prepare(page: Page, baseURL: string) {
  const calls: { projectId: string | null; method: string }[] = [];
  const saves: { project_id: number }[] = [];
  await page.addInitScript(({ user, api }) => {
    (window as any).WECOG_API_BASE = api;
    localStorage.setItem('emocog_workspace_owner_v1', String(user.id));
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_api_user', JSON.stringify(user));
    localStorage.setItem('emocog_selected_project_id', '7');
    sessionStorage.setItem('emocog_csrf_token', user.csrf_token);
  }, { user, api });
  await page.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === baseURL) return route.continue();
    if (url.origin !== api) return route.abort();
    const headers = {
      'Access-Control-Allow-Origin': baseURL,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token,X-Staff-User-ID',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let json: unknown = [];
    if (url.pathname === '/auth/me') json = user;
    if (url.pathname === '/auth/permissions') json = { operations: [] };
    if (url.pathname === '/projects') json = [{ id: 7, name: project }, { id: 8, name: project }];
    if (url.pathname === '/protocols') {
      const projectId = url.searchParams.get('project_id');
      calls.push({ projectId, method: req.method() });
      if (req.method() === 'POST') {
        const payload = req.postDataJSON();
        saves.push(payload);
        json = { id: 88, project_id: payload.project_id, revision: 1 };
      } else {
        json = projectId === '8' ? [protocol('Project B protocol', 8, 43)] : [protocol('Project A protocol')];
      }
    }
    return route.fulfill({ status: 200, headers, json });
  });
  await page.goto(researcher + '#/overview');
  await expect(page.locator('#projectSelect option[value="8"]')).toHaveCount(1);
  await expect(page.locator('.ov-proj-card')).toHaveCount(2);
  return { calls, saves };
}

test('keyboard selection uses project ID even when names match and new protocols save to the selected project', async ({ page, baseURL }) => {
  const { calls, saves } = await prepare(page, baseURL!);
  await page.evaluate(() => {
    (window as any).__projectChanges = [];
    window.addEventListener('wecog:projectchange', event => (window as any).__projectChanges.push((event as CustomEvent).detail.projectId));
  });
  const card = page.locator('button.ov-proj-card[data-project-id="8"]');
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/experiments$/);
  await expect(page.locator('#projectSelect')).toHaveValue('8');
  await expect(page.locator('.exp-card')).toContainText('Project B protocol');
  expect(calls.filter(call => call.method === 'GET').map(call => call.projectId)).toContain('8');
  expect(await page.evaluate(() => ({
    selected: localStorage.getItem('emocog_selected_project_id'),
    workspace: localStorage.getItem('emocog_selected_workspace_project_id'),
    events: (window as any).__projectChanges,
  }))).toEqual({ selected: '8', workspace: '8', events: ['8'] });
  await page.evaluate(() => (window as any).persistBuilderProtocolToApi(
    { protocolId: 'synthetic-project-switch', title: 'Synthetic', blocks: [] }, 'synthetic-project-switch', { draftOnly: true }));
  expect(saves.map(save => save.project_id)).toEqual([8]);
});

test('navigation aborts old protocol reads and late results cannot write to the shared cache', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.evaluate(() => {
    const w = window as any;
    const original = w.apiGet;
    w.__listReads = [];
    w.apiGet = (path: string, options: any) => {
      if (!path.startsWith('/protocols?project_id=')) return original(path, options);
      return new Promise(resolve => w.__listReads.push({ signal: options?.signal, resolve }));
    };
    w.navigate('#/experiments');
  });
  await page.waitForFunction(() => (window as any).__listReads.length === 1);
  await page.evaluate(() => {
    const w = window as any;
    w.navigate('#/overview');
    w.navigate('#/experiments');
  });
  await page.waitForFunction(() => (window as any).__listReads.length === 2);
  await page.evaluate(row => (window as any).__listReads[1].resolve([row]), protocol('Fresh server title'));
  await expect(page.locator('.exp-card')).toContainText('Fresh server title');
  const oldAborted = await page.evaluate(async row => {
    const old = (window as any).__listReads[0];
    old.resolve([row]); // The mocked server deliberately ignores cancellation.
    await new Promise(resolve => setTimeout(resolve, 0));
    return old.signal?.aborted;
  }, protocol('Stale server title'));
  expect(oldAborted).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_my_experiments')!).map((row: any) => row.title))).toEqual(['Fresh server title']);
  await expect(page.locator('.exp-card')).toContainText('Fresh server title');
});

test('browser Back and Forward restore the visible route and fetch only the mounted list', async ({ page, baseURL }) => {
  const { calls } = await prepare(page, baseURL!);
  await page.locator('#nav-experiments').click();
  await expect(page.locator('.exp-card')).toContainText('Project A protocol');
  await page.goBack();
  await expect(page.locator('.overview-page')).toBeVisible();
  await page.goForward();
  await expect(page.locator('.exp-card')).toContainText('Project A protocol');
  await expect.poll(() => calls.filter(call => call.method === 'GET').map(call => call.projectId)).toEqual(['7', '7']);
  await expect(page.locator('#experimentListSyncStatus')).toHaveCount(0);
});

test('a denied clipboard write never shows a success toast', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Denied'); } } });
    document.execCommand = () => false;
  });
  await page.locator('#nav-experiments').click();
  const copy = page.locator('.copy-exp-link-btn');
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.locator('#toast')).toHaveText(/Could not copy|Не удалось скопировать/);
  await expect(page.locator('body > input')).toHaveCount(0);
  await expect(copy).toBeFocused();
});

for (const cached of [false, true]) {
  test(`list failure keeps ${cached ? 'cached results unverified' : 'an unknown state distinct from empty'} and retry recovers`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!);
    await page.evaluate(({ cached, cachedRow, fresh }) => {
      const w = window as any;
      if (cached) localStorage.setItem('emocog_my_experiments', JSON.stringify([{
        id: 'cached', apiProtocolId: cachedRow.id, projectId: cachedRow.project_id,
        invitationCode: cachedRow.invitation_code, title: cachedRow.name, status: 'active',
      }]));
      const original = w.apiGet;
      let attempts = 0;
      w.apiGet = async (path: string, options: any) => {
        if (!path.startsWith('/protocols?project_id=')) return original(path, options);
        if (++attempts === 1) throw new Error('Synthetic network failure');
        if (attempts === 2) return [{ ...fresh, project_id: 8 }]; // Wrong scope is not a successful refresh.
        return [fresh];
      };
      w.navigate('#/experiments');
    }, { cached, cachedRow: protocol('Cached title'), fresh: protocol('Fresh title') });
    const status = page.locator('#experimentListSyncStatus');
    await expect(status).toContainText(/Could not refresh|Не удалось обновить/);
    await expect(page.locator('#view')).not.toContainText(/No experiments|Нет экспериментов/);
    if (cached) {
      await expect(page.locator('.exp-card')).toContainText('Cached title');
      await expect(page.locator('.copy-exp-link-btn')).toBeDisabled();
      await expect(page.locator('.copy-exp-link-btn')).toContainText(/Link not verified|Ссылка не проверена/);
    }
    await status.getByRole('button').click();
    await expect(status).toContainText(/Could not refresh|Не удалось обновить/);
    await expect(page.locator('#view')).not.toContainText('Fresh title');
    await status.getByRole('button').click();
    await expect(status).toHaveCount(0);
    await expect(page.locator('.exp-card')).toContainText('Fresh title');
    await expect(page.locator('.copy-exp-link-btn')).toBeEnabled();
  });
}
