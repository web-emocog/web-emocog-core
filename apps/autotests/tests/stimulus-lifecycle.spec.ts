import { test, expect, type Page } from '@playwright/test';

declare const stimuliList: any[];
const base = process.env.EMOCOG_WEB_ORIGIN || 'http://127.0.0.1:4173';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_selected_project_id', '7');
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (url.origin !== 'http://127.0.0.1:3000') return route.abort();
    const headers = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (body: unknown) => route.fulfill({ status: 200, headers, json: body });
    if (url.pathname === '/auth/me') return json({ id: 1, role: 'researcher', email: 'synthetic@example.test' });
    if (url.pathname === '/auth/permissions') return json({ operations: [] });
    if (url.pathname === '/projects') return json([{ id: 7, name: 'A' }, { id: 8, name: 'B' }]);
    if (url.pathname === '/stimuli/folders') return json([]);
    if (url.pathname === '/stimuli') return json([{ id: 42, project_id: Number(url.searchParams.get('project_id')),
      name: 'Synthetic image', mime_type: 'image/png', created_by: 1, visibility: 'private', metadata: {},
      content_url: '/stimuli/42/content', preview_url: '/stimuli/42/preview', content_available: true }]);
    if (/\/stimuli\/42\/(content|preview)$/.test(url.pathname)) return route.fulfill({ status: 200,
      headers: { ...headers, 'Content-Type': 'image/png' }, body: png });
    return json([]);
  });
  await page.goto(`${base}/apps/web/researcher.html#/stimuli`);
  await expect(page.locator('.stimulus-card[data-id="42"] img')).toBeVisible();
});

async function instrument(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__listeners = [];
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const capture = (options: any) => typeof options === 'boolean' ? options : !!options?.capture;
    EventTarget.prototype.addEventListener = function(type, fn, options) {
      if ((this === window || this === document) && fn && !w.__listeners.some((row: any) =>
        row.target === this && row.type === type && row.fn === fn && row.capture === capture(options))) {
        w.__listeners.push({ target: this, type, fn, capture: capture(options) });
      }
      return add.call(this, type, fn, options);
    };
    EventTarget.prototype.removeEventListener = function(type, fn, options) {
      w.__listeners = w.__listeners.filter((row: any) => !(row.target === this && row.type === type
        && row.fn === fn && row.capture === capture(options)));
      return remove.call(this, type, fn, options);
    };
    w.__observers = [];
    for (const name of ['IntersectionObserver', 'ResizeObserver', 'MutationObserver']) {
      const Original = w[name];
      w[name] = class extends Original {
        active = false;
        constructor(callback: any, options: any) { super(callback, options); w.__observers.push(this); }
        observe(...args: any[]) { this.active = true; return super.observe(...args); }
        disconnect() { this.active = false; return super.disconnect(); }
      };
    }
  });
}

for (const boundary of ['route', 'same-route-render', 'project', 'account', 'api-origin', 'pagehide']) {
  test(`AOI opening after delayed preview is cancelled on ${boundary}`, async ({ page }) => {
    await page.evaluate(() => {
      const w = window as any;
      w.hydrateApiStimulusPreview = () => new Promise(resolve => { w.__finishPreview = resolve; });
      w.__opening = w.openAoiEditor('42');
    });
    if (boundary === 'route') await page.evaluate(() => (window as any).navigate('#/overview'));
    if (boundary === 'same-route-render') await page.evaluate(() => (window as any).render());
    if (boundary === 'project') await page.evaluate(() => (window as any).setResearcherProjectSelection(8));
    if (boundary === 'account') await page.evaluate(() => {
      localStorage.setItem('emocog_workspace_owner_v1', '2');
      try { (window as any).WecogStaffSession.assertCurrent(); } catch (_) {}
    });
    if (boundary === 'api-origin') await page.evaluate(() => {
      (window as any).EmocogApiBase = { resolve: () => 'http://127.0.0.1:3001' };
    });
    if (boundary === 'pagehide') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.evaluate(async () => { (window as any).__finishPreview(); await (window as any).__opening; });
    await expect(page.locator('#aoiClose')).toHaveCount(0);
  });

  test(`an already open AOI cannot write or notify its builder after ${boundary}`, async ({ page }) => {
    await page.evaluate(async () => {
      const w = window as any; w.__writes = 0;
      await w.openAoiEditor('std_simple_black_square', { initialAois: [{ id: 'target', name: 'Target',
        shape: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], order: 1, isTarget: true,
        validityInterval: { startMs: 0, endMs: 1000 } }],
        onPersist: () => { w.__writes++; }, onChange: () => { w.__writes++; }, onClose: () => { w.__writes++; },
        queueIndex: 0, queueTotal: 2, onSaveAndNext: () => { w.__writes++; } });
      w.__staleControls = ['aoiSave', 'aoiSaveNext', 'aoiClose'].map(id => document.getElementById(id));
    });
    await page.evaluate(boundary => {
      const w = window as any;
      if (boundary === 'route') w.navigate('#/overview');
      if (boundary === 'same-route-render') w.render();
      if (boundary === 'project') w.setResearcherProjectSelection(8);
      if (boundary === 'account') {
        localStorage.setItem('emocog_workspace_owner_v1', '2');
        try { w.WecogStaffSession.assertCurrent(); } catch (_) {}
      }
      if (boundary === 'api-origin') w.EmocogApiBase = { resolve: () => 'http://127.0.0.1:3001' };
      if (boundary === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      w.__staleControls.forEach((control: HTMLElement) => control.click());
    }, boundary);
    expect(await page.evaluate(() => (window as any).__writes)).toBe(0);
    await expect(page.locator('#aoiClose')).toHaveCount(0);
  });
}

test('a real late preview response may populate its workspace cache but cannot reopen a retired screen', async ({ page }) => {
  let release!: () => void, pending = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('http://127.0.0.1:3000/stimuli/42/content', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    pending = true; await held;
    return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': base,
      'Access-Control-Allow-Credentials': 'true', 'Content-Type': 'image/png' }, body: png });
  });
  await page.evaluate(() => { (window as any).__opening = (window as any).openAoiEditor('42'); });
  await expect.poll(() => pending).toBe(true);
  await page.evaluate(() => (window as any).navigate('#/overview'));
  release();
  await page.evaluate(() => (window as any).__opening);
  await expect(page.locator('#aoiClose')).toHaveCount(0);
  expect(await page.evaluate(() => !!stimuliList.find(row => row.id === '42')?._previewObjectUrl)).toBe(true);
});

test('a later AOI request retires a pending editor instead of creating duplicate editor IDs', async ({ page }) => {
  await page.evaluate(async () => {
    const w = window as any;
    w.hydrateApiStimulusPreview = () => new Promise(resolve => { w.__finishPreview = resolve; });
    w.__first = w.openAoiEditor('42');
    await w.openAoiEditor('std_simple_black_square');
    w.__finishPreview(); await w.__first;
  });
  await expect(page.locator('#aoiClose')).toHaveCount(1);
  await expect(page.locator('#aoiStage')).toBeVisible();
  await page.locator('#aoiClose').click();
});

test('a closed AOI cannot save or call builder callbacks through retained controls', async ({ page }) => {
  await page.evaluate(async () => {
    const w = window as any;
    w.__writes = 0; w.__closes = 0;
    await w.openAoiEditor('std_simple_black_square', {
      initialAois: [{ id: 'target', name: 'Target', shape: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        order: 1, isTarget: true, validityInterval: { startMs: 0, endMs: 1000 } }],
      onPersist: () => { w.__writes++; }, onChange: () => { w.__writes++; }, onClose: () => { w.__closes++; },
      queueIndex: 0, queueTotal: 2, onSaveAndNext: () => { w.__writes++; }
    });
    w.__oldSave = document.getElementById('aoiSave'); w.__oldClose = document.getElementById('aoiClose');
    w.__oldNext = document.getElementById('aoiSaveNext');
  });
  await page.locator('#aoiClose').click();
  await page.evaluate(() => {
    const w = window as any; w.__oldSave.click(); w.__oldNext.click(); w.__oldClose.click();
  });
  expect(await page.evaluate(() => ({ writes: (window as any).__writes, closes: (window as any).__closes })))
    .toEqual({ writes: 0, closes: 1 });
});

test('100 library/AOI mounts release global handlers, observers and queued layout frames', async ({ page }) => {
  await instrument(page);
  const result = await page.evaluate(async () => {
    const w = window as any, view = document.getElementById('view')!;
    const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
    window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    window.cancelAnimationFrame = handle => { frames.delete(handle); };
    for (let i = 0; i < 100; i++) {
      view.replaceChildren(w.StimuliAOIView());
      await new Promise(resolve => setTimeout(resolve, 0));
      await w.openAoiEditor('std_simple_black_square');
      view.replaceChildren();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return { listeners: w.__listeners.map((row: any) => row.type),
      activeObservers: w.__observers.filter((observer: any) => observer.active).length,
      frames: frames.size, editors: document.querySelectorAll('#aoiClose').length };
  });
  expect(result).toEqual({ listeners: [], activeObservers: 0, frames: 0, editors: 0 });
});

test('upload naming cancellation settles its promise and revokes its local previews on navigation', async ({ page }) => {
  await instrument(page);
  await page.evaluate(() => {
    const w = window as any, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    w.__urls = new Set(); w.__uploadSettled = false;
    URL.createObjectURL = blob => { const url = create.call(URL, blob); w.__urls.add(url); return url; };
    URL.revokeObjectURL = url => { w.__urls.delete(url); revoke.call(URL, url); };
    w.__upload = w.requestStimulusUploadDetails(['image/png', 'video/mp4', 'audio/wav']
      .map((type, index) => new File(['synthetic'], 'audit-' + index, { type })))
      .then((result: any) => { w.__uploadSettled = true; return result; });
    w.__mediaHandles = Array.from(document.querySelectorAll('[data-upload-row] video,[data-upload-row] audio'));
  });
  await expect(page.locator('[data-upload-confirm]')).toBeVisible();
  await page.evaluate(() => (window as any).navigate('#/overview'));
  await expect.poll(() => page.evaluate(() => (window as any).__uploadSettled)).toBe(true);
  expect(await page.evaluate(() => (window as any).__upload)).toBeNull();
  await expect(page.locator('[data-upload-confirm]')).toHaveCount(0);
  expect(await page.evaluate(() => ({ urls: (window as any).__urls.size,
    keyListeners: (window as any).__listeners.filter((row: any) => row.type === 'keydown').length,
    media: (window as any).__mediaHandles.map((media: HTMLMediaElement) => ({ paused: media.paused, src: media.getAttribute('src') })) })))
    .toEqual({ urls: 0, keyListeners: 0, media: [{ paused: true, src: null }, { paused: true, src: null }] });
});

test('immediate unmount cancels all deferred library initialization instead of rendering detached galleries', async ({ page }) => {
  await instrument(page);
  const result = await page.evaluate(async () => {
    const w = window as any, view = document.getElementById('view')!, original = w.renderStimuliGallery;
    let renders = 0;
    w.renderStimuliGallery = (...args: any[]) => { renders++; return original(...args); };
    for (let i = 0; i < 100; i++) view.replaceChildren(w.StimuliAOIView());
    view.replaceChildren();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { renders, listeners: w.__listeners.length,
      observers: w.__observers.filter((observer: any) => observer.active).length };
  });
  expect(result).toEqual({ renders: 0, listeners: 0, observers: 0 });
});

test('restoring a persisted page remounts the library but never resumes its old AOI or upload dialog', async ({ page }) => {
  await page.evaluate(async () => {
    const w = window as any;
    await w.openAoiEditor('std_simple_black_square');
    w.__upload = w.requestStimulusUploadDetails([new File(['synthetic'], 'bfcache.png', { type: 'image/png' })]);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  expect(await page.evaluate(() => (window as any).__upload)).toBeNull();
  await expect(page.locator('#aoiClose,[data-upload-confirm]')).toHaveCount(0);
  await page.locator('#chips .chip').nth(1).click();
  await expect(page.locator('#input_media').locator('..').locator('..')).toBeVisible();
  await page.locator('#chips .chip').first().click();
  await expect(page.locator('.stimulus-card[data-id="42"]')).toBeVisible();
});

test('allocation/construction failures release UI ownership and already allocated preview URLs', async ({ page }) => {
  await instrument(page);
  const result = await page.evaluate(async () => {
    const w = window as any, created = new Set(), create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    let allocations = 0;
    URL.createObjectURL = blob => {
      if (++allocations === 2) throw new Error('synthetic allocation failure');
      const url = create.call(URL, blob); created.add(url); return url;
    };
    URL.revokeObjectURL = url => { created.delete(url); revoke.call(URL, url); };
    const errors = [];
    try { await w.requestStimulusUploadDetails([1, 2].map(index => new File(['synthetic'], index + '.png', { type: 'image/png' }))); }
    catch (error: any) { errors.push(error.message); }
    try { await w.openAoiEditor('std_simple_black_square', { initialAois: null }); }
    catch (_) { errors.push('invalid aoi fixture'); }
    return { errors, urls: created.size, listeners: w.__listeners.length,
      observers: w.__observers.filter((observer: any) => observer.active).length };
  });
  expect(result).toEqual({ errors: ['synthetic allocation failure', 'invalid aoi fixture'], urls: 0, listeners: 0, observers: 0 });
});

test('folder creation is single flight and a late committed result cannot invoke a cancelled dialog callback', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any; w.__folderCalls = 0; w.__folderCallbacks = 0;
    w.apiPost = () => { w.__folderCalls++; return new Promise(resolve => { w.__finishFolder = resolve; }); };
    w.showCreateFolderModal(() => { w.__folderCallbacks++; });
  });
  await page.locator('#folderNameInput').fill('Synthetic folder');
  await page.locator('#modalFolderCreate').click();
  await expect.poll(() => page.evaluate(() => (window as any).__folderCalls)).toBe(1);
  await page.evaluate(() => document.getElementById('modalFolderCreate')!.dispatchEvent(new Event('click')));
  expect(await page.evaluate(() => (window as any).__folderCalls)).toBe(1);
  await page.locator('#modalFolderCancel').click();
  await page.evaluate(() => (window as any).__finishFolder({ id: 99, name: 'Synthetic folder' }));
  await expect(page.locator('#modalFolderCreate')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__folderCallbacks)).toBe(0);
});

test('normal AOI save, next, close and accepted upload retain their intended callbacks and ownership', async ({ page }) => {
  await page.evaluate(async () => {
    const w = window as any; w.__saved = []; w.__next = 0; w.__closed = 0;
    await w.openAoiEditor('std_simple_black_square', { initialAois: [{ id: 'target', name: 'Original',
      shape: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], order: 1, isTarget: true,
      validityInterval: { startMs: 0, endMs: 1000 } }],
      onPersist: (aois: any) => w.__saved.push(JSON.parse(JSON.stringify(aois))),
      onSaveAndNext: () => { w.__next++; }, onClose: () => { w.__closed++; }, queueIndex: 0, queueTotal: 2 });
  });
  await page.locator('#aoiName').fill('Edited target');
  await page.locator('#aoiSave').click();
  await page.locator('#aoiSaveNext').click();
  expect(await page.evaluate(() => ({ names: (window as any).__saved.map((row: any) => row[0].name),
    next: (window as any).__next, closed: (window as any).__closed })))
    .toEqual({ names: ['Edited target', 'Edited target', 'Edited target'], next: 1, closed: 0 });
  await page.evaluate(() => {
    const w = window as any;
    w.__upload = w.requestStimulusUploadDetails([new File(['synthetic'], 'example.png', { type: 'image/png' })]);
  });
  await page.locator('[data-upload-name]').fill('Custom title');
  await page.locator('[data-upload-confirm]').click();
  const accepted = await page.evaluate(async () => {
    const entries = await (window as any).__upload;
    const preview = await fetch(entries[0].previewObjectUrl).then(response => response.text());
    URL.revokeObjectURL(entries[0].previewObjectUrl);
    return { name: entries[0].name, preview };
  });
  expect(accepted).toEqual({ name: 'Custom title', preview: 'synthetic' });
});
