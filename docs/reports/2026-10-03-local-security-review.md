# Local Stimulus Solution: Security And Regression Review

Date: 2026-10-03. Branch: `agent/local-stimulus-input-isolation`, base HEAD
`1d9f052`, including the uncommitted local implementation. This is a review,
not a production approval. No application fixes, commits, pushes, deployment,
or production database operations were performed in this review.

Follow-up: all seven findings were addressed and locally retested in
[Security Fixes And Repeat Verification](2026-10-03-security-fixes.md).
The findings below retain the original pre-fix evidence.

## Findings

### F1 [P1] Another Researcher Can Publish Someone Else's Private File

Location: `apps/api/routes/invitations_new.js:439`.

Saving a protocol creates a media manifest even when its files are private.
The invitation route checks project/protocol membership, then trusts an existing
manifest without checking the publishing actor's access to those private files.
`inspectProtocolStimuli` is called without its `user` option. A second researcher
can publish the first researcher's saved protocol. Publication then creates the
grant used by `mayReadVersion`, opening the previously forbidden original.

Reproduced over real HTTP/PostgreSQL with two researchers in one project:

1. Owner uploads a private PNG and saves a protocol, without publishing it.
2. Peer requests the original and receives 403.
3. Peer posts an invitation for the owner's protocol and receives 201.
4. Peer requests the same original and receives 200. The anonymous invitation
   content route also returns the original.

Required correction: authorize publication of every pinned version inside the
publication transaction, including existing manifests. Reading an old published
version for analysis must not independently authorize publication of a private
draft. Keep the historical UUID binding; do not resolve to the latest file.

### F2 [P1] Public Protocol Response Bypasses Metadata Redaction

Locations: `apps/api/stimuli/versions.js:53`,
`apps/api/routes/invitations_new.js:148`.

The manifest copies arbitrary stimulus metadata, removing only `content_path`.
The public entry response returns this manifest as part of the entire definition.
The separate participant stimulus-list route correctly applies a whitelist, but
its protection is bypassed by the entry response. Draft protocol readers in the
same project also receive the full metadata through the staff protocol route.

Reproduced with synthetic `researcher_note` and `participant_email` fields:
the participant stimulus list removed both fields, while public
`GET /invitations/by-code/:code` returned both unchanged. No real personal data
was used in this reproduction.

Required correction: use an explicit public protocol projection, with safe
media descriptor fields and the same public metadata whitelist. Retain the
private, immutable research snapshot in the database; do not erase history as
a workaround. Define and enforce draft metadata access separately.

### F3 [P1] Code-Only Rollback Removes The Privacy Boundary

Locations: `deploy/production/wecog-release:355`,
`deploy/production/wecog-release:395`.

After forward migrations, deployment failure automatically restarts the old
application while leaving the updated database in place. Manual rollback does
the same. Neither path checks whether the target supports stimulus visibility,
immutable versions, or invitation snapshots. The old handler lists all project
stimuli and serves their current content without the new private-file check.

Reproduced by mounting the base HEAD stimulus router in a temporary local API
against the upgraded disposable database. For a new, unpublished private file,
the current handler returned 403 to a peer, while the old handler returned 200
with identical bytes and included the private record in its library listing.
The real production controller was not executed.

Required correction: fail closed on schema/capability-incompatible rollback,
including the automatic deployment-failure path. An incompatible recovery needs
maintenance mode and a coordinated compatible database/uploads restoration.
An operational warning in documentation does not constrain these code paths.

### F4 [P2] A Corrupt Image Can Be Uploaded And Published Successfully

Location: `apps/api/routes/stimuli.js:468`;
signature check: `apps/api/security/stimulus-files.js:43`.

Images are admitted using only their signature. Decode/dimension validation
inside the upload/replacement transaction applies only to video. A hash proves
the bytes are unchanged, not that the image is displayable. Protocol checks only
verify existence and integrity, so preview failure does not prevent publication.

Reproduced by uploading exactly the eight PNG signature bytes. Upload, protocol
save, and invitation creation all returned 201. Both Chromium and Firefox
rejected the identical bytes with `Image.decode()`.

Required correction: validate supported media decodability and bounded dimensions
before committing upload/replacement, and reject publication of invalid legacy
media. Preserve a valid previous version on rejection. Review the equivalent
signature-only audio/PDF paths as well; they were not decoder-tested here.

### F5 [P2] Missing Media Still Consumes An Invitation Run At Admission

Location: `apps/api/routes/invitations_new.js:294`.

The public entry route checks pinned files, but the token/admission transaction
does not repeat that check before reserving quota and inserting the session.
Clients can call admission directly, and files may also disappear between the
entry check and admission. This contradicts the current documentation's claim
that admission verifies pinned hashes.

Reproduced by temporarily moving a published original aside: the entry route
returned 409, while admission returned 200, issued a token, created a session,
and incremented `used_runs` to its maximum of one. The original was restored
immediately after the probe.

Required correction: check the pinned snapshot before quota reservation in the
admission transaction, with consistent media/session/invitation lock ordering
and rollback. A browser-only preflight is insufficient. Separate recovery from
ordinary creation of a different replacement version.

### F6 [P2] Conversion Results Cross Project Boundaries After Preview Wait

Locations: `apps/web/researcher-stimuli.js:464`,
`apps/web/researcher-stimuli.js:793`.

The conversion function checks scope immediately after the conversion response,
then awaits each thumbnail. If scope changes during that wait, thumbnail errors
are swallowed and the converted array is returned anyway. Its caller inserts
the old project's slides into the current global library and persists them in
the new project's cache. Ordinary upload/replacement has a later scope guard;
the document conversion path does not.

Reproduced through the actual PDF file-input UI in both Chromium and Firefox,
with mocked conversion/thumbnail responses: hold the first thumbnail, select
project B, then release it. A private slide with `projectId: 7` became visible
and persisted while the active project was `8`. This proves the browser race,
not real LibreOffice conversion. No cross-project SQL insert was observed.

Required correction: validate the captured scope/generation after every awaited
phase and immediately before inserting/persisting the results. Retire discarded
object URLs. Apply the same discipline to folder, rename, and delete operations,
not just the read synchronization path.

### F7 [P2] Researcher Deletion Policy Is Inconsistent

Locations: `apps/api/security/permissions.js:58`,
`apps/api/routes/projects.js:222`,
`docs/api/authorization-matrix-v1.md:47`.

The documented matrix and researcher workflow forbid project deletion, but the
permission module, route, and existing test explicitly permit it. A synthetic
member researcher successfully deleted a disposable project with HTTP 204.
This inconsistency predates the new stimulus changes; it is not evidence of a
newly introduced escalation bug.

Decision needed: confirm whether researchers should be able to delete projects.
If forbidden, change the server operation and regression expectation. If
intended, correct the matrix and document deletion/retention safeguards. Do not
silently change this destructive-operation policy based only on a review.

## Verified Controls

Fresh real HTTP checks covered all eight roles: platform admin, organization
admin, PI, researcher, analyst, assistant, developer, and respondent.

- Foreign-organization stimulus access was denied for every non-platform role.
- Same-organization sibling project and missing project membership were denied
  for a researcher. Organization membership alone was insufficient.
- Analyst and assistant writes were denied. Developer/respondent tenant reads
  and writes were denied. Anonymous staff access returned 401.
- Private direct file access and private folder mutation were denied to peers
  before any publication grant.
- Forged creator assignment and client-supplied content paths were rejected.
- A researcher could not assign themselves an administrator role.
- A token with an incremented database token version was rejected immediately.
- Existing integration tests rechecked cookie/CSRF behavior, tenant-scoped
  analytics/exports, invitation quota concurrency, ingest rollback, immutable
  versions, video rejection/replacement preservation, posters, and old heatmaps.

These passing checks do not negate F1/F2/F3 or constitute a comprehensive
penetration test.

## Fresh Regression Results

| Check | Result |
| --- | --- |
| API unit/contract suite | 285 passed, 0 failed |
| PostgreSQL HTTP/integration suite | 17 passed, 0 failed, 0 skipped |
| Six Playwright suites, Chromium + Firefox | 138 passed, 0 failed |
| Python backup helper suite | 14 passed |
| TypeScript typecheck | Passed |
| Modified/new JavaScript syntax | 49 files passed |
| Release-controller Bash syntax | Passed |
| Python RT smoke | 2 correct trials; one valid RT of 320 ms |
| `git diff --check` | Passed |
| Fresh disposable DB migration up | All 17 applied |

The integration environment used PostgreSQL 16 and real FFmpeg 8.0.1 in a
temporary Alpine container, with only synthetic local data. Both containers
were stopped after the review. No production Docker image was built.

Additional audit probes intentionally assert the observed unsafe behavior so
they produce reproducible evidence. They are not security acceptance tests and
must be converted to denial/validation regression tests when fixing the issues.

Local evidence:

- `/private/tmp/emocog-security-review-observations.json`
- `/private/tmp/emocog-security-review-browser-observations.json`
- `/private/tmp/emocog-security-review-rollback.json`
- `/private/tmp/emocog-security-review.cjs`
- `/private/tmp/emocog-security-browser.cjs`
- `/private/tmp/emocog-security-rollback.cjs`
- `/private/tmp/emocog-security-review-api.log`
- `/private/tmp/emocog-security-review-postgres.log`
- `/private/tmp/emocog-security-review-regression-browser.log`
- `/private/tmp/emocog-security-review/conversion-race-chromium.png`
- `/private/tmp/emocog-security-review/conversion-race-firefox.png`

Temporary evidence may not survive machine cleanup. Reproduction steps above
remain part of the repository report.

## Scope And Limits

The review examined the changed stimulus solution and its critical auth,
membership, publication, participant, analytics, file-processing, migration,
and deployment boundaries. It was not a line-by-line audit of every unrelated
legacy file in the monorepo.

- Production/proxy/cloud permissions, real IAM, network segmentation, deployed
  CSP/TLS, object storage, and production backup/restore were not exercised.
- No fresh dependency advisory lookup, container vulnerability scan, or external
  penetration test was performed. No assertion of CVE-free dependencies is made.
- Direct filesystem actors and old writers that do not acquire media locks
  remain outside the coordinated writer guarantee.
- Resource-exhaustion behavior across multiple API replicas was not load-tested.
  Global media-write serialization also includes preview generation, so slow
  decoding can delay unrelated projects' mutations.
- Current private-to-project sharing is not equivalent to deleting access to
  previously published versions. Historical analysis intentionally retains that
  access. Older records with unknown uploaders remain project-shared and require
  an explicit ownership review before claiming a fully personal legacy library.
- Real camera/eye-tracker accuracy, independent calibration validation, mobile
  devices, and Yandex Browser were not scientifically/device-tested in this audit.
- A new binary version does not automatically repair a missing historical
  original used by an immutable invitation. Recovery needs the correct old bytes
  or a clearly identified new protocol/invitation.

## Recommended Fix Order

1. Close F1 and F2 using centralized publication authorization and public
   projections, with real two-user negative integration tests.
2. Block incompatible rollback (F3) before deployment. Maintain a coordinated
   recovery plan rather than weakening the new privacy boundary.
3. Add decode validation and atomic admission checks (F4/F5), including corrupt
   images and media missing immediately before token exchange.
4. Guard conversion and all delayed mutations by scope/generation (F6); test
   project, account, and API-origin changes with held network responses.
5. Resolve the destructive-operation role policy (F7), then rerun the complete
   acceptance suite with denial assertions for all reproduced findings.

Scientific formulas/thresholds were not changed. The next fix must preserve
target-blind gaze prediction, raw/corrected/display separation, canonical key
mapping, timer start after media readiness, and immutable measurement provenance.
