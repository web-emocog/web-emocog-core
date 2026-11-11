const SAFE_QUERY_KEYS = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'connect_timeout', 'application_name']);

function databaseName(value) {
  let url;
  try { url = new URL(value); } catch (_) { throw new Error('Invalid restore database configuration'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash || !url.hostname) {
    throw new Error('Invalid restore database configuration');
  }
  for (const key of url.searchParams.keys()) if (!SAFE_QUERY_KEYS.has(key)) {
    throw new Error('Ambiguous restore database configuration');
  }
  let name;
  try { name = decodeURIComponent(url.pathname.slice(1)); } catch (_) { throw new Error('Invalid restore database configuration'); }
  if (!name || /[\0\r\n/]/.test(name)) throw new Error('An explicit database name is required');
  return name;
}

function assertRestoreTarget(sourceUrl, targetUrl, drill = false) {
  const target = databaseName(targetUrl);
  // Different host aliases or passwords do not make the same database disposable.
  // Unattended drills never overwrite a same-named database, even on another host.
  if (sourceUrl && databaseName(sourceUrl) === target) throw new Error('Restore target must have a different database name');
  if (drill && !/^(?:emocog_restore|wecog_restore_[a-f0-9]{8,32})$/.test(target)) {
    throw new Error('Restore drill requires a disposable target database');
  }
  return target;
}

if (require.main === module) {
  try { assertRestoreTarget(process.env.DATABASE_URL, process.env.RESTORE_DATABASE_URL, process.argv.includes('--drill')); }
  catch (_) { process.stderr.write('Restore target validation failed; no database was modified.\n'); process.exitCode = 2; }
}

module.exports = { databaseName, assertRestoreTarget };
