import { test, expect } from '@playwright/test';
import { getPageUrl } from './helpers/testUtils';

test('English final results and validation headings stay English after live language changes', async ({ page }, testInfo) => {
  await page.goto(getPageUrl());
  await page.waitForFunction(() => typeof (window as any).setLanguage === 'function');
  await page.evaluate(() => {
    const state = (window as any).__WECOG_STATE__;
    state.sessionData.lifecycle = { status: 'completed' };
    state.sessionData.blinkSummary = { blinkCount: 8 };
    state.sessionData.perclosSummary = { windows: { '60s': { meanPct: 4 } } };
    state.sessionData.emotionSummary = { n: 10, valence_mean: 0.1, arousal_mean: 0.2 };
    state.sessionData.qcSummary = { overallPass: false, durationMs: 120000, gazeValidPct: 90, faceOkPct: 76.8,
      checks: { duration: true, faceVisible: true, faceOk: false, poseOk: true, illuminationOk: true,
        eyesOpen: true, occlusion: false, gazeValid: true, gazeOnScreen: true, lowFps: true } };
    (window as any).setLanguage('en');
    (window as any).nextStep(7);
  });
  await expect(page.locator('#finalQcSummary')).toContainText('Attention');
  await expect(page.locator('#finalQcSummary')).toContainText('Blinks');
  await expect(page.locator('#finalQcSummary')).toContainText('Valence');
  await expect(page.locator('#finalQcSummary')).toContainText('Arousal');
  await expect(page.locator('[data-i18n="label_aggregates_only"]')).toHaveText('Summary only (no raw arrays)');
  await expect(page.locator('#qcStatusBlock')).toContainText('Face image quality below threshold');
  expect(await page.locator('#validationResult .calibration-intro-kicker').textContent()).toBe('Accuracy check');
  expect(await page.locator('#step7').innerText()).not.toMatch(/[А-Яа-яЁё]/);
  await page.screenshot({ path: testInfo.outputPath('english-final-results.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => (window as any).setLanguage('ru'));
  await expect(page.locator('#finalQcSummary')).toContainText('Моргания');
  await page.evaluate(() => (window as any).setLanguage('en'));
  await expect(page.locator('#finalQcSummary')).toContainText('Blinks');
});

for (const format of ['full', 'aggregate']) {
  test(`researcher imports ${format} legacy exports with valid event category`, async ({ page }) => {
    let received: any;
    await page.route('**/ingest', async route => {
      received = route.request().postDataJSON();
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ qc_validity: 'invalid' }) });
    });
    await page.goto('http://127.0.0.1:4173/apps/web/researcher.html?analyticsPreview=1#/overview');
    await page.waitForFunction(() => !!(window as any).EmocogAnalyticsProduction?.importResultJson);
    const result = await page.evaluate(async format => {
      const completedAt = '2026-10-04T20:00:00.000Z';
      const source: any = {
        ids: { session: `S-IMPORT-${format}`, participant: 'P-IMPORT' },
        events: [{ schemaVersion: 'session_event.v1', eventId: 'legacy-language', type: 'interface_language_changed',
          category: 'session', severity: 'info', timestamp: 1000, tRelMs: 0, phase: null }],
        lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed',
          completedAt, finishAttemptId: `finish-${format}` },
        qcSummary: { overallPass: false, checks: { occlusion: false } },
      };
      if (format === 'aggregate') source.schemaVersion = 'session_feature.v1';
      else { source.user = { interfaceLanguage: 'en' }; source.eyeTracking = []; }
      (window as any).apiPost = async () => ({ id: 1 });
      const file = new File([JSON.stringify(source)], 'session.json', { type: 'application/json' });
      const imported = await (window as any).EmocogAnalyticsProduction.importResultJson(file, {
        query: { projectId: 1, protocolId: 1 }
      });
      return { sessionId: imported.sessionId, originalCategory: source.events[0].category };
    }, format);
    expect(result).toEqual({ sessionId: `S-IMPORT-${format}`, originalCategory: 'session' });
    expect(received.events[0].category).toBe('lifecycle');
    expect(received.events[0].eventId).toBe('legacy-language');
    expect(received.qcSummary.overallPass).toBe(false);
    expect(received.eyeTracking).toBeUndefined();
    expect(received.ids.invitationCode).toBeUndefined();
  });
}
