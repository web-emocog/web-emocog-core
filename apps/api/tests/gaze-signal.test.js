const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const gazeRoot = path.resolve(__dirname, '../../participant-web/js/gaze-tracker');

function importGazeModule(name) {
  return import(pathToFileURL(path.join(gazeRoot, name)).href);
}

function importParticipantModule(relativePath) {
  return import(pathToFileURL(path.resolve(gazeRoot, '..', relativePath)).href);
}

function importAttentionModule() {
  const source = fs.readFileSync(path.join(gazeRoot, 'attention-metrics.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function makeLandmarks(irisX, irisY) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  const set = (index, x, y) => {
    landmarks[index] = { x, y };
  };
  set(362, 0.6, 0.5);
  set(263, 0.8, 0.5);
  set(386, 0.7, 0.45);
  set(374, 0.7, 0.55);
  const leftIrisX = 0.7 + irisX * 0.1;
  const leftIrisY = 0.5 + irisY * 0.05;
  for (const [index, dx, dy] of [
    [468, 0, 0], [469, -0.008, 0], [470, 0, -0.008],
    [471, 0.008, 0], [472, 0, 0.008],
  ]) set(index, leftIrisX + dx, leftIrisY + dy);
  set(133, 0.4, 0.5);
  set(33, 0.2, 0.5);
  set(159, 0.3, 0.45);
  set(145, 0.3, 0.55);
  const rightIrisX = 0.3 + irisX * 0.1;
  const rightIrisY = 0.5 + irisY * 0.05;
  for (const [index, dx, dy] of [
    [473, 0, 0], [474, -0.008, 0], [475, 0, -0.008],
    [476, 0.008, 0], [477, 0, 0.008],
  ]) set(index, rightIrisX + dx, rightIrisY + dy);
  set(1, 0.5, 0.58);
  set(234, 0.1, 0.55);
  set(454, 0.9, 0.55);
  set(10, 0.5, 0.2);
  set(152, 0.5, 0.9);
  return landmarks;
}

describe('gaze signal semantics', () => {
  it('resets post-validation gaze availability without discarding validation', async () => {
    const { QCMetrics } = await importParticipantModule('qc-metrics/index.js');
    const qc = new QCMetrics({ screenWidth: 1000, screenHeight: 700 });
    qc._counters.gazeTotal = 1;
    qc._counters.gazeValid = 1;
    qc._counters.gazeOnScreen = 1;
    qc.setValidationData([
      { gazeX: 100, gazeY: 100, targetX: 100, targetY: 100 },
      { gazeX: 200, gazeY: 200, targetX: 200, targetY: 200 },
      { gazeX: 300, gazeY: 300, targetX: 300, targetY: 300 },
    ]);
    qc.resetGazeAvailability();
    assert.equal(qc._counters.gazeTotal, 0);
    assert.equal(qc._validationState.isComplete, true);
  });
  it('keeps repeated attempts separate in the legacy gaze heatmap path', async () => {
    const { buildHeatmaps } = await importParticipantModule('web-page/heatmap.js');
    const base = {
      correctedX: 150,
      correctedY: 75,
      valid: true,
      onScreen: true,
      confidence: 0.9,
      phase: 'cognitive_stimulus',
      blockId: 'vpc',
      trialId: 'trial-1',
      stimulusId: 'cat-1',
      screenWidth: 1000,
      screenHeight: 700,
      stimulusRect: { left: 100, top: 50, width: 200, height: 100 },
    };
    const result = buildHeatmaps([
      { ...base, attempt: 1, t: 1000 },
      { ...base, attempt: 2, t: 1100 },
    ], { screenWidth: 1000, screenHeight: 700 });
    assert.equal(result.perStimulus.length, 2);
    assert.deepEqual(result.perStimulus.map(item => item.attempt), [1, 2]);
    assert.notEqual(result.perStimulus[0].presentationId, result.perStimulus[1].presentationId);
  });

  it('uses corrected input velocity instead of feeding display lag back into smoothing', async () => {
    const { AdaptiveGazeFilter } = await importGazeModule('signal-processing.mjs');
    const filter = new AdaptiveGazeFilter({
      minCutoffHz: 1,
      maxCutoffHz: 12,
      velocityGain: 6,
    });
    filter.update({ x: 0, y: 0 }, 0, { width: 1000, height: 1000 });
    const jump = filter.update({ x: 400, y: 0 }, 33, { width: 1000, height: 1000 });
    const hold = filter.update({ x: 400, y: 0 }, 66, { width: 1000, height: 1000 });
    assert.ok(jump.velocityViewportPerSec > 1);
    assert.equal(hold.velocityViewportPerSec, 0);
    assert.ok(hold.x > jump.x && hold.x < 400);
  });

  it('allows natural head translation but rejects clear head/iris OOD', async () => {
    const { evaluateGazeGate } = await importGazeModule('signal-processing.mjs');
    const naturalMotion = evaluateGazeGate({
      baseConfidence: 0.9,
      irisDistance: { rmsZ: 1, peakZ: 2 },
      headDistance: { rmsZ: 3, peakZ: 5 },
    });
    assert.equal(naturalMotion.accepted, true);

    const headOod = evaluateGazeGate({
      baseConfidence: 0.9,
      irisDistance: { rmsZ: 1, peakZ: 2 },
      headDistance: { rmsZ: 8, peakZ: 12 },
    });
    assert.equal(headOod.accepted, false);
    assert.equal(headOod.rejectionReason, 'head_out_of_distribution');

    const irisOod = evaluateGazeGate({
      baseConfidence: 0.9,
      irisDistance: { rmsZ: 6, peakZ: 11 },
      headDistance: { rmsZ: 1, peakZ: 2 },
    });
    assert.equal(irisOod.accepted, false);
    assert.equal(irisOod.rejectionReason, 'iris_out_of_distribution');
  });

  it('fails closed for malformed feature distributions and landmarks', async () => {
    const {
      fitDistribution,
      distributionDistance,
      evaluateGazeGate,
    } = await importGazeModule('signal-processing.mjs');
    const { extractFeatureGroups } = await importGazeModule('features.js');
    assert.equal(fitDistribution([[1, 2], [Number.NaN, 3]]), null);
    assert.deepEqual(
      distributionDistance([1, Number.POSITIVE_INFINITY], {
        mean: [0, 0],
        std: [1, 1],
      }),
      { rmsZ: Infinity, peakZ: Infinity },
    );
    const invalidGate = evaluateGazeGate({
      baseConfidence: 0.9,
      irisDistance: { rmsZ: Number.NaN, peakZ: 1 },
      headDistance: { rmsZ: 1, peakZ: 1 },
    });
    assert.equal(invalidGate.accepted, false);
    assert.equal(invalidGate.rejectionReason, 'invalid_feature_distribution');

    const malformed = makeLandmarks(0, 0);
    malformed[468].x = Number.NaN;
    assert.equal(extractFeatureGroups(malformed), null);
  });

  it('keeps predictions in the current content viewport after resize', async () => {
    const { default: GazeTracker } = await importGazeModule('GazeTracker.js');
    const tracker = new GazeTracker({ screenWidth: 1000, screenHeight: 500 });
    const values = [-0.75, -0.25, 0.25, 0.75];
    for (const irisY of values) {
      for (const irisX of values) {
        assert.equal(
          tracker.addCalibrationPoint(
            makeLandmarks(irisX, irisY),
            500 + irisX * 400,
            250 + irisY * 180,
          ),
          true,
        );
      }
    }
    assert.equal(tracker.calibrate(), true);
    assert.equal(tracker.setPostCalibrationCorrection({
      kind: 'residual_bias',
      offsetX: 10,
      offsetY: 20,
      source: 'test',
    }), true);
    assert.equal(tracker.setPostCalibrationCorrection({
      matrixX: [1, 0, 0],
      matrixY: [0, 1, 0],
    }), false);
    const before = tracker.predict(makeLandmarks(0.25, -0.25), { timestamp: 0 });
    tracker.updateScreenSize(2000, 1000);
    const after = tracker.predict(makeLandmarks(0.25, -0.25), { timestamp: 33 });
    assert.equal(before.valid, true);
    assert.equal(after.valid, true);
    assert.ok(Math.abs(after.rawX - before.rawX * 2) <= 1);
    assert.ok(Math.abs(after.rawY - before.rawY * 2) <= 1);
    assert.ok(Math.abs(after.correctedX - before.correctedX * 2) <= 1);
    assert.ok(Math.abs(after.correctedY - before.correctedY * 2) <= 1);
  });

  it('applies residual bias only when LOOCV lowers every held-out target error', async () => {
    const {
      applyResidualBiasCorrection,
      evaluateResidualBiasLOOCV,
      fitResidualBias,
      shouldApplyResidualBiasCorrection,
      evaluateIndependentCorrectionBenchmark,
    } = await importGazeModule('bias-correction.mjs');
    const targets = [
      [120, 100], [500, 100], [880, 100],
      [120, 400], [500, 400], [880, 400],
    ];
    const points = targets.map(([targetX, targetY]) => ({
      samples: Array.from({ length: 12 }, (_, index) => ({
        gazeX: targetX - 40 + (index % 3) - 1,
        gazeY: targetY + 25 + (index % 3) - 1,
        targetX,
        targetY,
      })),
    }));
    const correction = fitResidualBias(points, { width: 1000, height: 500 });
    assert.ok(Math.abs(correction.offsetX - 40) < 1);
    assert.ok(Math.abs(correction.offsetY + 25) < 1);
    assert.ok(correction.trajectory.every(step => step.rmsAfterPx <= step.rmsBeforePx));
    const corrected = applyResidualBiasCorrection(points, correction);
    assert.ok(Math.abs(corrected[0].samples[0].gazeX - targets[0][0]) <= 1);
    const loocv = evaluateResidualBiasLOOCV(points, { width: 1000, height: 500 });
    assert.equal(loocv.worsenedTargetCount, 0);
    assert.ok(loocv.loocvRmsHeldOutPx < loocv.rawTargetRmsPx);
    assert.equal(shouldApplyResidualBiasCorrection(loocv), true);

    points[5].samples.forEach(sample => {
      sample.gazeX = sample.targetX + 160;
      sample.gazeY = sample.targetY - 120;
    });
    const inconsistent = evaluateResidualBiasLOOCV(points, { width: 1000, height: 500 });
    assert.ok(inconsistent.worsenedTargetCount > 0);
    assert.equal(shouldApplyResidualBiasCorrection(inconsistent), false);

    const rollback = evaluateIndependentCorrectionBenchmark(
      { accuracyPx: 90, precisionPx: 18, biasX: 40, biasY: 10 },
      { accuracyPx: 96, precisionPx: 18, biasX: 45, biasY: 12 },
    );
    assert.equal(rollback.accepted, false);
    assert.equal(rollback.reason, 'independent_benchmark_regression');
    const accepted = evaluateIndependentCorrectionBenchmark(
      { accuracyPx: 90, precisionPx: 18, biasX: 40, biasY: 10 },
      { accuracyPx: 82, precisionPx: 18.2, biasX: 20, biasY: 5 },
    );
    assert.equal(accepted.accepted, true);
  });

  it('calibrates targets in visual content viewport coordinates', async () => {
    const {
      getContentViewport,
      targetCenterInContentViewport,
      contentToLayoutViewport,
    } = await importGazeModule('viewport-coordinates.mjs');
    const win = {
      innerWidth: 1200,
      innerHeight: 900,
      visualViewport: {
        width: 900,
        height: 700,
        offsetLeft: 10,
        offsetTop: 20,
        scale: 1,
      },
    };
    const element = {
      getBoundingClientRect: () => ({
        left: 110,
        top: 220,
        width: 20,
        height: 20,
      }),
    };
    assert.deepEqual(getContentViewport(win), {
      width: 900,
      height: 700,
      offsetLeft: 10,
      offsetTop: 20,
      scale: 1,
    });
    const target = targetCenterInContentViewport(element, win);
    assert.equal(target.x, 110);
    assert.equal(target.y, 210);
    assert.deepEqual(contentToLayoutViewport(target, win), { x: 120, y: 230 });
  });

  it('keeps monotonic frame time separate from persisted wall time in both analyzers', () => {
    const participantRoot = path.resolve(__dirname, '../../participant-web/js');
    const analyzers = [
      path.join(participantRoot, 'precheck-analyzer.js'),
      path.join(participantRoot, 'precheck-analyzer/PrecheckAnalyzer.js'),
    ];
    for (const analyzerPath of analyzers) {
      const source = fs.readFileSync(analyzerPath, 'utf8');
      assert.match(source, /timestamp,\s*wallTimestamp:\s*Date\.now\(\)/);
      assert.match(source, /timestamp:\s*performance\.now\(\),\s*wallTimestamp:\s*Date\.now\(\)/);
      assert.doesNotMatch(source, /landmarks,\s*blendShapes,\s*timestamp:\s*Date\.now\(\)/);
    }

    const pipeline = fs.readFileSync(
      path.join(participantRoot, 'session-runtime/frame-pipeline.js'),
      'utf8'
    );
    assert.match(pipeline, /timestamp:\s*frame\.timestamp/);
    assert.match(pipeline, /wallTimestamp:\s*frame\.wallTimestamp/);
  });

  it('separates whole-session blink metrics from post-calibration scope', async () => {
    const { buildAttentionMetrics } = await importAttentionModule();
    const base = 1_700_000_000_000;
    const buildEyePhase = (phase, startMs, durationMs, closureStartMs) => {
      const samples = [];
      for (let t = 0; t <= durationMs; t += 33) {
        const closed = t >= closureStartMs && t <= closureStartMs + 330;
        samples.push({
          t: startMs + t,
          phase,
          earAvg: closed ? 0.23 : 0.36,
          leftEAR: closed ? 0.23 : 0.36,
          rightEAR: closed ? 0.23 : 0.36,
          bothOpen: !closed,
        });
      }
      return samples;
    };
    const eyeSignals = [
      ...buildEyePhase('precheck', base, 4_000, 1_500),
      ...buildEyePhase('tracking_test', base + 5_000, 4_000, 1_500),
    ];
    const metrics = buildAttentionMetrics({ eyeSignals, eyeTracking: [] });
    assert.equal(metrics.global.blinkDynamics.blinkCount, 2);
    assert.equal(metrics.global.meta.scopeStartPhase, 'session_first_measured_frame');
    assert.equal(metrics.global.meta.scopeFilterApplied, false);
    assert.equal(metrics.postCalibration.blinkDynamics.blinkCount, 1);
    assert.equal(metrics.postCalibration.meta.scopeStartPhase, 'tracking_test');
    assert.equal(metrics.postCalibration.meta.scopeFilterApplied, true);
  });
});
