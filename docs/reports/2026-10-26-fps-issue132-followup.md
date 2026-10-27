# FPS / QC Issue 132 Follow-up

Date: 2026-10-26. Checkout: `.worktrees/large-protocol-hotfix`, branch
`feature/frame-pipeline-workers`, base `89880ef5c0b98530e1d87fe6b13596e077d08f46`.
Existing uncommitted work was preserved. This follow-up is local only: no push,
issue comment/closure, deployment, production account, production database or
real camera/microphone recording.

## GitHub Status

[Issue 132](https://github.com/web-emocog/web-emocog-core/issues/132), our FPS/QC
diagnostic plan, is OPEN, last updated 2026-10-22, with no comments. Its body,
state and update timestamp are unchanged from the preceding audit. Related
issues 123 through 131 are also unchanged and have no comments. There are no
new real-device measurements or user reproductions in these issues.

An anonymous `/auth/me` 401 and a missing source map, described in issue 131,
do not by themselves prove that an invitation, admission or ingest failed.
Do not bypass authentication or disable QC on that basis. Ingest 401 reports
require separate endpoint/lifecycle evidence.

## Reproduced Defects and Changes

1. A decoded video counter returning `NaN` after startup never entered the
   existing estimated-media-time fallback. The frame pipeline could stop seeing
   new frames despite advancing playback. The fallback now recognizes a
   non-finite counter after the existing one-second deadline and only while the
   media clock advances. It remains explicitly labeled `media-time-estimate`.
2. A counter initially unavailable and subsequently becoming finite could emit
   `NaN` frame deltas. Its first usable value now establishes a finite baseline.
3. Analytics numeric normalization converted `null`, empty strings, booleans
   and arrays into zero/one. These are now missing values; finite numbers and
   nonempty numeric database strings remain accepted. Real measured zero is
   preserved. The regression failed before the correction and passed after it.
4. Protocol QC reported only a generic failure. A new message names the rule,
   measured value, required minimum and units. The issue event and repeat queue
   retain the rule/metric/value/threshold/method and available FPS evidence.
   Recovery removes the active issue, not the historical failed attempt.

No acceptance threshold, physiological formula, `hardStop` meaning, retry unit,
authentication policy, migration or protocol definition was changed.

## Explicit FPS Provenance

`qcSummary.fpsDiagnostics`, also available in live QC metrics, is an additive
`fps_diagnostics.v1` object. Camera and analysis channels have independent:

- `status`: `no_data`, `measured` or `stale`;
- `fps`: null when absent/stale, including a distinct actual measured zero;
- `lastWindowFps`, method, frame count and window duration;
- start/end offsets relative to monitor start and measurement age.

`scope` is `last_completed_window`, not a session average. After 2500 ms without
an update a window is stale, using the existing camera freshness interval.
Stopping freezes the evidence and its age; restarting clears both channels.
External numeric-only publishers are labeled `external-publication` and do not
invent a frame count/window length. The session pipeline passes actual camera
window counts and method. No pixels, landmarks, media or identifiers are added.

Legacy numeric getters/fields and QC evaluation remain compatible. They are
not silently redefined as session-wide rates. Old stored sessions are not
backfilled or recomputed; the researcher technical card still needs a separate
versioned full-session/block FPS presentation before issue 132 can be closed.
Warmup/phase-specific QC semantics are also not changed by this diagnostic patch.

## Fresh Verification

These are new executions on this follow-up, not results copied from earlier
reports. Repeat counts are executions, not additional unique cases.

| Check | Result |
| --- | --- |
| Full host Node 24 API suite | 499 passed, 0 failed; 5 platform/tool-dependent tests skipped; 2 PostgreSQL suites not enabled |
| Focused new/existing FPS and resilience tests | 19 passed before the final additional analytics regression |
| Dedicated FPS/QC Playwright | 4 cases x 3 engines x 3 repeats = 36 passed |
| Participant/session/Worker/security Playwright | 50 cases x 3 engines = 150 passed |
| Analytics/AOI/export/constructor browser checks | 7 cases x 2 repeats = 14 passed |
| Observer pilot unit regressions, unchanged pilot | 39 passed |
| TypeScript, release-audit, diff whitespace | Passed |

Browsers: Chromium, Firefox, headless WebKit. FPS tests use the existing tiny
procedural 10 FPS red video at playback rates 1 and 3; they test approximately
10/30 **presented** frames/s, not a real 30 FPS camera or model throughput.
The first 30 FPS test setup reset playback rate when loading `src`; this test
setup was corrected to set and assert the rate after loading. The final three
repeats all passed without retries or widened assertions. New FPS tests also
exercise no-data/stale/stop/restart, JSON round trips, QC debounce, recovery,
failed-attempt retention and `hardStop=false` without weakening QC.

No fresh PostgreSQL/native-tool Docker verification was run in this follow-up.
The earlier Docker report is historical evidence, not a substitute for these
explicitly unexecuted checks.

Reproduce from repository root with Node 22+ and installed test dependencies:

```sh
npm --prefix apps/api test
cd apps/autotests
npx playwright test --config=playwright.fps.config.ts --repeat-each=3
RUN_WORKER_REGRESSION=1 npx playwright test --config=playwright.workers.config.ts
npm run typecheck
```

The FPS config uses its own loopback server on port 4189, refuses server reuse
and blocks external browser requests. It needs no production invitation,
account, camera or microphone. The Worker config similarly uses port 4188.

## Still Required

- Repeated real Safari/Chrome measurements with the target Mac/camera,
  glasses/lighting conditions, active RT blocks and long observation.
- Separate startup/current/block/full-session statistics, phase-aware evidence
  and explicit labels in analytics; no claim that a final 1 FPS window is a
  whole-session average.
- User reproduction of the hand/occlusion and trial-rejection reports with
  exact reason codes and thresholds. No inference about hands from body skin
  alone, and no scientific accuracy claim from these synthetic tests.
- Fresh database/native Linux checks and deployment acceptance before release.

Issue 132 and related user reports remain open. Passing these checks does not
prove 25 FPS with a real face, laboratory signal accuracy or the absence of all
bugs.
