// Experimental same-frame selector. No target, current pose, elapsed time or
// prior prediction is read. Fitting uses auxiliary calibration pairs only
// (and the span of the usual red calibration), never green targets.
import { EYE_PATCH_LENGTH } from '../../participant-web/js/gaze-tracker/eye-patch-features.mjs?v=20261107-143';

const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const norm = values => Math.sqrt(dot(values, values));
const valid = values => Array.isArray(values) && values.length === EYE_PATCH_LENGTH
  && values.every(v => Number.isFinite(v) && Math.abs(v) <= 16);
const meanVector = rows => rows[0].map((_, i) => rows.reduce((s, row) => s + row[i], 0) / rows.length);
const subtract = (a, b) => a.map((v, i) => v - b[i]);

function removeProjection(values, basis) {
  const residual = values.slice();
  for (const mode of basis) {
    const k = dot(residual, mode);
    for (let i = 0; i < residual.length; i++) residual[i] -= k * mode[i];
  }
  return residual;
}

function estimate(pairs) {
  const center = meanVector(pairs.map(p => p.first));
  const ordinaryDifferences = pairs.map(p => subtract(p.first, center));
  const basis = [];
  for (const row of ordinaryDifferences) {
    const residual = removeProjection(row, basis), n = norm(residual);
    if (n > .1) basis.push(residual.map(v => v / n));
  }
  // Estimate an appearance direction distinct from between-target variation
  // in the reference posture. If those spaces coincide, abstain.
  const difference = meanVector(pairs.map(p => subtract(p.second, p.first)));
  const residual = removeProjection(difference, basis), n = norm(residual);
  return n >= .1 * Math.sqrt(EYE_PATCH_LENGTH) ? residual.map(v => v / n) : null;
}

export function fitPatchAppearanceGate(pairs, ordinaryCalibration, diagnostics = {}) {
  if (!Array.isArray(pairs) || pairs.length !== 5 || !pairs.every(p => valid(p?.first) && valid(p?.second))
    || !Array.isArray(ordinaryCalibration) || ordinaryCalibration.length !== 50 || !ordinaryCalibration.every(valid)) {
    diagnostics.failureReason = 'incomplete_calibration'; return null;
  }
  const positiveHeldOut = pairs.filter((pair, index) => {
    const direction = estimate(pairs.filter((_, i) => i !== index));
    return direction && dot(direction, subtract(pair.second, pair.first)) > 0;
  }).length;
  diagnostics.heldOutPositivePairs = positiveHeldOut;
  const direction = estimate(pairs);
  if (!direction || positiveHeldOut < 4) {
    diagnostics.failureReason = 'inconsistent_calibration_pairs'; return null;
  }
  const refMax = Math.max(...ordinaryCalibration.map(v => dot(direction, v)), ...pairs.map(p => dot(direction, p.first)));
  const alt = pairs.map(p => dot(direction, p.second)).sort((a, b) => a - b);
  const span = alt[2] - refMax;
  diagnostics.separatedAlternatePairs = alt.filter(value => value > refMax).length;
  if (span <= .1 || alt[1] <= refMax) {
    // Four observed alternate anchors must clear the reference range.
    diagnostics.failureReason = 'overlapping_reference_range'; return null;
  }
  const begin = refMax + .15 * span, end = alt[2], fadeAt = alt[4], cut = fadeAt + span;
  const smooth = a => a * a * (3 - 2 * a);
  return Object.freeze({
    calibrationPairs: pairs.length,
    heldOutPositivePairs: positiveHeldOut,
    weight(patch) {
      if (!valid(patch)) return 0;
      const score = dot(direction, patch);
      if (score <= begin || score >= cut) return 0;
      if (score < end) return smooth((score - begin) / (end - begin));
      if (score > fadeAt) return smooth((cut - score) / (cut - fadeAt));
      return 1;
    },
  });
}

const onScreen = (x, y, view) => x >= 0 && y >= 0 && x <= view.width && y <= view.height;

export function blendPatchRaw(full, paired, weight, viewport, independent = null, maxDisagreementFraction = null) {
  if (!full?.valid || ![full.rawX, full.rawY].every(Number.isFinite)) return null;
  const fallback = reason => ({ rawX: full.rawX, rawY: full.rawY, weight: 0, reason });
  if (!Number.isFinite(weight) || weight <= 0) return fallback('reference_or_unknown');
  if (!paired?.valid || ![paired.rawX, paired.rawY].every(Number.isFinite)) return fallback('paired_unavailable');
  const diagonal = Math.hypot(viewport.width, viewport.height);
  if (maxDisagreementFraction !== null && Math.hypot(full.rawX - paired.rawX, full.rawY - paired.rawY) > maxDisagreementFraction * diagonal) {
    return fallback('eye_disagreement');
  }
  // Never average through a screen boundary. A separate shadow can use a
  // paired estimate when an independent image method also supports it well
  // inside the screen. This is NOT proof of real off-screen specificity.
  if (!onScreen(full.rawX, full.rawY, viewport) || !onScreen(paired.rawX, paired.rawY, viewport)) {
    const margin = .025 * Math.min(viewport.width, viewport.height);
    const interior = p => p.rawX >= margin && p.rawX <= viewport.width - margin
      && p.rawY >= margin && p.rawY <= viewport.height - margin;
    if (!onScreen(full.rawX, full.rawY, viewport) && weight >= .75 && independent?.valid
      && interior(paired) && interior(independent)
      && Math.hypot(paired.rawX - independent.rawX, paired.rawY - independent.rawY) <= .08 * diagonal) {
      return { rawX: paired.rawX, rawY: paired.rawY, weight: 1, reason: 'confirmed_inside' };
    }
    return fallback('boundary_guard');
  }
  const alpha = Math.min(1, weight);
  return { rawX: Math.round(full.rawX + alpha * (paired.rawX - full.rawX)),
    rawY: Math.round(full.rawY + alpha * (paired.rawY - full.rawY)), weight: alpha, reason: 'blended' };
}
