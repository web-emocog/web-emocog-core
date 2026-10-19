# Production Snapshot Quota Failure

Date: 2026-10-19. Source: `fix/production-snapshot-retention`.

## Verified Failure

- Production run [39219917335](https://github.com/web-emocog/web-emocog-core/actions/runs/39219917335),
  commit `b5eb55056130ab481bdeddcd189009c03f71a621`, failed at
  `Create pre-deploy disk snapshot`. Yandex returned `ResourceExhausted`:
  `The limit on total size of snapshots has exceeded.`
- Tests, image builds/smoke checks and the logical database/media backup
  completed before that failure. The application deploy step was not reached.
  Public `/api/ready` returned `ready` / `db: ok` during investigation.
- The previous successful run
  [38003805459](https://github.com/web-emocog/web-emocog-core/actions/runs/38003805459)
  logged `PermissionDenied` on snapshot listing. Bash `mapfile` with process
  substitution masked the failed list/pipeline and returned success. Thus
  historical green jobs did not establish that retention actually worked.
- That older snapshot reported a 134217728000-byte source disk (125 GiB).
  The current cloud quota and inventory have not been independently read from
  an authenticated local cloud CLI; do not infer the live limit from defaults.

## Fix

1. Add an inventory/access preflight before image build/VM side effects.
2. After the validated logical database/media backup, reserve room by expiring
   only exact-scope owned READY automatic snapshots before creating the new one.
3. Verify the new snapshot's READY state, disk, folder, name and release labels
   before allowing migrations/container deployment.
4. Fail closed on CLI/JSON/list/delete errors, inventory changes or unverified
   creation. A permission or network error never authorizes more deletions.
5. Preserve baseline/manual, foreign-folder/disk and non-READY snapshots.
   Re-read inventory before each deletion and retain the newest previous copy.
6. Target five copies. Optional quota-specific adaptive retention requires
   explicit owner approval through `PRODUCTION_MIN_SNAPSHOTS_TO_KEEP`; unset
   means five, not two. A floor of two means one existing READY copy remains
   until the new READY snapshot succeeds. A bounded retry accommodates delayed
   quota accounting; reaching the approved floor blocks, rather than bypasses,
   the snapshot gate.

The workflow no longer relies on successful deployment to make room for its
own pre-deployment backup. No cloud IAM role or quota was changed by this patch.
The helper uses Node built-ins, adds no package/model/license dependencies and
does not change API/schema, participant data, scientific estimators or QC.

## Verification

- Full API/unit/security suite: 446 passed, zero failures/skips.
- Snapshot suite: 18 passed (included above), covering normal rotation,
  protected copies, approval floor, quota lag/exhaustion, IAM/network errors,
  invalid inventory/JSON, changed inventory, failed deletion and invalid new
  snapshots. Real subprocess tests verify the CLI adapter's failure propagation.
- Embedded production workflow Bash blocks, helper JavaScript syntax and
  workflow YAML parsing passed. Release audit, RT Python smoke and
  `git diff --check` passed.

No real cloud snapshot was deleted or created locally. Live IAM/quota and a
successful production deployment remain distinct operational verification,
not conclusions inferred from unit tests. Repository CI runs after push.

## Rollout And Residual Requirements

Use feature/fix -> develop -> main with ordinary merge commits and required
checks/review. Re-running the failed old SHA alone does not pick up this fix.
No VM controller/bootstrap update or database migration is needed for this
workflow-only change.

If cloud preflight reports PermissionDenied, an authorized cloud administrator
must verify the deploy identity's actual folder-scoped
`compute.snapshotSchedules.editor` binding. Do not grant broad editor/admin as
a workaround. If quota remains exhausted at the approved floor, increase the
appropriate quota or review unrelated resources manually; do not remove the
baseline or continue without a new snapshot.

Reverting the helper/workflow changes restores the previous deployment code,
not deleted backup history. All retention changes must therefore stay within
the owner's approved bounds. Logical database/media backup policy is unchanged.

Primary references: [Compute snapshot CLI](https://yandex.cloud/en/docs/cli/cli-ref/compute/cli-ref/snapshot/),
[Compute access management](https://yandex.cloud/en/docs/compute/security/),
[Compute quotas](https://yandex.cloud/en/docs/compute/concepts/limits),
[GitHub vars context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#vars-context).
