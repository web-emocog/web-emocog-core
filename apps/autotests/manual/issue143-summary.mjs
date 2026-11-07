// Local diagnostics only. Online bounded summaries, never raw gaze/landmark series.
const empty = () => ({ accepted: 0, offScreen: 0, dx: 0, dy: 0, dx2: 0, dy2: 0, error: 0, error2: 0,
  confidenceN: 0, confidence: 0, headN: 0, headRms: 0, maxHeadPeakZ: null, rejectionCounts: {} });
export function createMatchedWindow(target, since, modelNames, signalKeys = {}, viewport = null, pairs = [], nuisance = false) {
  return { target, since, lastFrame: -Infinity, analyzed: 0, faceMissing: 0,
    signalKeys, viewport,
    models: Object.fromEntries(modelNames.map(name => [name, empty()])),
    comparisons: pairs.map(pair => ({ ...pair, accepted: 0, errorDelta: 0 })),
    nuisance: nuisance ? { n: 0, sum: new Array(11).fill(0), sum2: new Array(11).fill(0) } : null,
    paired: { accepted: 0, errorDelta: 0 }, eye: { n: 0, left: 0, right: 0 } };
}

export function observeMatchedWindow(window, timestamp, eye, predictions, groups = null) {
  if (!Number.isFinite(timestamp) || timestamp < window.since || timestamp <= window.lastFrame) return;
  window.lastFrame = timestamp; window.analyzed++;
  if (window.nuisance && groups?.iris?.length === 12 && groups?.head?.length === 7) {
    const vector = [...groups.iris.slice(0, 4), ...groups.head];
    if (vector.every(Number.isFinite)) {
      window.nuisance.n++;
      vector.forEach((v, i) => { window.nuisance.sum[i] += v; window.nuisance.sum2[i] += v * v; });
    }
  }
  if (Number.isFinite(eye?.leftEAR) && Number.isFinite(eye?.rightEAR)) {
    window.eye.n++; window.eye.left += eye.leftEAR; window.eye.right += eye.rightEAR;
  } else window.faceMissing++;
  const errors = [], errorsByName = {};
  for (const [name, acc] of Object.entries(window.models)) {
    const gaze = predictions[name];
    const [xKey, yKey] = window.signalKeys[name] || ['rawX', 'rawY'];
    if (Number.isFinite(gaze?.confidence)) { acc.confidenceN++; acc.confidence += gaze.confidence; }
    if (Number.isFinite(gaze?.ood?.headRmsZ) && Number.isFinite(gaze?.ood?.headPeakZ)) {
      acc.headN++; acc.headRms += gaze.ood.headRmsZ;
      acc.maxHeadPeakZ = Math.max(acc.maxHeadPeakZ ?? 0, gaze.ood.headPeakZ);
    }
    if (!gaze?.valid || !Number.isFinite(gaze[xKey]) || !Number.isFinite(gaze[yKey])) {
      // Only predefined predictor reasons, never arbitrary exception messages.
      const allowed = ['low_confidence', 'iris_out_of_distribution', 'head_out_of_distribution',
        'invalid_feature_distribution', 'non_finite_prediction'];
      const reason = allowed.includes(gaze?.rejectionReason) ? gaze.rejectionReason : 'missing_prediction';
      acc.rejectionCounts[reason] = (acc.rejectionCounts[reason] || 0) + 1;
      continue;
    }
    const x = gaze[xKey], y = gaze[yKey];
    const dx = x - window.target.x, dy = y - window.target.y;
    const error = Math.hypot(dx, dy);
    acc.accepted++; acc.dx += dx; acc.dy += dy; acc.error += error;
    acc.dx2 += dx * dx; acc.dy2 += dy * dy; acc.error2 += error * error;
    if (window.viewport ? x < 0 || y < 0 || x > window.viewport.width || y > window.viewport.height : !gaze.onScreen) acc.offScreen++;
    errors.push(error);
    errorsByName[name] = error;
  }
  if (errors.length === Object.keys(window.models).length && errors.length === 2) {
    window.paired.accepted++; window.paired.errorDelta += errors[1] - errors[0];
  }
  for (const pair of window.comparisons) if (Number.isFinite(errorsByName[pair.baseline]) && Number.isFinite(errorsByName[pair.candidate])) {
    pair.accepted++; pair.errorDelta += errorsByName[pair.candidate] - errorsByName[pair.baseline];
  }
}

export function finishMatchedWindow(window, durationMs) {
  const divide = (value, n) => n ? value / n : null;
  return { analyzed: window.analyzed, faceMissing: window.faceMissing, durationMs,
    ...(window.nuisance ? { baselineNuisance: {
      method: 'same_eye_iris.v2', scope: 'all_finite_captures_not_only_gate_accepted_not_head_motion_ground_truth',
      frames: window.nuisance.n,
      fields: ['leftIrisX', 'leftIrisY', 'rightIrisX', 'rightIrisY', 'yawProxy', 'pitchProxy', 'rollProxy', 'eyeMidX', 'eyeMidY', 'faceScale', 'eyeDistance'],
      mean: window.nuisance.sum.map(value => divide(value, window.nuisance.n)),
      sd: window.nuisance.sum2.map((value, i) => window.nuisance.n ? Math.sqrt(Math.max(0,
        value / window.nuisance.n - (window.nuisance.sum[i] / window.nuisance.n) ** 2)) : null)
    } } : {}),
    eyeAperture: { frames: window.eye.n,
      meanLeftEAR: divide(window.eye.left, window.eye.n), meanRightEAR: divide(window.eye.right, window.eye.n) },
    models: Object.fromEntries(Object.entries(window.models).map(([name, acc]) => [name, {
      accepted: acc.accepted, attempted: window.analyzed, offScreen: acc.offScreen,
      meanErrorPx: divide(acc.error, acc.accepted), biasXPx: divide(acc.dx, acc.accepted),
      biasYPx: divide(acc.dy, acc.accepted), rejectionCounts: { ...acc.rejectionCounts },
      rmsErrorPx: acc.accepted ? Math.sqrt(acc.error2 / acc.accepted) : null,
      withinTargetSdXPx: acc.accepted ? Math.sqrt(Math.max(0, acc.dx2 / acc.accepted - (acc.dx / acc.accepted) ** 2)) : null,
      withinTargetSdYPx: acc.accepted ? Math.sqrt(Math.max(0, acc.dy2 / acc.accepted - (acc.dy / acc.accepted) ** 2)) : null,
      meanConfidence: divide(acc.confidence, acc.confidenceN),
      meanHeadRmsZ: divide(acc.headRms, acc.headN), maxHeadPeakZ: acc.maxHeadPeakZ,
    }])),
    paired: { accepted: window.paired.accepted,
      candidateMinusBaselineMeanErrorPx: divide(window.paired.errorDelta, window.paired.accepted) },
    ...(window.comparisons.length ? { comparisons: window.comparisons.map(pair => ({
      baseline: pair.baseline, candidate: pair.candidate, commonAccepted: pair.accepted,
      candidateMinusBaselineMeanErrorPx: divide(pair.errorDelta, pair.accepted)
    })) } : {}) };
}
