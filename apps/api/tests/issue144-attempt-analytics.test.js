const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAoiRows, buildSessionVisuals, buildExportBundle, buildSessionMetrics, buildHeatmapData,
  buildGroupSummary, buildGroupHeatmap } = require('../analytics/metrics');
const { exportCsv } = require('../analytics/v1-router');
const { presentationAttempts, trialSummary } = require('../analytics/attempts');

const query = {
  mode: 'session', metricIds: ['aoi.dwell_time_ms', 'aoi.ttff_ms'],
  filters: { blockIds: [], stimulusIds: [], aoiIds: [], qcChannels: ['task', 'gaze'] },
};
const protocol = { definition: { blocks: [{ id: 'b', name: 'Block', blockConfig: { aoiDefinitions: {
  '10': [{ id: 'target', name: 'Target', shape: 'rectangle', order: 1, isTarget: true,
    points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], validityInterval: { startMs: 0, endMs: 5000 } }],
} } }] } };
function fixture() {
  const presentation = (id, attempt, time) => ({ blockId: 'b', trialId: 't', stimulusId: '10',
    presentationId: id, attempt, presentationStartMs: time, validObservationDurationMs: 1000,
    meanConfidence: .9, grid: { width: 1, height: 1, values: [1] },
    fixationPoints: [{ x: .5, y: .5, startMs: 100, durationMs: attempt === 1 ? 200 : 500 }] });
  return { id: 1, participant_id: 'synthetic', started_at: new Date(0), stopped_at: new Date(60000),
    qc_validity: 'valid', features_payload: {
      cognitiveResults: [
        { blockId: 'b', trialId: 't', stimulusId: '10', attempt: 1, qualityValid: false,
          sourceTrialIndex: 8, qualityIssueCodes: ['protocol_qc_fpsStable'] },
        { blockId: 'b', trialId: 't', stimulusId: '10', attempt: 2, qualityValid: true, sourceTrialIndex: 8 },
      ],
      gaze_analytics: { schemaVersion: 'gaze_analytics.v1', summary: {},
        presentations: [presentation('retry', 2, 20000), presentation('first', 1, 10000)] },
    } };
}

test('issue144: default stimulus metrics exclude rejected attempts without deleting their evidence', () => {
  const row = fixture();
  const metric = buildAoiRows(row, protocol, query)[0].metrics[0];
  assert.equal(metric.value, 500);
  assert.equal(metric.observationDurationMs, 1000);
  assert.equal(row.features_payload.gaze_analytics.presentations.length, 2);
});

test('issue144: heatmaps are per presentation, chronological and retain rejection identity', () => {
  const visuals = buildSessionVisuals(fixture(), protocol, query);
  assert.deepEqual(visuals.map(item => item.presentationId), ['first', 'retry']);
  assert.deepEqual(visuals.map(item => item.attemptStatus), ['excluded', 'accepted']);
  assert.deepEqual(visuals.map(item => item.attempt), [1, 2]);
  assert.equal(visuals[0].sourceTrialIndex, 8);
  assert.deepEqual(visuals[0].qualityIssueCodes, ['protocol_qc_fpsStable']);
  assert.deepEqual(visuals.map(item => item.aoiRows[0].metrics[0].value), [200, 500]);
});

test('issue144: long JSON has one AOI record per attempt with status and reasons', () => {
  const bundle = buildExportBundle({ protocol, sessionRows: [fixture()], snapshot: {
    queryEcho: query, includedParticipantIds: ['synthetic'], includedSessionIds: [1],
    versions: {}, excludedSessions: [],
  } });
  const rows = bundle.longData.filter(row => row.metricId === 'aoi.dwell_time_ms');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.scope.presentationId), ['first', 'retry']);
  assert.deepEqual(rows.map(row => row.attemptStatus), ['excluded', 'accepted']);
  assert.deepEqual(rows.map(row => row.observationDurationMs), [1000, 1000]);
  assert.deepEqual(rows[0].qualityIssueCodes, ['protocol_qc_fpsStable']);
  assert.match(rows[0].qualityReasons[0].label.en, /frame rate/);
});

test('issue144: missing presentation has no session-wide observation duration', () => {
  const row = fixture(); row.features_payload.gaze_analytics.presentations = [];
  const metrics = buildAoiRows(row, protocol, query)[0].metrics;
  assert.ok(metrics.every(metric => metric.value === null && metric.observationDurationMs === null));
  const contexts = buildSessionVisuals(row, protocol, query);
  assert.equal(contexts.length, 2);
  assert.ok(contexts.every(context => context.status === 'no_data'));
  assert.ok(contexts.every(context => context.aoiRows[0].metrics[0].observationDurationMs === null));
});

test('issue144: exclusions keep recorded identity even when no gaze sample was available', () => {
  const row = fixture(); row.features_payload.gaze_analytics.presentations = [];
  Object.assign(row.features_payload.cognitiveResults[0], { presentationId: 'no-gaze', presentationIndex: 9, onsetMs: 1000 });
  const summary = trialSummary(row, query);
  assert.deepEqual(summary.counts, { valid: 1, excluded: 1, total: 2 });
  assert.equal(summary.exclusions[0].presentationId, 'no-gaze');
  assert.equal(summary.exclusions[0].presentationIndex, 9);
});

test('issue144: ambiguous legacy attempts stay visible but cannot contaminate default metrics', () => {
  const row = fixture(); row.features_payload.gaze_analytics.presentations = [
    { ...row.features_payload.gaze_analytics.presentations[0], attempt: null, presentationId: 'merged' },
  ];
  const context = buildSessionVisuals(row, protocol, query)[0];
  assert.equal(context.attemptStatus, 'ambiguous');
  assert.equal(context.includedInDefault, false);
  assert.deepEqual(context.qualityIssueCodes, ['presentation_attempt_ambiguous']);
  assert.equal(buildAoiRows(row, protocol, query)[0].metrics[0].value, null);
});

test('issue144: an explicit identity mismatch cannot borrow the result of a neighboring timed presentation', () => {
  const row = fixture();
  const entries = row.features_payload.gaze_analytics.presentations;
  entries.forEach(entry => { entry.attempt = 1; });
  row.features_payload.cognitiveResults = [{ blockId: 'b', trialId: 't', stimulusId: '10',
    attempt: 1, presentationId: 'retry', qualityValid: true }];
  const contexts = presentationAttempts(row);
  assert.deepEqual(contexts.map(entry => entry.attemptStatus), ['incomplete', 'accepted']);
  assert.deepEqual(contexts.map(entry => entry.includedInDefault), [false, true]);
  assert.equal(buildAoiRows(row, protocol, query)[0].metrics[0].value, 500);
});

test('issue144: one legacy result cannot silently validate multiple distinct presentations', () => {
  const row = fixture();
  row.features_payload.gaze_analytics.presentations.forEach(entry => { entry.attempt = 1; });
  row.features_payload.cognitiveResults = [{ blockId: 'b', trialId: 't', stimulusId: '10',
    attempt: 1, qualityValid: true }];
  const contexts = presentationAttempts(row);
  assert.equal(contexts.length, 2);
  assert.ok(contexts.every(entry => entry.attemptStatus === 'ambiguous' && !entry.includedInDefault));
  assert.equal(buildAoiRows(row, protocol, query)[0].metrics[0].value, null);
});

test('issue144: exclusions prefer the recorded presentation ID over a shared attempt number', () => {
  const row = fixture();
  row.features_payload.gaze_analytics.presentations.forEach(entry => { entry.attempt = 1; });
  row.features_payload.cognitiveResults = [{ blockId: 'b', trialId: 't', stimulusId: '10',
    attempt: 1, presentationId: 'retry', qualityValid: false }];
  const exclusion = trialSummary(row, query).exclusions[0];
  assert.equal(exclusion.presentationId, 'retry');
  assert.equal(exclusion.presentationStartMs, 20000);
});

test('issue144: a legacy context cannot make an exact presentation-result match ambiguous', () => {
  const row = fixture();
  const entries = row.features_payload.gaze_analytics.presentations;
  entries.forEach(entry => { entry.attempt = 1; });
  entries[1].presentationId = null;
  row.features_payload.cognitiveResults = [{ blockId: 'b', trialId: 't', stimulusId: '10',
    attempt: 1, presentationId: 'retry', qualityValid: true }];
  const contexts = presentationAttempts(row);
  assert.equal(contexts.find(entry => entry.presentationId === 'retry').attemptStatus, 'accepted');
  assert.equal(contexts.find(entry => entry.presentationId === null).includedInDefault, false);
  assert.equal(buildAoiRows(row, protocol, query)[0].metrics[0].value, 500);
});

test('issue144: 200 shuffled timed presentations retain their own quality and never mutate saved data', () => {
  const row = fixture();
  const template = row.features_payload.gaze_analytics.presentations[0];
  row.features_payload.gaze_analytics.presentations = Array.from({ length: 200 }, (_, index) => ({
    ...template, presentationId: `p-${index}`, attempt: 1, presentationStartMs: index * 1000,
  })).reverse();
  row.features_payload.cognitiveResults = Array.from({ length: 200 }, (_, index) => ({
    blockId: 'b', trialId: 't', stimulusId: 'api:10', attempt: 1,
    presentationId: `p-${index}`, onsetMs: index * 1000, qualityValid: index % 3 !== 0,
  })).filter((_, index) => index % 5 !== 0).reverse();
  const before = JSON.stringify(row);
  const contexts = presentationAttempts(row);
  assert.equal(contexts.length, 200);
  contexts.forEach((entry, index) => {
    assert.equal(entry.presentationId, `p-${index}`);
    assert.equal(entry.attemptStatus, index % 5 === 0 ? 'incomplete' : index % 3 === 0 ? 'excluded' : 'accepted');
    assert.equal(entry.includedInDefault, index % 5 !== 0 && index % 3 !== 0);
  });
  const included = contexts.filter(entry => entry.includedInDefault).length;
  assert.equal(buildAoiRows(row, protocol, query)[0].metrics[0].value, included * 500);
  assert.equal(JSON.stringify(row), before);
});

test('issue144: the first unfinished presentation stays out of default metrics before any result exists', () => {
  const row = fixture();
  row.features_payload.cognitiveResults = [];
  row.features_payload.gaze_analytics.presentations = [row.features_payload.gaze_analytics.presentations[1]];
  row.features_payload.experimentMeta = { presentationSequence: 1 };
  const entry = presentationAttempts(row)[0];
  assert.equal(entry.attemptStatus, 'incomplete');
  assert.equal(entry.includedInDefault, false);
  assert.equal(buildAoiRows(row, protocol, query)[0].metrics[0].value, null);
});

test('issue144: legacy presentations without result tracking remain explicitly unknown', () => {
  const row = fixture();
  row.features_payload.cognitiveResults = [];
  const entries = presentationAttempts(row);
  assert.ok(entries.every(entry => entry.attemptStatus === 'unknown' && entry.includedInDefault));
});

test('issue144: a stored reload invalidation survives analytics even without gaze samples', () => {
  for (const gazeMissing of [false, true]) {
    const row = fixture();
    Object.assign(row.features_payload.cognitiveResults[0], { qualityIssueCodes: [], invalidationReason: 'page_reloaded' });
    if (gazeMissing) row.features_payload.gaze_analytics.presentations = [];
    const rejected = presentationAttempts(row).find(entry => entry.attempt === 1);
    assert.deepEqual(rejected.qualityIssueCodes, ['page_reloaded']);
    assert.match(rejected.qualityReasons[0].label.en, /reload/i);
    assert.equal(trialSummary(row, query).exclusions[0].reasonCode, 'page_reloaded');
    assert.equal(row.features_payload.cognitiveResults[0].qualityIssueCodes.length, 0);
  }
});

test('issue144: an unknown invalidation message is not promoted into exported reasons', () => {
  const row = fixture();
  Object.assign(row.features_payload.cognitiveResults[0], { qualityIssueCodes: [], invalidationReason: 'private-message-/secret/path' });
  const summary = trialSummary(row, query);
  assert.equal(summary.exclusions[0].reasonCode, 'quality_invalid');
  assert.ok(!JSON.stringify(summary).includes('private-message'));
});

test('issue144: condition filters agree across counts, task metrics, AOI, heatmaps and export', () => {
  const row = fixture();
  row.features_payload.cognitiveResults.forEach((result, index) => Object.assign(result, {
    qualityValid: true, condition: index === 0 ? 'selected' : 'other', rt: index === 0 ? 200 : 800,
  }));
  const selectedQuery = { ...query, metricIds: [...query.metricIds, 'task.rt_mean_ms'],
    filters: { ...query.filters, conditionIds: ['selected'] } };
  assert.deepEqual(trialSummary(row, selectedQuery).counts, { valid: 1, excluded: 0, total: 1 });
  assert.equal(buildSessionMetrics(row, selectedQuery)[0].value, 200);
  assert.equal(buildAoiRows(row, protocol, selectedQuery)[0].metrics[0].value, 200);
  assert.equal(buildHeatmapData(row, selectedQuery).nFixations, 1);
  const groupQuery = { ...selectedQuery, mode: 'group' };
  const groupDwell = buildGroupSummary([row], groupQuery, protocol).metrics.find(metric => metric.metricId === 'aoi.dwell_time_ms');
  assert.equal(groupDwell.median, 200);
  assert.equal(buildGroupHeatmap([row], groupQuery).nFixations, 1);
  const bundle = buildExportBundle({ protocol, sessionRows: [row], snapshot: {
    queryEcho: selectedQuery, includedParticipantIds: ['synthetic'], includedSessionIds: [1], versions: {}, excludedSessions: [],
  } });
  assert.deepEqual(bundle.summary.session.presentations.map(entry => entry.presentationId), ['first']);
  assert.deepEqual(bundle.longData.filter(entry => entry.sourceKind === 'session_aoi').map(entry => entry.scope.presentationId), ['first', 'first']);
});

test('issue144: export respects block, stimulus and AOI filters without narrowing the full visual overview', () => {
  const row = fixture();
  const other = { ...row.features_payload.gaze_analytics.presentations[0], blockId: 'other-block',
    stimulusId: '11', presentationId: 'other-presentation' };
  row.features_payload.gaze_analytics.presentations.push(other);
  const otherAoi = { ...protocol.definition.blocks[0].blockConfig.aoiDefinitions['10'][0], id: 'other-aoi' };
  const multiProtocol = { definition: { blocks: [
    { ...protocol.definition.blocks[0], blockConfig: { aoiDefinitions: { '10': [
      ...protocol.definition.blocks[0].blockConfig.aoiDefinitions['10'], otherAoi,
    ] } } },
    { id: 'other-block', blockConfig: { aoiDefinitions: { '11': [otherAoi] } } },
  ] } };
  const selectedQuery = { ...query, filters: { ...query.filters, blockIds: ['b'], stimulusIds: ['10'], aoiIds: ['target'] } };
  assert.equal(buildSessionVisuals(row, multiProtocol, selectedQuery).length, 3);
  const bundle = buildExportBundle({ protocol: multiProtocol, sessionRows: [row], snapshot: {
    queryEcho: selectedQuery, includedParticipantIds: ['synthetic'], includedSessionIds: [1], versions: {}, excludedSessions: [],
  } });
  assert.equal(bundle.longData.length, 4);
  assert.ok(bundle.longData.every(entry => entry.scope.blockId === 'b' && entry.scope.stimulusId === '10' && entry.scope.aoiId === 'target'));
  const csv = exportCsv(bundle);
  assert.doesNotMatch(csv, /other-block|other-presentation|other-aoi/);
});

test('issue144: explicit presentation IDs separate repeated timed trials within one block attempt', async () => {
  const { pathToFileURL } = require('node:url');
  const path = require('node:path');
  const { createHeatmapAccumulator } = await import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/web-page/heatmap.js')).href);
  const accumulator = createHeatmapAccumulator({ gridWidth: 2, gridHeight: 2 });
  const add = (presentationId, first) => {
    for (let n = 0; n < 5; n++) accumulator.add({ blockId: 'b', trialId: 't', stimulusId: '10', attempt: 1,
      presentationId, phase: 'cognitive_stimulus', t: first + n * 50, tRelMs: first + n * 50,
      correctedX: 50, correctedY: 50, screenWidth: 100, screenHeight: 100, onScreen: true,
      valid: true, confidence: .9, stimulusRect: { left: 0, top: 0, width: 100, height: 100 } });
  };
  add('first', 1000); add('second', 5000);
  const saved = accumulator.snapshot();
  const restored = createHeatmapAccumulator({}, saved).finalize().perStimulus;
  assert.equal(restored.length, 2);
  assert.deepEqual(restored.map(entry => entry.presentationId), ['first', 'second']);
  assert.ok(restored.every(entry => entry.validObservationDurationMs < 300));
});

test('issue144: optional presentation timing rejects malformed values without echoing input', () => {
  const { validateGazePresentationTiming } = require('../security/gaze-validation');
  for (const value of [undefined, null, 0, 123.4]) assert.deepEqual(validateGazePresentationTiming({ presentations: [{ presentationStartMs: value }] }), []);
  for (const value of ['private-fixture', {}, -1, Infinity]) {
    const errors = validateGazePresentationTiming({ presentations: [{ presentationStartMs: value }] });
    assert.equal(errors.length, 1); assert.ok(!JSON.stringify(errors).includes('private-fixture'));
  }
});

test('issue144: a late frame cannot enter another presentation of the same logical trial', async () => {
  const { pathToFileURL } = require('node:url'); const path = require('node:path');
  const { SessionFramePipeline } = await import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/session-runtime/frame-pipeline.js')).href);
  let release, scheduled = 0;
  const state = { sessionData: {}, runtime: { taskContext: { blockId: 'b', trialId: 't', presentationId: 'first' },
    localAnalyzer: { analyzeFrame: () => new Promise(resolve => { release = resolve; }) } } };
  const pipeline = new SessionFramePipeline({ state, video: { readyState: 2, currentTime: 1 }, controller: { featureFlags: {} } });
  pipeline.active = true; pipeline._schedule = () => { scheduled++; };
  const pending = pipeline._tick(); state.runtime.taskContext.presentationId = 'second';
  release({ timestamp: 1000 }); await pending; pipeline.active = false;
  assert.equal(pipeline.diagnostics.contextBoundaryFrames, 1);
  assert.equal(state.runtime.lastPrecheckResult, undefined);
  assert.equal(scheduled, 1);
});
