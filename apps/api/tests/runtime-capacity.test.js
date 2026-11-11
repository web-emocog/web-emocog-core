const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { readStoragePolicy } = require('../config/storage-policy');
const { assertQuota } = require('../stimuli/storage-quotas');
const { createRouteRateLimiter } = require('../security/http-security');

function isolatedConfig(env = {}) {
  const filename = path.resolve(__dirname, '../config/index.js');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const load = vm.runInThisContext(`(function(require, module, process, __dirname) {
    ${fs.readFileSync(filename, 'utf8')}
  })`, { filename });
  // Test defaults and explicit overrides without reading a developer's .env.
  load(name => name === '../load-env' ? undefined : nativeRequire(name), module,
    { env: { NODE_ENV: 'test', ...env } }, path.dirname(filename));
  return module.exports;
}

function hit(limiter, pathname, method) {
  return new Promise((resolve, reject) => {
    const req = { path: pathname, method, ip: '192.0.2.44', headers: {}, socket: {} };
    const headers = {};
    const res = { setHeader: (key, value) => { headers[key] = value; }, getHeader: key => headers[key],
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body, headers }); return this; } };
    Promise.resolve(limiter(req, res, () => resolve({ status: 200 }))).catch(reject);
  });
}

test('capacity defaults and example config agree without enlarging login, files or concurrency', () => {
  const config = isolatedConfig(), policy = readStoragePolicy({});
  assert.equal(config.http.rateLimits.default, 600);
  assert.equal(config.http.rateLimits.media, 1200);
  assert.equal(config.http.rateLimits.auth, 20);
  assert.equal(config.http.rateLimits.ingest, 60);
  assert.equal(config.storage.maxUploadBytes, 50 * 1024 ** 2);
  assert.equal(config.storage.preview.maxConcurrent, 2);
  assert.equal(policy.organizationBytes, 10 * 1024 ** 3);
  assert.equal(policy.minFreeBytes, 1024 ** 3);
  assert.equal(policy.maxUserUploads, 2);
  assert.equal(policy.maxActiveUploads, 8);
  const example = fs.readFileSync(path.resolve(__dirname, '../.env.example'), 'utf8');
  for (const [key, expected] of Object.entries({ DEFAULT_RATE_LIMIT_PER_MINUTE: 600,
    MEDIA_RATE_LIMIT_PER_MINUTE: 1200, AUTH_RATE_LIMIT_PER_MINUTE: 20,
    MEDIA_ORGANIZATION_QUOTA_BYTES: 10 * 1024 ** 3 })) {
    assert.ok(example.split('\n').includes(`${key}=${expected}`), key);
  }
});

test('explicit operator limits still override the larger defaults', () => {
  const config = isolatedConfig({ DEFAULT_RATE_LIMIT_PER_MINUTE: '31', MEDIA_RATE_LIMIT_PER_MINUTE: '77', AUTH_RATE_LIMIT_PER_MINUTE: '7' });
  assert.equal(config.http.rateLimits.default, 31);
  assert.equal(config.http.rateLimits.media, 77);
  assert.equal(config.http.rateLimits.auth, 7);
  assert.equal(readStoragePolicy({ MEDIA_ORGANIZATION_QUOTA_BYTES: '100' }).organizationBytes, 100);
  const production = isolatedConfig({ NODE_ENV: 'production', JWT_SECRET: 'synthetic-capacity-test-secret-never-used-for-real-accounts' });
  assert.equal(production.http.rateLimitStore, 'postgres');
  assert.throws(() => isolatedConfig({ NODE_ENV: 'production', RATE_LIMIT_STORE: 'memory',
    JWT_SECRET: 'synthetic-capacity-test-secret-never-used-for-real-accounts' }), /PostgreSQL|postgres/);
});

test('new HTTP budgets accept their full capacity and still reject the next request independently', async () => {
  const limits = isolatedConfig().http.rateLimits;
  const limiter = createRouteRateLimiter(limits, { validate: false });
  for (const [route, method, capacity, profile] of [
    ['/stimuli/42/content', 'GET', 1200, 'media'],
    ['/protocols/39', 'PATCH', 600, 'default'],
    ['/auth/login', 'POST', 20, 'auth'],
  ]) {
    for (let index = 0; index < capacity; index++) assert.equal((await hit(limiter, route, method)).status, 200);
    const blocked = await hit(limiter, route, method);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.route_profile, profile);
    assert.ok(Number(blocked.headers['Retry-After']) > 0);
  }
});

test('larger library quota accepts more than the former GiB but retains exact accounting at 10 GiB', async () => {
  const policy = readStoragePolicy({});
  let totals = { retained_bytes: 2 * 1024 ** 3, reserved_bytes: 0, unmeasured: 0 };
  const client = { query: async () => ({ rows: [totals] }) };
  await assertQuota(client, 7, 1, policy);
  totals = { ...totals, retained_bytes: policy.organizationBytes - 20, reserved_bytes: 10 };
  await assertQuota(client, 7, 10, policy);
  await assert.rejects(assertQuota(client, 7, 11, policy), { code: 'media_quota_exceeded' });
  totals = { ...totals, unmeasured: 1 };
  await assert.rejects(assertQuota(client, 7, 0, policy), { code: 'media_inventory_unmeasured' });
});
