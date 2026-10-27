# Firefox Source And Scheduling Audit

Local continuation on 2026-10-27, branch `feature/frame-pipeline-workers`,
base `89880ef5c0b98530e1d87fe6b13596e077d08f46`. Prior local changes preserved.
No commit/push, deployment, issue closure, account change or camera/microphone use.

## Result

**Universal FPS remains open.** New measurements separate model latency from
the number of video-frame callbacks delivered by the browser. Do not interpret
the presentation counter as the number of independently analysed images.

Production models, MediaPipe 0.10.14, delegate policy, resolution, channel strides,
QC thresholds and frame-pipeline scheduler are unchanged in this continuation.
Changes here are confined to local replay diagnostics, regression tests and docs.

## Controls Before Changing The Runtime

Private hash-locked 640 x 480, approximately 29.9 FPS, MCD-derived file. Local
loopback only; requests outside the origin are blocked. Runs are sequential,
without overlapping tests/builds. Source-only controls last 20 seconds and load
no model; full multimodal replay lasts 60 seconds with the existing 3/6/6 strides.
No screenshots, traces, video recordings or raw physiological series are saved.

| Source-only control | Callback FPS | Presentation-counter FPS | RAF FPS |
| --- | ---: | ---: | ---: |
| Chromium 143, full browser, headless | 29.90 | 29.90 | 119.95 |
| WebKit 26, headless | 29.90 | 29.90 | 60.04 |
| Firefox 144, headless | 22.57 | 29.91 | 120.05 |
| Firefox 157, headless | 23.20 | 29.90 | 120.03 |
| Firefox 157, visible isolated window | 22.92 | 29.91 | 119.99 |

The visible/headless comparison does not identify headless mode as the cause.
An earlier independent minimal Firefox 157 control, without the application
imports or a second video observer, also measured 23.10 callbacks/s. Thus this
file-playback limitation can be reproduced without inference, pixel copying,
segmentation, rPPG or the application's primary loop. The precise browser/driver/
codec cause is **not** established. This is not proof about physical webcams,
all Firefox installations, other codecs or a different machine.

### Synthetic MediaStream Control

An alternating 640 x 480 canvas is drawn with a nominal 30 FPS timer and
captured using `canvas.captureStream(30)`. This is not physical camera capture.
The second sequential round separately measures producer timer speed, because
requested 30 FPS does not establish that the browser generated/delivered 30 FPS.

| Engine | Producer draw FPS, including play startup | Stream callback/counter FPS | Raw media clock |
| --- | ---: | ---: | --- |
| Chromium 143 | 30.33 | 29.95 | Increasing |
| WebKit 26 | 27.84 | 27.75 | One initial value, 554 repeats |
| Firefox 144 | 25.08 | 22.19 | Increasing |
| Firefox 157 | 27.06 | 20.24 | Increasing |

These are control-delivery observations, not model FPS or webcam acceptance.
They expose producer-timer and canvas-stream losses separately from file
callback coalescing; they do not establish where a hardware camera would lose
frames. WebKit's 555 callbacks must not be described as 555 independent PTS
measurements. The diagnostic stores aggregate clock counters without retiming
or publishing physiological samples. Original and producer-instrumented runs
remain separate private reports.

### Full Multimodal Replay

| Full multimodal replay | Analysis FPS | Face inference mean | UI timer p95 | Gate |
| --- | ---: | ---: | ---: | --- |
| Firefox 144, default canvas, run 1 | 22.97 | 39.19 ms | 9 ms | Fail |
| Firefox 144, compute canvas, run 1 | 22.88 | 41.28 ms | 9 ms | Fail |
| Firefox 157, timer, run 1 | 22.83 | 9.27 ms | 9 ms | Fail |
| Firefox 157, direct frame-ready, run 1 | 22.82 | 9.20 ms | 9 ms | Fail |
| Firefox 157, timer, run 2 | 23.08 | 9.11 ms | 8 ms | Fail |
| Firefox 157, absolute frame deadlines, run 2 | 23.13 | 9.10 ms | 8 ms | Fail |
| Firefox 157, visible window, timer, run 1 | 23.06 | 9.08 ms | 8 ms | Fail |
| Firefox 157, explicit zero seek, replay v9 run 1 | 22.91 | 9.25 ms | 9 ms | Fail |

After zero-position preparation the source-only file control still delivered
23.09 callbacks/s against 29.89 presentation-counter FPS. The final 60-second
full replay completed with zero module errors, no PTS rollback, first/start
media positions both zero, 458 segmentation and 229 pose frames. Its strict
performance gate still failed on low analysis FPS and sustained drop. Fixing
test-video admission is **not** an FPS fix. The dataset-free synthetic CLI
also completed with both dataset/Observer environment variables unset.

The last two runs received 23.08/23.13 callbacks/s with zero callbacks during
an active primary analysis. Their callback-to-dispatch delay was 0.06/0.01 ms
on average; face capture approximately 0.30 ms and Worker round trip 10.09/10.15
ms. Callback spacing averaged 43.33/43.22 ms. Timer drift is not supported as
the limiting explanation in these runs. Direct dispatch and absolute scheduling
did not solve the problem and have **not** been adopted into the product.

The old Firefox 144 inference cost remains a separate compatibility concern.
Firefox 157 runs the same model much faster here, but updating the browser alone
does not make this replay pass. Earlier conclusions about approximately 40 ms
inference refer to Firefox 144, not all Firefox versions.

The compute-canvas experiment disables antialias/depth/stencil/preserved drawing
buffer only in a locally interposed first-party initialization. It did not help;
no vendor code, fake DOM, model outputs or production canvas settings changed.

## Clock Integrity

An intermittent failed replay had a **startup**, not EOF, rollback:
previous 168 ms, next 68 ms, presentation counter 8, processed frames 2,
currentTime 0.074942 s, duration 60 s, ended false, seeking false.
Independent ffprobe inspection of the initial file PTS was increasing.
This does not prove the browser's underlying cause; an EOF explanation for
this particular failure is contradicted by the trace.

Waiting for `video.play()` alone was insufficient. A stress run reproduced a
similar startup rollback on the tiny synthetic VP8 fixture: previous 501 ms,
next 1 ms, presentation counter 7, accepted frames 1, currentTime 0.040691 s,
duration 1 s, ended false, seeking false. The same full Firefox test batch had
44 passes and one strict PTS failure; ten isolated finite-file tests had passed.

Finite-file replay now pauses, waits for current data, explicitly seeks to zero,
awaits `seeked`, verifies position/seek state, then starts playback and admits
callbacks only after the play promise. Preparation is bounded and errors clean
up its event handlers/timers. It is never used to reset the clock of an accepted
signal or a live stream. Admission/first-frame clocks remain recorded and the
strict increasing-PTS guard is unchanged. No mid-file rollback, duplicate timestamp,
unexpected seek or missing timestamp is silently retimed or interpolated. The
finite-file helper recognizes an old terminal frame only when the browser
reports `ended` and exact `currentTime === duration`; this is not a live-camera
policy and did not fix the observed startup failure by itself.

After explicit zero-position preparation, five complete Firefox FPS batches
passed (45 checks, including three fresh finite-file starts per batch), followed
by a fresh 27/27 three-engine matrix. These improve the evidence over a single
successful rerun but do not prove the underlying browser bug is universally
fixed. Full replays retain the strict guard and exact numeric decoder-state
diagnostics for future failures. The earlier failed runs remain documented;
the assertion and timestamps were not weakened and retries did not hide them.

## Diagnostic Tooling And Privacy

- Optional GL hooks retain only fixed-method call counts and aggregate durations,
  never arguments, pixels, GL objects or return values. Native return/error/this
  semantics and restoration are regression-tested. Profiling results explicitly
  cannot pass the performance gate because of instrumentation overhead.
- Firefox 144 profiling measured approximately 6.85 ms/frame inside `readPixels`
  versus 39.33 ms face inference. It is not evidence that eliminating readback
  would eliminate all inference cost. Browser timing quantization also limits
  interpretation of very short GL calls.
- Source-only controls are labelled `not_applicable` for analysis performance;
  requesting the full-performance pass gate for them is rejected. They cannot
  be mistaken for a physiological/model acceptance run.
- External automation roots are explicit local CLI configuration, never API
  input or HTTP-served directories. The test loader checks package metadata;
  this is not a general cryptographic package verifier. The actual diagnostic
  Playwright 1.64.1 archive was separately checked against official npm metadata
  and the temporary lockfile; license Apache-2.0. Only an external temporary
  prefix and its official matching Firefox binary were installed. Repository
  dependency/lockfile versions remain unchanged.
- New filenames record automation version and visible/headless mode. Zero-seek
  preparation is recorded as replay v9 / source-control v2, so earlier
  private v5-v8 / source v1 records are not overwritten. The generic
  latest-result alias remains replaceable by design. No private data goes to Git.

## Reproduction

After preparing the private dataset as described in
[public reference datasets](../research/public-reference-datasets.md):

```sh
WECOG_REFERENCE_ROOT=/private/dataset \
WECOG_OBSERVER_ROOT=/private/observer \
WECOG_REFERENCE_BROWSER=firefox \
WECOG_REFERENCE_RENDERER=default \
WECOG_REFERENCE_PLAYBACK_RATE=1 \
WECOG_REFERENCE_WORKLOAD=source \
WECOG_REFERENCE_RUN=1 node scripts/reference-data/replay.mjs
```

For full analysis use `WECOG_REFERENCE_WORKLOAD=multimodal` and
`WECOG_REFERENCE_REQUIRE_PERFORMANCE=1`. For an installed **separate** automation
prefix add `WECOG_REFERENCE_AUTOMATION_ROOT=/absolute/prefix` and its matching
`PLAYWRIGHT_BROWSERS_PATH`; do not mix Playwright test-runner versions. To compare
a visible isolated window add `WECOG_REFERENCE_HEADLESS=0`. Default is headless.
Use unique run/mode filenames for repeated measurements.

Optional local experiments, not deployment settings:
`WECOG_REFERENCE_FACE_CANVAS=compute`, `WECOG_REFERENCE_GL_PROFILE=1`,
`WECOG_REFERENCE_DISPATCH=frame-ready` or `frame-deadline`.
GL profiling cannot be combined with the performance pass gate.

The synthetic control needs neither a dataset nor the Observer folder, and does
not request camera/microphone permissions:

```sh
WECOG_REFERENCE_BROWSER=firefox \
WECOG_REFERENCE_RENDERER=default \
WECOG_REFERENCE_WORKLOAD=source \
WECOG_REFERENCE_SOURCE_INPUT=canvas \
WECOG_REFERENCE_PLAYBACK_RATE=1 \
WECOG_REFERENCE_RUN=3 node scripts/reference-data/replay.mjs
```

## Verification

Fresh reruns, not counts copied from older reports:

| Check | Result |
| --- | --- |
| macOS / Node 24 API | 534 total; 529 passed, 5 skipped, 0 failed |
| Isolated Linux / Node 22 API | 534 total; 530 passed, 4 skipped, 0 failed |
| Disposable PostgreSQL 16 | 49 passed |
| Worker/session/security regressions, three engines | 174 passed |
| Full Chromium / native Metal regression | 58 passed |
| FPS/source/clock/native video regressions, three engines, after zero-position preparation | 27 passed |
| Full Firefox FPS suite, five repetitions after preparation | 45 passed; earlier same stress shape had 44 passes and 1 PTS failure |
| Isolated finite-file Firefox test, before preparation | 10 passed; did not erase the intermittent failure |
| Isolated researcher analytics | 7 passed |
| Autotests TypeScript, replay module syntax, `git diff --check` | Passed |
| Dataset/Observer-free synthetic CLI and zero-prepared MCD control | Completed, no external transfer; source-only results are not analysis passes |
| Zero-prepared full MCD / Firefox 157 | Functional assertions passed; performance gate failed, 22.91 FPS |

The FPS suite initially failed one new synthetic-stream test in WebKit because
its stream repeatedly reported the same `mediaTime`. The correction is explicit
diagnostic separation: finite-file PTS remain strict; stream-only delivery
controls expose increasing/repeated/backwards/missing clock counters and never
run inference or manufacture replacement timestamps. A fake repeated-clock test
checks this distinction, and native tests verify that every generated canvas
track stops. The separate later Firefox file-clock failure led to explicit
pre-play zero-position preparation and the fresh reruns above; no failing test
was skipped or production/scientific threshold weakened. The playback
preparation helper also has fake-event tests for reset, metadata readiness,
invalid finite sources and decode failure.

The default API suites skip opt-in converter/real-nginx smoke checks; macOS also
skips the Linux media-resource test. PostgreSQL is exercised separately in the
disposable DB rather than silently treating its default skip as a DB pass.
No production DB/account is used. This matrix is not an exhaustive security
proof, a 40-minute endurance run or a physiological accuracy validation.

The API/autotest package and lockfile diffs, production `frame-pipeline.js` and
`PrecheckAnalyzer.js` were compared with the snapshot at the start of this
continuation: no further product/dependency changes in those files. Existing
earlier local fixes are preserved. Backlog source rows/counts remain 239; only
the follow-up explanation changed, not the original shared spreadsheet.

## Remaining Gates

1. Compare the compositor callback/counter diagnostics with a physical webcam
   in actual Firefox, with separate permission. The new synthetic canvas stream
   control exercises MediaStream delivery but is not a camera-driver or
   physiological/model acceptance test. File decoding is not live capture.
2. Compare codec/display-refresh/driver behavior using an isolated reproducer.
   Do not count interpolated `currentTime` polls or a jumped presentation counter
   as fresh samples. Preserve capture identity before considering another path.
3. Three matched full replays per target configuration, then the complete
   stimulus/checkpoint/RT flow and a 40-minute camera session. Do not close the
   FPS issue based on a source-only run or a single clip.
4. Scientific HR/respiration/gaze accuracy still needs independently verified
   clock mapping and ground truth. All MCD runs remain `accuracyStatus:not_scored`.

## Primary Sources

- [MDN requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback):
  callbacks and presentation counters are distinct; gaps between callbacks can
  be detected from the counter. Our numerical results are local measurements,
  not performance guarantees from this documentation.
- [Playwright 1.64.1](https://github.com/microsoft/playwright/releases/tag/v1.64.1)
  and [official browser release notes](https://playwright.dev/docs/release-notes):
  versioned diagnostic browser distribution, not a product model update.
- [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices):
  synchronous calls/readback can stall; the GL experiment measured only their
  local contribution and does not justify vendor patching.
