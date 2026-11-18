# Post-test analytics and recording follow-up

Base: develop after merged PR #175 (`6988d6f`). Follow-up branch:
`fix/post-test-analytics`. No changes to measurement/QC thresholds, calibration
prediction, authorization, published protocol binding, or production data.

## Implemented: issue #144 test findings

- Preserve cumulative QC counters and weighted analysis-FPS evidence over reloads
  and calibration segments; never add time while the page was closed.
- Preserve incomplete legacy QC as incomplete, not a successful fresh summary.
- Count recorded interrupted presentations separately, with and without gaze,
  without inventing cognitive results, responses or RT.
- Derive task observation duration from matching presentation endpoints, not the
  entire server session. Missing/ambiguous timing remains unknown.
- Exclude passive viewing from omissions, correctness and RT. Correct No-Go
  withholding is not an omission. UI, worker aggregates, comparisons and exports
  share the same response requirements.
- Include individual attempts in the level-1 detailed JSON/CSV export, with
  missingness, validity, identity and inclusion status. Bound attempt output;
  retain AOI filter boundaries and the researcher participant-table export.
- Use consistent feminine attempt labels in Russian.

## Verification

- API suite: 1,259 passed, 10 skipped, no failures (1,269 tests).
- Isolated PostgreSQL suite: 60 passed, 1 environment-gated skip, no failures.
- Browser analytics/security/passive suite: 99 passed across Chromium, Firefox
  and WebKit, with no camera/microphone access.
- Builder/security suite: 57 passed across the same three browsers.
- Attempt/physiology interval suite: 18 passed across the same three browsers,
  including durable full-QC snapshots and schema validation of final packets.
- Live browser/API/PostgreSQL persistence suite: 21 passed across the same three
  browsers, including publication binding, reload recovery and final delivery.
- Autotest TypeScript check passed. Public manifest staging passed: 292 files.
- Static release audit and RT Python smoke/unit checks passed.
- Both retained original #169 JSON packets and both rebuilt packets validate
  against the current closed schema with zero errors. Originals are private
  temporary inputs, not committed fixtures. This does not claim they were
  re-uploaded to their original production sessions.

The initial restricted local run could not start HTTP fixtures. An initial
database run also lacked media decoders/test request allowances. These runs are
not counted as successful verification. The successful database run uses the
existing project Linux runtime, current source/dependencies, isolated PostgreSQL,
and the same test-only request allowances as CI. Production protections are
unchanged.

## Open acceptance and scientific work

- #144: independent post-interruption gaze accuracy check/recalibration is not
  implemented here. Availability percentages cannot establish spatial recovery.
- #156: automated builder regressions pass; the four fixes from PR #175 still
  need a human re-test before final acceptance.
- #132 / #151 / #174: no claim that Windows analysis-FPS performance is fixed.
  Camera cadence and analysis cadence remain distinct. Test findings on the
  same Windows device differ by protocol; operating system alone is not a cause.
- #146: minute/block counts and coverage have regression coverage, but sparse HR
  estimates and respiration/brightness confounding remain scientific questions.
  No new sufficiency thresholds or physiological accuracy claims are introduced.

## Approved #177 policy, not yet activated

The user approved static passive trials only, opt-in per block and disabled by
default, at most +50% presentation extension, and accepted continuous segments
of at least 1 second. No video, audio or RT extension is allowed.

This requires a separate end-to-end implementation: published block setting and
preflight; monotonic accumulation and deadline/retry behavior; typed per-trial
target/valid/actual durations and excluded intervals/reasons; gaze/AOI filtering;
physiology continuity and coverage; analytics/export; and a 180-second target
test with a maximum 270-second presentation. A timer-only implementation is not
acceptable. Do not close #177 on this policy confirmation or this PR.

Issue closure follows repository policy: merged fix, green CI, and human
acceptance. Partial/scientific issues stay open with their remaining criteria.
