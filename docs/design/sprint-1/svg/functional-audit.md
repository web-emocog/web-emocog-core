# Функциональный аудит SVG-макетов

Проверка относится к дизайн-представлению функций. SVG не реализует API,
камеру или сбор сигналов, но должен показывать все экраны, действия и состояния,
которые потребуются при реализации.

## Кабинет исследователя

| ID | Функция | Представлено |
|---|---|---|
| R0 | Вход и регистрация | Вход, SSO, восстановление, отдельный registration state |
| R1 | Главная | Проекты, QC, предупреждения, последние сессии |
| R2 | Проекты | Поиск, статусы, открытие и создание |
| R3 | Новый проект | Название, владелец, цель, язык, хранение, privacy note |
| R4 | Обзор | Статус сбора, выборка, QC, устройства, новая ссылка |
| R5 | Протоколы | Версии, публикация, immutable snapshot, новый протокол |
| R6 | Конструктор | Блоки, сигналы, AOI, preview, publish |
| R7 | Участники | Invitation link, copy, funnel, session/QC statuses |
| R8 | Мониторинг | Live count, QC funnel, причины деградации, off-screen |
| R9 | Результаты | QC-фильтр, AOI heatmap, gaze, engagement, valence, export |
| R10 | Сессия | Общая временная шкала, head pose, off-screen, blinks total |
| R11 | Настройки | Команда, роли, consent version, retention, raw media |
| R12 | Стимулы | Поиск, загрузка, версии и VPC assets |
| R13 | Шаблоны | VPC, gaze drawing, RT, visual search |
| R14 | Тариф | Лимиты, использование, изменение тарифа |

## Веб участника

| ID | Функция | Представлено |
|---|---|---|
| P1 | Приглашение | Длительность, камера, выход, начало |
| P2 | Согласие | Обработка данных, checkbox, согласие и отказ |
| P3 | Устройство | Camera permission, свет, latency |
| P4 | Калибровка | 9 точек без кликов |
| P4a | Валидация успешна | Независимые точки, ошибка, hit rate |
| P4b | Валидация не пройдена | Честный результат и повторная калибровка |
| P5 | Инструкция | Задача, отсутствие подсказки взгляда, off-screen |
| P6 | Задание | Стимулы и ответ |
| P6b | SAM | Valence, arousal и связь со stimulus timeline |
| P7 | Завершение | Upload complete, blinks total, camera off, reward code |
| P8 | Камера недоступна | Permission/device recovery |
| P8b | Малый экран | Device eligibility и переход на компьютер |
| P8c | Offline upload | Локальное сохранение, retry, camera off |

## Сквозные требования

- Tracking продолжается в течение participant session, а не только calibration.
- Raw video не сохраняется по умолчанию.
- `low-confidence` не превращается в координату взгляда.
- `off-screen` не clamp-ится к viewport или AOI.
- Heatmap строится только по прошедшим QC frames.
- Blink total отображается на финальном и session screen.
- Camera tracks выключаются на final и pending-upload screens.
- AOI, gaze, engagement и valence имеют отдельные цветовые роли и подписи.
- Цвет не является единственным носителем статуса.
- Данные сопровождаются sample count, QC и algorithm version.

## Требует контракта при реализации

- API schema для AOI и heatmap layers.
- Пороговые значения calibration validation.
- Формат offline queue и retry policy.
- Названия и диапазоны QC states.
- Permission matrix для researcher roles.
