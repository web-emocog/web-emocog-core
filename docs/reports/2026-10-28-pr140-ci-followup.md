# PR 140: CI Follow-Up

Scope: approved follow-up to the issue 139 and audit release, not new product
features. The target remains `develop`; the subsequent `develop -> main` PR
requires the user's final merge. No production rollout is claimed here.

## Observed Failures

- Initial run `40693609922`: CodeQL reported `js/bad-tag-filter` in the new
  loader privacy test. Its script-tag extraction matched lowercase HTML only.
  The expression is not a production HTML sanitizer. It now accepts tag case,
  and the regression also exercises mixed/uppercase tags. CodeQL was successful
  on the next revision (`848599d`, run `40706767453`); no alert was dismissed.
- Both release runs reproduced the late-authentication library failure in
  Chromium and Firefox. An anonymous library shell was created before the
  authenticated owner became available. Its ownership check correctly retired
  it, but no new shell replaced it. The existing local test reproduced this in
  both engines before the fix.
- Linux/Firefox native MediaStream test observed 6 and then 5 FPS rather than
  the assumed minimum of 7. A canvas paint interval and captureStream ceiling
  do not guarantee source cadence on a shared CI runner. This evidence does
  not establish a defect in the product FPS calculation or physical camera.

## Changes

- After authentication, a retired library shell is explicitly disposed and
  remounted only on the library route and after `WecogStaffSession.assertCurrent`.
  Existing controls/dialogs are never rebound to the new identity. Repeated
  authentication for the same identity preserves the current shell and AOI.
- Unit/browser coverage checks late first authentication, repeated events,
  unrelated routes, locked staff tabs, and old scope disposal. The delayed-auth
  test uses an explicit response barrier rather than a 150 ms timing guess.
- Bumped the researcher-stimuli cache tag to `20261028-2`.
- Native stream tests inspect actual requestVideoFrameCallback delivery,
  compare the exact frame count and rounded FPS, assert monotonic counters,
  and verify cancellation with no playback-quality reads. Two synthetic paint
  rates (100/250 ms) cover lower source cadence without requiring physical
  camera permissions. Deterministic counter tests, file-source FPS checks,
  and the 17-vs-25 FPS quality-failure regression remain enabled.
- No runtime FPS algorithm, scientific threshold, face-visibility threshold,
  model, API/schema, migration, dependency, or access policy changed in this
  follow-up. Dota/Observer/plugin experiments are excluded.

## Verification

- API/unit, Node 24: 610 tests, **605 passed**, 5 platform/tool-dependent
  skips, 0 failed.
- Delayed authentication, Chromium/Firefox, three runs each: **6 passed**,
  retries=0; the shell is replaced, its old scope remains retired, and another
  authentication event preserves the current shell.
- TypeScript, syntax and static release audit passed.
- Complete FPS suite in Chromium/Firefox/WebKit, two runs per case:
  **78 passed**, retries=0.
- Complete staff suite in Chromium/Firefox/WebKit: **276 passed**, 3 existing
  API-fixture-dependent skips, 0 failed, retries=0.
- GitHub release gates must succeed before merging; their final results are
  recorded in PR 140. Earlier runs passed PostgreSQL migration/security/load/
  backup-restore gates and production image builds, but those results do not
  replace CI on the final revision.

Tests use synthetic files and API responses. No camera, microphone, private
stimulus, live participant or production account is involved. This follow-up
does not replace the real-camera Windows/Edge acceptance for issue 139.

## Rollout And Rollback

The follow-up ships with the audit/issue 139 release through a normal merge
commit into `develop`, without rewriting history or bypassing failed checks.
The user decides the final `main` merge. A rollback uses a separate revert PR;
no DB rollback or clearing participant storage is necessary for these changes.
