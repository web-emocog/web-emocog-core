# Контракт интеграции (Core Only)

## Назначение

Модуль предоставляет функции локального эвристического анализа аудио.

Без UI, без backend, без хранения пользовательских данных.

## Точка интеграции

CommonJS:

```js
const core = require("/Users/valeriia_firs/Desktop/Audio_detection/core");
```

ESM:

```js
import * as core from "/Users/valeriia_firs/Desktop/Audio_detection/core/index.mjs";
```

## Вход

### Базовый вход

- `analyzePcmSamples(samples, sampleRate, runtimeConfig)`
- `samples`: `Float32Array | TypedArray | number[]` (моно сигнал)
- `sampleRate`: число (Гц)

### Браузерный helper

- `analyzeAudioFileBrowser(file, runtimeConfig)`
- только для браузерной среды (`File/Blob` + WebAudio API)
- `analyzeAudioArrayBufferBrowser(arrayBuffer, runtimeConfig)`
- только для браузерной среды (`ArrayBuffer` + WebAudio API)

## Runtime config

- `max_audio_duration_sec`
- `abstain_confidence_threshold`
- `abstain_quality_threshold`
- `strict_mode`

## Выход

- `markers[]`
- `condition_flags[]`
- `quality`
- `decision`
- `indicator_percentages`
- `raw_features`
- `notes[]`
- `literature[]`

Формат отчёта:
- JSON-объект (plain object)
- JSON-строка через:
  - `toJsonReport(...)`
  - `analyzePcmSamplesJson(...)`
  - `analyzeAudioArrayBufferBrowserJson(...)`

## Приватность

- сетевые вызовы отсутствуют;
- хранение данных отсутствует;
- управление сохранением результатов полностью на стороне host-продукта.
