import { test, expect, Page } from '@playwright/test';

const participant = '/apps/participant-web/';
const canonical = participant + 'mvp_with_precheck_1-updated.html';
const code = 'Synthetic_Key-1';

async function isolate(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const external: string[] = [];
  await page.addInitScript(() => {
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      throw new Error('Physical capture is not permitted in this test');
    };
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === canonical) return route.fulfill({ contentType: 'text/html', body: '<title>Canonical target</title>' });
    if (url.origin === origin) return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  return external;
}

test('old entrypoint and supported fragment preserve the invitation and reach only the canonical runner', async ({ page, baseURL }) => {
  const external = await isolate(page, baseURL!);
  const urls = [participant + 'mvp_with_precheck_1.html?foo=bar&code=' + code,
    participant + 'mvp_with_precheck_1.html?foo=bar#/participant/' + code,
    participant + 'run_new.html?foo=bar#participant/' + code];
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  for (const url of urls) {
    await page.goto(url);
    await expect(page).toHaveTitle('Canonical target');
    const target = new URL(page.url());
    expect(target.pathname).toBe(canonical);
    expect(target.searchParams.get('code')).toBe(code);
    expect(target.searchParams.get('foo')).toBe('bar');
  }
  expect(requests.some(value => /\/web-page\/(?:app|experimental_task|precheck|tests|ui)\.js$/.test(value))).toBe(false);
  expect(external).toEqual([]);
});

test('malformed run links display a localized correction form instead of crashing or entering diagnostics', async ({ page, baseURL }) => {
  await isolate(page, baseURL!);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('emocog_participant_lang', 'en');
    localStorage.setItem('emocog_api_user', JSON.stringify({ role: 'developer' }));
  });
  for (const search of ['#/participant/%ZZ', '?code=first&code=second', '?code=']) {
    await page.goto(participant + 'run_new.html' + search);
    await expect(page).toHaveURL(/invite\.html\?invalid=1$/);
    await expect(page.getByRole('status')).toContainText('could not be recognized');
  }
  expect(errors).toEqual([]);
});

test('pasting an invalid URL stays on the form; a short link navigates on this origin only', async ({ page, baseURL }) => {
  const external = await isolate(page, baseURL!);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('emocog_participant_lang', 'en'); });
  await page.goto(participant + 'invite.html');
  const input = page.locator('#inviteRaw');
  await input.fill('https://untrusted.example/#/participant/%E0%A4%A');
  await page.locator('#goBtn').click();
  await expect(page.getByRole('status')).toContainText('could not be recognized');
  await expect(page).toHaveURL(/invite\.html$/);
  await input.fill('https://untrusted.example/invite/' + code);
  await input.press('Control+Enter');
  await expect(page).toHaveURL(baseURL + canonical + '?code=' + code);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('entry pages still accept a code when preference storage is inaccessible', async ({ page, baseURL }) => {
  await isolate(page, baseURL!);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } });
  });
  await page.goto(participant + 'run_new.html');
  await expect(page).toHaveURL(/invite\.html$/);
  await page.locator('#inviteRaw').fill(code);
  await page.locator('#goBtn').click();
  await expect(page).toHaveURL(baseURL + canonical + '?code=' + code);
  expect(errors).toEqual([]);
});
