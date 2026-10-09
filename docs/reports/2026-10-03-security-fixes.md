# Local Security Fixes And Repeat Verification

Date: 2026-10-03. Branch: `agent/local-stimulus-input-isolation`, base HEAD
`1d9f052`, including the existing uncommitted implementation. All work stayed
local. No commit, push, deployment, or production database operation was made.
The earlier keyboard, builder, stimulus-version and sharing changes were kept.

This follows [the original security review](2026-10-03-local-security-review.md).
The subsequent [functional retest](2026-10-04-stimulus-functional-retest.md)
adds live-browser/API coverage and records further geometry and startup fixes.
The seven reported reproduction cases are now covered by passing regressions.
This is not a guarantee that the entire application has no other vulnerabilities.

## Fixes

### F1: Publication Checks The Publishing Actor

`apps/api/routes/invitations_new.js` checks access to every referenced file,
including an existing pinned manifest, inside the media-write transaction.
A previous published read grant does not authorize publishing another person's
private file. Existing invitations retain their pinned versions and read grants.

The real HTTP/PostgreSQL two-researcher regression checks denial before and after
owner publication, successful publication after explicit sharing, and renewed
denial after unsharing, while historical published content remains unchanged.

### F2: Public And Project Responses Project Library Metadata

`apps/api/stimuli/public-projection.js` supplies one explicit allowlist for
library metadata: bounded string values for `text`, `label`, `emotion`, and
`alt`. Invitation entry and protocol list/get/create/update responses use this
projection. Immutable private metadata stays in the database, but is not copied
into participant or project-visible manifest responses. Server filesystem paths
are not included in manifest entries. Authored protocol instructions are not
treated as private library metadata.

Unit and real HTTP/PostgreSQL regressions check private note/contact redaction
and retention of the original database snapshot.

### F3: Incompatible Release Recovery Fails Closed

`apps/api/scripts/check-release-compatibility.js` checks recorded migration names
against migrations shipped with the target API image. Missing migration history,
a missing checker, or a database migration unknown to the target blocks startup.
`deploy/production/wecog-release` applies this check to normal startup, automatic
fallback, and manual rollback. Old writers stop before forward migrations.
Failed recovery stops API/web rather than reopening access with an old image.
No automatic database downgrade or restore is attempted.

Migration 17 also refuses downgrade when private items/folders, immutable versions,
or historical invitation snapshots would lose their contract. Tests exercise
controller orchestration with mock infrastructure, the checker against real
PostgreSQL, refusal guards, and an empty-database migration up/down/up cycle.

### F4: Media Requires Bounded Decode Validation

`apps/api/stimuli/media-preview.js` performs bounded FFprobe/FFmpeg inspection
and strict decode validation rather than accepting a MIME signature alone.
The validation proof is bound to the immutable file's SHA-256. Upload,
replacement, converted slides, protocol pinning, and publication require this
proof. Tool unavailability, timeout, corrupt input, and unsupported participant
media return explicit non-success responses. A failed replacement does not
replace the prior working version.

Real HTTP/PostgreSQL tests reject a truncated PNG, a malformed WAV, a corrupt
replacement, and corrupt legacy media; valid PNG/WAV files still work.
Video validation is a bounded first-frame check and audio validation decodes
the first second, not every frame/sample of a potentially long recording.

### F5: Admission Validates Media Before Reserving A Run

The invitation admission transaction verifies pinned files, hashes, and decode
proof before creating a session or reserving quota. A missing/corrupt file
returns a recoverable conflict without consuming a run. Legacy invitations
without a manifest acquire an immutable snapshot within the same transaction.
The lock order matches media writes and avoids upgrading locks during backfill.

Real HTTP/PostgreSQL tests remove/corrupt a referenced file and verify that
session count and `used_runs` do not increase. Existing concurrent quota,
idempotent completion, and analytics export tests continue to pass.

### F6: Late Library Mutations Stay In Their Original Namespace

`apps/web/researcher-stimuli.js` captures account/API-origin/project and a scope
generation before asynchronous mutations and file dialogs. Responses and
thumbnail decoding results are checked before application. Stale converted
items and object URLs are discarded; they cannot modify the new namespace's
cache, rows, or folders. Upload, conversion, replacement, rename, deletion,
folder operations, and sharing use these guards.

`apps/autotests/tests/stimulus-mutation-scope.spec.ts` tests 15 independent
project/account/API-origin boundary scenarios in each of Chromium and Firefox.
The 30 passing cases include delayed conversion responses and thumbnails,
rename, deletion, and folder responses. Already-authorized server writes remain
in their original project; the UI guard does not pretend to cancel them.

### F7: Project Deletion Follows The Role Policy

The permissions matrix, project DELETE route, and researcher UI now reserve
deletion for scoped administrators and principal investigators, including the
organization-administrator alias. Ordinary researchers cannot delete projects.
The real HTTP/PostgreSQL eight-role regression checks permitted deletion,
denied deletion without data loss, cross-organization access, and anonymous access.

## Repeat Verification

| Check | Final result |
| --- | --- |
| API unit and contract suite | 292 passed, 0 failed, 0 skipped |
| Real HTTP/PostgreSQL integration | 19 passed, 0 failed, 0 skipped |
| Full default Playwright suite, Chromium and Firefox | 258 passed, 0 failed, 28 skipped |
| Critical browser subset, also included in the full suite | 168 passed |
| Namespace mutation subset, also included in the full suite | 30 passed |
| TypeScript `tsc --noEmit` | Passed |
| Python backup/restore safety tests | 14 passed |
| Empty-database migration verification | All 17 migrations: up/down/up passed |
| Changed JavaScript, shell syntax, `git diff --check` | Passed |

The 28 skipped browser cases require opt-in live-API/researcher fixtures that
were not configured in this run; they are not counted as passing. The PostgreSQL
suite separately exercised actual HTTP authorization, media/version persistence,
publication, admission, concurrent quotas, and analytics export on synthetic data.

Local logs:

- `/private/tmp/emocog-security-fixes-api-final.log`
- `/private/tmp/emocog-security-fixes-postgres-final.log`
- `/private/tmp/emocog-security-fixes-browser-complete.log`
- `/private/tmp/emocog-security-fixes-browser-final.log`
- `/private/tmp/emocog-security-fixes-scope-debug.log`
- `/private/tmp/emocog-security-fixes-types.log`
- `/private/tmp/emocog-security-fixes-backup.log`
- `/private/tmp/emocog-security-fixes-migration-cycle.log`

PostgreSQL 16 and FFmpeg ran in disposable local containers with synthetic data.
An expired temporary media-tool container was replaced before the final passing
rerun. No production credentials or data were used. Temporary test containers
were stopped after verification; host-side logs were preserved.

## Remaining Verification Boundaries

- The production image and deployment controller were not exercised on a real
  production VM. Controller tests use isolated mocks, not a cloud deployment.
- Migration-name compatibility prevents the reported downgrade but is not a
  general proof that arbitrary future images are secure or semantically compatible.
- Browser tests use synthetic files and largely mocked API responses. Real
  Yandex Browser/Safari and users' exact media files were not tested.
- The bounded decode check cannot prove an entire long video/audio is valid.
  Participant playback error/recovery remains necessary for later corruption.
- Admission now takes the shared media-write serialization lock; throughput
  under production-scale load was not benchmarked.
- Real-camera calibration and scientific gaze accuracy were not evaluated.
  Scientific formulas and thresholds were not changed in this fix pass.
- This repeat verification closes the reported reproductions in the executed
  coverage; it does not replace an independent security audit or deployment QA.
