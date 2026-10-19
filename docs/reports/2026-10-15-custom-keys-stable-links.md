# Custom Response Keys And Stable Publication Links

Date: 2026-10-15. Local work on `feature/protocol-persistence-pdf`; not pushed or deployed.

## Changes

- Per-trial custom physical-key capture with bilingual Russian/US labels, explicit Save and Cancel/Escape.
- CVBNM / СМИТЬ presets alongside ZX,. / ЯЧБЮ, Space, arrows and pointer modes.
- Row selection and bulk assignment. Removing responses from selected trials does not disable keyboard input for remaining trials.
- Physical letters, digits, punctuation, Enter and numpad; numpad digits remain distinct. Modifier shortcuts, navigation Escape/Tab, function keys, held repeats and IME composition are not captured as bindings.
- One keyboard registry for builder, runtime instructions/input and server RT adapter; unknown/prototype-property names fail closed.
- Instructions use actual trial mappings; custom authored text supports `{response}` without rewriting unmarked author text.
- Stable entry URL follows the current published snapshot. Separate immutable invitation codes continue to identify session/media versions.
- Publication numbers increase transactionally under the existing media/protocol locks. Draft save does not move the public pointer.
- Lookup with an admitted session ID preserves its invitation. Media, admission and ingest use the resolved immutable code, not the moving alias.
- Invitation deletion with admitted sessions now returns 409, preserving version provenance.
- Participant JSON includes publication number in experiment metadata. JSON format version remains separate.
- Stateful module cache versions were updated consistently; no scientific algorithm changes.

## Contracts And Migration

Migration 18 adds `invitations.publication_version` and indexed `protocol_publications`.
POST invitations returns `public_code` and `publication_version`; protocol lists expose
the stable code and publication number. Entry GET resolves the actual invitation.
Role, org/project membership, expiry, quotas, immutable snapshots and media access
checks remain required. No raw biometric media or additional data uploads were introduced.

Legacy backfill retains the latest active invitation code already shown to researchers,
or the latest invitation when all have expired/exhausted quota. Older version-specific
codes remain unchanged. Down refuses to discard an alias pointing at a different snapshot.

Deployment: stop old writers, make a coordinated DB/media backup, apply migration 18,
upgrade API and versioned static files together. Do not deploy only the frontend.
Rollback after new publication requires a coordinated restore, not destructive down.

## Verification

- API/contract/unit suite: 354 passed.
- PostgreSQL integration: 34 passed, including migration up/down/up in an isolated schema, active/expired/exhausted backfill, concurrent publications, media isolation, stable URL, session pinning, CSRF, role/tenant boundaries and password regressions.
- Chromium/Firefox: 244 distinct browser cases passed across the targeted and broader regression runs, including real-cookie two-researcher draft editing and republishing the exact same URL.
- WebKit: 63 distinct browser cases passed, covering key capture/runtime/instructions, real publication, draft sharing, library isolation and PDF downloads.
- TypeScript no-emit check and `git diff --check` passed.

Initial test-fixture failures were corrected without relaxing production checks:
the trial fixture required an RT window, media files needed a directory mounted
in the FFmpeg container, and republishing must navigate the real stepper rather
than bypass the editor's restored draft step.

## Local Review And Limitations

A separate copy of the previous local PostgreSQL database and media was created;
the original database/files were not modified. The copied media inventory verified
50 referenced files, sizes and SHA-256 hashes. Only the copy received migration 18.
Automated tests use another isolated database, not the review copy.

These are software regressions, not validation of webcam accuracy, physiological
signals, hardware timing or OS-reserved shortcuts. Real-camera and physical-keyboard
testing remains necessary. Non-Russian/US layouts retain physical codes but labels
describe Russian/US positions. Unmarked authored instructions are intentionally preserved.
Analytical JSON format tags are not publication numbers; historical sessions are
not recomputed. This task does not resolve the previously documented independent
custom-QC-runtime integration gap.

Follow-up on 2026-10-16: recognized RU/EN authored response phrases are now
adapted automatically, and analytics select immutable publication identifiers.
The verification above describes the earlier work only; see the separate
2026-10-16 reports for current behavior, recovery limitations and regression runs.
