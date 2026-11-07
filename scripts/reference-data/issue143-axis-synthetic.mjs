// Controlled regression experiment, not webcam accuracy or a simulation of a
// person's drift. No recorded landmarks, calibration rows or media are used.
import { performance } from 'node:perf_hooks';
import { landmarksForGaze } from '../../apps/api/tests/fixtures/gaze-topology.js';
import { createModelComparison } from '../../apps/autotests/manual/issue143-models.mjs';

const viewport = { width: 1470, height: 956 }, camera = { width: 640, height: 480 };
const seeds = [1, 2, 3], noiseLevels = [0, .04];
const training = [-.8, -.4, 0, .4, .8];
const heldOut = [-.65, -.2, .2, .65];
const truths = {
  linear_xy: (x, y) => ({ x: 735 + 500 * x, y: 478 + 320 * y }),
  nonlinear_x_linear_y: (x, y) => ({ x: 735 + 500 * x + 140 * x * y, y: 478 + 320 * y }),
  nonlinear_xy: (x, y) => ({ x: 735 + 500 * x + 140 * x * y, y: 478 + 320 * y + 110 * y * y }),
};
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const round = v => Math.round(v * 1000) / 1000;
const results = [];
for (const [truthName, truth] of Object.entries(truths)) for (const noise of noiseLevels) {
  const conditions = Object.fromEntries(['held_out', 'shared_vertical_input_shift'].map(name => [name, {
    gateDisagreements: 0, models: null,
  }]));
  const selection = {};
  for (const seed of seeds) {
    const rng = random(seed), trackers = createModelComparison(viewport, camera, 'axis');
    // Noise is applied to a synthetic click-mean feature, not to target labels.
    // Two clicks at a target always stay together in the calibration CV fold.
    for (const x of training) for (const y of training) for (let click = 0; click < 2; click++) {
      const face = landmarksForGaze(x + (rng() * 2 - 1) * noise, y + (rng() * 2 - 1) * noise);
      const target = truth(x, y);
      for (const tracker of Object.values(trackers)) {
        if (!tracker.addCalibrationPoint(face, target.x, target.y)) throw Error('synthetic_calibration_sample_rejected');
      }
    }
    for (const [name, tracker] of Object.entries(trackers)) {
      if (!tracker.calibrate()) throw Error('synthetic_calibration_fit_failed');
      const d = tracker.getCalibrationDiagnostics();
      (selection[name] ??= []).push({ seed, basisX: d.basisX, basisY: d.basisY, lambdaX: d.lambdaX, lambdaY: d.lambdaY });
    }
    for (const [condition, out] of Object.entries(conditions)) {
      out.models ??= Object.fromEntries(Object.keys(trackers).map(name => [name, {
        count: 0, accepted: 0, offscreen: 0, error: 0, squaredX: 0, squaredY: 0,
        spreadSquared: 0, regressionMs: 0, horizontalOffscreenRejected: 0,
      }]));
      // Fresh, reproducible held-out noise. Both conditions use the same noise;
      // the second adds an unobserved shared vertical input offset, NOT time.
      const heldRng = random(seed + 100);
      for (const x of heldOut) for (const y of heldOut) {
        const target = truth(x, y);
        const perTarget = Object.fromEntries(Object.keys(trackers).map(name => [name, []]));
        for (let i = 0; i < 20; i++) {
          const face = landmarksForGaze(x + (heldRng() * 2 - 1) * noise,
            y + (heldRng() * 2 - 1) * noise + (condition === 'held_out' ? 0 : .12));
          const predictions = {};
          for (const [name, tracker] of Object.entries(trackers)) {
            const start = performance.now(), p = tracker.predict(face);
            const a = out.models[name]; a.regressionMs += performance.now() - start; a.count++; predictions[name] = p;
            if (!p?.valid) continue;
            a.accepted++; if (!p.onScreen) a.offscreen++;
            const dx = p.rawX - target.x, dy = p.rawY - target.y;
            a.error += Math.hypot(dx, dy); a.squaredX += dx * dx; a.squaredY += dy * dy;
            perTarget[name].push({ x: p.rawX, y: p.rawY });
          }
          if (Object.values(predictions).some(p => p?.valid !== predictions.baseline?.valid)) out.gateDisagreements++;
        }
        for (const [name, points] of Object.entries(perTarget)) {
          if (!points.length) continue;
          const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
          const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
          out.models[name].spreadSquared += points.reduce((s, p) => s + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0);
        }
      }
      // Four true horizontal off-screen inputs; no vertical-specificity claim.
      for (const x of [-2, 2]) for (const y of [-.25, .25]) {
        const target = truth(x, y);
        if (target.x >= 0 && target.x <= viewport.width) throw Error('invalid_offscreen_fixture');
        const face = landmarksForGaze(x, y + (condition === 'held_out' ? 0 : .12));
        for (const [name, tracker] of Object.entries(trackers)) {
          const p = tracker.predict(face);
          if (!p?.valid || !p.onScreen) out.models[name].horizontalOffscreenRejected++;
        }
      }
    }
  }
  for (const [condition, out] of Object.entries(conditions)) results.push({ truth: truthName, noise, condition,
    gateDisagreements: out.gateDisagreements,
    models: Object.fromEntries(Object.entries(out.models).map(([name, a]) => [name, {
      captures: a.count, accepted: a.accepted,
      meanRawErrorPx: a.accepted ? round(a.error / a.accepted) : null,
      rmsXPx: a.accepted ? round(Math.sqrt(a.squaredX / a.accepted)) : null,
      rmsYPx: a.accepted ? round(Math.sqrt(a.squaredY / a.accepted)) : null,
      withinTargetRmsSpreadPx: a.accepted ? round(Math.sqrt(a.spreadSquared / a.accepted)) : null,
      missingFraction: 1 - a.accepted / a.count,
      offscreenFractionOfAccepted: a.accepted ? a.offscreen / a.accepted : null,
      horizontalOffscreenSpecificity12Samples: a.horizontalOffscreenRejected / (4 * seeds.length),
      meanRegressionRuntimeMs: round(a.regressionMs / a.count),
      selection: selection[name],
    }])) });
}
console.log(JSON.stringify({ version: 'issue143_axis_synthetic.v1', seeds,
  scope: 'controlled_regression_only_not_webcam_accuracy_head_motion_e2e_latency_or_temporal_drift',
  correction: 'none_raw_only', results }, null, 2));
