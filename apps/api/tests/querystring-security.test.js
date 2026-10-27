const test = require('node:test');
const assert = require('node:assert/strict');
const qs = require('qs');

test('qs comma serialization tolerates an own non-callable toString without crashing', () => {
  for (const value of ['not callable', null, 42, {}]) {
    assert.equal(qs.stringify({ a: [{ toString: value }] }, { arrayFormat: 'comma' }),
      'a=%5Bobject%20Object%5D');
  }
  assert.equal(qs.stringify({ a: [1, 2, 3] }, { arrayFormat: 'comma' }), 'a=1%2C2%2C3');
});

test('patched query parsing preserves ordinary filters without mutating prototypes', () => {
  const value = qs.parse('filters[status]=completed&ids[]=1&ids[]=2&__proto__[wecogAudit]=true&constructor[prototype][wecogAudit]=true');
  assert.deepEqual(value.filters, { status: 'completed' });
  assert.deepEqual(value.ids, ['1', '2']);
  assert.equal(Object.prototype.wecogAudit, undefined);
  assert.equal(Object.hasOwn(value, '__proto__'), false);
});
