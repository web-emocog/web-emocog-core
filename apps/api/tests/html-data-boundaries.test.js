const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function bridge() {
  const context = vm.createContext({ document: { readyState: 'loading', addEventListener() {} } });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../web/researcher-api-bridge.js'), 'utf8'), context);
  return context;
}

test('session merge retains special JSON keys without writing through inherited prototypes', () => {
  const result = vm.runInContext(`(() => {
    const target = { session: { unchanged: 5 }, blocks: [] }, originalSession = target.session;
    const data = JSON.parse('{"__proto__":{"auditPolluted":true},"constructor":{"prototype":{"auditConstructor":true}},"session":{"__proto__":{"nestedPollution":true}},"blocks":[{"id":"a","rt":0}]}');
    data.session.name = '<literal> & "quotes"';
    EmocogResearcherBridge.applySessionData(target, data);
    return { clean: !Object.prototype.auditPolluted && !Object.prototype.nestedPollution && !Object.prototype.auditConstructor,
      sameNestedObject: target.session === originalSession, unchanged: target.session.unchanged,
      ownSpecial: Object.hasOwn(target, '__proto__') && Object.hasOwn(target.session, '__proto__'),
      preserved: JSON.parse(JSON.stringify(target)).__proto__.auditPolluted === true,
      prototype: Object.getPrototypeOf(target) === Object.prototype, blocks: target.blocks, name: target.session.name };
  })()`, bridge());
  assert.equal(result.clean, true);
  assert.equal(result.sameNestedObject, true);
  assert.equal(result.unchanged, 5);
  assert.equal(result.ownSpecial, true);
  assert.equal(result.preserved, true);
  assert.equal(result.prototype, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.blocks)), [{ id: 'a', rt: 0 }]);
  assert.equal(result.name, '<literal> & "quotes"');
});

test('session metrics keep missing or malformed values missing, but retain real zero and numeric strings', () => {
  const context = bridge();
  for (const value of [null, '', '  ', false, true, [], {}, [0]]) {
    const row = { id: 1, qc_score: value, features: { gaze_on_target_pct: value, valence_mean: value,
      bpm_mean: value, blocks: [{ duration_sec: value, attention: value, qc_score: value }] } };
    context.input = row;
    const result = vm.runInContext('EmocogResearcherBridge.mapSessionRowToSessionData(input)', context);
    assert.equal(result.qc.score, null);
    for (const key of ['gaze_on_target', 'valence_mean', 'bpm_mean']) assert.equal(result.segments.full[key], null, key);
    assert.equal(result.blocks[0].duration_sec, null);
    assert.equal(result.blocks[0].kpis.gaze_on_target_pct, null);
  }
  context.input = { qc_score: '0', features: { gaze_on_target_pct: null, gaze_on_target: 72.5, bpm_mean: '64.25', valence_mean: 0 } };
  const result = vm.runInContext('EmocogResearcherBridge.mapSessionRowToSessionData(input)', context);
  assert.equal(result.qc.score, 0);
  assert.equal(result.segments.full.gaze_on_target, 72.5);
  assert.equal(result.segments.full.bpm_mean, 64.25);
  assert.equal(result.segments.full.valence_mean, 0);
});

test('session merge creates an own data property instead of invoking an inherited setter', () => {
  const result = vm.runInContext(`(() => {
    let calls = 0; const prototype = { set name(value) { calls++; } }, target = Object.create(prototype);
    EmocogResearcherBridge.applySessionData(target, { name: 'literal name', nested: { value: 4 } });
    return { calls, own: Object.hasOwn(target, 'name'), name: target.name, nested: target.nested.value };
  })()`, bridge());
  assert.equal(result.calls, 0); assert.equal(result.own, true); assert.equal(result.name, 'literal name'); assert.equal(result.nested, 4);
});
