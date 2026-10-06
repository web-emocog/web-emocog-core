# Stimulus Library And Response Keys

## Response Contract

The trial editor supports four additional physical response keys:

| Russian layout | English layout | Saved response |
| --- | --- | --- |
| Я | Z | `KeyZ` |
| Ч | X | `KeyX` |
| Б | comma | `Comma` |
| Ю | period | `Period` |

The editor shows both actual Cyrillic and Latin labels. `KeyboardEvent.code`
determines the response regardless of the active layout. Imported Russian or
English characters normalize to the same codes. Space, arrows, mouse click,
pointer intent, and no-response trials retain their existing behavior.

The shared keyboard registry is used by the editor preview, participant response
collector, and server RT event adapter. Held-key repeats, modifier shortcuts,
and composing input do not count as new responses. Response and expectedResponse
retain the canonical code in cognitiveResults; the RT adapter lowercases both
identically for analysis. An incorrect accepted key remains an incorrect response,
not an ignored input.

Standard participant instructions derive their response phrases and choice-task
condition mappings from the current trial table, including physical keys, click,
pointer intent, and no-response trials. Changing keys no longer leaves a fixed
Space/arrow instruction in the body. Custom instructions can use `{response}`;
unmarked custom text is preserved rather than silently rewritten by task type.

Builder metadata is captured on input before a locale rerender. Editing drafts
have a separate account-isolated cache and source-revision check, so they do not
overwrite the new-protocol draft or resurrect metadata after an explicit save.

## Library Ownership And Persistence

The API is authoritative for uploaded files. SQL stores the project, metadata,
and a server-owned binary path. Binaries live under `UPLOADS_ROOT/stimuli`; they
are not embedded in SQL or kept only in browser storage. Production backups
must preserve BOTH the database and the binary volume.

The library has Built-in, Personal, Project, and All accessible views. Uploaded
files and folders are personal by default (`visibility=private`); only their
creator and platform admin can read them. Organization/project access remains
mandatory for other staff. Personal files remain tied to their project, not a
cross-project drive. Only creator/platform admin can change sharing. Shared
files are visible to authorized members of that project.

Migration 17 leaves existing records project-shared: their historical uploader
cannot safely be inferred. Browser caches never grant ownership. Publishing a
personal file grants participant access through that invitation; project staff
can read that exact revision for analytics. Unsharing hides the library item,
but does not break published sessions or expose an unpublished replacement.

Browser metadata caches are partitioned by account, API origin, and project,
and are never sufficient to authorize a record. Project changes clear visible
custom items immediately, revoke media object URLs, and discard late responses.
API list rows and folders must agree with the requested project. A stale selected
project that is absent from the accessible project list is replaced.

Old browser-only files without verifiable ownership are kept in account-scoped
`emocog_stimulus_quarantine_v1` rather than assigned to the current project.
Draft protocols are not deleted. These files require an explicit re-upload or a
separate ownership-confirmed recovery workflow; dead blob URLs cannot be repaired
from metadata alone.

## Display And Recovery

Visible gallery cards fetch small authenticated image thumbnails/video posters,
at most four at a time. Full originals are fetched only for participant playback,
AOI editing or explicit inspection. The list restores from SQL after reload and
delayed sign-in. Changed revisions invalidate old object URLs.

A library request failure is displayed as an error with Retry, not an empty
successful library. A transient preview failure retains the stimulus record and
offers a per-card Retry. A server-confirmed missing binary remains explicitly
unavailable and can be replaced without changing its stimulus ID.
Rejected uploads/replacements do not erase a successful record or mark an old
working file unavailable. Images must decode, not merely have a recognizable
signature; videos must decode and have a supported codec. Audio is also checked
with a bounded decode before acceptance;
signature, codec, decoding and unavailable-tool failures have separate codes.
No automatic re-encoding changes the original source.

Heatmap media is fetched with staff credentials. A missing background image does
not discard other visual contexts or analytical data. The media cache is revoked
on project/account boundaries. Rendering uses contain sizing, not image stretching.

Gaze coordinates for images/video use the actual decoded media content rectangle,
including object-fit letterboxes, padding/borders and visual-viewport offsets;
they do not use the surrounding stage. The measurement step has no entrance
animation. Heatmap/AOI planes preserve the intrinsic content aspect ratio inside
their decorative border, including on narrow screens.

Corrected recordings carry `coordinateMappingVersion=media-content-rect.v1`
and algorithm version `1.1.0`. Existing recordings keep their legacy coordinate
semantics. Session/group heatmaps and AOI metrics refuse to aggregate mixed
mappings with `gaze_coordinate_mappings_mixed`. Without the original gaze points
and rendering geometry, old results cannot be reliably rewritten as new ones.

Researcher authentication notifications wait until page scripts initialize.
Early library events cannot mark uninitialized state as ready or skip legacy
quarantine. A delayed-core-script regression covers this startup race.

## Immutable Revisions And Publication

`stimulus_versions` stores server-issued UUID, path, MIME, byte count and SHA-256.
Original binary identity and established checksum cannot be changed by SQL
updates. Preview status, dimensions/codec/duration and poster path are derived
separately. Replacing a stimulus creates another file/version, never overwrites
the original. A protocol save pins referenced versions and metadata in a
server-built `mediaManifest`; client manifests are ignored. An invitation stores
its immutable protocol definition, including AOIs, names and descriptions.

Publication checks the publishing actor against every referenced item, including
already-pinned drafts. A historical publication grant does not grant permission
to publish another invitation for a now-personal file. Staff protocol responses
and participant definitions share the explicit media-metadata whitelist
(`text`, `label`, `emotion`, `alt`); private research snapshots remain intact in
SQL and arbitrary library metadata is not sent through those endpoints.

Participant admission verifies pinned binary hashes and decode proof before
reserving a run or creating a session. Missing/corrupt media returns a recoverable
error without consuming quota. Legacy bindings freeze on successful admission
as well as before replacement. All operations use the same media lock ordering
as mutation/backup. Gaze samples carry the
version UUID. Session heatmaps resolve the invitation, not the latest edited
protocol/file. Group heatmaps refuse to overlay different file revisions and
explain how to select compatible sessions. Referenced files cannot be deleted
while protocols or published invitations still use them.

Pre-upgrade invitations receive the existing protocol definition in migration;
legacy file bindings freeze before replacement. Already lost or overwritten
files cannot be reconstructed from metadata or dead blob URLs.

## Coordinated Backup And Recovery

```bash
cd apps/api
npm run backup:media -- /ABSOLUTE/NEW/backup-prefix
```

The backup exports a PostgreSQL snapshot under an exclusive media advisory lock,
dumps that snapshot, inventories referenced originals/historical files and ready
previews, archives uploads and verifies every inventory hash/size. Missing or
corrupt references fail the backup. Mutations/publication hold the shared lock
and wait during backup; read-only API access stays available. The production
controller publishes the completion manifest last.

Restore must target a separate DB and new directory, validate dump/archive and
inventory checksums, and compare restored SQL references with actual files.
See `docs/operations/CICD_YANDEX_CLOUD.md`. Rolling migration 17 down after versions
exist, private items/folders exist or invitation snapshots differ from the
current protocol is refused; restore a coordinated pre-upgrade set instead.

Delayed conversion (including thumbnail waits), upload, folder creation/moves,
rename, replacement and deletion capture the account/API/project scope and its
generation. They cannot apply results to another workspace or one reopened
after a scope change; retired object URLs are revoked. Project deletion is
restricted to tenant leads/administrators, not ordinary researchers.

These capabilities are tested locally, not deployed. The API image requires
FFmpeg/ffprobe and migration 17. For first upgrade, pause old writers that do not
participate in the lock, preserve a verified pre-upgrade backup, and upgrade
API/controller/helper/static assets together.
