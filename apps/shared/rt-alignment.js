(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EmocogRtAlignment = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'rt_alignment.v1';
  const MAX_TRIALS = 200;
  const CHANNELS = ['gaze', 'body', 'valence', 'arousal', 'bpm'];
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const text = value => value == null ? null : String(value).slice(0, 128);
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const round = value => number(value) == null ? null : Math.round(value * 10000) / 10000;
  const time = (sample, monotonic) => number(monotonic ? sample?.monotonicMs : sample?.timestamp ?? sample?.t ?? sample?.startMs);
  function lowerBound(rows, value) {
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid].t < value) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function statistic(rows, start, end, read) {
    const slice = rows.slice(lowerBound(rows, start), lowerBound(rows, end));
    const valid = slice.map(row => ({ t: row.t, value: read(row.sample) })).filter(row => number(row.value) != null);
    let maxGapMs = valid.length ? Math.max(valid[0].t - start, end - valid[valid.length - 1].t) : null;
    for (let index = 1; index < valid.length; index += 1) maxGapMs = Math.max(maxGapMs, valid[index].t - valid[index - 1].t);
    return {
      value: round(mean(valid.map(row => row.value))), n: slice.length, nValid: valid.length,
      validFraction: slice.length ? round(valid.length / slice.length) : null,
      maxGapMs: round(maxGapMs),
      status: valid.length ? 'observed' : 'no_data'
    };
  }
  function build(session) {
    const objects = values => (Array.isArray(values) ? values : []).filter(value => value && typeof value === 'object' && !Array.isArray(value));
    const events = objects(session?.events);
    const starts = events.filter(event => event.type === 'stimulus_on');
    // Use one clock for the entire report, never match wall-clock events to monotonic samples.
    const monotonic = starts.length > 0 && starts.every(event => number(event.monotonicMs) != null);
    const clock = monotonic ? 'monotonic_epoch_ms' : 'wall_epoch_ms';
    const sortedEvents = events.map(event => ({ event, t: time(event, monotonic) })).filter(row => row.t != null).sort((a, b) => a.t - b.t);
    const onsets = sortedEvents.filter(row => row.event.type === 'stimulus_on');
    const origin = onsets[0]?.t ?? 0;
    const series = {};
    const indexed = values => (Array.isArray(values) ? values : []).map(sample => ({ sample, t: time(sample, monotonic) })).filter(row => row.t != null).sort((a, b) => a.t - b.t);
    series.gaze = indexed(session?.eyeTracking);
    series.body = indexed(session?.bodyPoseSamples);
    series.valence = indexed(session?.emotionSamples);
    series.arousal = series.valence;
    // Wall-clock-only legacy samples are rejected when the selected clock is monotonic.
    series.bpm = indexed(objects(session?.bpmRuns).flatMap(run => objects(run.samples)));
    const read = {
      gaze: sample => sample.valid === true && sample.onScreen !== false && number(sample.correctedX) != null && number(sample.correctedY) != null ? 1 : null,
      body: sample => sample.valid === true && sample.ood !== true ? number(sample.movementVelocity) : null,
      valence: sample => sample.degraded !== true && sample.dataSource !== 'landmarks' ? number(sample.valence) : null,
      arousal: sample => sample.degraded !== true && sample.dataSource !== 'landmarks' ? number(sample.arousal) : null,
      bpm: sample => sample.published === true ? number(sample.bpm) : null
    };
    const results = objects(session?.cognitiveResults);
    let previousEnd = -Infinity;
    const trials = [];
    for (let index = 0; index < onsets.length; index += 1) {
      if (trials.length >= MAX_TRIALS) break;
      const onset = onsets[index], event = onset.event;
      const next = onsets[index + 1]?.t ?? Infinity;
      const related = sortedEvents.slice(lowerBound(sortedEvents, onset.t), lowerBound(sortedEvents, next))
        .filter(row => row.event.blockId === event.blockId && row.event.trialId === event.trialId);
      const response = related.find(row => row.event.type === 'response' && row.event.responded === true);
      const ending = related.find(row => row.event.type === 'trial_end');
      const end = ending?.t ?? response?.t ?? null;
      const result = results.find(item => String(item.blockId ?? item.block) === String(event.blockId)
        && String(item.trialId) === String(event.trialId) && number(item.timestamp) != null
        && Math.abs(item.timestamp - (ending?.event.timestamp ?? response?.event.timestamp ?? 0)) < 5);
      const rtMs = number(response?.event.rtMs ?? ending?.event.rtMs);
      const isRt = event.response_mode !== 'none' && event.task_id !== 'passive_viewing';
      const attempt = number(event.attempt ?? result?.attempt) ?? 1;
      if (isRt && trials.length < MAX_TRIALS) {
        const windows = {};
        const ranges = { baseline: [Math.max(onset.t - 1000, previousEnd), onset.t], response: [onset.t, response?.t ?? end], post: [end, Math.min((end ?? 0) + 1000, next)] };
        for (const [name, range] of Object.entries(ranges)) {
          const [start, stop] = range;
          const available = number(start) != null && number(stop) != null && stop > start;
          windows[name] = { startMs: available ? round(start - origin) : null, endMs: available ? round(stop - origin) : null,
            channels: Object.fromEntries(CHANNELS.map(channel => [channel, statistic(series[channel], available ? start : 0, available ? stop : 0, read[channel])])) };
          // The gaze value is the observed valid-sample fraction, not a cognitive attention score.
          windows[name].channels.gaze.value = windows[name].channels.gaze.validFraction;
        }
        trials.push({ trialId: text(event.trialId), blockId: text(event.blockId), stimulusId: text(event.stimulusId),
          condition: text(event.condition), attempt, onsetMs: round(onset.t - origin), responseMs: response ? round(response.t - origin) : null,
          endMs: end == null ? null : round(end - origin), rtMs: response && rtMs != null && rtMs >= 0 ? rtMs : null,
          correct: typeof (ending?.event.correct ?? result?.correct) === 'boolean' ? (ending?.event.correct ?? result.correct) : null,
          qualityValid: end != null && ending?.event.qualityValid === true && result?.qualityValid !== false && result?.skippedMedia !== true,
          status: end == null ? 'incomplete' : response ? 'responded' : 'no_response', windows });
      }
      previousEnd = end ?? next;
    }
    return { schemaVersion: VERSION, algorithmVersion: 'event-windows-1.0.0', clock,
      baselineMs: 1000, postMs: 1000, trialCountTotal: onsets.filter(row => row.event.response_mode !== 'none' && row.event.task_id !== 'passive_viewing').length,
      truncated: onsets.filter(row => row.event.response_mode !== 'none' && row.event.task_id !== 'passive_viewing').length > trials.length,
      rawVideoStored: false, trials };
  }
  return { VERSION, CHANNELS, MAX_TRIALS, build };
});
