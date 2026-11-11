import { test, expect } from '@playwright/test';

test('transferred PCM is not copied again and a stalled audio queue stays bounded without requesting a microphone', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/audio/session-audio.js?v=20261110-integration1';
    const { SessionAudioCollector } = await import(modulePath);
    let time = 1000;
    const events: any[] = [], releases: Array<(value: null) => void> = [];
    const collector = new SessionAudioCollector({ state: { sessionData: { audioConsent: { granted: true } }, runtime: {} }, enabled: true,
      WorkerCtor: null, clock: { now: () => ({ monotonicMs: time += 1000, sessionTimeMs: time - 1000 }) },
      recordEvent: (type: string, details: any) => events.push({ type, details }) });
    collector.started = true; collector.sampleRate = 16;
    const channel = new MessageChannel(), source = new Float32Array([.25, .5, -.75]);
    let received: Float32Array;
    try {
      const message = new Promise<Float32Array>(resolve => { channel.port2.onmessage = event => resolve(event.data); });
      channel.port1.postMessage(source, [source.buffer]); received = await message;
      collector._captureSamples(received, true);
    } finally { channel.port1.close(); channel.port2.close(); }
    const owned = collector.pendingChunks[0] === received!;
    const values = Array.from(collector._consume(3));
    collector._analyzeWindow = () => new Promise(resolve => releases.push(resolve));
    for (let i = 0; i < 20; i++) collector._queueWindow(new Float32Array(16));
    await Promise.resolve();
    const pending = collector.pendingWindowCount, dropped = collector.droppedWindowCount, inFlight = releases.length;
    releases[0](null); for (let i = 0; i < 10; i++) await Promise.resolve();
    releases[1](null); await collector.analysisQueue;
    collector._analyzeWindow = async () => { throw new Error('synthetic analysis failure'); };
    collector._queueWindow(new Float32Array(16)); await collector.analysisQueue;
    const summary = await collector.stop();
    let terminated = false, sensorReleased = false, sent = 0;
    const timed = new SessionAudioCollector({ state: { sessionData: { audioConsent: { granted: true } }, runtime: {} },
      enabled: true, WorkerCtor: null, workerTimeoutMs: 10, clock: { now: () => ({ monotonicMs: 1000, sessionTimeMs: 0 }) } });
    timed.sampleRate = 16; timed.started = true; timed.everStarted = true;
    timed.worker = { postMessage() { sent++; }, terminate() { terminated = true; } };
    timed.stream = { getTracks: () => [{ stop() { sensorReleased = true; } }] };
    timed._queueWindow(new Float32Array(16)); timed._queueWindow(new Float32Array(16));
    await timed.analysisQueue; const timeoutSummary = await timed.stop();
    return { sourceDetached: source.byteLength === 0, owned, values, pending, dropped, inFlight,
      pendingAfterStop: collector.pendingWindowCount, summary, rawInEvents: JSON.stringify(events).includes('samples'),
      failedRecorded: events.some(event => event.type === 'audio_window_dropped' && event.details.reason === 'analysis_failed'),
      timeout: { terminated, sensorReleased, sent, pending: timed.pendingWindowCount, status: timeoutSummary.status, dropped: timeoutSummary.droppedWindowCount } };
  });
  expect(result.sourceDetached).toBe(true); expect(result.owned).toBe(true); expect(result.values).toEqual([.25, .5, -.75]);
  expect(result.pending).toBe(2); expect(result.inFlight).toBe(1); expect(result.dropped).toBe(18);
  expect(result.pendingAfterStop).toBe(0); expect(result.failedRecorded).toBe(true); expect(result.rawInEvents).toBe(false);
  expect(result.summary).toMatchObject({ windowCount: 0, droppedWindowCount: 21, rawAudioStored: false, rawAudioTransmitted: false });
  expect(result.timeout).toEqual({ terminated: true, sensorReleased: true, sent: 1, pending: 0, status: 'failed', dropped: 2 });
});

test('rPPG scratch reuse preserves exact POS/CHROM values without per-frame array maps or RGB copies', async ({ page }, info) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const base = '/lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/algorithms/';
    const { ColorProjectionWindow } = await import(base + 'color-projection.mjs?v=20261103-2');
    const { posSampleFromWindow: pos } = await import(base + 'pos.js');
    const { chromSampleFromWindow: chrom } = await import(base + 'chrom.js');
    const workspace = new ColorProjectionWindow();
    const samples = (length: number) => Object.freeze(Array.from({ length }, (_, i) => Object.freeze({
      tMs: i * 1000 / 30, r: 160 + 10 * Math.sin(i * .13), g: 110 + 7 * Math.cos(i * .17), b: 80 + Math.sin(i * .23) })));
    const legacy = (input: readonly any[], since: number | null = null) => {
      const rgb = input.filter(point => since === null || point.tMs >= since).map(point => ({ r: point.r, g: point.g, b: point.b }));
      return { sampleCount: rgb.length, pos: pos(rgb), chrom: chrom(rgb) };
    };
    let comparisons = 0, mismatch = false;
    for (const length of [0, 1, 29, 30, 31, 240, 1024, 31]) for (const since of [null, 0, 1000, Infinity]) {
      const input = samples(length), expected = legacy(input, since), actual = workspace.sample(input, since);
      mismatch ||= actual.sampleCount !== expected.sampleCount || !Object.is(actual.pos, expected.pos) || !Object.is(actual.chrom, expected.chrom);
      comparisons++;
    }
    const input = samples(240); workspace.sample(input, 0);
    const buffers = workspace._vectors.slice();
    let maps = 0, filters = 0;
    const map = Array.prototype.map, filter = Array.prototype.filter;
    let beforeMaps, beforeFilters, afterMaps, afterFilters;
    try {
      (Array.prototype as any).map = function (...args: any[]) { maps++; return map.apply(this, args); };
      (Array.prototype as any).filter = function (...args: any[]) { filters++; return filter.apply(this, args); };
      for (let i = 0; i < 100; i++) legacy(input, 0);
      beforeMaps = maps; beforeFilters = filters; maps = 0; filters = 0;
      for (let i = 0; i < 100; i++) workspace.sample(input, 0);
      afterMaps = maps; afterFilters = filters;
    } finally { Array.prototype.map = map; Array.prototype.filter = filter; }
    const beforeMs: number[] = [], afterMs: number[] = [];
    for (let round = 0; round < 5; round++) {
      let started = performance.now(); for (let i = 0; i < 1000; i++) legacy(input, 0); beforeMs.push(performance.now() - started);
      started = performance.now(); for (let i = 0; i < 1000; i++) workspace.sample(input, 0); afterMs.push(performance.now() - started);
    }
    return { comparisons, mismatch, beforeMaps, beforeFilters, afterMaps, afterFilters,
      capacity: workspace.capacity, scratchBytes: workspace._vectors.reduce((sum: number, value: Float64Array) => sum + value.byteLength, 0),
      reused: workspace._vectors.every((value: Float64Array, index: number) => value === buffers[index]), beforeMs, afterMs };
  });
  expect(result.comparisons).toBe(32); expect(result.mismatch).toBe(false); expect(result.reused).toBe(true);
  expect(result.beforeMaps).toBe(2100); expect(result.beforeFilters).toBe(100);
  expect(result.afterMaps).toBe(0); expect(result.afterFilters).toBe(0);
  expect(result.capacity).toBe(1024); expect(result.scratchBytes).toBe(32768);
  await info.attach('projection-microbenchmark-not-full-pipeline-fps', { body: JSON.stringify(result), contentType: 'application/json' });
  console.log(`${info.project.name} rPPG projection: ${JSON.stringify(result)}`);
});

test('head guide keeps every pose update but clears its precheck canvas only on exit', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<style>#overlayCanvas{width:640px;height:480px}'
      + '#calibrationHeadPoseCanvas{width:160px;height:112px}</style>'
      + '<canvas id="overlayCanvas" width="640" height="480"></canvas>';
    const guidePath = '/apps/participant-web/js/gaze-tracker/head-pose-guide.js?v=20261103-1';
    const guide = await import(guidePath);
    const canvas = document.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;
    let clears = 0;
    const clear = ctx.clearRect.bind(ctx);
    ctx.clearRect = (...args: Parameters<typeof clear>) => { clears++; clear(...args); };
    const frame = { face: { detected: true, bbox: { x: .3, y: .2, width: .36, height: .54 }, status: 'valid' },
      pose: { yaw: 0, pitch: 0, roll: 0, status: 'stable' }, illumination: { status: 'optimal' } };
    guide.resetHeadPoseReference(); guide.setHeadPoseGuideMode('precheck');
    const before = clears;
    for (let i = 0; i < 30; i++) guide.updateHeadPoseGuide(frame);
    const precheckClears = clears - before;
    guide.captureHeadPoseReference(frame); guide.setHeadPoseGuideMode('hidden');
    const hiddenStart = clears;
    for (let i = 0; i < 300; i++) guide.updateHeadPoseGuide({ ...frame, pose: { ...frame.pose, yaw: 20 } });
    const hiddenClears = clears - hiddenStart;
    const hidden = guide.getHeadPoseGuideSnapshot();
    const observer = new MutationObserver(() => {});
    const root = document.getElementById('calibrationHeadPoseGuide');
    if (root) observer.observe(root, { attributes: true });
    for (let i = 0; i < 30; i++) guide.updateHeadPoseGuide(frame);
    const hiddenMutations = observer.takeRecords().length; observer.disconnect();
    guide.setHeadPoseGuideMode('precheck'); guide.updateHeadPoseGuide(frame);
    const resumedStart = clears;
    const replacement = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(replacement); guide.updateHeadPoseGuide(frame);
    guide.setHeadPoseGuideMode('hidden');
    const replacementPixels = replacement.getContext('2d')!.getImageData(0, 0, replacement.width, replacement.height).data;
    guide.setHeadPoseGuideMode('calibration'); guide.updateHeadPoseGuide({ ...frame, pose: { ...frame.pose, yaw: 90 } });
    const fixedVisible = document.getElementById('calibrationHeadPoseGuide')!.classList.contains('active');
    guide.updateHeadPoseGuide({ face: { detected: false } });
    const missing = guide.getHeadPoseGuideSnapshot();
    guide.resetHeadPoseReference();
    return { precheckClears, hiddenClears, hiddenMutations, hidden,
      oldCanvasCleared: clears > resumedStart, replacementEmpty: replacementPixels.every(value => value === 0), fixedVisible, missing };
  });
  expect(result.precheckClears).toBe(30);
  expect(result.hiddenClears).toBe(0); expect(result.hiddenMutations).toBe(0);
  expect(result.hidden.current.yaw).toBeCloseTo(20, 6);
  expect(result.hidden.deviation.status).not.toBe('aligned');
  expect(result.oldCanvasCleared).toBe(true); expect(result.replacementEmpty).toBe(true);
  expect(result.fixedVisible).toBe(true); expect(result.missing.current).toBeNull();
});

test('QC warning avoids repeated DOM mutations while keeping language, reasons and recovery debounce live', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const overlayPath = '/apps/participant-web/js/qc-pause-overlay-new.js?v=20261103-1';
    const qc = await import(overlayPath);
    let lang = 'en'; qc.init({ getLang: () => lang }); qc.show('face_lost');
    const root = document.getElementById('qc-pause-overlay')!;
    const observer = new MutationObserver(() => {});
    observer.observe(root, { attributes: true, subtree: true, childList: true, characterData: true });
    for (let i = 0; i < 300; i++) qc.show('face_lost');
    const repeatedMutations = observer.takeRecords().length;
    lang = 'ru'; qc.show('face_lost'); const russian = root.textContent;
    qc.show('low_light'); const lighting = root.textContent;
    const acceptable = { face: { detected: true, status: 'valid' }, pose: { status: 'stable' }, illumination: { status: 'optimal' } };
    for (let i = 0; i < 3; i++) qc.updateFromMetrics({ qcScore: .8 }, acceptable);
    qc.show('face_lost');
    await new Promise(resolve => setTimeout(resolve, 450));
    const interruptedRecovery = qc.isVisible();
    for (let i = 0; i < 3; i++) qc.updateFromMetrics({ qcScore: .8 }, acceptable);
    await new Promise(resolve => setTimeout(resolve, 450));
    const recovered = !qc.isVisible(); observer.takeRecords();
    qc.hide(); qc.hide(); const hiddenMutations = observer.takeRecords().length;
    observer.disconnect();
    return { repeatedMutations, russian, lighting, interruptedRecovery, recovered, hiddenMutations };
  });
  expect(result.repeatedMutations).toBe(0); expect(result.hiddenMutations).toBe(0);
  expect(result.russian).toBe('Верните лицо в кадр'); expect(result.lighting).toBe('Улучшите освещение');
  expect(result.interruptedRecovery).toBe(true); expect(result.recovered).toBe(true);
});

// Only the tiny synthetic fixture is used. No camera/microphone permission,
// account, production invitation or biometric recording is required.
test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === baseURL || ['data:', 'blob:'].includes(url.protocol)
      ? route.continue() : route.abort();
  });
});

for (const paintInterval of [100, 250]) {
  test(`native live-stream FPS retains the camera path and stops without reading a playback counter (${paintInterval}ms paints)`, async ({ page }) => {
    await page.goto('/apps/participant-web/tools/session-report.html');
    test.skip(!await page.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream === 'function'),
      'No synthetic MediaStream support; never substitute a physical camera.');
    const result = await page.evaluate(async paintInterval => {
      const modulePath = '/apps/participant-web/js/session-runtime/video-frames.mjs';
      const { measureVideoFps } = await import(modulePath);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      const video = document.createElement('video'); video.muted = true; video.playsInline = true;
      const stream = canvas.captureStream(10); let paints = 0, qualityReads = 0;
      const timer = setInterval(() => { ctx.fillStyle = paints++ % 2 ? '#fff' : '#000'; ctx.fillRect(0, 0, 64, 64); }, paintInterval);
      video.srcObject = stream; document.body.append(video);
      video.getVideoPlaybackQuality = () => { qualityReads++; throw new Error('inert fixture'); };
      const request = video.requestVideoFrameCallback.bind(video), cancel = video.cancelVideoFrameCallback.bind(video);
      const pending = new Set<number>(), delivered: number[] = [];
      video.requestVideoFrameCallback = callback => {
        const id = request((now, metadata) => {
          pending.delete(id); delivered.push(metadata.presentedFrames); callback(now, metadata);
        });
        pending.add(id); return id;
      };
      video.cancelVideoFrameCallback = id => { pending.delete(id); cancel(id); };
      try {
        await video.play();
        const measured = await measureVideoFps(video, 2200);
        return { measured, qualityReads, delivered, pending: pending.size };
      } finally { clearInterval(timer); video.pause(); stream.getTracks().forEach(track => track.stop()); video.srcObject = null; video.remove(); }
    }, paintInterval);
    expect(result.qualityReads).toBe(0);
    expect(result.measured).toMatchObject({ method: 'video-frame-callback', measurementVersion: 'video_cadence.v2', playbackQuality: null });
    // captureStream's requested rate is a ceiling, not a CI scheduling guarantee.
    // Compare the measurement with actual native delivery, including skipped notifications.
    expect(result.delivered.length).toBeGreaterThan(1);
    expect(result.delivered.every((counter, index, all) => Number.isSafeInteger(counter)
      && (index === 0 || counter > all[index - 1]))).toBe(true);
    expect(result.measured.frames).toBe(1 + result.delivered[result.delivered.length - 1] - result.delivered[0]);
    expect(result.measured.fps).toBe(Math.round(result.measured.frames / result.measured.duration));
    expect(result.measured.duration).toBeGreaterThan(0);
    expect(result.pending).toBe(0);
  });
}

test('file FPS restart cleans callbacks and unavailable counters are explicitly lower-bound notifications', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/session-runtime/video-frames.mjs';
    const { measureVideoFps } = await import(modulePath);
    const video = document.createElement('video'); video.muted = true; video.loop = true; video.playsInline = true;
    video.src = '/apps/autotests/tests/fixtures/passive-video.webm'; document.body.append(video);
    const request = video.requestVideoFrameCallback.bind(video), cancel = video.cancelVideoFrameCallback.bind(video);
    const pending = new Set<number>();
    video.requestVideoFrameCallback = callback => {
      const id = request((now, meta) => { pending.delete(id); callback(now, meta); }); pending.add(id); return id;
    };
    video.cancelVideoFrameCallback = id => { pending.delete(id); cancel(id); };
    try {
      await video.play();
      const first = await measureVideoFps(video, 1200); const afterFirst = pending.size;
      const second = await measureVideoFps(video, 1200); const afterSecond = pending.size;
      video.getVideoPlaybackQuality = () => { throw new Error('unavailable fixture'); };
      const fallback = await measureVideoFps(video, 600);
      return { first, second, fallback, pending: pending.size, afterFirst, afterSecond };
    } finally { video.pause(); video.remove(); }
  });
  for (const measured of [result.first, result.second]) {
    expect(measured.method).toBe('decoded-frame-counter');
    expect(measured.fps).toBeGreaterThanOrEqual(7); expect(measured.fps).toBeLessThanOrEqual(14);
  }
  expect(result.fallback).toMatchObject({ method: 'video-callback-count', fallbackReason: 'playback_counter_unavailable',
    playbackQuality: { complete: false, droppedFrames: null, displayedFrames: null } });
  expect(result.fallback.frames).toBeGreaterThan(0);
  expect([result.afterFirst, result.afterSecond, result.pending]).toEqual([0, 0, 0]);
});

test('17 FPS quality failure is not hidden by a 61 FPS camera publication, and recovery clears the next attempt', async ({ page }) => {
  // A real deficit during an active attempt remains invalid at the same threshold.
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  await page.evaluate(() => (window as any).QCMetricsReady);
  const result = await page.evaluate(() => {
    const s = (window as any).__WECOG_STATE__, runtime = s.runtime.sessionRuntime;
    const savedPerformance = Object.getOwnPropertyDescriptor(performance, 'now'), savedDate = Date.now;
    const epoch = savedDate(); let clock = 0, firstFailure: number | null = null;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => clock });
    Date.now = () => epoch + clock;
    const qc = new (window as any).QCMetrics();
    try {
      s.runtime.invitationProtocolDefinition = { settings: { qualityControl: { schemaVersion: 'protocol_quality.v1',
        rules: { fpsStable: { enabled: true, threshold: 25, hardStop: false } } } } };
      s.sessionData.experimentMeta = { protocolProgress: { status: 'running' } };
      s.runtime.qcMetrics = qc; qc.start(); runtime.enterInstruction({ source: 'synthetic-issue132' });
      runtime.beginBlock({ blockId: 'synthetic-fps', blockType: 'passive' });
      const run = (fps: number, seconds: number) => {
        for (let index = 0; index < fps * seconds; index++) {
          clock += 1000 / fps; qc.processFrame({}); qc.setCameraFps(61);
          runtime.updateProtocolQuality(qc.getCurrentMetrics(), Date.now());
          if (firstFailure === null && runtime.getActiveIssues().some((issue: any) => issue.code === 'protocol_qc_fpsStable')) firstFailure = clock;
        }
      };
      run(17, 30);
      const slow = qc.getCurrentMetrics(), first = runtime.getCurrentBlock();
      const slowAttempt = { invalid: first.invalid, issues: first.issues.map((issue: any) => issue.code) };
      runtime.completeBlock({ success: true }); runtime.discardRepeat('synthetic-fps');
      runtime.enterInstruction({ source: 'synthetic-recovery' }); run(30, 5);
      const next = runtime.beginBlock({ blockId: 'synthetic-recovered', blockType: 'passive' });
      return { firstFailure, slowAnalysis: slow.analysisFps, camera: slow.cameraFps, slowAttempt,
        recoveredInvalid: next.invalid, activeCodes: runtime.getActiveIssues().map((issue: any) => issue.code),
        historyPreserved: s.sessionData.events.some((event: any) => event.type === 'session_issue_raised') };
    } finally {
      qc.stop(); Date.now = savedDate;
      if (savedPerformance) Object.defineProperty(performance, 'now', savedPerformance); else delete (performance as any).now;
    }
  });
  expect(Math.round(result.firstFailure!)).toBeGreaterThanOrEqual(13000);
  expect(result.firstFailure).toBeLessThan(14500);
  expect(result.slowAnalysis).toBeGreaterThanOrEqual(16); expect(result.slowAnalysis).toBeLessThanOrEqual(18);
  expect(result.camera).toBe(61);
  expect(result.slowAttempt.invalid).toBe(true);
  expect(result.slowAttempt.issues).toContain('protocol_qc_fpsStable');
  expect(result.recoveredInvalid).toBe(false);
  expect(result.activeCodes).not.toContain('protocol_qc_fpsStable');
  expect(result.historyPreserved).toBe(true);
});

test('instruction FPS cannot poison an unstarted attempt; an actual active deficit still rejects it', async ({ page }) => {
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  const result = await page.evaluate(() => {
    const s = (window as any).__WECOG_STATE__, runtime = s.runtime.sessionRuntime;
    s.sessionData.experimentMeta = { protocolProgress: {} };
    s.runtime.invitationProtocolDefinition = { settings: { qualityControl: { schemaVersion: 'protocol_quality.v1',
      rules: { fpsStable: { enabled: true, threshold: 25, hardStop: false } } } } };
    runtime.machine.start(); runtime.enterInstruction();
    const metrics = { durationMs: 30000, totalFrames: 500, analysisFps: 17 };
    runtime.updateProtocolQuality(metrics, 1000); runtime.updateProtocolQuality(metrics, 30000);
    const instructionIssues = runtime.getActiveIssues();
    const first = runtime.beginBlock({ blockId: 'instruction-safe', blockType: 'passive' });
    runtime.updateProtocolQuality(metrics, 31000); runtime.updateProtocolQuality(metrics, 34001);
    const active = runtime.getCurrentBlock();
    const decision = runtime.completeBlock();
    runtime.updateProtocolQuality(metrics, 35000);
    const next = runtime.beginBlock({ blockId: 'instruction-safe', blockType: 'passive' });
    return { instructionIssues, first, active, decision, next, historical: s.sessionData.events.some((e: any) => e.type === 'session_issue_raised') };
  });
  expect(result.instructionIssues).toEqual([]);
  expect(result.first.invalid).toBe(false);
  expect(result.active.invalid).toBe(true);
  expect(result.decision.repeatRequired).toBe(true);
  expect(result.next.invalid).toBe(false);
  expect(result.historical).toBe(true);
});

test('source-only control counts compositor callbacks without running a model and releases video callbacks', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const modulePath = '/scripts/reference-data/source-cadence.mjs';
    const { measureSourceCadence } = await import(modulePath);
    const video = document.createElement('video'); video.muted = true;
    video.src = '/apps/autotests/tests/fixtures/passive-video.webm'; document.body.append(video);
    try {
      const report = await measureSourceCadence(video, 400);
      let invalidDuration = false;
      try { await measureSourceCadence(video, Infinity); } catch { invalidDuration = true; }
      return { report, invalidDuration, paused: video.paused, handlersCleared: !video.onended && !video.onerror };
    } finally { video.pause(); video.remove(); }
  });
  expect(result.report).toMatchObject({ kind: 'source-cadence', modelsRun: false, accuracyValidated: false });
  expect(result.report.callbacks).toBeGreaterThan(0);
  expect(result.report.presented).toBeGreaterThanOrEqual(result.report.callbacks);
  expect(result.report.animationFrames).toBeGreaterThan(0);
  expect(result.paused && result.handlersCleared && result.invalidDuration).toBe(true);
});

test('source-only control rejects reordered frames and cleans up on failure', async ({ page, browserName }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const modulePath = '/scripts/reference-data/source-cadence.mjs';
    const { measureSourceCadence } = await import(modulePath);
    let requests = 0, cancelled = 0, paused = false;
    const preparationFrames = /Firefox\//.test(navigator.userAgent) ? 1 : 0;
    const video = {
      currentTime: .1, duration: 60, readyState: 2, ended: false, seeking: false,
      onended: null, onerror: null, play: () => Promise.resolve(), pause: () => { paused = true; },
      addEventListener(type: string, callback: Function) { if (type === 'seeked') queueMicrotask(() => callback()); },
      removeEventListener() {},
      requestVideoFrameCallback(callback: Function) {
        const count = ++requests;
        // Firefox has one preparation callback. Both measured sequences remain .1 -> 0.
        return setTimeout(() => callback(performance.now(), { mediaTime: count - preparationFrames === 1 ? .1 : 0, presentedFrames: count }), 5);
      },
      cancelVideoFrameCallback(id: number) { cancelled++; clearTimeout(id); },
    };
    let error = '';
    try { await measureSourceCadence(video, 100); } catch (failure) { error = (failure as Error).message; }
    await new Promise(resolve => setTimeout(resolve, 30));
    return { error, requests, cancelled, paused, handlersCleared: !video.onended && !video.onerror };
  });
  expect(result.error).toBe('non_monotonic_video_pts');
  expect(result.requests).toBe(browserName === 'firefox' ? 3 : 2);
  expect(result.cancelled).toBe(browserName === 'firefox' ? 2 : 1);
  expect(result.paused && result.handlersCleared).toBe(true);
});

test('synthetic live-stream control needs no camera permission and stops every generated track', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  test.skip(!await page.evaluate(() => typeof HTMLCanvasElement.prototype.captureStream === 'function'),
    'This engine has no canvas.captureStream; do not substitute a physical camera.');
  const result = await page.evaluate(async () => {
    const modulePath = '/scripts/reference-data/source-cadence.mjs';
    const { measureSyntheticSourceCadence } = await import(modulePath);
    const original = HTMLCanvasElement.prototype.captureStream, tracks: MediaStreamTrack[] = [];
    HTMLCanvasElement.prototype.captureStream = function (...args) {
      const stream = original.apply(this, args); tracks.push(...stream.getTracks()); return stream;
    };
    const video = document.createElement('video'); video.muted = true; document.body.append(video);
    try {
      const report = await measureSyntheticSourceCadence(video, 500);
      return { report, detached: video.srcObject === null, paused: video.paused,
        tracks: tracks.map(track => track.readyState) };
    } finally { HTMLCanvasElement.prototype.captureStream = original; video.pause(); video.remove(); }
  });
  expect(result.report).toMatchObject({ modelsRun: false, sourceInput: 'synthetic_canvas_stream', nominalFps: 30 });
  expect(result.report.producer.drawCalls).toBeGreaterThan(0);
  expect(Number.isFinite(result.report.producer.drawFpsIncludingPlay)).toBe(true);
  const clock = result.report.mediaClock;
  expect(clock.policy).toBe('observe_stream_pts_without_retiming');
  expect(clock.increasing + clock.repeated + clock.backwards + clock.missing).toBe(result.report.callbacks);
  expect(result.report.callbacks).toBeGreaterThan(0);
  expect(result.tracks.length).toBeGreaterThan(0);
  expect(result.tracks.every(state => state === 'ended')).toBe(true);
  expect(result.paused && result.detached).toBe(true);
});

test('stream control exposes repeated media clocks instead of presenting them as fresh signal timestamps', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const modulePath = '/scripts/reference-data/source-cadence.mjs';
    const { measureSourceCadence } = await import(modulePath);
    let counter = 0;
    const video = {
      onended: null, onerror: null, play: () => Promise.resolve(), pause() {},
      requestVideoFrameCallback(callback: Function) {
        return setTimeout(() => callback(performance.now(), { mediaTime: 0, presentedFrames: ++counter }), 5);
      },
      cancelVideoFrameCallback(id: number) { clearTimeout(id); },
    };
    return measureSourceCadence(video, 80, 'stream');
  });
  expect(result.callbacks).toBeGreaterThan(1);
  expect(result.modelsRun).toBe(false);
  expect(result.mediaClock).toMatchObject({ increasing: 1, repeated: result.callbacks - 1, backwards: 0, missing: 0 });
});

test('finite replay admits callbacks only after play resolves and keeps a strictly increasing source clock', async ({ page }, info) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  await page.bringToFront();
  const results = await page.evaluate(async () => {
    const modulePath = '/scripts/reference-data/media-clock.mjs';
    const { nextMediaTimestamp, prepareFiniteVideo } = await import(modulePath);
    const results = [];
    for (let run = 0; run < 3; run++) {
      const video = document.createElement('video'); video.muted = true;
      video.style.cssText = 'position:fixed;top:0;left:0;width:64px;height:64px;z-index:10000';
      video.src = '/apps/autotests/tests/fixtures/passive-video.webm'; document.body.append(video);
      let callback: number | null = null;
      try {
        await prepareFiniteVideo(video);
        await video.play();
        const rect = video.getBoundingClientRect();
        const admittedAt = { currentTime: video.currentTime, duration: video.duration, ended: video.ended, paused: video.paused,
          readyState: video.readyState, visibility: document.visibilityState,
          onScreen: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth };
        results.push(await new Promise(resolve => {
          let previous: number | null = null, accepted = 0, done = false;
          const finish = (error: string | null = null) => {
            if (done) return; done = true; clearTimeout(deadline);
            resolve({ accepted, error, admittedAt, ended: video.ended, currentTime: video.currentTime, run });
          };
          const deadline = setTimeout(() => finish('fixture_deadline'), 10_000);
          video.onended = () => finish(); video.onerror = () => finish('fixture_decode_failed');
          const tick = (_now: number, metadata: VideoFrameCallbackMetadata) => {
            if (done) return;
            try {
              const step = nextMediaTimestamp(previous, metadata, video);
              if (step.kind === 'terminal_replay') { finish(); return; }
              previous = step.timestamp; accepted++;
            } catch (error) {
              finish(`${(error as Error).message}:${JSON.stringify({ previous, mediaTime: metadata.mediaTime,
                presentedFrames: metadata.presentedFrames, currentTime: video.currentTime,
                duration: video.duration, ended: video.ended, seeking: video.seeking, accepted, run })}`);
              return;
            }
            callback = video.requestVideoFrameCallback(tick);
          };
          callback = video.requestVideoFrameCallback(tick);
        }));
      } finally {
        if (callback !== null) video.cancelVideoFrameCallback(callback);
        video.pause(); video.remove();
      }
    }
    return results;
  });
  await info.attach('finite-source-admission', { body: JSON.stringify(results), contentType: 'application/json' });
  console.log(`${info.project.name} finite source admission: ${JSON.stringify(results)}`);
  expect(results).toHaveLength(3);
  for (const result of results as Array<{ error: string | null; accepted: number; admittedAt: { onScreen: boolean; visibility: string } }>) {
    expect(result.admittedAt.onScreen).toBe(true); expect(result.admittedAt.visibility).toBe('visible');
    expect(result.error).toBeNull(); expect(result.accepted).toBeGreaterThan(0);
  }
});

for (const fps of [10, 30]) {
  test(`measures ${fps} source playback frames per second and exposes dropped/displayed counts`, async ({ page }) => {
    await page.goto('/apps/participant-web/tools/session-report.html');
    const result = await page.evaluate(async fps => {
      const modulePath = '/apps/participant-web/js/session-runtime/video-frames.mjs';
      const { measureVideoFps } = await import(modulePath);
      const video = document.createElement('video');
      Object.assign(video, { muted: true, loop: true, playsInline: true });
      video.src = '/apps/autotests/tests/fixtures/passive-video.webm';
      document.body.append(video);
      try {
        await video.play();
        // Loading a new src can reset playbackRate to defaultPlaybackRate.
        video.defaultPlaybackRate = video.playbackRate = fps / 10;
        return { ...await measureVideoFps(video, 3200), playbackRate: video.playbackRate };
      }
      finally { video.pause(); video.remove(); }
    }, fps);
    expect(result.method).toBe('decoded-frame-counter');
    expect(result.measurementVersion).toBe('video_cadence.v2');
    expect(result.playbackQuality.complete).toBe(true);
    expect(result.playbackQuality.displayedFrames + result.playbackQuality.droppedFrames).toBe(result.frames);
    expect(result.playbackRate).toBe(fps / 10);
    expect(result.duration).toBeGreaterThanOrEqual(3);
    expect(result.fps).toBeGreaterThanOrEqual(fps * .75);
    expect(result.fps).toBeLessThanOrEqual(fps * 1.25);
    expect(result.frames).toBeGreaterThan(0);
  });
}

test('keeps camera/analysis windows independent and preserves their provenance through JSON', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  const result = await page.evaluate(async () => {
    const modulePath = '/apps/participant-web/js/qc-metrics/fps-monitor.js';
    const { VideoFpsMonitor } = await import(modulePath);
    const original = Object.getOwnPropertyDescriptor(performance, 'now');
    let now = 0;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
    const monitor = new VideoFpsMonitor();
    try {
      monitor.start(); const missing = monitor.getDiagnostics();
      for (let i = 1; i <= 20; i++) { now = i * 100; monitor.tick(); }
      monitor.setCameraFps(30, { frames: 30, durationMs: 1000, method: 'video-frame-callback' });
      const measured = monitor.getDiagnostics();
      now += 3000; const stale = monitor.getDiagnostics();
      monitor.stop(); const stopped = monitor.getDiagnostics();
      now += 10000; const later = monitor.getDiagnostics();
      monitor.start(); const restarted = monitor.getDiagnostics();
      return JSON.parse(JSON.stringify({ missing, measured, stale, stopped, later, restarted }));
    } finally {
      monitor.stop();
      if (original) Object.defineProperty(performance, 'now', original);
      else delete (performance as any).now;
    }
  });
  expect(result.missing.analysis).toMatchObject({ status: 'no_data', fps: null });
  expect(result.measured.analysis).toMatchObject({ status: 'measured', fps: 10, frames: 10, durationMs: 1000 });
  expect(result.measured.camera).toMatchObject({ status: 'measured', fps: 30, frames: 30, method: 'video-frame-callback' });
  expect(result.stale.analysis).toMatchObject({ status: 'stale', fps: null, lastWindowFps: 10 });
  expect(result.stale.camera).toMatchObject({ status: 'stale', fps: null, lastWindowFps: 30 });
  expect(result.stopped.running).toBe(false);
  expect(result.later).toEqual(result.stopped);
  expect(result.restarted.analysis.status).toBe('no_data');
});

test('reports the exact QC rule and evidence, preserves the failed attempt and resolves on recovery', async ({ page }) => {
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  const result = await page.evaluate(() => {
    const shared = (window as any).__WECOG_STATE__;
    const runtime = shared.runtime.sessionRuntime;
    shared.currentLang = 'ru';
    shared.sessionData.experimentMeta = { protocolProgress: {} };
    shared.runtime.invitationProtocolDefinition = { settings: { qualityControl: {
      schemaVersion: 'protocol_quality.v1', rules: { fpsStable: { enabled: true, threshold: 25, hardStop: false } }
    } } };
    runtime.machine.start();
    runtime.beginBlock({ blockId: 'synthetic-fps-qc', blockType: 'passive_viewing' });
    const metrics = { durationMs: 12000, totalFrames: 120, analysisFps: 10,
      fpsDiagnostics: { schemaVersion: 'fps_diagnostics.v1', scope: 'last_completed_window',
        analysis: { status: 'measured', fps: 10, frames: 10, durationMs: 1000 },
        camera: { status: 'measured', fps: 30, frames: 30, durationMs: 1000 } } };
    runtime.updateProtocolQuality(metrics, 1000);
    const beforeHold = runtime.machine.activeIssues.size;
    runtime.updateProtocolQuality(metrics, 4001);
    const issues = [...runtime.machine.activeIssues.values()];
    const decision = runtime.completeBlock();
    runtime.updateProtocolQuality({ ...metrics, analysisFps: 30 }, 5000);
    const activeAfterRecovery = runtime.machine.activeIssues.size;
    const repeatQueue = runtime.machine.snapshot().repeatQueue;
    return JSON.parse(JSON.stringify({ beforeHold, issues, decision, activeAfterRecovery,
      repeatQueue, pendingQualityStop: runtime.pendingQualityStop }));
  });
  expect(result.beforeHold).toBe(0);
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0]).toMatchObject({ code: 'protocol_qc_fpsStable', invalidatesBlock: true,
    details: { rule: 'fpsStable', metric: 'analysisFps', value: 10, threshold: 25,
      fpsDiagnostics: { analysis: { fps: 10 }, camera: { fps: 30 } } } });
  expect(result.issues[0].message).toContain('FPS анализа: 10 FPS');
  expect(result.issues[0].message).toContain('25 FPS');
  expect(result.pendingQualityStop).toBeNull();
  expect(result.decision.repeatRequired).toBe(true);
  expect(result.activeAfterRecovery).toBe(0);
  expect(result.repeatQueue).toHaveLength(1);
  expect(result.repeatQueue[0].issues[0].details.threshold).toBe(25);
});
