const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data/compare-expressions.mjs')));

test('expression comparison uses an independent participant split and counts abstentions, not just correct predictions', async () => {
  const { compareExpressions } = await load();
  const input = { schemaVersion: 'expression-comparison.v1', rows: [
    { subject: 'train', split: 'validation', expected: 'neutral', predictions: {} },
    { subject: 'held-out', split: 'test', expected: 'neutral', predictions: { geometry: 'happiness', blendshapes: 'unknown', combined: 'neutral' } },
    { subject: 'held-out', split: 'test', expected: 'happiness', predictions: { geometry: 'happiness', blendshapes: 'happiness', combined: 'happiness' } }
  ] };
  const report = compareExpressions(input);
  assert.equal(report.n, 2); assert.equal(report.subjects, 1);
  assert.equal(report.methods.geometry.neutralFalsePositiveRate, 1);
  assert.equal(report.methods.blendshapes.missingRate, .5);
  assert.equal(report.methods.combined.accuracy, 1);
  assert.equal(report.methods.combined.macroF1, 1);
  assert.ok(!JSON.stringify(report).includes('held-out'));
  input.rows[0].subject = 'held-out';
  assert.throws(() => compareExpressions(input), /subject_split_leakage/);
});

test('malformed and unlabelled expression benchmarks are rejected', async () => {
  const { compareExpressions } = await load();
  assert.throws(() => compareExpressions({ rows: [] }), /invalid_expression_benchmark/);
  assert.throws(() => compareExpressions({ schemaVersion: 'expression-comparison.v1',
    rows: [{ subject: 'test', split: 'test', expected: 'mood' }] }), /invalid_expression_benchmark_row/);
});
