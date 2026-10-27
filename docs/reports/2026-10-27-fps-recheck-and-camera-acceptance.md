# FPS Recheck And Camera Acceptance

Date: 2026-10-27. Local dirty candidate `feature/frame-pipeline-workers`, based
on `89880ef5c0b98530e1d87fe6b13596e077d08f46`. The initial working-tree status
matched `/tmp/wecog-html-final-status.txt`. No production-code changes, threshold
changes, dependency updates, push, deployment or camera/microphone use in this
recheck. Earlier local work was preserved.

## Fresh Measurements

Host: macOS arm64, Apple M4 Pro. Sequential runs, no overlapping builds or tests.
Same hash-verified private MCD-derived 640 x 480, approximately 29.9 FPS file,
60 seconds at real-time speed. Existing multimodal replay runs production face,
eye-signal, rPPG, segmentation, pose and FACS processing with Observer aggregation.
The configured 3/6/6 strides, model versions and delegate policy were not changed.
Only loopback traffic was allowed. No raw media was added to the repository.

| Engine | Analysis FPS | Frames / face detected | UI timer p95 | Module errors | Strict gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Chromium 143.0.7499.4, full browser / Metal | 29.888 | 1793 / 1793 | 1 ms | 0 | Pass |
| WebKit 26.0 | 29.533 | 1772 / 1772 | 5 ms | 0 | Pass |
| Firefox 157.0, separate Playwright 1.64.1 installation | 23.439 | 1407 / 1407 | 8 ms | 0 | Fail |

All three used Workers for face, segmentation and pose. Maximum capture gaps
were 67, 67 and 100 ms respectively. Firefox failed `analysis_below_target` and
`sustained_analysis_drop`, with all 60 complete one-second windows below 25 FPS.
The failure was retained, not retried away or converted into a pass.

These FPS values describe the primary analysis loop, not a claim that every
auxiliary model runs at 30 FPS. Chromium completed 201 segment / 200 pose frames,
WebKit 590 / 295, Firefox 468 / 234. The bounded auxiliary scheduler skips work
while busy instead of accumulating an unbounded backlog. Chromium segmentation
mean was 235.4 ms, WebKit 33.6 ms and Firefox 35.5 ms; all were within the existing
1000 ms mean freshness budget. This budget is not scientific acceptance of the
auxiliary sampling rate.

A fresh 20.002-second Firefox source-only control, without models or inference,
delivered 463 callbacks: **23.148 callbacks/s**, against **29.897 presentation-
counter FPS**, with zero attempted external requests. This reproduces the
callback-delivery limitation without our model workload. It does not establish
the underlying codec/driver/browser cause, a physical sensor ceiling or live
camera performance. The full replay's callback and analysis counts were equal.

The current measurements are consistent with the earlier successful Chromium
and WebKit runs and the still-open Firefox issue. They are not a new matched
before/after benchmark of every optimization. Earlier Worker/main-thread
fallback findings remain documented in `2026-10-26-real-face-load-benchmark.md`.

## Automated Correctness Checks

Fresh `playwright.fps.config.ts`: **30 passed**, three engines, retries disabled.
Includes independent camera/analysis counters, strict source clocks, cleanup,
phase-specific QC characterization and recovery without erasing failed history.
Passing these checks does not make the Firefox throughput gate pass.

Fresh `RUN_WORKER_REGRESSION=1` / `playwright.workers.config.ts`: **173 passed,
1 failed** (174 checks, three engines, retries disabled). This is not an all-green
run. The failure is `Mac worker segmentation / reads real model masks without a
document shim or a main-thread fallback` in the repository's Firefox 144.0.2.

### Additional CPU Control Failure

That existing test deliberately substitutes a Chrome/Mac User-Agent in every
engine. Consequently the delegate policy selects Chromium's Mac CPU path even
inside Firefox. The observed result was `vision_worker_interrupted`, no usable
mask, and `worker_runtime_failed`, despite successful initialization.

A separate temporary local probe preserved the actual runtime, synthetic image,
timeouts and assertion. A wrapper around `_request` recorded only error code,
request phase and duration, and rethrew the original error without retrying:

- Firefox 144.0.2, native User-Agent / production GPU delegate: **3/3 passed**,
  real masks, no Worker fallback or errors.
- Same engine, substituted Chrome/Mac User-Agent / CPU delegate: **3/3 failed**.
  Each frame request exceeded the unchanged 5000 ms limit and raised
  `vision_worker_timeout`; observed timeout dispatch was approximately 5.0-5.2 s.

This establishes the immediate failure path for this forced-CPU control, not the
underlying CPU/WASM performance cause. It is separate from Firefox 157's file
callback-delivery limitation. It does not establish a failure in normal Firefox
GPU use or in real Chromium CPU use; neither does it justify declaring CPU
compatibility solved. Retain the failing evidence. Before changing this fixture,
explicitly distinguish normal-engine coverage from a forced cross-engine CPU
compatibility probe. Do not increase production timeouts or weaken mask/Worker
assertions just to make a test green. No such change was made here.

Probe source/configuration, aggregate results and the original failure log stay
in the private diagnostic directory below. No ephemeral probe was added to the
production tree. `git diff --check` passed before and after the report edit.

Private aggregate reports and logs for this run:
`/private/tmp/wecog-fps-recheck-20261027.igk2m5/`.
These are diagnostic aggregates, not an invitation to publish biometric media.

## What Still Needs Real-Device Testing

Automated replay covers algorithm execution, scheduling, counters and functional
regressions. It does not cover live camera exposure/effects, the installed Safari
or Chrome builds, personal gaze calibration, actual RT input latency, complete
participant UI/persistence or a thermally steady long session. WebKit automation
is not a test of installed Safari; Chromium automation is not installed Chrome.
UI timer lateness is a responsiveness proxy, not hardware-validated RT accuracy.
The replay remains `accuracyStatus: not_scored`.

1. Use the local candidate on the laptop that showed the original problem. Record
   computer, OS and exact browser builds, power mode / AC supply, other load,
   camera settings, resolution and lighting. Record camera effects such as
   Center Stage, Portrait or background blur; do not silently combine different
   effect settings into one comparison.
2. In installed Safari and Chrome, separately, run the same short protocol for
   5-10 minutes with the camera, usual glasses and ordinary working posture.
   Keep the tab visible and the camera exclusive to this run. Do not lower the
   protocol's QC thresholds to make the test pass.
3. After warmup, retain separate camera-publication and analysis FPS windows,
   their measurement methods, capture gaps, QC reasons, attempt counts and
   main/Worker/fallback state. A requested 30 FPS camera setting or compositor
   frame counter is not proof of 30 independently analysed camera frames. Avoid
   interpreting an old completed FPS window as a whole-session average.
4. Exercise actual RT responses, finish and save the result. Check that valid
   trials are accepted and invalid trials have the correct reason. Active QC
   raised during instructions affecting a following block remains a separately
   characterized policy issue; this recheck did not change that behavior.
5. After the short checks, run one complete representative long protocol to
   assess sustained load, temperature, memory, input responsiveness and final
   saving. A 60-second replay or accelerated checkpoint test is not a 40-minute
   wall-time soak test. Background-tab behavior is a separate test condition.

The human need not repeat the automated suites. Browser automation and log
analysis can handle most of the remaining work, but live camera use needs
explicit consent and realistic posture/movements; measurements on another
problematic computer require that computer. Universal FPS acceptance remains
open until those checks and the Firefox limitation are resolved or explicitly
scoped out of the supported matrix.
