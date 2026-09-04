# Бэкапы файлов, контроль свежести и инструкция по ролям

Дата: 2026-09-04. Изменения подготовлены локально в `develop`.
Production не изменён; cloud-команды, bootstrap, назначение ролей, push и merge
в рамках этой работы не выполнялись. Это не подтверждение production rollout.

## Изменения и технические включения

- Ежедневный и предрелизный DB backup дополнены архивом uploads, если там есть
  файлы. Пустой каталог отражается в manifest без пустого архива. Пропавший
  каталог является ошибкой.
- Manifest с размерами и SHA-256 публикуется последним, после dump/checksum и
  uploads/checksum. Прерванная загрузка не считается завершённым комплектом.
- Новый `backup-support.py` использует только Python standard library: файловые
  проверки, создание/проверка архива, безопасный restore drill в новый каталог,
  manifest и атомарная публикация метрик.
- Состояние daily и pre-deploy раздельное. Ошибка не продвигает время последнего
  успеха; отслеживаются начало, результат, in-progress и число файлов.
- Существующие node-exporter и OTel Collector передают ограниченный набор
  backup-метрик, время VM и ошибку textfile collector. Новых контейнеров,
  зависимостей npm, VM, buckets, API-ключей и IAM-разрешений не добавлено.
- Bootstrap устанавливает helper и инициализирует метрики под release lock,
  сохраняя предыдущий успех. Включение новых collector flags требует отдельного
  reload мониторинга после установки всего bundle.
- Добавлена инструкция `docs/operations/USER_ROLES.md`. Каноническая матрица
  авторизации исправлена по текущему коду: developer технический, org_admin
  ограничен организациями. Runtime авторизации и интерфейс не менялись.

## Решения, безопасность и ограничения

- Все части набора находятся под существующим `postgresql/` lifecycle prefix;
  отдельная политика хранения uploads не требуется. Это полные копии, не
  инкрементальные: объём хранения/трафик увеличатся при появлении файлов. Новые
  метрики также расходуют квоту мониторинга; стоимость в этом отчёте не оценена.
- Backup отказывает при symlink/hardlink, специальных файлах, изменении файлов
  во время копирования, превышении 100 000 файлов или 10 GiB исходного содержимого.
  Проверка архива читает содержимое и gzip CRC, а не только каталог.
- Restore helper не использует `extractall`, запрещает traversal/links/duplicate
  names и требует несуществующий destination. Он не меняет production uploads
  или PostgreSQL. Восстановленные файлы имеют ограниченные права; перенос в
  production и смена владельца остаются отдельной операционной процедурой.
- Имена исходных файлов и содержимое не выводятся в логи helper. JSON состояния
  и backup artifacts защищены; экспортируются только числовые метрики с двумя
  фиксированными значениями `reason`. Контрольные суммы не являются подписью и
  не защищают от замены сразу объекта и его checksum.
- DB dump и файловый архив **не образуют одну транзакцию**. Изменения файлов
  проверяются, но для доказательства согласованного восстановления DB+uploads
  нужен отдельный drill в тихое окно без загрузки/удаления файлов.
- `last_run_success` не заменяет freshness/No data: SIGKILL, отказ диска или
  ошибка до начала инструментирования могут оставить старые метрики. Для новых
  серий нулевое начальное значение не выдаётся за успешный backup.
- Параметры новых алертов и порядок их включения после первого успешного backup
  описаны в runbook. Алёрты в облаке автоматически не создаются.
- Роли пользователей не повышались. Инструкция использует существующую
  `admin:bootstrap`, затем штатную cookie/CSRF-защищённую форму memberships.

API, JSON Schema, SQL schema и миграции не менялись. Научные алгоритмы,
measurement/QC thresholds и participant data flow не затронуты.

## Проверки

Локальная среда: macOS, Node.js 24.19.0, Python 3.14.3.
Использован установленный Node.js 24, соответствующий версии release gates.
Первый запуск на системном Node.js 18 дал 27 ошибок загрузки browser ESM;
Node.js 18 не соответствует `engines.node >=22` и не использован для приёмки.

| Проверка | Результат |
| --- | --- |
| `node --test tests/*.test.js` из `apps/api` на Node.js 24 | 237 passed, 0 failed; PostgreSQL integration suite отключён без test DB |
| `python3 -B -m unittest discover -s deploy/production/tests -v` | 12 passed, включая restore bytes, confinement, links, concurrent writes, gzip corruption, limits и metric transitions |
| Изолированная Bash orchestration в API suite | 7 сценариев: empty, files, dump failure, archive failure, upload failure, manifest failure, early failure; все прошли |
| `node scripts/release-audit.js` | passed |
| `bash -n` для `wecog-release` и `bootstrap.sh` | passed |
| `docker compose -f compose.monitoring.yaml config --quiet` с example env file | passed; контейнеры не запускались |
| `git diff --check` | passed |

Тесты используют локальные фикстуры и подменяют Docker/DB/Object Storage IO.
Они проверяют настоящий код orchestration и сохранение исходных кодов ошибок,
но не доказывают работоспособность IAM, сети, реального pg_dump/restore или
приёма новых метрик Monium. Live PostgreSQL, Ubuntu Python 3.10, production Docker
images, end-to-end Collector ingestion и браузерные тесты в этой работе не
запускались. Независимый download/restore drill остаётся шагом будущего rollout.

## Rollout и rollback

См. [runbook](../operations/CICD_YANDEX_CLOUD.md#database--uploads-backups-and-freshness-alerts).
До отдельного решения пользователя изменения остаются локальными и не дают
дополнительного production-покрытия. Нельзя устанавливать один новый release
script без helper и каталогов метрик.

После review: сохранить установленные служебные файлы для отката, выбрать окно
без backup/deploy, установить полный bundle, перезагрузить только мониторинг,
выполнить пробный daily backup, проверить объекты/метрики, настроить алерты и
провести изолированное восстановление. Обычный merge application-кода в main
сам по себе не обновляет служебные файлы VM.

При откате вернуть сохранённые controller/helper/monitoring-файлы и reload
мониторинга. Существующие backup objects и историю метрик не удалять, SQL не
откатывать. Если возвращается DB-only controller, новые алерты явно скорректировать,
поскольку старый controller больше не обновляет backup-метрики.
