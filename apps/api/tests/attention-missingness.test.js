const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/gaze-tracker/attention-metrics.js')).href);
const sample = (t, earAvg) => ({ t, earAvg, leftEAR: earAvg, rightEAR: earAvg, bothOpen: earAvg > .2 });
const open = (from, to, step = 50) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => sample(from + i * step, .3));

test('a closure interrupted by a 350ms frame gap is not a measured blink', async () => {
  const { buildAttentionMetrics } = await load();
  const eyeSignals = [...open(0, 950), sample(1000, .08), sample(1050, .08), sample(1400, .3), sample(1450, .3)];
  const result = buildAttentionMetrics({ eyeSignals }).global;
  assert.equal(result.blinkDynamics.blinkCount, 0);
  assert.equal(result.perclos.episodes.count, 0);
  assert.equal(result.meta.algorithmVersion, '2.4.0');
  assert.equal(result.meta.maxEyeIntervalMs, 250);
});
test('a discontinuity does not carry closure confirmation or baseline into a later segment', async () => {
  const { buildAttentionMetrics } = await load();
  const eyeSignals = [...open(0, 950), sample(1000, .08), sample(1400, .08), sample(1450, .3), sample(1500, .3)];
  assert.equal(buildAttentionMetrics({ eyeSignals }).global.blinkDynamics.blinkCount, 0);
});
test('duplicate timestamps cannot manufacture two confirming closure frames', async () => {
  const { buildAttentionMetrics } = await load();
  const eyeSignals = [...open(0, 950), sample(1000, .08), sample(1000, .08), sample(1100, .3), sample(1150, .3)];
  assert.equal(buildAttentionMetrics({ eyeSignals }).global.blinkDynamics.blinkCount, 0);
});
test('continuous blinks before and after an independent warmup are retained at different frame rates', async () => {
  const { buildAttentionMetrics } = await load();
  for (const step of [20, 40, 50, 100]) {
    const segment = offset => Array.from({ length: Math.floor(3000 / step) + 1 }, (_, i) => {
      const t = i * step; return sample(t + offset, t >= 1500 && t < 1800 ? .08 : .3);
    });
    const result = buildAttentionMetrics({ eyeSignals: [...segment(0), ...segment(5000)] }).global;
    assert.equal(result.blinkDynamics.blinkCount, 2, `step ${step}`);
    assert.ok(result.blinkDynamics.blinks.every(e => e.durationMs <= 700));
  }
});
const gaze = (t, patch = {}) => ({ t, correctedX: 500, correctedY: 350, valid: true, onScreen: true,
  screenWidth: 1000, screenHeight: 700, ...patch });
test('fixations separated by a lost interval or trial boundary are distinct events', async () => {
  const { buildAttentionMetrics } = await load();
  for (const eyeTracking of [
    [gaze(0), gaze(50), gaze(100), gaze(1000), gaze(1050), gaze(1100)],
    [gaze(0, { trialId: 'a' }), gaze(50, { trialId: 'a' }), gaze(100, { trialId: 'a' }),
      gaze(150, { trialId: 'b' }), gaze(200, { trialId: 'b' }), gaze(250, { trialId: 'b' })]
  ]) {
    const result = buildAttentionMetrics({ eyeTracking }).global.saccadesAndFixations;
    assert.equal(result.fixationCount, 2); assert.equal(result.fixationMeanDurationMs, 100);
  }
});
test('rejected or half-missing corrected gaze cannot fall back to display coordinates', async () => {
  const { buildAttentionMetrics } = await load();
  for (const patch of [{ valid: false }, { correctedX: null }, { correctedY: null }]) {
    const eyeTracking = [0, 50, 100, 150].map(t => gaze(t, { x: 500, y: 350, ...patch }));
    assert.equal(buildAttentionMetrics({ eyeTracking }).global.saccadesAndFixations.fixationCount, 0);
  }
  const legacy = [0, 50, 100, 150].map(t => ({ t, x: 500, y: 350, screenWidth: 1000, screenHeight: 700 }));
  assert.equal(buildAttentionMetrics({ eyeTracking: [null, 1, 'bad', ...legacy] }).global.saccadesAndFixations.fixationCount, 1);
});
test('an explicitly rejected gaze sample splits fixation support even inside the maximum gap', async () => {
  const { buildAttentionMetrics } = await load();
  const eyeTracking = [gaze(0), gaze(50), gaze(100), gaze(150, { valid: false }), gaze(200), gaze(250), gaze(300)];
  assert.equal(buildAttentionMetrics({ eyeTracking }).global.saccadesAndFixations.fixationCount, 2);
});
