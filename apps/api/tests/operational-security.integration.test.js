const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

test('independent HTTP instances share an atomic PostgreSQL limit and recover after expiry', {
  skip: !process.env.S2_TEST_DATABASE_URL,
}, async t => {
  const { Pool } = require('pg');
  const express = require('express');
  const { rateLimit } = require('express-rate-limit');
  const { PostgresRateStore } = require('../security/postgres-rate-store');
  const pool = new Pool({ connectionString: process.env.S2_TEST_DATABASE_URL });
  const secret = randomBytes(32).toString('hex');
  const stores = [new PostgresRateStore(pool, secret), new PostgresRateStore(pool, secret)];
  const servers = stores.map(store => {
    const app = express();
    app.use(rateLimit({ store, windowMs: 60_000, limit: 5, keyGenerator: () => 'synthetic-shared', standardHeaders: false }));
    app.get('/', (_req, res) => res.sendStatus(204));
    return app.listen(0, '127.0.0.1');
  });
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await stores[0].resetKey('synthetic-shared');
    await pool.end();
  });
  for (const server of servers) if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const statuses = await Promise.all(Array.from({ length: 12 }, (_, i) => fetch(`http://127.0.0.1:${servers[i % 2].address().port}/`).then(response => response.status)));
  assert.equal(statuses.filter(status => status === 204).length, 5);
  assert.equal(statuses.filter(status => status === 429).length, 7);
  await pool.query("UPDATE http_rate_windows SET expires_at=clock_timestamp()-interval '1 second' WHERE key_hash=$1", [stores[0].digest('synthetic-shared')]);
  assert.equal((await fetch(`http://127.0.0.1:${servers[1].address().port}/`)).status, 204);
  const recovered = await stores[0].get('synthetic-shared');
  assert.equal(recovered.totalHits, 1);
});
