#!/usr/bin/env node
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Client } = require('pg');
const config = require('../config');
const { pool } = require('../db');
const { backupMediaSet } = require('./backup-media-set');
const { collectMediaInventory } = require('../stimuli/media-inventory');
const { assertRestoreTarget } = require('../security/restore-target');
const { runNativeProcess } = require('../security/native-process');

async function databaseFingerprint(client) {
  const tables = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename NOT IN ('http_rate_windows') ORDER BY tablename`)).rows;
  if (tables.length > 100) throw new Error('Restore fingerprint table limit');
  const result = {};
  for (const { tablename } of tables) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(tablename)) throw new Error('Unexpected restore table');
    const digest = createHash('sha256');
    let count = 0;
    await client.query(`DECLARE restore_fingerprint NO SCROLL CURSOR FOR
      SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash
      FROM public."${tablename}" t ORDER BY 1`);
    try {
      while (true) {
        const batch = (await client.query('FETCH 1000 FROM restore_fingerprint')).rows;
        if (!batch.length) break;
        for (const row of batch) { digest.update(row.hash); count++; }
      }
    } finally { await client.query('CLOSE restore_fingerprint'); }
    result[tablename] = { rows: count, sha256: digest.digest('hex') };
  }
  return result;
}

async function fingerprintSnapshot(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  try { const result = await databaseFingerprint(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}

async function verifyMediaRestore() {
  // This is an automated CI/local rehearsal, never a destructive production restore.
  if (config.nodeEnv === 'production' || process.env.ALLOW_MEDIA_RESTORE_DRILL !== 'YES'
      || process.env.S2_TEST_DATABASE_URL !== config.database.url || !process.env.RESTORE_ADMIN_DATABASE_URL) {
    throw new Error('Use an explicitly approved disposable database fixture');
  }
  const targetName = `wecog_restore_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const targetUrl = new URL(process.env.RESTORE_ADMIN_DATABASE_URL);
  targetUrl.pathname = '/' + targetName;
  assertRestoreTarget(config.database.url, targetUrl.href, true);
  const started = performance.now();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-media-restore-'));
  await fs.chmod(temporary, 0o700);
  const admin = new Client({ connectionString: process.env.RESTORE_ADMIN_DATABASE_URL, statement_timeout: 60_000 });
  const restored = new Client({ connectionString: targetUrl.href, statement_timeout: 60_000 });
  const source = await pool.connect();
  let created = false, restoredConnected = false;
  try {
    const before = await fingerprintSnapshot(source);
    const prefix = path.join(temporary, 'snapshot');
    const fileCount = await backupMediaSet(prefix);
    await admin.connect();
    await admin.query(`CREATE DATABASE "${targetName}"`);
    created = true;
    // Credentials remain in a private environment, never command arguments or output.
    const restore = new URL(targetUrl);
    const env = { PGHOST: restore.hostname.replace(/^\[|\]$/g, ''), PGPORT: restore.port || '5432', PGDATABASE: targetName,
      PGUSER: decodeURIComponent(restore.username), PGPASSWORD: decodeURIComponent(restore.password) };
    for (const [key, value] of restore.searchParams) {
      const name = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', connect_timeout: 'PGCONNECT_TIMEOUT' }[key];
      if (name) env[name] = value;
    }
    await runNativeProcess(process.env.PG_RESTORE_BIN || 'pg_restore', ['--dbname', targetName, '--no-owner', '--no-acl', '--exit-on-error',
      '--single-transaction', prefix + '.dump'], { env, timeoutMs: 15 * 60 * 1000 });
    if (fileCount) {
      await runNativeProcess('python3', [path.resolve(__dirname, '../../../deploy/production/backup-support.py'),
        'verify-uploads', prefix + '.uploads.tar.gz', '--restore-to-new-directory', path.join(temporary, 'restored')], { timeoutMs: 15 * 60 * 1000 });
    } else await fs.mkdir(path.join(temporary, 'restored'), { mode: 0o700 });
    await restored.connect(); restoredConnected = true;
    const after = await fingerprintSnapshot(source);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Source changed; repeat rehearsal without active writers');
    const actual = await fingerprintSnapshot(restored);
    if (JSON.stringify(before) !== JSON.stringify(actual)) throw new Error('Restored database content mismatch');
    const restoredInventory = await collectMediaInventory(restored, path.join(temporary, 'restored'));
    const expected = JSON.parse(await fs.readFile(prefix + '.media.json', 'utf8'));
    if (JSON.stringify(restoredInventory) !== JSON.stringify(expected)) throw new Error('Restored media inventory mismatch');
    return { formatVersion: 1, databaseContentVerified: true, mediaHashesVerified: true,
      tables: Object.keys(actual).length, files: expected.files.length, durationMs: Math.round(performance.now() - started) };
  } finally {
    source.release();
    if (restoredConnected) await restored.end();
    if (created) await admin.query(`DROP DATABASE "${targetName}"`).catch(() => {});
    await admin.end().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  verifyMediaRestore().then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(() => { process.stderr.write('Media restore rehearsal failed; inspect the isolated fixture and retry.\n'); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { databaseFingerprint, verifyMediaRestore };
