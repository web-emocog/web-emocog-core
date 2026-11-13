import { test, expect, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CODE = 'BOUNDED-SYNTHETIC';
const PAGE = `/apps/participant-web/mvp_with_precheck_1-updated.html?code=${CODE}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const VIDEO = readFileSync(path.resolve(__dirname, 'fixtures/passive-video.webm'));

async function mock(page: Page, { kind = 'image', blocks = 20, perBlock = 12, unavailable = false, limited = false } = {}) {
  const bytes = kind === 'video' ? VIDEO : PNG;
  const requests: number[] = [];
  let fail = unavailable, rateLimit = limited;
  await page.addInitScript(() => {
    // This suite must never request camera or microphone access.
    (window as any).__captureCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__captureCalls++; throw new Error('Capture is forbidden in media preparation tests');
    };
  });
  await page.route('**/invitations/by-code/**', async route => {
    const url = new URL(route.request().url());
    const content = url.pathname.match(/\/stimuli\/(\d+)\/content$/);
    if (content) {
      const id = Number(content[1]); requests.push(id);
      if (rateLimit) { rateLimit = false;
        await route.fulfill({ status: 429, headers: { 'Retry-After': '0', 'Access-Control-Expose-Headers': 'Retry-After' }, body: '{}' }); return; }
      if (fail && id === 2) { await route.abort('internetdisconnected'); return; }
      await route.fulfill({ contentType: kind === 'video' ? 'video/webm' : 'image/png', body: bytes }); return;
    }
    if (url.pathname.endsWith('/stimuli')) {
      await route.fulfill({ json: Array.from({ length: blocks * perBlock }, (_, i) => ({
        id: i + 1, name: `Synthetic ${kind} ${i + 1}`, mime_type: kind === 'video' ? 'video/webm' : 'image/png',
        size_bytes: bytes.length, version: 'revision-1', sha256: createHash('sha256').update(bytes).digest('hex'),
        content_url: `/invitations/by-code/${CODE}/stimuli/${i + 1}/content`, metadata: {}
      })) }); return;
    }
    await route.fulfill({ json: { invitation_id: 7, code: CODE, project_id: 2, protocol_id: 3, publication_version: 1,
      definition: { version: 'v2.0_universal', blocks: Array.from({ length: blocks }, (_, i) => ({
        id: `block-${i}`, type: 'cognitive_task', taskType: 'simple_rt',
        blockConfig: { useFixation: false, stimulusDuration: 10000, responseMode: 'keypress' },
        trials: Array.from({ length: perBlock }, (_, t) => ({ stimulusId: String(i * perBlock + t + 1), action: 'space', duration: 10000 }))
      })) }
    } });
  });
  return { requests, bytes, recover() { fail = false; } };
}

async function startRunner(page: Page) {
  await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.runtime.sessionRuntime.policyShown = true;
    const runner = await import(new URL('js/web-page/experimental_task-updated.js?v=20261112-emotion2', location.href).href);
    await runner.loadAndStartCognitiveTask({ protocol: shared.runtime.invitationProtocolDefinition, autoFinishSession: false });
  });
}

for (const kind of ['image', 'video']) {
  test(`${kind}: only the first block is warmed, repeated trials use pinned local handles and preserve onset`, async ({ page }) => {
    const m = await mock(page, { kind, limited: true });
    await page.goto(PAGE);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.invitationMediaStatus?.state === 'ready');
    expect(new Set(m.requests).size).toBe(12);
    expect(m.requests).toHaveLength(13);
    await startRunner(page);
    await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
    await page.locator('#cogStartBtn').click();
    const media = page.locator(kind === 'video' ? '#cogVideo' : '#cogImage');
    await expect(media).toBeVisible();
    expect(await media.getAttribute('src')).toMatch(/^blob:/);
    await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.runtime.currentPhase)).toBe('cognitive_stimulus');
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
    await expect(media).toBeVisible();
    expect(m.requests).toHaveLength(13);
    const audit = await page.evaluate(() => {
      const shared = (window as any).__WECOG_STATE__;
      return { status: shared.runtime.invitationMediaPreparation.cache.snapshot(), result: shared.sessionData.cognitiveResults[0],
        captureCalls: (window as any).__captureCalls };
    });
    expect(audit.captureCalls).toBe(0);
    expect(audit.status.pinnedEntries).toBe(12);
    expect(audit.status.peakBytes).toBeLessThanOrEqual(audit.status.budgetBytes);
    expect(audit.result.onsetMs).not.toBeNull();
    expect(audit.result.rt).toBeGreaterThanOrEqual(0);
  });
}

test('offline failure blocks trials with retry; retained files survive retry, reload makes no offline promise', async ({ page }) => {
  const m = await mock(page, { perBlock: 3, blocks: 3, unavailable: true });
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.invitationMediaStatus?.state === 'unavailable');
  await startRunner(page);
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'unavailable');
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(0);
  expect(await page.locator('#cogImage').getAttribute('src')).toBeNull();
  expect(m.requests.filter(id => id === 1)).toHaveLength(1);
  m.recover();
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
  expect(m.requests.filter(id => id === 1)).toHaveLength(1);
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogImage')).toBeVisible();
  expect(new Set(m.requests)).toEqual(new Set([1, 2, 3]));
  const before = m.requests.length;
  await page.reload();
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.invitationMediaStatus?.state === 'ready');
  expect(m.requests.length).toBe(before + 3);
});

test('an oversized active block explains the budget before any trial, with no direct-URL bypass', async ({ page }) => {
  const m = await mock(page, { blocks: 2, perBlock: 4 });
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.invitationMediaStatus?.state === 'ready');
  await page.evaluate(async budget => {
    const shared = (window as any).__WECOG_STATE__;
    const { createBlockMediaPreparation } = await import(new URL('/apps/participant-web/js/session-runtime/block-media-preparation.mjs', location.href).href);
    const { createInvitationRequestPool } = await import(new URL('/apps/participant-web/js/session-runtime/invitation-http.mjs?v=20261110-integration1', location.href).href);
    const { fetchMediaWithDeadline } = await import(new URL('/apps/participant-web/js/session-runtime/media-preload.mjs?v=20261110-integration1', location.href).href);
    shared.runtime.invitationMediaPreparation.dispose();
    shared.runtime.invitationMediaPreparation = createBlockMediaPreparation({ scope: 'budget-test',
      budgetBytes: budget, rows: shared.runtime.invitationStimuliMap,
      request: createInvitationRequestPool({ fetchRequest: fetchMediaWithDeadline }) });
  }, m.bytes.length * 3);
  const before = m.requests.length;
  await startRunner(page);
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'unavailable');
  await expect(page.locator('[data-block-media-status]')).toContainText(/бюджет|budget/i);
  expect(m.requests.length).toBe(before);
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'unavailable');
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(0);
  expect(await page.locator('#cogImage').getAttribute('src')).toBeNull();
});

test('many real video probes release decoders while byte-budget eviction revokes only owned URLs', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  await page.route('**/synthetic-video/**', route => route.fulfill({ body: VIDEO, contentType: 'video/webm' }));
  const result = await page.evaluate(async size => {
    const { createMediaCache } = await import(new URL('/apps/participant-web/js/session-runtime/media-cache.mjs', location.href).href);
    const { fetchMediaWithDeadline } = await import(new URL('/apps/participant-web/js/session-runtime/media-preload.mjs?v=20261110-integration1', location.href).href);
    const videos: HTMLVideoElement[] = [];
    const original = document.createElement;
    (document as any).createElement = function (...args: any[]) {
      const element = original.apply(document, args as [any]);
      if (args[0] === 'video') videos.push(element as HTMLVideoElement);
      return element;
    };
    const cache = createMediaCache({ scope: 'many-real-videos', request: fetchMediaWithDeadline, budgetBytes: size * 8 });
    try {
      for (let i = 0; i < 80; i++) {
        const row = { sourceUrl: `${location.origin}/synthetic-video/${i}`, mimeType: 'video/webm', sizeBytes: size };
        const lease = await cache.prepare([row]); lease.release();
      }
      const stats = cache.snapshot();
      cache.dispose();
      return { stats, after: cache.snapshot(), probes: videos.length,
        released: videos.every(video => video.paused && !video.hasAttribute('src') && video.onloadedmetadata === null && video.onerror === null) };
    } finally { cache.dispose(); document.createElement = original; }
  }, VIDEO.length);
  expect(result.probes).toBe(80);
  expect(result.released).toBe(true);
  expect(result.stats.peakBytes).toBeLessThanOrEqual(VIDEO.length * 8);
  expect(result.after.residentBytes).toBe(0);
});

test('three blocks prepare only at instruction boundaries and teardown releases all pins and URLs', async ({ page }) => {
  const m = await mock(page, { blocks: 3, perBlock: 2 });
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.invitationMediaStatus?.state === 'ready');
  await page.evaluate(async budget => {
    const shared = (window as any).__WECOG_STATE__;
    const { createBlockMediaPreparation } = await import(new URL('/apps/participant-web/js/session-runtime/block-media-preparation.mjs', location.href).href);
    const { fetchMediaWithDeadline } = await import(new URL('/apps/participant-web/js/session-runtime/media-preload.mjs?v=20261110-integration1', location.href).href);
    shared.runtime.invitationMediaPreparation.dispose();
    shared.runtime.invitationMediaPreparation = createBlockMediaPreparation({ scope: 'transition-test', budgetBytes: budget,
      rows: shared.runtime.invitationStimuliMap, request: fetchMediaWithDeadline });
  }, m.bytes.length * 4);
  await startRunner(page);
  for (let b = 0; b < 3; b++) {
    await page.waitForFunction(id => {
      const status = (window as any).__WECOG_STATE__.runtime.blockMediaStatus;
      return status?.state === 'ready' && status.blockId === id;
    }, `block-${b}`);
    expect(Math.max(...m.requests)).toBe((b + 1) * 2);
    const before = m.requests.length;
    await page.locator('#cogStartBtn').click();
    for (let t = 0; t < 2; t++) {
      await page.waitForFunction(id => {
        const runtime = (window as any).__WECOG_STATE__.runtime;
        return runtime.currentPhase === 'cognitive_stimulus' && runtime.taskContext.stimulusId === id;
      }, String(b * 2 + t + 1));
      expect(m.requests.length, 'no stimulus download while trial or block is active').toBe(before);
      await page.keyboard.press('Space');
      await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(b * 2 + t + 1);
    }
    await expect(page.locator('[data-session-modal-action]')).toBeVisible();
    expect(m.requests.length).toBe(before);
    await page.locator('[data-session-modal-action]').click();
  }
  const result = await page.evaluate(async () => {
    const runtime = (window as any).__WECOG_STATE__.runtime;
    runtime.stopCognitiveStimulusPlayback();
    const cache = runtime.invitationMediaPreparation.cache;
    const before = cache.urls();
    runtime.invitationMediaPreparation.dispose();
    const alive = await Promise.all(before.map(async (url: string) => { try { await fetch(url); return true; } catch { return false; } }));
    return { stats: cache.snapshot(), alive, capture: (window as any).__captureCalls };
  });
  expect(result.stats.pinnedEntries).toBe(0);
  expect(result.stats.residentBytes).toBe(0);
  expect(result.stats.peakBytes).toBeLessThanOrEqual(m.bytes.length * 4);
  expect(result.alive.every((value: boolean) => !value)).toBe(true);
  expect(result.capture).toBe(0);
});

test('a failed local handle never falls back to a network URL during a timed trial', async ({ page }) => {
  const m = await mock(page, { blocks: 1, perBlock: 1 });
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.invitationMediaStatus?.state === 'ready');
  await startRunner(page);
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
  await page.evaluate(() => {
    const image = document.getElementById('cogImage');
    if (!(image instanceof HTMLImageElement)) throw new Error('Stimulus image missing');
    const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(image, 'src', {
      get: () => original.get!.call(image),
      set: (url: string) => {
        if (!url.startsWith('blob:')) return original.set!.call(image, url);
        // Do not reuse the probed URL: Firefox may retain its decoded image.
        const invalid = URL.createObjectURL(new Blob(['not an image'], { type: 'image/png' }));
        URL.revokeObjectURL(invalid);
        original.set!.call(image, invalid);
      }
    });
  });
  const before = m.requests.length;
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape').getByRole('button').first()).toBeVisible();
  expect(m.requests.length).toBe(before);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.currentPhase)).not.toBe('cognitive_stimulus');
  expect(await page.locator('#cogImage').getAttribute('src')).toMatch(/^blob:/);
});
