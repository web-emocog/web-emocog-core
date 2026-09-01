import { test, expect } from '@playwright/test';
import { getPageUrl, getActiveStep, navigateToStep } from './helpers/testUtils';

const PAGE_URL = getPageUrl();
const SMOKE_INVITATION_CODE = 'E2E-SMOKE';
const SMOKE_PAGE_URL = `${PAGE_URL}?code=${SMOKE_INVITATION_CODE}`;

test.beforeEach(async ({ page }) => {
  await page.route(`**/invitations/by-code/${SMOKE_INVITATION_CODE}**`, async route => {
    if (route.request().url().endsWith('/ingest-token')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'smoke-participant-token' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        invitation_id: 1,
        code: SMOKE_INVITATION_CODE,
        protocol_id: 1,
        project_id: 1,
        protocol_name: 'Smoke protocol',
        definition: {
          version: 'v2-smoke',
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

test.describe('Smoke: Базовая навигация', () => {
  test('Страница открывается и виден STEP 1', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    
    const step1 = page.locator('#step1');
    await expect(step1).toBeVisible();
    await expect(step1).toHaveClass(/active/);
    
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
  });

  test('Все шаги существуют на странице', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    
    for (let i = 1; i <= 6; i++) {
      const step = page.locator(`#step${i}`);
      await expect(step).toBeAttached();
    }
  });

  test('Переход с шага 1 на шаг 2 работает', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    
    const startBtn = page.getByRole('button', { name: /Начать|Start/i });
    await expect(startBtn).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await startBtn.click();
    
    await expect(page.locator('#step2')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#step1')).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const consentHeadingTop = await page.locator('#step2 h2').evaluate(
      heading => heading.getBoundingClientRect().top
    );
    expect(consentHeadingTop).toBeGreaterThanOrEqual(0);
  });

  test('Доступны десять языков интерфейса', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    
    const localeSelect = page.locator('#participantLanguageSelect');
    await expect(localeSelect).toBeVisible();
    await expect(localeSelect.locator('option')).toHaveCount(10);
  });

  test('Пречек не оставляет предыдущий язык и не подменяет шкалы английским', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    const localeSelect = page.locator('#participantLanguageSelect');
    const expectedLighting: Record<string, string> = {
      ru: 'Освещение', en: 'Lighting', zh: '光线', es: 'Iluminación', hi: 'रोशनी',
      ar: 'الإضاءة', fr: 'Éclairage', bn: 'আলো', pt: 'Iluminação', ur: 'روشنی',
    };

    for (const [locale, label] of Object.entries(expectedLighting)) {
      await localeSelect.selectOption(locale);
      await expect(page.locator('[data-i18n="label_light"]')).toHaveText(label);
      await expect(page.locator('.status-hint')).not.toHaveText('');
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
    }

    await localeSelect.selectOption('es');
    await expect(page.locator('.status-hint')).toContainText('indicador se vuelve verde');
    await localeSelect.selectOption('ru');
    await expect(page.locator('.status-hint')).toContainText('Зелёный индикатор');
    await expect(page.locator('.status-hint')).not.toContainText('indicador se vuelve verde');
  });
});

test.describe('Smoke: Consent Gating', () => {
  test('Кнопка согласия disabled по умолчанию', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step2');
    
    const consentBtn = page.locator('#consentBtn');
    await expect(consentBtn).toBeDisabled();
  });

  test('Кнопка согласия enabled после установки галочки', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step2');
    
    const consentCheck = page.locator('#consentCheck');
    const consentBtn = page.locator('#consentBtn');
    
    await expect(consentBtn).toBeDisabled();
    await consentCheck.check();
    await expect(consentBtn).toBeEnabled({ timeout: 2000 });
  });

  test('Переход на шаг 3 после согласия работает', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step2');
    
    await page.locator('#consentCheck').check();
    await page.locator('#consentBtn').click();
    
    await expect(page.locator('#step3')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#step2')).not.toBeVisible();
  });
});

test.describe('Smoke: Email шаг', () => {
  test('Email поле присутствует на шаге 3', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step3');
    
    const emailInput = page.locator('#userEmail');
    await expect(emailInput).toBeVisible();
    expect(await emailInput.getAttribute('type')).toBe('email');
  });
});

test.describe('Smoke: Анкета шаг', () => {
  test('Все обязательные поля присутствуют на шаге 4', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step4');
    
    await expect(page.locator('#age')).toBeVisible();
    await expect(page.locator('#gender')).toBeVisible();
    await expect(page.locator('#vision')).toBeVisible();
    await expect(page.locator('#inputDevice')).toBeVisible();
    await expect(page.locator('#keyboardType')).toBeVisible();
  });

  test('Кнопка формы disabled при неполной анкете', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step4');
    
    const formBtn = page.locator('#formBtn');
    await expect(formBtn).toBeDisabled();
  });

  test('Кнопка формы enabled при заполненной анкете', async ({ page }) => {
    await page.goto(SMOKE_PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step4');
    
    // Заполняем обязательные поля
    await page.locator('#age').fill('25');
    await page.locator('#age').blur();
    await page.waitForTimeout(300);
    
    await page.locator('#gender').selectOption('m');
    await page.locator('#vision').selectOption('normal');
    await page.locator('#inputDevice').selectOption('mouse');
    await page.locator('#keyboardType').selectOption('internal');
    
    const formBtn = page.locator('#formBtn');
    await expect(formBtn).toBeEnabled({ timeout: 3000 });
  });
});
