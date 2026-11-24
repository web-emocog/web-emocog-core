# Face-loss recovery, publication #186 and FPS headroom

## Scope

Follow-up to PR #185, targeting develop only. The separate server-compatibility
hotfix #187 is merged into this branch with a normal merge, preserving authors.
No deployment, production upload, invitation visit, history rewrite or merge to
main is part of this verification. No new model, dependency or migration.

## Recovery after face loss

- Existing sustained `face_missing` (1500 ms) after personal calibration sets a
  durable local recovery gate. A returning face alone cannot restore trust.
- The primary pipeline withholds gaze outside calibration/validation while the
  gate is pending. Valid-time and trial-quality paths retain the exclusion.
- The active trial is not paused. Before the next block/retry, a localized
  explanation leads to three noncollinear repair targets, three captures each,
  and the existing independent validation with unchanged acceptance thresholds.
- Geometry changes require a full calibration, rather than mixing coordinate
  systems. Successful validation resumes the waiting runner, not the protocol
  entrypoint, restoring the original visible/hidden layout. Hidden continue
  buttons cannot bypass failed validation.
- A failed durable save cannot start recovery. Cancellation preserves the gate,
  accepted results and retry queue; retries are consumed after acknowledgement.
- Calibration preparation drains the precheck's single in-flight frame before
  taking ownership. A precheck delegate comparison cannot install a new model
  after calibration has started collecting captures.
- `calibrationRecovery` is checkpoint state, not an arbitrary ingest extension.

## Publication and retained uploads (#186)

The attached archive contains an older recording's exact retained final packet,
not the unavailable recording from the screen video. Current main rejects its
photodiode `stimulusName` event fields. The #187 contract accepts the unchanged
retained packet without recomputing measurements. This does not prove recovery
of a different missing file/tab, deployment of the server fix, or production
delivery. Expired tokens still use the existing same-session refresh rules.

Publication has an independently reproduced PNG eligibility contradiction:

1. A legacy PNG without cached decoder metadata was checked for static-image
   eligibility before immutable pinning/decoding supplied that metadata.
2. Decoder facts were then lost from the saved manifest/public invitation, so
   subsequent invitation validation could reject an otherwise valid protocol.

Structural/AOI checks and write-access locks remain before pinning. Final media
eligibility is checked after pinning/decoding. Only decoder facts validated for
the exact version SHA-256 enter the manifest. The public projection retains only
typed codec, duration, frame count and animation facts, never paths/probe errors.
Client manifests still cannot choose or authorize a server version. Existing
invitations are not rewritten. Animation, private/foreign media, invalid timing
and manual-extension incompatibility remain errors.

The builder now preserves a bounded typed preflight error and shows human
reasons in the existing correction dialog. Failure keeps the draft and previous
invitation and does not create an invitation. The exact failing `test_pass_v2`
definition/HTTP response was not supplied; the reproduced PNG bug is not claimed
to be the only possible cause of that unseen definition's failure.

## Precheck-only delegate selection

A bounded Worker probe tests CPU only after eight real face-detected GPU calls
average over 20 ms. It compares eight alternating pairs on the same immutable
frame, with one CPU warmup and a separate canvas, same weights and model options.
CPU is selected only with mean <=20 ms, max <=25 ms, gain >=3 ms and >=20%.
It is not a blanket Windows/CPU rule. Fast GPU paths do not create a candidate.

The probe checks a 1200 ms total deadline between synchronous calls and bounds
asynchronous initialization. Native synchronous calls cannot be preempted by a
JavaScript timer; the existing outer Worker timeout remains the final boundary.
Late/rejected candidates are closed; errors retain the working GPU. Probe frames
are not participant samples. Selection is forbidden during calibration/protocol.
No new adaptive cadence, resolution reduction or relaxed scientific QC.

Optional `face_delegate_probe.v1` telemetry is typed and bounded in JSON Schema
and TypeScript. It contains only the decision, paired timing summaries and fixed
budget. `session_feature.v1` remains backward-compatible; deploy the new API
schema no later than the new static client. New static dependencies use cache
tag `20261124-recovery1` and are included in the public asset manifest.

## Verification

- Targeted Node suites: 61 passed, including delegate failures/cleanup, bounded
  contracts, public projection privacy and cache/UI/reference-harness contracts.
- Full API suite with `--test-concurrency=2`: 1417 passed, 11 explicitly gated
  tests skipped, zero failures (1428 total). No product deadline was increased.
- Isolated PostgreSQL/media integration suite: 91 passed, 1 explicitly gated
  backup/restore test skipped. Actual publish -> invitation -> PATCH -> unchanged
  prior invitation is covered, including rejected manual/999 ms configurations.
- Builder regression: 21 passed across Chromium, Firefox and WebKit.
- Warm-cache upgrade: all four entry/dependency combinations passed.
- Release audit passed; further final suite results are recorded below/in PR.
- Recovery scenarios: 15 passed across Chromium/Firefox/WebKit. The virtual
  source is quantized at 67 ms; the actual sampler still polls at 33 ms and
  explicitly checks distinct captures, duplicate rejection and all 14 targets.
  macOS-only functional-test wall timeout accommodates native timer yields;
  processing/FPS gates and participant sampling are unchanged. A separate local
  broad Worker run was intentionally interrupted (12 passed, remainder not
  counted); the required Linux matrix supplies the independent full run.

The first follow-up CI reached green API, database and CodeQL gates, but both
browser jobs failed before tests: the bounded 360 s audio-package install still
downloaded from the observed slow EC2 mirror. The runner uses
`mirror+file:/etc/apt/apt-mirrors.txt`, not only direct APT source URIs. The action
now also routes that mirror list (and its security-list sibling if present),
with a regression test for priority tokens and unchanged publisher keys/suites.
No unauthenticated packages, third-party mirror, disabled test or unbounded wait.
Windows smoke also includes the new device-free recovery tests; a hosted VM is
not a substitute for the researcher's laptop.

The first unrestricted local API run had three timing failures under heavy host
load (mock container startup, abort timing and bounded media output), and one
Chromium virtual-clock validation test timed out. These are retained as failed
attempts, not silently counted as passes. Product deadlines/QC are not relaxed;
the full API suite is rerun with bounded test-process concurrency and browser
suites run separately.

## Performance evidence and limits

Local real-model clip A/B is not Windows acceptance. An initial pair
reported baseline/candidate analysis FPS 21.40/13.99; a two-round order-reversed
repeat reported baseline 9.59/3.03 and candidate 18.87/13.99. Source delivery
fell with analysis and primary/UI tails varied substantially. Other graphics
applications were active on the shared host; their processes were not stopped.
The video-to-canvas adapter adds overhead. Neither these inconsistent numbers
nor the deterministic synthetic GPU/CPU selection test demonstrates a Windows
speedup. The probe did not activate on this active-protocol A/B path.

Real-device acceptance remains open: the problem Windows laptop, camera source
cadence versus completed analysis cadence, primary mean/p95/p99, UI latency,
valid face/gaze coverage, exact backend and sustained 3/5+ minute passive trials.
Chrome/Edge GPU/driver evidence is unavailable. Keep FPS issues open until that
device evidence passes; do not describe this PR as solving every FPS regression.

## Rollout And Rollback

Review #187's compatibility fix independently if urgent. Review #185's combined
diff, require release/security gates, then test new invitations and a retained
packet on staging. Do not refresh an irreplaceable old result tab to load a new
client. A server compatibility fix can accept its existing packet unchanged.
Production deployment and main merge remain the user's decision.

Rollback by normal reverting the follow-up commit, not rewriting authorship or
history. Preserve #187 compatibility separately so legacy uploads keep working.
Existing immutable publications/invitations and stored measurements are not
backfilled or changed by this fix.
