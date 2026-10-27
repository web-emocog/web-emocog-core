const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { errorRecord, logUnexpectedError } = require('../security/error-log');

test('unexpected-error records retain a safe diagnostic code, not SQL, paths or credentials', () => {
  const error = Object.assign(new Error('PRIVATE_PASSWORD /private/path?code=PRIVATE_INVITATION'), {
    code: '23505', detail: 'PRIVATE_EMAIL@example.test', query: 'PRIVATE_SQL', token: 'PRIVATE_TOKEN',
    stack: 'PRIVATE_STACK', toJSON() { throw new Error('must not serialize'); }
  });
  const record = errorRecord(error, 'auth');
  assert.equal(record.code, '23505'); assert.equal(record.category, 'database');
  assert.match(record.errorId, /^[a-f0-9-]{36}$/); assert.ok(!JSON.stringify(record).includes('PRIVATE_'));
  assert.deepEqual(Object.keys(record).sort(), ['category', 'code', 'component', 'errorId', 'event']);
});
test('unknown codes, hostile components and failing log sinks cannot leak values or change API behavior', t => {
  assert.equal(errorRecord({ code: 'PRIVATE_TOKEN' }, 'PRIVATE_EMAIL@example.test').code, null);
  assert.equal(errorRecord(null, 'https://private.test').component, 'api');
  const error = Object.defineProperty({}, 'code', { get() { throw new Error('PRIVATE'); } });
  assert.equal(errorRecord(error).category, 'internal');
  const saved = console.error; t.after(() => { console.error = saved; });
  console.error = () => { throw new Error('log sink failed'); };
  assert.doesNotThrow(() => logUnexpectedError(error, 'auth'));
});
test('canonical API handlers cannot dump Error objects or their messages to console', () => {
  for (const name of fs.readdirSync(path.resolve(__dirname, '../routes'))) {
    if (!name.endsWith('.js')) continue;
    const source = fs.readFileSync(path.resolve(__dirname, '../routes', name), 'utf8');
    assert.doesNotMatch(source, /console\.(?:error|warn)\([^;\n]*(?:\berr\b|\berror\b)/, name);
  }
});
test('a real login failure keeps database details out of both the response and captured logs', async t => {
  const { pool } = require('../db'), originalQuery = pool.query, originalError = console.error;
  const lines = [];
  pool.query = async () => { throw Object.assign(new Error('PRIVATE_PASSWORD'), { code: '23505', detail: 'PRIVATE_EMAIL@example.test', stack: '/private/PRIVATE_PATH' }); };
  console.error = value => lines.push(String(value));
  const server = require('../app').listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve)); pool.query = originalQuery; console.error = originalError; await pool.end();
  });
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/auth/login`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'synthetic@example.test', password: 'synthetic-password-123' }) });
  assert.equal(response.status, 500); assert.ok(!JSON.stringify(await response.json()).includes('PRIVATE'));
  assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]).category, 'database');
  assert.ok(!lines.join('').includes('PRIVATE'));
});
