# Open Vocal Biomarkers (Core Only)

Локальный эвристический модуль анализа аудио без веб-интерфейса и без сервера.

В проекте оставлено только ядро функций:
- `/Users/valeriia_firs/Desktop/Audio_detection/core/constants.js`
- `/Users/valeriia_firs/Desktop/Audio_detection/core/utils.js`
- `/Users/valeriia_firs/Desktop/Audio_detection/core/audio.js`
- `/Users/valeriia_firs/Desktop/Audio_detection/core/acoustic_features.js`
- `/Users/valeriia_firs/Desktop/Audio_detection/core/quality.js`
- `/Users/valeriia_firs/Desktop/Audio_detection/core/marker_scoring.js`
- `/Users/valeriia_firs/Desktop/Audio_detection/core/condition_flags.js`
- `/Users/valeriia_firs/Desktop/Audio_detection/core/analyzer.js`
- `/Users/valeriia_firs/Desktop/Audio_detection/core/report.js`
- `/Users/valeriia_firs/Desktop/Audio_detection/core/engine.js` (фасад совместимости)
- `/Users/valeriia_firs/Desktop/Audio_detection/core/index.js` (CommonJS entry)
- `/Users/valeriia_firs/Desktop/Audio_detection/core/index.mjs` (ESM entry для веб-проектов)

## Что умеет модуль

- извлекать акустические маркеры из аудиосигнала;
- вычислять condition-флаги (эвристика по научным правилам);
- считать quality/reliability контур;
- возвращать JSON-совместимый объект для интеграции в продукт.

Модуль не ставит диагнозы.

## Подключение (CommonJS)

```js
const {
  analyzePcmSamples,
  analyzeAudioArrayBufferBrowser,
  analyzeAudioFileBrowser,
  getCapabilities,
  DEFAULT_CONFIG,
  toJsonReport,
} = require("/Users/valeriia_firs/Desktop/Audio_detection/core");
```

## Подключение (ESM для общего веба)

```js
import {
  analyzePcmSamples,
  analyzeAudioArrayBufferBrowser,
  analyzeAudioFileBrowser,
  DEFAULT_CONFIG,
  toJsonReport,
} from "/Users/valeriia_firs/Desktop/Audio_detection/core/index.mjs";
```

## Основной API

### 1) Универсальный core-вход (рекомендуется)

```js
const result = analyzePcmSamples(float32Samples, sampleRate, {
  ...DEFAULT_CONFIG,
  strict_mode: true,
  max_audio_duration_sec: 0,
});
```

Где:
- `float32Samples` — моно массив сэмплов (`Float32Array` или совместимый typed array);
- `sampleRate` — частота дискретизации исходного массива.

### 2) Browser helper для `File/Blob`

```js
const result = await analyzeAudioFileBrowser(file, { strict_mode: false });
```

### 3) Browser helper для `ArrayBuffer` (удобно для общего веба)

```js
const result = await analyzeAudioArrayBufferBrowser(arrayBuffer, { strict_mode: false });
```

## Выход

Возвращает объект с полями:
- `markers`
- `condition_flags`
- `quality`
- `decision`
- `indicator_percentages`
- `raw_features`
- `notes`
- `literature`

## JSON-отчёт

Модуль формирует отчёт в JSON:

```js
const reportObject = analyzePcmSamples(samples, sampleRate, DEFAULT_CONFIG);
const reportJson = toJsonReport(reportObject, true); // pretty JSON string
```

Также доступны shortcut-методы:
- `analyzePcmSamplesJson(...)`
- `analyzeAudioArrayBufferBrowserJson(...)`
- `analyzeAudioFileBrowserJson(...)`

## Лицензия

Код проекта: MIT.
