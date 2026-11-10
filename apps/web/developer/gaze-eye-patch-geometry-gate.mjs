// Separate posture channel for a local shadow comparison. It can qualify
// the use of two existing eye-image predictions, never generate coordinates.
import { LANDMARKS } from '../../participant-web/js/gaze-tracker/constants.js?v=20261106-143';

const eyeCorners = [LANDMARKS.LEFT_EYE_INNER, LANDMARKS.LEFT_EYE_OUTER,
  LANDMARKS.RIGHT_EYE_INNER, LANDMARKS.RIGHT_EYE_OUTER];
const isPosition = value => Number.isFinite(value) && value >= 0 && value <= 1;
const validProfile = profile => isPosition(profile?.mean) && Number.isFinite(profile.sd)
  && profile.sd >= 0 && profile.sd <= .5 && Number.isInteger(profile.samples) && profile.samples >= 1 && profile.samples <= 30;

export function readEyeCornerHeight(landmarks) {
  const values = eyeCorners.map(index => landmarks?.[index]?.y);
  return values.every(isPosition) ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

export function summarizeEyeCornerHeight(values) {
  if (!Array.isArray(values) || !values.length || values.length > 30 || !values.every(isPosition)) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  return { mean, sd, samples: values.length };
}

export function fitPatchGeometryGate(pairs, ordinary = [], diagnostics = {}) {
  if (!Array.isArray(pairs) || pairs.length !== 5 || !pairs.every(p => validProfile(p?.first) && validProfile(p?.second))
    || !Array.isArray(ordinary) || ![0, 50].includes(ordinary.length) || !ordinary.every(validProfile)) {
    diagnostics.failureReason = 'incomplete_geometry_calibration'; return null;
  }
  const upper = p => p.mean + Math.max(.001, 2 * p.sd);
  const lower = p => p.mean - Math.max(.001, 2 * p.sd);
  const referenceUpper = Math.max(...pairs.map(p => upper(p.first)), ...ordinary.map(upper));
  const alternateLower = Math.min(...pairs.map(p => lower(p.second)));
  const alternateUpper = Math.max(...pairs.map(p => upper(p.second)));
  const gap = alternateLower - referenceUpper;
  diagnostics.positivePairs = pairs.filter(p => p.second.mean - p.first.mean >= .01).length;
  diagnostics.separatedAlternatePairs = pairs.filter(p => lower(p.second) >= referenceUpper + .01).length;
  diagnostics.envelopeGap = gap;
  if (diagnostics.positivePairs < 4 || diagnostics.separatedAlternatePairs < 5) {
    diagnostics.failureReason = 'overlapping_geometry_range'; return null;
  }
  delete diagnostics.failureReason;
  const begin = referenceUpper + .2 * gap, end = alternateLower;
  const cut = alternateUpper + Math.max(.012, gap / 2);
  const smooth = u => u * u * (3 - 2 * u);
  return Object.freeze({
    weight(height) {
      if (!isPosition(height) || height <= begin || height >= cut) return 0;
      if (height < end) return smooth((height - begin) / (end - begin));
      if (height > alternateUpper) return smooth((cut - height) / (cut - alternateUpper));
      return 1;
    },
  });
}
