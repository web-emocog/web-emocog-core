import { test, expect } from '@playwright/test';
import { join, dirname } from 'path';
import { getPageUrl } from './helpers/testUtils';
import { loadCases, runForbiddenCase } from './helpers/caseRunner';

// Получаем __dirname через require в CommonJS контексте
const __dirname = typeof require !== 'undefined' && require.main 
  ? dirname(require.main.filename).replace(/\\/g, '/')
  : process.cwd() + '/tests';

const PAGE_URL = getPageUrl();
const FORBIDDEN_INVITATION_CODE = 'E2E-FORBIDDEN';
const FORBIDDEN_PAGE_URL = `${PAGE_URL}?code=${FORBIDDEN_INVITATION_CODE}`;
const CASES_PATH = join(process.cwd(), 'tests', 'cases', 'forbidden.yml');

// Загружаем кейсы из YAML
const cases = loadCases(CASES_PATH);

test.beforeEach(async ({ page }) => {
  await page.route(`**/invitations/by-code/${FORBIDDEN_INVITATION_CODE}**`, async route => {
    if (route.request().url().endsWith('/ingest-token')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'forbidden-participant-token' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        invitation_id: 3,
        code: FORBIDDEN_INVITATION_CODE,
        protocol_id: 3,
        project_id: 1,
        protocol_name: 'Forbidden validation protocol',
        definition: {
          version: 'v2-forbidden',
          participantShell: {
            consent: true,
            questionnaire: true,
            precheck: true,
            calibration: true,
          },
          blocks: [],
        },
      }),
    });
  });
});

// Генерируем тест для каждого кейса
cases.forEach((testCase) => {
  test(testCase.name, async ({ page }) => {
    await page.goto(FORBIDDEN_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await expect(page.locator('body')).toBeVisible();
    await runForbiddenCase(page, testCase);
  });
});
