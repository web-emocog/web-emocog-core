# Issue 132: Оценка Внешней Диагностики

Дата сверки: 27.10.2026. [Комментарий spinerdab](https://github.com/web-emocog/web-emocog-core/issues/132#issuecomment-6439924942)
добавлен 27.10 в 10:45:09 UTC. Issue остаётся OPEN; в нём один комментарий.
Связанные открытые 123–131 без новых update timestamps относительно прошлой
проверки. Ни комментарии, ни статусы GitHub не изменялись.

## Источник И Проверка

Прочитаны [REPORT.md](https://github.com/user-attachments/files/34012245/REPORT.md)
и [zip](https://github.com/user-attachments/files/34012262/fps-diagnostics-issue.zip).
Архив: 60 entries, 547193 uncompressed bytes; media лица/аудио среди entries нет.
Приложения сохранены только в `/tmp`, не добавлены в Git и не заменили наш config.
Перед выполнением просмотрены диагностические Node tests и их зависимости;
camera lab/чужие launch scripts автоматически не запускались.

SHA-256 скачанных файлов:

```text
REPORT.md 5ccc9d8429071dd3f4ecaffe2903d2c13957a7cb91a87cd2560fd8ea95bd923b
zip       2b4dd01e5c66a8980415103a3ddaf2e688111e964ceb1e8d384f16136a79a1ee
```

Baseline из отчёта действительно существует:
`44dd1e84e0dec7c9d78be5a2228395f2d235b923`, merge #122 от 19.10.2026.
Это **не** текущий локальный candidate `89880ef…` с dirty исправлениями.
Для внешних Node tests созданы отдельные временные копии baseline и candidate,
без `.env`, uploads и рабочей БД; API только импортировался, сервер не слушал.
Node 24 и уже установленные текущие API dependencies использованы для обеих
копий; старый lockfile заново не устанавливался. Это не повтор авторского
hardware/browser окружения. T02 не зависит от скорости машины/камеры.

Неизменённые T02/T07: 27 tests; baseline **12 pass / 15 ожидаемых fail**.
Это совпадает с отчётом: T02 7/20 pass, T07 5/7 pass. На candidate — 17 pass /
10 fail; это не product regression pass и не основание автоматически править
схемы под названия полей внешнего теста. Часть assertions требует отдельного
решения о semantics, а не просто исправления кода.

## Оценка Присланной Работы

**Полезный, в значительной части воспроизводимый диагностический этап.
Для закрытия issue недостаточен.** Положительно: указан baseline, есть код
проверок, raw numeric artifacts, отдельные синтетика/ручные замеры, повторы и
ограничения. Измерения живой камеры на MacBook Air дополняют, а не заменяют
наши camera-free controls. Не даётся оценка человеку/срокам за пределами данных.

| Пункт | Что можно принять | Что ещё требуется |
| --- | --- | --- |
| T01 | Ненадёжность currentTime-гейта и расхождение показателей подтверждены файлами и кодом | Независимый capture/delivery/analysis счёт с monotonic длительностями; другое устройство/режим; 60/120 Hz |
| T02 | Управляемые часы, разделение camera/analysis и legacy расхождения воспроизводимы | Разделить контракты last window/session; не требовать session mean от текущего окна |
| T03 | Ablation 3×60 с, warmup, p50/p95; сегментация около 52–53 мс и существенная нагрузка на этом baseline | Actual pipeline end-to-end, baseline/candidate, RT latency, QC/mask equivalence, failures/cleanup |
| T04 | Симуляция на настоящих runtime classes объясняет перенос active QC в блок и брак при 17 FPS | Версионированное решение о фазах и no-data; UI/API flow вместо только моделирования |
| T05 | display:none не остановил синтетический источник; background delivery изменился | Фон физической камеры отдельно: captureStream producer сам замедляется; trial timers и recovery |
| T06 | Synthetic checkpoint cost и две описанные реальные сессии полезны как ограниченное наблюдение | 40 мин реального wall-time, FPS timeline, baseline/candidate, server checkpoints, memory/long tasks |
| T07 | Кодом подтверждено происхождение трёх legacy FPS полей | Method/window labels и сопоставление интервалов; проверяемый обезличенный ledger для заявленных 6615 совпадений |

### Важные Поправки К Выводам

1. **23,2 — наблюдаемая доставка к video/compositor, не доказанный физический
   предел сенсора.** `presentedFrames` описывает кадры, отправленные на
   композицию. Не установлено место потери: capture/driver, системные эффекты,
   браузер или presentation. `frameRate=30` как число — пожелание, не exact.
   В T03 `makeSource()` вообще задаёт width/height, но не frameRate; CAM —
   отдельный опыт с frameRate=30. Убрать категоричное «при любом коде».
2. **Проценты дублей — оценка риска, а не прямое сопоставление каждого input.**
   Простой gate и camera counter убедительно расходятся, но delivered frames,
   decoded frames и выполненные анализы нужно связать по timestamp/frame ID.
   T03 full не запускает весь gaze/QC/multimodal/stimulus runtime.
3. **Не все красные tests означают неверный counter.** После реального gap
   низкое последнее окно возможно корректно. Ошибка — выдавать его за среднее
   за сессию без подписи. Нельзя заменить локальный провал накопительным mean:
   высокое прошлое значение скроет текущую деградацию.
4. **Задержка 3 с сама по себе не доказанный баг.** Это debounce-policy. Нужно
   согласовать, с какого момента invalid trial interval отсчитывается и какие
   transient события допустимы, затем тестировать выбранную семантику.
5. **CAM rates не нормированы на фактическое elapsedMs каждого интервала.**
   Код считает presentedFrames на `await sleep(1000)`, но не пишет monotonic
   границы окон. В T03 elapsed измеряется. Добавить timestamps в CAM до точных
   сравнений 23,2 и requested 30; не угадывать реальную длительность по индексу s.
6. **T06 не 40-минутный wall-time soak.** Массивы ускоренно наращиваются до
   эквивалентного размера. Это полезный stress, но нет полных 40 мин inference,
   thermal/background behavior и server backup. Короткие probes с отменой
   сразу после IDB save не устанавливают отсутствие всех main-thread stalls.
7. **Diagnostic lab требует lifecycle cleanup.** Камера/модели останавливаются
   на success path, но у CAM/T03 нет полноценного finally на все ошибки;
   модели analyzer/pose/bpm/segmenter в конце не освобождаются. Изменяет нагрузку
   повторных запусков. Ошибки segmentation подавляются, missing face может
   подменяться synthetic landmarks; метрики failure/coverage нужны явно.
8. В REPORT остались несогласованные ограничения: «консоль с камерой не
   проверена» рядом с таблицей таких замеров; «полный flow с лицом не проверен»
   рядом с двумя реальными сессиями. Разделить manual и automated coverage.
   Заявленные session export comparisons не приложены как проверяемый ledger.

Семантика video callbacks проверена по
[MDN requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback),
запрос frameRate — по
[MDN MediaTrackConstraints.frameRate](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/frameRate).
Вывод о непродемонстрированном физическом потолке — inference из семантики API
и состава приложенных измерений, а не новая запись камеры на устройстве автора.

## Как Использованы Результаты

Добавлен локальный characterization к `apps/autotests/tests/fps-diagnostics.spec.ts`:
17 analysis FPS, camera publication 61, threshold 25/hardStop=false; активное
срабатывание примерно через 13 с, invalid-at-start и recovery перед следующим
блоком, сохранение исторического события. Вместе с прежними cases: **30/30 в
Chromium/Firefox/WebKit**. Реальная камера/микрофон и рабочие invitations не нужны.
Первоначальный assert поправлен только на округление float milliseconds.

Это подтверждение механизма, **не исправление phase policy** и не одобрение
инвалидации по инструкции. Thresholds, методы науки и issue status не менялись.
Рекомендации автоматически не переносятся: не снижать 25 по одному устройству,
не делать global session mean QC и не обрезать eyeSignals с потерей агрегатов.

Следующий отдельный этап: версия interval-based evidence по фазе/блоку/пробе,
ранняя диагностика способности устройства с явным решением исследователя,
session/current/render FPS с разными подписями; повтор ручной матрицы на том же
устройстве и candidate. Проверить системные видеоэффекты и capture отдельно.
Issue нельзя закрывать только на основании этого отчёта или новых unit tests.
