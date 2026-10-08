const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { build } = require('../../shared/rt-alignment');
const { validateAlignment, buildConnectedness } = require('../analytics/connectedness');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const { spearman, pairsFor, csv } = require('../../web/connectedness-view');

function session() {
  return {
    events: [
      { type: 'stimulus_on', blockId: 'rt', trialId: 'a', stimulusId: '1', condition: 'go', timestamp: 2000, response_mode: 'keyboard' },
      { type: 'response', blockId: 'rt', trialId: 'a', responded: true, rtMs: 200, timestamp: 2200 },
      { type: 'trial_end', blockId: 'rt', trialId: 'a', qualityValid: true, correct: true, timestamp: 2200 },
      { type: 'stimulus_on', blockId: 'rt', trialId: 'b', stimulusId: '2', condition: 'go', timestamp: 2400, response_mode: 'keyboard' },
      { type: 'trial_end', blockId: 'rt', trialId: 'b', qualityValid: false, correct: false, timestamp: 2700 },
    ],
    cognitiveResults: [{ blockId: 'rt', trialId: 'a', timestamp: 2200, attempt: 2, qualityValid: true }],
    eyeTracking: [
      { t: 1900, valid: true, correctedX: 1, correctedY: 2 },
      { t: 2000, valid: true, correctedX: 1, correctedY: 2 },
      { t: 2100, valid: false, correctedX: 1, correctedY: 2 },
      { t: 2200, valid: true, correctedX: 1, correctedY: 2 },
      { t: 2400, valid: true, correctedX: 1, correctedY: 2 },
    ],
    bodyPoseSamples: [{ t: 2100, valid: true, movementVelocity: 0.1 }],
    emotionSamples: [{ t: 2100, valence: 0, arousal: 0, dataSource: 'landmarks' }],
    bpmRuns: [{ samples: [{ t: 2100, bpm: 80, published: false }] }],
  };
}

test('RT windows use half-open boundaries, valid fractions, attempts and missingness without raw media', () => {
  const data = session(), report = build(data);
  assert.deepEqual(validateAlignment(report), []);
  assert.equal(report.trials.length, 2);
  const trial = report.trials[0];
  assert.equal(trial.attempt, 2);
  assert.equal(trial.rtMs, 200);
  assert.equal(trial.windows.response.channels.gaze.value, 0.5);
  assert.equal(trial.windows.response.channels.gaze.n, 2);
  assert.equal(trial.windows.response.channels.body.value, 0.1);
  assert.equal(trial.windows.post.endMs, 400);
  assert.equal(report.trials[1].windows.baseline.startMs, 200);
  assert.equal(trial.windows.response.channels.bpm.value, null);
  assert.equal(trial.windows.response.channels.valence.value, null);
  assert.equal(report.trials[1].rtMs, null);
  assert.equal(report.trials[1].qualityValid, false);
  assert.equal(report.rawVideoStored, false);
  assert.equal(report.eyeTracking, undefined);
  assert.equal(JSON.stringify(report).includes('correctedX'), false);
});

test('monotonic and wall clocks cannot be mixed, including legacy-only BPM', () => {
  const data = session();
  data.events = data.events.map(event => ({ ...event, monotonicMs: event.timestamp + 10000 }));
  data.eyeTracking = data.eyeTracking.map(sample => ({ ...sample, monotonicMs: sample.t + 10000 }));
  data.bpmRuns[0].samples[0].published = true;
  const report = build(data);
  assert.equal(report.clock, 'monotonic_epoch_ms');
  assert.equal(report.trials[0].windows.response.channels.gaze.value, 0.5);
  assert.equal(report.trials[0].windows.response.channels.bpm.value, null);
  data.bpmRuns[0].samples[0].monotonicMs = 12100;
  assert.equal(build(data).trials[0].windows.response.channels.bpm.value, 80);
});

test('passive, aborted, no-response and repeated trials are not mislabeled as valid responses', () => {
  const data = session();
  data.events[0].response_mode = 'none';
  assert.equal(build(data).trials.length, 1);
  data.events = data.events.slice(3, 4);
  const report = build(data);
  assert.equal(report.trials[0].status, 'incomplete');
  assert.equal(report.trials[0].qualityValid, false);
  assert.equal(report.trials[0].windows.response.channels.gaze.value, null);
});

test('bounded strict ingest contract rejects extra nested fields, invalid numbers and oversized reports', async () => {
  const { buildAggregatesPayload } = await import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/unified-aggregates-new.js')).href);
  const payload = buildAggregatesPayload({ ...session(), ids: { session: 'rt-test' }, lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed', completedAt: '2026-10-08T10:00:00Z', finishAttemptId: 'finish-rt' } }, { forIngest: true });
  // Use canonical typed events, as participant runtime does.
  payload.events = [];
  assert.deepEqual(validateSessionFeaturePayload(payload), []);
  payload.rt_alignment.trials[0].windows.response.channels.gaze.rawLandmarks = [];
  assert.ok(validateSessionFeaturePayload(payload).some(error => error.keyword === 'additionalProperties'));
  delete payload.rt_alignment.trials[0].windows.response.channels.gaze.rawLandmarks;
  payload.rt_alignment.trials[0].rtMs = -1;
  assert.ok(validateSessionFeaturePayload(payload).some(error => error.path.endsWith('/rtMs')));
  payload.rt_alignment.trials = Array(201).fill(payload.rt_alignment.trials[0]);
  assert.ok(validateSessionFeaturePayload(payload).some(error => error.keyword === 'maxItems'));
});

test('server report respects snapshot scope and never substitutes full-session means', () => {
  const row = { id: 1, features_payload: { ...session(), rt_alignment: build(session()), emotion_summary: { valence_mean: 0.6 } } };
  const report = buildConnectedness(row, { filters: { stimulusIds: ['2'] } });
  assert.equal(report.trials.length, 1);
  assert.equal(report.trials[0].stimulusId, '2');
  assert.equal(report.policy.inference, 'not_computed');
  assert.equal(report.policy.videoAvailable, false);
  assert.equal(buildConnectedness({ id: 2, features_payload: { events: session().events } }, {}).source, 'legacy_events_only');
});

test('descriptive Spearman handles ties, missing/incorrect/QC data and CSV formula injection', () => {
  assert.equal(spearman([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]), 1);
  assert.equal(spearman([{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 2 }]), null);
  assert.equal(spearman([{ x: 1, y: 2 }]), null);
  const report = build(session());
  assert.equal(pairsFor(report.trials, 'response', 'gaze').length, 1);
  report.trials[0].trialId = '=HYPERLINK("unsafe")';
  const output = csv({ snapshot: { id: 'safe', datasetHash: 'hash' }, report });
  assert.ok(output.includes('"\'=HYPERLINK'));
  assert.ok(output.includes('maxGapMs'));
  assert.ok(output.includes('"-1000"'));
  assert.equal(output.includes('"\'-1000"'), false);
  assert.ok(output.includes('baselineMs'));
});

test('long sessions flag truncation and malformed local histories cannot crash aggregation', () => {
  const events = Array.from({ length: 220 }, (_, index) => [
    { type: 'stimulus_on', blockId: 'rt', trialId: String(index), timestamp: index * 2000 + 10000, response_mode: 'keyboard' },
    { type: 'trial_end', blockId: 'rt', trialId: String(index), timestamp: index * 2000 + 10500, qualityValid: true }
  ]).flat();
  const report = build({ events, cognitiveResults: [null], bpmRuns: [null, { samples: [null] }] });
  assert.equal(report.trialCountTotal, 220);
  assert.equal(report.trials.length, 200);
  assert.equal(report.truncated, true);
  assert.deepEqual(validateAlignment(report), []);
  assert.ok(JSON.stringify(report).length < 1750 * 1024);
  report.trials[0].windows.response.channels.gaze.nValid = 1;
  assert.ok(validateAlignment(report).some(error => error.keyword === 'consistency'));
});

test('explicit attempt survives delayed result bookkeeping and reversed trial clocks are rejected', () => {
  const data = session();
  data.events[0].attempt = 3;
  data.cognitiveResults[0].timestamp = 2220;
  const report = build(data);
  assert.equal(report.trials[0].attempt, 3);
  assert.deepEqual(validateAlignment(report), []);
  report.trials[0].endMs = report.trials[0].responseMs - 1;
  assert.ok(validateAlignment(report).some(error => error.message === 'Trial timestamps are reversed'));
});

test('published analytics windows use exactly the bounded ingest properties', () => {
  const alignment = require('../../../packages/shared/contracts/rt-alignment.v1.schema.json');
  const response = require('../../web/docs/analytics-contract/analytics-response-v1.schema.json');
  assert.equal(response.$defs.sessionSummary.properties.connectedness.$ref, '#/$defs/connectedness');
  for (const [name, rule] of Object.entries(alignment.properties)) {
    assert.deepEqual(response.$defs.connectedness.properties[name], rule);
  }
  assert.equal(response.$defs.connectedness.additionalProperties, false);
  assert.equal(response.$defs.connectedness.properties.policy.properties.videoAvailable.const, false);
});
