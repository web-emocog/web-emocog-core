// Local diagnostic only: a measured lid aperture masks evidence but does not
// move the crop or supply a center to the predictor. No target/pose/history.
import { EYE_TOPHAT_LENGTH, ROW_PATCH_SPEC, extractRowPatch } from '../../participant-web/js/gaze-tracker/eye-tophat-features.mjs?v=20261108-143l';
import { LANDMARKS } from '../../participant-web/js/gaze-tracker/constants.js?v=20261106-143';
import { getFramePixels } from '../../participant-web/js/session-runtime/frame-pixels.mjs';

const eyes = [
  [LANDMARKS.LEFT_EYE_INNER, LANDMARKS.LEFT_EYE_OUTER, LANDMARKS.LEFT_EYE_TOP, LANDMARKS.LEFT_EYE_BOTTOM],
  [LANDMARKS.RIGHT_EYE_INNER, LANDMARKS.RIGHT_EYE_OUTER, LANDMARKS.RIGHT_EYE_TOP, LANDMARKS.RIGHT_EYE_BOTTOM],
];
const cols = ROW_PATCH_SPEC.columns / ROW_PATCH_SPEC.pooling, rows = ROW_PATCH_SPEC.rows / ROW_PATCH_SPEC.pooling;
const xs = Array.from({ length: cols }, (_, i) => ROW_PATCH_SPEC.width * ((i + .5) / cols - .5));
const ys = Array.from({ length: rows }, (_, i) => ROW_PATCH_SPEC.height * ((i + .5) / rows - .5));
const sizes = [[.055, .055], [.075, .055], [.08, .075]];
const xMax = .30, yMax = .20, step = .025;
const makeGrid = pooled => Array.from({ length: 25 }, (_, i) => (i - 12) * step).flatMap(x =>
  Array.from({ length: 17 }, (_, j) => (j - 8) * step).flatMap(y => sizes.map(([sx, sy]) => template(x, y, sx, sy, pooled))));
// Lazily build only the selected lattice (coarse/fine exist for offline ablation).
const grids = new Map();

function template(x, y, sx, sy, pooled = false) {
  const axis = (samples, center, width, offset) => {
    const gaussian = p => Math.exp(-.5 * ((p - center) / width) ** 2);
    return pooled ? samples.map(p => (gaussian(p - offset) + gaussian(p + offset)) / 2) : samples.map(gaussian);
  };
  return { x, y, sx, sy, columns: axis(xs, x, sx, ROW_PATCH_SPEC.width / cols / 4),
    rows: axis(ys, y, sy, ROW_PATCH_SPEC.height / rows / 4) };
}

function apertureBounds(pixels, face, lids, [a, b, upper, lower]) {
  const { width, height } = pixels;
  const [first, second, top, bottom] = [face?.[a], face?.[b], lids?.[upper], lids?.[lower]];
  if (![first, second, top, bottom].every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y))) return null;
  let dx = (second.x - first.x) * width, dy = (second.y - first.y) * height;
  const size = Math.hypot(dx, dy);
  if (size < 1) return null;
  if (dx < 0) { dx = -dx; dy = -dy; }
  const centerX = (first.x + second.x) / 2, centerY = (first.y + second.y) / 2;
  const v = p => (-dy * (p.x - centerX) * width + dx * (p.y - centerY) * height) / (size * size);
  const high = v(top), low = v(bottom);
  if (!(high < low) || low - high > .8) return null;
  return { mid: (high + low) / 2, half: (low - high) / 2 };
}

function score(candidate, support, dataEnergy) {
  let covariance = 0, templateEnergy = 0;
  for (const { row, columns, centered, weights, mass } of support) {
    let sum = 0, squares = 0;
    for (let i = 0; i < columns.length; i++) {
      const v = candidate.rows[row] * candidate.columns[columns[i]];
      const wv = weights ? weights[i] * v : v;
      sum += wv; squares += wv * v; covariance += wv * centered[i];
    }
    // Row-dependent illumination is a nuisance intercept, not an iris row.
    templateEnergy += Math.max(0, squares - sum * sum / mass);
  }
  return templateEnergy > .02 ? covariance / Math.sqrt(dataEnergy * templateEnergy) : -Infinity;
}

function lidSupportWeight(x, y, aperture) {
  const halfCell = ROW_PATCH_SPEC.height / rows / 2;
  const u = (Math.abs(x) + ROW_PATCH_SPEC.width / cols / 4) / .5;
  if (u >= 1) return 0;
  const h = aperture.half * Math.sqrt(1 - u * u);
  const coverage = Math.max(0, Math.min(y + halfCell, aperture.mid + h)
    - Math.max(y - halfCell, aperture.mid - h)) / (2 * halfCell);
  // A mixed cell is measured, not interpolated: downweight it rather than
  // claiming all its brightness comes from the visible part of the eye.
  return Math.min(1, coverage) ** 2;
}

function fitMaskedEye(values, aperture, { fine = false, pooledFit = false, softSupport = false }) {
  const support = [];
  for (let row = 0; row < rows; row++) {
    const columns = [], weights = softSupport ? [] : null;
    for (let col = 0; col < cols; col++) {
      if (weights) {
        const weight = lidSupportWeight(xs[col], ys[row], aperture);
        if (weight >= .12) { columns.push(col); weights.push(weight); }
      } else {
        // Include only interior cells, with a margin for their pooled footprint.
        const u = Math.abs(xs[col]) + .018, v = Math.abs(ys[row] - aperture.mid) + .018;
        if ((u / .5) ** 2 + (v / aperture.half) ** 2 < 1) columns.push(col);
      }
    }
    const mass = weights ? weights.reduce((sum, w) => sum + w, 0) : columns.length;
    if (columns.length < 4 || mass < (weights ? 2.5 : 4)) continue;
    const brightness = columns.map(col => values[row * cols + col]);
    const mean = brightness.reduce((sum, x, i) => sum + x * (weights?.[i] ?? 1), 0) / mass;
    support.push({ row, columns, centered: brightness.map(x => mean - x), weights, mass });
  }
  if (support.length < 3) return { reason: 'insufficient_visible_rows' };
  const energy = support.reduce((sum, row) =>
    sum + row.centered.reduce((s, x, i) => s + x * x * (row.weights?.[i] ?? 1), 0), 0);
  if (energy < .5) return { reason: 'low_contrast' };
  const candidates = [];
  const minY = ys[support[0].row] - .07, maxY = ys[support.at(-1).row] + .07;
  if (!grids.has(pooledFit)) grids.set(pooledFit, makeGrid(pooledFit));
  for (const entry of grids.get(pooledFit)) {
    if (entry.y < minY || entry.y > maxY) continue; // bounded extrapolation, no invented pixels
    candidates.push({ entry, quality: score(entry, support, energy) });
  }
  let best = null;
  for (const candidate of candidates) if (!best || candidate.quality > best.quality) best = candidate;
  if (!best || best.quality < .72) return { reason: 'weak_match' };
  // A coarse eye-space lattice maps to much larger screen-space steps. Use
  // the SAME image objective and shape widths at progressively finer scales.
  const bounded = (x, y) => Math.abs(x) <= xMax && Math.abs(y) <= yMax && y >= minY && y <= maxY;
  const probe = (x, y, sx, sy) => {
    const entry = template(x, y, sx, sy, pooledFit), quality = score(entry, support, energy);
    if (quality > best.quality) best = { entry, quality };
  };
  for (let refinement = 1; refinement <= (fine || pooledFit ? 4 : 1); refinement++) {
    const { x, y, sx, sy } = best.entry, radius = step / (2 ** refinement);
    for (const dx of [-radius, 0, radius]) for (const dy of [-radius, 0, radius]) {
      if (dx === 0 && dy === 0) continue;
      const nextX = x + dx, nextY = y + dy;
      if (bounded(nextX, nextY)) probe(nextX, nextY, sx, sy);
    }
    if (pooledFit) {
      // Match the measured cell footprint instead of treating it as a point.
      // Allow bounded variation in shape widths; no guessed missing pixels.
      const current = best.entry;
      for (const dx of [-radius, 0, radius]) for (const dy of [-radius, 0, radius]) {
        const nextX = current.sx + dx, nextY = current.sy + dy;
        if ((dx || dy) && nextX >= .04 && nextX <= .11 && nextY >= .04 && nextY <= .11) {
          probe(current.x, current.y, nextX, nextY);
        }
      }
    }
  }
  // Constrained maxima or two nearly equal distant explanations are missing.
  const p = best.entry;
  if (Math.abs(p.x) >= xMax - 1e-9 || Math.abs(p.y) >= yMax - 1e-9 || p.y <= minY || p.y >= maxY) {
    return { reason: 'search_boundary' };
  }
  if (candidates.some(({ entry, quality }) => quality >= best.quality - .025 && Math.hypot(entry.x - p.x, entry.y - p.y) >= .10)) {
    return { reason: 'ambiguous_match' };
  }
  return { center: [2 * p.x, 2 * p.y] };
}

function evaluateMaskedEyeCenters(pixels, landmarks, visibilityLandmarks, options) {
  const raw = extractRowPatch(pixels, landmarks, 'raw');
  return evaluateCrop(raw, pixels, landmarks, visibilityLandmarks, options);
}

function evaluateCrop(raw, pixels, landmarks, visibilityLandmarks, options) {
  if (!raw || raw.length !== EYE_TOPHAT_LENGTH) return { centers: null, reason: 'unusable_crop' };
  const centers = [];
  for (const [index, eye] of eyes.entries()) {
    const aperture = apertureBounds(pixels, landmarks, visibilityLandmarks, eye);
    if (!aperture) return { centers: null, reason: 'invalid_lid_geometry' };
    const { center, reason } = fitMaskedEye(raw.slice(index * rows * cols, (index + 1) * rows * cols), aperture, options);
    if (!center) return { centers: null, reason };
    centers.push(...center);
  }
  return { centers, reason: null };
}

export function extractMaskedEyeCenters(pixels, landmarks, visibilityLandmarks = landmarks, options = {}) {
  return evaluateMaskedEyeCenters(pixels, landmarks, visibilityLandmarks, options).centers;
}

export function measureMaskedEyeFrame(frame) {
  const pixels = getFramePixels(frame);
  if (!pixels || pixels.width !== frame?.frameSize?.width || pixels.height !== frame?.frameSize?.height) {
    return { centers: null, reason: 'missing_frame_pixels' };
  }
  return evaluateMaskedEyeCenters(pixels, frame.landmarks, frame.landmarks, { pooledFit: true });
}

export function measureLidSupportPair(frame) {
  const pixels = getFramePixels(frame);
  if (!pixels || pixels.width !== frame?.frameSize?.width || pixels.height !== frame?.frameSize?.height) {
    return { hard: 'missing_frame_pixels', soft: 'missing_frame_pixels' };
  }
  const face = frame.landmarks, crop = extractRowPatch(pixels, face, 'raw');
  const hard = evaluateCrop(crop, pixels, face, face, { pooledFit: true });
  const soft = evaluateCrop(crop, pixels, face, face, { pooledFit: true, softSupport: true });
  // The probe has no consumers for centers; do not retain them even transiently
  // beyond extraction and never pass them to the click recorder.
  return { hard: hard.reason, soft: soft.reason };
}
