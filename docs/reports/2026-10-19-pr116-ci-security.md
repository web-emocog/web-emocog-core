# PR 116 CI And Worker Security

Date: 2026-10-19. This is an incremental verification of the existing
stimulus/session/analytics branch, not a new measurement-method version.

## Findings And Changes

- Release run `39184157591`, PostgreSQL job `117842931803`, failed before any
  database tests: the ECR image pull returned `toomanyrequests: Data limit
  exceeded` three times. The required release gate consequently failed.
- PostgreSQL startup now uses a bounded registry fallback. Google's Docker Hub
  cache and canonical Docker Hub both use PostgreSQL 16.10 Alpine at the same
  verified upstream digest. Neither a mutable image nor a skipped readiness
  check can pass the gate. The fixture binds only loopback, refuses to replace
  existing containers, and cleans up its own failed start. Normal job cleanup
  removes its successful fixture. Existing migrations, integration, HTTP,
  ingest-load, restore and required-release checks remain mandatory.
- New CodeQL alert 100 (`js/missing-origin-check`) concerns the checkpoint
  worker. Its handler now exists only in a dedicated worker, accepts only
  trusted messages with the dedicated-worker empty origin or the same origin,
  and validates a versioned request envelope. New requests and replies are
  bound by a random request ID and the original session/participant/invitation.
  Replies expose only a fixed preparation error, never internal exceptions.
- A validated legacy raw-source adapter preserves checkpoint preparation for
  pages already open before deployment. Invalid envelopes cannot downgrade
  into legacy requests; the new builder cannot accept an unbound legacy reply.
- Browser cache versions are advanced together so the entrypoints, builder and
  worker use the same message protocol. One synthetic active-session browser
  fixture now supplies its session identity rather than testing a pre-consent
  object as though it were an admitted session.
- No dependency advisories were open in the Dependabot API at inspection time.
  Existing main-branch CodeQL findings are not claimed resolved by this change;
  the new PR finding must be checked again after GitHub's next analysis.

## Verification

- API/unit/security: 428 passed, zero failures/skips.
- Fresh isolated PostgreSQL/HTTP integration: 38 passed, zero failures/skips.
- All 18 migrations: up/down/up on a newly created disposable database.
- Browser regression: 63 passed across Chromium, Firefox and WebKit (21 each),
  no retries/skips. Includes the real dedicated worker, old-page requests,
  accidental window import, full-session heatmaps, failed writes, admission,
  offline/final-reload persistence and passive physiology aggregation.
- Seven isolated startup-script tests exercise successful/fallback/failed
  pulls, failed readiness, invalid parameters and refusal to replace a fixture.
  Four worker unit tests cover spoofed, malformed, stale and foreign-session
  messages. These eleven tests are included in the 428 above.
- Actual digest-pinned PostgreSQL startup and removal passed with an isolated
  local container/port. Release audit, Python RT smoke, TypeScript, changed-JS
  syntax, shell/YAML parsing and `git diff --check` passed.

The first browser rerun exposed the missing synthetic session ID described
above (60 passed, three failures); after correcting that fixture the complete
63-case rerun passed. Historical test counts overlap and must not be summed.
GitHub release checks and production deployment are subsequent release gates,
not results inferred from these local checks.

## Impact And Rollout

No API schema, database migration, QC threshold, physiological estimator,
participant identity binding or raw biometric upload policy changed. Local
review databases, files and account passwords were not modified. Independent
real-camera scientific validation remains outstanding.

The user subsequently authorized ordinary merges through feature -> develop ->
main, only after successful checks, and verification of the production deploy.
This supersedes the manual-rollout ownership in the earlier handoff report for
this release only. Preserve the original PR description on the release PR.
Do not bypass protection or rewrite history. Existing backup/migration and
coordinated API/static rollback requirements from that report still apply.

## Primary References

- [Dedicated-worker message event](https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/message_event)
- [HTML dedicated worker specification](https://html.spec.whatwg.org/multipage/workers.html#dedicated-workers-and-the-worker-interface)
- [CodeQL origin-check guidance](https://codeql.github.com/codeql-query-help/javascript/js-missing-origin-check/)
- [Upstream PostgreSQL image](https://hub.docker.com/_/postgres)
