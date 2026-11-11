const test = require('node:test');
const assert = require('node:assert/strict');
const { inflateSync } = require('node:zlib');
const { requireIsolatedTarget, percentile, createSyntheticPng } = require('../scripts/load-stimuli');

function fixture() {
  const database = 'postgres://fixture:synthetic@127.0.0.1:5432/stimulus_test';
  return {
    env: { NODE_ENV: 'test', MEDIA_LOAD_TEST_ISOLATED: 'YES', DATABASE_URL: database,
      MEDIA_TEST_DATABASE_URL: database, MEDIA_LOAD_TEST_URL: 'http://127.0.0.1:4321',
      LIVE_STIMULUS_FIXTURE: '/tmp/fixture.json',
      MEDIA_LOAD_TEST_REPORT: '/tmp/report.json' },
    config: { http: { rateLimitStore: 'postgres', rateLimits: { auth: 20, ingest: 60, media: 1200, default: 600 } } },
  };
}

test('real media load test refuses production, remote targets, shared databases and enlarged test budgets', () => {
  const safe = fixture();
  assert.equal(requireIsolatedTarget(safe.env, safe.config), 'http://127.0.0.1:4321');
  for (const patch of [
    { NODE_ENV: 'production' }, { MEDIA_LOAD_TEST_ISOLATED: '' }, { MEDIA_TEST_DATABASE_URL: 'different' },
    { DATABASE_URL: 'postgres://127.0.0.1/real', MEDIA_TEST_DATABASE_URL: 'postgres://127.0.0.1/real' },
    { DATABASE_URL: 'postgres://remote.test/fixture_test', MEDIA_TEST_DATABASE_URL: 'postgres://remote.test/fixture_test' },
    { MEDIA_LOAD_TEST_URL: 'https://wecog.ru' }, { MEDIA_LOAD_TEST_URL: 'http://127.0.0.1:4321/path' },
    { MEDIA_LOAD_TEST_URL: 'http://user:password@127.0.0.1:4321' }, { LIVE_STIMULUS_FIXTURE: '' },
    { MEDIA_LOAD_TEST_REPORT: '' },
  ]) assert.throws(() => requireIsolatedTarget({ ...safe.env, ...patch }, safe.config));
  assert.throws(() => requireIsolatedTarget(safe.env, { http: { ...safe.config.http, rateLimitStore: 'memory' } }));
  assert.throws(() => requireIsolatedTarget(safe.env, { http: { ...safe.config.http,
    rateLimits: { ...safe.config.http.rateLimits, media: 10000 } } }));
});

test('load report percentiles sort a copy and retain submillisecond precision', () => {
  const values = [12.333, 1.001, 3.555, 9.9];
  assert.equal(percentile(values, 0.5), 9.9);
  assert.equal(percentile(values, 0.95), 12.33);
  assert.deepEqual(values, [12.333, 1.001, 3.555, 9.9]);
});

test('benchmark generates a 640 × 360 PNG of roughly the original fixture size in memory', () => {
  const image = createSyntheticPng();
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 640);
  assert.equal(image.readUInt32BE(20), 360);
  assert.equal(image.toString('ascii', 37, 41), 'IDAT');
  const scanlines = inflateSync(image.subarray(41, 41 + image.readUInt32BE(33)));
  assert.equal(scanlines.length, 641 * 360);
  for (let row = 0; row < 360; row++) assert.equal(scanlines[row * 641], 0);
  assert.ok(image.length >= 225_000 && image.length <= 235_000);
});
