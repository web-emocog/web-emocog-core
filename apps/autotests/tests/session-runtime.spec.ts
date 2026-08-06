import { test, expect } from '@playwright/test';
import { getPageUrl } from './helpers/testUtils';

const PAGE_URL = getPageUrl();

test.describe('Participant session runtime', () => {
  test('admits after consent, removes invitation from URL, and reloads the admitted session', async ({ page }) => {
    const invitationCode = 'INV-ADMISSION-E2E';
    const lookups: string[] = [];
    let tokenRequests = 0;
    await page.route('**/api/invitations/by-code/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.endsWith('/ingest-token')) {
        tokenRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ token: 'participant-ingest-token', admitted: true }),
        });
        return;
      }
      if (url.pathname.endsWith(`/by-code/${invitationCode}`)) {
        lookups.push(url.search);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            invitation_id: 1,
            code: invitationCode,
            protocol_id: 1,
            project_id: 1,
            protocol_name: 'Admission E2E',
            definition: {
              participantShell: {
                consent: true,
                questionnaire: false,
                precheck: true,
                calibration: false,
              },
              blocks: [],
            },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`${PAGE_URL}?code=${invitationCode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.invitationProtocolDefinition));
    await page.locator('#btnStartIntro').click();
    await page.locator('#consentCheck').check();
    await page.locator('#consentBtn').click();

    await expect.poll(() => tokenRequests).toBe(1);
    await expect(page).not.toHaveURL(/(?:\?|&)code=/);
    const admittedSessionId = await page.evaluate(
      () => (window as any).__WECOG_STATE__.sessionData.ids.session
    );
    expect(admittedSessionId).toBeTruthy();

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.invitationProtocolDefinition));
    expect(lookups.some(search => (
      new URLSearchParams(search).get('session_id') === admittedSessionId
    ))).toBe(true);
    await expect(page).not.toHaveURL(/(?:\?|&)code=/);
  });

  test('pause is available only during instructions and resumes by button', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));

    await page.evaluate(() => {
      (window as any).__WECOG_STATE__.runtime.sessionRuntime.enterInstruction({
        source: 'playwright-test',
      });
    });
    const pause = page.locator('#wecog-session-pause');
    await expect(pause).toBeVisible();
    await pause.click();
    await expect(page.locator('#wecog-session-modal')).toBeVisible();

    await page.locator('[data-session-modal-action]').click();
    await expect(page.locator('#wecog-session-modal')).not.toBeVisible();

    const pauseRejected = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.beginBlock({ blockId: 'browser-rt', blockType: 'rt' });
      return runtime.pause();
    });
    expect(pauseRejected.accepted).toBe(false);
    await expect(pause).not.toBeVisible();
  });

  test('quality error marks the current block for repeat', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));

    const decision = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.enterInstruction({ source: 'playwright-test' });
      runtime.beginBlock({ blockId: 'browser-vpc', blockType: 'vpc' });
      runtime.reportIssue({
        kind: 'quality',
        code: 'low_light_test',
        message: 'Недостаточно света',
      });
      return runtime.completeBlock({ success: true });
    });
    expect(decision.repeatRequired).toBe(true);
    await expect(page.locator('#wecog-session-alert')).toContainText('повтор');
  });

  test('explains and repeats only invalid cognitive trials', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    const decision = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.enterInstruction({ source: 'partial-repeat-test' });
      runtime.beginBlock({ blockId: 'rt-partial-browser', blockType: 'cognitive_task' });
      runtime.reportIssue({
        kind: 'quality',
        code: 'low_light',
        message: 'Освещение недостаточно',
      });
      runtime.resolveIssue('low_light');
      return runtime.completeBlock({
        success: true,
        repeatItems: [
          { id: 'trial-2', issueCodes: ['low_light'] },
          { id: 'trial-6', issueCodes: ['low_light'] },
          { id: 'trial-9', issueCodes: ['low_light'] },
        ],
        totalItemCount: 10,
      });
    });
    expect(decision.repeatRequired).toBe(true);
    await expect(page.locator('#wecog-session-alert')).toContainText(
      'Текущая проба будет повторена'
    );

    await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      (window as any).__partialRepeatPrompt = runtime.promptRepeat(
        'rt-partial-browser'
      );
    });
    await expect(page.locator('#wecog-session-modal')).toBeVisible();
    await expect(page.locator('[data-session-modal-body]')).toContainText(
      'Не засчитано 3 пробы из 10'
    );
    await expect(page.locator('[data-session-modal-body]')).toContainText(
      'Освещение недостаточно'
    );
    await expect(page.locator('[data-session-modal-note]')).not.toBeVisible();
    await page.locator('[data-session-modal-action]').click();
    await page.evaluate(() => (window as any).__partialRepeatPrompt);
  });

  test('reload restores the session and invalidates only the interrupted block', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      const runtime = shared.runtime.sessionRuntime;
      shared.sessionData.ids.session = 'S-PLAYWRIGHT-RELOAD';
      shared.sessionData.eyeTracking.push(
        { t: 1000, correctedX: 100, correctedY: 120, valid: true },
      );
      shared.sessionData.eyeSignals.push(
        { t: 1000, earAvg: 0.3, bothOpen: true },
      );
      await runtime.saveCheckpoint();
      shared.sessionData.eyeTracking.push(
        { t: 1033, correctedX: 102, correctedY: 121, valid: true },
      );
      shared.sessionData.eyeSignals.push(
        { t: 1033, earAvg: 0.1, bothOpen: false },
      );
      runtime.enterInstruction({ source: 'reload-test' });
      runtime.beginBlock({ blockId: 'reload-vpc', blockType: 'vpc' });
      await runtime.saveCheckpoint();
    });

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => {
      const runtime = (window as any).__WECOG_STATE__?.runtime?.sessionRuntime;
      return runtime?.machine?.activeIssues
        && [...runtime.machine.activeIssues.values()]
          .some((issue: any) => issue.code === 'page_reloaded');
    });
    const restored = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return runtime.machine.snapshot();
    });
    expect(restored.currentBlock).toBeNull();
    expect(restored.repeatQueue).toHaveLength(1);
    expect(restored.repeatQueue[0].blockId).toBe('reload-vpc');
    expect(restored.blockAttempts['reload-vpc']).toBe(1);
    const restoredSamples = await page.evaluate(() => {
      const shared = (window as any).__WECOG_STATE__;
      return {
        gaze: shared.sessionData.eyeTracking,
        eyes: shared.sessionData.eyeSignals,
      };
    });
    expect(restoredSamples.gaze).toHaveLength(2);
    expect(restoredSamples.eyes).toHaveLength(2);
    expect(restoredSamples.gaze[1].correctedX).toBe(102);
    expect(restoredSamples.eyes[1].bothOpen).toBe(false);
    await expect(page.locator('#wecog-session-modal')).toBeVisible();
    await page.locator('[data-session-modal-action]').click();
    await expect(page.locator('#step5')).toHaveClass(/active/);
    await page.waitForFunction(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return ![...runtime.machine.activeIssues.values()]
        .some((issue: any) => issue.code === 'page_reloaded');
    });
  });

  test('offline is recoverable and does not invalidate a locally recorded block', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.enterInstruction({ source: 'offline-test' });
      runtime.beginBlock({ blockId: 'offline-rt', blockType: 'rt' });
    });
    await page.context().setOffline(true);
    await page.waitForFunction(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return [...runtime.machine.activeIssues.values()]
        .some((issue: any) => issue.code === 'network_offline');
    });
    const whileOffline = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return {
        block: runtime.getCurrentBlock(),
        issue: [...runtime.machine.activeIssues.values()]
          .find((item: any) => item.code === 'network_offline'),
      };
    });
    expect(whileOffline.issue.invalidatesBlock).toBe(false);
    expect(whileOffline.block.invalid).toBe(false);

    await page.context().setOffline(false);
    await page.waitForFunction(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      return ![...runtime.machine.activeIssues.values()]
        .some((issue: any) => issue.code === 'network_offline');
    });
  });

  test('technical module failure invalidates and repeats the affected block', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    const decision = await page.evaluate(() => {
      const runtime = (window as any).__WECOG_STATE__.runtime.sessionRuntime;
      runtime.enterInstruction({ source: 'module-error-test' });
      runtime.beginBlock({ blockId: 'module-tracking', blockType: 'tracking' });
      runtime.reportIssue({
        kind: 'technical',
        code: 'tracking_module_failed',
        message: 'Tracking module failed',
        recoverable: false,
      });
      return runtime.completeBlock({ success: false, reason: 'tracking_module_failed' });
    });
    expect(decision.repeatRequired).toBe(true);
    expect(decision.block.blockId).toBe('module-tracking');
    expect(decision.block.issueIds.length).toBe(1);
  });

  test('blink dynamics and PERCLOS use the whole measured session', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const metrics = await page.evaluate(async () => {
      const url = new URL(
        'js/gaze-tracker/attention-metrics.js',
        window.location.href,
      ).href;
      const { buildAttentionMetrics } = await import(url);
      const eyeSignals = [];
      for (let t = 0; t <= 3300; t += 33) {
        const firstBlink = t >= 900 && t <= 1080;
        const secondBlink = t >= 2100 && t <= 2280;
        const closed = firstBlink || secondBlink;
        eyeSignals.push({
          t: 1_000_000 + t,
          phase: t < 1700 ? 'calibration' : 'tracking_test',
          leftEAR: closed ? 0.09 : 0.3,
          rightEAR: closed ? 0.09 : 0.3,
          earAvg: closed ? 0.09 : 0.3,
          bothOpen: !closed,
        });
      }
      return buildAttentionMetrics({ eyeSignals, eyeTracking: [] });
    });
    expect(metrics.scope).toBe('whole_measured_session');
    expect(metrics.global.blinkDynamics.blinkCount).toBe(2);
    expect(metrics.postCalibration.blinkDynamics.blinkCount).toBe(1);
    expect(metrics.global.blinkDynamics.durationMs.mean).toBeGreaterThan(70);
    expect(metrics.global.blinkDynamics.amplitude.mean).toBeGreaterThan(0.4);
    expect(metrics.global.blinkDynamics.openingSpeed.mean).toBeGreaterThan(0);
    expect(metrics.global.perclos.windows['30s']).toBeTruthy();
  });

  test('emotion summary remains session-wide when raw samples are trimmed', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    const summary = await page.evaluate(async () => {
      const url = new URL('js/emotion/public-api.js', window.location.href).href;
      const { appendEmotionSample, getEmotionSummary } = await import(url);
      const localState: any = {
        sessionData: {
          startTime: 1000,
          emotionSamples: [],
          emotionAccumulator: null,
        },
      };
      for (let i = 0; i < 10; i++) {
        appendEmotionSample(localState, {
          valence: i / 10,
          arousal: 0.5,
          dominant: 'neutral',
        }, 1000 + i * 100);
      }
      localState.sessionData.emotionSamples = [];
      return getEmotionSummary(localState.sessionData);
    });
    expect(summary.n).toBe(10);
    expect(summary.valence_mean).toBeCloseTo(0.45, 4);
    expect(summary.arousal_mean).toBe(0.5);
  });

  test('terminal checkpoint cannot be overwritten by an in-flight periodic save', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    const states = await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      const runtime = shared.runtime.sessionRuntime;
      shared.sessionData.ids.session = 'S-PLAYWRIGHT-CHECKPOINT-RACE';
      await runtime.saveCheckpoint();

      const writes: string[] = [];
      let releaseFirstWrite: () => void = () => {};
      const firstWriteGate = new Promise<void>(resolve => {
        releaseFirstWrite = resolve;
      });
      let firstWrite = true;
      runtime.checkpoints.save = async (
        _sessionId: string,
        _sessionData: unknown,
        snapshot: { state: string },
      ) => {
        writes.push(snapshot.state);
        if (firstWrite) {
          firstWrite = false;
          await firstWriteGate;
        }
        return true;
      };

      runtime.enterInstruction({ source: 'checkpoint-race-test' });
      await new Promise(resolve => setTimeout(resolve, 0));
      const finish = runtime.beginFinish();
      const completion = runtime.completeFinish(
        { source: 'checkpoint-race-test' },
        { clearCheckpoint: false },
      );
      releaseFirstWrite();
      await completion;
      return { writes, finishAccepted: finish.accepted, machine: runtime.machine.state };
    });

    expect(states.finishAccepted).toBe(true);
    expect(states.machine).toBe('completed');
    expect(states.writes.at(-1)).toBe('completed');
    expect(states.writes.slice(states.writes.lastIndexOf('completed') + 1)).toHaveLength(0);
  });

  test('finish stops camera and retries final ingest idempotently', async ({ page }) => {
    const idempotencyKeys: string[] = [];
    let ingestCalls = 0;
    await page.route('**/api/invitations/by-code/FINISH-TEST/ingest-token', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'participant-ingest-token' }),
      });
    });
    await page.route('**/api/ingest', async route => {
      ingestCalls += 1;
      idempotencyKeys.push(route.request().headers()['idempotency-key'] || '');
      await route.fulfill({
        status: ingestCalls === 1 ? 400 : 200,
        contentType: 'application/json',
        body: JSON.stringify(
          ingestCalls === 1
            ? { error: 'synthetic first-attempt rejection' }
            : { ok: true },
        ),
      });
    });

    await page.goto(PAGE_URL, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));

    const result = await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.sessionData.ids.session = 'S-PLAYWRIGHT-FINISH';
      shared.sessionData.ids.participant = 'P-PLAYWRIGHT-FINISH';
      shared.sessionData.ids.invitationCode = 'FINISH-TEST';
      (window as any).__cameraTrackStops = 0;
      shared.runtime.cameraStream = {
        getTracks: () => [{
          stop: () => {
            (window as any).__cameraTrackStops += 1;
          },
        }],
      };

      // Resolved by the browser from the application origin, not the TS project.
      const { finishSession } = await import(
        // @ts-expect-error The production JS module intentionally has no .d.ts file.
        '/apps/participant-web/js/web-page/tests-updated.js'
      );
      const first = await finishSession();
      const firstFinishAttemptId = shared.sessionData.lifecycle.finishAttemptId;
      const second = await finishSession();
      const third = await finishSession();
      const runtime = shared.runtime.sessionRuntime;
      return {
        first,
        second,
        third,
        firstFinishAttemptId,
        finalFinishAttemptId: shared.sessionData.lifecycle.finishAttemptId,
        lifecycleState: runtime.machine.state,
        cameraTrackStops: (window as any).__cameraTrackStops,
        cameraStreamCleared: shared.runtime.cameraStream === null,
        moduleStatuses: runtime.moduleStatus,
      };
    });

    expect(result.first.ok).toBe(false);
    expect(result.second.ok).toBe(true);
    expect(result.third.ok).toBe(true);
    expect(result.third.idempotent).toBe(true);
    expect(result.lifecycleState).toBe('completed');
    expect(result.cameraTrackStops).toBe(1);
    expect(result.cameraStreamCleared).toBe(true);
    expect(Object.values(result.moduleStatuses)).toEqual([
      'stopped',
      'stopped',
      'stopped',
      'stopped',
      'stopped',
      'stopped',
    ]);
    expect(ingestCalls).toBe(2);
    expect(idempotencyKeys[0]).toBeTruthy();
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(result.finalFinishAttemptId).toBe(result.firstFinishAttemptId);
    await expect(page.locator('#step7')).toHaveClass(/active/);
  });
});
