# rt_mvp — RT-компонент для большого веб-оркестра (Python, stdlib-only)

## Ключевая идея интеграции
Оркестр собирает события от разных инструментов (RT, gaze, blinks, HR, эмоции, QC).
RT-компонент:
1) принимает события (JSON/JSONL) **в общей схеме**
2) делает matching стимул→ответ и считает метрики/флаги
3) генерирует HTML-отчёт

Анализатор игнорирует неизвестные поля — оркестр может добавлять любые каналы.

## Event schema (минимальный набор)
- `instrument`: "rt"
- `session_id`: общий id сессии для всех инструментов
- `run_id`: id конкретного запуска RT задачи
- `event_type`: "stimulus_on" | "keypress" | ...
- `t_mono`: секунды от старта запуска (монотонные)
- `t_unix`: Unix seconds
- `trial_id`, `block_id`
- `stimulus_on`: `stimulus_id`, `stimulus_type`, `expected_response`, `timeout_ms`
- `keypress`: `button_id`

## Быстрый тест (офлайн)
### 1) Десктоп демо (Tkinter)
```bash
cd rt_component
python scripts/run_tk_experiment.py --task simple --trials 20
```

### 2) Анализ лога
```bash
python scripts/analyze_log.py logs/<file>.jsonl --task simple
```

## Формулы метрик
См. `README_METRICS.md`.
