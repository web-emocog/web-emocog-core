const test = require('node:test');
const assert = require('node:assert/strict');
const { presentationAttempts, trialSummary, trialAttemptDetails } = require('../analytics/attempts');
const { buildAoiRows, buildHeatmapData, buildSessionVisuals, buildExportBundle, buildGroupSummary } = require('../analytics/metrics');
const { buildFeatureReport } = require('../analytics/extended-features');
const { taskObservationDuration } = require('../analytics/task-observations');
const { exportCsv } = require('../analytics/v1-router');

const query = { mode: 'session', metricIds: ['aoi.dwell_time_ms', 'aoi.visit_count', 'aoi.target_reached'],
  filters: { blockIds: [], stimulusIds: [], aoiIds: [], conditionIds: [], qcChannels: ['task', 'gaze'] } };
const rectangle = (id, left, right) => ({ id, name: id, shape: 'rectangle',
  points: [{ x: left, y: 0 }, { x: right, y: 1 }], isTarget: true });
const protocol = { definition: { blocks: [{ id: 'b', blockConfig: { aoiDefinitions: {
  10: [rectangle('whole', 0, 1)] } } }] } };
function fixture() {
  const validTime = { schemaVersion: 'passive_valid_time.v1', targetMs: 2000, acceptedMs: 2000,
    actualMs: 2100, maxDurationMs: 3000, extended: true, limitReached: false,
    acceptedSegments: [{ startMs: 0, endMs: 1000 }, { startMs: 1100, endMs: 2100 }],
    excludedSegments: [{ startMs: 1000, endMs: 1100, reasons: ['head_pose'] }] };
  return { id: 7, session_id: 'synthetic-177', participant_id: 'synthetic', qc_validity: 'valid',
    started_at: new Date(0), stopped_at: new Date(90000), features_payload: {
      cognitiveResults: [{ blockId: 'b', trialId: 't', stimulusId: '10', presentationId: 'p',
        sourceTrialIndex: 3, presentationIndex: 1, attempt: 1, onsetMs: 1000, condition: 'a',
        responseMode: 'none', qualityValid: true, qualityIssueCodes: [], validTime }],
      gaze_analytics: { schemaVersion: 'gaze_analytics.v1', summary: {}, presentations: [
        { blockId: 'b', trialId: 't', stimulusId: '10', presentationId: 'p', attempt: 1,
          presentationStartMs: 1050, validObservationDurationMs: 2000,
          grid: { width: 2, height: 1, values: [99999, 99999] },
          fixationPoints: [
            { x: .25, y: .5, startMs: 50, durationMs: 200, signalConfidence: .9 },
            { x: .5, y: .5, startMs: 900, durationMs: 100 },
            { x: .5, y: .5, startMs: 1000, durationMs: 50 },
            { x: .75, y: .5, startMs: 1050, durationMs: 200, signalConfidence: .7 },
            { x: .5, y: .5, startMs: 2050, durationMs: 100 },
          ] },
      ] },
    } };
}
const trial = row => row.features_payload.cognitiveResults[0];
const gaze = row => row.features_payload.gaze_analytics.presentations[0];
const exportFor = row => buildExportBundle({ protocol, sessionRows: [row], snapshot: {
  id: 'synthetic-snapshot', datasetHash: 'synthetic-hash', queryEcho: query,
  includedParticipantIds: ['synthetic'], includedSessionIds: [7], versions: {}, excludedSessions: [] } });

test('issue177: gaze and grids use only complete fixations within their own accepted interval', () => {
  const row = fixture(), before = structuredClone(row);
  const entry = presentationAttempts(row)[0];
  assert.deepEqual(entry.fixationPoints.map(point => point.startMs), [100, 1100]);
  assert.deepEqual(entry.fixationPoints.map(point => point.acceptedSegmentIndex), [0, 1]);
  assert.deepEqual(entry.grid.values, [200, 200]);
  assert.equal(entry.validObservationDurationMs, 400);
  assert.equal(entry.actualDurationMs, 2100);
  assert.equal(entry.validTime.acceptedMs, 2000);
  assert.equal(buildHeatmapData(row, query).nFixations, 2);
  assert.deepEqual(row, before);
});

test('issue177: a short excluded gap breaks AOI visits rather than joining them', () => {
  const metrics = buildAoiRows(fixture(), protocol, query)[0].metrics;
  assert.equal(metrics.find(metric => metric.metricId === 'aoi.dwell_time_ms').value, 400);
  assert.equal(metrics.find(metric => metric.metricId === 'aoi.visit_count').value, 2);
  assert.ok(metrics.every(metric => metric.observationDurationMs === 400));
  assert.match(metrics[0].algorithm.id, /accepted-time/);
});

test('issue177: extended analytics cannot manufacture a transition across the excluded gap', () => {
  const definition = structuredClone(protocol.definition);
  definition.blocks[0].blockConfig.aoiDefinitions[10] = [rectangle('left', 0, .49), rectangle('right', .51, 1)];
  const report = buildFeatureReport([fixture()], { definition, plan: { axis: 'block' } });
  assert.equal(report.modules.find(module => module.id === 'G3').rows.length, 0);
  const dwell = report.modules.find(module => module.id === 'G1').rows;
  assert.equal(dwell.length, 2);
  assert.ok(dwell.every(row => row.dwellMs === 200));
});

for (const [name, mutate, reason] of [
  ['all fixations excluded', row => { gaze(row).fixationPoints = [gaze(row).fixationPoints[2]]; }, 'valid_time_gaze_missing'],
  ['fixation list missing', row => { delete gaze(row).fixationPoints; }, 'gaze_fixations_truncated'],
  ['fixation list truncated', row => { gaze(row).fixationsTruncated = true; }, 'gaze_fixations_truncated'],
  ['fixation count disagrees', row => { gaze(row).fixationCountTotal = 90; }, 'gaze_fixations_truncated'],
  ['trial onset missing', row => { delete trial(row).onsetMs; }, 'valid_time_alignment_missing'],
  ['gaze origin missing', row => { delete gaze(row).presentationStartMs; }, 'valid_time_alignment_missing'],
  ['invalid fixation clock', row => { gaze(row).fixationPoints[0].startMs = null; }, 'valid_time_fixation_invalid'],
  ['overlapping fixation clocks', row => { gaze(row).fixationPoints.push({ ...gaze(row).fixationPoints[0] }); }, 'valid_time_fixation_invalid'],
]) test(`issue177: ${name} remains missing, not measured zero`, () => {
  const row = fixture(); mutate(row);
  const metric = buildAoiRows(row, protocol, query)[0].metrics[0];
  assert.equal(metric.value, null); assert.equal(metric.observationDurationMs, null); assert.equal(metric.reason, reason);
  const heatmap = buildHeatmapData(row, query);
  assert.equal(heatmap.status, 'no_data'); assert.equal(heatmap.reason, reason);
  assert.equal(heatmap.validObservationDurationMs, null);
  const group = buildGroupSummary([row], { ...query, mode: 'group' }, protocol);
  assert.equal(group.metrics[0].median, null);
});

test('issue177: malformed stored timing fails closed without being silently treated as legacy', () => {
  const row = fixture(); trial(row).validTime.acceptedMs = 1;
  const entry = presentationAttempts(row)[0];
  assert.equal(entry.includedInDefault, false);
  assert.equal(entry.validTimePresent, true);
  assert.equal(entry.validTime, null);
  assert.ok(entry.qualityIssueCodes.includes('valid_time_invalid'));
  assert.deepEqual(trialSummary(row, query).counts, { valid: 0, excluded: 1, total: 1 });
});

test('issue177: physical trial duration never becomes accepted time, session time or instruction time', () => {
  const row = fixture();
  assert.equal(taskObservationDuration(row, [trial(row)]), 2100);
  const details = trialAttemptDetails(row, query)[0];
  assert.equal(details.actualDurationMs, 2100);
  assert.equal(details.validTime.acceptedMs, 2000);
  const exported = exportFor(row).longData.find(entry => entry.sourceKind === 'task_attempt');
  assert.equal(exported.observationDurationMs, 2100);
  assert.equal(exported.status, 'not_applicable');
  assert.equal(exported.value, null);
});

test('issue177: rejected deadline attempts retain reasons, partition and physical jitter in JSON and CSV', () => {
  const row = fixture();
  const failed = structuredClone(trial(row));
  Object.assign(failed, { presentationId: 'failed', attempt: 0, onsetMs: 100, qualityValid: false,
    qualityIssueCodes: ['valid_time_limit_reached'],
    validTime: { ...failed.validTime, acceptedMs: 1000, actualMs: 3027, limitReached: true,
      acceptedSegments: [{ startMs: 0, endMs: 1000 }], excludedSegments: [
        { startMs: 1000, endMs: 3000, reasons: ['fps_low'] },
        { startMs: 3000, endMs: 3027, reasons: ['valid_time_deadline'] }] } });
  row.features_payload.cognitiveResults.unshift(failed);
  row.features_payload.gaze_analytics.presentations.unshift({ ...structuredClone(gaze(row)),
    presentationId: 'failed', attempt: 0, presentationStartMs: 150 });
  const before = structuredClone(row), bundle = exportFor(row);
  const failedRows = bundle.longData.filter(entry => entry.presentationId === 'failed');
  assert.ok(failedRows.length >= 3);
  assert.ok(failedRows.every(entry => entry.actualDurationMs === 3027 && entry.validTimePresent === true));
  assert.ok(failedRows.every(entry => entry.qualityIssueCodes.includes('valid_time_limit_reached')));
  assert.equal(bundle.summary.session.trialAttempts[0].actualDurationMs, 3027);
  assert.deepEqual(bundle.summary.session.trialCounts, { valid: 1, excluded: 1, total: 2 });
  assert.equal(buildAoiRows(row, protocol, query)[0].metrics[0].value, 400);
  assert.match(exportCsv(bundle), /valid_time_deadline/);
  assert.match(exportCsv(bundle), /actualDurationMs.*3027/);
  assert.match(exportCsv(bundle), /Trial 4/);
  assert.deepEqual(row, before);
});

test('issue177: missing gaze still exports validTime presence and actual duration without an AOI', () => {
  const row = fixture(); row.features_payload.gaze_analytics.presentations = [];
  const bundle = exportFor(row);
  assert.equal(bundle.summary.session.trialAttempts[0].actualDurationMs, 2100);
  assert.equal(bundle.summary.session.presentations[0].validTime.acceptedMs, 2000);
  assert.equal(bundle.summary.session.presentations[0].actualDurationMs, 2100);
  const attempts = bundle.longData.filter(entry => entry.sourceKind === 'task_attempt');
  assert.equal(attempts.length, 3);
  assert.ok(attempts.every(entry => entry.validTimePresent === true && entry.actualDurationMs === 2100));
  assert.ok(bundle.longData.filter(entry => entry.sourceKind === 'session_aoi').every(entry => entry.value === null));
});

test('issue177: legacy trials retain their recorded duration and are not opted in by analytics', () => {
  const row = fixture(); delete trial(row).validTime;
  row.features_payload.presentation_plan = { actual: [{ presentationId: 'p', blockId: 'b', trialId: 't',
    stimulusId: '10', attempt: 1, stimulusOnPerfMs: 10000, stimulusOffPerfMs: 11200 }] };
  const entry = presentationAttempts(row)[0];
  assert.equal(entry.validTimePresent, false);
  assert.equal(entry.validTime, null);
  assert.equal(entry.fixationPoints.length, 5);
  assert.equal(taskObservationDuration(row, [trial(row)]), 1200);
  assert.equal(trialAttemptDetails(row, query)[0].actualDurationMs, 1200);
});

test('issue177: condition filtering applies to valid-time export and all trial metadata', () => {
  const row = fixture(), other = structuredClone(trial(row));
  Object.assign(other, { presentationId: 'other', condition: 'b' });
  row.features_payload.cognitiveResults.push(other);
  const selected = { ...query, filters: { ...query.filters, conditionIds: ['a'] } };
  assert.equal(trialAttemptDetails(row, selected).length, 1);
  assert.equal(buildSessionVisuals(row, protocol, selected, { respectFilters: true }).length, 1);
});
