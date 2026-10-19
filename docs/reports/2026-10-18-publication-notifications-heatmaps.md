# Publication Admission, Quiet Backups And Virtual Heatmap Stimuli

Local changes only, 2026-10-18. No commit, push, deployment, user-password
change or rewrite of an existing session/publication was performed.

## Confirmed Causes

The local review database contained publication 2 before the reported admission,
but the admitted session and its payload both referenced publication 1. The
welcome handler loaded the correct immutable publication code, then overwrote it
with the entered stable code. The first publication's code also serves as the
stable link, so admission incorrectly selected the first immutable snapshot.
Analytics displayed the actual database binding; changing its label would hide
the wrong QC policy, not repair the admission.

Standard shapes have no uploaded media file. Analytics previously enriched only
numeric database stimuli; `std_simple_black_square` retained a null content URL
and the frontend displayed an unavailable-image placeholder.

## Implementation

- The welcome handler refreshes the invitation before consent with no-store
  caching, prevents concurrent Start actions and retains only the immutable code
  returned by the lookup. The public lookup response is also no-store. Existing
  admissions still resolve through their session ID to the original snapshot.
- The constructor QC step has a RU/EN backup-notification checkbox. Its boolean
  lives in `settings.persistence.showBackupNotifications`, in builder state and
  in the project draft. It defaults to true for older definitions. Local cached
  settings are account-scoped and new-draft cleanup resets them; an active editor
  retains its selection after publication cleanup. The server validates the
  optional object at save/publication without weakening QC.
- Muting hides only successful interim-save messages. Dispatch frequency,
  acknowledgements, retries, local checkpoints and the final upload are unchanged.
  A pending request is not shown as a failure. Failed saves remain visible at a
  safe boundary, and a later successful silent save clears that backup warning
  without removing an unrelated local-storage warning.
- The shared standard registry supplies self-contained SVG previews to analytics
  descriptors for session visuals, AOI, heatmap and group heatmap. Recorded
  intrinsic dimensions are preferred; absent square dimensions default to square
  geometry. The preview depicts stimulus-local content, not the white viewport.
  Unknown IDs stay unavailable and numeric media retain existing version/access
  resolution. Text previews need a supported recorded participant language.
- Linked runtime/static imports use cache revision `20261018-2`, including the
  account-storage script in researcher and login pages.

## Contracts, Security And Measurement

No new endpoint, SQL migration, dependency or external asset is introduced.
SessionFeature and analytics response shapes are unchanged; contentUrl already
supports inline media. The new optional protocol setting is documented in
`docs/api/session-runtime-v1.md` and strictly boolean; it cannot disable saving.

Project membership, immutable invitation/token binding and pinned uploaded-media
versions remain enforced. Inline SVG is generated from the local standard
registry with XML escaping, not arbitrary researcher markup or external URLs.
No raw camera/audio data or new biometric stream is transmitted.

No gaze/RT/blink/rPPG estimator, baseline QC threshold or fixation/AOI coordinate
algorithm changes. Recalibration after reload is deliberately retained. Generated
previews are visual templates, not recordings of every dynamic PVT frame. These
tests do not establish scientific accuracy or hardware timing performance.

## Verification

- Unit/API/contract suite: 381 passed, 0 failed/skipped.
- PostgreSQL integration: 37 passed, 0 failed/skipped.
- Expanded Chromium/Firefox/WebKit regression: 336 passed, 3 skipped, 0 failed.
  The conditional real-cookie two-researcher publication case is skipped once
  per engine; its separate fixture flag was not enabled. Database tests cover
  publication immutability, project membership and outsider rejection.
- Final targeted replay after preview type/integer-dimension checks: 18 passed,
  0 failed/skipped. These overlap with the expanded set and are not extra unique
  cases to add to 336. The welcome-refresh case also passed in all three engines.
- TypeScript no-emit, JavaScript syntax, git diff/whitespace and targeted
  conflict-marker checks passed.
- Local review service restarted successfully: ready/db=ok and HTTP 200 for
  researcher HTML serving cache revision 20261018-2. User review DB/media retained.

Tests use the dedicated `protocol_fixes_test` database, never the local review
database. PostgreSQL suites run with `--test-concurrency=1` because an existing
global row-count assertion otherwise races between independent suites. Early
regression fixtures were corrected to declare AOI/gaze schema versions, provide
synthetic QC observations where expected, and await the asynchronous welcome
refresh instead of reading the prior publication before the request returned.

Coverage includes stable-link admission to publication 2, refreshing a welcome
screen after republishing, same-version reload, real interim ingest with pinned
QC, silent success plus visible failures, restoring the toggle from a project
draft, all four heatmap/AOI endpoints, actual browser image decoding/colour and
aspect ratio, and foreign-project rejection. Existing recovery, custom-key,
publication/PDF and participant runtime regressions are included.

## Rollout And Limits

Restart the local API and serve the matching static assets; review DB/media stay
intact. No production installation has been changed. Historical incorrectly
admitted runs remain on publication 1: do not relabel them as version 2. Use a new
session to test the corrected admission. Publishing a changed notification
preference creates a new immutable version without changing the public URL.

For deployment use the coordinated API/static release procedure from the earlier
resilience report; migration 18 remains a prerequisite from the previous feature.
Rollback code/static assets together without mutating historical definitions or
session data. Old participant code may show success notifications again; it must
not be used to reinterpret historical QC rules.
