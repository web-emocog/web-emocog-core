const assert = require('node:assert/strict');
const test = require('node:test');
const { validatePhysiologyIntervals } = require('../security/physiology-intervals');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const { intervalData } = require('../analytics/passive');
const { buildSessionMetrics, buildGroupSummary, buildExportBundle } = require('../analytics/metrics');
const { exportCsv } = require('../analytics/v1-router');

const load = () => import('../../participant-web/js/session-runtime/physiology-intervals.mjs');
const heart = bpm => ({ bpm, published: true });
const sample = { ...heart(80), respRate: 15 };
const empty = { mean: null, count: 0, observedMs: 0 };
const metricIds = ['physiology.bpm_mean', 'physiology.respiration_mean'];

test('interval coverage splits at minute boundaries and does not bridge holds, gaps or duplicate frames', async () => {
  const { PhysiologyIntervals } = await load();
  const x = new PhysiologyIntervals();
  x.record(59950, sample, 10000, 20000);
  x.record(60050, sample, 10000, 20000);
  x.record(60050, heart(120), 10000, 20000);
  x.record(60150, { bpm: 120, held: true, published: true, respRate: 15 }, 10000, 20000);
  x.record(60500, heart(100), 10000, 20000);
  x.record(60600, heart(100), 10000, 20000);
  const packet = x.snapshot(125000);
  assert.deepEqual(packet.minutes.map(r => r.heartRate), [
    { mean: 80, count: 1, observedMs: 50 }, { mean: 280 / 3, count: 3, observedMs: 150 }, empty,
  ]);
  assert.deepEqual(packet.minutes[1].respiration, { mean: 15, count: 2, observedMs: 150 });
  assert.deepEqual(validatePhysiologyIntervals(packet), []);
});

test('a snapshot on an exact minute boundary keeps its sample, even after a pause', async () => {
  const { PhysiologyIntervals } = await load();
  const x = new PhysiologyIntervals();
  x.record(60000, sample, 0, 0);
  x.breakContinuity();
  x.record(60000, sample, 0, 0);
  const saved = x.snapshot(60000);
  assert.equal(saved.minutes[1].heartRate.count, 1);
  assert.equal(saved.minutes[1].endMs, 60001);
  assert.deepEqual(validatePhysiologyIntervals(saved), []);
});

test('separate warm-up per channel, repeat identity and checkpoint restore without filling offline time', async () => {
  const { PhysiologyIntervals } = await load();
  const x = new PhysiologyIntervals();
  x.beginBlock({ blockId: 'rt', attempt: 1 }, 1000);
  x.record(10900, sample, 10000, 20000);
  x.record(11000, sample, 10000, 20000);
  x.record(11100, sample, 10000, 20000);
  x.record(21000, sample, 10000, 20000);
  x.record(21100, sample, 10000, 20000);
  const saved = JSON.parse(JSON.stringify(x.snapshot(21200)));
  assert.equal(saved.blocks[0].status, 'in_progress');
  assert.deepEqual(saved.blocks[0].heartRate, { mean: 80, count: 4, observedMs: 200 });
  assert.deepEqual(saved.blocks[0].respiration, { mean: 15, count: 2, observedMs: 100 });
  assert.deepEqual(validatePhysiologyIntervals(saved), []);
  const resumed = new PhysiologyIntervals(saved);
  resumed.beginBlock({ blockId: 'rt', attempt: 2 }, 80000);
  resumed.record(90000, heart(110), 10000, 20000);
  resumed.record(90100, heart(110), 10000, 20000);
  resumed.endBlock('accepted', 95000);
  const final = resumed.snapshot();
  assert.deepEqual(final.blocks.map(r => [r.attempt, r.status, r.endMs]), [
    [1, 'interrupted', 21200], [2, 'accepted', 95000],
  ]);
  assert.equal(final.minutes[0].heartRate.count, 5);
  assert.equal(final.minutes[1].heartRate.observedMs, 100);
  assert.deepEqual(validatePhysiologyIntervals(final), []);
});

test('hour-long interval aggregation does not depend on the retained samples buffer', async () => {
  const { PhysiologyIntervals } = await load();
  const x = new PhysiologyIntervals();
  for (let i = 0; i < 36000; i++) x.record(i * 100, heart(i < 600 ? 60 : 90), 0, 0);
  const packet = x.snapshot(3600000);
  assert.equal(packet.minutes.length, 60);
  assert.equal(packet.minutes[0].heartRate.mean, 60);
  assert.equal(packet.minutes[59].heartRate.mean, 90);
  assert.deepEqual(validatePhysiologyIntervals(packet), []);
  assert.ok(JSON.stringify(packet).length < 12000);
});

test('interval limits bound wire data and make omissions explicit', async () => {
  const { PhysiologyIntervals } = await load();
  const x = new PhysiologyIntervals();
  for (let i = 0; i < 401; i++) {
    x.beginBlock({ blockId: 'a'.repeat(128) }, i * 1000);
    x.endBlock('accepted', i * 1000 + 999);
  }
  const packet = x.snapshot(9 * 60 * 60 * 1000);
  assert.deepEqual([packet.minutes.length, packet.blocks.length, packet.truncated], [480, 400, true]);
  assert.ok(JSON.stringify(packet).length < 250000);
  assert.deepEqual(validatePhysiologyIntervals(packet), []);
});

async function fixture(bpm = 92) {
  const { PhysiologyIntervals } = await load();
  const x = new PhysiologyIntervals();
  x.beginBlock({ blockId: 'rt', attempt: 1 }, 1000);
  x.record(1100, heart(160), 0, 0);
  x.record(1600, heart(160), 0, 0, 750);
  x.record(2100, heart(160), 0, 0, 750);
  x.endBlock('repeat_required', 2200);
  x.beginBlock({ blockId: 'rt', attempt: 2 }, 3000);
  x.record(3100, heart(bpm), 0, 0);
  x.record(3600, heart(bpm), 0, 0, 750);
  x.record(4100, heart(bpm), 0, 0, 750);
  x.endBlock('accepted', 4200);
  x.beginBlock({ blockId: 'rest' }, 60000);
  x.endBlock('accepted', 70000);
  return { id: 1, participant_id: 'person', features_payload: { physiology_intervals: x.snapshot(),
    bpm_summary: { bpmMean: 80, validSampleCount: 10 } } };
}

test('ingest rejects malformed, oversized, out-of-order, duplicate and overlapping data', async () => {
  const data = (await fixture()).features_payload.physiology_intervals;
  const base = { schemaVersion: 'session_feature.v1', ids: { session: 'test-session' },
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed' }, events: [] };
  assert.deepEqual(validateSessionFeaturePayload({ ...base, physiology_intervals: data }), validateSessionFeaturePayload(base));
  for (const corrupt of [
    p => { p.extra = 'metadata'; },
    p => { p.minutes[0].heartRate.mean = 200; },
    p => { p.minutes[0].heartRate.observedMs = 60001; },
    p => { p.minutes[1].heartRate.mean = 0; },
    p => { p.minutes.reverse(); },
    p => { p.blocks[1].attempt = 1; },
    p => { p.blocks[1].startMs = p.blocks[0].startMs; },
    p => { p.blocks[0].status = 'in_progress'; },
    p => { p.blocks = Array(401).fill(p.blocks[0]); },
  ]) {
    const candidate = structuredClone(data);
    corrupt(candidate);
    assert.ok(validateSessionFeaturePayload({ ...base, physiology_intervals: candidate })
      .some(error => error.path.startsWith('/physiology_intervals')));
  }
});

test('block filtering excludes nonaccepted attempts and retains whole-session means unfiltered', async () => {
  const row = await fixture();
  const filtered = buildSessionMetrics(row, { metricIds, filters: { blockIds: ['rt'] } });
  assert.deepEqual(filtered.map(r => [r.value, r.denominator]), [[92, 3], [null, 0]]);
  assert.equal(filtered[0].scope.blockId, 'rt');
  assert.equal(buildSessionMetrics(row, { metricIds, filters: {} })[0].value, 80);
  assert.equal(buildSessionMetrics(row, { metricIds, filters: { blockIds: ['rt'], conditionIds: ['cond'] } })[0].value, null);
  const second = { ...await fixture(110), id: 2 };
  const third = { ...await fixture(60), id: 3, participant_id: 'other' };
  const result = buildGroupSummary([row, second, third], {
    metricIds, filters: { blockIds: ['rt'], qcChannels: [] },
  }).metrics[0];
  assert.deepEqual(result.participantValues.map(p => p.value), [101, 60]);
  assert.equal(result.median, 80.5);
});

test('too little coverage hides the mean without discarding counts or rewriting the stored estimate', async () => {
  const row = await fixture();
  row.features_payload.physiology_intervals.blocks[1].heartRate.observedMs = 999;
  const filtered = intervalData(row, { filters: { blockIds: ['rt'] } });
  assert.deepEqual(filtered.blocks[1].heartRate, { mean: null, count: 3, observedMs: 999 });
  assert.equal(row.features_payload.physiology_intervals.blocks[1].heartRate.mean, 92);
  assert.equal(buildSessionMetrics(row, { metricIds, filters: { blockIds: ['rt'] } })[0].value, null);
});

test('JSON and CSV export carry attempt statuses, intervals, counts, missing values and coverage', async () => {
  const row = await fixture();
  const snapshot = { id: 'snap', datasetHash: 'hash', queryEcho: { mode: 'session', metricIds, filters: { blockIds: ['rt'] } },
    versions: {}, includedParticipantIds: ['person'], includedSessionIds: [1] };
  for (const content of ['summary', 'long', 'both']) {
    const bundle = buildExportBundle({ snapshot, sessionRows: [row], protocol: { definition: { blocks: [] } } }, content);
    if (bundle.summary) assert.deepEqual(bundle.summary.session.physiologyIntervals.minutes, []);
    if (bundle.longData) {
      const rows = bundle.longData.filter(item => item.sourceKind === 'physiology_block');
      assert.deepEqual(rows.map(item => [item.attemptStatus, item.value]), [
        ['repeat_required', 160], ['accepted', 92], ['repeat_required', null], ['accepted', null],
      ]);
    }
    assert.match(exportCsv(bundle), /physiology_block.*intervalStartMs.*coveragePct/);
    assert.doesNotMatch(exportCsv(bundle), /physiology_minute/);
  }
});
