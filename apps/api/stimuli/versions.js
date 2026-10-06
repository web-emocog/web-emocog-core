const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { withTransaction } = require('../db/transaction');
const config = require('../config');
const { HttpError } = require('../security/http-error');
const { getStoredContentPath, resolveReadableServerOwnedUploadPath } = require('../security/upload-paths');
const { referencedDatabaseStimulusIds } = require('../../shared/protocol-stimuli');
const { mayReadStimulus } = require('./access');
const { ensurePlayableVersion } = require('./media-preview');

const MEDIA_LOCK = 'wecog:media-backup:v1';
const uploadsRoot = path.join(config.storage.uploadsRoot, 'stimuli');

async function withMediaWrite(pool, callback) {
  return withTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))', [MEDIA_LOCK]);
    // A single write order also protects legacy snapshot backfill against replacement/deletion.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['wecog:media-write:v1']);
    return callback(client);
  });
}

async function hashFile(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function ensureStimulusVersion(client, row, options = {}) {
  const resolved = await resolveReadableServerOwnedUploadPath(options.uploadsRoot || uploadsRoot, getStoredContentPath(row.metadata));
  if (!resolved.ok) throw new HttpError(422, 'Stimulus file is unavailable', resolved.code);
  const checksum = await hashFile(resolved.absolutePath);
  const size = (await fs.promises.stat(resolved.absolutePath)).size;
  const result = await client.query(`
    INSERT INTO stimulus_versions (id, stimulus_id, content_path, mime_type, size_bytes, sha256)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (stimulus_id, content_path) DO UPDATE
      SET sha256 = COALESCE(stimulus_versions.sha256, EXCLUDED.sha256)
    RETURNING *`,
  [crypto.randomUUID(), row.id, resolved.relativePath, row.mime_type || 'application/octet-stream', size, checksum]);
  const version = result.rows[0];
  if (version.sha256 !== checksum || Number(version.size_bytes) !== size) {
    throw new HttpError(409, 'Stimulus integrity check failed', 'stimulus_checksum_mismatch');
  }
  await client.query('UPDATE stimuli SET current_version_id = $1 WHERE id = $2', [version.id, row.id]);
  row.current_version_id = version.id;
  return version;
}

function manifestEntry(row, version) {
  const metadata = { ...row.metadata };
  delete metadata.content_path;
  delete metadata.contentPath;
  return { versionId: version.id, sha256: version.sha256, mimeType: version.mime_type,
    sizeBytes: Number(version.size_bytes), name: row.name, metadata };
}

async function pinProtocolMedia(client, projectId, definition, user, options = {}) {
  const ids = referencedDatabaseStimulusIds(definition).sort((a, b) => a - b);
  // Client manifests never authorize or select a server file version.
  const pinned = { ...definition, mediaManifest: {} };
  if (!ids.length) return pinned;
  const result = await client.query(`SELECT * FROM stimuli
    WHERE project_id = $1 AND id = ANY($2::int[]) ORDER BY id FOR UPDATE`, [projectId, ids]);
  const rows = new Map(result.rows.map(row => [Number(row.id), row]));
  for (const id of ids) {
    const row = rows.get(id);
    if (!row || (user && !mayReadStimulus(row, user))) {
      throw new HttpError(422, 'Protocol stimulus is unavailable or private', 'protocol_stimulus_unavailable');
    }
    const version = await ensureStimulusVersion(client, row, options);
    await ensurePlayableVersion(client, version, options.uploadsRoot || uploadsRoot);
    pinned.mediaManifest[String(id)] = manifestEntry(row, version);
  }
  return pinned;
}

// Freeze pre-upgrade definitions BEFORE replacing their first referenced file.
async function freezeLegacyBindings(client, projectId, stimulusId) {
  for (const table of ['protocols', 'invitations']) {
    const column = table === 'protocols' ? 'definition' : 'protocol_definition';
    const result = table === 'protocols'
      ? await client.query('SELECT id, definition FROM protocols WHERE project_id = $1 ORDER BY id', [projectId])
      : await client.query(`SELECT i.id, i.protocol_definition FROM invitations i
          JOIN protocols pr ON pr.id = i.protocol_id WHERE pr.project_id = $1 ORDER BY i.id`, [projectId]);
    for (const row of result.rows) {
      const definition = row[column];
      if (!definition || definition.mediaManifest || !referencedDatabaseStimulusIds(definition).includes(Number(stimulusId))) continue;
      // Legacy missing siblings are reported during admission, not guessed.
      const pinned = { ...definition, mediaManifest: {} };
      const ids = referencedDatabaseStimulusIds(definition);
      const stimuli = await client.query('SELECT * FROM stimuli WHERE project_id = $1 AND id = ANY($2::int[])', [projectId, ids]);
      for (const stimulus of stimuli.rows) {
        const resolved = await resolveReadableServerOwnedUploadPath(uploadsRoot, getStoredContentPath(stimulus.metadata));
        if (resolved.ok) pinned.mediaManifest[String(stimulus.id)] = manifestEntry(stimulus, await ensureStimulusVersion(client, stimulus));
      }
      await client.query(`UPDATE ${table} SET ${column} = $1::jsonb WHERE id = $2 AND NOT (${column} ? 'mediaManifest')`,
        [JSON.stringify(pinned), row.id]);
    }
  }
}

async function loadPinnedStimuli(client, projectId, definition) {
  const ids = referencedDatabaseStimulusIds(definition);
  if (!ids.length) return [];
  const result = await client.query('SELECT * FROM stimuli WHERE project_id = $1 AND id = ANY($2::int[]) ORDER BY id', [projectId, ids]);
  if (!definition?.mediaManifest) return result.rows;
  const versionIds = ids.map(id => definition.mediaManifest[String(id)]?.versionId).filter(Boolean);
  const versions = versionIds.length ? await client.query('SELECT * FROM stimulus_versions WHERE id = ANY($1::uuid[])', [versionIds]) : { rows: [] };
  const byVersion = new Map(versions.rows.map(row => [String(row.id), row]));
  return result.rows.map(row => {
    const entry = definition.mediaManifest[String(row.id)];
    const version = byVersion.get(entry?.versionId);
    if (!version || Number(version.stimulus_id) !== Number(row.id)) {
      return { ...row, metadata: {}, current_version_id: null, version_unavailable: true };
    }
    return { ...row, name: entry.name || row.name, mime_type: version.mime_type, size_bytes: version.size_bytes,
      metadata: { ...entry.metadata, ...version.media_info, content_path: version.content_path },
      current_version_id: version.id, sha256: version.sha256, pinned_version: version };
  });
}

module.exports = { MEDIA_LOCK, withMediaWrite, hashFile, ensureStimulusVersion,
  pinProtocolMedia, freezeLegacyBindings, loadPinnedStimuli, uploadsRoot };
