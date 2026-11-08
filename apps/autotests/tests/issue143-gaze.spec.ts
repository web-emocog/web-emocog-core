import { test, expect } from '@playwright/test';
import { landmarksForGaze } from '../../api/tests/fixtures/gaze-topology';
import { installGazeAccess } from '../fixtures/gaze-benchmark-auth';

const manualModes = ['', 'ablation', 'axis', 'appearance', 'gradient', 'gradient-temporal', 'gradient-pose', 'tophat', 'tophat-pose'];
const manualUrl = (mode: string) => '/apps/autotests/manual/issue143-gaze.html'
  + (mode === 'tophat-pose' ? '?models=tophat&pose=1' : mode.startsWith('gradient-pose') ? '?models=gradient&pose=1'
    : mode === 'gradient-temporal' ? '?models=gradient&temporal=1' : mode ? '?models=' + mode : '');

test('production calibration counts two fresh click captures and ignores a queued double-click', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-06T12:00:00Z') });
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.sessionRuntime);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(async landmarks => {
    await (window as any).GazeTrackerReady;
    const state = (window as any).__WECOG_STATE__;
    state.sessionData.precheck = { pass_fail: true };
    state.runtime.localAnalyzer = {};
    state.runtime.sessionRuntime.startContinuousModules = async () => true;
    state.runtime.sessionRuntime.isAnalysisRunning = () => true;
    (window as any).captureFixtureTimer = setInterval(() => {
      state.runtime.lastPrecheckResult = { timestamp: performance.now(), landmarks,
        eyes: { bothOpen: true }, pose: { status: 'stable', yaw: 0, pitch: 0, roll: 0 } };
    }, 33);
    const moduleUrl = '/apps/participant-web/js/web-page/tests-updated.js?v=20261108-143l';
    const module = await import(moduleUrl);
    (window as any).calibrationPrepared = module.startCalibration();
  }, landmarksForGaze(0, 0));
  await expect(page.locator('#calibrationIntro')).toBeVisible();
  await page.locator('#calibrationIntroStartBtn').evaluate((button: HTMLElement) => button.click());
  await page.evaluate(() => (window as any).calibrationPrepared);
  const before = await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => [point.style.left, point.style.top]);
  await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => { point.click(); point.click(); });
  await page.clock.runFor(1200);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(1);
  await expect(page.locator('#calibProgressText')).toContainText('(1/2)');
  expect(await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => [point.style.left, point.style.top])).toEqual(before);
  await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => point.click());
  await page.clock.runFor(1200);
  await expect(page.locator('#calibProgressText')).toContainText('(0/2)');
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(2);
  // An in-flight capture must not publish training/UI into a later phase.
  await page.locator('#fullscreenCalibPoint').evaluate((point: HTMLElement) => point.click());
  await page.evaluate(() => { (window as any).__WECOG_STATE__.runtime.currentPhase = 'instruction'; });
  await page.clock.runFor(2200);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.gazeTracker.getStatus().calibrationPoints)).toBe(2);
  await page.evaluate(() => clearInterval((window as any).captureFixtureTimer));
});

for (const mode of manualModes) test(`local manual ${mode || 'default'} check never asks for the camera automatically and Stop releases a late stream`, async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).testCameraRequests = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => {
      (window as any).testCameraRequests++;
      return new Promise(resolve => { (window as any).resolveTestStream = resolve; });
    } } });
  });
  const calls: string[] = [];
  page.on('request', request => { if (/\/api\/|\/ingest|:3000/.test(request.url())) calls.push(request.url()); });
  await page.goto(manualUrl(mode));
  if(mode==='gradient'||mode==='tophat')await expect(page.locator('#durationDescription')).toContainText('Без четырёхминутного интервала');
  if(mode==='gradient-temporal')await expect(page.locator('#durationDescription')).toContainText('4 минуты без проверочных точек');
  if(mode==='gradient-pose'||mode==='tophat-pose')await expect(page.locator('#durationDescription')).toContainText('обычная посадка, чуть ниже и возврат');
  expect(await page.evaluate(() => (window as any).testCameraRequests)).toBe(0);
  await page.locator('#start').click();
  await expect.poll(() => page.evaluate(() => (window as any).testCameraRequests)).toBe(1);
  await page.locator('#stop').click();
  await page.evaluate(() => {
    (window as any).stoppedTracks = 0;
    (window as any).resolveTestStream({ getTracks: () => [{ stop() { (window as any).stoppedTracks++; } }] });
  });
  await expect.poll(() => page.evaluate(() => (window as any).stoppedTracks)).toBeGreaterThan(0);
  await expect(page.locator('#target')).toBeHidden();
  await expect(page.locator('#calibrate')).toBeHidden();
  await expect(page.locator('#start')).toBeEnabled();
  expect(calls).toEqual([]);
});

test('manual target is unobscured on desktop/mobile and instructions stay off the measurement background', async ({ page }, testInfo) => {
  for (const mode of manualModes) for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(manualUrl(mode));
    await page.evaluate(() => {
      document.body.classList.add('running');
      document.getElementById('status')!.textContent = 'Калибровка 1/25 — нажатие 1/2. Смотрите в центр красного круга.';
      const target = document.getElementById('target')!;
      target.hidden = false; target.style.left = '92%'; target.style.top = '8%';
    });
    await expect(page.locator('#instructions')).toBeHidden();
    for (const [x, y] of [[92, 8], [8, 92]]) {
      await page.locator('#target').evaluate((target: HTMLElement, [x, y]) => {
        target.style.left = `${x}%`; target.style.top = `${y}%`;
      }, [x, y]);
      expect(await page.locator('#target').evaluate(target => {
        const rect = target.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id;
      })).toBe('target');
      const targetBox = (await page.locator('#target').boundingBox())!;
      const statusBox = (await page.locator('#status').boundingBox())!;
      expect(targetBox.x < statusBox.x + statusBox.width && targetBox.x + targetBox.width > statusBox.x
        && targetBox.y < statusBox.y + statusBox.height && targetBox.y + targetBox.height > statusBox.y).toBe(false);
    }
    if (process.env.WECOG_ISSUE143_VISUAL_REVIEW === '1') {
      await page.screenshot({ path: testInfo.outputPath(`manual-${mode || 'v3'}-${viewport.width}.png`) });
    }
  }
});

test('eye patch features use only their completed frame pixels without a camera in every engine', async ({ page }) => {
  await page.goto('/apps/autotests/manual/issue143-gaze.html');
  const result=await page.evaluate(async landmarks=>{
    // Browser-served ESM URLs, not TypeScript/Node module resolution paths.
    const urls = ['/apps/participant-web/js/gaze-tracker/eye-patch-features.mjs?v=20261107-143',
      '/apps/participant-web/js/session-runtime/frame-pixels.mjs', '/apps/autotests/fixtures/issue143-eye-image.mjs',
      '/apps/participant-web/js/gaze-tracker/eye-gradient-features.mjs?v=20261107-143g',
      '/apps/participant-web/js/gaze-tracker/eye-tophat-features.mjs?v=20261108-143l'];
    const [{ eyePatchFeaturesForFrame }, { rememberFramePixels }, { syntheticEyeImage }, { eyeGradientFeaturesForFrame }, { eyeTophatFeaturesForFrame }] = await Promise.all(urls.map(url => import(url)));
    const frame={landmarks,frameSize:{width:640,height:480}};
    const missing=eyePatchFeaturesForFrame(frame);
    const gradientMissing=eyeGradientFeaturesForFrame(frame);
    rememberFramePixels(frame,syntheticEyeImage(landmarks,{gazeX:.2,gazeY:-.3}));
    const vector=eyePatchFeaturesForFrame(frame)!;
    const gradient=eyeGradientFeaturesForFrame(frame);
    const tophat=eyeTophatFeaturesForFrame(frame);
    return {missing,length:vector.length,finite:vector.every(Number.isFinite), gradientMissing,
      gradientLength:gradient.length,gradientFinite:gradient.every(Number.isFinite),
      tophatLength:tophat.length,tophatFinite:tophat.every(Number.isFinite),tophatOtherCapture:eyeTophatFeaturesForFrame({...frame}),
      otherCapture:eyePatchFeaturesForFrame({...frame}),gradientOtherCapture:eyeGradientFeaturesForFrame({...frame})};
  },landmarksForGaze(.2,-.3));
  expect(result).toEqual({missing:null,length:120,finite:true,otherCapture:null,
    gradientMissing:null,gradientLength:4,gradientFinite:true,gradientOtherCapture:null,
    tophatLength:320,tophatFinite:true,tophatOtherCapture:null});
});

test('local check initializes the vendored model with synthetic video and tears it down', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Synthetic canvas capture smoke; not a real-camera accuracy test');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#888'; context.fillRect(0, 0, 640, 480);
      const stream = canvas.captureStream(15);
      const timer = setInterval(() => context.fillRect(0, 0, 640, 480), 67);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
      (window as any).syntheticTestStream = stream;
      return stream;
    } } });
  });
  await page.goto('/apps/autotests/manual/issue143-gaze.html');
  await page.locator('#start').click();
  await expect(page.locator('#calibrate')).toBeVisible({ timeout: 40000 });
  await page.locator('#stop').click();
  expect(await page.evaluate(() => (window as any).syntheticTestStream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
  await expect(page.locator('#target')).toBeHidden();
  await page.evaluate(() => {
    const target = document.getElementById('target')!;
    target.hidden = false; target.style.left = '92%'; target.style.top = '8%';
  });
  expect(await page.evaluate(() => {
    const point = document.getElementById('target')!.getBoundingClientRect();
    return document.elementFromPoint(point.left + point.width / 2, point.top + point.height / 2)?.id;
  })).toBe('target'); // The Stop control must not cover the edge calibration point.
});

for (const mode of [...manualModes, 'gradient-pose-stop', 'gradient-pose-timeout', 'developer-spatial', 'developer-posture', 'developer-temporal']) test(`manual ${mode || 'v3'} ${mode.endsWith('-stop') || mode.endsWith('-timeout') ? 'cleans up during a posture prompt' : 'completes two-click calibration and frozen summaries with a synthetic oracle'}`, async ({ page, browserName }) => {
  const cohort = mode.startsWith('developer-');
  const ablation = mode !== '';
  const tophat = mode.startsWith('tophat') || cohort;
  const pose = mode.startsWith('gradient-pose') || mode === 'tophat-pose' || mode === 'developer-posture', temporal = mode === 'gradient-temporal' || mode === 'developer-temporal', gradient = mode === 'gradient' || temporal || pose || tophat;
  test.skip(temporal || pose || tophat ? browserName !== 'webkit' : browserName !== 'chromium' && !(gradient && browserName === 'webkit'),
    'Functional clock oracle only; the full gradient temporal/posture checks run in WebKit. Not webcam accuracy.');
  // Functional virtual-clock replay executes every capture, including the 4-min gap.
  // This is a harness wall-time budget, not a relaxed camera/FPS/accuracy threshold.
  test.setTimeout(temporal ? 240000 : 120000);
  await page.clock.install({ time: new Date('2026-11-06T12:00:00Z') });
  const coordinates = [8, 29, 50, 71, 92].flatMap(y => [8, 29, 50, 71, 92].map(x => [x, y]))
    .concat([15, 50, 85].flatMap(y => [15, 50, 85].map(x => [x, y])))
    .concat([[30,22],[70,22],[22,70],[78,70],[50,63],[50,56],[12,12],[88,12],[12,88],[88,88]]);
  await page.addInitScript(fixtures => {
    (window as any).oracleFixtures = fixtures;
    (window as any).oracleStopped = 0;
    (window as any).oraclePersistenceWrites = 0;
    const setItem = Storage.prototype.setItem, openDb = IDBFactory.prototype.open;
    Storage.prototype.setItem = function(...args) { (window as any).oraclePersistenceWrites++; return setItem.apply(this, args); };
    IDBFactory.prototype.open = function(...args) { (window as any).oraclePersistenceWrites++; return openDb.apply(this, args); };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({
      getTracks: () => [{ addEventListener() {}, stop() { (window as any).oracleStopped++; } }]
    }) } });
    Object.defineProperties(HTMLVideoElement.prototype, {
      srcObject: { configurable: true, get() { return (this as any).testStream; }, set(stream) { (this as any).testStream = stream; } },
      videoWidth: { configurable: true, get: () => 640 }, videoHeight: { configurable: true, get: () => 480 }
    });
    HTMLVideoElement.prototype.play = async () => {};
  }, Object.fromEntries(coordinates.map(([x, y]) => [`${x}:${y}`, landmarksForGaze((x - 50) / 50, (y - 50) / 50)])));
  // Ground-truth target generates SYNTHETIC INPUT in this test only. The real
  // predictor is unchanged and never receives the target as context.
  await page.route('**/precheck-analyzer/PrecheckAnalyzer.js?*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import { rememberFramePixels } from '/apps/participant-web/js/session-runtime/frame-pixels.mjs';
    import { syntheticEyeImage } from '/apps/autotests/fixtures/issue143-eye-image.mjs';
    let imageKey, artificialPixels;
    export default class Analyzer {
      backend = 'synthetic_oracle'; async initialize() { return true; } dispose() {}
      async analyzeFrame() {
        const target = document.getElementById('target');
        const key = parseFloat(target.style.left) + ':' + parseFloat(target.style.top);
        const source = window.oracleFixtures[key] || window.oracleFixtures['50:50'];
        // Artificial capture translation, not a model input or a physical pose claim.
        const lowered = document.body.dataset.posePhase === 'lowered';
        const landmarks = lowered ? source.map(p => ({...p, y: p.y + .015})) : source;
        const frame = { timestamp: performance.now(), wallTimestamp: Date.now(), landmarks, frameSize: { width:640,height:480 },
          eyes: { bothOpen: true }, pose: { status: 'stable', yaw: 0, pitch: 0, roll: 0 } };
        ${mode === 'appearance' || gradient ? `
          // Only the artificial generator reuses its ONE unchanged image.
          // Every 33 ms callback still creates a new capture owner/timestamp;
          // the actual feature extractor/predictor executes on every capture.
          const sceneKey = key + ':' + lowered;
          if (imageKey !== sceneKey) {
            imageKey = sceneKey; artificialPixels = syntheticEyeImage(landmarks, {
              gazeX:(parseFloat(target.style.left)||50)/50-1,gazeY:(parseFloat(target.style.top)||50)/50-1 });
          }
          return rememberFramePixels(frame, artificialPixels);` : 'return frame;'}
      }
    }` }));
  await page.route('**/session-runtime/video-frames.mjs?*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export function observeVideoFrames(video, callback) {
      const id = setInterval(() => callback(performance.now()), 33);
      return { stop() { clearInterval(id); } };
    }` }));
  if (cohort) await installGazeAccess(page);
  await page.goto(cohort ? '/apps/participant-web/tools/gaze-benchmark.html?protocol=' + mode.slice('developer-'.length) : manualUrl(mode));
  if (cohort) {
    await page.locator('#consent').check();
    await expect(page.locator('#start')).toBeEnabled();
  }
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const initialWrites = await page.evaluate(() => (window as any).oraclePersistenceWrites);
  await page.locator('#start').evaluate((button: HTMLElement) => button.click());
  await expect(page.locator('#calibrate')).toBeVisible();
  if (mode === 'appearance' || gradient) await page.clock.runFor(1000);
  await page.locator('#calibrate').evaluate((button: HTMLElement) => button.click());
  for (let click = 0; click < 50; click++) {
    await page.locator('#target').evaluate((point: HTMLElement) => point.click());
    await page.clock.runFor(1000);
  }
  if (pose) {
    await page.clock.runFor(50000);
    for (const phase of ['natural', 'lowered', 'returned']) {
      await expect(page.locator('body')).toHaveAttribute('data-pose-phase', phase);
      await expect(page.locator('#poseContinue')).toBeVisible();
      await expect(page.locator('#target')).toBeHidden();
      await expect(page.locator('#download')).toBeHidden();
      if (mode.endsWith('-stop') || mode.endsWith('-timeout')) {
        if (mode.endsWith('-stop')) await page.locator('#stop').evaluate((button: HTMLElement) => button.click());
        await page.clock.runFor(61000);
        await expect(page.locator('#poseContinue')).toBeHidden();
        await expect(page.locator('#target')).toBeHidden();
        await expect(page.locator('#download')).toBeHidden();
        await expect(page.locator('#start')).toBeEnabled();
        expect(await page.evaluate(() => (window as any).oracleStopped)).toBe(1);
        return;
      }
      await page.locator('#poseContinue').evaluate((button: HTMLElement) => { button.click(); button.click(); });
      await page.clock.runFor(16000);
    }
  } else if (temporal) {
    await page.clock.runFor(80000);
    await expect(page.locator('#status')).toContainText('Непрерывный интервал 4 минуты');
    await expect(page.locator('#target')).toBeHidden();
    await expect(page.locator('#download')).toBeHidden();
    await page.clock.runFor(260000);
  } else await page.clock.runFor(gradient ? 100000 : 340000);
  await expect(page.locator('#download')).toBeVisible();
  const report = JSON.parse((await page.locator('#result').textContent())!);
  expect(report.version).toBe(cohort ? 'gaze_benchmark.v1' : tophat ? 'issue143_eye_tophat.v10' : pose ? 'issue143_eye_gradient_pose.v9' : temporal ? 'issue143_eye_gradient_temporal.v8' : gradient ? 'issue143_eye_gradient.v7' : mode === 'appearance' ? 'issue143_eye_patch.v6' : mode === 'axis' ? 'issue143_axis_regularization.v5' : ablation ? 'issue143_factorial_geometry.v4' : 'issue143_production_calibration.v3');
  if (cohort) {
    expect(report.benchmark.completed).toBe(true);
    expect(report.benchmark.protocol).toBe(mode.slice('developer-'.length) + '.v1');
    expect(report.benchmark.counters.calibrationAccepted).toBe(50);
    const writes = await page.evaluate(() => (window as any).oraclePersistenceWrites);
    expect(writes).toBe(initialWrites);
    expect(JSON.stringify(report)).not.toMatch(/synthetic@example|"(?:email|token|userAgent|deviceId)"\s*:/);
  }
  expect(report.calibration.clicks).toHaveLength(50);
  expect(report.calibration.repeatability).toHaveLength(25);
  if (ablation) {
    if (mode === 'axis') {
      expect(Object.keys(report.models)).toHaveLength(12);
      expect(report.models.axis_mixed.ridgeSelection.policy).toBe('per_axis_target_group_cv');
      expect(report.models.axis_mixed.ridgeSelection.curve).toHaveLength(4);
      expect(report.models.axis_auto.ridgeSelection.policy).toBe('per_axis_basis_target_group_cv');
      expect(report.models.axis_auto.ridgeSelection.curve).toHaveLength(8);
      expect(report.models.baseline.ridgeSelection.policy).toBe('joint_xy_target_group_cv');
      expect(report.models.quadratic_lambda_0p01.ridgeSelection.lambdaX).toBe(.01);
    } else if (gradient) {
      expect(Object.keys(report.models)).toEqual(['baseline','eye_patch','eye_gradient_all',tophat?'eye_tophat':'eye_gradient']);
      if(tophat) {
        expect(report.models.eye_tophat.featureMethod).toBe('eye_tophat_ridge.experimental.v1');
        expect(report.models.eye_tophat.experimentalModel.featureCount).toBe(320);
        expect(report.models.eye_tophat.ridgeSelection.curve).toHaveLength(5);
        expect(report.eyeImageFrames.tophatMissing).toBe(0);
      } else {
        expect(report.models.eye_gradient.featureMethod).toBe('eye_gradient_iris.experimental.v1');
        expect(report.models.eye_gradient.experimentalModel.featureCount).toBe(4);
        expect(report.models.eye_gradient.ridgeSelection.curve).toHaveLength(5);
        expect(report.eyeImageFrames.lateralMissing).toBe(0);
      }
      expect(report.models.eye_gradient_all.featureMethod).toBe('eye_gradient_all_iris.experimental.v1');
      expect(report.eyeImageRuntimeMs.frames).toBeGreaterThan(0);
      expect(report.eyeImageFrames.allMissing).toBe(0);
      expect(report.calibrationFramePolicy).toBe(tophat?'intersection_of_full_gradient_all_tophat_before_all_model_averages'
        :'intersection_of_full_gradient_all_gradient_before_all_model_averages');
      expect(report.calibration.clicks.every((p:any)=>p.commonEyeImageFrames>=p.minFrames)).toBe(true);
      expect(report.intervalMs).toBe(temporal ? 240000 : 0);
      expect(report.temporalScope).toBe(pose ? 'posture_probe_not_long_interval_drift'
        : temporal ? 'same_targets_before_after_no_within_interval_accuracy' : 'spatial_only_no_drift_measurement');
      if (temporal) {
        expect(report.temporalGap.elapsedMs).toBe(240000);
        expect(report.temporalGap.completedCaptures).toBeGreaterThan(7000);
        expect(report.temporalGap.cameraNotifications).toBeGreaterThanOrEqual(report.temporalGap.completedCaptures);
        expect(report.temporalGap.scope).toBe('interval_capture_counts_not_gaze_accuracy');
        expect(report.after.map((r: any) => r.targetPercent)).toEqual(report.before.map((r: any) => r.targetPercent));
      }
      expect(report.eyeImageStorageScope).toBe('transient_only_no_images_features_or_weights_in_export');
    } else if (mode === 'appearance') {
      expect(Object.keys(report.models)).toEqual(['baseline','axis_auto','eye_patch','eye_patch_core']);
      expect(report.models.eye_patch.featureMethod).toBe('eye_patch_ridge.experimental.v1');
      expect(report.models.eye_patch.ridgeSelection.curve).toHaveLength(5);
      expect(report.models.eye_patch_core.featureMethod).toBe('eye_patch_core_ridge.experimental.v1');
      expect(report.models.eye_patch_core.experimentalModel.featureCount).toBe(24);
      expect(report.eyePatchFrames.missing).toBe(0);
      expect(report.eyePatchRuntimeMs.frames).toBeGreaterThan(0);
      expect(Number.isFinite(report.models.eye_patch.calibrationRuntimeMs.total)).toBe(true);
      expect(report.calibrationFramePolicy).toBe('intersection_of_full_core_before_all_model_averages');
      expect(report.eyePatchImagesStored || report.eyePatchFeaturesStored).toBe(false);
      expect(report.calibration.clicks.every((p:any)=>p.eyePatchUsableFrames>=p.minFrames && p.eyePatchCoreUsableFrames>=p.minFrames
        && p.eyePatchCommonUsableFrames>=p.minFrames)).toBe(true);
    } else expect(Object.keys(report.models)).toEqual(['baseline', 'pixel_quadratic', 'normalized_linear', 'pixel_linear']);
    expect(report.comparison).toBe(mode === 'axis' || mode === 'appearance' || gradient
      ? 'same_captures_common_baseline_gate_calibration_only_model_selection'
      : 'same_captures_common_baseline_gate_no_model_selection');
    expect(Object.values(report.models).every((model: any) => model.clicksPerPoint === 2 && model.calibrationFrames.accepted > 0 && model.predictorRuntimeMs.errors === 0)).toBe(true);
    const checkedRows=pose?report.poseProbe.stages.flatMap((stage: any) => stage.rows)
      : gradient?[...report.before,...report.after]:report.after;
    expect(checkedRows.every((row: any) => Object.entries(row.signals).every(([name,s]: any) =>
      name.startsWith('eye_') ? Number.isFinite(s.meanErrorPx) : s.meanErrorPx < 10))).toBe(true);
    expect(checkedRows.every((row: any) => row.comparisons.length === (mode === 'axis' ? 22 : 6) && row.comparisons.every((p: any) => p.commonAccepted > 40))).toBe(true);
    expect(checkedRows.every((row: any) => row.baselineNuisance.frames > 40 && row.baselineNuisance.mean.length === 11 && !row.baselineNuisance.samples)).toBe(true);
  } else {
    expect(report.model.clicksPerPoint).toBe(2);
    expect(report.after.every((row: any) => row.signals.raw.meanErrorPx < 10 && row.signals.corrected.meanErrorPx < 10)).toBe(true);
  }
  if (pose) {
    expect(report.before).toBeUndefined(); expect(report.after).toBeUndefined();
    expect(report.poseProbe.scope).toBe('instructed_posture_change_then_return_not_ground_truth_pose');
    const stages = report.poseProbe.stages;
    expect(stages.map((stage: any) => stage.id)).toEqual(['natural', 'lowered', 'returned']);
    const positions = [[50,56],[12,12],[88,12],[12,88],[88,88]].map(([x,y]) => ({ x,y }));
    for (const stage of stages) expect(stage.rows.map((row: any) => row.targetPercent)).toEqual(positions);
    for (let i = 0; i < 5; i++) {
      const eyeMidY = (stage: number) => {
        const n = stages[stage].rows[i].baselineNuisance;
        return n.mean[n.fields.indexOf('eyeMidY')];
      };
      expect(eyeMidY(1) - eyeMidY(0)).toBeCloseTo(.015, 8);
      expect(eyeMidY(2)).toBeCloseTo(eyeMidY(0), 8);
    }
    await expect(page.locator('#poseContinue')).toBeHidden();
  } else {
    expect(report.before).toHaveLength(9); expect(report.after).toHaveLength(gradient && !temporal ? 0 : 9);
  }
  expect(report.rawVideoStored || report.rawLandmarksStored || report.rawGazeStored).toBe(false);
  expect(JSON.stringify(report)).not.toMatch(/"(?:landmarks|pixels|irisFeatures|headFeatures|weights|modelX|modelY|featureVectors)"\s*:/);
  if (!cohort) expect(await page.evaluate(() => (window as any).oraclePersistenceWrites)).toBe(0);
  expect(await page.evaluate(() => (window as any).oracleStopped)).toBeGreaterThan(0);
  await expect(page.locator('#target')).toBeHidden();
  if (gradient) {
    const downloading=page.waitForEvent('download');
    await page.locator('#download').evaluate((button:HTMLElement)=>button.click());
    const download=await downloading;
    if (cohort) expect(download.suggestedFilename()).toBe(`wecog-gaze-${report.benchmark.protocol}-${report.benchmark.runId}.json`);
    else expect(download.suggestedFilename()).toBe(tophat ? 'wecog-issue143-eye-tophat-v10.json' : pose ? 'wecog-issue143-eye-gradient-pose-v9.json'
      : temporal ? 'wecog-issue143-eye-gradient-temporal-v8.json' : 'wecog-issue143-eye-gradient-v7.json');
    await download.cancel();
  }
});

test('canonical live QC sees corrected off-screen predictions without a display point exactly once', async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  await page.waitForFunction(() => (window as any).handleGazeUpdate && (window as any).GazeTracker);
  const result = await page.evaluate(async () => {
    await (window as any).GazeTrackerReady;
    const state = (window as any).__WECOG_STATE__;
    state.flags.isRecording = false;
    const points: any[] = [];
    state.runtime.qcMetrics = { isRunning: () => true, addGazePoint: (point: any) => points.push(point) };
    state.runtime.gazeTracker = { isCalibrated: () => true };
    for (const gaze of [
      { valid: true, correctedX: 80, correctedY: 90, displayX: 10, displayY: 20, onScreen: true },
      { valid: true, correctedX: innerWidth + 100, correctedY: 90, displayX: null, displayY: null, onScreen: false },
      { valid: false, correctedX: 80, correctedY: 90, displayX: 10, displayY: 20, onScreen: true },
    ]) (window as any).handleGazeUpdate(gaze);
    return { points, method: state.sessionData.tech.gazeQcSignalMethod, outsideX: innerWidth + 100 };
  });
  expect(result.points).toEqual([{ x: 80, y: 90, onScreen: true }, { x: result.outsideX, y: 90, onScreen: false }, null]);
  expect(result.method).toBe('corrected_validity.v1');
});

test('canonical loader uses anatomical eye pairing and persists feature provenance without camera', async ({ page }) => {
  const failures: string[] = [];
  page.on('requestfailed', request => failures.push(new URL(request.url()).pathname + ': ' + request.failure()?.errorText));
  page.on('pageerror', error => failures.push(error.message));
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
  const fixture = [-.8, -.4, 0, .4, .8].flatMap(x => [-.8, -.4, 0, .4, .8].map(y => ({
    points: landmarksForGaze(x, y), targetX: 735 + x * 700, targetY: 478 + y * 440,
  })));
  const predicted = landmarksForGaze(.6, -.6, { leftShiftY: .004 });
  await page.goto('/apps/participant-web/mvp_with_precheck_1-updated.html');
  try {
    await page.waitForFunction(() => (window as any).handleGazeUpdate && (window as any).GazeTracker, undefined, { timeout: 15000 });
  } catch (error) { throw new Error('Canonical startup failed: ' + JSON.stringify(failures) + '; ' + String(error)); }
  const result = await page.evaluate(async ({ fixture, predicted }) => {
    await (window as any).GazeTrackerReady;
    const tracker = new (window as any).GazeTracker({ screenWidth: 1470, screenHeight: 956 });
    fixture.forEach(row => tracker.addCalibrationPoint(row.points, row.targetX, row.targetY));
    if (!tracker.calibrate()) throw new Error('Synthetic calibration failed');
    const gaze = tracker.predict(predicted, { timestamp: 240000 });
    (window as any).handleGazeUpdate(gaze);
    return { valid: gaze.valid, rawX: gaze.rawX, rawY: gaze.rawY,
      method: (window as any).__WECOG_STATE__.sessionData.tech.gazeFeatureMethod,
      statusMethod: tracker.getStatus().featureMethod,
      calibrationSampling: (window as any).__WECOG_STATE__.sessionData.tech.gazeCalibrationSampling };
  }, { fixture, predicted });
  expect(result.valid).toBe(true);
  expect(result.rawX).toBeCloseTo(1155, 0);
  expect(result.rawY).toBeCloseTo(214, 0);
  expect(result.method).toBe('same_eye_iris.v2');
  expect(result.statusMethod).toBe(result.method);
  expect(result.calibrationSampling).toBe('open_eye_calibration.v1');
});

for (const language of ['ru', 'en']) test(`spatial accuracy caveat is visible beside AOI/QC in ${language}`, async ({ page }, testInfo) => {
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/analytics/session-card');
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  if (language === 'en') await page.locator('#langEn').click();
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('.analytics-heatmap-canvas').first()).toBeVisible();
  await expect(page.locator('[data-gaze-spatial-qc]').first()).toContainText(language === 'en' ? 'Signal availability ≠ spatial accuracy' : 'Доступность сигнала ≠ пространственная точность');
  await page.evaluate(() => {
    const production = (window as any).EmocogAnalyticsProduction;
    const channels = production.store.state.summaryResponse.data.qcChannels;
    channels.find(channel => channel.channel === 'gaze').spatialAccuracy = {
      version: 'gaze_spatial_qc.v1', validationStatus: 'passed', meanErrorPx: 148.4, meanErrorPct: 8.8,
      radialErrorSdPx: 80.6, scope: 'pre_session_only', driftStatus: 'not_measured', aoiSuitability: 'not_established',
    };
    production.store.emit();
  });
  await expect(page.locator('[data-gaze-spatial-qc]').first()).toContainText('148.4 px (8.8%)');
  await page.goto('/apps/web/researcher.html?analyticsPreview=1#/analytics/data-quality');
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('[data-gaze-spatial-qc]').first()).toContainText(language === 'en' ? 'Drift during the task was not measured' : 'Дрейф во время задания не измерялся');
  const pdfText = await page.evaluate(() => {
    const body = document.getElementById('analyticsProductionBody')!;
    const progress = document.createElement('span'); progress.setAttribute('role', 'status');
    progress.textContent = 'TRANSIENT_PROGRESS_NOT_IN_PDF'; body.appendChild(progress);
    const text = (window as any).EmocogAnalyticsPdf.capture(body).text;
    progress.remove(); return text;
  });
  expect(pdfText).toContain(language === 'en' ? 'Drift during the task was not measured' : 'Дрейф во время задания не измерялся');
  expect(pdfText).not.toContain('TRANSIENT_PROGRESS_NOT_IN_PDF');
  if (process.env.WECOG_ISSUE143_VISUAL_REVIEW === '1') {
    await page.locator('[data-gaze-spatial-qc]').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('spatial-qc.png') });
  }
  if (process.env.WECOG_ISSUE143_PDF_REVIEW === '1' && language === 'ru' && testInfo.project.name === 'webkit') {
    const download = page.waitForEvent('download');
    await page.locator('#analyticsPdfDownload').click();
    await (await download).saveAs(testInfo.outputPath('spatial-qc.pdf'));
  }
});
