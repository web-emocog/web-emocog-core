(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EmocogPassiveMetrics = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const definitions = [
    ['physiology.bpm_mean', 'ЧСС: средняя оценка', 'Heart rate: mean estimate', 'bpm', 'rppg'],
    ['physiology.respiration_mean', 'Дыхание: средняя частота', 'Respiration: mean rate', 'breaths/min', 'respiration'],
    ['blink.count', 'Количество морганий', 'Blink count', 'count', 'blink'],
    ['blink.rate_per_min', 'Частота морганий', 'Blink rate', 'blinks/min', 'blink'],
    ['blink.perclos60_pct', 'PERCLOS: среднее по окнам 60 с', 'PERCLOS: mean of 60 s windows', 'pct', 'blink'],
    ['body.velocity_mean', 'Движение корпуса: средняя скорость', 'Body movement: mean velocity', 'torso/s', 'head_hands'],
    ['body.velocity_p95', 'Движение корпуса: P95 сохранённого окна', 'Body movement: retained-window P95', 'torso/s', 'head_hands'],
    ['face.valence_mean', 'Мимика: валентность (proxy)', 'Facial expression: valence (proxy)', 'index', 'face'],
    ['face.arousal_mean', 'Мимика: возбуждение (proxy)', 'Facial expression: arousal (proxy)', 'index', 'face']
  ].map(([id, ru, en, unit, channel]) => ({ id, label: { ru, en }, unit, channel,
    packageId: 'continuous_signals', defaultSelected: true,
    description: { ru: 'Фоновая сводка измеренных данных; не диагноз и не мгновенный ответ на стимул.',
      en: 'Background summary of observed data; not a diagnosis or an instantaneous stimulus response.' } }));

  function measurement(payload, id) {
    const bpm = payload.bpm_summary || {}, respiration = payload.respiration_summary || {};
    const blink = payload.blink_summary || payload.attentionMetrics?.global?.blinkDynamics || {};
    const perclos = payload.perclos_summary || payload.attentionMetrics?.global?.perclos || {};
    const body = payload.body_pose_summary || {}, face = payload.emotion_summary || {};
    const eyeCount = payload.attentionMetrics?.sampleCounts?.eyeSignals ?? payload.attentionMetrics?.global?.sampleCount;
    const eyeDuration = payload.attentionMetrics?.global?.eyeDurationMs ?? payload.attentionMetrics?.global?.durationMs;
    const source = {
      'physiology.bpm_mean': [bpm.bpmMean, bpm.validSampleCount ?? bpm.sampleCount, 'bpm_summary'],
      'physiology.respiration_mean': [respiration.resp_rate_mean, respiration.resp_sample_count, 'respiration_summary'],
      'blink.count': [blink.blinkCount, eyeCount, 'blink_summary'],
      'blink.rate_per_min': [blink.blinkRatePerMin, eyeCount, 'blink_summary'],
      'blink.perclos60_pct': [perclos.windows?.['60s']?.meanPct, eyeCount, 'perclos_summary'],
      'body.velocity_mean': [body.movementVelocityMean, body.validSampleCount, 'body_pose_summary'],
      'body.velocity_p95': [body.movementVelocityP95, body.retainedValidSampleCount, 'body_pose_summary'],
      'face.valence_mean': [face.valence_mean, face.n, 'emotion_summary'],
      'face.arousal_mean': [face.arousal_mean, face.n, 'emotion_summary']
    }[id];
    if (!source) return null;
    const [raw, count, field] = source;
    const n = finite(count) && count >= 0 ? Math.floor(count) : null;
    const disabled = (id.startsWith('body.') && body.enabled === false)
      || (id === 'physiology.respiration_mean' && respiration.resp_available === false);
    const incompleteEyes = id.startsWith('blink.') && payload.experimentMeta?.storageRecovery?.signalSeriesIncomplete;
    const shortWindow = id === 'blink.perclos60_pct' && !(eyeDuration >= 60000);
    const value = !disabled && !incompleteEyes && !shortWindow && n !== 0 && finite(raw) ? raw : null;
    const definition = definitions.find(item => item.id === id);
    const invalidRange = value != null && ((definition.unit === 'pct' && (value < 0 || value > 100))
      || (id === 'physiology.bpm_mean' && (value < 45 || value > 180))
      || (id === 'physiology.respiration_mean' && (value < 6 || value > 24))
      || (id.startsWith('face.') && (value < -1 || value > 1))
      || ((id.startsWith('body.') || id === 'blink.count' || id === 'blink.rate_per_min') && value < 0));
    return { value: invalidRange ? null : value, n,
      status: value != null && !invalidRange ? 'computed' : 'no_data',
      reason: incompleteEyes ? 'signal_history_incomplete' : shortWindow ? 'insufficient_window_duration' : invalidRange ? 'signal_summary_invalid'
        : value == null ? 'signal_data_missing' : null,
      source: field, scope: id === 'body.velocity_p95' ? 'retained_samples' : 'whole_measured_session',
      methodVersion: id.startsWith('physiology.') ? bpm.methodVersion || 'legacy_summary' : 'passive-summary.v1',
      countsKnown: n !== null };
  }
  return { definitions, measurement };
});
