#!/usr/bin/env node
const path = require('node:path');
const { pool } = require('../db');
const config = require('../config');
const { reconcileMediaOperation } = require('../stimuli/media-reconciliation');

async function main() {
  const id = process.argv[2];
  if (process.env.MEDIA_WRITERS_STOPPED !== 'YES' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || '')) {
    throw new Error('Stop every API/media writer and pass the database operation UUID with MEDIA_WRITERS_STOPPED=YES');
  }
  const result = await reconcileMediaOperation(pool, id, path.join(config.storage.uploadsRoot, 'stimuli'), { writersStopped: true });
  process.stdout.write(JSON.stringify({ state: result.state }) + '\n');
}

main().catch(error => {
  const code = /^media_[a-z_]+$/.test(error.code || '') ? error.code : 'media_reconciliation_failed';
  process.stderr.write(code + ': check the operator procedure before retrying.\n');
  process.exitCode = 1;
}).finally(() => pool.end());
