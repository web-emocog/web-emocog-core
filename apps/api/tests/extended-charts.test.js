'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../web/analytics-explorer-charts.js'), 'utf8');
const h = { tr: (_ru, en) => en, num: value => String(value), field: name => name, title: id => 'Chart ' + id };
function browser() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context, { timeout: 1000 });
  return context;
}
const render = browser().window.WecogAnalyticsCharts.render;
const chart = (type, rows, extra = {}) => ({ id: 'S2', chart: { type }, rows, ...extra });
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const tags = (svg, name) => [...svg.matchAll(new RegExp('<' + name + '\\b[^>]*>', 'g'))].map(match => attributes(match[0]));
const marks = svg => tags(svg, 'g').filter(tag => Object.hasOwn(tag, 'data-point'));
const indices = svg => marks(svg).map(mark => Number(mark['data-point']));
function finiteSVG(svg) {
  assert.equal(typeof svg, 'string');
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /class="ab-chart ax-chart"/);
  assert.match(svg, /role="group"/);
  assert.match(svg, /<title>/);
  assert.match(svg, /<desc>/);
  for (const tag of [...svg.matchAll(/<[a-z][^>]*>/g)]) {
    const attrs = attributes(tag[0]);
    for (const name of ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'width', 'height']) {
      if (attrs[name] !== undefined) assert.ok(Number.isFinite(Number(attrs[name])), `${name}=${attrs[name]}`);
    }
    for (const name of ['d', 'viewBox', 'transform', 'style']) {
      if (attrs[name] !== undefined) assert.doesNotMatch(attrs[name], /NaN|Infinity|undefined/);
    }
  }
  for (const mark of marks(svg)) {
    assert.equal(mark.role, 'button');
    assert.equal(mark.tabindex, '0');
    assert.ok(mark['aria-label']);
    assert.ok(['true', 'false'].includes(mark['aria-pressed']));
  }
}
function expectMarks(svg, expected) {
  finiteSVG(svg);
  assert.deepEqual(indices(svg), expected);
}

// Fixtures mirror the public report shapes; no API/database/statistics implementation is a test oracle.
const fixtures = {
  paired: chart('paired', [{ reference: -2, comparison: 3 }, { reference: 0, comparison: 1 }]),
  box: chart('box', [{ reference: 1, comparison: 2 }, { reference: 3, comparison: 4 }]),
  chord: { id: 'G3', chart: { type: 'matrix', x: 'from', y: 'to' }, rows: [
    { blockId: 'b', stimulusId: 's', fromId: 'a', toId: 'b', from: 'AOI A', to: 'AOI B', count: 2 },
    { blockId: 'b', stimulusId: 's', fromId: 'b', toId: 'a', from: 'AOI B', to: 'AOI A', count: 1 }
  ] },
  heatmap: { id: 'G6', chart: { type: 'matrix', x: 'x', y: 'y' }, rows: [
    { blockId: 'b', stimulusId: 's', x: 0, y: 0, value: .25, nParticipants: 3 },
    { blockId: 'b', stimulusId: 's', x: 1, y: 0, value: .75, nParticipants: 3 },
    { blockId: 'b', stimulusId: 's', x: 1, y: 1, value: 0, nParticipants: 3 }
  ] },
  flow: { id: 'Q1', rows: [
    { sessionId: 's1', participantId: 'p1', completed: 1, interrupted: 0, recordedTrials: 10, acceptedTrials: 8 },
    { sessionId: 's2', participantId: 'p1', completed: 0, interrupted: 1, recordedTrials: 3, acceptedTrials: 0 },
    { sessionId: 's3', completed: 0, interrupted: 0 }
  ] },
  matrix: { id: 'Q5', chart: { type: 'matrix', x: 'sessionId', y: 'channel' }, rows: [
    { sessionId: 's1', channel: 'gaze', available: true },
    { sessionId: 's1', channel: 'task', available: false },
    { sessionId: 's2', channel: 'task', available: 1 }
  ] },
  histogram: { id: 'R2', rows: [
    { participantId: 'p1', sessionId: 's1', blockId: null, metricId: 'rt.median', value: 300, label: 'Median RT', unit: 'ms' },
    { participantId: 'p1', sessionId: 's1', blockId: null, metricId: 'rt.q10', value: 210, label: '10th percentile', unit: 'ms' },
    { participantId: 'p1', sessionId: 's1', blockId: null, metricId: 'rt.q25', value: 250, label: '25th percentile', unit: 'ms' },
    { participantId: 'p1', sessionId: 's1', blockId: 'condition-b', metricId: 'rt.median', value: 330, label: 'Median RT', unit: 'ms' },
    { participantId: 'p2', sessionId: 's2', blockId: null, metricId: 'rt.median', value: 400, label: 'Median RT', unit: 'ms' },
    { participantId: 'p2', sessionId: 's2', blockId: null, metricId: 'rt.q90', value: 500, label: '90th percentile', unit: 'ms' }
  ] }
};

test('browser-only API exposes render, without a DOM, CommonJS or server global export', () => {
  const context = browser();
  assert.deepEqual(Object.keys(context.window.WecogAnalyticsCharts), ['render']);
  assert.equal(typeof context.window.WecogAnalyticsCharts.render, 'function');
  const server = vm.createContext({ module: { exports: 'untouched' } });
  vm.runInContext(source, server, { timeout: 1000 });
  assert.equal(server.module.exports, 'untouched');
  assert.equal(server.WecogAnalyticsCharts, undefined);
  assert.doesNotMatch(source, /\beval\s*\(|\bnew Function\b|\.innerHTML\s*=|\brequire\s*\(/);
});

test('empty, null, malformed and unsupported modules allow the generic fallback', () => {
  for (const input of [undefined, null, false, [], {}, { rows: {} }, { rows: 'not rows' },
    chart('paired', []), chart('box', [null, false, [], 0]), chart('line', [{ value: 4 }]),
    { id: 'R2', rows: [{ rt: 100 }] }, { id: 'G3', rows: [{ count: 1 }] },
    { id: 'G6', rows: [{ x: 0, y: 0, value: null }] }, { id: 'Q1', rows: [{ completed: null, interrupted: null }] },
    chart('matrix', [{ value: 1 }])]) assert.equal(render(input, h), null);
  for (const type of ['paired', 'box', 'histogram']) {
    assert.equal(render(chart(type, [{ reference: null, comparison: NaN, value: Infinity }]), h), null);
  }
});

test('every specialized chart is deterministic, accessible and keeps the original row indices', () => {
  for (const [kind, input] of Object.entries(fixtures)) {
    const first = render(input, h, 1);
    finiteSVG(first);
    assert.match(first, new RegExp('data-chart="' + kind + '"'));
    assert.equal(first, render(input, h, 1));
    for (const item of marks(first)) {
      const index = Number(item['data-point']);
      assert.ok(index >= 0 && index < input.rows.length);
      assert.equal(item['aria-pressed'], String(index === 1));
    }
    assert.ok(!first.includes('<foreignObject'));
    assert.ok(!first.includes(' onkeydown='));
  }
});

test('paired lines preserve negative/zero observations and do not bridge missing rows', () => {
  const input = chart('paired', [null, { reference: -2, comparison: 0 }, { reference: null, comparison: 4 },
    { reference: 5, comparison: Infinity }, { reference: NaN, comparison: null }]);
  const svg = render(input, h, 2);
  expectMarks(svg, [1, 2, 3]);
  assert.equal(tags(svg, 'path').filter(tag => tag.class === 'ax-pair-line').length, 1);
  assert.equal(tags(svg, 'circle').length, 4);
  assert.deepEqual(tags(svg, 'circle').map(tag => Number(tag['data-value'])), [-2, 0, 4, 5]);
  assert.match(svg, /is-selected/);
  assert.match(svg, /Missing/);
});

test('R6 label/value columns and units do not treat names as measurements', () => {
  const input = chart('paired', [
    { reference: 'Baseline', comparison: 'Recovery', referenceValue: -10, comparisonValue: 0, unit: 'ms' }
  ], { id: 'R6', chart: { type: 'paired', x: 'reference', y: 'comparison' } });
  const svg = render(input, h);
  expectMarks(svg, [0]);
  assert.match(svg, /Baseline/);
  assert.match(svg, /Recovery/);
  assert.match(svg, /Value \/ ms/);
  assert.deepEqual(tags(svg, 'circle').map(tag => Number(tag['data-value'])), [-10, 0]);
});

test('independent rows are never paired merely by row position', () => {
  const input = chart('paired', [{ reference: 1, comparison: null }, { reference: null, comparison: 8 }]);
  const svg = render(input, h);
  expectMarks(svg, [0, 1]);
  assert.equal(tags(svg, 'path').filter(tag => tag.class === 'ax-pair-line').length, 0);
});

test('boxplot goldens use type-7 quartiles and observed Tukey whiskers, not fences', () => {
  // For ten ordered values: Q1 is at index 2.25, median 4.5, Q3 6.75.
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 100];
  const input = chart('box', values.map(reference => ({ reference, comparison: null })));
  const svg = render(input, h);
  expectMarks(svg, values.map((_, i) => i));
  const summary = tags(svg, 'g').find(tag => tag.class === 'ax-box-summary');
  assert.equal(Number(summary['data-q1']), 2.25);
  assert.equal(Number(summary['data-median']), 4.5);
  assert.equal(Number(summary['data-q3']), 6.75);
  assert.equal(Number(summary['data-low']), 0);
  assert.equal(Number(summary['data-high']), 8);
  assert.deepEqual(marks(svg).filter(mark => mark['data-outlier'] === 'true').map(mark => Number(mark['data-value'])), [100]);
  assert.equal(tags(svg, 'circle').length, values.length);
  assert.match(svg, /Type-7 quantiles/);
});

test('boxplots keep both samples independently, including singleton, tied, negative and missing data', () => {
  const svg = render(chart('box', [{ reference: -5, comparison: 0 }, { reference: -5, comparison: null },
    { reference: null, comparison: NaN }]), h, 1);
  expectMarks(svg, [0, 1, 0]);
  const summaries = tags(svg, 'g').filter(tag => tag.class === 'ax-box-summary');
  assert.deepEqual(summaries.map(summary => Number(summary['data-median'])), [-5, 0]);
  assert.equal(tags(svg, 'circle').length, 3);
  assert.ok(marks(svg).every(mark => mark['data-outlier'] === 'false'));
});

test('boxplots use configured reference/comparison columns and never mutate their samples', () => {
  const rows = Object.freeze([Object.freeze({ a: 9, b: 3 }), Object.freeze({ a: 1, b: 4 })]);
  const input = Object.freeze({ id: 'S2', chart: Object.freeze({ type: 'box', x: 'a', y: 'b' }), rows });
  const svg = render(input, h);
  expectMarks(svg, [0, 1, 0, 1]);
  assert.deepEqual(rows.map(row => row.a), [9, 1]);
  assert.deepEqual(marks(svg).map(mark => mark['data-series']), ['a', 'a', 'b', 'b']);
});

test('chord ribbons preserve directed row counts; width encodes the recorded count', () => {
  const svg = render(fixtures.chord, h);
  expectMarks(svg, [0, 1]);
  assert.deepEqual(marks(svg).map(mark => Number(mark['data-count'])), [2, 1]);
  assert.match(svg, /AOI A -&gt; AOI B/);
  assert.match(svg, /AOI B -&gt; AOI A/);
  assert.equal(tags(svg, 'path').filter(tag => tag.class === 'ax-chord-ribbon').length, 2);
  assert.match(svg, /not participant-balanced/);
  const ribbons = tags(svg, 'path').filter(tag => tag.class === 'ax-chord-ribbon');
  const width = path => Number(/stroke-width:([\d.]+)/.exec(path.style)?.[1]);
  assert.ok(Math.abs(width(ribbons[0]) / width(ribbons[1]) - 2) < .0001);
});

test('chords distinguish IDs with identical labels, self-transitions and prototype-like AOI IDs', () => {
  const input = { id: 'G3', rows: [
    { fromId: '__proto__', toId: 'constructor', from: 'Same', to: 'Same', count: 1 },
    { fromId: 'constructor', toId: 'constructor', from: 'Same', to: 'Same', count: 2 }
  ] };
  expectMarks(render(input, h), [0, 1]);
  for (const count of [-1, 0, null, false, Infinity, NaN, 1.5]) {
    assert.equal(render({ id: 'G3', rows: [{ from: 'A', to: 'B', count }] }, h), null);
  }
});

test('G3 never silently combines different block/stimulus contexts', () => {
  const input = { ...fixtures.chord, rows: [...fixtures.chord.rows,
    { blockId: 'other', stimulusId: 's', fromId: 'a', toId: 'b', from: 'A', to: 'B', count: 999 }] };
  expectMarks(render(input, h), [0, 1]);
});

test('heatmap cells use recorded probabilities, retain zero and do not fill missing locations', () => {
  const svg = render(fixtures.heatmap, h);
  expectMarks(svg, [0, 1, 2]);
  assert.equal(tags(svg, 'rect').length, 3);
  assert.deepEqual(marks(svg).map(mark => Number(mark['data-value'])), [.25, .75, 0]);
  assert.match(svg, /n = 3/);
  assert.match(svg, /Blank = unrecorded; no interpolation/);
  const rects = tags(svg, 'rect');
  assert.equal(rects[2].style.match(/fill-opacity:([^;]+)/)[1], '0');
  assert.ok(Number(rects[1].x) > Number(rects[0].x));
  assert.ok(Number(rects[2].y) > Number(rects[1].y));
  assert.equal(rects[0].width, rects[0].height);
});

test('heatmaps reject invalid densities, unreadable coordinates and ambiguous grids', () => {
  for (const row of [ { x: 0, y: 0, value: -1 }, { x: 0, y: 0, value: 1.1 },
    { x: 0, y: -1, value: .5 }, { x: .5, y: 0, value: .5 }, { x: Infinity, y: 0, value: .5 },
    { x: 0, y: 0, value: true }, { x: 0, y: 0, value: null },
    { x: Number.MAX_SAFE_INTEGER, y: 0, value: .5 } ]) {
    assert.equal(render({ id: 'G6', rows: [row] }, h), null);
  }
  const first = fixtures.heatmap.rows[0];
  assert.equal(render({ id: 'G6', rows: [first, { ...first, value: .5 }] }, h), null);
  expectMarks(render({ id: 'G6', rows: [first, { ...first, blockId: 'other', value: .5 }] }, h), [0]);
});

test('Q1 counts sessions rather than unique participants or invented recruitment stages', () => {
  const svg = render(fixtures.flow, h);
  expectMarks(svg, [0, 1, 2]);
  assert.match(svg, /Completed: 1/);
  assert.match(svg, /Interrupted: 1/);
  assert.match(svg, /Unconfirmed: 1/);
  assert.match(svg, /Accepted \/ recorded trials: 8 \/ 10/);
  assert.match(svg, />3<\/text>/);
  assert.match(svg, /losses before registration are unknown/);
  assert.doesNotMatch(svg, /consented|invited|screened/i);
});

test('Q1 missing flags are not zero, contradictory outcomes and duplicate sessions are not counted', () => {
  for (const row of [{ completed: null, interrupted: 0 }, { completed: 0 },
    { completed: 1, interrupted: 1 }, { completed: -1, interrupted: 0 }]) {
    assert.equal(render({ id: 'Q1', rows: [row] }, h), null);
  }
  const first = fixtures.flow.rows[0];
  assert.equal(render({ id: 'Q1', rows: [first, first] }, h), null);
  expectMarks(render({ id: 'Q1', rows: [null, first, { completed: null, interrupted: null }] }, h), [1]);
});

test('Q5 matrix maps explicit boolean availability, not missingness or other booleans, to 0/1', () => {
  const svg = render(fixtures.matrix, h);
  expectMarks(svg, [0, 1, 2]);
  assert.deepEqual(marks(svg).map(mark => Number(mark['data-value'])), [1, 0, 1]);
  const input = { ...fixtures.matrix, rows: [fixtures.matrix.rows[0], { sessionId: 's2', channel: 'gaze', available: null }] };
  expectMarks(render(input, h), [0]);
  assert.equal(render({ id: 'F1', chart: { type: 'matrix', x: 'x', y: 'y' }, rows: [{ x: 'a', y: 'b', value: false }] }, h), null);
});

test('matrix supports signed values, zeros and prototype-like category values without synthesizing cells', () => {
  const input = { id: 'A1', chart: { type: 'matrix', x: 'column', y: 'row', value: 'measurement', unit: 'Hz' }, rows: [
    { column: '__proto__', row: 'constructor', measurement: -2 },
    { column: 'b', row: 'constructor', measurement: 0 },
    { column: 'b', row: 'prototype', measurement: 3 }
  ] };
  const svg = render(input, h);
  expectMarks(svg, [0, 1, 2]);
  assert.equal(tags(svg, 'rect').length, 3);
  assert.match(svg, /stroke-dasharray:3 2/);
  assert.match(svg, /measurement \/ Hz/);
  assert.equal(render({ ...input, rows: [input.rows[0], input.rows[0]] }, h), null);
});

test('R2 histograms are between-session median distributions, never reconstructed trial histograms', () => {
  const svg = render(fixtures.histogram, h);
  expectMarks(svg, [0, 4]);
  assert.deepEqual(marks(svg).map(mark => Number(mark['data-value'])), [300, 400]);
  assert.equal(tags(svg, 'rect').reduce((sum, bin) => sum + Number(bin['data-count']), 0), 2);
  assert.match(svg, /Distribution of recorded session RT medians, NOT trial-level RT/);
  assert.match(svg, /Median RT \/ ms/);
  assert.doesNotMatch(svg, /10th percentile|25th percentile|90th percentile/);
});

test('R2 respects a chart-selected quantile and takes only the first valid row per session/scope', () => {
  const input = { ...fixtures.histogram, chart: { metricId: 'rt.q10' } };
  expectMarks(render(input, h), [1]);
  assert.match(render(input, h), /session RT quantiles/);
  const original = fixtures.histogram.rows[0];
  const svg = render({ id: 'R2', rows: [{ ...original, value: null }, original, { ...original, value: 330 }] }, h);
  expectMarks(svg, [1]);
  assert.equal(tags(svg, 'rect').reduce((sum, bin) => sum + Number(bin['data-count']), 0), 1);
  assert.equal(render({ id: 'R2', rows: [{ ...original, value: -1 }] }, h), null);
});

test('generic equal-width histograms retain signed values and include the maximum exactly once', () => {
  const svg = render(chart('histogram', [{ value: -5 }, { value: -5 }, { value: 0 }, { value: 5 }, { value: null }]), h);
  expectMarks(svg, [0, 1, 2, 3]);
  assert.deepEqual(tags(svg, 'rect').map(bin => Number(bin['data-count'])), [2, 1, 1]);
  assert.deepEqual(marks(svg).map(mark => Number(mark['data-value'])), [-5, -5, 0, 5]);
  const single = render(chart('histogram', [{ value: 0 }]), h);
  expectMarks(single, [0]);
  assert.equal(tags(single, 'rect')[0]['data-count'], '1');
});

test('mixed measurement units are not silently put on one numeric axis', () => {
  for (const type of ['paired', 'box', 'histogram']) {
    assert.equal(render(chart(type, [{ reference: 1, comparison: 2, value: 1, unit: 'ms' },
      { reference: 2, comparison: 3, value: 2, unit: 'bpm' }]), h), null);
  }
});

test('every data/helper label is escaped before entering SVG text, title or attributes', () => {
  const attack = '\'"><script>alert(1)</script><img src=x onerror=alert(2)>&';
  const hostile = { tr: () => attack, num: () => attack, field: () => attack, title: () => attack };
  for (const input of Object.values(fixtures)) {
    const rows = input.rows.map(row => Object.fromEntries(Object.entries(row).map(([name, value]) =>
      [name, typeof value === 'string' && !['metricId', 'unit', 'blockId', 'stimulusId', 'fromId', 'toId'].includes(name) ? attack + value : value])));
    const svg = render({ ...input, rows }, hostile, 0);
    finiteSVG(svg);
    assert.doesNotMatch(svg, /<script|<img|<foreignObject|\sonerror="|\sonfocus="/i);
    assert.match(svg, /&lt;script&gt;/);
    assert.match(svg, /&quot;/);
    assert.match(svg, /&#39;/);
    assert.match(svg, /&amp;/);
  }
});

test('custom column names and units are escaped as well as observation labels', () => {
  const name = 'x"><image href="x" onload="evil()';
  const input = { id: 'F1', chart: { type: 'paired', x: name, y: 'b' }, rows: [{ [name]: 1, b: 2, unit: '"><script>x</script>' }] };
  const svg = render(input, h);
  expectMarks(svg, [0]);
  assert.match(svg, /data-series="x&quot;&gt;&lt;image/);
  assert.match(svg, /&lt;script&gt;/);
  assert.doesNotMatch(svg, /<image|<script/);
});

test('nonprimitive labels do not invoke arbitrary coercion and throwing helpers have safe fallbacks', () => {
  const bomb = { toString() { throw new Error('must not coerce'); } };
  const input = chart('paired', [{ reference: -1, comparison: 0, participant: bomb, unit: bomb }]);
  const hostile = { tr() { throw Error(); }, num: () => bomb, title: () => bomb, field: () => null };
  expectMarks(render(input, hostile), [0]);
});

test('prototype pollution, inherited measurements, accessor loops and forged array hooks are ignored', () => {
  const context = browser();
  const result = vm.runInContext(`(() => {
    const render = window.WecogAnalyticsCharts.render;
    const loop = { get reference() { while (true) {} }, comparison: 2 };
    const inherited = Object.create({ reference: 1, comparison: 2 });
    const rows = [loop, inherited, { reference: 0, comparison: 1 }];
    rows.slice = () => { while (true) {} };
    rows.map = () => { while (true) {} };
    const helpers = { get num() { while (true) {} } };
    const svg = render({ id: 'S1', rows, chart: { type: 'paired', x: '__proto__', y: 'constructor' } }, helpers);
    return [svg, render(Object.create({ rows, chart: { type: 'paired' } }), helpers), ({}).polluted];
  })()`, context, { timeout: 500 });
  expectMarks(result[0], [0, 2]);
  assert.equal(result[1], null);
  assert.equal(result[2], undefined);
  assert.equal(tags(result[0], 'path').filter(tag => tag.class === 'ax-pair-line').length, 1);
});

test('finite extreme numbers, tiny subnormals and nonfinite measurements never leak invalid SVG geometry', () => {
  for (const values of [[-Number.MAX_VALUE, 0, Number.MAX_VALUE], [Number.MAX_VALUE, Number.MAX_VALUE],
    [-Number.MIN_VALUE, 0, Number.MIN_VALUE], [0, 0, 0]]) {
    for (const type of ['paired', 'box', 'histogram']) {
      const input = chart(type, values.map(value => ({ reference: value, comparison: value, value })));
      finiteSVG(render(input, h));
    }
  }
  const invalid = [null, false, '', '3', [], {}, NaN, Infinity, -Infinity];
  for (const type of ['paired', 'box', 'histogram']) {
    assert.equal(render(chart(type, invalid.map(value => ({ reference: value, comparison: value, value }))), h), null);
  }
});

test('rendering examines at most the first 500 rows, including sparse arrays and hostile later accessors', () => {
  for (const type of ['paired', 'box', 'histogram']) {
    const rows = Array.from({ length: 500 }, (_, i) => ({ reference: i, comparison: i + 1, value: i }));
    Object.defineProperty(rows, '500', { get() { throw new Error('out of bounds'); } });
    const svg = render(chart(type, rows), h);
    finiteSVG(svg);
    assert.ok(indices(svg).every(index => index < 500));
    assert.equal(marks(svg).length, type === 'box' ? 1000 : 500);
    assert.match(svg, /First 500 input rows only/);
  }
  const sparse = [];
  sparse.length = 4294967295;
  sparse[499] = { reference: 0, comparison: 1 };
  expectMarks(render(chart('paired', sparse), h), [499]);
});

test('chords and categorical matrices enforce their 32-level limits deterministically', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ fromId: 'a' + i, toId: 'a' + (i + 1), from: 'A' + i, to: 'A' + (i + 1), count: 1 }));
  const svg = render({ id: 'G3', rows }, h);
  expectMarks(svg, Array.from({ length: 31 }, (_, i) => i));
  assert.match(svg, /First 32 AOIs only/);
  const matrix = render({ id: 'Q5', chart: { type: 'matrix', x: 'sessionId', y: 'channel' },
    rows: Array.from({ length: 40 }, (_, i) => ({ sessionId: 's' + i, channel: 'task', available: true })) }, h);
  expectMarks(matrix, Array.from({ length: 32 }, (_, i) => i));
  assert.match(matrix, /First 32 axis levels only/);
});

test('single-measure box plots use real session values, type-7 quartiles and centered geometry', () => {
  const input = { id: 'F1', chart: { type: 'box', value: 'value' }, rows: [1, 2, 3, 4, 100].map(value => ({ value, unit: 'bpm' })) };
  const svg = render(input, h);
  finiteSVG(svg);
  const box = tags(svg, 'g').find(tag => tag.class === 'ax-box-summary');
  assert.equal(box['data-series'], 'value');
  assert.equal(Number(box['data-q1']), 2); assert.equal(Number(box['data-median']), 3);
  assert.equal(Number(box['data-q3']), 4); assert.equal(Number(box['data-high']), 4);
  assert.deepEqual(indices(svg), [0, 1, 2, 3, 4]);
  assert.equal(marks(svg).filter(mark => mark['data-outlier'] === 'true').length, 1);
  assert.equal(tags(svg, 'rect').find(tag => Number(tag.width) === 88).x, '336');
});
