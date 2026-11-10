import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
});

for (const existing of [false, true]) {
  test(`builder preserves the selected profile and body option (${existing ? 'existing publication' : 'new protocol'})`, async ({ page, baseURL }) => {
    await page.goto(baseURL + '/apps/web/researcher.html?analyticsPreview=1#/overview');
    await page.evaluate(existing => {
      const w = window as any;
      if (existing) localStorage.setItem('emocog_my_experiments', JSON.stringify([{
        id: 'legacy-profile', title: 'Legacy', updatedAt: '2026-11-01T00:00:00Z', blocks: [], savedStep: 6,
        metadata: { title: 'Legacy', protocolId: 'legacy-profile' }
      }]));
      document.body.appendChild(w.ExperimentBuilderView({ startStep: 6,
        ...(existing ? { experimentId: 'legacy-profile' } : {}) }));
    }, existing);
    const profile = page.locator('#protocolSignalProfile');
    await expect(profile).toHaveValue(existing ? 'protocol_signals.v1' : 'protocol_signals.v2');
    const body = page.locator('.session-feature[data-key="bodyMovement"]');
    if (existing) await expect(body).toBeChecked();
    else await expect(body).not.toBeChecked();
    await profile.selectOption('protocol_signals.v2');
    await body.check();
    await page.locator('#saveDraftGlobalBtn').click();
    await expect.poll(() => page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('emocog_my_experiments') || '[]');
      return saved.find((row: any) => row.signalProfileId === 'protocol_signals.v2')?.sessionFeatureFlags.bodyMovement;
    })).toBe(true);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_my_experiments') || '[]')
      .find((row: any) => row.signalProfileId === 'protocol_signals.v2'));
    await page.reload();
    await page.evaluate(id => document.body.appendChild((window as any).ExperimentBuilderView({ experimentId: id, startStep: 6 })), saved.id);
    await expect(profile).toHaveValue('protocol_signals.v2');
    await expect(body).toBeChecked();
  });
}

test('neutral preparation is single-flight, expires without video, and can be skipped without inventing an estimate', async ({ page, baseURL }) => {
  await page.goto(baseURL + '/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.clock.install();
  await page.evaluate(async () => {
    const root = location.origin + '/apps/participant-web/js/';
    const { prepareNeutralCalibration } = await import(root + 'session-runtime/neutral-calibration-ui.js');
    const { NeutralCalibration } = await import(root + 'emotion/neutral-calibration.mjs');
    const { resolveSignalProfile } = await import(root + 'session-runtime/protocol-profile.mjs');
    const policy = resolveSignalProfile({ signalProfileId: 'protocol_signals.v2' }).emotionCalibration;
    const w = window as any;
    w.syntheticPipeline = { neutralCalibration: new NeutralCalibration(policy), isRunning: () => true,
      state: { runtime: {}, sessionData: { tech: {} } } };
    void prepareNeutralCalibration(w.syntheticPipeline, 'en').then(value => { w.preparationResult = value; });
    void prepareNeutralCalibration(w.syntheticPipeline, 'en');
  });
  await expect(page.locator('#emotionNeutralCalibration')).toHaveCount(1);
  await page.locator('#emotionNeutralStart').click();
  await page.clock.runFor(31000);
  await expect(page.locator('#emotionNeutralProgress')).toContainText('Not enough usable measurements');
  await expect(page.locator('#emotionNeutralStart')).toBeEnabled();
  await page.locator('#emotionNeutralSkip').click();
  await expect(page.locator('#emotionNeutralCalibration')).toHaveCount(0);
  const result = await page.evaluate(() => {
    const w = window as any;
    return { result: w.preparationResult, calibration: w.syntheticPipeline.state.sessionData.tech.emotionCalibration };
  });
  expect(result.result).toBe(true);
  expect(result.calibration).toMatchObject({ status: 'skipped', acceptedSamples: 0 });
  expect(JSON.stringify(result)).not.toMatch(/landmarks|valence|baseline/);
});

test('neutral preparation closes on pagehide and permits a fresh attempt without retaining a dialog', async ({ page, baseURL }) => {
  await page.goto(baseURL + '/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.evaluate(async () => {
    const root = location.origin + '/apps/participant-web/js/';
    const { prepareNeutralCalibration } = await import(root + 'session-runtime/neutral-calibration-ui.js');
    const { NeutralCalibration } = await import(root + 'emotion/neutral-calibration.mjs');
    const { resolveSignalProfile } = await import(root + 'session-runtime/protocol-profile.mjs');
    const w = window as any;
    w.pipeline = { neutralCalibration: new NeutralCalibration(resolveSignalProfile({ signalProfileId: 'protocol_signals.v2' }).emotionCalibration),
      state: { runtime: {}, sessionData: { tech: {} } }, isRunning: () => true };
    w.prepare = prepareNeutralCalibration;
    void w.prepare(w.pipeline, 'ru').then(result => { w.result = result; });
  });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(page.locator('#emotionNeutralCalibration')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).result)).toBe(false);
  await page.evaluate(() => { void (window as any).prepare((window as any).pipeline, 'ru'); });
  await expect(page.locator('#emotionNeutralCalibration')).toHaveCount(1);
  await page.locator('#emotionNeutralSkip').click();
});

test('the actual v2 precheck accepts intermittent failures but rejects stale video and a missing face', async ({ page, baseURL }) => {
  await page.goto(baseURL + '/apps/participant-web/mvp_with_precheck_1-updated.html');
  const result = await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    const { checkAllIndicators } = await import(location.origin + '/apps/participant-web/js/web-page/precheck-updated.js?v=20261109-issues2');
    shared.runtime.invitationProtocolDefinition = { settings: { signalProfileId: 'protocol_signals.v2' } };
    let now = 10000;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
    shared.indicatorsStatus = { illumination: 'passed', face: 'passed', pose: 'passed', visibility: 'passed' };
    for (let i = 0; i < 10; i++) {
      now = 10000 + i * 300;
      shared.runtime.precheckData = { timestamp: now, sourceVideoTime: i / 3,
        face: { detected: true, bbox: { x: .3, y: .3, width: .2, height: .3 } },
        pose: { status: 'stable', yaw: 0, pitch: 0, roll: 0 } };
      shared.indicatorsStatus.visibility = [3, 6].includes(i) ? 'failed' : 'passed';
      checkAllIndicators();
    }
    const passed = shared.sessionData.precheck;
    now += 1400; checkAllIndicators();
    const stale = shared.sessionData.precheck;
    shared.runtime.precheckData.face.detected = false;
    shared.runtime.precheckData.timestamp = now;
    shared.runtime.precheckData.sourceVideoTime = 100;
    checkAllIndicators();
    return { passed, stale, missing: shared.sessionData.precheck };
  });
  expect(result.passed).toMatchObject({ pass_fail: true, signalProfileId: 'protocol_signals.v2', gate: { successes: 8 } });
  expect(result.stale.pass_fail).toBe(false);
  expect(result.missing).toMatchObject({ pass_fail: false, gate: { samples: 0 } });
});

for (const profile of ['protocol_signals.v1', 'protocol_signals.v2']) {
  for (const lang of ['ru', 'en']) {
    for (const source of ['face', 'segment']) {
      test(`${profile} ${lang} ${source}: technical failure cannot pass with stale green indicators`, async ({ page, baseURL }) => {
        await page.goto(baseURL + '/apps/participant-web/mvp_with_precheck_1-updated.html');
        const result = await page.evaluate(async ({ profile, lang, source }) => {
          const w = window as any, shared = w.__WECOG_STATE__;
          w.setLanguage(lang);
          const { checkAllIndicators } = await import(location.origin + '/apps/participant-web/js/web-page/precheck-updated.js?v=20261109-issues2');
          shared.runtime.invitationProtocolDefinition = { settings: { signalProfileId: profile } };
          shared.runtime.successFrames = 20;
          shared.indicatorsStatus = { illumination: 'passed', face: 'passed', pose: 'passed', visibility: 'passed' };
          shared.runtime.precheckData = { error: source === 'face' ? 'face_model_unavailable' : null,
            visibility: { error: source === 'segment' }, timestamp: performance.now(), face: { detected: source === 'segment' } };
          checkAllIndicators();
          return { precheck: shared.sessionData.precheck, disabled: (document.getElementById('startCalibBtn') as HTMLButtonElement).disabled,
            message: document.getElementById('statusMessage')!.textContent };
        }, { profile, lang, source });
        expect(result.precheck).toMatchObject({ pass_fail: false, fail_reason: 'technical_analysis_failed' });
        expect(result.disabled).toBe(true);
        expect(result.message).toContain(lang === 'ru' ? 'техническая ошибка' : 'technical failure');
      });
    }
  }
}

for (const lang of ['ru', 'en']) {
  test(`${lang}: analyzer failure shows localized technical text instead of a raw backend code`, async ({ page, baseURL }) => {
    await page.goto(baseURL + '/apps/participant-web/mvp_with_precheck_1-updated.html');
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime?.ui));
    await page.evaluate(async lang => {
      const w = window as any;
      w.setLanguage(lang);
      const ui = w.__WECOG_STATE__.runtime.sessionRuntime.ui;
      ui.showIssue({ kind: 'technical', code: 'frame_analysis_failed', message: 'face_inference_failed' }, true);
    }, lang);
    const alert = page.locator('#wecog-session-alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText('face_inference_failed');
    await expect(alert).toContainText(lang === 'ru' ? 'техническая ошибка' : 'technical analysis error');
  });
}
