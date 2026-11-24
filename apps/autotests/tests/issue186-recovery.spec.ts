import { test, expect } from '@playwright/test';
import { getPageUrl } from './helpers/testUtils';

test('face loss persists a calibration gate after face returns, without interrupting the trial or consuming its retry', async ({ page }) => {
  await page.goto(getPageUrl(), { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as any).__WECOG_STATE__?.runtime.sessionRuntime);
  const result = await page.evaluate(async () => {
    const s = (window as any).__WECOG_STATE__, r = s.runtime.sessionRuntime;
    r.saveCheckpoint = async () => true;
    s.sessionData.cognitiveResults = [{ trialId: 'accepted', qualityValid: true, rt: 321 }];
    s.runtime.gazeTracker = { isCalibrated: () => true };
    s.runtime.currentPhase = 'cognitive_task';
    r.beginBlock({ blockId: 'b', blockType: 'cognitive_task' });
    r.reportIssue({ code: 'face_missing', kind: 'quality', recoverable: true });
    r.resolveIssue('face_missing');
    const during = { current: r.machine.currentBlock.blockId, required: r.requiresGazeCalibration() };
    let rejected = false;
    try { await r.ensureGazeCalibration(); } catch (_) { rejected = true; }
    r.completeBlock({ success: false });
    (window as any).__recoveryRepeat = r.promptRepeat('b').catch(() => {});
    return { during, rejected, results: s.sessionData.cognitiveResults, queue: r.machine.repeatQueue.length,
      issues: r.getActiveIssues().map((issue: any) => issue.code) };
  });
  expect(result.during).toEqual({ current: 'b', required: true });
  expect(result.rejected).toBe(true);
  expect(result.queue).toBe(1);
  expect(result.results).toEqual([{ trialId: 'accepted', qualityValid: true, rt: 321 }]);
  expect(result.issues).toContain('gaze_recalibration_required');
  await expect(page.locator('#wecog-session-modal')).toContainText(/калибровк|calibration/);
});

for (const passed of [true, false]) test(`independent validation ${passed ? 'resumes only the pending runner' : 'cannot resume through a hidden continue button'}`, async ({ page }) => {
  // Playwright yields through a native timer for every virtual poll. Host timer
  // throttling can slow macOS yields; this is not a processing/FPS assertion.
  test.setTimeout(process.platform === 'darwin' ? 180000 : 90000);
  await page.clock.install({ time: new Date('2026-11-24T12:00:00Z') });
  await page.goto(getPageUrl(), { waitUntil: 'load' });
  await page.bringToFront();
  await page.waitForFunction(() => !!(window as any).__WECOG_STATE__?.runtime.sessionRuntime);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(async passed => {
    const s = (window as any).__WECOG_STATE__;
    s.sessionData.cognitiveResults = [{ trialId: 'sentinel', qualityValid: true, rt: 321 }];
    (window as any).__resumed = 0;
    (window as any).__layoutRestored = false;
    s.runtime.calibrationRecoveryContinuation = { phase: 'cognitive_instruction',
      restoreLayout: () => { (window as any).__layoutRestored = true; },
      resolve: () => { (window as any).__resumed++; }, reject() {} };
    const { startGazeValidation } = await import(new URL('js/web-page/tests-updated.js?v=20261124-recovery1', location.href).href);
    startGazeValidation();
    document.getElementById('validationIntroStartBtn')!.click();
    const previous = Object.getOwnPropertyDescriptor(s.runtime, 'currentGazePrediction');
    let target = '', x = 100, y = 100;
    Object.defineProperty(s.runtime, 'currentGazePrediction', { configurable: true, get() {
      const point = document.getElementById('fullscreenCalibPoint')!;
      const key = point.style.left + ':' + point.style.top;
      // A 67 ms synthetic source clock still makes adjacent 33 ms polls share
      // captures, without another timer/real-time yield in Playwright's clock.
      if (passed && key !== target) {
        target = key;
        const rect = point.getBoundingClientRect();
        x = rect.left + rect.width / 2; y = rect.top + rect.height / 2;
      }
      const frame = Math.floor(performance.now() / 67) * 67;
      return { rawX: x, rawY: y, correctedX: x, correctedY: y,
        frameTimestamp: frame, timestamp: Date.now() - (performance.now() - frame), valid: passed };
    } });
    (window as any).__restoreGazeOracle = () => {
      if (previous) Object.defineProperty(s.runtime, 'currentGazePrediction', previous);
      else delete s.runtime.currentGazePrediction;
    };
  }, passed);
  await page.clock.runFor(46000);
  const result = await page.evaluate(() => {
    (window as any).__restoreGazeOracle();
    const s = (window as any).__WECOG_STATE__;
    document.getElementById('continueAfterValidationBtn')!.click();
    return { passed: s.sessionData.gazeValidation.passed, resumed: (window as any).__resumed,
      restored: (window as any).__layoutRestored,
      coverage: s.sessionData.gazeValidation.coverage,
      sampling: s.sessionData.gazeValidation.sampling,
      rows: s.sessionData.cognitiveResults, phase: s.runtime.currentPhase };
  });
  expect(result.passed).toBe(passed);
  expect(result.resumed).toBe(passed ? 1 : 0);
  expect(result.restored).toBe(passed);
  expect(result.coverage.complete).toBe(passed);
  expect(result.sampling.length).toBe(14);
  if (passed) for (const sample of result.sampling) {
    expect(sample.attempted).toBe(60);
    expect(sample.accepted).toBeGreaterThanOrEqual(28);
    expect(sample.accepted).toBeLessThanOrEqual(31);
    expect(sample.duplicate).toBeGreaterThan(0);
  }
  expect(result.rows).toEqual([{ trialId: 'sentinel', qualityValid: true, rt: 321 }]);
  if (passed) expect(result.phase).toBe('cognitive_instruction');
});

test('short recalibration requires a saved boundary and cancellation keeps its gate and accepted results', async ({ page }) => {
  await page.goto(getPageUrl(), { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as any).__WECOG_STATE__?.runtime.sessionRuntime);
  const blocked = await page.evaluate(async () => {
    const s = (window as any).__WECOG_STATE__, r = s.runtime.sessionRuntime;
    s.sessionData.calibrationRecovery = { pending: true, reason: 'face_missing' };
    s.sessionData.cognitiveResults = [{ trialId: 'accepted', qualityValid: true, rt: 321 }];
    r.saveCheckpoint = async () => false;
    try { await r.ensureGazeCalibration(); return false; } catch (_) { return r.requiresGazeCalibration(); }
  });
  expect(blocked).toBe(true);
  await expect(page.locator('#wecog-session-modal')).not.toBeVisible();
  await page.evaluate(() => {
    const w = window as any, s = w.__WECOG_STATE__, r = s.runtime.sessionRuntime;
    s.sessionData.precheck = { pass_fail: true };
    s.runtime.currentPhase = 'cognitive_instruction';
    s.runtime.localAnalyzer = { pendingFrame: new Promise(done => { w.finishPrecheckFrame = done; }) };
    s.runtime.gazeTracker = { isCalibrated: () => true, clearPostCalibrationCorrection() {}, updateScreenSize() {},
      getStatus: () => ({ calibrationScreenSize: { width: visualViewport!.width, height: visualViewport!.height } }) };
    r.saveCheckpoint = async () => true;
    r.startContinuousModules = async () => true;
    r.isAnalysisRunning = () => true;
    (document.querySelector('.container') as HTMLElement).style.display = 'block';
    (document.querySelector('.top-bar') as HTMLElement).style.display = 'none';
    w.recoveryCancelled = false;
    w.pendingCalibration = r.ensureGazeCalibration().catch(() => { w.recoveryCancelled = true; });
  });
  await expect(page.locator('#wecog-session-modal')).toBeVisible();
  await page.locator('#wecog-session-modal button').click();
  await expect(page.locator('#calibrationIntro')).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.currentPhase)).toBe('cognitive_instruction');
  await page.evaluate(() => (window as any).finishPrecheckFrame());
  await expect(page.locator('#calibrationIntro')).toBeVisible();
  await page.locator('#calibrationIntroStartBtn').click();
  await page.waitForFunction(() => (window as any).__gazeCalibrationDebug?.points === 3);
  const result = await page.evaluate(async () => {
    const w = window as any, s = w.__WECOG_STATE__;
    const plan = { points: w.__gazeCalibrationDebug.points, clicks: w.__gazeCalibrationDebug.clicksPerPoint };
    s.runtime.calibrationRecoveryContinuation.restoreLayout();
    const layout = ['.container', '.top-bar'].map(selector => (document.querySelector(selector) as HTMLElement).style.display);
    const { stopParticipantTestLoops } = await import(new URL('js/web-page/tests-updated.js?v=20261124-recovery1', location.href).href);
    stopParticipantTestLoops(); await w.pendingCalibration;
    return { plan, layout, cancelled: w.recoveryCancelled, required: s.runtime.sessionRuntime.requiresGazeCalibration(),
      rows: s.sessionData.cognitiveResults };
  });
  expect(result).toEqual({ plan: { points: 3, clicks: 3 }, layout: ['block', 'none'], cancelled: true, required: true,
    rows: [{ trialId: 'accepted', qualityValid: true, rt: 321 }] });
});

test('real Worker limits delegate selection to precheck and creates a separate candidate canvas', async ({ page }) => {
  await page.goto('/apps/participant-web/js/precheck-analyzer/illumination.js');
  const result = await page.evaluate(async () => {
    const root = new URL('./', location.href).href;
    const source = `self.onmessage = async () => {
      let analyzer;
      const allocations = [], closed = [];
      try {
        self.FilesetResolver = { forVisionTasks: async () => ({}) };
        self.FaceLandmarker = { createFromOptions: async (_files, options) => {
          allocations.push({ delegate: options.baseOptions.delegate, canvas: options.canvas });
          const delegate = options.baseOptions.delegate;
          return { close() { closed.push(delegate); }, detectForVideo() {
            const until = performance.now() + (delegate === 'GPU' ? 35 : 5);
            while (performance.now() < until) {}
            return { faceLandmarks: [Array.from({length:478}, () => ({x:.5,y:.5,z:0}))],
              facialTransformationMatrixes: [{data:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}], faceBlendshapes: [] };
          } };
        } };
        const {PrecheckAnalyzer} = await import(${JSON.stringify(root + 'PrecheckAnalyzer.js')});
        analyzer = new PrecheckAnalyzer({worker:false});
        await analyzer.initialize(); analyzer.reset();
        const canvas = new OffscreenCanvas(640,480);
        for(let i=0;i<8;i++) await analyzer.analyzeFrame(canvas, {timestamp:performance.now(), allowDelegateProbe:false});
        const before = {delegate:analyzer.inferenceDelegate, probe:analyzer.delegateProbeSummary || null};
        for(let i=0;i<8;i++) await analyzer.analyzeFrame(canvas, {timestamp:performance.now(), allowDelegateProbe:true});
        const after = {delegate:analyzer.inferenceDelegate, probe:analyzer.delegateProbeSummary,
          separate:allocations.length===2 && allocations[0].canvas!==allocations[1].canvas};
        analyzer.dispose(); analyzer=null;
        self.postMessage({before,after,closed});
      } catch(e) { analyzer?.dispose(); self.postMessage({error:String(e)}); }
    };`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    try {
      return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Worker probe timed out')), 12000);
        worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
        worker.onerror = () => { clearTimeout(timer); reject(new Error('Worker failed')); };
        worker.postMessage({});
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  });
  expect(result.error).toBeUndefined();
  expect(result.before).toEqual({ delegate: 'GPU', probe: null });
  expect(result.after.delegate).toBe('CPU');
  expect(result.after.separate).toBe(true);
  expect(result.after.probe).toMatchObject({ scope: 'precheck_same_frame', decision: 'cpu_selected', samples: 8, modelBudgetMs: 20 });
  expect(result.closed).toEqual(['GPU', 'CPU']);
});
