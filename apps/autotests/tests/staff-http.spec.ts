import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createHash } from 'node:crypto';

// Only synthetic staff/data, isolated API and static servers, no camera or login to a real account.
let server: http.Server, api: string, authMode = 'ok', loginCalls = 0, uncertainWrites = 0, aborted = 0;
let invitationPosts: number[] = [];
let logoutUnavailable = false;
const user = { id: 1, email: 'synthetic@example.test', role: 'admin' };
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4194');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Staff-User-ID,X-CSRF-Token,X-Auth-Transport');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const pathname = new URL(req.url!, 'http://fixture').pathname;
    function json(value: unknown, status = 200) { res.writeHead(status).end(JSON.stringify(value)); }
    if (pathname === '/slow-headers' || pathname === '/slow-body' || pathname === '/uncertain') {
      if (pathname === '/uncertain') uncertainWrites++;
      res.on('close', () => { aborted++; }); req.resume();
      if (pathname === '/slow-body') { res.writeHead(200); res.write('{"pending":'); }
      return;
    }
    if (pathname === '/transfer') {
      res.setHeader('Content-Type', 'application/octet-stream');
      let parts = 0;
      const timer = setInterval(() => { res.write(Buffer.alloc(32768, 7)); if (++parts === 4) { clearInterval(timer); res.end(); } }, 80);
      res.on('close', () => clearInterval(timer)); return;
    }
    if (pathname === '/multipart') {
      const chunks: Buffer[] = []; let length = 0;
      req.on('data', chunk => { length += chunk.length; if (length > 9 * 1024 * 1024) req.destroy(); else chunks.push(chunk); });
      req.on('end', async () => {
        const body = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': req.headers['content-type']! } }).formData();
        const file = body.get('file') as File;
        json({ size: file.size, name: file.name, project: body.get('project_id'),
          hash: createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex') });
      }); return;
    }
    if (pathname === '/auth/me') {
      if (authMode === 'unavailable') return json({ error: 'Unavailable' }, 503);
      if (authMode === 'expired') return json({ error: 'Unauthorized' }, 401);
      if (authMode === 'malformed') return json({ csrf_token: 'must-not-be-cached' });
      return json({ ...user, csrf_token: 'synthetic-csrf' });
    }
    if (pathname === '/auth/login') { loginCalls++; req.resume(); return setTimeout(() => json({ error: 'invalid_credentials' }, 401), 200); }
    if (pathname === '/auth/permissions') return json({ can_open_admin_panel: true, operations: [] });
    if (pathname === '/protocols') return json([{ id: 10, name: 'Synthetic protocol', definition: { protocolId: 'synthetic' } }]);
    if (pathname === '/invitations' && req.method === 'POST') {
      let body = ''; req.on('data', chunk => { if (body.length < 2000) body += chunk.toString(); });
      req.on('end', () => { invitationPosts.push(JSON.parse(body).protocol_id); json({ error: 'Protocol not found or access denied' }, 404); }); return;
    }
    if (pathname === '/projects') return json([{ id: 7, name: 'Synthetic project' }]);
    if (pathname === '/health') return json({ ok: true });
    if (pathname === '/delayed-json') { setTimeout(() => json({ ok: true }), 250); return; }
    if (pathname === '/redirect') { res.writeHead(302, { Location: '/health' }).end(); return; }
    if (pathname === '/auth/logout') {
      if (logoutUnavailable) return json({ error: 'Unavailable' }, 503);
      res.writeHead(204).end(); return;
    }
    return json([]);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
test.beforeEach(async ({ page, baseURL }) => {
  authMode = 'ok'; loginCalls = 0; uncertainWrites = 0; aborted = 0; invitationPosts = []; logoutUnavailable = false;
  await page.addInitScript(({ api, user }) => {
    (window as any).WECOG_API_BASE = api;
    if (sessionStorage.getItem('synthetic_seeded') === '1') return;
    sessionStorage.setItem('synthetic_seeded', '1');
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_api_user', JSON.stringify(user));
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_selected_project_id', '7');
    localStorage.setItem('emocog_protocol_meta_draft', 'synthetic-draft');
  }, { api, user });
  await page.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    return origin === baseURL || origin === api ? route.continue() : route.abort();
  });
});

for (const kind of ['slow-headers', 'slow-body']) {
  test(`native ${kind} is aborted without leaving a pending request`, async ({ page }) => {
    await page.goto('/apps/web/index.html?guest=1');
    const result = await page.evaluate(async url => {
      const client = (window as any).WecogHttp;
      try { await client.json(url, { credentials: 'include' }, { timeoutMs: 250 }); return { unexpected: true }; }
      catch (error) { return { code: (error as any).code, pending: client.pendingCount() }; }
    }, api + '/' + kind);
    expect(result).toEqual({ code: 'request_timeout', pending: 0 });
    await expect.poll(() => aborted).toBeGreaterThan(0);
  });
}

for (const change of ['account', 'route', 'project']) {
  test(`a ${change} change discards a native response body instead of applying previous-scope data`, async ({ page }) => {
    await page.goto('/apps/web/index.html?guest=1');
    const result = await page.evaluate(async ({ api, change }) => {
      const client = (window as any).WecogHttp;
      const pending = client.json(api + '/slow-body', {}, { scope: change === 'route' ? 'page' : 'workspace', timeoutMs: 3000 })
        .then(() => 'applied', (error: any) => error.code);
      await new Promise(resolve => setTimeout(resolve, 100));
      if (change === 'account') { localStorage.setItem('emocog_workspace_owner_v1', '2'); window.dispatchEvent(new StorageEvent('storage', { key: 'emocog_workspace_owner_v1', oldValue: '1', newValue: '2' })); }
      else if (change === 'route') location.hash = '#different-route';
      else { localStorage.setItem('emocog_selected_project_id', '8'); window.dispatchEvent(new Event('wecog:projectchange')); }
      return { outcome: await pending, pending: client.pendingCount() };
    }, { api, change });
    expect(result).toEqual({ outcome: change === 'account' ? 'staff_account_changed' : 'request_context_changed', pending: 0 });
    await expect.poll(() => aborted).toBeGreaterThan(0);
  });
}

test('native multipart POST timeout reports an uncertain write and never sends it twice', async ({ page }) => {
  await page.goto('/apps/web/index.html?guest=1');
  const result = await page.evaluate(async api => {
    const body = new FormData(); body.append('file', new Blob(['synthetic-image']), 'synthetic.txt');
    try { await (window as any).WecogHttp.json(api + '/uncertain', { method: 'POST', body }, { timeoutMs: 300 }); }
    catch (error) { return { code: (error as any).code, uncertain: (error as any).mutationMayHaveCommitted }; }
  }, api);
  expect(result).toEqual({ code: 'request_timeout', uncertain: true });
  expect(uncertainWrites).toBe(1);
});

test('workspace data survives a SPA route change, but not a project change', async ({ page }) => {
  await page.goto('/apps/web/index.html?guest=1');
  const result = await page.evaluate(async api => {
    const client = (window as any).WecogHttp;
    const pending = client.json(api + '/delayed-json', {}, { scope: 'workspace' });
    location.hash = '#another-section';
    return pending;
  }, api);
  expect(result).toEqual({ ok: true });
});

test('native transfer body is complete, redirecting staff requests is rejected, and pagehide cancels only active work', async ({ page }) => {
  await page.goto('/apps/web/index.html?guest=1');
  const result = await page.evaluate(async api => {
    const client = (window as any).WecogHttp;
    const blob = await client.blob(api + '/transfer', {}, { transfer: true });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let redirect = '';
    try { await client.json(api + '/redirect'); } catch (error) { redirect = (error as any).code; }
    const pending = client.json(api + '/slow-body').catch((error: any) => error.code);
    await new Promise(resolve => setTimeout(resolve, 100));
    window.dispatchEvent(new Event('pagehide'));
    const stopped = await pending, health = await client.json(api + '/health');
    return { length: bytes.length, intact: bytes.every(value => value === 7), redirect, stopped, health, pending: client.pendingCount() };
  }, api);
  expect(result).toEqual({ length: 131072, intact: true, redirect: 'request_network_error', stopped: 'request_cancelled', health: { ok: true }, pending: 0 });
});

test('an 8 MiB native staff multipart transfer preserves every byte and form field', async ({ page }) => {
  await page.goto('/apps/web/developer/accounts.html');
  await expect(page.locator('.grid')).toBeVisible();
  const result = await page.evaluate(async api => {
    const bytes = new Uint8Array(8 * 1024 * 1024).fill(7), body = new FormData();
    body.append('file', new Blob([bytes], { type: 'application/octet-stream' }), 'synthetic.bin'); body.append('project_id', '7');
    return (window as any).WecogHttp.json(api + '/multipart', { method: 'POST', credentials: 'include', body }, { transfer: true, scope: 'workspace' });
  }, api);
  expect(result).toEqual({ size: 8 * 1024 * 1024, name: 'synthetic.bin', project: '7',
    hash: createHash('sha256').update(Buffer.alloc(8 * 1024 * 1024, 7)).digest('hex') });
});

test('unconfirmed logout keeps the page signed in; a later confirmed logout clears only auth', async ({ page }) => {
  await page.goto('/apps/web/developer.html');
  await expect(page.locator('.grid')).toBeVisible();
  let alerts = 0;
  page.on('dialog', async dialog => { alerts++; await dialog.dismiss(); });
  logoutUnavailable = true;
  await page.locator('#logoutLink').click();
  await expect.poll(() => alerts).toBe(1);
  expect(new URL(page.url()).pathname).toBe('/apps/web/developer.html');
  expect(await page.evaluate(() => localStorage.getItem('emocog_developer_auth'))).toBe('1');
  logoutUnavailable = false;
  await page.locator('#logoutLink').click();
  await expect(page).toHaveURL(/\/developer\/login.html/);
  expect(await page.evaluate(() => ({ auth: localStorage.getItem('emocog_developer_auth'), draft: localStorage.getItem('emocog_protocol_meta_draft') })))
    .toEqual({ auth: null, draft: 'synthetic-draft' });
});

for (const mode of ['unavailable', 'malformed']) {
  test(`protected ${mode} auth does not erase sign-in/drafts or reveal the protected page`, async ({ page }) => {
    authMode = mode;
    await page.goto('/apps/web/developer/accounts.html');
    await expect(page.locator('#staffAuthUnavailable')).toBeVisible();
    await expect(page.locator('.grid')).toBeHidden();
    expect(await page.evaluate(() => ({ auth: localStorage.getItem('emocog_developer_auth'),
      draft: localStorage.getItem('emocog_protocol_meta_draft'), csrf: sessionStorage.getItem('emocog_csrf_token') })))
      .toEqual({ auth: '1', draft: 'synthetic-draft', csrf: null });
  });
}

test('a confirmed 401 routes to login, without deleting drafts', async ({ page }) => {
  authMode = 'expired';
  await page.goto('/apps/web/developer/accounts.html');
  await expect(page).toHaveURL(/\/developer\/login.html/);
  expect(await page.evaluate(() => localStorage.getItem('emocog_protocol_meta_draft'))).toBe('synthetic-draft');
});

test('a second submit does not issue a concurrent login POST', async ({ page }) => {
  await page.goto('/apps/web/developer/login.html?portal=researcher');
  await page.locator('#login').fill('synthetic@example.test');
  await page.locator('#password').fill('Synthetic-Password-Only');
  await page.locator('#form').evaluate(form => { form.dispatchEvent(new Event('submit', { cancelable: true })); form.dispatchEvent(new Event('submit', { cancelable: true })); });
  await expect(page.locator('#error')).toContainText('invalid_credentials');
  expect(loginCalls).toBe(1);
  await expect(page.locator('#form button[type=submit]')).toBeEnabled();
});

test('an inaccessible requested protocol is never replaced with the first available protocol', async ({ page }) => {
  await page.goto('/apps/web/developer/invite.html');
  await expect(page.locator('#protocolIdInput')).toHaveValue('10');
  await page.locator('#protocolIdInput').fill('999');
  await page.locator('#btnGenerate').click();
  await expect(page.locator('#copyFeedback')).toContainText('Protocol not found');
  expect(invitationPosts).toEqual([999]);
  await expect(page.locator('#linkOutput')).toHaveValue('');
  await expect(page.locator('#btnCopy')).toBeDisabled();
  await expect(page.locator('#protocolIdInput')).toHaveValue('999');
});

test('developer tabs are bound to their original account too', async ({ page }) => {
  await page.goto('/apps/web/developer/accounts.html');
  await expect.poll(() => page.evaluate(() => (window as any).WecogStaffSession?.getAccountId())).toBe('1');
  await page.evaluate(() => { localStorage.setItem('emocog_workspace_owner_v1', '2'); window.dispatchEvent(new StorageEvent('storage', { key: 'emocog_workspace_owner_v1', oldValue: '1', newValue: '2' })); });
  await expect(page.locator('#staffSessionChanged')).toBeVisible();
  await expect(page.locator('.grid')).toBeHidden();
});
