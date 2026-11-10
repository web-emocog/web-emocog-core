# PR 162: CI and security follow-up

## Scope

Only `feature/audit-modules-analytics-integration` is updated. No model weights,
scientific thresholds, production settings, migrations or deployment are changed.
The changes address failed CI checks and the CodeQL findings on this PR.

## Corrections

- Production web smoke tests inspect security headers on expected 404 responses
  without treating that expected status as a transport failure. Those paths now
  also have explicit 404 assertions; authorization and header assertions remain.
- Login browser tests expect the safe credential error and explicitly reject raw
  server rejection details. Password bytes, retry and origin tests are retained.
- Identity and workspace routers have explicit rate limits, including persistent
  PostgreSQL counters in production, before expensive or authenticated handlers.
  Router counters have their own namespace; the existing application-wide
  limiter, retry headers and fail-closed behavior remain enabled.
- Local outbox keys, expression fixtures, benchmark assets and public staging
  use opened file descriptors for inspection and reading, rejecting unexpected
  links and non-files. Size bounds are retained for benchmark inputs.
- Stimulus checksums reject paths outside the uploads root and linked files.
- The Linux conversion wrapper receives its bounded invocation through a
  dedicated data descriptor, not Python command-line arguments. RT stdin remains
  separate. Existing process-group cleanup and CPU/memory/file limits remain.
- Raw-media detection has explicit alternatives. Trial-index suffix parsing is
  linear, including long near-matching strings. The offline design prototype
  selects its layout from own routing properties, not an apparent login gate.
- The signup integration fixture accepts only its enumerated API routes on its
  own loopback server, with cross-origin targets and redirects forbidden.

## Local evidence

- Full API suite: 1,051 passed, 9 conditional skips, 0 failures (1,060 tests).
- Disposable PostgreSQL integration: 83 passed, 0 failures.
- Linux native-process/media tests: 13 passed, 2 conditional skips, 0 failures.
- Real Linux Poppler conversion: 3 pages, 1,275 x 1,650 pixels, resource limits
  verified. No biometric media or real account data is used by these fixtures.
- Targeted login tests: 6 passed across Chromium, Firefox and WebKit.
- Browser TypeScript check and public-tree staging/verification passed.
- SHA-256 checks for the emotion configuration, FACS classifier, face and pose
  model files match the pre-merge record.

The full browser regression and fresh GitHub Actions/CodeQL runs are required
before acceptance. Local production-image building is subject to Docker registry
availability; the CI image-build result must be checked independently.

## Limits and rollback

This is technical regression/security evidence, not physiological accuracy
validation. No real Windows hardware or camera was used in this follow-up.
Rollback is a normal revert of the follow-up commit; it requires no data/schema
rollback. Do not merge or deploy automatically as part of this follow-up.
