import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const base = 'http://127.0.0.1:4173';
declare const stimuliList: any[];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('ownership views, explicit sharing and video posters do not download full video for the gallery', async ({ page }, testInfo) => {
  let visibility = 'private';
  let contentRequests = 0;
  let sharingRequests = 0;
  const video = fs.readFileSync(path.resolve(__dirname, '../../api/tests/fixtures/stimulus-video.mp4'));
  await page.addInitScript(() => {
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_selected_project_id', '7');
  });
  await page.route('http://127.0.0.1:3000/**', async route => {
    const url = new URL(route.request().url());
    const headers = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (body: unknown) => route.fulfill({ status: 200, headers, json: body });
    if (url.pathname === '/auth/me') return json({ id: 1, role: 'researcher', email: 'test@example.org' });
    if (url.pathname === '/auth/permissions') return json({});
    if (url.pathname === '/projects') return json([{ id: 7, name: 'Local project' }]);
    if (url.pathname === '/stimuli/folders') return json([]);
    if (url.pathname === '/stimuli') return json([
      { id: 42, project_id: 7, created_by: 1, visibility, name: 'Personal image', mime_type: 'image/png',
        current_version_id: '11111111-1111-4111-8111-111111111111', size_bytes: png.length,
        content_url: '/stimuli/42/content', preview_url: '/stimuli/42/preview', metadata: {} },
      { id: 43, project_id: 7, created_by: 2, visibility: 'project', name: 'Shared video', mime_type: 'video/mp4',
        current_version_id: '22222222-2222-4222-8222-222222222222', size_bytes: video.length,
        content_url: '/stimuli/43/content', preview_url: '/stimuli/43/preview', metadata: {} },
    ]);
    if (url.pathname === '/stimuli/42' && route.request().method() === 'PATCH') {
      ++sharingRequests;
      visibility = route.request().postDataJSON().visibility;
      return json({ id: 42, visibility });
    }
    if (/\/preview$/.test(url.pathname)) return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'image/png' }, body: png });
    if (/\/content$/.test(url.pathname)) {
      if (route.request().method() === 'POST') return route.fulfill({ status: 422, headers,
        json: { error: 'Video cannot be decoded', code: 'media_decode_failed' } });
      ++contentRequests;
      return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': url.pathname.includes('/43/') ? 'video/mp4' : 'image/png' },
        body: url.pathname.includes('/43/') ? video : png });
    }
    return json({});
  });
  await page.goto(`${base}/apps/web/researcher.html#/stimuli`);
  const personal = page.locator('.stimulus-card[data-id="42"]');
  const shared = page.locator('.stimulus-card[data-id="43"]');
  await expect(shared.locator('img')).toBeVisible();
  await expect(shared.locator('video')).toHaveCount(0);
  await expect(personal.locator('.stim-sharing-btn')).toHaveText('Поделиться');
  await expect(shared.locator('.stim-sharing-btn')).toHaveCount(0);
  expect(contentRequests).toBe(0);
  await page.locator('[data-stimulus-scope="personal"]').click();
  await expect(personal).toBeVisible();
  await expect(shared).toHaveCount(0);
  await page.locator('[data-stimulus-scope="project"]').click();
  await expect(personal).toHaveCount(0);
  await expect(shared).toBeVisible();
  await page.locator('[data-stimulus-scope="builtin"]').click();
  await expect(personal).toHaveCount(0);
  await expect(shared).toHaveCount(0);
  await expect(page.locator('.stimulus-card').first()).toBeVisible();
  await page.locator('[data-stimulus-scope="all"]').click();
  const assertCircleFits = async () => {
    await expect.poll(() => page.locator('.stimulus-card[data-id="std_go_green_circle"] [data-standard-shape-preview]').evaluate(shape => {
      const figure = shape.getBoundingClientRect();
      const bounds = shape.parentElement!.getBoundingClientRect();
      return figure.width > 0 && Math.abs(figure.width - figure.height) < 1 &&
        figure.width <= bounds.width && figure.height <= bounds.height;
    })).toBe(true);
  };
  await assertCircleFits();
  page.on('dialog', dialog => dialog.accept());
  await personal.locator('.stim-sharing-btn').click();
  await expect(personal).toContainText('Общий для проекта');
  expect(sharingRequests).toBe(1);
  await personal.locator('.stim-sharing-btn').click();
  await expect(personal).toContainText('Личный');
  expect(sharingRequests).toBe(2);
  await page.reload();
  await expect(shared.locator('img')).toBeVisible();
  expect(contentRequests).toBe(0);
  const originalType = await page.evaluate(async () => {
    const stimulus = stimuliList.find((item: any) => item.id === '43');
    await (window as any).hydrateApiStimulusPreview(stimulus);
    return (await fetch(stimulus._previewObjectUrl)).headers.get('content-type');
  });
  expect(originalType).toBe('video/mp4');
  expect(contentRequests).toBe(1);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'),
    page.evaluate(() => (window as any).replaceStimulusContent('43'))]);
  await chooser.setFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('broken') });
  await expect(page.locator('.toast').last()).toContainText('Не удалось заменить файл');
  const preserved = await page.evaluate(() => {
    const stimulus = stimuliList.find((item: any) => item.id === '43');
    return { available: stimulus.contentAvailable, version: stimulus.contentVersion, thumbnail: !!stimulus._thumbnailObjectUrl };
  });
  expect(preserved).toEqual({ available: true, version: '22222222-2222-4222-8222-222222222222', thumbnail: true });
  await page.screenshot({ path: testInfo.outputPath('ownership-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#mobileNavToggle').click();
  await expect(page.locator('#mobileNavToggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#mobileNavToggle').click();
  await expect(page.locator('#mobileNavToggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#mobileNavigationPanel')).toHaveCSS('opacity', '0');
  await assertCircleFits();
  await expect(page.locator('[data-stimulus-scope="personal"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('ownership-mobile.png'), fullPage: true });
});
