// Artificial perturbations only. Labels enter the fits only on the 25 red
// calibration positions; the same gaze gates and captures apply to all.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Tracker from '../../apps/participant-web/js/gaze-tracker/GazeTracker.js';
import { landmarksForGaze } from '../../apps/api/tests/fixtures/gaze-topology.js';
import { syntheticEyeImage } from '../../apps/autotests/fixtures/issue143-eye-image.mjs';
import { extractEyePatchFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-patch-features.mjs';
import { extractEyeGradientFeatures } from '../../apps/participant-web/js/gaze-tracker/eye-gradient-features.mjs';
import { projectPatchBackground } from './issue143-patch-background.mjs';
import { fitPatchNuisance } from '../../apps/web/developer/gaze-eye-patch-nuisance.mjs';
import { projectPatchRows } from '../../apps/web/developer/gaze-eye-patch-rows.mjs';
import { fitPatchAppearanceGate, blendPatchRaw } from '../../apps/web/developer/gaze-eye-patch-gate.mjs';
import { fitPatchGeometryGate, readEyeCornerHeight, summarizeEyeCornerHeight } from '../../apps/web/developer/gaze-eye-patch-geometry-gate.mjs';

const camera = { width: 640, height: 480 }, viewport = { width: 1470, height: 956 };
const screen = (x, y) => [(x + 1) * viewport.width / 2, (y + 1) * viewport.height / 2];
const isOff = (x, y) => x < 0 || x > viewport.width || y < 0 || y > viewport.height;
const off = distance => [[-distance, -.2], [-distance, .2], [distance, -.2], [distance, .2],
  [-.2, -distance], [.2, -distance], [-.2, distance], [.2, distance]];
const conditions = {
  reference: {}, lid_up: { lidShift: -.04 }, lid_down: { lidShift: .04 }, partial: { aperture: .14 },
  known_change: { aperture: .19, lidShift: .032 },
  geometry_with_moderate_change: { lidShift: .012, cornerTranslation: .038 },
  geometry_without_image_nuisance: { cornerTranslation: .038 },
  geometry_outside_observed: { cornerTranslation: .10 },
  large_change: { aperture: .16, lidShift: .07 }, novel_slant: { apertureWidth: .43, apertureSlope: .19, lidShift: .025 },
  row_light: { rowIllumination: 45 }, glare: { glare: 250 }, texture: { texture: 20 },
  mixed: { aperture: .17, apertureWidth: .47, apertureSlope: -.08, lidShift: .035,
    contrast: .55, texture: 9, rowIllumination: 26, irisProfile: 'soft_oval' },
  absent: { irisVisible: false, texture: 20 }, closed: { aperture: .035 }, missing: {},
};
const newModes = ['project', 'shrink', 'lateral'];
const pairedModes = ['paired_rank1', 'paired_rank3', 'paired_soft', 'paired_rows', 'paired_rows_multi'];
const ids = ['baseline', 'full', 'gradient_all', 'rows', ...newModes, ...pairedModes];
const shadowIds = ['adaptive', 'adaptive_confirmed', 'geometry', 'geometry_confirmed'];
const average = values => values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
const falseRates = () => ({ trueOffScreen: 0, falseOnScreen: 0, missing: 0 });

export function runPatchBackgroundSynthetic() {
  const anchorPatch = (x, y, change) => {
    const face = landmarksForGaze(x, y);
    return extractEyePatchFeatures(syntheticEyeImage(face, { ...camera, gazeX: x, gazeY: y, ...change }), face);
  };
  const anchors = [[-.53, -.51], [.53, -.51], [.07, .05], [-.53, .51], [.53, .51]];
  const pairs = anchors.map(([x, y]) => ({ first: anchorPatch(x, y, {}),
    second: anchorPatch(x, y, { aperture: .19, lidShift: .032 }) }));
  const rowsPairs = pairs.map(p => ({ first: projectPatchRows(p.first), second: projectPatchRows(p.second) }));
  // Deliberately different calibration-only nuisances to check if one learned
  // pose direction can be complemented by shape variation on other anchors.
  const variants = [{ aperture: .18 }, { lidShift: -.025 }, { lidShift: .034 },
    { aperture: .19, lidShift: .032 }, { aperture: .19, apertureSlope: .07 }];
  const multi = anchors.map(([x, y], i) => ({ first: rowsPairs[i].first,
    second: projectPatchRows(anchorPatch(x, y, variants[i])) }));
  const paired = { paired_rank1: fitPatchNuisance(pairs, { rank: 1 }), paired_rank3: fitPatchNuisance(pairs, { rank: 3 }),
    paired_soft: fitPatchNuisance(pairs, { rank: 3, strength: .8 }),
    paired_rows: fitPatchNuisance(rowsPairs, { rank: 3 }), paired_rows_multi: fitPatchNuisance(multi, { rank: 3 }) };
  if (!Object.values(paired).every(Boolean)) throw Error('nuisance_fit_failed');
  pairs.length = 0;
  const vectors = new WeakMap();
  const options = { screenWidth: viewport.width, screenHeight: viewport.height };
  const models = { baseline: new Tracker(options) };
  for (const name of ids.slice(1)) models[name] = new Tracker({ ...options,
    experimentalEyePatch: { frameWidth: camera.width, frameHeight: camera.height,
      region: name === 'gradient_all' || name === 'rows' ? name : pairedModes.includes(name) ? 'nuisance' : 'full',
      readFeatures: face => vectors.get(face)?.[name] } });
  const capture = (x, y, image, missing = false) => {
    const source = landmarksForGaze(x, y), dy = image.cornerTranslation || 0;
    const face = dy ? source.map(point => ({ ...point, y: point.y + dy })) : source;
    const pixels = missing ? null : syntheticEyeImage(face, { ...camera, gazeX: x, gazeY: y, ...image });
    const full = extractEyePatchFeatures(pixels, face);
    const rows = projectPatchRows(full);
    vectors.set(face, { full, rows, gradient_all: extractEyeGradientFeatures(pixels, face, { support: 'all' }),
      ...Object.fromEntries(newModes.map(id => [id, projectPatchBackground(full, id)])),
      ...Object.fromEntries(pairedModes.map(id => [id, paired[id].project(id.startsWith('paired_rows') ? rows : full)])) });
    return face;
  };
  const ordinary = [], geometryRows = [];
  const profile = value => summarizeEyeCornerHeight([value - .0002, value, value + .0002]);
  const geometryPairs = anchors.map(([x, y]) => {
    const reference = readEyeCornerHeight(landmarksForGaze(x, y));
    return { first: profile(reference), second: profile(reference + .038) };
  });
  for (const x of [-.84, -.42, 0, .42, .84]) for (const y of [-.84, -.42, 0, .42, .84]) for (let click = 0; click < 2; click++) {
    const face = capture(x + click * .008, y - click * .008, {});
    ordinary.push(vectors.get(face).rows);
    geometryRows.push(profile(readEyeCornerHeight(face)));
    for (const tracker of Object.values(models)) if (!tracker.addCalibrationPoint(face, ...screen(x, y))) throw Error('calibration_frame_rejected');
  }
  const gate = fitPatchAppearanceGate(rowsPairs, ordinary);
  const geometryGate = fitPatchGeometryGate(geometryPairs, geometryRows);
  if (!geometryGate) throw Error('geometry_fixture_gate_failed');
  for (const tracker of Object.values(models)) if (!tracker.calibrate()) throw Error('calibration_fit_failed');
  let time = 0;
  const predict = (x, y, image, missing) => {
    const face = capture(x, y, image, missing), context = { timestamp: time += 33 };
    const p = Object.fromEntries(Object.entries(models).map(([name, tracker]) => [name, tracker.predict(face, context)]));
    const weight = gate?.weight(vectors.get(face).rows);
    const blend = blendPatchRaw(p.full, p.paired_rows, weight, viewport);
    const confirmed = blendPatchRaw(p.full, p.paired_rows, weight, viewport, p.gradient_all);
    const geometryWeight = geometryGate.weight(readEyeCornerHeight(face));
    const geometry = blendPatchRaw(p.full, p.paired_rows, geometryWeight, viewport, null, .16);
    const geometryConfirmed = blendPatchRaw(p.full, p.paired_rows, geometryWeight, viewport, p.gradient_all, .16);
    return { values: { ...Object.fromEntries(Object.entries(p).map(([id, v]) => [id, v?.valid ? [v.rawX, v.rawY] : null])),
      adaptive: blend ? [blend.rawX, blend.rawY] : null,
      adaptive_confirmed: confirmed ? [confirmed.rawX, confirmed.rawY] : null,
      geometry: geometry ? [geometry.rawX, geometry.rawY] : null,
      geometry_confirmed: geometryConfirmed ? [geometryConfirmed.rawX, geometryConfirmed.rawY] : null },
      gateReason: blend?.reason, confirmedReason: confirmed?.reason, geometryReason: geometry?.reason,
      geometryConfirmedReason: geometryConfirmed?.reason };
  };
  return { version: 'issue143_patch_background_synthetic.v6', scope: 'artificial_fixtures_only_not_accuracy_or_pose_evidence',
    appearanceGate: gate ? { available: true, heldOutPositivePairs: gate.heldOutPositivePairs } : { available: false },
    pairedProjection: Object.fromEntries(pairedModes.map(id => [id, { fittedRank: paired[id].rank, anchorPairs: anchors.length }])),
    results: Object.entries(conditions).map(([condition, image]) => {
      const totals = Object.fromEntries([...ids, ...shadowIds].map(id => [id, { errors: [], bottom: [], common: [], off: 0,
        spread2: 0, near: falseRates(), far: falseRates() }]));
      const actions = {}, confirmedActions = {}, geometryActions = {}, geometryConfirmedActions = {};
      const grid = [-.94, -.62, -.21, .23, .65, .94];
      for (const x of grid) for (const y of grid) {
        const target = screen(x, y);
        const window = Object.fromEntries(Object.keys(totals).map(id => [id, []]));
        const error = p => Math.hypot(p[0] - target[0], p[1] - target[1]);
        for (let i = 0; i < 4; i++) {
          const result = predict(x + .012 * Math.sin(i * 1.7), y + .012 * Math.cos(i * 1.9),
            { ...image, texturePhase: .17 * i }, condition === 'missing' && i % 2 === 0);
          const predictions = result.values;
          const action = result.gateReason || 'full_missing';
          actions[action] = (actions[action] || 0) + 1;
          const confirmedAction = result.confirmedReason || 'full_missing';
          confirmedActions[confirmedAction] = (confirmedActions[confirmedAction] || 0) + 1;
          for (const [reason, counts] of [[result.geometryReason, geometryActions], [result.geometryConfirmedReason, geometryConfirmedActions]]) {
            const action = reason || 'full_missing';
            counts[action] = (counts[action] || 0) + 1;
          }
          for (const [name, p] of Object.entries(predictions)) if (p) {
            const t = totals[name], e = error(p);
            t.errors.push(e);
            window[name].push(p);
            if (y === .94) t.bottom.push(e);
            if (predictions.full) t.common.push(e - error(predictions.full));
            t.off += Number(isOff(...p));
          }
        }
        for (const [id, samples] of Object.entries(window)) if (samples.length) {
          const x = average(samples.map(p => p[0])), y = average(samples.map(p => p[1]));
          totals[id].spread2 += samples.reduce((sum, p) => sum + (p[0] - x) ** 2 + (p[1] - y) ** 2, 0);
        }
      }
      for (const [band, distance] of [['near', 1.06], ['far', 1.25]]) for (const [x, y] of off(distance)) {
        for (const [name, p] of Object.entries(predict(x, y, image, false).values)) {
          totals[name][band][!p ? 'missing' : isOff(...p) ? 'trueOffScreen' : 'falseOnScreen']++;
        }
      }
      return { condition, actions, confirmedActions, geometryActions, geometryConfirmedActions,
        models: Object.fromEntries(Object.entries(totals).map(([name, t]) => [name, {
        accepted: t.errors.length, attempted: 144, meanErrorPx: average(t.errors), bottomMeanErrorPx: average(t.bottom),
        commonFull: t.common.length, meanDeltaVsFullPx: average(t.common), falseOffScreen: t.off,
        withinTargetSpreadPx: t.errors.length ? Math.sqrt(t.spread2 / t.errors.length) : null, near: t.near, far: t.far }])) };
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(runPatchBackgroundSynthetic(), null, 2));
}
