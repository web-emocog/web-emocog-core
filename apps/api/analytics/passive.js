const { definitions, measurement } = require('../../shared/passive-metrics');
const IDS = new Set(definitions.map(item => item.id));

function passiveMetric(metricId, row, query) {
  const definition = definitions.find(item => item.id === metricId);
  if (!definition) return null;
  const result = measurement(row.features_payload || {}, metricId);
  // A whole-session summary cannot answer an interval/condition-specific query.
  const intervalSelected = ['blockIds', 'stimulusIds', 'conditionIds', 'aoiIds'].some(key => query.filters?.[key]?.length);
  const value = intervalSelected ? null : result.value;
  return { metricId, value, unit: definition.unit, status: value == null ? 'no_data' : result.status,
    reason: intervalSelected ? 'session_summary_not_interval' : result.reason,
    numerator: null, denominator: result.n, observationDurationMs: null,
    nParticipants: value == null ? 0 : 1, nObservations: value == null ? 0 : (result.n ?? 0), signalConfidence: null,
    scope: { sessionId: row.id, blockId: null, trialId: null, presentationId: null, stimulusId: null, aoiId: null },
    qc: { channel: definition.channel, status: 'not_computed', validFraction: null, signalConfidence: null,
      reasons: [value == null ? (intervalSelected ? 'session_summary_not_interval' : result.reason) : 'summary_not_independent_validation'],
      ruleVersion: 'passive-summary-qc.v1' },
    algorithm: { id: `passive-${result.scope}`, version: result.methodVersion, parametersHash: null } };
}
module.exports = { IDS, passiveMetric };
