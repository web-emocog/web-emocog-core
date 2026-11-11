const path = require('node:path');
const fs = require('node:fs');
const { isIP } = require('node:net');

function readIdentityConfig(env = process.env) {
  if (env.IDENTITY_ENABLED !== 'true') return Object.freeze({ enabled: false });
  const invalid = () => { throw new Error('Invalid identity configuration; see docs/identity-onboarding.md'); };
  const production = env.NODE_ENV === 'production';
  const mode = env.IDENTITY_MAIL_MODE;
  if (!['local', 'smtp'].includes(mode) || (production && mode !== 'smtp')) invalid();
  let publicUrl;
  try { publicUrl = new URL(env.IDENTITY_PUBLIC_URL); } catch (_) { invalid(); }
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) invalid();
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
  if (mode === 'local' ? !loopback || publicUrl.protocol !== 'http:' : publicUrl.protocol !== 'https:') invalid();
  if (production && (loopback || isIP(publicUrl.hostname.replace(/^\[|\]$/g, ''))
    || !publicUrl.hostname.includes('.') || /\.(local|localhost|internal)$/.test(publicUrl.hostname))) invalid();
  const trustedOrigins = String(env.IDENTITY_TRUSTED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!trustedOrigins.includes(publicUrl.origin)) invalid();
  const key = Buffer.from(env.IDENTITY_OUTBOX_KEY || '', 'base64');
  if (key.length !== 32 || key.toString('base64') !== env.IDENTITY_OUTBOX_KEY) invalid();
  const from = String(env.IDENTITY_MAIL_FROM || '');
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(from) || from.length > 254) invalid();
  const captureDir = env.IDENTITY_LOCAL_CAPTURE_DIR;
  if (mode === 'local' && (!captureDir || !path.isAbsolute(captureDir))) invalid();
  if (mode === 'local') {
    const resolved = path.resolve(captureDir), repo = path.resolve(__dirname, '../../..');
    if (resolved === repo || resolved.startsWith(repo + path.sep)) invalid();
    if (fs.existsSync(resolved)) {
      const stat = fs.lstatSync(resolved);
      if (!stat.isDirectory() || fs.realpathSync(resolved) !== resolved || (stat.mode & 0o077)
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) invalid();
    }
  }
  const port = Number(env.IDENTITY_SMTP_PORT || 587);
  if (mode === 'smtp' && (!env.IDENTITY_SMTP_HOST || !env.IDENTITY_SMTP_USER || !env.IDENTITY_SMTP_PASSWORD
    || !Number.isInteger(port) || port < 1 || port > 65535)) invalid();
  return Object.freeze({
    enabled: true, production, mode, publicUrl: publicUrl.href.replace(/\/+$/, '') + '/',
    trustedOrigins, key, from, captureDir,
    smtp: { host: env.IDENTITY_SMTP_HOST, port, secure: port === 465,
      auth: { user: env.IDENTITY_SMTP_USER, pass: env.IDENTITY_SMTP_PASSWORD } },
    tokenTtlSeconds: 1800, inviteTtlSeconds: 172800, resendSeconds: 60, maxAttempts: 5,
  });
}

module.exports = { readIdentityConfig };
