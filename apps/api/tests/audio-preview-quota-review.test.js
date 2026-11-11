const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { readStoragePolicy } = require('../config/storage-policy');

async function loadModule(relativePath, overrides) {
  const filename = path.resolve(__dirname, relativePath);
  const source = await fs.readFile(filename, 'utf8');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const factory = vm.runInThisContext(`(function(require, module, exports) {\n${source}\n})`, { filename });
  factory(name => Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(name), module, module.exports);
  return module.exports;
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-preview-quota-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'source.wav'), 'synthetic unit-test input');
  const policy = readStoragePolicy({ MEDIA_ORGANIZATION_QUOTA_BYTES: String(8 * 1024 * 1024), MEDIA_MIN_FREE_BYTES: '1' });
  const version = { id: 'audio-preview-quota-review', stimulus_id: 7,
    mime_type: options.mimeType || 'audio/wav', content_path: options.contentPath || 'source.wav',
    sha256: 'a'.repeat(64), preview_status: 'pending', media_info: {} };
  const calls = [], nativeCalls = [], updates = [];
  const config = { storage: { preview: { ffprobeBin: 'unit-ffprobe', ffmpegBin: 'unit-ffmpeg',
    timeoutMs: 1000, maxConcurrent: 2, maxDimension: 480 } } };
  let locked = false;
  const queryable = { query: async (sql, values) => {
    if (sql.startsWith('SELECT project_id')) {
      assert.deepEqual(values, [version.stimulus_id]);
      return { rows: [{ project_id: 11 }] };
    }
    if (sql.startsWith('SELECT organization_id')) {
      assert.deepEqual(values, [11]);
      return { rows: [{ organization_id: 13 }] };
    }
    if (sql.includes('pg_advisory_xact_lock')) {
      assert.deepEqual(values, ['wecog:media-quota:13']);
      locked = true;
      calls.push('quota-lock');
      return { rows: [] };
    }
    if (sql.includes('AS retained_bytes')) {
      assert.equal(locked, true);
      assert.deepEqual(values, [13, null]);
      calls.push('quota-usage');
      return { rows: [{ retained_bytes: options.retainedBytes ?? policy.organizationBytes - 1,
        reserved_bytes: options.reservedBytes ?? 0, unmeasured: options.unmeasured ?? 0 }] };
    }
    if (sql.startsWith('SELECT content_path')) {
      assert.deepEqual(values, [13]);
      return { rows: [{ content_path: 'missing-legacy-file.wav' }] };
    }
    if (sql.includes('AS bytes FROM media_operations')) {
      calls.push('disk-reservations');
      return { rows: [{ bytes: 0 }] };
    }
    if (sql.startsWith('UPDATE stimulus_versions')) {
      const row = { ...version, preview_path: values[0], preview_status: values[1], media_info: JSON.parse(values[2]) };
      assert.equal(values[3], version.id);
      updates.push(row);
      calls.push('persist');
      return { rows: [row] };
    }
    throw new Error('Unexpected unit-test SQL: ' + sql);
  } };
  const storagePolicy = { readStoragePolicy: () => policy };
  const quotas = await loadModule('../stimuli/storage-quotas.js', {
    '../config/storage-policy': storagePolicy,
    'node:fs/promises': { statfs: async () => {
      calls.push('disk-check');
      return { bavail: options.diskLow ? 0n : 1024n, bsize: 1024n * 1024n };
    } },
  });
  const preview = await loadModule('../stimuli/media-preview.js', {
    '../config': config,
    '../config/storage-policy': storagePolicy,
    './storage-quotas': quotas,
    '../security/native-process': { runNativeProcess: async (command, args, nativeOptions) => {
      assert.equal(locked, true);
      assert.ok(calls.includes('quota-usage'));
      assert.ok(calls.includes('disk-reservations'));
      nativeCalls.push({ command, args, options: nativeOptions });
      calls.push(command);
      if (command === config.storage.preview.ffprobeBin) {
        return { stdout: JSON.stringify(options.metadata ?? {
          streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le' }], format: { duration: '1.5' },
        }) };
      }
      assert.equal(command, config.storage.preview.ffmpegBin);
      if (options.decoderError) throw Object.assign(new Error('synthetic decoder failure'), { code: options.decoderError });
      return { stdout: '' };
    } },
  });
  return { root, version, policy, queryable, preview, calls, nativeCalls, updates };
}

test('near-quota audio keeps quota locking and full decode validation without a poster reservation', async t => {
  const f = await fixture(t);
  const result = await f.preview.ensurePlayableVersion(f.queryable, f.version, f.root);
  assert.equal(result.preview_status, 'unsupported');
  assert.equal(result.preview_path, null);
  assert.deepEqual(result.media_info, { validated_sha256: f.version.sha256, codec: 'pcm_s16le', duration_ms: 1500 });
  assert.deepEqual(f.calls, ['quota-lock', 'quota-usage', 'disk-check', 'disk-reservations',
    'unit-ffprobe', 'unit-ffmpeg', 'persist']);
  assert.equal(f.nativeCalls.length, 2);
  const [probe, decode] = f.nativeCalls;
  assert.ok(probe.args.includes('-show_entries'));
  assert.deepEqual(decode.args.slice(decode.args.indexOf('-map')), ['-map', '0:a:0', '-t', '1', '-f', 'null', '-']);
  for (const call of f.nativeCalls) {
    assert.equal(call.args[call.args.indexOf('-protocol_whitelist') + 1], 'file,pipe');
    assert.deepEqual(call.options, { timeoutMs: 1000, resourceLimits: true });
  }
  assert.deepEqual(await fs.readdir(f.root), ['source.wav']);
});

for (const mimeType of ['image/png', 'video/mp4']) {
  test(`${mimeType} still requires the full poster budget before decoding`, async t => {
    const policy = readStoragePolicy({ MEDIA_ORGANIZATION_QUOTA_BYTES: String(8 * 1024 * 1024) });
    const f = await fixture(t, { mimeType, retainedBytes: policy.organizationBytes - policy.previewBytes + 1 });
    await assert.rejects(f.preview.ensurePlayableVersion(f.queryable, f.version, f.root),
      { status: 413, code: 'media_quota_exceeded' });
    assert.deepEqual(f.calls, ['quota-lock', 'quota-usage']);
    assert.equal(f.nativeCalls.length, 0);
    assert.equal(f.updates.length, 0);
  });
}

for (const [name, options, status, code] of [
  ['existing storage reservations exceed quota', { reservedBytes: 2 }, 413, 'media_quota_exceeded'],
  ['inventory is unmeasured', { unmeasured: 1 }, 503, 'media_inventory_unmeasured'],
  ['safe disk capacity is exhausted', { diskLow: true }, 507, 'media_disk_low'],
]) {
  test(`audio still fails closed when ${name}`, async t => {
    const f = await fixture(t, options);
    await assert.rejects(f.preview.ensurePlayableVersion(f.queryable, f.version, f.root), { status, code });
    assert.equal(f.calls[0], 'quota-lock');
    assert.equal(f.nativeCalls.length, 0);
    assert.equal(f.updates.length, 0);
  });
}

for (const metadata of [
  { streams: [{ codec_type: 'video' }], format: { duration: '1.5' } },
  { streams: [{ codec_type: 'audio' }], format: { duration: '0' } },
]) {
  test(`near-quota audio rejects invalid probe metadata: ${JSON.stringify(metadata)}`, async t => {
    const f = await fixture(t, { metadata });
    await assert.rejects(f.preview.ensurePlayableVersion(f.queryable, f.version, f.root),
      { status: 422, code: 'media_decode_failed' });
    assert.equal(f.nativeCalls.length, 1);
    assert.equal(f.updates[0].preview_status, 'failed');
    assert.equal(f.updates[0].media_info.validated_sha256, undefined);
  });
}

for (const [decoderError, status, code] of [
  ['timeout', 504, 'media_preview_timeout'],
  ['unavailable', 503, 'media_preview_unavailable'],
  ['invalid_media', 422, 'media_decode_failed'],
]) {
  test(`near-quota audio preserves decoder error ${code}`, async t => {
    const f = await fixture(t, { decoderError });
    await assert.rejects(f.preview.ensurePlayableVersion(f.queryable, f.version, f.root), { status, code });
    assert.equal(f.nativeCalls.length, 2);
    assert.equal(f.updates[0].preview_status, 'failed');
    assert.equal(f.updates[0].media_info.preview_error, code);
    assert.equal(f.updates[0].media_info.validated_sha256, undefined);
  });
}

test('near-quota audio does not bypass upload path confinement', async t => {
  const f = await fixture(t, { contentPath: '../outside.wav' });
  await assert.rejects(f.preview.ensurePlayableVersion(f.queryable, f.version, f.root),
    { status: 422, code: 'content_path_traversal' });
  assert.equal(f.nativeCalls.length, 0);
  assert.equal(f.updates[0].preview_status, 'failed');
});
