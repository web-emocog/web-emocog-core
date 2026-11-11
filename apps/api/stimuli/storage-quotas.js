const fs = require('node:fs/promises');
const { HttpError } = require('../security/http-error');
const { resolveReadableServerOwnedUploadPath } = require('../security/upload-paths');
const { readStoragePolicy } = require('../config/storage-policy');

const operationClients = new WeakMap();
const ACTIVE = "('reserved','receiving','processing','uncertain')";
const ADMISSION_LOCK = 'wecog:media-admission:v1';

async function lockOrganization(client, organizationId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`wecog:media-quota:${organizationId}`]);
}

async function organizationForProject(client, projectId) {
  const row = (await client.query('SELECT organization_id FROM projects WHERE id=$1', [projectId])).rows[0];
  if (!row) throw new HttpError(404, 'Project not found', 'project_not_found');
  return row.organization_id;
}

async function usage(client, organizationId, excludeOperation = null) {
  const row = (await client.query(`SELECT
    (SELECT COALESCE(sum(size_bytes),0) FROM media_storage_objects WHERE organization_id=$1) AS retained_bytes,
    (SELECT count(*) FROM media_storage_objects WHERE organization_id=$1 AND size_bytes IS NULL) AS unmeasured,
    (SELECT COALESCE(sum(reserved_bytes),0) FROM media_operations
      WHERE organization_id=$1 AND state IN ${ACTIVE} AND ($2::uuid IS NULL OR id<>$2)) AS reserved_bytes`,
  [organizationId, excludeOperation])).rows[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

async function assertQuota(client, organizationId, extraBytes = 0, policy = readStoragePolicy()) {
  const totals = await usage(client, organizationId, operationClients.get(client)?.id);
  if (totals.unmeasured) throw new HttpError(503, 'Media inventory needs validation before uploading', 'media_inventory_unmeasured');
  if (totals.retained_bytes + totals.reserved_bytes + extraBytes > policy.organizationBytes) {
    throw new HttpError(413, 'Organization media storage quota exceeded; retained historical versions count toward storage', 'media_quota_exceeded');
  }
  return totals;
}

async function measureUnmeasured(client, organizationId, root) {
  const rows = (await client.query(`SELECT content_path FROM media_storage_objects
    WHERE organization_id=$1 AND size_bytes IS NULL ORDER BY content_path LIMIT 501`, [organizationId])).rows;
  if (rows.length > 500) throw new HttpError(503, 'Media inventory needs offline validation before uploading', 'media_inventory_unmeasured');
  for (const row of rows) {
    const file = await resolveReadableServerOwnedUploadPath(root, row.content_path);
    if (!file.ok) throw new HttpError(503, 'Media inventory needs repair before uploading', 'media_inventory_unmeasured');
    const stat = await fs.stat(file.absolutePath);
    await client.query('UPDATE media_storage_objects SET size_bytes=$1 WHERE organization_id=$2 AND content_path=$3 AND size_bytes IS NULL',
      [stat.size, organizationId, row.content_path]);
  }
}

async function assertDiskSpace(client, root, additionalBytes = 0, policy = readStoragePolicy()) {
  let available;
  try {
    const stat = await fs.statfs(root, { bigint: true });
    available = stat.bavail * stat.bsize;
  } catch (_) {
    throw new HttpError(503, 'Media disk capacity cannot be verified', 'media_disk_unavailable');
  }
  const reserved = (await client.query(`SELECT COALESCE(sum(disk_bytes),0) AS bytes FROM media_operations WHERE state IN ${ACTIVE}`)).rows[0];
  if (available < BigInt(policy.minFreeBytes) + BigInt(reserved.bytes) + BigInt(additionalBytes)) {
    throw new HttpError(507, 'Insufficient safe disk capacity for media processing', 'media_disk_low');
  }
}

async function previewBudget(client, version, policy = readStoragePolicy()) {
  const row = (await client.query('SELECT project_id FROM stimuli WHERE id=$1', [version.stimulus_id])).rows[0];
  if (!row) throw new HttpError(409, 'Stimulus version is no longer available', 'stimulus_version_changed');
  const organizationId = await organizationForProject(client, row.project_id);
  await lockOrganization(client, organizationId);
  await assertQuota(client, organizationId, policy.previewBytes, policy);
  return organizationId;
}

async function accountObject(client, organizationId, relativePath, bytes, policy = readStoragePolicy()) {
  await lockOrganization(client, organizationId);
  const previous = (await client.query('SELECT size_bytes FROM media_storage_objects WHERE organization_id=$1 AND content_path=$2',
    [organizationId, relativePath])).rows[0];
  if (previous && previous.size_bytes !== null && Number(previous.size_bytes) !== bytes) {
    throw new HttpError(409, 'Immutable media size changed', 'stimulus_checksum_mismatch');
  }
  await client.query(`INSERT INTO media_storage_objects(organization_id,content_path,size_bytes) VALUES($1,$2,$3)
    ON CONFLICT(organization_id,content_path) DO UPDATE SET size_bytes=EXCLUDED.size_bytes`, [organizationId, relativePath, bytes]);
  await assertQuota(client, organizationId, 0, policy);
}

module.exports = { ACTIVE, ADMISSION_LOCK, operationClients, lockOrganization, organizationForProject,
  usage, assertQuota, measureUnmeasured, assertDiskSpace, accountObject, previewBudget };
