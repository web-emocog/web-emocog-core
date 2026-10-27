# Cross-Browser FPS Audit

Historical pre-fix measurements. The later
[backlog/readback follow-up](2026-10-26-backlog-audit.md) changes the local
segmentation delegate policy and removes the Firefox mask bottleneck, but does
not close the universal 25 FPS requirement. Results below remain unchanged.

Further [renderer/validation follow-up](2026-10-26-gpu-and-validation-followup.md)
identifies this Chromium headless-shell baseline as SwiftShader, not measured
Metal. Full Chromium/Metal passes three later repeats; Firefox remains open.

Date: 2026-10-26. Local branch: `feature/frame-pipeline-workers`.
Base: `89880ef5c0b98530e1d87fe6b13596e077d08f46`, with existing local changes.
No push, deployment, camera/microphone permission, account or production data.

## Verdict

**The universal FPS problem is not closed.** A functioning Worker and passing
functional tests do not imply that the analysis sustains 25 FPS. The previous
Mac CPU segmentation policy remains in place. No scientific/QC threshold,
resolution, model or production delegate policy was changed in this audit.

## Method

Sequential, non-concurrent 60-second MCD video replays on this macOS arm64 host.
The existing private, hash-locked 640 x 480 clip is about 29.9 FPS. All browser
traffic is loopback-only; source/data path confinement checks run every time.
Fresh browser contexts use installed Playwright Chromium 143.0.7499.4,
Firefox 144.0.2 and WebKit 26.0. These are headless test engines, not evidence
about every installed/current Chrome, Firefox or Safari release. The requested
default renderer is not a measurement proving hardware GPU acceleration.

The loaded workload runs the real face Worker, eye processing, rPPG, Observer
aggregation and production auxiliary pose/segmentation/FACS scheduling, with
unchanged strides 3/6/6 and bounded auxiliary work. It excludes personally
calibrated gaze, full protocol UI/checkpointing, simultaneous stimulus video,
physical camera drivers and actual keyboard/photodiode RT.

The replay still cannot establish physiological accuracy: MCD alignment remains
`not_scored`. Configuration agreement and FPS are not reference-device accuracy.

## Final Repeats

These runs use the restored production processing path, not the rejected
callback/transport/CPU-face experiments. Source presentation was about 29.88 FPS
in every engine. The engineering assessment below is recomputed from preserved
v4 measurements with the explicit segmentation freshness criterion as well.

| Engine | Analysis FPS | UI timer p95 | Mean segmentation latency | Assessment |
| --- | ---: | ---: | ---: | --- |
| Chromium 143.0.7499.4 | 24.58 | 2 ms | 156 ms | Fail: mean below 25 |
| Firefox 144.0.2 | 22.54 | 8 ms | 4307 ms | Fail: FPS and stale segmentation |
| WebKit 26.0 | 29.88 | 6 ms | 153 ms | Pass for this workload/host |

The final Firefox repeat stayed in Worker/CPU, so absence of fallback cannot be
used to close its issue. Earlier original-path passes also showed a timeout and
main-thread fallback. Initial light runs measured 22.97/23.75/29.44 FPS in
Chromium/Firefox/WebKit respectively. Such variation versus earlier-day runs is
another reason not to promise a portable fixed rate from one measurement.

Final private inputs/outputs are under `test-results/reference-data/`:
`mcd-replay-<engine>-default-multimodal-1x-run3.json` and
`crossbrowser-final-summary.json`. Summary generation does not modify raw run
records or reinterpret missing scientific references as ground truth.

## Findings

1. **Analysis can miss the target while video delivery is normal.** Input
   presentation remains about 29.9 FPS, but loaded analysis is slower in
   Chromium and Firefox. Camera FPS alone is not a full-session capability test.
2. **Intermittent Firefox segmentation Worker timeout.** Earlier runs hit the
   existing 5000 ms frame deadline and selected `worker_runtime_failed` /
   main-thread segmentation. UI timer delays reached about 0.6 seconds. The
   final repeat did not fall back, but still missed 25 FPS. A blank-image Worker
   smoke test is insufficient to rule this out with a real face and all models.
   Even in that successful Worker repeat, segmentation averaged 4307 ms: above
   the existing session mask freshness budget of 1000 ms. Successful replies
   alone do not establish that the QC channel has timely masks.
3. **Most measured primary latency is inside face analysis, not bitmap capture.**
   Profiling showed sub-millisecond mean bitmap capture, with much longer face
   round trips. `frame.analysisTime` includes canvas drawing/readback, inference
   and derived analysis; these measurements do not isolate pure model inference.
   Auxiliary CPU/GPU competition remains a hypothesis requiring finer profiling.
4. **Calibration/tracking still have media-time deduplication paths.**
   `web-page/tests-updated.js:getVideoTime()` and its validation/tracking loops
   use `video.currentTime`, unlike the session pipeline's frame observer. A media
   clock is not proof of a new decoded frame. Repeated analysis is a code-review
   risk to test on real MediaStreams, not a measured cause of this replay result.
5. **Precheck intentionally has a different schedule.**
   `precheck-updated.js:runLocalPrecheckAnalysis()` awaits face and segmentation
   serially, then its loop waits `FRAME_INTERVAL_MS`. Its visible update rate
   should not be confused with camera or experiment analysis FPS.

## Experiments Rejected

- Processing borrowed masks in a synchronous MediaPipe callback did not resolve
  the Firefox timeout. A Chromium regression detected a difference in complete
  mask-analysis output versus the existing owned-mask path, although the tested
  QC decision matched. The optimization was reverted, not accepted by weakening
  the assertion or an occlusion/confidence threshold.
- Sending shared ImageData directly instead of creating a bitmap did not remove
  the timeout in the paired Firefox test. This transport change was reverted.
- Forcing the face model to CPU in a local Firefox-only experiment produced about
  3.49 analysis FPS and did not remove the segmentation fallback. It was not
  adopted as a production policy. The harness retains an explicit experimental
  `WECOG_REFERENCE_FACE_DELEGATE=CPU` switch with separate output filenames.

The tracked production FaceSegmenter diff was checked against the turn-start
snapshot and is identical after these rollbacks. Existing unrelated/local work
was preserved.

## Final Verification

- API/unit suite: 509 tests, 504 passed, 0 failed, 5 platform/tool-dependent
  tests skipped. Two PostgreSQL integration suites were not enabled here.
- Worker/session/security browser suite: 156 passed across all three engines,
  including the restored-path same-frame mask/QC comparison. Chromium used the
  existing SwiftShader regression configuration; video benchmarks used the
  separately labelled default renderer.
- Dedicated FPS/QC browser suite: 24 passed, two repetitions per engine, with
  synthetic 10/30 FPS input and independent camera/analysis windows.
- TypeScript, replay syntax and diff whitespace checks passed.
- The earlier callback experiment had 47 browser passes and one failure; it is
  recorded as rejected, not counted as a passing final regression.

These passing functional/regression suites do not override the two failed
real-video performance assessments above. No raw recording entered Git or a
public report. The only retained implementation changes from this turn are
benchmark instrumentation, acceptance checks, regression tests and documentation.

## Added Regression Evidence

- `scripts/reference-data/performance.mjs` records complete one-second windows,
  including empty windows, and explicitly retains the unscored partial tail.
- Replay v4 separates bitmap capture, Worker round trip, face analyzer time,
  signal work, UI timer lateness, capture gaps and auxiliary fallback reasons.
- A performance assessment is separate from functional assertions. Diagnostic
  criteria are: mean analysis >=25 FPS, no >=3-second run of whole seconds below
  25, UI timer p95 <=10 ms, capture gaps <=250 ms and Worker backends. These are
  explicit engineering criteria for this benchmark, not changed protocol QC.
  A loaded pass also requires mean segmentation latency <=1000 ms, matching
  the existing runtime freshness cap; this does not prove every mask was fresh.
- Slow/offline playback is `not_applicable` for real-time acceptance. Missing
  timing evidence is `not_measured`, never a pass. A legacy v3 report cannot
  acquire a passing window assessment from an average alone.
- Long Tasks is not supported in every engine. An unsupported API with count 0
  is not proof that the main thread never stalled; timer probes remain separate.
- A real-model browser regression compares same-frame owned mask/QC output
  after MediaPipe masks are released, in all three engines.

## Repeat

Use Node 22+, installed Playwright engines and the private dataset paths from
`docs/research/public-reference-datasets.md`. From the repository root:

```sh
export WECOG_REFERENCE_ROOT=/absolute/private/mcd-rppg
export WECOG_OBSERVER_ROOT=/absolute/Wecog-Observer-Pilot
export WECOG_REFERENCE_RENDERER=default
export WECOG_REFERENCE_PLAYBACK_RATE=1
export WECOG_REFERENCE_WORKLOAD=multimodal
export WECOG_REFERENCE_RUN=3
for browser in chromium firefox webkit; do
  WECOG_REFERENCE_BROWSER="$browser" npm --prefix apps/api run test:reference:video
done
```

Inspect `performanceAssessment` as well as the command's functional result.
Set `WECOG_REFERENCE_REQUIRE_PERFORMANCE=1` to make a failed/not-measured
performance assessment exit nonzero, after preserving the report. The default
functional replay remains usable when diagnosing a deliberately slow workload.
The private named JSON reports are ignored by Git. Never run these performance
comparisons concurrently or expose face files to untrusted CI jobs/PRs.

## Remaining Acceptance Work

- Reproduce/isolate the Firefox Worker stall with real pixels and landmarks;
  distinguish preprocessing, inference, mask readback and result delivery.
- Profile contention before changing channel frequencies or choosing delegates.
  Faster GPU/CPU paths need output-equivalence and signal-quality checks.
- Test decoded-frame identity during calibration, validation and legacy tracking.
- Measure a fully warmed pipeline, not only camera capture, before admission to
  a protocol requiring 25 analysis FPS. Do not silently lower that requirement.
- Repeat on installed browsers with real camera consent, calibrated gaze, RT,
  stimulus video and checkpoint writes, then a long-session/memory/thermal test.
  Keep original timestamps and explicitly record dropped/stale/failed samples.

Primary API references:
[MediaPipe ImageSegmenter](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.imagesegmenter),
[OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas).
