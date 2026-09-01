# S3-03: Multimodal gaze, affect and movement map

Date: 2026-08-19
Responsible and executor: Valeria role (implemented in this branch)

## Result

A shared, UI-independent multimodal package now synchronizes gaze with
emotion/engagement proxies, head pose and body movement. It produces per-
presentation layers and an explicit renderer contract without storing video or
landmarks.

## Changes

- Added common monotonic timebase based on
  `performance.timeOrigin + performance.now()`.
- Added session collector for baseline-relative head pose and OOD gating.
- Hardened MediaPipe body collection with normalized scale baseline,
  confidence/OOD/occlusion counters and bounded retained samples.
- Added density, valence, arousal, engagement-proxy and fixation-proxy layers.
- Normalized gaze against the actual stimulus rectangle, not the browser window.
- Added 100 ms nearest-sample alignment gate and missing-data preservation.
- Added Canvas renderer with independently selectable layers and legend.
- Added `multimodal_summary` and `multimodal_heatmap` to typed ingest/export.
- Added feature flags for multimodal, body movement and gamer mode.
- Added researcher protocol controls without changing the current visual design.
- Kept legacy gaze heatmaps and the new multimodal map consistent for repeated
  attempts, including retries after a quality rejection.

## Technical inclusions

- Schemas: `multimodal_session.v1`, `multimodal_heatmap.v1` and
  `multimodal_timebase.v1`.
- Head pose is computed separately from iris/gaze and stored as baseline deltas.
- Body samples contain torso center, velocity, lean and movement bursts only.
- Low-confidence gaze/emotion and OOD movement do not contribute to values.
- Unmatched emotion remains `null`; it is never replaced with neutral or zero.
- Retained head/body arrays are capped while full-session accumulators remain.
- Gamer mode is explicit and cannot be inferred from protocol type.

## Decisions

- Presentation identity is `block + attempt + trial + stimulus`; this prevents
  merging retries or unrelated displays of the same asset.
- Stimulus-space normalization is mandatory for brochure/image heatmaps. Browser
  viewport normalization would create systematic offsets and misleading AOI.
- Engagement and fixation are labelled proxies and include algorithm/version,
  QC and sample counts rather than being presented as ground truth.
- The shared renderer does not depend on researcher navigation or design so the
  frontend can integrate it without changing collection semantics.

## Acceptance evidence

- Synthetic alignment p95 stays at or below 100 ms.
- Low-confidence and missing emotion produce no-data layers.
- Stimulus rectangle coordinate test maps the known point to the expected cell.
- A simulated 15-minute, 10 Hz session retains at most 1,800 head samples while
  the full accumulator records all 9,001 samples.
- Browser gaze retention is bounded at 32,000 samples and compacted in batches
  to 30,000, avoiding a full-array shift on every frame in long sessions.
- Head OOD, body validity and privacy flags are tested.
- Chrome and Firefox render non-empty density/fixation output and preserve
  missing valence.
- Final aggregate passes the same strict `/ingest` contract used by the
  researcher analytics/export path.
- Full API regression: 170 passed, 0 failed, 0 skipped.
- Full Chromium/Firefox regression: 144 passed, 0 failed, 18 explicitly
  skipped integration scenarios that require the separately started API.
- Sprint 3 browser suite: 10 passed, 0 failed; TypeScript check passed.

Automated commands:

```bash
cd apps/api
node --test tests/multimodal-session.test.js tests/final-aggregate-contract.test.js

cd ../autotests
npx playwright test tests/sprint3-audio-multimodal.spec.ts
```

Frontend integration contract:

```js
import {
  buildMultimodalHeatmaps,
  renderMultimodalHeatmap
} from './packages/shared/multimodal/index.mjs';
```

See `packages/shared/multimodal/README.md` for layer switches and renderer input.

## Rollout and rollback

1. Deploy the shared `.mjs` package with correct JavaScript MIME.
2. Keep gamer mode off; enable it only for a reviewed gaming study.
3. Validate layer labels and disclaimers with the researcher UI owner.
4. Roll back by disabling `multimodal`/`bodyMovement` feature flags; typed fields
   are nullable and require no database rollback.

## Formal acceptance

Code-level criteria are complete. A representative-camera movement baseline and
formal responsible/lead sign-off remain organizational acceptance steps.
