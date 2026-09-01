import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';

test.beforeEach(async ({ page }) => {
  await page.goto(`${baseUrl}/apps/participant-web/documents/privacy-policy-v1.0.html`);
});

test('audio consent is explicit and protocol-gated', async ({ page }) => {
  await page.goto(`${baseUrl}/apps/participant-web/mvp_with_precheck_1-updated.html`);
  const visible = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/audio/consent-ui.js';
    const { configureAudioConsentUI, captureAudioConsent } = await import(modulePath);
    const state = {
      sessionData: { audioConsent: {} },
      runtime: {},
    };
    configureAudioConsentUI(state, { settings: { featureFlags: { audio: true } } });
    const block = document.getElementById('audioConsentBlock');
    const checkbox = document.getElementById('audioConsentCheck') as HTMLInputElement;
    checkbox.checked = true;
    const consent = captureAudioConsent(state);
    return {
      hidden: block?.hidden,
      granted: consent.granted,
      rawCaptureGranted: consent.rawCaptureGranted,
    };
  });
  expect(visible).toEqual({ hidden: false, granted: true, rawCaptureGranted: false });
});

test('worker-backed audio lifecycle releases resources and sends no PCM', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/audio/session-audio.js';
    const { SessionAudioCollector } = await import(modulePath);
    class FakeNode {
      gain = { value: 1 };
      onaudioprocess: ((event: unknown) => void) | null = null;
      connect() { return this; }
      disconnect() {}
    }
    class FakeContext {
      sampleRate = 16000;
      destination = new FakeNode();
      state = 'running';
      closed = false;
      createMediaStreamSource() { return new FakeNode(); }
      createScriptProcessor() { return new FakeNode(); }
      createGain() { return new FakeNode(); }
      async resume() {}
      async suspend() {}
      async close() { this.closed = true; this.state = 'closed'; }
    }
    let stopped = false;
    const stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };
    let elapsed = 0;
    const state = {
      sessionData: { startTime: Date.now(), audioConsent: { granted: true } },
      runtime: { currentPhase: 'trial', taskContext: { blockId: 'audio-e2e' } },
    };
    const collector = new SessionAudioCollector({
      state,
      enabled: true,
      windowSeconds: 3,
      AudioContextCtor: FakeContext,
      mediaDevices: { getUserMedia: async () => stream },
      clock: {
        now: () => ({
          timeOriginMs: performance.timeOrigin,
          monotonicMs: performance.timeOrigin + (elapsed += 100),
          sessionTimeMs: elapsed,
        }),
      },
    });
    const started = await collector.start();
    const samples = Float32Array.from(
      { length: 16000 * 3 },
      (_, index) => 0.2 * Math.sin(2 * Math.PI * 180 * index / 16000)
    );
    collector._capture({ inputBuffer: { getChannelData: () => samples } });
    const summary = await collector.stop();
    return {
      started,
      stopped,
      windowCount: summary.windowCount,
      rawAudioStored: summary.rawAudioStored,
      rawAudioTransmitted: summary.rawAudioTransmitted,
      serializedContainsPcm: JSON.stringify(summary).includes('pcmSamples'),
    };
  });
  expect(result.started).toBe(true);
  expect(result.stopped).toBe(true);
  expect(result.windowCount).toBe(1);
  expect(result.rawAudioStored).toBe(false);
  expect(result.rawAudioTransmitted).toBe(false);
  expect(result.serializedContainsPcm).toBe(false);
});

test('audio window analysis keeps main-thread frame throughput within 20 percent', async ({ page }) => {
  const ratio = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/audio/session-audio.js';
    const { SessionAudioCollector } = await import(modulePath);
    const countFrames = (durationMs: number) => new Promise<number>(resolve => {
      let count = 0;
      const started = performance.now();
      const tick = () => {
        count += 1;
        if (performance.now() - started >= durationMs) resolve(count);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    class FakeNode {
      gain = { value: 1 };
      onaudioprocess: ((event: unknown) => void) | null = null;
      connect() { return this; }
      disconnect() {}
    }
    class FakeContext {
      sampleRate = 16000;
      destination = new FakeNode();
      state = 'running';
      createMediaStreamSource() { return new FakeNode(); }
      createScriptProcessor() { return new FakeNode(); }
      createGain() { return new FakeNode(); }
      async resume() {}
      async suspend() {}
      async close() { this.state = 'closed'; }
    }
    const baselineFrames = await countFrames(750);
    let elapsed = 0;
    const collector = new SessionAudioCollector({
      state: {
        sessionData: { startTime: Date.now(), audioConsent: { granted: true } },
        runtime: { currentPhase: 'trial', taskContext: {} },
      },
      enabled: true,
      windowSeconds: 10,
      AudioContextCtor: FakeContext,
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
      clock: {
        now: () => ({
          timeOriginMs: performance.timeOrigin,
          monotonicMs: performance.timeOrigin + (elapsed += 100),
          sessionTimeMs: elapsed,
        }),
      },
    });
    await collector.start();
    const samples = Float32Array.from(
      { length: 16000 * 10 },
      (_, index) => 0.2 * Math.sin(2 * Math.PI * 180 * index / 16000)
    );
    collector._capture({ inputBuffer: { getChannelData: () => samples } });
    const [analysisFrames] = await Promise.all([countFrames(750), collector.stop()]);
    return analysisFrames / Math.max(1, baselineFrames);
  });
  expect(ratio).toBeGreaterThanOrEqual(0.8);
});

test('multimodal renderer preserves missing emotion and draws gaze layers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/packages/shared/multimodal/index.mjs';
    const { buildMultimodalHeatmaps, renderMultimodalHeatmap } = await import(modulePath);
    const gaze = {
      correctedX: 150,
      correctedY: 75,
      stimulusRect: { left: 100, top: 50, width: 200, height: 100 },
      valid: true,
      onScreen: true,
      confidence: 0.9,
      monotonicMs: 1000,
      blockId: 'vpc',
      trialId: 'trial-1',
      stimulusId: 'cat-1',
    };
    const model = buildMultimodalHeatmaps({ gazeSamples: [gaze], emotionSamples: [] });
    const presentation = model.presentations[0];
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const rendered = renderMultimodalHeatmap(canvas, presentation, { model });
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, 320, 180).data || [];
    return {
      rendered: rendered.rendered,
      hasPixels: Array.from(pixels).some(value => value !== 0),
      valenceNoData: presentation.layers.valence.noData,
      coordinateSpace: model.coordinateSpace,
    };
  });
  expect(result.rendered).toBe(true);
  expect(result.hasPixels).toBe(true);
  expect(result.valenceNoData).toBe(true);
  expect(result.coordinateSpace).toBe('stimulus_normalized_0_1');
});

test('15-minute gaze retention stays bounded', async ({ page }) => {
  await page.goto(`${baseUrl}/apps/participant-web/mvp_with_precheck_1-updated.html`);
  const result = await page.evaluate(async () => {
    const [{ appendGazeSample }, { state }] = await Promise.all([
      // @ts-expect-error Production browser module intentionally has no .d.ts.
      import('/apps/participant-web/js/web-page/app-updated.js'),
      // @ts-expect-error Production browser module intentionally has no .d.ts.
      import('/apps/participant-web/js/web-page/state.js'),
    ]);
    state.sessionData.eyeTracking = [];
    for (let index = 0; index < 32_001; index += 1) {
      appendGazeSample({ index });
    }
    return {
      length: state.sessionData.eyeTracking.length,
      firstIndex: state.sessionData.eyeTracking[0]?.index,
      lastIndex: state.sessionData.eyeTracking.at(-1)?.index,
    };
  });
  expect(result).toEqual({ length: 30_000, firstIndex: 2_001, lastIndex: 32_000 });
});
