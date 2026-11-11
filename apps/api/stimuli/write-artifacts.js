const fs = require('node:fs/promises');
const { resolveReadableServerOwnedUploadPath } = require('../security/upload-paths');
const { logUnexpectedError } = require('../security/error-log');

const journals = new WeakMap();

function trackPreviewArtifact(client, root, relativePath) {
  if (relativePath) journals.get(client)?.push({ root, relativePath });
}

async function discardPreviewArtifacts(artifacts) {
  for (const { root, relativePath } of artifacts) {
    try {
      const resolved = await resolveReadableServerOwnedUploadPath(root, relativePath);
      if (resolved.ok) await fs.unlink(resolved.absolutePath);
    } catch (error) {
      if (error.code !== 'ENOENT') logUnexpectedError(error, 'stimuli.preview-cleanup');
    }
  }
}

module.exports = { journals, trackPreviewArtifact, discardPreviewArtifacts };
