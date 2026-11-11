import { test as base, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

declare const stimuliList: any[];
declare const folders: any[];
const api = 'http://127.0.0.1:3000';
const foreign = 'http://127.0.0.1:3001'; // Intercepted only; no server or real external traffic.
const version = '11111111-1111-4111-8111-111111111111';
const marker = '<img src=x onerror="window.__stimuliXss=1"> & \' " <svg onload="window.__stimuliXss=1">';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
type Seen = { url: string; method: string; headers: Record<string, string>; body: any };
type State = { rows: any[]; folderRows: any[]; requests: Seen[]; redirect: boolean; failContent: boolean };

const test = base.extend<{ state: State }>({
  state: async ({ page, context, baseURL }, use) => {
    const state: State = { rows: [{ id: 42, project_id: 7, name: 'Synthetic stimulus', mime_type: 'image/png',
      current_version_id: version, created_by: 1, visibility: 'private', size_bytes: png.length,
      content_url: '/stimuli/42/content', preview_url: '/stimuli/42/preview', metadata: {} }],
    folderRows: [{ id: 6, project_id: 7, name: 'Synthetic folder' }], requests: [], redirect: false, failContent: false };
    await context.addCookies([{ name: 'synthetic_staff', value: 'credential-must-not-leak', url: api }]);
    await page.addInitScript(() => {
      localStorage.setItem('emocog_workspace_owner_v1', '1');
      localStorage.setItem('emocog_developer_auth', '1');
      localStorage.setItem('emocog_selected_project_id', '7');
      sessionStorage.setItem('emocog_csrf_token', 'synthetic-csrf-do-not-leak');
      (window as any).__stimuliFetchInits = [];
      const originalFetch = window.fetch;
      window.fetch = function(input, init) {
        (window as any).__stimuliFetchInits.push({ url: input instanceof Request ? input.url : String(input),
          credentials: init?.credentials ?? (input instanceof Request ? input.credentials : undefined),
          redirect: init?.redirect ?? (input instanceof Request ? input.redirect : undefined) });
        return originalFetch.call(this, input, init);
      };
      (window as any).__stimuliMediaCalls = 0;
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
        (window as any).__stimuliMediaCalls++;
        throw new Error('Camera/microphone forbidden by security regression test');
      };
    });
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin === baseURL) {
        if (process.env.OLD_AUDIT_STIMULI_BASELINE && url.pathname === '/apps/web/researcher-stimuli.js') {
          return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.OLD_AUDIT_STIMULI_BASELINE, 'utf8') });
        }
        return route.continue();
      }
      let body: any;
      try { body = req.postDataJSON(); } catch (_) { body = req.postData(); }
      state.requests.push({ url: req.url(), method: req.method(), headers: await req.allHeaders(), body });
      const headers = { 'Access-Control-Allow-Origin': baseURL!, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
      if (url.origin === foreign) return route.fulfill({ status: 200, headers, contentType: 'image/png', body: png });
      if (url.origin !== api) return route.abort();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const json = (body: unknown) => route.fulfill({ status: 200, headers, json: body });
      if (url.pathname === '/auth/me') return json({ id: 1, role: 'researcher', email: 'synthetic-stimuli@example.test', csrf_token: 'synthetic-csrf-do-not-leak' });
      if (url.pathname === '/auth/permissions') return json({ operations: [] });
      if (url.pathname === '/projects') return json([{ id: 7, name: 'Synthetic project' }]);
      if (url.pathname === '/stimuli/folders') return json(state.folderRows);
      if (url.pathname === '/stimuli') return json(state.rows);
      if (/\/stimuli\/[^/]+\/(?:content|preview)$/.test(url.pathname)) {
        if (state.redirect) return route.continue({ url: baseURL + '/__old_audit_stimuli_redirect' });
        if (state.failContent && url.pathname.endsWith('/content')) return route.fulfill({ status: 503, headers, json: { error: marker } });
        return route.fulfill({ status: 200, headers, contentType: 'image/png', body: png });
      }
      if (req.method() === 'PATCH') return json({ id: 42, name: body.name, folder_id: body.folder_id });
      if (req.method() === 'DELETE') return route.fulfill({ status: 204, headers });
      return json([]);
    });
    await use(state);
    expect(await page.evaluate(() => (window as any).__stimuliMediaCalls)).toBe(0);
  },
});

test.beforeEach(async ({ state }) => { expect(state.requests).toEqual([]); });

async function openLibrary(page: Page) {
  await page.goto('/apps/web/researcher.html#/stimuli');
  await expect(page.locator('.stimulus-card[data-id="42"]')).toBeVisible();
  await expect(async () => page.locator('.stimulus-card[data-id="42"]').scrollIntoViewIfNeeded()).toPass({ timeout: 5000 });
  await expect.poll(() => page.evaluate(() => !!(window as any).openAoiEditor)).toBe(true);
}

async function noExecution(page: Page, scope = '#view') {
  expect(await page.evaluate(() => (window as any).__stimuliXss)).toBeUndefined();
  if (scope === 'body') scope = '#view, #modalGallery, #aoiStage, #aoiList, #aoiForm, [data-upload-row]';
  await expect(page.locator(scope).locator('[onerror], [onload], [onfocus], [onclick], iframe, object, embed, a[href^="javascript:"]')).toHaveCount(0);
}

test('API names, folder names, metadata and rename response stay literal in gallery, folders and picker', async ({ page, state }) => {
  state.rows[0].name = marker;
  state.rows[0].metadata = { source_document_name: marker, source_page: marker };
  state.folderRows[0].name = marker;
  await openLibrary(page);
  await expect(page.locator('.stimulus-card[data-id="42"]')).toContainText(marker);
  await expect(page.locator('#stimuliTabBar')).toContainText(marker);
  await page.evaluate(() => {
    const host = document.createElement('nav'); host.id = 'stimuli-folders-subnav';
    document.getElementById('view')!.appendChild(host);
    (window as any).updateStimuliSubnav();
  });
  await expect(page.locator('#stimuli-folders-subnav')).toContainText(marker);
  await expect(page.locator('#stimuli-folders-subnav .stimuli-folder-nav-item').last()).toHaveAttribute('href', '#');
  await page.locator('.analytics-tab[data-folder-id="folder_6"]').click();
  await page.locator('#folderAddLibraryBtn').click();
  await expect(page.locator('#modalGallery')).toContainText(marker);
  await expect(page.locator('#modalGallery .modal-pick[data-id="42"] img')).toBeVisible();
  await noExecution(page, 'body');
  await page.locator('#modalCloseBtn').click();
  await page.locator('#chips .chip').first().click();
  const renamed = marker + ' renamed';
  page.once('dialog', dialog => dialog.accept(renamed));
  await page.locator('.stimulus-card[data-id="42"] .stim-edit-btn').click();
  await expect(page.locator('.stimulus-card[data-id="42"]')).toContainText(renamed);
  expect(state.requests.filter(r => r.method === 'PATCH').map(r => r.body)).toEqual([{ name: renamed }]);
  await noExecution(page);
  await page.locator('.stimulus-card[data-id="42"] .stim-delete-btn').click();
  await expect(page.locator('.stimulus-card[data-id="42"]')).toHaveCount(0);
  expect(state.requests.filter(r => r.method === 'DELETE').map(r => new URL(r.url).pathname)).toEqual(['/stimuli/42']);
});

test('legacy import IDs are exact data, not CSS selectors or inline action arguments', async ({ page, state }) => {
  await openLibrary(page);
  const id = 'import"] , .stimulus-card[data-id="42\\\'];window.__stimuliXss=1;//';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(({ id, marker }) => {
    const w = window as any;
    w.applyStimuliDefinitionsToLibrary(JSON.parse(JSON.stringify({ [id]: { type: 'text', aois: [] } })));
    stimuliList.find(item => item.id === id).name = marker;
    w.renderStimuliGallery(document.getElementById('stimuliGallery'));
  }, { id, marker });
  const card = page.locator('#stimuliGallery > .stimulus-card').filter({ hasText: marker });
  await card.click();
  await expect(card).toHaveClass(/selected/);
  await expect(page.locator('.stimulus-card[data-id="42"]')).not.toHaveClass(/selected/);
  const renamed = marker + ' import rename';
  page.once('dialog', dialog => dialog.accept(renamed));
  await card.locator('.stim-edit-btn').click();
  await expect(card).toContainText(renamed);
  await card.locator('.stim-delete-btn').click();
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(state.requests.filter(r => ['PATCH', 'DELETE'].includes(r.method))).toEqual([]);
  await noExecution(page);
});

test('scoped localStorage cannot forge runtime preview URLs or async state at the same API version', async ({ page, state }) => {
  await page.addInitScript(({ api, foreign, version, marker }) => {
    const scope = JSON.stringify(['1', api, '7']);
    localStorage.setItem('emocog_stimulus_library_v1:' + scope, JSON.stringify({ stimuli: [{
      id: '42', apiStimulusId: 42, projectId: 7, contentVersion: version,
      _previewObjectUrl: foreign + '/forged-full', _thumbnailObjectUrl: foreign + '/forged-thumb',
      _previewHydrationPromise: {}, _thumbnailPromise: {}, src: foreign + '/forged-src',
      aois: [{ id: marker, name: marker, shape: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], order: 1 }],
    }] }));
  }, { api, foreign, version, marker });
  await openLibrary(page);
  await expect(page.locator('.stimulus-card[data-id="42"] img')).toHaveAttribute('src', /^blob:/);
  await page.evaluate(() => (window as any).openAoiEditor('42'));
  await expect(page.locator('#aoiMedia')).toHaveAttribute('src', /^blob:/);
  await expect(page.locator('#aoiList')).toContainText(marker);
  expect(state.requests.filter(r => new URL(r.url).origin === foreign)).toEqual([]);
  await noExecution(page, 'body');
});

test('API and conversion metadata URLs cannot turn authenticated blob loads into requests to another origin', async ({ page, state }) => {
  state.rows[0].content_url = foreign + '/metadata-content';
  state.rows[0].preview_url = foreign + '/metadata-preview';
  await openLibrary(page);
  await expect(page.locator('.stimulus-card[data-id="42"] .stim-retry-btn')).toBeVisible();
  await page.evaluate(async ({ foreign, marker }) => {
    const w = window as any;
    for (const path of [foreign + '/x', '//127.0.0.1:3001/x', '/stimuli/42/content?next=' + foreign,
      '/stimuli/42/content#fragment', '/stimuli/42/../content', '/stimuli/42/content?version=bad',
      'data:image/png;base64,AAAA', 'javascript:window.__stimuliXss=1']) {
      const converted = w.convertedStimulusFromApi({ id: 52, project_id: 7,
        metadata: { content_url: path, source_page: marker }, preview_url: path }, { name: marker + '.pdf' }, 0, 1);
      await w.hydrateStimulusThumbnail(converted).catch(() => {});
      await w.hydrateApiStimulusPreview(converted).catch(() => {});
    }
    await w.openAoiEditor('42');
  }, { foreign, marker });
  await expect(page.locator('#aoiMedia')).toHaveCount(0);
  expect(state.requests.filter(r => new URL(r.url).origin === foreign)).toEqual([]);
  await noExecution(page, 'body');
});

test('approved API content keeps cookie/CSRF authentication and immutable version URLs', async ({ page, state, browserName }) => {
  state.rows[0].content_url += '?version=' + version;
  state.rows[0].preview_url += '?version=' + version;
  await openLibrary(page);
  await expect(page.locator('.stimulus-card[data-id="42"] img')).toHaveAttribute('src', /^blob:/);
  await page.evaluate(() => (window as any).openAoiEditor('42'));
  await expect(page.locator('#aoiMedia')).toHaveAttribute('src', /^blob:/);
  const reads = state.requests.filter(r => r.method === 'GET' && /\/stimuli\/42\/(content|preview)\?/.test(r.url));
  expect(reads.length).toBeGreaterThanOrEqual(2);
  for (const request of reads) {
    expect(new URL(request.url).searchParams.get('version')).toBe(version);
    expect(request.headers['x-csrf-token']).toBe('synthetic-csrf-do-not-leak');
    // WebKit request interception omits Cookie; verify the actual fetch init below in every engine.
    if (browserName !== 'webkit') expect(request.headers.cookie).toContain('synthetic_staff=credential-must-not-leak');
  }
  const inits = await page.evaluate(() => (window as any).__stimuliFetchInits.filter((r: any) => /\/stimuli\/42\/(content|preview)\?/.test(r.url)));
  expect(inits.length).toBeGreaterThanOrEqual(2);
  expect(inits.every((r: any) => r.credentials === 'include' && r.redirect === 'error')).toBe(true);
});

test('redirecting API previews fail closed and AOI does not retry them as native media', async ({ page, state }) => {
  state.redirect = true;
  await openLibrary(page);
  await expect(page.locator('.stimulus-card[data-id="42"] .stim-retry-btn')).toBeVisible();
  await page.locator('.stimulus-card[data-id="42"] .stim-retry-btn').click();
  await page.evaluate(() => (window as any).openAoiEditor('42'));
  await expect(page.locator('#aoiClose')).toBeVisible();
  await expect(page.locator('#aoiMedia')).toHaveCount(0);
  expect(state.requests.filter(r => new URL(r.url).origin === foreign)).toEqual([]);
});

test('failed API content never falls back to a cached external url/src in AOI or the folder picker', async ({ page, state }) => {
  state.failContent = true;
  await openLibrary(page);
  await expect(page.locator('.stimulus-card[data-id="42"] img')).toBeVisible();
  await page.evaluate(foreign => {
    const s = stimuliList.find(item => item.id === '42');
    s.url = foreign + '/fallback-url'; s.src = foreign + '/fallback-src';
  }, foreign);
  await page.locator('.analytics-tab[data-folder-id="folder_6"]').click();
  await page.locator('#folderAddLibraryBtn').click();
  await expect(page.locator('#modalGallery .modal-pick[data-id="42"] img')).toHaveAttribute('src', /^blob:/);
  await page.locator('#modalCloseBtn').click();
  await page.evaluate(() => (window as any).openAoiEditor('42'));
  await expect(page.locator('#aoiMedia')).toHaveCount(0);
  expect(state.requests.filter(r => new URL(r.url).origin === foreign)).toEqual([]);
});

test('legacy remote media is anonymous, while credential URLs and executable schemes are rejected', async ({ page, state }) => {
  await openLibrary(page);
  await page.evaluate(foreign => {
    const w = window as any, host = document.createElement('section'); host.id = 'legacyMedia'; document.body.appendChild(host);
    for (const type of ['image', 'video', 'audio']) host.insertAdjacentHTML('beforeend', w.stimulusPreviewHtml({
      id: 'legacy-' + type, type, url: foreign + '/' + type, name: 'Legacy remote media' }));
    for (const url of ['http://user:secret@127.0.0.1:3001/credentials', 'javascript:window.__stimuliXss=1',
      'data:text/html,<svg onload="window.__stimuliXss=1">', 'blob:http://127.0.0.1:3001/foreign']) {
      host.insertAdjacentHTML('beforeend', w.stimulusPreviewHtml({ id: 'bad-url', type: 'image', url }));
    }
  }, foreign);
  await expect.poll(() => [...new Set(state.requests.filter(r => new URL(r.url).origin === foreign && r.method === 'GET')
    .map(r => new URL(r.url).pathname))].sort()).toEqual(['/audio', '/image', '/video']);
  for (const request of state.requests.filter(r => new URL(r.url).origin === foreign)) {
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers['x-csrf-token']).toBeUndefined();
    expect(request.url).not.toContain('secret');
  }
  await expect(page.locator('#legacyMedia img')).toHaveCount(1);
  await noExecution(page, '#legacyMedia');
});

test('file titles round-trip through the upload dialog without creating HTML or inline actions', async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(marker => {
    (window as any).__uploadDetails = (window as any).requestStimulusUploadDetails([
      new File(['synthetic'], marker + '.png', { type: 'image/png' }),
    ]);
  }, marker);
  await expect(page.locator('[data-upload-name]')).toHaveValue(marker);
  await noExecution(page, 'body');
  await page.locator('[data-upload-name]').fill(marker + ' renamed');
  await page.locator('[data-upload-confirm]').click();
  expect(await page.evaluate(async () => (await (window as any).__uploadDetails)[0].name)).toBe(marker + ' renamed');
});

test('AOI IDs, names, geometry and validity from protocol import remain data through edit/save/delete', async ({ page }) => {
  await openLibrary(page);
  await page.evaluate(marker => {
    const w = window as any;
    w.applyStimuliDefinitionsToLibrary({ '42': { aois: [{ id: marker, name: marker, shape: 'rectangle',
      points: [{ x: '0.1', y: 0.1 }, { x: 0.8, y: '0.9' }], order: '2<svg onload="window.__stimuliXss=1">',
      isTarget: true, validityInterval: { startMs: 5, endMs: 1000 } },
    { id: 'bad-interval', shape: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      validityInterval: { startMs: '5<svg>', endMs: '1000<svg>' } },
    { id: 'bad-geometry', shape: 'polygon', points: [{ x: '"><svg onload="window.__stimuliXss=1">', y: 0 }] }] } });
    return w.openAoiEditor('42');
  }, marker);
  await expect(page.locator('#aoiList .aoi-list-item')).toHaveCount(1);
  await expect(page.locator('#aoiList')).toContainText(marker);
  await expect(page.locator('#aoiName')).toHaveValue(marker);
  await expect(page.locator('#aoiSvg [data-select]').first()).toHaveAttribute('data-select', marker);
  await page.locator('#aoiList .aoi-list-item').click();
  await page.locator('#aoiName').fill(marker + ' edited');
  await page.locator('#aoiSave').click();
  await noExecution(page, 'body');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_stimuli') || '[]').find((s: any) => s.id === '42').aois);
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe(marker + ' edited');
  expect(saved[0].points.every((p: any) => Number.isFinite(p.x) && p.x >= 0 && p.x <= 1)).toBe(true);
  await page.locator('#aoiDelete').click();
  await expect(page.locator('#aoiList .aoi-list-item')).toHaveCount(0);
});

test('AOI presentation fragments cannot inject actions, navigation, CSS URLs or active foreign content', async ({ page, state }) => {
  await openLibrary(page);
  await page.evaluate(async ({ foreign, marker }) => {
    const w = window as any;
    w.applyStimuliDefinitionsToLibrary({ 'import-preview': { type: 'text', aois: [] } });
    await w.openAoiEditor('import-preview', { previewHtml: `<div onclick="window.__stimuliXss=1" style="width:120px;height:80px;background:#16a34a;background-image:url(${foreign}/css);clip-path:url(${foreign}/clip)">Safe label</div>
      <img src="http://user:secret@127.0.0.1:3001/leak" onerror="window.__stimuliXss=1">
      <svg onload="window.__stimuliXss=1"><foreignObject>${marker}</foreignObject></svg>
      <iframe src="${foreign}/frame"></iframe><object data="${foreign}/object"></object>
      <a href="javascript:window.__stimuliXss=1">action</a><form action="${foreign}/submit"><input autofocus onfocus="window.__stimuliXss=1"></form>
      <style>@import '${foreign}/style';</style><script>window.__stimuliXss=1</script>` });
  }, { foreign, marker });
  await expect(page.locator('#aoiStandardPreview')).toContainText('Safe label');
  await page.locator('#aoiStandardPreview > div').dispatchEvent('click');
  await noExecution(page, 'body');
  expect(state.requests.filter(r => new URL(r.url).origin === foreign)).toEqual([]);
  await expect(page.locator('#aoiStandardPreview > div')).toHaveCSS('width', '120px');
  await expect(page.locator('#aoiStandardPreview > div')).toHaveCSS('background-color', 'rgb(22, 163, 74)');
});

test('AOI media inside presentation fragments keeps anonymous loading and inert text', async ({ page, state }) => {
  await openLibrary(page);
  await page.evaluate(async foreign => {
    const w = window as any;
    w.applyStimuliDefinitionsToLibrary({ 'import-media-preview': { type: 'text', aois: [] } });
    await w.openAoiEditor('import-media-preview', { previewHtml:
      `<div><img src="${foreign}/fragment-image" alt="literal &quot; title" onerror="window.__stimuliXss=1">
       <audio src="${foreign}/fragment-audio" controls></audio><video src="${foreign}/fragment-video" muted></video></div>` });
  }, foreign);
  await expect.poll(() => state.requests.filter(r => new URL(r.url).origin === foreign && r.method === 'GET').length).toBeGreaterThanOrEqual(3);
  for (const request of state.requests.filter(r => new URL(r.url).origin === foreign)) {
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.authorization).toBeUndefined();
    expect(request.headers['x-csrf-token']).toBeUndefined();
  }
  await expect(page.locator('#aoiStandardPreview img')).toHaveAttribute('alt', 'literal " title');
  await expect(page.locator('#aoiStandardPreview img')).toHaveAttribute('crossorigin', 'anonymous');
  await noExecution(page, '#aoiStandardPreview');
});
