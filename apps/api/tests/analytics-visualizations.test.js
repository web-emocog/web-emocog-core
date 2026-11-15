'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { participantCsv } = require('../analytics/participant-csv');
require('../../web/analytics-visualizations');
const { view } = global.WecogAnalyticsVisualizations;

test('trend preserves measured dots and separates spans across missing measurements', () => {
  const points = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: null }, { x: 3, y: 7 }, { x: 4, y: 9 }];
  const source = { title: 'RT <', unit: 'ms', points, ordered: true, en: true };
  const result = view(source, 'curve', 3);
  assert.equal((result.svg.match(/stroke:#2a8e78/g) || []).length, 2);
  assert.equal((result.svg.match(/<circle/g) || []).length, 4);
  assert.match(result.svg, /RT &lt;/);
  assert.equal(result.count, 3);
  assert.notEqual(result.svg, view(source, 'curve', 1).svg);
  assert.equal(view({ ...source, ordered: false }, 'curve', 3), null);
});

test('histogram and exploratory clusters preserve all finite values and distinguish zero from missing', () => {
  const source = { title: 'Results', en: true, points: [0, 0, 1, 12, 15, null].map((y, x) => ({ x, y })) };
  const histogram = view(source, 'histogram', 4);
  assert.equal(histogram.count, 4);
  assert.equal([...histogram.svg.matchAll(/<title>(\d+)<\/title>/g)].reduce((sum, hit) => sum + Number(hit[1]), 0), 5);
  const clusters = view(source, 'clusters', 2);
  assert.equal(clusters.count, 2);
  assert.equal((clusters.svg.match(/<circle/g) || []).length, 5);
  assert.deepEqual(clusters, view(source, 'clusters', 2));
});

test('participant CSV has readable headings, blank missing estimates and protected aliases', () => {
  const persons = [{ id: '=bad', sessions: [{}, {}], metrics: { 'task.accuracy': .625, 'rt.mean': 0, 'private.secret': 999 } },
    { id: 'Alias', sessions: [{}], metrics: { 'rt.mean': 450, 'physiology.bpm': 0 } }];
  const csv = participantCsv({ participants: persons }, true);
  assert.match(csv, /^\uFEFFParticipant,Sessions in selection,"Mean reaction time, ms","Correct responses, %","Pulse, bpm"/);
  assert.match(csv, /'=bad,2,0,62.5,\r\nAlias,1,450,,0$/);
  assert.doesNotMatch(csv,/999|private|snapshotId/);
});
