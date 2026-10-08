# Stimulus Functional And Access Retest

Work began 2026-10-03 and continued 2026-10-04, local time. Branch:
`agent/local-stimulus-input-isolation`, base HEAD `1d9f052`, with the previous
uncommitted implementation preserved. No commit, push, fetch, deployment or
production-database operation was performed.

This continues [the security fixes](2026-10-03-security-fixes.md). The results
below are fresh executions, not copied counts from the earlier report.

## Further Bugs Fixed

1. Participant gaze normalization used the entire stimulus stage instead of the
   visible media pixels. A real portrait regression measured 646 px instead of
   the actual 122 px content width. `stimulus-geometry.mjs` now computes the
   decoded image/video content rectangle with object-fit, borders, padding,
   object-position and visual-viewport offsets. Hidden/undecoded/unsupported
   layouts fail closed. Text/shape tasks retain their existing stage semantics.
2. Heatmap wrappers used border-box aspect ratios, distorting the inner coordinate
   plane on small screens. Session, AOI and group planes now use content-box
   sizing; media and canvas retain matching dimensions and native proportions.
3. The participant measurement step inherited an entrance translation animation.
   Rapidly starting a task could move stimuli during measurement. Step 6 no
   longer animates; other introductory screens retain their existing design.
4. Authentication could resolve between library and core script downloads,
   causing `stimuliList is not defined`. Authentication notification now waits
   for DOM readiness, and scope initialization tolerates early events without
   marking legacy state initialized. A deliberately held core-script download
   regression exercises the real authenticated startup ordering.

The updated participant module cache graph remains consistent. Changed
researcher analytics/library scripts and the participant stylesheet have new
cache URLs. No new dependency, asset, SQL schema, camera predictor or scientific
threshold was introduced in this retest pass.

## Measurement Compatibility

New media-coordinate results are tagged `media-content-rect.v1`, algorithm
`1.1.0`; AOI and group calculations retain this provenance and parameter hash.
Legacy recordings remain unchanged. Mixed coordinate mappings are explicitly
rejected for session/group heatmaps and AOI calculations, including repeated
presentations within one session. The explanation is localized in RU/EN.
Compatible repeated presentations contribute all fixation/observation counts.

Old stage-normalized heatmaps cannot be reliably converted to corrected media
coordinates without original samples and the original display geometry. Do not
silently rewrite them, mix them with new results, or revert new writers to the
old method merely to make a group graph available. Select compatible sessions
or acquire new measurements. Target-blind prediction, corrected/display signal
separation and fixation thresholds remain unchanged.

## Real API And Browser Coverage

Disposable PostgreSQL 16 and FFmpeg containers, synthetic users/media, and a
local API were used. Browser fixtures use actual login, upload, protocol save,
publication, invitation admission, ingest and analytics endpoints, not mocked
responses for these flows. The measurement flow starts the cognitive engine
directly, bypassing real camera/precheck/calibration, and uses synthetic gaze
aggregates. The heatmap UI is supplied with responses retrieved from its real
API via its production store; normal manual filter selection is not duplicated
in every media case.

Live cases cover landscape, portrait, square and video media at 1280x720 and
390x844, plus portrait fullscreen, in Chromium and Firefox. They check decoded
dimensions, viewport confinement, the actual participant sampling rectangle,
native aspect ratio, heatmap/background alignment, nonempty rendering and
absence of page errors. Geometry comparisons are taken in one browser frame.
After the full suite, the four video cases were strengthened and rerun to check
`readyState >= 2`, actual participant playback/time progression, and a decoded
researcher background frame after scrolling it into view. Production code did
not change after the full passing run. Representative mobile heatmap, video and
portrait/fullscreen participant screenshots were also visually inspected.

Private originals and unauthorized edits return 403; another project cannot
read them. A same-project peer cannot see a private library item or publish it.
Owner publication allows reading only that pinned historical version for
analytics, not listing the personal library or publishing it again. Explicit
sharing and revocation, reload, account switching, and owner return were tested.
The eight-role PostgreSQL regression and earlier negative security tests were
repeated. No production role gate was bypassed or weakened.

At one read-only inventory checkpoint, 104 persisted current media files matched
their database SHA-256 values; 64 predated the latest API restart. This is a
point-in-time synthetic inventory, not a claim about production storage.

Keyboard coverage exercises all four physical codes under Russian and English
printed keys, canonical expected/actual responses, timing, wrong accepted keys,
Space/arrows compatibility, repeats, modifiers and composing/unrelated input.
Library mutation tests retain delayed-response/account/project/origin guards.
The broader suite covers publication feedback, builder navigation, trial edits,
randomization, fullscreen transitions, missing-file retry/skip, offline/reload,
session completion, idempotency and analytics/export.

## Test Fixture Repairs

Previously opt-in researcher tests used ambiguous toast locators, obsolete
breadcrumbs, duplicate protocol IDs and researcher credentials for an admin-only
screen. They now assert the actual publication status/link, use unique IDs and
separate synthetic admin login. Fullscreen bounds use the actual resized
viewport. Randomization tests use 500-ms stimuli rather than racing a 50-ms
visibility window; the randomized order and pause assertions are unchanged.

High-throughput integration fixtures use increased rate-limit env values only
on their disposable test servers. Production defaults and rate-limit contract
tests are unchanged. The PostgreSQL suite uses a separate DB from browser
fixtures so its empty-version migration-refusal assertion is meaningful.

Earlier failed runs are retained as diagnostic evidence. An initial full run
had 304 passes and 8 failures; the motion/atomic-comparison and timing fixes
addressed these. A subsequent fullscreen case revealed the startup race above;
its deterministic regression then passed in both browsers. Only the final
completed executions below count as acceptance evidence.

## Final Verification

| Check | Result |
| --- | --- |
| API unit/contract/security suite | 302 passed, 0 failed, 0 skipped |
| Real HTTP/PostgreSQL integration | 19 passed, 0 failed, 0 skipped |
| Full browser suite, live gates enabled | 314 passed, 0 failed, 0 skipped |
| Targeted startup/fullscreen/randomization regression | 6 passed |
| Additional decoded-video-frame/playback checks, same video cases | 4 passed |
| TypeScript typecheck | Passed |
| Python backup/restore safety | 14 passed |
| RT Python smoke | Passed |
| Empty-DB migration verification | 17 migrations, up/down/up passed |
| Source syntax, merge markers, diff whitespace | 62 JS modules and 1 shell script checked; passed |

Logs are under `/private/tmp/`:

- `emocog-repeat-api-final-complete.log`
- `emocog-repeat-postgres-passed.log`
- `emocog-repeat-browser-final-complete.log`
- `emocog-repeat-bootstrap-motion-passed.log`
- `emocog-repeat-video-frame-passed.log`
- `emocog-repeat-types-final.log`
- `emocog-repeat-backup-passed.log`
- `emocog-repeat-rt-passed.log`
- `emocog-repeat-migrations-passed.log`

Our temporary API and both disposable test containers were stopped after
verification; no listener remained on test ports 3000/4173. Host-side logs,
synthetic media and browser artifacts were retained. No user service was stopped.

## Rollout And Limits

Keep this local pending review. A later deployment must ship the coordinated
API/static assets and existing migration-17/media-tool/backup requirements from
the prior report. Preserve both SQL and uploads; database metadata alone is not
a backup of binary files. Rollback must retain newly recorded coordinate
provenance and must not reinterpret new data as the legacy method.

- Real Yandex Browser/Safari, hardware keyboards/IME layouts, user-specific
  files and production infrastructure were not exercised.
- Real-camera calibration and scientific eye-tracking accuracy require separate
  device/reference measurements. Synthetic tests do not prove accuracy.
- Bounded media validation checks the first video frame/first audio second;
  later corruption still requires the tested playback recovery UI.
- Unsupported cropped/transformed media layouts need a separately versioned
  mapping; canonical stimuli use contain sizing.
- These executions close reproduced bugs in the exercised coverage, not every
  possible application bug or an independent security audit.
