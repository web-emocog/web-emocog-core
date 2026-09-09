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
      if (checks.consecutiveLowFps === false || checks.consecutive_low_fps === false) {
        fail_reasons.push('consecutive_low_fps');
      }
    }
    if (qcSummary.failReasons && Array.isArray(qcSummary.failReasons)) {
      qcSummary.failReasons.forEach(r => { if (r && !fail_reasons.includes(r)) fail_reasons.push(r); });
    }
  }

  const checkEntries = checks
    ? Object.entries(checks).filter(([, value]) => typeof value === 'boolean')
    : [];
  const checkScore = checkEntries.length
    ? (checkEntries.filter(([, value]) => value).length / checkEntries.length) * 100
    : null;
  const criticalChecks = [
    checks?.duration,
    checks?.faceVisible ?? checks?.face_visible,
    checks?.faceOk ?? checks?.face_ok,
    checks?.illuminationOk ?? checks?.illumination_ok,
    checks?.occlusion,
  ].filter(value => typeof value === 'boolean');
  const hasCriticalFailure = criticalChecks.some(value => value === false);
  const hasAdvisoryFailure = checkEntries.some(([, value]) => value === false) && !hasCriticalFailure;

  // The browser score contains multiplicative penalties. A single short FPS
  // episode must not turn otherwise usable gaze/face evidence into a zero-like
  // score. Boolean checks provide an independent, auditable evidence score.
  if (!hasCriticalFailure && checkScore !== null) {
    qc_score = qc_score === null ? checkScore : Math.max(qc_score, checkScore);
  }

  let validity = 'invalid';
  if (qc_score !== null) {
    if (qc_score >= 70) validity = 'valid';
    else if (qc_score >= 50) validity = 'borderline';
  }
  if (hasCriticalFailure) validity = 'invalid';
  else if (hasAdvisoryFailure && validity === 'valid') validity = 'borderline';

  return {
    validity,
    qc_score: qc_score === null ? null : Math.round(qc_score * 10) / 10,
    fail_reasons
  };
}

const RT_QC_THRESHOLDS = Object.freeze({
  omission_rate: 0.25,
  commission_rate: 0.35,
  rt_outlier_frac: 0.4,
});

function meanBlockMetric(rtFeatures, metricId) {
  if (!rtFeatures?.blocks) return null;
  const vals = [];
  for (const block of rtFeatures.blocks) {
    const entry = block?.computed_metrics?.[metricId];
    if (entry && typeof entry.value === 'number' && Number.isFinite(entry.value)) {
      vals.push(entry.value);
    }
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Block-level behavioral RT QC; does not invalidate whole session by default. */
function mergeBehavioralRtQc(qcState, rtFeatures, payload) {
  const out = {
    validity: qcState.validity,
    qc_score: qcState.qc_score,
    fail_reasons: [...(qcState.fail_reasons || [])],
  };
  const behavioral = { blocks: [] };

  const omission = meanBlockMetric(rtFeatures, 'omission_rate');
  if (omission != null && omission >= RT_QC_THRESHOLDS.omission_rate) {
    if (!out.fail_reasons.includes('high_omission_rate')) out.fail_reasons.push('high_omission_rate');
    behavioral.blocks.push({ reason: 'high_omission_rate', value: omission, level: 'block' });
  }

  const commission = meanBlockMetric(rtFeatures, 'commission_rate');
  if (commission != null && commission >= RT_QC_THRESHOLDS.commission_rate) {
    if (!out.fail_reasons.includes('high_commission_rate')) out.fail_reasons.push('high_commission_rate');
    behavioral.blocks.push({ reason: 'high_commission_rate', value: commission, level: 'block' });
  }

  const outlier = meanBlockMetric(rtFeatures, 'rt_outlier_frac');
  if (outlier != null && outlier >= RT_QC_THRESHOLDS.rt_outlier_frac) {
    if (!out.fail_reasons.includes('high_rt_outlier_frac')) out.fail_reasons.push('high_rt_outlier_frac');
    behavioral.blocks.push({ reason: 'high_rt_outlier_frac', value: outlier, level: 'block' });
  }

  if (rtFeatures?.blocks) {
    for (const block of rtFeatures.blocks) {
      if (block.status === 'no_events' || block.status === 'analyzer_unavailable') {
        behavioral.blocks.push({
          block_id: block.block_id,
          reason: block.status === 'analyzer_unavailable' ? 'rt_analyzer_unavailable' : 'rt_block_incomplete',
          level: 'block',
        });
        const code = block.status === 'analyzer_unavailable' ? 'rt_analyzer_unavailable' : 'rt_block_incomplete';
        if (!out.fail_reasons.includes(code)) out.fail_reasons.push(code);
      }
    }
  }

  if (payload && typeof payload === 'object') {
    payload.rt_qc = behavioral;
  }

  return out;
}

module.exports = { computeQcValidity, mergeBehavioralRtQc, RT_QC_THRESHOLDS };
