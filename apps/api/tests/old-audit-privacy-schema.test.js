const test = require('node:test');
const assert = require('node:assert/strict');
const { schema, validateSessionDataSchema } = require('../security/session-data-schema');
const { validateSessionFeaturePayload, requireSessionFeaturePayload } = require('../security/payload-policy');

test('all nested measurement objects are closed or explicitly bounded typed maps', () => {
  let objects = 0, arrays = 0;
  const visit = (rule, path) => {
    if (!rule || typeof rule !== 'object') return;
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (types.includes('object')) {
      objects++;
      if (rule.additionalProperties !== false) {
        assert.equal(typeof rule.additionalProperties, 'object', path);
        assert.equal(typeof rule.propertyNames?.pattern, 'string', path);
        assert.ok(Number.isInteger(rule.maxProperties) && rule.maxProperties <= 200, path);
      }
    }
    if (types.includes('array')) {
      arrays++;
      assert.ok(rule.items && Number.isInteger(rule.maxItems) && rule.maxItems <= 5000, path);
    }
    for (const name of ['properties', '$defs']) for (const [key, child] of Object.entries(rule[name] || {})) {
      visit(child, path + '/' + key);
    }
    for (const key of ['items', 'additionalProperties']) if (typeof rule[key] === 'object') visit(rule[key], path + '/' + key);
    for (const child of rule.anyOf || []) visit(child, path + '/anyOf');
  };
  visit(schema, '');
  assert.ok(objects > 50);
  assert.ok(arrays > 20);
});

test('every object module rejects an unreviewed nested field, without mutating input', () => {
  let checked = 0;
  for (const [key, rawRule] of Object.entries(schema.properties)) {
    const rule = rawRule.$ref ? schema.$defs[rawRule.$ref.slice('#/$defs/'.length)] : rawRule;
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (!types.includes('object')) continue;
    const payload = { [key]: { unreviewed: { privateNote: 'synthetic private value' } } };
    const before = JSON.stringify(payload);
    const errors = validateSessionDataSchema(payload);
    assert.ok(errors.some(error => error.path === '/' + key + '/unreviewed'
      && error.keyword === 'additionalProperties'), key);
    assert.equal(JSON.stringify(payload), before);
    checked++;
  }
  assert.ok(checked > 10);
});

test('value checks and depth bounds complement nested schemas; known measurements remain accepted', () => {
  const base = { schemaVersion: 'session_feature.v1', ids: { session: 'S-privacy-audit' }, events: [],
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' },
    emotion_summary: { n: 1, valence_mean: 0, arousal_mean: 0 }, bpm_summary: { sampleCount: 0 } };
  assert.deepEqual(validateSessionFeaturePayload(base), []);
  for (const metadata of [{ unknown: { value: 'synthetic@example.test' } },
    { unknown: { value: 'data:image/png;base64,Zm9v' } },
    JSON.parse('{"__proto__":{"private":true}}')]) {
    const errors = validateSessionFeaturePayload({ ...base, experimentMeta: metadata });
    assert.ok(errors.length > 0);
    assert.ok(!JSON.stringify(errors).includes('synthetic@example.test'));
    assert.ok(!JSON.stringify(errors).includes('base64,Zm9v'));
  }
  let deep = {};
  for (let i = 0; i < 20; i++) deep = { nested: deep };
  assert.ok(validateSessionFeaturePayload({ ...base, experimentMeta: deep }).some(error => error.keyword === 'maxDepth'));
});

test('422 diagnostics never echo arbitrary keys and preserve the path to known fields', () => {
  let code, reply;
  const body = { schemaVersion: 'session_feature.v1',
    ids: { session: 1, 'synthetic-address@example.test': true },
    events: [], lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' },
    attentionMetrics: { perPhase: { 'synthetic-private-name': { unknown: true } } },
    'synthetic-private-root': { someField: 'synthetic-address@example.test' }
  };
  requireSessionFeaturePayload({ body }, {
    status(value) { code = value; return this; },
    json(value) { reply = value; }
  }, () => assert.fail('invalid packet must not continue to ingest'));
  assert.equal(code, 422);
  assert.equal(reply.code, 'pii_forbidden');
  assert.ok(reply.errors.some(error => error.path === '/ids/session'));
  assert.ok(reply.errors.some(error => error.path === '/attentionMetrics/perPhase/*/*'));
  assert.doesNotMatch(JSON.stringify(reply), /synthetic-/);
});
