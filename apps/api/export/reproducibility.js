const crypto = require('node:crypto');
const { escapeCsv } = require('../security/csv');
const { HttpError } = require('../security/http-error');
const { sessionVersion } = require('../analytics/protocol-versions');
const { build: assessQuality } = require('../../shared/metric-quality');
const { definitions, measurement } = require('../../shared/passive-metrics');

const VERSION = 'reproducibility_export.v1';
const LIMITS = Object.freeze({ sessions: 50, sourceBytes: 8 * 1024 * 1024,
  rows: 25000, outputBytes: 16 * 1024 * 1024, concurrent: 2 });
const COLUMNS = Object.freeze(['session_id', 'participant_id', 'project_id', 'protocol_id', 'protocol_version',
  'group_id', 'source_kind', 'scope', 'channel', 'metric', 'value', 'unit', 'method_version',
  'block_id', 'trial_id', 'presentation_id', 'attempt', 'attempt_status', 'condition_id', 'stimulus_id',
  'stimulus_version', 'clock', 'time_origin_ms', 'session_start_epoch_ms', 'onset_epoch_ms', 'onset_perf_ms',
  'interval_start_ms', 'interval_end_ms', 'observed_ms', 'sample_count', 'coverage_fraction',
  'recording_integrity', 'signal_quality', 'suitability', 'quality_valid', 'missing_reason', 'reason_codes']);
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const code = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : null;
const id = value => (typeof value === 'number' || typeof value === 'string') && String(value).length <= 256
  && !/[@\r\n\x00]|:\/\//.test(String(value)) ? String(value) : null;
const codes = value => Array.isArray(value) ? [...new Set(value.map(code).filter(Boolean))].sort() : [];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, errorCode = 'export_source_invalid') => { throw new HttpError(422, message, errorCode); };

function rowsArray(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) fail(`Invalid ${name} collection`);
  return value;
}

function projectPlan(plan) {
  if (!plan) return null;
  if (plan.schemaVersion !== 'presentation_plan.v1' || plan.rngVersion !== 'mulberry32.v1') {
    fail('Unsupported saved presentation plan', 'export_plan_version_unsupported');
  }
  const strings = ['planItemId', 'blockId', 'trialId', 'stimulusId', 'stimulusVersion', 'condition',
    'expectedResponse', 'responseMode', 'presentationId', 'status'];
  const numbers = ['sourceIndex', 'orderIndex', 'protocolDurationMs', 'fixationMs', 'interStimulusMinMs',
    'interStimulusMaxMs', 'fixationMinMs', 'fixationMaxMs', 'randomItiMinMs', 'randomItiMaxMs',
    'fixationBaseMs', 'randomPreStimulusMs', 'fixationDurationMs', 'stimulusDurationMs', 'itiMs',
    'sequence', 'attempt', 'startedAtEpochMs', 'startedAtPerfMs', 'timeOriginMs', 'sessionStartEpochMs',
    'fixationStartedPerfMs', 'stimulusOnEpochMs', 'stimulusOnPerfMs', 'stimulusOffEpochMs',
    'stimulusOffPerfMs', 'effectiveStimulusDurationMs', 'actualItiMs'];
  const bools = ['randomize', 'useFixation', 'randomInterStimulus', 'qualityValid'];
  const entry = source => Object.fromEntries([
    ...strings.filter(key => Object.hasOwn(source, key)).map(key => [key, id(source[key])]),
    ...numbers.filter(key => Object.hasOwn(source, key)).map(key => [key, number(source[key])]),
    ...bools.filter(key => typeof source[key] === 'boolean').map(key => [key, source[key]]),
    ...(Object.hasOwn(source, 'deviations') ? [['deviations', codes(source.deviations)]] : [])
  ]);
  const blocks = rowsArray(plan.blocks, 'plan blocks');
  const sourceInputs = rowsArray(plan.sourceInputs, 'schedule inputs');
  const actual = rowsArray(plan.actual, 'actual presentations');
  if (blocks.length > 400 || sourceInputs.length > 400 || actual.length > 20000
    || blocks.reduce((n, block) => n + rowsArray(block.entries, 'plan entries').length, 0) > 10000
    || sourceInputs.reduce((n, block) => n + rowsArray(block.trials, 'plan inputs').length, 0) > 10000) {
    fail('Saved plan exceeds its declared limits', 'export_plan_limit');
  }
  return { schemaVersion: plan.schemaVersion, seed: number(plan.seed), rngVersion: plan.rngVersion,
    counterbalancing: { mode: code(plan.counterbalancing?.mode), assignment: id(plan.counterbalancing?.assignment) },
    repeatTimingPolicy: code(plan.repeatTimingPolicy), timedBlockPolicy: code(plan.timedBlockPolicy),
    historyBeforePlan: code(plan.historyBeforePlan),
    sourceInputs: sourceInputs.map(block => ({ ...entry(block), trials: block.trials.map(entry) })),
    blocks: blocks.map(block => ({ ...entry(block), entries: block.entries.map(entry) })), actual: actual.map(entry) };
}

function buildReproducibilityExport(sourceRows, { pseudonymKey, limits = LIMITS, selection } = {}) {
  if (typeof pseudonymKey !== 'string' || pseudonymKey.length < 16) throw new Error('export_pseudonym_key_required');
  if (!Array.isArray(sourceRows) || sourceRows.length > limits.sessions) {
    throw new HttpError(413, 'Select fewer sessions', 'export_session_limit');
  }
  const inputBytes = Buffer.byteLength(JSON.stringify(sourceRows));
  if (inputBytes > limits.sourceBytes) throw new HttpError(413, 'Select fewer sessions', 'export_source_limit');
  const longRows = [], sessions = [];
  const pseudonym = (project, participant) => participant == null ? null : 'p_' + crypto.createHmac('sha256', pseudonymKey)
    .update(JSON.stringify([String(project), String(participant)])).digest('hex').slice(0, 32);
  const ordered = [...sourceRows].sort((a, b) => String(a.session_id).localeCompare(String(b.session_id), 'en'));
  let bytes = 0;
  for (const row of ordered) {
    const payload = row.features_payload || {};
    const quality = assessQuality(payload, { serverAcknowledged: !!row.features_payload });
    const plan = projectPlan(payload.presentation_plan ?? payload.experimentMeta?.presentationPlan);
    const base = { session_id: id(row.session_id), participant_id: pseudonym(row.project_id, row.participant_id),
      project_id: number(row.project_id), protocol_id: number(row.protocol_id), protocol_version: sessionVersion(row),
      group_id: id(row.group_id), recording_integrity: code(quality.recordingIntegrity.status),
      session_start_epoch_ms: number(payload.startTime), signal_quality: 'unknown', suitability: 'not_independently_validated' };
    const push = item => {
      const normalized = Object.fromEntries(COLUMNS.map(key => [key, null]));
      Object.assign(normalized, base, item);
      normalized.reason_codes = codes(normalized.reason_codes);
      if (!Array.isArray(normalized.reason_codes)) normalized.reason_codes = [];
      bytes += Buffer.byteLength(JSON.stringify(normalized));
      if (longRows.length >= limits.rows || bytes > limits.outputBytes) {
        throw new HttpError(413, 'Select fewer sessions or a shorter date range', 'export_output_limit');
      }
      longRows.push(normalized);
    };
    const limitations = [];
    if (!plan) limitations.push('presentation_plan_not_recorded');
    if (plan?.historyBeforePlan === 'unknown_legacy') limitations.push('presentation_history_before_plan_unknown');
    const retained = payload.experimentMeta?.checkpointBuild;
    if (retained?.signalSeriesIncomplete || payload.experimentMeta?.storageRecovery?.signalSeriesIncomplete) {
      limitations.push('signal_history_incomplete');
    }
    for (const [field, label] of [['rt_alignment', 'rt_alignment'], ['physiology_intervals', 'physiology_intervals']]) {
      if (!payload[field]) limitations.push(`${label}_not_recorded`);
      else if (payload[field].truncated === true) limitations.push(`${label}_source_truncated`);
    }
    const gazeSummary = payload.gaze_analytics?.qualitySummary || payload.gaze_analytics?.summary;
    if (gazeSummary?.presentationsTruncated) limitations.push('gaze_presentations_source_truncated');
    const byPresentation = new Map();
    for (const record of plan?.actual || []) {
      if (byPresentation.has(record.presentationId)) fail('Duplicate recorded presentation', 'export_attempt_ambiguous');
      byPresentation.set(record.presentationId, record);
    }
    const task = rowsArray(payload.cognitiveResults, 'task trials');
    const covered = new Set();
    for (const trial of task) {
      const presentId = id(trial.presentationId);
      const record = presentId == null ? null : byPresentation.get(presentId);
      if (presentId != null && covered.has(presentId)) fail('Duplicate task result', 'export_attempt_ambiguous');
      if (record && (String(trial.blockId ?? trial.block) !== record.blockId || String(trial.trialId) !== record.trialId
        || String(trial.stimulusId) !== record.stimulusId || trial.attempt !== record.attempt)) {
        fail('Presentation identity does not match task result', 'export_attempt_ambiguous');
      }
      if (presentId != null) covered.add(presentId);
      const qualityValid = typeof trial.qualityValid === 'boolean' ? trial.qualityValid : null;
      const missing = trial.skippedMedia === true ? 'stimulus_unavailable' : trial.response == null ? 'no_response' : null;
      const context = { source_kind: 'task_attempt', scope: 'presentation', channel: 'task',
        block_id: id(trial.blockId ?? trial.block), trial_id: id(trial.trialId), presentation_id: presentId,
        attempt: number(trial.attempt), attempt_status: qualityValid === false ? 'excluded' : qualityValid === true ? 'accepted' : 'unknown',
        condition_id: id(trial.condition), stimulus_id: id(trial.stimulusId), stimulus_version: record?.stimulusVersion ?? null,
        clock: 'session_relative_wall_ms', interval_start_ms: number(trial.onsetMs),
        onset_epoch_ms: record?.stimulusOnEpochMs ?? null, onset_perf_ms: record?.stimulusOnPerfMs ?? null,
        time_origin_ms: record?.timeOriginMs ?? null, method_version: 'recorded_task_attempt.v1', quality_valid: qualityValid,
        signal_quality: qualityValid === true ? 'available_not_validated' : qualityValid === false ? 'rejected' : 'unknown',
        reason_codes: codes(trial.qualityIssueCodes) };
      const rt = number(trial.rt);
      push({ ...context, metric: 'task.rt_ms', value: rt != null && rt >= 0 && !trial.skippedMedia ? rt : null, unit: 'ms',
        missing_reason: trial.skippedMedia ? 'stimulus_unavailable' : rt == null ? missing || 'rt_not_recorded' : rt < 0 ? 'invalid_rt' : null });
      push({ ...context, metric: 'task.correct', value: typeof trial.correct === 'boolean' ? trial.correct : null, unit: 'boolean',
        missing_reason: typeof trial.correct === 'boolean' ? null : 'correctness_not_recorded' });
      push({ ...context, metric: 'task.responded', value: trial.response != null, unit: 'boolean', missing_reason: missing });
    }
    // Prepared/interrupted intent is exported even if no result ever reached the collector.
    for (const record of plan?.actual || []) if (!covered.has(record.presentationId)) push({
      source_kind: 'task_attempt', scope: 'presentation', channel: 'task', metric: 'task.rt_ms', unit: 'ms',
      block_id: record.blockId, trial_id: record.trialId, presentation_id: record.presentationId,
      stimulus_id: record.stimulusId, stimulus_version: record.stimulusVersion, attempt: record.attempt,
      attempt_status: 'incomplete', onset_epoch_ms: record.stimulusOnEpochMs, onset_perf_ms: record.stimulusOnPerfMs,
      time_origin_ms: record.timeOriginMs, clock: 'performance_now_ms', method_version: plan.schemaVersion,
      missing_reason: 'trial_result_missing', reason_codes: record.deviations
    });
    const alignment = payload.rt_alignment;
    const windowUnits = { gaze: 'fraction', body: 'torso/s', valence: 'index', arousal: 'index', bpm: 'bpm', respiration: 'breaths/min' };
    for (const trial of rowsArray(alignment?.trials, 'RT-aligned trials')) {
      for (const scope of ['baseline', 'response', 'post']) {
        const window = trial.windows?.[scope];
        if (!window) continue;
        for (const [channel, unit] of Object.entries(windowUnits)) {
          const signal = window.channels?.[channel];
          if (!signal) continue;
          const available = signal.status === 'observed' && number(signal.nValid) > 0;
          push({ source_kind: 'rt_aligned_window', scope, channel, metric: 'connectedness.' + channel,
            value: available ? number(signal.value) : null, unit, method_version: code(alignment.algorithmVersion),
            block_id: id(trial.blockId), trial_id: id(trial.trialId), stimulus_id: id(trial.stimulusId), condition_id: id(trial.condition),
            attempt: number(trial.attempt), quality_valid: trial.qualityValid === true,
            clock: `first_rt_onset_relative_${alignment.clock || 'unknown'}`, interval_start_ms: number(window.startMs),
            interval_end_ms: number(window.endMs), sample_count: number(signal.nValid),
            coverage_fraction: number(signal.validFraction), missing_reason: available ? null : 'signal_data_missing',
            signal_quality: available ? 'available_not_validated' : 'missing' });
        }
      }
    }
    const physiology = payload.physiology_intervals;
    if (physiology && physiology.schemaVersion !== 'physiology_intervals.v1') fail('Unsupported physiology interval version');
    for (const [kind, intervals] of [['minute', physiology?.minutes], ['block_attempt', physiology?.blocks]]) {
      for (const interval of rowsArray(intervals, 'physiology intervals')) {
        const start = number(interval.startMs), end = number(interval.endMs);
        if (start == null || end == null || end < start) fail('Invalid interval boundaries');
        for (const [channel, unit] of [['heartRate', 'bpm'], ['respiration', 'breaths/min']]) {
          const signal = interval[channel] || {}, n = number(signal.count), observed = number(signal.observedMs);
          if (n == null || n < 0 || !Number.isInteger(n) || observed == null || observed < 0 || observed > end - start) {
            fail('Invalid interval coverage');
          }
          const mean = number(signal.mean);
          const valid = n > 0 && observed > 0 && mean != null;
          push({ source_kind: 'physiology_interval', scope: kind, channel,
            metric: channel === 'heartRate' ? 'physiology.bpm_mean' : 'physiology.respiration_mean',
            unit, value: valid ? mean : null, method_version: code(signal.methodVersion) || 'legacy_summary',
            block_id: id(interval.blockId), attempt: number(interval.attempt), attempt_status: code(interval.status),
            clock: 'session_relative_wall_ms', interval_start_ms: start, interval_end_ms: end,
            observed_ms: observed, sample_count: n, coverage_fraction: end > start ? observed / (end - start) : null,
            signal_quality: valid ? 'available_not_validated' : 'missing',
            missing_reason: valid ? null : n === 0 ? 'no_valid_samples' : observed === 0 ? 'no_observed_duration' : 'estimate_missing',
            reason_codes: valid ? [] : ['interval_signal_missing'] });
        }
      }
    }
    for (const definition of definitions) {
      const result = measurement(payload, definition.id);
      const source = payload[result.source];
      push({ source_kind: 'signal_summary', scope: result.scope, channel: definition.channel,
        metric: definition.id, value: result.value, unit: definition.unit, sample_count: result.n,
        clock: 'not_recorded', method_version: code(source?.methodVersion ?? source?.algorithmVersion ?? source?.version),
        missing_reason: code(result.reason), signal_quality: result.value == null ? 'missing' : 'available_not_validated',
        reason_codes: ['summary_not_independent_validation'] });
    }
    const status = payload.lifecycle?.status;
    const completed = status === 'completed' ? true : ['in_progress', 'failed'].includes(status) ? false : null;
    push({ source_kind: 'recording', scope: 'session', channel: 'recording', metric: 'recording.completed', unit: 'boolean',
      value: completed, missing_reason: completed === null ? 'recording_status_not_recorded' : null,
      method_version: code(payload.lifecycle?.schemaVersion),
      reason_codes: quality.recordingIntegrity.reasons });
    sessions.push({ ...base, limitations: [...new Set(limitations)].sort(),
      planStatus: plan ? 'recorded' : 'not_recorded', presentationPlan: plan,
      sourceSha256: hash({ plan, task: longRows.filter(item => item.session_id === base.session_id) }),
      qualityAssessment: quality });
  }
  const bundle = { schemaVersion: VERSION, counts: { sessions: sessions.length, rows: longRows.length },
    completeRelativeToStoredData: true,
    scope: ['presentation_plan', 'task_attempts', 'retained_rt_windows', 'physiology_intervals', 'passive_session_summaries'],
    originalRecordingComplete: sessions.length > 0 && sessions.every(item => item.recording_integrity === 'complete' && item.limitations.length === 0),
    policies: { attempt: 'all_attempts_preserved_filter_explicitly', physiology: 'minute_and_block_views_overlap_do_not_sum',
      clocks: 'wall_and_performance_not_interchangeable', participantWeighting: 'aggregate_within_participant_before_group',
      privacy: 'project_scoped_pseudonyms_no_raw_media_no_free_responses', groupAssignment: 'null_unless_server_assigned',
      legacy: 'unknown_not_reconstructed', measurement: 'not_independently_validated' },
    columns: COLUMNS, sessions, rows: longRows,
    ...(selection ? { selection } : {}) };
  bundle.datasetSha256 = hash(bundle);
  if (Buffer.byteLength(JSON.stringify(bundle)) > limits.outputBytes) throw new HttpError(413, 'Select fewer sessions', 'export_output_limit');
  return bundle;
}

function reproducibilityCsv(bundle) {
  // Each CSV retains plan/limitations via a manifest row; JSON is the canonical package.
  const columns = [...COLUMNS, 'manifest_json'];
  const manifest = { ...bundle, rows: undefined };
  return '\uFEFF' + [columns.map(escapeCsv).join(','),
    columns.map(key => escapeCsv(key === 'source_kind' ? 'manifest' : key === 'manifest_json' ? JSON.stringify(manifest) : null)).join(','),
    ...bundle.rows.map(row => columns.map(key => escapeCsv(key === 'manifest_json' ? null : row[key])).join(','))].join('\r\n');
}

module.exports = { VERSION, LIMITS, COLUMNS, buildReproducibilityExport, reproducibilityCsv };
