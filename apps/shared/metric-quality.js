(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EmocogMetricQuality = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'metric_quality.v1';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const count = value => finite(value) && value >= 0 ? value : null;
  const fraction = value => finite(value) && value >= 0 && value <= 1 ? value : null;
  const REPORT_LIMITS = Object.freeze({ rtAlignmentAttempts: 200, physiologyMinutes: 480,
    physiologyBlockAttempts: 400, gazePresentations: 200 });

  function protocolStatus(qc, report) {
    if (report?.schemaVersion === 'protocol_quality.v1') {
      if (report.failed?.length) return 'failed';
      if (report.missing?.length) return 'unknown';
      const enabled = Object.values(report.checks || {}).filter(check => check.enabled);
      if (enabled.length && enabled.every(check => check.status === 'passed')) return 'passed';
    }
    return qc.overallPass === true ? 'passed' : qc.overallPass === false ? 'failed' : 'unknown';
  }

  function build(payload = {}, options = {}) {
    const lifecycle = payload.lifecycle || {}, meta = payload.experimentMeta || {};
    const completed = lifecycle.status === 'completed' && !meta.protocolTermination;
    const interrupted = lifecycle.status === 'failed' || !!meta.protocolTermination;
    const recovery = meta.storageRecovery || {};
    const integrityReasons = [];
    if (!completed) integrityReasons.push(interrupted ? 'protocol_interrupted' : 'recording_not_completed');
    if (recovery.signalSeriesIncomplete || meta.checkpointBuild?.signalSeriesIncomplete) integrityReasons.push('signal_history_incomplete');
    const recordingIntegrity = { status: completed && integrityReasons.length === 0 ? 'complete'
      : interrupted || integrityReasons.includes('signal_history_incomplete') ? 'partial' : 'unknown',
    storage: options.serverAcknowledged === true ? 'server_acknowledged' : 'local_prepared', reasons: integrityReasons };
    const qc = payload.qcSummary || {}, gaze = payload.gaze_analytics?.summary || {};
    const minutes = Array.isArray(payload.physiology_intervals?.minutes) ? payload.physiology_intervals.minutes : [];
    const observed = channel => minutes.reduce((sum, item) => sum + (count(item?.[channel]?.observedMs) || 0), 0);
    const intervalDuration = count(payload.physiology_intervals?.throughMs);
    const bpm = payload.bpm_summary || {}, resp = payload.respiration_summary || {}, body = payload.body_pose_summary || {};
    const face = payload.emotion_summary || {}, blink = payload.blink_summary || {};
    const signal = (channel, n, coverage, observedMs, methodVersion, disabled = false) => {
      const sampleCount = count(n), coverageFraction = fraction(coverage);
      const status = disabled || sampleCount === 0 ? 'missing'
        : sampleCount > 0 || coverageFraction > 0 ? 'available' : 'unknown';
      return { channel, status, sampleCount, coverageFraction, observedMs: count(observedMs),
        methodVersion: typeof methodVersion === 'string' ? methodVersion : null,
        reasons: status === 'missing' ? ['signal_data_missing'] : status === 'unknown' ? ['signal_quality_unknown']
          : coverageFraction === null ? ['coverage_unknown', 'summary_not_independent_validation'] : ['summary_not_independent_validation'] };
    };
    const physiology = (channel, source, sampleCount, methodVersion) => signal(channel, sampleCount,
      intervalDuration > 0 ? observed(source) / intervalDuration : null,
      intervalDuration != null ? observed(source) : null, methodVersion);
    const signals = [
      signal('gaze', gaze.sampleCountValid, gaze.validFraction ?? (finite(qc.gazeValidPct) ? qc.gazeValidPct / 100 : null),
        null, payload.gaze_analytics?.schemaVersion),
      physiology('heart_rate', 'heartRate', bpm.validSampleCount ?? bpm.sampleCount, bpm.methodVersion),
      physiology('respiration', 'respiration', resp.resp_sample_count, resp.methodVersion),
      signal('blink', payload.attentionMetrics?.sampleCounts?.eyeSignals ?? payload.attentionMetrics?.global?.sampleCount,
        null, null, blink.version || blink.algorithmVersion),
      signal('facial_expression', face.n, null, null, face.algorithmVersion || face.methodVersion),
      signal('body_pose', body.validSampleCount,
        body.sampleCount > 0 ? body.validSampleCount / body.sampleCount : null, null, body.version, body.enabled === false),
      signal('task', (Array.isArray(payload.cognitiveResults) ? payload.cognitiveResults : [])
        .filter(item => item?.qualityValid === true && !item.skippedMedia).length,
        null, null, 'browser_event_timing.v1')
    ];
    const suitability = signals.map(item => ({ channel: item.channel,
      status: item.status === 'available' ? 'research_only' : 'unavailable',
      reasons: [item.status === 'available' ? 'not_validated_against_reference' : 'insufficient_signal',
        ...(item.channel === 'facial_expression' ? ['facial_scores_not_emotion_probabilities', 'arousal_not_physiological_arousal'] : []),
        ...(item.channel === 'respiration' ? ['respiration_lighting_confound_unchecked'] : []),
        ...(item.channel === 'task' ? ['browser_timing_not_hardware_timing'] : [])] }));
    const limits = [
      { code: 'rt_alignment_limit', scope: 'connectedness', limit: REPORT_LIMITS.rtAlignmentAttempts,
        total: count(payload.rt_alignment?.trialCountTotal), retained: count(payload.rt_alignment?.trials?.length),
        truncated: payload.rt_alignment?.truncated === true },
      { code: 'physiology_minute_limit', scope: 'physiology', limit: REPORT_LIMITS.physiologyMinutes,
        total: intervalDuration == null ? null : Math.ceil(intervalDuration / 60000),
        retained: count(payload.physiology_intervals?.minutes?.length), truncated: payload.physiology_intervals?.truncated === true },
      { code: 'physiology_attempt_limit', scope: 'physiology', limit: REPORT_LIMITS.physiologyBlockAttempts,
        total: null, retained: count(payload.physiology_intervals?.blocks?.length), truncated: payload.physiology_intervals?.truncated === true },
      { code: 'gaze_presentation_limit', scope: 'gaze', limit: REPORT_LIMITS.gazePresentations,
        total: count(gaze.presentationCountTotal), retained: count(gaze.presentationCountStored), truncated: gaze.presentationsTruncated === true }
    ];
    return { schemaVersion: VERSION, recordingIntegrity,
      protocolQuality: meta.protocolTermination?.reason === 'quality_stopped' ? 'failed'
        : protocolStatus(qc, options.protocolReport ?? qc.protocolQc),
      signals, suitability, limits, independentlyValidated: false };
  }
  return { VERSION, REPORT_LIMITS, build };
});
