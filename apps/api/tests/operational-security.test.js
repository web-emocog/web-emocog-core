const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PostgresRateStore } = require('../security/postgres-rate-store');
const { createOperationalMetrics } = require('../operations/metrics');
const { currentRequestId } = require('../operations/request-context');
const { errorRecord } = require('../security/error-log');

test('shared limiter hashes keys, uses atomic database expiry and bounds cleanup', async () => {
  const queries = [];
  const store = new PostgresRateStore({ query: async (sql, values) => {
    queries.push({ sql, values });
    return { rows: [{ hits: '3', expires_at: '2026-11-05T12:00:00Z' }] };
  } }, 'x'.repeat(32), { now: () => 10000 });
  store.init({ windowMs: 60_000 });
  assert.equal((await store.increment('auth:192.0.2.12')).totalHits, 3);
  await store.increment('auth:192.0.2.12');
  assert.equal(queries.filter(row => row.sql.startsWith('DELETE')).length, 1);
  assert.match(queries[0].sql, /ON CONFLICT\(key_hash\) DO UPDATE/);
  assert.match(queries[0].sql, /clock_timestamp\(\)/);
  assert.match(queries[0].values[0], /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(queries).includes('192.0.2.12'));
  assert.equal(queries[0].values[0], queries[2].values[0]);
  assert.notEqual(store.digest('auth:192.0.2.12'), store.digest('media:192.0.2.12'));
  assert.match(queries[1].sql, /^DELETE FROM http_rate_windows WHERE expires_at </);
  assert.throws(() => store.init({ windowMs: 0 }));
});

test('limiter store failure fails closed and never propagates private database diagnostics', async () => {
  const store = new PostgresRateStore({ query: async () => { throw Object.assign(new Error('PRIVATE_DSN'), { detail: 'PRIVATE_SQL' }); } },
    'x'.repeat(32), { now: () => 0 });
  for (let i = 0; i < 2; i++) await assert.rejects(store.increment('default:private-key'), error =>
    error.status === 503 && error.code === 'rate_limit_store_unavailable' && !JSON.stringify(error).includes('PRIVATE'));
});

test('metrics labels are bounded, correlation IDs are server-owned and contain no participant identifiers', async () => {
  let now = 0;
  const metrics = createOperationalMetrics({ now: () => now });
  const req = { path: '/invitations/by-code/PRIVATE_CODE/stimuli/99/content', method: 'GET',
    headers: { 'x-request-id': 'PRIVATE_REQUEST', authorization: 'PRIVATE_TOKEN' } };
  const res = new EventEmitter();
  Object.assign(res, { statusCode: 200, writableFinished: true, setHeader: (_name, value) => { res.id = value; } });
  await new Promise(resolve => metrics.middleware(req, res, async () => {
    assert.equal(currentRequestId(), res.id);
    await Promise.resolve();
    const record = errorRecord({ code: '23505', message: 'PRIVATE' });
    assert.equal(record.requestId, req.requestId);
    resolve();
  }));
  now = 101;
  res.emit('finish'); res.emit('close');
  assert.match(res.id, /^[a-f0-9-]{36}$/);
  assert.equal(currentRequestId(), undefined);
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.aborted, 0);
  assert.equal(snapshot.requests[0].route, 'invitations');
  assert.deepEqual(snapshot.requests[0].buckets, [0, 0, 1, 1, 1, 1]);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  assert.ok(!metrics.prometheus().includes('PRIVATE'));
  assert.match(metrics.prometheus(), /wecog_http_duration_seconds_bucket/);
});

test('unknown paths never create a new metric label per URL or copied external method', () => {
  const metrics = createOperationalMetrics();
  for (let i = 0; i < 2000; i++) {
    const res = new EventEmitter();
    Object.assign(res, { statusCode: 404, writableFinished: true, setHeader() {} });
    metrics.middleware({ path: `/PRIVATE_${i}`, method: `PRIVATE_${i}` }, res, () => {});
    res.emit('finish');
  }
  assert.equal(metrics.snapshot().requests.length, 1);
  assert.equal(metrics.snapshot().requests[0].count, 2000);
  assert.ok(!metrics.prometheus().includes('PRIVATE'));
});
