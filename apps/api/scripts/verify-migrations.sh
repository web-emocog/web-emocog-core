#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

if [[ "${MIGRATION_VERIFY_ALLOW_DOWN:-}" != "YES" ]]; then
  echo "Refusing destructive migration verification. Set MIGRATION_VERIFY_ALLOW_DOWN=YES for an isolated database." >&2
  exit 2
fi

if [[ "${NODE_ENV:-development}" == "production" ]]; then
  echo "Migration down verification must never run against production." >&2
  exit 2
fi

migration_count="$(find migrations -maxdepth 1 -type f -name '*.js' | wc -l | tr -d ' ')"
if [[ "$migration_count" -lt 1 ]]; then
  echo "No migrations found." >&2
  exit 2
fi

echo "Applying ${migration_count} migrations..."
npm run migrate:up
echo "Reverting ${migration_count} migrations..."
npm run migrate:down -- "$migration_count"
echo "Applying migrations again..."
npm run migrate:up

applied="$(node -e '
  const { Client } = require("pg");
  (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      const { rows } = await client.query("SELECT COUNT(*) AS count FROM pgmigrations");
      console.log(rows[0].count);
    } finally {
      await client.end();
    }
  })().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
')"
if [[ "$applied" -ne "$migration_count" ]]; then
  echo "Expected ${migration_count} applied migrations, found ${applied}." >&2
  exit 1
fi

echo "Migration verification passed: up/down/up, ${applied} migrations applied."
