# Issue 132: CPU Workers And Memory Ownership

Date: 2026-11-03. Local `fix/issues-132-144`, based on develop
`f05645f5a469d919c8ad2a85b4b982ee10b5a9d1`, with the previously tested local fixes.
No push/deployment. No camera or microphone permissions were requested.

## Execution Map

| Work | Location | Scheduling / memory ownership |
| --- | --- | --- |
| Face, illumination, derived pose/eyes | Dedicated face Worker; explicit legacy fallback | One frame in flight, original capture timestamps; pixels transferred back, not copied into session JSON |
| Regional segmentation | Separate segment Worker | Mac Chromium CPU compatibility policy, otherwise GPU with bounded fallback |
| Body pose | Separate pose Worker | GPU/CPU fallback; shares one auxiliary admission slot with segmentation |
| DOM, keyboard, orchestration, calibrated gaze/QC | Main thread | Ordered state updates and DOM-dependent work; no synchronous wait on auxiliary inference |
| Continuous rPPG | Main thread | Reuses the captured pixels; optimized synchronous color projection, not another frame copy or model |
| Optional audio capture | AudioWorklet, or explicit ScriptProcessor fallback | Transfer PCM ownership; borrowed buffers still require a copy |
| Optional audio analysis | Dedicated audio-window Worker, with compatibility fallback | One analysis at a time; bounded pending PCM and terminating timeout |
| Backup statistics / heatmap aggregation | Module aggregate Worker | Cumulative snapshot preparation, outside RT; structured clone still has a main-thread cost |
| Durable storage | Browser IndexedDB machinery | Existing delta chunks and recovery semantics unchanged |

The real video replay instantiated **three actual vision Workers** with tasks
`face`, `segment`, `pose`, and observed at most **two outstanding frame jobs**.
All three were terminated and the outstanding-job count was zero after stop in
every run. Outstanding jobs are not a measurement of physical CPU-core affinity.
The auxiliary slot is deliberately bounded: increasing its queue/pool can compete
for the same GPU, retain old frames and change effective sampling latency.

RAM is not divided into execution threads. Ordinary Worker messages clone data;
transferring eligible buffers moves ownership and detaches the sender. See
[MDN transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects).
Browser/OS scheduling, not this application, assigns Worker execution to cores.

## Pinned WASM Inspection

Directly inspected the memory section and imports of both shipped WASM files:

| Asset | Initial memory pages | Shared memory | Imported memories |
| --- | ---: | --- | ---: |
| vision_wasm_internal.wasm | 292 | No | 0 |
| vision_wasm_nosimd_internal.wasm | 291 | No | 0 |

Each page is 64 KiB. These are roughly 18.2 MiB **initial linear-memory minima**,
not total model/browser/GPU RSS. The declared maximum of 32768 pages is a limit,
not proof of 2 GiB actually allocated. No thread-named imports were found.

The pinned build is not a shared-linear-memory pthread build. Adding an arbitrary
`numThreads` option does not turn it into one. Emscripten pthreads require a
compatible build, SharedArrayBuffer and cross-origin isolation; see
[Emscripten pthreads](https://emscripten.org/docs/porting/pthreads.html).
No vendor/WASM patches, new model builds or COOP/COEP changes were made.

## Implemented

### Reused POS / CHROM Workspace

`ColorProjectionWindow` computes the same channel means/normalization and both
projections using four per-engine Float64 scratch vectors. It removes the
filtered RGB point copies and 22 temporary arrays per eligible ROI window.
The existing standalone POS/CHROM functions remain the reference implementation.

Summation order, formulas, epsilons, time-boundary inclusion, the 30-sample gate,
source pixel sampling, confidence/publication gates and model cadences are
unchanged. Workspaces are not shared between engines/threads. Capacity grows to
the next power of two of the largest observed window, not session duration;
smaller subsequent windows do not read the unused tail.

Tests compare exact numeric values, not an approximate tolerance. Coverage:
random windows, nonfinite channels, reversed times, empty/short windows, time
boundaries, varying lengths, independent workspaces and a complete minute-long
engine run with jitter, black frames and a gap. Every emitted result and final
ROI history equals the original projection path in that engine comparison.

In all three browsers, 100 warmed projections previously made 2100 array-map
and 100 filter calls; the new path made zero of either and reused the same four
buffers. This is not a claim that the whole engine allocates no objects.

### Audio Ownership And Backpressure

- Reuse full Float32Array buffers already transferred from AudioWorklet, without
  immediately copying them again. Borrowed ScriptProcessor buffers, shared
  buffers and partial views still receive owned copies.
- Limit analysis retention to two PCM windows: one in flight and one pending,
  in addition to the current partial capture window. Overflow explicitly updates
  `droppedWindowCount` and records scoped `audio_window_dropped` metadata, not PCM.
- Catch per-window analysis errors, release the slot, and permit subsequent
  windows and teardown to finish. A failed diagnostic callback cannot prevent
  releasing buffers or stopping sensors.
- On Worker timeout, terminate the Worker itself, not just its pending promise.
  Stop the optional audio graph, release microphone tracks, and retain `failed`
  rather than reporting `completed`. Do not replay the stalled calculation on
  the UI thread or keep sending raw PCM into a blocked Worker. Other channels
  are not stopped by this optional-channel failure.

The first new backpressure/error tests failed before the fix. Extending the
timeout regression also reproduced that the previous implementation did not
terminate its Worker. Real buffer transfer/detachment is tested with a synthetic
MessageChannel, and timeout/sensor release with synthetic adapters. No real
microphone or recorded voice was used.

The complete reverse import closure for the library/audio changes was updated
to `20261103-2`, including developer pages, while unrelated singleton module
versions remain unchanged.

## Exploratory Video Measurement

Same hash-verified 60-second private MCD-derived clip as the earlier report:
`2b926fb33f32d5d99609870d4456a5c1e8525b8978ae4ef2869d9d524eb8dd40`.
Paired before/after runs isolate the old/new RppgEngine source, with all other
pipeline modules held the same. Pinned face/segment/pose, FACS, rPPG and QC run
normally; audio is not enabled. Models/pixels are not replaced by mocked results.

| Engine | Before mean FPS | After mean FPS | Before rPPG ms/frame | After rPPG ms/frame | After scratch storage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chromium full browser / Metal | 29.887 | 29.887 | 0.478 | 0.270 | 16 KiB |
| Firefox | 22.281 | 22.283 | 0.272 | 0.180 | 8 KiB |
| WebKit | 29.882 | 29.832 | 0.350 | 0.321 | 16 KiB |

Every run detected a face on all completed frames and reported no technical
issues. The table is exploratory: a few short targeted unit checks/source edits
occurred during these development replays, and there is only one pair per engine.
It is not a statistically controlled speedup claim or a per-window FPS gate.
Final functional regression is run separately. The isolated five-round browser
projection benchmark also improves, but is not full-session FPS or total RAM.

Overall FPS remains essentially unchanged. Less main-thread work and allocation
do not fix the previously measured Firefox inference/delivery bottleneck.
Personal gaze calibration, actual RT latency, installed Safari, live camera,
full protocol persistence and long thermal/RSS behavior are not measured by this
replay. Physiological accuracy is not established by these performance tests.

## Verification

- Final API unit suite: 639 passed, five environment-dependent test skips.
- Browser FPS/ownership/QC: 54 passed; Worker/runtime/security: 231 passed;
  staff: 282 passed and three existing cookie-fixture skips; creation/precheck:
  60 passed. All three browser engines, no retries. TypeScript and diff checks
  passed. Tested runtime/library/test hashes stayed unchanged during the final run.
- No thresholds, pixel resolution, model files, delegates or 3/6/6 strides changed.
- No additional Worker pool, SharedArrayBuffer or server configuration changes.

The five API skips are native PDF conversion (two), Linux media wrapper (one)
and real-nginx tests (two). PostgreSQL integration suites are not enabled by the
unit command; prior DB results are not presented as a fresh run here.

## Remaining Resource Work

1. MediaPipe backend/driver profiling and real-device admission remain necessary.
   Duplicating the stateful VIDEO-mode face model across a pool would multiply
   model memory, alter tracking sequences and risk reordered/stale samples.
2. rPPG now costs about 0.27 ms per frame in the Chromium replay. Another Worker
   must justify message/pixel ownership, synchronization and failure complexity
   against that small budget; moving it blindly does not solve 45 ms inference.
3. `CheckpointBuilder.postMessage` still clones retained derived sample arrays.
   A delta-based persistent aggregate Worker is a possible larger redesign;
   source arrays cannot simply be detached while UI/recovery still owns them.
4. Invitation downloads have a concurrency pool of three, but retained Blob URLs
   do not have an explicit total memory budget in the current preloader. This is
   a confirmed cache-policy gap, not proof it caused a particular low-FPS session.
   Large-media memory traces and a disk-backed/bounded cache design must preserve
   offline recovery, pinned versions and stimulus-ready timing before changing it.
   Preloading behavior was deliberately not changed in this follow-up.
5. Measure long-session total process/GPU memory on the problematic machine.
   JS scratch-byte counts and WASM memory limits are not total resident RAM.

Private artifacts and temporary replay harness:
`/private/tmp/wecog-issue132-thread-memory-20261103/`. No face frames or voice
recordings are saved in that directory or committed to Git.

Follow-up dated 04.11: bounded whole-media preparation and probe cleanup are
implemented and tested separately in
`2026-11-04-media-preload-memory-followup.md`. The total retained-Blob budget
remains a distinct, unimplemented cache-policy task; the earlier measurements
above are not retroactively relabeled as tests of that follow-up.
