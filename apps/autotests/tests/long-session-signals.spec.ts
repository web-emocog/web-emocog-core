import { test, expect } from '@playwright/test';

const pageUrl = 'http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html';
const version = '20261025-1';

test('full-session heatmaps survive durable reload and reach the real aggregate worker', async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto(pageUrl);
  const before = await page.evaluate(async version => {
    const base = new URL('js/session-runtime/', location.href).href;
    const { appendGazeHistory, captureGazeHistory, buildSessionHeatmaps } = await import(`${base}gaze-history.mjs?v=${version}`);
    const { SessionCheckpointStore } = await import(`${base}checkpoint-store.mjs?v=${version}`);
    const session: any = { ids: { session: 'long-session-browser', participant: 'synthetic-only' },
      user: { interfaceLanguage: 'en' }, eyeTracking: [] };
    const runtime = {};
    for (let i = 0; i < 108000; i++) {
      const sample = { t: 1000000 + i * 1000 / 30, tRelMs: i * 1000 / 30, correctedX: 500, correctedY: 350,
        screenWidth: 1000, screenHeight: 700, valid: true, onScreen: true, confidence: .9,
        phase: 'cognitive_stimulus', blockId: 'main', attempt: 1, trialId: i < 54000 ? 'early' : 'late',
        stimulusId: 'std_simple_black_square', stimulusVersion: '1', stimulusType: 'image',
        stimulusRect: { left: 100, top: 50, width: 800, height: 600, intrinsicWidth: 800, intrinsicHeight: 600 } };
      appendGazeHistory(session, runtime, sample);
      if (i >= 106000) session.eyeTracking.push(sample);
    }
    captureGazeHistory(session, runtime);
    const map = buildSessionHeatmaps(session, runtime);
    const store = new SessionCheckpointStore();
    await store.save(session.ids.session, session, { state: 'running' });
    return { mode: store.lastPersistenceMode, samples: map.accumulation.summary.sampleCountTotal,
      early: map.perStimulus[0].sampleCountTotal, size: JSON.stringify(session.heatmapState).length };
  }, version);
  expect(before.mode).toBe('indexeddb');
  expect(before.samples).toBe(108000);
  expect(before.early).toBe(54000);
  expect(before.size).toBeLessThan(100000);
  await page.reload();
  const after = await page.evaluate(async version => {
    const base = new URL('js/session-runtime/', location.href).href;
    const { SessionCheckpointStore } = await import(`${base}checkpoint-store.mjs?v=${version}`);
    const { CheckpointBuilder } = await import(`${base}checkpoint-builder.mjs?v=${version}`);
    const { buildSessionHeatmaps } = await import(`${base}gaze-history.mjs?v=${version}`);
    const store = new SessionCheckpointStore();
    const saved = await store.load('long-session-browser');
    const source = saved.sessionData;
    const map = buildSessionHeatmaps(source, {});
    const packet = await new CheckpointBuilder().build(source);
    await store.clear('long-session-browser');
    return { samples: map.accumulation.summary.sampleCountTotal, first: map.perStimulus[0].trialId,
      packetSamples: packet.gaze_analytics?.summary?.sampleCountTotal,
      presentations: packet.gaze_analytics?.presentations?.length, rawSent: !!packet.eyeTracking || !!packet.heatmapState };
  }, version);
  expect(after).toEqual({ samples: 108000, first: 'early', packetSamples: 108000, presentations: 2, rawSent: false });
});

test('compact fallback retains full heatmaps even when raw series cannot be retained', async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto(pageUrl);
  const result = await page.evaluate(async version => {
    const base = new URL('js/session-runtime/', location.href).href;
    const { SessionCheckpointStore } = await import(`${base}checkpoint-store.mjs?v=${version}`);
    const { createHeatmapAccumulator } = await import(new URL(`js/web-page/heatmap.js?v=${version}`, location.href).href);
    const acc = createHeatmapAccumulator({ gridWidth: 4, gridHeight: 4 });
    for (let i = 0; i < 100; i++) acc.add({ t: 1000 + 33 * i, x: 100, y: 100,
      screenWidth: 1000, screenHeight: 700, onScreen: true, valid: true });
    const store = new SessionCheckpointStore({ indexedDB: null });
    await store.save('compact-long', { ids: { session: 'compact-long' }, heatmapState: acc.snapshot(), eyeTracking: [] }, { state: 'running' });
    const saved = await new SessionCheckpointStore({ indexedDB: null }).load('compact-long');
    await store.clear('compact-long');
    return { count: saved.sessionData.heatmapState.summary.sampleCountTotal, mode: store.lastPersistenceMode };
  }, version);
  expect(result.count).toBe(100);
});
