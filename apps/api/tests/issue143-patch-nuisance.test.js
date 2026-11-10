const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../../web/developer/gaze-eye-patch-nuisance.mjs');
const zeros = () => Array(120).fill(0);

test('paired projection removes same-target variation without learning a gaze target or keeping the pairs', async () => {
  const { fitPatchNuisance } = await load();
  const pairs = Array.from({ length: 5 }, (_, i) => {
    const first = zeros();
    first[2] = i - 2;
    const second = first.slice();
    second[0] = 2;
    second[1] = (i - 2) / 2;
    return { first, second, x: i * 200 };
  });
  const fit = fitPatchNuisance(pairs);
  assert.equal(fit.rank, 2);
  assert.ok(Object.isFrozen(fit));
  for (const p of pairs) {
    const projected = fit.project(p.second, { targetX: 1000, elapsedMs: 240000 });
    assert.ok(Math.abs(projected[0]) < 1e-10 && Math.abs(projected[1]) < 1e-10);
    assert.equal(projected[2], p.first[2]);
    assert.deepEqual(projected, fit.project(p.second));
  }
  const probe = pairs[0].second.slice(), expected = fit.project(probe);
  pairs[0].second.fill(4); pairs.length = 0;
  assert.deepEqual(fit.project(probe), expected);
});

test('paired projection refuses absent variation, unsupported rank and invalid patch values', async () => {
  const { fitPatchNuisance } = await load();
  const first = zeros(), second = zeros();
  const pairs = Array.from({ length: 5 }, () => ({ first, second }));
  assert.equal(fitPatchNuisance(pairs), null);
  second[3] = 2;
  assert.equal(fitPatchNuisance(pairs.slice(0, 3)), null);
  assert.equal(fitPatchNuisance(pairs, { rank: 10 }), null);
  assert.equal(fitPatchNuisance(pairs).project([1]), null);
  second[3] = Infinity;
  assert.equal(fitPatchNuisance(pairs), null);
});

test('paired row normalization survives some combined perturbations but does not establish off-screen safety', async () => {
  const { runPatchBackgroundSynthetic } = await import('../../../scripts/reference-data/issue143-patch-background-synthetic.mjs');
  const output = runPatchBackgroundSynthetic();
  const get = condition => output.results.find(row => row.condition === condition).models;
  const normal = get('reference'), mixed = get('mixed'), partial = get('partial'), light = get('row_light');
  assert.equal(output.pairedProjection.paired_rows.anchorPairs, 5);
  assert.equal(normal.paired_rows.accepted, normal.full.accepted);
  assert.equal(normal.paired_rows.near.trueOffScreen, 8);
  assert.ok(normal.paired_rows.meanErrorPx < normal.full.meanErrorPx);
  assert.ok(partial.paired_rows.bottomMeanErrorPx < partial.rows.bottomMeanErrorPx);
  assert.ok(light.paired_rows.meanErrorPx < light.full.meanErrorPx);
  assert.equal(mixed.paired_rows.commonFull, 144);
  assert.ok(mixed.paired_rows.meanDeltaVsFullPx < -200);
  assert.ok(mixed.paired_rows.far.falseOnScreen > mixed.full.far.falseOnScreen);
  assert.equal(get('absent').paired_rows.near.falseOnScreen, 8);
  assert.equal(get('missing').paired_rows.accepted, get('missing').full.accepted);
  assert.equal(output.appearanceGate.available, true);
  assert.deepEqual(normal.adaptive, normal.adaptive_confirmed);
  assert.equal(normal.adaptive.meanErrorPx, normal.full.meanErrorPx);
  const known = get('known_change');
  assert.equal(known.adaptive.falseOffScreen, known.full.falseOffScreen);
  assert.ok(known.adaptive_confirmed.falseOffScreen < known.full.falseOffScreen);
  assert.equal(known.adaptive_confirmed.near.falseOnScreen, known.full.near.falseOnScreen);
  assert.equal(get('large_change').adaptive_confirmed.falseOffScreen, get('large_change').full.falseOffScreen);
  const moderate = get('geometry_with_moderate_change'), poseOnly = get('geometry_without_image_nuisance');
  assert.deepEqual(normal.geometry, normal.full);
  assert.ok(moderate.geometry.bottomMeanErrorPx < moderate.full.bottomMeanErrorPx);
  assert.equal(moderate.geometry.falseOffScreen, moderate.full.falseOffScreen);
  assert.ok(poseOnly.geometry.meanErrorPx > poseOnly.full.meanErrorPx); // no physical claim from head motion alone
  assert.deepEqual(get('geometry_outside_observed').geometry, get('geometry_outside_observed').full);
});
