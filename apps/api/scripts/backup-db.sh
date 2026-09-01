#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_OUTPUT:?BACKUP_OUTPUT must point outside the repository or to an ignored backups directory}"

umask 077
output="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$BACKUP_OUTPUT")"
mkdir -p "$(dirname "$output")"
temporary="${output}.partial"
trap 'rm -f "$temporary"' EXIT

PGDATABASE="$DATABASE_URL" pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file="$temporary"

test -s "$temporary"
mv "$temporary" "$output"
chmod 600 "$output"
shasum -a 256 "$output" > "${output}.sha256"
chmod 600 "${output}.sha256"
echo "$output"
