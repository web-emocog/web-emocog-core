// Offline ablation only. This changes the intensity basis of the full patch,
// not gaze coordinates or the visible crop. It needs no lid/iris landmarks.
import { EYE_PATCH_LENGTH, EYE_PATCH_SPEC } from '../../participant-web/js/gaze-tracker/eye-patch-features.mjs?v=20261107-143';

export function projectPatchRows(patch, rowRetention = 0) {
  if (!Array.isArray(patch) || patch.length !== EYE_PATCH_LENGTH || !patch.every(Number.isFinite)
    || !Number.isFinite(rowRetention) || rowRetention < 0 || rowRetention > 1) return null;
  const { rows, columns } = EYE_PATCH_SPEC, perEye = rows * columns;
  const features = [];
  for (let eye = 0; eye < 2; eye++) {
    const values = patch.slice(eye * perEye, (eye + 1) * perEye);
    const center = values.reduce((a, x) => a + x, 0) / perEye;
    const projected = [];
    for (let row = 0; row < rows; row++) {
      const slice = values.slice(row * columns, (row + 1) * columns);
      const rowMean = slice.reduce((a, x) => a + x, 0) / columns;
      for (const value of slice) projected.push((value - rowMean) + rowRetention * (rowMean - center));
    }
    const rms = Math.sqrt(projected.reduce((a, x) => a + x * x, 0) / perEye);
    if (!Number.isFinite(rms) || rms < 1e-6) return null;
    for (const value of projected) features.push(value / Math.max(rms, .04));
  }
  return features;
}
