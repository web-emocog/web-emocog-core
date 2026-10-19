# Interactive Connectedness And Passive Analytics

Date: 2026-10-19. Local working tree only; no commit, push or deployment.
This is technical verification, not human/clinical validation.

## Delivered

- Timeline event markers, scatter points and table buttons select the same RT
  trial. Selected states, keyboard Enter/Space, previous/next buttons, an explicit
  trial selector and 5 s / 30 s / whole-session zoom are supported.
- The detail panel shows gaze validity, body velocity, facial valence/arousal
  proxies, fresh BPM and respiration context before stimulus, until response
  and after the trial. Counts, missing values and maximum gaps remain visible.
- Nine passive metrics are available in session and group background-signal
  cards, snapshot JSON/long exports and the current-report PDF. Historical
  analytics plans need not be edited to request these new metrics.
- A shared registry (`apps/shared/passive-metrics.js`) defines the stable IDs,
  units and missing-data rules used by the API and browser configuration.
- Metric catalog version is 1.1. Event-window method version is 1.1.0, adding
  optional respiration to the existing `rt_alignment.v1` contract; old 1.0.0
  reports without respiration remain accepted and usable.

## Corrections Found During Verification

1. The timeline previously rendered static SVG without selection handlers.
   Events, points, rows, details and zoom now share selection state.
2. Physiology context in an interim backup did not include the live collector's
   current samples. They now reach the aggregate worker before finalization.
3. Adding that live series unconditionally would count it twice after finalize,
   when it was already in `bpmRuns`. Finalized collectors are not appended again;
   browser tests exercise the real worker before and after finalization.
4. An empty summary object previously implied channel QC passed. Channel data
   availability no longer substitutes for independent channel QC. Missing data
   and available-but-unvalidated summaries have distinct reasons.
5. Respiration event context is independent of pulse publication. Held,
   low-confidence and out-of-range respiration is excluded. A legacy sample
   count which was never recorded remains unknown, not a fabricated count of one.

## Scientific Boundaries

- Missing data is `null + status/reason`, not zero. Observed zero blink count,
  PERCLOS or expression values are preserved when the measurement is available.
- Whole-session means cannot answer block/condition/stimulus/AOI-filtered
  questions; they return `session_summary_not_interval` instead of borrowing
  the full-session result. No historical raw series is reconstructed.
- PERCLOS60 requires recorded eye-series duration of at least 60 seconds.
  That duration check alone is not proof of valid signal coverage. Incomplete
  recovered eye histories abstain. PERCLOS is not a microsleep diagnosis.
- Body P95 describes retained observations, with an explicit scope and count,
  not an unbounded whole-session percentile.
- Group analysis first averages sessions within each participant, then uses
  a participant-level distribution with equal participant weight. Frame counts
  and repeated sessions do not increase a participant's weight.
- BPM and respiration are overlapping rolling estimates. Short RT windows
  provide context only, not instantaneous physiological responses or independent
  observations. Their short-window correlation is disabled. No HRV, stress,
  clinical mood or causal physiological effect is inferred here.
- No raw camera video, audio or landmark series was added to ingest.
- The existing bounded event report still retains at most 200 trials and marks
  truncation. A full long-session event-series store is a separate extension.

## Sources And Design Rationale

- [iMotions official analysis documentation](https://imotions.com/products/imotions-lab/features/analysis/)
  describes synchronized multimodal review, interactive visualization and timeline
  zoom. This informs interaction design, not scientific validation of wecog.
- [A linear model for event-related respiration responses](https://discovery.ucl.ac.uk/1522233/1/1-s2.0-S0165027016301224-main.pdf)
  describes a signal model for event-related respiration. The engineering choice
  here is deliberately narrower: descriptive rolling-rate context, not a claim
  to implement or validate that event-related physiological model.

## Verification On This Working Tree

| Check | Result |
| --- | --- |
| Full API/unit suite | 416 passed, 0 failed |
| PostgreSQL/HTTP integration, serial, isolated DB | 38 passed, 0 failed |
| Broad browser suite | 696 passed: 232 each in Chromium, Firefox and WebKit |
| Final focused browser repeat after visual refinements | 33 passed: 11 each in the same engines; overlaps the broad run |
| TypeScript test-project check | Passed |
| Changed/untracked JavaScript syntax checks | 94 files passed |
| Changed core JSON contract parsing | 4 files passed |
| Whitespace check | `git diff --check` passed |

The browser suite covers publication/version isolation, built-in and uploaded
stimuli, image/video loading and heatmaps, participant recovery, network failure,
CSRF/account switching, private/shared media, RT keys, PDF/export and analytics
snapshot races. The new PostgreSQL test sends the canonical participant packet
through `/ingest`, reads snapshot metrics and export, and rejects outsider access.
Visual inspection used synthetic-only screenshots, including missing/zero
distinctions, native keyboard controls and long identifiers at mobile width.

During test development, the group browser fixture omitted `qcChannels` from
its synthetic query; the fixture was corrected and both subsequent browser
runs passed. This was not a change to production query validation.

Test writes used only `protocol_fixes_test` on the local PostgreSQL container.
The separate local review database, accounts and media were preserved. The
isolated audit server was stopped and its generated fixture data cleaned up.

## Local Review

The existing review app was restarted on API port 3000 and static port 4173.
Open `http://127.0.0.1:4173/apps/web/researcher.html` and refresh the page.
Choose the actual publication/session and apply the selection before reviewing:

1. Analytics / Session: Background signals, missing-data reasons and method.
2. Analytics / Connectedness: select a marker, point or row; try keyboard,
   previous/next, zoom and before/response/after context. Old reports may lack
   respiration or other windowed signals.
3. Analytics / Group: participant-level summaries and distributions.
4. Download the current-report PDF and snapshot export; check the applied
   selection and publication. No unavailable data should become a zero.

Real-camera estimator accuracy still requires synchronized reference recordings
and a prespecified scientific validation protocol. Synthetic and browser tests
cannot establish physiological or gaze accuracy on people.
