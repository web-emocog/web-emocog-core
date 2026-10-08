# Temporary Local Photodiode Merge

Date: 2026-10-07. Branch: `agent/local-stimulus-input-isolation`.
Local work only; no push, deployment, or production database changes.
The connectedness module is not implemented by this change.

## Merge And Preservation

The existing uncommitted stimulus, input, account, session, calibration, builder,
and analytics fixes were saved in local checkpoint `8898a3a` before merging
`feature/photodiode` at `9cd3009a5e6640592b875ce76c184b3f98cb721c`.
The Git merge had no conflicts. Follow-up edits are restricted to photodiode
integration, tests, and documentation; previous API, database, authorization,
stimulus version, and keyboard changes remain intact.

## Temporary Feature

- The welcome screen labels the square as a **temporary local feature** in
  Russian and English. The same status is explicit in code and `AGENTS.md`.
- It is disabled by default. Enable the welcome-screen checkbox or append
  `photodiode=1` to the participant URL, retaining its invitation parameters.
- Activation is limited to `localhost`, `127.0.0.1`, and IPv6 loopback. A
  deployed hostname cannot enable the feature via the query or checkbox.
- The square is 110 CSS pixels at the top-right corner. It is hidden before
  the experiment, during consent/precheck/calibration, and after completion.
  It does not intercept pointer events.
- Codes are four pulses for experiment start/end, three for a visible block
  change, two for starting a task stage, and one for stimulus onset.
  White and black intervals nominally last 100 ms each.

## Corrections To The Incoming Implementation

1. Experiment start also works for protocols whose first visible block is a
   task, without relying on a stale global instruction-start flag.
2. Task/stage codes are serialized with a bounded queue instead of silently
   dropping or interleaving flashes. Initial codes complete before an active
   task starts; the RT baseline and timed-block deadline start afterwards.
3. A stimulus pulse is requested only after fixation ends, successful media
   loading/rendering, and response collector activation. Failed media loads
   do not emit stimulus pulses; successful retries do.
4. A stimulus pulse never waits in a queue or delays an active trial. If a
   preceding code is still running, its status is explicitly `busy`, not a
   misleading delayed onset. Rapid trials can therefore lack a pulse.
5. Finish is idempotent. Page hiding, navigation, and entering calibration
   cancel timers and pending codes. A cancelled old finish cannot stop a new
   experiment. A hidden tab cannot accumulate flashes.
6. Local session metadata and technical marker events explicitly set
   `temporary: true` / `timingValidated: false`. Stimulus requests are logged
   synchronously with block/trial context; completion callbacks retain that
   captured context even if the runtime has advanced. A final payload can
   retain a request before an asynchronous completion event has settled.
7. The ordinary disabled path adds neither marker events nor photodiode
   metadata and does not wait for marker codes.

## Verification

Fresh final checks in this worktree:

| Check | Result |
| --- | --- |
| API unit/security/contracts | 319 passed |
| PostgreSQL integration | 23 passed |
| Combined `npm test` | 342 passed, 0 failed, 0 skipped |
| Full Chromium and Firefox regression | 402 passed, 0 failed, 0 skipped |
| Photodiode unit checks within the API run | 9 passed |
| Photodiode browser checks within the full run | 10 passed |
| Real stimulus upload/access/display/heatmap/library checks within the full run | 22 passed |
| Playwright TypeScript check | Passed |
| Modified JavaScript syntax and `git diff --check` | Passed |
| Python RT smoke | Passed; two trials, two correct responses |

Tests use synthetic users in `emocog_recovery_tests`, separate from the manual
preview database. Media files use an isolated subdirectory of
the existing FFmpeg container's mounted media directory. No human passwords,
projects, or stimulus uploads are reset to create test fixtures.

Initial runs caught test-fixture problems: a protocol version that selected
the wrong fixture parser, an image fixture outside the v2 stimulus registry,
a short fixation assertion that could miss the visible interval, a WebDriver
latency assertion instead of an actual decision-clock comparison, and a test
upload directory outside the FFmpeg mount.
These were corrected without relaxing authorization, payload validation,
media validation, production rate limits, or QC thresholds.
Batch tests raise request caps only in the isolated test processes; production
configuration is unchanged. API rate-limit middleware checks remain enabled.

Final ignored logs under `apps/api/uploads/local-preview/`:

- `photodiode-api-postgres-verified.log`
- `photodiode-browser-full-verified.log`

## Limits And Manual Test

This is software diagnostics, not validated photodiode synchronization.
Timers, DOM timestamps, display refresh, browser scheduling, and actual emitted
light are different clocks. Unit and browser tests cannot establish hardware
latency, jitter, or pulse readability. Measure these with the physical detector
and acquisition device before using the codes for scientific timing.

The bright square can affect peripheral viewing and gaze measurements. Compare
enabled and disabled runs on the intended device and keep stimuli away from
the detector patch. Real-camera calibration/blink accuracy and Safari behavior
still require manual device checks. No raw face video or audio export is added.

Manual preview uses the existing loopback API on port 3000 and restricted
static frontend on port 4173. Open the researcher workspace, choose a published
protocol, then enable the temporary feature on the participant welcome screen.
Use the normal invitation and consent flow; no participant authorization bypass
is introduced.

For a future rollback, revert the local merge using its first parent so that
checkpoint `8898a3a` remains; do not reset or discard the earlier fixes.
