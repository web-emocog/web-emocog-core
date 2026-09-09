#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script through sudo." >&2
  exit 77
fi

readonly SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly REPOSITORY_ROOT=$(cd -- "${SCRIPT_DIR}/../.." && pwd)

for command in curl docker find flock nginx python3 sha256sum systemctl visudo; do
  command -v "${command}" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 69
  }
done
docker compose version >/dev/null

install -d -o root -g root -m 0755 \
  /opt/wecog \
  /etc/wecog \
  /etc/wecog/monitoring \
  /etc/nginx/snippets
install -d -o root -g root -m 0755 /var/lib/wecog/metrics
install -d -o root -g root -m 0700 /var/lib/wecog/state
install -d -o 10001 -g 10001 -m 0750 /var/lib/wecog/uploads /var/lib/wecog/backups

install -o root -g root -m 0644 \
  "${REPOSITORY_ROOT}/compose.production.yaml" \
  /opt/wecog/compose.yaml
install -o root -g root -m 0644 \
  "${REPOSITORY_ROOT}/compose.monitoring.yaml" \
  /opt/wecog/compose.monitoring.yaml
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/backup-support.py" /opt/wecog/backup-support.py
# Serialize with the backup/deploy controller; init preserves previous successes.
flock --exclusive /var/lib/wecog/state/release.lock \
  python3 /opt/wecog/backup-support.py metrics /var/lib/wecog/metrics daily init
flock --exclusive /var/lib/wecog/state/release.lock \
  python3 /opt/wecog/backup-support.py metrics /var/lib/wecog/metrics pre-deploy init
install -o root -g root -m 0755 \
  "${SCRIPT_DIR}/wecog-release" \
  /usr/local/sbin/wecog-release
install -o root -g root -m 0755 \
  "${SCRIPT_DIR}/wecog-monitoring" \
  /usr/local/sbin/wecog-monitoring
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/wecog-backup.service" \
  "${SCRIPT_DIR}/wecog-backup.timer" \
  "${SCRIPT_DIR}/wecog-monitoring.service" \
  /etc/systemd/system/
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/monitoring/blackbox.yml" \
  "${SCRIPT_DIR}/monitoring/otelcol.yaml" \
  /etc/wecog/monitoring/

if [[ ! -e /etc/wecog/release.conf ]]; then
  install -o root -g root -m 0600 \
    "${SCRIPT_DIR}/release.conf.example" \
    /etc/wecog/release.conf
fi

if [[ ! -e /etc/wecog/monitoring.conf ]]; then
  install -o root -g root -m 0600 \
    "${SCRIPT_DIR}/monitoring.conf.example" \
    /etc/wecog/monitoring.conf
fi

install -o root -g root -m 0440 \
  "${SCRIPT_DIR}/wecog-deploy.sudoers" \
  /etc/sudoers.d/wecog-deploy
visudo -cf /etc/sudoers.d/wecog-deploy >/dev/null

install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/nginx-private-paths.conf" \
  /etc/nginx/snippets/wecog-private-paths.conf
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/nginx-wecog-container.conf" \
  /etc/nginx/sites-available/wecog.ru.container

systemctl daemon-reload
systemctl enable --now wecog-backup.timer

echo "Bootstrap files installed and the daily backup timer was enabled."
echo "Monitoring files were staged but the monitoring service was not enabled or started."
echo "Active Nginx configuration, application containers, and PostgreSQL were not changed."
