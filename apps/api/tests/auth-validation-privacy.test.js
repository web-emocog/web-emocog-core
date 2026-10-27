const test = require('node:test');
const assert = require('node:assert/strict');

test('auth validation never echoes passwords, nested values or email addresses', async t => {
  const server = require('../app').listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const secret = 'synthetic-private-password-'.repeat(4);
  for (const route of ['/auth/login', '/auth/register']) for (const password of [secret, { nested: secret }]) {
    const response = await fetch(url + route, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ email: 'synthetic@example.test', password }) });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.ok(result.errors.some(error => error.path === 'password'));
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.ok(result.errors.every(error => !Object.hasOwn(error, 'value')));
  }
});
