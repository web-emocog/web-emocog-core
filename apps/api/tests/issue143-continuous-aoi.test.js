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
