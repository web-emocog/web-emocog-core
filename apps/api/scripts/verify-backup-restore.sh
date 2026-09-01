#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

if [[ "$DATABASE_URL" == "$RESTORE_DATABASE_URL" ]]; then
  echo "Restore drill requires a separate target database." >&2
  exit 2
fi

backup_dir="${BACKUP_DRILL_DIR:-$(mktemp -d)}"
created_temp_dir=0
if [[ -z "${BACKUP_DRILL_DIR:-}" ]]; then created_temp_dir=1; fi
trap 'if [[ "$created_temp_dir" -eq 1 ]]; then rm -rf "$backup_dir"; fi' EXIT

export BACKUP_OUTPUT="${backup_dir}/wecog-drill.dump"
bash scripts/backup-db.sh >/dev/null
export BACKUP_INPUT="$BACKUP_OUTPUT"
export ALLOW_DB_RESTORE=YES
bash scripts/restore-db.sh >/dev/null

signature_sql="SELECT json_build_object(
  'migrations', (SELECT COUNT(*) FROM pgmigrations),
  'tables', (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
  'sessions', (SELECT COUNT(*) FROM sessions),
  'features', (SELECT COUNT(*) FROM session_features),
  'users', (SELECT COUNT(*) FROM users)
)::text"
source_signature="$(psql --dbname="$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$signature_sql")"
restore_signature="$(psql --dbname="$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$signature_sql")"

if [[ "$source_signature" != "$restore_signature" ]]; then
  echo "Backup/restore signature mismatch." >&2
  echo "source=${source_signature}" >&2
  echo "restore=${restore_signature}" >&2
  exit 1
fi

echo "Backup/restore drill passed: ${source_signature}"
