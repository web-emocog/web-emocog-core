# Face Segmenter Module

Модуль сегментации лица на основе MediaPipe Image Segmenter для детекции окклюзии.

**Версия:** 1.2.0

## Описание

Face Segmenter анализирует видеокадры и определяет:
- Области лица (кожа, волосы, фон)
- Окклюзию лица руками (body_skin в области лица)
- Видимость ключевых областей лица
- Симметрию лица

## Структура модуля

```
js/
├── face-segmenter.js      # Browser Wrapper (основной файл для подключения)
└── face-segmenter/
    ├── index.js           # Entry point для ES modules
    ├── FaceSegmenter.js   # Основной класс
    ├── constants.js       # Индексы классов и лэндмарок
    ├── thresholds.js      # Пороговые значения
    ├── mask-analyzer.js   # Анализ масок сегментации
    ├── region-analyzer.js # Анализ областей лица
    ├── symmetry-checker.js # Проверка симметрии
    └── visualization.js   # Визуализация масок
```

## Зависимости

```html
<!-- MediaPipe Tasks Vision -->
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm/vision_bundle.mjs" type="module"></script>
```

Или через CDN с FilesetResolver:
```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js"></script>
```

## Быстрый старт

### Browser (без сборщика)

```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js"></script>
<script src="js/face-segmenter.js"></script>
<script>
    const segmenter = new FaceSegmenter({
        onInitialized: () => console.log('Ready!'),
        onError: (err) => console.error(err)
    });
    
    await segmenter.initialize();
    
    // В цикле анализа:
    const result = await segmenter.segmentFrame(videoElement, faceLandmarks);
    
    if (result.faceVisibility.handDetected) {
        console.log('Рука на лице!');
    }
</script>
```

### ES Modules

```javascript
import { FaceSegmenter } from './face-segmenter/index.js';

const segmenter = new FaceSegmenter();
await segmenter.initialize();
```

## API

### Конструктор

```javascript
new FaceSegmenter(options)
```

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|--------------|----------|
| `runningMode` | `string` | `"VIDEO"` | Режим работы (`"VIDEO"` или `"IMAGE"`) |
| `segmentationType` | `string` | `"selfie_multiclass"` | Тип модели |
| `maskConfidence` | `number` | `0.5` | Порог уверенности маски |
| `minSkinVisibility` | `number` | `0.6` | Минимум видимости кожи |
| `minTotalFaceSkin` | `number` | `0.55` | Минимум кожи лица |
| `hairOcclusionThreshold` | `number` | `0.25` | Порог окклюзии волосами |
| `handOcclusionThreshold` | `number` | `0.05` | Порог окклюзии рукой (в области) |
| `globalHandThreshold` | `number` | `0.08` | Глобальный порог руки |
| `maxAsymmetry` | `number` | `0.30` | Максимальная асимметрия |
| `onInitialized` | `Function` | `null` | Callback при инициализации |
| `onError` | `Function` | `null` | Callback при ошибке |

### Методы

| Метод | Параметры | Возвращает | Описание |
|-------|-----------|------------|----------|
| `initialize()` | - | `Promise<boolean>` | Инициализация модели |
| `segmentFrame(video, landmarks)` | HTMLVideoElement, Array | `Promise<Object>` | Сегментация кадра |
| `getLastResult()` | - | `Object` | Последний результат |
| `reset()` | - | `void` | Сброс состояния |
| `dispose()` | - | `void` | Освобождение ресурсов |

## Классы сегментации

MediaPipe Selfie Multiclass Segmenter возвращает 6 классов:

| Индекс | Название | Описание |
|--------|----------|----------|
| 0 | `background` | Фон |
| 1 | `hair` | Волосы |
| 2 | `body_skin` | Кожа тела (включая руки!) |
| 3 | `face_skin` | Кожа лица |
| 4 | `clothes` | Одежда |
| 5 | `others` | Аксессуары и прочее |

> ⚠️ **Важно:** Класс `body_skin` включает руки. Если в области лица много `body_skin` — это означает окклюзию рукой.

## Формат выходных данных

### segmentFrame() результат

```javascript
{
    maskAnalysis: {
        hasData: true,
        classDistribution: {
            background: { count: 12500, ratio: 0.45 },
            hair: { count: 3200, ratio: 0.12 },
            body_skin: { count: 800, ratio: 0.03 },
            face_skin: { count: 8500, ratio: 0.31 },
            clothes: { count: 2000, ratio: 0.07 },
            others: { count: 500, ratio: 0.02 }
        },
        faceRegion: {
            boundingBox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
            stats: {
                totalPixels: 15000,
                faceSkin: 12000,
                hair: 1500,
                bodySkin: 200,
                background: 800,
                clothes: 300,
                others: 200
            },
            ratios: {
                faceSkin: 0.80,
                hair: 0.10,
                bodySkin: 0.013,
                background: 0.053,
                clothes: 0.02,
                others: 0.013,
                totalSkin: 0.813,
                occlusion: 0.133
            }
        }
    },
    
    faceVisibility: {
        isComplete: true,
        score: 95,
        issues: [],
        regions: {
            globalBodySkinRatio: 0.013,
            totalFaceSkinVisibility: 0.80
        },
        handDetected: false,
        thresholds: { /* текущие пороги */ }
    },
    
    isComplete: true,
    score: 95,
    issues: [],
    timestamp: 1706889600000,
    frameSize: { width: 640, height: 480 }
}
```

### Возможные issues

| Issue | Описание |
|-------|----------|
| `no_data` | Нет данных сегментации |
| `hand_on_face` | Обнаружена рука на лице |
| `low_skin_visibility` | Низкая видимость кожи лица |
| `hair_occlusion` | Волосы закрывают лицо |

## Интеграция с QCMetrics

```javascript
// Инициализация
const segmenter = new FaceSegmenter();
const qcMetrics = new QCMetrics();

await segmenter.initialize();
qcMetrics.start();

// В цикле анализа
async function analyzeLoop() {
    const precheckResult = await precheckAnalyzer.analyzeFrame(video);
    const landmarks = precheckResult.landmarks;
    
    // Передаём landmarks для точного определения области лица
    const segmenterResult = await segmenter.segmentFrame(video, landmarks);
    
    // Передаём оба результата в QCMetrics
    qcMetrics.processFrame(precheckResult, segmenterResult);
    
    // QCMetrics использует handDetected для определения окклюзии
    if (segmenterResult.faceVisibility.handDetected) {
        showWarning('Уберите руку от лица');
    }
}
```


## Алгоритм детекции окклюзии

1. **Определение области лица:**
   - Если есть landmarks — используем bounding box лица с padding 10%
   - Если нет landmarks — используем центральную область (20%, 10%, 60%, 80%)

2. **Анализ классов в области лица:**
   - Считаем пиксели каждого класса
   - Вычисляем соотношения

3. **Детекция руки:**
   - Если `bodySkin ratio >= globalHandThreshold (0.08)` → `handDetected = true`
   - Это означает, что 8%+ области лица занято кожей тела (рукой)

4. **Проверка видимости кожи:**
   - Если `faceSkin ratio < minTotalFaceSkin (0.55)` → `low_skin_visibility`

