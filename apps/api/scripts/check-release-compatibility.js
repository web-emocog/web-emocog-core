const fs = require('node:fs');
const path = require('node:path');

function assertCompatibleMigrations(applied, supported) {
  if (applied.some(name => !supported.includes(name))) {
    throw new Error('Database requires a newer API; restore a coordinated backup for downgrade');
  }
}

async function checkReleaseCompatibility(queryable) {
  const table = await queryable.query("SELECT to_regclass('public.pgmigrations') AS table_name");
  if (!table.rows[0]?.table_name) throw new Error('Migration history is unavailable; compatibility is unknown');
  const applied = await queryable.query('SELECT name FROM public.pgmigrations ORDER BY id');
  const supported = fs.readdirSync(path.join(__dirname, '../migrations'))
    .filter(name => name.endsWith('.js')).map(name => name.slice(0, -3));
  assertCompatibleMigrations(applied.rows.map(row => row.name), supported);
  // This checker is shipped only with the API enforcing the private/versioned contract.
  return true;
}

if (require.main === module) {
  const { pool } = require('../db');
  checkReleaseCompatibility(pool).then(() => {
    process.stdout.write('Release/database compatibility verified\n');
  }).catch(() => {
    process.stderr.write('Unsafe or unknown release/database compatibility. Keep maintenance mode; restore the coordinated backup to downgrade.\n');
    process.exitCode = 1;
  }).finally(() => pool.end());
}

module.exports = { assertCompatibleMigrations, checkReleaseCompatibility };
