# Publication: legacy inventory and staff media limits

## Report and reproduction

A publication failed with `503 media_inventory_unmeasured`. A second screenshot
showed `429` responses for many versioned `/stimuli/:id/content` reads and a
protocol save. These are two different failures, not evidence of lost stimuli.
Production logs and the affected organization's database were not accessed.
The specific unknown production objects and any additional proxy limit remain
unverified. No user data, production setting or remote branch was modified.

The previous quota implementation was reproduced from the unchanged Git HEAD:
any unmeasured inventory row immediately rejects publication without measuring
files. Migration 0019 intentionally imports legacy originals/posters with NULL
sizes. Upload admission measured them, but direct publication did not.

Authenticated media reads also used the default rate-limit profile, sharing its
budget with protocol writes. Opening the builder stimuli step additionally
downloaded originals from the entire library rather than selected assignments.

## Local changes

- A quota check with an explicit server-owned uploads root measures legacy
  objects under the existing organization lock, then recalculates retained and
  reserved bytes. Version pinning and preview generation supply that root.
- Missing, linked, oversized-batch or still-unmeasured inventory remains a
  blocking error. Actual quota excess remains 413. Failed publication rolls
  back inventory updates and does not create a partial protocol/publication.
- Only GET/HEAD for exact numeric staff content/preview paths use the existing
  bounded media profile. Writes, authentication, metadata and protocol saves
  retain their original profiles and access checks. The separation itself does
  not disable or raise any rate limit; the requested capacity change is below.
- The builder hydrates only referenced stimuli. Full previews share the same
  four-request queue as thumbnails and reuse their in-flight request.
- Publication messages explain inventory errors and 429 waiting time without
  automatic replay of a write. Existing drafts/links are retained.
- Updated the builder/stimuli script cache tags. No model changes, new runtime
  dependencies, schema changes or migrations are required by this hotfix.

## Verification

- Full API: 1,055 passed, 9 conditional skips, 0 failures.
- Disposable PostgreSQL: 86 passed, no skips/failures. New HTTP regressions
  create a migrated inventory, publish and republish without visiting storage,
  create an invitation and open it. Negative tests cover missing legacy files,
  actual quota excess and transactional rollback.
- Targeted quota/media/rate tests: 41 passed. Exhausting 300 media requests does
  not prevent protocol save or invitation creation; media and write limits both
  remain enforced, with Retry-After on rejection.
- Browser publication/media regressions: 123 passed, 3 conditional skips across
  Chromium, Firefox and WebKit. Queue/selection tests rerun separately: 6 passed.
  These overlapping counts must not be added as unique checks.
- Complete staff browser regression after all edits: 422 passed, 7 conditional
  skips, 0 failures across Chromium, Firefox and WebKit.
- Browser typecheck, JavaScript syntax and diff checks passed. Public staging
  validates 284 files. Emotion/FACS and model checksums match the prior record.

## Acceptance and limits

### Requested capacity increase

After the publication fixes, the user separately requested larger limits.
Local defaults and `.env.example` now agree on:

| Limit | Before | After |
| --- | --- | --- |
| Ordinary API requests per minute per IP | 300 | 600 |
| Media reads per minute per IP | 300 | 1,200 |
| Retained media per organization | 1 GiB | 10 GiB |

Login remains 20 requests/minute/IP. Ingest, single-file size, four concurrent
browser reads, server decoder/upload concurrency, free disk reserve and browser
block cache are unchanged. A larger quota does not reserve disk space or remove
actual-capacity checks. The quota includes all projects, retained versions and
posters in an organization. Explicit environment values still override defaults.
An operator must inspect/update the three corresponding variables on an
existing server; no production configuration was inspected or changed here.

After the capacity change: all 40 targeted quota/rate tests passed; the full API
suite passed 1,059 tests with 9 conditional skips and no failures. The separate
PostgreSQL integration rerun passed all 86 tests without skips or failures.

This is local verification, not a production repair. The affected researcher
must preserve the local draft/site data until the fix is released. After release
retry the same draft once and check the invitation and exact publication version.

The online measurement bound of 500 unknown objects per organization remains.
Larger inventories need a separately controlled server-side measurement in
batches; missing files need repair. Never set unknown sizes to zero, delete
stimuli to bypass the guard, or disable the quota check.

Large legitimate libraries can still encounter the bounded media budget. This
hotfix removes unrelated original downloads and protects save capacity; it does
not promise unlimited reads, offline persistence or automatic retries of writes.

Operator verification must inspect the affected organization's unknown-size
rows and file availability before declaring that particular production case
resolved. Do not change its experiments or clear browser state for diagnosis.

## Follow-up: full stimulus path and real HTTP load

The heatmap reader also used unbounded parallel downloads. Its media cache now
has four shared download slots, including simultaneous report requests. The
versioned URL remains the cache key; duplicate references use one in-flight
request. A generation check runs after a queued task receives its slot, before
it sends authenticated traffic, and again before it creates a Blob URL. Old
queued tasks cannot run under the next account. Failures release their slot;
one unavailable background does not discard other heatmaps or their data.

The full route is: reserve upload and verify bytes/type/quota; retain an
immutable original and decoder-validated poster/metadata; pin that version in
the publication; prepare and decode participant media before a trial; resolve
heatmap backgrounds from the same published version, not the current library
replacement. Audio has playback validation but no invented spatial image/AOI.
Built-in visual stimuli use the shared standard-stimulus definitions.

An isolated PostgreSQL-backed API was constrained to 2 CPUs and 1 GiB RAM,
with a separate PostgreSQL container at 2 CPUs/768 MiB. Test files are synthetic.
There are 600 library entries: 24 files pass through actual upload admission,
multipart transfer, native decoder and poster generation; 576 additional
fixture entries have distinct physical originals, real version rows and quota
accounting. They are not claimed as 600 end-to-end uploads. Each PNG original
is 230,653 bytes. The protocol contains all 600 originals in five blocks.

The recorded run accepted all 1,134 normal HTTP requests (1,084 status 200 and
50 status 201), including 60 protocol-name saves interleaved with the read
burst and one full-definition save after media exhaustion. The media burst
contained 600 authenticated originals, 300 previews and 120 invitation-scoped
originals: 1,020 reads / 182,175,660 response bytes in 1.68 s. Media p50 was
6.43 ms, p95 25.80 ms, maximum 45 ms; all originals matched their SHA-256.
These are warm local-loopback measurements, not WAN/server-capacity promises.
There were no 429/5xx responses in the normal phase.

Another 180 reads exhausted exactly the 1,200-read window; the next request
returned the expected 429 with profile `media` and Retry-After. Protocol save
still returned 200. The independent 600-request action budget was then
deliberately exhausted and also returned 429/Retry-After. Limiter rows were
neither reset nor disabled during this benchmark. All defaults, including
20 authentication requests, 60 ingest requests and production storage/concurrency
limits, were unmodified. No actual 10 GiB allocation test was performed.

The functional browser suite is a separate test, not load evidence. Its
synthetic-account login budget is explicitly higher because it performs many
valid fixture logins. Each browser starts with a fresh rate window in the
disposable database, as in independent CI jobs; media/action/ingest budgets
remain the defaults. A combined unpaced preliminary run legitimately hit the
ingest/action limits while creating dozens of sessions within a minute. This
was not treated as a missing-file bug or fixed by disabling production guards.

Final verification after adding the heatmap queue and load harness:

- Real-API browser workflow: 13/13 per Chromium, Firefox and WebKit (39 passed,
  no skips/failures). Includes JPEG/PNG/GIF/WebP, MP4/WebM, WAV/MP3/OGG,
  private/project access, actual playback, result ingest, mobile/desktop and
  fullscreen geometry. In the 800x200 image case the library original is replaced
  by a 1x1 file after publication; participant display and heatmap still decode
  the old 800x200 version, and a peer cannot read the new private replacement.
- Related browser regressions: 174 passed, 3 conditional skips, no failures,
  across all three engines. Covers built-ins/AOI, actual decoding, media errors,
  bounded retries, 63/360-image invitations without duplicate downloads,
  four-slot heatmap hydration, and queued work retired on account change.
- Full API: 1,061 passed, 9 conditional skips, no failures. The two new
  load-script tests reject unsafe destinations/configurations and check report
  percentiles. The earlier full PostgreSQL integration rerun remains 86/86.
- Public staging verified all 284 files. Typecheck, JS/Bash syntax and diff
  checks passed. Emotion configuration/FACS and face/pose model checksums remain
  unchanged. Physical camera/microphone capture was never requested.

The API/DB test containers were stopped by the harness. The existing local
application and its database were not stopped or modified. Browser engines on
this Mac are not a physical Windows/Linux device certification. Large files,
slow networks, media codec support and a block exceeding the managed browser
media budget can still produce an explicit preparation error; no universal
absence of errors or unlimited offline storage is claimed.

## Reproducing the real media load test

Prerequisites: Docker, Node >=22, installed API/autotest dependencies and the
Chromium/Firefox/WebKit Playwright browsers. Use a clean test worktree without
`apps/api/.env`: that file overrides process environment and is refused by the
harness. Do not use production credentials or a production database.

From the repository root, build a local API image with the native decoders and
ensure the official PostgreSQL image is available:

```sh
docker build -f docker/api/Dockerfile -t wecog-api:media-check .
docker pull postgres:16-alpine
MEDIA_TEST_API_IMAGE=wecog-api:media-check bash apps/autotests/scripts/check-stimulus-workflow.sh
```

The harness mounts current code read-only, creates its own containers/database,
uses an ephemeral loopback API port and a separate static port 4237, runs the
load script and browser checks, and stops only containers it created. The user's
ports 3000/4173/5432 are not used. A private temporary directory retains the
synthetic fixture and evidence; it must not be published with credentials.
The benchmark command `npm run load:stimuli` generates its own synthetic PNG
and test accounts. It writes the browser fixture to a new file at
`LIVE_STIMULUS_FIXTURE` for the subsequent browser checks. The benchmark has
additional explicit guards:
test environment, acknowledged disposable database, matching loopback test URL,
PostgreSQL limiter and unchanged rate defaults. It refuses production/remote
targets rather than offering an override. This manual destructive fixture test
must not be pointed at an ordinary developer database.

## Release and rollback

The PR targets `develop` only; merging or deploying `main` is a separate user
decision. No schema migration, model weight or scientific threshold changes are
included. On release, inspect the effective API environment and proxy limits;
set the three capacity variables explicitly if older values are still present.
Preserve originals, previews and historical versions, then retry the affected
draft once and verify participant display and the same session's heatmap.

Rollback is a code revert/redeployment, not data deletion. Keep the explicitly
configured storage capacity at or above existing usage: reverting the default
to 1 GiB after accepting larger libraries would block further writes. Do not
zero unknown inventory, remove historical files or disable access/rate checks
to recover a release. Existing publication links and stored session data must
remain intact.
