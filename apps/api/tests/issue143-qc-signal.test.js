const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const InlineQc = require('../../participant-web/js/qc-metrics');
const load = file => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/', file)));
const viewport = { width: 1000, height: 700 };

test('live QC uses unsmoothed corrected coordinates, never raw or display aliases', async () => {
  const { qcGazeSignal, QC_GAZE_SIGNAL_METHOD } = await load('gaze-tracker/qc-signal.mjs');
  assert.equal(QC_GAZE_SIGNAL_METHOD, 'corrected_validity.v1');
  assert.deepEqual(qcGazeSignal({ valid: true, correctedX: 300, correctedY: 200,
    rawX: 800, rawY: 600, displayX: 400, displayY: 250, x: 401, y: 251 }, viewport),
  { x: 300, y: 200, onScreen: true });
});

test('finite off-screen prediction without a display point stays available but off-screen in QC', async t => {
  const previousWindow = global.window;
  global.window = { innerWidth: viewport.width, innerHeight: viewport.height };
  t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });
  const { qcGazeSignal } = await load('gaze-tracker/qc-signal.mjs');
  const { addGazePoint, createGazeState } = await load('qc-metrics/gaze-tracking.js');
  const { computePercentages, createInstrumentCounters } = await load('qc-metrics/frame-analysis.js');
  const counters = createInstrumentCounters(); let state = createGazeState();
  for (const input of [
    { valid: true, correctedX: 500, correctedY: 350, displayX: 450, displayY: 350, onScreen: true },
    { valid: true, correctedX: 1200, correctedY: 350, displayX: null, displayY: null, onScreen: false },
  ]) {
    const result = addGazePoint(state, qcGazeSignal(input, viewport)); state = result.state;
    counters.gazeTotal++; if (result.gazeValidInc) counters.gazeValid++;
    if (result.gazeOnScreenInc) counters.gazeOnScreen++;
  }
  assert.equal(state.valid, true); assert.equal(state.onScreen, false);
  assert.equal(computePercentages(counters).gazeValidPct, 100);
  assert.equal(computePercentages(counters).gazeOnScreenPct, 50);
});

test('rejected or incomplete corrected signals cannot become valid via plausible display/raw values', async () => {
  const { qcGazeSignal } = await load('gaze-tracker/qc-signal.mjs');
  for (const input of [null, {}, { x: 100, y: 100 },
    { valid: false, correctedX: 100, correctedY: 100, displayX: 100, displayY: 100 },
    { valid: true, correctedX: null, correctedY: 100, rawX: 100, rawY: 100 },
    { valid: true, correctedX: NaN, correctedY: 100 },
    { valid: true, correctedX: 100, correctedY: Infinity },
    { valid: true, correctedX: '100', correctedY: 100 }]) assert.equal(qcGazeSignal(input, viewport), null);
  assert.equal(qcGazeSignal({ valid: true, correctedX: 100, correctedY: 100 }, { width: 0, height: 700 }), null);
});

test('an explicit off-screen flag is never relaxed by in-bounds coordinates and vice versa', async () => {
  const { qcGazeSignal } = await load('gaze-tracker/qc-signal.mjs');
  assert.equal(qcGazeSignal({ valid: true, correctedX: 100, correctedY: 100, onScreen: false }, viewport).onScreen, false);
  assert.equal(qcGazeSignal({ valid: true, correctedX: 1200, correctedY: 100, onScreen: true }, viewport).onScreen, false);
});

test('modular and inline QC count the corrected adapter identically without starting a camera', async t => {
  const previousWindow = global.window;
  global.window = { innerWidth: viewport.width, innerHeight: viewport.height };
  t.after(() => { if (previousWindow === undefined) delete global.window; else global.window = previousWindow; });
  const { qcGazeSignal } = await load('gaze-tracker/qc-signal.mjs');
  const { QCMetrics } = await load('qc-metrics/index.js');
  for (const Ctor of [QCMetrics, InlineQc]) {
    const qc = new Ctor();
    for (const gaze of [
      { valid: true, correctedX: 100, correctedY: 100, displayX: 200, displayY: 200 },
      { valid: true, correctedX: 1200, correctedY: 100, displayX: null, displayY: null },
      { valid: false, correctedX: 100, correctedY: 100, displayX: 200, displayY: 200 },
    ]) qc.addGazePoint(qcGazeSignal(gaze, viewport));
    assert.equal(qc._counters.gazeTotal, 3); assert.equal(qc._counters.gazeValid, 2);
    assert.equal(qc._counters.gazeOnScreen, 1);
  }
});
