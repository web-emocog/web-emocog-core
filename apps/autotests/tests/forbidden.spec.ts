import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { getPageUrl } from './helpers/testUtils';
import { loadCases, runForbiddenCase } from './helpers/caseRunner';

// Получаем __dirname через require в CommonJS контексте
const __dirname = typeof require !== 'undefined' && require.main 
  ? dirname(require.main.filename).replace(/\\/g, '/')
  : process.cwd() + '/tests';

const PAGE_URL = getPageUrl();
const CASES_PATH = join(process.cwd(), 'tests', 'cases', 'forbidden.yml');

// Загружаем кейсы из YAML
const cases = loadCases(CASES_PATH);

// Генерируем тест для каждого кейса
cases.forEach((testCase) => {
  test(testCase.name, async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await expect(page.locator('body')).toBeVisible();
    await runForbiddenCase(page, testCase);
  });
});

