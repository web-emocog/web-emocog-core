# Analytics production tests

`analytics-production.spec.ts` покрывает основной frontend-сценарий:

- block-scoped AOI для training/main с общим stimulus;
- нормализованные AOI coordinates;
- сохранение analyticsPlan block overrides;
- завершённую session, AOI, heatmap и resize alignment;
- snapshot-based JSON export и совпадение snapshot/hash/QC/N;
- сохранение nullable metric как `null + status`, а не `0`;
- group N и RU/EN accessibility labels.

После установки `@playwright/test` тест запускается из `apps/web`:

```powershell
npx playwright test --config playwright.analytics.config.ts
```

В CI этот spec следует включить в общий пакет `apps/autotests` без изменения сценария.
