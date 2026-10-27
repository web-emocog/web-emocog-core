# HTML: Отображение И Целостность Данных

Дата: 27.10.2026. Ветка `feature/frame-pipeline-workers`, основа
`89880ef5c0b98530e1d87fe6b13596e077d08f46`. Предыдущий dirty diff сохранён.
Локальная работа, без commit/push, production, рабочих аккаунтов, камеры/микрофона.

## Результат

Завершён локальный подблок HTML-STAFF/REPORT, **не весь аудит приложения**.
11 строк исходной таблицы получили подтверждённый результат: пять исправлений
или подтверждённых прежних исправлений, шесть эвристических XSS-пунктов без
подтверждённого опасного source-to-sink пути. Остальные виды ошибок этих файлов
не объявляются исключёнными.

### Изменения

- Developer accounts: API role в `<option value>` и label экранируется, включая
  неизвестную роль; сообщение отказа тоже. Это defense-in-depth: не доказан
  обход серверного enum/authorization или опубликованный exploit.
- `setChips`: DOM/textContent вместо HTML-интерполяции. Первый chip остаётся
  active; текст, кавычки, ampersands и фактический ноль сохраняются.
- Legacy analytics session header/blocks: QC label/value/class/score, причины,
  browser/device/light/protocol и block names выводятся как текст/escaped.
  Badge class выбирается из внутреннего enum. Сохранены `<code>` и форматирование.
- `applySessionData`: рекурсивное слияние только через own data properties;
  `__proto__`/`constructor` остаются данными, не обходят inherited prototype или
  setter. Сохраняются собственные поля и ссылка на существующий nested object.
- Legacy numeric adapter: `null`, пустая строка, boolean, array/object не
  превращаются в 0/1. Реальный ноль и непустая конечная числовая строка остаются.
  Это исправление missingness, не изменение научных формул/порогов.
- Experiment counter: количество блоков только у массива, не произвольное
  `blocks.length` из импортированного/повреждённого JSON.
- Главная: устранён доступ к недоступному в этом scope `STORAGE_KEY`, из-за
  которого карточки проектов не появлялись. `refreshOverviewProjects`
  точечно обновляет секцию после API sync, не перерисовывая весь экран.
- Direct admin route обновляется после получения fresh server permissions.
  Cached admin identity не включает управление при свежем отказе сервера.
- Classic assets researcher core/bridge/experiments/analytics согласованно
  обновлены до query tag `20261027-2`. Participant module graph не менялся.

SQL, API schema/routes, auth grants, scientific acceptance thresholds, models,
sampling, RT и signal processing не менялись. Старые серверные метрики не
пересчитываются. Prototype merge предназначен для JSON данных; cyclic JS
objects/бесконечная глубина вне JSON contract этим тестом не разрешаются.

## Source-To-Sink Приёмка Строк

| Строка | Область | Результат |
| --- | --- | --- |
| 80 | participant ui-updated | Все HTML sinks: static translations/markup, finite/numeric output; policy text через textContent. XSS не подтверждён |
| 84 | participant ui legacy | Две QC HTML-вставки: static translations/numeric output. Неизвестный issues[] не вставляется как markup |
| 91 | session-report | Четыре static/clear HTML sinks; summary/heatmap/attention/events JSON через DOM text. Прежнее локальное исправление подтверждено |
| 102 | developer accounts | Исправлены role options; остальные поля/error уже escaped/text; update membership сохраняет точные IDs |
| 104 | BPM developer | Единственный HTML sink очищает log; сообщения/errors в textContent. Камера не запускалась |
| 108 | developer experiments | Все API-колонки escaped; empty/error rows static, dates форматируются; hostile API fixtures проверены |
| 110 | developer invite | IDs/code/count/date escaped; URL через encodeURIComponent; copy feedback textContent |
| 119 | admin/settings | Templates static; API text/attributes escapeAdminHtml, password DOM value; removal кодирует точный ID |
| 125 | API bridge | List/picker/banner/export static/DOM/escaped; исправлены own-property merge и numeric missingness |
| 132 | researcher core | Chips исправлены; project data escaped; иные HTML sinks — static translations/очистка |
| 136 | researcher experiments | Imported IDs/titles escaped; block counter и project cache/render исправлены |

Строка 123 остаётся **частичной**: закрыты перечисленные реальные legacy session
sinks, но остальные графики/tooltip 4500-строчного файла не объявлены полностью
проверенными. HTML-блок также сохраняет открытыми legacy shell 96, builder 131
и stimuli 140. Большая часть этих трёх файлов уже имеет локальные исправления,
но это не полная source-to-sink приёмка каждого пути.

## Проверки

| Набор | Фактический результат |
| --- | --- |
| Новые data-boundaries unit tests | 3/3; до исправления все три воспроизводили несоответствия |
| Полный API macOS / Node 24 | 553 всего: 548 pass, 5 skip, 0 fail |
| Полный API Linux / Node 22 | 553 всего: 549 pass, 4 skip, 0 fail |
| Disposable PostgreSQL 16 integration | 49/49 |
| HTML browser tests: 11 cases × 3 engines × 3 repeats | 99/99, retries=0 |
| Password/publication/stimuli/PDF regression, 3 engines | 144 pass, 3 explicit skip, 0 fail |
| Real-cookie API/UI + PostgreSQL: 2 synthetic researchers | 3/3; отдельная проверка трёх skipped UI cases |
| Participant runtime/Workers regression, 3 engines | 174/174 |
| Production analytics regression | 7/7 |
| FPS diagnostics с новым issue132 characterization | 30/30 |
| Staff HTTP regression, три движка | 48/48 |
| TypeScript, syntax, diff checks | Pass |

В сумме 505 успешных браузерных исполнений (повторы не считаются уникальными
cases). Нельзя смешивать ожидаемые красные внешние diagnostic tests из
issue132 с этой product regression: они проверяют другую семантику/нерешённые
FPS-задачи. Их оценка — в [отдельном отчёте](2026-10-27-issue132-comment-review.md).

Mac skips: два real converter smoke, Linux-only wrapper, два real nginx tests;
на Linux wrapper выполнен, остальные четыре требуют отдельных инструментальных
gates. PostgreSQL suites выполнены отдельно с синтетической disposable DB.

Первый browser run: 21 pass / 9 fail. Три группы причин: ранняя отрисовка admin
до получения прав, отсутствующие overview project cards, тест сравнивал uppercase
QC class с исходной строкой (преобразование регистра уже было частью адаптера).
Вторая попытка: 24/30; полная перерисовка overview при sync стирала transient
chips, а `STORAGE_KEY` не был доступен между функциями. Вместо blanket rerender
сделан точечный refresh секции. Затем 33/33 и финально 99/99, без скрытых retries.

Новый FPS characterization первоначально упал на дробных миллисекундах
`12999.999999999955` вместо 13000. Округление к целой миллисекунде в assert
исправило test fixture; QC timing/threshold не менялись.

## Подсчёт Аудита

Единица счёта — **строка исходной таблицы**, не коммит, тест или новая находка.
Машиночитаемый источник: `2026-10-26-backlog-status.json` / `auditTotals`.

| Категория | Строк |
| --- | ---: |
| Всего исходных | 239 |
| Исправлено в текущем коде | 49 |
| Исправлено/подтверждено локально | 19 |
| Исправлено суммарно | **68** |
| Неактуально, удалено или не подтверждён заявленный тип бага | **61** |
| Осталось выполнить/проверить, включая частичные | **110** |
| Из оставшихся — частично исправлено | 9 |

Таким образом, разобрано/снято с исполнения 129/239; это **не 129 исправленных
багов**. В этом этапе ещё 11 строк: пять подтверждённых исправлений и шесть
неподтверждённых XSS-эвристик. Новые отдельные FPS/scientific validation/posture
задачи не включены искусственно в знаменатель 239. Production не проверен.

## Следующее

Остаются четыре HTML-строки, phase-aware FPS/QC и startup/current/session
provenance, scientific validation, lifecycle/логирование/legacy/архитектурный
долг. Не снижать порог 25 и не обрезать eyeSignals без сохранения агрегатов,
coverage и научно понятного контракта только ради прохождения тестов.

До выпуска: review/CI, staging на реальном API и проверка cache tags. Rollback —
вернуть согласованный комплект изменённых classic assets и HTML, сохранив
workspace/drafts. Миграций БД нет. Google Sheet, GitHub issue и production не
изменялись. Тесты используют synthetic data и loopback, без записи биометрии.

Основания подхода:
[OWASP DOM XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html),
[OWASP Prototype Pollution Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html).
