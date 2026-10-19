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
