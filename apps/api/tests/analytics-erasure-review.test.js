const test = require('node:test');
const assert = require('node:assert/strict');
const { createSnapshot } = require('../analytics/snapshots');

for (const code of ['40001', '40P01', 'XX000']) test(`snapshot transaction failure ${code} rolls back and releases its connection`, async () => {
  const failure = Object.assign(new Error('synthetic transaction conflict'), { code });
  const queries = []; let released = 0;
  const pool = { connect: async () => ({
    query: async sql => { queries.push(sql); if (/SELECT/.test(sql)) throw failure; return { rows: [] }; },
    release: () => { released++; },
  }) };
  await assert.rejects(createSnapshot(pool, { projectId: 1, protocolId: 2 }, 1), error => {
    if (code === 'XX000') return error === failure;
    return error.status === 409 && error.code === 'analytics_selection_changed';
  });
  assert.ok(queries.includes('ROLLBACK'));
  assert.equal(released, 1);
});
