# Stimulus, Session And Analytics Handoff

Date: 2026-10-19.
Source branch: `feature/stimulus-session-analytics-fixes`.
Target: `develop`, based on `74f600398d08b72c0faf5eff7f94735d8b4cbee8`.
The user will handle any subsequent merge or production rollout.

## Included Work

- Project-scoped database persistence of complete protocol drafts, colleague
  visibility, awaited deletion and explicit refusal to delete collected data.
- Publication conflict detection, preservation of unsynchronized edits and
  working links after failed saves, and one stable participant entry link with
  immutable versioned invitation/session bindings.
- Configurable physical response-key capture, RU/EN equivalents, additional
  response keys and automatic response-method instructions without manual
  placeholders; updated instruction titles and wrapped survey questions.
- Built-in and uploaded stimulus rendering, content-bounded standard AOI
  previews, pinned media/publication heatmaps and private-stimulus protections.
- Consent/admission and finish transitions, durable checkpoints, interim server
  backups, idempotent final delivery, offline/reload recovery, request deadlines,
  Retry-After handling and researcher-controlled successful-backup notices.
- Streaming long-session heatmap accumulation before raw retention, bounded
  detail budgets and explicit incompleteness instead of misleading AOI values.
- Publication-scoped analytics, canonical participant identity, descriptive
  paired/independent comparisons and snapshot-consistent authorized exports.
- Interactive RT connectedness with selected-trial detail, keyboard navigation
  and zoom; nine background signal metrics in session/group reports and exports.
- Fresh-versus-held physiology accounting, conservative respiration publication,
  signal-history/resampling checks and synthetic-signal regression coverage.
- Current-report PDF export with offline jsPDF, Cyrillic font, figures and
  snapshot provenance. The exact vendored PDF runtime is included despite the
  global `dist/` ignore; upstream bytes/licenses/checksums are preserved.
- A clearer login network-error message, distinct from incorrect credentials.
- Updated contracts, licenses, local-start documentation and regression tests.

## Verification

Fresh handoff checks include 417 passing API/unit tests, 38 PostgreSQL/HTTP
integration tests, all 18 migrations up/down/up on a newly created isolated
database, release audit, TypeScript, syntax/JSON checks and staged secret-pattern
review. The final critical browser rerun passed 300 cases (100 each in Chromium,
Firefox and WebKit), with no skips, unexpected failures or flaky retries.

Earlier, broader browser evidence and scientific limitations remain in:

- `2026-10-19-connectedness-passive-analytics.md`
- `2026-10-19-long-session-signal-readiness.md`
- `2026-10-18-stimulus-resilience-audit.md`
- `2026-10-18-resilience-server-backups-qc.md`
- `2026-10-16-publication-analytics-responses.md`
- `2026-10-15-custom-keys-stable-links.md`
- `2026-10-14-protocol-persistence-pdf.md`

Historical report test counts overlap; they must not be summed into a single
number of distinct tests. Fresh PR checks do not establish real-camera accuracy.

## Rollout Requirements

1. Review/merge into `develop`; this branch does not update `main` or deploy.
2. Back up the database and media before a later production rollout.
3. Apply migration `1699000000018_protocol_publications.js` and deploy the API
   and static assets together. Never rewrite historical session invitation or
   media-version bindings.
4. Reapply analytics selections to obtain snapshots under the new fingerprints.
5. Once stable links have been published, rollback requires a coordinated
   backup/release strategy; the migration refuses a destructive down operation
   that would discard those links.

No local review database, uploaded participant/researcher files, credentials,
environment files or temporary audit fixtures belong to the commit. Existing
local account passwords and production accounts were not changed.

## Scientific And Operational Boundaries

Physiological and expression signals remain research estimates/proxies, not
diagnoses, stress/HRV/mood or microsleep measurements. Short RT windows do not
make overlapping rolling BPM/respiration independent event responses. Whole-
session means cannot answer interval-filtered questions. Comparisons remain
descriptive, with no invented significance tests or confidence intervals.

Raw camera/audio/landmark uploads were not added, QC thresholds were not relaxed,
and missing/truncated data remains explicitly labelled. Existing bounded event
and heatmap detail limits still apply; see the linked method reports.
