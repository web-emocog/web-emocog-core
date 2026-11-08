# Emotion Test: точечная политика камеры

Дата: 08.11.2026. Ветка: `fix/emo_test_cam`, база актуального `origin/develop`:
`b3a3499`. Дерево базы совпадает с `f35b724`, на котором выполнялись проверки.
Production, аккаунты и данные не изменялись.

## Причина и исправление

Публичный HEAD-запрос к
`https://wecog.ru/apps/web/developer/emotion-test.html` подтвердил HTTP 200
и `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
`authorizeDiagnostic()` корректно останавливал запуск до загрузки моделей
и `getUserMedia`, если браузер сообщал о запрещённой камере. Поэтому разрешение
пользователя не запрашивалось. Поведение Safari само по себе не доказывает
корректность серверной политики; отдельный Safari workaround не вводится.

В `docker/web/nginx.conf` добавлен exact location только для этого HTML:
`camera=(self), microphone=(), geolocation=()`. Он не разрешает датчики всему
developer-каталогу. Повторены security headers, поскольку локальные `add_header`
отменяют наследование родительского набора. Query-параметры не мешают exact match.
Для legacy размещения то же исключение добавлено в
`deploy/nginx-participant-media.conf`, перед staff prefix.

Проверки admin/developer, fresh `/auth/me`, текущего staff identity и самой
Permissions-Policy сохранены. Камера запрашивается только после кнопки запуска;
policy не заменяет пользовательское разрешение. На других staff documents,
JS и похожих путях сохраняется default deny. Микрофон, геолокация, API policy
и participant policy не менялись. Другие самостоятельные developer diagnostics
не получили новых разрешений в рамках этого исправления.

Семантика пустого списка origins и `self`:
[W3C Permissions Policy](https://www.w3.org/TR/permissions-policy/#examples).

## Проверки

- Новый `emotion-camera-policy.test.js`: exact scope обеих конфигураций,
  сохранность остальных headers, staff admission и fresh checks до камеры.
- Расширен обязательный `smoke-test-web-image.sh`: реальный nginx-ответ,
  единственный точный policy header (дублирующий deny не допускается), версия
  URL с query, HTML MIME, остальные security headers, соседние staff/JS/near-miss
  paths. Старые проверки participant, приватных файлов и публичных модулей сохранены.
- `developer-bpm-lifecycle.spec.ts`: реальный document response header в браузере,
  разрешённый запуск/Stop и закрытие synthetic track, native Chromium policy deny
  до моделей/камеры, отозванная роль несмотря на разрешающий header. Native deny
  проверяется в Chromium; Firefox/WebKit пропускают только этот Chromium-specific
  case. Остальные lifecycle tests запускаются во всех трёх движках.

Фактические результаты этого этапа:

| Проверка | Результат |
| --- | --- |
| Новый Node contract | 3 passed |
| Полный API/unit, Node 24, последовательный запуск | 786 tests: 781 passed, 5 skipped, 0 failed |
| Developer lifecycle, Chromium/Firefox/WebKit | 82 passed, 2 skipped, 0 failed |
| Emotion cases в установленном Google Chrome, headless | 4 passed, 0 failed |
| `npm run typecheck` | Passed |
| Собранный web-образ: обязательный smoke, `nginx -t` | Passed |
| Legacy include: `nginx -t` в изолированном контейнере | Passed |
| `bash -n`, `git diff --check` | Passed |

Два browser skip — только native Chromium policy case в Firefox/WebKit.
Пять API skip — опциональные native conversion/nginx tests без соответствующих
host-инструментов; PostgreSQL integration этим запуском не выполнялась.
Browser fixture доставляет настоящий response header через Playwright, не
подменяет `allowsFeature` в новых Emotion cases; датчик, модели и auth ответы
синтетические. Image smoke отдельно проверяет header от настоящего nginx.
Локальные логи: `/tmp/wecog-emotion-policy-api.log`,
`/tmp/wecog-emotion-policy-browser.log`, `/tmp/wecog-emotion-policy-chrome.log`.

## Границы и выкладка

Новых зависимостей, моделей, API, схем, миграций или отправки измерений нет.
Emotion/FACS, cadence, QC и научные пороги не изменены. Проверки с synthetic
камерой не являются оценкой точности эмоций или реальной webcam performance.
Нужна ручная приёмка запроса разрешения и живого preview после выкладки
в Chrome/Edge/Safari. Отдельный Edge на этой машине не установлен.

Обычный PR в `develop`, затем согласованный merge в `main` и сборка/deploy
web-образа доставляют исправление. Для container deployment bootstrap/SSH,
ручной reload host nginx и изменения БД не нужны: edge proxy передаёт header
web-контейнера. На legacy server нужен review своего include, `nginx -t`
и согласованный reload; файл не устанавливался автоматически.
После деплоя заново открыть документ и проверить единственный
`camera=(self), microphone=(), geolocation=()` header. При сохранённом запрете
пользователя/ОС его нужно отдельно снять штатными настройками браузера.
Rollback: вернуть прежний web-образ; для legacy вернуть прежний include с
`nginx -t` и reload. Это вернёт запрет камеры, но не затронет данные.

Ветка предназначена для PR в `develop`. Создание PR, merge и production deploy
в рамках этого изменения не выполняются.
