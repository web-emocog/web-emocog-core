const test = require('node:test');
const assert = require('node:assert/strict');
const { landmarksForGaze } = require('./fixtures/gaze-topology');
const load = () => import('../../web/developer/gaze-eye-patch-geometry-gate.mjs');

test('corner height reads neither iris nor lids and detects image-plane translation', async () => {
  const { readEyeCornerHeight } = await load();
  const face = landmarksForGaze(0, 0), reference = readEyeCornerHeight(face);
  assert.ok(Number.isFinite(reference));
  const irisAndLids = face.map((p, i) => i >= 468 || [386, 374, 159, 145].includes(i) ? { ...p, y: .7 } : p);
  assert.equal(readEyeCornerHeight(irisAndLids), reference);
  const moved = face.map(p => ({ ...p, y: p.y + .05 }));
  assert.ok(Math.abs(readEyeCornerHeight(moved) - reference - .05) < 1e-12);
  assert.equal(readEyeCornerHeight([]), null);
});

test('geometry gate keeps reference and unknown heights outside the calibrated blend', async () => {
  const { fitPatchGeometryGate, summarizeEyeCornerHeight } = await load();
  const profile = x => summarizeEyeCornerHeight([x - .001, x, x + .001]);
  const pairs = Array.from({ length: 5 }, (_, i) => ({ first: profile(.49 + i * .001), second: profile(.55 + i * .001) }));
  const ordinary = Array.from({ length: 50 }, () => profile(.5));
  const info = {}, gate = fitPatchGeometryGate(pairs, ordinary, info);
  assert.equal(info.separatedAlternatePairs, 5);
  assert.equal(gate.weight(.5), 0);
  assert.equal(gate.weight(.55), 1);
  assert.equal(gate.weight(.7), 0);
  assert.equal(gate.weight(null), 0);
  assert.ok(gate.weight(.53) > 0 && gate.weight(.53) < 1);
  ordinary[49] = profile(.555);
  assert.equal(fitPatchGeometryGate(pairs, ordinary, info), null);
  assert.equal(info.failureReason, 'overlapping_geometry_range');
});

test('geometry qualification cannot supply gaze without two sufficiently agreeing eyes-based estimates', async () => {
  const { blendPatchRaw } = await import('../../web/developer/gaze-eye-patch-gate.mjs');
  const view = { width: 800, height: 600 };
  const point = (rawX, rawY) => ({ rawX, rawY, valid: true });
  const a = point(250, 300), b = point(270, 310);
  assert.equal(blendPatchRaw(null, b, 1, view, null, .16), null);
  assert.equal(blendPatchRaw(a, null, 1, view, null, .16).rawX, a.rawX);
  assert.equal(blendPatchRaw(a, point(750, 310), 1, view, null, .16).reason, 'eye_disagreement');
  assert.equal(blendPatchRaw(a, b, 1, view, null, .16).rawX, b.rawX);
  const same = blendPatchRaw(a, a, 1, view, null, .16);
  assert.deepEqual([same.rawX, same.rawY], [a.rawX, a.rawY]);
});
