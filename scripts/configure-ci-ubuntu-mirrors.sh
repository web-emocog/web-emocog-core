#!/usr/bin/env bash
set -euo pipefail

# Ubuntu 24.04 GitHub-hosted runners use mirror+file:/etc/apt/apt-mirrors.txt.
# Keep the runner's suites, components and Ubuntu signing keys intact.
mirrors=()
for mirror in https://archive.ubuntu.com/ubuntu https://mirrors.edge.kernel.org/ubuntu; do
  if curl --fail --silent --show-error --location --connect-timeout 5 --max-time 15 \
      --output /dev/null "$mirror/dists/noble/InRelease"; then
    mirrors+=("$mirror")
  fi
done

if (( ${#mirrors[@]} == 0 )); then
  echo "::error::No Ubuntu Noble package mirror was reachable from this runner." >&2
  exit 1
fi
printf '%s\n' "${mirrors[@]}" | sudo tee /etc/apt/apt-mirrors.txt
printf '%s\n' 'APT::Update::Error-Mode "any";' | sudo tee /etc/apt/apt.conf.d/99-wecog-ci
