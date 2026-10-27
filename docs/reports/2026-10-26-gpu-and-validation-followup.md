# GPU Measurement And Validation Sampling Follow-Up

Work started: 2026-10-26; final regressions completed 2026-10-27 (Europe/Istanbul).
Local branch: `feature/frame-pipeline-workers`, base
`89880ef5c0b98530e1d87fe6b13596e077d08f46`, preserving prior local work.
No commit, push, deployment, issue closure, account change, camera or microphone.

## Findings And Changes

1. The previous Chromium `default` runs used Playwright's **headless shell**,
   which actually reported SwiftShader on this host. Omitting software flags
   was not evidence of hardware acceleration. The full Chromium channel in new
   headless mode reports ANGLE/Metal on Apple M4 Pro. Historical JSON records
   remain unchanged; their measurements are software-renderer baselines, not
   proof that native Chrome cannot sustain 25 FPS.
2. The replay now records browser distribution, a page WebGL renderer probe and
   diagnostic delegate/output overrides. Version 5 filenames are distinct from
   historical runs. `WECOG_NATIVE_GPU=1` in the Worker regression config selects
   full Chromium and checks for a non-software page renderer. This probe alone
   does not prove what a Worker/driver uses; actual model execution and measured
   throughput are tested separately.
3. Validation previously pushed `currentGazePrediction` every 33 ms, including
   repeated predictions, with a fresh polling timestamp. At 15 inference FPS,
   60 timer polls could look like 60 independent measurements. New
   `unique_capture.v1` sampling accepts each increasing capture timestamp once,
   rejects pre-window/unstamped/out-of-order predictions and clock changes, and
   retains capture rather than polling time locally. The existing settle delay,
   number of timer polls, gaze model and accuracy/precision limits are unchanged.
4. New `target_coverage.v1` requires observations at all five independent
   benchmark targets before passing. A missing target cannot disappear inside
   the mean of the remaining targets. The participant gets a localized missing
   measurements explanation in all ten supported languages; incomplete coverage
   offers full calibration rather than repairing only observed zones.
5. Only bounded, allowlisted sampling counters and target coverage enter ingest.
   JSON Schema, TypeScript, client compaction and server policy are updated
   together. The API rejects inconsistent counters/coverage and `passed: true`
   with incomplete coverage before writes. Each claimed observed target must
   have an accepted benchmark counter, not just a matching total. Legacy summaries remain supported;
   no DB migration or historical recalculation is needed. The separate nested
   payload/privacy backlog is **not** closed by typing these new fields.

## Sequential Real-Video Measurements

The same private, hash-locked 640 x 480 MCD-derived 60-second clip, real-time
playback, full face/eye/rPPG/Observer/segmentation/pose/FACS workload, unchanged
3/6/6 strides. No performance runs overlap other tests/builds. Existing production
delegate policy is retained: Chromium/Mac segment Worker CPU, Firefox/WebKit GPU.
The source is about 29.9 FPS. All records remain `accuracyStatus: not_scored`.

| Engine / run | Analysis FPS | UI timer p95 | Face inference mean | Segmentation mean | Strict gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Chromium 143 / Metal 1 | 29.82 | 2 ms | 8.33 ms | 148.17 ms | Pass |
| Chromium 143 / Metal 2 | 29.89 | 2 ms | 8.18 ms | 147.15 ms | Pass |
| Chromium 143 / Metal 3 | 29.89 | 2 ms | 8.30 ms | 149.77 ms | Pass |
| Firefox 144 / repeat 2 | 22.95 | 9 ms | 40.25 ms | 20.52 ms | Fail: analysis FPS/sustained drop |
| WebKit 26 / repeat 1 | 29.88 | 6 ms | 6.62 ms | 22.42 ms | Pass |

These pass/fail criteria also include capture gaps, Worker fallback and segment
freshness. No fallback or processing error occurred in the completed baseline
runs. Chromium maximum capture gap was 168 ms in run 1 and 67 ms in runs 2/3.

An earlier fresh Firefox run aborted on `non_monotonic_video_pts` before producing
a completed report. It is **not** counted as a pass, an FPS average or an accuracy
result. Later runs retained the strict timestamp guard and completed. Additional
relative-clock/counter diagnostics now accompany this failure. The intermittent
source-clock failure still requires investigation; no frames are silently
retimed or interpolated to hide it.

Private completed records under ignored `test-results/reference-data/`:

- `mcd-replay-chromium-default-multimodal-1x-browser-run1.json`
- `mcd-replay-chromium-default-multimodal-1x-browser-run2.json`
- `mcd-replay-chromium-default-multimodal-1x-browser-v5-run3.json`
- `mcd-replay-firefox-default-multimodal-1x-v5-run2.json`
- `mcd-replay-webkit-default-multimodal-1x-v5-run1.json`

The first new measurements precede the metadata-only v5 filename change; their
instrumented workload, scheduling, model inputs and thresholds are the same.

## Experiments Not Adopted Into Production

- Disabling the currently unused blendshape classifier output: Chromium shell
  remained 24.46 FPS; Firefox remained 22.95 FPS with 40.51 ms face inference.
  This did not solve the bottleneck. Production `outputFaceBlendshapes` is
  unchanged; neither the FACS output nor its frequency was removed.
- A single full Chromium/Metal GPU-segmentation experiment reached 29.89 FPS,
  5.87 ms face inference and 17.01 ms segmentation. This disproves treating the
  old SwiftShader regression as evidence about Metal, but is insufficient for
  a global delegate policy change. The conservative CPU policy already passes
  the throughput gate; matched-frame numerical/QC and real-device acceptance
  would be required before changing it.

## Reproduction

Use the documented private dataset/Observer locations, then:

```bash
WECOG_REFERENCE_ROOT=/private/dataset \
WECOG_OBSERVER_ROOT=/private/observer \
WECOG_REFERENCE_BROWSER=chromium \
WECOG_REFERENCE_CHROMIUM_MODE=browser \
WECOG_REFERENCE_RENDERER=default \
WECOG_REFERENCE_WORKLOAD=multimodal \
WECOG_REFERENCE_PLAYBACK_RATE=1 \
WECOG_REFERENCE_REQUIRE_PERFORMANCE=1 \
WECOG_REFERENCE_RUN=1 node scripts/reference-data/replay.mjs
```

For Firefox/WebKit omit `WECOG_REFERENCE_CHROMIUM_MODE`. Run engines sequentially
on an otherwise idle host. Do not interpret `renderer=default` as measured GPU.
Use the recorded renderer and distribution. The native Chromium regression is
`WECOG_NATIVE_GPU=1 RUN_WORKER_REGRESSION=1` with
`playwright.workers.config.ts --project=chromium`; it is not a video FPS benchmark.

## Verification

Final reruns, not counts copied from prior reports:

| Check | Result |
| --- | --- |
| macOS / Node 24 API | 530 total; 525 passed, 5 skipped, 0 failed |
| Isolated Linux / Node 22 API | 530 total; 526 passed, 4 skipped, 0 failed |
| Disposable PostgreSQL 16 integration | 49 passed, 0 skipped/failed |
| Chromium shell / Firefox / WebKit runtime, Worker and security regressions | 171 passed |
| Full Chromium/new-headless native GPU regressions | 57 passed; non-software page renderer asserted |
| Researcher analytics on isolated loopback port 4193 | 7 passed |
| Autotests TypeScript | Passed |
| Targeted sampling / aggregates / replay tests | 13 passed |
| `git diff --check` | Passed |

The three runtime scenarios run in each engine: a frozen prediction cannot
pass validation; fresh 15 Hz synthetic predictions remain unique and can pass;
one absent benchmark target still fails despite low error on the other targets.
These use a **synthetic oracle for UI flow**, not target-informed production
prediction or scientific accuracy evidence. Other browser regressions include
reload, offline, teardown, late Worker replies, ingest retry and stimulus paths.

API/DB tests retain the previous checkpoint after invalid `passed`/coverage,
including a fabricated complete coverage with no counters for the missing
targets. Oversized/duplicate rows, unsupported versions, invalid clocks/counts,
forbidden metadata and legacy summaries are checked. Raw gaze series still do
not enter ingest; bounded sampling counters survive client compaction.

An initial macOS run had three loopback `listen EPERM` sandbox failures plus
an outdated source assertion for the renamed poll counter. The assertion was
updated to retain the 60-poll, settle-delay and unique-capture/pass invariants;
the full suite was rerun with loopback permission. No failing test was skipped
or threshold weakened. Docker test DB/network were disposable and cleaned up.

## Limits And Rollout

**Universal FPS is not closed:** Firefox still misses 25 FPS, with most primary
latency in real face inference, not canvas copying or segmentation. No model,
image resolution, channel stride, GPU driver, browser permission or QC threshold
was silently changed to obtain a pass.

Replay excludes physical camera drivers, personally calibrated gaze, a real
full protocol with concurrent stimulus video/checkpointing and actual keyboard/
photodiode timing. A 60-second clip is not a 40-minute acceptance test. MCD clock
alignment is not verified, so HR/respiration/gaze accuracy is not established.
Validation target completeness is not a scientifically validated minimum sample
count; sparse precision estimation and legacy standalone calibration/tracking
media-time deduplication remain follow-up work.

Review/CI and an explicit release request are required before deployment. Static
asset cache invalidation must be coordinated in that release; it is not claimed
complete here. Roll back sampling producer/compactor, schema/types and server
metadata validator together, not one side in isolation. Historical optional
metadata can remain stored. No raw media fixture enters Git or ingest.

Primary references: [Playwright browser distributions](https://playwright.dev/docs/browsers),
[Playwright new headless transition](https://github.com/microsoft/playwright/issues/33566),
[MediaPipe FaceLandmarker options](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.facelandmarkeroptions).
