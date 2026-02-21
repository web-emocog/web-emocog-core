Структура
```
├── mvp_with_precheck_1.html  # UI и загрузка MediaPipe
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
