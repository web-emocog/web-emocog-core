Структура
```
├── mvp_with_precheck_1.html  # UI и загрузка MediaPipe)
├── style.css                 # Стили интерфейса и индикаторов состояния
├── translations.js           # Словарь для RU/EN
└── js/
    ├── app.js                # Инициализация и приём gaze/eye-signal в sessionData
    ├── state.js              # Конфиг, состояние сессии, фазы и события
    ├── precheck.js           # Логика pre-check (освещение, поза, видимость лица)
    ├── tests.js              # Калибровка, валидация, tracking test, завершение сессии
    ├── experimental_task.js  # Когнитивный контур (instruction/task blocks, trial events)
    ├── heatmap.js            # Построение heatmap per-stimulus/per-block
    ├── eye-signal.js         # Извлечение EAR/iris proxy из кадров анализа
    ├── camera.js             # Работа с видеопотоком, измерение FPS камеры/рендера
    └── ui.js                 # Навигация по шагам, локализация и вывод QC-отчета
```

Поток после калибровки:
- После `calibration + validation` запускается Test Hub (меню выбора тестов).
- RT/Tracking запускаются через существующие модули (`experimental_task.js`, `tests.js`) с callback-возвратом в Hub.
- Новые gaze-тесты вынесены в `apps/participant-web/js/gaze-tracker/gaze-tests/*`:
  - `VPC (Felidae)`
  - `Visuospatial drawing`