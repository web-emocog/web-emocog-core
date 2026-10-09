const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

async function main() {
  if (process.env.NODE_ENV === 'production' || !process.env.LIVE_STIMULUS_FIXTURE) {
    throw new Error('Use the synthetic local live fixture only');
  }
  const fixture = JSON.parse(fs.readFileSync(process.env.LIVE_STIMULUS_FIXTURE, 'utf8'));
  // Authentication must be deliberately supplied, not sent from an arbitrary file.
  const adminEmail = process.env.EMOCOG_ADMIN_EMAIL;
  const adminPassword = process.env.EMOCOG_ADMIN_PASSWORD;
  if (!/^admin-[0-9a-f-]{36}@example\.test$/.test(adminEmail || '')
      || adminPassword !== 'SyntheticBrowserOnly2026!'
      || fixture.users?.admin?.email !== adminEmail) {
    throw new Error('Explicit matching synthetic administrator credentials required');
  }
  const response = await fetch('http://127.0.0.1:3000/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    redirect: 'error',
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  if (!response.ok) throw new Error('Synthetic API login failed');
  const auth = await response.json();
  const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, RUN_API_CONTRACT: '1', RUN_RESEARCHER_CONTRACT: '1',
      API_EXPORT_TOKEN: auth.token, EMOCOG_RESEARCHER_EMAIL: fixture.users.owner.email,
      EMOCOG_RESEARCHER_PASSWORD: fixture.users.owner.password, EMOCOG_RESEARCHER_PROJECT_ID: String(fixture.projectId),
      EMOCOG_ADMIN_EMAIL: adminEmail, EMOCOG_ADMIN_PASSWORD: adminPassword },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

main().catch(() => { process.stderr.write('Local live suite failed\n'); process.exitCode = 1; });
