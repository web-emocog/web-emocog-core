const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.resolve(__dirname,
  '../../participant-web/js/gaze-tracker/validation-sampling.mjs')));

test('validation rejects pre-target, duplicated, out-of-order and unstamped predictions', async () => {
  const { createValidationSamplingWindow } = await load();
  const window = createValidationSamplingWindow({ monotonicStart: 100, wallStart: 1000 });
  assert.equal(window.accept({ frameTimestamp: 99 }), false);
  assert.equal(window.accept({ frameTimestamp: 100 }), true);
  assert.equal(window.accept({ frameTimestamp: 100 }), false);
  assert.equal(window.accept({ frameTimestamp: 101 }), true);
  assert.equal(window.accept({ frameTimestamp: 100.5 }), false);
  assert.equal(window.accept({ timestamp: 1001 }), false);
  assert.equal(window.accept({}), false);
  assert.equal(window.accept({ frameTimestamp: NaN }), false);
  assert.deepEqual(window.summary(), { version: 'unique_capture.v1', attempted: 8, accepted: 2,
    duplicate: 2, beforeWindow: 1, missingTimestamp: 2, clockChanged: 1, clock: 'monotonic' });
});

test('a 30 Hz poll does not turn 15 Hz measurements into 30 Hz validation samples', async () => {
  const { createValidationSamplingWindow } = await load();
  const window = createValidationSamplingWindow({ monotonicStart: 0, wallStart: 1000 });
  let accepted = 0;
  for (let tick = 0; tick < 60; tick++) {
    const frame = Math.floor(tick / 2);
    if (window.accept({ frameTimestamp: frame * 1000 / 15 })) accepted++;
  }
  assert.equal(accepted, 30);
  assert.equal(window.summary().duplicate, 30);
});

test('legacy wall-clock captures stay compatible but cannot change clock within a window', async () => {
  const { createValidationSamplingWindow } = await load();
  const window = createValidationSamplingWindow({ monotonicStart: 100, wallStart: 1000 });
  assert.equal(window.accept({ timestamp: 999 }), false);
  assert.equal(window.accept({ timestamp: 1001 }), true);
  assert.equal(window.accept({ timestamp: 1001 }), false);
  assert.equal(window.accept({ timestamp: 1002 }), true);
  assert.equal(window.accept({ frameTimestamp: 105 }), false);
  assert.equal(window.summary().clock, 'wall');
  assert.throws(() => createValidationSamplingWindow({ monotonicStart: NaN, wallStart: 0 }), /invalid_validation_clock/);
});

test('validation requires measurements from each independent target, not repeated copies of another target', async () => {
  const { validationTargetCoverage } = await load();
  const point = (pointIndex, gazeX = 10) => ({ pointIndex, samples: [{ gazeX, gazeY: 20 }] });
  assert.deepEqual(validationTargetCoverage([point(0), point(0), point(1, NaN), point(9)], 3), {
    version: 'target_coverage.v1', expectedTargets: 3, observedTargets: 1,
    missingTargetIndices: [1, 2], complete: false,
  });
  assert.equal(validationTargetCoverage([point(0), point(1), point(2)], 3).complete, true);
  assert.equal(validationTargetCoverage([], 5).observedTargets, 0);
  assert.throws(() => validationTargetCoverage([], 0), /invalid_validation_targets/);
});
