# Analytics production tests

`analytics-production.spec.ts` покрывает основной frontend-сценарий:

- block-scoped AOI для training/main с общим stimulus;
- нормализованные AOI coordinates;
- сохранение analyticsPlan block overrides;
- завершённую session, AOI, heatmap и resize alignment;
- snapshot-based JSON export и совпадение snapshot/hash/QC/N;
- сохранение nullable metric как `null + status`, а не `0`;
- group N и RU/EN accessibility labels.

Spec находится в общем пакете `apps/autotests` и запускается оттуда:

```powershell
cd ../autotests
npx playwright test --config playwright.analytics.config.ts
```

Конфигурация раздаёт корень репозитория, чтобы относительные импорты из
`apps/shared` проверялись так же, как в production static root.

Такой путь использует установленный в `apps/autotests` `@playwright/test` и
одинаково работает локально и в CI.
