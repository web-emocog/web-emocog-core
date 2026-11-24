import { test, expect } from '@playwright/test';
import { getPageUrl } from './helpers/testUtils';

// runFor executes every scheduled observation over the full 270-second oracle.
test.describe.configure({ timeout: 60_000 });

for (const exhausted of [false, true]) {
  test(`static passive valid-time uses the actual runner, 180s target, exhausted=${exhausted}`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-22T12:00:00Z') });
    await page.goto(getPageUrl(), { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      shared.sessionData.startTime = Date.now();
      const { loadAndStartCognitiveTask } = await import(new URL(
        'js/web-page/experimental_task-updated.js?v=20261124-load2', location.href).href);
      await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: {
        version: 'v2.0-valid-time-test', blocks: [{ id: 'rest-static', type: 'passive',
          content: { useFixation: false, slideDuration: 180000,
            validTime: { schemaVersion: 'passive_valid_time.v1', enabled: true, maxExtensionRatio: .5, minSegmentMs: 1000 },
            trials: [{ stimulusId: 'std_simple_black_square', duration: 180000 }] } }] } });
    });
    await page.locator('#cogStartBtn').click();
    await page.clock.runFor(100);
    await page.evaluate(exhausted => {
      const shared = (window as any).__WECOG_STATE__;
      if (!shared.runtime.validTimeTrial) throw new Error('Real runner did not start valid-time policy');
      // Timer/QC flow oracle only, not camera FPS or gaze accuracy evidence.
      (window as any).__validTimeOracle = setInterval(() => {
        const tracker = shared.runtime.validTimeTrial;
        if (!tracker) return;
        const relative = performance.now() - tracker.startMs;
        tracker.observe(performance.now(), exhausted || relative >= 60000 && relative < 65000 ? ['protocol_qc_fpsStable'] : []);
      }, 50);
    }, exhausted);
    await page.keyboard.press('Space');
    await page.clock.runFor(30000);
    const partial = await page.evaluate(() => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.captureValidTimeTrial();
      return shared.sessionData.cognitiveResults[0];
    });
    expect(partial.qualityValid).toBe(false);
    expect(partial.validTime.actualMs).toBeGreaterThanOrEqual(30000);
    expect(partial.validTime.acceptedMs).toBe(exhausted ? 0 : partial.validTime.actualMs - 150);
    await page.clock.runFor(exhausted ? 240100 : 155500);
    const result = await page.evaluate(() => {
      clearInterval((window as any).__validTimeOracle);
      const shared = (window as any).__WECOG_STATE__;
      return { results: shared.sessionData.cognitiveResults,
        repeatRequired: shared.sessionData.events.some((event: any) => event.type === 'block_repeat_required'),
        active: !!shared.runtime.validTimeTrial, overlay: (window as any).qcPauseOverlay?.isVisible() };
    });
    expect(result.results).toHaveLength(1);
    expect(result.active).toBe(false);
    expect(result.results[0].qualityValid).toBe(!exhausted);
    expect(result.results[0].rt).toBeNull();
    expect(result.results[0].response).toBeNull();
    expect(result.results[0].validTime.limitReached).toBe(exhausted);
    expect(result.results[0].validTime.actualMs).toBeLessThanOrEqual(270000);
    if (exhausted) expect(result.results[0].validTime.acceptedMs).toBe(0);
    else {
      expect(result.results[0].validTime.acceptedMs).toBeGreaterThanOrEqual(180000);
      expect(result.results[0].validTime.acceptedMs).toBeLessThan(180100);
    }
    expect(result.repeatRequired).toBe(exhausted);
    expect(result.overlay).not.toBe(true);
  });
}

test('leaving an extended passive trial retains a partial failed attempt, not a completed result', async ({ page }) => {
  await page.goto(getPageUrl(), { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    shared.runtime.sessionRuntime.policyShown = true;
    const { loadAndStartCognitiveTask } = await import(new URL(
      'js/web-page/experimental_task-updated.js?v=20261124-load2', location.href).href);
    await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2.0-valid-time-test',
      blocks: [{ id: 'rest-static', type: 'passive', content: { useFixation: false, slideDuration: 180000,
        validTime: { schemaVersion: 'passive_valid_time.v1', enabled: true, maxExtensionRatio: .5, minSegmentMs: 1000 },
        trials: [{ stimulusId: 'std_simple_black_square', duration: 180000 }] } }] } });
  });
  await page.locator('#cogStartBtn').click();
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime.validTimeTrial));
  const result = await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    const { stopCognitiveStimulusPlayback } = await import(new URL(
      'js/web-page/experimental_task-updated.js?v=20261124-load2', location.href).href);
    stopCognitiveStimulusPlayback();
    return { result: shared.sessionData.cognitiveResults[0], active: shared.runtime.validTimeTrial };
  });
  expect(result.active).toBeNull();
  expect(result.result.qualityValid).toBe(false);
  expect(result.result.qualityIssueCodes).toContain('valid_time_incomplete');
  expect(result.result.validTime.targetMs).toBe(180000);
});

test('the real frame pipeline gates by capture time, current FPS and available face visibility', async ({ page }) => {
  await page.goto(getPageUrl(), { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  const result = await page.evaluate(async () => {
    const shared = (window as any).__WECOG_STATE__;
    const base = new URL('js/session-runtime/', location.href);
    const { SessionFramePipeline } = await import(new URL('frame-pipeline.js?v=20261124-load2', base).href);
    const { PassiveValidTime } = await import(new URL('passive-valid-time.mjs?v=20261122-validtime1', base).href);
    const contexts: any[] = [], measured: boolean[] = [];
    const origin = performance.now() - 30;
    const tracker = new PassiveValidTime({ startMs: origin, targetMs: 10000 });
    shared.runtime.validTimeTrial = tracker;
    shared.runtime.currentPhase = 'cognitive_stimulus';
    shared.runtime.taskContext = { blockId: 'b', trialId: 't', presentationId: 'p' };
    shared.flags.isRecording = false;
    const metrics = { analysisFps: 29, cameraFps: 29, durationMs: 30000, totalFrames: 900 };
    shared.runtime.invitationProtocolDefinition = { settings: { qualityControl: { schemaVersion: 'protocol_quality.v1',
      rules: { fpsStable: { enabled: true, hardStop: true, threshold: 25 } } } } };
    shared.runtime.localAnalyzer = { analyzeFrame: async () => ({ timestamp: performance.now() - 30,
      wallTimestamp: Date.now() - 30, face: { detected: true }, pose: { isStable: true },
      illumination: { status: 'optimal' }, landmarks: Array.from({ length: 468 }, () => ({ x: .5, y: .5, z: 0 })) }) };
    shared.runtime.gazeTracker = { isCalibrated: () => true, updateScreenSize() {},
      predict: (_landmarks: any, options: any) => ({ valid: true, correctedX: 50, correctedY: 50,
        x: 50, y: 50, frameTimestamp: options.timestamp, t: options.wallTimestamp, onScreen: true }) };
    shared.runtime.qcMetrics = { isRunning: () => true, processFrame() {}, addGazePoint() {}, getCurrentMetrics: () => metrics };
    const controller = { featureFlags: {}, sessionClock: null, setModuleStatus() {}, captureMultimodalFrame: () => null,
      updateProtocolQuality() {}, reportIssue() {}, resolveIssue() {}, getActiveIssues: () => [],
      recordPhysiologyFrame: (_time: any, _sample: any, _config: any, allowed: boolean) => measured.push(allowed) };
    const video = { readyState: 2, currentTime: 1 };
    const pipeline = new SessionFramePipeline({ state: shared, controller, video });
    pipeline.active = true;
    pipeline.bpm = { engine: { cfg: {} }, setValidTimeContext: (context: any) => contexts.push(context),
      process: () => ({ published: true, bpm: 70 }) };
    pipeline._schedule = () => {};
    pipeline._requestFrame = () => {};
    pipeline._publishCameraFps = () => {};
    pipeline._publishDiagnostics = () => {};
    pipeline._scheduleAuxiliary = () => {};
    pipeline._processEmotion = () => {};
    for (let index = 0; index < 4; index++) {
      metrics.analysisFps = index === 1 ? 16 : 29;
      pipeline.lastSegmenterResult = index === 2 ? null : { isComplete: true, faceVisibility: { isComplete: true } };
      pipeline.lastSegmenterCapturedAt = performance.now();
      video.currentTime++;
      await pipeline._tick();
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    pipeline.active = false;
    const snapshot = tracker.snapshot(performance.now(), true);
    shared.runtime.validTimeTrial = null;
    return { contexts, measured, snapshot };
  });
  expect(result.contexts.map((context: any) => context.allowed)).toEqual([true, false, false, true]);
  expect(result.measured).toEqual([true, false, false, true]);
  expect(result.snapshot.excludedSegments.some((segment: any) => segment.reasons.includes('protocol_qc_fpsStable'))).toBe(true);
  expect(result.snapshot.excludedSegments.some((segment: any) => segment.reasons.includes('face_visibility_unavailable'))).toBe(true);
});
