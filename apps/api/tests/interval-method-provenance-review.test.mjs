import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PhysiologyIntervals } from '../../participant-web/js/session-runtime/physiology-intervals.mjs';
const require = createRequire(import.meta.url);
const { validatePhysiologyIntervals } = require('../security/physiology-intervals');
const { buildSessionMetrics, buildExportBundle } = require('../analytics/metrics');
const { exportCsv } = require('../analytics/v1-router');
const method = 'respiration_luma.log_peak.v2';

test('method provenance belongs to each minute and attempt, including recovery from unversioned history', () => {
  let x = new PhysiologyIntervals();
  x.beginBlock({ blockId: 'old', attempt: 1 }, 0);
  for (const t of [0, 500, 1000]) x.record(t, { bpm: 80, published: true, respRate: 10 }, 0, 0, 750);
  x.endBlock('accepted', 1500);
  x = new PhysiologyIntervals(JSON.parse(JSON.stringify(x.snapshot())));
  x.beginBlock({ blockId: 'new', attempt: 1 }, 2000);
  const fresh = { bpm: 90, published: true, respRate: 20, respConf: .8,
    bpmMethodVersion: 'continuous_signals.v2', respMethodVersion: method };
  for (const t of [2000, 2500, 3000]) x.record(t, fresh, 0, 0, 750);
  x.endBlock('accepted', 3500);
  for (const t of [60000, 60500, 61000]) x.record(t, fresh, 0, 0, 750);
  const data = x.snapshot(61500);
  assert.deepEqual(validatePhysiologyIntervals(data), []);
  assert.equal(data.minutes[0].respiration.methodVersion, 'mixed_methods');
  assert.equal(data.minutes[0].respiration.mean, 15);
  assert.equal(data.minutes[1].respiration.methodVersion, method);
  assert.equal(data.blocks[0].respiration.methodVersion, undefined);
  assert.equal(data.blocks[1].respiration.methodVersion, method);
  assert.deepEqual(new PhysiologyIntervals(JSON.parse(JSON.stringify(data))).snapshot(61500), data);

  const row = { id: 1, participant_id: 'synthetic', features_payload: { physiology_intervals: data,
    respiration_summary: { resp_rate_mean: 16, resp_sample_count: 9, methodVersion: 'respiration_luma.mixed_versions' } } };
  const query = { mode: 'session', metricIds: ['physiology.respiration_mean'], filters: { blockIds: ['new'] } };
  assert.equal(buildSessionMetrics(row, query)[0].algorithm.version, method);
  assert.equal(buildSessionMetrics(row, { ...query, filters: { blockIds: ['old', 'new'] } })[0].algorithm.version, 'mixed_methods');
  const snapshot = { id: 'synthetic-snap', datasetHash: 'synthetic-hash', versions: {},
    queryEcho: { ...query, filters: {} }, includedParticipantIds: ['synthetic'], includedSessionIds: [1] };
  const bundle = buildExportBundle({ snapshot, sessionRows: [row], protocol: { definition: { blocks: [] } } }, 'both');
  const rows = kind => bundle.longData.filter(item => item.sourceKind === kind);
  assert.deepEqual(rows('physiology_block').map(item => item.algorithm.version), ['legacy_summary', method]);
  assert.deepEqual(rows('physiology_minute').map(item => item.algorithm.version), ['mixed_methods', method]);
  assert.match(exportCsv(bundle), /mixed_methods/);
  assert.match(exportCsv(bundle), /respiration_luma\.log_peak\.v2/);

  for (const invalid of [{ methodVersion: 'x'.repeat(65) }, { methodVersion: null }, { rawVideo: 'forbidden' }]) {
    const bad = structuredClone(data); Object.assign(bad.minutes[0].respiration, invalid);
    assert.notDeepEqual(validatePhysiologyIntervals(bad), []);
    if (Object.hasOwn(invalid, 'methodVersion')) assert.throws(() => new PhysiologyIntervals(bad));
  }
});
