const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStaffSession } = require('../../web/staff-session');

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
