/**
 * QC Aggregator (Фаза 2.6): расчёт qc_score, valid/borderline/invalid, причины брака.
 */
function computeQcValidity(qcSummary, payload) {
  let qc_score = null;
  const fail_reasons = [];
  const checks = qcSummary && typeof qcSummary === 'object' && qcSummary.checks && typeof qcSummary.checks === 'object'
    ? qcSummary.checks
    : null;

  function toScore100(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (value <= 1) return Math.max(0, Math.min(100, value * 100));
    return Math.max(0, Math.min(100, value));
  }

  if (qcSummary && typeof qcSummary === 'object') {
    if (typeof qcSummary.qc_score === 'number') qc_score = toScore100(qcSummary.qc_score);
    else if (typeof qcSummary.qcScore === 'number') qc_score = toScore100(qcSummary.qcScore);
    else if (typeof qcSummary.gazeValidPct === 'number') qc_score = toScore100(qcSummary.gazeValidPct);
    else if (qcSummary.overallPass === true) qc_score = 100;
    else if (qcSummary.overallPass === false) qc_score = 0;

    if (checks) {
      if (checks.duration === false) fail_reasons.push('short_duration');
      if (checks.faceVisible === false || checks.face_visible === false) fail_reasons.push('low_face_visible');
      if (checks.faceOk === false || checks.face_ok === false) fail_reasons.push('low_face_ok_pct');
      if (checks.poseOk === false || checks.pose_ok === false) fail_reasons.push('low_pose_ok_pct');
      if (checks.illuminationOk === false || checks.illumination_ok === false) fail_reasons.push('low_illumination_ok_pct');
      if (checks.eyesOpen === false || checks.eyes_open === false) fail_reasons.push('low_eyes_open_pct');
      if (checks.occlusion === false) fail_reasons.push('high_occlusion_pct');
      if (checks.gazeValid === false || checks.gaze_valid === false) fail_reasons.push('low_gaze_valid_pct');
      if (checks.gazeOnScreen === false || checks.gaze_on_screen === false) fail_reasons.push('high_offscreen');
      if (checks.trackingOnTarget === false || checks.tracking_on_target === false) {
        fail_reasons.push('low_tracking_on_target');
      }
      if (checks.lowFps === false || checks.low_fps === false) fail_reasons.push('low_fps_time');
    }
    if (qcSummary.failReasons && Array.isArray(qcSummary.failReasons)) {
      qcSummary.failReasons.forEach(r => { if (r && !fail_reasons.includes(r)) fail_reasons.push(r); });
    }
  }

  let validity = 'invalid';
  if (qc_score !== null) {
    if (qc_score >= 70) validity = 'valid';
    else if (qc_score >= 50) validity = 'borderline';
  }
  if (fail_reasons.length === 0 && qc_score !== null && qc_score >= 50) {
    if (qc_score >= 70) validity = 'valid';
    else validity = 'borderline';
  }

  return { validity, qc_score, fail_reasons };
}

module.exports = { computeQcValidity };
