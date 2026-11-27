# Issue 186: Legacy Image Validation

## Reproduction

Two remaining compatibility gaps were found after #189:

- The builder required a locally stored PNG codec before allowing a researcher
  to request valid-time extension, although library synchronization does not
  carry that fact and the server is responsible for checking the real file.
- The API reused historical preview metadata based on poster availability and
  SHA alone. Obsolete facts, such as a duration associated with a static image,
  could reject a real static PNG/JPEG even after new publication code was deployed.

A synthetic PostgreSQL regression seeded ready historical posters and matching
SHA values but obsolete image facts. Before the fix, both static formats received
422 with `passive_valid_time_invalid` and `passive_valid_time_media_unsupported`.
This establishes a matching mechanism, not a read of any production database.

## Fix

For valid-time publication/admission, PNG/JPEG/BMP preview caches require a
server-owned `image_decode.v1` marker
in addition to SHA binding. Missing/obsolete markers trigger the existing bounded
native inspection/preview path. Current results are reused, not repeatedly
decoded. Original media bytes, stimulus/version IDs, SHA values and existing
invitation snapshots are preserved. No database migration or client capture/FPS
change is needed. Audio/video cache policy is unchanged.
Ordinary preview reads reuse historical posters without forcing native work.
Participant media validation evaluates eligibility after refreshing decoder facts;
stale cached claims cannot reject valid images or authorize actual APNG animation.

The builder permits existing compatible library images to request publication
checks without a local PNG codec. Its hint explains the automatic check and no
longer recommends unnecessary conversion/re-upload. It still blocks unavailable
files, local-only IDs and incompatible task/media selections. Server-side MIME,
decoder, animation, access, integrity and runtime/QC checks remain authoritative.
The new cache marker is not exposed in participant media manifests.

## Verification

- New regression was red against the previous API image, then green after the fix.
- Stock API image with real FFmpeg/PostgreSQL regressions cover
  fresh and historical-cache PNG/JPEG/BMP, repeated publication without decoding
  again, immutable originals/invitations, forged client manifests and foreign
  project files. Real generated APNG is rejected even with a legacy cache that
  falsely labels the same bytes as static PNG. GIF remains rejected for extension.
- Full local API suite: 1429 passed, 11 environment-gated skips, no failures.
- Full PostgreSQL/media quota/restore/security integration run with CI fixture
  settings: 86 passed, one identity-environment skip, no failures. An initial
  container run lacked participant producer modules; that setup failure is not
  counted as a pass. The final run mounts them read-only for the release-path test.
  The additional participant-media check refreshes obsolete facts before judging
  static eligibility, and tests both valid images and actual APNG animation.
- Targeted builder/media/static-eligibility/public-projection unit tests: 20 passed.
- Chromium, Firefox and WebKit builder/publication/PDF/security suites: 141 passed,
  three explicitly gated live-API cases skipped, no failures.
- TypeScript, static release audit and public staging (298 files) passed.

Only synthetic images and metadata are used in committed tests. The original
researcher's production protocol was not changed. API and UI must be deployed
together before retrying publication; keep #186 open until researcher acceptance.
