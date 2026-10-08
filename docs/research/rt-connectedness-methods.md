# RT connectedness: research use and limits

## Implemented analysis

The researcher Connectedness tab describes one snapshot-bound session. It joins
RT trial events with compact, event-locked signal aggregates. It is not a
diagnostic score, a causal model, or a replacement for lab hardware validation.

- Timeline: recorded stimulus, response and trial end; repetitions stay separate.
- Filters: block, condition, signal and analysis window.
- Windows: up to 1000 ms before stimulus, stimulus-to-response (or end for
  no-response trials), and up to 1000 ms after trial end. Windows are half-open
  and clipped at adjacent trial boundaries. The 1000 ms defaults are engineering
  settings, not universal physiological-response latencies or a preregistration.
- Signals: retained valid/on-screen corrected-gaze sample fraction; valid body
  movement velocity proxy; non-degraded expression valence/arousal proxy when
  available; published rolling BPM estimates at their publication time.
- No raw video, audio, landmarks, or individual camera samples are transmitted.
- Counts, valid fraction and maximum gap include edge gaps. No interpolation,
  last-value holding, upsampling, or imputation of missing channels is performed.
- Session means are never substituted for trial-window observations. Legacy
  payloads have event-only reports; historical results are not rewritten.
- Only valid, correct RT responses with a recorded channel enter the scatter
  pairs. Incorrect, incomplete, no-response and QC-rejected attempts remain in
  the table/export for audit. Accepted retries remain separate observations.
- Spearman rho is an optional descriptive statistic for one selected block and
  condition, using average ranks for ties. At least three varying pairs are
  mathematically required; this is not a power/sample-adequacy threshold.
  No p-value, confidence interval, significance star, or network is produced.

## Synchronization and missingness

New task events and samples use monotonic epoch timestamps. A report uses one
clock throughout; a sample with no matching clock is excluded. Legacy data may
use wall-clock timestamps and cannot establish hardware synchronization.
Camera, display and input-device delays are not silently compensated. BPM is a
rolling physiological estimate, not instantaneous cardiac reactivity to a
200 ms RT stimulus. Gaze valid fraction concerns retained samples, not elapsed
coverage or attention. Constant landmark-only emotion stubs are excluded.
Blinks/PERCLOS without compatible windowed samples are explicitly unavailable,
not inferred from session totals. Video replay is unavailable by design.

Reports retain at most the first 200 RT attempts and flag truncation. Original
cognitive results are not deleted. Existing collectors can discard samples in
long recordings; report gaps and counts must be reviewed before interpretation.
The timeline origin is the first recorded stimulus, including passive stimuli.

## Contract and access

Optional `rt_alignment.v1` extends `session_feature.v1` backward-compatibly.
The producer summarizes local arrays before event transport trimming. The API
validates the published bounded schema and count/window consistency. Analytics
reads use the same tenant checks, snapshot fingerprint and inclusion list as
session summaries. The browser rejects late snapshot responses after a filter
change. CSV/JSON exports carry snapshot/hash, clock, algorithm and window
parameters. CSV cells are protected against formula injection. A long-format
CSV is available directly from the module; generic JSON selection exports also
contain the per-session connectedness report. No migration/backfill is needed.

## Scientific acceptance still required

Group inference requires a prespecified hierarchical/mixed-effects or suitable
repeated-measures model, participant identifiers, condition/attempt effects,
temporal autocorrelation treatment, missingness/sensitivity analysis and a
multiple-comparison plan. Trial-level rows are not independent participants.
Do not interpret a descriptive rho as a population effect. Model validity,
real-camera accuracy and physiological construct validity have not been
established by software tests.

Before scientific deployment, validate event timing against a photodetector and
input reference, measure sensor latency, benchmark glasses/motion/light effects,
compare physiological proxies with annotated/reference measurements, and select
windows from the experimental hypothesis. The temporary photodiode feature
remains opt-in and `timingValidated: false`.

## Primary references and product comparison

- [Bakdash & Marusich (2017), Repeated Measures Correlation](https://doi.org/10.3389/fpsyg.2017.00456): repeated measurements violate ordinary independent-observation inference; informs exclusion of pooled-frame significance tests.
- [Tobii Pro Lab: Times of Interest and export](https://www.tobii.com/resource-center/webinars/introduction-to-tobii-pro-lab): informs event-defined windows and auditable export.
- [iMotions Lab](https://imotions.com/products/imotions-lab/): synchronized sensor timelines, transparent analysis and segmented exports; informs the descriptive multimodal workflow, not claims of equivalent accuracy.
- [Noldus The Observer](https://noldus.com/observer-human): synchronized behavioral observations and physiology; informs keeping task events separate from physiological signals.
- [PsychoPy timing limitations](https://psychopy.org/general/timing/millisecondPrecision.html): hardware delays and timing measurements must be distinguished from clock precision.

Sources reviewed 2026-10-08. No competitor code, model, dataset, or asset is copied.
