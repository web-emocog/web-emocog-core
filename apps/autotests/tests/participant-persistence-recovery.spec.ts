import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ingestAcknowledgement } from './helpers/ingestAcknowledgement';

const participant = 'http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html';
const moduleVersion = '20261025-1';
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
    const headers = { 'Access-Control-Allow-Origin': '*' };
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
    const { appendGazeSample } = await import(new URL(`js/web-page/app-updated.js?v=${moduleVersion}`, location.href).href);
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
  let accept = false;
  const uploads: Array<{ key: string | undefined; payload: any }> = [];
  await page.route('**/ingest', route => {
    uploads.push({ key: route.request().headers()['idempotency-key'], payload: route.request().postDataJSON() });
    return route.fulfill({ status: accept ? 200 : 403, json: accept ? ingestAcknowledgement(route.request(), { qc_validity: 'valid' }) : { error: 'Temporarily rejected' },
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
    shared.currentLang = 'en';
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
