# Server Backups, Protocol QC And Persistence Diagnostics

Local implementation on 2026-10-18; not committed, pushed or deployed.
Previous uncommitted work and the preserved review database/media are retained.

## Changes

- Cumulative backups use the existing authenticated typed POST /ingest every
  30 seconds, at block boundaries and after reconnect. Partial data remain
  incomplete; no duplicate session or additional invitation run is created.
- A monotonic delivery sequence, server-computed canonical digest, row/advisory
  locks and final-first sealing prevent stale or conflicting copies from
  replacing newer results. Final upload retains its existing finish idempotency.
- Checkpoint aggregation runs in a browser Worker, not a second camera loop.
  Unavailable workers use explicitly marked lightweight summaries; no absent
  gaze/alignment measurement is fabricated as zero. Heavy Python RT inference
  remains final-only. Accepted interim RT, available blink/emotion/physiology
  summaries and retained-window gaze aggregates survive a failed final upload.
- The constructor publishes validated versioned QC rules. Live checks use
  cumulative observed metrics after a warm-up and sustained violation, without
  changing gaze/blink/rPPG models or baseline QC. A hard stop waits until the
  current trial ends; invalid attempts remain auditable. The repeat queue is
  explicitly abandoned with an event, rather than blocking finalization.
- Server QC uses the pinned invitation definition, including staff imports of
  an admitted session; a newer draft cannot alter interpretation of that run.
  Browser-supplied pass/fail assertions cannot override the pinned thresholds.
  Hard-stopped runs are labelled aborted and excluded unless incomplete runs
  are selected. Manual import cannot silently finalize a checkpoint export.
- Consent/final errors distinguish browser storage, network, access, expired
  invitations, schema rejection and temporary server failure. Logs/events use
  safe stage/code/status fields. Notices do not overlay an active trial.

## Contracts And Security

SessionFeature v1 gains optional strict `delivery` metadata; JSON Schema,
TypeScript declarations, producer and server validator were updated together.
Existing final clients remain supported. Protocol rules are validated both on
save/publication and on use; historical publications without rules retain their
old baseline behavior. No new SQL migration or external dependency is required.
The preceding publication feature still requires migration 18.

Checkpoint requests require the same session/invitation/project/protocol token
tuple as final requests. Role/tenant checks, immutable media, body limits, PII
rejection and atomic rollback remain in place. No raw camera/audio/landmarks are
uploaded. Digest metadata is server-owned and not trusted from the client.

## Verification

- API/contract/unit suite: 379 passed, 0 failed; includes blocked storage getters
  and the distinction between memory-only state and durable persistence.
- PostgreSQL integration: 36 passed, 0 failed on a separate test database.
- Broad Chromium/Firefox/WebKit regression: 321 passed, 3 skipped, 0 failed.
  The skipped case is the separate real-cookie two-researcher publication fixture
  in each engine. Existing publication/access behavior is covered by the DB suite.
- Final targeted run after storage hardening: 33 passed, 0 skipped/failed,
  including a real ephemeral API and DB in all three browser engines. These are
  overlapping checks, not 33 additional distinct cases beyond the broad run.
- TypeScript no-emit and git diff/whitespace checks passed. No conflict markers
  were found in the changed persistence implementation.
- Local review startup confirmed HTTP 200 for the researcher frontend,
  ready/db=ok for the API, and the new delivery contract served by that API.
  It uses the preserved review copy, not the automated-test database.

The new hard-stop test initially exposed a conflict with mandatory repeats;
this was fixed by explicitly auditing abandoned repeats before finalization,
not by weakening the finish guard or deleting failed responses.

New tests cover sequence ordering, duplicate/conflicting retries, final sealing, fake client QC,
immutable policy interpretation, aborted/partial selection and outsider denial.
Browser tests cover timer dispatch, blocked storage versus access denial,
safe-boundary hard stops, Worker fallback, physiological summary counts and
real API/DB preservation across failed final upload and reload.

## Limits And Rollout

The stored copy is the latest accepted cumulative result, not all raw temporal
samples. It cannot recover discarded samples or unacknowledged data after
simultaneous browser/storage/network failure. It is not automatic cross-device
resume. Offline or suspended tabs can exceed the nominal 30-second interval.
Scientific accuracy, power-cut behavior and multi-hour/weak-device RT timing
remain hardware validation tasks; synthetic/browser tests do not establish them.

The percentage/FPS thresholds are researcher configuration, with unchanged base
gates. The 10-second/10-frame warm-up and 3-second persistence are documented
engineering decisions, not newly validated physiological criteria. Existing
protocols need editing and republishing to opt into the new rules; active pinned
sessions must not be silently reinterpreted.

Deploy the API before or atomically with versioned static assets after coordinated
DB/media backup. Do not roll back to an API that rejects delivery metadata while
new participant tabs are active. A safe rollback requires maintenance/draining
active sessions and a coordinated release restore; do not erase accepted data
or run destructive migration down. Production and original local DB were not used
for tests or modified by this task.
