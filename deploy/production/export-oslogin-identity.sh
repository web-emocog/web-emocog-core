#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <directory> <login> <organization-id>" >&2
  exit 64
fi

readonly SSH_DIRECTORY=$1
readonly OSLOGIN_LOGIN=$2
readonly ORGANIZATION_ID=$3

for command in chmod find install yc; do
  command -v "${command}" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 69
  }
done

install --directory --mode 0700 "${SSH_DIRECTORY}"

mapfile -d '' -t existing_entries < <(
  find "${SSH_DIRECTORY}" -mindepth 1 -maxdepth 1 -print0
)
if (( ${#existing_entries[@]} != 0 )); then
  echo "OS Login export directory must be empty: ${SSH_DIRECTORY}" >&2
  exit 73
fi

# The CLI's human-readable output is not a stable machine interface. Discover
# the generated credential pair from the dedicated empty directory instead.
yc compute ssh certificate export \
  --login "${OSLOGIN_LOGIN}" \
  --organization-id "${ORGANIZATION_ID}" \
  --directory "${SSH_DIRECTORY}" \
  >/dev/null

mapfile -d '' -t certificates < <(
  find "${SSH_DIRECTORY}" \
    -mindepth 1 \
    -maxdepth 1 \
    -type f \
    -name '*-cert.pub' \
    -print0
)
if (( ${#certificates[@]} != 1 )); then
  echo "Expected exactly one exported OS Login certificate, found ${#certificates[@]}." >&2
  exit 70
fi

readonly SSH_CERTIFICATE=${certificates[0]}
readonly SSH_IDENTITY=${SSH_CERTIFICATE%-cert.pub}
if [[ ! -f ${SSH_IDENTITY} ]]; then
  echo "The private key matching ${SSH_CERTIFICATE} was not exported." >&2
  exit 70
fi

chmod 0600 "${SSH_IDENTITY}" "${SSH_CERTIFICATE}"
printf '%s\n' "${SSH_IDENTITY}"
