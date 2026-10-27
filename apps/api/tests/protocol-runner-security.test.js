const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js/protocol-runner-new.js'), 'utf8');

test('legacy invitation loading aborts a stalled JSON body without applying a partial definition', async () => {
  let expire, cleared = 0, signal;
  const context = { window: { location: { origin: 'http://127.0.0.1' } }, AbortController,
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
  const rejected = assert.rejects(pending, /synthetic_abort/);
  await new Promise(resolve => setImmediate(resolve)); expire(); await rejected;
  assert.equal(signal.aborted, true); assert.equal(cleared, 1);
  assert.equal(runner.getDefinition(), null);
});
