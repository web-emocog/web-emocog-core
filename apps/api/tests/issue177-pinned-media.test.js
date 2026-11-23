const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectProtocolStimuli } = require('../stimuli/protocol-availability');
const { inspectPassiveValidTimeBlock } = require('../../shared/protocol-quality');
const policy = { schemaVersion: 'passive_valid_time.v1', enabled: true, maxExtensionRatio: .5, minSegmentMs: 1000 };

test('#177 publication/invitation media inspection checks the actual pinned MIME, not forged manifest/trial labels', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-177-pinned-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('synthetic-media-inspection-fixture');
  await fs.writeFile(path.join(root, 'media.bin'), bytes);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  const definition = { version: 'v2', blocks: [{ type: 'passive', blockConfig: { validTime: policy },
    trials: [{ stimulusId: 31, duration: 2000, stimulus: { type: 'image' } }] }],
  mediaManifest: { 31: { versionId: 'pinned-version', mimeType: 'image/png', sha256: checksum, sizeBytes: bytes.length } } };
  let actualMime = 'video/mp4', info = {}, owner = 5;
  const db = { async query(sql) {
    if (sql.includes('FROM stimuli')) return { rows: [{ id: 31, project_id: 7, created_by: owner,
      visibility: 'private', mime_type: 'image/png', metadata: {} }] };
    assert.match(sql, /FROM stimulus_versions/);
    return { rows: [{ id: 'pinned-version', stimulus_id: 31, mime_type: actualMime,
      sha256: checksum, size_bytes: bytes.length, content_path: 'media.bin', media_info: info }] };
  } };
  const options = { uploadsRoot: root, user: { sub: 5, role: 'researcher' } };
  for (const mime of ['video/mp4', 'audio/wav', 'image/gif', 'image/webp', 'image/svg+xml', null]) {
    actualMime = mime;
    const report = await inspectProtocolStimuli(db, 7, definition, options);
    assert.equal(report.ok, false, mime);
    assert.equal(report.unavailable[0].code, 'passive_valid_time_media_unsupported');
  }
  actualMime = 'image/jpeg';
  assert.equal((await inspectProtocolStimuli(db, 7, definition, options)).ok, false, 'stale or forged manifest MIME rejected');
  definition.mediaManifest[31].mimeType = actualMime;
  let report = await inspectProtocolStimuli(db, 7, definition, options);
  assert.equal(report.ok, true);
  assert.equal(report.validTimeMedia[31].mime_type, 'image/jpeg');
  assert.equal(inspectPassiveValidTimeBlock(definition.blocks[0], { mediaManifest: report.validTimeMedia, allowUnresolvedMedia: false }).ok, true);
  for (const extra of [{ codec: 'apng' }, { animated: true }, { frame_count: 2 }, { duration_ms: 1000 }]) {
    info = extra;
    assert.equal((await inspectProtocolStimuli(db, 7, definition, options)).ok, false);
  }
  actualMime = 'image/png'; definition.mediaManifest[31].mimeType = actualMime;
  info = {};
  assert.equal((await inspectProtocolStimuli(db, 7, definition, options)).ok, false, 'unknown PNG animation is not static evidence');
  info = { codec: 'png' };
  assert.equal((await inspectProtocolStimuli(db, 7, definition, options)).ok, true, 'verified static PNG decoder metadata');
  actualMime = 'image/jpeg'; definition.mediaManifest[31].mimeType = actualMime;
  info = {}; owner = 6;
  report = await inspectProtocolStimuli(db, 7, definition, options);
  assert.equal(report.unavailable[0].code, 'stimulus_record_missing', 'private-media authorization still wins');
  owner = 5;
  await fs.writeFile(path.join(root, 'media.bin'), Buffer.from('corrupt'));
  assert.equal((await inspectProtocolStimuli(db, 7, definition, options)).unavailable[0].code, 'stimulus_checksum_mismatch');
});

test('#177 unpinned publication reports server MIME for subsequent preflight; disabled media behavior stays unchanged', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-177-current-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'image.png'), Buffer.from('synthetic-image'));
  const definition = { blocks: [{ type: 'passive', content: { validTime: policy, slides: [31] } }] };
  let mime = 'image/jpeg';
  const db = { query: async () => ({ rows: [{ id: 31, mime_type: mime, metadata: { content_path: 'image.png' } }] }) };
  const report = await inspectProtocolStimuli(db, 7, definition, { uploadsRoot: root });
  assert.equal(report.ok, true);
  assert.equal(report.validTimeMedia[31].mime_type, mime);
  mime = 'video/mp4';
  assert.equal((await inspectProtocolStimuli(db, 7, definition, { uploadsRoot: root })).ok, false);
  delete definition.blocks[0].content.validTime;
  const disabled = await inspectProtocolStimuli(db, 7, definition, { uploadsRoot: root });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.validTimeMedia, undefined);
});
