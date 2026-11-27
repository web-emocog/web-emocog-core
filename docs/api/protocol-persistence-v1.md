# Protocol persistence and PDF reports

Updated: 2026-10-15. Migration 18 is required for stable publication links. Deploy
API and versioned static frontend together. Existing clients retain strict-save behavior.

## Drafts and Access

`POST /protocols` and `PATCH /protocols/:id` accept optional
`save_mode: "draft" | "publish"`. The server owns `definition.isDraft`.
Drafts may contain unfinished surveys/AOIs or unavailable files; known private
media references still require creator/project access. Drafts cannot issue
participant invitations. Publication retains survey/AOI/media validation,
decoding checks and immutable media pinning.

`definition.builderState` preserves editor metadata, blocks, step, editor
version, feature flags, analytics plan and authored QC controls. Authenticated
project members with `protocol.read` can retrieve drafts and inactive protocols.
Organization membership alone is insufficient; write/publish roles are unchanged.
Private stimulus binaries remain creator-scoped.

Participant projections omit constructor state. Constructor-only selections do
not enlarge playable media manifests. Preserving authored QC controls does not
reinterpret or relax runtime scientific QC rules.

## Revisions and Publication

Responses include an opaque SHA-256 `revision`. PATCH and invitation creation
accept `expected_revision`; stale requests return
`409 / protocol_revision_conflict`. The optional `expected_updated_at` remains
supported, but revision hashes also distinguish same-millisecond changes.

Saving and invitation creation remain separate operations. Each successful
publication gets a new immutable invitation snapshot/code. `public_code` is the
stable participant-entry code and `publication_version` is a monotonically
increasing publication number, separate from the JSON format's `definition.version`.
The builder copies `public_code`, never the newly generated snapshot code.
Failed publication preserves local edits and any previously verified link.
Retry targets the same protocol ID, never an unrelated duplicate.

### Media Validation Failures

Runtime stimulus references exclude `mediaManifest`, including arbitrary library
metadata nested inside it. Archival `stimulusId`, `slides` or `trials` keys do not
add presentations, require access to extra files or expand invitation manifests.
Runtime block/trial references and optional constructor-only references remain
checked. Client-supplied manifests never authorize or select a server version.

After pinning, a failed media check returns HTTP 422 with the existing
`protocol_stimulus_unavailable` code and a `protocol_preflight.v1` report, just
like structural `protocol_preflight_failed` errors. Known reasons distinguish
unsupported valid-time images, unsupported media, audio screen areas and integrity
failures. Unknown reasons use a safe generic message. Raw library metadata,
filenames, storage paths and decoder output are not included in this report.
The browser bounds typed report fields for both error codes, renders messages as
text and preserves the draft and previous link on rejection.

Pinning can reject an inaccessible/missing project file before a media report
exists. Its existing error code is preserved; the builder then shows a localized
library/access hint without disclosing whether another user's private file exists.
No error path grants access, substitutes a file, publishes an invalid definition
or changes an already issued invitation. Static-image requirements for valid-time
extension remain unchanged.

Legacy PNG/JPEG/BMP preview caches are refreshed automatically when their
server-owned `media_info.image_decode_version` is absent or obsolete, even when
the historical poster and `validated_sha256` exist. Fresh bounded decoding
replaces obsolete media facts; a successful result is reused on later reads and
publications. The original binary, stimulus/version IDs, checksum and existing
invitation snapshots are not replaced. This is lazy validation, not a bulk data
migration. Audio/video cache policy and resource limits remain unchanged.

The builder treats existing library PNGs without a local codec as candidates
for that server check, not as verified static media. It no longer tells users to
switch formats or upload an old file again just because browser metadata is
missing. Publication still rejects animation (including APNG with stale cached
facts claiming static PNG), inaccessible files, RT/manual tasks and unsupported
media. Decoder cache-version bookkeeping is not copied into participant manifests.

`GET /invitations/by-code/:public_code` resolves the latest published invitation,
returning its immutable `code`, `invitation_id` and `publication_version`.
If `session_id` belongs to an already admitted session of this protocol, the
response resolves that session's original invitation instead. An ID from another
protocol cannot redirect the lookup. Draft edits do not move the publication pointer.
The client uses the returned immutable `code` for media, admission and ingest;
these endpoints deliberately do not follow the entry alias mid-session.
Quota and expiry checks apply to the resolved invitation, including resumes.
An invitation with admitted sessions cannot be deleted (`invitation_has_sessions`).
Deleting an unused current invitation invalidates the public link until another
publication; the server never silently falls back to an older version.

Migration 18 retains the latest active code previously shown for each protocol
(or the latest invitation when none is active). Earlier codes remain historical
version links. Published snapshots and session bindings are not rewritten.
The migration adds a nullable invitation version and a small indexed pointer table;
backfill scans/sorts invitations. Pause old writers, back up DB/media, run the
migration in a maintenance window, then upgrade API/static assets together.
Up/down/up and legacy active/expired/exhausted backfill are tested in an isolated
schema. Down refuses to discard an alias once it points at a different snapshot;
use a coordinated backup restore instead. Never run down against live data.

`pendingSync` prevents list refresh from replacing unsynchronized edits with older
API data. Local-only saves are explicitly reported. Protocol list field
`has_unpublished_changes` identifies differences from the latest active snapshot.

## Deletion

The frontend waits for DELETE before removing the browser entry. The server
serializes media writes and locks invitations before the protocol, matching
participant admission. Deleting an unused protocol cascades unused invitations;
stimuli become deletable when no remaining definitions reference them.

After any session starts, deletion returns `409 / protocol_has_sessions`.
Collected session/protocol/media provenance is preserved. This endpoint is not
a destructive purge or an archive mechanism.

## PDF Download

The current analytics tab and applied selection are exported: visible statistics,
missingness/QC, tables, available graphs, combined stimulus/heatmap/AOI layers,
local connectedness controls and query/algorithm provenance. Other tabs and
unapplied filters are not exported. Preview PDFs are clearly marked as fictional.

Download reauthorizes through the existing JSON export endpoint, verifies the
snapshot ID/hash and checks account, tab, selection and local controls again
before saving. Export denial never falls back to cached data. Generation is
browser-local with vendored jsPDF and an embedded Cyrillic font: no CDN or new
server PDF dependency. An unavailable figure is explicitly reported.
For allowed CORS origins the API exposes only snapshot/hash and attachment-name
response headers, so loopback frontend/API ports can verify the same export.
