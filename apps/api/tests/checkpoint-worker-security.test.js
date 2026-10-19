const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const moduleUrl = name => pathToFileURL(path.resolve(__dirname, '../../participant-web/js/session-runtime', name)).href;
const source = () => ({ ids: { session: 'secure-session', participant: 'synthetic', invitationCode: 'synthetic-code' },
  checkpointViewport: { width: 1280, height: 720 } });

test('checkpoint requests have unpredictable per-request IDs and bounded structural validation', async () => {
  const { createCheckpointRequest, isCheckpointRequest, isLegacyCheckpointRequest } = await import(moduleUrl('checkpoint-messages.mjs'));
  const request = createCheckpointRequest(source());
  assert.equal(isCheckpointRequest(request), true);
  assert.match(request.requestId, /^[a-f0-9]{32}$/);
  assert.notEqual(request.requestId, createCheckpointRequest(source()).requestId);
  assert.equal(isLegacyCheckpointRequest(source()), true);
  assert.equal(isLegacyCheckpointRequest({ ...source(), schemaVersion: 'checkpoint_request.v0' }), false);
  assert.equal(isLegacyCheckpointRequest({ ...request, requestId: '' }), false);
  for (const value of [null, [], { ...request, requestId: 'fixed' }, { ...request, extra: true },
    { ...request, source: [] }, { ...request, source: { ...source(), ids: {} } },
    { ...request, source: { ...source(), checkpointViewport: { width: Infinity, height: 720 } } }]) {
    assert.equal(isCheckpointRequest(value), false);
  }
});

test('worker replies must match request, schema and the original session identity', async () => {
  const { createCheckpointRequest, isCheckpointResponse } = await import(moduleUrl('checkpoint-messages.mjs'));
  const request = createCheckpointRequest(source());
  const response = { schemaVersion: 'checkpoint_response.v1', requestId: request.requestId,
    packet: { schemaVersion: 'session_feature.v1', ids: source().ids } };
  assert.equal(isCheckpointResponse(response, request), true);
  for (const value of [{ ...response, requestId: '0'.repeat(32) }, { ...response, schemaVersion: 'other' },
    { ...response, packet: { ...response.packet, ids: { ...source().ids, session: 'foreign' } } },
    { ...response, packet: { ...response.packet, ids: { ...source().ids, invitationCode: 'foreign' } } },
    { ...response, error: 'checkpoint_prepare_failed' }, { ...response, arbitrary: true }]) {
    assert.equal(isCheckpointResponse(value, request), false);
  }
  assert.equal(isCheckpointResponse({ schemaVersion: 'checkpoint_response.v1', requestId: request.requestId,
    error: 'checkpoint_prepare_failed' }, request), true);
});

test('aggregate worker accepts only trusted local dedicated-worker requests, never window messages', async () => {
  const { createCheckpointRequest, isCheckpointRequest, isLegacyCheckpointRequest } = await import(moduleUrl('checkpoint-messages.mjs'));
  const code = fs.readFileSync(path.resolve(__dirname, '../../participant-web/js/session-runtime/aggregate-worker.mjs'), 'utf8')
    .replace(/^import[^\n]*\n/gm, '');
  class DedicatedWorkerGlobalScope {}
  const replies = [];
  const self = Object.assign(new DedicatedWorkerGlobalScope(), { location: { origin: 'https://wecog.test' }, postMessage: value => replies.push(value) });
  const context = { self, DedicatedWorkerGlobalScope, isCheckpointRequest, isLegacyCheckpointRequest, buildCheckpointHeatmaps: () => ({}),
    buildAttentionMetrics: () => ({}), buildAggregatesPayload: value => ({ schemaVersion: 'session_feature.v1', ids: value.ids }) };
  vm.runInNewContext(code, context);
  const request = createCheckpointRequest(source());
  for (const event of [{ origin: 'https://attacker.test', isTrusted: true, data: request },
    { origin: 'null', isTrusted: true, data: request }, { origin: '', isTrusted: false, data: request },
    { origin: '', isTrusted: true, data: { ...source(), ids: {} } }]) self.onmessage(event);
  assert.equal(replies.length, 0);
  self.onmessage({ origin: '', isTrusted: true, data: request });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].requestId, request.requestId);
  assert.equal(replies[0].packet.ids.session, 'secure-session');
  self.onmessage({ origin: '', isTrusted: true, data: source() });
  assert.equal(replies.length, 2, 'an already-open pre-upgrade page retains its checkpoint path');
  assert.equal(replies[1].requestId, null);
  assert.equal(replies[1].packet.ids.session, 'secure-session');
  const windowScope = { location: self.location, postMessage() { throw Error('Window handler must not run'); } };
  vm.runInNewContext(code, { ...context, self: windowScope });
  assert.equal(windowScope.onmessage, undefined);
});

test('checkpoint builder ignores spoofed, stale and foreign-session replies before a valid response', async () => {
  const { CheckpointBuilder } = await import(moduleUrl('checkpoint-builder.mjs'));
  const oldWorker = globalThis.Worker, oldLocation = globalThis.location;
  let terminated = 0;
  globalThis.location = { origin: 'https://wecog.test' };
  globalThis.Worker = class {
    terminate() { terminated++; }
    postMessage(request) {
      const packet = { schemaVersion: 'session_feature.v1', ids: request.source.ids };
      const data = { schemaVersion: 'checkpoint_response.v1', requestId: request.requestId, packet };
      queueMicrotask(() => {
        this.onmessage({ isTrusted: true, origin: 'https://attacker.test', data });
        this.onmessage({ isTrusted: false, origin: '', data });
        this.onmessage({ isTrusted: true, origin: '', data: { ...data, requestId: '0'.repeat(32) } });
        this.onmessage({ isTrusted: true, origin: '', data: { ...data, packet: { ...packet, ids: { session: 'foreign' } } } });
        this.onmessage({ isTrusted: true, origin: '', data });
      });
    }
  };
  try {
    const packet = await new CheckpointBuilder().build(source());
    assert.equal(packet.ids.session, 'secure-session');
    assert.equal(packet.schemaVersion, 'session_feature.v1');
    assert.equal(terminated, 1);
  } finally {
    if (oldWorker === undefined) delete globalThis.Worker; else globalThis.Worker = oldWorker;
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
  }
});
