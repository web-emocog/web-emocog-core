const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { classifyRoute, classifyRateLimitRoute, createRouteRateLimiter } = require('../security/http-security');
const config = require('../config');

function runLimiter(limiter, route, method = 'GET', ip = '192.0.2.20') {
  return new Promise((resolve, reject) => {
    const req = { path: route, method, ip, headers: {}, socket: {} };
    const res = {
      headers: {}, statusCode: 200,
      setHeader(name, value) { this.headers[name] = value; },
      getHeader(name) { return this.headers[name]; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body, headers: this.headers }); return this; },
    };
    Promise.resolve(limiter(req, res, () => resolve({ status: 200 }))).catch(reject);
  });
}

describe('Invitation media rate-limit regression', () => {
  it('keeps JSON parsing and all write routes in their existing profiles', () => {
    const file = '/invitations/by-code/test/stimuli/42/content';
    assert.equal(classifyRoute(file), 'ingest');
    for (const method of ['GET', 'HEAD']) {
      assert.equal(classifyRateLimitRoute({ path: file, method }), 'media');
      assert.equal(classifyRateLimitRoute({ path: '/invitations/by-code/test/stimuli', method }), 'media');
    }
    for (const [route, method, profile] of [
      [file, 'POST', 'ingest'],
      ['/invitations/by-code/test', 'GET', 'ingest'],
      ['/invitations/by-code/test/ingest-token', 'POST', 'ingest'],
      ['/ingest', 'POST', 'ingest'],
      ['/auth/login', 'POST', 'auth'],
      ['/stimuli/42/content', 'GET', 'default'],
      ['/invitations/by-code/test/stimuli/not-a-number/content', 'GET', 'ingest'],
    ]) assert.equal(classifyRateLimitRoute({ path: route, method }), profile);
    assert.equal(config.http.rateLimits.media, Number(process.env.MEDIA_RATE_LIMIT_PER_MINUTE) > 0
      ? Number(process.env.MEDIA_RATE_LIMIT_PER_MINUTE) : 300);
  });

  it('loads 63 images without spending invitation/admission/ingest capacity', async () => {
    const limiter = createRouteRateLimiter({ auth: 2, ingest: 4, media: 300, default: 4 }, { validate: false });
    assert.equal((await runLimiter(limiter, '/invitations/by-code/test')).status, 200);
    assert.equal((await runLimiter(limiter, '/invitations/by-code/test/stimuli')).status, 200);
    for (let id = 1; id <= 63; id++) {
      assert.equal((await runLimiter(limiter, `/invitations/by-code/test/stimuli/${id}/content`)).status, 200);
    }
    assert.equal((await runLimiter(limiter, '/invitations/by-code/test')).status, 200);
    assert.equal((await runLimiter(limiter, '/invitations/by-code/test/ingest-token', 'POST')).status, 200);
    assert.equal((await runLimiter(limiter, '/ingest', 'POST')).status, 200);
    assert.equal((await runLimiter(limiter, '/ingest', 'POST')).status, 429);
  });

  it('still bounds media across invitations on one IP and isolates other IPs', async () => {
    const limiter = createRouteRateLimiter({ auth: 1, ingest: 2, media: 2, default: 2 }, { validate: false });
    const file = '/invitations/by-code/test/stimuli/1/content';
    assert.equal((await runLimiter(limiter, file)).status, 200);
    assert.equal((await runLimiter(limiter, file, 'HEAD')).status, 200);
    const blocked = await runLimiter(limiter, '/invitations/by-code/another/stimuli/2/content');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.route_profile, 'media');
    assert.ok(Number(blocked.headers['Retry-After']) > 0);
    assert.equal((await runLimiter(limiter, file, 'GET', '192.0.2.21')).status, 200);
    assert.equal((await runLimiter(limiter, '/ingest', 'POST')).status, 200);
    assert.equal((await runLimiter(limiter, '/auth/login', 'POST')).status, 200);
    assert.equal((await runLimiter(limiter, '/auth/login', 'POST')).status, 429);
  });
});

const moduleUrl = pathToFileURL(path.resolve(__dirname, '../../participant-web/js/session-runtime/invitation-http.mjs'));

describe('Invitation request queue', () => {
  it('finishes 360 media reads through the real limiter across a rate-limit window', async () => {
    const { createInvitationRequestPool } = await import(moduleUrl);
    let clock = Date.now();
    const buckets = new Map();
    const store = {
      async increment(key) {
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetTime.getTime() <= clock) {
          bucket = { totalHits: 0, resetTime: new Date(clock + 60000) };
          buckets.set(key, bucket);
        }
        return { totalHits: ++bucket.totalHits, resetTime: bucket.resetTime };
      },
      async decrement(key) { const bucket = buckets.get(key); if (bucket) bucket.totalHits--; },
      async resetKey(key) { buckets.delete(key); },
    };
    const limiter = createRouteRateLimiter({ auth: 2, ingest: 4, media: 300, default: 4 }, { store, validate: false });
    let rejected = 0;
    const pool = createInvitationRequestPool({ now: () => clock, wait: async ms => { clock += ms; }, fetchRequest: async (url, options, read) => {
      const result = await runLimiter(limiter, url);
      if (result.status === 429) rejected++;
      return read(new Response('{}', { status: result.status, headers: result.headers }));
    } });
    const responses = await Promise.all(Array.from({ length: 360 }, (_, id) => pool(
      `/invitations/by-code/test/stimuli/${id + 1}/content`, {}, response => response.status
    )));
    assert.ok(rejected > 0);
    assert.ok(responses.every(status => status === 200));
    assert.equal((await runLimiter(limiter, '/invitations/by-code/test')).status, 200);
    assert.equal((await runLimiter(limiter, '/ingest', 'POST')).status, 200);
  });

  it('bounds concurrent binary reads even for a large protocol', async () => {
    const { createInvitationRequestPool } = await import(moduleUrl);
    let active = 0;
    let peak = 0;
    const pool = createInvitationRequestPool({
      fetchRequest: async (url, options, read) => {
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setImmediate(resolve));
        const result = await read(new Response(url));
        active--;
        return result;
      },
    });
    const result = await Promise.all(Array.from({ length: 500 }, (_, id) => pool(String(id), {}, r => r.text())));
    assert.equal(peak, 3);
    assert.deepEqual(result, Array.from({ length: 500 }, (_, id) => String(id)));
  });

  it('honors a shared Retry-After cooldown before retrying or starting queued files', async () => {
    const { createInvitationRequestPool } = await import(moduleUrl);
    let clock = 0;
    let attempts = 0;
    const calls = [];
    const pool = createInvitationRequestPool({
      concurrency: 1, now: () => clock, wait: async ms => { clock += ms; },
      fetchRequest: async (url, options, read) => {
        calls.push({ url, at: clock });
        return read(++attempts === 1
          ? new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })
          : new Response('ok'));
      },
    });
    assert.deepEqual(await Promise.all(['a', 'b'].map(url => pool(url, {}, r => r.text()))), ['ok', 'ok']);
    assert.deepEqual(calls, [{ url: 'a', at: 0 }, { url: 'a', at: 60000 }, { url: 'b', at: 60000 }]);
  });

  it('handles HTTP-date and missing Retry-After without an immediate retry storm', async () => {
    const { createInvitationRequestPool } = await import(moduleUrl);
    for (const header of [new Date(5000).toUTCString(), null, 'invalid']) {
      let clock = 0;
      let calls = 0;
      const pool = createInvitationRequestPool({
        now: () => clock, wait: async ms => { clock += ms; },
        fetchRequest: async (url, options, read) => read(++calls === 1
          ? new Response('{}', { status: 429, headers: header ? { 'Retry-After': header } : {} })
          : new Response('ok')),
      });
      assert.equal(await pool('test', {}, r => r.text()), 'ok');
      assert.equal(clock, header?.startsWith('Thu,') ? 5000 : 1000);
    }
  });

  it('bounds retries and never retries expired/private/missing content or network errors', async () => {
    const { createInvitationRequestPool } = await import(moduleUrl);
    let clock = 0;
    let calls = 0;
    const pool = createInvitationRequestPool({
      now: () => clock, wait: async ms => { clock += ms; },
      fetchRequest: async (url, options, read) => { calls++; return read(new Response('{}', { status: 429 })); },
    });
    await assert.rejects(pool('test', {}, r => r.text()), { httpStatus: 429 });
    assert.equal(calls, 3);
    for (const status of [401, 403, 404, 410, 503]) {
      calls = 0;
      const terminal = createInvitationRequestPool({ fetchRequest: async (url, options, read) => {
        calls++; return read(new Response('{}', { status }));
      } });
      assert.equal(await terminal('test', {}, r => r.status), status);
      assert.equal(calls, 1);
    }
    const offline = createInvitationRequestPool({ fetchRequest: async () => { throw new TypeError('offline'); } });
    await assert.rejects(offline('test', {}, r => r.text()), /offline/);
  });

  it('does not sleep or send queued requests before an excessive server cooldown', async () => {
    const { createInvitationRequestPool } = await import(moduleUrl);
    let calls = 0;
    const pool = createInvitationRequestPool({ concurrency: 1, now: () => 0,
      wait: async () => { assert.fail('Unbounded sleep'); },
      fetchRequest: async (url, options, read) => {
        calls++; return read(new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } }));
      },
    });
    await assert.rejects(pool('first', {}, r => r.text()), { httpStatus: 429, retryAfterMs: 3600000 });
    await assert.rejects(pool('next', {}, r => r.text()), { httpStatus: 429 });
    assert.equal(calls, 1);
  });
});
