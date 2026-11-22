const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSessionDataSchema } = require('../security/session-data-schema');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const { validResult, validatePassiveValidTime, assertPublishedPassiveValidTime } = require('../security/passive-valid-time');
const { validateResult } = require('../../shared/passive-valid-time');

function timing() {
  return { schemaVersion: 'passive_valid_time.v1', targetMs: 2000, acceptedMs: 2000, actualMs: 2700,
    maxDurationMs: 3000, extended: true, limitReached: false,
    acceptedSegments: [{ startMs: 0, endMs: 1000 }, { startMs: 1500, endMs: 2500 }],
    excludedSegments: [{ startMs: 1000, endMs: 1500, reasons: ['fps_low'] },
      { startMs: 2500, endMs: 2700, reasons: ['valid_time_short_segment'] }] };
}
const data = value => ({ cognitiveResults: [{ validTime: value }] });
function packet(value = timing()) {
  return { schemaVersion: 'session_feature.v1', ids: { session: 'synthetic-valid-time' },
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' },
    events: [], ...data(value) };
}
function published() {
  return { blocks: [{ id: 'b', type: 'passive', content: { slideDuration: 2000, responseMode: 'none',
    validTime: { schemaVersion: 'passive_valid_time.v1', enabled: true, maxExtensionRatio: .5, minSegmentMs: 1000 },
    slides: [{ stimulusId: 'std_simple_black_square', duration: 2000 }] } }] };
}
const result = value => ({ cognitiveResults: [{ blockId: 'b', trialId: 't', stimulusId: 'std_simple_black_square',
  responseMode: 'none', task_id: 'passive_viewing', qualityValid: true, validTime: value }] });

test('issue177: absent validTime and empty legacy cognitive results remain supported', () => {
  for (const value of [{}, { cognitiveResults: [] }, { cognitiveResults: [null, {}] }]) {
    assert.deepEqual(validateSessionDataSchema(value), []);
    assert.deepEqual(validatePassiveValidTime(value), []);
  }
});

test('issue177: the complete typed packet accepts a chronological onset-relative partition', () => {
  assert.equal(validateResult(timing()), true);
  assert.equal(validResult(timing()), true);
  assert.deepEqual(validateSessionFeaturePayload(packet()), []);
});

test('issue177: a checkpoint can preserve the zero-duration failed partial result', () => {
  const value = { ...timing(), acceptedMs: 0, actualMs: 0, extended: false,
    acceptedSegments: [], excludedSegments: [] };
  assert.deepEqual(validateSessionFeaturePayload(packet(value)), []);
  const input = result(value); input.cognitiveResults[0].qualityValid = false;
  assert.doesNotThrow(() => assertPublishedPassiveValidTime(input, published()));
});

test('issue177: timer jitter remains actual elapsed time beyond the acceptance deadline', () => {
  const value = { ...timing(), acceptedMs: 1000, actualMs: 3027, limitReached: true,
    acceptedSegments: [{ startMs: 0, endMs: 1000 }], excludedSegments: [
      { startMs: 1000, endMs: 3000, reasons: ['fps_low'] },
      { startMs: 3000, endMs: 3027, reasons: ['valid_time_deadline'] }] };
  assert.deepEqual(validateSessionFeaturePayload(packet(value)), []);
  assert.equal(validResult(value), true);
  const input = result(value); input.cognitiveResults[0].qualityValid = false;
  assert.doesNotThrow(() => assertPublishedPassiveValidTime(input, published()));
  assert.equal(value.actualMs, 3027);
});

const mutations = [
  ['null object', (_v, input) => { input.cognitiveResults[0].validTime = null; }],
  ['missing required field', v => { delete v.actualMs; }],
  ['unknown object field', v => { v.untrusted = {}; }],
  ['unknown segment field', v => { v.acceptedSegments[0].rawFrames = []; }],
  ['wrong version', v => { v.schemaVersion = 'untyped'; }],
  ['fractional milliseconds', v => { v.actualMs = 2700.5; }],
  ['unsafe integer', v => { v.targetMs = Number.MAX_SAFE_INTEGER + 1; }],
  ['duration overflow', v => { v.actualMs = 86400001; }],
  ['nonfinite duration', v => { v.actualMs = Infinity; }],
  ['negative duration', v => { v.actualMs = -1; }],
  ['target below one second', v => { v.targetMs = 999; }],
  ['cap above ratio', v => { v.maxDurationMs = 3001; }],
  ['cap below target', v => { v.maxDurationMs = 1999; }],
  ['accepted total mismatch', v => { v.acceptedMs = 1999; }],
  ['incorrect extension flag', v => { v.extended = false; }],
  ['incorrect limit flag', v => { v.limitReached = true; }],
  ['first interval gap', v => { v.acceptedSegments[0].startMs = 1; }],
  ['interior gap', v => { v.excludedSegments[0].startMs = 1001; }],
  ['overlap', v => { v.excludedSegments[0].startMs = 999; }],
  ['missing terminal partition', v => { v.excludedSegments.pop(); }],
  ['unsorted accepted list', v => { v.acceptedSegments.reverse(); }],
  ['unsorted excluded list', v => { v.excludedSegments.reverse(); }],
  ['last accepted interval below one second', v => { v.acceptedSegments[1].endMs = 2499; }],
  ['accepted interval beyond deadline', v => { v.acceptedSegments[1].endMs = 3001; }],
  ['interval beyond actual duration', v => { v.excludedSegments[1].endMs = 2701; }],
  ['fractional segment offset', v => { v.excludedSegments[0].endMs = 1500.1; }],
  ['missing exclusion reasons', v => { v.excludedSegments[0].reasons = []; }],
  ['unbounded exclusion reasons', v => { v.excludedSegments[0].reasons = Array(17).fill('fps_low'); }],
  ['free-text exclusion reason', v => { v.excludedSegments[0].reasons = ['private message <script>']; }],
  ['oversized exclusion code', v => { v.excludedSegments[0].reasons = ['a'.repeat(81)]; }],
  ['accepted segment overflow', v => { v.acceptedSegments = Array(4097).fill(v.acceptedSegments[0]); }],
  ['excluded segment overflow', v => { v.excludedSegments = Array(4097).fill(v.excludedSegments[0]); }],
];
for (const [name, mutate] of mutations) test(`issue177: fail closed on ${name} without clipping or mutation`, () => {
  const input = packet(); mutate(input.cognitiveResults[0].validTime, input);
  const before = structuredClone(input);
  assert.ok(validateSessionFeaturePayload(input).some(error => error.path.includes('validTime')));
  assert.deepEqual(input, before);
});

test('issue177: both segment lists support exactly 4096 entries, not a truncated prefix', () => {
  const value = { ...timing(), targetMs: 4096000, acceptedMs: 4096000, actualMs: 4100096,
    maxDurationMs: 6144000, extended: true,
    acceptedSegments: Array.from({ length: 4096 }, (_, i) => ({ startMs: i * 1001, endMs: i * 1001 + 1000 })),
    excludedSegments: Array.from({ length: 4096 }, (_, i) => ({ startMs: i * 1001 + 1000, endMs: (i + 1) * 1001, reasons: ['fps_low'] })) };
  assert.deepEqual(validateSessionFeaturePayload(packet(value)), []);
  assert.equal(value.acceptedSegments.length, 4096);
});

test('issue177: published static passive opt-in is enforced independently from client response claims', () => {
  assert.doesNotThrow(() => assertPublishedPassiveValidTime(result(timing()), published()));
  const changes = [
    d => { delete d.blocks[0].content.validTime; },
    d => { d.blocks[0].content.validTime.enabled = false; },
    d => { d.blocks[0].type = 'audio_test'; },
    d => { d.blocks[0].content.responseMode = 'keypress'; },
    d => { d.blocks[0].content.slides[0].duration = 2500; },
    d => { d.blocks[0].content.validTime.maxExtensionRatio = .25; },
    d => { d.blocks.push(structuredClone(d.blocks[0])); },
  ];
  for (const mutate of changes) {
    const definition = published(); mutate(definition);
    assert.throws(() => assertPublishedPassiveValidTime(result(timing()), definition), { code: 'valid_time_not_declared' });
  }
  for (const field of [{ responseMode: 'keypress' }, { task_id: 'simple_rt' }, { blockId: 'foreign' }, { stimulusId: 'foreign' }]) {
    const input = result(timing()); Object.assign(input.cognitiveResults[0], field);
    assert.throws(() => assertPublishedPassiveValidTime(input, published()), { code: 'valid_time_not_declared' });
  }
});

test('issue177: enabled published policy cannot be bypassed by stripping timing metadata', () => {
  const input = result(timing()); delete input.cognitiveResults[0].validTime;
  assert.throws(() => assertPublishedPassiveValidTime(input, published()), { code: 'valid_time_not_declared' });
  const legacy = published(); delete legacy.blocks[0].content.validTime;
  assert.doesNotThrow(() => assertPublishedPassiveValidTime(input, legacy));
});

test('issue177: minimal runtime issue flags remain valid and cannot hide arbitrary nested fields', () => {
  const input = packet();
  Object.assign(input.cognitiveResults[0], { qualityValid: false, qualityIssueCodes: ['valid_time_incomplete'],
    qualityIssues: [{ code: 'valid_time_incomplete', kind: 'quality' }] });
  assert.deepEqual(validateSessionFeaturePayload(input), []);
  input.cognitiveResults[0].qualityIssues[0].arbitraryClientData = {};
  assert.notDeepEqual(validateSessionFeaturePayload(input), []);
});

test('issue177: gaze aggregates and retained fixations obey their matched accepted intervals', () => {
  const input = result(timing());
  Object.assign(input.cognitiveResults[0], { presentationId: 'p', onsetMs: 1000 });
  input.gaze_analytics = { presentations: [{ presentationId: 'p', blockId: 'b', trialId: 't',
    stimulusId: 'std_simple_black_square', presentationStartMs: 1000, validObservationDurationMs: 1000,
    fixationPoints: [{ x: .5, y: .5, startMs: 100, durationMs: 200 }] }] };
  assert.doesNotThrow(() => assertPublishedPassiveValidTime(input, published()));
  for (const mutate of [
    p => { p.validObservationDurationMs = 2002; },
    p => { p.fixationPoints[0].startMs = 900; },
    p => { p.fixationPoints[0].durationMs = 2001; },
    p => { p.stimulusId = 'unrelated'; },
  ]) {
    const bad = structuredClone(input); mutate(bad.gaze_analytics.presentations[0]);
    assert.throws(() => assertPublishedPassiveValidTime(bad, published()), { code: 'valid_time_not_declared' });
  }
});

test('issue177: dynamic and unresolved media cannot use valid time by supplying client static metadata', () => {
  for (const mime of ['video/mp4', 'audio/wav', 'image/gif', 'image/webp', 'image/svg+xml', null]) {
    const definition = published();
    definition.blocks[0].content.slides[0].stimulusId = '10';
    definition.mediaManifest = { 10: { mimeType: mime } };
    const input = result(timing()); input.cognitiveResults[0].stimulusId = '10';
    assert.throws(() => assertPublishedPassiveValidTime(input, definition), { code: 'valid_time_not_declared' });
  }
  const definition = published();
  definition.blocks[0].content.slides[0].stimulusId = '10';
  definition.mediaManifest = { 10: { mimeType: 'image/png', codec: 'png' } };
  const input = result(timing()); input.cognitiveResults[0].stimulusId = '10';
  assert.doesNotThrow(() => assertPublishedPassiveValidTime(input, definition));
});

test('issue177: an unmet accepted-time target is not declared quality-valid by arbitrary client data', () => {
  const value = { ...timing(), acceptedMs: 1000, actualMs: 3000, limitReached: true,
    acceptedSegments: [{ startMs: 0, endMs: 1000 }],
    excludedSegments: [{ startMs: 1000, endMs: 3000, reasons: ['fps_low'] }] };
  assert.throws(() => assertPublishedPassiveValidTime(result(value), published()), { code: 'valid_time_not_declared' });
});
