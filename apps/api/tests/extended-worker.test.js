'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');
const { once } = require('node:events');
const statistics = require('../analytics/extended-statistics');
const { calculate } = require('../analytics/extended-worker');
const { scopeRows, validatePlan } = require('../analytics/extended-service');

const FEATURE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8',
  'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7',
  'A1', 'A2', 'A3', 'A4', 'A5', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'];
const ALL_IDS = [...FEATURE_IDS, 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
const moduleBy = (report, id) => report.modules.find(module => module.id === id);
const value = (report, id, key) => moduleBy(report, id).metrics.find(metric => metric.id === key)?.value;
function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Number.isFinite(actual), `not finite: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function finiteTree(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (value && typeof value === 'object') Object.values(value).forEach(finiteTree);
}
function projection(participants, extra = {}) {
  return { participants, modules: FEATURE_IDS.map(id => ({ id, status: 'no_data', metrics: [], rows: [] })),
    availability: { moduleStatuses: {} }, options: { metrics: [] }, ...extra };
}
// Isolate the feature/statistics boundary without changing require.cache or any
// production files. Numerical routines remain real; features have their own tests.
function projected(report, plan = {}) {
  const sandbox = { module: { exports: {} }, require(id) {
    if (id === 'node:worker_threads') return { parentPort: null };
    if (id === './extended-features') return { buildFeatureReport: () => structuredClone(report) };
    if (id === './extended-statistics') return statistics;
    throw new Error(`Unexpected dependency: ${id}`);
  } };
  const filename = require.resolve('../analytics/extended-worker');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  const result = sandbox.module.exports.calculate({ rows: [], definition: {}, filters: {},
    plan: { axis: 'condition', design: 'paired', metricId: 'rt.mean', seed: 179, iterations: 500, ...plan } });
  finiteTree(result);
  return JSON.parse(JSON.stringify(result));
}
const sleepA = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0, 2];
const sleepB = [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];
const sleepPeople = () => sleepA.map((a, i) => ({ id: `p${i}`, metrics: { 'rt.mean': a },
  conditions: { A: { 'rt.mean': a }, B: { 'rt.mean': sleepB[i] } }, sessions: [] }));
const pairPlan = { referenceId: 'A', comparisonId: 'B' };

test('all 40 feature/statistical IDs survive empty, legacy and missing data with no invented inference', () => {
  for (const rows of [[], [{ session_id: 'legacy', participant_id: 'p', features_payload: {} }]]) {
    const report = calculate({ rows, definition: {}, filters: {}, plan: validatePlan({}) });
    assert.deepEqual(report.modules.map(module => module.id), ALL_IDS);
    for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']) {
      assert.notEqual(moduleBy(report, id).status, 'computed');
      assert.ok(moduleBy(report, id).reason);
    }
    assert.equal(report.inference.unit, 'participant');
    finiteTree(report);
  }
});

test('paired comparison preserves R sleep independent golden, correct effect-size method and finite units', () => {
  const report = projected(projection(sleepPeople()), pairPlan);
  near(value(report, 'S1', 'difference'), 1.58);
  near(value(report, 'S1', 'p'), 0.00283289019738427);
  near(value(report, 'S3', 'lower'), 0.700114236723);
  near(value(report, 'S3', 'upper'), 2.459885763277);
  const s3 = moduleBy(report, 'S3');
  assert.equal(s3.diagnostics.effectSize.method, 'cohen_dz');
  assert.equal(s3.metrics.find(metric => metric.id === 'effect').unit, 'ms');
  assert.equal(s3.metrics.find(metric => metric.id === 'standardized').unit, '');
  assert.equal(moduleBy(report, 'S2').pMethod, 'exact_conditional_sign_permutation');
  assert.equal(moduleBy(report, 'S4').diagnostics.resamplingUnit, 'participant_pair');
});

test('independent different Ns use Welch, separate rows and independently resampled participants', () => {
  const people = [1, 2, 3, 4, 5, 7, 8].map((v, i) => ({ id: String(i), metrics: { 'rt.mean': v } }));
  const report = projected(projection(people), { design: 'independent', referenceParticipantIds: ['0', '1', '2'],
    comparisonParticipantIds: ['3', '4', '5', '6'] });
  const s1 = moduleBy(report, 'S1');
  assert.equal(s1.method, 'welch_t'); assert.equal(s1.diagnostics.nA, 3); assert.equal(s1.diagnostics.nB, 4);
  near(s1.diagnostics.effect, 4);
  assert.equal(s1.rows.length, 7);
  assert.ok(s1.rows.every(row => row.difference === null && (row.reference === null || row.comparison === null)));
  assert.equal(moduleBy(report, 'S4').diagnostics.resamplingUnit, 'participant');
  assert.equal(moduleBy(report, 'S3').diagnostics.effectSize.method, 'cohen_d_pooled_sd');
});

test('overlapping independent people and zero variance cannot masquerade as a computed test', () => {
  const report = projected(projection(sleepPeople()), { design: 'independent',
    referenceParticipantIds: ['p0', 'p1'], comparisonParticipantIds: ['p1', 'p2'] });
  for (const id of ['S1', 'S2', 'S4']) {
    assert.equal(moduleBy(report, id).status, 'no_data');
    assert.equal(moduleBy(report, id).reason, 'independent_groups_overlap');
  }
  const constant = sleepPeople().map(person => ({ ...person, conditions: { A: { 'rt.mean': 1 }, B: { 'rt.mean': 2 } } }));
  const zero = projected(projection(constant), pairPlan);
  assert.equal(moduleBy(zero, 'S1').status, 'no_data');
  assert.equal(value(zero, 'S1', 'p'), null);
  assert.equal(moduleBy(zero, 'S1').reason, 'zero_difference_variation');
  near(value(zero, 'S1', 'difference'), 1);
  assert.equal(value(zero, 'S3', 'lower'), null);
});

test('S5 config is independent from comparison config and honors Pearson/Spearman explicitly', () => {
  const x = [1, 2, 3, 4, 5, 6, 7], y = [10, 9, 2.5, 6, 4, 3, 2];
  const people = x.map((v, i) => ({ id: String(i), metrics: { 'rt.mean': v, 'rt.median': y[i] } }));
  const report = projected(projection(people), { secondMetricId: 'rt.median', method: 'pearson' });
  assert.equal(moduleBy(report, 'S1').status, 'needs_configuration');
  assert.equal(moduleBy(report, 'S5').status, 'computed');
  assert.equal(moduleBy(report, 'S5').method, 'pearson');
  near(value(report, 'S5', 'r'), -0.828503883588428);
  near(value(report, 'S5', 'p'), 0.021280260007523286);
  assert.equal(moduleBy(report, 'S5').metrics[0].unit, '');
  const rank = projected(projection(people), { secondMetricId: 'rt.median' });
  assert.equal(moduleBy(rank, 'S5').method, 'spearman');
  assert.equal(moduleBy(rank, 'S5').pMethod, 'exact_pairing_permutation_absolute_rho');
  const self = projected(projection(people), { secondMetricId: 'rt.mean' });
  assert.equal(moduleBy(self, 'S5').status, 'needs_configuration');
});

test('S5 complete pair exclusions are joint and partial p results do not claim computed inference', () => {
  const people = Array.from({ length: 9 }, (_, i) => ({ id: String(i), metrics: { 'rt.mean': i, 'rt.median': i % 4 } }));
  const partial = projected(projection(people), { secondMetricId: 'rt.median' });
  assert.equal(moduleBy(partial, 'S5').status, 'no_data');
  assert.equal(value(partial, 'S5', 'p'), null);
  assert.equal(moduleBy(partial, 'S5').reason, 'small_n_exact_budget_exceeded');
  people[0].metrics['rt.mean'] = NaN; people[1].metrics['rt.median'] = Infinity;
  const complete = projected(projection(people), { secondMetricId: 'rt.median', method: 'pearson' });
  assert.equal(value(complete, 'S5', 'participants'), 7);
  assert.equal(moduleBy(complete, 'S5').rows.length, 7);
});

test('S6 reads results envelope, retains every missing hypothesis and never shrinks declared family', () => {
  const report = projected(projection(sleepPeople()), { ...pairPlan, correction: 'holm',
    familyMetricIds: ['rt.mean', 'physiology.bpm'] });
  const s6 = moduleBy(report, 'S6');
  assert.equal(s6.rows.length, 2); assert.equal(s6.diagnostics.familySize, 2);
  near(s6.rows[0].pAdjusted, 2 * 0.00283289019738427);
  near(s6.rows[0].effect, 1.58);
  assert.equal(s6.rows[1].p, null); assert.equal(s6.rows[1].pAdjusted, null);
  assert.equal(s6.rows[1].status, 'unavailable');
  assert.equal(value(report, 'S6', 'hypotheses'), 2);
  assert.equal(value(report, 'S6', 'available'), 1);
  assert.equal(s6.status, 'no_data'); assert.ok(s6.reason);
  const all = projected(projection(sleepPeople()), { ...pairPlan, familyMetricIds: ['rt.mean'], correction: 'bh' });
  assert.equal(moduleBy(all, 'S6').status, 'computed');
  near(moduleBy(all, 'S6').rows[0].pAdjusted, 0.00283289019738427);
});

test('S1/S2 multi-level paired Friedman matches published pulse golden and uses complete people', () => {
  const groups = [[72, 96, 88, 92, 74, 76, 82], [120, 120, 132, 120, 101, 96, 112], [76, 95, 104, 96, 84, 72, 76]];
  const people = groups[0].map((_, i) => ({ id: String(i), conditions: Object.fromEntries(
    ['A', 'B', 'C'].map((level, j) => [level, { 'rt.mean': groups[j][i] }])) }));
  people.push({ id: 'incomplete', conditions: { A: { 'rt.mean': 100 }, C: { 'rt.mean': 110 } } });
  const report = projected(projection(people), { levels: ['A', 'B', 'C'], familyMetricIds: ['rt.mean'] });
  for (const id of ['S1', 'S2']) {
    const result = moduleBy(report, id);
    assert.equal(result.method, 'friedman'); assert.equal(result.status, 'computed');
    near(result.diagnostics.statistic, 10.57142857142857);
    near(result.diagnostics.p, 0.005063414171757498);
    assert.equal(result.diagnostics.n, 7); assert.equal(result.diagnostics.selection.missingParticipants, 1);
  }
  assert.equal(value(report, 'S1', 'difference'), undefined);
  assert.equal(moduleBy(report, 'S3').reason, 'omnibus_has_no_pairwise_mean_effect');
  assert.equal(value(report, 'S3', 'effect'), undefined);
  assert.equal(moduleBy(report, 'S4').reason, 'bootstrap_requires_two_levels');
  assert.equal(moduleBy(report, 'S6').rows[0].effect, null);
});

test('independent multi-level Kruskal uses disjoint people and rejects cross-condition reuse', () => {
  const people = ['A', 'B', 'C'].flatMap((level, j) => Array.from({ length: 5 }, (_, i) => ({
    id: `${level}${i}`, conditions: { [level]: { 'rt.mean': j ? 2 : 1 } } })));
  const plan = { design: 'independent', levels: ['A', 'B', 'C'] };
  const report = projected(projection(people), plan);
  assert.equal(moduleBy(report, 'S1').method, 'kruskal_wallis');
  near(value(report, 'S1', 'statistic'), 14); near(value(report, 'S1', 'p'), Math.exp(-7));
  assert.deepEqual(moduleBy(report, 'S1').diagnostics.selection.ns, [5, 5, 5]);
  people[0].conditions.B = { 'rt.mean': 5 };
  const overlap = projected(projection(people), plan);
  assert.equal(moduleBy(overlap, 'S1').status, 'no_data');
  assert.equal(moduleBy(overlap, 'S1').reason, 'independent_levels_overlap_participants');
  assert.equal(value(overlap, 'S1', 'p'), null);
});

test('R8 passes exactly four counters and exposes declared loglinear diagnostics, including no signal class', () => {
  const base = projection([]);
  const r8 = base.modules.find(module => module.id === 'R8');
  r8.status = 'computed';
  r8.metrics = Object.entries({ hits: 8, misses: 2, falseAlarms: 1, correctRejections: 9, observations: 20 })
    .map(([id, value]) => ({ id, value }));
  const report = projected(base);
  near(value(report, 'R8', 'dPrime'), 1.8446621568568151);
  near(value(report, 'R8', 'criterion'), 0.17447248366510543);
  assert.equal(moduleBy(report, 'R8').diagnostics.correctionValue, 0.5);
  assert.ok(moduleBy(report, 'R8').warnings.includes('pooled_trial_weighted_sdt_not_participant_mean_or_inference'));
  r8.metrics.find(metric => metric.id === 'hits').value = 0;
  r8.metrics.find(metric => metric.id === 'misses').value = 0;
  const absent = projected(base);
  assert.equal(value(absent, 'R8', 'dPrime'), null);
  assert.equal(moduleBy(absent, 'R8').diagnostics.reason, 'signal_and_noise_trials_required');
  assert.equal(moduleBy(absent, 'R8').status, 'computed'); // counts, not inferred SDT
});

function repeatedPeople() {
  return [1, 2, 3, 4].map((v, i) => ({ id: String(i), sessions: [
    { sessionId: `${i}-b`, metrics: { 'rt.mean': v + 10 }, comparable: { eligible: true, key: 'same_protocol', visit: 'visit2' } },
    { sessionId: `${i}-a`, metrics: { 'rt.mean': v }, comparable: { eligible: true, key: 'same_protocol', visit: 'visit1' } },
  ] }));
}
test('S7 aligns explicit comparable visit columns without pair configuration; ICC penalizes visit bias', () => {
  const report = projected(projection(repeatedPeople()));
  assert.equal(moduleBy(report, 'S1').status, 'needs_configuration');
  assert.equal(moduleBy(report, 'S7').status, 'computed');
  near(value(report, 'S7', 'icc'), 1 / 31);
  assert.deepEqual(moduleBy(report, 'S7').diagnostics.selection.visits, ['visit1', 'visit2']);
  assert.equal(moduleBy(report, 'S7').rows[0].reference, 1);
  assert.equal(moduleBy(report, 'S7').diagnostics.model, 'two_way_random_effects_absolute_agreement_single_measurement');
});

test('S7 missing visits, duplicates, legacy sessions, retries and incompatible protocols never get compressed', () => {
  const people = repeatedPeople();
  people[0].sessions[0].metrics = {}; // missing visit2 metric, not replaced by a later number
  people[0].sessions.push({ sessionId: 'retry', metrics: { 'rt.mean': 20 }, comparable: { eligible: false, key: 'same_protocol', visit: 'visit2' } });
  const report = projected(projection(people));
  assert.equal(value(report, 'S7', 'participants'), 3); near(value(report, 'S7', 'icc'), 1 / 51);
  assert.equal(moduleBy(report, 'S7').diagnostics.selection.missingParticipants, 1);
  const legacy = repeatedPeople().map(person => ({ ...person, sessions: person.sessions.map(({ comparable, ...session }) => session) }));
  assert.equal(moduleBy(projected(projection(legacy)), 'S7').status, 'needs_configuration');
  const incompatible = repeatedPeople(); incompatible[0].sessions[0].comparable.key = 'another_protocol';
  assert.equal(moduleBy(projected(projection(incompatible)), 'S7').status, 'needs_configuration');
  const duplicates = repeatedPeople(); duplicates[0].sessions.push({ ...duplicates[0].sessions[0], sessionId: 'duplicate-visit' });
  assert.equal(value(projected(projection(duplicates)), 'S7', 'participants'), 3);
  const sameId = repeatedPeople(); sameId[0].sessions[0].sessionId = sameId[0].sessions[1].sessionId;
  assert.equal(value(projected(projection(sameId)), 'S7', 'participants'), 3);
  const threeVisits = repeatedPeople();
  threeVisits[0].sessions.push({ sessionId: 'third', metrics: { 'rt.mean': 20 }, comparable: { eligible: true, key: 'same_protocol', visit: 'visit3' } });
  assert.equal(moduleBy(projected(projection(threeVisits)), 'S7').status, 'needs_configuration');
});

test('worker-level units preserve fractions and ratios with no silent factor of 100', () => {
  const people = sleepPeople().map((person, i) => ({ ...person, conditions: {
    A: { 'task.accuracy': 0.5 + i / 100, 'rt.cv': 0.1 + i / 100 },
    B: { 'task.accuracy': 0.6 + i / 200, 'rt.cv': 0.2 + i / 200 },
  } }));
  for (const [metricId, unit] of [['task.accuracy', 'fraction'], ['rt.cv', 'ratio']]) {
    const report = projected(projection(people), { ...pairPlan, metricId });
    assert.equal(moduleBy(report, 'S1').metrics[0].unit, unit);
    near(value(report, 'S1', 'difference'), 0.0775);
    assert.equal(moduleBy(report, 'S4').metrics[1].unit, unit);
  }
});

test('real projection respects condition/block/AOI subscopes without recovering whole-session summaries', () => {
  const rows = [1, 2, 3, 4].map((v, i) => ({ session_id: `s${i}`, participant_id: `p${i}`,
    features_payload: { cognitiveResults: [
      { blockId: 'A', condition: 'A', correct: true, rt: 100 + v, qualityValid: true },
      { blockId: 'B', condition: 'B', correct: true, rt: 150 + v * 2, qualityValid: true }],
    bpm_summary: { bpmMean: 70 + v, count: 100 }, blink_summary: { blinkCount: 10 } } }));
  const plan = validatePlan({ ...pairPlan, method: 'pearson', secondMetricId: 'task.accuracy' });
  const full = calculate({ rows, definition: {}, plan, filters: {} });
  assert.equal(moduleBy(full, 'S1').status, 'computed');
  for (const filters of [{ blockIds: ['A'] }, { conditionIds: ['A'] }, { aoiIds: ['target'] }]) {
    const report = calculate({ rows: scopeRows(rows, filters), definition: {}, plan, filters });
    assert.equal(moduleBy(report, 'S1').status, 'no_data');
    assert.equal(value(report, 'S1', 'p'), null);
    assert.deepEqual(report.modules.map(module => module.id), ALL_IDS);
    finiteTree(report);
  }
});

test('actual bounded worker posts clone-safe reports and fails closed on malformed input', async t => {
  for (const [workerData, expected] of [[{ rows: [], definition: {}, filters: {}, plan: validatePlan({}) }, true], [null, false]]) {
    const worker = new Worker(require.resolve('../analytics/extended-worker'), { workerData,
      resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 } });
    t.after(() => worker.terminate());
    const [response] = await once(worker, 'message');
    assert.equal(response.ok, expected);
    if (expected) { assert.deepEqual(response.data.modules.map(module => module.id), ALL_IDS); finiteTree(response.data); }
  }
});
