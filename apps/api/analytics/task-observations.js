const { validResult } = require('../security/passive-valid-time');
const finite = value => typeof value === 'number' && Number.isFinite(value);

// A presentation's own monotonic endpoints survive reload without counting
// instructions, calibration or time with the page closed as task observation.
function taskObservationIndex(row) {
  const actual = row.features_payload?.presentation_plan?.actual
    ?? row.features_payload?.experimentMeta?.presentationPlan?.actual ?? [];
  if (!Array.isArray(actual)) return null;
  const records = new Map();
  for (const entry of actual) {
    if (entry?.presentationId == null) continue;
    const key = String(entry.presentationId);
    records.set(key, records.has(key) ? null : entry);
  }
  return records;
}

function taskObservationDuration(row, trials, records = taskObservationIndex(row)) {
  if (!trials.length) return null;
  let duration = 0;
  const seen = new Set();
  for (const trial of trials) {
    const key = trial.presentationId == null ? null : String(trial.presentationId);
    if (key !== null && seen.has(key)) return null;
    if (Object.hasOwn(trial, 'validTime')) {
      if (!validResult(trial.validTime)) return null;
      duration += trial.validTime.actualMs;
      if (key !== null) seen.add(key);
      continue;
    }
    const entry = key === null ? null : records?.get(key);
    if (!entry || seen.has(key) || String(entry.blockId) !== String(trial.blockId ?? trial.block)
      || String(entry.trialId) !== String(trial.trialId) || entry.attempt !== trial.attempt
      || (entry.stimulusId != null || trial.stimulusId != null)
        && String(entry.stimulusId).replace(/^api:/, '') !== String(trial.stimulusId).replace(/^api:/, '')) return null;
    const start = entry.stimulusOnPerfMs, end = entry.stimulusOffPerfMs;
    if (!finite(start) || !finite(end) || start < 0 || end < start) return null;
    duration += end - start;
    seen.add(key);
  }
  return duration;
}

module.exports = { taskObservationDuration, taskObservationIndex };
