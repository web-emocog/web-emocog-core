const crypto = require('node:crypto');
const { body, validationResult } = require('express-validator');

class IdentityError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

async function canonicalEmail(value) {
  if (typeof value !== 'string' || value.length > 255) throw new IdentityError('invalid_email');
  const req = { body: { email: value.trim() } };
  // Use the same provider-specific policy as /auth/login, not a new alias policy.
  await body('email').isEmail().normalizeEmail().run(req);
  if (!validationResult(req).isEmpty() || !req.body.email) throw new IdentityError('invalid_email');
  return req.body.email;
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 12 && Buffer.byteLength(password, 'utf8') <= 72;
}
function tokenHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new IdentityError('invalid_or_expired_token');
  return crypto.createHash('sha256').update(token).digest('hex');
}
function makeToken() { const token = crypto.randomBytes(32).toString('base64url'); return { token, hash: tokenHash(token) }; }
function encryptPayload(value, key, id) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('identity-outbox:v1:' + id));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function decryptPayload(value, key, id) {
  const data = Buffer.from(value, 'base64');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAAD(Buffer.from('identity-outbox:v1:' + id));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
}
function text(value, max = 255) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new IdentityError('invalid_name');
  }
  return value.trim();
}
async function lockEmail(client, email) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['identity:' + email]);
}
async function throttle(client, config, scope) {
  const bucket = crypto.createHmac('sha256', config.key).update(scope).digest('hex');
  const r = await client.query(`INSERT INTO identity_email_throttles (bucket) VALUES ($1)
    ON CONFLICT (bucket) DO UPDATE SET requested_at = clock_timestamp()
    WHERE identity_email_throttles.requested_at < clock_timestamp() - ($2 * interval '1 second') RETURNING bucket`,
  [bucket, config.resendSeconds]);
  return r.rowCount > 0;
}

module.exports = { IdentityError, canonicalEmail, validPassword, tokenHash, makeToken,
  encryptPayload, decryptPayload, text, lockEmail, throttle };
