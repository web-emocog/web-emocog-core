const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveParticipantStimulus } = require('../../shared/standard-stimuli');
const { inspectProtocolStimuli } = require('../stimuli/protocol-availability');
const { hasUsablePreview } = require('../stimuli/media-preview');

test('WAV/MP3 remain audio with a prepared URL or an unavailable source', () => {
  for (const mime_type of ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3']) {
    for (const metadata of [{ url: 'blob:synthetic-audio' }, {}]) {
      const value = resolveParticipantStimulus({ stimulusId: '42', meta: { mime_type, metadata } });
      assert.equal(value.type, 'audio');
      if (!metadata.url) assert.equal(value.mediaUnavailable, true);
    }
  }
});

test('audio publication accepts a stored binary without spatial AOIs, but not fake geometry', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-publication-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'fixture.wav'), 'synthetic existence fixture, not a decode test');
  const queryable = { query: async () => ({ rows: [{ id: 42, mime_type: 'audio/wav', metadata: { content_path: 'fixture.wav' } }] }) };
  for (const type of ['cognitive_task', 'passive']) {
    const definition = { blocks: [{ type, trials: [{ stimulusId: '42' }], blockConfig: { useAOI: false } }] };
    assert.equal((await inspectProtocolStimuli(queryable, 1, definition, { uploadsRoot: root })).ok, true);
    definition.blocks[0].blockConfig.aoiDefinitions = { 42: [{}] };
    const report = await inspectProtocolStimuli(queryable, 1, definition, { uploadsRoot: root });
    assert.equal(report.ok, false);
    assert.equal(report.unavailable[0].code, 'audio_spatial_aoi_unsupported');
  }
});

test('ready preview metadata does not hide a missing file or a symlink escape', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-existence-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const version = { preview_status: 'ready', preview_path: 'preview.jpg', sha256: 'digest', media_info: { validated_sha256: 'digest' } };
  assert.equal(await hasUsablePreview(version, root), false);
  await fs.writeFile(path.join(root, 'preview.jpg'), 'synthetic poster');
  assert.equal(await hasUsablePreview(version, root), true);
  await fs.symlink(path.join(root, 'preview.jpg'), path.join(root, 'link.jpg'));
  assert.equal(await hasUsablePreview({ ...version, preview_path: 'link.jpg' }, root), false);
  assert.equal(await hasUsablePreview({ ...version, media_info: {} }, root), false);
  assert.equal(await hasUsablePreview({ ...version, preview_status: 'unsupported', preview_path: null }, root), true);
});
