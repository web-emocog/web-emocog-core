# Мини-отчёт S1-04

## Статус

`Ready for review`. Задача не переводится в `Done` до приёмки ответственным
и подтверждения route/API/runtime mapping участниками команды.

## Внесённые правки

- Описан полный researcher flow `R0-R14`.
- Описан participant flow `P1-P8`, включая permission, calibration,
  degraded, upload и final states.
- Сформированы дизайн-токены, типографика, сетка и responsive breakpoints.
- Определены состояния `hover`, `focus`, `disabled`, `loading`, `error`,
  `empty`, `permission`, `no-data`, `low-confidence` и `off-screen`.
- Подготовлен route/component mapping на существующий frontend.
- Создан отдельный кликабельный прототип без правок production-файлов.
- Подготовлен `61` SVG-макет: все `R0-R14` и `P1-P8` в desktop/mobile,
  критические варианты, дизайн-система и системные состояния.
- SVG-версия переведена на более минималистичную и контрастную систему:
  иконная навигация, одно главное действие и сокращённые подписи.
- Цвета разделены по ролям: brand/action, data, success, warning и danger.
- Добавлены AOI heatmap, registration, calibration validation, SAM,
  unsupported-device и pending-upload states.
- Подготовлен handoff checklist для frontend, backend и participant runtime.

## Новые технические включения

- Статический прототип на HTML, CSS и JavaScript без новых зависимостей.
- Hash-based navigation для демонстрации всех экранов одним локальным URL.
- Адаптивный researcher shell и отдельный participant shell.
- Нативная keyboard navigation и видимый `focus-visible`.
- Поддержка `prefers-reduced-motion`.

## Особенности реализации

- Визуальная система продолжает существующие экраны Figma `R0` и `R1`:
  Golos Text, IBM Plex Mono для данных, светлый нейтральный фон и teal-акцент.
- Качество измерений не маскируется: отсутствие данных не заменяется нулём,
  низкая уверенность обозначается явно, а взгляд вне экрана не притягивается
  к визуальной цели.
- Тексты не обещают медицинскую или психологическую диагностику.
- Mobile layout сохраняет одно главное действие и порядок участника.
- Production-папки `apps/web` и `apps/participant-web` не изменялись.

## Проверка

- `24` маршрута проверены при `1440x900`.
- Те же `24` маршрута проверены при `390x844`.
- На каждом маршруте найден ровно один `h1`.
- Горизонтальный scroll отсутствует.
- Browser console errors отсутствуют.
- Custom validation формы нового проекта проверена.
- `node --check docs/design/sprint-1/prototype/app.js` проходит.
- Все SVG проходят `xmllint`; внешние изображения и зависимости отсутствуют.
- SVG-галерея содержит `61` карточку, фильтры работают без перезагрузки.

## Решения спорных вопросов

- Новые researcher routes пока помечены как планируемые, если их нет в
  production frontend. Прототип не создаёт фиктивный API-контракт.
- Мобильный кабинет исследователя проектируется адаптивно, но объём
  полноценного редактирования сложных протоколов на телефоне должен быть
  подтверждён командой.
- Demo/mock значения имеют явную маркировку и не выглядят как измеренные.
- Из-за лимита Figma Starter MCP готовая система зафиксирована в локальном
  прототипе и спецификации. Исходная Figma-страница не изменена.

## Требует согласования

- Канонические routes для `R3`, `R4`, `R7`, `R13` и `R14`.
- API schema для AOI, protocol versions, invitation и analytics export.
- Единые названия participant lifecycle и QC/signal states.
- Уровень поддержки сложного researcher editing на мобильных устройствах.
- Публичная регистрация исследователя или только invitation/SSO.

## Приёмка

- [ ] Работа принята ответственным по задаче: Валерия.
- [ ] Route/component mapping подтверждён Аней.
- [ ] API и permission states подтверждены Юлей.
- [ ] Participant lifecycle и signal states подтверждены Егором.
- [ ] Спорные решения оформлены в GitHub Issues.
- [ ] Работа принята тимлидом/техлидом.
