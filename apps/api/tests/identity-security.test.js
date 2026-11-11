const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { readIdentityConfig } = require('../config/identity');
const { canonicalEmail, validPassword, makeToken, tokenHash, encryptPayload, decryptPayload } = require('../services/identity-security');

function env(extra = {}) {
  return { NODE_ENV: 'development', IDENTITY_ENABLED: 'true', IDENTITY_MAIL_MODE: 'local',
    IDENTITY_PUBLIC_URL: 'http://127.0.0.1:3000/apps/web/', IDENTITY_TRUSTED_ORIGINS: 'http://127.0.0.1:3000',
    IDENTITY_MAIL_FROM: 'wecog@local.test', IDENTITY_OUTBOX_KEY: Buffer.alloc(32, 42).toString('base64'),
    IDENTITY_LOCAL_CAPTURE_DIR: '/private/tmp/wecog-identity-config-not-created', ...extra };
}
test('identity is off by default; production requires SMTP, HTTPS, trusted origin and encryption', () => {
  assert.equal(readIdentityConfig({}).enabled, false);
  for (const extra of [{ NODE_ENV: 'production' }, { IDENTITY_OUTBOX_KEY: '' }, { IDENTITY_TRUSTED_ORIGINS: '' },
    { IDENTITY_PUBLIC_URL: 'https://evil.test' }, { IDENTITY_PUBLIC_URL: 'http://user:pass@127.0.0.1:3000' },
    { IDENTITY_LOCAL_CAPTURE_DIR: path.resolve(__dirname, '../../web') }]) {
    assert.throws(() => readIdentityConfig(env(extra)), /Invalid identity configuration/);
  }
  const config = readIdentityConfig(env({ NODE_ENV: 'production', IDENTITY_MAIL_MODE: 'smtp',
    IDENTITY_PUBLIC_URL: 'https://example.test/apps/web/', IDENTITY_TRUSTED_ORIGINS: 'https://example.test',
    IDENTITY_SMTP_HOST: 'postbox.cloud.yandex.net', IDENTITY_SMTP_USER: 'test-only', IDENTITY_SMTP_PASSWORD: 'test-only' }));
  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.secure, false);
});
test('normalization exactly follows existing login provider rules, including plus and dots', async () => {
  assert.equal(await canonicalEmail(' A.li.ce+test@Gmail.com '), 'alice@gmail.com');
  assert.equal(await canonicalEmail('A.li.ce+test@Example.com'), 'a.li.ce+test@example.com');
  assert.equal(await canonicalEmail('Alice@Googlemail.com'), 'alice@gmail.com');
  await assert.rejects(canonicalEmail('a@example.com\r\nBCC:victim@example.com'));
  await assert.rejects(canonicalEmail({ email: 'a@example.com' }));
});
test('passwords are neither trimmed nor normalized and enforce bcrypt byte limit', () => {
  assert.equal(validPassword('x'.repeat(11)), false);
  assert.equal(validPassword(' '.repeat(12)), true);
  assert.equal(validPassword('x'.repeat(72)), true);
  assert.equal(validPassword('\u00e9'.repeat(37)), false);
  assert.equal(validPassword({ length: 12 }), false);
});
test('256-bit one-time tokens are hashed; encrypted outbox is authenticated and row-bound', () => {
  const { token, hash } = makeToken(), key = crypto.randomBytes(32), id = crypto.randomUUID();
  assert.equal(token.length, 43); assert.equal(hash.length, 64); assert.equal(hash, tokenHash(token));
  assert.throws(() => tokenHash('bad'), /invalid_or_expired_token/);
  const cipher = encryptPayload({ token, to: 'private@example.test' }, key, id);
  assert.equal(cipher.includes(token), false); assert.equal(cipher.includes('private@example.test'), false);
  assert.equal(decryptPayload(cipher, key, id).token, token);
  assert.throws(() => decryptPayload(cipher, crypto.randomBytes(32), id));
  assert.throws(() => decryptPayload(cipher, key, crypto.randomUUID()));
});
test('local mailbox writes private files and refuses a public or symlink mailbox', async t => {
  const { captureMail } = require('../services/identity-mail');
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'identity-mail-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'mail'), id = crypto.randomUUID();
  await captureMail({ captureDir: dir }, id, { message: '{"synthetic":true}' });
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(dir, id + '.json'))).mode & 0o777, 0o600);
  const symlink = path.join(root, 'link'); await fs.symlink(dir, symlink);
  await assert.rejects(captureMail({ captureDir: symlink }, id, { message: '{}' }));
  await assert.rejects(captureMail({ captureDir: path.resolve(__dirname, '../../web/mail') }, id, { message: '{}' }));
});

test('HTTP identity boundary rejects form CSRF, hostile origin, role mass assignment and GET activation', async t => {
  const express = require('express');
  const { createIdentityRouter } = require('../routes/identity');
  let queries = 0;
  const app = express();
  app.use('/identity', createIdentityRouter({ config: readIdentityConfig(env()), pool: { query() { queries++; throw new Error('unexpected DB'); } } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(base + '/identity/signup', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ email: 'test@example.test' }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await post({ email: 'test@example.test' }, { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await post({ email: 'test@example.test', role: 'admin' })).status, 400);
  assert.equal((await fetch(base + '/identity/confirm?token=' + makeToken().token)).status, 404);
  assert.equal(queries, 0);
});

test('legacy password-first registration retires only when identity is explicitly enabled', async t => {
  const express = require('express'), auth = require('../routes/auth');
  const original = process.env.IDENTITY_ENABLED;
  t.after(() => { if (original == null) delete process.env.IDENTITY_ENABLED; else process.env.IDENTITY_ENABLED = original; });
  const app = express(); app.use(express.json()); app.use('/auth', auth);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const send = () => fetch(`http://127.0.0.1:${server.address().port}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  delete process.env.IDENTITY_ENABLED; assert.equal((await send()).status, 400);
  process.env.IDENTITY_ENABLED = 'true'; assert.equal((await send()).status, 410);
});
