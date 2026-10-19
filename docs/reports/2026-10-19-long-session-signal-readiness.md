# Long-session Signal Readiness Audit

Local work on `feature/protocol-persistence-pdf`, 2026-10-18/19. Existing
working-tree changes and review data were preserved. No commit, push,
deployment, author-history rewrite or user-password change is part of this task.

## Scope And Evidence

The user confirmed that synchronized reference recordings are not available.
This is a technical audit, not a human-accuracy, clinical-validation or
production-certification report. No webcam video, microphone recording or raw
landmark upload was introduced. No external model/dependency was installed.

## Corrections

### Full-duration Heatmaps

- Raw gaze retention remains approximately 30000-32000 points. Previously,
  final maps were rebuilt only from that tail, losing early presentations.
  `gaze-history.mjs` now accumulates before retention. Counts, grids and pending
  fixation state survive JSON/IndexedDB checkpoints and reload.
- The batch and streaming paths share one implementation. Ongoing fixations
  survive checkpoint boundaries without splitting/double-counting. Duplicate
  or regressing timestamps do not inflate counts. Version/attempt/trial keys
  stay separate. Corrupt accumulator recovery blocks silent replacement of
  the stored run; it does not erase the checkpoint.
- Fixation grouping no longer repeatedly reduces a growing raw point group.
  Its online sufficient statistics bound memory for a prolonged fixation.
- Method `1.2.0` grids actually accumulate fixation duration x quality at the
  centroid, matching the normalization label. The previous grid accumulated
  sample durations despite that label. A single point after a gap cannot
  satisfy the 100 ms real-span criterion.
- Quality changes after validation/recalibration affect future contributions;
  past contributions are not retroactively rescaled. Corrected coordinates and
  actual media rectangles remain the inputs; no target/AOI snapping was added.
- Backend provenance retains the method version. New fixation grids and legacy
  sample-density grids cannot be silently averaged, even with equal media IDs.
- Standard registry media and authenticated uploaded media use the same
  accumulation path. Their actual display/revision/access behavior remains
  covered by the live multi-browser regression suite.

### Bounded Detail, Not False Completeness

- Canonical grids are 32x18. Local accumulation has bounds of 2000 presentation
  contexts and 200 blocks; arbitrary grid dimensions above 128 are rejected.
  Exceeding presentation capacity marks the report incomplete.
- The existing wire limit is 200 presentations. Each local presentation retains
  at most 500 fixation details. Wire details additionally share a 4000-point
  budget, distributed across presentations, retaining at least one point for
  each nonempty presentation. This does not reduce their full density grids or
  total fixation counts and does not mutate the local source arrays.
- `fixationsTruncated` makes AOI metrics return `no_data`, not statistics from
  a misleading prefix. Heatmap counts still use total fixation counts. RU/EN
  warnings explain incomplete details, including the overall presentation cap.
- A 200-context/500-details-each synthetic packet with dense 32x18 grids fits
  below 1750 KiB after detail budgeting and passes the real ingest validator.
  This is not a universal byte-size guarantee for arbitrary maximum-sized RT,
  audio, author text and other fields combined; the API's 2 MiB default limit
  is not raised or bypassed. Oversized final results still need the existing
  visible error/local-download recovery path.

### Fresh Physiology Versus Hold

- `continuous_signals.v2` distinguishes measured publications from held BPM.
  Held values may remain available to the display but do not enter fresh
  measurement means/counts or confirm an elevated fresh measurement.
- Respiration never falls back to `respRateRaw`. Low-confidence, explicitly
  held/unpublished and out-of-existing-band estimates remain missing. The
  existing 0.20 confidence and 6-24/min band are not relaxed.
- Resampling requires real history, finite increasing timestamps and limited
  gaps, instead of padding a short history into a complete analysis window.
  Camera-derived series and the separately sampled approximately 2 Hz BPM
  series have distinct cadence allowances.
- Integer-lag ACF could select a repeated period and halve an otherwise clear
  synthetic pulse frequency. Spectral-period consistency and parabolic ACF
  interpolation correct that failure. Flat/nonfinite signals yield no pulse
  estimate. This is an estimator revision, not proof of improved human accuracy.
- Fresh online counts/means/min/max are independent of the 7200-record
  diagnostic tail. Checkpoints retain cumulative summaries; resumed segments
  are weighted by valid publication counts, not by run count. Repeated snapshot
  calls do not add a segment twice. Duplicate frames and callbacks after
  collector finalization cannot create measurements.
- SessionReporter ranges explicitly refer to retained samples. Full-session
  fresh summaries and held/display ranges must not be confused.

### Other Channels

- Long eye-signal arrays could overflow the JS argument stack when expanded
  into min/max calls, preventing completion of an otherwise valid session.
  Iterative extrema remove that failure; 130000 synthetic eye samples are
  exercised. The scientific blink/PERCLOS thresholds are unchanged.
- Raw-derived gaze dynamics expose retained-window coverage when applicable;
  full cumulative heatmaps do not magically restore discarded raw trajectories.
- Body velocity P95 is labelled `retained_samples`; body means/counts continue
  using their existing full-session accumulator.
- Existing emotion/FACS baseline, missing-data abstention, blink/PERCLOS,
  movement, audio and multimodal checks remain in the full test matrix. FACS
  output is an expression proxy, not a direct measurement of internal mood.
  A short blink is not automatically a microsleep.

## Contracts And Privacy

No SQL migration or new top-level ingest field is required. `heatmapState` and
`continuousSignalState` are local checkpoint fields. Existing aggregate objects
carry method, coverage, totals and truncation metadata. API authentication,
CSRF, immutable publication/session bindings, idempotency and tenant checks
remain enabled. Local synthetic tests use a separate database/API and temporary
researcher accounts; they do not write to the user's review database.

## Verification

- Unit/API/contract/security: **408 passed**, 0 failed/skipped. This includes
  17 added long-session/signal tests; they are part of 408, not another 17.
- PostgreSQL: **37 passed**, 0 failed/skipped, serially on
  `protocol_fixes_test`. The review database was not used for these writes.
- Broad browser replay: **675 passed**, 0 failed/skipped/flaky, 225 cases per
  Chromium/Firefox/WebKit project, about 7.3 minutes. It includes live private/
  project media access, two researcher accounts, uploads/revisions, actual
  video display, standard AOIs, keyboard responses, photodiode, PDF, password
  changes, consent/finalization, offline/reload and lost-ack recovery.
- After the final cache refresh, **57 recovery/long-session/edge checks** and
  **6 BPM loading/recovery checks** passed again in the three engines. These
  overlap the broad 675, not additional unique scenarios.
- One hour at 30 Hz: **108000 synthetic gaze samples** retain both early/late
  contexts across ring-buffer trimming and checkpoint recovery. In the final
  unit run the two-context accumulator serialized to about **13 KiB**. This
  excludes raw signal arrays and does not describe every possible study size.
- **186 ideal/lightly perturbed pulse waveforms**: 48-168 BPM in steps of 4,
  20-second windows at 15/30/60 Hz; each within the test's 3 BPM tolerance.
  **12 respiration sinusoids**: 9/12/18/21 per minute, 60 seconds at 6/10/20 Hz;
  each within 1.5/min. These are synthetic computation tests, not human MAE.
- **130000 eye samples** complete attention/blink/PERCLOS calculations without
  argument-stack overflow. Missing/held values, duplicates, gaps, corruption,
  finalized collectors and changed calibration quality have negative tests.
- TypeScript no-emit, syntax/conflict-marker checks for **88 changed/new JS
  modules**, and `git diff --check` pass. Python RT smoke completes with two
  parsed trials.
- Final local cache revision: **`20261019-2`**. The review API/static host was
  restarted; `/ready` returns `ready`/`db=ok`, `/health` reports an available
  Python RT analyzer, and researcher/participant pages return HTTP 200. The
  isolated audit API and its temporary users/projects/uploads were cleaned up.

The initial broad run exposed one interim-respiration-summary integration
failure. The builder now passes the cumulative summary explicitly, and the
control broad run passes all 675 cases. Earlier targeted failures also exposed
the ACF alias and long-array min/max issues above; thresholds were not weakened
to hide them.

## Unclosed Release Gates

1. Independent reference recordings: gaze error/precision on held-out targets,
   contact ECG/PPG, respiratory belt and annotated eye closures. Compare the
   previous estimator and `continuous_signals.v2`, with predeclared acceptance
   criteria, missingness and uncertainty. Overlapping spectral publications
   are not independent physiological observations.
2. Real-time multi-hour camera runs on weak devices, with glasses/glare,
   movement, lighting, browser suspension, storage pressure and clock changes.
   The simulated hour tests accumulation/recovery, not one hour of real capture.
   Eye-signal history still grows; workers/chunking do not eliminate its memory
   cost. Large context snapshots and RT latency require device profiling.
3. Approval of explicit 200-presentation/500-detail/4000-wire-detail semantics.
   Studies needing all fixation-level AOI statistics beyond those limits need
   versioned event storage or online AOI aggregates, not threshold relaxation.
4. Human acceptance, CI, staging behind the real proxy, backup/restore and
   independent security/privacy review. Local tests do not replace a pentest,
   operational load test or a clinical evaluation.

The need for contact-reference and condition-stratified rPPG evaluation is
illustrated by [Evaluation of biases in remote photoplethysmography
methods](https://www.nature.com/articles/s41746-021-00462-z). Its published
performance is not a performance claim for wecog.

## Local Acceptance Checklist

1. Use a protocol with both a standard square and an uploaded image/video;
   verify the early and late maps, media proportions and pinned publication.
2. Reload between trials, complete camera check/calibration, then finish;
   previous accepted trials and maps should remain without duplicate points.
3. Disconnect the network, finish and reconnect. A failed upload remains
   recoverable, then acknowledges once. Keep the JSON until acceptance.
4. Inspect a deliberately long presentation: the full map remains visible,
   but shortened fixation details produce a warning and no invented AOI values.
5. Check a second researcher account in a separate browser profile: private
   media stays private; shared project media follows project membership.
6. Treat BPM/respiration as research estimates: warmup/poor signal may yield
   missing data; held display values must not add fresh observations.

## Rollout And Rollback

Keep API/static assets coordinated at the final cache revision below. No
automatic deployment or history edit is performed. Existing final session
records are not rewritten; discarded historical raw points cannot be recovered.
On rollback, keep a release archive and downloaded pending JSON. Older code
cannot guarantee interpretation of the new local accumulator/method metadata;
do not silently continue a partially measured run under another estimator.
