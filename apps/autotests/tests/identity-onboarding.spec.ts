import { test, expect } from '@playwright/test';

const root = '/apps/web/account/';
const token = 'a'.repeat(43);
test('signup sends email only, not a password or global role', async ({ page, baseURL }) => {
  let posted: any;
  await page.route('http://127.0.0.1:3000/identity/signup', async route => {
    posted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true }, headers: { 'access-control-allow-origin': baseURL!, 'access-control-allow-credentials': 'true' } });
  });
  await page.goto(root + 'signup.html');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
  await page.getByRole('button', { name: 'Send confirmation email' }).click();
  await expect(page.getByRole('status')).toContainText('If eligible');
  expect(posted).toEqual({ email: 'synthetic@example.test' });
});
test('mail scanner navigation never activates signup; explicit form confirms and fragment is removed', async ({ page, baseURL }) => {
  const mutations: any[] = [];
  await page.route('http://127.0.0.1:3000/identity/confirm', async route => {
    mutations.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true }, headers: { 'access-control-allow-origin': baseURL!, 'access-control-allow-credentials': 'true' } });
  });
  await page.goto(root + 'confirm.html#purpose=signup&token=' + token);
  expect(new URL(page.url()).hash).toBe('');
  expect(mutations).toHaveLength(0);
  await page.getByLabel('Choose a new password').fill('synthetic-password-14');
  await page.getByLabel('Display name').fill('Synthetic researcher');
  await page.getByRole('button', { name: 'Confirm deliberately' }).click();
  await expect(page.getByRole('status')).toContainText('Confirmed.');
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toEqual({ token, password: 'synthetic-password-14', display_name: 'Synthetic researcher' });
  const storage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  expect(storage).not.toContain(token); expect(storage).not.toContain('synthetic-password-14');
});
test('verification needs an explicit gesture but never requests a password', async ({ page, baseURL }) => {
  let body: any;
  await page.route('http://127.0.0.1:3000/identity/confirm', async route => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true }, headers: { 'access-control-allow-origin': baseURL!, 'access-control-allow-credentials': 'true' } });
  });
  await page.goto(root + 'confirm.html#purpose=verify&token=' + token);
  await expect(page.getByLabel('Choose a new password')).toBeHidden(); expect(body).toBeUndefined();
  await page.getByRole('button', { name: 'Confirm deliberately' }).click();
  await expect(page.getByRole('status')).toContainText('Confirmed.'); expect(body).toEqual({ token });
});
test('workspace creates scoped org/project and accepts invitation only on click, with cookie CSRF', async ({ page, baseURL }) => {
  const mutations: { path: string; data: any }[] = [];
  await page.route('http://127.0.0.1:3000/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: {
      'access-control-allow-origin': baseURL!, 'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE', 'access-control-allow-headers': 'content-type,x-csrf-token,x-staff-user-id' } });
    let json: any = {};
    if (path === '/auth/me') json = { id: 7, email: 'synthetic@example.test', role: 'researcher', csrf_token: 'synthetic-csrf' };
    else if (path === '/workspace' && request.method() === 'GET') json = { email_verified: true, self_service_eligible: true, workspaces: [] };
    else {
      expect(request.headers()['x-csrf-token']).toBe('synthetic-csrf');
      expect(request.headers()['x-staff-user-id']).toBe('7');
      mutations.push({ path, data: request.postDataJSON() }); json = { ok: true };
    }
    await route.fulfill({ json, headers: { 'access-control-allow-origin': baseURL!, 'access-control-allow-credentials': 'true' } });
  });
  await page.goto(root + 'workspace.html#purpose=invite&token=' + token);
  await expect(page.getByRole('button', { name: 'Accept project invitation' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe(''); expect(mutations).toHaveLength(0);
  await page.getByRole('button', { name: 'Accept project invitation' }).click();
  await expect(page.getByRole('status')).toContainText('Invitation accepted.');
  await page.getByLabel('Organization name', { exact: true }).fill('Synthetic laboratory');
  await page.getByLabel('First project name').fill('Synthetic study');
  await page.getByRole('button', { name: 'Create organization and project' }).click();
  await expect(page.getByRole('status')).toContainText('created');
  expect(mutations).toEqual([{ path: '/workspace/invitations/accept', data: { token } },
    { path: '/workspace/organizations', data: { organization_name: 'Synthetic laboratory', project_name: 'Synthetic study' } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('disabled self service reports an operator gate rather than success', async ({ page, baseURL }) => {
  await page.route('http://127.0.0.1:3000/identity/signup', route => route.fulfill({ status: 503,
    json: { code: 'identity_disabled', error: 'Self-service is not configured' },
    headers: { 'access-control-allow-origin': baseURL!, 'access-control-allow-credentials': 'true' } }));
  await page.goto(root + 'signup.html');
  await page.getByLabel('Email', { exact: true }).fill('synthetic@example.test');
  await page.getByRole('button', { name: 'Send confirmation email' }).click();
  await expect(page.getByRole('status')).toContainText('not been configured');
});

test('a signed-out recipient keeps the invitation in memory while signing in separately', async ({ page, baseURL }) => {
  let signedIn = false, submitted: unknown;
  const headers = { 'access-control-allow-origin': baseURL!, 'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST', 'access-control-allow-headers': 'content-type,x-csrf-token,x-staff-user-id' };
  await page.route('http://127.0.0.1:3000/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/auth/me') return route.fulfill({ status: signedIn ? 200 : 401, headers,
      json: signedIn ? { id: 9, email: 'recipient@example.test', role: 'researcher', csrf_token: 'synthetic-csrf' } : {} });
    if (path === '/workspace/invitations/accept') {
      submitted = request.postDataJSON();
      return route.fulfill({ headers, json: { ok: true } });
    }
    return route.fulfill({ headers, json: { email_verified: true, self_service_eligible: true, workspaces: [] } });
  });
  await page.goto(root + 'workspace.html#purpose=invite&token=' + token);
  const signIn = page.locator('#sign-in').getByRole('link', { name: 'Sign in' });
  await expect(signIn).toHaveAttribute('target', '_blank');
  expect(await signIn.getAttribute('href')).not.toContain(token);
  signedIn = true;
  await page.getByRole('button', { name: 'Continue after signing in' }).click();
  await expect(signIn).toBeHidden();
  expect(submitted).toBeUndefined();
  await page.getByRole('button', { name: 'Accept project invitation' }).click();
  await expect(page.getByRole('status')).toContainText('Invitation accepted.');
  expect(submitted).toEqual({ token });
  expect(await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))).not.toContain(token);
});
