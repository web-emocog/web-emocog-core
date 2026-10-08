# Local Stimulus Input And Isolation

Date: 2026-10-02

Branch: `agent/local-stimulus-input-isolation`

Base: local `origin/develop`, commit `1d9f052`. No remote fetch, push, PR,
production migration, or deployment was performed. The pre-existing edits in
the primary checkout were left untouched; implementation uses a separate worktree.

## Root Causes

- The RT collector accepted only Space and arrows. The editor, preview, runtime,
  and RT adapter did not share a physical-key mapping for the requested layouts.
- The library combined all browser-only records with API data and retained the
  previous project's records until an asynchronous request succeeded.
- A saved project ID was not checked against the accessible project list.
- Late API arrivals rerendered the gallery without hydrating authenticated media.
- Some project-selection paths changed localStorage without notifying the library.
- API synchronization moved uploads behind all built-in stimuli after reload.
- The trial dialog's fixed content minimums could put Save outside the viewport.
- A single unavailable heatmap background rejected the whole visual response.

## Changes

- Shared canonical `KeyZ`, `KeyX`, `Comma`, `Period` mapping for Russian/English
  layouts, saved trials, participant results, preview, and server RT events.
- Repeat/modifier/composition protection; legacy keys and response modes preserved.
- Immediate scope invalidation, account/API/project metadata partitioning,
  project validation, late-response rejection, and media URL revocation.
- API-authoritative library restoration, including delayed authentication;
  uploaded records appear first after reload.
- Explicit library loading/error states and Retry. Preview download errors retain
  the record and offer Retry without falsely claiming the binary was deleted.
- Legacy unscoped local files retained in quarantine, not silently assigned to
  another account/project. Draft protocols are not removed.
- Protected heatmap media hydration with per-context failure isolation.
- Scrollable trial content with fixed visible Save/Cancel controls.
- Cache-busting versions for updated browser scripts.

## Verification

- `apps/api`: `npm test`, 281 passed, zero failures.
- Temporary PostgreSQL 16: all 16 integration tests passed, repeated successfully.
  Real multipart image/MP4 upload, SQL metadata reconstruction, binary equality,
  video byte ranges (206), foreign-project content/preview/delete/folder denial.
- Python RT smoke passed. An additional adapter-to-Python check yielded five
  trials: four correct physical-key responses, one wrong key, valid mean RT 320 ms.
- Playwright: 126 tests passed across Chromium and Firefox for design-system,
  participant runtime, analytics, and the new stimulus/input scenarios.
- Additional final library-order checks cover both browsers after the ordering fix.
- TypeScript typecheck, JavaScript syntax checks, and `git diff --check` passed.
- Library screenshot inspected locally; final ordering check captures a fresh image.
- The temporary database container was stopped and removed after tests.

## Boundaries And Follow-Up

Production API, its database, binary volume, and deployment were not accessed.
Local tests do not prove that a production upload volume survives redeployment.
The MP4 database fixture checks storage/range delivery; the existing browser
regression separately checks playback of a valid uploaded video fixture.

Project members currently share a library by design. Per-uploader privacy needs
an explicit creator/visibility/sharing contract; it is not implied by this fix.
Previously missing binaries cannot be reconstructed from SQL metadata or expired
browser blob URLs.

Proposed next work: separate built-in/project/personal sources; immutable media
revisions with checksums and source dimensions pinned to published protocols;
small previews/video posters; binary-volume reconciliation and joint DB/file
backup verification. See `docs/stimulus-library-and-responses.md` for the contract.
