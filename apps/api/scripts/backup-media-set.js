#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pool } = require('../db');
const config = require('../config');
const { MEDIA_LOCK } = require('../stimuli/versions');
const { collectMediaInventory } = require('../stimuli/media-inventory');

function run(command, args, capture = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.stdout?.on('data', chunk => {
      output += chunk.toString();
      if (output.length > 64 * 1024) child.kill('SIGKILL');
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Backup tool unavailable')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim()); else reject(new Error('Backup tool failed'));
    });
  });
}

async function backupMediaSet(prefix, options = {}) {
  if (!path.isAbsolute(prefix)) throw new Error('Backup prefix must be absolute');
  const helper = options.helper || path.resolve(__dirname, '../../..', 'deploy/production/backup-support.py');
  const outputPaths = [`${prefix}.dump`, `${prefix}.uploads.tar.gz`, `${prefix}.media.json`];
  for (const file of outputPaths) {
    try { await fs.promises.lstat(file); throw new Error('Backup destination exists'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SET statement_timeout = 900000');
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [MEDIA_LOCK]);
    locked = true;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const inventory = await collectMediaInventory(client, config.storage.uploadsRoot);
    await fs.promises.writeFile(`${prefix}.media.json`, JSON.stringify(inventory) + '\n', { flag: 'wx', mode: 0o600 });
    await run(options.pgDump || process.env.PG_DUMP_BIN || 'pg_dump', [
      '--dbname=' + config.database.url, '--format=custom', '--no-owner', '--no-acl',
      '--snapshot=' + snapshot, '--file=' + `${prefix}.dump`,
    ]);
    await run(options.pgRestore || process.env.PG_RESTORE_BIN || 'pg_restore', ['--list', `${prefix}.dump`], false);
    await fs.promises.chmod(`${prefix}.dump`, 0o600);
    const count = Number(await run(options.python || 'python3', [helper, 'create-uploads', config.storage.uploadsRoot, `${prefix}.uploads.tar.gz`]));
    if (!Number.isInteger(count) || count < 0) throw new Error('Invalid backup file count');
    if (count) {
      await run(options.python || 'python3', [helper, 'verify-uploads', `${prefix}.uploads.tar.gz`]);
      await run(options.python || 'python3', [helper, 'verify-media', `${prefix}.uploads.tar.gz`, `${prefix}.media.json`]);
    } else if (inventory.files.length) throw new Error('Referenced media missing from backup');
    await client.query('COMMIT');
    return count;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [MEDIA_LOCK]).catch(() => {});
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  backupMediaSet(process.argv[2]).then(count => process.stdout.write(String(count) + '\n'))
    .catch(() => { process.stderr.write('Coordinated backup failed: check media integrity, tools and storage.\n'); process.exitCode = 1; })
    .finally(() => pool.end());
}
module.exports = { backupMediaSet };
