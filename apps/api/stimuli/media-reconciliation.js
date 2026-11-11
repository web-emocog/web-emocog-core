const fs = require('node:fs/promises');
const path = require('node:path');
const { HttpError } = require('../security/http-error');
const { resolveServerOwnedUploadPath } = require('../security/upload-paths');
const { withMediaWrite } = require('./versions');
const { lockOrganization } = require('./storage-quotas');
const { publicOperation } = require('./media-operations');

// Offline/operator-only. Losing a session lock does not prove a disconnected
// native worker stopped writing; never expose this as an automatic HTTP retry.
async function reconcileMediaOperation(pool, id, uploadsRoot, { writersStopped = false } = {}) {
  if (!writersStopped) throw new HttpError(409, 'Stop media writers before reconciliation', 'media_writers_active');
  const lease = await pool.connect();
  const key = `wecog:media-operation:${id}`;
  let locked = false;
  try {
    locked = (await lease.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [key])).rows[0].locked;
    if (!locked) throw new HttpError(409, 'Media operation is still active', 'media_operation_pending');
    return await withMediaWrite(pool, async client => {
      const operation = (await client.query('SELECT * FROM media_operations WHERE id=$1', [id])).rows[0];
      if (!operation) throw new HttpError(404, 'Media operation not found', 'media_operation_not_found');
      if (operation.state === 'completed' || operation.state === 'failed') return publicOperation(operation);
      await lockOrganization(client, operation.organization_id);
      await client.query('SELECT id FROM media_operations WHERE id=$1 FOR UPDATE', [id]);
      for (const artifact of operation.artifacts) {
        const file = resolveServerOwnedUploadPath(uploadsRoot, artifact.path);
        if (!file.ok) throw new HttpError(409, 'Media artifact inventory needs repair', 'media_artifact_invalid');
        const referenced = await client.query(`SELECT 1 FROM (
          SELECT content_path AS path FROM stimulus_versions UNION ALL SELECT preview_path FROM stimulus_versions
          UNION ALL SELECT metadata->>'content_path' FROM stimuli UNION ALL SELECT metadata->>'contentPath' FROM stimuli
        ) refs WHERE path=$1 OR left(path,length($1)+1)=$1 || '/' LIMIT 1`, [file.relativePath]);
        if (referenced.rows.length) throw new HttpError(409,
          'Media artifacts are still referenced; preserve them for manual repair', 'media_artifact_referenced');
        try {
          const realRoot = await fs.realpath(uploadsRoot);
          let component = realRoot;
          for (const segment of file.relativePath.split(path.sep)) {
            component = path.join(component, segment);
            const stat = await fs.lstat(component);
            if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1))) {
              throw new HttpError(409, 'Media artifact inventory needs repair', 'media_artifact_invalid');
            }
          }
          if (artifact.directory) await fs.rm(file.absolutePath, { recursive: true, force: true });
          else await fs.unlink(file.absolutePath);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        await client.query(`DELETE FROM media_storage_objects WHERE organization_id=$1
          AND (content_path=$2 OR left(content_path,length($2)+1)=$2 || '/')`, [operation.organization_id, file.relativePath]);
      }
      return publicOperation((await client.query(`UPDATE media_operations SET state='failed',reserved_bytes=0,disk_bytes=0,
        error_code='media_operation_reconciled',updated_at=now() WHERE id=$1 RETURNING *`, [id])).rows[0]);
    });
  } finally {
    try { if (locked) await lease.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]); lease.release(); }
    catch (_) { lease.release(true); }
  }
}

module.exports = { reconcileMediaOperation };
