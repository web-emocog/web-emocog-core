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
  Converter input is additionally confined to the owned upload root, including
  parent-symlink and hardlink rejection, before the validated-byte copy.
- Server RT is asynchronous and batched, with a bounded queue and cancellation.
  Python does not hold DB transactions. Access, participant/snapshot binding,
  delivery and idempotency are rechecked in the atomic commit transaction.
  Failed analysis leaves the checkpoint intact. A stale final cannot replace
  a newer checkpoint. Adapter v2 fixes empty/foreign-block attribution without
  changing the Python metric formulas; previous results are not recalculated.
  Special block IDs such as `__proto__` survive the RT projection/JSON round
  trip as own data instead of disappearing through an inherited setter.
- Compatible `qs` patch: 6.16.0 -> 6.16.1, addressing
  [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw).
  Lockfile integrity/license and the concrete comma-serialization regression
  are checked. No framework-major upgrade is included.
- Required CI additionally runs isolated staff HTTP, HTML/data and staff
  regressions on the existing Linux Chromium/Firefox + macOS WebKit matrix.
  Existing GL preflight, zero-retry isolated suites, required aggregate gate
  and the 35-minute general browser-job limit are preserved. Both PostgreSQL
  suites run serially against a disposable database.
- Superseded stimulus-library reads resolve as obsolete after a project or
  account change, including rejection/cancellation paths. They cannot invalidate
  the new project's cache. Current-scope errors still fail visibly.

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
| Full macOS / Node 24 API suite after final RT/path regressions | 553 pass, 5 explicit tool/platform skips, 0 fail |
| Full Linux / Node 22 API suite after final RT/path regressions, real Poppler enabled | 556 pass, 2 nginx-only skips, 0 fail |
| Disposable PostgreSQL 16, both suites, migrations applied | 49 pass, 0 skip/fail |
| Native nginx access-log redaction, both configurations | 4 pass, 0 skip/fail |
| Staff HTTP, 3 engines, two repetitions | 96 pass, retries=0 |
| HTML/data, 3 engines, two repetitions | 66 pass, retries=0 |
| Staff publication/password/stimulus/PDF, 3 engines | 144 pass, 3 explicit real-API opt-in skips, 0 fail |
| Real cookie/CSRF API + disposable DB, two researchers, all 3 engines | 3 pass; explicitly exercises the opt-in cases above |
| Runtime/Workers/security, 3 engines | 174 pass, retries=0 |
| FPS/QC diagnostics, 3 engines | 30 pass, retries=0 |
| Production backup/snapshot unit tests, synthetic fixtures | 52 pass |
| RT single-job Python smoke and Tk metadata scope | Pass |
| Browser typecheck; 62 changed JS / 25 inline script syntax checks; YAML | Pass |
| Runtime npm audit after the qs patch | 0 known advisories |

At preparation of this report the complete default browser run is still running.
Its final evidence and remote Actions checks must be verified on the PR before
merging into `develop`; this table is not an assertion that pending checks passed.
The cold local exact-image build was stopped after slow apt downloads (233 MB
required). Production images and smokes must pass in GitHub CI. Isolated Linux
tests mount this checkout read-only on an existing tools image; that is distinct
from testing the newly built release artifact.

## CodeQL Triage On PR 138

The initial scan raised six alerts. Five were individually reviewed and marked
false positive, with their reasoning recorded on GitHub; no query or security
gate was disabled:

- 107/108: invitation code selects credential type, not authorization. JWT
  signature/scope/full DB tuple or fresh staff principal/role/membership are
  required before RT and under the commit lock. HTTP/DB negative tests cover
  choosing/removing/changing the code and revoking membership.
- 106: the dedicated overrides dictionary intentionally stores block IDs as
  own data descriptors via `Object.defineProperty`, after block membership and
  value normalization. It does not traverse inherited objects or mutate a
  shared prototype/security object. Special-key regressions pass in Node and
  all three browsers.
- 104/105: executable paths are trusted operator configuration, not HTTP data.
  `spawn(shell:false)` and Linux `execvpe` preserve separate argv entries;
  environment/output/process/resource protections are exercised. This is not
  a claim of a complete parser sandbox.

Alert 103 is retained pending a new scan after adding explicit converter
input-root confinement. Existing Multer document names are already generated
as server UUID + extension under `.incoming`; the additional guard also checks
real paths/parents/hardlinks. No alert is declared fixed merely because a new
commit was pushed.

The first disposable DB fixture denied execution of its synthetic analyzer
scripts on a noexec tmpfs: 41 pass / 8 fail. Repeating with exec enabled only in
that disposable test tmpfs gave 49/49. Production tmpfs/security settings were
not changed. The first API invocation in the desktop sandbox could not bind
loopback (EPERM); the permitted local-server rerun passed. Neither failed
environment run is counted as successful evidence.

The first complete browser run exposed a scope-cancellation regression:
542 pass, 2 fail, 64 explicit skips. Both failures were the same obsolete
library read after switching projects, not an authorization bypass. The loader
now resolves superseded reads as false without invalidating the new scope;
the strengthened existing test passed 6/6 (three repetitions in both default
engines, retries=0). Full-suite verification is repeated before merge; the
initial failures are not relabeled as passes.

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
