const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../../../scripts/reference-data/issue143-click-scatter.mjs');
const ridge = () => import('../../participant-web/js/gaze-tracker/ridge.js');

function rowsFor(summarize, variability = true) {
  return [-.8, 0, .8].flatMap(x => [-.8, 0, .8].flatMap(y => [-1, 1].map(click => {
    const values = [-1, 0, 1].map(step => {
      const z = .3 * x - .2 * y + click * .04 + (variability ? step * .7 : 0);
      return [x + .8 * z, y - .7 * z, z];
    });
    const clickScatter = summarize(values);
    return { irisFeatures: [...clickScatter.mean, 1], clickScatter, screenX: 600 + 400 * x, screenY: 400 + 300 * y, values };
  })));
}

test('within-click moments equal explicit per-frame weighted ridge with equal weight per click', async () => {
  const { summarizeClickVectors, fitClickScatter } = await load();
  const { ridgeRegression, dotProduct } = await ridge();
  const rows = rowsFor(summarizeClickVectors);
  // Give one click fewer frames. It must not lose its one-click weight.
  rows[0].values = rows[0].values.slice(0, 2);
  rows[0].clickScatter = summarizeClickVectors(rows[0].values);
  rows[0].irisFeatures = [...rows[0].clickScatter.mean, 1];
  const model = fitClickScatter(rows, [.05, .05, .05], [.1]);
  const matrix = [], tx = [], ty = [];
  for (const row of rows) for (const v of row.values) {
    const weight = 1 / Math.sqrt(row.values.length);
    matrix.push([...v.map((x, j) => weight * (x - model.mean[j]) / model.std[j]), weight]);
    tx.push(row.screenX * weight); ty.push(row.screenY * weight);
  }
  const wx = ridgeRegression(matrix, tx, .1), wy = ridgeRegression(matrix, ty, .1);
  for (const v of [[.1, .2, -.1], [-.8, .5, 1]]) {
    const row = [...v.map((x, j) => (x - model.mean[j]) / model.std[j]), 1];
    assert.ok(Math.abs(dotProduct(row, wx) - dotProduct(row, model.modelX)) < 1e-7);
    assert.ok(Math.abs(dotProduct(row, wy) - dotProduct(row, model.modelY)) < 1e-7);
  }
});

test('within-click loss gives no invented improvement on constant captures and preserves intercept', async () => {
  const { summarizeClickVectors, fitClickScatter } = await load();
  const { ridgeRegressionDual } = await ridge();
  const rows = rowsFor(summarizeClickVectors, false), m = fitClickScatter(rows, [.05,.05,.05], [.1]);
  const refX = ridgeRegressionDual(m.matrix, rows.map(r => r.screenX), .1);
  const refY = ridgeRegressionDual(m.matrix, rows.map(r => r.screenY), .1);
  m.modelX.forEach((x,j) => assert.ok(Math.abs(x - refX[j]) < 1e-7));
  m.modelY.forEach((y,j) => assert.ok(Math.abs(y - refY[j]) < 1e-7));
});

test('within-click calibration-only selection scores held-out frames, not just their average', async () => {
  const { summarizeClickVectors, fitClickScatter } = await load();
  const rows = rowsFor(summarizeClickVectors), model = fitClickScatter(rows, [.05,.05,.05]);
  assert.equal(model.curve.length, 5);
  assert.equal(model.targetCount, 9);
  assert.equal(model.targetCvRmsPx, Math.min(...model.curve.map(r => r.rmsPx)));
  const before = structuredClone(rows);
  fitClickScatter(rows, [.05,.05,.05]);
  assert.deepEqual(rows, before);
  // Eye-only channels include a nuisance direction that varies at fixed label.
  const p = (x,y,z) => {
    const f = [x+.8*z,y-.7*z,z];
    return model.modelX[3] + f.reduce((s,v,j) => s + model.modelX[j]*(v-model.mean[j])/model.std[j], 0);
  };
  assert.ok(Math.abs(p(.2,-.3,-1) - p(.2,-.3,1)) < 3);
  assert.ok(Math.abs(p(.7,-.3,0) - p(-.7,-.3,0)) > 500); // Not a constant predictor.
});

test('within-click fit fails closed on malformed, oversized or degenerate inputs', async () => {
  const { summarizeClickVectors, fitClickScatter } = await load();
  assert.equal(summarizeClickVectors([]), null);
  assert.equal(summarizeClickVectors([[NaN]]), null);
  assert.equal(summarizeClickVectors(Array.from({length:31},()=>[0])), null);
  const rows=rowsFor(summarizeClickVectors);
  assert.equal(fitClickScatter(rows.slice(0,4), [.05,.05,.05]), null);
  assert.equal(fitClickScatter(rows,[.05,.05,.05],[0]), null);
  rows[0].clickScatter.covariance[0] = -1;
  assert.equal(fitClickScatter(rows,[.05,.05,.05]),null);
});

test('negative image oracle: observed small lid variation does not guarantee extrapolation to a larger shift', async () => {
  const { runScatterSynthetic } = await import('../../../scripts/reference-data/issue143-scatter-synthetic.mjs');
  const [r] = runScatterSynthetic('small_lid_variation', 'lid_up');
  assert.equal(r.attempts, 96); assert.equal(r.accepted, 96);
  assert.ok(r.scatterError > r.meanError * 1.5);
  assert.equal(r.offMean, 72); assert.equal(r.offScatter, 96);
});
