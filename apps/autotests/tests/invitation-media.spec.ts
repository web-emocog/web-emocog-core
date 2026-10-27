import { test, expect, Page } from '@playwright/test';
import { getPageUrl } from './helpers/testUtils';

const PAGE_URL = getPageUrl();
const CODE = 'INV-LARGE-SYNTHETIC';
const IMAGE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function mockInvitation(page: Page, count: number, options: { rateLimitOnce?: boolean; unavailableOnce?: boolean } = {}) {
  const state = { requests: new Map<number, number>(), active: 0, peak: 0, version: 1, lookups: 0 };
  await page.route('**/invitations/by-code/**', async route => {
    const url = new URL(route.request().url());
    const file = url.pathname.match(/\/stimuli\/(\d+)\/content$/);
    if (file) {
      const id = Number(file[1]);
      const attempts = (state.requests.get(id) || 0) + 1;
      state.requests.set(id, attempts);
      state.peak = Math.max(state.peak, ++state.active);
      try {
        if (id === 1 && attempts === 1 && options.rateLimitOnce) {
          await route.fulfill({ status: 429, headers: { 'Retry-After': '1', 'Access-Control-Expose-Headers': 'Retry-After' }, body: '{}' });
        } else if (id === 1 && attempts === 1 && options.unavailableOnce) {
          await route.fulfill({ status: 503, body: '{}' });
        } else {
          await new Promise(resolve => setTimeout(resolve, 5));
          await route.fulfill({ status: 200, contentType: 'image/png', body: IMAGE });
        }
      } finally { state.active--; }
      return;
    }
    if (url.pathname.endsWith(`/by-code/${CODE}/stimuli`)) {
      await route.fulfill({ json: Array.from({ length: count }, (_, index) => ({
        id: index + 1, name: `Synthetic image ${index + 1}`, mime_type: 'image/png',
        version: `revision-${state.version}`, sha256: `synthetic-${state.version}-${index + 1}`, metadata: {},
        content_url: `/invitations/by-code/${CODE}/stimuli/${index + 1}/content`,
      })) });
      return;
    }
    if (url.pathname.endsWith(`/by-code/${CODE}`)) {
      state.lookups++;
      await route.fulfill({ json: {
        invitation_id: 901, code: CODE, protocol_id: 901, project_id: 1,
        publication_version: state.version,
        definition: { version: 'v2.0_universal', blocks: [{
          id: 'large-image-task', type: 'cognitive_task', taskType: 'simple_rt',
          blockConfig: { stimulusDuration: 1000 },
          trials: Array.from({ length: count }, (_, id) => ({ stimulusId: String(id + 1), condition: 'target', action: 'space' })),
        }] },
      } });
      return;
    }
    await route.fallback();
  });
  return state;
}

async function waitForImages(page: Page, count: number) {
  await page.waitForFunction(expected => {
    const map = (window as any).__WECOG_STATE__?.runtime?.invitationStimuliMap;
    return Object.values(map || {}).filter((row: any) => row.metadata?.url?.startsWith('blob:')).length === expected;
  }, count);
}

test.describe('Large invitation media hotfix', () => {
  for (const count of [63, 360]) {
    test(`preloads ${count} images, recovers from 429, and starts without downloading them twice`, async ({ page }) => {
      const mock = await mockInvitation(page, count, { rateLimitOnce: true });
      await page.goto(`${PAGE_URL}?code=${CODE}`, { waitUntil: 'load' });
      await waitForImages(page, count);
      expect(mock.peak).toBeLessThanOrEqual(3);
      expect(mock.requests.size).toBe(count);
      expect(mock.requests.get(1)).toBe(2);
      expect([...mock.requests.values()].reduce((a, b) => a + b, 0)).toBe(count + 1);

      await page.locator('#btnStartIntro').click();
      await expect(page.locator('#step2')).toHaveClass(/active/);
      expect(mock.lookups).toBe(2);
      expect([...mock.requests.values()].reduce((a, b) => a + b, 0)).toBe(count + 1);
      const dimensions = await page.evaluate(async id => {
        const row = (window as any).__WECOG_STATE__.runtime.invitationStimuliMap[String(id)];
        const image = new Image();
        image.src = row.metadata.url;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, count);
      expect(dimensions).toEqual([1, 1]);

      await page.evaluate(async () => {
        const shared = (window as any).__WECOG_STATE__;
        shared.runtime.sessionRuntime.policyShown = true;
        const url = new URL('js/web-page/experimental_task-updated.js?v=20261025-1', window.location.href).href;
        const { loadAndStartCognitiveTask } = await import(url);
        await loadAndStartCognitiveTask({ protocol: shared.runtime.invitationProtocolDefinition, autoFinishSession: false });
      });
      await page.locator('#cogStartBtn').click();
      await expect(page.locator('#cogImage')).toBeVisible();
      await expect.poll(() => page.locator('#cogImage').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    });
  }

  test('only retries an unavailable image and retains successfully decoded files', async ({ page }) => {
    const mock = await mockInvitation(page, 63, { unavailableOnce: true });
    await page.goto(`${PAGE_URL}?code=${CODE}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.invitationProtocolDefinition));
    expect(mock.requests.get(1)).toBe(1);
    await page.locator('#btnStartIntro').click();
    await expect(page.locator('#step2')).toHaveClass(/active/);
    await waitForImages(page, 63);
    expect(mock.requests.get(1)).toBe(2);
    for (let id = 2; id <= 63; id++) expect(mock.requests.get(id)).toBe(1);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.invitationStimulusObjectUrls.length)).toBe(63);
  });

  test('does not reuse cached files when the publication changes', async ({ page }) => {
    const mock = await mockInvitation(page, 2);
    await page.goto(`${PAGE_URL}?code=${CODE}`, { waitUntil: 'load' });
    await waitForImages(page, 2);
    const previous = await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.invitationStimuliMap['1'].metadata.url);
    mock.version = 2;
    await page.locator('#btnStartIntro').click();
    await expect(page.locator('#step2')).toHaveClass(/active/);
    expect(mock.requests.get(1)).toBe(2);
    expect(mock.requests.get(2)).toBe(2);
    const current = await page.evaluate(() => ({
      version: (window as any).__WECOG_STATE__.runtime.invitationProtocolMeta.publicationVersion,
      url: (window as any).__WECOG_STATE__.runtime.invitationStimuliMap['1'].metadata.url,
      retained: (window as any).__WECOG_STATE__.runtime.invitationStimulusObjectUrls.length,
    }));
    expect(current.version).toBe(2);
    expect(current.url).not.toBe(previous);
    expect(current.retained).toBe(2);
    expect(await page.evaluate(async url => { try { await fetch(url); return true; } catch { return false; } }, previous)).toBe(false);
  });

  test('does not call a rate-limited invitation missing or request a new link', async ({ page }) => {
    let requests = 0;
    await page.route('**/invitations/by-code/**', async route => {
      requests++;
      await route.fulfill({ status: 429, headers: { 'Retry-After': '3600', 'Access-Control-Expose-Headers': 'Retry-After' }, body: '{}' });
    });
    await page.goto(`${PAGE_URL}?code=${CODE}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.invitationLoadError));
    await page.locator('#btnStartIntro').click();
    await expect(page.locator('#inviteLinkHint')).toContainText(/временно ограничил|temporarily rate limited/);
    await expect(page.locator('#step1')).toHaveClass(/active/);
    await expect(page.locator('#btnStartIntro')).toBeEnabled();
    expect(requests).toBe(1);
  });
});
