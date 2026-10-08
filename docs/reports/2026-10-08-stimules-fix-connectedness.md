# Stimulus fixes and RT connectedness verification

## Publication scope

Branch: `feature/stimules_fix`, based on the existing local fixes and merged with
`main` security updates. Preserves password, stimulus persistence/access,
participant/heatmap geometry, response-key, language, precheck, calibration and
temporary opt-in photodiode changes. No production deployment, preview database
reset, password reset or historical-session backfill is performed.

## Further corrections

- Staff tabs remain bound to their initial account. Account changes block
  requests, cache operations and interaction; explicit hiding and `aria-hidden`
  now prevent CSS layout rules from overriding the lock screen's hidden content.
- CSRF refresh retries only an explicit pre-route middleware rejection, once,
  after the same identity is confirmed. Other failures are not replayed.
- Builtin AOIs, manually edited/empty AOIs and block overrides remain distinct.
  Republishing creates a fresh immutable invitation, never reuses an old code.
- Removed duplicated obsolete stimulus functions introduced by merging repeated
  older fixes from main. The newer guarded implementation is retained.
- Snapshot creation now checks its request ID and original query fingerprint;
  late responses cannot apply an obsolete selection to any analytics tab.
- Updated existing `js-yaml` test dependency to patched 4.3.2. API dependencies
  include main's security updates; dependency installation reported no known
  vulnerabilities. License/source/integrity are documented.
- CI exposed Docker context exclusions of the required backup helper and
  contract schemas. Narrow `.dockerignore` exceptions restore those files while
  retaining environment/upload exclusions. The larger PostgreSQL suite also
  exceeded the default authentication quota; only that CI test step now uses
  `AUTH_RATE_LIMIT_PER_MINUTE=1000`. Runtime/production rate limits are unchanged.
- CodeQL findings were addressed without disabling security checks: persisted
  legacy titles/IDs/versions and step labels are HTML-escaped; the existing
  constant-time CSRF guard explicitly validates the verified request principal.
  The local live-suite helper no longer automatically posts credentials read
  from a fixture file: it requires matching explicit synthetic credentials and
  rejects production use and HTTP redirects. Regression tests cover these paths.
- Verified authentication precedes the explicit safe-method/bearer early return;
  all cookie mutations still require constant-time CSRF validation. The unused
  legacy event router now has its own limiter if loaded independently and remains
  unmounted by the canonical API.
- Unspecified block/condition filters no longer collide with "all" or legitimate
  placeholder-like names. The three-pair coefficient display threshold is labeled
  as an interface policy, not a mathematical minimum or sample-adequacy rule.
- Canonical and legacy API CSV exports now share a safe serializer: untrusted
  formula/control-prefixed strings are neutralized, including leading whitespace,
  while genuine negative numeric observations remain numeric. Direct serializer
  and route-wiring regressions cover both paths.

## Connectedness

The canonical tab reads real snapshot-bound session data, not demo coefficients.
It includes an RT event timeline, block/condition/window/channel filters,
trial-window scatter, missingness/QC audit table and CSV/JSON export.

Compact `rt_alignment.v1` reports are built before transport trimming. Windows
are half-open and clipped at neighboring trials; one clock is used throughout.
Task events explicitly record attempt numbers. Validation rejects oversized or
unknown fields, inconsistent sample counts and reversed trial/window times.
The published ingest, analytics response and TypeScript contracts stay aligned.

CSV protects untrusted strings from formula injection without converting
negative numeric observations into text. Exports carry snapshot/hash, window
parameters, algorithm/clock, missingness and truncation provenance.

Analysis is descriptive within one session. No pooled-frame significance test,
causal/clinical conclusion, group model or participant video replay is offered.
Rolling BPM, expression proxies and retained gaze-valid fractions are explicitly
labeled. Missing blinks/PERCLOS windows and legacy signal data are not imputed.
Reports retain at most 200 RT attempts and expose truncation without deleting
original cognitive results. See `docs/research/rt-connectedness-methods.md` for
primary scientific/product sources and required real-device acceptance.

## Verification

- API/unit/contract suite: 346 passed, zero failed or skipped.
- PostgreSQL integration: 23 passed, zero failed or skipped, only in the separate
  `emocog_recovery_tests` database. Tests include private files/versions, tenant
  boundaries, password/session revocation and denial of connectedness to a
  same-organization researcher without project membership.
- The full initial Chromium/Firefox run covered 416 executions: 350 passed,
  54 explicitly gated live/contract tests skipped and 12 failures. These exposed
  outdated CSRF/account-switch expectations; revised assertions additionally
  exposed the genuine CSS hiding bug, which was fixed rather than weakening
  access protection.
- Final targeted Chromium/Firefox recheck: 72 passed, zero failed. Covers
  connectedness, snapshot races, CSV/XSS, passwords, CSRF, delayed stimulus
  mutations and two-tab account/publication/AOI regressions.
- Final WebKit recheck: 102 passed, zero failed, including participant runtime,
  media, keyboard layouts, builder/design and the new account-lock assertions.
- The final missing-condition/method-label changes also pass all four
  Connectedness checks in Chromium, Firefox and WebKit.
- Additional live password checks pass at desktop/mobile widths in Chromium,
  Firefox and WebKit against synthetic accounts and the separate test database.
- Participant runtime, keyboard layouts, uploaded media/geometry, builder and
  design regression checks were also rerun across Chromium, Firefox and WebKit.
  GitHub release gates provide the complete final-commit browser run.
- TypeScript typecheck, JavaScript syntax, static release audit, Python RT smoke
  and `git diff --check` passed.
- Production API and web images build and their isolated container smoke tests
  pass, including protected static-path checks.
- The supplied older session JSON was read-only checked: event alignment builds
  and validates; no user result was imported or altered.
- Restarted loopback API reports ready/database OK. Researcher and new assets
  return 200; unauthenticated staff access returns 401 and private API
  configuration is inaccessible through the static server (404).

Higher rate limits were used only inside the disposable integration-test
process, not the running preview or production configuration. Browser tests use
synthetic data; they do not establish gaze, physiological or hardware timing
accuracy. No tests can certify absence of all bugs.

## Separate authorship PR

`feature/author-attribution` adds a narrow `.mailmap` and migration explanation.
New commits are sent as Dorila24. This normal PR does not rewrite historical
author/committer objects, SHAs or GitHub contribution counters. A real protected
history rewrite still requires a coordinated administrator operation; branch
protections were not changed.

## Manual retest

1. Reload the local researcher page. Use separate browser profiles for genuinely
   simultaneous accounts; a shared-cookie old tab must lock, not switch identity.
2. Upload personal stimuli under both accounts; only the creator may change
   visibility. Project-shared stimuli may be viewed by authorized project peers.
3. Verify builtin/custom AOIs, fresh publication and correct RT-only invitation.
4. Complete a new RT session using the configured keys in both keyboard layouts.
5. Apply that session's analytics selection, open Connectedness and review
   windows, counts, QC, missing channels and exports. Legacy event-only reports
   must not invent new signal values.
