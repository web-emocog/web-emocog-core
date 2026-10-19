const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../../shared/instruction-responses');
const { validateAnalyticsQuery } = require('../analytics/query');
const { buildDescriptiveComparison } = require('../analytics/comparisons');
const { sessionVersion, resolveProtocolVersion } = require('../analytics/protocol-versions');
const { sessionMatchesQuery, datasetFingerprint } = require('../analytics/snapshots');

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

describe('Participant-level descriptive comparisons', () => {
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
