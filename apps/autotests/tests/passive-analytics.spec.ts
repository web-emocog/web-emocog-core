import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireApi = createRequire(path.resolve(__dirname, '../../api/package.json'));
const { buildSessionMetrics, buildGroupSummary } = requireApi('./analytics/metrics');
const { definitions } = requireApi('../shared/passive-metrics');
const base = 'http://127.0.0.1:4173/apps/web/researcher.html?analyticsPreview=1';
const query = { metricIds: definitions.map((item: any) => item.id), filters: { qcChannels: ['task', 'gaze'] } };
const measured = { id: 105, participant_id: 'synthetic', features_payload: {
  bpm_summary: { bpmMean: 80, validSampleCount: 30, methodVersion: 'continuous_signals.v2' },
  respiration_summary: { resp_rate_mean: 12, resp_sample_count: 20, resp_available: true },
  blink_summary: { blinkCount: 0, blinkRatePerMin: 0 },
  attentionMetrics: { sampleCounts: { eyeSignals: 1800 }, global: { eyeDurationMs: 60000 } },
  perclos_summary: { windows: { '60s': { meanPct: 0 } } },
  body_pose_summary: { enabled: true, validSampleCount: 300, retainedValidSampleCount: 40,
    movementVelocityMean: .1, movementVelocityP95: .3 },
  emotion_summary: { n: 50, valence_mean: 0, arousal_mean: .2 }
} };

for (const language of ['ru', 'en']) test(`session exposes real background metrics and preserves zero vs missing in ${language}`, async ({ page }) => {
  await page.goto(`${base}#/analytics/session-card`);
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  if (language === 'en') await page.locator('#langEn').click();
  await page.evaluate(metrics => {
    const api = (window as any).EmocogAnalyticsProduction, load = api.api.sessionSummary;
    api.api.sessionSummary = async (...args: any[]) => {
      const response = await load(...args); response.data.metrics = metrics; return response;
    };
  }, buildSessionMetrics(measured, query));
  await page.locator('#analyticsApplyFilters').click();
  const signals = page.locator('#analyticsPassiveSignals');
  await expect(signals.locator('[data-passive-metric]')).toHaveCount(9);
  await expect(signals.locator('[data-passive-metric="physiology.bpm_mean"]')).toContainText('80');
  await expect(signals.locator('[data-passive-metric="physiology.bpm_mean"]')).toContainText('continuous_signals.v2');
  await expect(signals.locator('[data-passive-metric="physiology.respiration_mean"]')).toContainText('12');
  await expect(signals.locator('[data-passive-metric="blink.count"]')).toContainText('0');
  const selected = await page.evaluate(() => {
    const api = (window as any).EmocogAnalyticsProduction; return api.buildAnalyticsQuery(api.store.state).metricIds;
  });
  expect(selected).toEqual(expect.arrayContaining(definitions.map((item: any) => item.id)));
  await page.evaluate(async metrics => {
    const api = (window as any).EmocogAnalyticsProduction, load = api.api.sessionSummary;
    api.api.sessionSummary = async (...args: any[]) => {
      const response = await load(...args); response.data.metrics = metrics; return response;
    };
    await api.store.loadSessionSummary();
  }, buildSessionMetrics({ ...measured, features_payload: {} }, query));
  await expect(signals.locator('[data-passive-metric="physiology.bpm_mean"]')).toContainText(language === 'en' ? 'No data' : 'Нет данных');
  await expect(signals.locator('[data-passive-metric="physiology.respiration_mean"]')).not.toContainText('>0<');
  await signals.locator('a').click();
  await expect(page).toHaveURL(/analytics\/connectedness/);
});

test('group background metrics give each participant equal weight, not each frame', async ({ page }) => {
  const second = structuredClone(measured); second.id = 106; second.participant_id = 'second';
  second.features_payload.bpm_summary.bpmMean = 100;
  second.features_payload.bpm_summary.validSampleCount = 10000;
  await page.goto(`${base}#/analytics/group-comparison`);
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.evaluate(metrics => {
    const api = (window as any).EmocogAnalyticsProduction, load = api.api.groupSummary;
    api.api.groupSummary = async (...args: any[]) => {
      const response = await load(...args); response.data.metrics = metrics; return response;
    };
  }, buildGroupSummary([measured, second], query).metrics);
  await page.locator('#analyticsApplyFilters').click();
  const pulse = page.locator('#analyticsPassiveSignals [data-passive-metric="physiology.bpm_mean"]');
  await expect(pulse).toContainText('90');
  await expect(pulse).toContainText('Участников: 2');
});

test('active physiology reaches the aggregate worker once, before and after finalization', async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto('http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.sessionRuntime);
  const result = await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__, runtime = shared.runtime.sessionRuntime;
    shared.sessionData.events = [
      { type: 'stimulus_on', timestamp: 1000, blockId: 'b', trialId: 't', response_mode: 'keyboard' },
      { type: 'response', timestamp: 1400, blockId: 'b', trialId: 't', responded: true, rtMs: 400 },
      { type: 'trial_end', timestamp: 1400, blockId: 'b', trialId: 't', qualityValid: true, correct: true }
    ];
    const samples = [{ t: 1100, bpm: 80, published: true, respRate: 12, respConf: .8 }];
    const collector = { finalized: false, samples };
    runtime.framePipeline = { bpm: collector, getBpmSnapshot: () => ({ ready: true,
      sampleCount: 1, validSampleCount: 1, bpmMean: 80, validRespSampleCount: 1, respRateMean: 12 }) };
    const interim = await runtime.delivery.build();
    shared.sessionData.bpmRuns = [{ samples }]; collector.finalized = true;
    const final = await runtime.delivery.build();
    return [interim, final].map(packet => ({
      bpm: packet.rt_alignment.trials[0].windows.response.channels.bpm,
      respiration: packet.rt_alignment.trials[0].windows.response.channels.respiration,
      rawSent: !!packet.bpmRuns || !!packet.eyeTracking || !!packet.continuousSignalState,
      mean: packet.bpm_summary.bpmMean
    }));
  });
  for (const packet of result) {
    expect(packet.bpm).toMatchObject({ value: 80, n: 1, nValid: 1 });
    expect(packet.respiration).toMatchObject({ value: 12, n: 1, nValid: 1 });
    expect(packet.rawSent).toBe(false);
    expect(packet.mean).toBe(80);
  }
});
