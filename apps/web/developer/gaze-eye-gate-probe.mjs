const scoreNames = Object.freeze(['eyeLookDown', 'eyeSquint', 'eyeBlink', 'cheekSquint', 'mouthSmile']
  .flatMap(name => ['Left', 'Right'].map(side => name + side)));

function stats() { return { count: 0, sum: 0, min: Infinity, max: -Infinity }; }
function update(s, value, upper) {
  if (!Number.isFinite(value) || value < 0 || value > upper) return;
  s.count++;
  s.sum += value;
  s.min = Math.min(s.min, value); s.max = Math.max(s.max, value);
}
function summary(s) {
  return { available: s.count, mean: s.count ? s.sum / s.count : null,
    min: s.count ? s.min : null, max: s.count ? s.max : null };
}

// Called only for fresh captures; no frame references or coordinate series retained.
export function createEyeGateProbeWindow() {
  const gaze = { left: stats(), right: stats() }, precheck = { left: stats(), right: stats() };
  const blend = Object.fromEntries(scoreNames.map(name => [name, stats()]));
  const counts = { fresh: 0, accepted: 0, missingGazeFeatures: 0, gazeConfidenceRejected: 0,
    precheckEyesRejected: 0, missingPrecheckEyeFlags: 0, gazeAndPrecheckRejected: 0, poseRejected: 0, eyesAndPoseRejected: 0 };
  let lastAt = null, eyeRunAt = null, longestEyeRejectionMs = 0, eyeRejectionRuns = 0;
  return {
    observe(frame, result) {
      const at = frame?.timestamp;
      if (!Number.isFinite(at) || lastAt !== null && at <= lastAt) return;
      counts.fresh++;
      const { groups, eyesRejected, poseRejected, gazeConfidenceRejected, precheckEyesRejected } = result;
      if (!eyesRejected && !poseRejected) counts.accepted++;
      if (!groups) counts.missingGazeFeatures++;
      if (gazeConfidenceRejected) counts.gazeConfidenceRejected++;
      if (precheckEyesRejected) counts.precheckEyesRejected++;
      if (![frame.eyes?.bothOpen, frame.eyes?.left?.isOpen, frame.eyes?.right?.isOpen].some(value => typeof value === 'boolean')) {
        counts.missingPrecheckEyeFlags++;
      }
      if (gazeConfidenceRejected && precheckEyesRejected) counts.gazeAndPrecheckRejected++;
      if (poseRejected) counts.poseRejected++;
      if (eyesRejected && poseRejected) counts.eyesAndPoseRejected++;
      if (eyesRejected) {
        if (eyeRunAt === null || at - lastAt > 150) { eyeRunAt = at; eyeRejectionRuns++; }
        longestEyeRejectionMs = Math.max(longestEyeRejectionMs, at - eyeRunAt);
      } else eyeRunAt = null;
      lastAt = at;
      update(gaze.left, groups?.eye?.leftEAR, 5); update(gaze.right, groups?.eye?.rightEAR, 5);
      update(precheck.left, frame.eyes?.left?.ear, 5); update(precheck.right, frame.eyes?.right?.ear, 5);
      for (const name of scoreNames) update(blend[name], frame.blendShapes?.[name], 1);
    },
    summary() {
      return { counts: { ...counts }, eyeRejectionRuns, longestEyeRejectionMs,
        ear: { gaze: { left: summary(gaze.left), right: summary(gaze.right) },
          precheck: { left: summary(precheck.left), right: summary(precheck.right) } },
        blendShapes: Object.fromEntries(scoreNames.map(name => [name, summary(blend[name])])) };
    },
  };
}
