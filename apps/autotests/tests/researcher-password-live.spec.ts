import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const requireApi = createRequire(path.resolve(__dirname, '../../api/package.json'));
const web = 'http://127.0.0.1:4173';
const databaseUrl = process.env.PASSWORD_TEST_DATABASE_URL;

test.describe('Real self-service password change for an administrator-created researcher', () => {
  test.skip(process.env.RUN_PASSWORD_LIVE !== '1', 'Set RUN_PASSWORD_LIVE=1 with an isolated PASSWORD_TEST_DATABASE_URL');
  let pool: any;
  let server: any;
  let api: string;
  let projectId: number;
  let organizationId: number;
  let adminToken: string;
  const createdUsers: number[] = [];

  test.beforeAll(async () => {
    if (!databaseUrl || process.env.NODE_ENV === 'production') throw new Error('An isolated local test database is required');
    const url = new URL(databaseUrl);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/emocog_recovery_tests') {
      throw new Error('Use only the dedicated local recovery test database');
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = '20000';
    ({ pool } = requireApi('./db'));
    const app = requireApi('./app');
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    api = `http://127.0.0.1:${server.address().port}`;
    const suffix = randomUUID();
    organizationId = (await pool.query('INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id',
      ['Password integration', `password-${suffix}`])).rows[0].id;
    projectId = (await pool.query('INSERT INTO projects(organization_id,name,slug) VALUES($1,$2,$3) RETURNING id',
      [organizationId, 'Password verification', `password-${suffix}`])).rows[0].id;
    const password = 'SyntheticAdminPassword2026!';
    const admin = (await pool.query("INSERT INTO users(email,password_hash,role) VALUES($1,$2,'admin') RETURNING id,email",
      [`password-admin-${suffix}@example.test`, await requireApi('bcryptjs').hash(password, 4)])).rows[0];
    createdUsers.push(admin.id);
    const login = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password }) });
    expect(login.status).toBe(200);
    adminToken = (await login.json()).token;
  });

  test.afterAll(async () => {
    if (pool && organizationId) await pool.query('DELETE FROM organizations WHERE id=$1', [organizationId]);
    if (pool && createdUsers.length) await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [createdUsers]);
    if (server) await new Promise<void>(resolve => server.close(resolve));
    if (pool) await pool.end();
  });

  for (const width of [1280, 390]) {
    test(`new password survives reload/logout and old password fails at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
      const initial = 'SyntheticInitial2026!';
      const changed = ' НовыйПароль2026! ';
      const email = `password-researcher-${randomUUID()}@example.test`;
      const created = await fetch(`${api}/auth/users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ email, password: initial, role: 'researcher', organization_ids: [organizationId], project_ids: [projectId] }),
      });
      expect(created.status).toBe(201);
      const user = await created.json();
      createdUsers.push(user.id);
      // Login deliberately ignores localStorage API overrides. Configure the
      // isolated fixture through trusted page configuration, not an auth bypass.
      await page.addInitScript(api => { (window as any).WECOG_API_BASE = api; }, api);
      const loginUrl = `${web}/apps/web/developer/login.html?portal=researcher`;
      await page.goto(loginUrl);
      await page.locator('#login').fill(email);
      await page.locator('#password').fill(initial);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(page).toHaveURL(/\/researcher\.html/);
      await expect(page.locator('#wsEnterBtn')).toBeEnabled();
      await page.locator('#wsEnterBtn').click();
      await expect(page.locator('#welcomeScreen')).toBeHidden();
      if (width === 390) await page.locator('#mobileNavToggle').click();
      await page.locator('#nav-settings').click();
      await expect(page.locator('#researcherPasswordForm')).toBeVisible();
      const oldCookie = (await page.context().cookies(api)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
      await page.locator('#researcherCurrentPassword').fill(initial);
      await page.locator('#researcherNewPassword').fill(changed);
      await page.locator('#researcherConfirmPassword').fill(changed);
      const accepted = page.waitForResponse(response => response.url() === `${api}/auth/me/password` && response.request().method() === 'PATCH');
      await page.locator('#researcherChangePasswordBtn').click();
      expect((await accepted).status()).toBe(200);
      await expect(page.locator('#researcherPasswordStatus')).toContainText('Пароль изменён.');
      const me = await page.context().request.get(`${api}/auth/me`);
      expect(me.status()).toBe(200);
      const current = await me.json();
      expect(current.id).toBe(user.id);
      expect(current.role).toBe('researcher');
      expect(await page.evaluate(() => sessionStorage.getItem('emocog_csrf_token'))).toBe(current.csrf_token);
      expect((await fetch(`${api}/auth/me`, { headers: { Cookie: oldCookie } })).status).toBe(401);
      expect(await page.evaluate(async password => {
        try {
          await (window as any).apiPatch('/auth/me/password', { currentPassword: password, newPassword: password });
          return { status: 200 };
        } catch (error) { return { status: error.status, code: error.code }; }
      }, changed)).toEqual({ status: 400, code: 'password_unchanged' });
      const stored = (await pool.query('SELECT password_hash,token_version FROM users WHERE id=$1', [user.id])).rows[0];
      expect(await requireApi('bcryptjs').compare(changed, stored.password_hash)).toBe(true);
      expect(await requireApi('bcryptjs').compare(initial, stored.password_hash)).toBe(false);
      expect(stored.token_version).toBe(1);
      await page.screenshot({ path: testInfo.outputPath('real-password-updated.png'), fullPage: true, animations: 'disabled' });
      await page.reload();
      await expect(page.locator('#welcomeScreen')).toBeHidden();
      await expect(page.locator('#researcherPasswordForm')).toBeVisible();
      await expect(page.locator('#researcherNewPassword')).toHaveValue('');
      expect((await page.context().request.post(`${api}/auth/logout`)).status()).toBe(204);
      await page.goto(loginUrl);
      await page.locator('#login').fill(email);
      await page.locator('#password').fill(initial);
      const rejected = page.waitForResponse(response => response.url() === `${api}/auth/login` && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      expect((await rejected).status()).toBe(401);
      await expect(page.locator('#error')).toBeVisible();
      await page.locator('#password').fill(changed);
      await page.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(page).toHaveURL(/\/researcher\.html/);
      expect((await page.context().request.get(`${api}/auth/me`)).status()).toBe(200);
    });
  }
});
