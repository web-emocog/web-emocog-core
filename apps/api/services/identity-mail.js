const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fork } = require('node:child_process');
const nodemailer = require('nodemailer');
const { withTransaction } = require('../db/transaction');
const { readIdentityConfig } = require('../config/identity');
const { encryptPayload, decryptPayload, canonicalEmail } = require('./identity-security');

async function enqueueMail(client, config, { email, token, purpose, expiresAt, challengeId = null, invitationId = null }) {
  const id = crypto.randomUUID();
  const page = purpose === 'invite' ? 'account/workspace.html' : 'account/confirm.html';
  const url = new URL(page, config.publicUrl);
  url.hash = new URLSearchParams({ purpose, token }).toString();
  const subjects = { signup: 'Confirm your wecog account', reset: 'Reset your wecog password',
    verify: 'Verify your wecog email', invite: 'Your wecog project invitation' };
  if (!subjects[purpose]) throw new Error('Unsupported identity mail purpose');
  const payload = { to: email, subject: subjects[purpose],
    text: `${subjects[purpose]}\n\n${url.href}\n\nOpen the link and deliberately confirm on the page. Opening this email does not activate anything.\nThe link expires at ${new Date(expiresAt).toISOString()}. If you did not request this, ignore it.\n` };
  await client.query(`INSERT INTO identity_mail_outbox
    (id, challenge_id, invitation_id, payload_cipher, expires_at) VALUES ($1,$2,$3,$4,$5)`,
  [id, challengeId, invitationId, encryptPayload(payload, config.key, id), expiresAt]);
}

function createMailTransport(config) {
  if (config.mode === 'local') return nodemailer.createTransport({ jsonTransport: true,
    disableFileAccess: true, disableUrlAccess: true });
  // A short-lived child enforces an absolute deadline even if an SMTP peer drips bytes.
  return { sendMail(mail) {
    return new Promise((resolve, reject) => {
      const child = fork(path.join(__dirname, 'identity-smtp-child.js'), [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [],
        env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      });
      let settled = false;
      const finish = (ok) => {
        if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGKILL');
        if (ok) resolve({}); else reject(new Error('Identity mail delivery failed'));
      };
      const timer = setTimeout(() => finish(false), 20000);
      child.once('message', result => finish(result?.ok === true));
      child.once('error', () => finish(false)); child.once('exit', () => finish(false));
      child.send({ smtp: config.smtp, mail }, error => { if (error) finish(false); });
    });
  } };
}

async function captureMail(config, id, info) {
  const dir = path.resolve(config.captureDir);
  const repo = path.resolve(__dirname, '../../..');
  if (dir === repo || dir.startsWith(repo + path.sep)) throw new Error('Local capture must be outside the repository');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (await fs.realpath(dir) !== dir) throw new Error('Local capture cannot use a symlink');
  const stat = await fs.stat(dir);
  if ((stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new Error('Local capture directory must be private and owned by this process');
  }
  try { await fs.writeFile(path.join(dir, id + '.json'), info.message, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

function createIdentityOutboxWorker({ pool = require('../db').pool, config = readIdentityConfig(), transport } = {}) {
  let timer, active, closed = false;
  const mailer = config.enabled ? (transport || createMailTransport(config)) : null;
  async function runOnce() {
    if (!config.enabled || closed) return false;
    return withTransaction(pool, async client => {
      await client.query("SET LOCAL statement_timeout = '25000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '30000ms'");
      await client.query(`DELETE FROM identity_challenges WHERE id IN (SELECT id FROM identity_challenges
        WHERE expires_at < clock_timestamp()-interval '7 days' ORDER BY expires_at LIMIT 100)`);
      await client.query(`DELETE FROM workspace_invitations WHERE id IN (SELECT id FROM workspace_invitations
        WHERE expires_at < clock_timestamp()-interval '30 days' ORDER BY expires_at LIMIT 100)`);
      await client.query(`DELETE FROM identity_email_throttles WHERE bucket IN (SELECT bucket FROM identity_email_throttles
        WHERE requested_at < clock_timestamp()-interval '1 day' ORDER BY requested_at LIMIT 100)`);
      await client.query(`UPDATE identity_mail_outbox SET status = 'cancelled', payload_cipher = NULL,
        finished_at = clock_timestamp() WHERE status = 'pending' AND expires_at <= clock_timestamp()`);
      const r = await client.query(`SELECT o.* FROM identity_mail_outbox o
        WHERE o.status = 'pending' AND o.next_attempt_at <= clock_timestamp()
          AND o.expires_at > clock_timestamp() AND o.attempts < $1
        ORDER BY o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, [config.maxAttempts]);
      const row = r.rows[0];
      if (!row) return false;
      const challenge = row.challenge_id ? await client.query(
        'SELECT 1 FROM identity_challenges WHERE id=$1 AND used_at IS NULL AND expires_at > clock_timestamp()', [row.challenge_id])
        : await client.query(`SELECT 1 FROM workspace_invitations WHERE id=$1 AND revoked_at IS NULL
          AND accepted_at IS NULL AND expires_at > clock_timestamp()`, [row.invitation_id]);
      if (!challenge.rowCount) {
        await client.query(`UPDATE identity_mail_outbox SET status='cancelled', payload_cipher=NULL,
          finished_at=clock_timestamp() WHERE id=$1`, [row.id]);
        return true;
      }
      try {
        const payload = decryptPayload(row.payload_cipher, config.key, row.id);
        if (await canonicalEmail(payload.to) !== payload.to || typeof payload.text !== 'string'
          || payload.text.length > 4096 || !['Confirm your wecog account', 'Reset your wecog password',
            'Verify your wecog email', 'Your wecog project invitation'].includes(payload.subject)) throw new Error('Invalid outbox payload');
        const info = await mailer.sendMail({ from: config.from, to: payload.to, subject: payload.subject,
          text: payload.text, messageId: `<${row.id}@${config.from.split('@')[1]}>`,
          disableFileAccess: true, disableUrlAccess: true });
        if (config.mode === 'local') await captureMail(config, row.id, info);
        await client.query(`UPDATE identity_mail_outbox SET status='sent', payload_cipher=NULL,
          attempts=attempts+1, finished_at=clock_timestamp() WHERE id=$1`, [row.id]);
      } catch (_) {
        // SMTP errors can contain addresses, credentials and message contents. Never log them.
        await client.query(`UPDATE identity_mail_outbox SET attempts=attempts+1,
          status=CASE WHEN attempts+1 >= $2 THEN 'failed' ELSE 'pending' END,
          payload_cipher=CASE WHEN attempts+1 >= $2 THEN NULL ELSE payload_cipher END,
          finished_at=CASE WHEN attempts+1 >= $2 THEN clock_timestamp() ELSE NULL END,
          next_attempt_at=clock_timestamp() + (LEAST(900, 30 * power(2, attempts)) * interval '1 second')
          WHERE id=$1`, [row.id, config.maxAttempts]);
      }
      return true;
    });
  }
  function tick() {
    if (active || closed) return;
    active = runOnce().catch(() => false).finally(() => { active = null; });
  }
  return {
    runOnce,
    start() { if (!config.enabled || timer || closed) return; timer = setInterval(tick, 1000); timer.unref(); tick(); },
    async stop() { closed = true; clearInterval(timer); await active; mailer?.close?.(); },
  };
}

module.exports = { enqueueMail, createIdentityOutboxWorker, createMailTransport, captureMail };
