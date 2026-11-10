import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { syntheticWave as wave } from './helpers/syntheticAudio';

const mp3 = readFileSync(path.resolve(__dirname, 'fixtures/synthetic-tone.mp3'));
const ogg = readFileSync(path.resolve(__dirname, 'fixtures/synthetic-tone.ogg'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
test.beforeEach(async ({ page }) => page.addInitScript(() => {
  (window as any).__formatCaptureCalls = 0;
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
    (window as any).__formatCaptureCalls++;
    throw new Error('Physical capture is forbidden in this test');
  };
}));
test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => (window as any).__formatCaptureCalls || 0)).toBe(0);
});

async function staff(page: Page, base: string, previews: () => number = () => 200,
  failure = { code: 'media_preview_busy', retryAfter: '1' }) {
  let count = 0;
  await page.addInitScript(() => localStorage.setItem('emocog_selected_project_id', '7'));
  await page.route('http://127.0.0.1:3000/**', route => {
    const p = new URL(route.request().url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'Retry-After' };
    const json = (body: unknown) => route.fulfill({ headers, json: body });
    if (p === '/auth/me') return json({ id: 1, email: 'fixture@example.test', role: 'researcher', csrf_token: 'fixture' });
    if (p === '/projects') return json([{ id: 7, name: 'Format checks' }]);
    if (p === '/stimuli') return json([{ id: 42, project_id: 7, mime_type: 'image/png', name: 'Image', created_by: 1,
      visibility: 'private', metadata: {}, content_available: true, content_url: '/stimuli/42/content', preview_url: '/stimuli/42/preview' }]);
    if (p === '/stimuli/42/preview') {
      count++;
      const status = previews();
      return status === 200 ? route.fulfill({ headers, contentType: 'image/png', body: png })
        : route.fulfill({ headers: { ...headers, 'Retry-After': failure.retryAfter }, status, json: { code: failure.code, error: 'Synthetic preview error' } });
    }
    return json([]);
  });
  return () => count;
}

for (const [name, mime, bytes] of [['WAV', 'audio/x-wav', wave()], ['MP3', 'audio/mpeg', mp3], ['OGG/Opus', 'audio/ogg', ogg]] as const) {
  for (const mode of (name === 'OGG/Opus' ? ['normal'] : ['normal', 'permission', 'decode-error'])) test(`${name}: real decoder, playback and teardown (${mode})`, async ({ page, baseURL }) => {
    const nativeDuration = name === 'OGG/Opus' ? await page.evaluate(bytes => new Promise<number | null>(resolve => {
      const audio = new Audio(), url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/ogg' }));
      const finish = (duration: number | null) => {
        clearTimeout(timer); audio.onloadedmetadata = null; audio.onerror = null;
        audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); resolve(duration);
      };
      const timer = setTimeout(() => finish(null), 5000);
      audio.onloadedmetadata = () => finish(audio.duration);
      audio.onerror = () => finish(null);
      audio.preload = 'metadata'; audio.src = url; audio.load();
    }), [...bytes]) : null;
    const blocked = mode === 'permission';
    if (blocked) await page.addInitScript(() => {
      const original = HTMLMediaElement.prototype.play;
      let denied = false;
      HTMLMediaElement.prototype.play = function () {
        if (this.id === 'cogAudio' && !denied) {
          denied = true;
          return Promise.reject(new DOMException('Synthetic autoplay restriction', 'NotAllowedError'));
        }
        return original.call(this);
      };
    });
    await page.route('**/format-audio', r => r.fulfill({ contentType: mime, body: bytes }));
    await page.goto(`${baseURL}/apps/participant-web/mvp_with_precheck_1-updated.html`);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.evaluate(async ({ mime, base }) => {
      const s = (window as any).__WECOG_STATE__;
      s.runtime.sessionRuntime.policyShown = true;
      s.runtime.invitationStimuliMap = { 42: { id: '42', mime_type: mime, metadata: { source_url: base + '/format-audio' } } };
      const { loadAndStartCognitiveTask } = await import(new URL('js/web-page/experimental_task-updated.js?v=20261110-integration1', location.href).href);
      await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2.0_universal', blocks: [{ id: 'audio', type: 'cognitive_task', taskType: 'simple_rt',
        blockConfig: { useFixation: false, rtWindow: 5000 }, trials: [{ stimulusId: '42', duration: 5000, action: 'Space' },
          { stimulusId: 'std_simple_black_square', duration: 5000, action: 'Space' }] }] } });
    }, { mime, base: baseURL });
    if (nativeDuration === 0) {
      // Some Linux WebKit/GStreamer builds return zero for a valid Ogg/Opus file.
      // Verify rejection, never silently call that a successful playback.
      await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'unavailable');
      await expect(page.locator('#cogStartBtn')).toHaveText('Повторить подготовку');
      expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults || [])).toHaveLength(0);
      return;
    }
    await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
    await page.locator('#cogStartBtn').click();
    await page.waitForFunction(() => (window as any).__WECOG_STATE__.runtime.currentPhase === 'cognitive_stimulus'
      || document.querySelector('[data-allow-stimulus-audio]'));
    const allow = page.locator('[data-allow-stimulus-audio]');
    if (blocked) await expect(allow).toBeVisible();
    if (await allow.isVisible()) await allow.click();
    await expect.poll(() => page.locator('#cogAudio').evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0);
    expect(await page.locator('#cogAudio').evaluate((a: HTMLAudioElement) => a.muted)).toBe(false);
    const rect = await page.evaluate(async () => (await import(new URL('js/web-page/app-updated.js?v=20261110-integration1', location.href).href)).currentStimulusContentRect());
    expect(rect).toBe(null);
    if (mode === 'decode-error') await page.locator('#cogAudio').evaluate(a => a.dispatchEvent(new Event('error')));
    else await page.keyboard.press('Space');
    await expect(page.locator('#cogShape')).toBeVisible();
    expect(await page.locator('#cogAudio').getAttribute('src')).toBe(null);
    expect(await page.locator('#cogAudio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
    const row = await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults[0]);
    expect(row).toMatchObject({ stimulusType: 'audio', skippedMedia: mode === 'decode-error', correct: mode !== 'decode-error' });
    if (mode === 'decode-error') expect(row).toMatchObject({ rt: null, response: null, qualityIssueCodes: ['stimulus_media_playback_failed'] });
    await page.keyboard.press('Space');
  });
}

test('passive audio ignores response keys, advances by duration and stores no fictional RT', async ({ page, baseURL }) => {
  await page.route('**/passive-audio', route => route.fulfill({ contentType: 'audio/wav', body: wave() }));
  await page.goto(`${baseURL}/apps/participant-web/mvp_with_precheck_1-updated.html`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async base => {
    const shared = (window as any).__WECOG_STATE__;
    shared.runtime.sessionRuntime.policyShown = true;
    shared.runtime.invitationStimuliMap = { 42: { id: '42', mime_type: 'audio/wav', metadata: { source_url: base + '/passive-audio' } } };
    const { loadAndStartCognitiveTask } = await import(new URL('js/web-page/experimental_task-updated.js?v=20261110-integration1', location.href).href);
    await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2.0_universal', blocks: [{
      id: 'passive', type: 'passive', blockConfig: { useFixation: false, useAOI: false },
      trials: [{ stimulusId: '42', duration: 1500 }, { stimulusId: 'std_simple_black_square', duration: 1000 }],
    }] } });
  }, baseURL);
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
  await page.locator('#cogStartBtn').click();
  await page.waitForFunction(() => (window as any).__WECOG_STATE__.runtime.currentPhase === 'cognitive_stimulus'
    || document.querySelector('[data-allow-stimulus-audio]'));
  const allow = page.locator('[data-allow-stimulus-audio]');
  if (await allow.isVisible()) await allow.click();
  await expect.poll(() => page.locator('#cogAudio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults || [])).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults?.length || 0)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults[0])).toMatchObject({
    stimulusType: 'audio', responseMode: 'none', response: null, rt: null, skippedMedia: false,
  });
  await expect(page.locator('#cogAudio')).not.toHaveAttribute('src');
});

test('resolved play without an advancing audio clock cannot start or score a trial', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.id === 'cogAudio') {
        Object.defineProperty(this, 'currentTime', { configurable: true, get: () => 0, set: () => {} });
        (window as any).__audioPlayRequested = true;
      }
      return original.call(this);
    };
  });
  await page.route('**/stalled-audio', route => route.fulfill({ contentType: 'audio/wav', body: wave() }));
  await page.goto(`${baseURL}/apps/participant-web/mvp_with_precheck_1-updated.html`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async base => {
    const shared = (window as any).__WECOG_STATE__;
    shared.runtime.sessionRuntime.policyShown = true;
    shared.runtime.invitationStimuliMap = { 42: { id: '42', mime_type: 'audio/wav', metadata: { source_url: base + '/stalled-audio' } } };
    const { loadAndStartCognitiveTask } = await import(new URL('js/web-page/experimental_task-updated.js?v=20261110-integration1', location.href).href);
    await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2.0_universal', blocks: [{
      id: 'stalled', type: 'cognitive_task', taskType: 'simple_rt', blockConfig: { useFixation: false },
      trials: [{ stimulusId: '42', duration: 5000, action: 'Space' }],
    }] } });
  }, baseURL);
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
  await page.clock.install();
  await page.locator('#cogStartBtn').click();
  await page.waitForFunction(() => (window as any).__audioPlayRequested || document.querySelector('[data-allow-stimulus-audio]'));
  const allow = page.locator('[data-allow-stimulus-audio]');
  if (await allow.isVisible()) await allow.click();
  await page.clock.fastForward(16000);
  await expect(page.getByRole('button', { name: 'Пропустить пробу' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults || [])).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.currentPhase)).not.toBe('cognitive_stimulus');
});

test('provided MP4 plays with a native decoder or explicitly blocks preparation when H.264 is absent', async ({ page, baseURL }) => {
  test.skip(!process.env.WECOG_USER_MEDIA_MP4, 'Optional private user video; never added to Git');
  const bytes = readFileSync(process.env.WECOG_USER_MEDIA_MP4!);
  await page.route('**/private-format-mp4', r => r.fulfill({ contentType: 'video/mp4', body: bytes }));
  await page.goto(`${baseURL}/apps/participant-web/mvp_with_precheck_1-updated.html`);
  const nativeH264 = await page.evaluate(() => !!document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'));
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async base => {
    const s = (window as any).__WECOG_STATE__;
    s.runtime.sessionRuntime.policyShown = true;
    s.runtime.invitationStimuliMap = { 42: { id: '42', mime_type: 'video/mp4', metadata: { source_url: base + '/private-format-mp4' } } };
    const { loadAndStartCognitiveTask } = await import(new URL('js/web-page/experimental_task-updated.js?v=20261110-integration1', location.href).href);
    await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2.0_universal', blocks: [{ id: 'mp4', type: 'cognitive_task', taskType: 'simple_rt',
      blockConfig: { useFixation: false, rtWindow: 8000 }, trials: [{ stimulusId: '42', duration: 8000, action: 'Space' }] }] } });
  }, baseURL);
  if (!nativeH264) {
    await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'unavailable');
    await expect(page.locator('#cogStartBtn')).toHaveText('Повторить подготовку');
    await page.locator('#cogStartBtn').click();
    await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'unavailable');
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.currentPhase)).not.toBe('cognitive_stimulus');
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults || [])).toHaveLength(0);
    return;
  }
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogVideo')).toBeVisible();
  await expect.poll(() => page.locator('#cogVideo').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  expect(await page.locator('#cogVideo').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test('temporary thumbnail errors retry a bounded number of times without downloading originals', async ({ page, baseURL }) => {
  let calls = 0;
  let originals = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/stimuli/42/content') originals++; });
  const requests = await staff(page, baseURL!, () => ++calls <= 2 ? 503 : 200);
  await page.goto(`${baseURL}/apps/web/researcher.html#/stimuli`);
  await page.locator('.stimulus-card[data-id="42"]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-stimulus-thumbnail="42"] img')).toBeVisible();
  expect(requests()).toBe(3);
  expect(originals).toBe(0);
});

for (const [status, code, retryAfter] of [[403, 'forbidden', '1'], [503, 'media_write_uncertain', '1'],
  [503, 'media_preview_busy', '30']] as const) test(`thumbnail ${code}/${retryAfter}s does not trigger automatic repeats`, async ({ page, baseURL }) => {
  const requests = await staff(page, baseURL!, () => status, { code, retryAfter });
  await page.goto(`${baseURL}/apps/web/researcher.html#/stimuli`);
  await page.locator('.stimulus-card[data-id="42"]').scrollIntoViewIfNeeded();
  const card = page.locator('[data-stimulus-thumbnail="42"]');
  await expect(card.getByRole('button', { name: 'Повторить' })).toBeVisible();
  await page.waitForTimeout(2200);
  expect(requests()).toBe(1);
});

test('audio library preview is opt-in, decoded locally and never requests an image poster or spatial AOI', async ({ page, baseURL }) => {
  await staff(page, baseURL!);
  let contents = 0, posters = 0;
  const headers = { 'Access-Control-Allow-Origin': baseURL!, 'Access-Control-Allow-Credentials': 'true' };
  await page.route(url => url.origin === 'http://127.0.0.1:3000' && url.pathname === '/stimuli', route => route.fulfill({ headers, json: [{
    id: 42, project_id: 7, name: 'Audio fixture', created_by: 1, visibility: 'private', mime_type: 'audio/x-wav',
    metadata: {}, content_available: true, content_url: '/stimuli/42/content', preview_url: '/stimuli/42/preview',
  }] }));
  await page.route('http://127.0.0.1:3000/stimuli/42/content', route => {
    contents++; return route.fulfill({ headers, contentType: 'audio/x-wav', body: wave() });
  });
  await page.route('http://127.0.0.1:3000/stimuli/42/preview', route => {
    posters++; return route.fulfill({ headers, status: 415, json: { code: 'media_preview_unsupported' } });
  });
  await page.goto(`${baseURL}/apps/web/researcher.html#/stimuli`);
  const card = page.locator('[data-stimulus-thumbnail="42"]');
  await expect(card.getByRole('button', { name: 'Прослушать аудио' })).toBeVisible();
  expect(contents).toBe(0); expect(posters).toBe(0);
  await card.getByRole('button', { name: 'Прослушать аудио' }).click();
  await expect(card.locator('audio')).toBeVisible();
  await expect.poll(() => card.locator('audio').evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThanOrEqual(1);
  expect(await card.locator('audio').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  expect(contents).toBe(1); expect(posters).toBe(0);
  await page.evaluate(() => (window as any).openAoiEditor('42'));
  await expect(page.locator('#aoiSvg')).toHaveCount(0);
});

for (const useAOI of [false, true]) test(`removed AOIs publish without stale runtime definitions (AOI ${useAOI})`, async ({ page, baseURL }, testInfo) => {
  await page.setViewportSize(useAOI ? { width: 390, height: 844 } : { width: 1280, height: 720 });
  await staff(page, baseURL!);
  await page.goto(`${baseURL}/apps/web/researcher.html#/overview`);
  await page.waitForFunction(() => typeof (window as any).ExperimentBuilderView === 'function');
  await page.evaluate(useAOI => {
    const w = window as any;
    localStorage.setItem('emocog_my_experiments', JSON.stringify([{ id: 'cleared-aois', title: 'Cleared areas', protocolId: 'cleared-aois', savedStep: 8,
      metadata: { title: 'Cleared areas', protocolId: 'cleared-aois', estimatedDuration: '1 min' },
      blocks: [{ id: 'rt', type: 'cognitive_task', label: 'Audio and visual task', content: { taskType: 'simple_rt', useAOI,
        aoiDefinitions: { std_simple_black_square: [] }, aoiSchemaVersion: '1.2', useFixation: false,
        trials: [{ stimulusId: 'std_simple_black_square', action: 'Space', duration: 1000, repetitions: 1 }] } }] }]));
    w.hasResearcherApiToken = () => true;
    w.apiGet = async () => [];
    w.apiPost = async (url: string, payload: any) => {
      if (url === '/protocols') { w.savedPublication = payload.definition; return { id: 501, project_id: 7, definition: payload.definition }; }
      return { id: 601, code: 'fixture-publication' };
    };
    document.getElementById('view')!.replaceChildren(w.ExperimentBuilderView({ experimentId: 'cleared-aois', startStep: 8 }));
  }, useAOI);
  await page.locator('#finishSaveProtocolBtn').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Протокол можно опубликовать');
  await expect(dialog).not.toContainText('/blocks');
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(dialog.getByRole('heading', { name: 'Перед публикацией', exact: true })).toBeInViewport();
  await expect(dialog.locator('[data-preflight-continue]')).toBeInViewport();
  await dialog.screenshot({ path: `/tmp/wecog-preflight-${testInfo.project.name}-${useAOI ? 'mobile' : 'desktop'}.png` });
  expect((await dialog.locator('[data-preflight-continue]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dialog.locator('[data-preflight-continue]').click();
  await expect.poll(() => page.evaluate(() => !!(window as any).savedPublication)).toBe(true);
  const report = await page.evaluate(() => {
    const w = window as any, d = w.savedPublication, b = d.blocks.find((b: any) => b.id === 'rt');
    return { valid: w.EmocogAoiProtocol.validateProtocolAois(d).ok, contentAois: b.content.aoiDefinitions,
      runtimeAois: b.blockConfig.aoiDefinitions, authoredAois: d.builderState?.blocks[0]?.content?.aoiDefinitions };
  });
  expect(report.valid).toBe(true);
  expect(report.contentAois).toBeUndefined();
  expect(report.runtimeAois).toBeUndefined();
  expect(report.authoredAois).toEqual({ std_simple_black_square: [] });
});
