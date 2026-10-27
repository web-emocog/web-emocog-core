# Real Face Video: FPS and Signal Stability

Date: 2026-10-26. Branch: `feature/frame-pipeline-workers`, base
`89880ef5c0b98530e1d87fe6b13596e077d08f46`. Local only: no deployment, push,
production account/database, real camera/microphone or raw-data upload.

## Findings

1. **Reproduced and corrected locally: Mac segmentation Worker failure.**
   The pinned MediaPipe GPU mask readback checks `ontouchend in self.document`
   for a Mac user agent. A Worker has no document. This failed initialization
   or mask reading and selected the existing main-thread fallback. That
   fallback produced about 6 FPS and long UI stalls in this workload.
   `segmentationDelegate()` now selects CPU **inside the Worker** for this Mac
   case; main-thread Mac and non-Mac workers retain GPU. Backend/delegate are
   explicit in diagnostics. No fake DOM, vendor patch, new model, physiological
   formula or QC threshold change. CPU/GPU are not presumed bit-identical.
2. **Unresolved quality blocker: load-sensitive physiology output.** The same
   video gives about 72.8 BPM in the light configuration but 110-112 BPM in
   loaded realtime. Same-time fresh publications also disagree. At 0.5x,
   retaining original PTS, loaded output returns close to the light result.
   This supports a sampling/load-sensitivity hypothesis, not an exact proven
   root cause. Signal gates were not tuned to this recording.
3. **Eye proxies need cadence robustness review.** Light/offline passes give
   14 blinks and about 11.16% mean 60-second PERCLOS; loaded realtime gives
   12-13 blinks and 0% PERCLOS. No independent blink/closure annotation exists
   here. Neither result is ground truth or evidence of microsleep.
4. **Posture interpretation flag:** the directed shoulder-line angle has an
   absolute mean near 175 degrees here. This is not a 175-degree physical
   shoulder tilt. Axial-angle convention/historical compatibility need a
   separate review; this patch does not silently change that metric.

Structural tests passing does not resolve findings 2-4. A protocol requiring
stable 25 analysis FPS can still reject the loaded configuration, whose mean
is below 25. No claim of scientific accuracy or production readiness.

## Dataset and Integrity

Used the existing strict-decode first 60 seconds of `1020_FullHDwebcam_before`
from [MCD-rPPG](https://huggingface.co/datasets/kyegorov/mcd_rppg), revision
`bf59b3cd1414c2a510d83c3125f16bb87d469ebb`, CC BY 4.0.
Attribution: Egorov et al. (2025), *Gaze into the Heart*,
[doi:10.1145/3746027.3758255](https://doi.org/10.1145/3746027.3758255).
Hashes are checked before every replay. The derived clip is lossless in
decoded YUV420, without resizing, audio or rate override, not original raw RGB.
Raw recordings remain private, outside Git/web root/Observer/Docker images.

Two more small video/reference pairs, about 40 MB, were downloaded at the same
revision. SHA-256 matches upstream LFS. Network-disabled, read-only FFprobe
checks found these additional integrity/timing problems:

| Recording | Decoded / PPG samples | Capture timestamps | Decoder errors |
| --- | --- | --- | --- |
| 1020 IriunWebcam before | 4310 / 4310 | 4321 | Present |
| 1035 FullHDwebcam before | 5352 / 5352 | 5390 | Present |

As with earlier downloads, accuracy is `not_scored`. No trimming clocks,
fitting arbitrary offsets or treating clinical-table pulse/respiration as
time-synchronized truth. The author's loader reads PPG column one, not a
video clock from column two. No foreign code/model was executed or installed.

Other sources checked:

- [COHFACE](https://www.idiap.ch/en/dataset/cohface) includes face video, BVP
  and respiration. [Official access](https://zenodo.org/records/4081054)
  requires an EULA, non-commercial research and an institutional signatory.
  No request/agreement was submitted on the user's behalf.
- [MPSC-RR](https://huggingface.co/datasets/justchugh/MPSC-RR), revision
  `439dddb42f8a95cd4aba6465eb6be3bb3af8a8bf`, declares CC BY 4.0 and a belt,
  but its listed release/metadata contain no usable paired belt timeseries.
  Only small metadata files were downloaded. Many views omit the face.
- MPU-rPPG's public Figshare sample has conflicting CC-BY metadata versus
  research-only/redistribution wording. Not downloaded. Unlicensed/restricted
  clips were not substituted to invent accuracy scores.

## Workloads and Results

Host: macOS arm64; headless Chromium 143.0.7499.4. This is not Safari or a
physical-camera benchmark. Video: 640 x 480, approximately 29.9 FPS. No traces,
screenshots, recording permissions, personal profile or external browser traffic.
Loopback serving enforces Host/Origin/CSP and an asset allowlist; backend/.env
remain denied. Observer counts equal every fresh shared-module publication;
JSON round trips preserve aggregates.

`signals`: actual Face Landmarker Worker, eye/attention core,
ContinuousBpmCollector and Observer aggregation. `multimodal`: also production
`_scheduleAuxiliary` / `_processEmotion`, pose/segmentation/FACS, unchanged
strides 3/6/6 and bounded single-flight auxiliary work. Excludes personally
calibrated gaze, actual keyboard/photodiode RT and participant UI/persistence.

An initial harness waited for another presentation after inference and gave
15.68 FPS. It now uses single-flight latest frames with a 33 ms target, matching
runtime policy. That initial figure is not a product baseline. Current report
method is `wecog-public-video-functional-replay.v3`.

FPS below is per **wall-clock second**. Physiology values are estimates only.

| Workload | Repeats | Analysis FPS | Mean BPM | Respiration/min | Fresh BPM / respiration publications |
| --- | --- | --- | --- | --- | --- |
| Signals, default renderer, 1x | 3 | 29.871-29.872 | 72.8065 each | 10.0313 each | 68 / 25 each |
| Signals, SwiftShader, 1x | 1 | 28.4755 | 72.7031 | 9.9609 | 64 / 32 |
| Multimodal before workaround, 1x | 1 | 6.0231 | Missing | Missing | 0 / 0 |
| Multimodal after workaround, 1x | 2 | 24.4150 / 24.4395 | 112.2451 / 110.4404 | 8.7891 / 9.6454 | 12 / 20 and 10 / 26 |
| Signals, 0.5x | 1 | 14.9468 | 72.7598 | 10.1250 | 67 / 25 |
| Multimodal, 0.5x | 1 | 14.9469 | 72.7598 | 10.1250 | 67 / 25 |

At 0.5x, processed **media-time** rate is 29.8993 FPS, not 30 wall-clock FPS.
Both slow passes process all 1793 presented frames. Light realtime processes
1792/1793; loaded realtime processes 1465 and 1468. Face detection is present
on every analyzed frame, not proof of no occlusion or cross-person accuracy.

With the workaround, segmentation stays `worker`/`CPU` instead of `main`.
UI timer lateness p95 drops from 340.6 ms to 2 ms; main-thread long tasks drop
from 120 to 0. These timer probes are not hardware RT accuracy measurements.
Pose processes 243/244 samples, FACS stores 227. No independent FACS/posture
truth exists in this clip, and computed valence is not a mood diagnosis.

Same-time configuration agreement uses monotone one-to-one nearest fresh
publications within 500 ms, never held/duplicate samples:

| Compared to light 1x | Paired BPM publications | Mean absolute inter-configuration difference |
| --- | --- | --- |
| Loaded realtime repeat 1 | 8 | 42.8654 BPM |
| Loaded realtime repeat 2 | 5 | 43.7180 BPM |
| Loaded 0.5x | 67 | 0.07585 BPM |

Unmatched values remain explicit in the ignored, private
`test-results/reference-data/mcd-configuration-sensitivity.json`. These are
**agreement**, not sensor MAE. No acceptance cutoff is inferred from one clip.

## Regression Verification

- API/units: 502 passed, 0 failed; 5 platform/tool-dependent tests skipped,
  two PostgreSQL suites not enabled in this follow-up.
- Participant/Worker/security: 153 passed, Chromium/Firefox/WebKit. New Mac
  real-model test requires CPU segmentation inside Worker without a DOM shim.
- Extra Mac regression, Chromium default graphics: passed twice.
- TypeScript, edited-file syntax, release-audit and diff whitespace: passed.
- Repeated BIDMC numeric respiration check: 8/23 eligible windows, coverage
  34.8%, MAE 0.3996/min, RMSE 0.4384/min on published windows. Contact impedance
  input, **not webcam respiration accuracy**.

Initial multimodal harness failures were missing allowed QC/TFLite assets and
fallback globals unlike the page. Those harness issues were repaired separately
from the actual Mac production-module mask-readback defect above.

## Repeat and Next Gate

Node 22+, installed Playwright engines, private inputs described in
`docs/research/public-reference-datasets.md`. From repository root:

```sh
export WECOG_REFERENCE_ROOT=/absolute/private/mcd-rppg
export WECOG_OBSERVER_ROOT=/absolute/Wecog-Observer-Pilot
export WECOG_REFERENCE_RENDERER=default
export WECOG_REFERENCE_PLAYBACK_RATE=1
export WECOG_REFERENCE_WORKLOAD=multimodal
export WECOG_REFERENCE_RUN=1
npm --prefix apps/api run test:reference:video
```

Set `WECOG_REFERENCE_WORKLOAD=signals` for light load and
`WECOG_REFERENCE_PLAYBACK_RATE=.5` for the offline comparison with original PTS.
Private named reports distinguish browser/renderer/workload/rate/run. Never run
performance comparisons concurrently or grant untrusted PRs these face files.

Next: investigate sampling cadence/aliasing, POS normalization, interpolation
and ROI motion on explicit frame/PTS sequences. Consider separating lightweight
RGB/rPPG sampling from heavyweight inference, but do not claim it validated or
weaken QC to pass. Obtain authorized COHFACE access or synchronized local camera,
eye tracker, ECG/contact PPG, respiration belt and RT markers. Each channel needs
its own suitable truth; load sensitivity remains a release-quality blocker.
