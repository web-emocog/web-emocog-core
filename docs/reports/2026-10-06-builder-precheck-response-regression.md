# Builder, Precheck And Response Instructions

Date: 2026-10-06. Branch: `agent/local-stimulus-input-isolation`.
All changes and verification are local. No deployment, push, or production
database mutation was performed. Existing stimulus/security/password work is
preserved.

## Changes

1. Builder title, protocol ID, estimated duration, and description are captured
   on input, before language rerenders. Editing has a separate account-isolated
   metadata draft with a source-revision check and current step. It neither
   overwrites the new-protocol draft nor replaces a newer saved revision.
   Explicit save still controls persistence/publication through the API.
2. Precheck contour status and the pose indicator share
   `apps/participant-web/js/precheck-status.mjs`. Color uses the actual pose
   result and the existing face-height interval `[0.17, 0.52]`, not deviation
   from a fictitious ideal face size. Unknown pose is pending, not passed.
   The overlay matches the mirrored video and its `object-fit: cover` crop.
   A reference contour appears only after an actual reference is captured.
   Post-precheck personalized head-deviation guidance is unchanged.
3. Both effective calibration instruction surfaces explain that blinking is
   allowed between target transitions and before the next click. Eyes should
   be open and directed at the target while clicking. All ten locales are
   covered. Calibration fitting, validation limits, and QC thresholds are
   unchanged.
4. Standard instruction bodies now derive the response from actual trial modes
   and expected responses, including `KeyZ`, `KeyX`, `Comma`, `Period`, click,
   pointer intent, and no response. Choice-task mappings come from trial
   conditions instead of fixed arrow keys. Multiple consecutive instruction
   blocks use the upcoming task. Custom text is not replaced merely because
   the next block has a known task type; `{response}` provides explicit
   substitution in custom text in all ten locales. The builder explains this
   placeholder. Input collection and scoring contracts are unchanged.
5. Analytics refinement disclosure keeps the user's open/closed state across
   checkbox/filter changes, reset, and language rerenders. This is UI state,
   not an extra field in analytics requests or snapshots.
6. Canonical participant imports, runtime UI, head guidance, and translations
   use coordinated cache versions. Contract tests check the shared imports to
   avoid mixing old and new head-reference/state instances.

## Verification

Fresh checks in this worktree:

| Check | Result |
| --- | --- |
| API unit/security/contracts (`npm test`) | 310 passed, 0 failed, 0 skipped |
| PostgreSQL integration | 23 passed, 0 failed, 0 skipped |
| Chromium and Firefox broad regression run | 240 passed, 0 failed, 0 skipped |
| New creation/precheck/instruction scenarios within broad run | 40 passed |
| Playwright TypeScript check | Passed |
| JavaScript syntax checks | 36 modules passed |
| `git diff --check` | Passed |

The browser run includes metadata creation/editing/reload/revision isolation,
refinement state, precheck gate/contour agreement and cover geometry, physical
keyboard responses, all ten instruction locales, authenticated uploaded media,
heatmaps, late mutation scope guards, session recovery/export, and the previous
password fixes. Password live tests use isolated fixtures, not human accounts.
PostgreSQL runs against the separate `emocog_recovery_tests` database, not the
manual verification workspace.

An initial unit run caught outdated cache-version expectations and a cold-start
timeout in the fake media-tool fixture. Expectations were synchronized with
the actual module graph. The fake preview fixture's startup allowance is now
5 seconds; the strict process-timeout/output-limit tests and production media
timeouts were not relaxed. A multilingual browser assertion was corrected to
allow key-before-verb word order while retaining exact condition/key checks.

Final ignored local logs under `apps/api/uploads/local-preview/`:

- `creation-full-api-final.log`
- `creation-postgres-tests.log`
- `creation-broad-browser-final.log`

## Limits

Precheck image geometry and statuses were exercised with synthetic face/pose
samples, without retaining real face images or raw biometric fixtures. This
does not establish webcam accuracy or guarantee first-attempt calibration on
a real participant/device. A manual camera pass remains necessary. No gaze
target snapping, calibration-threshold reduction, or retrospective changes to
stored results were introduced.
