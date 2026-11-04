const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js/session-runtime/media-preload.mjs')).href);

function environment(mode = 'ready') {
  const probes = [], revoked = [], timers = new Set();
  let releaseDecode;
  class Probe {
    constructor(kind) { this.kind = kind; this.complete = false; this.naturalWidth = this.videoWidth = mode === 'invalid' ? 0 : 10;
      this.naturalHeight = this.videoHeight = 10; this.loads = this.pauses = this.decodes = 0; probes.push(this); }
    set src(value) { this.value = value; if (this.kind === 'image') { this.complete = mode === 'ready'; queueMicrotask(() => this.fire()); } }
    get src() { return this.value; }
    fire() { if (!this.value || mode === 'idle') return; if (mode === 'error') this.onerror?.();
      else if (this.kind === 'video') this.onloadedmetadata?.(); else this.onload?.(); }
    load() { this.loads++; if (this.value) queueMicrotask(() => this.fire()); }
    decode() { this.decodes++; return mode === 'decode-error' ? Promise.reject(new Error('synthetic decode failure'))
      : mode === 'decode-pending' ? new Promise(resolve => { releaseDecode = resolve; }) : Promise.resolve(); }
    pause() { this.pauses++; }
    removeAttribute() { this.value = ''; }
  }
  const env = { Image: class extends Probe { constructor() { super('image'); } }, document: { createElement: () => new Probe('video') },
    URL: { createObjectURL: () => 'blob:owned-test', revokeObjectURL: url => revoked.push(url) },
    setTimeout(callback, delay) { const id = setTimeout(callback, delay); timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); } };
  return { env, probes, revoked, timers, release: () => releaseDecode?.() };
}

function assertReleased(fixture) {
  assert.equal(fixture.timers.size, 0);
  for (const probe of fixture.probes) {
    assert.equal(probe.src, ''); assert.equal(probe.onload, null); assert.equal(probe.onloadedmetadata, null); assert.equal(probe.onerror, null);
    if (probe.kind === 'video') { assert.equal(probe.pauses, 1); assert.equal(probe.loads, 2); }
  }
}

test('whole media preparation is bounded and results preserve row order', async () => {
  const { mapMediaPreloads } = await load();
  let active = 0, peak = 0;
  const rows = Array.from({ length: 500 }, (_, index) => index);
  let previousActive = 0, previousPeak = 0;
  await Promise.all(rows.map(async () => {
    previousPeak = Math.max(previousPeak, ++previousActive); await Promise.resolve(); previousActive--;
  }));
  assert.equal(previousPeak, 500, 'the original outer Promise.all has no whole-preparation admission limit');
  const results = await mapMediaPreloads(rows, async row => {
    peak = Math.max(peak, ++active); await Promise.resolve(); await Promise.resolve(); active--; return row * 2;
  });
  assert.equal(peak, 3); assert.equal(active, 0); assert.deepEqual(results, rows.map(row => row * 2));
});

test('a mapper failure drains in-flight tasks, stops new work, and preserves even a null rejection', async () => {
  const { mapMediaPreloads } = await load();
  let active = 0, calls = 0;
  await assert.rejects(mapMediaPreloads(Array(100).fill(0), async (_, index) => {
    calls++; active++; await Promise.resolve(); active--; if (index === 0) throw new Error('synthetic failure'); return index;
  }), /synthetic failure/);
  assert.equal(active, 0); assert.equal(calls, 3);
  let rejected = false;
  try { await mapMediaPreloads([1], async () => { throw null; }); } catch (error) { rejected = true; assert.equal(error, null); }
  assert.equal(rejected, true);
  await assert.rejects(mapMediaPreloads([], () => null, 0), TypeError);
  assert.deepEqual(await mapMediaPreloads([], () => null), []);
});

for (const kind of ['image', 'video']) {
  test(`${kind} probe is released on success without revoking the cached media URL`, async () => {
    const { preloadMediaBlob } = await load(), fixture = environment();
    const result = await preloadMediaBlob(new Blob(['x'], { type: `${kind}/test` }), '', { environment: fixture.env });
    assert.equal(result, 'blob:owned-test'); assert.deepEqual(fixture.revoked, []); assertReleased(fixture);
    if (kind === 'image') assert.equal(fixture.probes[0].decodes, 1);
  });

  for (const mode of ['error', 'invalid', 'idle']) test(`${kind} ${mode} releases handlers/timers/decoder and revokes only its failed URL`, async () => {
    const { preloadMediaBlob } = await load(), fixture = environment(mode);
    await assert.rejects(preloadMediaBlob(new Blob(['x'], { type: `${kind}/test` }), '', { environment: fixture.env, timeoutMs: 5 }));
    assert.deepEqual(fixture.revoked, ['blob:owned-test']); assertReleased(fixture);
  });
}

test('late image decode after timeout cannot restore a released probe or revoke twice', async () => {
  const { preloadMediaBlob } = await load(), fixture = environment('decode-pending');
  await assert.rejects(preloadMediaBlob(new Blob(['x'], { type: 'image/test' }), '', { environment: fixture.env, timeoutMs: 5 }), /timed out/);
  fixture.release(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(fixture.revoked, ['blob:owned-test']); assertReleased(fixture);
});

test('a rejected image decode releases its probe and cached URL', async () => {
  const { preloadMediaBlob } = await load(), fixture = environment('decode-error');
  await assert.rejects(preloadMediaBlob(new Blob(['x'], { type: 'image/test' }), '', { environment: fixture.env }), /could not be decoded/);
  assert.deepEqual(fixture.revoked, ['blob:owned-test']); assertReleased(fixture);
});

test('empty or mismatched media fails before allocating a URL', async () => {
  const { preloadMediaBlob } = await load(), fixture = environment();
  await assert.rejects(preloadMediaBlob(new Blob([]), '', { environment: fixture.env }), /empty file/);
  await assert.rejects(preloadMediaBlob(new Blob(['x'], { type: 'text/html' }), 'image/png', { environment: fixture.env }), /unexpected media type/);
  assert.equal(fixture.probes.length, 0); assert.deepEqual(fixture.revoked, []);
});
