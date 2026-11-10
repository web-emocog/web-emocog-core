// Offline-only original experiment. A dark-region shape is not a physical pupil
// model. Screen coordinates, pose, history and landmarks beyond the crop corners
// never enter this descriptor. No external code or weights.
import { extractRowPatch, EYE_TOPHAT_LENGTH, ROW_PATCH_SPEC } from '../../apps/participant-web/js/gaze-tracker/eye-tophat-features.mjs';
import { dotProduct, ridgeRegression } from '../../apps/participant-web/js/gaze-tracker/ridge.js';

const cols = ROW_PATCH_SPEC.columns / ROW_PATCH_SPEC.pooling;
const rows = ROW_PATCH_SPEC.rows / ROW_PATCH_SPEC.pooling;
const grid = Array.from({ length: rows * cols }, (_, i) => {
  const x = (i % cols + .5) / cols * 2 - 1, y = (Math.floor(i / cols) + .5) / rows * 2 - 1;
  return [x, y, x * x, y * y, 1];
});

// Black top-hat suppresses horizontal background. Test whether a compact fitted
// center can retain the useful eye motion without fitting all 320 intensities.
// The log quadratic is an original simplified appearance hypothesis, not RANSAC
// on pupil contours. Large residuals receive less influence in one fixed refit.
function fitEye(values, background = Math.min(...values), support = null) {
  const peak = Math.max(...(support ? support.map(i => values[i]) : values)) - background;
  if (!(peak > .3)) return null;
  const points = Array.from(support ?? grid.keys()).flatMap(index => {
    const signal = (values[index] - background) / peak;
    return signal >= .12 ? [{ basis: grid[index], log: Math.log(signal), signal }] : [];
  });
  if (points.length < 9 || new Set(points.map(e => e.basis[0])).size < 3
    || new Set(points.map(e => e.basis[1])).size < 3) return null;

  // ridgeRegression leaves its last coefficient unregularized. Weight the
  // entire design row, including the intercept, for weighted least squares.
  const solve = prior => {
    const weights = points.map(({ basis, log, signal }) => {
      const residual = prior ? Math.abs(log - dotProduct(basis, prior)) : 0;
      return Math.sqrt(signal * (residual > .45 ? .45 / residual : 1));
    });
    return ridgeRegression(points.map(({ basis }, i) => basis.map(x => x * weights[i])),
      points.map(({ log }, i) => log * weights[i]), .0001);
  };
  const weights = solve(solve(null));
  if (!weights.every(Number.isFinite) || weights[2] >= 0 || weights[3] >= 0) return null;
  const x = -.5 * weights[0] / weights[2], y = -.5 * weights[1] / weights[3];
  const sx = ROW_PATCH_SPEC.width / 2 * Math.sqrt(-.5 / weights[2]);
  const sy = ROW_PATCH_SPEC.height / 2 * Math.sqrt(-.5 / weights[3]);
  // Do not clamp a peak outside the measured grid into a plausible center.
  if (Math.abs(x) >= 1 - 1 / cols || Math.abs(y) >= 1 - 1 / rows
    || sx < .02 || sx > .2 || sy < .02 || sy > .2) return null;
  return [x * ROW_PATCH_SPEC.width, y * ROW_PATCH_SPEC.height];
}

const inGrid = (x, y) => x >= 0 && x < cols && y >= 0 && y < rows;
const median = values => {
  values.sort((a, b) => a - b);
  return (values[(values.length - 1) >> 1] + values[values.length >> 1]) / 2;
};
const ring = [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, 3], [3, -3], [-3, -3]];
const smoothOffsets = [-1, 0, 1].flatMap(y => [-1, 0, 1].map(x => [x, y, (x === 0 ? 2 : 1) * (y === 0 ? 2 : 1)]));

function fitLocalEye(values, requireObservedSupport = false) {
  // A little spatial smoothing + contrast against an annulus proposes a local
  // center without using gaze, landmarks, time or the previous prediction.
  const smooth = values.map((_, i) => {
    let sum = 0, weight = 0;
    for (const [dx, dy, w] of smoothOffsets) {
      const x = i % cols + dx, y = Math.floor(i / cols) + dy;
      if (inGrid(x, y)) { sum += w * values[y * cols + x]; weight += w; }
    }
    return sum / weight;
  });
  let best = null;
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
    const neighbors = ring.flatMap(([dx, dy]) => inGrid(x + dx, y + dy) ? [smooth[(y + dy) * cols + x + dx]] : []);
    if (neighbors.length < 4) continue;
    const background = median(neighbors), score = smooth[y * cols + x] - background;
    if (!best || score > best.score) best = { x, y, background, score };
  }
  if (!best || best.score <= .3) return null;

  // Exclude separated regions from the fit. A false peak can still win seed
  // selection, so local connectedness alone is not proof of visible iris.
  const seed = best.y * cols + best.x, support = [seed], visited = new Set(support);
  for (let i = 0; i < support.length; i++) {
    for (const [dx, dy] of smoothOffsets) {
      const x = support[i] % cols + dx, y = Math.floor(support[i] / cols) + dy;
      const j = y * cols + x;
      if (!inGrid(x, y) || visited.has(j) || (x - best.x) ** 2 + (y - best.y) ** 2 > 16) continue;
      visited.add(j);
      if (smooth[j] - best.background >= .12 * best.score) support.push(j);
    }
  }
  const center = fitEye(smooth, best.background, support);
  if (!center || !requireObservedSupport) return center;

  // Smoothing is useful for localization but can spread a thin dark stripe
  // across several rows. Require support in the UNSMOOTHED pooled cells too.
  // This is a descriptor availability check, not a change to the iris/head gate.
  const rim = ring.flatMap(([dx, dy]) => inGrid(best.x + dx, best.y + dy)
    ? [values[(best.y + dy) * cols + best.x + dx]] : []);
  const background = median(rim), peak = Math.max(...support.map(i => values[i])) - background;
  if (peak <= .3) return null;
  const observed = support.filter(i => values[i] - background >= .12 * peak).map(i => grid[i]);
  for (const [axis, width] of [ROW_PATCH_SPEC.width, ROW_PATCH_SPEC.height].entries()) {
    const span = [...new Set(observed.map(basis => basis[axis]))];
    const position = center[axis] / width;
    if (span.length < 3 || position <= Math.min(...span) || position >= Math.max(...span)) return null;
  }
  return center;
}

export function fitEyeShapeCenters(topHat, method = 'global') {
  if (!Array.isArray(topHat) || topHat.length !== EYE_TOPHAT_LENGTH || !topHat.every(Number.isFinite)) return null;
  if (!['global', 'local', 'local_observed'].includes(method)) return null;
  const fit = method === 'global' ? fitEye : eye => fitLocalEye(eye, method === 'local_observed');
  const left = fit(topHat.slice(0, grid.length)), right = fit(topHat.slice(grid.length));
  return left && right ? [...left, ...right] : null;
}

export function extractEyeShapeCenters(pixels, landmarks, method) {
  return fitEyeShapeCenters(extractRowPatch(pixels, landmarks, 'row_tophat'), method);
}

// Both descriptors use 2 * eye-width-normalized offsets. Two pooled cells
// (.10 eye widths) is the fixed disagreement bound, not learned on targets.
// This ablation cannot recover frames where the independent descriptor fails.
export function confirmEyeShapeCenters(centers, gradientCenters) {
  if (![centers, gradientCenters].every(v => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite))) return null;
  return [0, 2].every(i => Math.hypot(centers[i] - gradientCenters[i], centers[i + 1] - gradientCenters[i + 1]) <= .20)
    ? centers : null;
}
