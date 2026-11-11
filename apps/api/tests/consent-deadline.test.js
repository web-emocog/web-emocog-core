const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js/web-page/consent-signature.js'), 'utf8');

function setup(fetch, debug) {
  let deadline, cleared = 0;
  const consoleCalls = [];
  const context = { window: { WECOG_DEBUG: debug }, navigator: {}, crypto: require('node:crypto').webcrypto,
    TextEncoder, AbortController, fetch,
    setTimeout(callback, ms) { assert.equal(ms, 15000); deadline = callback; return 1; },
    clearTimeout(id) { assert.equal(id, 1); cleared++; },
    console: { log: (...args) => consoleCalls.push(args), error: (...args) => consoleCalls.push(args) } };
  vm.runInNewContext(source, context);
  return { api: context.window.ConsentSignature, expire: () => deadline(), cleared: () => cleared, consoleCalls };
}

test('consent download deadline includes a stalled response body and never saves a failed signature', async () => {
  let signal;
  const f = setup(async (_url, options) => {
    signal = options.signal;
    return { ok: true, text: () => new Promise((_resolve, reject) => signal.addEventListener('abort',
      () => reject(new Error('aborted')), { once: true })) };
  });
  const state = { sessionData: {} };
  const pending = f.api.signDocument('informed_consent', '/documents/v1.0.html', 'synthetic', state);
  await new Promise(resolve => setImmediate(resolve)); f.expire();
  assert.equal(await pending, false); assert.equal(signal.aborted, true);
  assert.equal(f.cleared(), 1); assert.equal(state.sessionData.consent, undefined);
});

test('successful consent retains the exact SHA-256 and clears its deadline', async () => {
  const f = setup(async () => ({ ok: true, text: async () => '<p>synthetic consent</p>' }));
  const document = await f.api.loadDocumentAndHash('/documents/v2.3.html');
  assert.equal(document.hash, require('node:crypto').createHash('sha256').update('<p>synthetic consent</p>').digest('hex'));
  assert.equal(document.version, '2.3'); assert.equal(f.cleared(), 1);
});

test('consent failures only emit fixed optional codes, not the document URL, participant or error', async () => {
  const entries = [];
  const debug = { enabled: true, error: (...args) => entries.push(args) };
  const f = setup(async () => { throw new Error('private-marker-for-consent'); }, debug);
  const state = { sessionData: {} };
  assert.equal(await f.api.signDocument('informed_consent', '/synthetic-private-url', 'synthetic-private-id', state), false);
  assert.equal(state.sessionData.consent, undefined);
  assert.deepEqual(f.consoleCalls, []);
  assert.deepEqual(entries, [['consent', 'document:load-failed'], ['consent', 'signature:failed']]);
});
