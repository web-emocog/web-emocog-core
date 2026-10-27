const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const express = require('express');
const { createRouteAwareJsonParser } = require('../security/http-security');

test('compressed garbage is rejected without taking the parser or server down', async t => {
  const app = express();
  app.use(createRouteAwareJsonParser({ auth: '1kb', ingest: '2kb', default: '1kb' }));
  app.post('/auth/test', (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: 'invalid_body' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/auth/test`;
  const send = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body });
  const invalid = await send(Buffer.concat([gzipSync('{"ok":true}'), Buffer.from('invalid gzip trailer')]));
  assert.equal(invalid.status, 400); await invalid.arrayBuffer();
  const oversized = await send(gzipSync(JSON.stringify({ value: 'x'.repeat(4096) })));
  assert.equal(oversized.status, 413); await oversized.arrayBuffer();
  const valid = await send(gzipSync('{"ok":true}'));
  assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), { ok: true });
});
