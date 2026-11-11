#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { constants } = require('node:fs');

async function readOutboxKey(keyFile) {
  const handle = await fs.open(keyFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077)
        || info.uid !== process.getuid() || info.size !== 44) throw new Error('Unsafe local outbox key');
    const buffer = Buffer.alloc(45);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const value = buffer.subarray(0, bytesRead).toString('utf8');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32) throw new Error('Unsafe local outbox key');
    return value;
  } finally { await handle.close(); }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Local identity launcher is not for production');
  const database = new URL(process.env.IDENTITY_LOCAL_DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)
    || !/(?:_dev|_test)$/.test(database.pathname)) throw new Error('Set IDENTITY_LOCAL_DATABASE_URL to a loopback *_dev or *_test database');
  const stateDir = path.join(await fs.realpath(os.tmpdir()), 'wecog-identity-' + process.getuid());
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  if (await fs.realpath(stateDir) !== stateDir || ((await fs.stat(stateDir)).mode & 0o077)) throw new Error('Local identity state directory must be private');
  const keyFile = path.join(stateDir, 'outbox-key');
  try { await fs.writeFile(keyFile, crypto.randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const outboxKey = await readOutboxKey(keyFile);
  Object.assign(process.env, { NODE_ENV: 'development', DATABASE_URL: database.href, FORCE_HTTPS: 'false',
    IDENTITY_ENABLED: 'true', IDENTITY_MAIL_MODE: 'local', IDENTITY_PUBLIC_URL: 'http://127.0.0.1:3000/apps/web/',
    IDENTITY_TRUSTED_ORIGINS: 'http://127.0.0.1:3000', IDENTITY_MAIL_FROM: 'wecog@local.test',
    IDENTITY_LOCAL_CAPTURE_DIR: path.join(stateDir, 'mail'), IDENTITY_OUTBOX_KEY: outboxKey });
  const express = require('express');
  const { pool } = require('../db');
  await pool.query('SELECT email_verified_at FROM users LIMIT 0');
  await pool.query('SELECT 1 FROM identity_mail_outbox LIMIT 0');
  const app = require('../app');
  const repo = path.resolve(__dirname, '../../..');
  const staticOptions = { dotfiles: 'deny', index: false };
  for (const name of ['web', 'shared', 'participant-web', 'researcher-web']) {
    app.use('/apps/' + name, express.static(path.join(repo, 'apps', name), staticOptions));
  }
  app.use('/lib', express.static(path.join(repo, 'lib'), staticOptions));
  app.use('/Audio_detection/browser', express.static(path.join(repo, 'Audio_detection/browser'), staticOptions));
  app.use('/packages/shared/multimodal', express.static(path.join(repo, 'packages/shared/multimodal'), staticOptions));
  const worker = require('../services/identity-mail').createIdentityOutboxWorker({ pool });
  const server = app.listen(3000, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  worker.start();
  process.stdout.write('Local signup: http://127.0.0.1:3000/apps/web/account/signup.html\nPrivate captured mail: ' + process.env.IDENTITY_LOCAL_CAPTURE_DIR + '\nNo external email is sent.\n');
  let stopped = false;
  async function stop() {
    if (stopped) return; stopped = true;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await worker.stop(); await pool.end();
  }
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (require.main === module) main().catch(() => { process.stderr.write('Local identity startup failed. Use a migrated, loopback *_dev or *_test database and a free port 3000.\n'); process.exitCode = 1; });
module.exports = { readOutboxKey };
