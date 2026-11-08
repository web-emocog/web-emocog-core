// OFFLINE ONLY: this negative experiment is not imported by participant code.
// Original, experimental fit. No image/landmark/target history at prediction.
// Each click has weight one regardless of its number of accepted frames:
// sum_i [(w·mean_i+b-y_i)^2 + w^T covariance_i w] + lambda ||w||^2.
// The scatter term is exactly the per-frame squared loss within a click, not
// inferred head motion and not augmentation along an assumed gaze direction.
export const CLICK_SCATTER_METHOD = 'eye_patch_click_scatter.experimental.v1';
export const CLICK_SCATTER_MAX_WIDTH = 120;
const maxRows = 50, maxFrames = 30;

export function summarizeClickVectors(vectors) {
  const n = vectors?.length, d = vectors?.[0]?.length;
  if (!Array.isArray(vectors) || !(n >= 1 && n <= maxFrames && d >= 1 && d <= CLICK_SCATTER_MAX_WIDTH)
    || !vectors.every(v => Array.isArray(v) && v.length === d && v.every(Number.isFinite))) return null;
  const mean = Array.from({ length: d }, (_, j) => vectors.reduce((s, v) => s + v[j], 0) / n);
  const covariance = new Float64Array(d * (d + 1) / 2);
  for (const v of vectors) {
    let k = 0;
    for (let j = 0; j < d; j++) for (let l = 0; l <= j; l++) covariance[k++] += (v[j] - mean[j]) * (v[l] - mean[l]) / n;
  }
  if (!mean.every(Number.isFinite) || !covariance.every(Number.isFinite)) return null;
  return { mean, covariance, count: n };
}

function validate(rows, floors) {
  const d = floors?.length;
  return Array.isArray(rows) && rows.length >= 2 && rows.length <= maxRows
    && Array.isArray(floors) && d >= 1 && d <= CLICK_SCATTER_MAX_WIDTH && floors.every(v => Number.isFinite(v) && v > 0)
    && rows.every(r => Array.isArray(r.irisFeatures) && r.irisFeatures.length === d + 1
      && r.irisFeatures[d] === 1 && r.irisFeatures.every(Number.isFinite)
      && [r.screenX, r.screenY].every(Number.isFinite)
      && r.clickScatter?.covariance instanceof Float64Array && r.clickScatter.covariance.length === d * (d + 1) / 2
      && r.clickScatter.covariance.every(Number.isFinite)
      && Number.isInteger(r.clickScatter.count) && r.clickScatter.count >= 1 && r.clickScatter.count <= maxFrames
      && floors.every((_, j) => r.clickScatter.covariance[j * (j + 1) / 2 + j] >= 0));
}

// Positive-definite solve with two right-hand sides and an unpenalized bias.
// Return null on a numerical failure; never manufacture a zero coefficient fit.
function solve(matrix, rhs) {
  const n = matrix.length, L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = matrix[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (!Number.isFinite(s) || (i === j && s <= 0)) return null;
    L[i][j] = i === j ? Math.sqrt(s) : s / L[j][j];
  }
  const result = [];
  for (const b of rhs) {
    const x = b.slice();
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) x[i] -= L[i][j] * x[j];
      x[i] /= L[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) x[i] -= L[j][i] * x[j];
      x[i] /= L[i][i];
    }
    if (!x.every(Number.isFinite)) return null;
    result.push(x);
  }
  return result;
}

function fit(rows, floors, lambda) {
  const d = floors.length, n = rows.length;
  const mean = floors.map((_, j) => rows.reduce((s, r) => s + r.irisFeatures[j], 0) / n);
  const std = mean.map((m, j) => Math.max(floors[j], Math.sqrt(rows.reduce((s, r) => s + (r.irisFeatures[j] - m) ** 2, 0) / n)));
  const targetX = rows.reduce((s, r) => s + r.screenX, 0) / n;
  const targetY = rows.reduce((s, r) => s + r.screenY, 0) / n;
  const matrix = rows.map(r => [...mean.map((m, j) => (r.irisFeatures[j] - m) / std[j]), 1]);
  const H = Array.from({ length: d }, () => new Float64Array(d)), bx = new Array(d).fill(0), by = new Array(d).fill(0);
  for (let i = 0; i < n; i++) {
    const r = rows[i], m = matrix[i]; let k = 0;
    for (let j = 0; j < d; j++) {
      bx[j] += m[j] * (r.screenX - targetX); by[j] += m[j] * (r.screenY - targetY);
      for (let l = 0; l <= j; l++) H[j][l] += m[j] * m[l] + r.clickScatter.covariance[k++] / (std[j] * std[l]);
    }
  }
  for (let j = 0; j < d; j++) {
    H[j][j] += lambda;
    for (let l = 0; l < j; l++) H[l][j] = H[j][l];
  }
  const weights = solve(H, [bx, by]);
  if (!weights) return null;
  return { mean, std, modelX: [...weights[0], targetX], modelY: [...weights[1], targetY], matrix,
    targetsX: rows.map(r => r.screenX), targetsY: rows.map(r => r.screenY) };
}

function loss(row, fitted) {
  const d = fitted.mean.length;
  const error = (weights, target) => {
    let estimate = weights[d], variance = 0, k = 0;
    for (let j = 0; j < d; j++) estimate += weights[j] * (row.irisFeatures[j] - fitted.mean[j]) / fitted.std[j];
    for (let j = 0; j < d; j++) for (let l = 0; l <= j; l++) {
      variance += (j === l ? 1 : 2) * weights[j] * weights[l] * row.clickScatter.covariance[k++] / (fitted.std[j] * fitted.std[l]);
    }
    return (estimate - target) ** 2 + Math.max(0, variance);
  };
  return error(fitted.modelX, row.screenX) + error(fitted.modelY, row.screenY);
}

export function fitClickScatter(rows, floors, candidates = [.01, .1, 1, 10, 100]) {
  if (!validate(rows, floors) || !Array.isArray(candidates) || !candidates.length || candidates.length > 5
    || !candidates.every(v => Number.isFinite(v) && v > 0)) return null;
  const group = r => `${r.screenX.toFixed(2)}:${r.screenY.toFixed(2)}`;
  const groups = [...new Set(rows.map(group))];
  if (groups.length < 6) return null;
  let best = null;
  const curve = [];
  for (const lambda of candidates) {
    let squared = 0, count = 0;
    for (const heldOut of groups) {
      const train = rows.filter(r => group(r) !== heldOut);
      const fitted = fit(train, floors, lambda);
      if (!fitted) break;
      for (const r of rows.filter(r => group(r) === heldOut)) { squared += loss(r, fitted); count++; }
    }
    if (count !== rows.length || !Number.isFinite(squared)) continue;
    const rmsPx = Math.sqrt(squared / count);
    curve.push({ lambda, rmsPx });
    if (!best || rmsPx < best.targetCvRmsPx) best = { lambda, targetCvRmsPx: rmsPx };
  }
  if (!best) return null;
  const fitted = fit(rows, floors, best.lambda);
  return fitted ? { ...fitted, ...best, curve, targetCount: groups.length } : null;
}
