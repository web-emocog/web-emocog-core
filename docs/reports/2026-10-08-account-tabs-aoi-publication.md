# Local account/tab, builtin AOI and publication corrections

## Scope

Branch: `agent/local-stimulus-input-isolation`.
No GitHub publication, history rewrite, password reset, schema migration or
preview database reset was performed for these fixes. Local code changes remain
uncommitted. The application uses the existing `emocog_preview` database;
integration tests use the separate `emocog_recovery_tests` database.

## Observed causes

1. Staff cookies are shared between tabs in the same browser profile. Logging
   into account 2 replaces account 1's cookie, while the old tab retains its old
   screen and CSRF token. Shared workspace keys and language can then be read or
   written by that stale tab. This is not two independent authenticated sessions.
2. The submitted result contains two passive presentations and one RT trial.
   A read-only API/database comparison confirmed that it matches the invitation's
   immutable snapshot, whereas the current edited protocol contains RT only.
   Publication incorrectly reused an old invitation to that earlier snapshot.
3. Builtin non-face stimuli lacked default AOIs. Catalog refresh also replaced
   manually edited face AOIs with preset arrays on every refresh.

## Corrections

- `staff-session.js` binds the tab to a fixed staff identity. Cookie/workspace
  identity changes block the old screen and its API requests. Delayed responses
  cannot silently adopt another account. Stale workspace reads/writes are blocked
  so delayed callbacks cannot corrupt the newly active account's draft or language.
- API authentication checks optional `X-Staff-User-ID` against the authenticated
  principal before CSRF checks or routes. The header asserts identity; it grants
  no authority and does not replace cookie/JWT, role or tenant membership checks.
- Only an explicit middleware `csrf_token_invalid` rejection permits one retry.
  CSRF is refreshed through `/auth/me` only for the same fixed staff identity.
  Other authorization failures, HTTP errors and network failures are not replayed.
  Multipart bodies and browser cookie credentials are preserved.
- Researcher language is archived/restored with the account workspace.
- Each successful publication creates a fresh invitation pinning the newly saved
  protocol and media. Old invitation codes, results and snapshots are preserved.
  An old code cannot redirect the editor to another protocol ID.
- A URL with a new invitation code cannot restore another invitation's session
  tuple or results. Its older IndexedDB checkpoint is retained for recovery.
- Known builtin stimuli receive normalized default AOIs. Faces retain face/eyes/
  mouth regions; shapes receive target regions; the flanker target is the central
  arrow. Arbitrary uploaded images and unknown IDs do not receive invented AOIs.
  Explicit manual AOI lists, including deliberately empty lists and block-scoped
  overrides, keep priority. Existing results are not recalculated.
- WebKit exposed a preexisting native select sizing issue: the participant
  language control was only 25 CSS pixels high despite a 44-pixel minimum.
  Explicit height/appearance and a direction-aware caret now preserve the
  44-pixel control size, native keyboard selection and RTL layout.

## Verification

- API/unit/contract suite: 329 passed, 0 failed.
- PostgreSQL integration: 23 passed, 0 failed on the separate test database.
  Includes private media/list/content/preview denial, creator-only sharing,
  immutable participant and heatmap media, tenant analytics access, cookie/CSRF
  checks, staff identity mismatch and password/session revocation.
- Chromium and Firefox final browser run: 126 passed, 0 failed.
  Covers real two-tab workspace switching with mocked staff API, multipart CSRF
  recovery, fresh publication, builtin/custom AOIs in the builder, IndexedDB
  invitation isolation, project media loading, all four keyboard positions in
  both layouts, design/builder regressions, participant runtime and final ingest.
- WebKit final browser run: 63 passed, 0 failed. Chromium/Firefox design checks
  repeated after the Safari CSS fix: 22 passed, 0 failed. Across the three engines,
  all 189 distinct browser test executions passed.
- TypeScript typecheck, JavaScript syntax checks and `git diff --check`: passed.
- Restarted API: `/ready` reports ready and database OK. Researcher, participant
  and session-guard assets return 200; private API configuration returns 404.

The first integration attempt exceeded the preview authentication rate limit
under automated test load (429). The passing rerun used higher rate limits only
inside the test process. Running preview/production limits were not changed.

## Manual retest

1. Reload researcher pages to load the new frontend code.
2. Use separate browser profiles or different browsers for genuinely simultaneous
   account 1/account 2 testing. In one shared profile, the old tab now locks when
   the account changes; reload explicitly adopts the current account.
3. Upload a personal image under each identity. The peer must not see it or edit
   its sharing. Share it with the project: authorized peers may view it, but only
   its creator/platform-admin may change visibility.
4. Check each account retains its language and drafts on switching back.
5. Enable AOI for builtin stimuli and inspect default regions. Edit one and
   confirm the custom markup survives reload and remains scoped to its block.
6. Publish the edited RT-only experiment and use its newly generated link.
   The previous link intentionally continues to run the historical snapshot.

Browser automation uses synthetic inputs, not a real participant camera. It
does not establish scientific gaze accuracy, blink validity or actual device RT
timing. WebKit automation is not a claim of manual validation in installed Safari.
