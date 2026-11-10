const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data/issue143-summarize-gradient.mjs')));
const names = ['baseline', 'eye_patch', 'eye_gradient_all', 'eye_gradient'];
const methods = ['same_eye_iris.v2', 'eye_patch_ridge.experimental.v1',
  'eye_gradient_all_iris.experimental.v1', 'eye_gradient_iris.experimental.v1'];

// Entirely artificial summary, not a participant export or biometric fixture.
function fixture() {
  return { version: 'issue143_eye_gradient.v7', intervalMs: 0,
    temporalScope: 'spatial_only_no_drift_measurement', after: [],
    models: Object.fromEntries(names.map((name, i) => [name, { featureMethod: methods[i], ridgeLambda: 1,
      targetCvRmsPx: 12, correction: { selected: false, independentDecision: { reason: 'correction_not_applied' } } }])),
    before: Array.from({ length: 9 }, (_, index) => {
      const accepted = index ? 1 : 3, mean = index ? 20 : 10;
      return { targetIndex: index, analyzed: 4, signals: Object.fromEntries(names.flatMap(name => ['raw', 'corrected'].map(type => [name + '.' + type,
        { attempted: 4, accepted: name === 'baseline' ? accepted : 1, offScreen: name === 'baseline' ? 1 : 0,
          meanErrorPx: name === 'baseline' ? mean : 7, rmsErrorPx: name === 'baseline' ? mean : 7,
          biasXPx: name === 'baseline' ? mean : 7, biasYPx: 0, withinTargetSdXPx: 3, withinTargetSdYPx: 4 }]))),
        comparisons: names.slice(1).flatMap(name => ['raw', 'corrected'].map(type => ({ baseline: 'baseline.' + type,
          candidate: name + '.' + type, commonAccepted: 1, candidateMinusBaselineMeanErrorPx: -2 }))) };
    }) };
}

test('issue143 gradient analysis separates weighted marginal errors from common-frame deltas', async () => {
  const { summarizeGradientReport } = await load(); const source = fixture();
  const result = summarizeGradientReport(source), b = result.before.signals['baseline.raw'];
  assert.equal(b.accepted, 11); assert.equal(b.attempted, 36);
  assert.equal(b.sampleWeightedMeanErrorPx, 190 / 11);
  assert.equal(b.equalTargetMeanErrorPx, 170 / 9);
  assert.equal(b.rmsErrorPx, Math.sqrt(3500 / 11));
  assert.equal(b.withinTargetRmsSpreadPx, 5);
  assert.equal(result.before.comparisons[0].candidateMinusBaselineMeanErrorPx, -2);
  assert.equal(result.before.comparisons[0].commonAbsoluteErrorsStored, false);
  assert.notEqual(result.before.signals['eye_patch.raw'].sampleWeightedMeanErrorPx - b.sampleWeightedMeanErrorPx, -2);
  assert.equal(result.before.comparisons[0].betterTargets, 9);
  assert.equal(source.before[0].signals['baseline.raw'].accepted, 3);
});

test('issue143 short check cannot become zero drift; absent signals stay null', async () => {
  const { summarizeGradientReport } = await load(); const source = fixture();
  for (const w of source.before) {
    for (const s of Object.values(w.signals)) Object.assign(s, { accepted: 0, offScreen: 0, meanErrorPx: null });
    for (const c of w.comparisons) Object.assign(c, { commonAccepted: 0, candidateMinusBaselineMeanErrorPx: null });
  }
  const result = summarizeGradientReport(source);
  assert.equal(result.before.signals['baseline.raw'].sampleWeightedMeanErrorPx, null);
  assert.equal(result.before.signals['baseline.raw'].missingFraction, 1);
  assert.equal(result.before.comparisons[0].candidateMinusBaselineMeanErrorPx, null);
  assert.equal(result.after.signals['baseline.raw'].missingFraction, null);
  assert.equal(result.after.signals['baseline.raw'].rmsErrorPx, null);
  assert.equal(result.driftAssessment.available, false);
});

test('issue143 gradient analysis fails closed on incompatible or inconsistent summaries', async () => {
  const { summarizeGradientReport } = await load();
  for (const change of [r => { r.version = 'legacy'; }, r => { r.before.pop(); },
    r => { r.after.push(r.before[0]); }, r => { r.intervalMs = 240000; },
    r => { r.before[0].comparisons[0].commonAccepted = 2; },
    r => { r.before[0].comparisons.pop(); },
    r => { r.before[0].targetIndex = r.before[1].targetIndex; },
    r => { r.before[0].signals['baseline.raw'].meanErrorPx = NaN; }]) {
    const source = fixture(); change(source);
    assert.throws(() => summarizeGradientReport(source), /invalid_gradient_summary/);
  }
});

test('issue143 local analysis does not echo arbitrary export fields or retain input references', async () => {
  const { summarizeGradientReport } = await load(); const source = fixture();
  source.rawFrames = ['PRIVATE_SENTINEL']; source.invitation = 'PRIVATE_SENTINEL';
  source.models.baseline.rawImages = 'PRIVATE_SENTINEL';
  const result = summarizeGradientReport(source);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  source.models.baseline.correction.selected = true;
  assert.equal(result.models.baseline.correctionSelected, false);
});

function temporalFixture() {
  const source = fixture();
  for (const w of source.before) w.targetPercent = { x: 10 + w.targetIndex * 10, y: 40 };
  return { ...source, version: 'issue143_eye_gradient_temporal.v8', intervalMs: 240000,
    temporalScope: 'same_targets_before_after_no_within_interval_accuracy',
    temporalGap: { elapsedMs: 240007, completedCaptures: 4500, cameraNotifications: 7200,
      scope: 'interval_capture_counts_not_gaze_accuracy' },
    after: structuredClone(source.before).reverse() };
}

test('temporal gradient analysis pairs the same targets, not frame counts or array order', async () => {
  const { summarizeGradientReport } = await load(), source = temporalFixture();
  for (const w of source.after) {
    const s = w.signals['baseline.raw'];
    if (w.targetIndex === 0) { s.meanErrorPx += 90; s.rmsErrorPx += 90; }
    s.biasXPx -= w.targetIndex === 0 ? 9 : 1;
    s.biasYPx += w.targetIndex === 0 ? 1 : -1;
  }
  source.temporalGap.unexpectedPrivateField = 'PRIVATE_SENTINEL';
  const result = summarizeGradientReport(source);
  assert.equal(result.version, 'issue143_gradient_analysis.v2');
  assert.equal(result.temporalGap.elapsedMs, 240007);
  assert.equal(result.temporalComparison.withinIntervalAccuracyAvailable, false);
  assert.deepEqual(result.temporalComparison.signals['baseline.raw'], {
    matchedTargets: 9, meanErrorDeltaPx: 10, medianTargetErrorDeltaPx: 0,
    meanBiasDeltaXPx: -17 / 9, meanBiasDeltaYPx: -7 / 9,
    worsenedTargets: 1, shiftedLeftTargets: 9, shiftedUpTargets: 8,
  });
  assert.notEqual(result.after.signals['baseline.raw'].sampleWeightedMeanErrorPx
    - result.before.signals['baseline.raw'].sampleWeightedMeanErrorPx, 10);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
});

test('temporal gradient analysis reports unmatched or missing targets explicitly', async () => {
  const { summarizeGradientReport } = await load(), source = temporalFixture();
  for (const w of source.after) {
    for (const s of Object.values(w.signals)) Object.assign(s, { accepted: 0, offScreen: 0, meanErrorPx: null });
    for (const p of w.comparisons) Object.assign(p, { commonAccepted: 0, candidateMinusBaselineMeanErrorPx: null });
  }
  const stats = summarizeGradientReport(source).temporalComparison.signals['baseline.raw'];
  assert.equal(stats.matchedTargets, 0);
  assert.equal(stats.meanErrorDeltaPx, null);
  assert.equal(stats.meanBiasDeltaXPx, null);
  assert.equal(stats.medianTargetErrorDeltaPx, null);
});

test('temporal gradient analysis rejects a short gap or different screen targets', async () => {
  const { summarizeGradientReport } = await load();
  for (const change of [r => { r.temporalGap.elapsedMs = 239999; },
    r => { r.temporalGap.scope = 'accuracy'; },
    r => { r.after[0].targetPercent.y += 1; }, r => { r.after[0].targetIndex = r.after[1].targetIndex; },
    r => { r.before[0].targetPercent.x = 101; }, r => { r.after.pop(); }]) {
    const source = temporalFixture(); change(source);
    assert.throws(() => summarizeGradientReport(source), /invalid_gradient_summary/);
  }
});

function poseFixture() {
  const source = fixture();
  const rows = source.before.slice(0,5).map(w => ({ ...w, targetPercent: { x: 20 + 10 * w.targetIndex, y: 55 } }));
  delete source.before; delete source.after;
  return { ...source, version: 'issue143_eye_gradient_pose.v9', temporalScope: 'posture_probe_not_long_interval_drift',
    poseProbe: { scope: 'instructed_posture_change_then_return_not_ground_truth_pose',
      stages: ['natural','lowered','returned'].map(id => ({ id, rows: structuredClone(rows) })) } };
}

test('posture gradient analysis compares A-B-A labels and signed shifts without claiming ground-truth motion', async () => {
  const { summarizeGradientReport } = await load(), source = poseFixture();
  for (const row of source.poseProbe.stages[1].rows) {
    for (const s of Object.values(row.signals)) { s.biasYPx -= 100; s.meanErrorPx += 90; s.rmsErrorPx += 90; }
  }
  const result = summarizeGradientReport(source);
  assert.equal(result.version, 'issue143_gradient_analysis.v3');
  assert.equal(result.before, undefined);
  assert.equal(result.stages.length, 3);
  assert.equal(result.changes.loweredMinusNatural.signals['eye_patch.raw'].meanBiasDeltaYPx, -100);
  assert.equal(result.changes.loweredMinusNatural.signals['eye_patch.raw'].shiftedUpTargets, 5);
  assert.equal(result.changes.returnedMinusNatural.signals['eye_patch.raw'].meanBiasDeltaYPx, 0);
});

test('posture gradient analysis rejects incomplete or mismatched A-B-A stages', async () => {
  const { summarizeGradientReport } = await load();
  for (const change of [r => { r.poseProbe.stages[1].id = 'unknown'; },
    r => { r.poseProbe.stages[2].rows[0].targetPercent.x = 10; },
    r => { r.poseProbe.stages[1].rows.pop(); }, r => { r.intervalMs = 1; }]) {
    const source = poseFixture(); change(source);
    assert.throws(() => summarizeGradientReport(source), /invalid_gradient_summary/);
  }
});

function tophatFixture(pose = true) {
  const source = pose ? poseFixture() : fixture();
  source.version = 'issue143_eye_tophat.v10';
  source.models.eye_tophat = { ...source.models.eye_gradient, featureMethod: 'eye_tophat_ridge.experimental.v1' };
  delete source.models.eye_gradient;
  const windows = pose ? source.poseProbe.stages.flatMap(s => s.rows) : source.before;
  for (const row of windows) {
    for (const signal of ['raw','corrected']) {
      row.signals['eye_tophat.' + signal] = row.signals['eye_gradient.' + signal];
      delete row.signals['eye_gradient.' + signal];
    }
    for (const pair of row.comparisons) pair.candidate = pair.candidate.replace('eye_gradient.', 'eye_tophat.');
  }
  return source;
}

test('v10 analysis preserves its different fourth model for both pose and short checks', async () => {
  const { summarizeGradientReport } = await load();
  for (const pose of [true, false]) {
    const source = tophatFixture(pose), result = summarizeGradientReport(source);
    assert.equal(result.version, 'issue143_gradient_analysis.v4');
    assert.equal(result.models.eye_tophat.featureMethod, 'eye_tophat_ridge.experimental.v1');
    assert.equal(result.models.eye_gradient, undefined);
    const signals = pose ? result.stages[0].signals : result.before.signals;
    assert.ok(signals['eye_tophat.raw']); assert.equal(signals['eye_gradient.raw'], undefined);
    if (pose) assert.equal(result.changes.returnedMinusNatural.signals['eye_tophat.raw'].meanErrorDeltaPx, 0);
    else assert.equal(result.driftAssessment.available, false);
  }
});

test('v10 analysis cannot silently label old gradient outputs as the new descriptor', async () => {
  const { summarizeGradientReport } = await load();
  for (const change of [r => { r.models.eye_tophat.featureMethod = 'eye_gradient_iris.experimental.v1'; },
    r => { delete r.poseProbe.stages[1].rows[0].signals['eye_tophat.raw']; },
    r => { r.poseProbe.stages[2].rows[1].targetPercent.x += 1; }]) {
    const source = tophatFixture(); change(source);
    assert.throws(() => summarizeGradientReport(source), /invalid_gradient_summary/);
  }
});

test('developer benchmark analyzes each frozen protocol and refuses incomplete or mislabeled runs', async () => {
  const { summarizeGradientReport } = await load();
  for (const protocol of ['spatial.v1', 'posture.v1', 'temporal.v1']) {
    const source = tophatFixture(protocol === 'posture.v1');
    source.version = 'gaze_benchmark.v1'; source.benchmark = { completed: true, protocol };
    source.viewport = { width: 800, height: 600 };
    if (protocol === 'temporal.v1') {
      source.intervalMs = 240000; source.temporalScope = 'same_targets_before_after_no_within_interval_accuracy';
      source.temporalGap = { elapsedMs: 240001, completedCaptures: 7200, cameraNotifications: 7200, scope: 'interval_capture_counts_not_gaze_accuracy' };
      for (const row of source.before) row.targetPercent = { x: 10 + row.targetIndex * 10, y: 40 };
      source.after = structuredClone(source.before);
    }
    const result = summarizeGradientReport(source);
    assert.ok(result.models.eye_tophat);
    assert.equal(result.normalized.unit, 'percent_of_viewport_diagonal_not_degrees_of_visual_angle');
    assert.equal(result.normalized.phases[0].signals['eye_tophat.raw'].equalTargetMeanError, .7);
    if (protocol === 'temporal.v1') assert.equal(result.temporalComparison.signals['eye_tophat.raw'].meanErrorDeltaPx, 0);
    source.benchmark.completed = false;
    assert.throws(() => summarizeGradientReport(source), /invalid_gradient_summary/);
  }
  const mismatched = tophatFixture(true);
  mismatched.version = 'gaze_benchmark.v1'; mismatched.benchmark = { completed: true, protocol: 'spatial.v1' };
  assert.throws(() => summarizeGradientReport(mismatched), /invalid_gradient_summary/);
});

function zonesFixture(temporal) {
  const source = temporal ? temporalFixture() : fixture();
  source.viewport = { width: 800, height: 600 };
  const coordinates = [[30, 22], [70, 22], [22, 70], [78, 70], [50, 63], [12, 12], [88, 12], [12, 88], [88, 88]];
  for (const row of [...source.before, ...source.after]) {
    const [x, y] = coordinates[row.targetIndex];
    row.targetPercent = { x, y };
  }
  return source;
}

test('zonal summary uses fixed coordinates, preserves missingness and separates paired weights', async () => {
  const { summarizeGradientZones } = await load(), source = zonesFixture(false);
  const [lowerLeft, lowerRight] = source.before.slice(-2);
  for (const [row, n, delta] of [[lowerLeft, 1, -8], [lowerRight, 3, 4]]) {
    for (const key of ['baseline.raw', 'eye_patch.raw']) row.signals[key].accepted = n;
    const pair = row.comparisons.find(p => p.candidate === 'eye_patch.raw');
    Object.assign(pair, { commonAccepted: n, candidateMinusBaselineMeanErrorPx: delta });
  }
  source.before.reverse();
  source.untrusted = 'PRIVATE_SENTINEL';
  const result = summarizeGradientZones(source);
  const lower = result.zones.lower_corners, pair = lower.before.comparisons.find(p => p.candidate === 'eye_patch.raw');
  assert.equal(result.viewportDiagonalPx, 1000);
  assert.equal(result.zones.corners.targetCount, 4);
  assert.equal(result.zones.interior.targetCount, 5);
  assert.equal(result.zones.lower_targets.targetCount, 4);
  assert.equal(lower.before.signals['eye_patch.raw'].missingFraction, .5);
  assert.equal(lower.before.signals['eye_patch.raw'].measuredTargets, 2);
  assert.equal(pair.commonAccepted, 4);
  assert.equal(pair.equalTargetCommonErrorDeltaPx, -2);
  assert.equal(pair.candidateMinusBaselineMeanErrorPx, 1);
  assert.equal(lower.after, null); assert.equal(lower.shift, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
});

test('zonal temporal shift separates a uniform offset from opposing target shifts', async () => {
  const { summarizeGradientZones } = await load(), source = zonesFixture(true);
  for (const row of source.after) {
    const s = row.signals['baseline.raw'];
    s.biasXPx += 12;
    s.biasYPx += row.targetIndex === 7 ? -14 : row.targetIndex === 8 ? 6 : 0;
    if (row.targetIndex === 8) {
      const patch = row.signals['eye_patch.raw'];
      patch.accepted = 0;
      const pair = row.comparisons.find(p => p.candidate === 'eye_patch.raw');
      Object.assign(pair, { commonAccepted: 0, candidateMinusBaselineMeanErrorPx: null });
    }
  }
  const result = summarizeGradientZones(source);
  assert.equal(result.zones.lower_corners.temporalComparison.withinIntervalAccuracyAvailable, false);
  assert.deepEqual(result.zones.lower_corners.shift['baseline.raw'], { matchedTargets: 2, uniformShiftXPx: 12,
    uniformShiftYPx: -4, nonUniformShiftRmsPx: 10 });
  assert.equal(result.zones.upper_corners.shift['baseline.raw'].nonUniformShiftRmsPx, 0);
  assert.equal(result.zones.lower_corners.shift['eye_patch.raw'].matchedTargets, 1);
  assert.equal(result.zones.lower_corners.shift['eye_patch.raw'].nonUniformShiftRmsPx, null);
  assert.equal(result.zones.lower_corners.after.signals['eye_patch.raw'].measuredTargets, 1);
  assert.equal(result.zones.lower_corners.temporalComparison.signals['eye_patch.raw'].matchedTargets, 1);
});

test('zonal summary refuses other layouts, posture and incomplete runs', async () => {
  const { summarizeGradientZones } = await load();
  assert.throws(() => summarizeGradientZones(poseFixture()), /invalid_gradient_summary/);
  const shifted = zonesFixture(true);
  for (const row of [...shifted.before, ...shifted.after]) row.targetPercent.x += 1;
  assert.throws(() => summarizeGradientZones(shifted), /invalid_gradient_summary/);
  const source = zonesFixture(false);
  source.version = 'gaze_benchmark.v1'; source.benchmark = { completed: false, protocol: 'spatial.v1' };
  assert.throws(() => summarizeGradientZones(source), /invalid_gradient_summary/);
});

test('aggregate fusion bounds require identical accepted frames and never infer covariance', async () => {
  const { summarizeBlendBounds } = await import('../../../scripts/reference-data/issue143-blend-bounds.mjs');
  const source = zonesFixture(false);
  for (const row of source.before) {
    const set = (key, x, y, sdX, sdY) => Object.assign(row.signals[key],
      { accepted: 2, offScreen: 0, biasXPx: x, biasYPx: y, rmsErrorPx: Math.hypot(x, y, sdX, sdY),
        withinTargetSdXPx: sdX, withinTargetSdYPx: sdY });
    set('baseline.raw', 10, 0, 4, 0);
    set('eye_patch.raw', -10, 0, 2, 0);
    set('eye_gradient_all.raw', 20, 0, 0, 0);
    // Two different models have the same count as baseline, but only gradient
    // and patch are proven to have the same accepted set via the baseline.
    for (const p of row.comparisons.filter(p => ['eye_patch.raw', 'eye_gradient_all.raw'].includes(p.candidate))) p.commonAccepted = 2;
  }
  const [baseline, gradient] = summarizeBlendBounds(source).phases.before.all;
  assert.deepEqual([baseline.matchedTargets, baseline.lowerRmsPx, baseline.upperRmsPx, baseline.relativeToLeft], [9, 1, 3, 'lower']);
  assert.equal(gradient.matchedTargets, 9);
  assert.equal(gradient.lowerRmsPx, Math.sqrt(26));
  assert.equal(gradient.lowerRmsPx, gradient.upperRmsPx);
  const unmatched = source.before[7].comparisons.find(p => p.candidate === 'eye_gradient_all.raw');
  unmatched.commonAccepted = 1;
  const g = summarizeBlendBounds(source).phases.before.lower[1];
  assert.equal(g.matchedTargets, 3);
  assert.equal(g.relativeToLeft, 'unavailable');
});

test('posture geometry audit compares envelopes and refuses missing or invalid aggregates', async () => {
  const { summarizeGeometrySeparation } = await import('../../../scripts/reference-data/issue143-geometry-audit.mjs');
  const source = poseFixture();
  assert.throws(() => summarizeGeometrySeparation(source), /missing_geometry_summary/);
  for (const [i, stage] of source.poseProbe.stages.entries()) for (const row of stage.rows) {
    row.baselineNuisance = { frames: 40, fields: ['eyeMidY'], mean: [i === 1 ? .56 : .50], sd: [.002],
      additional: 'PRIVATE_SENTINEL' };
  }
  const result = summarizeGeometrySeparation(source);
  assert.ok(Math.abs(result.guardedGap - .052) < 1e-12);
  assert.equal(result.loweredMinusNaturalEnvelopeGap, result.loweredMinusReturnedEnvelopeGap);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SENTINEL/);
  source.poseProbe.stages[1].rows[0].baselineNuisance.frames = 0;
  assert.throws(() => summarizeGeometrySeparation(source), /missing_geometry_summary/);
});
