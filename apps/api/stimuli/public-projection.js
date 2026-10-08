// Library metadata is researcher-owned, not a participant protocol contract.
function publicStimulusMetadata(metadata) {
  const result = {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return result;
  for (const key of ['text', 'label', 'emotion', 'alt']) {
    if (typeof metadata[key] === 'string') result[key] = metadata[key].slice(0, 512);
  }
  return result;
}

function publicProtocolDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return definition;
  const projected = { ...definition };
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
  return { ...row, definition: publicProtocolDefinition(row.definition) };
}

module.exports = { publicStimulusMetadata, publicProtocolDefinition, publicProtocol };
