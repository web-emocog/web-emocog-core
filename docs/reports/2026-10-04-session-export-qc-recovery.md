# Session Export And QC Recovery

Local-only work on `agent/local-stimulus-input-isolation`, preserving existing
uncommitted stimulus/input/security changes. No commit, push, deployment or
production-database access was performed.

## Reproduced Failures

The supplied private participant export was read locally, not copied into
fixtures or uploaded as a raw file. Its ingest compactor produced approximately
118 KB of typed aggregates from the approximately 27.7 MB export. Validation
failed on one event: `interface_language_changed` had category `session`,
which is not in the `session_event.v1` enum. This explains both automatic
upload and manual full-export import receiving HTTP 422; it was not a network
connectivity failure.

The export also reported `faceVisiblePct=100`, `faceOkPct=76.8` and
`occlusionPct=23.2`. The previous final message incorrectly described a low
face-quality percentage as a lost face. The runtime detector required regional
hand-occlusion evidence, while final/module QC and its inline fallback also
accepted a global `handDetected`/`hand_on_face` flag. Such a global mask is not
evidence of a hand covering the face. The export cannot establish whether
glasses, neck/skin or another segmentation error caused these historical flags.

## Fixes

- The event producer uses `lifecycle`. Shared event construction, ingest
  compaction and full/aggregate researcher imports normalize only the known
  legacy `session` alias. Source exports are not mutated; IDs and timestamps
  are preserved. Unknown categories and PII remain rejected by the unchanged
  backend validator.
- Permanent client rejection has a distinct localized HTTP error message;
  it is no longer described as a connectivity failure. Checkpoint, token
  authorization and stable finish-id behavior are unchanged.
- Final metrics, the summary-only checkbox and validation heading have
  translations in all supported locales. Changing language on the completed
  screen updates both metrics and QC while preserving server validity.
- Runtime, modular and inline QC use the same regional hand-occlusion
  predicate. New QC summaries carry
  `faceVisibilityMethod=regional_hand_evidence.v2`. Scientific thresholds,
  temporal hold gates and actual missing-face detection remain unchanged.
  Historical summaries are not re-scored.
- Participant imports use coordinated cache URLs to avoid stale producers or
  duplicate stateful runtime modules. Changed researcher and QC entry points
  are cache-versioned as well.

## Real Local Recovery

The existing local admitted session and its project/protocol tuple were
verified against the export. Through the normal invitation ingest-token
endpoint, the compacted result was submitted to the running local API with
its original stable finish ID. HTTP 200 confirmed acceptance. A second
identical submission also returned 200; PostgreSQL retained exactly one
session-feature row and the invitation counter did not increase.

Historical QC remained `invalid`. No token, invitation code, raw landmarks or
user export was written into this report or a repository fixture. The original
download is unchanged. Recovery did not bypass participant scope or loosen
the schema.

## Fresh Verification

| Check | Result |
| --- | --- |
| Full API unit/contract/security suite | 305 passed, 0 failed, 0 skipped |
| PostgreSQL/HTTP integration, separate local test DB | 19 passed, 0 failed, 0 skipped |
| Session runtime, analytics and export recovery, Chromium + Firefox | 90 passed, 0 failed |
| New recovery browser cases, included in the 90 above | 6 passed |
| TypeScript typecheck and changed-JS syntax | Passed |
| Diff whitespace | Passed |

New regressions cover current and legacy language events, source immutability,
unknown-category/PII rejection, inline/module/runtime occlusion parity, English
final labels and live language changes, and full/aggregate legacy imports.
Researcher import browser cases mock the ingest endpoint; actual HTTP/database
acceptance was separately verified with the supplied session as described above.
The broader browser suite covers offline/reload, checkpoint and finish
idempotency, stimulus/video presentation, fullscreen and analytics regressions.

The initial PostgreSQL fixture run hit the default authentication rate limit.
The passing rerun raised limits only in its isolated test process; limits on
the running manual-preview API and production defaults were not changed.
Logs are in the ignored `apps/api/uploads/local-preview/` directory:

- `recovery-full-api-tests.log`
- `recovery-broad-browser-tests.log`
- `recovery-postgres-tests.log`

The English final regression also writes a synthetic screenshot to the
Playwright test output directory. It contains no user recording.

## Calibration Follow-Up, Not Implemented

The existing calibration uses 25 grid targets and two clicks per target.
Validation collects observations on timer ticks, which can count a repeated
prediction more than once. Calibration also has a repeated-frame fallback.
The supplied final validation had approximately 150 px vertical bias, so
systematic offset deserves separate investigation rather than treating all
error as jitter. This is one session, not a device benchmark.

Proposed work, requiring separate implementation and acceptance:

1. Collect only unique, recent camera/prediction frames after target settling,
   with stable/open-eye/confidence gates, bounded timeout and specific feedback.
2. Compare an adaptive smaller initial target set against the current baseline;
   recollect deficient training regions without discarding good samples, then
   run a fresh independent validation. Existing targeted recalibration helpers
   can be reused.
3. Diagnose coordinate changes and vertical bias explicitly. Accept correction
   only through training cross-validation and independent held-out validation;
   do not fit on the displayed validation target or reuse it as evaluation.
4. Explain glare/eye visibility, separate left/right eye quality and measure
   actual Safari/device/eyewear behavior. Consider an appearance-based predictor
   only after license, browser-runtime and independent benchmark review.

No new calibration algorithm, reduced threshold or scientific accuracy claim
is part of this patch. MediaPipe landmarks alone are not screen-gaze estimation.

## Rollout And Limits

The API, persistent local PostgreSQL and frontend remain running for manual
verification. Refresh participant/researcher tabs to load the coordinated
cache versions. This session is already stored, so replaying the entire
experiment is not needed for result recovery. Invalid/all-session filters may
be needed to see its historical QC result.

Ship the producer, compactor, importer, translations and coordinated cache
versions together. A rollback must preserve method provenance and stored
historical QC, rather than silently mixing global and regional occlusion
methods. Existing RBAC, stimulus-version migrations and media-storage
requirements from prior local work still apply.

Real-camera accuracy, glasses-specific false-positive rates, Safari execution
and all application/security paths were not independently proven by these
tests. These results close reproduced defects in the exercised coverage; they
do not certify absence of every bug or clinical validity.
