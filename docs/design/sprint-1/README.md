# Web EmoCog UX/UI, Sprint 1

Рабочие артефакты задачи `S1-04` из роудмепа на 21.07-03.08.2026.

## Что входит

- `ux-ui-specification.md` - пользовательские потоки, дизайн-токены, состояния и mapping на текущий frontend.
- `handoff-checklist.md` - правила передачи дизайна Ане и критерии готовности.
- `mini-report.md` - отчёт по задаче, результаты проверки и вопросы для согласования.
- `prototype/` - отдельный кликабельный прототип researcher и participant flow.
- `svg/` - минималистичные SVG-макеты всех экранов для ручного импорта в Figma.

Production-файлы в `apps/web` и `apps/participant-web` в рамках этой задачи не изменяются.

## Запуск прототипа

Из корня репозитория:

```bash
python3 -m http.server 8088
```

Открыть:

```text
http://localhost:8088/docs/design/sprint-1/prototype/
```

Ключевые маршруты:

```text
#/overview
#/projects
#/project/overview
#/project/protocols
#/builder
#/project/participants
#/project/monitoring
#/project/results
#/session
#/library/stimuli
#/library/templates
#/settings
#/billing
#/states
#/participant/invite
```

## Источник дизайна

Figma: `AklUZ62D9WiHBwYKZJkqBG`.

Существующие `R0` и `R1` используются как визуальная база. Новые экраны продолжают ту же систему: Golos Text, IBM Plex Mono для данных, нейтральный светлый фон, teal как основной акцент и явные статусы качества.
