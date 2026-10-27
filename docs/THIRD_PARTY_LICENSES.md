# Third-party licenses

## Analytics PDF export

- jsPDF **4.2.1**, MIT, vendored from the npm release published by
  https://github.com/parallax/jsPDF/releases/tag/v4.2.1.
- File: `apps/web/assets/vendor/jspdf/dist/jspdf.umd.min.js`.
- SHA-256: `e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54`.
- License: `apps/web/assets/vendor/jspdf/LICENSE`.
- DejaVu Sans 2.37: Bitstream Vera license / public-domain DejaVu changes,
  https://github.com/dejavu-fonts/dejavu-fonts/blob/master/LICENSE.
- File: `apps/web/assets/fonts/DejaVuSans.ttf`; unmodified runtime-bundled font.
- SHA-256: `7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954`.
- License: `apps/web/assets/fonts/DejaVuSans-LICENSE.txt`.
- PDF generation stays in the browser, uses an authorized analysis snapshot,
  embeds Cyrillic glyphs, and does not contact a CDN. No HTML-to-PDF, AcroForm,
  annotation, executable JavaScript or user-supplied font API is used.

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

`apps/api/tests/face-regions.test.js` contains selected x/y coordinates adapted
from Google's Apache-2.0 [canonical face model](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj)
to test regional bounds, not as participant data. Source file SHA256 inspected
2026-10-25: `8bac80443397e113f41a8b565ea72c59390bc031d9defab289dba7bc0c54e618`.
Copyright The MediaPipe Authors; coordinates are normalized in the fixture.

```text
64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff  face_landmarker.task
59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a  pose_landmarker_lite.task
c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0  selfie_multiclass_256x256.tflite
191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b  selfie_segmenter.tflite
```

## Project code

EmoCog source code is distributed under Apache License 2.0; see repository
`LICENSE`.

## Open Vocal Biomarkers core

- Component: `Audio_detection/**`.
- License: MIT; see `Audio_detection/LICENSE`.
- Execution: local browser Worker, without an external inference service.
- Production output excludes raw PCM and condition/diagnostic flags.

The browser bundle `Audio_detection/browser/open-vocal-biomarkers.mjs` is
generated only from the same pinned MIT source files by
`Audio_detection/scripts/build-browser-bundle.mjs` and is parity-tested against
the CommonJS core.

## VPC Felidae image set

The nine VPC stimuli are served from `apps/participant-web/assets/vpc/felidae`
so a participant browser does not contact Wikimedia. The source page, author
and exact CC/Public Domain license are recorded in
`manifest-felidae.js`; the original Commons API response is retained as
`commons-metadata.json`.

## Atkinson Hyperlegible Next

- Component: `apps/web/assets/fonts/atkinson-hyperlegible-next.woff2`.
- Upstream revision: `7925f50f649b3813257faf2f4c0b381011f434f1`.
- License: SIL Open Font License 1.1; the bundled text is in
  `apps/web/assets/fonts/ATKINSON-OFL.txt`.
- Upstream: https://github.com/googlefonts/atkinson-hyperlegible-next
- Purpose: locally served, high-legibility typography for participant,
  researcher and developer interfaces.

```text
abde1ad5cf78b9ac575ef90d991f2e9101eb0b3b6668bde9a00e2e1e27d99afd  atkinson-hyperlegible-next.woff2
```

## Media Inspection System Tools

The API image installs Debian FFmpeg/ffprobe for thumbnails, video posters and
decoding checks. Upstream source/license: https://ffmpeg.org/legal.html.
The exact package version and FFmpeg build configuration are recorded in
`/usr/local/share/wecog/runtime-packages.txt` and `ffmpeg-build.txt`. Preserve
`/usr/share/doc/ffmpeg/copyright`, package sources and release image digest when
distributing the image. LGPL/GPL terms depend on the package build; these tools
are separate subprocesses, not a browser/Node-linked library. Local tests used
Alpine FFmpeg 8.0.1. See root `THIRD_PARTY_LICENSES.md` for the scope of the notice.

## Test tooling: js-yaml

The existing Node test helper dependency is updated from 4.3.1 to 4.3.2 to fix
the reported high-severity merge-key CPU exhaustion issue. Source:
https://github.com/nodeca/js-yaml ; license: MIT. npm registry integrity for 4.3.2:
`sha512-SFNOvSJ+Dgf/9An904Yx+CgSlIPCkIpao4qo51lpee25TIRejdH3rhR4EZMGoNx3/TP3O+wzWuiTFl4sqbltzA==`.
The lockfile fixes the installed version; no upstream code is vendored. Registry
license/source/integrity and zero-vulnerability npm audit were verified on
2026-10-08. This is test tooling, not a new physiological model.

## Update policy

Local diagnostic tooling on 2026-10-27 additionally used Playwright **1.64.1**,
Apache-2.0, from the official npm registry and
https://github.com/microsoft/playwright/releases/tag/v1.64.1, with its matching
official Firefox 157 binary. Installed only in a temporary external prefix;
the repository's Playwright dependency remains 1.57.0. The diagnostic package
archive integrity was checked against the npm registry and temporary lockfile:
`sha512-HCrVhHr5QQuwYoswEUGTb7gGp522yflbv/ST8nF4sFWGuLjQCt17Q/EubpGGSNKYn1tsTCPZxqHhHCfVURu7UA==`.
No new model, runtime or browser binary is bundled with the product.

Security maintenance on 2026-10-25 also updates the existing API dependency
`express-validator` to **7.3.2** (MIT), source
https://github.com/express-validator/express-validator. The exact archive
integrity and transitive versions are recorded in `apps/api/package-lock.json`.
This applies the compatible patch from Dependabot PR #50, not the unrelated
Express 5 migration. No upstream source or scientific model is vendored.

Security maintenance on 2026-10-27 pins the existing transitive **qs 6.16.1**
(BSD-3-Clause), source https://github.com/ljharb/qs, to address
https://github.com/advisories/GHSA-6pq8-jhm2-2vcw. No major Express upgrade or
new runtime package is introduced. Official npm archive integrity:
`sha512-5Px6J7rfHBAGUhNQ3es4YzcOdBBw0SDcVtThJml4RdnKw4tKs2epA0kPZ+K8X+WiHktT93RHVcQ/3ym5aTCgtg==`.
The exact dependency tree is recorded in `apps/api/package-lock.json`.

Before updating a runtime or model:

1. Verify an OSI-compatible license and attribution requirements.
2. Pin an exact package/model revision.
3. Record source URL and SHA-256 for vendored files.
4. Run API, browser smoke and baseline-versus-new gaze benchmark.
5. Update this file in the same pull request.
