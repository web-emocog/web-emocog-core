# Security And Resilience Audit Candidate

Date: 2026-10-27. Branch: `fix/security-resilience-audit`, based on `develop`
at `4eab50078ad66f1ff54c5d019a789dd8df560e8e` after the approved browser-job
timeout fix. This is the remaining web/API audit, not the observation pilot.

## Scope

- Researcher/developer HTTP uses bounded headers/body reads, context-aware
  cancellation and explicit uncertain mutation outcomes. Network failure does
  not clear sign-in/drafts or claim a successful logout. CSRF retry remains
  limited to an explicit rejection before mutation and the same staff identity.
- HTML/data boundaries escape imported/API attributes and labels or construct
  text nodes. Special JSON keys remain own data properties, not prototype
  mutations. Missing numeric observations no longer become measured zeros.
- Auth validation does not return rejected passwords. Unexpected route errors
  log only allowlisted diagnostics, not SQL, stack traces or input values.
  Both nginx access-log configurations redact invitation credentials and omit
  query strings/Referer. Historic and native error logs are not retroactively
  sanitized by this change.
- Document/media subprocesses have a reduced environment, bounded output,
  process-group termination and Linux resource limits. Validation rejects
  symlinks and converts the exact checked document bytes. Rasterization checks
  every page and enforces total time/pixel/output budgets. New previews are
  removed on immediate failed/empty SQL updates.
- Server RT is asynchronous and batched, with a bounded queue and cancellation.
  Python does not hold DB transactions. Access, participant/snapshot binding,
  delivery and idempotency are rechecked in the atomic commit transaction.
  Failed analysis leaves the checkpoint intact. A stale final cannot replace
  a newer checkpoint. Adapter v2 fixes empty/foreign-block attribution without
  changing the Python metric formulas; previous results are not recalculated.
- Compatible `qs` patch: 6.16.0 -> 6.16.1, addressing
  [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw).
  Lockfile integrity/license and the concrete comma-serialization regression
  are checked. No framework-major upgrade is included.
- Required CI additionally runs isolated staff HTTP, HTML/data and staff
  regressions on the existing Linux Chromium/Firefox + macOS WebKit matrix.
  Existing GL preflight, zero-retry isolated suites, required aggregate gate
  and the 35-minute general browser-job limit are preserved. Both PostgreSQL
  suites run serially against a disposable database.

No new DB migration, role grant, physiological model, signal stride or QC
threshold. The previously published FPS work and its production delegate policy
are retained unchanged. Observer/non-task/Dota/screen/audio capture code, raw
recordings, private datasets, credentials and `.env` files are not included.
The original dirty audit checkout remains separate and unchanged.

## Fresh Local Evidence Before PR

These results were obtained on this selected candidate, not copied from prior
audit reports. Repeated browser executions are not unique test cases.

| Check | Result |
| --- | --- |
| Full macOS / Node 24 API suite | 551 pass, 5 explicit tool/platform skips, 0 fail |
| Full Linux / Node 22 API suite, real Poppler enabled | 554 pass, 2 nginx-only skips, 0 fail |
| Disposable PostgreSQL 16, both suites, migrations applied | 49 pass, 0 skip/fail |
| Native nginx access-log redaction, both configurations | 4 pass, 0 skip/fail |
| Staff HTTP, 3 engines, two repetitions | 96 pass, retries=0 |
| HTML/data, 3 engines, two repetitions | 66 pass, retries=0 |
| Staff publication/password/stimulus/PDF, 3 engines | 144 pass, 3 explicit real-API opt-in skips, 0 fail |
| Runtime/Workers/security, 3 engines | 174 pass, retries=0 |
| FPS/QC diagnostics, 3 engines | 30 pass, retries=0 |
| Production backup/snapshot unit tests, synthetic fixtures | 52 pass |
| RT single-job Python smoke and Tk metadata scope | Pass |
| Browser typecheck; 62 changed JS / 25 inline script syntax checks; YAML | Pass |
| Runtime npm audit after the qs patch | 0 known advisories |

At preparation of this report the complete default browser run and exact-image
Docker build/smokes are still running. Their final evidence and remote Actions
checks must be verified on the PR before merging into `develop`; this table is
not an assertion that pending checks passed. Isolated Linux tests mount this
checkout read-only on an existing tools image; that is distinct from testing
the newly built release artifact.

The first disposable DB fixture denied execution of its synthetic analyzer
scripts on a noexec tmpfs: 41 pass / 8 fail. Repeating with exec enabled only in
that disposable test tmpfs gave 49/49. Production tmpfs/security settings were
not changed. The first API invocation in the desktop sandbox could not bind
loopback (EPERM); the permitted local-server rerun passed. Neither failed
environment run is counted as successful evidence.

## Reproduction

From `apps/api`: `npm ci`, `npm test`, `npm run test:rt-python`,
`node scripts/release-audit.js`. With a separately provisioned disposable DB,
set `S2_TEST_DATABASE_URL` and run `npm run test:postgres`; never use production.
`RUN_POPPLER_SMOKE=1` enables real PDF conversion; `WECOG_NGINX_BIN` enables
native loopback log checks. Linux resource/process tests must run on Linux.

From `apps/autotests`: `npm ci`, `npm run typecheck`, `npm test`,
`npm run test:frame-workers`, `npm run test:fps`, `npm run test:staff-http`,
`npm run test:html-security`, `npm run test:staff-regression`.
Each isolated configuration owns a distinct loopback server and refuses reuse.
Tests use synthetic data and do not request camera/microphone permissions.

## Limits And Remaining Work

- The 239-row audit snapshot is a dated triage, not complete product approval:
  68 fixed/current-or-local, 61 non-actionable/obsolete, 110 remaining including
  9 partial. See [status JSON](2026-10-26-backlog-status.json) and
  [complex backlog](2026-10-26-complex-backlog.md). No Google Sheet edits or
  automatic GitHub issue closures are made by this release.
- Universal physical-camera FPS, particularly Firefox, remains open. Existing
  [FPS evidence](2026-10-27-fps-release-candidate.md) and its scientific caveats
  remain applicable; functional CI is not physiological/hardware validation.
- Native resource limits are not a filesystem/network sandbox. Dedicated
  conversion isolation, transaction-aware file garbage collection, restrictive
  static CSP, long-session quota/lifecycle stress and independent security
  review remain work items.
- RT queue limits are per-process, not durable/distributed. Browser pending
  final/idempotent retry remains necessary after restarts. Uncertain writes
  cannot safely be retried blindly; abort does not roll back a server commit.

## Rollout And Rollback

First merge this audit PR into `develop` only after local and remote checks.
Use one `develop` -> `main` PR containing FPS, CI and audit, then stop for the
user's review and main merge. No direct push/merge into main or production
deployment is authorized by this task.

Deploy coherent API/web images together. Preserve DB/uploads backups and the
previous image digests. No new data migration is required. Roll back the whole
tested API/web artifact pair, not an individual HTTP helper or consumer.
Existing measurements, invitations, checkpoints and user accounts must not be
rewritten or cleared to make rollout/rollback pass.
