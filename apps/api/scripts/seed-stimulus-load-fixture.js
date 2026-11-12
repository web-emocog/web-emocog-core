const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

async function seedStimulusLoadFixture(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const suffix = randomUUID();
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
    return { projectId: project.id, otherProjectId: otherProject.id, users };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
}

module.exports = { seedStimulusLoadFixture };
