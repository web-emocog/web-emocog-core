import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ingestAcknowledgement } from './helpers/ingestAcknowledgement';

const participant = `${process.env.WECOG_TEST_BASE_URL || 'http://127.0.0.1:4173'}/apps/participant-web/mvp_with_precheck_1-updated.html`;
const moduleVersion = '20261112-emotion1';
const code = 'recovery-invitation';
const definition = { version: 'v2.0_universal', participantShell: { consent: true, questionnaire: true, precheck: true, calibration: true },
  blocks: [
    { id: 'intro-a', type: 'instruction', content: { titleEn: 'First task', textEn: 'Press D.', standardInstruction: false } },
    { id: 'task-a', type: 'cognitive_task', taskType: 'simple_rt', blockConfig: { responseMode: 'keypress', useFixation: false, rtWindow: 5000 },
      trials: [{ id: 'a', stimulusId: 'std_simple_black_square', action: 'KeyD', duration: 5000 }] },
    { id: 'intro-b', type: 'instruction', content: { titleEn: 'Second task', textEn: 'Press M.', standardInstruction: false } },
    { id: 'task-b', type: 'cognitive_task', taskType: 'simple_rt', blockConfig: { responseMode: 'keypress', useFixation: false, rtWindow: 5000 },
      trials: [{ id: 'b', stimulusId: 'std_simple_black_square', action: 'KeyM', duration: 5000 }] },
    { id: 'finish', type: 'finish', content: { titleEn: 'Experiment completed' } }
  ] };

async function mockInvitation(page: Page, transientAdmission = false) {
  let admissions = 0;
  await page.route('http://127.0.0.1:3000/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': new URL(participant).origin, 'Access-Control-Allow-Credentials': 'true' };
    if (path.endsWith('/ingest-token')) {
      admissions++;
      return route.fulfill({ headers, status: transientAdmission && admissions === 1 ? 503 : 200,
        json: transientAdmission && admissions === 1 ? { error: 'Temporary outage' } : { token: 'recovery-token' } });
    }
    if (path.endsWith('/stimuli')) return route.fulfill({ headers, json: [] });
    if (path.startsWith('/invitations/by-code/')) return route.fulfill({ headers, json: { code, public_code: 'stable-recovery',
      invitation_id: 91, protocol_id: 92, project_id: 93, publication_version: 2, definition } });
    if (path === '/auth/me') return route.fulfill({ headers, status: 401, json: {} });
    if (path === '/ingest') return route.fulfill({ headers, json: ingestAcknowledgement(route.request()) });
    return route.fulfill({ headers, json: { ok: true } });
  });
  return () => admissions;
}

test('one consent click handles transient admission and IndexedDB failure, then reloads the same registration', async ({ page }) => {
  const admissions = await mockInvitation(page, true);
  const consoleOutput: string[] = [];
  page.on('console', message => consoleOutput.push(message.text()));
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(() => {
    const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
    runtime.checkpoints._savePrimary = async () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.locator('#btnStartIntro').click();
  await page.locator('#consentCheck').check();
  await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  expect(admissions()).toBe(2);
  const ids = await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids);
  expect(consoleOutput.join('\n')).not.toContain('[IDs Generated]');
  expect(consoleOutput.join('\n')).not.toContain(ids.participant.slice(0, 8));
  await page.reload();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids)).toEqual(ids);
  expect(admissions()).toBe(2);
});

test('Start preserves the immutable publication code behind a stable entry link', async ({ page }) => {
  await mockInvitation(page);
  await page.goto(`${participant}?code=stable-recovery`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await expect(page.locator('#inviteLinkInput')).toHaveValue('stable-recovery');
  await page.locator('#btnStartIntro').click();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.invitationCode)).toBe(code);
  const admission = page.waitForRequest(request => request.url().endsWith('/ingest-token'));
  await page.locator('#consentCheck').check();
  await page.locator('#consentBtn').click();
  expect((await admission).url()).toContain(`/by-code/${code}/ingest-token`);
  await expect(page.locator('#step3')).toHaveClass(/active/);
  await page.reload();
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.experimentMeta.publicationVersion)).toBe(2);
});

test('muting successful backup notices keeps uploads and error warnings active', async ({ page }) => {
  await mockInvitation(page);
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.runtime.invitationProtocolDefinition.settings = { persistence: { showBackupNotifications: false } };
    shared.sessionData.consent = { informed_consent: { accepted: true } };
    const runtime = shared.runtime.sessionRuntime;
    runtime.delivery.send = async () => ({ ok: true });
    await runtime.delivery.checkpoint();
  });
  await expect(page.locator('#sessionPersistenceStatus')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.serverBackup.status)).toBe('saved');
  await page.evaluate(async () => {
    const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
    runtime.delivery.send = async () => ({ ok: false, status: 503 });
    await runtime.delivery.checkpoint();
  });
  await expect(page.locator('#sessionPersistenceStatus')).toHaveAttribute('data-persistence-code', 'backup');
  await page.evaluate(async () => {
    const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
    runtime.delivery.send = async () => ({ ok: true });
    await runtime.delivery.checkpoint();
  });
  await expect(page.locator('#sessionPersistenceStatus')).toHaveCount(0);
});

test('a publication made while the welcome screen is open is refreshed before consent', async ({ page }) => {
  await mockInvitation(page);
  let lookups = 0;
  await page.route(/\/invitations\/by-code\/stable-recovery(?:\?|$)/, route => {
    lookups++;
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: {
      code: lookups === 1 ? 'stable-recovery' : code, public_code: 'stable-recovery',
      invitation_id: lookups === 1 ? 90 : 91, publication_version: lookups === 1 ? 1 : 2,
      protocol_id: 92, project_id: 93, definition
    } });
  });
  await page.goto(`${participant}?code=stable-recovery`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.invitationProtocolMeta.publicationVersion)).toBe(1);
  await page.locator('#btnStartIntro').click();
  await expect(page.locator('#consentCheck')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.invitationProtocolMeta.publicationVersion)).toBe(2);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.invitationCode)).toBe(code);
});

test('admission distinguishes blocked local storage from API permission failure', async ({ page }) => {
  await mockInvitation(page);
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(() => {
    const shared = (window as any).__WECOG_STATE__;
    shared.currentLang = 'en';
    shared.runtime.sessionRuntime.saveCheckpoint = async () => false;
  });
  await page.locator('#btnStartIntro').click();
  await page.locator('#consentCheck').check();
  await page.locator('#consentBtn').click();
  await expect(page.locator('#consentError')).toContainText('Browser storage is unavailable');
  await expect(page.locator('#step3')).not.toHaveClass(/active/);
  await page.evaluate(() => {
    const shared = (window as any).__WECOG_STATE__;
    sessionStorage.clear();
    shared.runtime.sessionRuntime.saveCheckpoint = async () => true;
  });
  await page.route('**/ingest-token', route => route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, json: { error: 'denied' } }));
  await page.locator('#consentBtn').click();
  await expect(page.locator('#consentError')).toContainText('server denied access');
});

test('30-second backup uses typed cumulative ingest and final upload supersedes later ticks', async ({ page }) => {
  const uploads: any[] = [];
  await page.addInitScript(() => {
    const original = window.setInterval;
    (window as any).__backupTicks = [];
    window.setInterval = ((callback: any, delay: any, ...args: any[]) => {
      if (delay === 30000) (window as any).__backupTicks.push(callback);
      return original(callback, delay, ...args);
    }) as any;
  });
  await mockInvitation(page);
  await page.route('**/ingest', route => {
    uploads.push(route.request().postDataJSON());
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: ingestAcknowledgement(route.request()) });
  });
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.locator('#btnStartIntro').click();
  await page.locator('#consentCheck').check();
  await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  await page.evaluate(() => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.cognitiveResults = [{ rt: 410, correct: true, blockId: 'retained' }];
    shared.runtime.sessionRuntime.getBpmSnapshot = () => ({ ready: true, sampleCount: 12, bpmMean: 72,
      respRateMean: 15, respRateMin: 14, respRateMax: 16, validRespSampleCount: 3 });
    (window as any).__backupTicks[0]();
  });
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0].delivery).toMatchObject({ sequence: 1, kind: 'checkpoint' });
  expect(uploads[0].lifecycle.status).toBe('in_progress');
  expect(uploads[0].cognitiveResults[0].rt).toBe(410);
  expect(uploads[0].eyeTracking).toBeUndefined();
  expect(uploads[0].gaze_analytics.schemaVersion).toBe('gaze_analytics.v1');
  expect(uploads[0].bpm_summary.bpmMean).toBe(72);
  expect(uploads[0].respiration_summary).toMatchObject({ resp_rate_mean: 15, resp_sample_count: 3, resp_available: true });
  await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.serverBackup.status)).toBe('saved');
  await page.evaluate(async moduleVersion => {
    const { finishSession } = await import(new URL(`js/web-page/tests-updated.js?v=${moduleVersion}`, location.href).href);
    await finishSession();
    (window as any).__backupTicks[0]();
  }, moduleVersion);
  await expect(page.locator('#step7')).toHaveClass(/active/);
  expect(uploads).toHaveLength(2);
  expect(uploads[1].delivery).toMatchObject({ sequence: 2, kind: 'final' });
});

test('worker-unavailable backup is explicit about omitted signal series and still retains RT', async ({ page }) => {
  await mockInvitation(page);
  const uploads: any[] = [];
  await page.addInitScript(() => { (window as any).Worker = undefined; });
  await page.route('**/ingest', route => {
    uploads.push(route.request().postDataJSON());
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: ingestAcknowledgement(route.request()) });
  });
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.consent = { informed_consent: { accepted: true } };
    shared.sessionData.ids = { session: 'worker-fallback', participant: 'p', invitationCode: 'recovery-invitation' };
    shared.sessionData.cognitiveResults = [{ rt: 420, correct: true }];
    await shared.runtime.sessionRuntime.delivery.checkpoint();
  });
  expect(uploads).toHaveLength(1);
  expect(uploads[0].experimentMeta.backupScope).toBe('light_summary_without_signal_series');
  expect(uploads[0].gaze_analytics).toBeUndefined();
  expect(uploads[0].cognitiveResults[0].rt).toBe(420);
});

test('configured hard stop waits for the current RT response, saves results and labels the protocol incomplete', async ({ page }) => {
  const uploads: any[] = [];
  await mockInvitation(page);
  await page.route('**/ingest', route => {
    uploads.push(route.request().postDataJSON());
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: ingestAcknowledgement(route.request(), { qc_validity: 'invalid' }) });
  });
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async moduleVersion => {
    const shared = (window as any).__WECOG_STATE__;
    shared.currentLang = 'en'; shared.runtime.sessionRuntime.policyShown = true;
    shared.sessionData.ids = { session: 'hard-stop', participant: 'p', invitationCode: 'recovery-invitation' };
    shared.runtime.invitationProtocolDefinition.settings = { qualityControl: { schemaVersion: 'protocol_quality.v1', rules: {
      gazeValid: { enabled: true, threshold: 99, hardStop: true }
    } } };
    const { loadAndStartCognitiveTask } = await import(new URL(`js/web-page/experimental_task-updated.js?v=${moduleVersion}`, location.href).href);
    await loadAndStartCognitiveTask({ protocol: shared.runtime.invitationProtocolDefinition });
  }, moduleVersion);
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
  await page.evaluate(() => {
    const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
    const metrics = { durationMs: 20000, totalFrames: 100, gazeTotal: 100, gazeValidPct: 90 };
    runtime.updateProtocolQuality(metrics, 1000); runtime.updateProtocolQuality(metrics, 4100);
  });
  expect(uploads).toHaveLength(0);
  await page.keyboard.press('KeyD');
  await expect(page.locator('#step7')).toHaveClass(/active/);
  await expect(page.locator('#protocolQcNotice')).toContainText('incomplete');
  expect(uploads).toHaveLength(1);
  expect(uploads[0].experimentMeta.protocolTermination.reason).toBe('quality_stopped');
  expect(uploads[0].cognitiveResults).toHaveLength(1);
  expect(uploads[0].cognitiveResults[0].qualityValid).toBe(false);
});

test('rolling gaze retention rebases IndexedDB chunks without corrupting a long-session checkpoint', async ({ page }) => {
  await page.goto(participant);
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  const result = await page.evaluate(async ({ moduleVersion }) => {
    const shared = (window as any).__WECOG_STATE__;
    const appUrl = Array.from(document.scripts).find(script => script.src.includes('/js/web-page/app-updated.js?'))!.src;
    const { appendGazeSample } = await import(appUrl);
    const { SessionCheckpointStore } = await import(new URL('js/session-runtime/checkpoint-store.mjs', location.href).href);
    shared.sessionData.ids.session = 'rolling-retention';
    shared.sessionData.eyeTracking = Array.from({ length: 32000 }, (_, i) => ({ t: i, x: .5, y: .5 }));
    const store = shared.runtime.sessionRuntime.checkpoints;
    await store.save('rolling-retention', shared.sessionData, { state: 'instruction' });
    appendGazeSample({ t: 32000, x: .5, y: .5 });
    await store.save('rolling-retention', shared.sessionData, { state: 'instruction' });
    for (let i = 32001; i <= 32500; i++) appendGazeSample({ t: i, x: .5, y: .5 });
    await store.save('rolling-retention', shared.sessionData, { state: 'completed' });
    const loaded = await new SessionCheckpointStore().load('rolling-retention');
    const samples = loaded.sessionData.eyeTracking;
    return { count: samples.length, first: samples[0].t, last: samples.at(-1).t, mode: store.lastPersistenceMode };
  }, { moduleVersion });
  expect(result).toEqual({ count: 30500, first: 2001, last: 32500, mode: 'indexeddb' });
});

test('overlapping checkpoint callers share a handled failure rather than an unhandled rejection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  const outcomes = await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.ids.session = 'overlapping-failure';
    const runtime = shared.runtime.sessionRuntime;
    let rejectWrite: (error: Error) => void = () => {};
    runtime.checkpoints.save = () => new Promise((_resolve, reject) => { rejectWrite = reject; });
    const first = runtime.saveCheckpoint();
    const second = runtime.saveCheckpoint();
    rejectWrite(new Error('Storage unavailable'));
    return Promise.all([first, second]);
  });
  expect(outcomes).toEqual([false, false]);
  expect(errors).toEqual([]);
});

test('final screen and ingest still work if all local checkpoint writes fail', async ({ page }) => {
  await mockInvitation(page);
  const uploads: any[] = [];
  await page.route('**/ingest', route => {
    uploads.push(route.request().postDataJSON());
    return route.fulfill({ json: ingestAcknowledgement(route.request(), { qc_validity: 'valid' }), headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async ({ code, moduleVersion }) => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.ids = { session: 'failed-storage-final', participant: 'p', invitationCode: code };
    shared.sessionData.startTime = Date.now() - 35 * 60 * 1000;
    shared.sessionData.cognitiveResults = [{ blockId: 'task-a', trialId: 'a', rt: 420, correct: true }];
    shared.runtime.sessionRuntime.checkpoints.save = async () => { throw new Error('QuotaExceededError'); };
    const { finishSession } = await import(new URL(`js/web-page/tests-updated.js?v=${moduleVersion}`, location.href).href);
    await finishSession();
  }, { code, moduleVersion });
  await expect(page.locator('#step7')).toHaveClass(/active/);
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  expect(uploads).toHaveLength(1);
  expect(uploads[0].lifecycle.status).toBe('completed');
  expect(uploads[0].cognitiveResults[0].rt).toBe(420);
});

test('failed final upload survives reload with the exact original payload and finish key', async ({ page }) => {
  await mockInvitation(page);
  const privateMarker = 'SYNTHETIC-UPLOAD-ERROR-MUST-NOT-BE-EXPORTED';
  const consoleOutput: string[] = [];
  page.on('console', message => consoleOutput.push(message.text()));
  await page.addInitScript(() => {
    (window as any).WECOG_ALLOW_DEBUG = true;
    localStorage.setItem('wecog_debug', '1');
  });
  let accept = false;
  const uploads: Array<{ key: string | undefined; payload: any }> = [];
  await page.route('**/ingest', route => {
    uploads.push({ key: route.request().headers()['idempotency-key'], payload: route.request().postDataJSON() });
    return route.fulfill({ status: accept ? 200 : 403, json: accept ? ingestAcknowledgement(route.request(), { qc_validity: 'valid' }) : { error: privateMarker, details: [privateMarker] },
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async ({ code, moduleVersion }) => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.ids = { session: 'retry-after-reload', participant: 'p', invitationCode: code };
    shared.sessionData.startTime = Date.now() - 35 * 60 * 1000;
    shared.sessionData.cognitiveResults = [{ rt: 410, correct: true, blockId: 'task-a', trialId: 'a' }];
    shared.sessionData.eyeTracking = [{ t: 100, valid: true, x: .4, y: .4 }, { t: 200, valid: true, x: .5, y: .5 }];
    shared.runtime.sessionRuntime.checkpoints._savePrimary = async () => { throw new Error('quota'); };
    const { finishSession } = await import(new URL(`js/web-page/tests-updated.js?v=${moduleVersion}`, location.href).href);
    await finishSession();
  }, { code, moduleVersion });
  await expect(page.locator('#step7')).toHaveClass(/active/);
  await expect(page.locator('#retryUploadBtn')).toBeVisible();
  expect(uploads).toHaveLength(1);
  const failure = await page.evaluate(() => {
    const w = window as any;
    return { state: JSON.stringify(w.__WECOG_STATE__.sessionData),
      error: w.__WECOG_STATE__.sessionData.upload.error,
      diagnostic: w.WECOG_DEBUG.find('upload:failed')[0]?.data };
  });
  expect(failure.error).toBe('permission');
  expect(failure.diagnostic).toEqual({ category: 'permission', httpStatus: 403 });
  expect(failure.state).not.toContain(privateMarker);
  expect(consoleOutput.join('\n')).not.toContain(privateMarker);
  expect(consoleOutput.join('\n')).not.toContain('[Final upload]');
  accept = true;
  await page.reload();
  await expect(page.locator('#step7')).toHaveClass(/active/);
  await expect.poll(() => uploads.length).toBe(2);
  expect(uploads[1]).toEqual(uploads[0]);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.upload.ok)).toBe(true);
  await page.locator('#aggregatesOnlyCheckbox').check();
  const download = page.waitForEvent('download');
  await page.locator('#downloadBtn').click();
  const downloadPath = await (await download).path();
  if (!downloadPath) throw new Error('Download unavailable');
  const exported = JSON.parse(await readFile(downloadPath, 'utf8'));
  expect(exported.gaze_analytics.summary.sampleCountTotal).toBe(uploads[0].payload.gaze_analytics.summary.sampleCountTotal);
});

test('a failed JSON download is visible, revokes the blob URL and can be retried', async ({ page }) => {
  await mockInvitation(page);
  const privateMarker = 'SYNTHETIC-PRIVATE-DOWNLOAD-FAILURE';
  const consoleOutput: string[] = [];
  page.on('console', message => consoleOutput.push(message.text()));
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(marker => {
    const w = window as any;
    w.setLanguage('en');
    w.nextStep(7);
    w.__revokeCalls = [];
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { w.__revokeCalls.push(url); nativeRevoke(url); };
    w.__nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { throw new Error(marker); };
  }, privateMarker);
  await page.locator('#downloadBtn').click();
  const status = page.locator('#downloadResultStatus');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Could not download the JSON');
  expect(consoleOutput.join('\n')).not.toContain(privateMarker);
  await expect(page.locator('a[download]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__revokeCalls)).toEqual([expect.stringMatching(/^blob:/)]);
  await page.evaluate(() => { HTMLAnchorElement.prototype.click = (window as any).__nativeAnchorClick; });
  const result = page.waitForEvent('download');
  await page.locator('#downloadBtn').click();
  expect((await result).suggestedFilename()).toMatch(/^session_.+\.json$/);
  await expect(status).toBeHidden();
});

test('reload resumes the next instruction without erasing earlier RT, and finish needs no extra click', async ({ page }) => {
  await mockInvitation(page);
  const uploads: any[] = [];
  await page.route('**/ingest', route => {
    uploads.push(route.request().postDataJSON());
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: ingestAcknowledgement(route.request()) });
  });
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async ({ code, moduleVersion }) => {
    const shared = (window as any).__WECOG_STATE__;
    shared.currentLang = 'en';
    (window as any).setLanguage('en');
    shared.sessionData.ids = { session: 'resume-rt', participant: 'p', invitationCode: code };
    shared.runtime.sessionRuntime.policyShown = true;
    shared.runtime.sessionRuntime.notifyBlockComplete = async () => true;
    const { loadAndStartCognitiveTask } = await import(new URL(`js/web-page/experimental_task-updated.js?v=${moduleVersion}`, location.href).href);
    await loadAndStartCognitiveTask({ protocol: shared.runtime.invitationProtocolDefinition });
  }, { code, moduleVersion });
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
  await page.waitForTimeout(180);
  await page.keyboard.press('KeyD');
  await expect(page.locator('#cogTitle')).toHaveText('Second task');
  await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.shellStep = 6;
    await shared.runtime.sessionRuntime.saveCheckpoint();
  });
  await page.reload();
  await expect(page.locator('[data-session-modal-action]')).toBeVisible();
  await page.locator('[data-session-modal-action]').click();
  await page.evaluate(async ({ moduleVersion }) => {
    const shared = (window as any).__WECOG_STATE__;
    (window as any).setLanguage('en');
    shared.runtime.sessionRuntime.notifyBlockComplete = async () => true;
    const { loadAndStartCognitiveTask } = await import(new URL(`js/web-page/experimental_task-updated.js?v=${moduleVersion}`, location.href).href);
    await loadAndStartCognitiveTask({ protocol: shared.runtime.invitationProtocolDefinition });
  }, { moduleVersion });
  await expect(page.locator('#cogTitle')).toHaveText('Second task');
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
  await page.waitForTimeout(180);
  await page.keyboard.press('KeyM');
  await expect(page.locator('#step7')).toHaveClass(/active/);
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0].cognitiveResults.map((trial: any) => trial.blockId)).toEqual(['task-a', 'task-b']);
});

async function openConsent(page: Page) {
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.locator('#btnStartIntro').click();
  await page.locator('#consentCheck').check();
}

test('consent stays single-flight during a checkbox change and handles a rejected admission', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockInvitation(page);
  let admissions = 0;
  let release = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/ingest-token', async route => {
    admissions++;
    await hold;
    return route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, json: { error: 'denied' } });
  });
  await openConsent(page);
  await page.evaluate(() => { (window as any).setLanguage('en'); });
  const button = page.locator('#consentBtn');
  const check = page.locator('#consentCheck');
  await button.click();
  try {
    await expect.poll(() => admissions).toBe(1);
    await check.uncheck();
    await check.check();
    await expect(button).toBeDisabled();
    await button.dispatchEvent('click');
    await check.uncheck();
  } finally { release(); }
  await expect(page.locator('#consentError')).toContainText('server denied access');
  await expect(button).not.toHaveAttribute('aria-busy', 'true');
  await expect(button).toBeDisabled();
  await check.check();
  await expect(button).toBeEnabled();
  expect(admissions).toBe(1);
  expect(errors).toEqual([]);
});

test('leaving during admission aborts retry and restores the same pending session and consent screen', async ({ page }) => {
  await mockInvitation(page);
  const attempts: any[] = [];
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Retry-After', 'Retry-After': '1' };
  await page.route('**/ingest-token', route => {
    attempts.push(route.request().postDataJSON());
    return route.fulfill({ status: attempts.length === 1 ? 503 : 200, headers,
      json: attempts.length === 1 ? { error: 'retry' } : { token: 'recovered-token' } });
  });
  await openConsent(page);
  const response = page.waitForResponse(r => r.url().endsWith('/ingest-token'));
  await page.locator('#consentBtn').click();
  await response;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.waitForTimeout(1100);
  expect(attempts).toHaveLength(1);
  await expect(page).toHaveURL(/code=recovery-invitation/);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#step2')).toHaveClass(/active/);
  await page.waitForFunction(() => {
    const shared = (window as any).__WECOG_STATE__;
    return shared?.runtime?.participantShellReady && !shared.runtime.participantPageExited;
  });
  await page.locator('#consentCheck').check();
  await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
});

test('return from page history restores accepted RT but does not accept the interrupted trial', async ({ page }) => {
  const errors: string[] = [];
  let ingests = 0;
  page.on('pageerror', error => errors.push(error.message));
  await mockInvitation(page);
  await page.route('**/ingest', route => {
    ingests++;
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: ingestAcknowledgement(route.request()) });
  });
  await page.goto(`${participant}?code=${code}`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async ({ code, moduleVersion }) => {
    const shared = (window as any).__WECOG_STATE__;
    shared.currentLang = 'en';
    shared.sessionData.ids = { session: 'history-active-rt', participant: 'p', invitationCode: code };
    shared.sessionData.shellStep = 6;
    shared.runtime.sessionRuntime.policyShown = true;
    shared.runtime.sessionRuntime.notifyBlockComplete = async () => true;
    const { loadAndStartCognitiveTask } = await import(new URL(`js/web-page/experimental_task-updated.js?v=${moduleVersion}`, location.href).href);
    await loadAndStartCognitiveTask({ protocol: shared.runtime.invitationProtocolDefinition });
  }, { code, moduleVersion });
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyD');
  await expect(page.locator('#cogTitle')).toHaveText('Second task');
  await page.locator('#cogStartBtn').click();
  await expect(page.locator('#cogShape')).toBeVisible();
  const stopped = await page.evaluate(() => {
    const { runtime, sessionData } = (window as any).__WECOG_STATE__;
    const controller = runtime.sessionRuntime;
    let trackStops = 0;
    runtime.cameraStream = { getTracks: () => [{ stop() { trackStops++; } }] };
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM' }));
    return { trackStops, checkpointTimer: controller.checkpointTimer, serverTimer: controller.serverCheckpointTimer,
      deliveryClosed: controller.delivery.closed, reservedFinal: Boolean(sessionData.finalDelivery),
      activeBlock: controller.machine.currentBlock?.blockId,
      accepted: sessionData.cognitiveResults.map((trial: any) => trial.blockId) };
  });
  expect(stopped).toEqual({ trackStops: 1, checkpointTimer: null, serverTimer: null, deliveryClosed: true,
    reservedFinal: false, activeBlock: 'task-b', accepted: ['task-a'] });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('[data-session-modal-action]')).toBeVisible();
  await page.locator('[data-session-modal-action]').click();
  await expect(page.locator('#step5')).toHaveClass(/active/);
  const restored = await page.evaluate(() => {
    const shared = (window as any).__WECOG_STATE__;
    return { id: shared.sessionData.ids.session, results: shared.sessionData.cognitiveResults.map((trial: any) => trial.blockId),
      runtimeStopped: shared.runtime.participantPageExited === true, publication: shared.sessionData.experimentMeta.publicationVersion };
  });
  expect(restored).toEqual({ id: 'history-active-rt', results: ['task-a'], runtimeStopped: false, publication: 2 });
  expect(ingests).toBe(0);
  expect(errors).toEqual([]);
});

test('a history return with unavailable storage retains data and offers an explicit download', async ({ page }) => {
  await mockInvitation(page);
  await openConsent(page);
  await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  await page.evaluate(() => {
    const w = window as any;
    w.setLanguage('en');
    const { runtime, sessionData } = w.__WECOG_STATE__;
    sessionData.cognitiveResults = [{ blockId: 'retained', rt: 430 }];
    runtime.sessionRuntime.saveCheckpoint = async () => false;
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  const panel = page.locator('#participantPageRecovery');
  await expect(panel).toBeVisible();
  await expect(page.locator('.container')).toHaveAttribute('inert', '');
  await panel.getByRole('button', { name: 'Retry recovery' }).click();
  await expect(panel.getByRole('button', { name: 'Retry recovery' })).toBeEnabled();
  const pending = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download available data' }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('Download unavailable');
  const data = JSON.parse(await readFile(path, 'utf8'));
  expect(data.cognitiveResults).toEqual([{ blockId: 'retained', rt: 430 }]);
  expect(data.finalDelivery).toBeUndefined();
});

test('history return preserves a failed final upload and handles a rejected manual retry', async ({ page }) => {
  await mockInvitation(page);
  const errors: string[] = [];
  const uploadAttempts: any[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/ingest', route => {
    uploadAttempts.push(route.request().postDataJSON());
    return route.fulfill({ status: uploadAttempts.length === 1 ? 403 : 200, headers: { 'Access-Control-Allow-Origin': '*' },
      json: uploadAttempts.length === 1 ? { error: 'denied' } : ingestAcknowledgement(route.request()) });
  });
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(async ({ code, moduleVersion }) => {
    const w = window as any;
    w.setLanguage('en');
    const { runtime, sessionData } = w.__WECOG_STATE__;
    sessionData.ids = { session: 'history-final', participant: 'p', invitationCode: code };
    let stopped = 0, release: () => void = () => {};
    runtime.cameraStream = { getTracks: () => [{ stop() { stopped++; } }] };
    runtime.sessionRuntime.audioCollector = { stop: () => new Promise<void>(resolve => { release = resolve; }) };
    const { finishSession } = await import(new URL(`js/web-page/tests-updated.js?v=${moduleVersion}`, location.href).href);
    const finishing = finishSession();
    try {
      if (stopped !== 1) throw new Error('Camera must be released before queued audio finishes');
    } finally { release(); }
    await finishing;
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    // Inject a technical rejection before the second upload can start.
    const descriptor = Object.getOwnPropertyDescriptor(sessionData, 'pendingFinalUpload')!;
    Object.defineProperty(sessionData, 'pendingFinalUpload', { configurable: true, get() { throw new Error('test retry failure'); } });
    w.__restorePendingFinal = () => Object.defineProperty(sessionData, 'pendingFinalUpload', descriptor);
  }, { code, moduleVersion });
  await expect(page.locator('#step7')).toHaveClass(/active/);
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  expect(uploadAttempts).toHaveLength(1);
  await page.locator('#retryUploadBtn').click();
  await expect(page.getByText('The data could not be prepared for upload.')).toBeVisible();
  await expect(page.locator('#retryUploadBtn')).toBeEnabled();
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as any).__restorePendingFinal());
  await page.locator('#retryUploadBtn').click();
  await expect(page.getByText('Data uploaded successfully.')).toBeVisible();
  expect(uploadAttempts).toHaveLength(2);
  expect(uploadAttempts[1]).toEqual(uploadAttempts[0]);
});

test('late camera permission after page exit stops the track without reactivating precheck', async ({ page }) => {
  await mockInvitation(page);
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  const outcome = await page.evaluate(async () => {
    const w = window as any;
    w.nextStep(5);
    const { startPreCheck } = await import(new URL('js/web-page/precheck-updated.js?v=20261110-integration1', location.href).href);
    let resolvePermission: (stream: any) => void = () => {};
    let requests = 0, stops = 0;
    navigator.mediaDevices.getUserMedia = () => {
      requests++;
      return new Promise(resolve => { resolvePermission = resolve; });
    };
    const starting = startPreCheck();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    resolvePermission({ getTracks: () => [{ stop() { stops++; } }] });
    const started = await starting;
    return { requests, stops, started, active: w.__WECOG_STATE__.flags.isPrecheckRunning,
      camera: w.__WECOG_STATE__.runtime.cameraStream };
  });
  expect(outcome).toEqual({ requests: 1, stops: 1, started: false, active: false, camera: null });
});

test('microphone tracks stop before queued analysis resolves, without losing accepted windows', async ({ page }) => {
  await page.goto(participant);
  const outcome = await page.evaluate(async () => {
    const { SessionAudioCollector } = await import(new URL('js/audio/session-audio.js?v=20261110-integration1', location.href).href);
    const shared = { sessionData: { audioConsent: { granted: true } }, runtime: {} };
    const collector = new SessionAudioCollector({ state: shared, enabled: true, WorkerCtor: null });
    let stops = 0, complete = false, release: () => void = () => {};
    collector.stream = { getTracks: () => [{ stop() { stops++; } }] };
    collector.everStarted = true;
    collector.started = true;
    collector.analysisQueue = new Promise<void>(resolve => {
      release = () => {
        collector.windows.push({ usable: true, quality: { accepted: true }, features: {} });
        resolve();
      };
    });
    const stopping = collector.stop().then((result: any) => { complete = true; return result; });
    await Promise.resolve();
    const immediate = { stops, complete, capturing: collector.started };
    release();
    const summary = await stopping;
    await collector.stop();
    return { immediate, totalStops: stops, windowCount: summary.windowCount };
  });
  expect(outcome).toEqual({ immediate: { stops: 1, complete: false, capturing: false }, totalStops: 1, windowCount: 1 });
});

for (const phase of ['instruction', 'drawing', 'complete'] as const) {
  test(`visuospatial ${phase} releases handlers on exit and only explicit completion stores a result`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockInvitation(page);
    await page.goto(participant);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.evaluate(async () => {
      const w = window as any;
      w.nextStep(6);
      const { runVisuospatialDrawingTest } = await import(new URL('js/gaze-tracker/gaze-tests/visuospatial/runner.js?v=20261110-integration1', location.href).href);
      w.__drawingStarts = 0;
      w.__WECOG_STATE__.runtime.currentGaze = { x: 100, y: 150 };
      w.__drawing = runVisuospatialDrawingTest({ onStart: () => { w.__drawingStarts++; } });
    });
    if (phase !== 'instruction') {
      await page.locator('#visuospatialStartBtn').click();
      await expect(page.locator('#visuospatialDrawingOverlay')).toBeVisible();
      await page.keyboard.down('Space');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.keyboard.up('Space');
    }
    if (phase === 'complete') await page.locator('#visuospatialFinishBtn').click();
    else await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    const outcome = await page.evaluate(async () => {
      const w = window as any;
      const result = await w.__drawing;
      (document.getElementById('visuospatialStartBtn') as HTMLButtonElement).dispatchEvent(new Event('click'));
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      const data = w.__WECOG_STATE__.sessionData;
      return { stored: data.gazeTests?.visuospatialRuns?.length || 0, result: result !== null,
        starts: w.__drawingStarts, cancelReleased: w.__WECOG_STATE__.runtime.cancelVisuospatialTest == null,
        activeKeys: w.__WECOG_ACTIVE_LISTENERS__ || 0, final: Boolean(data.finalDelivery),
        completedEvent: data.events.some((event: any) => event.type === 'visuospatial_run_end') };
    });
    expect(outcome).toEqual({ stored: phase === 'complete' ? 1 : 0, result: phase === 'complete',
      starts: phase === 'instruction' ? 0 : 1, cancelReleased: true, activeKeys: 0, final: false, completedEvent: phase === 'complete' });
    expect(errors).toEqual([]);
  });
}

test('page exit retires an in-flight local gaze analysis before it can publish or schedule another tick', async ({ page }) => {
  await mockInvitation(page);
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  const outcome = await page.evaluate(async moduleVersion => {
    const shared = (window as any).__WECOG_STATE__;
    const { startGazeTestsAnalysisLoop, isGazeTestsAnalysisLoopRunning } = await import(new URL(
      `js/gaze-tracker/gaze-tests/common/analysis-loop.js?v=${moduleVersion}`, location.href).href);
    const video = document.getElementById('precheckVideo') as HTMLVideoElement;
    Object.defineProperties(video, { srcObject: { configurable: true, writable: true, value: {} },
      readyState: { configurable: true, value: 4 }, currentTime: { configurable: true, value: 1 } });
    let analyses = 0, release: (value: any) => void = () => {}, seen: () => void = () => {};
    const called = new Promise<void>(resolve => { seen = resolve; });
    shared.runtime.localAnalyzer = { reset() {}, dispose() {}, analyzeFrame() {
      analyses++; seen(); return new Promise(resolve => { release = resolve; });
    } };
    shared.runtime.lastPrecheckResult = { retained: true };
    startGazeTestsAnalysisLoop();
    await called;
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    release({ landmarks: [], unexpectedAfterExit: true });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    return { analyses, running: isGazeTestsAnalysisLoopRunning(), timer: shared.runtime.gazeTestsAnalysisInterval,
      last: shared.runtime.lastPrecheckResult };
  }, moduleVersion);
  expect(outcome).toEqual({ analyses: 1, running: false, timer: null, last: { retained: true } });
});

test('a snapshot failure still stops frame, audio, multimodal and RT resources exactly once', async ({ page }) => {
  await mockInvitation(page);
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  const outcome = await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    const runtime = shared.runtime.sessionRuntime;
    const calls: string[] = [];
    runtime.getBpmSnapshot = () => { throw new Error('synthetic snapshot failure'); };
    runtime.framePipeline = { stop() { calls.push('frame'); return { reason: 'page_exit', sampleCount: 2 }; } };
    runtime.audioCollector = { async stop() { calls.push('audio'); } };
    runtime.multimodalCollector = { stop() { calls.push('multimodal'); } };
    runtime._removeRtListeners = () => { calls.push('rt'); };
    const outcomes = await Promise.allSettled([runtime.stopContinuousModules('page_exit'), runtime.stopContinuousModules('page_exit')]);
    // Restore this method so pagehide checkpoint cleanup can run safely.
    runtime.getBpmSnapshot = () => ({ ready: false });
    return { calls, outcomes: outcomes.map(value => value.status), runs: shared.sessionData.bpmRuns?.length,
      statuses: [...new Set(Object.values(runtime.moduleStatus))] };
  });
  expect(outcome).toEqual({ calls: ['rt', 'audio', 'frame', 'multimodal'], outcomes: ['rejected', 'rejected'], runs: 1, statuses: ['stopped'] });
});

test('real navigation away and Back restores registration with the same admitted session', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const admissions = await mockInvitation(page);
  await openConsent(page);
  await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  const ids = await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.sessionData.cognitiveResults = [{ blockId: 'retained-before-navigation', rt: 390 }];
    await shared.runtime.sessionRuntime.saveCheckpoint();
    return shared.sessionData.ids;
  });
  await page.goto(new URL('/apps/participant-web/tools/session-report.html', participant).href);
  await page.goBack();
  await page.waitForFunction(() => {
    const shared = (window as any).__WECOG_STATE__;
    return shared?.runtime?.participantShellReady && !shared.runtime.participantPageExited;
  });
  await expect(page.locator('#step3')).toHaveClass(/active/);
  const restored = await page.evaluate(() => {
    const shared = (window as any).__WECOG_STATE__;
    return { ids: shared.sessionData.ids, results: shared.sessionData.cognitiveResults };
  });
  expect(restored).toEqual({ ids, results: [{ blockId: 'retained-before-navigation', rt: 390 }] });
  expect(admissions()).toBe(1);
  expect(errors).toEqual([]);
});

for (const failure of ['calibration', 'continuation', 'legacy-shell'] as const) {
  test(`${failure} failure offers recovery and JSON without finalising or erasing accepted results`, async ({ page }) => {
    const errors: string[] = [];
    const marker = 'SYNTHETIC-PRIVATE-MODEL-FAILURE';
    let uploads = 0;
    page.on('pageerror', error => errors.push(error.message));
    await mockInvitation(page);
    await page.route('**/ingest', route => { uploads++; return route.fulfill({ status: 500, json: {} }); });
    await page.goto(`${participant}?code=${code}`);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.evaluate(async ({ failure, marker, moduleVersion, code }) => {
      const w = window as any;
      w.setLanguage('en');
      const shared = w.__WECOG_STATE__;
      const runtime = shared.runtime.sessionRuntime;
      shared.sessionData.ids = { session: 'preparation-failure', participant: 'p', invitationCode: code };
      shared.sessionData.shellStep = 5;
      shared.sessionData.cognitiveResults = [{ blockId: 'accepted', rt: 410, correct: true }];
      // Deliberately unavailable storage must not turn recovery into a silent reload.
      runtime.saveCheckpoint = async () => false;
      w.__preparationTrackStops = 0;
      shared.runtime.cameraStream = { getTracks: () => [{ stop() { w.__preparationTrackStops++; } }] };
      if (failure === 'calibration') {
        w.nextStep(5);
        shared.sessionData.precheck = { pass_fail: true };
        runtime.isAnalysisRunning = () => true;
        let reject: (error: Error) => void = () => {};
        w.QCMetricsReady = new Promise((_resolve, no) => { reject = no; });
        const button = document.getElementById('startCalibBtn') as HTMLButtonElement;
        button.disabled = false;
        button.classList.remove('hidden');
        button.click();
        button.click();
        reject(new Error(marker));
      } else {
        runtime.startContinuousModules = async () => { throw new Error(marker); };
        if (failure === 'legacy-shell') {
          shared.runtime.invitationParticipantShell = { consent: true, questionnaire: true, precheck: false, calibration: false };
          w.nextStep(6);
        } else {
          const { continueInvitationSessionAfterShell } = await import(new URL(`js/web-page/tests-updated.js?v=${moduleVersion}`, location.href).href);
          await continueInvitationSessionAfterShell();
        }
      }
    }, { failure, marker, moduleVersion, code });
    const recovery = page.locator('#participantPageRecovery');
    await expect(recovery.getByRole('heading')).toHaveText('Measurement preparation failed');
    await recovery.getByRole('button', { name: 'Retry recovery' }).click();
    await expect(recovery.getByRole('button', { name: 'Retry recovery' })).toBeEnabled();
    await expect(recovery).not.toContainText(marker);
    const pending = page.waitForEvent('download');
    await recovery.getByRole('button', { name: 'Download available data' }).click();
    const path = await (await pending).path();
    if (!path) throw new Error('Download unavailable');
    const json = await readFile(path, 'utf8');
    const data = JSON.parse(json);
    expect(data.cognitiveResults).toEqual([{ blockId: 'accepted', rt: 410, correct: true }]);
    expect(data.ids.session).toBe('preparation-failure');
    expect(data.finalDelivery).toBeUndefined();
    expect(json).not.toContain(marker);
    const state = await page.evaluate(() => {
      const w = window as any;
      return { stops: w.__preparationTrackStops, recording: w.__WECOG_STATE__.flags.isRecording,
        failures: w.__WECOG_STATE__.sessionData.events.filter((e: any) => e.type === 'participant_preparation_failed').length };
    });
    expect(state).toEqual({ stops: 1, recording: false, failures: 1 });
    expect(uploads).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('explicit recovery after a preparation failure reloads the same session at camera check', async ({ page }) => {
  await mockInvitation(page);
  await openConsent(page);
  await page.locator('#consentBtn').click();
  await expect(page.locator('#step3')).toHaveClass(/active/);
  const ids = await page.evaluate(async moduleVersion => {
    const shared = (window as any).__WECOG_STATE__;
    (window as any).setLanguage('en');
    shared.sessionData.shellStep = 5;
    shared.sessionData.cognitiveResults = [{ blockId: 'accepted', rt: 450 }];
    shared.runtime.sessionRuntime.startContinuousModules = async () => { throw new Error('test preparation failure'); };
    const { continueInvitationSessionAfterShell } = await import(new URL(`js/web-page/tests-updated.js?v=${moduleVersion}`, location.href).href);
    await continueInvitationSessionAfterShell();
    return shared.sessionData.ids;
  }, moduleVersion);
  await page.locator('#participantPageRecovery').getByRole('button', { name: 'Retry recovery' }).click();
  await expect(page.locator('[data-session-modal-action]')).toBeVisible();
  await page.locator('[data-session-modal-action]').click();
  await expect(page.locator('#step5')).toHaveClass(/active/);
  const restored = await page.evaluate(() => {
    const shared = (window as any).__WECOG_STATE__;
    return { ids: shared.sessionData.ids, results: shared.sessionData.cognitiveResults, recording: shared.flags.isRecording };
  });
  expect(restored).toEqual({ ids, results: [{ blockId: 'accepted', rt: 450 }], recording: false });
});

test('a denied camera remains a recoverable precheck error without displaying private exception text', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockInvitation(page);
  await page.addInitScript(() => {
    (window as any).__deniedCameraCalls = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        (window as any).__deniedCameraCalls++;
        throw new DOMException('SYNTHETIC-PRIVATE-CAMERA', 'NotAllowedError');
      }
    } });
  });
  await page.goto(participant);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await page.evaluate(() => {
    (window as any).setLanguage('en');
    (window as any).nextStep(5);
  });
  await page.locator('#startPrecheckBtn').click();
  await expect.poll(() => page.evaluate(() => (window as any).__deniedCameraCalls)).toBe(1);
  await expect(page.locator('#startPrecheckBtn')).toBeVisible();
  await expect(page.locator('#statusMessage')).not.toBeEmpty();
  await expect(page.locator('#statusMessage')).toContainText('Allow camera access');
  await expect(page.locator('#statusMessage')).not.toContainText('SYNTHETIC-PRIVATE-CAMERA');
  await expect(page.locator('#participantPageRecovery')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('language has one owner and remains responsive before invitation startup completes', async ({ page }) => {
  await mockInvitation(page);
  let release = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/auth/me', async route => {
    await hold;
    return route.fulfill({ status: 401, json: {}, headers: {
      'Access-Control-Allow-Origin': new URL(participant).origin, 'Access-Control-Allow-Credentials': 'true' } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('emocog_participant_lang', 'ru');
    const original = Storage.prototype.setItem;
    (window as any).__languageWrites = [];
    Storage.prototype.setItem = function (key, value) {
      if (key === 'emocog_participant_lang') (window as any).__languageWrites.push(value);
      return original.call(this, key, value);
    };
  });
  await page.goto(participant, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  const before = await page.evaluate(() => (window as any).__languageWrites.length);
  try {
    await page.locator('#participantLanguageSelect').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await page.evaluate(() => (window as any).__languageWrites.slice(-1))).toEqual(['en']);
    expect(await page.evaluate(() => (window as any).__languageWrites.length)).toBe(before + 1);
    await page.locator('#participantLanguageSelect').selectOption('es');
    await page.waitForTimeout(1400);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    expect(await page.evaluate(() => (window as any).__languageWrites.length)).toBe(before + 2);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.participantShellReady)).not.toBe(true);
  } finally { release(); }
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

for (const fragment of ['#participant/%ZZ', '#/participant/%E0%A4%A', '#participant/a/b']) {
  test(`malformed legacy fragment ${fragment} cannot throw or admit a different invitation`, async ({ page }) => {
    const errors: string[] = [];
    let lookups = 0;
    page.on('pageerror', error => errors.push(error.message));
    await mockInvitation(page);
    page.on('request', request => { if (request.url().includes('/invitations/by-code/')) lookups++; });
    await page.goto(participant + fragment);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    expect(lookups).toBe(0);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.invitationCode)).toBeFalsy();
    await expect(page.locator('#btnStartIntro')).toBeVisible();
  });
}

test('a valid legacy fragment on the canonical document uses the shared invitation parser', async ({ page }) => {
  await mockInvitation(page);
  await page.goto(participant + '#/participant/%72ecovery-invitation');
  await expect(page).toHaveURL(participant + '?code=' + code);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.invitationCode)).toBe(code);
});
