// Reproducible geometry intervention, NOT webcam accuracy/head-motion science.
// Baseline is the current default, candidates see identical input fixtures.
import { performance } from 'node:perf_hooks';
import { landmarksForGaze, changeEyelids } from '../../apps/api/tests/fixtures/gaze-topology.js';
import { createModelComparison } from '../../apps/autotests/manual/issue143-models.mjs';

const viewport = { width: 1470, height: 956 };
function transform(points, camera, angle, scale = 1, tx = 0, ty = 0) {
  return points.map(p => {
    const x = (p.x - .5) * camera.width, y = (p.y - .5) * camera.height;
    return { x: .5 + scale * (x * Math.cos(angle) - y * Math.sin(angle)) / camera.width + tx,
      y: .5 + scale * (x * Math.sin(angle) + y * Math.cos(angle)) / camera.height + ty };
  });
}
const conditions = [
  { name: 'held_out_static', apply: (points, _camera, _i) => points },
  { name: 'pixel_roll', apply: (points, camera, i) => transform(points, camera, (i % 2 ? 1 : -1) * .15) },
  { name: 'translation_scale', apply: (points, camera, i) => transform(points, camera, 0, .95 + .1 * (i % 2), .004, -.003) },
  { name: 'lid_only', apply: points => changeEyelids(points, { factor: .75, centerShift: .004 }) },
  { name: 'deterministic_iris_jitter', apply: (points, _camera, i) => points.map((p, id) =>
    id >= 468 ? { x: p.x + Math.sin(i * 1.7 + id) * .0005, y: p.y + Math.cos(i * 2.1 + id) * .0005 } : p) },
];
const results = [];
for (const camera of [{ width: 640, height: 480 }, { width: 1280, height: 720 }, { width: 640, height: 640 }]) {
  const trackers = createModelComparison(viewport, camera, true);
  for (const x of [-.8, -.4, 0, .4, .8]) for (const y of [-.8, -.4, 0, .4, .8]) for (let click = 0; click < 2; click++) {
    const faces = [landmarksForGaze(x, y)];
    for (const tracker of Object.values(trackers)) if (!tracker.addAveragedCalibrationPoint(faces, 735 + x * 700, 478 + y * 440)) throw Error('calibration_sample');
  }
  for (const tracker of Object.values(trackers)) if (!tracker.calibrate()) throw Error('calibration_fit');
  for (const condition of conditions) {
    const accumulators = Object.fromEntries(Object.keys(trackers).map(name => [name,
      { n: 0, missing: 0, offscreen: 0, error: 0, dx: 0, dy: 0, jitter2: 0, runtimeMs: 0 }]));
    let gateDisagreements = 0;
    for (const x of [-.9, -.6, .2, .9]) for (const y of [-.9, -.6, .2, .9]) {
      const perTarget = Object.fromEntries(Object.keys(trackers).map(name => [name, []]));
      for (let i = 0; i < 20; i++) {
        const landmarks = condition.apply(landmarksForGaze(x, y), camera, i);
        const predictions = {};
        for (const [name, tracker] of Object.entries(trackers)) {
          const start = performance.now(), p = tracker.predict(landmarks, { timestamp: 240000 + i * 33 });
          const a = accumulators[name]; a.runtimeMs += performance.now() - start; a.n++; predictions[name] = p;
          if (!p?.valid) { a.missing++; continue; }
          if (!p.onScreen) a.offscreen++;
          const dx = p.rawX - (735 + x * 700), dy = p.rawY - (478 + y * 440);
          a.error += Math.hypot(dx, dy); a.dx += dx; a.dy += dy;
          perTarget[name].push({ x: p.rawX, y: p.rawY });
        }
        if (Object.values(predictions).some(p => p?.valid !== predictions.baseline?.valid)) gateDisagreements++;
      }
      for (const [name, points] of Object.entries(perTarget)) {
        const cx = points.reduce((s, p) => s + p.x, 0) / points.length, cy = points.reduce((s, p) => s + p.y, 0) / points.length;
        accumulators[name].jitter2 += points.reduce((s, p) => s + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0);
      }
    }
    const offscreen = Object.fromEntries(Object.keys(trackers).map(name => [name, 0]));
    for (const x of [-1.4, 1.4]) for (const y of [-1.4, 1.4]) {
      const landmarks = condition.apply(landmarksForGaze(x, y), camera, 0);
      for (const [name, tracker] of Object.entries(trackers)) {
        const p = tracker.predict(landmarks); if (!p?.valid || !p.onScreen) offscreen[name]++;
      }
    }
    const r = value => Math.round(value * 1000) / 1000;
    results.push({ camera, condition: condition.name, gateDisagreements,
      models: Object.fromEntries(Object.entries(accumulators).map(([name, a]) => [name, {
        captures: a.n, accepted: a.n - a.missing,
        meanRawErrorPx: a.n > a.missing ? r(a.error / (a.n - a.missing)) : null,
        biasXPx: a.n > a.missing ? r(a.dx / (a.n - a.missing)) : null,
        biasYPx: a.n > a.missing ? r(a.dy / (a.n - a.missing)) : null,
        withinTargetRmsSpreadPx: a.n > a.missing ? r(Math.sqrt(a.jitter2 / (a.n - a.missing))) : null,
        missingFraction: a.missing / a.n, offscreenFraction: a.offscreen / a.n,
        offscreenSpecificity4Samples: offscreen[name] / 4,
        meanRegressionRuntimeMs: r(a.runtimeMs / a.n),
      }])) });
  }
}
console.log(JSON.stringify({ version: 'issue143_factorial_synthetic.v1',
  scope: 'synthetic_geometry_only_not_human_accuracy_or_e2e_latency_no_drift_simulation', results }, null, 2));
