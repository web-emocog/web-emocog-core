const crypto = require('node:crypto');
const { HttpError } = require('../security/http-error');
const { withTransaction } = require('../db/transaction');
const { readStoragePolicy } = require('../config/storage-policy');
const { rejectOwnedFields } = require('./access');
const { rejectClientOwnedContentPath } = require('../security/upload-paths');
const { ACTIVE, ADMISSION_LOCK, operationClients, lockOrganization, assertQuota,
  measureUnmeasured, assertDiskSpace } = require('./storage-quotas');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fingerprint(descriptor) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(descriptor))).digest('hex');
}
function validKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}
function normalizeDescriptor(input, limits) {
  const invalid = () => { throw new HttpError(422, 'Invalid media operation descriptor; refresh the client and validate the file', 'media_operation_invalid'); };
  if (!input || rejectOwnedFields(input) || !['upload','replace','convert'].includes(input.kind)) invalid();
  const file = input.file;
  const max = input.kind === 'convert' ? limits.maxDocumentBytes : limits.maxUploadBytes;
  if (!Number.isSafeInteger(input.project_id) || input.project_id < 1 || !file
    || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > max
    || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)
    || typeof file.type !== 'string' || !file.type || file.type.length > 255
    || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 512) invalid();
  if (input.kind === 'replace' && (!Number.isSafeInteger(input.stimulus_id) || input.stimulus_id < 1)) invalid();
  const folderId = input.folder_id == null ? null : input.folder_id;
  if (folderId !== null && (!Number.isSafeInteger(folderId) || folderId < 1)) invalid();
  if (input.visibility !== undefined && !['private','project'].includes(input.visibility)) invalid();
  const metadata = input.metadata || {};
  if (typeof metadata !== 'object' || Array.isArray(metadata) || !rejectClientOwnedContentPath(metadata).ok) invalid();
  const name = input.name === undefined ? file.name.trim() : String(input.name).trim();
  if (!name || name.length > 512) invalid();
  return { kind: input.kind, project_id: input.project_id,
    stimulus_id: input.kind === 'replace' ? input.stimulus_id : null,
    file: { size: file.size, sha256: file.sha256, type: file.type.toLowerCase(), name: file.name },
    name, folder_id: folderId, visibility: input.visibility || 'private', metadata: canonical(metadata) };
}

function reservationCost(descriptor, limits, policy = readStoragePolicy()) {
  const bytes = descriptor.kind === 'convert'
    ? policy.conversionOutputBytes + limits.maxPages * policy.previewBytes
    : descriptor.file.size + (/^(image|video)\//.test(descriptor.file.type) ? policy.previewBytes : 0);
  return { bytes, disk: bytes + (descriptor.kind === 'convert' ? policy.conversionWorkingBytes : descriptor.file.size) };
}
function publicOperation(row) {
  const expired = new Date(row.expires_at).getTime() <= Date.now();
  const stale = ['receiving','processing'].includes(row.state) && expired;
  const expiredReservation = row.state === 'reserved' && expired;
  return { key: row.operation_key, project_id: row.project_id, state: stale ? 'uncertain' : expiredReservation ? 'failed' : row.state,
    ...(row.state === 'completed' ? { status: row.result_status, result: row.result } : {}),
    ...(expiredReservation ? { code: 'media_reservation_expired' } : row.error_code ? { code: row.error_code } : {}),
    recovery_required: row.state === 'uncertain' || stale, expires_at: row.expires_at };
}
async function findOperation(pool, actorId, key) {
  if (!validKey(key)) throw new HttpError(422, 'Create a media operation before uploading; refresh this client', 'media_operation_required');
  return (await pool.query('SELECT * FROM media_operations WHERE actor_id=$1 AND operation_key=$2', [actorId, key])).rows[0];
}

async function admitOperation(pool, actorId, organizationId, key, descriptor, root, limits, policy = readStoragePolicy()) {
  if (!validKey(key)) throw new HttpError(422, 'Use a stable media operation key of 16 to 128 characters', 'media_operation_invalid');
  const digest = fingerprint(descriptor);
  return withTransaction(pool, async client => {
    // Admission locks are short-lived: never held while receiving or running native tools.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [ADMISSION_LOCK]);
    await lockOrganization(client, organizationId);
    const existing = await findOperation(client, actorId, key);
    if (existing) {
      if (existing.fingerprint !== digest || Number(existing.organization_id) !== Number(organizationId)) {
        throw new HttpError(409, 'Media operation key was used for a different request', 'media_operation_conflict');
      }
      if (existing.state !== 'reserved' || new Date(existing.expires_at).getTime() > Date.now()) return existing;
      const expired = await client.query(`UPDATE media_operations SET state='failed',reserved_bytes=0,disk_bytes=0,
        error_code='media_reservation_expired',updated_at=now()
        WHERE id=$1 AND state='reserved' AND expires_at<=now() RETURNING *`, [existing.id]);
      return expired.rows[0] || (await findOperation(client, actorId, key));
    }
    // Only never-claimed reservations can expire automatically. A crashed writer
    // remains charged until an operator proves rollback and removes its artifacts.
    await client.query(`UPDATE media_operations SET state='failed',reserved_bytes=0,disk_bytes=0,
      error_code='media_reservation_expired',updated_at=now()
      WHERE state='reserved' AND expires_at<now()`);
    await client.query(`UPDATE media_operations SET state='uncertain',error_code='media_recovery_required',updated_at=now()
      WHERE state IN ('receiving','processing') AND expires_at<now()`);
    const counts = (await client.query(`SELECT count(*) AS total,
      count(*) FILTER (WHERE actor_id=$1) AS actor FROM media_operations WHERE state IN ${ACTIVE}`, [actorId])).rows[0];
    const poolCapacity = pool.options?.max === undefined ? policy.maxActiveUploads : Math.floor(pool.options.max / 2);
    if (poolCapacity < 1) throw new HttpError(503, 'Media processing requires at least two database connections', 'media_pool_capacity');
    if (Number(counts.actor) >= policy.maxUserUploads || Number(counts.total) >= Math.min(policy.maxActiveUploads, poolCapacity)) {
      throw new HttpError(429, 'Too many active media uploads; finish or recover an existing operation', 'media_upload_capacity');
    }
    await measureUnmeasured(client, organizationId, root);
    const cost = reservationCost(descriptor, limits, policy);
    await assertQuota(client, organizationId, cost.bytes, policy);
    await assertDiskSpace(client, root, cost.disk, policy);
    return (await client.query(`INSERT INTO media_operations
      (id,actor_id,organization_id,project_id,operation_key,fingerprint,descriptor,state,reserved_bytes,disk_bytes,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'reserved',$8,$9,now()+$10*interval '1 millisecond') RETURNING *`,
    [crypto.randomUUID(), actorId, organizationId, descriptor.project_id, key, digest, JSON.stringify(descriptor), cost.bytes, cost.disk, policy.reservationTtlMs])).rows[0];
  });
}

async function claimOperation(pool, operation, root, policy = readStoragePolicy()) {
  const client = await pool.connect();
  const lock = `wecog:media-operation:${operation.id}`;
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [lock])).rows[0].locked;
    if (!locked) throw new HttpError(409, 'Media operation is in progress; poll its status instead of uploading again', 'media_operation_pending');
    const fresh = (await client.query('SELECT * FROM media_operations WHERE id=$1', [operation.id])).rows[0];
    if (fresh.state === 'completed') {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]);
      client.release();
      return { operation: fresh, replay: true };
    }
    if (fresh.state !== 'reserved') throw new HttpError(409,
      'Media operation cannot be restarted; poll or reconcile its existing outcome', fresh.state === 'failed' ? 'media_operation_failed' : 'media_operation_pending');
    await assertDiskSpace(client, root, 0, policy);
    const row = (await client.query(`UPDATE media_operations SET state='receiving',updated_at=now(),
      expires_at=now()+$2*interval '1 millisecond' WHERE id=$1 AND state='reserved' AND expires_at>now() RETURNING *`,
    [operation.id, policy.reservationTtlMs])).rows[0];
    if (!row) throw new HttpError(409, 'Media reservation expired; create a new operation after validation', 'media_reservation_expired');
    let released = false;
    return { operation: row, client, release: async () => {
      if (released) return;
      released = true;
      try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]); client.release(); }
      catch (_) { client.release(true); }
    } };
  } catch (error) {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]).catch(() => {});
    client.release(true);
    throw error;
  }
}

async function completeOperation(client, operation, status, result, callback) {
  // Fence stale/reconciled writers before they can publish. Same transaction
  // records media, releases the reservation, and stores the exact replay result.
  await lockOrganization(client, operation.organization_id);
  const row = (await client.query('SELECT * FROM media_operations WHERE id=$1 FOR UPDATE', [operation.id])).rows[0];
  if (!row || !['receiving','processing'].includes(row.state)) {
    throw new HttpError(409, 'Media operation needs recovery before publication', 'media_recovery_required');
  }
  operationClients.set(client, operation);
  try {
    const value = await callback(client);
    const body = result(value);
    await client.query(`UPDATE media_operations SET state='completed',reserved_bytes=0,disk_bytes=0,
      result_status=$2,result=$3::jsonb,error_code=NULL,updated_at=now() WHERE id=$1`, [operation.id, status, JSON.stringify(body)]);
    return body;
  } finally { operationClients.delete(client); }
}

async function failOperation(pool, operation, uncertain = false) {
  await pool.query(`UPDATE media_operations SET state=$2,
    reserved_bytes=CASE WHEN $3 THEN reserved_bytes ELSE 0 END,
    disk_bytes=CASE WHEN $3 THEN disk_bytes ELSE 0 END,
    error_code=$4,updated_at=now() WHERE id=$1 AND state<>'completed'`,
  [operation.id, uncertain ? 'uncertain' : 'failed', uncertain, uncertain ? 'media_recovery_required' : 'media_operation_failed']);
}

module.exports = { canonical, fingerprint, validKey, normalizeDescriptor, reservationCost, publicOperation,
  findOperation, admitOperation, claimOperation, completeOperation, failOperation };
