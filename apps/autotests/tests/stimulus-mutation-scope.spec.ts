import { test, expect } from '@playwright/test';

declare const stimuliList: any[];
declare const folders: any[];
const base = 'http://127.0.0.1:4173';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

for (const boundary of ['project', 'account', 'origin']) {
  for (const mutation of ['conversion-response', 'conversion-thumbnail', 'rename', 'delete', 'folder']) {
    test(`late ${mutation} cannot modify the library after ${boundary} changes`, async ({ page }) => {
      let pending = false;
      let switched = false;
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      await page.addInitScript(() => {
        localStorage.setItem('emocog_workspace_owner_v1', '1');
        localStorage.setItem('emocog_developer_auth', '1');
        localStorage.setItem('emocog_selected_project_id', '7');
      });
      await page.route(/^http:\/\/127\.0\.0\.1:300[01]\//, async route => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        const headers = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' };
        const json = (body: unknown) => route.fulfill({ status: 200, headers, json: body });
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (url.pathname === '/auth/me') return json({ id: 1, role: 'researcher', email: 'synthetic@example.test' });
        if (url.pathname === '/auth/permissions') return json({ operations: [] });
        if (url.pathname === '/projects') return json([{ id: 7, name: 'A' }, { id: 8, name: 'B' }]);
        if (url.pathname === '/stimuli/folders') return json([]);
        if (url.pathname === '/stimuli') {
          const project = Number(url.searchParams.get('project_id'));
          return json([{ id: switched ? 43 : 42, project_id: project, created_by: 1,
            visibility: 'private', name: 'Current project', mime_type: 'image/png', metadata: {},
            content_available: true, content_url: `/stimuli/${switched ? 43 : 42}/content` }]);
        }
        if (url.pathname === '/stimuli/convert') {
          if (mutation === 'conversion-response') { pending = true; await held; }
          return json({ stimuli: [{ id: 52, project_id: 7, name: 'Old project page', mime_type: 'image/png',
            content_url: '/stimuli/52/content', preview_url: '/stimuli/52/preview', metadata: {} }] });
        }
        if (url.pathname === '/stimuli/52/preview' && mutation === 'conversion-thumbnail') {
          pending = true; await held;
        }
        if (url.pathname === '/stimuli/42' && method !== 'GET') {
          pending = true; await held;
          if (method === 'DELETE') return route.fulfill({ status: 204, headers });
          return json({ id: 42, name: 'Old renamed stimulus', folder_id: 6 });
        }
        if (/\/stimuli\/\d+\/(content|preview)$/.test(url.pathname)) {
          return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'image/png' }, body: png });
        }
        return json({});
      });
      await page.goto(`${base}/apps/web/researcher.html#/stimuli`);
      await expect(page.locator('.stimulus-card[data-id="42"]')).toBeVisible();
      if (mutation.startsWith('conversion')) {
        await page.locator('#input_docs').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mock') });
      } else {
        page.on('dialog', dialog => dialog.accept('Old renamed stimulus'));
        await page.evaluate(mutation => {
          const operation = mutation === 'rename' ? (window as any).renameStimulusInLibrary('42')
            : mutation === 'delete' ? (window as any).deleteStimulusFromLibrary('42')
            : (window as any).setStimulusFolder('42', 6);
          (window as any).__oldMutation = operation.catch(() => {});
        }, mutation);
      }
      await expect.poll(() => pending).toBe(true);
      switched = true;
      await page.evaluate(boundary => {
        if (boundary === 'account') localStorage.setItem('emocog_workspace_owner_v1', '2');
        if (boundary === 'origin') {
          (window as any).EmocogApiBase = { resolve: () => 'http://127.0.0.1:3001' };
          (window as any).API_BASE = 'http://127.0.0.1:3001';
        }
        if (boundary === 'project') (window as any).setResearcherProjectSelection(8);
        else {
          (window as any).activateStimulusLibraryScope();
          (window as any).syncProjectStimuliFromApi().catch(() => {});
        }
      }, boundary);
      await expect(page.locator('.stimulus-card[data-id="43"]')).toBeVisible();
      release();
      if (!mutation.startsWith('conversion')) await page.evaluate(() => (window as any).__oldMutation);
      else await expect(page.locator('#dropzone_docs')).toHaveCSS('pointer-events', 'auto');
      await expect(page.locator('.stimulus-card[data-id="52"]')).toHaveCount(0);
      const state = await page.evaluate(() => ({
        rows: stimuliList.filter(item => item.apiStimulusId).map(item => ({ id: item.id, projectId: item.projectId, name: item.name })),
        cache: JSON.parse(localStorage.getItem('emocog_stimuli') || '[]').filter((item: any) => item.apiStimulusId),
        folders: folders.filter(folder => folder.apiFolderId),
      }));
      expect(state.rows).toEqual([{ id: '43', projectId: boundary === 'project' ? 8 : 7, name: 'Current project' }]);
      expect(state.cache.map((item: any) => item.id)).toEqual(['43']);
      expect(state.folders).toEqual([]);
    });
  }
}
