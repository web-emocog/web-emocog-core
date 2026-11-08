// Geometry/implementation benchmark only. No real face, camera or human accuracy.
// Usage: node scripts/reference-data/issue143-synthetic.mjs <baseline-git-ref>
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { landmarksForGaze, changeEyelids } from '../../apps/api/tests/fixtures/gaze-topology.js';
import Current from '../../apps/participant-web/js/gaze-tracker/GazeTracker.js';

const ref = process.argv[2];
if (!ref || !/^[a-zA-Z0-9_./-]+$/.test(ref) || ref.startsWith('-')) throw new Error('Explicit safe baseline git ref required');
const root = 'apps/participant-web/js/gaze-tracker/';
const source = file => execFileSync('git', ['show', `${ref}:${root}${file}`], { encoding: 'utf8', maxBuffer: 500000 });
const data = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const constants = data(source('constants.js'));
const features = data(source('features.js').replaceAll("'./constants.js'", JSON.stringify(constants)));
let baseline = source('GazeTracker.js').replaceAll("'./constants.js'", JSON.stringify(constants))
  .replaceAll("'./features.js'", JSON.stringify(features));
for (const file of ['ridge.js', 'signal-processing.mjs']) {
  baseline = baseline.replaceAll(`'./${file}'`, JSON.stringify(pathToFileURL(path.resolve(root, file)).href));
}
const Baseline = (await import(data(baseline))).default;

function measure(Tracker, options = {}) {
  const tracker = new Tracker({ screenWidth: 1470, screenHeight: 956, ...options });
  for (const x of [-.8, -.4, 0, .4, .8]) for (const y of [-.8, -.4, 0, .4, .8]) {
    tracker.addCalibrationPoint(landmarksForGaze(x, y), 735 + x * 700, 478 + y * 440);
  }
  if (!tracker.calibrate()) throw new Error('Synthetic calibration failed');
  const errors = [], shifted = [], times = [], repeat = [], lidErrors = [];
  let missing = 0, offscreenTrueNegative = 0, offscreenN = 0, timestamp = 0;
  for (const x of [-.9, -.6, .2, .9]) for (const y of [-.9, -.6, .2, .9]) {
    for (let i = 0; i < 20; i++) {
      const pose = i < 10 ? {} : { leftShiftX: .004, leftShiftY: .004 };
      const start = performance.now();
      timestamp += 33;
      const gaze = tracker.predict(landmarksForGaze(x, y, pose), { timestamp });
      times.push(performance.now() - start);
      const error = Math.hypot(gaze.rawX - (735 + x * 700), gaze.rawY - (478 + y * 440));
      (i < 10 ? errors : shifted).push(error);
      if (!gaze.valid || !gaze.onScreen) missing++;
      if (x === .2 && y === .2 && i < 10) repeat.push({ x: gaze.rawX, y: gaze.rawY });
    }
  }
  let lidMissing = 0;
  for (const x of [-.9, -.6, .2, .9]) for (const y of [-.9, -.6, .2, .9]) {
    timestamp += 33;
    const gaze = tracker.predict(changeEyelids(landmarksForGaze(x, y), { factor: .75, centerShift: .004 }), { timestamp });
    lidErrors.push(Math.hypot(gaze.rawX - (735 + x * 700), gaze.rawY - (478 + y * 440)));
    if (!gaze.valid || !gaze.onScreen) lidMissing++;
  }
  for (const x of [-1.4, 1.4]) for (const y of [-1.4, 1.4]) {
    timestamp += 33;
    const gaze = tracker.predict(landmarksForGaze(x, y), { timestamp });
    offscreenN++;
    if (!gaze.valid || !gaze.onScreen) offscreenTrueNegative++;
  }
  const mean = rows => rows.reduce((a, b) => a + b, 0) / rows.length;
  const centerX = mean(repeat.map(p => p.x)), centerY = mean(repeat.map(p => p.y));
  const round = value => Math.round(value * 1000) / 1000;
  return {
    sampleCount: 320, heldOutTargets: 16,
    meanRawErrorPx: round(mean(errors)), geometryShiftMeanRawErrorPx: round(mean(shifted)),
    repeatRmsJitterPx: round(Math.sqrt(mean(repeat.map(p => (p.x - centerX) ** 2 + (p.y - centerY) ** 2)))),
    missingOrOffscreenFraction: missing / 320,
    lidOnlyMeanRawErrorPx: round(mean(lidErrors)), lidOnlyMissingOrOffscreenFraction: lidMissing / lidErrors.length,
    offscreenSpecificity: offscreenTrueNegative / offscreenN, offscreenSamples: offscreenN,
    meanPredictionRuntimeMs: round(mean(times)),
  };
}
console.log(JSON.stringify({ scope: 'synthetic_geometry_only_not_webcam_accuracy', baselineRef: ref,
  baseline: measure(Baseline), current: measure(Current),
  diagnosticCandidate: measure(Current, { experimentalGeometry: 'corner_width' }) }, null, 2));
