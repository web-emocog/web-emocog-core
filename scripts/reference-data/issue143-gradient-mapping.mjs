// Offline experiment only. No participant/runtime imports this fitter.
// Original code under the repository's Apache-2.0 license; no external weights.
import { dotProduct, ridgeRegression } from '../../apps/participant-web/js/gaze-tracker/ridge.js';

const lambdas = [.01, .1, 1, 10, 100];
const methods = ['binocular_linear', 'binocular_quadratic'];

function project(centers, method) {
  if (!Array.isArray(centers) || centers.length !== 4 || !centers.every(Number.isFinite)) return null;
  const x = (centers[0] + centers[2]) / 2, y = (centers[1] + centers[3]) / 2;
  return method === 'binocular_linear' ? [x, y] : [x, y, x * x, x * y, y * y];
}

function fit(rows, lambda) {
  const mean = rows[0].features.map((_, j) => rows.reduce((s, r) => s + r.features[j], 0) / rows.length);
  const std = mean.map((m, j) => Math.max(.03,
    Math.sqrt(rows.reduce((s, r) => s + (r.features[j] - m) ** 2, 0) / rows.length)));
  const standardize = f => [...mean.map((m, j) => (f[j] - m) / std[j]), 1];
  const matrix = rows.map(r => standardize(r.features));
  if (!matrix.every(r => r.every(Number.isFinite))) return null;
  const wx = ridgeRegression(matrix, rows.map(r => r.x), lambda);
  const wy = ridgeRegression(matrix, rows.map(r => r.y), lambda);
  if (!wx.every(Number.isFinite) || !wy.every(Number.isFinite)) return null;
  return f => {
    const row = standardize(f), x = dotProduct(row, wx), y = dotProduct(row, wy);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };
}

export function fitGradientMapping(calibration, method) {
  if (!methods.includes(method) || !Array.isArray(calibration) || calibration.length < 12 || calibration.length > 50) return null;
  const rows = [], groups = new Map();
  for (const row of calibration) {
    const features = project(row?.centers, method), x = row?.screenX, y = row?.screenY;
    if (!features?.every(Number.isFinite) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const group = `${x.toFixed(2)}:${y.toFixed(2)}`;
    groups.set(group, (groups.get(group) || 0) + 1);
    rows.push({ group, features, x, y });
  }
  // Require two clicks per target. Neither click from a held-out target may
  // affect fitting OR feature normalization in that fold.
  if (groups.size < 6 || [...groups.values()].some(n => n !== 2)) return null;
  let selected = null;
  const curve = [];
  for (const lambda of lambdas) {
    let squared = 0, n = 0;
    for (const group of groups.keys()) {
      const predict = fit(rows.filter(r => r.group !== group), lambda);
      if (!predict) break;
      for (const r of rows.filter(r => r.group === group)) {
        const p = predict(r.features);
        if (!p) break;
        squared += (p.x - r.x) ** 2 + (p.y - r.y) ** 2;
        n++;
      }
    }
    if (n !== rows.length || !Number.isFinite(squared)) continue;
    const result = { lambda, rmsPx: Math.sqrt(squared / n) };
    curve.push(result);
    if (!selected || result.rmsPx < selected.rmsPx) selected = result;
  }
  if (!selected) return null;
  const predict = fit(rows, selected.lambda);
  if (!predict) return null;
  return {
    // No screen point, head pose, timestamp or AOI parameter at inference.
    // This helper deliberately leaves validity decisions to the shared gate.
    predict(centers) {
      const f = project(centers, method);
      return f?.every(Number.isFinite) ? predict(f) : null;
    },
    diagnostics: { method, selected: { ...selected }, curve, calibrationTargets: groups.size,
      calibrationRows: rows.length, independentTargetsUsed: 0 },
  };
}
