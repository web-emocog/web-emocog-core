# FPS Release Candidate

Date: 2026-10-27. Branch: `fix/fps-workers-and-quality-diagnostics`, based on
`develop` at `89880ef5c0b98530e1d87fe6b13596e077d08f46`.

## Scope

- Face, segmentation and pose processing in same-origin Workers, bounded pending
  work, deterministic cleanup and tested fallback behavior.
- One reusable frame pixel buffer for downstream processing; resize canvas only
  when dimensions change. Preserve capture times across slow inference.
- Independent analysis and camera-publication FPS with measurement provenance,
  window ages and explicit stale/no-data diagnostics; no counting display refresh
  as camera FPS. Keep scientific models, sampling strides and QC thresholds.
- Defer auxiliary inference without blocking the primary analysis loop. Drop
  stale cross-trial work rather than attributing it to a new stimulus.
- Consistent module cache versions for the asynchronous runtime and its callers.
- Gaze validation accepts independent captures instead of repeated polling of
  the same prediction, requires coverage of every benchmark target, and retains
  bounded metadata through typed ingest. Legacy payloads remain supported.
- More specific QC reasons, camera-stall reporting, missingness-aware attention,
  and related transient-buffer/checkpoint protections.
- Camera-free procedural fixtures, unit/browser regression and private reference
  replay diagnostics. Real biometric recordings are not committed.

This is a selected candidate, not the entire previous dirty checkout. It excludes
the observation plugin, Dota/game pilot, screen/audio monitoring, the broad staff
HTTP/UI audit, async server RT scheduling and document-conversion changes.
Those working files remain separate locally. No new scientific model, database
migration or protocol/invitation rewrite is included.

## Dependency Security

The original develop lockfile failed npm audit with three runtime advisories.
This candidate includes the previously checked dependency updates as a separate
commit: body-parser 1.20.9, ip-address 10.7.5, multer 2.5.0, and express-validator
7.3.2 with a consistent lockfile. No framework-major upgrade is included.

References: [body-parser advisory](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[ip-address advisory](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5), and
[multer advisory](https://github.com/advisories/GHSA-q7qp-rjg7-q26m).

## Verification

Fresh checks on this selected working tree, not borrowed totals from the larger
local audit:

- Node 24 API suite: 499 passed, zero failed.
- Disposable Linux/Node 22 API suite: 499 passed, zero failed.
- Disposable PostgreSQL integration: 38 passed, zero failed; migrations applied.
- Browser typecheck: passed.
- Frame/Worker/session regression: 147 passed across Chromium, Firefox and WebKit.
- FPS/quality diagnostic regression: 30 passed across those three engines.
- Complete default Chromium/Firefox browser suite: 544 passed, 64 skipped,
  zero failed. Skipped opt-in checks are not counted as passed.
- npm audit, runtime dependencies, moderate-or-higher gate: zero findings.

That is 721 successful browser executions across the three distinct suites,
not 721 unique scenarios. Syntax checks covered 81 changed/new JavaScript files;
relative imports resolved and `git diff --check` passed. A path/content review
of the selected files found no credentials, private recordings or unexpected
large binary files. This is a scoped review, not an independent security audit.
Tests, model runs and known limitations must not be conflated with scientific
validation.

### Fresh Selected-Candidate Performance

Sequential 60-second real-time replays on macOS arm64 / Apple M4 Pro, using the
same hash-checked MCD-derived 640 x 480 file, real models, unchanged strides,
bounded auxiliary scheduling and production delegate policy. No camera or
microphone use, concurrent test load, screenshots, tracing or external requests.
Repository Playwright is 1.57.0; Firefox 157 uses a separate verified temporary
Playwright 1.64.1 prefix without modifying the product dependencies.

| Engine | Analysis FPS | Primary frames | UI timer p95 | Errors | Performance gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Chromium 143, full browser / native Metal | 29.891 | 1793 | 1 ms | 0 | Pass |
| WebKit 26 | 29.600 | 1776 | 6 ms | 0 | Pass |
| Firefox 157 | 23.690 | 1422 | 5 ms | 0 | Fail |

Face was detected in every processed frame. All engines used Workers for face,
segmentation and pose, and aggregate JSON round-trip checks passed. Auxiliary
model sample rates differ from primary analysis FPS: segment/pose frames were
203/203, 591/296 and 473/237 respectively. Segment mean latencies were 233.8,
33.6 and 33.4 ms. This is not a claim that each model runs at 30 Hz.

Firefox's presentation-counter FPS was 29.887, but analysis remained below 25
with a sustained drop; the strict performance assertion failed and is retained.
Successful functional regression does not override that result. The replay
excludes personal gaze calibration, actual RT input, complete protocol UI and
persistence. UI timer p95 is not hardware-validated reaction-time accuracy.
Physiological accuracy remains `not_scored`.

Private aggregate evidence: `/private/tmp/wecog-fps-release-replay-20261027.I0as8b/`.
The private source video and replay outputs are excluded from Git/CI.

### Corrected Test Identity

An earlier fixture forced Chrome/Mac User-Agent in every engine. Firefox 144's
forced CPU control then exceeded the existing five-second frame deadline in
three of three probes; native Firefox GPU passed three of three. That failure
is retained as evidence, not an FPS fix. The candidate now uses a Mac User-Agent
matching each actual engine, checks the expected delegate (Chromium CPU,
Firefox/WebKit GPU), and still requires real masks, a Worker backend and no
fallback/error. No timeout was increased, assertion removed or test retried to
hide failure. Forced cross-engine CPU compatibility is not claimed resolved.

### Required CI Coverage

The isolated three-engine Worker and FPS suites run in a separate required job.
They are excluded from the default two-engine suite only to avoid running them
with a different server/configuration. The aggregate release gate explicitly
checks this job's success as well as API, PostgreSQL and general browser jobs.
No benchmark faces or live-camera permission are required in CI. Hardware FPS
acceptance is distinct from these functional regression jobs.

The first Linux run passed 132 Worker/session checks but failed 15 GL/model
checks: Firefox and WebKit had no window WebGL2 context (`gl` was null), and real
models could not initialize. This differs from the successful local macOS run.
It is retained as failed CI evidence, not counted as a pass. The job now installs
Mesa software drivers and runs the model tests headed under Xvfb, with an explicit
window/OffscreenCanvas Worker WebGL2 preflight for every engine. Missing graphics
support fails the job before the long model run. Playwright's GitHub reporter
also exposes failures as annotations. Assertions, models, per-frame deadlines,
scientific thresholds and product launch/delegate policy are unchanged.
The loopback preflight passed locally for all three engines, and the unchanged
GL/mask tests passed another 12 executions (two repetitions per engine).
The first Linux workflow's general Chromium/Firefox job, API, PostgreSQL,
CodeQL and container builds all completed successfully; only the new GL/model
job failed. Its rerun remains a separate verification, not a retroactive pass.

References: [Playwright CI / headed execution](https://playwright.dev/docs/ci)
and [Mesa software rendering variables](https://docs.mesa3d.org/envvars.html).
This software CI configuration must not be used as a hardware performance claim.

## Remaining Acceptance And Rollback

Universal FPS acceptance and issue 132 remain open. Earlier 60-second M4 Pro
replay measurements approached 30 analysis FPS in Chromium/WebKit but only
approximately 23 FPS in Firefox; a no-model Firefox file control also reproduced
the callback-delivery limit. This is not proof about a physical camera or a
browser-independent sensor ceiling. Installed Safari and Chrome are not
identical to automated WebKit and Chromium distributions.

Before a general production release, test this candidate on the computer that
showed the original slowdown: the same short protocol in installed Safari and
Chrome, then a representative full long session. Retain separate camera and
analysis FPS windows, versions, effects/lighting/power conditions, QC reasons,
trial counts and final-save result. Do not lower QC thresholds to force a pass.
Replay does not validate calibrated gaze accuracy, physiology accuracy, actual
hardware RT latency, thermal stability or a full 40-minute participant workflow.

Active instruction-phase QC carrying into a subsequent block is characterized,
not silently changed here. Background-tab capture policy remains distinct from
visible-tab performance.

Deployment is not part of creating this PR. No merge into develop/main, production
restart or data changes are authorized by this candidate. Rollback can revert
the PR; no database migration rollback or invitation republication is needed.
