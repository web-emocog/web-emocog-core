# S3-02: Audio module MVP in the common session

Date: 2026-08-19
Responsible: Valeria
Executor: Egor role (implemented in this branch)

## Result

The existing MIT `Audio_detection` core now runs as an optional background
participant module for the full measurement session. It is disabled by default,
requires separate participant consent and never stores or transmits raw audio.

## Changes

- Added deterministic browser ESM generation from the existing CommonJS core.
- Added protocol feature flags and researcher controls on the QC step.
- Added separate optional audio consent to the participant consent screen.
- Added `SessionAudioCollector` lifecycle: start, pause, resume, stop, dispose.
- Added AudioWorklet capture with ScriptProcessor compatibility fallback.
- Moved 10-second window analysis to a module Worker.
- Added QC for silence, clipping, short windows, sample rate and core OOD.
- Added monotonic window timestamps and block/trial/stimulus provenance.
- Added attempt/presentation provenance so repeated trials remain distinguishable.
- Added `audio_summary` to `SessionFeature`, `/ingest` allowlist and final export.
- Added server rejection of raw media fields and unknown audio-summary fields.
- Made final session teardown await audio analysis, track stop and AudioContext close.
- Added nginx media-permission/MIME deployment snippet.

## Technical inclusions

- Schema: `audio_session.v1`.
- Core algorithm version is included in every output.
- Accepted windows include compact acoustic features and marker scores.
- Rejected windows retain QC reasons but do not expose markers.
- Raw PCM remains in memory only until its window is processed.
- Worker failures are counted as dropped windows and cannot block final teardown.
- Worker analysis has a 15-second timeout; an ignored browser permission prompt
  does not block the video pipeline or final session completion.
- Condition/diagnostic flags from the standalone core are deliberately excluded
  from participant output to avoid presenting research proxies as diagnoses.

## Decisions

- Audio is optional rather than required because microphone consent is separate
  from camera/behavioral consent and denial must not block non-audio protocols.
- A pause closes the current audio window. This prevents one window from mixing
  instruction, pause and trial scopes.
- Production debug capture cannot be enabled by protocol JSON.
- Browser Worker analysis was selected over main-thread analysis to protect gaze
  and RT frame timing.

## Acceptance evidence

- Browser core output equals CommonJS core output on the same PCM fixture.
- Consent-off path makes zero `getUserMedia` calls.
- Permission denied remains `permission_denied` after finish.
- Silence, clipping and short windows abstain without markers.
- Duplicate stop is idempotent; tracks, Worker and AudioContext are released.
- Worklet setup failure falls back to ScriptProcessor, and a stream granted after
  finish is immediately stopped instead of reviving the module.
- Chrome and Firefox browser tests pass consent, Worker lifecycle and privacy.
- Chrome and Firefox frame-throughput tests pass the no-more-than-20% degradation
  gate while a 10-second window is analyzed.
- Aggregate payload passes `/ingest`; injected PCM/raw-media keys are rejected.
- Full API regression: 170 passed, 0 failed, 0 skipped.
- Full Chromium/Firefox regression: 144 passed, 0 failed, 18 explicitly
  skipped integration scenarios that require the separately started API.
- Sprint 3 browser suite: 10 passed, 0 failed; TypeScript check passed.

Automated commands:

```bash
cd apps/api
node --test tests/audio-session.test.js tests/final-aggregate-contract.test.js

cd ../autotests
npm run typecheck
npx playwright test tests/sprint3-audio-multimodal.spec.ts
```

## Rollout and rollback

1. Deploy static Worker, Worklet, browser bundle and `.mjs` MIME configuration.
2. Keep `settings.featureFlags.audio=false` for existing protocols.
3. Enable audio only in a pilot protocol after legal consent text approval.
4. Monitor `permission`, rejected windows and dropped windows, not raw signal.
5. Roll back operationally by disabling the protocol audio flag; no DB migration
   is required because the new typed fields are nullable.

## Formal acceptance

All code-level acceptance checks are complete. Real-device microphone quality
must still be sampled across the team's target laptop/headset matrix before a
production protocol enables the feature. Formal responsible and lead sign-off
remain organizational steps.
