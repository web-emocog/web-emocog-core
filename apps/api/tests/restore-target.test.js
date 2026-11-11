const test = require('node:test');
const assert = require('node:assert/strict');
const { databaseName, assertRestoreTarget } = require('../security/restore-target');

test('restore guards reject different URLs which still name the same source database', () => {
  const source = 'postgres://secret:PRIVATE@localhost:5432/live';
  for (const target of ['postgresql://other:PRIVATE@127.0.0.1/live', 'postgres://other@db.internal:5432/%6cive']) {
    assert.throws(() => assertRestoreTarget(source, target), /different database name/);
  }
  assert.equal(assertRestoreTarget(source, 'postgres://other@db.internal/wecog_restore_1234abcd', true), 'wecog_restore_1234abcd');
  assert.throws(() => assertRestoreTarget(source, 'postgres://other@db.internal/another_live', true), /disposable/);
});

test('restore targets cannot hide database/host overrides inside libpq query parameters', () => {
  for (const url of ['postgres://user@db/safe?dbname=live', 'postgres://user@db/safe?database=live',
    'postgres://user@db/safe?service=production', 'postgres://user@db/safe?host=other',
    'postgres://user@db/', 'postgres://user@db/line%0abreak', 'http://db/safe']) {
    assert.throws(() => databaseName(url));
  }
  assert.equal(databaseName('postgresql://user:password@db/emocog_restore?sslmode=require'), 'emocog_restore');
});
