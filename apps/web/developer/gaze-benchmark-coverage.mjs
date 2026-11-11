import { createValidationSamplingWindow } from '../../participant-web/js/gaze-tracker/validation-sampling.mjs';

const gateReasons = new Set(['low_confidence', 'iris_out_of_distribution', 'head_out_of_distribution',
  'invalid_feature_distribution', 'non_finite_prediction']);
const descriptors = { eye_patch: 'full', eye_patch_core: 'core', eye_gradient_all: 'gradient_all',
  eye_gradient: 'gradient', eye_tophat: 'tophat', eye_masked: 'masked',
  eye_patch_rows: 'rows', eye_patch_nuisance: 'nuisance' };

export function createValidationAttemptRecorder(modelNames, clock, raw) {
  const captures = createValidationSamplingWindow(clock);
  const rejections = Object.fromEntries(modelNames.map(name => [name, {}]));
  return {
    observe(frame, predictions, eyeFeatures) {
      // Record every UNIQUE fresh analyzer result observed by the existing poll,
      // not just accepted predictions, and never count an old frame 60 times.
      if (!captures.accept({ frameTimestamp: frame?.timestamp })) return;
      for (const name of modelNames) {
        const prediction = predictions?.[name];
        const x = raw ? prediction?.rawX : prediction?.correctedX;
        const y = raw ? prediction?.rawY : prediction?.correctedY;
        if (prediction?.valid && Number.isFinite(x) && Number.isFinite(y)) continue;
        const region = descriptors[name];
        const reason = gateReasons.has(prediction?.rejectionReason) ? prediction.rejectionReason
          : !frame?.landmarks?.length ? 'no_face_landmarks'
          : !prediction && region && !eyeFeatures?.[region] ? 'missing_eye_descriptor'
          : prediction?.valid ? 'non_finite_prediction' : 'missing_prediction';
        const counts = rejections[name];
        counts[reason] = (counts[reason] || 0) + 1;
      }
    },
    summary(points) {
      return { captures: captures.summary(), models: Object.fromEntries(modelNames.map(name => [name, {
        acceptedSamples: points[name].samples.length, rejectionCounts: { ...rejections[name] },
      }])) };
    },
  };
}

export async function collectValidationTargets({ positions, modelNames, diagnostics = null, measure }) {
  const points = Object.fromEntries(modelNames.map(name => [name, []]));
  const missingTargets = [];
  async function record(targetIndex, attempt) {
    const { measured, summary } = await measure(targetIndex, attempt);
    const target = diagnostics?.[targetIndex];
    if (target) target.attempts.push(summary);
    for (const name of modelNames) {
      // Keep the first window with any coverage. Never mix two windows or choose
      // by residual error. Retry only fills gaps; other models keep their data.
      if (points[name][targetIndex]?.samples.length) continue;
      points[name][targetIndex] = measured[name];
      if (target && measured[name].samples.length) target.selectedAttempt[name] = attempt;
    }
    return modelNames.some(name => !points[name][targetIndex].samples.length);
  }
  for (const index of positions.keys()) if (await record(index, 1)) missingTargets.push(index);
  // Historical local reports keep their original policy. The versioned developer
  // export records every retry, including when coverage is still incomplete.
  if (diagnostics) for (const index of missingTargets) await record(index, 2);
  return points;
}

export function calibrationRejection(summary, patchReady) {
  if (!summary.accepted) {
    if (summary.invalidEyes && summary.invalidPose) return 'eye_and_pose_signal';
    if (summary.invalidEyes) return 'eye_signal';
    if (summary.invalidPose) return 'pose_signal';
    return 'insufficient_fresh_frames';
  }
  return patchReady ? 'tracker_rejected' : 'eye_descriptors';
}

export function countCalibrationRejection(targets, targetIndex, reason, summary) {
  const target = targets[targetIndex] ??= { targetIndex, rejectedClicks: 0, invalidEyes: 0, invalidPose: 0, reasons: {} };
  target.rejectedClicks++;
  target.invalidEyes += summary.invalidEyes;
  target.invalidPose += summary.invalidPose;
  target.reasons[reason] = (target.reasons[reason] || 0) + 1;
}

const maskedReasons = new Set(['missing_frame_pixels', 'unusable_crop', 'invalid_lid_geometry',
  'insufficient_visible_rows', 'low_contrast', 'weak_match', 'search_boundary', 'ambiguous_match']);

function countMaskReason(counts, reason) {
  if (reason === null) return;
  const key = maskedReasons.has(reason) ? reason : 'unclassified';
  counts[key] = (counts[key] || 0) + 1;
}

export function recordMaskedCalibrationClick(coverage, targetIndex, controlFrames, sharedCount, minFrames, readReason) {
  const enough = sharedCount >= minFrames;
  const target = coverage.targets[targetIndex] ??= { targetIndex, acceptedControlClicks: 0,
    clicksWithEnoughCommonFrames: 0, controlFrames: 0, commonFrames: 0, rejectionCounts: {} };
  target.acceptedControlClicks++;
  target.controlFrames += controlFrames.length;
  target.commonFrames += sharedCount;
  if (enough) target.clicksWithEnoughCommonFrames++;
  else coverage.missingCommonClicks++;
  for (const frame of controlFrames) countMaskReason(target.rejectionCounts, readReason(frame));
}

export function summarizeLidSupportClick(frames, minFrames, readStatus) {
  const pairs = { both: 0, hardOnly: 0, softOnly: 0, neither: 0 };
  const rejections = { hard: {}, soft: {} };
  let controlFrames = 0;
  for (const frame of frames) {
    const values = readStatus(frame);
    if (!values?.control) continue;
    controlFrames++;
    const hard = values.hard === null, soft = values.soft === null;
    pairs[hard ? soft ? 'both' : 'hardOnly' : soft ? 'softOnly' : 'neither']++;
    countMaskReason(rejections.hard, values.hard);
    countMaskReason(rejections.soft, values.soft);
  }
  return { minFrames, controlFrames, gateEligibleFrames: frames.length,
    pairs, rejections, controlReady: controlFrames >= minFrames,
    hardReady: pairs.both + pairs.hardOnly >= minFrames, softReady: pairs.both + pairs.softOnly >= minFrames };
}
