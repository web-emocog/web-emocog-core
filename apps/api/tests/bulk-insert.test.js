const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_POSTGRES_PARAMETERS,
  boundedBatchSize,
  insertEventPayloadsInChunks,
} = require('../db/bulk-insert');

describe('bounded bulk inserts', () => {
  it('never creates more PostgreSQL parameters than the protocol limit', () => {
    assert.equal(boundedBatchSize(MAX_POSTGRES_PARAMETERS, 2), 32_767);
    assert.equal(boundedBatchSize(0, 2), 1);
  });

  it('chunks event payloads and preserves their order', async () => {
    const queries = [];
    const queryable = {
      async query(sql, parameters) { queries.push({ sql, parameters }); },
    };
    const events = Array.from({ length: 205 }, (_, index) => ({ index }));
    const inserted = await insertEventPayloadsInChunks(queryable, {
      sessionId: 42,
      events,
      batchSize: 100,
    });
    assert.equal(inserted, 205);
    assert.deepEqual(queries.map(entry => entry.parameters.length), [200, 200, 10]);
    assert.equal(JSON.parse(queries[0].parameters[1]).index, 0);
    assert.equal(JSON.parse(queries[2].parameters[9]).index, 204);
    assert.ok(queries.every(entry => entry.parameters.length <= 200));
  });
});
