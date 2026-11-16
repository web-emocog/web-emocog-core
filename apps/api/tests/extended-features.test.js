'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFeatureReport, LIMITS } = require('../analytics/extended-features');
const moduleOf = (report, id) => report.modules.find(m => m.id === id);
const valueOf = (report, moduleId, metricId) => moduleOf(report, moduleId).metrics.find(m => m.id === metricId)?.value;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const channel = value => ({ mean: value, count: 20, observedMs: 5000, methodVersion: 'test.v1' });
const block = (blockId, startMs, value, status = 'accepted') => ({ blockId, attempt: 1, status,
  startMs, endMs: startMs + 60000, heartRate: channel(value), respiration: channel(12) });
const definition = { blocks: [
  { id: 'base', title: 'Базовый блок' },
  { id: 'task', title: 'Основное задание', blockConfig: { aoiDefinitions: { picture: [
    { id: 'left', name: 'Левая цель', shape: 'rectangle', points: [{ x: 0, y: 0 }, { x: .49, y: 1 }], isTarget: true, order: 1 },
    { id: 'right', name: 'Правая цель', shape: 'rectangle', points: [{ x: .51, y: 0 }, { x: 1, y: 1 }], isTarget: true, order: 2 },
  ] } } },
  { id: 'survey', title: 'Самоотчёт', type: 'survey', content: { questions: [
    { id: 'q1', text: 'Первый вопрос', type: 'single', options: [{ id: 'yes', label: 'Да' }, { id: 'no', label: 'Нет' }] },
    { id: 'q2', text: 'Второй вопрос', type: 'open' },
  ] } },
] };
const plan = { axis: 'block', baselineBlockId: 'base', referenceId: 'base', comparisonId: 'task', metricId: 'physiology.bpm',
  slowThresholdMs: 500, fastThresholdMs: 250, signalConditions: { signal: ['signal'], noise: ['noise'] },
  surveyScoring: [{ id: 'scale', items: [{ questionId: 'q1', min: 1, max: 5, reverse: false },
    { questionId: 'q2', min: 1, max: 5, reverse: true }] }] };
function session(sessionId = 's1', participantId = 'p1') {
  const trial = (i, correct, rt, condition, response) => ({ blockId: 'task', trialId: 't' + i, stimulusId: 'picture',
    presentationId: 'pres' + i, attempt: 1, sourceTrialIndex: i, presentationIndex: i + 1,
    onsetMs: i * 1000, qualityValid: true, correct, rt, condition, response });
  const payload = {
    cognitiveResults: [trial(0, false, 150, 'signal', null), trial(1, true, 300, 'signal', 'Space'),
      trial(2, true, 500, 'signal', 'Space'), trial(3, true, 700, 'signal', 'Space'),
      trial(4, false, 100, 'noise', 'Space'), trial(5, true, null, 'noise', null)],
    gaze_analytics: { schemaVersion: 'gaze_analytics.v1', summary: { presentationsTruncated: false }, presentations: [
      { blockId: 'task', trialId: 't1', stimulusId: 'picture', presentationId: 'pres1', attempt: 1,
        validObservationDurationMs: 1000, grid: { width: 2, height: 1, values: [1, 1] },
        fixationPoints: [{ x: .25, y: .5, startMs: 0, durationMs: 200 }, { x: .75, y: .5, startMs: 250, durationMs: 300 }] },
    ] },
    bpm_summary: { bpmMean: 80, bpmMin: 70, bpmMax: 90, validSampleCount: 100, methodVersion: 'test.v1' },
    respiration_summary: { resp_rate_mean: 12, resp_rate_min: 10, resp_rate_max: 14, resp_sample_count: 40, resp_available: true, methodVersion: 'resp.v1' },
    physiology_intervals: { schemaVersion: 'physiology_intervals.v1', throughMs: 120000, truncated: false,
      minutes: [block('base', 0, 70), block('task', 60000, 90)].map(({ startMs, endMs, heartRate, respiration }) => ({ startMs, endMs, heartRate, respiration })),
      blocks: [block('base', 0, 70), block('task', 60000, 90)] },
    presentation_plan: { schemaVersion: 'presentation_plan.v1', blocks: [{ entries: [{ planItemId: 'item1', stimulusDurationMs: 1000 }] }],
      actual: [{ planItemId: 'item1', blockId: 'task', presentationId: 'pres1', status: 'completed', qualityValid: true,
        stimulusOnPerfMs: 100, stimulusOffPerfMs: 1110, effectiveStimulusDurationMs: 1000 }] },
    blink_summary: { blinkCount: 3, blinkRatePerMin: 6, durationMs: { mean: 120 }, amplitude: { mean: .8 }, incompleteBlinkRate: 10 },
    attentionMetrics: { sampleCounts: { eyeSignals: 100 }, global: { eyeDurationMs: 60000 } },
    body_pose_summary: { enabled: true, validSampleCount: 50, retainedValidSampleCount: 20, movementVelocityMean: .1,
      movementVelocityP95: .3, movementBurstCount: 2, torsoLeanAbsMeanDeg: 4, shoulderRollAbsMeanDeg: 3, shoulderRollSampleCount: 30, version: 'pose.v1' },
    emotion_summary: { n: 30, valence_mean: .2, arousal_mean: .4, methodVersion: 'face.v1' },
    audio_summary: { enabled: true, consentGranted: true, algorithmVersion: 'audio.v1', windows: [
      { blockId: 'task', trialId: 't1', presentationId: 'pres1', attempt: 1, accepted: true, qc: { valid: true },
        sessionStartMs: 1000, sessionEndMs: 2000, biomarkers: { pitch_mean_hz: 150, jitter_local: .02 } },
    ] },
    events: [{ type: 'survey_response', blockId: 'survey', durationMs: 2500,
      responses: [{ questionId: 'q1', responseType: 'single', value: 2 }, { questionId: 'q2', responseType: 'open', value: 4 }] }],
    lifecycle: { status: 'completed' }, meta: { tech: { browser: { family: 'Firefox' }, deviceClass: 'desktop_webcam', measuredFPS: 29 } },
  };
  return { id: sessionId, session_id: sessionId, participant_id: participantId, qc_validity: 'valid',
    started_at: '2026-11-01T10:00:00Z', stopped_at: '2026-11-01T10:02:00Z', features_payload: payload };
}
const reportFor = (rows, patch = {}) => buildFeatureReport(rows, { definition, plan: { ...plan, ...patch } });

test('empty and malformed inputs preserve all 33 feature cards with Russian unavailability', () => {
  for (const rows of [[], null, {}, [null, false, [], {}, { session_id: '<script>' }]]) {
    const report = buildFeatureReport(rows, null);
    assert.equal(report.modules.length, 33);
    assert.equal(new Set(report.modules.map(m => m.id)).size, 33);
    assert.deepEqual(report.participants, []);
    assert.equal(moduleOf(report, 'R3').status, 'needs_configuration');
    assert.equal(moduleOf(report, 'R4').status, 'no_data');
    for (const m of report.modules) {
      assert.match(m.reason, /[А-Яа-я]/u);
      assert.ok(Array.isArray(m.metrics) && Array.isArray(m.rows));
    }
  }
});

test('persisted channels compute feature cards without mutation or inferred per-block summaries', () => {
  const row = session(), before = structuredClone(row), report = reportFor([row]);
  for (const m of report.modules) assert.equal(m.status, 'computed', m.id + ': ' + m.reason);
  close(valueOf(report, 'R1', 'rt.mean'), 500);
  close(valueOf(report, 'R1', 'rt.sd'), 200);
  close(valueOf(report, 'R1', 'rt.cv'), .4);
  close(valueOf(report, 'R2', 'rt.median'), 500);
  close(valueOf(report, 'R5', 'task.accuracy'), 4 / 6);
  assert.equal(report.participants[0].conditions.base['physiology.bpm'], 70);
  assert.equal(report.participants[0].conditions.task['physiology.bpm'], 90);
  assert.equal(report.participants[0].sessions[0].metrics['physiology.bpm'], 80);
  assert.equal(valueOf(report, 'F2', 'physiology.bpm.baselineDelta'), 20);
  assert.equal(moduleOf(report, 'F4').rows[0].continuousRecoveryMs, null);
  assert.equal(valueOf(report, 'A3', 'survey.score.scale'), 4);
  assert.equal(valueOf(report, 'A1', 'audio.pitch'), 150);
  assert.equal(valueOf(report, 'G5', 'gaze.spatialEntropy'), 1);
  assert.deepEqual(row, before);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test('participant estimates and each level use equal session weights, never pooled trial weights', () => {
  const a = session('a', 'p'), b = session('b', 'p'), c = session('c', 'other');
  for (const [row, rt, n] of [[a, 100, 100], [b, 900, 1], [c, 300, 1]]) row.features_payload = {
    cognitiveResults: Array.from({ length: n }, (_, i) => ({ blockId: 'task', condition: 'signal', correct: true, rt, qualityValid: true, trialId: 't' + i })),
  };
  const report = reportFor([a, b, c], { axis: 'condition' });
  assert.equal(report.participants[0].metrics['rt.mean'], 500);
  assert.equal(report.participants[0].conditions.signal['rt.mean'], 500);
  assert.equal(report.participants[0].sessions.length, 2);
  assert.equal(valueOf(report, 'R1', 'rt.mean'), 400);
});

test('explicit slow/fast thresholds use strict inequalities and never assumed cutoffs', () => {
  const report = reportFor([session()]);
  close(valueOf(report, 'R3', 'rt.slowFraction'), 1 / 3);
  close(valueOf(report, 'R3', 'rt.fastFraction'), 0);
  for (const patch of [{ slowThresholdMs: null, fastThresholdMs: null }, { fastThresholdMs: 600 }]) {
    assert.equal(moduleOf(reportFor([session()], patch), 'R3').status, 'needs_configuration');
  }
});

test('raw signal detection counts are integer sums; participant summaries remain session-equal', () => {
  const report = reportFor([session('a'), session('b')]);
  assert.equal(valueOf(report, 'R8', 'hits'), 6);
  assert.equal(valueOf(report, 'R8', 'misses'), 2);
  assert.equal(valueOf(report, 'R8', 'falseAlarms'), 2);
  assert.equal(valueOf(report, 'R8', 'correctRejections'), 2);
  assert.equal(report.participants[0].metrics.hits, 3);
  assert.equal(report.participants[0].sessions[0].metrics.hits, 3);
  assert.equal(moduleOf(reportFor([session()], { signalConditions: { signal: ['signal'], noise: ['signal'] } }), 'R8').status, 'needs_configuration');
});

test('post-error comparison matches neighboring condition/block/attempt and requires both comparison strata', () => {
  const report = reportFor([session()]);
  close(valueOf(report, 'R7', 'rt.postErrorDelta'), -300);
  for (const alter of [
    p => { p.cognitiveResults[1].attempt = 2; },
    p => { p.cognitiveResults[1].condition = 'different'; },
    p => { p.cognitiveResults[1].blockId = 'other'; },
    p => { p.cognitiveResults[1].presentationIndex = 200; },
    p => { p.cognitiveResults[1].qualityValid = false; },
    p => { p.cognitiveResults[0].invalidationReason = 'page_reloaded'; },
    p => { p.events.push({ type: 'session_restored_after_reload' }); },
    p => { p.rt_alignment = { truncated: true }; },
    p => { p.cognitiveResults.forEach(t => { delete t.presentationIndex; }); },
  ]) {
    const row = session(); alter(row.features_payload);
    const m = moduleOf(reportFor([row]), 'R7');
    assert.equal(m.status, 'no_data', alter.toString());
    assert.match(m.reason, /сосед|поряд/u);
  }
});

test('invalid retries and duplicate attempt identities cannot contaminate task/gaze/audio defaults', () => {
  const row = session();
  row.features_payload.cognitiveResults[1].qualityValid = false;
  let report = reportFor([row]);
  assert.equal(moduleOf(report, 'G1').status, 'no_data');
  assert.equal(moduleOf(report, 'A1').status, 'no_data');
  close(valueOf(report, 'R1', 'rt.mean'), 600);
  row.features_payload.cognitiveResults[1].qualityValid = true;
  row.features_payload.cognitiveResults.push({ ...row.features_payload.cognitiveResults[1] });
  report = reportFor([row]);
  close(valueOf(report, 'R1', 'rt.mean'), 600);
  assert.equal(moduleOf(report, 'G1').status, 'no_data');
  assert.equal(moduleOf(report, 'A1').status, 'no_data');
});

test('held, unpublished, rejected, disabled and malformed channel data are excluded', () => {
  const row = session(), p = row.features_payload;
  p.bpm_summary.held = true;
  p.respiration_summary.published = false;
  p.body_pose_summary.enabled = false;
  p.emotion_summary.degraded = true;
  p.blink_summary.status = 'rejected';
  p.audio_summary.windows[0].accepted = false;
  p.physiology_intervals.blocks.forEach(b => { b.heartRate.held = true; b.respiration.published = false; });
  p.physiology_intervals.minutes = [];
  const report = reportFor([row]);
  for (const key of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'A1', 'A2']) assert.equal(moduleOf(report, key).status, 'no_data', key);
  assert.ok(!Object.hasOwn(report.participants[0].metrics, 'physiology.bpm'));
});

test('session summaries cannot become block physiology, trajectories or baseline deltas', () => {
  const row = session(); delete row.features_payload.physiology_intervals;
  const report = reportFor([row]);
  assert.equal(moduleOf(report, 'F1').status, 'computed');
  for (const key of ['F2', 'F3', 'F4']) assert.equal(moduleOf(report, key).status, 'no_data');
  assert.ok(!Object.hasOwn(report.participants[0].conditions.task, 'physiology.bpm'));
});

test('accepted intervals require valid counts, numeric coverage, method compatibility and block status', () => {
  const row = session(), p = row.features_payload;
  p.physiology_intervals.blocks[1].status = 'repeat_required';
  let report = reportFor([row]);
  assert.equal(moduleOf(report, 'F2').status, 'no_data');
  p.physiology_intervals.blocks[1].status = 'accepted';
  p.physiology_intervals.blocks[1].heartRate.methodVersion = 'different.v2';
  p.physiology_intervals.blocks[1].respiration.observedMs = '5000';
  report = reportFor([row]);
  assert.equal(moduleOf(report, 'F2').status, 'no_data');
  assert.equal(moduleOf(report, 'F4').status, 'no_data');
});

test('truncated fixations suppress dwell/transitions/ordered targets, not separately accumulated grids', () => {
  const row = session(); row.features_payload.gaze_analytics.presentations[0].fixationsTruncated = true;
  const report = reportFor([row]);
  for (const key of ['G1', 'G2', 'G3', 'G4']) assert.equal(moduleOf(report, key).status, 'no_data', key);
  assert.equal(moduleOf(report, 'G5').status, 'computed');
  assert.equal(moduleOf(report, 'G6').status, 'computed');
  assert.ok(moduleOf(report, 'Q5').rows.every(r => r.sourceTruncated));
});

test('heatmaps normalize within session and participant and never mix different stimuli/mappings', () => {
  const a = session('a', 'p'), b = session('b', 'p'), c = session('c', 'q');
  a.features_payload.gaze_analytics.presentations[0].grid.values = [100000, 0];
  b.features_payload.gaze_analytics.presentations[0].grid.values = [0, 1];
  c.features_payload.gaze_analytics.presentations[0].grid.values = [0, 100];
  const report = reportFor([a, b, c]);
  const cells = moduleOf(report, 'G6').rows;
  close(cells[0].value, .25); close(cells[1].value, .75);
  assert.equal(cells[0].nParticipants, 2);
});

test('surveys score only explicitly numeric keyed values, reverse correctly and retain missingness', () => {
  const row = session();
  const report = reportFor([row], { metricId: 'rt.mean' });
  assert.equal(valueOf(report, 'A3', 'survey.score.scale'), 4);
  assert.equal(moduleOf(report, 'A5').rows[0].selfReport, 4);
  row.features_payload.events[0].responses[0].value = 'yes';
  const missing = reportFor([row]);
  assert.equal(moduleOf(missing, 'A3').status, 'no_data');
  assert.equal(moduleOf(missing, 'A3').rows[0].missingItems, 1);
  assert.equal(missing.featureRows.find(r => r.metricId === 'survey.score.scale').value, null);
  assert.ok(moduleOf(missing, 'A4').rows.some(r => r.optionId === 'yes'));
  assert.equal(moduleOf(missing, 'A5').status, 'no_data');
  const direct = reportFor([session()], { surveyScoring: [{ id: 'direct', items: [{ questionId: 'q1' }] }] });
  assert.equal(valueOf(direct, 'A3', 'survey.score.direct'), 2);
});

test('duplicate survey submissions/questions and malformed reverse settings never invent scores', () => {
  const row = session(); row.features_payload.events.push(structuredClone(row.features_payload.events[0]));
  assert.equal(moduleOf(reportFor([row]), 'A3').status, 'no_data');
  const bad = reportFor([session()], { surveyScoring: [{ id: 'bad', items: [{ questionId: 'q1', reverse: true }] }] });
  assert.equal(moduleOf(bad, 'A3').status, 'needs_configuration');
  const duplicate = session(); duplicate.features_payload.events[0].responses.push({ questionId: 'q1', value: 3 });
  assert.equal(moduleOf(reportFor([duplicate]), 'A3').status, 'no_data');
});

test('server-owned filters preserve scope and never relabel session-wide means as selected blocks', () => {
  const report = reportFor([session()], { filters: { blockIds: ['task'] } });
  for (const key of ['F1', 'F5', 'F6', 'F7']) assert.equal(moduleOf(report, key).status, 'no_data', key);
  assert.equal(report.participants[0].conditions.task['physiology.bpm'], 90);
  assert.ok(!report.participants[0].conditions.base);
  assert.ok(!Object.hasOwn(report.participants[0].metrics, 'physiology.bpm'));
  const subset = reportFor([session()], { filters: { conditionIds: ['signal'] } });
  assert.equal(moduleOf(subset, 'F3').status, 'no_data');
  assert.equal(valueOf(subset, 'R1', 'rt.mean'), 500);
  const { scopeRows } = require('../analytics/extended-service');
  const condition = reportFor(scopeRows([session()], { conditionIds: ['signal'] }), { filters: { conditionIds: ['signal'] } });
  assert.equal(moduleOf(condition, 'G1').status, 'computed');
  const aoi = reportFor(scopeRows([session()], { aoiIds: ['left'] }), { filters: { aoiIds: ['left'] } });
  assert.equal(moduleOf(aoi, 'R1').status, 'no_data');
  assert.equal(moduleOf(aoi, 'G1').status, 'computed');
  assert.ok(moduleOf(aoi, 'G1').rows.every(row => row.aoiId === 'left'));
});

test('AOI summaries balance repeated sessions and transition totals are complete', () => {
  const rows = [session('a', 'one'), session('b', 'one'), session('c', 'two')];
  [200, 400, 800].forEach((duration, index) => {
    const entry = rows[index].features_payload.gaze_analytics.presentations[0];
    entry.fixationPoints[0].durationMs = duration;
    entry.fixationPoints[1].startMs = duration + 50;
    entry.validObservationDurationMs = duration + 350;
  });
  const report = reportFor(rows);
  close(moduleOf(report, 'G1').rows.find(row => row.aoiId === 'left').dwellMs, 550);
  assert.equal(moduleOf(report, 'G3').rows[0].count, 3);
  assert.equal(moduleOf(report, 'G3').rows[0].nParticipants, 2);
});

test('an impossible fixation duration does not enter AOI summaries or transitions', () => {
  const row = session();
  row.features_payload.gaze_analytics.presentations[0].validObservationDurationMs = 50;
  const report = reportFor([row]);
  for (const id of ['G1', 'G2', 'G3']) assert.equal(moduleOf(report, id).status, 'no_data');
});

test('missing participant keys never fall back to private identity or contribute to group comparisons', () => {
  const row = session(); row.participant_key = null; row.participant_id = 'private-id';
  const report = reportFor([row]);
  assert.deepEqual(report.participants, []);
  assert.equal(report.availability.unidentifiedSessions, 1);
  assert.equal(valueOf(report, 'R1', 'rt.mean'), undefined);
  assert.ok(!JSON.stringify(report).includes('private-id'));
});

test('private text, arbitrary QC errors and unsafe HTML cannot be reflected into report data', () => {
  const row = session(); row.features_payload.meta.user = { email: 'secret@example.org', name: 'Private Person' };
  row.features_payload.events[0].responses.push({ questionId: 'private', responseType: 'open', value: '<script>secret@example.org</script>' });
  row.features_payload.cognitiveResults[0].invalidationReason = '<b>Private Person</b>';
  row.features_payload.meta.tech.userAgent = '<iframe>secret@example.org</iframe>';
  row.features_payload.bpmRuns = [{ samples: [{ bpm: 999, published: false, token: 'super-secret-token' }] }];
  const def = structuredClone(definition); def.blocks[0].title = '<img src=x onerror=alert(1)>';
  const report = buildFeatureReport([row], { definition: def, plan });
  const text = JSON.stringify(report);
  for (const forbidden of ['secret@example.org', 'Private Person', '<script', '<img', '<iframe', 'super-secret-token']) assert.ok(!text.includes(forbidden), forbidden);
  assert.equal(report.options.participants[0].label, 'Участник 1');
  assert.equal(report.options.blocks[0].label, 'Блок 1');
});

test('bounded inputs, output rows and session deduplication are explicit', () => {
  const row = session(); row.features_payload.cognitiveResults = Array.from({ length: LIMITS.trials + 1 }, (_, i) => ({ correct: true, rt: i, blockId: 'task' }));
  const report = reportFor([row, row]);
  assert.equal(report.availability.duplicateSessions, 1);
  assert.equal(report.availability.truncated, true);
  assert.ok(report.availability.truncationReasons.includes('task_trials'));
  assert.ok(report.featureRows.length <= LIMITS.featureRows);
  assert.ok(report.modules.every(m => m.rows.length <= LIMITS.moduleRows));
});

test('malformed numeric fields cannot produce NaN, infinity or coerced numbers', () => {
  const row = session(), p = row.features_payload;
  p.cognitiveResults.forEach(t => { t.rt = '500'; t.correct = 'true'; });
  p.bpm_summary.bpmMean = Infinity; p.respiration_summary.resp_rate_mean = NaN;
  p.physiology_intervals = { schemaVersion: 'physiology_intervals.v1', minutes: [null, false], blocks: [{ heartRate: { mean: '80', count: 20 } }] };
  p.audio_summary.windows[0].biomarkers.pitch_mean_hz = '150';
  const report = reportFor([row]);
  assert.equal(moduleOf(report, 'R1').status, 'no_data');
  assert.equal(moduleOf(report, 'F1').status, 'no_data');
  assert.ok(!Object.hasOwn(report.participants[0].metrics, 'audio.pitch'));
  function inspect(v) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v));
    if (v && typeof v === 'object') Object.values(v).forEach(inspect);
  }
  inspect(report);
});

test('presentation plan compares actual retained duration only, never timestamps or file names', () => {
  const row = session(); row.features_payload.presentation_plan = { schemaVersion: 'presentation_plan.v1',
    blocks: [{ entries: [{ planItemId: 'item1', stimulusDurationMs: 1000 }] }],
    actual: [{ planItemId: 'item1', blockId: 'task', presentationId: 'pres1', status: 'completed', qualityValid: true,
      effectiveStimulusDurationMs: 1000, stimulusOnPerfMs: 100, stimulusOffPerfMs: 1110, stimulusName: '2026-11-01T100000.png' }] };
  const report = reportFor([row]), q4 = moduleOf(report, 'Q4');
  assert.equal(q4.status, 'computed'); assert.equal(q4.rows[0].deltaMs, 10);
  assert.match(q4.reason, /не аппаратная/u);
  assert.ok(!JSON.stringify(report).includes('2026-11-01T100000.png'));
  delete row.features_payload.presentation_plan.actual[0].stimulusOffPerfMs;
  assert.equal(moduleOf(reportFor([row]), 'Q4').status, 'no_data');
});

test('full high-resolution heatmaps are mass-preservingly coarsened, never a clipped prefix', () => {
  const row = session();
  row.features_payload.gaze_analytics.presentations[0].grid = { width: 80, height: 45,
    values: Array.from({ length: 3600 }, (_, i) => i === 3599 ? 1 : 0) };
  const report = reportFor([row]), cells = moduleOf(report, 'G6').rows;
  assert.ok(cells.length <= LIMITS.moduleRows);
  assert.ok(cells.length > 0);
  assert.equal(cells.length, cells[0].gridWidth * cells[0].gridHeight);
  close(cells.reduce((v, r) => v + r.value, 0), 1);
  assert.equal(cells.at(-1).value, 1);
  assert.ok(cells.every(r => r.fullGrid));
});

test('joint availability is a fraction of session/channel cells, not a cognitive score', () => {
  const report = reportFor([session()]);
  assert.equal(valueOf(report, 'Q5', 'channels.available'), 1);
  assert.equal(report.availability.channels.audio.sessions, 1);
  const empty = session(); empty.features_payload = {};
  assert.equal(valueOf(reportFor([empty]), 'Q5', 'channels.available'), 0);
});

test('question options come only from pinned definitions with no guessed ranges or free answers', () => {
  const report = reportFor([session()]);
  const question = report.options.questions.find(q => q.id === 'q1');
  assert.equal(question.label, 'Первый вопрос');
  assert.equal(question.type, 'single');
  assert.equal(question.min, null); assert.equal(question.max, null);
  assert.deepEqual(question.options, [{ id: 'yes', label: 'Да' }, { id: 'no', label: 'Нет' }]);
});

test('repeat metadata separates recorded chronology from actual comparable visit identities', () => {
  const a = session('a'), b = session('b');
  for (const row of [a, b]) { row.publication_version = 2; row.protocol_id = 3; }
  b.started_at = '2026-11-02T10:00:00Z';
  const repeated = reportFor([b, a]).participants[0].sessions;
  assert.deepEqual(repeated.map(s => s.visitIndex), [1, 2]);
  assert.equal(repeated[0].comparableKey, repeated[1].comparableKey);
  assert.ok(repeated.every(s => s.comparable.eligible === false && s.comparable.visit === null));
  assert.equal(repeated[0].publicationSource, 'server_session_row');
  const missing = reportFor([session()]).participants[0].sessions[0];
  assert.equal(missing.comparableKey, null);
  const assigned = reportFor([b, a], { repeatVisits: [{ sessionId: 'a', visit: 'A' }, { sessionId: 'b', visit: 'B' }] }).participants[0].sessions;
  assert.deepEqual(assigned.map(s => s.comparable.visit), ['A', 'B']);
  assert.ok(assigned.every(s => s.comparable.eligible));
});

test('numeric survey text and option scores require explicit bounded researcher rules', () => {
  const row = session();
  row.features_payload.events[0].responses = [{ questionId: 'q1', responseType: 'single', value: 'yes' },
    { questionId: 'q2', responseType: 'open', value: '3,5' }];
  assert.equal(moduleOf(reportFor([row]), 'A3').status, 'no_data');
  const surveyScoring = [{ id: 'scale', items: [
    { questionId: 'q1', values: [{ optionId: 'yes', value: 2 }, { optionId: 'no', value: 0 }] },
    { questionId: 'q2', numericText: true, min: 1, max: 5, reverse: true }] }];
  close(valueOf(reportFor([row], { surveyScoring }), 'A3', 'survey.score.scale'), 4.5);
  for (const value of ['3abc', 'Infinity', '1e309', '999', '', '<script>3</script>']) {
    row.features_payload.events[0].responses[1].value = value;
    assert.equal(moduleOf(reportFor([row], { surveyScoring }), 'A3').status, 'no_data');
  }
});

test('every advertised chart uses supported types and actual flat row fields', () => {
  const report = reportFor([session()]);
  for (const m of report.modules.filter(m => m.chart)) {
    assert.ok(['line', 'bar', 'scatter', 'matrix'].includes(m.chart.type));
    assert.ok(m.rows.every(r => r[m.chart.x] !== undefined && r[m.chart.y] !== undefined), m.id);
    if (m.chart.series) assert.ok(m.rows.every(r => typeof r[m.chart.series] === 'string'), m.id);
  }
});

test('legacy rows retain honest missing timing/configuration and real zero blink counts', () => {
  const row = session(); row.features_payload = { cognitiveResults: [{ correct: true, rt: 400 }],
    blink_summary: { blinkCount: 0, blinkRatePerMin: 0 }, bpm_summary: { bpmMean: 80 } };
  const report = reportFor([row]);
  assert.equal(valueOf(report, 'R1', 'rt.mean'), 400);
  assert.equal(valueOf(report, 'F5', 'blink.count'), 0);
  assert.equal(valueOf(report, 'F1', 'physiology.bpm'), 80);
  for (const key of ['R4', 'R7', 'F2', 'F3', 'F4', 'Q4']) assert.equal(moduleOf(report, key).status, 'no_data', key);
});

test('session filters match database IDs while exported identity remains the public session ID', () => {
  const first = session('public-session-a', 'p1'), second = session('public-session-b', 'p2');
  first.id = 119; second.id = 120;
  const report = reportFor([first, second], { filters: { sessionIds: [119] } });
  assert.equal(report.participants.length, 1);
  assert.equal(report.participants[0].id, 'p1');
  assert(report.featureRows.length > 0);
  assert(report.featureRows.every(row => row.sessionId === 'public-session-a'));
  close(valueOf(report, 'R1', 'rt.mean'), 500);
  assert.equal(reportFor([first, second], { filters: { sessionIds: ['public-session-a'] } }).participants.length, 0);
});
