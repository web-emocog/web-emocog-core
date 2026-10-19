# Large protocol entry hotfix

## Incident and Scope

A published protocol referenced 63 JPEG stimuli. Production reported an ingest
budget of 60 requests per IP per minute. Invitation lookup, stimulus metadata,
all content GETs, admission and ingest shared that budget. Unbounded parallel
preloading exhausted it before the participant pressed Start; the next lookup
returned 429, incorrectly presented as a missing invitation.

This branch starts from origin/develop at e89370e. It does not include the
unpublished local observer, microphone, Dota pilot, monitoring or related changes
from the separate feature/local-observation-pilot working copy.

## Changes

- Separate bounded per-IP media profile for invitation stimulus list/content
  GET and HEAD only: MEDIA_RATE_LIMIT_PER_MINUTE, default 300.
- Authentication, invitation/admission/ingest limits, body parsers, file access
  checks, tenant scope, published content pins and database schema unchanged.
- Invitation-only request pool, at most three active requests, shared 429
  cooldown, numeric/date Retry-After, at most two retries per request.
- Retry-After exposed through CORS for separate-origin local frontend/API.
- Server waits longer than two minutes are reported rather than slept forever;
  the cooldown remains respected on another click. No automatic retry of
  401/403/404/410, other terminal responses or network errors.
- Reuse successful decoded blobs when another image failed. Reuse is limited
  to the same invitation/protocol/publication and matching media source/version/
  hash. Replaced blobs are revoked. Existing unavailable-media fallback remains.
- Exhausted invitation lookup cooldown is shown as temporary loading throttling,
  not an invalid link. Entry-module cache key updated.

## Verification

Regression cases cover 63-image entry with separate admission/ingest capacity,
bounded media exhaustion and different IPs, 360 reads across a real limiter's
window with a deterministic clock/store, 500 queued reads, shared cooldown,
HTTP-date/missing/excessive Retry-After, bounded retries and terminal errors.

Browser cases cover 63 and 360 uploaded images, temporary 429, actual decoding
and cognitive stimulus presentation, Start without duplicate downloads, partial
preload recovery, publication replacement and long cooldown without new requests.
Existing session-runtime tests cover consent, uploaded video, built-in stimuli,
offline/reload, checkpoints and idempotent final ingest.

Local results: 440 API/unit/security tests and 123 browser tests passed with no
failures, skips or retries. Browsers: Chromium, Firefox and WebKit. TypeScript
typecheck, static release audit, RT Python smoke and git diff --check passed.

No production sessions were started or modified. No new dependencies, migrations,
biometric collection, scientific thresholds or analytics changes are included.

## Rollout and Rollback

Ship API and frontend together through feature -> develop -> main. The default
media budget works without changing existing INGEST_RATE_LIMIT_PER_MINUTE.
An operator can configure MEDIA_RATE_LIMIT_PER_MINUTE for shared-network cohorts;
large protocols can wait across windows rather than require unlimited requests.
Rollback is a normal revert of the hotfix merge, with no data migration. It
restores the previous shared limit and therefore reintroduces the incident.
