# Protocol persistence and PDF regression report

Local branch: `feature/protocol-persistence-pdf`, based on develop
`74f600398d08b72c0faf5eff7f94735d8b4cbee8`.
No production deployment, GitHub push, database migration or user-data purge.

## Findings and Fixes

1. Protocol deletion only removed a browser-storage entry. It now awaits an
   authorized database DELETE. Unused invitations cascade; referenced stimuli
   are released. Started sessions block deletion with an explicit 409.
2. Drafts were local-only and absent from colleagues' workspaces. Draft saves
   now persist editor state through project-scoped API CRUD and are restored
   from the database in a fresh browser workspace.
3. Publication failure erased previously verified links and list refresh could
   overwrite unsynchronized edits. Both are retained. Repeated publication uses
   the same protocol ID, including a new protocol whose invitation creation failed.
4. Instruction titles did not update block labels. Input now updates the
   localized title and card label; explicit English edits take priority over
   template translations.
5. Native legend positioning put long survey questions across fieldset borders.
   Questions wrap inside cards, including long unbroken words at 390 px.
6. Analytics lacked PDF download. The current report/applied selection now
   exports with Cyrillic text, tables, available figures, combined media/heatmap/
   AOI layers, controls, snapshot identity and provenance. Authorization is
   checked again before download; changed accounts/selections cancel export.
7. Cross-port export verification could not read snapshot/hash headers because
   CORS did not expose them. Only those service headers and Content-Disposition
   are now exposed to already-allowed origins.
8. Additional protections: content revisions prevent stale saves/publication;
   admission/deletion use a consistent lock order; private stimuli cannot be
   bound through another researcher's draft; editor-only media selections do
   not enlarge participant manifests.

## Verification

- **354** API unit/contract tests passed.
- **30** real PostgreSQL integration tests passed, including two researchers,
  project boundaries, private media, immutable invitations, physical deletion,
  password/CSRF regressions and concurrent admission/deletion.
- **136 distinct browser checks** passed in Chromium/Firefox across protocol
  persistence/PDF, analytics, participant runtime and design-system suites.
- The real-cookie two-account test additionally verified cross-port JSON export
  snapshot/hash access after the CORS fix on the restarted API.
- TypeScript checks, JavaScript syntax checks and `git diff --check` passed.
- Generated PDFs were opened with pypdf and rendered with Poppler; Cyrillic,
  snapshot identity, pagination and composite figures were inspected. Preview
  reports explicitly identify synthetic data.

The isolated fixture used PostgreSQL 16, actual FFmpeg and separate temporary
uploads. Test rate limits were raised only for the fixture, not production.
Existing repository changes and the user's original database were not modified.

## Known Scope Boundary

Authored QC controls now survive database saves/restoration. Their existing lack
of connection to participant runtime QC is a separate issue; this patch does not
change scientific thresholds or relax gaze/face quality criteria. Protocols
with collected sessions require a separate archive/retention workflow rather
than destructive deletion. Saving and invitation creation remain two operations;
their failure states are handled explicitly rather than claimed to be atomic.
