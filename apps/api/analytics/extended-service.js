const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { HttpError } = require('../security/http-error');

const VERSION = 'analytics-extensions.2';
const METRICS = ['rt.mean', 'rt.median', 'rt.cv', 'task.accuracy', 'physiology.bpm',
  'physiology.respiration', 'blink.rate', 'face.valence', 'body.velocity', 'audio.pitch'];
const METHODS = ['spearman', 'pearson'];
const metricIdentifier = value => typeof value === 'string'
  && /^(?:rt|task|gaze|physiology|blink|body|face|audio|survey)\.[A-Za-z0-9_.-]{1,100}$/.test(value);
const KEYS = new Set(['baselineBlockId', 'referenceId', 'comparisonId', 'axis', 'metricId', 'secondMetricId',
  'slowThresholdMs', 'fastThresholdMs', 'signalConditions', 'surveyScoring', 'correction', 'design', 'method',
  'referenceParticipantIds', 'comparisonParticipantIds', 'familyMetricIds', 'levels', 'repeatVisits', 'seed', 'iterations']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function invalid(message) { throw new HttpError(422, message, 'analytics_extension_plan_invalid'); }
function fields(value, keys) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) invalid('Unknown analysis setting');
}
function identifier(value) {
  if (typeof value !== 'string' || !value || value.length > 128 || /[\u0000-\u001f]/.test(value)) invalid('Invalid analysis identifier');
  return value;
}
function ids(values) {
  if (!Array.isArray(values) || values.length > 100) invalid('Too many analysis identifiers');
  const normalized = values.map(identifier);
  if (new Set(normalized).size !== normalized.length) invalid('Repeated analysis identifier');
  return normalized;
}
function validatePlan(input = {}) {
  fields(input, [...KEYS]);
  const plan = { axis: 'condition', metricId: 'rt.mean', secondMetricId: 'physiology.bpm',
    design: 'paired', correction: 'holm', seed: 179, iterations: 1000 };
  for (const key of ['baselineBlockId', 'referenceId', 'comparisonId']) {
    if (input[key] != null && input[key] !== '') plan[key] = identifier(input[key]);
  }
  for (const [key, allowed] of [['axis', ['block', 'condition']], ['design', ['paired', 'independent']],
    ['correction', ['holm', 'bh', 'bonferroni']], ['method', METHODS]]) {
    if (input[key] !== undefined) {
      if (!allowed.includes(input[key])) invalid('Unsupported analysis setting');
      plan[key] = input[key];
    }
  }
  for (const key of ['metricId', 'secondMetricId']) if (input[key] !== undefined) {
    if (!metricIdentifier(input[key])) invalid('Unsupported measure identifier');
    plan[key] = input[key];
  }
  for (const key of ['slowThresholdMs', 'fastThresholdMs']) if (input[key] != null) {
    if (!Number.isFinite(input[key]) || input[key] <= 0 || input[key] > 600000) invalid('Invalid response threshold');
    plan[key] = input[key];
  }
  if (plan.slowThresholdMs != null && plan.fastThresholdMs != null && plan.fastThresholdMs >= plan.slowThresholdMs)
    invalid('The fast response threshold must be smaller than the slow response threshold');
  if (plan.referenceId && plan.referenceId === plan.comparisonId) invalid('Choose different comparison levels');
  for (const key of ['referenceParticipantIds', 'comparisonParticipantIds']) if (input[key] !== undefined) plan[key] = ids(input[key]);
  if (input.familyMetricIds !== undefined) {
    plan.familyMetricIds = ids(input.familyMetricIds);
    if (plan.familyMetricIds.some(id => !metricIdentifier(id))) invalid('Unknown family metric');
  }
  if (input.levels !== undefined) {
    plan.levels = ids(input.levels);
    if (plan.levels.length > 8) invalid('Choose at most eight comparison levels');
  }
  if (input.repeatVisits !== undefined) {
    if (!Array.isArray(input.repeatVisits) || input.repeatVisits.length > 100) invalid('Invalid repeat visit mapping');
    const sessions = new Set();
    plan.repeatVisits = input.repeatVisits.map(item => {
      fields(item, ['sessionId', 'visit']);
      const sessionId = identifier(item.sessionId);
      if (sessions.has(sessionId) || !['A', 'B'].includes(item.visit)) invalid('Each session must belong to one explicit visit');
      sessions.add(sessionId);
      return { sessionId, visit: item.visit };
    });
  }
  if (plan.referenceParticipantIds?.some(id => plan.comparisonParticipantIds?.includes(id))) invalid('Independent groups must not overlap');
  if (input.signalConditions !== undefined) {
    fields(input.signalConditions, ['signal', 'noise']);
    plan.signalConditions = { signal: ids(input.signalConditions.signal), noise: ids(input.signalConditions.noise) };
    if (!plan.signalConditions.signal.length || !plan.signalConditions.noise.length
      || plan.signalConditions.signal.some(id => plan.signalConditions.noise.includes(id))) invalid('Signal and noise conditions must be nonempty and disjoint');
  }
  if (input.surveyScoring !== undefined) {
    if (!Array.isArray(input.surveyScoring) || input.surveyScoring.length > 10) invalid('Too many survey scales');
    const scaleIds = new Set();
    plan.surveyScoring = input.surveyScoring.map(scale => {
      fields(scale, ['id', 'items']);
      const id = identifier(scale.id);
      if (scaleIds.has(id)) invalid('Repeated survey scale');
      scaleIds.add(id);
      if (!Array.isArray(scale.items) || !scale.items.length || scale.items.length > 50) invalid('Invalid survey scale items');
      const questionIds = new Set();
      return { id, items: scale.items.map(item => {
        fields(item, ['questionId', 'reverse', 'min', 'max', 'numericText', 'values']);
        const questionId = identifier(item.questionId);
        if (questionIds.has(questionId)) invalid('Repeated survey question');
        questionIds.add(questionId);
        if (item.reverse !== undefined && typeof item.reverse !== 'boolean') invalid('Invalid survey reverse flag');
        if (item.numericText !== undefined && typeof item.numericText !== 'boolean') invalid('Invalid numeric survey text flag');
        for (const key of ['min', 'max']) if (item[key] !== undefined && (!Number.isFinite(item[key]) || Math.abs(item[key]) > 1000000)) invalid('Invalid survey range');
        if (item.min !== undefined && item.max !== undefined && item.min >= item.max) invalid('The survey range must increase');
        if (item.reverse && !(Number.isFinite(item.min) && Number.isFinite(item.max) && item.min < item.max)) invalid('Reversed items require an explicit range');
        if (item.numericText && !(Number.isFinite(item.min) && Number.isFinite(item.max) && item.min < item.max)) invalid('Numeric text requires an explicit range');
        let values;
        if (item.values !== undefined) {
          if (!Array.isArray(item.values) || !item.values.length || item.values.length > 100) invalid('Invalid option scoring map');
          const seen = new Set();
          values = item.values.map(entry => {
            fields(entry, ['optionId', 'value']); const optionId = identifier(entry.optionId);
            if (seen.has(optionId) || !Number.isFinite(entry.value) || Math.abs(entry.value) > 1000000) invalid('Invalid option score');
            seen.add(optionId); return { optionId, value: entry.value };
          });
        }
        return { questionId, reverse: item.reverse === true, ...(item.numericText ? { numericText: true } : {}),
          ...(values ? { values } : {}), ...(item.min !== undefined ? { min: item.min } : {}), ...(item.max !== undefined ? { max: item.max } : {}) };
      }) };
    });
  }
  if (input.seed !== undefined) {
    if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 4294967295) invalid('Invalid random seed');
    plan.seed = input.seed;
  }
  if (input.iterations !== undefined) {
    if (!Number.isInteger(input.iterations) || input.iterations < 200 || input.iterations > 2000) invalid('Invalid resampling count');
    plan.iterations = input.iterations;
  }
  return plan;
}

function scopeRows(rows, filters = {}) {
  const match = (values, actual) => !values?.length || values.some(value => String(value).replace(/^api:/, '') === String(actual).replace(/^api:/, ''));
  const fine = Boolean(filters.stimulusIds?.length || filters.conditionIds?.length || filters.aoiIds?.length);
  const scoped = Boolean(fine || filters.blockIds?.length);
  return rows.map(row => {
    const payload = { ...row.features_payload };
    const accepts = trial => match(filters.blockIds, trial.blockId ?? trial.block)
      && match(filters.stimulusIds, trial.stimulusId) && match(filters.conditionIds, trial.condition);
    if (scoped) {
      // Keep attempt identity/QC for gaze joins. The feature layer suppresses
      // task measurements for AOI-only selections rather than losing context.
      payload.cognitiveResults = (payload.cognitiveResults || []).filter(accepts);
      if (payload.gaze_analytics) payload.gaze_analytics = { ...payload.gaze_analytics,
        presentations: (payload.gaze_analytics.presentations || []).filter(entry => match(filters.blockIds, entry.blockId)
          && match(filters.stimulusIds, entry.stimulusId)) };
      payload.events = (payload.events || []).filter(event => accepts(event));
      for (const key of ['blink_summary', 'perclos_summary', 'body_pose_summary', 'emotion_summary', 'bpm_summary', 'respiration_summary']) delete payload[key];
      if (payload.physiology_intervals) payload.physiology_intervals = { ...payload.physiology_intervals,
        minutes: [], blocks: fine ? [] : (payload.physiology_intervals.blocks || []).filter(block => match(filters.blockIds, block.blockId)) };
      if (payload.audio_summary) payload.audio_summary = { ...payload.audio_summary,
        windows: filters.aoiIds?.length ? [] : (payload.audio_summary.windows || []).filter(accepts) };
    }
    return { id: row.id, session_id: row.session_id, participant_id: row.participant_id,
      ...(Object.hasOwn(row, 'participant_key') ? { participant_key: row.participant_key } : {}),
      protocol_id: row.protocol_id, publication_version: row.publication_version,
      started_at: row.started_at, stopped_at: row.stopped_at, qc_validity: row.qc_validity, features_payload: payload };
  });
}

function createRunner({ timeoutMs = 20000, maximumBytes = 16 * 1024 * 1024, maxQueue = 4 } = {}) {
  let running = false;
  const queue = [];
  const cache = new Map();
  function next() {
    if (running || !queue.length) return;
    const job = queue.shift();
    if (job.signal?.aborted) { job.reject(new HttpError(499, 'Analysis request cancelled', 'analytics_extension_cancelled')); next(); return; }
    running = true;
    let worker;
    try {
      worker = new Worker(path.join(__dirname, 'extended-worker.js'), { workerData: job.input,
        resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 } });
    } catch (_) {
      running = false;
      job.reject(new HttpError(503, 'Analysis worker is unavailable', 'analytics_extension_worker_unavailable'));
      next(); return;
    }
    let done = false;
    const finish = (error, data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      job.signal?.removeEventListener('abort', abort);
      // Release the CPU slot only after the previous worker has actually stopped.
      void worker.terminate().catch(() => {}).finally(() => { running = false; next(); });
      if (error) job.reject(error);
      else {
        if (cache.size >= 8) cache.delete(cache.keys().next().value);
        cache.set(job.key, { through: Date.now() + 180000, value: data });
        job.resolve(data);
      }
    };
    const abort = () => finish(new HttpError(499, 'Analysis request cancelled', 'analytics_extension_cancelled'));
    const timer = setTimeout(() => finish(new HttpError(504, 'Analysis timed out; select a smaller dataset', 'analytics_extension_timeout')), timeoutMs);
    job.signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', value => value.ok ? finish(null, value.data)
      : finish(new HttpError(422, 'The selected analysis cannot be calculated', 'analytics_extension_calculation_failed')));
    worker.once('error', () => finish(new HttpError(503, 'Analysis worker is unavailable', 'analytics_extension_worker_unavailable')));
    worker.once('exit', () => { if (!done) finish(new HttpError(503, 'Analysis worker stopped', 'analytics_extension_worker_unavailable')); });
  }
  return function run(input, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(new HttpError(499, 'Analysis request cancelled', 'analytics_extension_cancelled'));
    if (input.rows.length > 100) return Promise.reject(new HttpError(422, 'Choose at most 100 sessions per report', 'analytics_extension_dataset_too_large'));
    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized) > maximumBytes) return Promise.reject(new HttpError(422, 'Select a smaller dataset', 'analytics_extension_dataset_too_large'));
    const key = createHash('sha256').update(VERSION).update(serialized).digest('hex');
    const cached = cache.get(key);
    if (cached && cached.through > Date.now()) return Promise.resolve(cached.value);
    cache.delete(key);
    if (queue.length >= maxQueue) return Promise.reject(new HttpError(503, 'Analysis is busy; retry shortly', 'analytics_extension_busy'));
    return new Promise((resolve, reject) => { queue.push({ input, key, resolve, reject, signal }); next(); });
  };
}

module.exports = { VERSION, METRICS, METHODS, validatePlan, scopeRows, createRunner, run: createRunner() };
