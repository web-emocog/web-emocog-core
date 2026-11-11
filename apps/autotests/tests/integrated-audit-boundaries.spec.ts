import { expect, test } from '@playwright/test';

const participant = '/apps/participant-web/mvp_with_precheck_1-updated.html';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.WECOG_API_BASE = location.origin + '/main/api';
    w.__captureCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      w.__captureCalls++;
      throw new Error('Capture must not be used by this fixture');
    };
  });
  await page.route('**/auth/me', route => route.fulfill({ status: 401, json: {} }));
});

test('a stimulus must use the pinned publication path, under the configured API prefix', async ({ page }) => {
  const goodPath = '/invitations/by-code/pinned-audit/stimuli/7/content';
  let valid = false;
  const requested: string[] = [];
  await page.route('**/invitations/by-code/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/content')) {
      requested.push(pathname);
      return route.fulfill({ contentType: 'image/png', body: png });
    }
    if (pathname.endsWith('/stimuli')) return route.fulfill({ json: [{
      id: 7, mime_type: 'image/png', size_bytes: png.length,
      content_url: valid ? goodPath : '/invitations/by-code/other-publication/stimuli/7/content'
    }] });
    return route.fulfill({ json: {
      code: 'pinned-audit', public_code: 'stable-audit', publication_version: 2, invitation_id: 2, project_id: 3, protocol_id: 4,
      definition: { version: 'v2.0_universal', blocks: [{ id: 'rt', type: 'cognitive_task', taskType: 'simple_rt',
        trials: [{ stimulusId: '7', action: 'Space', duration: 5000 }] }] }
    } });
  });
  await page.goto(participant + '?code=stable-audit');
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.invitationMediaStatus?.state === 'unavailable');
  expect(requested).toEqual([]);
  valid = true;
  await page.locator('#btnStartIntro').click();
  await expect(page.locator('#consentCheck')).toBeVisible();
  expect(requested).toEqual(['/main/api' + goodPath]);
  expect(await page.evaluate(() => (window as any).__captureCalls)).toBe(0);
});

test('oversized protocols stop before presenting or saving trials', async ({ page }) => {
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  const result = await page.evaluate(async () => {
    const s = (window as any).__WECOG_STATE__;
    s.currentLang = 'en';
    s.runtime.sessionRuntime.policyShown = true;
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
    const { loadAndStartCognitiveTask } = await import(url);
    await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2', blocks: [1, 2].map(id => ({
      id: String(id), type: 'cognitive_task', taskType: 'simple_rt',
      trials: [{ stimulusId: 'std_simple_black_square', repetitions: 3000, action: 'Space' }]
    })) } });
    return { trials: s.sessionData.cognitiveResults.length, started: s.sessionData.events.some((entry: any) => entry.type === 'trial_start') };
  });
  await expect(page.locator('#cogText')).toContainText('exceeds the block or trial limit');
  expect(result).toEqual({ trials: 0, started: false });
});

test('the local demo loads real bundled media-free trials', async ({ page }) => {
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async () => {
    const s = (window as any).__WECOG_STATE__;
    s.currentLang = 'en';
    s.runtime.sessionRuntime.policyShown = true;
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
    await (await import(url)).loadAndStartCognitiveTask({ autoFinishSession: false });
  });
  await expect(page.locator('#cogTitle')).toHaveText('Go / No-Go demo');
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.runtime.currentPhase)).toBe('cognitive_stimulus');
  expect(await page.evaluate(() => (window as any).__captureCalls)).toBe(0);
});

test('a fullscreen task after a custom instruction still waits for its own Start gesture', async ({ page }) => {
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async () => {
    const w = window as any, s = w.__WECOG_STATE__;
    s.runtime.sessionRuntime.policyShown = true;
    w.__fullscreenCalls = 0;
    document.documentElement.requestFullscreen = async () => { w.__fullscreenCalls++; };
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
    await (await import(url)).loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2', blocks: [
      { id: 'intro', type: 'instruction', content: { title: 'Custom instruction' } },
      { id: 'rt', type: 'cognitive_task', taskType: 'simple_rt',
        blockConfig: { fullscreenStimulus: true, useFixation: false, stimulusDuration: 5000 },
        trials: [{ stimulusId: 'std_simple_black_square', action: 'Space', duration: 5000 }] }
    ] } });
  });
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
  expect(await page.evaluate(() => (window as any).__fullscreenCalls)).toBe(0);
  await expect(page.locator('#cogShape')).toBeHidden();
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__fullscreenCalls)).toBe(1);
});

test('fallback analysis discards a result from a stopped run and never overlaps it with the replacement', async ({ page }) => {
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async () => {
    const w = window as any, s = w.__WECOG_STATE__;
    s.runtime.sessionRuntime.policyShown = true;
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
    const { loadAndStartCognitiveTask } = await import(url);
    const video = document.getElementById('precheckVideo')!;
    Object.defineProperties(video, {
      srcObject: { get: () => ({}) }, readyState: { get: () => 2 }, currentTime: { get: () => performance.now() / 1000 }
    });
    w.__analysisResolvers = [];
    s.runtime.localAnalyzer = { analyzeFrame: () => new Promise(resolve => { w.__analysisResolvers.push(resolve); }) };
    w.__restart = () => loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2', blocks: [
      { id: 'intro', type: 'instruction', content: { title: 'Controlled analysis' } }
    ] } });
    await w.__restart();
  });
  await expect.poll(() => page.evaluate(() => (window as any).__analysisResolvers.length)).toBe(1);
  await page.evaluate(async () => {
    const w = window as any;
    w.__WECOG_STATE__.runtime.stopCognitiveStimulusPlayback();
    await w.__restart();
  });
  expect(await page.evaluate(() => {
    const w = window as any;
    return { requests: w.__analysisResolvers.length, timer: w.__WECOG_STATE__.runtime.cognitiveAnalysisInterval };
  })).toEqual({ requests: 1, timer: null });
  await page.evaluate(() => (window as any).__analysisResolvers[0]({ fixture: 'stale' }));
  await expect.poll(() => page.evaluate(() => (window as any).__analysisResolvers.length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.lastPrecheckResult?.fixture)).not.toBe('stale');
  await page.evaluate(() => (window as any).__analysisResolvers[1]({ fixture: 'active' }));
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.runtime.lastPrecheckResult?.fixture)).toBe('active');
  expect(await page.evaluate(() => {
    const w = window as any, runtime = w.__WECOG_STATE__.runtime;
    runtime.stopCognitiveStimulusPlayback();
    return { pendingTimer: runtime.cognitiveAnalysisInterval, captureCalls: w.__captureCalls };
  })).toEqual({ pendingTimer: null, captureCalls: 0 });
});
