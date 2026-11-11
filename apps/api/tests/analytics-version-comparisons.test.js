const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../../shared/instruction-responses');
const { validateAnalyticsQuery } = require('../analytics/query');
const { buildDescriptiveComparison } = require('../analytics/comparisons');
const { exportCsv } = require('../analytics/v1-router');
const { sessionVersion, resolveProtocolVersion } = require('../analytics/protocol-versions');
const { sessionMatchesQuery, datasetFingerprint, collectProtocolOptions, hydrateSnapshot } = require('../analytics/snapshots');

function query(comparison) {
  return validateAnalyticsQuery({ schemaVersion: '1.0', mode: 'group', analysisLevel: 'level_2', projectId: 1,
    protocolId: 1, protocolVersion: 'publication:1', metricIds: ['task.rt_mean_ms'],
    filters: { qcMode: 'all', qcChannels: ['task'], includeIncompleteSessions: true }, comparison });
}
const paired = { design: 'paired', axis: 'condition', metricId: 'task.rt_mean_ms', referenceId: 'a', comparisonId: 'b' };
const row = (id, trials) => ({ participant_key: id, participant_id: 'alias-' + id, features_payload: { cognitiveResults: trials } });
const trial = (condition, rt, extra = {}) => ({ condition, rt, correct: true, qualityValid: true, ...extra });

describe('Automatic authored response instructions', () => {
  for (const [source, response, expected] of [
    ['When ready, press Space quickly.', 'press D / В', 'When ready, press D / В quickly.'],
    ['Нажмите клавишу Пробел. Смотрите в центр.', 'нажмите клавишу D / В', 'Нажмите клавишу D / В. Смотрите в центр.'],
    ['Press the Up Arrow key now.', 'click the left mouse button', 'Click the left mouse button now.'],
    ['Use {response}.', 'press D / В', 'Use press D / В.'],
    ['Press Start. Describe the space between objects.', 'press D / В', 'Press Start. Describe the space between objects.'],
    ['Press NumpadEnter, then wait.', 'press M / Ь', 'Press M / Ь, then wait.'],
    ['Нажмите клавишу Ю / ..', 'нажмите Enter', 'Нажмите Enter.'],
    ['Press «Space».', 'press D', 'Press D.'],
  ]) it(source, () => assert.equal(render(source, response), expected));
  it('keeps multiple-response mappings outside prose and preserves unrelated content', () => {
    assert.equal(render('Press Space. Watch carefully.', 'press D / В or F / А', { multiple: true, lang: 'en' }), 'Use the response mapping below. Watch carefully.');
    assert.equal(render('No keyboard instruction here.', 'press D'), 'No keyboard instruction here.');
  });
});

describe('Comparison query contract', () => {
  it('keeps both schema designs aligned with server metrics and restricts paired physiology to blocks', () => {
    const { COMPARISON_METRICS } = require('../analytics/query');
    const schema = require('../../web/docs/analytics-contract/analytics-query-v1.schema.json');
    for (const design of ['paired', 'independent']) {
      const rule = schema.$defs.comparison.oneOf.find(item => item.properties?.design?.const === design);
      assert.deepEqual(new Set(rule.properties.metricId.enum), COMPARISON_METRICS);
      if (design === 'paired') assert.equal(rule.then.properties.axis.const, 'block');
    }
  });
  it('rejects malformed comparison fields instead of throwing from string helpers', () => {
    for (const metricId of [1, false, [], {}, { startsWith: 1 }]) {
      assert.equal(query({ ...paired, metricId }).ok, false);
    }
    assert.equal(query({ ...paired, referenceId: { toString: 0 } }).ok, false);
    assert.equal(query({ ...paired, comparisonId: ['b'] }).ok, false);
  });
});

describe('Participant-level descriptive comparisons', () => {
  it('compares physiology only over accepted recorded block intervals and keeps participants equally weighted', () => {
    const signal = mean => ({ mean, count: mean == null ? 0 : 4, observedMs: mean == null ? 0 : 30000 });
    const block = (id, mean, status = 'accepted') => ({ blockId: id, attempt: 1, startMs: 0, endMs: 35000, status,
      heartRate: signal(mean), respiration: signal(mean == null ? null : 12) });
    const session = (id, blocks) => ({ ...row(id, []), features_payload: { physiology_intervals: {
      schemaVersion: 'physiology_intervals.v1', minutes: [], blocks,
    } } });
    const spec = { ...paired, axis: 'block', metricId: 'physiology.bpm_mean' };
    const result = buildDescriptiveComparison([
      session('one', [block('a', 70), block('b', 80), block('b', 170, 'repeat_required')]),
      session('one', [block('a', 80), block('b', 90)]),
      session('two', [block('a', 60), block('b', 80)]),
      session('missing', [block('a', 90)]),
    ], { comparison: spec });
    assert.equal(result.effectUnit, 'bpm');
    assert.equal(result.nParticipants, 2);
    assert.equal(result.effect, 15);
    assert.equal(result.reference.mean, 67.5);
    assert.equal(result.comparison.mean, 82.5);
    assert.equal(result.estimateCi95.lower, null);
    assert.ok(result.warnings.includes('physiology_comparison_descriptive_only'));
    assert.equal(result.excludedParticipants.length, 1);
    const input = { ...query(paired).value, metricIds: [spec.metricId], comparison: spec };
    assert.equal(validateAnalyticsQuery(input).ok, true);
    assert.equal(validateAnalyticsQuery({ ...input, comparison: { ...spec, axis: 'condition' } }).ok, false);
  });
  it('independent physiology summaries use session estimates and retain the correct units', () => {
    const session = (id, mean) => ({ ...row(id, []), features_payload: { respiration_summary: {
      resp_rate_mean: mean, resp_sample_count: 8, resp_available: true,
    } } });
    const result = buildDescriptiveComparison([session('one', 10), session('one', 14), session('two', 18)], {
      comparison: { design: 'independent', metricId: 'physiology.respiration_mean',
        referenceParticipantIds: ['one'], comparisonParticipantIds: ['two'] },
    });
    assert.equal(result.reference.mean, 12);
    assert.equal(result.effect, 6);
    assert.equal(result.effectUnit, 'breaths/min');
    assert.equal(result.nParticipants, 2);
  });
  it('pools repeated sessions, excludes incomplete pairs and invalid/wrong RT, and never invents inference', () => {
    const rows = [row('one', [trial('a', 100), trial('b', 200), trial('b', 999, { correct: false })]),
      row('one', [trial('a', 300), trial('b', 400, { qualityValid: false })]),
      row('two', [trial('a', 300), trial('b', 500)]), row('missing', [trial('a', 50)])];
    const data = buildDescriptiveComparison(rows, { comparison: paired });
    assert.equal(data.reference.mean, 250);
    assert.equal(data.comparison.mean, 350);
    assert.equal(data.effect, 100);
    assert.equal(data.nParticipants, 2);
    assert.equal(data.nObservations, 5);
    assert.equal(data.reference.nObservations, 3);
    assert.equal(data.comparison.nObservations, 2);
    assert.deepEqual(data.pairedDifferences, { mean: 100, median: 100, q1: 50, q3: 150, sd: Math.sqrt(20000) });
    assert.equal(data.excludedParticipants.length, 1);
    assert.equal(data.pValueAdjusted, null);
    assert.equal(data.estimateCi95.lower, null);
  });
  it('gives participants equal weight rather than giving prolific participants more weight', () => {
    const rows = [row('a', Array.from({ length: 100 }, () => trial('a', 100))), row('b', [trial('a', 300)]), row('c', [trial('a', 500)])];
    const spec = { design: 'independent', metricId: 'task.rt_mean_ms', referenceParticipantIds: ['a','b'], comparisonParticipantIds: ['c'] };
    const data = buildDescriptiveComparison(rows, { comparison: spec });
    assert.equal(data.reference.mean, 200);
    assert.equal(data.effect, 300);
    assert.equal(data.nParticipants, 3);
    assert.deepEqual({ q1: data.reference.q1, q3: data.reference.q3, n: data.reference.nObservations }, { q1: 150, q3: 250, n: 101 });
    assert.equal(data.comparison.sd, null);
    assert.equal(data.pairedDifferences, null);
  });
  it('uses the spread of paired differences, with the NIST t critical value for two df', () => {
    const data = buildDescriptiveComparison([10, 20, 30].map((difference, i) =>
      row(String(i + 1), [trial('a', 200 + i * 100), trial('b', 200 + i * 100 + difference)])), { comparison: paired });
    const margin = 4.303 * 10 / Math.sqrt(3);
    assert.equal(data.effect, 20);
    assert.ok(Math.abs(data.estimateCi95.lower - (20 - margin)) < 1e-10);
    assert.ok(Math.abs(data.estimateCi95.upper - (20 + margin)) < 1e-10);
    assert.equal(data.pValueAdjusted, null);
    assert.equal(data.estimateCi95.method, 'paired_t_nist_table_exploratory_v1');
    const csv = exportCsv({ snapshot: { id: 's', datasetHash: 'h', queryEcho: {} },
      dataDictionary: [], counts: { participants: 3, sessions: 3, observations: 6 }, comparison: data });
    assert.equal((csv.match(/^comparison_pair,/gm) || []).length, 3);
    assert.match(csv, /paired_t_nist_table_exploratory_v1/);
  });
  it('uses unequal group variances and keeps tabulated Welch intervals conservative', () => {
    const a = [100, 200, 300], b = [350, 400, 450, 500];
    const rows = [...a, ...b].map((rt, i) => row(String(i), [trial('a', rt)]));
    const data = buildDescriptiveComparison(rows, { comparison: {
      design: 'independent', metricId: 'task.rt_mean_ms', referenceParticipantIds: ['0','1','2'], comparisonParticipantIds: ['3','4','5','6'],
    } });
    const se = Math.sqrt(10000 / 3 + (12500 / 3) / 4);
    assert.equal(data.effect, 225);
    assert.ok(Math.abs(data.estimateCi95.lower - (225 - 3.182 * se)) < 1e-10);
    assert.equal(data.estimateCi95.method, 'welch_t_nist_table_exploratory_v1');
    assert.ok(data.warnings.includes('exploratory_interval_assumptions_not_verified'));
    assert.equal(data.adjustmentMethod, 'not_computed');
  });
  it('uses percentage-point differences and does not turn missing RT into zero', () => {
    const rows = [row('a', [trial('a', null), trial('b', 400, { correct: false })])];
    assert.equal(buildDescriptiveComparison(rows, { comparison: paired }).effect, null);
    assert.equal(buildDescriptiveComparison(rows, { comparison: { ...paired, metricId: 'task.accuracy_pct' } }).effect, -100);
  });
  it('excludes unidentified sessions and unscored accuracy rather than merging aliases or inventing zero', () => {
    const rows = [row('one', [trial('a', 100, { correct: undefined }), trial('b', 200, { correct: undefined })]),
      { ...row(null, [trial('a', 100), trial('b', 200)]), participant_id: 'shared-alias' }];
    const data = buildDescriptiveComparison(rows, { comparison: { ...paired, metricId: 'task.accuracy_pct' } });
    assert.equal(data.effect, null);
    assert.equal(data.nParticipants, 0);
    assert.equal(data.unidentifiedSessionCount, 1);
    assert.ok(data.warnings.includes('sessions_without_participant_id_excluded'));
  });
  it('validates both designs and rejects overlap, irrelevant fields, wrong mode and unsupported metrics', () => {
    assert.equal(query(paired).ok, true);
    const independent = { design: 'independent', metricId: 'task.rt_mean_ms', referenceParticipantIds: ['a'], comparisonParticipantIds: ['b'] };
    assert.equal(query(independent).ok, true);
    assert.equal(query({ ...independent, comparisonParticipantIds: ['a'] }).ok, false);
    assert.equal(query({ ...paired, referenceParticipantIds: ['a'] }).ok, false);
    assert.equal(query({ ...paired, comparisonId: 'a' }).ok, false);
    assert.equal(query({ ...paired, metricId: 'qc.valid_fraction' }).ok, false);
    const valid = query(paired).value;
    assert.equal(validateAnalyticsQuery({ ...valid, mode: 'session', filters: { ...valid.filters, sessionIds: [1] } }).ok, false);
    assert.equal(validateAnalyticsQuery({ ...valid, filters: { ...valid.filters, blockIds: ['hidden-filter'] } }).ok, false);
  });
});

describe('Immutable publication analytics', () => {
  it('never recomputes an old snapshot under a falsely retained backend version', async () => {
    const db = { query: async () => { throw new Error('Stale snapshot must not be hydrated'); } };
    for (const versions of [{ backend: 'analytics-api-1.2.0' }, {}]) {
      await assert.rejects(hydrateSnapshot(db, { versions }), { status: 409, code: 'analytics_snapshot_stale' });
    }
  });
  it('filter choices prefer authored block names and never expose generated IDs as a title', () => {
    const options = collectProtocolOptions({ blocks: [{ id: 'block_1234', label: 'Recovery', type: 'rest' },
      { id: 'block_9999', type: 'cognitive_task' }] });
    assert.equal(options.blocks[0].name_ru, 'Recovery');
    assert.equal(options.blocks[1].name_ru, 'Блок 2');
    assert.equal(options.blocks[1].name_en, 'Block 2');
  });
  it('separates publication, historical invitation, and unverified sessions', () => {
    const q = query(paired).value;
    assert.equal(sessionVersion({ publication_version: 2, invitation_id: 10 }), 'publication:2');
    assert.equal(sessionVersion({ invitation_id: 10 }), 'invitation:10');
    assert.equal(sessionVersion({}), 'legacy');
    assert.deepEqual(sessionMatchesQuery({ publication_version: 1 }, q), []);
    assert.ok(sessionMatchesQuery({ publication_version: 2 }, q).includes('protocol_version_filter'));
    assert.ok(sessionMatchesQuery({}, q).includes('protocol_version_filter'));
    const rtOnly = { publication_version: 1, features_payload: { cognitiveResults: [{ blockId: 'main', stimulusId: 'square' }] } };
    assert.deepEqual(sessionMatchesQuery(rtOnly, { ...q, filters: { ...q.filters, blockIds: ['main'], stimulusIds: ['square'] } }), []);
  });
  it('resolves pinned definitions instead of current drafts and rejects ambiguous format tags', async () => {
    const protocol = { id: 7, definition: { version: 'v2', blocks: [{ id: 'current' }] } };
    const pinned = { version: 'v2', blocks: [{ id: 'old' }] };
    const db = { query: async () => ({ rows: [{ id: 4, protocol_definition: pinned, created_at: new Date(0), publication_version: 1 }] }) };
    assert.deepEqual((await resolveProtocolVersion(db, protocol, 'publication:1')).definition, pinned);
    const legacy = await resolveProtocolVersion(db, protocol, 'legacy');
    assert.deepEqual(legacy.definition.blocks, []);
    await assert.rejects(resolveProtocolVersion(db, protocol, 'publication:9999999999999'), { status: 400 });
    await assert.rejects(resolveProtocolVersion({ query: async () => ({ rows: [{ protocol_definition: pinned }, { protocol_definition: protocol.definition }] }) }, protocol, 'v2'), { status: 409 });
  });
});
