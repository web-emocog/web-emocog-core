const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixationInsideAoi } = require('../analytics/metrics.js');

const aoi = import('../../web/developer/gaze-continuous-aoi.mjs');
const heatmap = import('../../participant-web/js/web-page/heatmap.js?v=20261102-1');
const viewport = { width: 1000, height: 800 };
const board = { left: 0, top: 0, ...viewport };
const prediction = (x, y, overrides = {}) => ({
  valid: true, onScreen: true, confidence: 1, rawX: x, rawY: y, correctedX: x, correctedY: y, ...overrides,
});
const pair = (baseline, eye_patch) => ({ baseline, eye_patch });

test('continuous AOI balances side, vertical band and inset in both halves', async () => {
  const { AOI_PRESENTATIONS, aoiTrialLayout, insideAoiRectangle } = await aoi;
  assert.equal(AOI_PRESENTATIONS.length, 40);
  const conditions = rows => rows.map(r => [r.targetSide, r.band, r.inset].join(':')).sort();
  const early = conditions(AOI_PRESENTATIONS.slice(0, 20)), late = conditions(AOI_PRESENTATIONS.slice(20));
  assert.equal(new Set(early).size, 20);
  assert.deepEqual(early, late);
  for (const trial of AOI_PRESENTATIONS) {
    const { left, right, cue } = aoiTrialLayout(trial);
    const a = { shape: 'rectangle', points: [{ x: left.left, y: left.top }, { x: left.right, y: left.bottom }] };
    for (const [x, y] of [[left.left, left.top], [left.right, left.bottom], [.5, cue.y], [cue.x, cue.y], [NaN, .3]]) {
      assert.equal(insideAoiRectangle(x, y, left), fixationInsideAoi({ x, y }, a));
    }
    assert.equal(insideAoiRectangle(cue.x, cue.y, trial.targetSide === 'left' ? left : right), true);
    assert.equal(insideAoiRectangle(cue.x, cue.y, trial.targetSide === 'left' ? right : left), false);
  }
});

test('AOI accepts only fresh scored captures and separates raw, corrected, missing and off-screen', async () => {
  const { AOI_PRESENTATIONS, aoiTrialLayout, createAoiTrialRecorder } = await aoi;
  const { createHeatmapAccumulator } = await heatmap;
  const trial = AOI_PRESENTATIONS[0];
  const recorder = createAoiTrialRecorder(trial, { board, ...aoiTrialLayout(trial) }, viewport, 100, createHeatmapAccumulator);
  const hit = prediction(150, 128), opposite = prediction(850, 128);
  recorder.observe(799, pair(hit, hit)); // pre-transition
  recorder.observe(800, pair(hit, opposite));
  recorder.observe(800, pair(hit, hit)); // duplicate
  recorder.observe(833, pair(hit, null));
  recorder.observe(866, pair(prediction(500, 128), hit));
  recorder.observe(899, pair(prediction(-10, 128, { correctedX: 150 }), prediction(150, 128, { onScreen: false })));
  recorder.observe(932, pair(hit, prediction(150, 128, { valid: false })));
  recorder.observe(6100, pair(hit, hit)); // exclusive end
  const row = recorder.finish(6000);
  assert.deepEqual([row.measured, row.outsideWindow, row.duplicate], [5, 2, 1]);
  assert.deepEqual(row.signals['baseline.raw'].frames, { target: 3, other: 0, outsideAoi: 1, offScreen: 1, missing: 0 });
  assert.deepEqual(row.signals['eye_patch.corrected'].frames, { target: 1, other: 1, outsideAoi: 0, offScreen: 1, missing: 2 });
  assert.deepEqual(row.pairs.raw, { common: 3, bothHit: 0, onlyBaselineHit: 1, onlyPatchHit: 2, neitherHit: 0,
    baselineErrorSumPx: 510, patchErrorSumPx: 700 });
  assert.deepEqual(row.pairs.corrected, { common: 3, bothHit: 0, onlyBaselineHit: 2, onlyPatchHit: 1, neitherHit: 0,
    baselineErrorSumPx: 350, patchErrorSumPx: 700 });
});

test('rejecting difficult captures cannot improve matched hits; fixation is local to its own presentation', async () => {
  const { AOI_PRESENTATIONS, aoiTrialLayout, createAoiTrialRecorder, summarizeAoiBlock } = await aoi;
  const { createHeatmapAccumulator } = await heatmap;
  const rows = [0, 20, 39].map(index => {
    const trial = AOI_PRESENTATIONS[index], layout = aoiTrialLayout(trial);
    const recorder = createAoiTrialRecorder(trial, { board, ...layout }, viewport, 0, createHeatmapAccumulator);
    const hit = prediction(layout.cue.x * viewport.width, layout.cue.y * viewport.height);
    const wrong = prediction(viewport.width - hit.rawX, hit.rawY);
    for (let i = 0; i < 6; i++) recorder.observe(700 + i * 33, pair(hit, hit));
    for (let i = 0; i < 6; i++) recorder.observe(1300 + i * 33, pair(wrong, null));
    return recorder.finish(6000);
  });
  assert.equal(rows[0].signals['baseline.corrected'].fixation.fixationCount, 2);
  assert.equal(rows[0].signals['eye_patch.corrected'].fixation.fixationCount, 1);
  assert.ok(rows[0].signals['baseline.corrected'].fixation.otherDwellMs > 0);
  assert.equal(rows[0].signals['eye_patch.corrected'].fixation.otherDwellMs, 0);
  assert.equal(rows[0].signals['baseline.corrected'].fixation.targetDwellMs, rows[0].signals['eye_patch.corrected'].fixation.targetDwellMs);
  const summary = summarizeAoiBlock(rows);
  assert.equal(summary.all.pairs.corrected.equalWindowTargetHitDelta, 0);
  assert.equal(summary.all.signals['eye_patch.corrected'].targetHitFractionOfAccepted, 1);
  assert.equal(summary.all.signals['eye_patch.corrected'].equalWindowTargetHitFraction, .5);
  assert.equal(summary.all.signals['eye_patch.corrected'].missingFraction, .5);
  assert.equal(summary.lowerLate.presentations, 2);
  assert.doesNotMatch(JSON.stringify(rows), /"(?:x|y|fixationPoints|stimulusRect)"\s*:/);
});

test('AOI separates dispersion, interrupted signal and capture gaps without changing fixation results', async () => {
  const { AOI_PRESENTATIONS, aoiTrialLayout, createAoiTrialRecorder, summarizeAoiBlock, validAoiFixationDiagnostics } = await aoi;
  const { createHeatmapAccumulator } = await heatmap;
  const trial = AOI_PRESENTATIONS[0];
  const geometry = { board: { left: 100, top: 0, width: 800, height: 800 }, ...aoiTrialLayout(trial) };
  const recorder = createAoiTrialRecorder(trial, geometry, viewport, 0, createHeatmapAccumulator);
  const hit = prediction(220, 128), jump = prediction(280, 128);
  const measure = (at, point) => recorder.observe(at, pair(point, point));
  for (const at of [700, 733, 766, 799, 832]) measure(at, hit);
  measure(865, jump); // > .04 of the board, still in the target AOI.
  measure(898, { valid: false, rejectionReason: 'low_confidence' });
  measure(931, prediction(-1, 128)); // off-screen
  measure(964, prediction(99, 128)); // on-screen but outside board; last observed loss
  for (const at of [997, 1030, 1063, 1096, 1129]) measure(at, jump);
  measure(1261, hit); // both a gap and a jump, with no observed rejected frame
  measure(1294, { valid: false, rejectionReason: 'private_error_message' });
  measure(1327, null);
  const row = recorder.finish(6000), signal = row.signals['baseline.corrected'];
  assert.equal(signal.fixation.fixationCount, 2);
  assert.equal(signal.fixation.reachedTarget, true);
  const d = signal.fixationDiagnostics;
  assert.equal(d.outsideBoardFrames, 1);
  assert.equal(d.missingReasons.low_confidence, 1);
  assert.equal(d.missingReasons.no_prediction, 1);
  assert.equal(d.missingReasons.other, 1);
  assert.deepEqual(d.grouping.splits, { gapOnly: 1, dispersionOnly: 1, gapAndDispersion: 1, presentationEnd: 1 });
  assert.deepEqual(d.grouping.shortGroups, { gapOnly: 1, dispersionOnly: 0, gapAndDispersion: 0, presentationEnd: 1 });
  assert.deepEqual(d.grouping.gapContext, { missing: 0, offScreen: 0, outsideBoard: 1, withoutObservedLoss: 1 });
  assert.equal(d.grouping.shortGroupMs, 133);
  assert.equal(validAoiFixationDiagnostics(d, signal.frames, signal.fixation, 6000), true);
  const tampered = structuredClone(d);
  tampered.grouping.gapContext.missing++;
  assert.equal(validAoiFixationDiagnostics(tampered, signal.frames, signal.fixation, 6000), false);
  assert.equal(summarizeAoiBlock([row]).all.signals['baseline.corrected'].fixationDiagnostics.groupingWindows, 1);
  assert.doesNotMatch(JSON.stringify(row), /private_error_message|"(?:x|y|fixationPoints|timestamp)"\s*:/);
});

test('AOI suppresses split counts when the grouping rules change upstream', async () => {
  const { AOI_PRESENTATIONS, aoiTrialLayout, createAoiTrialRecorder } = await aoi;
  const { createHeatmapAccumulator } = await heatmap;
  const trial = AOI_PRESENTATIONS[0];
  const recorder = createAoiTrialRecorder(trial, { board, ...aoiTrialLayout(trial) }, viewport, 0, options => {
    const acc = createHeatmapAccumulator(options);
    return { add: acc.add, finalize() {
      const result = acc.finalize();
      result.perStimulus[0].algorithm.parameters.dispersionNorm = .05;
      return result;
    } };
  });
  const hit = prediction(150, 128);
  for (const at of [700, 733, 766, 799, 832]) recorder.observe(at, pair(hit, hit));
  const signal = recorder.finish(6000).signals['baseline.corrected'];
  assert.equal(signal.fixation.fixationCount, 1);
  assert.equal(signal.fixationDiagnostics.grouping, null);
});

test('diagnostic counts reconcile with the unchanged accumulator over varied deterministic streams', async () => {
  const { AOI_PRESENTATIONS, aoiTrialLayout, createAoiTrialRecorder, validAoiFixationDiagnostics } = await aoi;
  const { createHeatmapAccumulator } = await heatmap;
  let seed = 4001;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let run = 0; run < 100; run++) {
    const trial = AOI_PRESENTATIONS[run % 40];
    const geometry = { board: { left: 30, top: 20, width: 900, height: 750 }, ...aoiTrialLayout(trial) };
    const recorder = createAoiTrialRecorder(trial, geometry, viewport, 0, createHeatmapAccumulator);
    let x = .2, y = .2;
    for (let at = 700; at < 6000; at += 1 + Math.floor(random() * 180)) {
      if (random() < .3) { x = random() * 1.2 - .1; y = random() * 1.2 - .1; }
      const point = prediction(30 + x * 900, 20 + y * 750);
      recorder.observe(at, pair(random() < .1 ? null : point,
        random() < .1 ? { valid: false, rejectionReason: 'low_confidence' } : point));
    }
    for (const signal of Object.values(recorder.finish(6000).signals)) {
      assert.ok(signal.fixationDiagnostics.grouping);
      assert.equal(validAoiFixationDiagnostics(signal.fixationDiagnostics, signal.frames, signal.fixation, 6000), true);
    }
  }
});
