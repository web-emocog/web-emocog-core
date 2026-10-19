const test = require('node:test');
const assert = require('node:assert/strict');
const { definitions, measurement } = require('../../shared/passive-metrics');
const { build, CHANNELS } = require('../../shared/rt-alignment');
const { validateAlignment } = require('../analytics/connectedness');
const { buildSessionMetrics, buildGroupSummary, buildExportBundle, channelQc } = require('../analytics/metrics');
const { validateAnalyticsQuery, METRIC_CATALOG } = require('../analytics/query');

const ids = definitions.map(item => item.id);
const query = (patch = {}) => ({ schemaVersion: '1.0', mode: 'session', analysisLevel: 'level_1',
  projectId: 1, protocolId: 2, protocolVersion: 'publication:2', metricIds: ids,
  filters: { participantIds: [], sessionIds: ['one'], groupIds: [], conditionIds: [], blockIds: [], stimulusIds: [],
    aoiIds: [], qcMode: 'all', qcChannels: ['task', 'gaze'], minValidFraction: null, minSignalConfidence: null,
    deviceClasses: [], dateFrom: null, dateTo: null, includeIncompleteSessions: false, ...patch } });
const payload = () => ({ bpm_summary: { bpmMean: 80, validSampleCount: 30, methodVersion: 'continuous_signals.v2' },
  respiration_summary: { resp_rate_mean: 12, resp_sample_count: 20, resp_available: true },
  blink_summary: { blinkCount: 0, blinkRatePerMin: 0 },
  perclos_summary: { windows: { '60s': { meanPct: 0 } } },
  attentionMetrics: { sampleCounts: { eyeSignals: 1800 }, global: { eyeDurationMs: 60000 } },
  body_pose_summary: { enabled: true, validSampleCount: 300, retainedValidSampleCount: 40, movementVelocityMean: .1, movementVelocityP95: .3 },
  emotion_summary: { n: 50, valence_mean: 0, arousal_mean: .2 } });
const row = (id, person, data = payload()) => ({ id, participant_id: person, session_id: String(id), features_payload: data });

test('passive catalog and valid query share stable metric IDs and units', () => {
  assert.equal(validateAnalyticsQuery(query()).ok, true);
  for (const definition of definitions) {
    const catalog = METRIC_CATALOG.metrics.find(item => item.id === definition.id);
    assert.equal(catalog.unit, definition.unit);
    assert.deepEqual(catalog.label, definition.label);
  }
});

test('passive metrics expose observed means and genuine zeros, never invent missing measurements', () => {
  const metrics = buildSessionMetrics(row(1, 'p'), query());
  assert.equal(metrics.length, 9);
  assert.ok(metrics.every(metric => metric.status === 'computed'));
  assert.equal(metrics.find(m => m.metricId === 'physiology.bpm_mean').value, 80);
  assert.equal(metrics.find(m => m.metricId === 'blink.count').value, 0);
  assert.equal(metrics.find(m => m.metricId === 'face.valence_mean').value, 0);
  const p95 = metrics.find(m => m.metricId === 'body.velocity_p95');
  assert.equal(p95.denominator, 40);
  assert.equal(p95.algorithm.id, 'passive-retained_samples');
  assert.ok(buildSessionMetrics(row(2, 'p', {}), query()).every(m => m.value === null && m.status === 'no_data'));
});

test('disabled, zero-count, incomplete, out-of-range and too-short channels abstain', () => {
  const data = payload();
  data.bpm_summary.validSampleCount = 0;
  data.respiration_summary.resp_available = false;
  data.body_pose_summary.enabled = false;
  data.emotion_summary.n = 0;
  data.attentionMetrics.global.eyeDurationMs = 59999;
  assert.equal(measurement(data, 'physiology.bpm_mean').value, null);
  assert.equal(measurement(data, 'physiology.respiration_mean').value, null);
  assert.equal(measurement(data, 'body.velocity_mean').value, null);
  assert.equal(measurement(data, 'face.valence_mean').value, null);
  assert.equal(measurement(data, 'blink.perclos60_pct').reason, 'insufficient_window_duration');
  const invalid = payload(); invalid.bpm_summary.bpmMean = Infinity;
  assert.equal(measurement(invalid, 'physiology.bpm_mean').value, null);
  invalid.bpm_summary.bpmMean = 500;
  assert.equal(measurement(invalid, 'physiology.bpm_mean').reason, 'signal_summary_invalid');
  invalid.experimentMeta = { storageRecovery: { signalSeriesIncomplete: true } };
  assert.equal(measurement(invalid, 'blink.count').reason, 'signal_history_incomplete');
  delete invalid.bpm_summary.validSampleCount;
  invalid.bpm_summary.bpmMean = 80;
  assert.equal(measurement(invalid, 'physiology.bpm_mean').n, null);
});

test('session summaries cannot masquerade as selected block, stimulus, AOI or condition windows', () => {
  for (const field of ['blockIds', 'stimulusIds', 'aoiIds', 'conditionIds']) {
    const metrics = buildSessionMetrics(row(1, 'p'), query({ [field]: ['selected'] }));
    assert.ok(metrics.every(m => m.value === null && m.reason === 'session_summary_not_interval'));
  }
});

test('legacy sample counts stay unknown and empty summaries never claim channel QC passed', () => {
  const legacy = payload(); delete legacy.attentionMetrics.sampleCounts;
  const blink = buildSessionMetrics(row(1, 'p', legacy), query()).find(m => m.metricId === 'blink.count');
  assert.equal(blink.value, 0);
  assert.equal(blink.denominator, null);
  assert.equal(blink.nObservations, 0);
  for (const channel of ['rppg', 'respiration', 'blink', 'face', 'head_hands']) {
    const absent = channelQc(row(1, 'p', { bpm_summary: {}, respiration_summary: {}, blink_summary: {} }), channel);
    assert.equal(absent.status, 'not_computed');
    assert.deepEqual(absent.reasons, ['signal_data_missing']);
    assert.equal(channelQc(row(1, 'p'), channel).status, 'not_computed');
    assert.equal(channelQc({ ...row(1, 'p'), qc_validity: 'invalid' }, channel).status, 'invalid');
  }
});

test('participant-equal physiology group statistics do not weight people by frames or session count', () => {
  const first = payload(), second = payload(), third = payload();
  second.bpm_summary.bpmMean = 100; second.bpm_summary.validSampleCount = 1;
  third.bpm_summary.bpmMean = 60; third.bpm_summary.validSampleCount = 10000;
  const group = buildGroupSummary([row(1, 'A', first), row(2, 'A', second), row(3, 'B', third)], query({ sessionIds: [] }));
  const bpm = group.metrics.find(m => m.metricId === 'physiology.bpm_mean');
  assert.deepEqual(bpm.participantValues.map(p => p.value), [90, 60]);
  assert.equal(bpm.median, 75);
  assert.equal(bpm.nParticipants, 2);
});

test('snapshot JSON and long exports preserve physiology source scope, counts, nulls and units', () => {
  const data = payload(); delete data.respiration_summary;
  const snapshot = { id: 's', datasetHash: 'hash', queryEcho: query(), versions: {}, includedParticipantIds: ['p'], includedSessionIds: [1] };
  const bundle = buildExportBundle({ snapshot, sessionRows: [row(1, 'p', data)], protocol: { definition: { blocks: [] } } });
  assert.equal(bundle.summary.session.metrics.find(m => m.metricId === 'physiology.bpm_mean').unit, 'bpm');
  assert.equal(bundle.longData.find(m => m.metricId === 'physiology.respiration_mean').value, null);
  assert.equal(bundle.dataDictionary.find(m => m.metricId === 'body.velocity_p95').unit, 'torso/s');
});

test('respiration joins event windows independently of pulse publication and rejects holds/low confidence', () => {
  const events = [{ type: 'stimulus_on', timestamp: 1000, blockId: 'b', trialId: 't', response_mode: 'keyboard' },
    { type: 'response', timestamp: 1400, blockId: 'b', trialId: 't', responded: true, rtMs: 400 },
    { type: 'trial_end', timestamp: 1400, blockId: 'b', trialId: 't', qualityValid: true, correct: true }];
  const samples = [{ t: 1100, published: false, bpm: 90, respRate: 12, respConf: .8 },
    { t: 1200, published: true, bpm: 90, held: true, respRate: 18, respConf: .1 },
    { t: 1300, published: true, bpm: 80, respRate: 18, respConf: .8, respHeld: true }];
  const report = build({ events, bpmRuns: [{ samples }] });
  assert.equal(report.algorithmVersion, 'event-windows-1.1.0');
  const channels = report.trials[0].windows.response.channels;
  assert.equal(channels.respiration.value, 12);
  assert.equal(channels.respiration.nValid, 1);
  assert.equal(channels.bpm.value, 80);
  assert.deepEqual(validateAlignment(report), []);
  const legacy = structuredClone(report); legacy.algorithmVersion = 'event-windows-1.0.0';
  for (const trial of legacy.trials) for (const period of Object.values(trial.windows)) delete period.channels.respiration;
  assert.deepEqual(validateAlignment(legacy), []);
  assert.ok(CHANNELS.includes('respiration'));
});
