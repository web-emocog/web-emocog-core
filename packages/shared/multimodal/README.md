# Multimodal research output

Shared, UI-independent aggregation and rendering API for synchronized gaze,
emotion/engagement proxies, head pose and body movement.

## Timebase

All new samples use `performance.timeOrigin + performance.now()` and expose
`timeOriginMs`, `monotonicMs` and `sessionTimeMs`. Nearest-neighbour emotion to
gaze alignment is accepted only within 100 ms; unmatched data remains missing.

## Privacy and QC

- Corrected gaze is normalized to the actual stimulus rectangle.
- Low-confidence/off-screen gaze, low-confidence emotion, head OOD and body OOD
  are excluded rather than imputed.
- Head pose is represented as yaw/pitch/roll deltas from a session baseline.
- Body output contains normalized torso kinematics only.
- Raw video and landmarks are never stored in the multimodal output.
- Gamer-oriented body movement is feature-gated by protocol.

## Aggregation

```js
import { buildMultimodalHeatmaps } from './packages/shared/multimodal/index.mjs';

const model = buildMultimodalHeatmaps({ gazeSamples, emotionSamples }, {
  gridWidth: 16,
  gridHeight: 9,
  maxAlignmentMs: 100,
  maxPresentations: 50,
});
```

Each presentation contains density, valence, arousal, engagement-proxy and
fixation-proxy layers plus sample counts, QC thresholds and alignment error.

## Renderer API

```js
import { renderMultimodalHeatmap } from './packages/shared/multimodal/index.mjs';

renderMultimodalHeatmap(canvas, model.presentations[0], {
  model,
  layers: {
    density: true,
    valence: false,
    arousal: false,
    engagement: true,
    fixation: true,
  },
  opacity: 0.72,
});
```

The renderer has no dependency on the researcher UI and can be integrated by
the frontend team without changing collection or analytics contracts.
