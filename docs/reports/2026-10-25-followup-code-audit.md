# Follow-up Local Code Audit

Date: 2026-10-25. Checkout: `.worktrees/large-protocol-hotfix`, branch
`feature/frame-pipeline-workers`; base `89880ef5c0b98530e1d87fe6b13596e077d08f46`.
This report supplements, rather than replaces, the earlier Docker/security
audit. Previous uncommitted changes were preserved. No push, deployment,
production-account action or real camera/microphone recording was performed.

## Scope

Reviewed the active participant pipeline and its fallbacks, local checkpoints,
auth validation, stimulus parsing/preview cleanup, and their callers. Re-ran
tenant/role, publication-version, ingest, stimulus and analytics regressions.
Static parsing covered 344 first-party JavaScript files and 18 Python files;
shell scripts in deploy/scripts/docker were syntax-checked. Vendored libraries
and models were not reimplemented or represented as independently audited.
This is a broad risk-based audit, not a proof that every execution path is safe.

## Findings and Fixes

| Area | Reproduced defect | Fix and regression evidence |
| --- | --- | --- |
| Auth privacy | Validation errors could echo rejected passwords or other entered values. | All auth validation errors retain path/type/message, not input values. Real HTTP login/register negative tests cover long/nested synthetic passwords. |
| Native media tools | FFmpeg/ffprobe did not share the document converter's environment/resource protection; metadata output handling was inconsistent. | Shared `native-process.js`: small environment allowlist, bounded stdout and stderr in bytes, whole POSIX process-group termination, Linux resource limits and generic safe errors. Actual image/video/audio decoding was exercised. |
| Native tool startup | A missing command behind the Linux wrapper could leak an internal pathname via its traceback and become a generic decode failure. | Wrapper exits 127 without traceback; callers return unavailable without exposing the command path. |
| Preview persistence | A newly generated JPEG survived an immediately failed DB update, or an update to an already deleted version. | Delete only that new preview on failed/empty UPDATE; leave pre-existing historical files alone. |
| Checkpoints | Sanitizing an own JSON key named `__proto__` could silently discard it or invoke prototype setter semantics. | Preserve it with a data-property definition and recursive sanitization. Unit round trips and actual browser IndexedDB round trips verify preservation without prototype mutation. |
| Worker lifecycle | Late initialization/result/errors after reset or stop/start could disable a new worker, attach a closed model or write an old pose result into the new run. | Generation checks before model attachment/result/state changes, disposal of stale resources and initialization-promise identity checks. Tests cover stale success, stale failure and fallback recovery. |
| Camera telemetry | A decoded-frame counter that advanced initially and then froze never selected the explicit media-time estimate fallback. | Detect stalled counters after progress, without inventing frames when media time is paused. Preserve the diagnostic estimate label. |
| Camera failure | No-frame acquisition failure could bypass frame-based QC because no new analyzed frame arrived. | Report `camera_frames_stalled` once after the existing 3-second hold; resolve only when frames return. No hidden trial pause and no relaxation of scientific thresholds. |
| rPPG timing | Delayed inference/live-video resize could pair captured landmarks with later pixel geometry or timestamp a measurement at processing completion. | Reuse captured pixel dimensions and capture wall time. A regression changes live-video size and advances processing time by 5 seconds, then verifies source alignment. |

No schema, migration, role policy, physiological formula or scientific QC
threshold was changed in this follow-up. Camera-stall detection adds a technical
issue under the existing attempt/repeat rules; it does not manufacture valid data.
Raw pixels remain transient local frame data, not checkpoint or ingest fields.

## Fresh Verification

All results below were obtained on this follow-up code, not copied from the
earlier report. Repeated runs are not counted as unique test cases.

| Verification | Result |
| --- | --- |
| Full host Node 24 API suite with actual Poppler and Nginx | 484 passed, 0 failed, 1 Linux-only test skipped; DB-dependent suites exercised separately below |
| Read-only Linux Node 22 API image with disposable PostgreSQL 16.10 | 39 passed, 0 failed, 0 skipped |
| Linux native-process, document, compressed-body, media and auth-negative tests | 19 passed, 0 failed, 0 skipped |
| Participant/session/worker/security Playwright, Chromium and Firefox, twice each | 196 passed, 0 failed |
| Worker/security Playwright, WebKit, twice | 26 passed, 0 failed |
| Analytics/AOI/authenticated heatmaps/constructor Playwright, twice | 14 passed, 0 failed |
| Production backup/snapshot Python regression tests, fixtures only | 52 passed, 0 failed |
| API and web exact-image smoke | Both passed; `/ready` refuses service without DB; 3-page PDF conversion and Linux limits pass |
| Real FFmpeg/ffprobe and LibreOffice under Linux limits | PNG and H.264 MP4 previews ready; WAV validated with no visual preview; 2-slide PPTX converted |
| Dependency advisories | API production dependencies: 0 known; autotest lockfile: 0 known |
| Static/tooling checks | 344 JS files parse; 18 Python files parse; shell syntax, TypeScript, RT Python smoke, release-audit and `git diff --check` pass |

Images: `wecog-api:audit-followup-20261025` and
`wecog-web:audit-followup-20261025`. Tests and fixtures are mounted read-only,
since they are deliberately excluded from production images. Runtime code
and dependencies come from the images. Synthetic decoder fixtures in the
Linux unit suite require an executable temporary directory. An initial run
with `noexec` correctly refused those fixture executables; it is not counted
as a passing run. Separate real-decoder/image smoke tests passed with `noexec`
temporary storage, a read-only root filesystem and no extra capabilities.
SHA-256 comparisons confirmed that the native-process/auth/media modules and
the changed participant runtime files in those images match the local sources.
The disposable PostgreSQL container/network were removed after verification.

Useful repeat commands, using disposable DB/localhost only:

```bash
cd apps/api
npm test
npm run test:postgres  # S2_TEST_DATABASE_URL must reference a disposable DB
npm run test:rt-python
node scripts/release-audit.js

cd ../autotests
npm run typecheck
RUN_WORKER_REGRESSION=1 npx playwright test --config playwright.workers.config.ts --repeat-each=2 --project=chromium --project=firefox
npx playwright test --config playwright.workers.config.ts --repeat-each=2 --project=webkit
EMOCOG_WEB_URL=http://127.0.0.1:4173/apps/web npx playwright test --config playwright.analytics.config.ts --repeat-each=2
```

`WECOG_NGINX_BIN` enables the real Nginx log-redaction tests;
`RUN_POPPLER_SMOKE=1` enables real Poppler checks. Native media tests require
FFmpeg/ffprobe. Linux resource-limit checks must also run inside Linux rather
than being inferred from macOS results.

## Remaining Boundaries

- No human-camera benchmark or reference-device validation was run. This audit
  does not establish 25 FPS, gaze accuracy, respiration/heart-rate accuracy or
  medical validity. Measure the instrumented pipeline on the affected laptop.
- Native parser resource/environment limits are not filesystem/network
  isolation from API data. Dedicated converter isolation remains advisable.
- Nginx access logs are redacted, but native error logs and historic log copies
  still need an operational retention/redaction review.
- Strict frontend CSP still requires removal of legacy inline code. This audit
  is not an independent penetration test or an audit of all container OS CVEs.
- Preview cleanup covers immediate SQL errors, not every later rollback of an
  outer transaction. A transaction-aware file ledger or orphan reconciliation
  remains needed for complete garbage collection.
- Production PostgreSQL major version and an actual restore drill were not
  checked. The Bookworm API image's default client is PostgreSQL 15; backup
  tools must match or be newer than the server before a PostgreSQL upgrade.
  Disposable integration tests are not evidence of production backup recovery.
- Changes remain local. Remote CI/CodeQL, production migrations/configuration
  and real-user acceptance must be verified before release.

## Rollout and Rollback

Publish only after review and green PR gates, first to `develop`. No new data
migration is required. Keep the existing image/commit as rollback target and
preserve database/uploads backups. If worker compatibility degrades on a real
device, inspect the recorded fallback reason and primary/auxiliary timings;
do not lower QC thresholds or silently convert estimates into measurements.
