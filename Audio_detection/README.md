# Open Vocal Biomarkers

MIT-licensed local heuristic audio core and its browser session adapter. The
module is intended for research features and does not provide diagnoses.

## Entries

- `core/index.js`: CommonJS API.
- `core/index.mjs`: ESM wrapper for environments that can load CommonJS.
- `browser/open-vocal-biomarkers.mjs`: generated browser-native ESM bundle.
- `scripts/build-browser-bundle.mjs`: deterministic bundle generator.
- `apps/participant-web/js/audio/session-audio.js`: consent, microphone
  lifecycle, windowing, QC and aggregate-only session integration.

Rebuild and validate the browser bundle after changing `core/**`:

```bash
node Audio_detection/scripts/build-browser-bundle.mjs
cd apps/api
node --test tests/audio-session.test.js
```

## Core API

```js
const { analyzePcmSamples } = require('./Audio_detection/core');

const result = analyzePcmSamples(float32Samples, sampleRate, {
  strict_mode: false,
  max_audio_duration_sec: 0,
});
```

The standalone core returns acoustic features, markers, quality, decision and
provenance fields. The participant adapter intentionally transmits only a
smaller allowlisted aggregate: window timestamps, QC, reliability, compact
biomarkers and marker scores. Condition flags and raw PCM are not sent.

## Browser lifecycle

Audio is disabled by default. A researcher enables `settings.featureFlags.audio`
in the protocol, then the participant must grant a separate optional consent.
Only after both gates pass does the runtime request microphone permission.

- Capture uses `AudioWorklet` with a `ScriptProcessor` compatibility fallback.
- Window analysis runs in a module Worker and does not block gaze/RT inference.
- Pause closes the current window; resume starts a new one.
- `stop()`/`dispose()` stop all tracks, close `AudioContext`, terminate the
  Worker and are idempotent.
- Silence, clipping, windows shorter than 3 seconds, unsupported sample rate
  and core OOD/abstain are retained as rejected QC windows without markers.
- Raw audio is neither stored nor transmitted. Production debug capture cannot
  be enabled from a protocol.

## Output

`SessionFeature.audio_summary` uses `audio_session.v1` and includes:

- `algorithmVersion`, `sampleRate`, window timestamps and scope;
- `acceptedWindowCount`, `rejectedWindowCount`, `droppedWindowCount`;
- quality and reliability values with explicit abstention reasons;
- compact marker and biomarker aggregates;
- `rawAudioStored: false` and `rawAudioTransmitted: false`.

The server rejects unknown top-level audio fields and raw-media payload keys.

## License

`Audio_detection/**` is MIT licensed; see `Audio_detection/LICENSE`. Host
application code remains Apache-2.0 under the repository license.
