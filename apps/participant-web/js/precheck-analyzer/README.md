# PreCheck Analyzer Module

Модуль анализа готовности к eye-tracking на основе MediaPipe Face Landmarker.

**Версия:** 2.1.0

## Описание

PreCheck Analyzer анализирует видеопоток и проверяет:
- Освещённость (слишком темно/ярко)
- Детекцию и позицию лица
- Позу головы (yaw, pitch, roll)
- Состояние глаз (открыты/закрыты, EAR)
- Центрирование глаз в кадре
- Состояние рта

## Структура модуля

```
js/
├── precheck-analyzer.js   # Browser Wrapper (основной файл для подключения)
└── precheck-analyzer/
    ├── index.js           # Entry point для ES modules
    ├── PrecheckAnalyzer.js # Основной класс
    ├── constants.js       # Индексы лэндмарок
    ├── thresholds.js      # Пороговые значения
    ├── illumination.js    # Анализ освещённости
    ├── face-parser.js     # Парсинг результатов детекции
    ├── pose-analyzer.js   # Анализ позы головы
    ├── eyes-analyzer.js   # Анализ глаз (EAR, iris)
    ├── mouth-analyzer.js  # Анализ рта
    └── recommendations.js # Рекомендации пользователю
```

## Зависимости

```html
<!-- MediaPipe Tasks Vision -->
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js"></script>
```

## Быстрый старт

### Browser (без сборщика)

```html
<script src="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js"></script>
<script src="js/precheck-analyzer.js"></script>
<script>
    const analyzer = new PrecheckAnalyzer({
        onInitialized: () => console.log('Ready!'),
        onError: (err) => console.error(err)
    });
    
    await analyzer.initialize();
    
    // В цикле анализа:
    const result = await analyzer.analyzeFrame(videoElement);
    
    console.log('Лицо:', result.face.detected);
    console.log('Поза:', result.pose.status);
    console.log('Глаза:', result.eyes.bothOpen);
</script>
```

### ES Modules

```javascript
import { PrecheckAnalyzer } from './precheck-analyzer/index.js';

const analyzer = new PrecheckAnalyzer();
await analyzer.initialize();
```

## API

### Конструктор

```javascript
new PrecheckAnalyzer(options)
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `onInitialized` | `Function` | Callback при инициализации |
| `onError` | `Function` | Callback при ошибке |

### Методы

| Метод | Параметры | Возвращает | Описание |
|-------|-----------|------------|----------|
| `initialize()` | - | `Promise<boolean>` | Инициализация модели |
| `analyzeFrame(video)` | HTMLVideoElement | `Promise<Object>` | Анализ кадра |
| `getLastResult()` | - | `Object` | Последний результат |
| `reset()` | - | `void` | Сброс состояния |
| `dispose()` | - | `void` | Освобождение ресурсов |

## Пороговые значения

### Освещённость

| Параметр | Значение | Описание |
|----------|----------|----------|
| `tooDark` | 30 | Порог слишком тёмно (0-255) |
| `tooBright` | 220 | Порог слишком ярко (0-255) |

### Лицо

| Параметр | Значение | Описание |
|----------|----------|----------|
| `minSize` | 5% | Минимальный размер лица |
| `maxSize` | 60% | Максимальный размер лица |
| `validZone.minX` | 0.15 | Левая граница зоны |
| `validZone.maxX` | 0.85 | Правая граница зоны |
| `validZone.minY` | 0.10 | Верхняя граница зоны |
| `validZone.maxY` | 0.90 | Нижняя граница зоны |

### Поза

| Параметр | Значение | Описание |
|----------|----------|----------|
| `maxYaw` | 10° | Максимальный поворот влево/вправо |
| `maxPitch` | 10° | Максимальный наклон вверх/вниз |
| `maxRoll` | 8° | Максимальный наклон в сторону |
| `eyesCenterMaxDeviation` | 0.15 | Макс. отклонение глаз от центра |

### Глаза

| Параметр | Значение | Описание |
|----------|----------|----------|
| `earThreshold` | 0.2 | Порог EAR для открытых глаз |

## Формат выходных данных

### analyzeFrame() результат

```javascript
{
    illumination: {
        value: 65,              // Яркость 0-100%
        rawValue: 166,          // Сырое значение 0-255
        status: 'optimal'       // 'optimal' | 'too_dark' | 'too_bright'
    },
    
    face: {
        detected: true,
        size: 18.5,             // Размер лица в % от кадра
        status: 'optimal',      // 'optimal' | 'too_small' | 'too_large' | 'not_found'
        bbox: {
            x: 0.25, y: 0.15,
            width: 0.45, height: 0.55
        },
        landmarkCount: 478
    },
    
    pose: {
        yaw: 2.3,               // Поворот влево/вправо (градусы)
        pitch: -1.5,            // Наклон вверх/вниз (градусы)
        roll: 0.8,              // Наклон в сторону (градусы)
        isStable: true,
        isTilted: false,
        status: 'stable',       // 'stable' | 'tilted' | 'off_center' | 'no_face'
        issues: [],
        eyesCentering: {
            centered: true,
            deviation: { x: 0.02, y: -0.01 },
            hint: null
        }
    },
    
    eyes: {
        left: {
            ear: 0.285,         // Eye Aspect Ratio
            isOpen: true
        },
        right: {
            ear: 0.291,
            isOpen: true
        },
        bothOpen: true
    },
    
    mouth: {
        isOpen: false,
        openRatio: 0.05
    },
    
    landmarks: [...],           // 478 точек MediaPipe
    timestamp: 1706889600000,
    frameSize: { width: 640, height: 480 }
}
```

### Статусы позы

| Статус | Описание | issues |
|--------|----------|--------|
| `stable` | Поза стабильная | `[]` |
| `tilted` | Голова наклонена | `['yaw_exceeded']`, `['pitch_exceeded']`, `['roll_exceeded']` |
| `off_center` | Глаза не в центре | `['eyes_off_center']` |
| `no_face` | Лицо не найдено | - |

### Подсказки центрирования

| hint | Значение |
|------|----------|
| `move_left` | Сдвиньтесь влево |
| `move_right` | Сдвиньтесь вправо |
| `move_up` | Сдвиньтесь выше |
| `move_down` | Сдвиньтесь ниже |

## Индексы лэндмарок MediaPipe

```javascript
const LANDMARKS = {
    // Глаза (для EAR)
    LEFT_EYE: [362, 385, 387, 263, 373, 380],
    RIGHT_EYE: [33, 160, 158, 133, 153, 144],
    
    // Iris (для направления взгляда)
    LEFT_IRIS: [468, 469, 470, 471, 472],
    RIGHT_IRIS: [473, 474, 475, 476, 477],
    
    // Центры глаз
    LEFT_EYE_CENTER: 468,
    RIGHT_EYE_CENTER: 473,
    
    // Рот
    UPPER_LIP: 13,
    LOWER_LIP: 14,
    LEFT_MOUTH_CORNER: 61,
    RIGHT_MOUTH_CORNER: 291
};
```

## Eye Aspect Ratio (EAR)

EAR используется для определения открыты ли глаза:

```
EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
```

Где p1-p6 — точки контура глаза.

- EAR > 0.2 → глаз открыт
- EAR ≤ 0.2 → глаз закрыт

## Интеграция с QCMetrics

```javascript
const analyzer = new PrecheckAnalyzer();
const qcMetrics = new QCMetrics();

await analyzer.initialize();
qcMetrics.start();

async function analyzeLoop() {
    const result = await analyzer.analyzeFrame(video);
    
    // Передаём результат в QCMetrics
    qcMetrics.processFrame(result);
    
    // Показываем подсказки пользователю
    if (!result.face.detected) {
        showMessage('Лицо не найдено');
    } else if (result.pose.status === 'tilted') {
        showMessage('Держите голову прямо');
    } else if (!result.eyes.bothOpen) {
        showMessage('Держите глаза открытыми');
    }
}
```

## Рекомендации (модуль recommendations.js)

```javascript
import { getRecommendations, getMainRecommendation } from './precheck-analyzer/recommendations.js';

const result = await analyzer.analyzeFrame(video);
const recommendations = getRecommendations(result);

// recommendations = [
//   { priority: 1, category: 'face', message: 'Лицо не найдено' },
//   { priority: 2, category: 'illumination', message: 'Слишком темно' }
// ]

const main = getMainRecommendation(result);
// main = 'Лицо не найдено'
```

