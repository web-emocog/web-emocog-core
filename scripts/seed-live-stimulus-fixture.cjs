// Only for disposable browser-test databases. Pipe stdout to a private fixture file.
const { randomBytes, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');

async function main() {
  const database = new URL(process.env.DATABASE_URL);
  const api = new URL(process.env.LIVE_STIMULUS_API_BASE || 'http://127.0.0.1:3000');
  const loopback = url => ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (process.env.NODE_ENV !== 'test' || process.env.WECOG_LIVE_FIXTURE_ISOLATED !== '1'
    || !['postgres:', 'postgresql:'].includes(database.protocol) || !loopback(database)
    || !/^\/emocog_[a-z0-9_]+_test$/.test(database.pathname) || database.search || database.hash
    || api.protocol !== 'http:' || !loopback(api) || api.username || api.password || api.search || api.hash
    || api.pathname !== '/') throw new Error('Use an explicitly isolated loopback test API and database');

  const requireApi = createRequire(require.resolve('../apps/api/package.json'));
  const { Client } = requireApi('pg');
  const bcrypt = requireApi('bcryptjs');
  const client = new Client({ connectionString: database.href, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    const stamp = randomUUID();
    const workspaces = {};
    for (const kind of ['shared', 'foreign']) {
      const slug = `fixture-${kind}-${stamp}`;
      const org = (await client.query('INSERT INTO organizations(name, slug) VALUES ($1,$1) RETURNING id', [slug])).rows[0].id;
      const project = (await client.query('INSERT INTO projects(organization_id,name,slug) VALUES ($1,$2,$2) RETURNING id', [org, slug])).rows[0].id;
      workspaces[kind] = { org, project };
    }
    const users = {};
    const kinds = ['owner', 'peer', 'outsider'];
    if (process.env.WECOG_LIVE_FIXTURE_ADMIN === '1') kinds.push('admin');
    for (const kind of kinds) {
      const { org, project } = workspaces[kind === 'outsider' ? 'foreign' : 'shared'];
      const email = `${kind}-${stamp}@example.test`;
      const password = randomBytes(24).toString('base64url');
      const hash = await bcrypt.hash(password, 10);
      const role = kind === 'admin' ? 'admin' : 'researcher';
      const id = (await client.query('INSERT INTO users(email,password_hash,role) VALUES ($1,$2,$3) RETURNING id', [email, hash, role])).rows[0].id;
      await client.query('INSERT INTO user_organizations(user_id,organization_id) VALUES ($1,$2)', [id, org]);
      await client.query('INSERT INTO user_projects(user_id,project_id) VALUES ($1,$2)', [id, project]);
      users[kind] = { id, email, password };
    }
    await client.query('COMMIT');
    process.stdout.write(JSON.stringify({ apiBase: api.origin, projectId: workspaces.shared.project, users }) + '\n');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await client.end(); }
}

main().catch(() => {
  process.stderr.write('Could not seed isolated live stimulus fixture. Check flags and test migrations.\n');
  process.exitCode = 1;
});
