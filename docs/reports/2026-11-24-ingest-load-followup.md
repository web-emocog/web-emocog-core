# Ingest Retry and Windows Load Follow-up

## Changes

- A known `payload_schema_invalid`/422 checkpoint response starts a persisted
  five-minute retry cooldown **before** snapshot serialization. The local
  five-second durable checkpoint continues. Server status remains failed, never
  acknowledged. On expiry a fresh cumulative packet probes the current API;
  final delivery is never blocked. Other failures keep their existing behavior.
- `protocol_signals.v2` no longer requests the unused MediaPipe blendshape
  classifier output. Default/legacy callers and the developer eye-gate comparison
  retain SDK scores. Landmarks, transformation matrices, detection thresholds,
  cadence, resolution, gaze, landmark-based emotion/FACS, blink, rPPG and QC are
  unchanged. The choice survives Worker startup, CPU candidate creation and the
  classic fallback. There is no switch during an active trial.
- Optional bounded `meta.tech.framePipeline.faceOutputPolicy` records
  `landmarks_matrix.v1` or `sdk_full.v1` (null if unknown). JSON Schema and
  TypeScript agree. No migration, new dependency/model or raw biometric data.
- `scripts/windows/load-sample.ps1` adds opt-in, local read-only aggregate load
  sampling. It never changes priorities, timers, power, driver or registry
  settings. Missing counters remain null; process identities stay in memory.
  GPU load groups process instances per physical engine rather than summing all
  engines into an invalid percentage. Observer cost is included explicitly.
- Static import/cache closure uses `20261124-load2`. The delivery module gets
  the same new token. Existing recovery/publication fixes are retained.

## Verification

- Full local API suite (`--test-concurrency=2`, loopback allowed): 1425 passed,
  11 explicitly gated tests skipped, 0 failed. The first restricted run could
  not open local HTTP ports; it is not counted as a product pass.
- Output-policy/reference tests: 14 passed. Delivery/model/delegate/headroom
  targeted run: 33 passed. TypeScript and static release audit passed.
- Recovery suite, including the actual 1500 ms face-loss detector and identical
  GPU/CPU output settings: 15 passed in Chromium, Firefox and WebKit (26.5 s).
- Matched-frame experiment: the locked CC-BY-4.0 `kyegorov/mcd_rppg` replay,
  120 face-detected pairs plus ten warmup pairs per delegate, alternating order,
  same immutable 640x480 frame, full/core options. CPU run: zero differences in
  landmarks, raw transformation matrices, parsed face/eyes/pose/mouth/
  illumination. The final GPU run also found zero differences, including raw
  matrices. Reports retain counts and timing
  aggregates only, not frames, landmarks or participant files. Reproduce with
  `WECOG_REFERENCE_ROOT=<private-root> node scripts/reference-data/compare-face-outputs.mjs`
  and optionally `WECOG_FACE_OUTPUT_DELEGATE=CPU`.

Mean differences on this Mac were around 0.1 ms in either direction (CPU
7.89 vs 7.79 ms; final GPU 10.01 vs 10.11 ms). This is removal of unnecessary
work, **not evidence of a material or even repeatable FPS improvement**.
The precheck-only paired CPU/GPU selection, readback optimization, Worker
ownership and 25/30/33 ms mean/p95/p99 headroom gates remain separate earlier
changes. None converts missing/low-quality samples into accepted measurements.

## Limitations and Rollout

No real Windows camera, lab tracker or thermal/USB/driver load was measured on
this Mac. A hardware inventory, virtual CI host and replay do not establish
physical-device performance. Use the documented same-PC baseline/platform/
tracker/combined and camera A/B comparisons; the script's camera tag is not a
verified device identity. The optional GPU counter is feature-detected, not
guaranteed available. Do not infer an OS scheduling or camera fault from these
counters alone, or change monitor refresh rate as a purported fix.

The API compatibility fix from #187 remains necessary for old retained packets.
This checkpoint cooldown reduces a request storm but does not repair old tabs
or deploy a server. Deploy the full #185 API schema **before or together with**
the new static client: deploying only #187's old-packet hotfix is not enough for
the new optional telemetry. Existing same-session authorization, idempotency,
strict schemas, publication locks and invitation immutability remain enforced.

No production requests/imports/deployment, issue closures or merges are part of
this change. Keep PR #185 draft until checks and physical Windows acceptance.
Rollback is a normal revert of this follow-up commit and its cache/schema
closure, not rewriting author history or changing QC thresholds.

## Primary References

- [MediaPipe Face Landmarker options](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js): optional blendshape classifier output, distinct from landmarks and transformation matrices.
- [Microsoft local CIM queries](https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance): read-only local counter access and operation timeout.
