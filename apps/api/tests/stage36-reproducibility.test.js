const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { buildReproducibilityExport, reproducibilityCsv } = require('../export/reproducibility');
const { build: assess } = require('../../shared/metric-quality');
const { validateSessionFeaturePayload } = require('../security/payload-policy');

test('the dataset digest covers the final selection and is retained in the CSV manifest', () => {
  const selection = { projectId: 1, protocolId: 2, protocolVersion: 'publication:2',
    dateFrom: null, dateTo: null, sessionDbId: 3, filterSemantics: 'explicit_selection_not_analytics_snapshot' };
  const options = { pseudonymKey: 'synthetic-reproducibility-key', selection };
  const bundle = buildReproducibilityExport([], options);
  const { datasetSha256, ...data } = JSON.parse(JSON.stringify(bundle));
  assert.equal(datasetSha256, createHash('sha256').update(JSON.stringify(data)).digest('hex'));
  assert.deepEqual(bundle.selection, selection);
  const csv = reproducibilityCsv(bundle);
  assert.ok(csv.includes(datasetSha256));
  assert.ok(csv.includes('""protocolVersion"":""publication:2""'));
  const changed = buildReproducibilityExport([], { ...options, selection: { ...selection, protocolVersion: 'publication:3' } });
  assert.notEqual(changed.datasetSha256, datasetSha256);
  assert.equal(buildReproducibilityExport([], options).datasetSha256, datasetSha256);
  assert.throws(() => buildReproducibilityExport([], { ...options, limits: { sessions: 50, sourceBytes: 100,
    rows: 25000, outputBytes: Buffer.byteLength(JSON.stringify(bundle)) - 1 } }), error => error.status === 413);
});

test('a legacy recording without lifecycle is unknown, not a confirmed incomplete recording', () => {
  for (const [status, value] of [[undefined, null], [null, null], ['future', null],
    ['completed', true], ['in_progress', false], ['failed', false]]) {
    const bundle = buildReproducibilityExport([{ id: 1, session_id: 'synthetic-legacy', project_id: 1,
      features_payload: { ...(status === undefined ? {} : { lifecycle: { status } }) } }],
    { pseudonymKey: 'synthetic-reproducibility-key' });
    const recording = bundle.rows.find(row => row.metric === 'recording.completed');
    assert.equal(recording.value, value);
    assert.equal(recording.missing_reason, value === null ? 'recording_status_not_recorded' : null);
  }
});

test('recording integrity, observation availability and measurement suitability are independent', () => {
  const assessment = assess({ lifecycle: { status: 'completed' }, qcSummary: { overallPass: true },
    gaze_analytics: { summary: { validFraction: 0, sampleCountValid: 0 } }, emotion_summary: { n: 10 },
    rt_alignment: { trialCountTotal: 201, trials: new Array(200), truncated: true } }, { serverAcknowledged: true });
  assert.equal(assessment.recordingIntegrity.status, 'complete');
  assert.equal(assessment.recordingIntegrity.storage, 'server_acknowledged');
  assert.equal(assessment.protocolQuality, 'passed');
  assert.equal(assessment.signals.find(row => row.channel === 'gaze').status, 'missing');
  assert.equal(assessment.suitability.find(row => row.channel === 'facial_expression').status, 'research_only');
  assert.equal(assessment.independentlyValidated, false);
  assert.equal(assessment.limits.find(row => row.code === 'rt_alignment_limit').truncated, true);
  assert.equal(assess({ lifecycle: { status: 'completed' }, experimentMeta: { storageRecovery: { signalSeriesIncomplete: true } } }).recordingIntegrity.status, 'partial');
});

test('closed nested module schemas reject unknown content and forged assessment properties', () => {
  const valid = { schemaVersion: 'session_feature.v1', ids: { session: 'synthetic' }, events: [],
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' },
    quality_assessment: assess() };
  assert.deepEqual(validateSessionFeaturePayload(valid), []);
  for (const patch of [{ meta: { tech: { notes: 'unexpected private metadata' } } },
    { quality_assessment: { ...valid.quality_assessment, independentlyValidated: true } },
    { precheck: { signal: 'data:image/png;base64,AAAA' } },
    { experimentMeta: { presentationPlan: { seed: 10, embedded: 'unexpected' } } }]) {
    assert.ok(validateSessionFeaturePayload({ ...valid, ...patch }).length > 0);
  }
});

test('planned order and interval draws survive reload without guessing older schedules', async () => {
  const { createPresentationPlan, restorePresentationPlan, createPresentationRecord, presentationWindow } =
    await import('../../participant-web/js/session-runtime/presentation-plan.mjs');
  const blocks = [{ id: 'test', type: 'cognitive_task', blockConfig: { randomize: true, fixation: { duration: 500 },
    randomInterStimulus: true, interStimulusMinMs: 100, interStimulusMaxMs: 300 },
  trials: Array.from({ length: 12 }, (_, index) => ({ id: `trial-${index}`, stimulus: { stimulusId: `shape-${index}` } })) }];
  const plan = createPresentationPlan({ blocks, seed: 2026 });
  assert.deepEqual(plan, createPresentationPlan({ blocks, seed: 2026 }));
  assert.notDeepEqual(plan.blocks[0].entries.map(row => row.trialId), blocks[0].trials.map(row => row.id));
  const entry = plan.blocks[0].entries[0];
  const args = { blockId: 'test', planItemId: entry.planItemId, presentationId: 'p1', sequence: 1, attempt: 1,
    epochMs: 1200, perfMs: 200, timeOriginMs: 1000 };
  plan.actual.push(createPresentationRecord(plan, args));
  assert.equal(plan.actual[0].effectiveStimulusDurationMs, null);
  assert.equal(presentationWindow(500, 250, 300), 50);
  assert.equal(presentationWindow(500, 300, 300), 0);
  assert.equal(presentationWindow(500, 250, null), 500);
  const restored = JSON.parse(JSON.stringify(plan));
  assert.equal(restorePresentationPlan(restored, blocks), restored);
  const retry = { ...args, sequence: 2, presentationId: 'p2', attempt: 2 };
  assert.deepEqual(createPresentationRecord(restored, retry), createPresentationRecord(plan, retry));
  assert.throws(() => restorePresentationPlan(restored, [{ ...blocks[0], trials: blocks[0].trials.slice(1) }]), /protocol_mismatch/);
});

test('manual control values agree with independent Python reading JSON and CSV', t => {
  const cases = [
    ['s1', 'a', 'control', [[100, true], [200, true], [999, false]]],
    ['s2', 'a', 'control', [[300, true], [null, true]]],
    ['s3', 'b', 'control', [[400, true]]],
    ['s4', 'c', 'intervention', [[250, true]]]
  ];
  const input = cases.map(([session_id, participant_id, group_id, trials], i) => ({ id: i + 1,
    session_id, participant_id, project_id: 1, protocol_id: 2, group_id,
    features_payload: { cognitiveResults: trials.map(([rt, qualityValid], index) => ({ rt, qualityValid,
      correct: rt != null, response: rt == null ? null : 'Space', presentationId: `p${index}`, trialId: `t${index}`, attempt: 1 })),
    ...(i !== 0 ? {} : { physiology_intervals: { schemaVersion: 'physiology_intervals.v1', throughMs: 120000,
      blocks: [], minutes: [{ startMs: 0, endMs: 60000, heartRate: { count: 2, observedMs: 30000, mean: 82 },
        respiration: { count: 0, observedMs: 0, mean: null } }, { startMs: 60000, endMs: 120000,
        heartRate: { count: 0, observedMs: 0, mean: null }, respiration: { count: 0, observedMs: 0, mean: null } }] } }) } }));
  const bundle = buildReproducibilityExport(input, { pseudonymKey: 'fixture-key-not-for-production' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-golden-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const script = path.resolve(__dirname, '../../../scripts/research/recalculate_export.py');
  for (const [ext, contents] of [['json', JSON.stringify(bundle)], ['csv', reproducibilityCsv(bundle)]]) {
    const filename = path.join(tmp, `golden.${ext}`);
    fs.writeFileSync(filename, contents);
    const result = JSON.parse(execFileSync('python3', [script, filename], { encoding: 'utf8' }));
    // Participant a median 200, participant b median 400; missing/excluded not zeros.
    assert.deepEqual(result.groups, { control: { participants: 2, median_of_participant_medians_ms: 300 },
      intervention: { participants: 1, median_of_participant_medians_ms: 250 } });
    assert.deepEqual(result.physiology.find(row => row.channel === 'heartRate'),
      { session_id: 's1', channel: 'heartRate', minutes: 2, missing_minutes: 1, coverage_fraction: .25 });
  }
});
