# Bounded Participant Stimulus Preparation

## Scope

Local implementation for large-protocol stimulus loading (#2). Only participant
preparation/playback modules and new targeted tests/docs are changed. No API,
checkpoint schema, state machine, researcher frontend, dependency, or scientific
quality threshold changes are required by this implementation.

## Behavior

- Invitation lookup retains a metadata manifest, not all protocol binaries.
  Only the first referenced media block is warmed at entry. Subsequent blocks
  prepare on instruction screens, before `beginBlock` or any trial timer.
- `media-cache.mjs` defaults to a 256 MiB managed encoded-byte budget. A cache
  serializes complete download/hash/probe operations and reserves three times
  the incoming file bytes for download chunks, Blob construction, and hashing.
  Previously cached unpinned files are evicted LRU as necessary. Known-size
  uncached files are prepared largest first to reduce workspace pressure.
- The request pool still caps invitation requests at three and preserves the
  shared bounded Retry-After cooldown. Serial file preparation is intentional:
  it avoids three simultaneous full video workspaces/decoders.
- All distinct keys needed by the active block are pinned before playback.
  Repetitions/aliases with the same key share one URL and one download. Keys
  include invitation/publication scope, source, stimulus version, SHA, MIME and
  declared size. Different sources/versions remain separate even if bytes match.
- A block cannot silently exceed the budget, split into smaller scientific
  blocks, skip files, reduce resolution, or switch to network streaming. A block
  that cannot fit its local bytes plus preparation workspace gets a recoverable
  explanation and a retry action before trials. This is a resource budget, not
  a limit on stimulus count, task duration, or scientific quality.
- Sizes are checked when declared; nonempty SHA-256 declarations must be valid
  digests and must match the downloaded bytes. Legacy missing hashes are allowed
  but do not acquire an invented integrity guarantee. Source/version checks are
  retained, with no reuse across publication tuples.
- Images/videos in timed playback must have a prepared local handle. Direct-URL
  error fallback is removed, including the StandardStimuli fallback property.
  Existing local render/play readiness and the existing `performance.now()` RT
  onset remain in place. No QC/analysis cadence or thresholds are lowered.
- Complete file bytes are required for videos. The response body is read
  incrementally, accounted and cancelled on overflow, scope abort, or deadline.
  No Range/MSE/direct-URL strategy is used in timed trials. Temporary video
  metadata probes are paused, detached and unloaded; image probes are detached.
- Preparation is single-flight per block. Superseded operations cannot bind
  stale trial handles. Disposed scopes cannot update their manifest/status.
  Disposing a cache does not revoke pinned playback: the owner must release its
  lease after removing media sources. An old owner's late release cannot clear
  a newer binding on a reused trial object. Only cache-created URLs are revoked;
  user-owned source Blob URLs are never revoked.
- Switching invitation/publication while media are pinned is rejected before
  replacement. Unpinned old work is cancelled/drained before allocating the new
  scope, rather than overlapping two full preparation workspaces.

## Readiness And Recovery

`state.runtime.invitationMediaStatus` reports `preparing`, `ready`, or
`unavailable`, plus the warmed block ID and cache counters. `ready` means only
that identified warm block, not the whole protocol. Manifest rows expose
`mediaReadiness` and a `metadata.url` only while their cache handle is retained.

`state.runtime.blockMediaStatus` reports `preparing`, `ready`, `unavailable`
(with a recoverable error code), or `released`. Task instructions announce
readiness via a status region; failed preparation changes the action to Retry
preparation, without starting a trial or asking for another invitation link.

Successful partial preparation survives retry while within the budget. A fully
retained block can prepare without network access in the same page. Evicted or
not-yet-prepared blocks need a connection. Reload destroys the in-memory cache
and requires preparation again against the existing server-pinned session and
publication. No Blob URLs, leases, or readiness promises are checkpointed.
Existing interrupted-attempt/reload and final-ingest policies are not changed.
An arbitrary protocol is **not** promised to run wholly offline.

## Runtime Integration Hooks

The owner of `session-runtime/index.js` should integrate these without importing
a second query-version of a singleton module:

1. At terminal teardown/reset, after stopping measurement and before disposing
   media, call `state.runtime.stopCognitiveStimulusPlayback?.()`. The runner
   registers this callback and also exports `stopCognitiveStimulusPlayback()`.
   It cancels preparation/render/trial callbacks, detaches playback sources and
   releases block pins. It does not finish/ingest or change machine/QC policy.
2. Then call `state.runtime.invitationMediaPreparation?.dispose()` and clear the
   legacy `invitationStimulusObjectUrls` view. Optionally await
   `state.runtime.invitationMediaPreparation?.cache.whenIdle()` to drain abort
   cleanup. Do not revoke arbitrary user-provided URLs from the manifest.
3. Normal block completion, repeat, runner finish, restart, invitation switch
   and page unload are wired locally. The runtime hook is needed for independent
   session finish/reset paths which bypass the cognitive runner.
4. Keep caches/functions/Blob URLs out of checkpoint/ingest data. Only metadata
   and existing protocol progress should survive reload. No checkpoint changes
   are implemented here.
5. Coordinate entrypoint/helper cache tags as part of main integration. Existing
   tags are left for the integrating owner; new helper imports must use the same
   canonical URL in app, runner and tests.

The existing invitation-media browser fixture uses placeholder SHA strings such
as `synthetic-1-1`. Replace them with the actual PNG digest when integrating the
stricter integrity checks. Keep changed version/SHA/source negative cases; do
not bypass integrity verification to preserve placeholder fixtures. Tests which
assert eager whole-protocol loading must instead assert first/block readiness.

## Limitations

- Counters bound managed encoded bytes and conservative copy workspace, **not**
  process RSS, browser internal response chunks, garbage-collection timing,
  decoded image surfaces, video decoder/GPU buffers, or the protocol/manifest
  metadata itself. One temporary probe per cache is used; native decoder memory
  is not observable. Synthetic tests are not low-memory hardware acceptance.
- A full active block and its largest necessary workspace must fit. Preparing
  files does not guarantee every video frame is decodable or playback will never
  stall. Existing local playback failures remain technical failures, never a
  network fallback or a scientifically valid substitute stimulus.
- There is no persistent file cache, OPFS, service worker, or partial-video
  offline guarantee. Adding disk-backed playback needs separate storage quota,
  integrity, publication isolation, seek/playback, and real-device acceptance.
- Legacy direct image/video primary sources are fetched/probed ahead of their
  block, rather than loaded in a timed trial. They therefore need fetch/CORS
  access. Existing generated shapes/text need no media bytes. Missing numeric
  invitation references fail closed instead of becoming shapes.
- An aborted task already sleeping inside the existing shared 429 pool may
  occupy its pool slot until the bounded server cooldown ends. The caller
  cancels immediately, and the signal-aware adapter prevents a stale fetch or
  commit after that wait. The shared rate-limit cooldown is not bypassed.

## Validation

Targeted commands (no install, production access, capture, or human screenshots):

```sh
node --test apps/api/tests/block-media-cache.test.js apps/api/tests/media-preload.test.js apps/api/tests/invitation-media.test.js
node apps/autotests/node_modules/typescript/bin/tsc --noEmit -p apps/autotests/tsconfig.json
cd apps/autotests
node node_modules/@playwright/test/cli.js test --config=playwright.block-media.config.ts
```

The unit suite includes 4,000 synthetic files/200 blocks, many video-designated
files, exact peak-budget checks, repeated content, pinned eviction/disposal,
unknown-length video cancellation, offline/partial retry/reload, size/SHA/version
isolation, shared 429 backoff, pending decoder cancellation and external/body
deadline cancellation. Browser checks use a synthetic PNG and generated WebM,
including 80 real video probes, all three browser engines, multi-block transitions,
onset/results, failed-local-handle behavior and complete release. Camera/mic calls
are explicitly forbidden and screenshots/video/traces are disabled.

Full isolated-DB stimulus-live-workflow and system persistence suites remain the
integrating owner's gates. No hardware accuracy, low-memory-device benchmark,
or arbitrary all-offline acceptance is claimed. Rollback requires reverting the
owned media integration and coherently refreshing cache tags; it must not restore
a hidden timed network fallback as a purported recovery strategy.
