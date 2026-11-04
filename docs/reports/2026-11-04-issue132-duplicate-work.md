# Issue 132: Duplicate Calls And Browser Resource Ownership

Date: 2026-11-04, local branch `fix/issues-132-144`. No commit, push, issue
mutation, production-account access or deployment in this follow-up. Tests use
synthetic inputs and do not request a real camera or microphone.

## Confirmed Findings

1. **Concurrent precheck setup.** The running flag was set only after camera
   acquisition and the initial two-second FPS measurement. Three concurrent
   calls made three `getUserMedia` requests. Stopping while waiting for permission
   did not prevent a late stream from attaching and starting analysis.
2. **Old fallback gaze run reactivating.** An in-flight callback read the shared
   replacement `localState` after stop/restart. It published its old result and
   scheduled a second timer into the new run. A deterministic reproduction
   observed two pending timers and an obsolete published result. Late
   segmentation completion could also replace/unlock the new run's mask slot.
3. **Redundant camera FPS monitor.** Tracking started its own observer even when
   the continuous pipeline already measured source FPS. The trajectory ending
   path then stopped it twice. This is not a second face-model inference, but
   is avoidable work and competes for shared camera-FPS state.
4. **Calibration preparation reentry.** Startup awaited dynamic module readiness
   without sharing its in-flight promise. Repeated calls could create multiple
   QC/gaze instances and calibration-introduction handlers.
5. **Four duplicate module URLs.** All three engines loaded both tagged and
   untagged copies of `face-segmenter/constants.js`, `qc-metrics/frame-analysis.js`,
   `session-runtime/vision-worker-client.mjs` and `session-runtime/contracts.mjs`.
   The first browser regression caught these duplicates, rather than ignoring
   them. Duplicate module definitions do not themselves prove duplicate model
   execution or explain the full reported FPS loss.
6. **Historical frame keys retained pixels.** Precheck retained up to 100
   original result objects. `frame-pixels.mjs` uses those same objects as WeakMap
   keys for captured ImageData, so the history also kept their pixel buffers
   alive. If all 100 captures are 640x480 RGBA, the buffers alone represent
   122,880,000 bytes, approximately 117.2 MiB. This is an ownership-based bound,
   not a measured browser/GPU RSS delta.

## Fixes

- Camera setup owns one promise, abort controller and stream. Stop/cancellation
  releases a stream arriving later without detaching a newer stream. Video
  metadata/playback preparation has a 15-second deadline, abort cleanup and
  explicit error handling. The FPS sampler now accepts an optional AbortSignal
  and cancels its observer/timer immediately; the existing two-argument API
  keeps its normal result and sampling method.
- Active precheck calls reuse one loop. Owner checks after async initialization,
  face inference and segmentation prevent old results from entering history,
  indicators or another scheduled iteration. Normal completed setup keeps the
  shared camera for calibration; it must not be treated as a cancelled setup.
  Continuous takeover also retires the precheck running flag, including the
  calibration-disabled route. Subsequent navigation cleanup cannot reset the
  analyzer already owned by continuous analysis. This handoff check was added
  after an initial broad pass; final acceptance uses a subsequent frozen run.
- Fallback gaze callbacks capture their run object. Only that current active
  run can publish, schedule or use a mask. When continuous analysis takes over,
  the fallback retires without clearing continuous gaze or smoothing state.
  Timer handle zero is not mistaken for absence of a timer.
- Calibration startup shares one preparation promise and releases its guard
  on failure, allowing a fresh retry. It does not change point placement,
  sampling, correction/validation separation or acceptance thresholds.
- Tracking uses the existing continuous source-FPS channel, and only starts
  its legacy observer when continuous analysis is absent. The redundant stop
  in trajectory completion is removed; the finish path remains responsible.
- Both current and legacy precheck histories store shallow derived-result
  snapshots instead of original frame keys. The same derived values and
  100-entry limit remain; current capture pixels remain available to same-frame
  consumers. Historical snapshots no longer keep those WeakMap pixel entries
  alive. Garbage collection timing and total browser memory are not asserted.
- Imports use one canonical URL for each duplicated module. Only reverse
  dependency references are cache-bumped to `20261104-2`; unchanged leaf helpers
  keep their existing canonical URLs. Model binaries, vendor code, delegates,
  strides and numerical QC thresholds are unchanged.

## Apparent Duplicates That Remain Intentional

- Face, segmentation and pose are different model tasks. Their separate Worker
  contexts are not three executions of the same face calculation. Primary
  admission remains single-flight with latest-frame scheduling; auxiliary
  admission remains bounded and independent of primary completion.
- Source-frame notifications and the primary stall heartbeat have different
  roles. Frame identity and the busy guard prevent the heartbeat from becoming
  another inference loop on the same delivered frame.
- The local checkpoint timer and server-backup timer have different durability
  responsibilities. `SessionDelivery.pending` coalesces simultaneous server
  checkpoint requests; local writes are serialized separately. Removing one
  timer would remove a recovery mechanism, not just redundant computation.
- `rt_input_observed` is a diagnostic event, not a second accepted trial
  response. The task input handler remains responsible for accepting/scoring
  responses. `GazeTracker.predict()` returns a prediction but does not invoke
  its stored `onGazeUpdate` option, so the explicit pipeline consumer is not a
  demonstrated double publication.

Of 23 runtime files newly touched by this follow-up, comparison with HEAD after
normalizing cache query strings finds functional changes only in
`video-frames.mjs` and the legacy `precheck.js` history snapshot. The other
functional changes are in files already dirty from the prior local work:
precheck, fallback gaze, and tracking/calibration.
This check guards against accidentally changing model mathematics in the wider
cache-version update.

## Checks And Limits

`issue132-duplicate-work.test.js` covers permission coalescing/cancellation,
retry ownership, video timeout/error/playback rejection, successful camera
handoff, single precheck loop, stale results, gaze restart/handoff, late masks
and both current/legacy tracking monitor paths. `video-fps.test.js` additionally
covers FPS cancellation, including callback handle zero and an already aborted
signal. Browser checks run the actual imported modules with synthetic I/O,
including single-flight calibration and a full startup resource inventory.

After normalization, each engine reports **113 distinct UI module paths, no
duplicate URL versions and zero sensor requests**. This inventory is per page:
separate face/segmentation/pose Worker contexts intentionally have separate
module/model instances and are not expected to share one JavaScript module map.

Final frozen-source results, all commands completed with exit code zero:

| Suite | Passed | Skipped |
| --- | ---: | ---: |
| API unit suite | 670 | 5 |
| FPS, duplicate calls, module inventory and pixel ownership | 84 | 0 |
| Worker, runtime and security | 231 | 0 |
| Staff, publication, access and attempt analytics | 282 | 3 |
| Creation, precheck and response instructions | 60 | 0 |
| Invitation media and persistence/recovery | 57 | 0 |

Browser total: **714 passed**, three existing cookie-fixture skips, Chromium,
Firefox and WebKit, retries zero. API skips remain two native PDF checks, one
Linux media-wrapper check and two real-nginx checks. PostgreSQL integration
was not enabled in this unit command; earlier DB results are not relabeled as
a fresh run.

TypeScript, syntax checks for 67 changed JavaScript/module files and
`git diff --check` passed. SHA-256 verification checked all 94 changed
runtime/library/test files against the 100-file snapshot: no source changes
during final acceptance. The separate audit worktree stayed untouched, and the
test servers were stopped. Seventeen new duplicate-work unit cases and the
FPS-abort case account for the API increase; focused/intermediate repetitions
are not added to the final totals. The history tests exercise 105 captures,
retain the newest 100 derived snapshots and preserve original capture pixels
only for their current owners.

The initial API run without local-server permission failed three
tests with `listen EPERM`; no application assertions were disabled. The initial
browser batch passed 72 cases and correctly failed its three module-inventory
cases. Those findings were fixed before the final no-retry run.
The added browser handoff fixture initially switched owners before its mocked
analyzer had entered, producing `release is not a function` in all three
engines. It now waits explicitly for analysis admission and supplies a synthetic
segmenter. Assertions are unchanged; a final frozen-source run follows that
fixture correction rather than counting the failed batch as acceptance.
The next broad pass was stopped gracefully during staff tests after finding
the pixel-history retention issue. Its successful partial results are not
added to the final counts. A new frozen-source pass includes the history fix.

These are functional/resource-ownership checks, not a fresh long-session RAM or
live-camera FPS acceptance measurement. They do not establish 25 FPS on Firefox
or the problematic MacBook, physiological accuracy, or a total retained-media
memory budget. Earlier replay measurements remain in their dated reports.
Full derived-array cloning into checkpoint aggregation and the retained Blob
cache are still confirmed resource costs. A persistent/delta aggregation Worker
or bounded disk-backed media cache needs its own preservation, version-pinning
and recovery tests; neither redesign is silently included in this patch.

## GitHub Issue Recheck

Read-only GitHub check on 04.11 found the same four open issues:

The remote develop head still matches this checkout's base,
`f05645f5a469d919c8ad2a85b4b982ee10b5a9d1`. Main is protected at
`809ac09b25bcff799dfb3d5bb74b4e301c43ccec`. No branch history, protection setting
or remote source was changed.

- **132:** no comments newer than 30.10. The Safari/Edge/Chromium cases and the
  missing simultaneous camera/platform trace remain relevant. Keep open;
  optimizing extra work is not proof that every device meets 25 FPS.
- **144:** attempt separation/filter/export fixes remain local and receive
  regression checks; they are not declared deployed or closed here.
- **143:** long-session gaze drift still needs independent real-device
  validation; these resource changes do not establish that it is fixed.
- **146:** minute/block HR and respiration summaries remain unimplemented;
  the existing session summaries are not being relabeled as interval metrics.

Private logs, diagnostic reproductions and source-hash manifests:
`/private/tmp/wecog-20261104-duplicate-audit/`. No participant media, invitation
credentials, passwords or authentication tokens are written into this report.
