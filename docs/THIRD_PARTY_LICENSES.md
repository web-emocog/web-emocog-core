# Third-party licenses

## MediaPipe Tasks Vision

- Компонент: `@mediapipe/tasks-vision`.
- Версия vendored runtime: `0.10.14`.
- License: Apache License 2.0.
- Upstream: https://github.com/google-ai-edge/mediapipe
- License: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

Vendored runtime:

```text
apps/participant-web/js/vendor/mediapipe/vision_bundle.mjs
apps/participant-web/js/vendor/mediapipe/wasm/
```

SHA-256 на дату 2026-07-25:

```text
e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669  vision_bundle.mjs
cb3ec20026a9aecc2a81a93c25630ceb5389297ddb7a5f0bd61dd09cde606b9b  vision_wasm_internal.wasm
924274fcd5ac8985f6570a8573e7971b7bd2d580ba1b8f3beb0ba8f95db6347c  vision_wasm_nosimd_internal.wasm
```

## MediaPipe model assets

| Model | Revision | Purpose |
| --- | --- | --- |
| Face Landmarker float16 | `1` | Face/iris landmarks and blendshapes |
| Pose Landmarker Lite float16 | `1` | Body posture and movement |
| Selfie Multiclass Segmenter float32 | `1` | Face visibility/occlusion QC |
| Selfie Segmenter float16 | `1` | Segmentation fallback |

Model cards for Face Mesh and MediaPipe segmentation specify Apache-2.0.
Runtime and model files are served from the application origin. The canonical
participant path does not contact a MediaPipe CDN or model host.

```text
64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  face_landmarker.task
59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a  pose_landmarker_lite.task
c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0  selfie_multiclass_256x256.tflite
191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b  selfie_segmenter.tflite
```

## Project code

EmoCog source code is distributed under Apache License 2.0; see repository
`LICENSE`.

## VPC Felidae image set

The nine VPC stimuli are served from `apps/participant-web/assets/vpc/felidae`
so a participant browser does not contact Wikimedia. The source page, author
and exact CC/Public Domain license are recorded in
`manifest-felidae.js`; the original Commons API response is retained as
`commons-metadata.json`.

## Update policy

Before updating a runtime or model:

1. Verify an OSI-compatible license and attribution requirements.
2. Pin an exact package/model revision.
3. Record source URL and SHA-256 for vendored files.
4. Run API, browser smoke and baseline-versus-new gaze benchmark.
5. Update this file in the same pull request.
