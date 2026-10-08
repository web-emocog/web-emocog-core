# Researcher Password Change Recovery

Local-only work on `agent/local-stimulus-input-isolation`. Existing uncommitted
stimulus/input/security/session changes were preserved. No commit, push,
deployment or production-account/database access was performed.

## Findings

- The researcher Settings view rendered password fields and an inert button:
  there was no submit handler or call to `/auth/me/password`. This directly
  explains why changing those fields did not replace the original password in
  the checked source/local build. The affected person's production account and
  deployed assets were not inspected, so their exact incident is not separately
  confirmed.
- The UI advertised eight characters while the API required twelve.
- Staff login trimmed the submitted password, unlike the API. An exact password
  containing leading/trailing spaces could therefore work through the API but
  fail through the login page. The account-creation page also trimmed passwords.
- Two overlapping self-service requests could both verify the old hash and
  report success; the last unconditional update silently replaced the first.
- Validation errors in this route included validator values and could reflect
  submitted passwords back to the client.
- Follow-up review reproduced a further UI race in both browsers: switching
  language during a delayed request rebuilt the form, removed the submission
  lock and could hide its eventual result. Returning to Settings during the
  same request also lost the pending state.

## Changes

- A labelled, accessible settings form submits the current and new password via
  the existing cookie/CSRF API helper. A confirmation field, twelve-character
  minimum and 72-byte UTF-8 maximum match the server policy. Passwords are used
  exactly as entered, not normalized or trimmed.
- In-flight submission is guarded and disabled. Success is displayed only
  after API acceptance; credentials are cleared afterwards, and the returned
  CSRF token replaces the previous token. English/Russian status messages cover
  invalid current passwords, validation, expiration, conflicts, rate limits
  and unconfirmed/network failures. An ambiguous response explicitly asks the
  user to try signing in with the new password before retrying the change.
- A page-local status controller now survives language/SPA-route rerenders.
  It holds only pending/status/error state, never submitted passwords or DOM
  nodes. The current form remains locked until completion and receives the
  localized result even if the submitting form was removed. Editing a ready
  form clears its previous message. The settings script cache URL was bumped
  again for this follow-up fix.
- Login and administrator account creation no longer trim password values.
  Login still ignores localStorage API overrides; passwords cannot be routed
  by changing that stored preference.
- `PATCH /auth/me/password` updates only the server-authenticated user's row.
  Parameterized compare-and-swap checks both the previously verified hash and
  the authenticated `token_version`. A stale/concurrent request receives 409.
  The new hash and token-version increment are one atomic SQL update.
- Cookie callers receive a refreshed HttpOnly cookie and CSRF token. Previous
  cookies and bearer tokens fail authentication; bearer clients sign in again.
  The current password remains mandatory, and client-supplied IDs/roles do not
  change the target or privileges.
- Validation returns stable, sanitized codes without password values. This
  route's server error logging does not print submitted passwords or SQL errors.
- Changed settings/core/translation entry points have cache-versioned URLs.
  Auth invariants and the self-service endpoint are documented in AGENTS, the
  API README and the authorization matrix.

No dependency, migration, password-policy relaxation, auth bypass, role change
or biometric/scientific algorithm change was introduced.

## Verification

All results below are from the final October 6 local rerun, not an older report.

| Check | Result |
| --- | --- |
| Full API unit/contract/security suite | 308 passed, 0 failed, 0 skipped |
| Real PostgreSQL/HTTP integration | 23 passed, 0 failed, 0 skipped |
| Settings, design system, participant runtime, export recovery and analytics in Chromium/Firefox | 144 passed, 0 failed, 0 skipped |
| Password browser cases, included in the 144 | 32 passed: 28 mocked and 4 real API/PostgreSQL cases |
| TypeScript typecheck | Passed |
| Changed JavaScript and inline HTML script syntax | Passed |
| Diff whitespace | Passed |

Real browser cases create a synthetic researcher through the normal
administrator API in `emocog_recovery_tests`, authenticate through the staff
login page, select their project, navigate to Settings and click the change
button. Both 1280px and 390px viewports are tested in each browser. The exact
new Cyrillic password with surrounding spaces is verified against PostgreSQL;
the original hash no longer matches, and `token_version` increases once.
Reload/logout/new login succeeds; the old password and old cookie fail. The
refreshed CSRF works on the next authenticated write. Fixtures are deleted in
the test teardown; no person's or manual-preview user's password is reset.

HTTP regressions also verify missing/stale CSRF, invalid current passwords,
short/oversized/non-string new passwords, unchanged passwords, ignored foreign
IDs/roles, unchanged unrelated accounts and two deterministic simultaneous
password changes. Exactly one succeeds; the losing candidate cannot log in.
Follow-up HTTP cases also verify migration from a legacy eight-character
password, two successive changes, a twelve-character ASCII password, exactly
72 UTF-8 bytes of Cyrillic, rejection above that limit, and stale self-service
requests after a concurrent administrator reset or role change. Administrative
mutations are injected only into the synthetic fixture, using real database
writes after authentication and before the guarded update; they cannot be
overwritten and old tokens remain revoked.
Mocked browser regressions verify delayed acceptance, duplicate submission,
field clearing, absence of password storage, English mobile labels and safe
handling of HTTP 400/401/403/409/429/500, network and malformed responses.
Follow-up browser cases verify pending guards and success after changing
language/leaving/returning, plus a rejected request that finishes while the
form is absent. The new delayed-request regression failed in both browsers
before the follow-up fix and passes in the final expanded suite.

Earlier harness runs required corrections: mobile language switching must open
the navigation drawer; real login deliberately ignores localStorage endpoint
overrides, so the isolated fixture uses trusted page configuration instead.
Final real cases use normal project/settings navigation, not a form hidden
behind onboarding. No runtime security checks were weakened to make tests pass.

Logs and synthetic screenshots are under the ignored local-preview directory:

- `apps/api/uploads/local-preview/password-full-api-tests.log`
- `apps/api/uploads/local-preview/password-postgres-tests.log`
- `apps/api/uploads/local-preview/password-broad-browser-tests.log`
- `apps/api/uploads/local-preview/password-recheck-full-api-tests.log`
- `apps/api/uploads/local-preview/password-recheck-postgres-tests.log`
- `apps/api/uploads/local-preview/password-recheck-broad-browser-tests.log`
- `apps/api/uploads/local-preview/password-rerender-regression-before.log`
- `apps/api/uploads/local-preview/password-change-desktop-2026-10-06.png`
- `apps/api/uploads/local-preview/password-change-mobile-2026-10-06.png`

## Local Runtime And Rollout

The existing preview PostgreSQL/media containers were restarted after Docker
had stopped. The current API is running on loopback port 3000 and the restricted
static server on loopback port 4173, using the same existing preview data.
Tests run temporary HTTP servers against a separate test database, not the
manual-preview database. No migration or re-seeding of preview users was needed.

The checked fix is not deployed to the live website. Publish the backend and
frontend together through the normal reviewed release process, then have the
affected researcher repeat the password change with their current password.
An earlier value typed into the inert form cannot be recovered or inferred.
Do not tell the researcher their password was changed until API confirmation.

Rollback is a reviewed revert of this fix, without reverting unrelated local
work or stored password hashes. Already changed passwords must not be silently
restored; token versions must not be decremented. Reverting the form would
reintroduce the original non-working password change.

Residual limits: no live deployment or affected-account verification was done;
Safari/Yandex and password-manager autofill were not separately tested. Unit,
HTTP/PostgreSQL, Chromium/Firefox and visual desktop/mobile checks passed.
