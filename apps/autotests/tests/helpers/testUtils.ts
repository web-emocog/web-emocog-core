import { Page, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import path from 'path';

/**
 * Получить путь к HTML файлу и преобразовать в file:// URL
 */
export function getPageUrl(): string {
  const htmlPath = process.env.HTML_PATH || 
    path.resolve(process.cwd(), 'mvp_with_precheck_1.html');
  
  if (!existsSync(htmlPath)) {
    throw new Error(`HTML file not found: ${htmlPath}. Current dir: ${process.cwd()}`);
  }
  
  return pathToFileURL(htmlPath).toString();
}

/**
 * Получить активный шаг
 */
export async function getActiveStep(page: Page): Promise<string> {
  const activeStep = page.locator('.step.active');
  await activeStep.waitFor({ state: 'visible' });
  const stepId = await activeStep.getAttribute('id');
  if (!stepId) {
    throw new Error('Active step has no id attribute');
  }
  return stepId;
}

/**
 * Перейти к указанному шагу
 */
export async function navigateToStep(page: Page, targetStep: string): Promise<void> {
  const visited = new Set<string>();
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    const currentStep = await getActiveStep(page);
    
    if (currentStep === targetStep) {
      await page.waitForTimeout(500); // Стабилизация
      return;
    }

    if (visited.has(currentStep)) {
      throw new Error(`Navigation loop detected. Current: ${currentStep}, Target: ${targetStep}`);
    }
    visited.add(currentStep);

    // Логика навигации по шагам
    if (currentStep === 'step1') {
      await page.getByRole('button', { name: /Начать|Start/i }).click();
      await page.waitForTimeout(500);
    } else if (currentStep === 'step2') {
      // Проверяем чекбокс согласия
      const consentCheck = page.locator('#consentCheck');
      if (!(await consentCheck.isChecked())) {
        await consentCheck.check();
        await page.waitForTimeout(300);
      }
      const consentBtn = page.locator('#consentBtn');
      await expect(consentBtn).toBeEnabled({ timeout: 2000 });
      await consentBtn.click();
      await page.waitForTimeout(500);
    } else if (currentStep === 'step3') {
      // Заполняем email если пустой
      const emailInput = page.locator('#userEmail');
      const emailValue = await emailInput.inputValue();
      if (!emailValue || !emailValue.includes('@')) {
        await emailInput.fill('test@example.com');
        await emailInput.blur();
        await page.waitForTimeout(300);
      }
      await page.getByRole('button', { name: /Далее|Next/i }).click();
      await page.waitForTimeout(500);
    } else if (currentStep === 'step4') {
      // Заполняем обязательные поля анкеты
      const age = page.locator('#age');
      if ((await age.inputValue()) === '') {
        await age.fill('25');
        await age.blur();
        await page.waitForTimeout(200);
      }
      
      const gender = page.locator('#gender');
      if ((await gender.inputValue()) === '') {
        await gender.selectOption('m');
        await page.waitForTimeout(200);
      }

      const vision = page.locator('#vision');
      if ((await vision.inputValue()) === '') {
        await vision.selectOption('normal');
        await page.waitForTimeout(200);
      }

      const inputDevice = page.locator('#inputDevice');
      if ((await inputDevice.inputValue()) === '') {
        await inputDevice.selectOption('mouse');
        await page.waitForTimeout(200);
      }

      const keyboard = page.locator('#keyboardType');
      if ((await keyboard.inputValue()) === '') {
        await keyboard.selectOption('internal');
        await page.waitForTimeout(200);
      }

      const formBtn = page.locator('#formBtn');
      await expect(formBtn).toBeEnabled({ timeout: 3000 });
      await formBtn.click();
      await page.waitForTimeout(500);
    } else {
      // Для других шагов ищем кнопку "Далее"
      const nextBtn = page.locator('.step.active').getByRole('button', { 
        name: /Далее|Next|Продолжить|Continue/i 
      }).first();
      
      if (await nextBtn.count() > 0) {
        await nextBtn.click();
        await page.waitForTimeout(500);
      } else {
        throw new Error(`Cannot find navigation button on step ${currentStep}`);
      }
    }
  }

  const finalStep = await getActiveStep(page);
  throw new Error(
    `Failed to navigate to ${targetStep}. Final step: ${finalStep}. Visited: ${Array.from(visited).join(', ')}`
  );
}

/**
 * Проверить, что мы остались на указанном шаге
 */
export async function expectStayOnStep(page: Page, stepId: string): Promise<void> {
  const currentStep = await getActiveStep(page);
  expect(currentStep).toBe(stepId);
}

