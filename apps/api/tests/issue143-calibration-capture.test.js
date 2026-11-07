const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { landmarksForGaze, changeEyelids } = require('./fixtures/gaze-topology');
const load = name => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/gaze-tracker', name)));
const frame = timestamp => ({ timestamp, landmarks: landmarksForGaze(.3, .4),
  eyes: { bothOpen: true }, pose: { yaw: 0, pitch: 0, roll: 0, status: 'stable' } });

test('click capture rejects pre-click, missing, duplicate, reordered and future captures', async () => {
  const { createCalibrationCapture, calibrationCapturePolicy } = await load('calibration-capture.mjs');
  const policy = calibrationCapturePolicy({ x: 50, y: 50 });
  const window = createCalibrationCapture({ start: 100, wallStart: 2000, policy });
  for (const time of [99, undefined, 101, 101, 100, 111]) window.observe(frame(time), 110);
  for (let t = 102; t < 114; t++) window.observe(frame(t), 120);
  const result = window.finish();
  assert.equal(result.summary.accepted, true);
  assert.equal(result.frames.length, policy.maxFrames);
  assert.equal(result.summary.sampling.beforeWindow, 1);
  assert.equal(result.summary.sampling.missingTimestamp, 1);
  assert.equal(result.summary.sampling.duplicate, 2);
  assert.equal(result.summary.outsideWindow, 1);
  assert.throws(() => window.finish());
});

test('a blink before clicking is harmless; a closure inside capture resets the usable run', async () => {
  const { createCalibrationCapture, calibrationCapturePolicy } = await load('calibration-capture.mjs');
  const policy = calibrationCapturePolicy({ x: 50, y: 50 });
  const window = createCalibrationCapture({ start: 100, wallStart: 2000, policy });
  window.observe({ ...frame(99), landmarks: changeEyelids(frame(99).landmarks, { factor: .1 }) }, 100);
  for (let t = 100; t < 104; t++) window.observe(frame(t), t);
  window.observe({ ...frame(104), eyes: { bothOpen: false } }, 104);
  for (let t = 105; t < 105 + policy.minFrames; t++) window.observe(frame(t), t);
  const result = window.finish();
  assert.equal(result.summary.accepted, true);
  assert.equal(result.frames.length, policy.minFrames);
  assert.equal(result.summary.invalidEyes, 1);
  assert.equal(result.summary.interruptedRuns, 1);
});

test('one closed eye and post-filter shortage cannot train even with many attempted frames', async () => {
  const { createCalibrationCapture, calibrationCapturePolicy } = await load('calibration-capture.mjs');
  const policy = calibrationCapturePolicy({ x: 8, y: 92 });
  const window = createCalibrationCapture({ start: 100, wallStart: 2000, policy });
  for (let t = 100; t < 125; t++) window.observe({ ...frame(t), landmarks: changeEyelids(frame(t).landmarks, { leftFactor: .1 }) }, t);
  for (let t = 125; t < 125 + policy.minFrames - 1; t++) window.observe(frame(t), t);
  const result = window.finish();
  assert.equal(result.summary.accepted, false); assert.equal(result.frames.length, 0);
  assert.equal(result.summary.invalidEyes, 25);
});

test('pose rejection resets a run; retry policy never lowers original first-attempt requirements', async () => {
  const { createCalibrationCapture, calibrationCapturePolicy } = await load('calibration-capture.mjs');
  const policy = calibrationCapturePolicy({ x: 50, y: 50 });
  const window = createCalibrationCapture({ start: 100, wallStart: 2000, policy });
  for (let t = 100; t < 104; t++) window.observe(frame(t), t);
  window.observe({ ...frame(104), pose: { yaw: 13, pitch: 0, roll: 0 } }, 104);
  assert.equal(window.finish().summary.accepted, false);
  assert.deepEqual(calibrationCapturePolicy({ x: 50, y: 50, failedClicks: 10 }), policy);
  assert.throws(() => calibrationCapturePolicy({ x: NaN, y: 50 }));
});

test('calibration copies never retain original frame/landmark ownership and finish is bounded', async () => {
  const { createCalibrationCapture, calibrationCapturePolicy } = await load('calibration-capture.mjs');
  const policy = calibrationCapturePolicy({ x: 50, y: 50 });
  const window = createCalibrationCapture({ start: 100, wallStart: 2000, policy });
  const first = frame(100);
  window.observe(first, 100);
  for (let t = 101; t < 180; t++) window.observe(frame(t), t);
  const result = window.finish();
  assert.notEqual(result.frames[0], first.landmarks);
  assert.notEqual(result.frames[0][0], first.landmarks[0]);
  assert.equal(result.frames.length, policy.maxFrames);
  assert.equal('landmarks' in result.summary, false);
});

test('stalled calibration expires; cancellation cannot return partial training data', async () => {
  const { collectCalibrationClick, calibrationCapturePolicy } = await load('calibration-capture.mjs');
  const policy = calibrationCapturePolicy({ x: 50, y: 50 });
  let time = 100;
  const stalled = await collectCalibrationClick({ policy, getFrame: () => frame(100), now: () => time,
    wallNow: () => 2000, sleep: async ms => { time += ms; } });
  assert.equal(stalled.summary.accepted, false); assert.equal(stalled.frames.length, 0);
  assert.ok(time <= 100 + policy.timeoutMs + 8);
  time = 100;
  const cancelled = await collectCalibrationClick({ policy, getFrame: () => frame(time), now: () => time,
    wallNow: () => 2000, isActive: () => time < 180, sleep: async ms => { time += ms; } });
  assert.equal(cancelled.summary.cancelled, true); assert.equal(cancelled.frames.length, 0);
});

test('local feature-copy hook sees only accepted unique captures and does not transfer pixel ownership', async () => {
  const { createCalibrationCapture, calibrationCapturePolicy } = await load('calibration-capture.mjs');
  const { rememberFramePixels, getFramePixels } = await import(pathToFileURL(path.resolve(__dirname,
    '../../participant-web/js/session-runtime/frame-pixels.mjs')));
  const policy=calibrationCapturePolicy({x:50,y:50}), extra=new WeakMap(); let called=0;
  const capture=createCalibrationCapture({start:100,wallStart:2000,policy,onLandmarkCopy:(source,copy)=>{
    called++; assert.ok(getFramePixels(source)); assert.equal(getFramePixels(copy),undefined); extra.set(copy,[1,2,3]);
  }});
  const first=rememberFramePixels(frame(100),{data:new Uint8ClampedArray(4),width:1,height:1});
  capture.observe(first,100); capture.observe(first,101);
  for(let t=101;t<100+policy.minFrames;t++)capture.observe(rememberFramePixels(frame(t),{data:new Uint8ClampedArray(4),width:1,height:1}),t);
  const result=capture.finish(); assert.equal(called,policy.minFrames); assert.equal(result.summary.accepted,true);
  assert.deepEqual(extra.get(result.frames[0]),[1,2,3]);
  assert.equal('data' in result.frames[0],false); assert.equal('pixels' in result.summary,false);
  assert.throws(()=>createCalibrationCapture({start:100,wallStart:2000,policy,onLandmarkCopy:true}));
});

test('shared correction math agrees with original functions, and independent worsening rolls back', async () => {
  const { fitValidationCorrection, calculateValidationMetrics, filterValidationPointsForMetrics, assessCorrectionBenchmark } = await load('validation-metrics.mjs');
  const { fitResidualBias, applyResidualBiasCorrection, evaluateResidualBiasLOOCV, shouldApplyResidualBiasCorrection } = await load('bias-correction.mjs');
  const viewport = { width: 1000, height: 800 };
  const points = [100, 500, 900].flatMap(targetX => [100, 400, 700].map(targetY => ({
    samples: Array.from({ length: 60 }, (_, i) => ({ targetX, targetY,
      gazeX: targetX + 30 + (i % 3 - 1), gazeY: targetY - 20 })) })));
  const filtered = filterValidationPointsForMetrics(points, .8).points;
  const original = fitResidualBias(filtered, viewport), actual = fitValidationCorrection(points, viewport);
  assert.deepEqual(actual.correction, original);
  assert.deepEqual(actual.rawMetrics, calculateValidationMetrics(points, viewport));
  assert.deepEqual(actual.postCalibrationCorrection.correctedInSampleMetrics, calculateValidationMetrics(applyResidualBiasCorrection(filtered, original), viewport));
  assert.deepEqual(actual.postCalibrationCorrection.loocv, evaluateResidualBiasLOOCV(filtered, viewport));
  assert.equal(actual.postCalibrationCorrection.applied, shouldApplyResidualBiasCorrection(actual.postCalibrationCorrection.loocv));
  const independent = points.slice(0, 5).map(p => ({ samples: p.samples.map(s => ({ ...s,
    rawX: s.targetX, rawY: s.targetY, gazeX: s.targetX - 30, gazeY: s.targetY + 20 })) }));
  assert.equal(assessCorrectionBenchmark(independent, viewport, true).independentDecision.accepted, false);
  assert.equal(fitValidationCorrection([], viewport).postCalibrationCorrection.applied, false);
});

test('raw/corrected summaries use distinct coordinates and distinct on-screen counts', async () => {
  const { createMatchedWindow, observeMatchedWindow, finishMatchedWindow } = await import(pathToFileURL(path.resolve(__dirname, '../../autotests/manual/issue143-summary.mjs')));
  const window = createMatchedWindow({ x: 50, y: 50 }, 0, ['raw', 'corrected'],
    { raw: ['rawX', 'rawY'], corrected: ['correctedX', 'correctedY'] }, { width: 100, height: 100 });
  const prediction = { valid: true, rawX: 110, rawY: 50, correctedX: 60, correctedY: 50, onScreen: true };
  observeMatchedWindow(window, 0, {}, { raw: prediction, corrected: prediction });
  const result = finishMatchedWindow(window, 2000);
  assert.equal(result.models.raw.meanErrorPx, 60); assert.equal(result.models.corrected.meanErrorPx, 10);
  assert.equal(result.models.raw.offScreen, 1); assert.equal(result.models.corrected.offScreen, 0);
  assert.equal(result.models.raw.withinTargetSdXPx, 0);
});
