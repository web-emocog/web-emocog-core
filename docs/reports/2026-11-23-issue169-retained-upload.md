# Issue 169: retained upload compatibility

Evidence received 2026-11-23; follow-up verification 2026-11-24.

## Scope and evidence

The two Windows exports supplied on 2026-11-23 contain original
`pendingFinalUpload.payload` objects. Validating these objects, without
rebuilding or removing any fields, reproduces HTTP 422 against the current
main contract (`6a9f73e`, after the merge of #183). This does not require a long protocol or a large
request. The rejected event is `calibration_viewport_changed`, whose existing
producer adds a boolean `targeted` field not declared in the closed API schema.

| Retained packet | Wire size, bytes | Main validation failures | Patched validation failures |
| --- | ---: | --- | ---: |
| Windows, illuminated condition | 359485 | `events[16].targeted` | 0 |
| Windows, natural-light condition | 380114 | `events[16].targeted` | 0 |
| Previously supplied Safari export | 1217381 | 50 `events[].stimulusName` occurrences | 0 |

The older main snapshot `1c1e571` was also tested: it additionally rejects
`qcSummary.continuity` in the illuminated-condition packet. That specific gap
is already covered by #177/#183 in current main and develop. The current-main
validator was checked from a fresh git-archive snapshot, not the stale local
main tracking ref. Main and develop have identical source trees at this check.

The previous Safari packet contains photodiode events with a nullable stimulus
label copied from the existing task context. It is NOT the session shown in
the new screen recording. That recording shows a different session; its JSON
and the server's detailed rejection response are unavailable. No exact cause
or successful recovery is claimed for that session.

All three packets were inspected locally. Before/after serialization and file
hash checks confirmed that neither the packet objects nor the original files
were changed. No private session files, invitation codes, tokens, raw samples,
or video frames are included in the repository or test fixtures. Real HTTP/DB
tests use newly created synthetic sessions in an isolated disposable database.

## Changes and compatibility

- Explicit optional boolean `events[].targeted`.
- Explicit optional string-or-null `events[].stimulusName`, maximum 2000 characters.
- Matching public event declarations and TypeScript types.
- Main-compatible typed `qcSummary.continuity`: fixed `qc_continuity.v1`, integer
  segment count in [1, 1000000], boolean history completeness, no unknown fields.
  Current main and develop already contain the identical schema from #177; there is no duplicate
  or changed continuity definition in the develop diff.
- Seven focused tests and an expanded real HTTP/PostgreSQL release-path test.

No new schema version or database migration is necessary: all fields are
optional and describe already emitted data. Existing producers, compaction,
authorization, finish keys, event limits and API body limits are unchanged.
The API validator does not strip, coerce or mutate submitted data. Unknown
fields, wrong types, oversized labels, PII and raw media remain rejected.
Validation responses expose safe field paths, not submitted values.

The original main-based fix was merged with develop normally, preserving
commit authorship. The new PR targets develop; main release remains a user
decision. The PR does not include the separate #185 FPS optimization diff.

## Delivery and quality invariants

The existing participant transport reuses the retained final packet. Tests
exercise 422 without automatic retries, explicit retry after server update,
401 followed by token renewal for the same session/invitation, durable ACK,
and idempotent replay. The serialized request remains byte-identical. The real
server test verifies stored events, continuity and FPS, one feature row, scoped
export, foreign-tenant denial, consent, erasure and rejection after erasure.

Saving an insufficient-FPS session does not make it valid. In the new Windows
files, camera FPS is 30 while measured analysis FPS is 19.25 and 22.73. Mean
primary processing time is about 41.9/41.8 ms; mean segmentation time is about
153.6/157.9 ms. Lighting and face detection pass. These are measured diagnostics,
not invented values or proof of a lighting problem.

Those exports lack the new #185 latency/headroom instrumentation. They cannot
demonstrate that #185 has fixed the affected Windows laptop. New device testing
is still required; API compatibility and processing performance are separate
problems. No QC thresholds, models, protocol duration or measured data changed.

## Verification

Initial historical-main (`1c1e571`) verification:

- Full API suite: 1259 passed, 10 skipped, no failures (before the additional
  public-schema consistency assertion, subsequently checked in the focused suite).
- Focused compatibility suite: 7 passed, no failures.
- Full PostgreSQL integration suite with required media tools: 59 passed,
  1 skipped, no failures; migrations up succeeded on the disposable database.
- TypeScript check, release audit and diff whitespace check passed.

The first host integration run lacked FFmpeg and had four media-tool failures.
A first restricted container attempt also lacked sufficient temporary space and
executable fixture storage. The final pinned offline test image supplied both
media tools and executable temporary fixture space; no assertions or application
security thresholds were relaxed to resolve those environment failures.

Final verification after the normal merge with develop (`51c3c37`):

- Full API suite: 1393 passed, 10 skipped, no failures.
- S2/protocol/#177/operational/release-path PostgreSQL suites: 63 passed,
  1 skipped, no failures. Identity and media suites require separate opt-in
  variables and were not enabled in this run.
- Expanded PostgreSQL run with the identity and media opt-ins enabled:
  90 passed, 1 skipped, no failures. The remaining skipped case is the
  separately gated database/media backup-restore test, not an ingest case.
- TypeScript, release audit and whitespace checks passed.
- Chromium/Firefox runtime and persistence suites initially passed 149/152
  cases. Three Firefox virtual-clock validation cases timed out at the default
  30-second wall-clock limit, rather than failing their scientific assertions.
  Running those exact three cases separately with a 90-second harness deadline
  passed all three in 22.7 seconds total. No application, assertion, sampling
  cadence or scientific threshold was changed. This is not represented as a
  single all-green 152-case run; CI on the final commit is still required.
- A second-agent read-only code review found no concrete issues and passed
  27 focused tests, TypeScript and privacy probes. Required human approval
  is not replaced by this review.

## Rollout and rollback

1. Review and merge the develop PR, then release the API through the existing
   reviewed release process. No production POST, import, deploy or merge was
   performed during this investigation.
2. Verify the actual deployed commit. Public health currently reports
   `release_sha: unknown`; it cannot prove which fix is deployed.
3. After deployment, retry from a still-open final page without reloading or
   rebuilding its retained packet. Existing token renewal still requires the
   original immutable binding and recorded consent where required. Confirm a
   durable server ACK and researcher-side record before declaring recovery.
4. Leave #169 open until the affected real-session recovery is confirmed.
   A missing JSON, lost tab storage, expired/deleted invitation or erased session
   cannot be restored by this schema change. The new report does not establish
   a regression in the #156 builder fixes, separately accepted in its comments.

Rollback is the previous API image; no database down migration is needed.
It restores the former rejection behavior for these fields. Do not erase local
retained packets or rewrite measurements as a rollback workaround.
