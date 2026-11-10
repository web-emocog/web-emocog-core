const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../../web/developer/gaze-eye-patch-gate.mjs');
const v = (nuisance, gaze = 0) => [nuisance, gaze, ...new Array(118).fill(0)];
const view = { width: 800, height: 600 };
const point = (rawX, rawY) => ({ valid: true, rawX, rawY });

test('appearance gate leaves reference calibration and unknown extremes at zero weight', async () => {
  const { fitPatchAppearanceGate } = await load();
  const pairs = Array.from({ length: 5 }, (_, i) => ({ first: v(0, i - 2), second: v(3, i - 2) }));
  const ordinary = Array.from({ length: 50 }, (_, i) => v(.2, (i - 25) / 10));
  const info = {}, gate = fitPatchAppearanceGate(pairs, ordinary, info);
  assert.deepEqual(info, { heldOutPositivePairs: 5, separatedAlternatePairs: 5 });
  assert.equal(gate.weight(v(.2, 6)), 0);
  assert.equal(gate.weight(v(3, 6)), 1);
  assert.equal(gate.weight(v(9, 1)), 0);
  assert.ok(gate.weight(v(1.5, 1)) > 0 && gate.weight(v(1.5, 1)) < 1);
  assert.equal(gate.weight(v(1.5, 1), { targetX: 700, elapsed: 240000 }), gate.weight(v(1.5, 1)));
  pairs[0].second.fill(0); ordinary.length = 0;
  assert.equal(gate.weight(v(3, 1)), 1);
});

test('appearance gate abstains if the same-target change is indistinguishable from reference training', async () => {
  const { fitPatchAppearanceGate } = await load();
  const ordinary = Array.from({ length: 50 }, () => v(0));
  const absorbed = Array.from({ length: 5 }, (_, i) => ({ first: v(0, i), second: v(0, i + 3) }));
  const unclear = {};
  assert.equal(fitPatchAppearanceGate(absorbed, ordinary, unclear), null);
  assert.equal(unclear.failureReason, 'inconsistent_calibration_pairs');
  const pairs = Array.from({ length: 5 }, (_, i) => ({ first: v(0, i), second: v(3, i) }));
  ordinary[49] = v(4);
  const overlap = {};
  assert.equal(fitPatchAppearanceGate(pairs, ordinary, overlap), null);
  assert.equal(overlap.failureReason, 'overlapping_reference_range');
});

test('raw fusion preserves missingness and only crosses the boundary with an agreeing interior reference', async () => {
  const { blendPatchRaw } = await load();
  assert.equal(blendPatchRaw(null, point(100, 100), 1, view), null);
  assert.equal(blendPatchRaw(point(0, 0), null, 1, view).reason, 'paired_unavailable');
  assert.equal(blendPatchRaw(point(50, 100), point(100, 100), .5, view).rawX, 75);
  const full = point(-50, 100), paired = point(50, 100);
  assert.equal(blendPatchRaw(full, paired, 1, view).reason, 'boundary_guard');
  assert.equal(blendPatchRaw(full, paired, 1, view, point(600, 100)).reason, 'boundary_guard');
  assert.equal(blendPatchRaw(full, paired, 1, view, point(3, 100)).reason, 'boundary_guard');
  assert.equal(blendPatchRaw(full, paired, .5, view, point(48, 101)).reason, 'boundary_guard');
  assert.equal(blendPatchRaw(full, paired, 1, view, point(48, 101)).reason, 'confirmed_inside');
  assert.equal(blendPatchRaw(point(100, 100), point(900, 100), 1, view, point(48, 101)).rawX, 100);
});
