const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildSessionMetrics, buildExportBundle } = require('../analytics/metrics');
const { trialSummary, presentationAttempts } = require('../analytics/attempts');
const { exportCsv } = require('../analytics/v1-router');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const responses = require('../../shared/task-response-semantics');
const { computeQcValidity } = require('../qc/aggregator');
const { build: assessQuality } = require('../../shared/metric-quality');
const load = file => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js', file)).href);

function taskFixture() {
  const trials = [
    { responseMode: 'none', task_id: 'passive_viewing', correct: true, response: null, duration: 5000, rt: 999 },
    { expectedResponse: 'Space', correct: true, response: 'Space', rt: 300, duration: 300 },
    { expectedResponse: 'Space', correct: false, response: null, duration: 1000 },
    { condition: 'nogo', expectedResponse: null, correct: true, response: null, duration: 1000 },
    { expectedResponse: 'Space', correct: false, response: null, qualityValid: false, duration: 500 },
  ].map((trial, index) => ({ qualityValid: true, blockId: 'b', trialId: `t${index}`,
    presentationId: `p${index}`, attempt: 1, ...trial }));
  return { id: 1, participant_id: 'synthetic', started_at: new Date(0), stopped_at: new Date(999999),
    features_payload: { cognitiveResults: trials, presentation_plan: { actual: trials.map(trial => ({
      ...trial, stimulusOnPerfMs: 10, stimulusOffPerfMs: 10 + trial.duration,
    })) } } };
}
const query = { filters: {}, metricIds: ['task.accuracy_pct', 'task.omission_count', 'task.omission_rate_pct',
  'task.rt_mean_ms', 'task.trial_count_valid', 'task.trial_count_excluded'] };

test('#144 passive viewing and correct withholding do not become omissions or inflate accuracy', () => {
  const row = taskFixture(), before = structuredClone(row);
  const metrics = Object.fromEntries(buildSessionMetrics(row, query).map(metric => [metric.metricId, metric]));
  assert.equal(metrics['task.omission_count'].value, 1);
  assert.equal(metrics['task.omission_rate_pct'].value, 50);
  assert.equal(metrics['task.omission_count'].denominator, 2);
  assert.equal(metrics['task.accuracy_pct'].value, 66.667);
  assert.equal(metrics['task.accuracy_pct'].denominator, 3);
  assert.equal(metrics['task.rt_mean_ms'].value, 300);
  assert.equal(metrics['task.trial_count_valid'].value, 4);
  assert.equal(metrics['task.trial_count_excluded'].value, 1);
  assert.equal(metrics['task.rt_mean_ms'].observationDurationMs, 7300);
  assert.equal(metrics['task.trial_count_excluded'].observationDurationMs, 7800);
  assert.deepEqual(row, before);
});

test('#144 passive-only performance is not applicable, but the recorded trial remains counted', () => {
  const row = taskFixture(); row.features_payload.cognitiveResults.length = 1;
  const metrics = buildSessionMetrics(row, query);
  for (const metric of metrics.slice(0, 4)) {
    assert.equal(metric.value, null); assert.equal(metric.status, 'not_applicable');
    assert.equal(metric.reason, 'response_not_required');
  }
  assert.equal(metrics[4].value, 1);
});

test('#144 legacy timing is unknown, not the server session lifetime; conflicting identities cannot borrow timing', () => {
  const row = taskFixture(); delete row.features_payload.presentation_plan;
  assert.ok(buildSessionMetrics(row, query).every(metric => metric.observationDurationMs === null));
  for (const mutate of [
    actual => { actual[0].attempt = 2; },
    actual => { actual[0].trialId = 'wrong'; },
    actual => { actual[0].stimulusId = 'wrong'; },
    actual => { actual[0].stimulusOffPerfMs = 9; },
    actual => { actual.push(actual[0]); },
  ]) {
    const fixture = taskFixture(); mutate(fixture.features_payload.presentation_plan.actual);
    assert.equal(buildSessionMetrics(fixture, query)[0].observationDurationMs, null);
  }
  assert.equal(responses.responseRequired({ response: null }), true);
  assert.equal(responses.responseRequired({ condition: 'SYNTHETIC nogo', response: null }), false);
  assert.equal(responses.responseRequired({ expectedResponse: null }), false);
  const malformed = taskFixture(); malformed.features_payload.presentation_plan.actual = {};
  assert.equal(buildSessionMetrics(malformed, query)[0].observationDurationMs, null);
});

test('#144 excluded response tasks remain missing data, not passive tasks or successful zeros', () => {
  const row = taskFixture();
  row.features_payload.cognitiveResults = row.features_payload.cognitiveResults.slice(1, 3)
    .map(trial => ({ ...trial, qualityValid: false }));
  for (const metric of buildSessionMetrics(row, query).slice(0, 4)) {
    assert.equal(metric.value, null);
    assert.equal(metric.status, 'no_data');
    assert.equal(metric.reason, 'no_valid_task_trials');
  }
  const passive = taskFixture(); passive.features_payload.cognitiveResults.length = 1;
  const [commission] = buildSessionMetrics(passive, { filters: {}, metricIds: ['task.commission_count'] });
  assert.equal(commission.value, null); assert.equal(commission.status, 'not_applicable');
});

test('#144 attempt exports refuse oversized selections without silently dropping attempts', () => {
  const rows = [1, 2].map(id => ({ id, features_payload: { cognitiveResults:
    Array.from({ length: 4500 }, (_, index) => ({ blockId: 'b', trialId: `t${index}`, qualityValid: true })) } }));
  assert.throws(() => buildExportBundle({ sessionRows: rows, protocol: null,
    snapshot: { queryEcho: query, includedParticipantIds: [], includedSessionIds: [1, 2] } }, 'long'),
  error => error.status === 413 && error.code === 'export_output_limit');
});

test('#144 interrupted presentations remain separate from completed results, with no invented response or RT', () => {
  for (const withGaze of [true, false]) {
    const row = taskFixture();
    row.features_payload.presentation_plan.actual.push({ presentationId: 'interrupted', blockId: 'b', trialId: 'lost',
      stimulusId: 's', attempt: 1, sequence: 6, status: 'interrupted', deviations: ['page_reloaded'],
      stimulusOnEpochMs: 10100, sessionStartEpochMs: 10000 });
    if (withGaze) row.features_payload.gaze_analytics = { schemaVersion: 'gaze_analytics.v1', presentations: [
      { presentationId: 'interrupted', blockId: 'b', trialId: 'lost', stimulusId: 's' },
    ] };
    const before = structuredClone(row);
    const summary = trialSummary(row, query);
    assert.deepEqual(summary.counts, { valid: 4, excluded: 1, total: 5, interrupted: 1 });
    const interrupted = summary.exclusions.find(entry => entry.attemptStatus === 'interrupted');
    assert.equal(interrupted.presentationId, 'interrupted');
    assert.equal(interrupted.reasonCode, 'page_reloaded');
    assert.equal(interrupted.includedInDefault, false);
    assert.equal(presentationAttempts(row).filter(entry => entry.presentationId === 'interrupted').length, 1);
    assert.equal(trialSummary(row, { filters: { blockIds: ['other'] } }).exclusions.length, 0);
    const bundle = buildExportBundle({ sessionRows: [row], protocol: { definition: { blocks: [] } }, snapshot: {
      id: 'snapshot', datasetHash: 'hash', queryEcho: { ...query, mode: 'session', analysisLevel: 'level_1' },
      versions: {}, includedParticipantIds: ['synthetic'], includedSessionIds: [1],
    } });
    const attempts = bundle.longData.filter(entry => entry.sourceKind === 'task_attempt');
    assert.equal(attempts.length, 18);
    assert.ok(attempts.filter(entry => entry.presentationId === 'interrupted').every(entry =>
      entry.value === null && entry.attemptStatus === 'interrupted' && entry.includedInDefault === false));
    assert.ok(attempts.filter(entry => entry.presentationId === 'p0').every(entry => entry.status === 'not_applicable'));
    assert.equal(attempts.find(entry => entry.presentationId === 'p3' && entry.metricId === 'task.responded').value, false);
    assert.equal(attempts.find(entry => entry.presentationId === 'p3').responseRequired, false);
    const csv = exportCsv(bundle);
    assert.match(csv, /task_attempt/); assert.match(csv, /interrupted/); assert.match(csv, /page_reloaded/);
    assert.deepEqual(row, before);
  }
});

test('#144 QC resumes weighted counters and completed FPS windows over multiple reloads, never the offline gap', async t => {
  const { QCMetrics } = await load('qc-metrics/QCMetrics.js');
  const originals = { performance: global.performance, document: global.document, window: global.window };
  let now = 0;
  global.performance = { now: () => now };
  global.document = { getElementById: () => null, querySelectorAll: () => [] };
  global.window = { innerWidth: 1000, innerHeight: 700 };
  t.after(() => Object.assign(global, originals));
  const frame = visible => ({ face: { detected: visible, status: visible ? 'optimal' : 'not_found' },
    pose: { status: 'stable' }, eyes: { bothOpen: true }, illumination: { status: 'optimal' } });
  const run = (qc, count, step, visible) => {
    for (let i = 0; i < count; i++) { now += step; qc.addGazePoint(visible ? { x: 500, y: 350 } : null, null); qc.processFrame(frame(visible)); }
  };
  const first = new QCMetrics(); first.start({ analysisFpsThreshold: 25 });
  run(first, 200, 50, false); first.stop();
  const saved = JSON.parse(JSON.stringify(first.getSummary()));
  now += 500000;
  assert.equal(first.getSummary().durationMs, 10000);
  const second = new QCMetrics(); second.start({ previousSummary: saved, analysisFpsThreshold: 25 });
  assert.equal(second.getCurrentMetrics().analysisFps, 0);
  run(second, 400, 25, true); second.stop();
  let summary = second.getSummary();
  assert.equal(summary.totalFrames, 600);
  assert.equal(summary.durationMs, 20000);
  assert.equal(summary.faceVisiblePct, 66.7);
  assert.equal(summary.gazeValidPct, 66.7);
  assert.equal(summary.fpsDiagnostics.analysisSession.meanFps, 30);
  assert.equal(summary.fpsDiagnostics.analysisSession.belowThresholdMs, 10000);
  assert.equal(summary.continuity.segmentCount, 2);
  assert.equal(summary.continuity.historyComplete, true);
  now += 100000;
  const third = new QCMetrics(); third.start({ previousSummary: summary, analysisFpsThreshold: 25 });
  // Recalibration clears this segment's validation gaze, not earlier task data.
  third.addGazePoint({ x: 500, y: 350 }, null); third.resetGazeAvailability();
  assert.equal(third.getSummary().gazeTotal, 600);
  run(third, 400, 25, true); third.stop(); summary = third.getSummary();
  assert.equal(summary.durationMs, 30000);
  assert.equal(summary.totalFrames, 1000);
  assert.equal(summary.gazeValidPct, 80);
  assert.equal(summary.fpsDiagnostics.analysisSession.meanFps, 1000 / 30);
  assert.deepEqual(validateSessionFeaturePayload({ schemaVersion: 'session_feature.v1', ids: { session: 'synthetic-reload' },
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' }, events: [], qcSummary: summary }), []);
  const legacy = new QCMetrics(); legacy.start({ previousSummary: { totalFrames: 600, durationMs: 20000 } });
  assert.equal(legacy.getSummary().continuity.historyComplete, false);
  assert.equal(legacy.getSummary().overallPass, false);
  assert.equal(legacy.getSummary().checks.historyComplete, false);
  const misleading = { ...legacy.getSummary(), qcScore: 1, checks: { duration: true }, overallPass: true,
    protocolQc: { schemaVersion: 'protocol_quality.v1', checks: { gazeValid: { enabled: true, status: 'passed' } } } };
  assert.equal(computeQcValidity(misleading).validity, 'invalid');
  assert.ok(computeQcValidity(misleading).fail_reasons.includes('qc_history_incomplete'));
  const assessed = assessQuality({ lifecycle: { status: 'completed' }, qcSummary: misleading });
  assert.equal(assessed.protocolQuality, 'unknown');
  assert.equal(assessed.recordingIntegrity.status, 'partial');
  for (const mutate of [
    saved => { saved.counters.faceVisible = saved.counters.totalFrames + 1; },
    saved => { saved.counters.gazeValid = saved.counters.gazeTotal + 1; },
    saved => { saved.counters.totalFrames = .5; },
    saved => { saved.fpsDiagnostics.analysisSession.frames = -1; },
    saved => { saved.continuity.schemaVersion = 'unsupported'; },
    saved => { saved.continuity.segmentCount = -1; },
    saved => { saved.gazeValidTimeMs = null; },
  ]) {
    const damaged = structuredClone(saved); mutate(damaged);
    const recovered = new QCMetrics(); recovered.start({ previousSummary: damaged, analysisFpsThreshold: 25 });
    assert.equal(recovered.getSummary().continuity.historyComplete, false); recovered.stop();
  }
  legacy.stop(); third.reset(); third.start();
  assert.equal(third.getSummary().totalFrames, 0);
  assert.equal(third.getSummary().continuity.segmentCount, 1); third.stop();
});
