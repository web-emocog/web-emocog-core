# Safe snapshot CLI failure diagnostics

## Scope and incident context

A production snapshot gate reported only `ResourceExhausted`; its original CLI
description and support correlation IDs were unavailable in the public job log.
The user later reported a successful rerun. The original failure cause remains
unconfirmed: this change improves observability, not quota policy or recovery.

## Changes and implementation

- Add bounded (first 64 KiB) parsing of CLI stderr for fixed, allowlisted cause
  summaries and standard RPC codes. Unknown descriptions remain explicitly
  withheld rather than being echoed into public GitHub Actions logs.
- Log exit code, action, stdout presence, quota-recovery eligibility and its
  blocker (`command_not_create`, `stdout_not_empty`, or
  `snapshot_quota_not_confirmed`). Eligibility is not permission to bypass the
  remaining retention, identity, inventory and last-READY-copy guards.
- Retain well-formed client request/trace UUIDs and a supported operation-ID
  wrapper for investigation with cloud support. No new cloud lookup is made.
- Preserve safe diagnostics for handled quota failures and partial timeout
  output, including byte output from `TimeoutExpired`.
- Keep the ORIGINAL strict quota matcher, empty-stdout requirement, subprocess
  retry/deadline settings, rotation decisions and mandatory backup/READY gates.

No new dependencies, API/schema/migration, IAM role changes, workflow triggers,
VM bootstrap files or scientific/measurement changes are introduced.

## Security and residual risks

Raw stderr/stdout, arbitrary provider descriptions, environment values,
credentials, PII, URLs and local trace paths are not logged or uploaded. Only
constant summaries and narrowly validated technical IDs are emitted. JSON stays
on one prefixed line; provider-controlled newlines, ANSI escapes and workflow
commands are not copied. Diagnostic text never authorizes deletion or retry.

Not every provider error/ID format is recognized. Unknown errors still fail
closed and may require cloud support using the available correlation IDs.
Live provider behavior, accounting latency and the original incident cause were
not reproduced by these isolated tests. No production/cloud mutation was made
while implementing or testing this logging change.

## Verification

Executed with Python 3.14.3 and Node.js 24.19.0:

- `python3 -B -m unittest discover -s deploy/production/tests -v`:
  **52 passed** (14 backup-support, 38 snapshot tests).
- `cd apps/api && npm test`: **440 passed**, 0 failed.
- `git diff --check`: passed.

Regression coverage includes support IDs, wrapper-format quota descriptions
without relaxed deletion, ambiguous stdout, non-quota resource exhaustion,
secret/PII/path withholding, unknown codes/IDs, bounded large output, partial
byte timeout output, handled quota recovery and the real CLI entry point.
All YC calls are mocked or replaced by a local fake executable. Live cloud,
separate PostgreSQL integration DB and browser/hardware validation were not run;
the latter are outside this runner-only logging change.

## Rollout and rollback

Keep the change in `develop`. Production stays unchanged until the user includes
it in a later `develop` -> `main` promotion; that deploy automatically uses the
updated runner-side helper. No immediate release or VM bootstrap is required.
Rollback is a normal revert of this logging commit through the same branch
flow; it changes log detail only and cannot recover deleted cloud resources.

Primary reference: [Yandex snapshot CLI](https://yandex.cloud/ru/docs/compute/cli-ref/snapshot/create).
