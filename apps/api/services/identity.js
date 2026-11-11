const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { withTransaction } = require('../db/transaction');
const { enqueueMail } = require('./identity-mail');
const { IdentityError, canonicalEmail, validPassword, tokenHash, makeToken, lockEmail, throttle, text } = require('./identity-security');

function createIdentityService({ pool, config }) {
  async function requestChallenge(purpose, inputEmail, actorId = null) {
    if (!['signup', 'reset', 'verify'].includes(purpose)) throw new IdentityError('invalid_request');
    const email = await canonicalEmail(inputEmail);
    await withTransaction(pool, async client => {
      await lockEmail(client, email);
      if (!await throttle(client, config, purpose + ':' + email)) return;
      const r = await client.query(`SELECT u.id,u.email,u.role,u.token_version,u.email_verified_at,
        NOT EXISTS (SELECT 1 FROM user_organizations WHERE user_id=u.id)
          AND NOT EXISTS (SELECT 1 FROM user_projects WHERE user_id=u.id) AS no_memberships
        FROM users u WHERE email=$1`, [email]);
      const user = r.rows[0];
      const claim = purpose === 'signup' && user?.role === 'respondent' && !user.email_verified_at && user.no_memberships;
      if (purpose === 'signup' ? Boolean(user) && !claim : !user) return;
      // A legacy address may be a typo or an unverified placeholder. It must
      // not grant password reset until a signed-in user proves mailbox control.
      if (purpose === 'reset' && !user.email_verified_at) return;
      if (purpose === 'verify' && (user.id !== actorId || user.email_verified_at)) return;
      const { token, hash } = makeToken(), id = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + config.tokenTtlSeconds * 1000);
      await client.query(`INSERT INTO identity_challenges
        (id,purpose,email,user_id,token_version,token_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, claim ? 'claim' : purpose, email, user?.id || null, user ? user.token_version : null, hash, expiresAt]);
      await enqueueMail(client, config, { email, token, purpose, expiresAt, challengeId: id });
    });
  }

  async function confirm({ token, password, display_name }) {
    const hash = tokenHash(token);
    const initial = await pool.query('SELECT email, purpose FROM identity_challenges WHERE token_hash=$1', [hash]);
    if (!initial.rows[0]) throw new IdentityError('invalid_or_expired_token');
    const purpose = initial.rows[0].purpose;
    if (purpose !== 'verify' && !validPassword(password)) throw new IdentityError('password_must_be_12_to_72_bytes');
    const displayName = ['signup', 'claim'].includes(purpose) && display_name ? text(display_name) : null;
    const passwordHash = purpose !== 'verify' ? await bcrypt.hash(password, 12) : null;
    return withTransaction(pool, async client => {
      await lockEmail(client, initial.rows[0].email);
      const r = await client.query(`SELECT * FROM identity_challenges WHERE token_hash=$1
        AND used_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`, [hash]);
      const challenge = r.rows[0];
      if (!challenge) throw new IdentityError('invalid_or_expired_token');
      if (purpose === 'signup') {
        const created = await client.query(`INSERT INTO users
          (email,password_hash,role,display_name,email_verified_at) VALUES ($1,$2,'researcher',$3,clock_timestamp())
          ON CONFLICT (email) DO NOTHING RETURNING id`, [challenge.email, passwordHash, displayName]);
        if (!created.rowCount) throw new IdentityError('invalid_or_expired_token');
      } else if (purpose === 'claim') {
        const claimed = await client.query(`UPDATE users SET password_hash=$1,role='researcher',
          display_name=$2,token_version=token_version+1,email_verified_at=clock_timestamp(),updated_at=clock_timestamp()
          WHERE id=$3 AND email=$4 AND token_version=$5 AND role='respondent' AND email_verified_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM user_organizations WHERE user_id=users.id)
            AND NOT EXISTS (SELECT 1 FROM user_projects WHERE user_id=users.id) RETURNING id`,
        [passwordHash, displayName, challenge.user_id, challenge.email, challenge.token_version]);
        if (!claimed.rowCount) throw new IdentityError('invalid_or_expired_token');
      } else {
        const updated = await client.query(`UPDATE users SET
          password_hash=CASE WHEN $1::text IS NULL THEN password_hash ELSE $1 END,
          token_version=token_version+1, email_verified_at=COALESCE(email_verified_at,clock_timestamp()),
          updated_at=clock_timestamp() WHERE id=$2 AND email=$3 AND token_version=$4 RETURNING id`,
        [passwordHash, challenge.user_id, challenge.email, challenge.token_version]);
        if (!updated.rowCount) throw new IdentityError('invalid_or_expired_token');
      }
      await client.query('UPDATE identity_challenges SET used_at=COALESCE(used_at,clock_timestamp()) WHERE email=$1', [challenge.email]);
      await client.query(`UPDATE identity_mail_outbox SET status='cancelled',payload_cipher=NULL,finished_at=clock_timestamp()
        WHERE status='pending' AND challenge_id IN (SELECT id FROM identity_challenges WHERE email=$1)`, [challenge.email]);
      return { ok: true, sign_in_required: true };
    });
  }
  return { requestChallenge, confirm };
}

module.exports = { createIdentityService };
