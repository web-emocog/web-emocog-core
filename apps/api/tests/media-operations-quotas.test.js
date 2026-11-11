const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { readStoragePolicy } = require('../config/storage-policy');
const { normalizeDescriptor, fingerprint, reservationCost, completeOperation, publicOperation, failOperation } = require('../stimuli/media-operations');
const { assertQuota, assertDiskSpace, measureUnmeasured, operationClients } = require('../stimuli/storage-quotas');
const { withMediaWrite } = require('../stimuli/versions');
const { trackPreviewArtifact } = require('../stimuli/write-artifacts');
const { reconcileMediaOperation } = require('../stimuli/media-reconciliation');

const MiB = 1024 * 1024;
const limits = { maxUploadBytes: 50*MiB, maxDocumentBytes: 50*MiB, maxPages: 100 };
const descriptor = () => ({ kind: 'upload', project_id: 4, file: { name: 'x.pdf', size: 10,
  type: 'application/pdf', sha256: 'a'.repeat(64) }, metadata: { z: 2, a: 1 } });

test('storage policy has strict configurable defaults, without a test-mode bypass', () => {
  const policy = readStoragePolicy({ NODE_ENV: 'test' });
  assert.equal(policy.organizationBytes, 10*1024*MiB);
  assert.equal(policy.maxUserUploads, 2);
  assert.equal(policy.minFreeBytes, 1024*MiB);
  for (const value of ['0','-1','NaN','20bad','1.2','9007199254740992']) {
    assert.throws(() => readStoragePolicy({ MEDIA_ORGANIZATION_QUOTA_BYTES: value }));
  }
  assert.equal(readStoragePolicy({ MEDIA_MAX_USER_UPLOADS: '1' }).maxUserUploads, 1);
});

test('operation fingerprints canonicalize metadata but bind bytes, target, visibility, names and folders', () => {
  const normalized = normalizeDescriptor(descriptor(), limits);
  assert.equal(fingerprint(normalized), fingerprint(normalizeDescriptor({ ...descriptor(), metadata: { a: 1,z: 2 } }, limits)));
  for (const changed of [
    { project_id: 5 }, { name: 'renamed' }, { folder_id: 2 }, { visibility: 'project' },
    { file: { ...descriptor().file, sha256: 'b'.repeat(64) } },
    { file: { ...descriptor().file, size: 11 } },
  ]) assert.notEqual(fingerprint(normalized), fingerprint(normalizeDescriptor({ ...descriptor(), ...changed }, limits)));
  assert.notEqual(fingerprint(normalized), fingerprint(normalizeDescriptor({ ...descriptor(), kind: 'replace', stimulus_id: 3 }, limits)));
});

test('unsafe descriptors cannot acquire a reservation', () => {
  for (const changed of [
    { project_id: '4' }, { created_by: 2 }, { visibility: 'public' }, { metadata: { content_path: 'other' } },
    { file: { ...descriptor().file, size: 50*MiB+1 } }, { file: { ...descriptor().file, sha256: 'invalid' } },
    { kind: 'replace' }, { folder_id: -1 }, { metadata: [] },
  ]) assert.throws(() => normalizeDescriptor({ ...descriptor(), ...changed }, limits), { code: 'media_operation_invalid' });
});

test('reservation includes bounded posters and all converted output, not just incoming bytes', () => {
  const policy = readStoragePolicy({});
  assert.equal(reservationCost({ kind: 'upload', file: { size: 10, type: 'image/png' } }, limits, policy).bytes, 2*MiB+10);
  assert.equal(reservationCost({ kind: 'upload', file: { size: 10, type: 'audio/wav' } }, limits, policy).bytes, 10);
  const convert = reservationCost({ kind: 'convert' }, limits, policy);
  assert.equal(convert.bytes, 456*MiB);
  assert.equal(convert.disk, (456+768)*MiB);
});

test('quota includes retained historical objects plus other active reservations; unknown sizes fail closed', async () => {
  let values;
  let totals = { retained_bytes: '60', reserved_bytes: '30', unmeasured: '0' };
  const client = { query: async (sql, args) => { values = args; assert.match(sql, /media_storage_objects/); return { rows: [totals] }; } };
  const policy = { organizationBytes: 100 };
  await assertQuota(client, 7, 10, policy);
  await assert.rejects(assertQuota(client, 7, 11, policy), { code: 'media_quota_exceeded' });
  operationClients.set(client, { id: 'my-operation' });
  await assertQuota(client, 7, 10, policy);
  assert.deepEqual(values, [7, 'my-operation']);
  operationClients.delete(client);
  totals = { ...totals, unmeasured: '1' };
  await assert.rejects(assertQuota(client, 7, 0, policy), { code: 'media_inventory_unmeasured' });
});

test('disk guard counts outstanding work reservations and fails closed if statfs is unavailable', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-disk-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const client = { query: async () => ({ rows: [{ bytes: '0' }] }) };
  await assertDiskSpace(client, root, 1, { minFreeBytes: 1 });
  await assert.rejects(assertDiskSpace(client, root, 0, { minFreeBytes: Number.MAX_SAFE_INTEGER }), { code: 'media_disk_low' });
  await assert.rejects(assertDiskSpace(client, path.join(root,'missing'), 0, { minFreeBytes: 1 }), { code: 'media_disk_unavailable' });
});

test('publication quota measures migrated objects before admission and still counts reservations and other organizations separately', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-publication-inventory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'legacy-poster'), '123456');
  let unknown = true;
  const client = { query: async (sql, values) => {
    if (sql.includes('AS retained_bytes')) {
      assert.deepEqual(values, [7, null]);
      return { rows: [{ retained_bytes: unknown ? 3 : 9, reserved_bytes: 2, unmeasured: unknown ? 1 : 0 }] };
    }
    if (sql.startsWith('SELECT content_path')) {
      assert.deepEqual(values, [7]);
      return { rows: [{ content_path: 'legacy-poster' }] };
    }
    assert.ok(sql.startsWith('UPDATE media_storage_objects'));
    assert.deepEqual(values, [6, 7, 'legacy-poster']);
    unknown = false;
    return { rows: [] };
  } };
  assert.deepEqual(await assertQuota(client, 7, 1, { organizationBytes: 12 }, root),
    { retained_bytes: 9, reserved_bytes: 2, unmeasured: 0 });
  unknown = true;
  await assert.rejects(assertQuota(client, 7, 2, { organizationBytes: 12 }, root), { code: 'media_quota_exceeded' });
});

test('publication cannot repair unknown inventory by ignoring missing files or exceeding the online batch bound', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-publication-invalid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let rows = [{ content_path: 'missing' }];
  const client = { query: async sql => {
    if (sql.includes('AS retained_bytes')) return { rows: [{ retained_bytes: 0, reserved_bytes: 0, unmeasured: rows.length }] };
    if (sql.startsWith('SELECT content_path')) return { rows };
    assert.fail('No unknown object may be recorded as zero bytes');
  } };
  await assert.rejects(assertQuota(client, 7, 0, { organizationBytes: 100 }, root), { code: 'media_inventory_unmeasured' });
  rows = Array.from({ length: 501 }, () => ({ content_path: 'missing' }));
  await assert.rejects(assertQuota(client, 7, 0, { organizationBytes: 100 }, root), { code: 'media_inventory_unmeasured' });
});

test('legacy poster measurement rejects symlink escape instead of guessing zero bytes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-measure-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root,'poster'), 'poster');
  await fs.symlink(path.join(root,'poster'), path.join(root,'linked'));
  let relative = 'poster';
  const updates = [];
  const client = { query: async (sql,args) => {
    if (sql.startsWith('SELECT')) return { rows: [{ content_path: relative }] };
    updates.push(args); return { rows: [] };
  } };
  await measureUnmeasured(client, 3, root);
  assert.deepEqual(updates[0], [6,3,'poster']);
  relative = 'linked';
  await assert.rejects(measureUnmeasured(client, 3, root), { code: 'media_inventory_unmeasured' });
});

test('exact result and reservation release share media transaction; lost COMMIT acknowledgement preserves posters', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-commit-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root,'poster'), 'poster');
  const statements = [];
  let stored;
  const client = { query: async (sql,args) => {
    statements.push(sql);
    if (sql.startsWith('SELECT * FROM media_operations')) return { rows: [{ state: 'processing' }] };
    if (sql.startsWith('UPDATE media_operations')) stored = JSON.parse(args[2]);
    if (sql === 'COMMIT') throw Object.assign(new Error('synthetic'), { code: 'ECONNRESET' });
    return { rows: [] };
  }, release() {} };
  const operation = { id: crypto.randomUUID(), organization_id: 1 };
  await assert.rejects(withMediaWrite({ connect: async () => client }, queryable => completeOperation(queryable, operation,
    201, value => ({ id: value }), async transaction => {
      trackPreviewArtifact(transaction, root, 'poster');
      await transaction.query('INSERT fake media write'); return 123;
    })), { code: 'media_write_uncertain' });
  assert.deepEqual(stored, { id: 123 });
  assert.ok(statements.findIndex(sql => sql.startsWith('UPDATE media_operations')) < statements.indexOf('COMMIT'));
  assert.equal(operationClients.has(client), false);
  assert.equal(await fs.readFile(path.join(root,'poster'), 'utf8'), 'poster');
});

test('stale writers are fenced; uncertain failures retain reservations; completed outcomes cannot be overwritten', async () => {
  const client = { query: async () => ({ rows: [{ state: 'uncertain' }] }) };
  await assert.rejects(completeOperation(client, { id: 'x', organization_id: 1 }, 201, x => x, () => assert.fail('writer was not fenced')),
    { code: 'media_recovery_required' });
  let call;
  await failOperation({ query: async (sql,args) => { call = { sql,args }; } }, { id: 'x' }, true);
  assert.match(call.sql, /state<>'completed'/);
  assert.deepEqual(call.args, ['x','uncertain',true,'media_recovery_required']);
  const status = publicOperation({ operation_key: 'key', project_id: 1, state: 'processing', expires_at: new Date(0) });
  assert.equal(status.recovery_required, true);
  assert.equal(status.state, 'uncertain');
  await assert.rejects(reconcileMediaOperation({}, 'id', '/unused'), { code: 'media_writers_active' });
});

async function uiFixture(apiPost, apiGet, memory = new Map()) {
  const source = await fs.readFile(path.join(__dirname,'../../web/researcher-stimuli.js'), 'utf8');
  const start = source.indexOf("const stimulusMediaJournalStorageKey =");
  const end = source.indexOf('// UI ownership is narrower', start);
  const context = { CURRENT_LANG: 'en', crypto: crypto.webcrypto, TextEncoder, Uint8Array,
    setTimeout: resolve => { resolve(); }, apiPost, apiGet,
    localStorage: { getItem: key => memory.get(key) || null, setItem: (key,value) => memory.set(key,value) },
    captureStimulusOperation: () => ({ scope: 'actor:project' }), requireCurrentStimulusOperation() {} };
  vm.createContext(context);
  vm.runInContext(source.slice(start,end)+'\nthis.uploadOperation=uploadStimulusMediaOperation;', context);
  return context;
}
const uiFile = () => ({ name: 'file.pdf', type: 'application/pdf', size: 4, arrayBuffer: async () => Uint8Array.from([1,2,3,4]).buffer });
const uiResult = { id: 9, project_id: 4, current_version_id: crypto.randomUUID() };

test('UI recovers lost upload response with the original stable key and does not retry the mutation', async () => {
  const posts = [], polls = [];
  const ui = await uiFixture(async (route,body) => {
    posts.push({ route, body });
    if (route === '/stimuli/operations') return { state: 'reserved' };
    throw Object.assign(new Error('lost response'), { mutationMayHaveCommitted: true });
  }, async route => { polls.push(route); return { state: 'completed', result: uiResult }; });
  const result = await ui.uploadOperation({ file: uiFile() }, { kind: 'upload', project_id: 4 }, '/stimuli/upload', {});
  assert.equal(result.id, 9);
  assert.equal(posts.length, 2);
  assert.equal(polls.length, 1);
  assert.ok(posts[1].route.endsWith(posts[0].body.key));
  assert.ok(polls[0].includes(posts[0].body.key));
});

test('UI survives reload with the same key for an unknown outcome, never blindly resending bytes', async () => {
  const memory = new Map();
  const keys = [];
  let uploads = 0;
  const ui = await uiFixture(async (route,body) => {
    if (route === '/stimuli/operations') { keys.push(body.key); return { state: 'reserved' }; }
    uploads++; throw new Error('disconnected');
  }, async () => ({ state: 'processing' }), memory);
  await assert.rejects(ui.uploadOperation({ file: uiFile() }, { kind: 'upload', project_id: 4 }, '/stimuli/upload', {}), { code: 'media_write_uncertain' });
  const reloaded = await uiFixture(async (route,body) => {
    assert.equal(route, '/stimuli/operations'); keys.push(body.key);
    return { state: 'completed', result: uiResult };
  }, () => assert.fail('completed result needs no poll'), memory);
  assert.equal((await reloaded.uploadOperation({ file: uiFile() }, { kind: 'upload', project_id: 4 }, '/stimuli/upload', {})).id,9);
  assert.equal(keys[0], keys[1]);
  assert.equal(uploads, 1);
});

test('UI reports explicit quota rejection without uploading bytes or hiding it as an unknown outcome', async () => {
  const ui = await uiFixture(async route => {
    assert.equal(route, '/stimuli/operations');
    throw Object.assign(new Error('Organization quota exceeded'), { status: 413, code: 'media_quota_exceeded' });
  }, () => assert.fail('a rejected admission must not be polled'));
  await assert.rejects(ui.uploadOperation({ file: uiFile() }, { kind: 'upload', project_id: 4 }, '/stimuli/upload', {}), { code: 'media_quota_exceeded' });
});
