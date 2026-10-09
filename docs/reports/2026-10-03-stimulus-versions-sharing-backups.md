# Local Stimulus Versions, Sharing And Recovery

Date: 2026-10-03. Local branch: `agent/local-stimulus-input-isolation`, based on
`1d9f052`. Work is uncommitted in the isolated worktree. No fetch, push, PR,
deployment, production database access or production migration was performed.
The primary dirty checkout was not edited. Previous keyboard/input-isolation
changes remain included.

## Implemented

- New uploads and folders default to personal scope. Server-issued creator and
  explicit private/project sharing are enforced separately from tenant membership.
  Only creator/platform admin changes sharing. Built-in, Personal, Project and
  All accessible gallery views expose that distinction.
- Migration 17 adds immutable original-file versions, SHA-256 and current-version
  binding. Replacement creates a new path/version; old files remain available for
  already published invitations and analysis. SQL triggers protect established
  binary identity and published invitation definitions.
- Protocol saves build their own media manifest, including a snapshot of names
  and metadata. Invitations snapshot the full definition. An edited protocol,
  changed emotion label or replacement cannot alter an old participant link.
- Admission validates pinned files/hashes. Participant samples carry the version
  UUID. Session heatmap backgrounds use the invitation revision and recorded
  geometry. Mixed-version group heatmaps return an explicit explanation instead
  of an incorrectly merged overlay.
- Visible library cards request bounded JPEG thumbnails/posters rather than full
  videos. Full originals remain separate for participant playback and AOI editing.
  Standard shape previews now scale uniformly to their card instead of shrinking
  asymmetrically or clipping. Participant shape sizes are unchanged.
- Video uploads perform real decoding and codec validation. Damaged media are
  rejected with typed errors; rejected replacement preserves the old SQL version
  and the old usable UI record. Temporary thumbnail failures do not undo a committed
  upload. Late responses cannot reinsert a file into another project's library.
- A coordinated backup holds a media lock, exports/dumps the same PostgreSQL
  snapshot, verifies SQL references against the binary archive, and publishes its
  completion manifest last. Inventory includes historical originals and ready
  previews. Missing/corrupt references fail closed.
- API image and CI install FFmpeg; image records package/build versions. License
  notices, env example, authorization model, repository instructions and recovery
  runbook were updated. Browser import cache versions were changed coherently so
  stateful modules keep one state instance.

## Verified Locally

Environment: macOS, Node.js 25.4.0, Python 3.13.7, disposable PostgreSQL 16,
and separate FFmpeg 8.0.1 tools container. Browser API fixtures are local mocks;
real SQL/file behavior is independently tested by HTTP integration and restore.

- API unit/security/contract suite: 285 passed, no failures.
- PostgreSQL integration: 17 passed, no failures. Coverage includes same-project
  personal isolation, cross-project isolation, sharing permissions, spoofed
  multipart ownership fields, immutable SQL guards, pinned metadata, old/new
  participant files, old heatmap background, mixed-version group rejection,
  invalid video rejection and preservation after failed replacement.
- Migration verification: all 17 up/down/up on a new empty DB. Down with existing
  versions was separately rejected without changing the schema.
- Six Playwright specs run in Chromium and Firefox: 138 passed. These cover
  design system, session runtime, analytics, input/isolation, sharing/posters and
  audio/multimodal integration. This is the selected regression set, not every
  optional Playwright spec in the repository.
- Python backup helper: 14 passed. Python RT smoke passed with two correct trials
  and valid RT 320 ms; this does not prove physical input timing accuracy.
- TypeScript typecheck, syntax checks for 49 changed/new JS modules, shell syntax,
  static release audit and `git diff --check` passed.
- Gallery desktop/mobile screenshots inspected. They contain synthetic fixtures,
  not actual participant or production uploads.

The final real backup/restore drill used two image revisions, an original H.264
MP4 and its JPEG poster. The archive contained 27 regular files, including
unreferenced local test files. The SQL inventory referenced four files across
three immutable versions. A new DB and new upload directory were restored;
every inventory path, size and hash matched the restored SQL references. A
temporarily missing historical original refused backup before creating a dump.
An exclusive backup lock prevented acquisition of the media-writer shared lock.
No working database or upload directory was overwritten.
Both temporary PostgreSQL/media-tool containers were stopped after verification;
local backup artifacts remain available for inspection.

Earlier diagnostic runs exposed a missing helper path, linked-file acceptance,
test-suite rate limiting, stale test module versions and a short timing-fixture
polling race. These were resolved and the reported final runs were repeated.
Production rate limits and scientific timings/thresholds were not weakened.

## Rollout And Rollback

Deployment is still a separate authorized operation. First pause old writers and
external file jobs that do not take the media lock. Preserve and restore-test a
pre-upgrade DB/uploads backup. Upgrade API image, controller, Python helper and
static assets as one compatible release, apply migration 17 in maintenance, and
verify private/shared access, MP4 decoding, range delivery and backup completion.
Do not install the new backup controller against an image missing its script.

Legacy records remain project-shared because historical ownership is unknown;
do not guess creator from browser cache. Legacy invitations snapshot the existing
definition, and file bindings freeze before subsequent replacement. Previously
overwritten/lost media require recovery from a trusted backup or explicit re-upload.

After versions exist, migration down is refused. Returning to an old API that
does not enforce private scope is not a safe code-only rollback. Recovery must
use a verified pre-upgrade DB/files set in maintenance, with an explicit decision
about writes made since that set. Never automatically overwrite live data on a
failed health check.

## Limits

Full backups pause media writes/publication for their duration; reads remain
available. Version/history retention increases disk and backup volume. External
writers must be paused or integrated with the lock. Current limits are 100,000
archive files, 10 GiB uncompressed backup data, bounded media time/output and
32-million-pixel decoded geometry. Capacity/storage redesign remains separate.

The production Debian API image was not built/deployed in this local run; media
tools were exercised in Alpine. CI/runtime image verification and independent
security/decoder review remain required before production approval. Browser
coverage is Chromium/Firefox, not a separately installed Yandex Browser. No
real-webcam gaze accuracy or clinical calibration claim follows from these tests.
