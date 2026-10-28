# Библиотека Стимулов: Жизненный Цикл И Границы UI

Дата: 28.10.2026. Локальная ветка `fix/audit-diagnostics-lifecycle`, база
`f43713cd885d3dda2c2071984020341be2d83e4a`. Следующий адресный блок
исходного аудита: строка **141**, `apps/web/researcher-stimuli.js`.
Без отправки на GitHub, миграций, изменения рабочей БД и production rollout.
Другие незакоммиченные наработки в checkout сохранены.

## Подтверждённые Дефекты

1. `openAoiEditor()` ожидал загрузку preview и затем открывал окно без проверки
   исходного экрана. Тест до исправления: перейти из библиотеки в overview,
   завершить delayed preview; на другом экране появляется `#aoiClose`.
   Получено 1 вместо 0. Это воспроизведённый дефект, не вывод по наличию `await`.
2. Подписка `wecog:stimulisynced` удалялась только при следующем событии уже
   после удаления root. Resize/Intersection observers миниатюр не имели общего
   teardown при unmount. У AOI resize listener освобождался явной кнопкой,
   но не при смене экрана, проекта или блокировке аккаунта.
3. Отложенный layout/drag RAF и callbacks старых controls не были привязаны
   к lifetime редактора. Повторный запрос мог создать несколько окон с теми
   же DOM IDs. Naming dialog удерживал document keydown, собственные URLs
   и незавершённый promise после навигации.

Это клиентские дефекты жизненного цикла. Они не доказывают обход server RBAC
или утечку данных между пользователями: серверная staff/tenant проверка и
защита account-storage уже присутствовали и не ослаблялись.

## Исправления

- `createStimulusUiScope` учитывает DOM owner, account, route и, для transient
  UI, project/API/generation. Dispose идемпотентен; снимает owned listeners,
  observers и pending timeout/RAF, включая handle 0. Поздние callbacks
  дополнительно проверяют current context.
- Library shell может обновляться при выборе другого проекта в том же root.
  Это принципиально отличается от lifetime AOI, upload naming, folder picker
  и progress dialog. Старые окна закрываются без `onClose/onPersist/onChange`
  и без перехода к следующему материалу конструктора.
- Новый AOI request отменяет предыдущий, в том числе ожидающий preview.
  После await проверяются lifetime, актуальность объекта стимула и retirement.
  Factory errors освобождают уже зарегистрированные resources.
- Повторное создание thumbnail observers отключает прежние. Даже доставленный
  позже callback прежнего observer не запускает hydration и не отключает
  replacement observer. Сами workspace preview caches сохраняются.
- Cancel naming dialog завершает promise значением `null`, освобождает свои
  blob URLs и останавливает video/audio. Confirm передаёт ownership previews
  существующему uploader. Ошибка выделения второго URL освобождает первый.
  Сбой pause/load одного decoder не препятствует остальному teardown.
- Folder add/create защищены от повторного нажатия во время отправки.
  Поздний ответ не вызывает callbacks закрытого окна. Это не rollback уже
  выполненной сервером мутации: неизвестный результат не повторяется сам.
- `pagehide` освобождает UI resources. Persisted `pageshow` монтирует только
  библиотеку заново после проверки staff binding, не восстанавливая старые
  окна и не повторяя POST. Обновлён cache tag единственного изменённого
  classic script в `researcher.html`: `20261028-1`.

## Регрессии И Перепроверка

В ходе работы общий набор поймал чрезмерную отмену: первая версия scope
отключала и library shell при смене проекта. Прогон остановлен, исправлено
разделением shell и transient UI; targeted Chromium набор дал 36 passed.
Это промежуточная регрессия нашей локальной реализации, а не старый дефект.

Отдельный контроль BFCache сначала воспроизвёл неактивную библиотеку после
teardown: вкладка Upload оставалась скрытой. Добавлен persisted pageshow
remount и регрессия возврата. Синтетический PageTransitionEvent проверяет
обработчики, но не доказывает, что каждый браузер действительно кэширует
страницу в конкретной конфигурации.

Node fixture для IntersectionObserver сначала не наблюдала ни одного узла,
поэтому её `active` не становился true; исправлена fixture, а не assertion.
Первый API-прогон в sandbox не смог открыть localhost (`listen EPERM`);
результатом проверки приложения считается последующий разрешённый прогон.

Окончательный последовательный прогон на одном наборе исходников:

| Проверка | Результат |
| --- | --- |
| API/unit, Node 24/macOS | 593 tests: **588 passed**, 5 skipped, 0 failed |
| Staff regression, Chromium/Firefox/WebKit | **210 passed**, 3 skipped, 0 failed; retries=0 |
| Новые lifecycle browser cases в staff suite | **66 passed**, без skips/retries |
| HTML data boundaries, три движка | **33 passed**, 0 failed; retries=0 |
| Analytics production/scoped AOI, Chromium | **7 passed**, 0 failed |
| TypeScript, JS syntax, git diff --check | passed |

Исходники зафиксированы SHA-256 до запуска и повторно сверены после него.
Пять пропущенных unit tests требуют native converter/nginx/Linux tools на
этом macOS host; два PostgreSQL integration suites также не выполнялись.
Три staff skips относятся к прежнему случаю удаления протокола с isolated API
fixture (`RUN_RESEARCHER_CONTRACT`), по одному на движок. Новые tests не
пропускались. Это не проверка production DB или реального native conversion.

Покрытие новых тестов:

- delayed preview и уже открытый AOI: route, same-route remount, project,
  account, API origin, pagehide;
- настоящий поздний blob response, безопасное сохранение workspace cache;
- superseded editor, stale controls, штатные save/next/close callbacks;
- 100 mount/unmount и 100 immediate-unmount без растущих owned resources;
- cancel/confirm upload naming, image/video/audio, decoder/factory errors;
- single-flight folder create и неизвестный результат закрытого окна;
- BFCache event restore без старых AOI/naming dialogs;
- unit guards до прихода invalidation event, handle 0, late callback,
  identity-bound shell, замена observer без повреждения нового.

Команды из корня checkout:

```bash
cd apps/api && npm test
cd ../autotests
npm run typecheck
npm run test:staff-regression
npm run test:html-security
npx playwright test --config=playwright.analytics.config.ts
```

Новые browser cases включены в существующий staff regression config, который
уже вызывается release-gates workflow. Не добавлены retry/skip для этих cases.
Все API responses и файлы синтетические. Камера, микрофон, личные стимулы,
учётные записи и production API не используются.

## Ограничения

Это не полный XSS-аудит `researcher-stimuli.js`: строка 140 остаётся открытой.
Не менялись формулы AOI/gaze/RT, scientific thresholds, frame pipeline,
server media permissions, immutable publication или session ingest.
Проверки не подтверждают точность физиологии или FPS реальной камеры.
PostgreSQL/native deployment gates и выпуск не выполнялись.
UI cancellation не удаляет уже сохранённый на сервере файл или папку.
Чистота счётчиков owned ресурсов не является полным heap-профилированием.

## Счётчик Аудита

В исходных 239 строках **141** переведена в «Исправлено локально».
Итог: **73 исправлены**, **62 неактуальны/не подтверждены**,
**104 остаются**, включая **9 частично исправленных**.
Это закрытие одного проверенного блока, а не всего UI/security аудита.
Исходный Google Sheet и GitHub issues не редактировались.
