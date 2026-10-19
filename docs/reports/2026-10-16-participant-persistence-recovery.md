# Participant Admission And Long-Session Recovery

Date: 2026-10-16. Local changes; not pushed or deployed.

## Findings And Changes

- Reproduced a storage incompatibility: gaze retention trims the array from
  32,000 to 30,000 samples, while the checkpoint writer assumed an append-only
  array. A shrinking or shifted array could reject a write or misalign chunks.
  Retained chunks now rebase atomically when the head moves. Unchanged heads
  still use incremental writes. The existing retention limit is unchanged.
- A failed local checkpoint previously could prevent terminal persistence from
  reaching the final screen and ingest. Terminal failures are now handled;
  local download and the network attempt remain available. Concurrent periodic
  callers share the handled result, including failures.
- IndexedDB failure now falls back to a sanitized compact sessionStorage copy.
  It retains consent, identities, RT, progress, lifecycle and prepared final
  aggregates, but excludes diagnostic sample arrays. A fresh store instance in
  the same tab can recover it. Both-storage failure is not reported as durable
  persistence; storage exhaustion and tab closure remain real limitations.
- The immutable final packet is prepared before terminal checkpointing. Reload
  and retry reuse its session, invitation and finish key. Accepted upload
  cleanup failures do not turn acceptance into a failure. Summary download and
  staff manual import also prefer the canonical prepared packet when IDs match.
- Automatic final retry waits until invitation bootstrap is ready, rather than
  racing registration initialization. Stable entry aliases may recognize a
  previously pinned checkpoint, without changing the API's session binding.
- The actual protocol cursor is restored without deleting prior RT. Interrupted
  trials retain the existing invalidation/repeat behavior. A terminal finish
  block starts finalization automatically; a finish block before other tasks
  cannot silently skip them.
- A transient admission failure gets one short retry with the same session ID.
  Permission denials are not replayed; long Retry-After delays are not ignored.

## Contracts, Security And Measurement

No new database migration or wire schema is introduced by these lifecycle
changes. Checkpoint schema remains 3 with additive local metadata. Stateful
participant module imports are aligned at cache version `20261016-2`.
Deploy with the preceding API/static publication changes and migration 18.

No raw camera/audio is stored or transmitted. Checkpoint redaction remains
active. Participant token tuple validation, membership, CSRF, immutable media
and ingest idempotency remain enforced. The production invitation was not
admitted or modified during verification.

No gaze prediction, calibration, physiological algorithm or QC threshold is
relaxed. A compact recovery is explicitly marked as incomplete raw data, not
presented as a complete signal recording. Bounded gaze history is still not a
full-session raw archive; earlier discarded samples cannot be reconstructed.
Offline acquisition still has a final-only server upload policy.

## Verification

- API/contract/unit suite: 373 passed, 0 failed.
- PostgreSQL integration: 35 passed, 0 failed, including final ingest,
  idempotency, immutable invitation binding, access checks and safe migration guards.
- The six new lifecycle regression cases passed in Chromium, Firefox and WebKit.
  Two additional compact-packet manual import cases passed in all three engines.
- Across the overlapping broader browser runs, 444 distinct cases passed and
  21 specialized-fixture cases remained skipped. See the companion publication
  analytics report for the deduplicated browser totals and skipped scope.
- TypeScript no-emit and whitespace/diff checks passed.

New browser cases cover transient admission plus quota failure, actual IndexedDB rolling
retention, overlapping failed writes, total storage failure at finish, exact
packet/key retry after reload, summary download after compact recovery, and
resuming the next task without clearing prior RT.

The final local startup uses the existing review database/media copy without
overwriting it; API readiness confirms database access and the researcher HTML
returns HTTP 200. The automated-test API was stopped before this startup.

## Limits And Rollout

The reported production session and server logs were not available for direct
inspection. Reproducing matching local failure modes is not proof of the exact
production cause, and no claim is made that the missing 16:25-17:00 session has
been recovered. Preserve the affected browser's storage and any JSON export
for separate recovery investigation; do not fabricate replacement results.

Browser tests use synthetic inputs, bounded sample simulations and mocked
failure responses; they do not validate 35 minutes of real camera tracking,
glasses, photodiode hardware or storage behavior on every Safari/device version.

Back up DB/media, apply the preceding migration if needed, deploy API and
versioned static assets together, then smoke-test consent, reload and finish
before inviting participants. Do not alter an active participant's pinned
definition. Roll back by coordinated release/backup recovery, not by destructive
migration down after immutable versions/publications have been used.
