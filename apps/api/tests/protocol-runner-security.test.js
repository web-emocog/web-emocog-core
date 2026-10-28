const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js/protocol-runner-new.js'), 'utf8');

test('legacy invitation loading aborts a stalled JSON body without applying a partial definition', async () => {
  let expire, cleared = 0, signal;
  const context = { window: { location: { origin: 'http://127.0.0.1' }, addEventListener() {}, removeEventListener() {} }, AbortController,
    setTimeout(callback, ms) { assert.equal(ms, 15000); expire = callback; return 1; },
    clearTimeout(id) { assert.equal(id, 1); cleared++; },
    fetch: async (_url, options) => {
      signal = options.signal;
      return { ok: true, json: () => new Promise((_resolve, reject) => signal.addEventListener('abort',
        () => reject(new Error('synthetic_abort')), { once: true })) };
    } };
  vm.runInNewContext(source, context);
  const runner = context.window.ProtocolRunner;
  const pending = runner.loadByCode('synthetic');
  const rejected = assert.rejects(pending, { name: 'AbortError', code: 'protocol_load_cancelled' });
  await new Promise(resolve => setImmediate(resolve)); expire(); await rejected;
  assert.equal(signal.aborted, true); assert.equal(cleared, 1);
  assert.equal(runner.getDefinition(), null);
});

function harness(fetch) {
  const listeners = new Set(), deadlines = new Map(); let sequence = 0;
  const context = { window: { location: { origin: 'http://127.0.0.1' },
    addEventListener(type, callback) { assert.equal(type, 'pagehide'); listeners.add(callback); },
    removeEventListener(type, callback) { assert.equal(type, 'pagehide'); listeners.delete(callback); } },
    AbortController, fetch, setTimeout(callback) { deadlines.set(++sequence, callback); return sequence; },
    clearTimeout(id) { deadlines.delete(id); } };
  vm.createContext(context); vm.runInContext(source, context);
  return { context, listeners, deadlines, api: () => context.window.ProtocolRunner,
    reload: () => vm.runInContext(source, context) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = title => ({ ok: true, json: async () => ({ definition: { blocks: [{ type: 'instruction', params: { title } }] } }) });

for (const stage of ['headers', 'body']) test(`legacy deadline settles even if stalled ${stage} ignore AbortSignal`, async () => {
  const h = harness(async () => stage === 'headers' ? new Promise(() => {}) : { ok: true, json: () => new Promise(() => {}) });
  const pending = h.api().loadByCode('synthetic');
  const rejected = assert.rejects(pending, { name: 'AbortError', code: 'protocol_load_cancelled' });
  await flush(); [...h.deadlines.values()][0](); await rejected;
  assert.equal(h.deadlines.size, 0); assert.equal(h.api().getDefinition(), null);
});

test('a late invitation cannot replace the newer definition, even when its body ignores abort', async () => {
  let resolveOld;
  const h = harness(async url => url.endsWith('/old')
    ? { ok: true, json: () => new Promise(resolve => { resolveOld = resolve; }) } : response('new'));
  const old = h.api().loadByCode('old'); const rejected = assert.rejects(old, { name: 'AbortError' });
  await flush(); await h.api().loadByCode('new'); await rejected;
  resolveOld({ definition: { blocks: [{ type: 'instruction', params: { title: 'old' } }] } });
  await flush(); assert.equal(h.api().getCurrentBlock().params.title, 'new');
  assert.equal(h.deadlines.size, 0);
});

test('stop/pagehide/reload cancel pending loads without retaining lifecycle handlers', async () => {
  const h = harness(async () => new Promise(() => {}));
  for (let i = 0; i < 100; i++) {
    const old = h.api(); const pending = old.loadByCode('synthetic');
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await flush();
    if (i % 2) [...h.listeners][0](); else old.stop();
    await rejected; assert.equal(h.deadlines.size, 0);
    h.reload(); assert.equal(h.listeners.size, 1);
    await assert.rejects(old.loadByCode('disposed'), { name: 'AbortError' });
  }
  h.api().dispose(); assert.equal(h.listeners.size, 0);
});

test('failed invitation leaves the prior definition intact and releases its deadline', async () => {
  const h = harness(async () => response('retained')); await h.api().loadByCode('good');
  h.context.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
  await assert.rejects(h.api().loadByCode('missing'), /HTTP 404/);
  assert.equal(h.api().getCurrentBlock().params.title, 'retained'); assert.equal(h.deadlines.size, 0);
  assert.throws(() => h.api().start({}), /Load a protocol successfully/);
});
