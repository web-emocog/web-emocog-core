import { test, expect, Page } from '@playwright/test';

const web = 'http://127.0.0.1:4173';
const initialPassword = 'InitialSynthetic2026!';
const newPassword = ' НовыйПароль2026! ';

async function settings(page: Page, options: { status?: number; code?: string; abort?: boolean; gate?: Promise<void>; malformed?: boolean } = {}) {
  const requests: { body: any; csrf: string }[] = [];
  let csrf = 'initial-csrf';
  await page.route('http://127.0.0.1:3000/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = { 'Access-Control-Allow-Origin': web, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body });
    if (url.pathname === '/auth/me/password') {
      requests.push({ body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] });
      if (options.gate) await options.gate;
      if (options.abort) return route.abort('failed');
      if (options.malformed) return json({});
      if (options.status) return json({ error: 'Synthetic rejection', code: options.code }, options.status);
      csrf = 'rotated-csrf';
      return json({ ok: true, auth_transport: 'cookie', csrf_token: csrf, user: { id: 1, role: 'researcher' } });
    }
    if (url.pathname === '/auth/me') return json({ id: 1, email: 'synthetic@example.test', role: 'researcher', csrf_token: csrf, auth_transport: 'cookie' });
    if (url.pathname === '/auth/permissions') return json({});
    if (url.pathname === '/projects') return json([{ id: 7, name: 'Password verification' }]);
    return json([]);
  });
  await page.goto(`${web}/apps/web/researcher.html#/settings`);
  await expect(page.locator('#researcherPasswordForm')).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('emocog_csrf_token'))).toBe('initial-csrf');
  return requests;
}

async function fillPassword(page: Page, current = initialPassword, next = newPassword, confirmation = next) {
  await page.locator('#researcherCurrentPassword').fill(current);
  await page.locator('#researcherNewPassword').fill(next);
  await page.locator('#researcherConfirmPassword').fill(confirmation);
}

test('login preserves the exact password and ignores a stored API redirect', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('emocog_api_base', 'http://127.0.0.1:29999'));
  const attempts: any[] = [];
  await page.route('http://127.0.0.1:3000/auth/login', async route => {
    const headers = { 'Access-Control-Allow-Origin': web, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type,X-Auth-Transport', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    attempts.push(route.request().postDataJSON());
    await route.fulfill({ status: 401, headers, json: { error: 'Synthetic rejection' } });
  });
  await page.goto(`${web}/apps/web/developer/login.html?portal=researcher`);
  await page.locator('#login').fill('Synthetic@Example.test');
  await page.locator('#password').fill(newPassword);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.locator('#error')).toContainText('Synthetic rejection');
  expect(attempts).toEqual([{ email: 'synthetic@example.test', password: newPassword }]);
});

test('settings submit once, wait for API acceptance, rotate CSRF and clear credentials', async ({ page }, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests = await settings(page, { gate });
  await fillPassword(page);
  await page.locator('#researcherConfirmPassword').press('Enter');
  await expect(page.locator('#researcherPasswordForm')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#researcherPasswordStatus')).toHaveAttribute('data-state', 'pending');
  await expect(page.locator('#researcherChangePasswordBtn')).toBeDisabled();
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(() => (document.getElementById('researcherPasswordForm') as HTMLFormElement).requestSubmit());
  expect(requests[0]).toEqual({ body: { currentPassword: initialPassword, newPassword }, csrf: 'initial-csrf' });
  release();
  await expect(page.locator('#researcherPasswordStatus')).toContainText('Пароль изменён.');
  await expect(page.locator('#researcherChangePasswordBtn')).toBeEnabled();
  expect(requests).toHaveLength(1);
  for (const id of ['researcherCurrentPassword', 'researcherNewPassword', 'researcherConfirmPassword']) {
    await expect(page.locator(`#${id}`)).toHaveValue('');
  }
  expect(await page.evaluate(() => sessionStorage.getItem('emocog_csrf_token'))).toBe('rotated-csrf');
  const storage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  expect(storage).not.toContain(initialPassword);
  expect(storage).not.toContain(newPassword);
  await page.screenshot({ path: testInfo.outputPath('password-updated.png'), fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.locator('#researcherPasswordForm')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('emocog_csrf_token'))).toBe('rotated-csrf');
});

test('password requirements, matching confirmation and non-ASCII byte limits reject without sending', async ({ page }) => {
  const requests = await settings(page);
  for (const [current, next, confirmation, message] of [
    ['', '', '', 'Заполните'],
    [initialPassword, 'short123', 'short123', '72 байта'],
    [initialPassword, 'а'.repeat(37), 'а'.repeat(37), '72 байта'],
    [initialPassword, '😀'.repeat(6), '😀'.repeat(6), '72 байта'],
    [initialPassword, newPassword, 'DifferentPassword2026!', 'не совпадают'],
    [initialPassword, initialPassword, initialPassword, 'отличаться'],
  ]) {
    await fillPassword(page, current, next, confirmation);
    await page.locator('#researcherChangePasswordBtn').click();
    await expect(page.locator('#researcherPasswordStatus')).toContainText(message);
  }
  expect(requests).toHaveLength(0);
});

test('pending password changes survive language and route rerenders without duplicate submission', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const requests = await settings(page, { gate });
    await fillPassword(page);
    await page.locator('#researcherChangePasswordBtn').click();
    await expect.poll(() => requests.length).toBe(1);
    await page.locator('#langEn').click();
    await expect(page.locator('#researcherChangePasswordBtn')).toBeDisabled();
    await expect(page.locator('#researcherPasswordForm')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#researcherPasswordStatus')).toHaveText('Saving the new password…');
    await page.evaluate(() => { location.hash = '#/overview'; });
    await expect(page.locator('#researcherPasswordForm')).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/settings'; });
    await expect(page.locator('#researcherChangePasswordBtn')).toBeDisabled();
    await page.evaluate(() => (document.getElementById('researcherPasswordForm') as HTMLFormElement).requestSubmit());
    expect(requests).toHaveLength(1);
    release();
    await expect(page.locator('#researcherPasswordStatus')).toHaveText('Password changed. Use the new password for your next sign-in. Previous sessions have been revoked.');
    await expect(page.locator('#researcherChangePasswordBtn')).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('emocog_csrf_token'))).toBe('rotated-csrf');
  } finally { release(); }
});

test('a rejected password change remains visible when returning after it finishes', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await settings(page, { gate, status: 400, code: 'current_password_invalid' });
    await fillPassword(page);
    const rejected = page.waitForResponse(response => response.url().endsWith('/auth/me/password') && response.request().method() === 'PATCH');
    await page.locator('#researcherChangePasswordBtn').click();
    await expect(page.locator('#researcherChangePasswordBtn')).toBeDisabled();
    await page.evaluate(() => { location.hash = '#/overview'; });
    await expect(page.locator('#researcherPasswordForm')).toHaveCount(0);
    release();
    expect((await rejected).status()).toBe(400);
    await page.evaluate(() => { location.hash = '#/settings'; });
    await expect(page.locator('#researcherPasswordStatus')).toContainText('Текущий пароль неверен');
    await expect(page.locator('#researcherPasswordStatus')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#researcherChangePasswordBtn')).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('emocog_csrf_token'))).toBe('initial-csrf');
    for (const id of ['researcherCurrentPassword', 'researcherNewPassword', 'researcherConfirmPassword']) {
      await expect(page.locator(`#${id}`)).toHaveValue('');
    }
  } finally { release(); }
});

for (const [status, code, message] of [
  [400, 'current_password_invalid', 'Текущий пароль неверен'],
  [401, undefined, 'Сеанс истёк'],
  [403, 'csrf_token_invalid', 'Сеанс истёк'],
  [409, 'password_change_conflict', 'Учётная запись уже изменена'],
  [429, undefined, 'Слишком много попыток'],
  [500, 'password_change_failed', 'Не удалось подтвердить'],
] as const) {
  test(`password API rejection ${status} never reports success`, async ({ page }) => {
    const requests = await settings(page, { status, code });
    await fillPassword(page);
    await page.locator('#researcherChangePasswordBtn').click();
    await expect(page.locator('#researcherPasswordStatus')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#researcherPasswordStatus')).toContainText(message);
    // Only a middleware CSRF rejection can retry once for the same identity.
    expect(requests).toHaveLength(code === 'csrf_token_invalid' ? 2 : 1);
    if (requests.length === 2) expect(requests[1].body).toEqual(requests[0].body);
    expect(await page.evaluate(() => sessionStorage.getItem('emocog_csrf_token'))).toBe('initial-csrf');
    await expect(page.locator('#researcherNewPassword')).toHaveValue('');
  });
}

for (const mode of ['network', 'malformed'] as const) {
  test(`${mode} failure cannot produce a password success message`, async ({ page }) => {
    await settings(page, { abort: mode === 'network', malformed: mode === 'malformed' });
    await fillPassword(page);
    await page.locator('#researcherChangePasswordBtn').click();
    await expect(page.locator('#researcherPasswordStatus')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#researcherPasswordStatus')).toContainText('Не удалось подтвердить');
    await expect(page.locator('#researcherChangePasswordBtn')).toBeEnabled();
  });
}

test('password form has English labels and fits a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await settings(page);
  await page.locator('#mobileNavToggle').click();
  await page.locator('#langEn').click();
  await page.locator('#mobileNavToggle').click();
  await expect(page.locator('label[for="researcherNewPassword"]')).toContainText('at least 12');
  await expect(page.locator('label[for="researcherConfirmPassword"]')).toContainText('Confirm new password');
  await expect(page.locator('#researcherPasswordPolicy')).toContainText('72 UTF-8 bytes');
  await fillPassword(page, initialPassword, newPassword, 'Mismatch2026!');
  await page.locator('#researcherChangePasswordBtn').click();
  await expect(page.locator('#researcherPasswordStatus')).toHaveText('The new password and confirmation do not match.');
  expect(await page.locator('#researcherPasswordForm').innerText()).not.toMatch(/[А-Яа-яЁё]/);
  expect(await page.locator('#researcherPasswordForm input').evaluateAll(inputs => inputs.every(input => {
    const rect = input.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth;
  }))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('password-mobile.png'), fullPage: true, animations: 'disabled' });
});
