const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createHash, webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '../../participant-web/js/session-runtime');
const load = name => import(pathToFileURL(path.join(root, name)).href);
const bytes = new Uint8Array(1024).fill(42);
const hash = value => createHash('sha256').update(value).digest('hex');
const descriptor = (id, overrides = {}) => ({ sourceUrl: `https://local.test/media/${id}`, mimeType: 'image/png',
  version: 'v1', sha256: hash(bytes), sizeBytes: bytes.length, ...overrides });

function fixture({ budgetBytes = 8 * 1024, scope = 'publication-1', handler } = {}) {
  const requests = [], revoked = [], allocated = [], stats = [];
  let online = true, activeProbes = 0, peakProbes = 0;
  const environment = { crypto: webcrypto, URL: {
    createObjectURL(blob) { const url = URL.createObjectURL(blob); allocated.push(url); return url; },
    revokeObjectURL(url) { revoked.push(url); URL.revokeObjectURL(url); }
  } };
  const request = async (url, options, read) => {
    requests.push(url);
    if (!online) throw new TypeError('synthetic offline');
    return read(handler ? await handler(url, options) : new Response(bytes, { headers: { 'Content-Type': 'image/png' } }), options.signal);
  };
  const probe = async (blob, mime, { signal }) => {
    assert.equal(signal.aborted, false);
    peakProbes = Math.max(peakProbes, ++activeProbes);
    await Promise.resolve(); activeProbes--;
    return environment.URL.createObjectURL(blob);
  };
  return { scope, budgetBytes, request, probe, environment, requests, revoked, allocated, stats,
    onChange(stat) { stats.push(stat); assert.ok(stat.residentBytes + stat.workingBytes <= budgetBytes); },
    offline() { online = false; }, online() { online = true; }, peakProbes: () => peakProbes };
}

test('a 4,000-file synthetic protocol and many video blocks stay within the managed byte budget', async () => {
  const { createMediaCache } = await load('media-cache.mjs');
  const f = fixture({ budgetBytes: 32 * 1024 }), cache = createMediaCache(f);
  for (let block = 0; block < 200; block++) {
    const rows = Array.from({ length: 20 }, (_, i) => descriptor(block * 20 + i,
      { mimeType: block % 2 ? 'video/mp4' : 'image/png' }));
    const lease = await cache.prepare(rows);
    assert.equal(cache.snapshot().pinnedEntries, 20);
    assert.ok(rows.every(row => lease.urlFor(row)?.startsWith('blob:')));
    lease.release();
  }
  assert.equal(f.requests.length, 4000);
  assert.equal(f.peakProbes(), 1, 'only one temporary decoder per cache');
  assert.ok(cache.snapshot().peakBytes <= f.budgetBytes);
  assert.ok(cache.snapshot().residentBytes <= f.budgetBytes);
  assert.ok(f.revoked.length > 3900, 'old blocks are evicted, not retained for protocol lifetime');
  cache.dispose();
  assert.equal(cache.snapshot().residentBytes, 0);
  assert.equal(cache.snapshot().workingBytes, 0);
  assert.deepEqual(new Set(f.revoked), new Set(f.allocated));
  assert.equal(f.revoked.length, f.allocated.length, 'each owned URL revoked once');
});

test('repeated references and aliases share pinned handles; active media cannot be evicted, even on dispose', async () => {
  const { createMediaCache } = await load('media-cache.mjs');
  const f = fixture({ budgetBytes: 3 * 1024 }), cache = createMediaCache(f), row = descriptor(1);
  const active = await cache.prepare(Array(1000).fill(row));
  const url = active.urlFor(row);
  const repeated = await cache.prepare([{ ...row }]);
  assert.equal(repeated.urlFor(row), url);
  repeated.release();
  await assert.rejects(cache.prepare([descriptor(2)]), { code: 'media_budget_exceeded' });
  assert.equal(cache.snapshot().pinnedEntries, 1);
  assert.deepEqual(f.revoked, []);
  cache.dispose();
  assert.equal(active.valid(), false);
  assert.equal((await fetch(url)).ok, true, 'playback owner still holds the bytes');
  active.release(); active.release(); cache.dispose();
  assert.deepEqual(f.revoked, [url]);
  assert.equal(cache.snapshot().entries, 0);
});

test('blocks too large for resident bytes fail before downloading; download workspace is also bounded', async () => {
  const { createMediaCache } = await load('media-cache.mjs');
  const f = fixture(), cache = createMediaCache(f);
  await assert.rejects(cache.prepare(Array.from({ length: 9 }, (_, i) => descriptor(i))), { code: 'media_budget_exceeded' });
  assert.equal(f.requests.length, 0);
  const streaming = fixture({ budgetBytes: 2 * 1024 }), other = createMediaCache(streaming);
  await assert.rejects(other.prepare([descriptor(1, { sizeBytes: null })]), { code: 'media_budget_exceeded' });
  assert.equal(other.snapshot().workingBytes, 0);
  assert.equal(other.snapshot().entries, 0);
  cache.dispose(); other.dispose();
});

test('unknown-length large video stream is cancelled at the budget boundary, not buffered or played remotely', async () => {
  const { createMediaCache } = await load('media-cache.mjs');
  let cancelled = false, chunks = 0;
  const f = fixture({ handler: () => new Response(new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(bytes); }, cancel() { cancelled = true; }
  }), { headers: { 'Content-Type': 'video/mp4' } }) });
  const cache = createMediaCache(f);
  await assert.rejects(cache.prepare([descriptor(1, { mimeType: 'video/mp4', sizeBytes: null, sha256: null })]), { code: 'media_budget_exceeded' });
  assert.equal(cancelled, true);
  assert.ok(chunks <= 4);
  assert.equal(f.allocated.length, 0);
  assert.equal(cache.snapshot().workingBytes, 0);
  cache.dispose();
});

test('offline block retry keeps successful bytes and only downloads missing content', async () => {
  const { createMediaCache } = await load('media-cache.mjs');
  let failing = true;
  const f = fixture({ handler: url => {
    if (url.endsWith('/2') && failing) throw new TypeError('synthetic offline');
    return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
  } });
  const cache = createMediaCache(f), rows = [descriptor(1), descriptor(2)];
  await assert.rejects(cache.prepare(rows), /offline/);
  assert.equal(cache.snapshot().residentBytes, 1024);
  assert.equal(cache.snapshot().pinnedEntries, 0);
  failing = false;
  const lease = await cache.prepare(rows);
  assert.equal(f.requests.filter(url => url.endsWith('/1')).length, 1);
  assert.equal(f.requests.filter(url => url.endsWith('/2')).length, 2);
  const urls = rows.map(row => lease.urlFor(row));
  lease.release(); f.offline();
  const offline = await cache.prepare(rows);
  assert.deepEqual(rows.map(row => offline.urlFor(row)), urls);
  offline.release(); cache.dispose();
  const reloaded = createMediaCache(f);
  await assert.rejects(reloaded.prepare(rows), /offline/, 'reload does not resurrect revoked Blob URLs');
  reloaded.dispose();
});

test('SHA, size, version, source and publication pinning cannot silently reuse stale media', async () => {
  const { createMediaCache, mediaContentKey } = await load('media-cache.mjs');
  const f = fixture(), cache = createMediaCache(f), row = descriptor(1);
  const a = await cache.prepare([row]); a.release();
  const b = await cache.prepare([descriptor(1, { version: 'v2' })]); b.release();
  const c = await cache.prepare([descriptor(2)]); c.release();
  assert.equal(f.requests.length, 3);
  assert.notEqual(mediaContentKey('p1', row), mediaContentKey('p2', row));
  assert.notEqual(mediaContentKey('p1', row), mediaContentKey('p1', { ...row, sha256: '0'.repeat(64) }));
  await assert.rejects(cache.prepare([descriptor(3, { sha256: '0'.repeat(64) })]), { code: 'media_hash_mismatch' });
  await assert.rejects(cache.prepare([descriptor(3, { sha256: 'invalid' })]), { code: 'media_hash_invalid' });
  await assert.rejects(cache.prepare([descriptor(3, { sizeBytes: 1 })]), { code: 'media_size_mismatch' });
  cache.dispose();
});

test('scope cancellation drains stalled streams without late cache or manifest writes', async () => {
  const { createBlockMediaPreparation } = await load('block-media-preparation.mjs');
  let cancelled = false, notify;
  const started = new Promise(resolve => { notify = resolve; });
  const f = fixture({ handler: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); notify(); }, cancel() { cancelled = true; }
  }), { headers: { 'Content-Type': 'image/png' } }) });
  const rows = { '1': { id: '1', mime_type: 'image/png', metadata: { source_url: descriptor(1).sourceUrl } } };
  const manager = createBlockMediaPreparation({ ...f, rows });
  const block = { trials: [{ stimulus: { type: 'image', stimulusId: '1', src: '' } }] };
  const pending = manager.prepareBlock(block);
  await started; manager.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.equal(manager.cache.snapshot().workingBytes, 0);
  assert.equal(manager.cache.snapshot().entries, 0);
  assert.equal(block.trials[0].stimulus.src, '');
  assert.ok(!rows['1'].metadata.url);
});

test('new block scopes cannot evict an active trial and never revoke user-owned URLs', async () => {
  const { createBlockMediaPreparation } = await load('block-media-preparation.mjs');
  const f = fixture(), userUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  const manager = createBlockMediaPreparation({ ...f, requireManifest: false });
  const block = { trials: [{ stimulus: { type: 'image', src: userUrl, stimulusId: 'custom' } }] };
  const lease = await manager.prepareBlock(block);
  const preparedUrl = block.trials[0].stimulus.src;
  assert.notEqual(preparedUrl, userUrl);
  assert.equal(block.trials[0].stimulus.fallbackSrc, undefined);
  await assert.rejects(manager.prepareBlock({ trials: [] }), { code: 'media_block_active' });
  manager.dispose();
  assert.equal((await fetch(preparedUrl)).ok, true);
  manager.releaseBlock();
  assert.equal(lease.valid(), false);
  assert.equal((await fetch(userUrl)).ok, true);
  assert.deepEqual(f.revoked, [preparedUrl]);
  URL.revokeObjectURL(userUrl);
});

test('shared 429 cooldown applies to bounded preparation and offline failure is recoverable', async () => {
  const { createMediaCache } = await load('media-cache.mjs');
  const { createInvitationRequestPool } = await load('invitation-http.mjs');
  const f = fixture();
  let clock = 0, limited = false;
  const calls = [];
  const request = createInvitationRequestPool({ now: () => clock, wait: async ms => { clock += ms; },
    fetchRequest: async (url, options, read) => {
      calls.push({ url, clock });
      if (!limited) { limited = true; return read(new Response('', { status: 429, headers: { 'Retry-After': '2' } })); }
      return read(new Response(bytes), options.signal);
    } });
  const cache = createMediaCache({ ...f, request });
  const lease = await cache.prepare([descriptor(1), descriptor(2)]);
  assert.deepEqual(calls.map(call => call.clock), [0, 2000, 2000]);
  assert.equal(cache.snapshot().pinnedEntries, 2);
  lease.release(); cache.dispose();
});

test('pre-aborted preparation does no work; stale descriptor results do not bind a newer block', async () => {
  const { createMediaCache } = await load('media-cache.mjs');
  const { createBlockMediaPreparation } = await load('block-media-preparation.mjs');
  const f = fixture(), cache = createMediaCache(f), controller = new AbortController();
  controller.abort();
  await assert.rejects(cache.prepare([descriptor(1)], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.requests.length, 0); cache.dispose();
  const manager = createBlockMediaPreparation({ ...f, requireManifest: false });
  const old = { trials: [{ stimulus: { type: 'image', src: descriptor(1).sourceUrl } }] };
  const next = { trials: [{ stimulus: { type: 'image', src: descriptor(2).sourceUrl } }] };
  const pending = manager.prepareBlock(old);
  const rejection = assert.rejects(pending, { name: 'AbortError' });
  const ready = await manager.prepareBlock(next);
  await rejection;
  assert.equal(old.trials[0].stimulus.preparedMedia, undefined);
  assert.ok(next.trials[0].stimulus.src.startsWith('blob:'));
  ready.release(); manager.releaseBlock(); manager.dispose();
});

test('late release from an old scope does not clear a newer scope binding on the same trial object', async () => {
  const { createBlockMediaPreparation } = await load('block-media-preparation.mjs');
  const f = fixture(), block = { trials: [{ stimulus: { type: 'image', src: descriptor(1).sourceUrl } }] };
  const old = createBlockMediaPreparation({ ...f, requireManifest: false });
  await old.prepareBlock(block); old.dispose();
  const next = createBlockMediaPreparation({ ...f, scope: 'publication-2', requireManifest: false });
  await next.prepareBlock(block);
  const url = block.trials[0].stimulus.src;
  old.releaseBlock();
  assert.equal(block.trials[0].stimulus.src, url);
  next.releaseBlock(); next.dispose();
});

test('external cancellation and deadline abort stalled fetch/body reads, not only response headers', async () => {
  const { fetchMediaWithDeadline, readMediaResponse } = await load('media-preload.mjs');
  const original = global.fetch;
  try {
    for (const deadline of [false, true]) {
      let bodyCancelled = false, fetchSignal, started;
      const ready = new Promise(resolve => { started = resolve; });
      global.fetch = async (url, options) => {
        fetchSignal = options.signal;
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); started(); },
          cancel() { bodyCancelled = true; } }));
      };
      const controller = new AbortController();
      const pending = fetchMediaWithDeadline('https://local.test/stalled', { signal: controller.signal },
        (response, signal) => readMediaResponse(response, { signal, account() {}, maxBytes: 8192 }), deadline ? 10 : 1000);
      const rejected = assert.rejects(pending, deadline ? { code: 'request_timeout' } : { name: 'AbortError' });
      await ready;
      if (!deadline) controller.abort();
      await rejected;
      assert.equal(fetchSignal.aborted, true);
      assert.equal(bodyCancelled, true);
    }
  } finally { global.fetch = original; }
});

test('a pre-aborted decoder allocates nothing and a pending decoder releases on cancellation', async () => {
  const { preloadMediaBlob } = await load('media-preload.mjs');
  const controller = new AbortController(), revoked = [], probes = [];
  const environment = { URL: { createObjectURL: () => 'blob:cancel-test', revokeObjectURL: url => revoked.push(url) },
    setTimeout, clearTimeout, Image: class {
      constructor() { probes.push(this); }
      removeAttribute() { this.src = ''; }
    } };
  const pending = preloadMediaBlob(new Blob([bytes], { type: 'image/png' }), '', { environment, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(revoked, ['blob:cancel-test']);
  assert.equal(probes[0].src, '');
  assert.equal(probes[0].onload, null);
  await assert.rejects(preloadMediaBlob(new Blob([bytes]), '', { environment, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(probes.length, 1);
});
