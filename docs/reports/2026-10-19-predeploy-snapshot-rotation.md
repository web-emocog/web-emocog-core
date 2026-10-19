# Pre-deploy disk snapshot quota recovery

## Incident and scope

The supplied production job failed at `Create pre-deploy disk snapshot` with
`ResourceExhausted: The limit on total size of snapshots has exceeded.` Image
smoke tests and `wecog-release prepare` had succeeded; application deployment
was skipped. The former retention step ran only after deployment/public checks,
so quota exhaustion prevented cleanup. Its `mapfile < <(yc ... | jq ...)` also
did not propagate a failed list command to the parent shell.

Changes are based on `origin/develop` commit `468e222` in
`fix/predeploy-snapshot-rotation`. No cloud deletion, IAM change, production
deployment, VM bootstrap, service restart, push or merge was performed.

## Implementation and decisions

- Runner-only `deploy/production/predeploy-snapshot.py`, Python standard library,
  no new dependency/framework. Checked subprocess calls replace shell pipelines
  and process substitution. CLI retries are explicitly disabled; command timeout
  is at most 600 seconds and the controller deadline is 1200 seconds.
- A non-mutating list/get preflight runs after cloud authentication and before
  release preparation. Actual creation/deletion rights cannot be proven without
  executing writes; permission errors remain hard release failures.
- Mandatory order: access preflight -> successful validated DB/media backup and
  uploaded manifest -> rotation/new snapshot -> get/list `READY` verification
  -> application migrations/deployment -> public HTTPS checks.
- Normal retention reserves one slot: at most four old automated `READY` copies
  plus the new copy, with the configured target five. Only explicit snapshot
  size/count quota errors permit deleting one additional oldest eligible copy
  per retry. No retry after timeout, transport error, unknown result, generic
  ResourceExhausted, PermissionDenied or malformed JSON.
- Folder ID, source disk ID, both labels (`app=wecog`, `reason=predeploy`) and
  canonical automatic name must all match. Manual/baseline, foreign, partially
  labelled, `protected=true`, ERROR and in-flight resources are never deleted.
  An in-flight managed operation stops the gate for inspection.
- Preserve the newest previous `READY` snapshot throughout the entire gate.
  Before deletion, re-read its identity and the victim's identity; after deletion
  re-list and verify actual removal and retained recovery points. A changing
  READY inventory stops the run. Independent concurrent writers are prohibited;
  deploy/rollback already share the checked `wecog-production` concurrency group
  with `cancel-in-progress: false`.
- Malformed metadata, duplicate keys/IDs, invalid dates/statuses, possibly
  truncated lists, binding mismatch and non-READY creation fail closed. A new
  create result must match folder/disk/name/release labels, followed by an
  independent get and retained-inventory check. Recomputed storage size is not
  part of immutable identity. Raw CLI output/trace paths are not echoed.
- The normal successful floor is one old plus one new READY copy. Initial
  bootstrap with no previous automated copies creates only one. If a single old
  READY copy remains and quota still blocks creation, keep it and stop; an
  administrator must review/increase quota rather than bypass backup gates.

## Regression coverage and results

Executed locally with Node.js 24.19.0 and Python 3.14.3; all cloud calls in snapshot
tests use controlled substitutes, never production credentials/resources.

- `python3 -B -m unittest discover -s deploy/production/tests -v`: **43 passed**
  (14 backup-support tests, 29 snapshot tests).
- Snapshot cases include the observed quota message, oldest-first recovery to
  the two-copy floor, exhaustion at the protected copy, bootstrap, foreign/manual
  and protected resources, in-flight/error states, read/create/delete denial,
  false-success deletion, malformed/truncated/duplicate data, metadata races,
  independent READY verification, ambiguous create results, timeout and nonzero
  real entrypoint exit with a fake executable. No real cloud CLI is invoked.
- Targeted Node tests (`production-snapshot`, `production-backup`,
  `release-hardening`): **26 passed**. They also enforce mandatory workflow order,
  no failure bypass/process substitution and shared deploy/rollback concurrency.
- Full `cd apps/api && npm test`: **431 passed**, zero failures. PostgreSQL
  integration suites remain conditional on a separate test DB; no production
  database was used and no live DB suite was provisioned for this workflow fix.
- YAML syntax, static release audit and `git diff --check` are checked before
  handoff. Browser/UI/scientific behavior, API contracts and SQL are unchanged.

The existing backup wrapper now discovers `test_backup_support.py` explicitly;
the new wrapper runs `test_predeploy_snapshot.py`. This keeps each suite in the
required npm test gate without duplicating Python execution or weakening the
existing backup assertions.

## Rollout, rollback and residual risks

1. Review the diff and merge a green fix PR into `develop`; the user promotes
   `develop` to `main` using the normal merge flow. Runner changes need no VM
   bootstrap; root-owned server backup/release scripts are unchanged.
2. Before promotion, an administrator must verify actual deploy-account access:
   `compute.snapshotSchedules.editor` and snapshot metadata read access (e.g.
   folder-scoped `compute.auditor`). Existing documentation is not proof of live
   permissions. No automatic role grants or organization-wide admin bypass.
3. Inspect the first real run for the selected disk, retention/deletion IDs,
   successful backup set, new READY snapshot and public health checks. Live YC
   permissions, accounting latency, quotas and snapshot restore were not tested
   locally. With delayed deletion visibility the gate may stop safely and need
   inspection/retry rather than silently delete another copy.
4. If a create times out, inspect its cloud operation before rerunning. Existing
   application stays active when the gate fails; no rollback is needed before
   the deploy step. A partial retention run can have fewer historical copies,
   but must not remove its protected prior recovery point.
5. Revert workflow/helper changes via a reviewed PR if necessary. Deleted old
   snapshots are not recoverable by Git revert. The retained prior snapshot,
   manual baseline and independent DB/media backups remain recovery sources.
6. No DB/media retention, migration, runtime contract, scientific threshold or
   participant data flow changes. Cloud Backup/Acronis is a separate mechanism
   and is not repaired by this disk-snapshot workflow fix.

Primary references: [YC CLI snapshot create](https://yandex.cloud/ru/docs/compute/cli-ref/snapshot/create),
[snapshot get/status](https://yandex.cloud/ru/docs/compute/api-ref/Snapshot/get),
[Compute quotas](https://yandex.cloud/ru/docs/compute/concepts/limits),
[Compute access roles](https://yandex.cloud/ru/docs/compute/security/).
