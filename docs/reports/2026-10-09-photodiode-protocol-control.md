# Temporary Photodiode Protocol Control

Date: 2026-10-09. Branch: `feature/photodiode-protocol-control`.

## Cause

The deployed frontend contains the photodiode module, but its previous
implementation deliberately hid the checkbox and rejected activation on
non-loopback hosts. The production merge and deployment did not remove it.
There was no researcher-owned protocol setting for this diagnostic.

## Changes

- The builder's quality-control step now includes a separate Hardware
  diagnostics card with a bilingual **temporary feature** label and a timing
  and gaze-interference warning.
- `settings.featureFlags.photodiode` is a strict boolean, disabled by default.
  The existing protocol API and immutable invitation snapshots store it.
- Selection survives step navigation, language changes, reload, draft save,
  reopening and publication. Starting a new protocol clears draft feature
  selections rather than inheriting the previous hardware opt-in.
- The participant applies the loaded invitation's setting on both loopback
  and deployed hosts. Enabled protocols show a read-only explanation; a URL
  parameter or welcome checkbox cannot override that protocol setting.
- A failed or different invitation lookup first disables the previous
  selection and cancels pending flashes. Missing, false and malformed settings
  fail closed.
- Local diagnostic checkbox/query access remains available without an
  invitation. Disabled protocols do not emit markers or add marker metadata.
- Pulse codes, readiness checks, RT clock behavior, queue limits and
  calibration/visibility teardown are unchanged. Marker version is now
  `photodiode.temporary.v1`, retaining `temporary: true` and
  `timingValidated: false`.
- Cache versions for the modified entry points are updated without loading
  multiple versions of the stateful participant runtime modules.

## API, Security And Science

No API route, SQL schema, migration, dependency or media asset was added.
Existing project membership, cookie/CSRF and protocol-edit permissions still
apply. PostgreSQL tests confirm that an unrelated researcher cannot edit the
setting and that editing a protocol does not rewrite an existing invitation.
No raw face video, audio or landmarks are uploaded.

Software tests do not validate physical light onset, detector readability,
hardware latency or jitter. Compare enabled/disabled trials and measure actual
light with the intended detector before scientific timing claims. The feature
remains optional and does not change quality thresholds.

## Fresh Verification

- Full API suite, including real PostgreSQL: **373 passed, 0 failed, 0 skipped**.
- Chromium/Firefox session runtime and photodiode suites: **90 passed**, including
  the mobile keyboard/label-layout regression.
- Chromium/Firefox design-system, builder language and instruction regression:
  **62 passed**.
- WebKit session runtime and photodiode suites: **45 passed**, including the same
  mobile control regression.
- Total distinct browser checks in this matrix: **197 passed**.
- TypeScript, modified JavaScript syntax, static release audit, Python RT smoke
  and whitespace validation passed.

Tests use `emocog_recovery_tests`, separate test media, a frontend on port 4181
and a synthetic deployed hostname. Ordinary preview data and servers on
ports 3000/4173 are not changed. Test-process request caps use existing CI limits.
Initial failures were incomplete API fixtures and a live-auth CORS request from
the isolated test port; corrected fixtures avoid the live staff session without
relaxing production CORS or authorization. Local test logs are outside Git.

## Rollout And Rollback

This change is prepared for review, not deployed by the agent. After deployment,
enable **Photodiode square (temporary feature)** on the quality-control step and
publish the protocol again. Use the newly created participant link: older links
retain their original immutable settings. Confirm the square stays hidden
during consent/precheck/calibration, emits only during the protocol and stops
after completion. Check the disabled protocol as a negative control.

Rollback the frontend commit or publish a new protocol with the setting off;
no database migration or destructive data operation is needed.
