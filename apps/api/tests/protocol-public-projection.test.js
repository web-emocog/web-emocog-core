const test = require('node:test');
const assert = require('node:assert/strict');
const { publicProtocolDefinition, publicStimulusMetadata } = require('../stimuli/public-projection');

test('protocol and stimulus endpoints use one explicit metadata projection without modifying saved snapshots', () => {
  const metadata = { label: 'Stimulus', emotion: 'happy', text: 'x'.repeat(600), alt: 'A face',
    researcher_note: 'private', participant_email: 'private@example.test',
    content_path: '/private/path', contentPath: '/private/path', nested: { secret: true } };
  const definition = { participantShell: { consent: true }, blocks: [{ id: 'b', trials: [] }],
    mediaManifest: { 7: { versionId: 'version', sha256: 'hash', mimeType: 'image/png',
      sizeBytes: 12, name: 'Face', metadata, content_path: '/private' } } };
  const projected = publicProtocolDefinition(definition);
  assert.deepEqual(projected.mediaManifest[7].metadata, publicStimulusMetadata(metadata));
  assert.deepEqual(Object.keys(projected.mediaManifest[7].metadata), ['text', 'label', 'emotion', 'alt']);
  assert.equal(projected.mediaManifest[7].metadata.text.length, 512);
  assert.ok(!JSON.stringify(projected).includes('private'));
  assert.equal(projected.blocks, definition.blocks);
  assert.equal(definition.mediaManifest[7].metadata.researcher_note, 'private');
});
