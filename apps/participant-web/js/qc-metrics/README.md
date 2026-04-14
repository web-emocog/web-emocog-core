# QC Metrics Module

Модуль контроля качества данных для eye-tracking исследований.

**Версия:** 3.4.0

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
| `illumination_ok_pct_min` | 90% | Минимум хорошего освещения |
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

QC Score вычисляется как взвешенная сумма нормализованных метрик (0-1):

| Метрика | Ключ | Вес |
|---------|------|-----|
| Face Visible | `faceVis` | 0.14 |
| Face OK | `faceOk` | 0.16 |
| Pose OK | `poseOk` | 0.08 |
| Illumination OK | `lightOk` | 0.06 |
| Eyes Open | `eyesOpen` | 0.06 |
| No Occlusion | `occlInv` | 0.10 |
| Gaze Valid | `gazeValid` | 0.14 |
| Gaze On Screen | `gazeOn` | 0.16 |
| No Dropout | `dropoutInv` | 0.04 |
| FPS OK | `fpsOk` | 0.06 |

**Штрафы (hard penalties):**
- Короткая сессия (< minDurationMs): × 0.35
- Низкая видимость лица (< face_visible_pct_min): × 0.6
- Низкий faceOk (< face_ok_pct_min): × 0.6
- Высокая окклюзия (> occlusion_pct_max): × 0.7
- Низкий gaze valid (< gaze_valid_pct_min): × 0.7
- Низкий gaze on screen (< gaze_on_screen_pct_min): × 0.7
- Много низкого FPS (> maxLowFpsTimeMs): × 0.6

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


