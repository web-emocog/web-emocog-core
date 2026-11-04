const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg');
const load = file => import(pathToFileURL(path.join(root, file)).href);

function samples(length, seed = 1) {
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  return Array.from({ length }, (_, index) => Object.freeze({ tMs: index * 1000 / 30,
    r: 100 + 100 * random(), g: 60 + 70 * random(), b: 40 + 60 * random() }));
}

function reference(series, since = null, minimum = 0, pos, chrom) {
  const window = since === null ? series : series.filter(point => point.tMs >= since);
  if (window.length < minimum) return null;
  return { sampleCount: window.length, pos: pos(window), chrom: chrom(window) };
}

test('reused color projections are bit-identical to both original algorithms and do not mutate source data', async () => {
  const { ColorProjectionWindow } = await load('algorithms/color-projection.mjs');
  const { posSampleFromWindow: pos } = await load('algorithms/pos.js');
  const { chromSampleFromWindow: chrom } = await load('algorithms/chrom.js');
  const workspace = new ColorProjectionWindow();
  for (const seed of [1, 17, 2048]) for (const length of [0, 1, 2, 29, 30, 31, 60, 240, 480, 1024]) {
    const input = Object.freeze(samples(length, seed));
    for (const since of [null, 0, 1000 / 30, 1000, 5000, Infinity, NaN]) for (const minimum of [0, 30]) {
      const expected = reference(input, since, minimum, pos, chrom);
      assert.deepEqual(workspace.sample(input, since, minimum), expected, `seed=${seed}, length=${length}, since=${since}, minimum=${minimum}`);
    }
  }
});

test('nonfinite channel values, time filtering and an inclusive window boundary preserve the previous behavior', async () => {
  const { ColorProjectionWindow } = await load('algorithms/color-projection.mjs');
  const { posSampleFromWindow: pos } = await load('algorithms/pos.js');
  const { chromSampleFromWindow: chrom } = await load('algorithms/chrom.js');
  const workspace = new ColorProjectionWindow();
  for (const channel of ['r', 'g', 'b']) for (const value of [NaN, Infinity, -Infinity, 0, -0]) {
    const input = samples(60).map((point, index) => index === 30 ? { ...point, [channel]: value } : point);
    for (const since of [null, 1000, 1000 + 1e-8]) assert.deepEqual(workspace.sample(input, since), reference(input, since, 0, pos, chrom));
  }
  const input = [{ tMs: NaN, r: 255, g: 0, b: 0 }, ...samples(60).reverse()];
  assert.deepEqual(workspace.sample(input, 1000, 30), reference(input, 1000, 30, pos, chrom));
});

test('scratch storage grows only with the largest window and is never shared by distinct engine workspaces', async () => {
  const { ColorProjectionWindow } = await load('algorithms/color-projection.mjs');
  const { posSampleFromWindow: pos } = await load('algorithms/pos.js');
  const { chromSampleFromWindow: chrom } = await load('algorithms/chrom.js');
  const first = new ColorProjectionWindow(), second = new ColorProjectionWindow();
  const long = samples(1024), short = samples(31, 17);
  first.sample(long); const capacity = first.capacity;
  const buffers = first._vectors.slice();
  assert.ok(capacity >= long.length && capacity < long.length * 2);
  for (let index = 0; index < 100; index++) assert.deepEqual(first.sample(short), reference(short, null, 0, pos, chrom));
  assert.equal(first.capacity, capacity);
  for (let index = 0; index < 4; index++) assert.equal(first._vectors[index], buffers[index]);
  assert.equal(second.capacity, 0);
  second.sample(short);
  assert.ok(second.capacity < first.capacity);
  assert.deepEqual(first.sample(long), reference(long, null, 0, pos, chrom));
});

test('complete engine outputs and signal histories equal the original projection path over a minute with dropouts and jitter', async () => {
  const { RppgEngine } = await load('RppgEngine.js');
  const { posSampleFromWindow: pos } = await load('algorithms/pos.js');
  const { chromSampleFromWindow: chrom } = await load('algorithms/chrom.js');
  const optimized = new RppgEngine({ algorithm: 'auto' }), previous = new RppgEngine({ algorithm: 'auto' });
  previous._colorProjection = { sample: (series, since, minimum) => reference(series, since, minimum, pos, chrom) };
  const width = 160, height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  const imageData = { width, height, data };
  const landmarks = Object.freeze(Array.from({ length: 478 }, (_, index) => Object.freeze({
    x: .2 + .6 * (index % 22) / 21, y: .1 + .8 * Math.floor(index / 22) / 21, z: 0 })));
  let emitted = 0;
  for (let index = 1; index <= 1800; index++) {
    const timestampMs = index * 1000 / 30 + (index % 11) * .01 + (index > 900 ? 3000 : 0);
    const pulse = timestampMs / 1000 * 2 * Math.PI * 1.2;
    const breath = 2 * Math.sin(timestampMs / 1000 * 2 * Math.PI * .2);
    const rgb = index % 137 === 0 ? [0, 0, 0] : [160 + 4 * Math.sin(pulse + .4) + breath,
      120 + 8 * Math.sin(pulse) + breath, 80 + 2 * Math.sin(pulse - .4) + breath];
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = rgb[0]; data[offset + 1] = rgb[1]; data[offset + 2] = rgb[2]; data[offset + 3] = 255;
    }
    const input = { timestampMs, frameW: width, frameH: height, imageData, landmarks, fps: 30 };
    const expected = previous.update(input), actual = optimized.update(input);
    assert.deepEqual(actual, expected, `different output at frame ${index}`);
    if (actual) emitted++;
  }
  assert.ok(emitted > 30, 'the comparison must include real estimation output, not just warmup nulls');
  assert.ok(optimized._colorProjection.capacity > 0, 'valid skin windows must actually be projected');
  assert.deepEqual(optimized.state, previous.state, 'all ROI histories and numeric state remain identical');
});
