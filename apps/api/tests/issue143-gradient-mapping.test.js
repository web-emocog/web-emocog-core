const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../../../scripts/reference-data/issue143-gradient-mapping.mjs');
const centers = (x, y, delta = .02) => [.3 * x + delta, .24 * y - delta, .3 * x - delta, .24 * y + delta];
const target = (x, y, curved) => ({ screenX: 600 + 400 * x,
  screenY: 400 + 250 * y + (curved ? 135 * y * y + 70 * x * y : 0) });
const training = curved => [-.8, -.4, 0, .4, .8].flatMap(x => [-.8, -.4, 0, .4, .8]
  .flatMap(y => [-.02, .02].map(d => ({ centers: centers(x, y, d), ...target(x, y, curved) }))));
const heldOutError = (model, curved) => {
  let squared = 0, n = 0;
  for (const x of [-.91, -.21, .23, .92]) for (const y of [-.93, -.29, .21, .94]) {
    const truth = target(x, y, curved), p = model.predict(centers(x, y));
    squared += (p.x - truth.screenX) ** 2 + (p.y - truth.screenY) ** 2; n++;
  }
  return Math.sqrt(squared / n);
};

test('offline gradient mapping can represent a known nonlinear screen relation without test targets', async () => {
  const { fitGradientMapping } = await load(), data = training(true);
  const linear = fitGradientMapping(data, 'binocular_linear');
  const quadratic = fitGradientMapping(data, 'binocular_quadratic');
  assert.ok(heldOutError(linear, true) > 40);
  assert.ok(heldOutError(quadratic, true) < 1);
  assert.equal(quadratic.diagnostics.calibrationTargets, 25);
  assert.equal(quadratic.diagnostics.calibrationRows, 50);
  assert.equal(quadratic.diagnostics.independentTargetsUsed, 0);
  assert.equal(quadratic.diagnostics.curve.length, 5);
  assert.equal(quadratic.diagnostics.selected.rmsPx, Math.min(...quadratic.diagnostics.curve.map(r => r.rmsPx)));
});

test('offline gradient mapping is binocular-symmetric, target blind, frozen after fit and not clipped', async () => {
  const { fitGradientMapping } = await load(), data = training(false);
  const model = fitGradientMapping(data, 'binocular_linear');
  const c = centers(.35, -.4), original = model.predict(c);
  assert.deepEqual(model.predict([...c.slice(2), ...c.slice(0, 2)]), original);
  assert.deepEqual(model.predict(c, { targetX: 0, targetY: 0, timestamp: 240000, headYaw: 10 }), original);
  data[0].centers.fill(0); data[0].screenX = -10000; data.length = 0;
  assert.deepEqual(model.predict(c), original);
  assert.ok(model.predict(centers(2, 0)).x > 1200);
  assert.equal(model.predict([1, 0, NaN, 0]), null);
  assert.equal(model.predict([1, 0]), null);
  assert.equal(model.predict(null), null);
});

test('offline gradient mapping rejects incomplete click groups, invalid input and unbounded training', async () => {
  const { fitGradientMapping } = await load(), data = training(false);
  const fit = rows => fitGradientMapping(rows, 'binocular_quadratic');
  assert.equal(fit(data.slice(1)), null);
  assert.equal(fit(data.slice(0, 10)), null);
  assert.equal(fit([...data, data[0]]), null);
  assert.equal(fit([{ ...data[0], screenY: Infinity }, ...data.slice(1)]), null);
  assert.equal(fit([{ ...data[0], centers: [0, NaN, 0, 0] }, ...data.slice(1)]), null);
  assert.equal(fitGradientMapping(data, 'unknown'), null);
});

test('negative oracle: lower edge error can conceal worse off-screen specificity on the same gate', async () => {
  const { runSyntheticMappingComparison } = await import('../../../scripts/reference-data/issue143-gradient-mapping-synthetic.mjs');
  const [{ methods }] = runSyntheticMappingComparison('angular_projection');
  const reference = methods.v7_gradient_all, curved = methods.binocular_quadratic;
  assert.equal(reference.accepted, 216);
  assert.equal(curved.commonAccepted, reference.accepted);
  assert.ok(curved.edgeMeanErrorPx < reference.edgeMeanErrorPx);
  assert.deepEqual(reference.truthOffScreen, { attempted: 8, missing: 0, predictedOffScreen: 4, falseOnScreen: 4 });
  assert.deepEqual(curved.truthOffScreen, { attempted: 8, missing: 0, predictedOffScreen: 0, falseOnScreen: 8 });
});
