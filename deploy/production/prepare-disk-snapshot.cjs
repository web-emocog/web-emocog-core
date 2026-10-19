const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9-]{4,62}$/.test(value);

function readConfig(env) {
  const keep = Number(env.YC_AUTOMATED_SNAPSHOTS_TO_KEEP);
  const minimum = Number(env.YC_MIN_AUTOMATED_SNAPSHOTS_TO_KEEP ?? env.YC_AUTOMATED_SNAPSHOTS_TO_KEEP);
  if (!identifier(env.YC_FOLDER_ID) || !identifier(env.YC_VM_DISK_ID)
      || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
      || !Number.isInteger(keep) || keep < 2 || keep > 50
      || !Number.isInteger(minimum) || minimum < 2 || minimum > keep) {
    throw new Error('Invalid snapshot scope, release SHA or retention bounds. No snapshots were changed.');
  }
  return { folder: env.YC_FOLDER_ID, disk: env.YC_VM_DISK_ID, sha: env.GITHUB_SHA, keep, minimum };
}

function isOwned(snapshot, config) {
  return record(snapshot) && snapshot.folder_id === config.folder && snapshot.source_disk_id === config.disk
    && snapshot.labels?.app === 'wecog' && snapshot.labels?.reason === 'predeploy'
    && snapshot.labels?.protected !== 'true' && snapshot.labels?.baseline !== 'true' && snapshot.labels?.manual !== 'true'
    && /^wecog-predeploy-\d{8}-\d{6}-[a-f0-9]{8}$/.test(snapshot.name || '')
    && /^[a-f0-9]{12}$/.test(snapshot.labels?.commit || '');
}

function readySnapshots(inventory, config) {
  if (!Array.isArray(inventory) || inventory.some(item => !record(item) || !identifier(item.id))
      || new Set(inventory.map(item => item.id)).size !== inventory.length) {
    throw new Error('Invalid snapshot inventory. Refusing snapshot cleanup.');
  }
  const snapshots = inventory.filter(item => isOwned(item, config) && item.status === 'READY');
  if (snapshots.some(item => !Number.isFinite(Date.parse(item.created_at)))) {
    throw new Error('Invalid snapshot creation time. Refusing snapshot cleanup.');
  }
  return snapshots.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
}

function isSnapshotQuotaFailure(details) {
  return /code\s*=\s*ResourceExhausted\b/i.test(details)
    && /(?:limit|quota)[^\n]*(?:size|number|count)[^\n]*\bsnapshots\b/i.test(details);
}

function yc(args) {
  const result = spawnSync('yc', [...args, '--format', 'json'], {
    encoding: 'utf8', timeout: args[2] === 'create' ? 600000 : 120000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`Yandex snapshot ${args[2]} failed; deployment must not proceed.`);
    error.details = result.stderr || '';
    // A quota on some unrelated operation is not permission to delete a backup.
    error.snapshotQuota = isSnapshotQuotaFailure(error.details);
    throw error;
  }
  if (args[2] === 'delete') return null;
  try { return JSON.parse(result.stdout); }
  catch (_) { throw new Error(`Invalid JSON from snapshot ${args[2]}; deployment must not proceed.`); }
}

async function prepareSnapshot(config, { run = yc, sleep = delay, now = () => new Date(), log = console.log, checkOnly = false } = {}) {
  const inventory = () => run(['compute', 'snapshot', 'list', '--folder-id', config.folder]);
  let owned = readySnapshots(inventory(), config);
  log(`Snapshot preflight: ${owned.length} owned READY snapshots; target ${config.keep}, minimum ${config.minimum}.`);
  if (checkOnly) return { readyCount: owned.length };

  const removeOldest = () => {
    const candidate = owned.at(-1);
    if (owned.length <= config.minimum - 1) throw new Error('Refusing to remove the retained recovery snapshot.');
    const refreshed = readySnapshots(inventory(), config);
    const current = refreshed.find(item => item.id === candidate.id);
    if (!current || current.created_at !== candidate.created_at || current.name !== candidate.name
        || current.labels.commit !== candidate.labels.commit
        || refreshed.slice(0, config.minimum - 1).some(item => item.id === candidate.id)) {
      throw new Error('Snapshot inventory changed during cleanup; refusing deletion.');
    }
    run(['compute', 'snapshot', 'delete', '--id', candidate.id]);
    owned = refreshed.filter(item => item.id !== candidate.id);
    log(`Removed expired automated snapshot ${candidate.id}; ${owned.length} previous READY snapshots retained.`);
  };

  let deletedSinceCreate = false;
  // Reserve a slot before creating, rather than requiring temporary N+1 capacity.
  while (owned.length > config.keep - 1) { removeOldest(); deletedSinceCreate = true; }
  const stamp = now().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `wecog-predeploy-${stamp}-${config.sha.slice(0, 8)}`;
  let retriedAfterDelete = false;
  for (;;) {
    try {
      const snapshot = run(['compute', 'snapshot', 'create', '--folder-id', config.folder, '--name', name,
        '--description', `Wecog automatic pre-deploy snapshot for ${config.sha}`,
        '--labels', `app=wecog,reason=predeploy,commit=${config.sha.slice(0, 12)}`, '--disk-id', config.disk]);
      if (!isOwned(snapshot, config) || !identifier(snapshot.id) || snapshot.name !== name
          || snapshot.labels.commit !== config.sha.slice(0, 12) || snapshot.status !== 'READY'
          || !Number.isFinite(Date.parse(snapshot.created_at))) {
        throw new Error('New disk snapshot is not verified READY for this release; deployment must not proceed.');
      }
      log(`Verified new READY snapshot ${snapshot.id}; previous recovery snapshot and manual snapshots preserved.`);
      return snapshot;
    } catch (error) {
      if (!error.snapshotQuota) throw error;
      // Deletion quota accounting can lag; never delete another copy on the first stale response.
      if (deletedSinceCreate && !retriedAfterDelete) {
        retriedAfterDelete = true;
        await sleep(3000);
        continue;
      }
      if (owned.length <= config.minimum - 1) {
        throw new Error(`Snapshot quota exhausted at the approved retention floor (${config.minimum}). `
          + 'Increase compute.snapshots.size/count or review unrelated snapshots. Manual backups were not changed.');
      }
      removeOldest();
      deletedSinceCreate = true;
      retriedAfterDelete = false;
      await sleep(1000);
    }
  }
}

if (require.main === module) {
  Promise.resolve().then(() => {
    if (process.argv.slice(2).some(arg => arg !== '--check-only')) throw new Error('Only --check-only is supported.');
    return prepareSnapshot(readConfig(process.env), { checkOnly: process.argv.includes('--check-only') });
  }).catch(error => {
    console.error(error.message);
    if (error.details) console.error(error.details.slice(0, 4000));
    process.exitCode = 1;
  });
}

module.exports = { readConfig, readySnapshots, prepareSnapshot, isSnapshotQuotaFailure };
