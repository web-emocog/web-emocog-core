const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStaffSession } = require('../../web/staff-session');
const { createHttpClient } = require('../../web/http-client');

function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
}

function fixture(fetch) {
  const local = storage({ emocog_workspace_owner_v1: '1' });
  const tab = storage({ emocog_csrf_token: 'stale' });
  let blocks = 0;
  const session = createStaffSession({ storage: local, sessionStorage: tab,
    fetch, apiBase: 'https://api.example.test', onBlocked: () => { blocks++; } });
  return { local, tab, session, blocks: () => blocks };
}

test('staff tab sends its fixed identity and preserves multipart content', async () => {
  const form = new FormData();
  form.append('project_id', '7');
  form.append('file', new Blob(['test'], { type: 'image/png' }), 'test.png');
  const { session } = fixture(async request => {
    assert.equal(request.headers.get('X-Staff-User-ID'), '1');
    assert.equal(request.credentials, 'include');
    assert.equal((await request.formData()).get('file').name, 'test.png');
    return Response.json({ id: 42 });
  });
  assert.equal((await session.fetch('https://api.example.test/stimuli/upload', {
    method: 'POST', body: form, credentials: 'include'
  })).status, 200);
});

test('stale tab cannot send a request after another account becomes active', async () => {
  let calls = 0;
  const { session, local, blocks } = fixture(async () => { calls++; });
  local.setItem('emocog_workspace_owner_v1', '2');
  await assert.rejects(session.fetch('https://api.example.test/stimuli'), { code: 'staff_account_changed' });
  assert.equal(calls, 0);
  assert.equal(blocks(), 1);
  assert.throws(() => session.bind(2), { code: 'staff_account_changed' });
});

test('late response is rejected after an account switch', async () => {
  let release;
  const { session, local } = fixture(() => new Promise(resolve => { release = resolve; }));
  const pending = session.fetch('https://api.example.test/stimuli');
  local.setItem('emocog_workspace_owner_v1', '2');
  release(Response.json([{ id: 42 }]));
  await assert.rejects(pending, { code: 'staff_account_changed' });
});

test('server identity mismatch locks the tab instead of refreshing another account CSRF', async () => {
  let calls = 0;
  const { session, blocks } = fixture(async () => {
    calls++;
    return Response.json({ code: 'staff_account_changed' }, { status: 409 });
  });
  await assert.rejects(session.fetch('https://api.example.test/stimuli/upload', { method: 'POST' }), { code: 'staff_account_changed' });
  assert.equal(calls, 1);
  assert.equal(blocks(), 1);
});

test('CSRF is refreshed once for the same staff user and a rejected multipart upload is replayed', async () => {
  const received = [];
  const { session, tab } = fixture(async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    received.push(request);
    if (request.url.endsWith('/auth/me')) return Response.json({ id: 1, csrf_token: 'fresh' });
    const form = await request.formData();
    assert.equal(form.get('file').name, 'test.png');
    return request.headers.get('X-CSRF-Token') === 'fresh'
      ? Response.json({ id: 42 }) : Response.json({ code: 'csrf_token_invalid' }, { status: 403 });
  });
  const body = new FormData();
  body.append('file', new Blob(['content']), 'test.png');
  const response = await session.fetch('https://api.example.test/stimuli/upload', {
    method: 'POST', body, credentials: 'include', headers: { 'X-CSRF-Token': 'stale' }
  });
  assert.equal(response.status, 200);
  assert.equal(received.length, 3);
  assert.equal(tab.getItem('emocog_csrf_token'), 'fresh');
});

test('CSRF refresh never adopts a different authenticated user', async () => {
  let calls = 0;
  const { session, tab } = fixture(async () => {
    calls++;
    return calls === 1 ? Response.json({ code: 'csrf_token_invalid' }, { status: 403 })
      : Response.json({ id: 2, csrf_token: 'other-account-secret' });
  });
  await assert.rejects(session.fetch('https://api.example.test/stimuli/upload', { method: 'POST' }), { code: 'staff_account_changed' });
  assert.equal(calls, 2);
  assert.equal(tab.getItem('emocog_csrf_token'), 'stale');
});

test('other permission failures and network failures are not replayed', async () => {
  let calls = 0;
  const { session } = fixture(async () => {
    calls++;
    return Response.json({ code: 'stimulus_not_owned' }, { status: 403 });
  });
  assert.equal((await session.fetch('https://api.example.test/stimuli/42', { method: 'PATCH' })).status, 403);
  assert.equal(calls, 1);
  const network = fixture(async () => { throw new Error('offline'); });
  await assert.rejects(network.session.fetch('https://api.example.test/stimuli/42', { method: 'PATCH' }), /offline/);
});

test('a cancelled write cannot replay after its shared CSRF refresh completes', async () => {
  let release, refreshStarted;
  const started = new Promise(resolve => { refreshStarted = resolve; });
  const writes = [];
  const { session } = fixture(async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    if (request.url.endsWith('/auth/me')) {
      refreshStarted();
      return new Promise(resolve => { release = resolve; });
    }
    writes.push(request);
    return Response.json({ code: 'csrf_token_invalid' }, { status: 403 });
  });
  const controller = new AbortController();
  const pending = session.fetch('https://api.example.test/stimuli/42', { method: 'PATCH', signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'request_cancelled' });
  await started;
  controller.abort();
  release(Response.json({ id: 1, csrf_token: 'fresh' }));
  await rejected;
  assert.equal(writes.length, 1);
});

test('a write deadline prevents a late CSRF refresh from causing another submission', async () => {
  let release, writes = 0;
  const { session } = fixture(async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    if (request.url.endsWith('/auth/me')) return new Promise(resolve => { release = resolve; });
    writes++;
    return Response.json({ code: 'csrf_token_invalid' }, { status: 403 });
  });
  const client = createHttpClient({ fetch: session.fetch });
  await assert.rejects(client.json('https://api.example.test/stimuli/42', { method: 'PATCH' }, { timeoutMs: 25 }),
    { code: 'request_timeout', mutationMayHaveCommitted: true });
  assert.equal(typeof release, 'function');
  release(Response.json({ id: 1, csrf_token: 'fresh' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1);
  assert.equal(client.pendingCount(), 0);
});

test('cancelling one write does not cancel another write sharing the same CSRF refresh', async () => {
  let release, refreshStarted, refreshCalls = 0;
  const started = new Promise(resolve => { refreshStarted = resolve; });
  const writes = [];
  const { session } = fixture(async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    if (request.url.endsWith('/auth/me')) {
      refreshCalls++; refreshStarted();
      return new Promise(resolve => { release = resolve; });
    }
    writes.push(request.url);
    return request.headers.get('X-CSRF-Token') === 'fresh'
      ? Response.json({ ok: true }) : Response.json({ code: 'csrf_token_invalid' }, { status: 403 });
  });
  const controller = new AbortController();
  const first = session.fetch('https://api.example.test/stimuli/41', { method: 'PATCH', signal: controller.signal });
  const rejected = assert.rejects(first, { code: 'request_cancelled' });
  await started;
  const second = session.fetch('https://api.example.test/stimuli/42', { method: 'PATCH' });
  // Let the second pre-route rejection join the pending single-flight refresh.
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  release(Response.json({ id: 1, csrf_token: 'fresh' }));
  await rejected;
  assert.equal((await second).status, 200);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(writes, ['https://api.example.test/stimuli/41', 'https://api.example.test/stimuli/42', 'https://api.example.test/stimuli/42']);
});

test('a temporary CSRF refresh failure keeps the tab usable and permits a later explicit attempt', async () => {
  let refreshCalls = 0, writes = 0;
  const { session, tab, blocks } = fixture(async (input, options) => {
    const request = input instanceof Request ? input : new Request(input, options);
    if (request.url.endsWith('/auth/me')) {
      return ++refreshCalls === 1 ? Response.json({ error: 'Unavailable' }, { status: 503 })
        : Response.json({ id: 1, csrf_token: 'fresh' });
    }
    writes++;
    return request.headers.get('X-CSRF-Token') === 'fresh'
      ? Response.json({ ok: true }) : Response.json({ code: 'csrf_token_invalid' }, { status: 403 });
  });
  await assert.rejects(session.fetch('https://api.example.test/stimuli/42', { method: 'PATCH' }), { status: 503 });
  assert.equal(tab.getItem('emocog_csrf_token'), 'stale');
  assert.equal(blocks(), 0);
  session.assertCurrent();
  assert.equal((await session.fetch('https://api.example.test/stimuli/42', { method: 'PATCH' })).status, 200);
  assert.equal(refreshCalls, 2);
  assert.equal(writes, 3);
});
