# Wecog production CI/CD in Yandex Cloud

This document describes the production path for `web-emocog/web-emocog-core`.
The normal release trigger is a merged pull request that updates `main`.

## Release flow

1. GitHub Actions checks out the exact merge commit and runs Node and Python tests.
2. It builds separate immutable `wecog-api` and `wecog-web` images.
3. It authenticates to Yandex Cloud through GitHub OIDC; no long-lived cloud key is stored in GitHub.
4. It pushes both images to Yandex Container Registry under the full commit SHA.
5. Through a short-lived OS Login certificate it asks the VM's root-owned release controller to prepare the release.
6. The VM reads production values from Lockbox using its attached runtime service account, pulls the images, creates a PostgreSQL custom-format dump, validates it, and uploads the dump plus checksum to Object Storage.
7. GitHub creates a boot-disk snapshot only after the logical database backup has completed.
8. The VM applies forward migrations, starts the images, and checks database readiness and web health.
9. If health checks fail, the controller starts the previously recorded application images again. It does not automatically reverse database migrations.
10. GitHub verifies `/` and `/api/ready` through public HTTPS.
11. Only after the public checks pass, GitHub removes old snapshots carrying both `app=wecog` and `reason=predeploy`, retaining the newest five.

A separate systemd timer creates a validated PostgreSQL dump every day at 00:30 UTC, with a random delay of up to 15 minutes. This protects the database even during periods without deployments.

## Architecture and boundaries

- Host Nginx remains the stable TLS edge.
- `wecog-web` serves only explicitly copied public files on `127.0.0.1:8080`.
- `wecog-api` runs as UID `10001` on `127.0.0.1:3000`.
- PostgreSQL remains a host service on `127.0.0.1:5432` during this migration.
- Uploads live outside the image at `/var/lib/wecog/uploads`.
- Lockbox values are rendered to `/etc/wecog/api.env`, owned by root with mode `0600`.
- The OS Login account is not in the `docker` group and cannot edit production files. It can invoke only `/usr/local/sbin/wecog-release` through passwordless sudo; that root-owned script validates every action and image tag.
- Images use a full 40-character Git commit SHA. Mutable `latest` and `main` tags are not used for deployment.

Keeping web and API images independent means a future move to Managed PostgreSQL, Object Storage uploads, multiple VMs, or Kubernetes does not require rebuilding the frontend deployment model.

## Cloud identities and minimum access

Deploy service account `wecog-github-deploy` (`ajeuqpta4a5pecli5pl4`):

- `container-registry.images.pusher` on registry `crphf3uq1mmhoqcsh60e`.
- `compute.snapshotSchedules.editor` on folder `b1gakvq29fuiic89917k`.
- `compute.osLogin` and `compute.operator` on VM `fv45olob093b3smqvpsa`.
- `resource-manager.auditor` on folder `b1gakvq29fuiic89917k`.
- OS Login profile `wecog-deploy`, UID `20050`.

Runtime service account attached to the VM:

- `container-registry.images.puller` on registry `crphf3uq1mmhoqcsh60e`.
- `lockbox.payloadViewer` on secret `e6qgmqh8i1odhlg6hv9i`.
- `storage.uploader` on bucket `wecog-prod-backups-b1gakvq29fuiic89917k`.
- `kms.keys.encrypter` on KMS key `abjhgm57i6tarpd927ug`; Object Storage needs it to encrypt newly uploaded backup objects.

The workload identity federated credential must bind the deploy service account to this exact GitHub subject:

```text
repo:web-emocog/web-emocog-core:ref:refs/heads/main
```

The production workflows intentionally do not declare a GitHub Environment. Declaring one changes the OIDC `sub` claim to `repo:web-emocog/web-emocog-core:environment:production` and would no longer match the existing credential.

## One-time VM bootstrap

Run these steps before merging the CI/CD branch into `main`.

### 1. Copy the bootstrap bundle from the Mac

From the repository root on the Mac:

```bash
ssh \
  -i /Users/egorbulanov/cloud_emocog_ssh \
  eabulanov@158.160.179.184 \
  'mkdir -p /home/eabulanov/wecog-cicd-bootstrap/deploy'
```

This connects with the existing administrator key and creates a staging directory. It does not change the running application.

```bash
scp \
  -i /Users/egorbulanov/cloud_emocog_ssh \
  compose.production.yaml \
  eabulanov@158.160.179.184:/home/eabulanov/wecog-cicd-bootstrap/
```

This copies the production Compose definition to the staging directory.

```bash
scp \
  -i /Users/egorbulanov/cloud_emocog_ssh \
  -r deploy/production \
  eabulanov@158.160.179.184:/home/eabulanov/wecog-cicd-bootstrap/deploy/
```

This copies the root-owned release controller, Nginx templates, and sudo policy. It does not activate any of them yet.

### 2. Verify required VM commands

Connect to the VM:

```bash
ssh -i /Users/egorbulanov/cloud_emocog_ssh eabulanov@158.160.179.184
```

Check dependencies:

```bash
for command in curl docker find flock nginx python3 sha256sum systemctl visudo; do
  command -v "$command" || echo "MISSING: $command"
done
docker compose version
```

The loop prints the executable path for each required command and clearly identifies missing packages. The second command verifies the Compose plugin, not the obsolete standalone `docker-compose` program.

If a required Ubuntu package is missing, install only the missing packages before continuing.

### 3. Install protected deployment files

```bash
sudo /home/eabulanov/wecog-cicd-bootstrap/deploy/production/bootstrap.sh
```

The script creates `/opt/wecog`, `/etc/wecog`, and `/var/lib/wecog`; installs the Compose file and release controller as root; creates the restricted sudo rule; stages the new Nginx configuration without enabling it; and enables the daily backup timer. It does not stop PM2, start containers, modify PostgreSQL, or reload Nginx. Before the first release is recorded, the timer exits successfully without creating a backup.

Validate the installed policy and configuration:

```bash
sudo visudo -cf /etc/sudoers.d/wecog-deploy
sudo stat -c '%U:%G %a %n' \
  /usr/local/sbin/wecog-release \
  /etc/wecog/release.conf \
  /etc/sudoers.d/wecog-deploy \
  /opt/wecog/compose.yaml
systemctl list-timers wecog-backup.timer --no-pager
```

The first command parses only the new sudo policy. The second confirms root ownership and restrictive modes. `release.conf` contains resource IDs, not Lockbox payload values. The last command shows the next scheduled database backup without starting one immediately.

### 4. Prevent the legacy process manager from racing for port 3000

The old `pm2-uskovayuli.service` is already failed, but it is still a possible source of a port conflict after reboot. Immediately before the first GitHub deployment:

```bash
sudo systemctl disable --now pm2-uskovayuli.service
sudo systemctl is-enabled pm2-uskovayuli.service || true
sudo ss -lntp | grep ':3000' || echo 'port 3000 is free'
```

The first command stops and disables only the legacy API process manager. Static production pages remain served by host Nginx. The last command confirms that the Docker API can bind the loopback port.

### 5. Test the restricted OS Login path

From the Mac, connect while impersonating the deploy service account:

```bash
yc compute ssh \
  --id fv45olob093b3smqvpsa \
  --login wecog-deploy \
  --public-address \
  --impersonate-service-account-id ajeuqpta4a5pecli5pl4
```

Inside that session:

```bash
sudo -n /usr/local/sbin/wecog-release status
sudo -n true || true
```

The release status command must work without a password. Generic sudo must still fail; this proves the account received only the one intended privileged entry point.

## First automated release

After bootstrap, commit and push the CI/CD files to the release branch, merge
them into `develop`, and wait for every required check on the `develop` to
`main` pull request. Merging that pull request triggers `Deploy production`
automatically.

The staged VM configuration must come from the same revision as the release.
If `compose.production.yaml` or `deploy/production/` changed after the initial
bootstrap, copy the updated files to the VM and run `bootstrap.sh` again before
merging. Re-running bootstrap updates only the staged configuration and keeps
the active Nginx configuration and application traffic unchanged.

The workflow must complete these visible stages in order:

1. tests;
2. image build and push;
3. startup smoke test of the exact production API image without production
   secrets or database access, followed by the exact web-image smoke test for
   participant media modules, MIME types, security headers, and private-path
   denials;
4. Lockbox read and PostgreSQL backup upload;
5. disk snapshot creation;
6. migrations and container deployment;
7. public HTTPS checks.

The OS Login export step locates the generated private key and certificate in
a newly created protected directory. It does not parse the CLI's
human-readable output, which may be written to a different stream or change
between CLI versions.

If container startup or its health check fails, the release controller writes
container status and the last 200 log lines to the GitHub job before cleanup or
application rollback. It does not print the runtime environment file.

Do not switch host Nginx to the web container before that first workflow is green.

## Retention and cost controls

The retention policy is intentionally bounded:

- automatic pre-deploy disk snapshots: keep the latest 5;
- automatic PostgreSQL dumps: keep for 35 days;
- failed local dump artifacts on the VM: keep for at most 2 days;
- immutable Container Registry images: retain at least the latest 10 and allow deletion after 30 days;
- untagged Container Registry image versions: allow deletion after 2 days.

The VM also retains only the current and previous local `wecog-api` and `wecog-web` image tags after a healthy deployment or rollback. This cleanup matches those two exact registry repository names and does not prune unrelated Docker images or containers.

The manually created baseline snapshot and the manually uploaded baseline archives are protected because automated cleanup selects only labelled snapshots and objects under the `postgresql/` prefix. Successful dump files are deleted from the VM immediately after both the dump and its checksum reach Object Storage.

### Configure Object Storage lifecycle once

Run this from the repository root on the Mac only after reviewing `deploy/production/object-storage-lifecycle.json`:

```bash
yc storage bucket update \
  --name wecog-prod-backups-b1gakvq29fuiic89917k \
  --lifecycle-rules-from-file deploy/production/object-storage-lifecycle.json
```

This replaces the bucket's current lifecycle configuration with one rule applying only to the `postgresql/` prefix. Current automated backup objects expire after 35 days, non-current versions after 2 days, and incomplete multipart uploads after 1 day. It does not match manually stored baseline files outside that prefix. Object Storage evaluates lifecycle rules daily, so expiration is not immediate.

Verify the saved configuration:

```bash
yc storage bucket get \
  wecog-prod-backups-b1gakvq29fuiic89917k \
  --full
```

This is a read-only check. In its lifecycle section, confirm the exact `postgresql/` prefix and the 35-day expiration before continuing.

### Configure Container Registry lifecycle after the first image push

Container Registry repositories are created by the first successful image push. After that push, create a disabled policy for each repository:

```bash
yc container repository lifecycle-policy create \
  --repository-name crphf3uq1mmhoqcsh60e/wecog-api \
  --name wecog-api-retention \
  --description 'Wecog API image retention' \
  --rules deploy/production/container-registry-lifecycle-rules.json
```

```bash
yc container repository lifecycle-policy create \
  --repository-name crphf3uq1mmhoqcsh60e/wecog-web \
  --name wecog-web-retention \
  --description 'Wecog web image retention' \
  --rules deploy/production/container-registry-lifecycle-rules.json
```

Each command creates a policy in `DISABLED` state for one repository; it does not delete images. Keeping ten releases gives the application rollback workflow enough immutable image history while the 30-day boundary prevents unbounded storage growth.

For each returned policy ID, run a dry run and inspect its result:

```bash
yc container repository lifecycle-policy dry-run POLICY_ID
yc container repository lifecycle-policy list-dry-run-results POLICY_ID
```

The first command calculates what the policy would delete without deleting anything. The second shows the result ID and number of affected images. If the result is correct, activate that policy:

```bash
yc container repository lifecycle-policy update POLICY_ID --activate
```

This final command enables automatic cleanup for that one repository. Repeat dry run and activation independently for API and web policies; never paste a policy ID without checking which repository it belongs to.

## One-time Nginx cutover after the first green deployment

On the VM, first verify both local services:

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS -H 'X-Forwarded-Proto: https' http://127.0.0.1:3000/ready
sudo /usr/local/sbin/wecog-release status
```

These commands verify the static container, API plus database readiness, and recorded release state without changing traffic.

Back up and activate the prepared Nginx configuration:

```bash
sudo cp \
  /etc/nginx/sites-available/wecog.ru \
  /etc/nginx/sites-available/wecog.ru.before-containers
sudo install -o root -g root -m 0644 \
  /etc/nginx/sites-available/wecog.ru.container \
  /etc/nginx/sites-available/wecog.ru
sudo nginx -t
sudo systemctl reload nginx
```

The first command preserves the current working configuration. `install` makes the staged proxy configuration active. `nginx -t` blocks the reload if syntax or certificate paths are invalid. The final command performs a graceful reload without stopping existing connections.

Verify the public boundary:

```bash
curl -fsS https://wecog.ru/ >/dev/null && echo 'WEB OK'
curl -fsS https://wecog.ru/api/ready && echo
for path in \
  /Audio_detection/browser/open-vocal-biomarkers.mjs \
  /packages/shared/multimodal/index.mjs; do
  curl -fsSI "https://wecog.ru$path" \
    | tr -d '\r' \
    | grep -Eqi '^Content-Type: (application|text)/javascript(;|$)' \
    && echo "$path -> JavaScript MIME OK"
done
curl -fsSI https://wecog.ru/apps/participant-web/run_new.html \
  | tr -d '\r' \
  | grep -Fi 'Permissions-Policy: camera=(self), microphone=(self), geolocation=()'
for path in \
  /.git/config \
  /apps/api/.env \
  /apps/api/package.json \
  /Audio_detection/README.md \
  /packages/shared/multimodal/README.md \
  /packages/shared/contracts/session-feature.v1.schema.json \
  /DEPLOY_VERSION.txt; do
  curl -sS -o /dev/null -w "$path -> HTTP %{http_code}\n" "https://wecog.ru$path"
done
```

The web, API, participant media module, MIME, and permission-policy checks must
succeed. Every private path must return `404`.

## Normal operation

After the one-time cutover, developers only create pull requests. A merge into `main` runs the full deployment. Parallel production deployments are serialized by the `wecog-production` concurrency group.

Inspect the daily backup timer and its most recent log on the VM with:

```bash
systemctl list-timers wecog-backup.timer --no-pager
sudo journalctl -u wecog-backup.service -n 100 --no-pager
```

The first command is read-only and shows the next run. The second shows the last 100 backup-service log lines; it may include object keys but never Lockbox secret values.

Application rollback is available under GitHub Actions as `Roll back production application`. Leaving `image_tag` empty selects the recorded previous release. Supplying a value requires the full 40-character commit SHA.

An application rollback changes container images only. It deliberately does not run `node-pg-migrate down`. All production migrations must follow the expand/contract rule:

1. add new nullable columns/tables/indexes without breaking the old application;
2. deploy code that can use both old and new shapes;
3. backfill asynchronously if needed;
4. remove obsolete schema only in a later, separately reviewed release.

If data itself must be restored, stop and perform a manual recovery from the validated Object Storage dump. Restoring a database is destructive and must never be an automatic reaction to an HTTP health failure.

## Production observability

The low-cost baseline runs three resource-limited containers on the production
VM under the separate `wecog-monitoring` Compose project:

- `blackbox-exporter` checks `https://wecog.ru/` and
  `https://wecog.ru/api/ready` through public HTTPS, including DNS, TLS, Nginx,
  the application containers, and PostgreSQL readiness;
- `node-exporter` reads host memory and root-filesystem capacity;
- `otel-collector` sends the selected metrics to Monium.

The exporters listen only on VM loopback ports `9100` and `9115`. The Collector
configuration keeps only availability, latency, HTTP status, earliest TLS
certificate expiry, memory, and root-filesystem metrics. A 60-second scrape
interval and metric filtering prevent unbounded metric cardinality and cost.
Container logs use rotation and the three monitoring containers together are
limited to one CPU and 512 MiB of memory.

The Monium API key belongs to the dedicated `wecog-monitoring-writer` service
account and is stored in the separate Lockbox secret
`e6qv3j5psv0u96jruihr`. It must never be stored in Git, GitHub Actions, the API
Lockbox secret, or the application container environment. The production VM's
runtime service account receives `lockbox.payloadViewer` on this monitoring
secret only so that the root-owned controller can render
`/etc/wecog/monitoring.env` with mode `0600`.

The first rollout is deliberately staged. Running the main bootstrap installs
the monitoring files and systemd unit but does not enable or start monitoring.
Before starting it, confirm that its loopback ports are free:

```bash
sudo ss -lntp | grep -E ':(9100|9115)\b' \
  || echo 'MONITORING PORTS ARE FREE'
```

This is a read-only socket check. Any existing listener must be identified
before continuing; do not terminate an unknown process merely to free a port.

After copying the reviewed repository bundle to the VM, install its protected
files:

```bash
sudo /home/eabulanov/REVIEWED_BUNDLE/deploy/production/bootstrap.sh
```

Replace `REVIEWED_BUNDLE` with the directory containing the exact reviewed
commit. The command updates root-owned templates, keeps the existing
`/etc/wecog/monitoring.conf` if it already exists, and does not start the
monitoring containers or change application traffic.

Verify installed identifiers and file permissions without printing the API
key:

```bash
sudo grep -E \
  '^(WECOG_MONITORING_LOCKBOX_SECRET_ID|WECOG_MONIUM_PROJECT|WECOG_MONIUM_CLUSTER|WECOG_MONIUM_SERVICE)=' \
  /etc/wecog/monitoring.conf
sudo stat -c '%U:%G %a %n' \
  /etc/wecog/monitoring.conf \
  /usr/local/sbin/wecog-monitoring \
  /opt/wecog/compose.monitoring.yaml \
  /etc/systemd/system/wecog-monitoring.service
```

The first command prints only non-secret identifiers. The second must show
`root:root`, mode `600` for `monitoring.conf`, mode `755` for the controller,
and mode `644` for Compose and systemd files.

Enable and start the monitoring stack:

```bash
sudo systemctl enable --now wecog-monitoring.service
```

This fetches the API key from Lockbox into a root-only environment file, pulls
the pinned monitoring images, starts the isolated Compose project, and fails if
either local HTTPS probe or the host metrics endpoint is unhealthy. It does not
restart Nginx, PostgreSQL, or the application containers.

Inspect the result without exposing credentials:

```bash
sudo systemctl status wecog-monitoring.service --no-pager -l
sudo /usr/local/sbin/wecog-monitoring status
sudo docker logs --tail 100 wecog-monitoring-otel-collector-1 2>&1 \
  | grep -Ei 'error|failed|unauthenticated|permission' \
  || echo 'NO COLLECTOR ERRORS FOUND'
```

The first command checks systemd state. The second requires all three
containers to be running and both public HTTPS targets to return a successful
probe. The final command looks only for recent Collector errors and does not
print its environment.

Monium may need more than 60 seconds to display the first data. In
`Overview -> Metrics`, filter by `service = "wecog"`; expected metric names
include `probe_success`, `probe_duration_seconds`,
`probe_ssl_earliest_cert_expiry`, `node_memory_MemAvailable_bytes`, and
`node_filesystem_avail_bytes`.

This baseline is not an independent external observer because it runs on the
production VM. A total VM or network failure is detected by the existing native
Compute Cloud alert through its strict `No data` policy. When contractual SLOs
or multiple application instances are introduced, move `blackbox-exporter` and
`otel-collector` to a separate monitoring VM or external probe. Keep the same
target names and metric labels so existing dashboards and alerts continue to
work.

## Growth path

The next infrastructure steps should be triggered by load and recovery objectives, in this order:

1. Move uploaded stimulus binaries from the VM filesystem to private Object Storage. Keep only metadata in PostgreSQL.
2. Move PostgreSQL to Managed Service for PostgreSQL with automated backups and point-in-time recovery.
3. Add a staging environment with a separate folder, service accounts, Lockbox secret, bucket, database, registry paths, and domain.
4. Put an Application Load Balancer in front of two application instances for zero-downtime and VM-failure tolerance.
5. Move to Managed Kubernetes only when the number of independently scaled services and deployment frequency justify its operational cost.

Do not add Kubernetes only as a precaution. Docker Compose on one VM is the lower-cost operational baseline; the migration steps above preserve the image, secret, health-check, and immutable-release contracts so later scaling is incremental rather than a redesign.
