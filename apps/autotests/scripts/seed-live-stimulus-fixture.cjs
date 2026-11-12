const fs = require('node:fs/promises');
const { seedStimulusLoadFixture } = require('../../api/scripts/seed-stimulus-load-fixture');

async function main() {
  const databaseUrl = process.env.S2_TEST_DATABASE_URL;
  const output = process.env.LIVE_STIMULUS_FIXTURE;
  if (process.env.NODE_ENV === 'production' || !databaseUrl
      || process.env.DATABASE_URL !== databaseUrl || !output) {
    throw new Error('Use an isolated S2 test database and an explicit fixture output path');
  }

  const fixture = await seedStimulusLoadFixture(databaseUrl);
  await fs.writeFile(output, JSON.stringify(fixture), { mode: 0o600 });
  process.stdout.write('Synthetic live browser fixture created\n');
}

main().catch(() => { process.stderr.write('Live test fixture creation failed\n'); process.exitCode = 1; });
