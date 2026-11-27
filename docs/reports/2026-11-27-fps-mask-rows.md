# FPS follow-up: exact row-span mask processing

## Scope

Follow-up for #132 and #151, based on develop
`9ebf8f7c5a2eb648ed9cfe5885394adcacc4e982`. This is a small CPU-stage
optimization, not a Windows FPS resolution. No changes to published protocols,
camera constraints, models, delegates, input resolution, sample cadence, QC
thresholds, calibration, or the valid-time policy.

## Implementation

The existing face support already contains ordered, disjoint horizontal spans.
Whole-face and regional scans now intersect each row with those spans once,
instead of calling `Map.get` and checking span membership for every pixel.
They visit the same pixel centres in the same order, including truncated masks
and clipped contours. Landmark-point checks and the no-support rectangle
fallback remain unchanged. Integer counters, derived confidence/visibility,
method identifiers, and native mask ownership remain unchanged.

The public import closure uses `20261127-maskrows1`, including wrappers,
Worker/client, precheck, session consumers, and developer diagnostics. Most
changed files only update the query URL: otherwise a warm browser can keep a
parent importing the old processor. No new model, asset, dependency, schema,
migration, or API field is introduced. No raw participant data is read or
included in this change.

## Reproducible CPU Comparison

From the repository root:

```bash
WECOG_MASK_BASELINE=9ebf8f7c5a2eb648ed9cfe5885394adcacc4e982 \
  node scripts/benchmark-mask-rows.mjs
```

The script reads only the two first-party processors from that local commit.
It uses the existing synthetic face fixture at widths 79/160/256, three
rotations, two mirror orientations, and varied class bytes: 18 cases. After
36 warm-up pairs, it alternates old/new order for 360 measured pairs. Every
pair must pass exact deep equality for derived results; no numeric tolerance
is used. The baseline is explicit and restricted to a full local commit SHA.

Three consecutive runs on macOS arm64, Node v25.4.0:

| Run | Before mean / p95, ms | Candidate mean / p95, ms | Exact derived equality |
| --- | --- | --- | --- |
| 1 | 0.3619 / 0.7146 | 0.2429 / 0.4883 | yes, all pairs |
| 2 | 0.3642 / 0.7183 | 0.2531 / 0.5501 | yes, all pairs |
| 3 | 0.3687 / 0.7410 | 0.2475 / 0.5093 | yes, all pairs |

This saves about 0.11-0.12 ms in this synthetic CPU stage. It does **not** time
face inference, GPU readback, camera delivery, whole-pipeline FPS, or human
accuracy. It cannot explain or fix a face-model call taking tens of
milliseconds on the affected Windows device. Previous bottleneck evidence and
the separate headroom gate remain in
[the Windows headroom report](2026-11-23-windows-fps-headroom.md).
Mean <=25 ms, p95 <=30 ms, p99 <=33 ms with >=60 completed primary samples
remain engineering gates, not relaxed scientific QC.

## Verification

- The new row-lookup regression fails against the original loop (432 lookups
  for a small full-face mask), then passes after the change. Its independent
  polygon oracle checks exact pixel-read order at four widths, rotated and
  mirrored faces, clipped contours, and truncated buffers.
- `cd apps/api && npm test`: 1430 passed, 11 environment-gated skips, zero
  failures (1441 tests). Skips are not PostgreSQL/conversion acceptance.
- `cd apps/autotests && npm run typecheck`: passed.
- `npx playwright test -c playwright.fps.config.ts`: 90 passed across
  Chromium, Firefox, and WebKit, including bounded row lookups and module
  ownership with no sensor request at startup.
- `npx playwright test -c playwright.issue177.config.ts`: 39 passed across
  the same engines, including actual-runner 180-second target / 270-second
  ceiling, quality recovery, interruption, and capture-time gating. Controlled
  clocks are not a physical three-minute camera test.
- `npx playwright test -c playwright.workers.config.ts issue139-face-visibility.spec.ts`:
  18 passed, including face-local exclusions and classic-loader fallback.
- `npx playwright test -c playwright.workers.config.ts vision-workers.spec.ts`:
  60 passed, including pinned native models on synthetic frames, Worker and
  fallback ownership, callback failures, and shared-frame equivalence.
- `node apps/autotests/scripts/check-emotion-cache-upgrade.mjs 9ebf8f7c5a2eb648ed9cfe5885394adcacc4e982`:
  four scenarios passed. It warms old mask helpers as well as existing emotion
  dependencies, then checks that the participant uses the changed processors,
  even if a developer page has already fetched them into the shared HTTP cache.
- `node apps/api/scripts/release-audit.js`: passed. Public staging: 298
  allowlisted files, entrypoints and workspace exclusions passed.
- `git diff --check`: passed. No physical camera/microphone was used.

## Assigned-Issue Acceptance

As of 2026-11-27, the four assigned open issues are not safe to auto-close:

| Issue | Software evidence | Remaining acceptance |
| --- | --- | --- |
| #132 | FPS counters, scheduling/diagnostics and this exact mask optimization have automated coverage | Comparable repeated and long-run measurements on the affected devices; human review |
| #151 | Processing overhead reduced without changing QC; earlier targeted model/delegate changes remain | Same-device Windows Chrome/Edge/Yandex runs with the same published profile and modules, camera/analysis FPS and primary mean/p95/p99 |
| #177 | Runner, exclusions, +50% ceiling and recovery tests green | Researcher acceptance of a published static passive protocol after the publication fix is deployed |
| #186 | PR #191 has green required checks for legacy image publication; ingest and publication are separate cases | Merge/deploy by the owner, then verify editing/publishing the old static stimulus; keep failure diagnostics and the draft |

Do not close these based only on local tests or a green unrelated PR. Previously
closed issues remain unchanged. No GitHub branch cleanup, main merge, deployment,
research-session creation, or production data mutation is part of this change.

## Rollout And Rollback

Review and merge into develop using an ordinary merge, retaining authorship.
Run the Windows runtime smoke on the candidate branch; this is compatibility
coverage, not acceptance of an affected laptop's hardware FPS. After deployment,
repeat the same three-/five-minute Windows protocol, separately reporting source
cadence, completed analysis, stage timings, headroom, and QC. Do not infer the
cause from OS or camera make alone; driver/power/thermal explanations remain
hypotheses without a matched measurement.

Rollback by reverting this change with its cache closure as one unit. There is
no database migration or stored-result reinterpretation to undo. Do not change
stimuli, scientific thresholds, or sampling rates to make a performance test
pass.
