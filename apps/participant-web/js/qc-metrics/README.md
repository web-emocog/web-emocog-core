# QC Metrics Module

Модуль контроля качества данных для eye-tracking исследований.

**Версия:** 3.5.0

## Описание

QC Metrics собирает и анализирует метрики качества данных в реальном времени:
- Видимость и позиция лица
- Освещённость
- Состояние глаз (открыты/закрыты)
- Окклюзия (закрытие лица руками и т.д.)
- Валидность и позиция взгляда
- FPS камеры

## Структура модуля

```
js/
├── qc-metrics.js          # Browser Wrapper (основной файл для подключения)
└── qc-metrics/
    ├── index.js           # Entry point для ES modules
    ├── QCMetrics.js       # Основной класс
    ├── constants.js       # Пороговые значения и константы
    ├── helpers.js         # Утилиты (clamp, round, median, percentile)
    ├── fps-monitor.js     # Мониторинг FPS видео
    ├── gaze-tracking.js   # Трекинг взгляда и onScreen состояния
    ├── frame-analysis.js  # Анализ кадров (face, pose, eyes)
    ├── validation.js      # Валидация калибровки (accuracy, precision)
    └── metrics-calculator.js # Расчёт QC Score и метрик
```

## Быстрый старт

### Browser (без сборщика)

```html
<script src="js/qc-metrics.js"></script>
<script>
    const qcMetrics = new QCMetrics({
        onMetricsUpdate: (metrics) => console.log(metrics)
    });
    
    qcMetrics.start();
    
    // В цикле анализа:
    qcMetrics.processFrame(precheckResult, segmenterResult);
    qcMetrics.addGazePoint(gazeData, poseData);
    qcMetrics.setCameraFps(measuredFps);
    
    // Получение результатов:
    const summary = qcMetrics.getSummary();
    qcMetrics.stop();
</script>
```

### ES Modules

```javascript
import { QCMetrics } from './qc-metrics/index.js';

const qcMetrics = new QCMetrics();
qcMetrics.start();
```

## API

### Конструктор

```javascript
new QCMetrics(options)
```

| Параметр | Тип | Описание |
|----------|-----|----------|
| `options.onMetricsUpdate` | `Function` | Callback при обновлении метрик |
| `options.*` | `number` | Любой threshold (см. ниже) |

### Основные методы

| Метод | Описание |
|-------|----------|
| `start()` | Запуск сбора метрик |
| `stop()` | Остановка сбора |
| `reset()` | Сброс всех данных |
| `isRunning()` | Проверка статуса |

### Методы обработки данных

| Метод | Параметры | Описание |
|-------|-----------|----------|
| `processFrame(precheckResult, segmenterResult)` | Результаты PrecheckAnalyzer и FaceSegmenter | Обработка кадра |
| `addGazePoint(gazeData, poseData, occluded)` | `{x, y}`, `{yaw, pitch}`, `boolean` | Добавление точки взгляда |
| `setCameraFps(fps)` | `number` | Установка измеренного FPS камеры |

### Методы получения данных

| Метод | Возвращает | Описание |
|-------|------------|----------|
| `getCurrentMetrics()` | `Object` | Текущие метрики |
| `getSummary()` | `Object` | Полный отчёт с проверками |

## Формат выходных данных

### getCurrentMetrics()

```javascript
{
    durationMs: 12500,           // Длительность сессии
    totalFrames: 375,            // Всего кадров
    qcScore: 0.847,              // Общий QC Score (0-1)
    
    // Проценты качества (0-100)
    faceVisiblePct: 98.2,
    faceOkPct: 95.1,
    poseOkPct: 92.3,
    illuminationOkPct: 100,
    eyesOpenPct: 97.5,
    occlusionPct: 1.2,
    gazeValidPct: 89.4,
    gazeOnScreenPct: 94.1,
    lowFpsPct: 0,
    
    // FPS
    analysisFps: 28,             // FPS анализа (processFrame calls/sec)
    cameraFps: 30,               // Реальный FPS камеры
    baselineFps: 30,             // Baseline FPS
    
    // Gaze time
    gazeValidTimeMs: 11000,
    gazeOnScreenTimeMs: 10500,
    gazeTotal: 350,              // Всего вызовов addGazePoint
    
    timestamp: 1706889600000
}
```

### getSummary()

```javascript
{
    ...getCurrentMetrics(),
    
    validation: {
        accuracyPx: 45.2,
        precisionPx: 12.1,
        accuracyPct: 2.1,
        precisionPct: 0.6,
        sampleCount: 9
    },
    
    checks: {
        duration: true,
        faceVisible: true,
        faceOk: true,
        poseOk: true,
        illuminationOk: true,
        eyesOpen: true,
        occlusion: true,
        gazeValid: true,
        gazeOnScreen: true,
        lowFps: true,
        consecutiveLowFps: true
    },
    
    passedChecks: 11,
    totalChecks: 11,
    overallPass: true,
    
    counters: { /* внутренние счётчики */ },
    fpsHistory: [28, 29, 30, ...],
    maxConsecutiveLowFpsMs: 0,
    totalLowFpsMs: 0
}
```

## Пороговые значения (Thresholds)

| Параметр | Значение | Описание |
|----------|----------|----------|
| `minDurationMs` | 8000 | Минимальная длительность сессии |
| `face_visible_pct_min` | 85% | Минимум видимости лица |
| `face_ok_pct_min` | 85% | Минимум валидных кадров лица |
| `pose_ok_pct_min` | 85% | Минимум стабильной позы |
| `illumination_ok_pct_min` | 92% | Минимум хорошего освещения (v3.5: повышен с 90%) |
| `eyes_open_pct_min` | 85% | Минимум открытых глаз |
| `occlusion_pct_max` | 20% | Максимум окклюзии |
| `gaze_valid_pct_min` | 80% | Минимум валидного взгляда |
| `gaze_on_screen_pct_min` | 85% | Минимум взгляда на экран |
| `gaze_accuracy_pct_max` | 12% | Максимум ошибки точности (relaxed v2.2.0) |
| `gaze_precision_pct_max` | 6% | Максимум ошибки прецизии (relaxed v2.2.0) |
| `fps_absolute_min` | 12 | Абсолютный минимум FPS камеры |
| `maxLowFpsTimeMs` | 4000 | Максимум времени низкого FPS |
| `maxConsecutiveLowFpsMs` | 2000 | Максимум непрерывного низкого FPS |

## QC Score

QC Score вычисляется как взвешенная сумма нормализованных метрик (0-1).

### Весовые коэффициенты (v3.5)

| Метрика | Ключ | Вес | Описание |
|---------|------|-----|----------|
| Face Visible | `faceVis` | 0.12 | Лицо видно (базовый сигнал) |
| Face OK | `faceOk` | 0.14 | Лицо ОК (размер, позиция, без окклюзии) |
| **Pose OK** | `poseOk` | **0.14** | **Поза стабильна (критично для rPPG + gaze)** |
| **Illumination OK** | `lightOk` | **0.10** | **Освещение (фундамент для CV, повышен с 0.06)** |
| Eyes Open | `eyesOpen` | 0.06 | Глаза открыты |
| No Occlusion | `occlInv` | 0.08 | Нет окклюзии |
| Gaze Valid | `gazeValid` | 0.12 | Валидный взгляд |
| Gaze On Screen | `gazeOn` | 0.12 | Взгляд на экране |
| **Gaze Accuracy** | `gazeAccuracy` | **0.06** | **Точность gaze из валидации (NEW, заменяет dropoutInv)** |
| FPS OK | `fpsOk` | 0.06 | Стабильный FPS |

> **v3.5 изменения:**
> - **ИСПРАВЛЕН баг:** `dropoutInv` математически дублировал `gazeValid` (оба = `clamp01(gazeValidPct / 100)`). Заменён на `gazeAccuracy`.
> - **Повышен вес `poseOk`** с 0.08 → 0.14 (критично для rPPG и качества gaze).
> - **Повышен вес `lightOk`** с 0.06 → 0.10 (освещение — фундамент для всех CV-алгоритмов).
> - **Добавлен `gazeAccuracy`** — плавный штраф по данным валидации (accuracy% → smooth penalty в score).

### Hard Penalties (штрафы по важности, v3.5)

Штрафы применяются мультипликативно: `score *= (1 - factor)`.
Чем выше `factor`, тем жёстче штраф. Подбираются итеративно (аналогия с P-компонентом PID).

| Условие | Factor | Множитель | Описание |
|---------|--------|-----------|----------|
| Короткая сессия | 0.65 | × 0.35 | Почти обнуляет score |
| **Нестабильная поза** | **0.45** | **× 0.55** | **Самый жёсткий (rPPG critical)** |
| Лицо не видно | 0.40 | × 0.60 | Серьёзный штраф |
| Лицо не ОК | 0.40 | × 0.60 | Серьёзный штраф |
| Низкий FPS | 0.40 | × 0.60 | Серьёзный штраф |
| **Плохое освещение** | **0.35** | **× 0.65** | **Значительный штраф (NEW)** |
| Окклюзия | 0.30 | × 0.70 | Умеренный штраф |
| Невалидный gaze | 0.30 | × 0.70 | Умеренный штраф |
| Gaze off-screen | 0.30 | × 0.70 | Умеренный штраф |
| **Плохая gaze accuracy** | **0.25** | **× 0.75** | **Умеренный штраф (NEW)** |

### Gaze Accuracy — плавный штраф

Validation accuracy интегрирована в числовой `qcScore` двумя способами:

1. **Weighted component** (вес 0.06): плавная шкала от 0% ошибки (score=1) до 2× порога (score=0).
   - До 50% порога (6%): score ≈ 1.0 (отлично)
   - На пороге (12%): score ≈ 0.5
   - На 200% порога (24%): score ≈ 0.0 (очень плохо)

2. **Hard penalty** (× 0.75): дополнительный штраф если accuracy% > порога.

## Интеграция с другими модулями

```javascript
// PrecheckAnalyzer → QCMetrics
const precheckResult = await precheckAnalyzer.analyzeFrame(video);
qcMetrics.processFrame(precheckResult);

// FaceSegmenter → QCMetrics
const segmenterResult = await faceSegmenter.segmentFrame(video, landmarks);
qcMetrics.processFrame(precheckResult, segmenterResult);

// WebGazer/GazeTracker → QCMetrics
const gazeData = webgazer.getCurrentPrediction();
qcMetrics.addGazePoint(gazeData, precheckResult.pose);

// Camera FPS Monitor → QCMetrics
qcMetrics.setCameraFps(cameraFpsMonitor.getCurrentFps());
```


