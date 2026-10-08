const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireApi = createRequire(path.resolve(__dirname, '../../api/package.json'));

async function main() {
  const databaseUrl = process.env.S2_TEST_DATABASE_URL;
  const output = process.env.LIVE_STIMULUS_FIXTURE;
  if (process.env.NODE_ENV === 'production' || !databaseUrl
      || process.env.DATABASE_URL !== databaseUrl || !output) {
    throw new Error('Use an isolated S2 test database and an explicit fixture output path');
  }
  const { Client } = requireApi('pg');
  const bcrypt = requireApi('bcryptjs');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const suffix = require('node:crypto').randomUUID();
    const organization = (await client.query('INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id',
      ['Live browser fixture', `browser-${suffix}`])).rows[0];
    const project = (await client.query('INSERT INTO projects(organization_id,name,slug) VALUES($1,$2,$3) RETURNING id',
      [organization.id, 'Live stimulus fixture', `browser-${suffix}`])).rows[0];
    const otherProject = (await client.query('INSERT INTO projects(organization_id,name,slug) VALUES($1,$2,$3) RETURNING id',
      [organization.id, 'Unrelated browser project', `other-${suffix}`])).rows[0];
    const password = 'SyntheticBrowserOnly2026!';
    const hash = await bcrypt.hash(password, 4);
    const users = {};
    for (const [name, role] of [['owner', 'researcher'], ['peer', 'researcher'], ['outsider', 'researcher'], ['admin', 'admin']]) {
      const user = (await client.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) RETURNING id,email,role,token_version',
        [`${name}-${suffix}@example.test`, hash, role])).rows[0];
      if (role !== 'admin') {
        await client.query("INSERT INTO user_organizations(user_id,organization_id,role) VALUES($1,$2,'member')", [user.id, organization.id]);
        await client.query("INSERT INTO user_projects(user_id,project_id,role) VALUES($1,$2,'researcher')",
          [user.id, name === 'outsider' ? otherProject.id : project.id]);
      }
      users[name] = { ...user, password };
    }
    await client.query('COMMIT');
    fs.writeFileSync(output, JSON.stringify({ projectId: project.id, otherProjectId: otherProject.id, users }), { mode: 0o600 });
    process.stdout.write('Synthetic live browser fixture created\n');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
}

main().catch(() => { process.stderr.write('Live test fixture creation failed\n'); process.exitCode = 1; });
