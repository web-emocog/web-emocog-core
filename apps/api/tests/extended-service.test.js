const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan, scopeRows, createRunner } = require('../analytics/extended-service');

test('analysis plans reject unknown nested values, overlapping groups and invalid ranges', () => {
  assert.equal(validatePlan({}).correction, 'holm');
  for (const input of [{ rawRows: [] }, { metricId: 'diagnosis' }, { iterations: 1000000 },
    { slowThresholdMs: NaN }, { slowThresholdMs: 200, fastThresholdMs: 300 },
    { referenceId: 'A', comparisonId: 'A' },
    { referenceParticipantIds: ['one'], comparisonParticipantIds: ['one'] },
    { signalConditions: { signal: ['A'], noise: ['A'] } },
    { surveyScoring: [{ id: 'x', items: [{ questionId: 'q', reverse: true }] }] },
    { familyMetricIds: ['unknown'] }, { levels: Array.from({ length: 9 }, (_, i) => String(i)) },
    { surveyScoring: [{ id: 'x', items: [{ questionId: 'q', extra: true }] }] },
    { repeatVisits: [{ sessionId: 'one', visit: 'A' }, { sessionId: 'one', visit: 'B' }] },
    { repeatVisits: [{ sessionId: 'one', visit: 'invented' }] },
    { surveyScoring: [{ id: 'x', items: [{ questionId: 'q', numericText: true }] }] },
    { surveyScoring: [{ id: 'x', items: [{ questionId: 'q', values: [{ optionId: 'a', value: 1 }, { optionId: 'a', value: 2 }] }] }] },
  ]) assert.throws(() => validatePlan(input), { code: 'analytics_extension_plan_invalid' });
  assert.deepEqual(validatePlan({ surveyScoring: [{ id: 'scale', items: [{ questionId: 'q', reverse: true, min: 1, max: 5 }] }] }).surveyScoring,
    [{ id: 'scale', items: [{ questionId: 'q', reverse: true, min: 1, max: 5 }] }]);
});

test('repeat visit assignment is explicit, bounded and preserves distinct sessions', () => {
  assert.deepEqual(validatePlan({ repeatVisits: [{ sessionId: 'one', visit: 'A' }, { sessionId: 'two', visit: 'B' }] }).repeatVisits,
    [{ sessionId: 'one', visit: 'A' }, { sessionId: 'two', visit: 'B' }]);
  assert.equal(validatePlan({ secondMetricId: 'survey.score.researcher_scale' }).secondMetricId, 'survey.score.researcher_scale');
});

test('scoping never attributes whole-session summaries to one selected block or AOI', () => {
  const source = { id: 1, features_payload: { blink_summary: { blinkCount: 20 }, emotion_summary: { valence_mean: .4 },
    cognitiveResults: [{ blockId: 'A', condition: 'target', stimulusId: '1' }, { blockId: 'B', condition: 'control', stimulusId: '2' }],
    audio_summary: { windows: [{ blockId: 'A' }, { blockId: 'B' }] },
    physiology_intervals: { blocks: [{ blockId: 'A' }, { blockId: 'B' }], minutes: [{}] } } };
  const scoped = scopeRows([source], { blockIds: ['A'] })[0].features_payload;
  assert.equal(scoped.blink_summary, undefined);
  assert.equal(scoped.emotion_summary, undefined);
  assert.equal(scoped.cognitiveResults.length, 1);
  assert.equal(scoped.audio_summary.windows.length, 1);
  assert.equal(scoped.physiology_intervals.blocks.length, 1);
  assert.deepEqual(scoped.physiology_intervals.minutes, []);
  assert.equal(source.features_payload.cognitiveResults.length, 2);
  const aoi = scopeRows([source], { aoiIds: ['target'] })[0].features_payload;
  assert.equal(aoi.cognitiveResults.length, 2); // Only attempt context, not AOI-attributed task metrics.
  assert.deepEqual(aoi.physiology_intervals.blocks, []);
});

test('analysis workers reject oversize or aborted tasks before allocating a worker', async () => {
  const run = createRunner({ maximumBytes: 100 });
  await assert.rejects(run({ rows: Array(101).fill({}) }), { code: 'analytics_extension_dataset_too_large' });
  await assert.rejects(run({ rows: [{ data: 'a'.repeat(200) }] }), { code: 'analytics_extension_dataset_too_large' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run({ rows: [] }, { signal: controller.signal }), { code: 'analytics_extension_cancelled' });
});

test('bounded queue recovers after cancellation and returns only finite versioned results', async () => {
  const run = createRunner({ maxQueue: 1 });
  const controller = new AbortController();
  const input = { rows: [], definition: {}, filters: {}, plan: validatePlan({}), scope: {} };
  const first = run(input, { signal: controller.signal });
  const rejected = assert.rejects(first, { code: 'analytics_extension_cancelled' });
  const second = run({ ...input, scope: { test: 'queued' } });
  await assert.rejects(run({ ...input, scope: { test: 'overflow' } }), { code: 'analytics_extension_busy' });
  controller.abort(); await rejected;
  const data = await second;
  assert.equal(data.schemaVersion, 'analytics-extensions.v1');
  assert.equal(data.modules.length, 40);
  assert.deepEqual(await run({ ...input, scope: { test: 'queued' } }), data);
});
