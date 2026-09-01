#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${BACKUP_INPUT:?BACKUP_INPUT is required}"

if [[ "${ALLOW_DB_RESTORE:-}" != "YES" ]]; then
  echo "Refusing restore. Set ALLOW_DB_RESTORE=YES after verifying the target is disposable." >&2
  exit 2
fi

if [[ "${DATABASE_URL:-}" == "$RESTORE_DATABASE_URL" ]]; then
  echo "Source and restore database URLs must be different." >&2
  exit 2
fi

test -s "$BACKUP_INPUT"
if [[ -f "${BACKUP_INPUT}.sha256" ]]; then
  expected="$(cut -d ' ' -f 1 "${BACKUP_INPUT}.sha256")"
  actual="$(shasum -a 256 "$BACKUP_INPUT" | cut -d ' ' -f 1)"
  [[ "$expected" == "$actual" ]] || { echo "Backup checksum mismatch." >&2; exit 1; }
fi

PGDATABASE="$RESTORE_DATABASE_URL" pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$BACKUP_INPUT"

PGDATABASE="$RESTORE_DATABASE_URL" psql -v ON_ERROR_STOP=1 -Atc 'SELECT COUNT(*) FROM pgmigrations' >/dev/null
echo "Restore completed and pgmigrations is readable."
