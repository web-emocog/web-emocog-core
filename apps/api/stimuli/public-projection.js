const crypto = require('crypto');

function protocolRevision(row) {
  return crypto.createHash('sha256').update(JSON.stringify([row.name, row.definition, row.updated_at])).digest('hex');
}

// Library metadata is researcher-owned, not a participant protocol contract.
function publicStimulusMetadata(metadata) {
  const result = {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return result;
  for (const key of ['text', 'label', 'emotion', 'alt']) {
    if (typeof metadata[key] === 'string') result[key] = metadata[key].slice(0, 512);
  }
  return result;
}

function publicProtocolDefinition(definition, options = {}) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return definition;
  const projected = { ...definition };
  if (!options.includeBuilderState) delete projected.builderState;
  if (definition.mediaManifest) {
    projected.mediaManifest = {};
    for (const [id, entry] of Object.entries(definition.mediaManifest)) {
      projected.mediaManifest[id] = {
        versionId: entry.versionId, sha256: entry.sha256, mimeType: entry.mimeType,
        sizeBytes: entry.sizeBytes, name: entry.name,
        metadata: publicStimulusMetadata(entry.metadata),
      };
    }
  }
  return projected;
}

function publicProtocol(row) {
  return { ...row, revision: protocolRevision(row), definition: publicProtocolDefinition(row.definition, { includeBuilderState: true }) };
}

module.exports = { publicStimulusMetadata, publicProtocolDefinition, publicProtocol, protocolRevision };
