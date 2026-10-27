# Local security and frame-pipeline hardening

Date: 2026-10-25. Base: fetched `origin/develop` at
`89880ef5c0b98530e1d87fe6b13596e077d08f46`.
Local checkout: `.worktrees/large-protocol-hotfix`, branch
`feature/frame-pipeline-workers`. No push, deployment, user DB mutation or real
camera/microphone recording was performed. Existing local work was backed up
before editing; Dota/observer code in other checkouts was not touched.

## Implemented

- Updated `body-parser` 1.20.8 -> 1.20.9, `multer` 2.4.0 -> 2.5.0,
  `ip-address` 10.7.1 -> 10.7.5. The later Docker/GitHub audit also updates
  `express-validator` 7.3.1 -> 7.3.2;
  Multer's declared minimum was raised. Production dependency audit returned
  zero known vulnerabilities; this is not proof of absence of vulnerabilities.
- Escaped imported trial duration/repetitions, folder IDs/names and preview
  labels/summaries before HTML interpolation. Saved numeric trial values must
  be positive safe integers. Real-editor browser regression uses a harmless
  injected event-handler marker and verifies a normal numeric edit/save.
- Native document tools inherit a small environment allowlist, not the API's
  signing keys/DB credentials. POSIX timeouts kill the whole process group.
  Limiter slots are released even if temporary-directory creation fails.
- Every PDF page is checked before rendering: 8192 px/edge, 16 MP/page,
  256 MP/document at configured DPI. Rendering is page-by-page with a total
  deadline and an output budget checked between pages. Linux uses a fail-closed
  Python `resource` wrapper (1 GiB address space, 256 MiB/file, no core dumps,
  128 descriptors and bounded CPU time). These are resource limits, NOT a
  separate filesystem/network sandbox. macOS only exercises the portable
  pixel/output/deadline safeguards.
- Added an exact-image release smoke for a synthetic three-page PDF and Linux
  resource limits. It must succeed before deployment side effects. Ordinary
  page dimensions/DPI are asserted so the security change cannot silently
  upscale/downscale the output.
- Both nginx access-log configurations omit query strings, Referer, cookies,
  Authorization, and invitation-code path segments, including mixed-case API
  paths. Timestamp/request ID/status/latency remain available. This does not
  retroactively erase logs or sanitize nginx's separately formatted error log.
- Kept the earlier worker optimization: single in-flight task, bounded fair
  auxiliary work, shared transient frame pixels, no redundant canvas resize,
  cleanup and verified main-thread fallbacks. No rPPG/gaze formulas or QC
  thresholds were weakened for a target FPS.
- Camera and analysis FPS now have independent counters/history. Camera
  updates cannot overwrite analysis throughput or baseline. Frame identity
  prefers video callbacks or decoded counters; media-clock-only fallback is
  explicitly labelled as an estimate. Live camera counts are published during
  all pipeline phases, not just the tracking-deviation screen. Stale camera
  observations are not returned as fresh ones by the active modular monitor.
- Capture timestamps are taken before inference; the worker path preserves
  supplied capture times. Delayed results crossing trial contexts are not
  attached to the next trial.
- Corrected forehead/chin landmark regions that previously included unrelated
  face areas. Synthetic masks verify that lower-face body-skin cannot become
  forehead occlusion, while real local occlusion still fails. This repairs a
  geometry bug, not the inherent ambiguity of segmentation class `body_skin`.

## Verification

- Node 24 full suite: **470 passed**, no failing tests, with
  `RUN_POPPLER_SMOKE=1` and `WECOG_NGINX_BIN` enabled. Two DB-dependent suites
  (`S2-01 PostgreSQL integration`, `Protocol persistence and project boundaries`)
  are explicitly skipped when no disposable DB is configured; Node's summary
  counts skipped suites differently from skipped tests.
- Chromium/Firefox full session-runtime + workers + new security/FPS checks:
  **176 passed**, two repetitions. Covers consent/admission, uploaded images
  and video, invalid-trial repeats, reload/checkpoints, terminal save and
  idempotent final ingest, locale and input behavior.
- Chromium/Firefox/WebKit worker/security/FPS suite: **48 passed**, two
  repetitions, including actual self-hosted models on blank images and a
  procedural 10 FPS video. These are not human accuracy measurements.
- `npm run typecheck`, `release-audit.js`, RT Python smoke and `git diff --check`
  passed. Nginx 1.29.0 was built from official source only under `/tmp`: both
  full configs passed `nginx -t` with local filesystem/certificate substitutions;
  actual HTTP requests verified log redaction. No system nginx was installed.
- Earlier failed runs were investigated rather than hidden: the new editor
  fixture lacked a required RT window; the worker regression configuration
  used a helper defaulting to the wrong local port; a source-regex test expected
  a timestamp expression inline instead of a pre-inference capture variable.
  Fixtures/configuration were corrected and behavioral assertions retained.

## Remaining Release Gates

- Docker and actual Linux production-image PDF/PPTX conversion and PostgreSQL
  security/persistence tests were subsequently verified. See the
  [Docker/GitHub follow-up](2026-10-25-docker-security-audit.md) for fresh counts,
  false-positive dismissals and remaining release boundaries. The initial
  native macOS test run alone did not establish these results. Backup/restore
  drills remain a separate release gate.
- Human references are still required for gaze/HR/respiration/blink accuracy,
  glasses/skin/lighting coverage and scientific QC false-rejection rates.
  Worker responsiveness on synthetic inference does not guarantee 25 FPS.
- Move untrusted document conversion to a dedicated restricted worker/container
  without API filesystem/network access; RLIMIT and environment filtering alone
  do not isolate a native parser exploit.
- Stage a restrictive static-app script CSP after removing legacy inline-script
  dependencies. Do not immediately enforce a policy that would break the current
  participant flow. Independently review remaining CodeQL findings and routes.
- Review error-log handling and retention: invitation credentials can still be
  present in old logs or native nginx error diagnostics. The patch specifically
  fixes access logs, not every log sink.
- Session-wide QC proportions still need a separately specified recent-window /
  block-window policy before changing scientific validity semantics. Geometry
  and FPS fixes must not be mistaken for approval of all current QC thresholds.

## Reference Recording

See [the acquisition and automated benchmark guide](../research/reference-video-benchmark.md)
for the equipment question list, synchronization, independent ground truth,
private storage and proposed replay/nightly implementation. Hardware-specific
adapters and private scientific CI are not implemented before receiving sample
exports and agreed acceptance criteria.

Primary advisory sources:
[body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[Multer](https://github.com/advisories/GHSA-q7qp-rjg7-q26m),
[ip-address](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5).
