const { validateSessionDataSchema } = require('./session-data-schema');
const { HttpError } = require('./http-error');
const { validateResult, policyFor, validateBlock } = require('../../shared/passive-valid-time');
const { inspectPassiveValidTimeBlock } = require('../../shared/protocol-quality');

function validResult(value) {
  if (validateSessionDataSchema({ cognitiveResults: [{ validTime: value }] }).length) return false;
  return validateResult(value) && [value.acceptedSegments, value.excludedSegments].every(segments =>
    segments.every((segment, index) => !index || segment.startMs >= segments[index - 1].endMs));
}

function validatePassiveValidTime(payload) {
  const errors = [];
  for (const [index, trial] of (Array.isArray(payload.cognitiveResults) ? payload.cognitiveResults : []).entries()) {
    if (!trial || !Object.hasOwn(trial, 'validTime')) continue;
    if (!validResult(trial.validTime)) errors.push({ path: `/cognitiveResults/${index}/validTime`,
      keyword: 'consistency', message: 'Invalid passive valid-time partition' });
    if (errors.length >= 100) break;
  }
  return errors;
}

function assertPublishedPassiveValidTime(payload, definition) {
  const seen = new Set();
  for (const trial of Array.isArray(payload.cognitiveResults) ? payload.cognitiveResults : []) {
    if (!trial) continue;
    const reject = () => { throw new HttpError(422, 'Passive timing does not match the published protocol', 'valid_time_not_declared'); };
    const blocks = (Array.isArray(definition?.blocks) ? definition.blocks : [])
      .filter(block => String(block.id) === String(trial.blockId ?? trial.block));
    const present = Object.hasOwn(trial, 'validTime');
    if (!present && !blocks.some(block => policyFor(block))) continue;
    if (blocks.length !== 1 || (trial.blockId ?? trial.block) == null || !present || !validResult(trial.validTime)) reject();
    if (trial.presentationId != null) {
      const key = String(trial.presentationId);
      if (seen.has(key)) reject();
      seen.add(key);
    }
    const block = blocks[0], policy = policyFor(block);
    const inspection = inspectPassiveValidTimeBlock(block, { mediaManifest: definition.mediaManifest, allowUnresolvedMedia: false });
    if (!policy || !validateBlock(block) || !inspection.ok || !inspection.config
      || trial.responseMode != null && trial.responseMode !== 'none'
      || trial.task_id != null && trial.task_id !== 'passive_viewing') reject();
    const cfg = { ...block.content, ...block.blockConfig };
    const entries = block.trials?.length ? block.trials : block.content?.trials?.length ? block.content.trials : cfg.slides;
    const sid = value => String(value ?? '').replace(/^api:/, '');
    const candidates = (Array.isArray(entries) ? entries : []).filter(entry => sid(typeof entry === 'object'
      ? entry?.stimulusId ?? entry?.stimulus_id ?? entry?.id ?? entry?.stimulus?.stimulusId : entry) === sid(trial.stimulusId));
    const durations = candidates.map(entry => Number(entry?.duration ?? cfg.slideDuration ?? cfg.stimulusDuration ?? cfg.stimulus_ms ?? 5000));
    if (!durations.length || durations.some(duration => !Number.isSafeInteger(duration) || duration < 1000)
      || !durations.includes(trial.validTime.targetMs)
      || trial.validTime.maxDurationMs !== Math.floor(trial.validTime.targetMs * (1 + policy.maxExtensionRatio))) reject();
    // An exhausted target cannot be silently accepted as a completed valid trial.
    if (trial.validTime.acceptedMs < trial.validTime.targetMs && trial.qualityValid === true) reject();
    assertAcceptedGaze(payload, trial, reject);
  }
}

function assertAcceptedGaze(payload, trial, reject) {
  if (trial.presentationId == null) return;
  const entries = (Array.isArray(payload.gaze_analytics?.presentations) ? payload.gaze_analytics.presentations : [])
    .filter(entry => entry && String(entry.presentationId) === String(trial.presentationId));
  if (entries.length > 1) reject();
  const entry = entries[0];
  if (!entry) return;
  const id = value => String(value ?? '').replace(/^api:/, '');
  if (id(entry.blockId) !== id(trial.blockId ?? trial.block) || id(entry.trialId) !== id(trial.trialId)
    || id(entry.stimulusId) !== id(trial.stimulusId)) reject();
  const value = trial.validTime;
  // Ingest carries aggregates, not raw capture evidence. Check only demonstrable bounds.
  if (typeof entry.validObservationDurationMs === 'number' && entry.validObservationDurationMs > value.acceptedMs + 1) reject();
  if (!Array.isArray(entry.fixationPoints) || !entry.fixationPoints.length) return;
  const offset = entry.presentationStartMs - trial.onsetMs;
  if (!Number.isFinite(entry.presentationStartMs) || !Number.isFinite(trial.onsetMs) || offset < 0) reject();
  let duration = 0;
  for (const point of entry.fixationPoints) {
    const start = point?.startMs + offset, end = start + point?.durationMs;
    if (!Number.isFinite(point?.startMs) || point.startMs < 0 || !Number.isFinite(point?.durationMs) || point.durationMs <= 0
      || !value.acceptedSegments.some(segment => start >= segment.startMs - 1 && end <= segment.endMs + 1)) reject();
    duration += point.durationMs;
  }
  if (duration > value.acceptedMs + 1) reject();
}

module.exports = { validResult, validatePassiveValidTime, assertPublishedPassiveValidTime };
