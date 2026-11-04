# Issue 132: Further Performance Audit

Date: 2026-11-03. Local branch `fix/issues-132-144`, based on develop
`f05645f5a469d919c8ad2a85b4b982ee10b5a9d1`. No push or deployment.
This report extends, rather than replaces, the 02.11 attempt/QC report.
"Before" below means the local state at the start of this follow-up, including
the previously verified scheduler/attempt fixes, not an unmodified develop build.

## Changes

- Clear the precheck canvas once when leaving the visible mode, not on every
  hidden frame. Keep pose normalization, smoothing, detection and visible
  drawing at their existing cadence. Clear a replaced canvas as well.
- Avoid rebuilding identical QC warning text or rewriting an unchanged display
  state. Preserve live language/reason changes, the three-frame recovery streak,
  the 400 ms hide debounce and interruption of that debounce by a bad frame.
- Record bounded aggregate timings for six primary stages in
  `tech.framePipeline.stages`, with `timingMethod=completed-primary-stages.v1`.
  Publish detached diagnostic snapshots at most once per second during running,
  then force a final flush at teardown. Actual measurements and QC still run
  every analyzed frame. No extra camera, raw frame, landmark or timing-history
  arrays are retained or transmitted.
- Update the complete reverse import/cache dependency closure to `20261103-1`.
  Keep one shared instance of the guide, QC overlay, runtime and page modules.

No changes to camera resolution, model assets, delegates, confidence thresholds,
published protocol thresholds, 33 ms scheduling budget, 3/6/6 strides,
physiology formulas, valid-sample gates, target-blind gaze or storage contracts.
No plugin, Dota or unrelated worktree changes are included.

## Before/After Measurement

Sequential local runs on the same macOS arm64/M4 Pro host. The verified MCD
derived 60-second file has SHA-256
`2b926fb33f32d5d99609870d4456a5c1e8525b8978ae4ef2869d9d524eb8dd40`.
Existing license, pinned manifest and all manifest-listed hashes were checked by
`verifyManifest`. Face recordings remain outside this checkout and out of Git.

An isolated loopback harness runs the actual `SessionFramePipeline`, pinned
face/segment/pose Workers, FACS, continuous rPPG, QCMetrics and multimodal
collector. The video adapter substitutes a prerecorded file for the live camera;
it does not substitute any model result. No camera/microphone permissions or
external network requests. Chromium uses its full browser and Metal renderer,
not the default software headless shell. Each engine runs before then after
in a fresh process; no other test workload runs concurrently.

| Engine | Before FPS | After FPS | After analyzed frames | Face found | Technical errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium | 29.871 | 29.888 | 1793 | 100% | 0 |
| Firefox | 22.815 | 22.631 | 1358 | 100% | 0 |
| WebKit | 29.882 | 29.882 | 1793 | 100% | 0 |

These paired single runs do not establish a statistically significant speedup
or slowdown. Chromium/WebKit are source-rate limited in this fixture. Firefox
still fails a 25 analyzed-FPS requirement; do not turn its functional result into
a performance pass.

Mean elapsed time per completed frame after the changes:

| Stage | Chromium ms | Firefox ms | WebKit ms |
| --- | ---: | ---: | ---: |
| Face, including capture/Worker exchange | 10.265 | 43.690 | 10.878 |
| Guide, gaze dispatch, eyes | 0.013 | 0.029 | 0.016 |
| Emotion/multimodal | 0.015 | 0.025 | 0.031 |
| Quality calculation/dispatch | 0.028 | 0.043 | 0.038 |
| Continuous rPPG | 0.488 | 0.274 | 0.365 |
| Auxiliary dispatch | 0.008 | 0.006 | 0.003 |

No personal gaze calibration is run: the gaze predictor and normal gaze/blink
UI/history consumers are NOT included in these timing numbers. Nor are actual keyboard RT,
full protocol UI/checkpoint writes, live camera effects or a long thermal test.
The face timing includes asynchronous waiting, not just model inference.
The counters describe this pipeline instance, not a reconstructed history across
page reloads.
Physiological accuracy is not assessed by this performance replay.

A separate fresh Firefox source-only control, without models, measured 23.482
callbacks/s versus 29.878 presented frames/s over 20.015 seconds. This confirms a
decoder/compositor notification limit in this automated environment, but does
not prove it is the only Firefox bottleneck, or describe the physical camera.

A further diagnostic-only Firefox trace wrapped the existing capture/request
methods and instrumented first-party analyzer stage boundaries, without changing
model outputs or formulas. It measured mean capture 0.456 ms, pixel drawing/read
0.286 ms, derived calculations 0.098 ms, and `detectForVideo` 45.343 ms. Worker
round trip averaged 46.143 ms. The dominant delay is inside that inference call,
which may include GPU synchronization, not the small first-party pixel loops.
One in-flight request at teardown is not counted as a completed analysis frame.

Two alternative paths were tested only in the private harness:

| Instrumented Firefox path | FPS | Mean detectForVideo ms |
| --- | ---: | ---: |
| Unchanged input/context | 21.199 | 45.343 |
| Compute context without antialias/depth/stencil/preserved drawing buffer | 20.932 | 45.902 |
| Reuse owned ImageData as model input | 20.883 | 46.074 |

Each ran on the same 60-second file with 100% face detection and no technical
errors. They do not demonstrate a speedup and were NOT adopted in production.
These instrumented single runs are not comparable to the uninstrumented FPS
table as a scoring gate. Face detection alone is not landmark/signal equivalence
or physiological validation; no alternative was promoted on that basis.

Auxiliary work remains single-flight and bounded. Chromium's existing CPU
segmentation policy took about 152 ms per segment, with 298 segments/298 pose
results in the after run; deferred requests did not build a queue. Firefox and
WebKit segmentation averaged about 21.5 ms. Do not describe the nominal stride
as guaranteed frequency or change the compatibility delegate policy from this
single benchmark.

An isolated UI microbenchmark (seven rounds of 2000 updates per engine) showed
14,000 redundant hidden-canvas clears and 14,000 repeated warning DOM mutations
before the patch. The regression tests require zero such operations afterwards.
Their original measured per-frame cost was small: these removals do not explain
or claim to cure 17-23 FPS by themselves.
The after microbenchmark recorded one explicit setup/reset clear in total,
zero clears inside the 14,000 hidden updates, and zero repeated warning mutations
in each engine. No sub-millisecond timing is presented as a reliable speedup.

## Verification

The two new browser regressions initially failed in all three engines before
the UI changes. The fixture explicitly fixes CSS canvas sizes, matching the
production page, including WebKit's device-pixel ratio.

- Complete API suite: 631 passed, 5 environment-dependent tests skipped.
- Targeted scheduler/cache contract suite: 44 passed.
- Worker/runtime/security: 231 passed across Chromium, Firefox and WebKit.
- FPS/QC/UI regression: 48 passed across the same three engines, no retries.
- Staff/analytics/stimulus/publication regression: 282 passed, 3 existing cookie
  fixture skips, across the three engines.
- Creation/precheck/instructions: 60 passed across the three engines.
- TypeScript check and `git diff --check`: passed.

The five API test skips are two native PDF checks, the Linux-only media wrapper
and two real-nginx checks; PostgreSQL integration suites are not enabled in this
unit command. They were not rerun in this UI-only follow-up. Prior integration
results in the 02.11 report are not relabeled as fresh results here.

The first optional creation/precheck run used port 4190, which the browsers
correctly reject as an unsafe service port. That run was stopped; all 60 tests
were then rerun on 4196, with no browser protection disabled. No product change
was made to accommodate the fixture error.

The new scheduler assertions check stage-count equality, the elapsed-time
partition, constant-memory timing shape, detached snapshots, rate limiting and
the final teardown flush. The actual diagnostic object passes the existing
ingest policy; injected raw landmarks are still rejected.

## Remaining Work / Closure Gate

1. Continue Firefox model/backend diagnosis on installed browsers and a matched
   face-only versus full-pipeline GPU workload. Capture/pixels/derived costs have
   now been separated from inference; two input/context variants did not help.
   Preserve the failed performance evidence instead of relaxing the FPS gate.
2. Compare alternative paths only on matched frames, including landmark/pose,
   eye/blink, illumination, FACS and downstream signal equivalence. Disabling
   blendshapes, reducing pixels or skipping measured samples is not a free fix.
3. Repeat on the problematic MacBook Air M3 with installed Safari/Chrome/Edge,
   live camera, calibrated gaze, actual task/RT, stimulus rendering and durable
   checkpoint writes. Include background/visibility, camera effects, long-session
   memory and thermal controls. Playwright WebKit is not installed Safari.
4. Obtain the missing fps-lab JSON and anonymized problem-session 119/120 JSON.
   They have not been supplied. Their absence prevents attribution of that
   specific low-FPS case, not the local functional tests above.

Issue 132 remains open. The code contains measured, low-risk optimizations and
more useful diagnostics, not a claim that every environment now sustains 25 FPS.

Private aggregate logs, the temporary benchmark harness and before/after source
copies: `/private/tmp/wecog-issue132-20261103/`. They contain no saved face frames.
These are separate from the private source dataset. Do not publish the dataset.
