const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHttpClient } = require('../../web/http-client');
const tick = () => new Promise(resolve => setImmediate(resolve));
const never = () => new Promise(() => {});

test('staff HTTP bounds stalled headers and bodies even when a fetch adapter ignores abort', async () => {
  for (const body of [false, true]) {
    let signal, calls = 0;
    const client = createHttpClient({ fetch: async (_, init) => {
      calls++; signal = init.signal;
      return body ? { ok: true, json: never } : never();
    } });
    await assert.rejects(client.json('https://api.test/private', {}, { timeoutMs: 15 }),
      { code: 'request_timeout', mutationMayHaveCommitted: false });
    assert.equal(signal.aborted, true); assert.equal(calls, 1); assert.equal(client.pendingCount(), 0);
  }
});

test('late headers cannot invoke a reader after the deadline', async () => {
  let release, reads = 0;
  const client = createHttpClient({ fetch: () => new Promise(resolve => { release = resolve; }) });
  await assert.rejects(client.request('https://api.test', {}, () => { reads++; }, { timeoutMs: 15 }), { code: 'request_timeout' });
  release(Response.json({ secret: 'old-data' })); await tick();
  assert.equal(reads, 0); assert.equal(client.pendingCount(), 0);
});

test('account, route and project changes reject an in-flight body before it can reach a consumer', async () => {
  for (const account of [true, false]) {
    let context = { owner: '1', key: 'project1/route1' }, release, applied = false, signal;
    const client = createHttpClient({ context: () => context, fetch: async (_, init) => {
      signal = init.signal; return { ok: true, json: () => new Promise(resolve => { release = resolve; }) };
    } });
    const pending = client.json('https://api.test').then(() => { applied = true; }); await tick();
    context = account ? { ...context, owner: '2' } : { ...context, key: 'project2/route2' };
    client.cancelChanged();
    await assert.rejects(pending, { code: account ? 'staff_account_changed' : 'request_context_changed' });
    release({ secret: 'previous-context' }); await tick();
    assert.equal(applied, false); assert.equal(signal.aborted, true); assert.equal(client.pendingCount(), 0);
  }
});

test('a caller abort is linked and a pre-aborted mutation is never sent', async () => {
  let calls = 0, signal;
  const client = createHttpClient({ fetch: (_, init) => { calls++; signal = init.signal; return never(); } });
  const cancelled = new AbortController(); cancelled.abort('do-not-log-this-reason');
  await assert.rejects(client.json('https://api.test', { method: 'POST', signal: cancelled.signal }),
    { code: 'request_cancelled', mutationMayHaveCommitted: false });
  assert.equal(calls, 0);
  const controller = new AbortController(); const pending = client.json('https://api.test', { signal: controller.signal });
  await tick(); controller.abort(); await assert.rejects(pending, { code: 'request_cancelled' });
  assert.equal(signal.aborted, true); assert.equal(client.pendingCount(), 0);
});

test('navigation cancels all requests without resending mutations and distinguishes uncertain writes', async () => {
  let calls = 0;
  const client = createHttpClient({ fetch: () => { calls++; return never(); } });
  const read = client.json('https://api.test');
  const write = client.json('https://api.test', { method: 'PATCH', body: '{}' }); await tick();
  client.cancelAll();
  await assert.rejects(read, { code: 'request_cancelled', mutationMayHaveCommitted: false });
  await assert.rejects(write, { code: 'request_cancelled', mutationMayHaveCommitted: true });
  assert.equal(calls, 2); assert.equal(client.pendingCount(), 0);
});

test('HTTP errors preserve status/code, including rate limits, and never cause a replay', async () => {
  for (const status of [401, 403, 409, 429, 500]) {
    let calls = 0;
    const client = createHttpClient({ fetch: async () => {
      calls++; return Response.json({ error: 'safe server reason', code: 'synthetic_failure' }, { status });
    } });
    await assert.rejects(client.json('https://api.test', { method: 'POST' }), { status, code: 'synthetic_failure' });
    assert.equal(calls, 1); assert.equal(client.pendingCount(), 0);
  }
});

test('offline mutations have an uncertain outcome without exposing credentials, URLs or payloads', async () => {
  const secret = 'synthetic-private-password'; let calls = 0;
  const client = createHttpClient({ fetch: async () => { calls++; throw new TypeError(secret); } });
  await assert.rejects(client.json('https://api.test/?code=' + secret, { method: 'POST', body: secret }), error => {
    assert.equal(error.code, 'request_network_error'); assert.equal(error.mutationMayHaveCommitted, true);
    assert.equal(JSON.stringify(error).includes(secret) || error.message.includes(secret), false); return true;
  });
  assert.equal(calls, 1);
});

test('an absolute deadline is checked after body consumption even before a delayed timer fires', async () => {
  let now = 0;
  const client = createHttpClient({ now: () => now, fetch: async () => ({ ok: true, json: async () => { now = 40; return {}; } }) });
  await assert.rejects(client.json('https://api.test', {}, { timeoutMs: 30 }), { code: 'request_timeout' });
});

test('large transfers have a distinct bounded budget and multipart content is preserved', async () => {
  let now = 0;
  const body = new FormData(); body.append('file', new Blob(['synthetic']), 'file.png');
  const client = createHttpClient({ now: () => now, fetch: async (_, init) => {
    assert.equal(init.body, body); assert.equal(init.credentials, 'include'); assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('content-type'), null);
    assert.equal(init.body.get('file').name, 'file.png'); now = 45000; return Response.json({ saved: true });
  } });
  assert.deepEqual(await client.json('https://api.test', { method: 'POST', body, credentials: 'include' }, { transfer: true }), { saved: true });
  assert.equal(client.pendingCount(), 0);
});

test('invalid policies and disallowed URLs fail before sending any request', async () => {
  let calls = 0;
  const client = createHttpClient({ validateUrl: url => url === 'https://api.test', fetch: async () => { calls++; } });
  for (const timeoutMs of [0, NaN, Infinity, -1, 600001, '30000']) {
    await assert.rejects(client.json('https://api.test', {}, { timeoutMs }), /invalid_request_deadline/);
  }
  await assert.rejects(client.json('https://foreign.test'), /invalid_request_url/);
  await assert.rejects(client.json('https://api.test', {}, { scope: 'ignore-identity' }), /invalid_request_scope/);
  await assert.rejects(client.request('https://api.test'), /response_reader_required/);
  assert.equal(calls, 0); assert.equal(client.pendingCount(), 0);
});

test('successful calls remove caller abort listeners and settle pending state over 100 cycles', async () => {
  let listeners = 0;
  const signal = { aborted: false, addEventListener() { listeners++; }, removeEventListener() { listeners--; } };
  const client = createHttpClient({ fetch: async () => Response.json({ ok: true }) });
  for (let i = 0; i < 100; i++) await client.json('https://api.test', { signal });
  assert.equal(listeners, 0); assert.equal(client.pendingCount(), 0);
});

test('all canonical staff pages load transport and protected-tab dependencies in order', () => {
  const root = path.resolve(__dirname, '../../web');
  const pages = ['researcher.html', 'developer.html', 'developer/accounts.html', 'developer/experiments.html',
    'developer/invite.html', 'developer/bpm-test.html', 'developer/body-pose-test.html',
    'developer/rt-test.html', 'developer/emotion-test.html', 'developer/audio-test.html'];
  for (const page of pages) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    assert.ok(source.indexOf('http-client.js') < source.indexOf('staff-session.js'), page);
    assert.ok(source.indexOf('account-storage.js') < source.indexOf('staff-session.js'), page);
    assert.ok(source.indexOf('staff-session.js') < source.indexOf('auth-guard.js'), page);
  }
  const login = fs.readFileSync(path.join(root, 'developer/login.html'), 'utf8');
  assert.ok(login.includes('http-client.js')); assert.ok(!login.includes('staff-session.js'));
  const invite = fs.readFileSync(path.join(root, 'developer/invite.html'), 'utf8');
  assert.ok(!invite.includes('firstAccessible') && !invite.includes('fallbackProtocolId'));
});
