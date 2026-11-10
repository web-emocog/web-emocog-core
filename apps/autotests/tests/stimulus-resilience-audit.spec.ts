import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ingestAcknowledgement } from './helpers/ingestAcknowledgement';
const participant = 'http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html';
const version = '20261109-issues2';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const video = readFileSync(path.resolve(__dirname, 'fixtures/passive-video.webm'));

async function invitation(page: Page, media = false) {
  let metadataOnline = true, downloads = 0;
  await page.route('http://127.0.0.1:3000/**', route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173', 'Access-Control-Allow-Credentials': 'true' };
    if (path === '/auth/me') return route.fulfill({ headers, status: 401, json: {} });
    if (path.endsWith('/ingest-token')) return route.fulfill({ headers, json: { token: 'audit-token' } });
    if (path.endsWith('/stimuli')) return route.fulfill({ headers, json: media ? [{ id: '42', name: 'Upload', mime_type: 'image/png',
      version: 'version-42', content_url: '/invitations/by-code/immutable-two/stimuli/42/content', metadata: {} }] : [] });
    if (path === '/invitations/by-code/immutable-two/stimuli/42/content') {
      downloads++; return route.fulfill({ headers, contentType: 'image/png', body: png });
    }
    if (path.startsWith('/invitations/by-code/')) return metadataOnline ? route.fulfill({ headers, json: {
      code: 'immutable-two', public_code: 'stable-audit', publication_version: 2, invitation_id: 2, project_id: 3, protocol_id: 4,
      definition: { version: 'v2.0_universal', blocks: media ? [{ id: 'rt', type: 'cognitive_task', taskType: 'simple_rt',
        trials: [{ stimulusId: '42', action: 'KeyD', duration: 5000 }] }] : [{ id: 'finish', type: 'finish' }] }
    } }) : route.abort('internetdisconnected');
    if (path === '/ingest') return route.fulfill({ headers, json: ingestAcknowledgement(route.request()) });
    return route.fulfill({ headers, json: {} });
  });
  return { offlineMetadata: () => { metadataOnline = false; }, onlineMetadata: () => { metadataOnline = true; }, downloads: () => downloads };
}

test('refreshing the immutable publication at Start reuses decoded media; reload reloads valid bytes', async ({ page }) => {
  const fixture = await invitation(page, true);
  await page.goto(`${participant}?code=stable-audit`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__.runtime.invitationMediaStatus?.state === 'ready');
  const first = await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.invitationStimuliMap['42'].metadata.url);
  expect(first).toMatch(/^blob:/);
  expect(fixture.downloads()).toBe(1);
  await page.locator('#btnStartIntro').click();
  await expect(page.locator('#consentCheck')).toBeVisible();
  expect(fixture.downloads()).toBe(1);
  await page.locator('#consentCheck').check(); await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  await page.reload();
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__.runtime.invitationMediaStatus?.state === 'ready');
  expect(fixture.downloads()).toBe(2);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.invitationStimuliMap['42'].metadata.url)).not.toBe(first);
});

test('offline metadata on final reload cannot replace the pinned invitation or final packet', async ({ page }) => {
  const fixture = await invitation(page);
  let accepting = false;
  const sent: any[] = [];
  await page.route('**/ingest', route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status: accepting ? 200 : 403, headers: { 'Access-Control-Allow-Origin': '*' },
      json: accepting ? ingestAcknowledgement(route.request()) : { error: 'Offline fixture' } });
  });
  await page.goto(`${participant}?code=stable-audit`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.locator('#btnStartIntro').click(); await page.locator('#consentCheck').check(); await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  await page.evaluate(async version => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.cognitiveResults = [{ rt: 425, blockId: 'accepted', correct: true }];
    const { finishSession } = await import(new URL(`js/web-page/tests-updated.js?v=${version}`, location.href).href);
    await finishSession();
  }, version);
  await expect(page.locator('#retryUploadBtn')).toBeVisible();
  const original = sent[0];
  fixture.offlineMetadata();
  await page.reload();
  await expect(page.locator('#retryUploadBtn')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.invitationCode)).toBe('immutable-two');
  expect(sent.at(-1)).toEqual(original);
  accepting = true; fixture.onlineMetadata();
  await page.locator('#retryUploadBtn').click();
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.upload?.ok)).toBe(true);
  expect(sent.at(-1)).toEqual(original);
});

test('admission does not reserve a run when IndexedDB works but the active recovery reference is unavailable', async ({ page }) => {
  await invitation(page);
  let admissions = 0;
  page.on('request', request => { if (request.url().endsWith('/ingest-token')) admissions++; });
  await page.goto(`${participant}?code=stable-audit`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(() => { (window as any).__WECOG_STATE__.runtime.sessionRuntime.checkpoints.getActiveSessionId = () => null; });
  await page.locator('#btnStartIntro').click(); await page.locator('#consentCheck').check(); await page.locator('#consentBtn').click();
  await expect(page.locator('#consentError')).toContainText(/хранилище|storage/i);
  expect(admissions).toBe(0);
});

test('a false HTTP 200 cannot finish upload; the next valid acknowledgement uses the exact packet', async ({ page }) => {
  await invitation(page);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const bodies: string[] = [];
  await page.route('**/ingest', async route => {
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/html', body: '<html>Proxy error</html>' });
    await hold;
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: ingestAcknowledgement(route.request()) });
  });
  await page.goto(`${participant}?code=stable-audit`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async version => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.ids.session ||= 'false-success-audit';
    shared.sessionData.ids.participant ||= 'audit-participant';
    const { finishSession } = await import(new URL(`js/web-page/tests-updated.js?v=${version}`, location.href).href);
    (window as any).__finish = finishSession();
  }, version);
  await expect.poll(() => bodies.length).toBe(2);
  expect(await page.evaluate(() => !!(window as any).__WECOG_STATE__.sessionData.pendingFinalUpload)).toBe(true);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.upload?.ok === true)).toBe(false);
  release();
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.upload?.ok)).toBe(true);
  expect(bodies[1]).toBe(bodies[0]);
});

for (const kind of ['image', 'video']) {
  test(`a hanging local ${kind} times out without network fallback; a late callback cannot corrupt the next stimulus`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.setTimeout;
      (window as any).__mediaDeadlines = [];
      window.setTimeout = ((callback: any, delay: any, ...args: any[]) => {
        if (callback?.name === 'fail' && [10000, 15000].includes(delay)) (window as any).__mediaDeadlines.push(callback);
        return original(callback, delay, ...args);
      }) as any;
    });
    let downloads = 0;
    await page.route('**/audit-hang-*', route => {
      downloads++;
      return route.fulfill({ contentType: kind === 'video' ? 'video/webm' : 'image/png', body: kind === 'video' ? video : png });
    });
    await page.goto(participant);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.evaluate(async ({ kind, version }) => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      shared.runtime.invitationStimuliMap = { '42': { id: '42', mime_type: kind === 'video' ? 'video/webm' : 'image/png',
        metadata: { source_url: `${location.origin}/audit-hang-source` } } };
      const { loadAndStartCognitiveTask } = await import(new URL(`js/web-page/experimental_task-updated.js?v=${version}`, location.href).href);
      await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: '1', blocks: [{ id: 'media', type: 'cognitive_task', taskType: 'simple_rt',
        blockConfig: { useFixation: false, rtWindow: 5000 }, trials: [{ stimulusId: '42', duration: 5000, action: 'Space' },
          { stimulusId: 'std_simple_black_square', duration: 5000, action: 'Space' }] }] } });
    }, { kind, version });
    await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
    await page.evaluate(kind => {
      const element = document.getElementById(kind === 'video' ? 'cogVideo' : 'cogImage')!;
      // Only stall the timed presentation, not the block's independent decoder probe.
      Object.defineProperty(element, 'src', { set() {} });
    }, kind);
    await page.locator('#cogStartBtn').click();
    await page.waitForFunction(() => (window as any).__mediaDeadlines.length === 1);
    await expect(page.locator(kind === 'video' ? '#cogVideo' : '#cogImage')).toBeHidden();
    await page.evaluate(() => (window as any).__mediaDeadlines[0]());
    await expect(page.getByRole('button', { name: /Пропустить пробу|Skip this trial/ })).toBeVisible();
    await page.getByRole('button', { name: /Пропустить пробу|Skip this trial/ }).click();
    await expect(page.locator('#cogShape')).toBeVisible();
    await page.evaluate(() => (window as any).__mediaDeadlines[0]());
    await expect(page.locator('#cogShape')).not.toContainText(/не загрузился|could not be loaded/);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults[0].skippedMedia)).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.map((row: any) => row.qualityValid))).toEqual([false, true]);
    expect(downloads).toBe(1);
  });
}

test('a video decode error after onset interrupts only that presentation; its healthy retry is accepted', async ({ page }) => {
  await page.route('**/audit-late-video', route => route.fulfill({ contentType: 'video/webm', body: video }));
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async version => {
    const w = window as any;
    const s = w.__WECOG_STATE__;
    const runtime = s.runtime.sessionRuntime;
    runtime.policyShown = true;
    const repeat = runtime.promptRepeat.bind(runtime);
    runtime.promptRepeat = (blockId: string) => {
      w.mediaRepeatItems = runtime.machine.repeatQueue.find((row: any) => row.blockId === blockId)?.repeatItems;
      return repeat(blockId);
    };
    s.runtime.invitationStimuliMap = { '42': { id: '42', mime_type: 'video/webm',
      metadata: { source_url: location.origin + '/audit-late-video' } } };
    const { loadAndStartCognitiveTask } = await import(new URL(`js/web-page/experimental_task-updated.js?v=${version}`, location.href).href);
    await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: '1', blocks: [{ id: 'media', type: 'cognitive_task', taskType: 'simple_rt',
      blockConfig: { useFixation: false, showFeedback: false, rtWindow: 5000 },
      trials: [{ id: 'video-fail', stimulusId: '42', duration: 5000, action: 'Space' },
        { id: 'healthy-shape', stimulusId: 'std_simple_black_square', duration: 5000, action: 'Space' }] }] } });
  }, version);
  await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogVideo')).toBeVisible();
  await page.locator('#cogVideo').evaluate(element => {
    (window as any).oldVideoError = (element as HTMLVideoElement).onerror;
    element.dispatchEvent(new Event('error'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
  await expect(page.locator('#cogShape')).toBeVisible();
  await page.evaluate(() => (window as any).oldVideoError());
  await page.keyboard.press('Space');
  await expect(page.locator('[data-session-modal-action]')).toBeVisible();
  const first = await page.evaluate(() => {
    const w = window as any, data = w.__WECOG_STATE__.sessionData;
    const [failed, healthy] = data.cognitiveResults;
    return { failed, healthy, status: data.experimentMeta.presentationPlan.actual[0].status,
      responsesOnFailure: data.events.filter((e: any) => e.type === 'response' && e.presentationId === failed.presentationId).length,
      repeat: w.mediaRepeatItems };
  });
  expect(first.failed).toMatchObject({ rt: null, response: null, skippedMedia: true, qualityValid: false,
    qualityIssueCodes: ['stimulus_media_playback_failed'] });
  expect(first.healthy).toMatchObject({ skippedMedia: false, qualityValid: true, correct: true });
  expect(first.status).toBe('interrupted');
  expect(first.responsesOnFailure).toBe(0);
  expect(first.repeat).toEqual([{ id: first.failed.trialId, issueCodes: ['stimulus_media_playback_failed'] }]);
  await page.locator('[data-session-modal-action]').click();
  await expect(page.locator('#cogVideo')).toBeVisible();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.map((row: any) => row.qualityValid)))
    .toEqual([false, true, true]);
});

test('an undecodable analytics image is evicted so retry downloads corrected bytes instead of reusing a broken blob', async ({ page }) => {
  let valid = false, requests = 0;
  await page.route('http://127.0.0.1:3000/stimuli/42/content', route => {
    requests++;
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173', 'Access-Control-Allow-Credentials': 'true' }, contentType: 'image/png', body: valid ? png : Buffer.from('broken png') });
  });
  await page.goto('http://127.0.0.1:4173/apps/web/researcher.html?analyticsPreview=1#/analytics/session-card');
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.evaluate(async () => {
    const w = window as any, api = w.EmocogAnalyticsProduction, store = api.store;
    await store.apply();
    const response = structuredClone(store.state.visualResponse);
    response.data.contexts[0].stimulus.contentUrl = '/stimuli/42/content';
    response.data.contexts[0].heatmap.stimulus = response.data.contexts[0].stimulus;
    delete w.EmocogAnalyticsPreviewFixture;
    w.apiGet = async () => structuredClone(response);
    await store.loadVisualAnalytics();
  });
  await expect(page.locator('.analytics-stimulus-fallback:visible')).toHaveCount(1);
  expect(requests).toBe(1);
  valid = true;
  await page.getByRole('button', { name: /Повторить загрузку медиа|Retry loading media/ }).click();
  await expect.poll(() => page.locator('.analytics-stimulus-image').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  expect(requests).toBe(2);
});

test('failed admission reload stays on consent and reuses its original identifiers', async ({ page }) => {
  await invitation(page);
  let deny = true;
  const ids: string[] = [];
  await page.route('**/ingest-token', route => {
    ids.push(route.request().postDataJSON().session_id);
    return route.fulfill({ status: deny ? 403 : 200, headers: { 'Access-Control-Allow-Origin': '*' },
      json: deny ? { error: 'Denied fixture' } : { token: 'retry-token' } });
  });
  await page.goto(`${participant}?code=stable-audit`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.locator('#btnStartIntro').click(); await page.locator('#consentCheck').check(); await page.locator('#consentBtn').click();
  await expect(page.locator('#consentError')).toBeVisible();
  const sessionId = ids[0];
  await page.reload();
  await expect(page.locator('#step2')).toHaveClass(/active/);
  await expect(page.locator('#step3')).not.toHaveClass(/active/);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.session)).toBe(sessionId);
  deny = false;
  await page.locator('#consentCheck').check(); await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  expect(ids).toEqual([sessionId, sessionId]);
});

test('an unreadable saved checkpoint cannot silently become a new run or overwrite the old data', async ({ page }) => {
  await invitation(page);
  await page.goto(`${participant}?code=stable-audit`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.locator('#btnStartIntro').click(); await page.locator('#consentCheck').check(); await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  const sessionId = await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.cognitiveResults = [{ blockId: 'retained', rt: 481 }];
    await shared.runtime.sessionRuntime.saveCheckpoint();
    return shared.sessionData.ids.session;
  });
  await page.addInitScript(() => {
    const w = window as any;
    w.__readableIndexedDB = window.indexedDB;
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open: () => {
      const request: any = { error: new DOMException('Test blocked database', 'UnknownError') };
      setTimeout(() => request.onerror?.(), 0);
      return request;
    } } });
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.sessionRuntime.checkpointRestoreFailed)).toBe(true);
  await page.locator('#btnStartIntro').click();
  await expect(page.locator('#step1')).toHaveClass(/active/);
  await expect(page.locator('#sessionPersistenceStatus')).toContainText(/Не очищайте|Do not clear/);
  const restoredRt = await page.evaluate(sessionId => new Promise<number>((resolve, reject) => {
    const request = (window as any).__readableIndexedDB.open('wecog-participant-runtime');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('session-checkpoints', 'readonly');
      const checkpoint = transaction.objectStore('session-checkpoints').get(sessionId);
      transaction.oncomplete = () => { db.close(); resolve(checkpoint.result.sessionData.cognitiveResults[0].rt); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), sessionId);
  expect(restoredRt).toBe(481);
});
