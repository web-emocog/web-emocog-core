# Issue 186: Publication Follow-up

## Reproduction and Fix

Server-owned `mediaManifest` entries retained arbitrary library metadata. The
reference collector recursively interpreted archival `stimulusId`, `slides` and
`trials` keys as additional runtime stimuli. Publication pinned the correct file,
then inspected the expanded set and rejected it as unavailable/private. A new
synthetic regression failed before the collector fix and passed afterwards.

The collector now skips `mediaManifest`. Actual block/trial references and the
explicit constructor-reference option retain their checks. Access checks,
server-owned paths, checksums, decoder eligibility and immutable invitations are
not weakened. No database migration, dependency or model change is required.

Media inspection no longer discards its failure reasons before preflight. The
existing `protocol_stimulus_unavailable` code carries bounded, localized typed
preflight errors. The client handles it alongside structural preflight errors;
pin-level access failures without details receive a safe library/access hint.
Raw metadata, unavailable file names, paths and decoder output are not exposed.
Drafts and previous invitation links remain intact. Browser cache versions are
updated for changed scripts and their entrypoints.

The script warning in the issue is explicitly CSP **report-only**; it does not
explain an API validation response. This change does not add `unsafe-inline`,
disable CSP or bypass authentication.

## Verification

- Full local API suite: 1428 passed, 12 environment-gated skips, no failures.
- Targeted reference/preflight/HTTP contract suite: 25 passed, no skips/failures.
- Real PostgreSQL and stock API image with FFmpeg: synthetic legacy PNG and JPEG
  publish, re-edit and create invitations successfully with valid-time extension.
  Synthetic GIF and foreign-project files are rejected, forged client manifests
  cannot authorize files, and failed writes preserve the full saved definition
  and existing invitation snapshot. Three tests passed, no skips/failures.
- TypeScript and static release audit passed.
- PostgreSQL publication/persistence, valid-time ingest and S2 authorization/media
  regressions: 64 passed, no skips/failures, using the stock API image and the
  same test-only rate limits as CI. The first broader run used the default login
  rate limit and was rejected with 429; that setup run is not counted as a pass.
- Chromium, Firefox and WebKit publication/draft/PDF regressions: 54 passed,
  three explicitly gated live-API cases skipped. Typed rejection messages are
  rendered as text (including hostile markup), the previous link/edits survive,
  and retry publishes without a duplicate protocol or premature invitation.
- Public staging/dependency-closure verification passed: 298 files.
- Additional Chromium/Firefox/WebKit suites: valid-time builder 21 passed,
  builder security 57 passed, bounded staff HTTP/authentication 51 passed;
  no skips/failures.

Only synthetic fixtures belong to this change. This regression establishes a
matching failure mechanism, not proof of the exact stored metadata in every
reported incident. Keep issue acceptance open until the affected researcher can
re-edit and publish after API and browser assets are deployed together. Do not
change an existing production protocol or invite participants to test a fix
without the researcher's decision.
