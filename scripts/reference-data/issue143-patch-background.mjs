// Local experiment only. Analytic, low-rank background perturbations in the
// existing corner-normalized crop. No frame geometry, target, learned weights,
// iris center or lid mask is required by the transform.
import { EYE_PATCH_LENGTH, EYE_PATCH_SPEC } from '../../apps/participant-web/js/gaze-tracker/eye-patch-features.mjs';

const { columns, rows, widthInCanthalWidths: width, heightInCanthalWidths: height } = EYE_PATCH_SPEC;
const size = rows * columns;
const cells = Array.from({ length: size }, (_, index) => [index % columns, Math.floor(index / columns)]);
const mean = a => a.reduce((sum, v) => sum + v, 0) / a.length;
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const centered = values => {
  const mid = mean(values);
  return values.map(v => v - mid);
};

// Smooth synthetic background (no iris): integrate the same four locations
// per cell as the full patch. These modes are a geometric prior, not camera
// data, and are not updated from an independent or elapsed-time target.
function aperture(halfWidth, halfHeight, shift, slope = 0) {
  return centered(cells.map(([c, r]) => {
    let value = 0;
    for (const dx of [.25, .75]) for (const dy of [.25, .75]) {
      const x = ((c + dx) / columns - .5) * width, y = ((r + dy) / rows - .5) * height;
      const distance = (x / halfWidth) ** 2 + ((y - shift - slope * x) / halfHeight) ** 2;
      value += 1 / (1 + Math.exp(12 * (distance - 1))) / 4;
    }
    return value;
  }));
}
const diff = (a, b) => a.map((v, i) => v - b[i]);
const eye = aperture(.50, .23, 0);
const narrow = aperture(.50, .15, 0);
const up = aperture(.50, .23, -.045), down = aperture(.50, .23, .045);
const basis = [];
for (const source of [
  eye, diff(down, up), diff(narrow, eye), diff(aperture(.42, .23, 0), eye),
  diff(diff(up, eye), diff(eye, down)),
  diff(aperture(.50, .15, .045), aperture(.50, .15, -.045)),
  centered(cells.map(([, r]) => r)),
  diff(aperture(.50, .23, 0, .13), aperture(.50, .23, 0, -.13)),
]) {
  let residual = source;
  for (const mode of basis) {
    const p = dot(residual, mode);
    residual = residual.map((v, i) => v - p * mode[i]);
  }
  const norm = Math.sqrt(dot(residual, residual));
  if (norm > 1e-9) basis.push(residual.map(v => v / norm));
}

// Coefficients from fixed lateral columns. Ridge here regularizes a tiny
// intensity reconstruction (not gaze). Compute a positive-definite factor
// once; no per-frame matrix construction or dependence on target positions.
const lateral = cells.map(([c]) => Math.abs((c + .5) / columns - .5) >= .3);
const leftFactor = [];
for (const [i, mode] of basis.entries()) {
  const row = new Float64Array(basis.length);
  for (let j = 0; j <= i; j++) {
    let value = mode.reduce((sum, v, k) => sum + (lateral[k] ? v * basis[j][k] : 0), 0) + (i === j ? .08 : 0);
    const previous = i === j ? row : leftFactor[j];
    for (let k = 0; k < j; k++) value -= row[k] * previous[k];
    row[j] = i === j ? Math.sqrt(value) : value / leftFactor[j][j];
  }
  leftFactor.push(row);
}

function lateralCoefficients(values) {
  const a = basis.map(mode => mode.reduce((sum, v, i) => sum + (lateral[i] ? v * values[i] : 0), 0));
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < i; j++) a[i] -= leftFactor[i][j] * a[j];
    a[i] /= leftFactor[i][i];
  }
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < a.length; j++) a[i] -= leftFactor[j][i] * a[j];
    a[i] /= leftFactor[i][i];
  }
  return a;
}

export function projectPatchBackground(patch, mode = 'project') {
  if (!Array.isArray(patch) || patch.length !== EYE_PATCH_LENGTH || !patch.every(Number.isFinite)
    || !['project', 'shrink', 'lateral'].includes(mode)) return null;
  const out = [];
  for (let eyeIndex = 0; eyeIndex < 2; eyeIndex++) {
    const values = centered(patch.slice(eyeIndex * size, (eyeIndex + 1) * size));
    const a = mode === 'lateral' ? lateralCoefficients(values) : basis.map(b => dot(b, values));
    const factor = mode === 'shrink' ? .8 : 1;
    const residual = values.map((v, i) => v - factor * basis.reduce((sum, b, j) => sum + a[j] * b[i], 0));
    const rms = Math.sqrt(dot(residual, residual) / size);
    if (!Number.isFinite(rms) || rms < 1e-6) return null;
    for (const v of residual) out.push(v / Math.max(rms, .04));
  }
  return out;
}
