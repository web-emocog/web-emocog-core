# Media Preparation: Bounded Concurrency And Decoder Cleanup

Date: 2026-11-04. Local continuation of issue 132, same dirty branch
`fix/issues-132-144`. No push/deployment, real account, camera or microphone use.

## Finding And Fix

The existing invitation request pool limits fetch/body reading to three active
requests. The surrounding `Promise.all(rows.map(...))` does not bound the full
preparation: downloaded files can continue decoding while further files download.
Temporary video/image probes also lacked consistent source/decoder cleanup;
the previous video metadata timeout did not remove its handlers.

`media-preload.mjs` now provides:

- An ordered mapper with three complete preparations in flight, including fetch
  and decode. It starts no new rows after an uncaught mapper failure and drains
  existing work before rejecting. The shared HTTP request pool and 429 retry
  behavior are unchanged; there is no nested acquisition of that same pool.
- Image decoding and video metadata validation before marking a file ready,
  with the existing 15-second per-probe deadline and positive-dimension checks.
- Cleared event handlers/timer and detached temporary source on success, decode
  failure, invalid dimensions or timeout. Video probes are paused and reset by
  `load()` after removing `src`; successful Blob URLs remain owned by the
  invitation cache. Failed URLs are revoked once. Late decode results cannot
  restore an expired probe or revoke a cached successful file.

The reset/abort role of media `load()` is documented by
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/load).
The readiness/decode-failure contract is documented by
[MDN image decoding](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode).
These APIs do not guarantee an immediate decrease in total browser/GPU RSS.

No change to total protocol/file upload limits, number of allowed stimuli,
camera/model settings, scientific thresholds, response keys, publication links,
stimulus geometry, RT onset recording or original API fallback on media failure.
All successful binaries are still cached for the current publication. This does
NOT implement a disk-backed cache or a total retained-Blob memory budget.

Only `app-updated.js`, its new helper and the HTML entry need `20261104-1`;
the previously verified library/runtime singleton tags remain unchanged.
Persistence tests now import the canonical app entry rather than a duplicate
module under an obsolete query version, and can run on an isolated loopback port.

## Verification

Thirteen new unit cases cover a 500-row ordered batch, the unbounded reference
mapper versus a peak of three new preparations, failure draining, null rejection,
image/video success, error, invalid size, timeout, late image decode, decode
rejection, empty files and mismatched MIME. Success tests explicitly check that
cache URLs are not revoked while temporary probes are released.

Three-engine browser checks include:

- 63 and 360 images, with deliberately delayed native decoding to expose excess
  concurrency. Decoding and downloads both peak at no more than three. All
  prepared probes have detached sources and cleared handlers.
- A real 429/retry path, no duplicate downloads after the intro/consent transition,
  transient media failure, published-version replacement and revocation of old
  cache URLs, without requesting a new invitation link on a rate limit.
- Actual image and WebM probe cleanup, while the returned Blob URLs remain
  readable. All fixtures are tiny synthetic media, not participant recordings.
- Consent/admission recovery, interrupted trials, rolling IndexedDB history,
  network failure, final delivery retry with the same finish key, and reload
  preserving earlier RT results.

Final results on the same source snapshot:

| Suite | Passed | Skipped |
| --- | ---: | ---: |
| Full API unit suite | 652 | 5 |
| FPS, QC and buffer ownership | 54 | 0 |
| Worker, runtime and security | 231 | 0 |
| Staff, publication, access and attempt analytics | 282 | 3 |
| Creation, precheck and response instructions | 60 | 0 |
| Invitation media and persistence/recovery | 57 | 0 |

The browser total is **684 passed**, three existing cookie-fixture skips,
across Chromium, Firefox and WebKit, retries zero. The earlier initial 18
media-only cases overlap the final 57 and are not added to this total. All five
browser commands and TypeScript completed successfully. Syntax checks passed
for all 44 changed JavaScript/module files, as did `git diff --check`.

SHA-256 verification confirmed that all 67 changed runtime/library/test files
stayed unchanged throughout the final broad run. The source manifest is private
(`source-hashes.json`, 72 files including guidance/reports); the final manifest
also includes this completed report. The separate audit worktree was not copied
or edited. These checks do not imply that unexecuted real-device or integration
scenarios passed.

The API skips remain two native PDF checks, one Linux media-wrapper check and
two real-nginx checks. PostgreSQL integration is not enabled in this unit run;
earlier DB results are not being relabeled as fresh verification.

## Limits

The work bounds temporary preparation, not all retained files. Large invitations
can still retain many successful encoded Blob files; that needs a separately
tested cache policy preserving pinned versions, offline/reload behavior and
scientific presentation readiness. No claim is made that every low-memory
machine is safe or that Firefox now meets the 25-FPS requirement.

Private synthetic test results/configuration/logs:
`/private/tmp/wecog-20261104-media-memory/`.
