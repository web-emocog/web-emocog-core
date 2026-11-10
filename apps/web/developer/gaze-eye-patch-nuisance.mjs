// Experimental, local-only calibration. A pair consists of two transient
// eye-patch means at the SAME labelled calibration target under two views.
// The fit sees feature differences, never coordinates, pose or future data.
import { EYE_PATCH_LENGTH } from '../../participant-web/js/gaze-tracker/eye-patch-features.mjs?v=20261107-143';

const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const valid = patch => Array.isArray(patch) && patch.length === EYE_PATCH_LENGTH
  && patch.every(v => Number.isFinite(v) && Math.abs(v) <= 16);

export function fitPatchNuisance(pairs, { rank = 3, strength = 1 } = {}) {
  if (!Array.isArray(pairs) || pairs.length < 4 || pairs.length > 12 || !pairs.every(pair => valid(pair?.first) && valid(pair?.second))
    || !Number.isSafeInteger(rank) || rank < 1 || rank > 6 || !Number.isFinite(strength) || strength < 0 || strength > 1) return null;
  const residuals = pairs.map(({ first, second }) => first.map((v, i) => second[i] - v));
  const basis = [];
  // Pivot on the largest remaining same-target difference. No gaze label or
  // outer measurement takes part in choosing directions or their strength.
  while (basis.length < rank) {
    const norm2 = residuals.map(r => dot(r, r));
    const best = norm2.indexOf(Math.max(...norm2));
    const norm = Math.sqrt(norm2[best]);
    if (norm < .1 * Math.sqrt(EYE_PATCH_LENGTH)) break;
    const direction = residuals[best].map(v => v / norm);
    basis.push(direction);
    for (const r of residuals) {
      const p = dot(r, direction);
      for (let i = 0; i < r.length; i++) r[i] -= p * direction[i];
    }
  }
  if (!basis.length) return null;
  return Object.freeze({
    rank: basis.length,
    project(patch) {
      if (!valid(patch)) return null;
      const coefficients = basis.map(mode => dot(mode, patch));
      return patch.map((v, i) => v - strength * basis.reduce((s, b, j) => s + b[i] * coefficients[j], 0));
    },
  });
}
