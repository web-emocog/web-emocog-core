# Stimulus And Session Resilience Audit

Local working-tree audit, 2026-10-18. No commit, push, deployment, password change
or modification of the user's review database/media was requested or performed.
The API and static assets are coordinated at cache revision `20261018-3`.

## Confirmed Issues And Corrections

- Uploaded analytics descriptors returned MIME strings outside the response
  type enum; fractional dimensions and undocumented hash/error fields also
  disagreed with the contract. Descriptors and schema now agree, and video is
  rendered as video, with legacy MIME descriptors still accepted by the UI.
- A proxy's HTTP success without a canonical ingest acknowledgement could clear
  a pending result. Participant transport and manual import now validate session,
  lifecycle and finish-key acknowledgements. Invalid successes retain the packet
  for retry. UI callback errors cannot negate a durable acknowledgement.
- JSON bodies could remain pending beyond a header-only request timeout.
  Deadlines now include body consumption. Long Retry-After responses also defer
  subsequent send cycles for the same session, including after reload when
  sessionStorage is available.
- Failed primary media could enter a fallback without another timeout; late
  video play callbacks could belong to the previous source. Each source now has
  a deadline and guarded callbacks. Retry/skip does not turn failure into a valid
  response. Same-publication Start reuses decoded media instead of downloading
  it again; reload/new publication refreshes it.
- Decode-failed analytics blobs were retained for later retries. They are
  evicted, with a visible retry control; other heatmaps/statistics survive.
  WebKit also exposed a video metadata-only preload that left no first frame;
  analytics now requests frame data, with a bounded readiness fallback.
- A failed lookup on reload could leave the public URL code in place of the
  restored immutable code. Bootstrap no longer overwrites the restored binding
  before a successful lookup. Final retry keeps the frozen packet.
- A persisted IndexedDB record without a readable active-session reference was
  treated as reload-safe, and admission ran before checking storage. Preflight
  now precedes run reservation; unfinished admission restores to consent, with
  the same IDs and no background ingest. IndexedDB opens/transactions time out;
  timed-out transactions abort before compact fallback, late opens close.
  Restoring a compact pre-final checkpoint carries an incomplete-signal-series
  marker in experimentMeta for subsequent aggregate exports; a frozen completed
  packet remains unchanged.
- An unreadable prior checkpoint could silently become a new run. Recovery now
  blocks that replacement and explains how to retry without clearing site data.
  Local failures during an existing run warn at a safe boundary; final network
  upload and explicit JSON download remain available.
- Audio library references could be used as visual stimuli and fail only during
  presentation. Visual protocol availability now rejects unsupported MIME types
  before admission. This does not introduce an audio-stimulus player.

## Security And Measurement Boundaries

Tests use synthetic participants, temporary staff accounts/projects and a
dedicated local database. They check private/project-sharing access, outsiders,
account changes, pinned media revisions and publication isolation. The preserved
review application is only a static host for browser tests, not their write API.

No estimator, gaze correction, QC threshold, fixation algorithm or scientific
acceptance criterion was relaxed. No raw camera/audio upload was added. RT starts
after stimulus readiness. Skipped media remains marked as invalid. Standard SVG
previews come from the registry, not arbitrary researcher HTML.

## Verification

- Full unit/API/contract/security set: 391 passed, 0 failed/skipped.
- PostgreSQL integration: 37 passed, 0 failed/skipped; suites ran serially on
  `protocol_fixes_test`, not the review database.
- Expanded browser replay: 657 passed, 0 failed/skipped/flaky, in Chromium,
  Firefox and WebKit. The real-cookie two-researcher case was enabled rather
  than skipped. The final run took about 7.1 minutes.
- A final targeted persistence/recovery replay passed all 15 cases in the three
  engines after the compact-recovery metadata addition. These overlap the 657;
  they are not another 15 unique functional scenarios.
- RT Python smoke exited successfully and returned two parsed trials.
- TypeScript no-emit, syntax checks for 74 changed/new JavaScript modules,
  git whitespace checks and targeted conflict-marker checks passed.
- The local review API/static host restarted successfully: ready/db=ok, HTTP 200
  for researcher and participant pages, matching cache revision `20261018-3`.
  The temporary audit API/accounts/uploads were cleaned up; review data and
  media were retained. No Git history, remote branch or deployment was changed.

Coverage includes standard previews/AOIs, real portrait/landscape/square uploads,
actual video decoding/playback, desktop/mobile/fullscreen geometry and heatmap
alignment; pinned versions, private/project access and revocation; failed media,
hanging fallback, late callbacks and decode-cache retry; admission/storage
failure, reload, offline metadata, a real browser network outage, false HTTP
success and a lost acknowledgement after a real database commit. The last case
verifies one stored session and one quota reservation despite retransmission.

Earlier trial runs exposed the WebKit first-frame issue described above. Test
fixtures were also corrected to use credentialed CORS and canonical ingest
acknowledgements. An old text locator selected a newly introduced hidden fallback
before the visible error; it now asserts the visible failure without suppressing
the test. Static transport checks were updated for the bounded JSON helper while
retaining the single-ingest and decode-readiness invariants. No failing case was
disabled or measurement threshold relaxed to obtain the final green run.

Local evidence: `/private/tmp/wecog-audit-unit-final-20261018.log`,
`/private/tmp/wecog-audit-postgres-20261018.log`,
`/private/tmp/wecog-audit-browser-final-20261018.log`,
`/private/tmp/wecog-audit-results-20261018.json`,
`/private/tmp/wecog-audit-browser-replay-20261018.log`. Browser screenshots were
also visually inspected for uploaded media and heatmaps. Earlier report counts
were not reused as evidence for this run.

## Limits

An existing long-session limitation remains: `appendGazeSample` retains a rolling
window of 30,000-32,000 gaze samples, and final heatmaps are built from the retained
samples. This audit fixes media rendering, checkpoint consistency and delivery;
it does not introduce a full-session streaming gaze archive. Consequently early
presentations in a sufficiently long session can have incomplete/missing gaze
coverage even when all RT responses and the final packet were saved. Window
duration depends on actual sample rate. A separate cumulative/streaming design
and fixation-boundary validation are needed; increasing an unbounded in-memory
array is not a safe fix. Do not interpret these tests as evidence of complete
multi-hour gaze coverage.

These synthetic/browser checks do not replace a real camera/device benchmark,
a long human session, production acceptance or an independent security audit.
Recovery requires surviving browser storage and available page assets. A cold
offline page load, cleared storage, private-window eviction, OS crash or disk
failure cannot be promised lossless. A compact fallback explicitly omits raw
sample series. A server can enrich the submitted packet with calculated fields;
tests compare the transmitted retry packet, not demand byte equality with that
enriched database representation. Missing historical files are not reconstructed
or silently replaced. No production result was retroactively relabelled.

## Manual Acceptance

1. Publish a protocol with a standard square, a portrait upload and a short
   video; edit QC/backup notices and republish. Keep the same public URL and
   verify that a newly admitted run is publication 2.
2. Confirm consent once; check camera/calibration and complete several responses
   with the configured key. Reload and recalibrate: accepted RT responses stay,
   only the interrupted attempt repeats.
3. In the already loaded page, disconnect the network and finish. Keep the tab
   open, download JSON, reconnect and retry. Check one stored session, not two.
   Do not use a cold offline page load as a test of a service worker: none is
   promised by this flow.
4. In analytics select the actual publication and session; check square AOI,
   uploaded image/video aspect ratios, fixation overlay and PDF. Test media retry
   separately from an analytics API error.
5. For simultaneous different staff accounts use separate browser profiles or
   browsers. Tabs in one profile share the staff cookie: an account change must
   lock stale tabs instead of treating them as independent authenticated users.
   Verify a new private upload is absent for a peer, explicit project sharing
   exposes it to authorized project members, and an outsider cannot read/edit it.
6. A real long camera run and device timing/scientific validation are still
   required. In particular, audit gaze coverage before relying on long-session
   early-block heatmaps; see the retained-window limitation above.
