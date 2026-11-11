const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { createIdentityService } = require('../services/identity');
const { createWorkspaceService } = require('../services/workspace');
const { decryptPayload } = require('../services/identity-security');
const { createIdentityOutboxWorker } = require('../services/identity-mail');

const url = process.env.IDENTITY_TEST_DATABASE_URL;
describe('identity PostgreSQL isolation and concurrency', { skip: !url }, () => {
  let pool, config, identity, workspace, root, apiPool;
  const users = [], organizations = [], suffix = crypto.randomUUID().slice(0, 8);
  const email = name => `${name}-${suffix}@example.test`;
  const password = 'synthetic-password-14';
  before(async () => {
    const parsed = new URL(url);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
    assert.match(parsed.pathname, /_test$/);
    pool = new (require('pg').Pool)({ connectionString: url, statement_timeout: 10000 });
    root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'identity-pg-'));
    config = { enabled: true, mode: 'local', publicUrl: 'http://127.0.0.1:3000/apps/web/', from: 'wecog@local.test',
      trustedOrigins: ['http://127.0.0.1:3000'], key: crypto.randomBytes(32), captureDir: path.join(root, 'mail'),
      tokenTtlSeconds: 1800, inviteTtlSeconds: 172800, resendSeconds: 60, maxAttempts: 5 };
    identity = createIdentityService({ pool, config }); workspace = createWorkspaceService({ pool, config });
  });
  after(async () => {
    if (pool) {
      await pool.query('DELETE FROM organizations WHERE id=ANY($1::int[])', [organizations]);
      await pool.query('DELETE FROM identity_challenges WHERE email LIKE $1', [`%-${suffix}@example.test`]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [users]);
      await pool.end();
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
    if (apiPool) await apiPool.end();
  });
  async function mail(address, invitation = false) {
    const result = await pool.query(invitation ? `SELECT o.* FROM identity_mail_outbox o JOIN workspace_invitations i
      ON i.id=o.invitation_id WHERE i.email=$1 ORDER BY o.created_at DESC LIMIT 1` :
      `SELECT o.* FROM identity_mail_outbox o JOIN identity_challenges c ON c.id=o.challenge_id
       WHERE c.email=$1 ORDER BY o.created_at DESC LIMIT 1`, [address]);
    const row = result.rows[0], payload = decryptPayload(row.payload_cipher, config.key, row.id);
    const link = new URL(payload.text.match(/http[^\s]+/)[0]);
    assert.equal(link.search, '');
    return { token: new URLSearchParams(link.hash.slice(1)).get('token'), row, payload };
  }
  async function user(name, role = 'researcher', verified = true) {
    const r = await pool.query(`INSERT INTO users(email,password_hash,role,email_verified_at)
      VALUES ($1,$2,$3,CASE WHEN $4 THEN clock_timestamp() ELSE NULL END) RETURNING *`,
    [email(name), await bcrypt.hash(password, 4), role, verified]);
    const u = r.rows[0]; users.push(u.id); return { ...u, sub: u.id, ver: u.token_version };
  }
  async function organization(owner) {
    const result = await workspace.create(owner, { organization_name: 'Identity test ' + suffix, project_name: 'Private project' });
    organizations.push(result.organization.id); return result;
  }
  it('signup is email-first, throttled, hashed, single-use under concurrent confirmation', async () => {
    const address = email('signup');
    await Promise.all([identity.requestChallenge('signup', address), identity.requestChallenge('signup', address)]);
    assert.equal((await pool.query('SELECT 1 FROM users WHERE email=$1', [address])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM identity_challenges WHERE email=$1', [address])).rowCount, 1);
    const { token, row } = await mail(address);
    assert.equal(row.payload_cipher.includes(token), false);
    const confirmed = await Promise.allSettled([identity.confirm({ token, password }), identity.confirm({ token, password: password + '-other' })]);
    assert.equal(confirmed.filter(r => r.status === 'fulfilled').length, 1);
    const created = (await pool.query('SELECT * FROM users WHERE email=$1', [address])).rows[0]; users.push(created.id);
    assert.equal(created.role, 'researcher'); assert.ok(created.email_verified_at);
    await assert.rejects(identity.confirm({ token, password }), /invalid_or_expired_token/);
    assert.equal((await pool.query('SELECT 1 FROM user_organizations WHERE user_id=$1', [created.id])).rowCount, 0);
  });
  it('existing staff identity is never overwritten; stale signup cannot pre-hijack an account', async () => {
    const staff = await user('staff', 'PI', false);
    await identity.requestChallenge('signup', staff.email);
    assert.equal((await pool.query('SELECT 1 FROM identity_challenges WHERE email=$1', [staff.email])).rowCount, 0);
    const address = email('race'); await identity.requestChallenge('signup', address);
    const { token } = await mail(address);
    const claimed = await pool.query("INSERT INTO users(email,password_hash,role) VALUES ($1,$2,'researcher') RETURNING id", [address, staff.password_hash]);
    users.push(claimed.rows[0].id);
    await assert.rejects(identity.confirm({ token, password }), /invalid_or_expired_token/);
    assert.equal((await pool.query('SELECT password_hash FROM users WHERE email=$1', [address])).rows[0].password_hash, staff.password_hash);
  });
  it('legacy unverified respondent preclaims can only be claimed with email proof and a new password; old sessions rotate', async () => {
    const respondent = await user('preclaim', 'respondent', false);
    await identity.requestChallenge('signup', respondent.email);
    const { token } = await mail(respondent.email);
    await identity.confirm({ token, password: password + '-email-owner' });
    const current = (await pool.query('SELECT * FROM users WHERE id=$1', [respondent.id])).rows[0];
    assert.equal(current.role, 'researcher'); assert.equal(current.token_version, respondent.ver + 1);
    assert.ok(current.email_verified_at); assert.equal(await bcrypt.compare(password, current.password_hash), false);
    const verified = await user('existing-respondent', 'respondent', true);
    await identity.requestChallenge('signup', verified.email);
    assert.equal((await pool.query('SELECT 1 FROM identity_challenges WHERE email=$1', [verified.email])).rowCount, 0);
  });
  it('reset is one-time, expires, revokes sibling challenges and rotates session version atomically', async () => {
    const account = await user('reset');
    await identity.requestChallenge('reset', account.email);
    const first = await mail(account.email);
    await pool.query("UPDATE identity_email_throttles SET requested_at=clock_timestamp()-interval '2 minutes'");
    await identity.requestChallenge('reset', account.email);
    const second = await mail(account.email);
    await identity.confirm({ token: second.token, password: password + '-reset' });
    const current = (await pool.query('SELECT * FROM users WHERE id=$1', [account.id])).rows[0];
    assert.equal(current.token_version, account.ver + 1); assert.ok(current.email_verified_at);
    await assert.rejects(identity.confirm({ token: first.token, password }), /invalid_or_expired_token/);
    await assert.rejects(workspace.create(account, { organization_name: 'stale', project_name: 'stale' }), /verified_researcher_required/);
    await pool.query("UPDATE identity_email_throttles SET requested_at=clock_timestamp()-interval '2 minutes'");
    await identity.requestChallenge('reset', account.email);
    const expired = await mail(account.email);
    await pool.query("UPDATE identity_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expired.row.challenge_id]);
    await assert.rejects(identity.confirm({ token: expired.token, password }), /invalid_or_expired_token/);
  });
  it('does not send reset mail for a legacy unverified identity; signed-in verification enables recovery', async () => {
    const legacy = await user('legacy-admin', 'admin', false);
    await identity.requestChallenge('reset', legacy.email);
    assert.equal((await pool.query('SELECT 1 FROM identity_challenges WHERE email=$1', [legacy.email])).rowCount, 0);
    await identity.requestChallenge('verify', legacy.email, legacy.id);
    const verification = await mail(legacy.email);
    await identity.confirm({ token: verification.token });
    const verified = (await pool.query('SELECT * FROM users WHERE id=$1', [legacy.id])).rows[0];
    assert.ok(verified.email_verified_at);
    assert.equal(verified.password_hash, legacy.password_hash);
    assert.equal(verified.role, 'admin');
  });
  it('unverified/foreign identities cannot onboard; owner is scoped, not a global elevation', async () => {
    const pending = await user('unverified', 'researcher', false);
    await assert.rejects(workspace.create(pending, { organization_name: 'no', project_name: 'no' }), /verified_researcher_required/);
    const owner = await user('owner'); const first = await organization(owner);
    const outsider = await user('outsider'); const foreign = await organization(outsider);
    await assert.rejects(workspace.project(outsider, first.organization.id, 'attack'), /workspace_not_found/);
    assert.equal((await pool.query('SELECT role FROM users WHERE id=$1', [owner.id])).rows[0].role, 'researcher');
    const listed = await workspace.list(owner); assert.ok(listed.workspaces.every(w => w.organization_id !== foreign.organization.id));
    await assert.rejects(workspace.changeMember(owner, first.organization.id, owner.id, null), /last_owner_required/);
  });
  it('invitations require exact verified email, explicit one-time accept, no password/global changes or extra projects', async () => {
    const owner = await user('inviter'), invited = await user('invitee'), wrong = await user('wrong');
    const org = await organization(owner), extra = await workspace.project(owner, org.organization.id, 'Other private');
    await workspace.invite(owner, org.organization.id, { email: invited.email, project_id: org.project.id });
    const { token } = await mail(invited.email, true);
    await assert.rejects(workspace.accept(wrong, token), /invalid_or_expired_invitation/);
    assert.equal((await pool.query('SELECT 1 FROM user_projects WHERE user_id=$1', [invited.id])).rowCount, 0);
    const attempts = await Promise.allSettled([workspace.accept(invited, token), workspace.accept(invited, token)]);
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    const member = (await pool.query('SELECT * FROM users WHERE id=$1', [invited.id])).rows[0];
    assert.equal(member.password_hash, invited.password_hash); assert.equal(member.role, 'researcher');
    assert.equal((await pool.query('SELECT 1 FROM user_projects WHERE user_id=$1 AND project_id=$2', [invited.id, extra.id])).rowCount, 0);
    await assert.rejects(workspace.invite(invited, org.organization.id, { email: wrong.email, project_id: org.project.id }), /workspace_not_found/);
    await assert.rejects(workspace.changeMember(owner, org.organization.id, invited.id, 'PI'), /invalid_membership_role/);
  });
  it('invite revoke/expiry and inviter ownership revocation prevent future acceptance', async () => {
    const owner = await user('revoke-owner'), invited = await user('revoked'); const org = await organization(owner);
    await workspace.invite(owner, org.organization.id, { email: invited.email, project_id: org.project.id });
    const revoked = await mail(invited.email, true);
    await workspace.revoke(owner, org.organization.id, revoked.row.invitation_id);
    await assert.rejects(workspace.accept(invited, revoked.token), /invalid_or_expired_invitation/);
    const other = await user('expired-invite');
    await workspace.invite(owner, org.organization.id, { email: other.email, project_id: org.project.id });
    const expired = await mail(other.email, true);
    await pool.query("UPDATE workspace_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expired.row.invitation_id]);
    await assert.rejects(workspace.accept(other, expired.token), /invalid_or_expired_invitation/);
  });
  it('org and project last-owner protection survives concurrent owner demotions', async () => {
    const owner = await user('concurrent-owner'), second = await user('second-owner'); const org = await organization(owner);
    await workspace.invite(owner, org.organization.id, { email: second.email, project_id: org.project.id });
    const invited = await mail(second.email, true); await workspace.accept(second, invited.token);
    await workspace.changeMember(owner, org.organization.id, second.id, 'owner');
    const results = await Promise.allSettled([
      workspace.changeMember(owner, org.organization.id, owner.id, 'member'),
      workspace.changeMember(second, org.organization.id, second.id, 'member'),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await pool.query("SELECT 1 FROM user_organizations WHERE organization_id=$1 AND role='owner'", [org.organization.id])).rowCount, 1);
    const current = (await pool.query("SELECT user_id FROM user_organizations WHERE organization_id=$1 AND role='owner'", [org.organization.id])).rows[0].user_id;
    const activeOwner = current === owner.id ? owner : second;
    const remaining = current === owner.id ? second : owner;
    await workspace.changeMember(activeOwner, org.organization.id, remaining.id, 'owner');
    const privateProject = await workspace.project(activeOwner, org.organization.id, 'Only current owner');
    await assert.rejects(workspace.changeMember(remaining, org.organization.id, activeOwner.id, null), /last_project_owner_required/);
    assert.equal((await pool.query("SELECT 1 FROM user_projects WHERE project_id=$1 AND role='owner'", [privateProject.id])).rowCount, 1);
  });
  it('forced outbox failure rolls back challenge and throttle together', async () => {
    const address = email('rollback');
    const brokenPool = { async connect() {
      const client = await pool.connect();
      return { release: () => client.release(), query(sql, params) {
        if (sql.includes('INSERT INTO identity_mail_outbox')) throw new Error('synthetic outbox failure');
        return client.query(sql, params);
      } };
    } };
    const broken = createIdentityService({ pool: brokenPool, config });
    await assert.rejects(broken.requestChallenge('signup', address), /synthetic outbox failure/);
    assert.equal((await pool.query('SELECT 1 FROM identity_challenges WHERE email=$1', [address])).rowCount, 0);
    await identity.requestChallenge('signup', address);
    assert.equal((await pool.query('SELECT 1 FROM identity_challenges WHERE email=$1', [address])).rowCount, 1);
  });
  it('real cookie auth enforces CSRF and revokes the old session after an email reset', async t => {
    process.env.DATABASE_URL = url;
    const express = require('express'), cookieParser = require('cookie-parser');
    ({ pool: apiPool } = require('../db'));
    const app = express(); app.use(express.json()); app.use(cookieParser());
    app.use('/auth', require('../routes/auth'));
    app.use('/identity', require('../routes/identity').createIdentityRouter({ pool: apiPool, config }));
    app.use('/workspace', require('../routes/workspace').createWorkspaceRouter({ pool: apiPool, config }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`, account = await user('http-cookie');
    const send = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const login = await send('/auth/login', { email: account.email, password }, { 'x-auth-transport': 'cookie' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0], auth = await login.json();
    assert.equal(auth.auth_transport, 'cookie'); assert.equal(Object.hasOwn(auth, 'token'), false);
    assert.equal((await send('/workspace/organizations', { organization_name: 'Denied', project_name: 'Denied' }, { cookie })).status, 403);
    const create = await send('/workspace/organizations', { organization_name: 'Cookie scoped', project_name: 'Cookie project' },
      { cookie, 'x-csrf-token': auth.csrf_token, 'x-staff-user-id': String(account.id) });
    assert.equal(create.status, 201); organizations.push((await create.json()).organization.id);
    const unknown = await send('/identity/recovery', { email: email('unknown-recovery') });
    const known = await send('/identity/recovery', { email: account.email });
    assert.equal(unknown.status, 202); assert.deepEqual(await known.json(), await unknown.json());
    const reset = await mail(account.email);
    assert.equal((await fetch(base + '/identity/confirm?token=' + reset.token)).status, 404);
    assert.equal((await send('/identity/confirm', { token: reset.token, password: password + '-new' })).status, 200);
    assert.equal((await fetch(base + '/auth/me', { headers: { cookie } })).status, 401);
  });
  it('transactional outbox retries are bounded, never retain plaintext, and local capture is private', async () => {
    // Drain other test mails first; local capture never talks to an SMTP server.
    const local = createIdentityOutboxWorker({ pool, config });
    while (await local.runOnce()) {}
    await local.stop();
    const files = await fs.readdir(config.captureDir); assert.ok(files.length);
    assert.equal((await fs.stat(path.join(config.captureDir, files[0]))).mode & 0o777, 0o600);
    const address = email('retry'); await identity.requestChallenge('signup', address);
    const retry = await mail(address);
    let sends = 0;
    const failing = createIdentityOutboxWorker({ pool, config, transport: { async sendMail() { sends++; throw new Error('private SMTP error'); } } });
    for (let i = 0; i < 8; i++) {
      await pool.query('UPDATE identity_mail_outbox SET next_attempt_at=clock_timestamp() WHERE id=$1', [retry.row.id]);
      await failing.runOnce();
    }
    await failing.stop();
    const failed = (await pool.query('SELECT * FROM identity_mail_outbox WHERE id=$1', [retry.row.id])).rows[0];
    assert.equal(sends, 5); assert.equal(failed.status, 'failed'); assert.equal(failed.payload_cipher, null);
  });
});
