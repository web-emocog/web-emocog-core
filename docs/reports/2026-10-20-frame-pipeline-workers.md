# Frame pipeline workers: technical verification

## Scope and baseline

Local branch `feature/frame-pipeline-workers` starts at fetched
`origin/develop` commit `89880ef` (2026-10-19). Existing local observer/Dota
development in other checkouts is not included. No production protocol,
participant data, API endpoint, database migration or quality threshold is
changed by this work. Nothing is deployed automatically.

## Implementation

- Face Landmarker, Image Segmenter and Pose Landmarker use the existing pinned,
  self-hosted MediaPipe models in same-origin classic Workers. Classic workers
  retain compatibility with the WASM loader's `importScripts` call.
- An empty warmup belongs to initialization (30 s deadline), not participant
  measurement. Per-frame requests have a 5 s deadline, one in-flight bitmap,
  request IDs, error/message-error handling and explicit termination.
- Unsupported or failed workers fall back to the existing main-thread path.
  Runtime failures produce an interrupted frame rather than presenting stale
  results as a new observation. Backend/fallback reasons remain diagnostic.
- WebKit's pinned SDK segmentation path accesses `self.document` during mask
  readback in a worker. The initialization warmup detects this; segmentation
  then uses the unchanged main-thread GPU backend. Face and pose workers remain
  enabled. No fake DOM shim or vendor patch is introduced. The automated test
  requires this fallback to actually initialize, process and release a frame.
- Canvas dimensions are assigned only on change. Face illumination and rPPG
  share the exact same ImageData via a transient WeakMap. rPPG formulas,
  publication gates and accumulation are not changed. The legacy inline face
  fallback retains its original standalone readback behavior.
- Core face/gaze/eyes processing does not await auxiliary segmentation/pose.
  A yielded, fair single-flight auxiliary scheduler retains the existing
  nominal strides: segmentation 3, body pose 6, emotion 6 primary frames.
  Slow tasks defer opportunities without accumulating old frames. Actual
  sample counts and durations are recorded; constant output rates are NOT
  guaranteed. No signal is silently disabled to achieve an FPS target.
- Eye/emotion/rPPG timestamps refer to capture. Body pose snapshots the original
  context and monotonic clock before dispatch. A primary result crossing a
  phase/trial boundary is discarded, counted, and the loop continues. Late
  body data attaches to its original multimodal sample, not the current one.
- Segmentation results older than 1000 ms on the monotonic capture clock are not reused as fresh occlusion
  evidence. Stop generations prevent late callbacks from mutating a stopped
  session. SDK masks and ImageBitmaps are closed, including on failure.
- `tech.framePipeline` contains bounded numeric counters, elapsed timings,
  strides, backend names and safe fallback codes (`frame_pipeline.v2`). It
  contains no frames, pixels, audio, landmarks, credentials or invitation URL.
- Frequent global body-skin console messages are debug-only; segmentation
  decisions and thresholds are unchanged. Participant module cache tags are
  updated consistently to `20261025-1` to avoid mixed state/runtime singletons.

## Tests

Run from the repository root (Node.js 22+):

```sh
cd apps/api
npm test
cd ../autotests
npm run typecheck
npx playwright test --config playwright.workers.config.ts
RUN_WORKER_REGRESSION=1 \
PAGE_URL=http://127.0.0.1:4188/apps/participant-web/mvp_with_precheck_1-updated.html \
npx playwright test --config playwright.workers.config.ts --project=chromium --project=firefox
```

The test server uses loopback port 4188 and the current checkout. No real
camera/microphone permission or production API is required. Real-model tests
use blank canvas frames. A separate controlled test substitutes a synthetic
35 ms detector to compare derived face/eyes/pose/blendshape values and UI timer
responsiveness across main/worker execution. It is not a webcam FPS benchmark.

Unit cases cover pixels excluded from JSON/checkpoints, canvas reuse/resize,
readback sharing, immutable landmarks, stale request IDs, single-flight,
  timeout/crash/messageerror, hung bitmap capture and its late completion, captured body labels
and clock, late output after stop, auxiliary fairness and bounded backlog,
phase boundaries, and cleanup after mask-analysis failure.

Two test-fixture issues were distinguished from product behavior: worker
dynamic-import interception differs in Firefox (the synthetic benchmark now
substitutes the model import in the real worker script), and the tiny generated
video fixture could contain no decodable frames in Chromium (a procedural,
checked-in 788-byte VP8 fixture replaces timing-dependent generation; dimensions
remain asserted and real video decoding/presentation is not mocked).

Verification on 2026-10-25: the isolated three-engine worker/security/FPS suite
passed 48 checks (two repetitions). The Chromium/Firefox session-runtime suite
passed 176 checks (two repetitions). The combined API/security suite on Node 24
passed 470 tests, including real Poppler and native nginx log-redaction probes;
the two PostgreSQL suites were not executed without a disposable database.
See `2026-10-25-security-performance.md` for the final scope and limitations.

## Measurement limitations

Moving inference off the UI thread does not make a CPU/GPU faster or guarantee
25 FPS. ImageBitmap capture, transfer/readback and GPU contention can be costly.
FACS/gaze/rPPG still require reference-device human validation. A lower processing
rate is not repaired by relabelling camera FPS or interpolating measurements.

Before production rollout, compare the same devices under the same lighting,
including glasses and movement: processed unique frames/s, p50/p95/p99 frame
latency, key-event latency, auxiliary sample rates/missingness, illumination
parity, gaze/EAR/blink continuity, rPPG publication rate, memory and long-session
recovery. Real camera benchmarking requires separate user permission.

## Rollout and rollback

Review and merge into `develop` first; production promotion remains manual.
Existing stored sessions are not reprocessed. A rollout keeps QC thresholds and
protocol snapshots intact. Unsupported browsers use the original backend. A
whole-change rollback should revert this change set with its cache tags, not
delete stored data or weaken QC. No new dependency, model, license or external
data recipient is introduced.

Reference: [MediaPipe Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).
