import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithDeadline, withRequestAbort } from '../../participant-web/js/session-runtime/http.mjs';
import { fetchMediaWithDeadline } from '../../participant-web/js/session-runtime/media-preload.mjs';
import { createInvitationRequestPool } from '../../participant-web/js/session-runtime/invitation-http.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('an already aborted request never fetches or reads, including the media facade', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; });
  const controller = new AbortController();
  controller.abort(new Error('synthetic-secret-not-for-errors'));
  for (const request of [fetchWithDeadline, fetchMediaWithDeadline]) {
    await assert.rejects(request('/synthetic', { signal: controller.signal }, () => assert.fail('Unexpected read')),
      { name: 'AbortError', message: 'Request cancelled' });
  }
  assert.equal(calls, 0);
});

test('a late response after caller cancellation cannot run its reader or retain the body', async t => {
  const pendingResponse = deferred();
  let signal, reads = 0, cancelled = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { signal = options.signal; return pendingResponse.promise; });
  const controller = new AbortController();
  const pending = fetchWithDeadline('/synthetic', { signal: controller.signal }, () => { reads++; }, 10000);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await tick();
  controller.abort();
  await rejected;
  assert.equal(signal.aborted, true);
  pendingResponse.resolve({ body: { cancel: async () => { cancelled++; } } });
  await tick();
  assert.equal(reads, 0);
  assert.equal(cancelled, 1);
});

test('header and body deadlines abort the actual request and release its body', async t => {
  for (const phase of ['headers', 'body']) {
    let signal, cancelled = 0;
    const response = { json: () => new Promise(() => {}), body: { cancel: async () => { cancelled++; } } };
    const mock = t.mock.method(globalThis, 'fetch', async (_url, options) => {
      signal = options.signal;
      return phase === 'headers' ? new Promise(() => {}) : response;
    });
    await assert.rejects(fetchWithDeadline('/synthetic', {}, r => r.json(), 10),
      { code: 'request_timeout', httpStatus: 408 });
    assert.equal(signal.aborted, true);
    assert.equal(cancelled, phase === 'body' ? 1 : 0);
    mock.mock.restore();
  }
});

test('abort listeners are removed even when the underlying operation never settles', async t => {
  const controller = new AbortController();
  const added = t.mock.method(controller.signal, 'addEventListener');
  const removed = t.mock.method(controller.signal, 'removeEventListener');
  const pending = withRequestAbort(new Promise(() => {}), controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await rejected;
  assert.equal(added.mock.callCount(), 1);
  assert.equal(removed.mock.callCount(), 1);
});

test('a queued cancelled file is rejected immediately without issuing a request', async () => {
  const hold = deferred(), started = deferred();
  const calls = [];
  const pool = createInvitationRequestPool({ concurrency: 1, fetchRequest: async (url, _options, read) => {
    calls.push(url);
    if (url === 'first') { started.resolve(); await hold.promise; }
    return read(new Response('ok'));
  } });
  const first = pool('first', {}, r => r.text());
  await started.promise;
  const controller = new AbortController();
  const second = pool('cancelled', { signal: controller.signal }, r => r.text());
  const rejected = assert.rejects(second, { name: 'AbortError' });
  controller.abort();
  await rejected;
  hold.resolve();
  assert.equal(await first, 'ok');
  assert.equal(await pool('third', {}, r => r.text()), 'ok');
  assert.deepEqual(calls, ['first', 'third']);
});

test('cancelling cooldown releases its slot but does not bypass shared Retry-After', async () => {
  const waiting = deferred();
  let clock = 0, waits = 0;
  const calls = [];
  const pool = createInvitationRequestPool({ concurrency: 1, now: () => clock,
    wait: ms => {
      if (++waits === 1) { waiting.resolve(); return new Promise(() => {}); }
      clock += ms;
      return Promise.resolve();
    },
    fetchRequest: async (url, _options, read) => {
      calls.push([url, clock]);
      return read(url === 'cancelled'
        ? new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }) : new Response('ok'));
    } });
  const controller = new AbortController();
  const cancelled = pool('cancelled', { signal: controller.signal }, r => r.text());
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  await waiting.promise;
  const next = pool('next', {}, r => r.text());
  controller.abort();
  await rejected;
  assert.equal(await next, 'ok');
  assert.deepEqual(calls, [['cancelled', 0], ['next', 60000]]);
});

test('queue forwards the request deadline signal to streaming readers', async t => {
  let fetchSignal, readSignal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    fetchSignal = options.signal;
    return new Response('ok');
  });
  const pool = createInvitationRequestPool({ fetchRequest: fetchMediaWithDeadline });
  assert.equal(await pool('/synthetic', {}, (response, signal) => { readSignal = signal; return response.text(); }), 'ok');
  assert.equal(fetchSignal, readSignal);
  assert.equal(readSignal.aborted, false);
});

test('request limits reject invalid configurations rather than leaving a silent queue', async () => {
  for (const timeout of [0, -1, Infinity, NaN]) {
    await assert.rejects(fetchWithDeadline('/synthetic', {}, r => r.text(), timeout), TypeError);
  }
  for (const concurrency of [0, -1, 9, 1.5]) {
    assert.throws(() => createInvitationRequestPool({ concurrency }), TypeError);
  }
});
