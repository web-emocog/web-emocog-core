# Windows FPS: mask ownership and processing headroom

## Scope And Evidence

Follow-up for #132 and #151, based on develop
`51c3c3709876dc73473f46a5685989a0b7344b65`. This is not a declaration that
Windows FPS is fixed. Real-device acceptance is still required. No changes to
the photodiode ingest 422 issue, #177 valid-time behavior, or PR #183 merge.

The supplied Windows run kept camera delivery near 29-30 FPS while analysis
averaged 16.416 FPS. Completed primary processing averaged 60.337 ms; the face
stage averaged 59.126 ms, with 51.815 ms inside the model call. The comparable
Windows Chrome/Edge issue attachments also separate camera cadence from
analysis: 15.849/21.580 FPS, primary mean 59.988/37.769 ms. That paired comparison
used the same legacy profile within the pair, not the newer run's v2 profile.
These observations locate the main deficit in processing, not camera delivery. They do not prove
which driver, power, thermal, or browser behavior caused the deficit. No raw
participant recordings, identifiers, tokens, or exports are checked in.

## Changes

- Consume MediaPipe segmentation masks inside its synchronous callback. The
  return-value overload clones all output masks, including unused confidence
  maps. Keep the owned category byte copy needed by derived face-region QC and
  one GPU face-skin confidence clone, closed inside the callback. That one copy
  preserves the old copy/readback rounding on software GL; all other output
  clones are avoided. Do not retain or manually close borrowed MediaPipe masks.
  The runtime releases them before an error can trigger the existing CPU retry.
- Separate face draw, readback, model-call, and derived calculation times.
  The same image, models, resolution, timestamps, and formulas remain in use.
- Record a fixed-size 1 ms latency histogram (1002 buckets, 8016 bytes), never
  per-frame history or pixels. Publish nullable mean/p95/p99/max summaries only.
  The overflow bucket conservatively reports the observed maximum.
- Engineering headroom is mean <=25 ms, p95 <=30 ms, p99 <=33 ms with >=60
  completed primary frames. This is separate from scientific QC. Precheck uses
  a shorter eight-sample minimum for a non-blocking face-processing warning.
- Extend the private, loopback-only reference comparison to up to ten minutes,
  five-second windows, p99, and explicitly forced face CPU/GPU diagnostics.
  Assert the actual delegate; do not silently change the participant policy.
- Extend the strict API schema and TypeScript contract for additive telemetry.
  Reject unrecognized fields; continue accepting old payloads without it.
  Propagate cache tag `20261123-fps1` through the public dependency closure.

The pinned MediaPipe 0.10.14 runtime and model hashes are unchanged. Callback
ownership follows the [vendor API](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.imagesegmenter);
vendor code is not patched. Reference media
is the existing pinned `kyegorov/mcd_rppg` CC-BY-4.0 cache, revision
`bf59b3cd1414c2a510d83c3125f16bb87d469ebb`, Egorov et al. (2025),
doi:10.1145/3746027.3758255. It remains outside the webroot and repository.

## Verification

Full machine-readable evidence: [benchmark JSON](2026-11-23-windows-fps-headroom-benchmark.json).
The initial ten completed measurements used Apple M4 Pro/macOS and the same 640x480
locked reference video; they are not Windows hardware or scientific accuracy
acceptance. Paired 30-second runs alternate order (before/after, after/before)
with fresh browsers, equal weights/profile, and no physical sensors/uploads.

| Measurement | Result |
| --- | --- |
| Canvas source, Mac default segmentation policy, before x2 | 20.66 / 24.80 analysis FPS; source-limited, gate fails |
| Same canvas source, candidate x2 | 19.47 / 22.50 analysis FPS; source-limited, gate fails |
| File-backed camera + GPU segmentation, before x2 | 29.00 FPS; primary mean 11.44 / 11.58 ms; both gates pass |
| Same file-backed camera + GPU, candidate x2 | 29.00 FPS; primary mean 11.55 / 11.63 ms; both gates pass |
| Candidate, five continuous minutes, GPU | 8700 frames, 29.00 FPS; primary mean/p95/p99/max 11.89 / 16.60 / 20.10 / 28.90 ms |
| Five-minute stability | all 60 complete five-second windows at 29 FPS; no <25 FPS full-second window; zero module errors; UI p95 1.50 ms |
| Explicit CPU face diagnostic, ten seconds | actual delegate CPU, 290 frames, 29.00 FPS; primary mean/p95/p99 13.47 / 16.30 / 17.20 ms |

**No before/after speedup is demonstrated on this host.** The removed copies
are verified directly rather than inferred from noise in average FPS. This
cannot establish recovery of the Windows bottleneck. GPU segmentation is an
explicit local diagnostic override on this Mac; production policy is unchanged.
The five-minute/CPU runs explicitly mark the repeating finite source and report
no source-clip elapsed PTS. Earlier short fake-camera runs expose a continuous
fake-stream clock, not source PTS; the evidence file records that limitation.

An initial comparison failed during imports because its private server/snapshot
omitted the newly shared #177 helpers. The harness allowlist and frozen snapshot
were corrected before the ten completed measurements. No observations from that
failed import-only probe are counted. The first full API run exposed outdated
VM imports, callback-owner mocks, and version-specific test imports. These were
updated to exercise the new API, retaining the existing cleanup/privacy/QC
assertions.

### CI Follow-Up

Initial CI found a real compatibility gap in the proposed zero-copy path:
software GL changed average face confidence by about 4.3e-10 in the fixture,
even when comparing one inference through the same MaskReader. Category bytes
and visibility agreed, but exact confidence compatibility did not. The final
implementation retains just the used GPU confidence clone (one rather than
seven output clones). No tolerance or QC threshold was relaxed. The ten initial
benchmark runs above measure the earlier revision, not this corrected final
implementation; a new long run is required and recorded separately below.

Windows smoke also found that Python's system MIME associations made `.mjs`
files non-executable despite HTTP 200. The loopback test handler now explicitly
serves JavaScript/WASM types. A regression test poisons both the extension table
and OS MIME map; actual HTTP HEAD checks run in each browser. This is a test
server correction, not a deployment server or Windows driver change.

The Chromium browser job timed out while downloading PulseAudio dependencies,
before executing native media tests. Installation now has a bounded 360-second
command inside an eight-minute step; daemon/sink commands each have a 15-second
deadline. Signed repositories and all browser/media checks remain required.

Local results before the CI follow-up: API 1392 passed, 10 skipped; Worker/
runtime/browser matrix 312 passed; FPS diagnostics 84 passed; #177 integration
36 passed. Typecheck, release audit, public staging (297 files), and warm-cache
upgrade passed. The skipped API cases need separate PostgreSQL/HTTP, converter,
Linux or nginx environments; they are not counted as passed tests. Hosted
PostgreSQL/migration/ingest and API/security checks passed on the initial commit.

Reproduce the benchmark from a private licensed reference cache and a frozen
develop snapshot (including `apps/shared/`), outside the webroot:

```sh
WECOG_BASELINE_ROOT=/private/frozen-develop \
WECOG_REFERENCE_ROOT=/private/mcd-rppg \
WECOG_BASELINE_PROFILE=v2 \
WECOG_PIPELINE_VARIANTS=before-v2-no-body,candidate-v2-no-body \
WECOG_PIPELINE_BROWSERS=chromium \
WECOG_PIPELINE_REPEATS=2 \
WECOG_PIPELINE_SEGMENT_DELEGATE=GPU \
WECOG_PIPELINE_FAKE_VIDEO=/private/reference.y4m \
node scripts/reference-data/compare-pipeline.mjs
```

For the long run select only `candidate-v2-no-body`, one repeat and
`WECOG_PIPELINE_MEASURE_MS=300000`. The tested CPU diagnostic additionally sets
`WECOG_PIPELINE_FACE_DELEGATE=CPU`. Neither setting changes production defaults.

## Rollout And Rollback

Deploy the compatible API schema before the updated participant web bundle;
otherwise its closed old schema rejects the new telemetry. Old clients remain
compatible. Reopen a prepared invitation after the web update; do not replace
an active participant session midway through a protocol. The versioned import
closure prevents old cached modules from silently retaining the previous path.

For rollback, revert the client optimization/cache bundle while retaining the
additive server telemetry compatibility until outstanding sessions have been
delivered. Do not roll back to a server that rejects in-flight new telemetry.
No data migration, auth, access-control, or model-asset changes are needed.

## Remaining Acceptance

On the affected Windows laptop, compare Chrome and Edge with the same protocol,
camera/lighting, profile, and power mode. Collect camera vs analysis FPS and
primary p95/p99 over at least five minutes, not just an initial average. Test
both default face GPU and diagnostic CPU paths before considering any device
policy change. Required operating margin is below 40 ms; unchanged protocol QC
must still reject actual insufficient quality. Keep #132/#151 open until this
evidence is available. A synthetic stream or Mac GPU pass cannot close them.

The changes remove provable unnecessary work but cannot guarantee recovery of
the Windows 38-60 ms face bottleneck. GPU driver/software-rendering and thermal
causes remain unconfirmed without measurements on that device.
