const { definitions, measurement } = require('../../shared/passive-metrics');
const IDS = new Set(definitions.map(item => item.id));
const CHANNELS = { 'physiology.bpm_mean': 'heartRate', 'physiology.respiration_mean': 'respiration' };
const MIN_REPORT_COVERAGE_MS = 1000;
const incompatibleFilters = filters => ['stimulusIds', 'conditionIds', 'aoiIds'].some(key => filters[key]?.length);

function reportInterval(row) {
  const visible = channel => channel.observedMs >= MIN_REPORT_COVERAGE_MS ? channel : { ...channel, mean: null };
  return { ...row, heartRate: visible(row.heartRate), respiration: visible(row.respiration) };
}

function intervalPayload(row) {
  const data = row.features_payload?.physiology_intervals;
  return data?.schemaVersion === 'physiology_intervals.v1' && Array.isArray(data.minutes) && Array.isArray(data.blocks) ? data : null;
}

function intervalData(row, query) {
  const data = intervalPayload(row);
  if (!data) return null;
  const filters = query.filters || {};
  if (incompatibleFilters(filters)) return null;
  if (!filters.blockIds?.length) return { ...data, minutes: data.minutes.map(reportInterval), blocks: data.blocks.map(reportInterval) };
  const blockIds = new Set(filters.blockIds);
  return { ...data, minutes: [], blocks: data.blocks.filter(block => blockIds.has(block.blockId)).map(reportInterval) };
}

function blockMeasurement(row, query, channel) {
  const rows = intervalPayload(row)?.blocks;
  const blockIds = new Set(query.filters.blockIds);
  let n = 0, observedMs = 0, sum = 0;
  for (const block of rows || []) {
    if (block.status !== 'accepted' || !blockIds.has(block.blockId)) continue;
    const signal = block[channel];
    if (signal.observedMs < MIN_REPORT_COVERAGE_MS || !Number.isFinite(signal.mean)) continue;
    n += signal.count;
    observedMs += signal.observedMs;
    sum += signal.mean * signal.count;
  }
  const value = n ? sum / n : null;
  return { value, n, observedMs, status: value === null ? 'no_data' : 'computed',
    reason: value !== null ? null : rows ? 'block_physiology_missing' : 'session_summary_not_interval',
    scope: 'accepted_blocks', methodVersion: 'physiology_intervals.v1' };
}

function intervalExportRows(data, metricIds, context) {
  if (!data) return [];
  const rows = [];
  for (const metricId of metricIds) {
    if (!Object.hasOwn(CHANNELS, metricId)) continue;
    const definition = definitions.find(item => item.id === metricId);
    for (const [kind, intervals] of [['minute', data.minutes], ['block', data.blocks]]) {
      for (const interval of intervals) {
        const { mean, count, observedMs } = interval[CHANNELS[metricId]];
        const duration = interval.endMs - interval.startMs;
        const hasData = count > 0 && Number.isFinite(mean);
        rows.push({ ...context, metricId, value: hasData ? mean : null, unit: definition.unit,
          status: hasData ? 'computed' : 'no_data', reason: hasData ? null : 'interval_signal_missing',
          denominator: count, nObservations: count, observationDurationMs: observedMs,
          sourceKind: 'physiology_' + kind, intervalStartMs: interval.startMs, intervalEndMs: interval.endMs,
          coveragePct: duration > 0 ? observedMs / duration * 100 : 0,
          blockId: interval.blockId, attempt: interval.attempt, attemptStatus: interval.status,
          algorithm: { id: 'physiology-intervals', version: data.schemaVersion, parametersHash: null } });
      }
    }
  }
  return rows;
}

function passiveMetric(metricId, row, query) {
  const definition = definitions.find(item => item.id === metricId);
  if (!definition) return null;
  const filters = query.filters || {};
  const blockSelected = Boolean(filters.blockIds?.length);
  const channel = Object.hasOwn(CHANNELS, metricId) ? CHANNELS[metricId] : null;
  const blocked = incompatibleFilters(filters) || (blockSelected && !channel);
  const result = blocked ? { value: null, status: 'no_data', reason: 'session_summary_not_interval',
    n: null, scope: 'whole_measured_session', methodVersion: null }
    : blockSelected ? blockMeasurement(row, query, channel) : measurement(row.features_payload || {}, metricId);
  const value = result.value;
  return { metricId, value, unit: definition.unit, status: value == null ? 'no_data' : result.status,
    reason: result.reason,
    numerator: null, denominator: result.n, observationDurationMs: result.observedMs ?? null,
    nParticipants: value == null ? 0 : 1, nObservations: value == null ? 0 : (result.n ?? 0), signalConfidence: null,
    scope: { sessionId: row.id, blockId: blockSelected && !blocked && filters.blockIds.length === 1 ? filters.blockIds[0] : null,
      trialId: null, presentationId: null, stimulusId: null, aoiId: null },
    qc: { channel: definition.channel, status: 'not_computed', validFraction: null, signalConfidence: null,
      reasons: [value == null ? result.reason : 'summary_not_independent_validation'],
      ruleVersion: 'passive-summary-qc.v1' },
    algorithm: { id: `passive-${result.scope}`, version: result.methodVersion, parametersHash: null } };
}
module.exports = { IDS, passiveMetric, intervalData, intervalExportRows };
