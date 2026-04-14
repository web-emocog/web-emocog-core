import { test, expect } from '@playwright/test';
import { getPageUrl, getActiveStep, navigateToStep } from './helpers/testUtils';

const PAGE_URL = getPageUrl();

test.describe('Smoke: Базовая навигация', () => {
  test('Страница открывается и виден STEP 1', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    
    const step1 = page.locator('#step1');
    await expect(step1).toBeVisible();
    await expect(step1).toHaveClass(/active/);
    
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
  });

  test('Все шаги существуют на странице', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    
    for (let i = 1; i <= 6; i++) {
      const step = page.locator(`#step${i}`);
      await expect(step).toBeAttached();
    }
  });

  test('Переход с шага 1 на шаг 2 работает', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    
    const startBtn = page.getByRole('button', { name: /Начать|Start/i });
    await expect(startBtn).toBeVisible();
    await startBtn.click();
    
    await expect(page.locator('#step2')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#step1')).not.toBeVisible();
  });

  test('Переключатель языка присутствует', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    
    const langRu = page.locator('#langRu');
    const langEn = page.locator('#langEn');
    
    await expect(langRu).toBeVisible();
    await expect(langEn).toBeVisible();
  });
});

test.describe('Smoke: Consent Gating', () => {
  test('Кнопка согласия disabled по умолчанию', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step2');
    
    const consentBtn = page.locator('#consentBtn');
    await expect(consentBtn).toBeDisabled();
  });

  test('Кнопка согласия enabled после установки галочки', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step2');
    
    const consentCheck = page.locator('#consentCheck');
    const consentBtn = page.locator('#consentBtn');
    
    await expect(consentBtn).toBeDisabled();
    await consentCheck.check();
    await expect(consentBtn).toBeEnabled({ timeout: 2000 });
  });

  test('Переход на шаг 3 после согласия работает', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step2');
    
    await page.locator('#consentCheck').check();
    await page.locator('#consentBtn').click();
    
    await expect(page.locator('#step3')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#step2')).not.toBeVisible();
  });
});

test.describe('Smoke: Email шаг', () => {
  test('Email поле присутствует на шаге 3', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step3');
    
    const emailInput = page.locator('#userEmail');
    await expect(emailInput).toBeVisible();
    expect(await emailInput.getAttribute('type')).toBe('email');
  });
});

test.describe('Smoke: Анкета шаг', () => {
  test('Все обязательные поля присутствуют на шаге 4', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step4');
    
    await expect(page.locator('#age')).toBeVisible();
    await expect(page.locator('#gender')).toBeVisible();
    await expect(page.locator('#vision')).toBeVisible();
    await expect(page.locator('#inputDevice')).toBeVisible();
    await expect(page.locator('#keyboardType')).toBeVisible();
  });

  test('Кнопка формы disabled при неполной анкете', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
    await navigateToStep(page, 'step4');
    
    const formBtn = page.locator('#formBtn');
    await expect(formBtn).toBeDisabled();
  });

  test('Кнопка формы enabled при заполненной анкете', async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 30_000 });
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

