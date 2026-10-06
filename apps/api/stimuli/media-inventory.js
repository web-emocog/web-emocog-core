const fs = require('fs');
const { hashFile } = require('./versions');
const { getStoredContentPath, resolveReadableServerOwnedUploadPath } = require('../security/upload-paths');

async function collectMediaInventory(queryable, uploadsRoot) {
  const entries = new Map();
  const add = (relative, sha256, bytes) => {
    if (!relative) return;
    const name = 'stimuli/' + relative;
    const previous = entries.get(name);
    if (previous?.sha256 && sha256 && previous.sha256 !== sha256) throw new Error('Conflicting media checksums');
    entries.set(name, { file: name, sha256: sha256 || previous?.sha256 || null, bytes: bytes ?? previous?.bytes ?? null });
  };
  const stimuli = await queryable.query('SELECT id, metadata FROM stimuli ORDER BY id');
  const schema = await queryable.query("SELECT to_regclass('public.stimulus_versions') AS versions");
  const versions = schema.rows[0]?.versions
    ? await queryable.query('SELECT content_path, preview_path, sha256, size_bytes, preview_status FROM stimulus_versions ORDER BY id')
    : { rows: [] };
  for (const row of stimuli.rows) add(getStoredContentPath(row.metadata), null, null);
  for (const row of versions.rows) {
    add(row.content_path, row.sha256, Number(row.size_bytes));
    if (row.preview_status === 'ready') add(row.preview_path, null, null);
  }
  if (entries.size > 100_000) throw new Error('Media inventory exceeds limits');
  for (const entry of entries.values()) {
    const resolved = await resolveReadableServerOwnedUploadPath(uploadsRoot, entry.file);
    if (!resolved.ok) throw new Error('Referenced media is unavailable');
    const stat = await fs.promises.stat(resolved.absolutePath);
    const checksum = await hashFile(resolved.absolutePath);
    if ((entry.bytes !== null && stat.size !== entry.bytes) || (entry.sha256 && entry.sha256 !== checksum)) {
      throw new Error('Referenced media integrity check failed');
    }
    entry.bytes = stat.size;
    entry.sha256 = checksum;
  }
  return { formatVersion: 1, files: [...entries.values()].sort((a, b) => a.file.localeCompare(b.file)) };
}

module.exports = { collectMediaInventory };
