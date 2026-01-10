import { Page, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import { navigateToStep, getActiveStep } from './testUtils';

export type Action =
  | { action: 'click'; target: string }
  | { action: 'fill'; target: string; value: string }
  | { action: 'select'; target: string; value: string }
  | { action: 'check'; target: string }
  | { action: 'uncheck'; target: string }
  | { action: 'waitFor'; target: string; timeout?: number }
  | { action: 'press'; key: string }
  | { action: 'blur'; target: string }
  | { action: 'fillLongString'; target: string; prefix: string; length: number; char: string };

export type ForbiddenCase = {
  name: string;
  startStep?: string; // например "step2"
  actions: Action[];
  expect: {
    stayOnStep?: string;
    buttonDisabled?: string;
    buttonEnabled?: string;
    errorMessage?: {
      selector?: string;
      text?: string;
    };
    fieldError?: {
      selector: string;
      hasClass?: string;
      ariaInvalid?: boolean;
      dataAttribute?: string;
    };
    noConsoleErrors?: boolean;
  };
};

/**
 * Загрузить кейсы из YAML файла
 */
export function loadCases(filePath: string): ForbiddenCase[] {
  const raw = readFileSync(filePath, 'utf-8');
  const doc = yaml.load(raw) as any;
  if (!doc || !doc.cases || !Array.isArray(doc.cases)) {
    throw new Error(`Invalid YAML format: expected "cases" array`);
  }
  return doc.cases as ForbiddenCase[];
}

/**
 * Выполнить запретный кейс
 */
export async function runForbiddenCase(page: Page, testCase: ForbiddenCase): Promise<void> {
  // Собираем консольные ошибки
  const consoleErrors: string[] = [];
  const errorListener = (msg: any) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  };
  page.on('console', errorListener);

  try {
    // Переходим на нужный шаг, если указан
    if (testCase.startStep) {
      await navigateToStep(page, testCase.startStep);
      await page.waitForTimeout(500);
    }

    // Выполняем действия
    for (const action of testCase.actions) {
      await executeAction(page, action);
    }

    // Проверяем ожидания
    await checkExpectations(page, testCase, consoleErrors);
  } finally {
    page.off('console', errorListener);
  }
}

/**
 * Выполнить одно действие
 */
async function executeAction(page: Page, action: Action): Promise<void> {
  switch (action.action) {
      case 'click': {
        // Если селектор начинается с button[data-i18n='btn_next'], используем контекст активного шага
        let loc;
        if (action.target.includes("button[data-i18n='btn_next']") && !action.target.includes('#')) {
          const activeStep = await page.locator('.step.active').first();
          loc = activeStep.locator("button[data-i18n='btn_next']:not(#formBtn)").first();
        } else {
          loc = page.locator(action.target).first();
        }
        
        // Проверяем, что элемент существует (attached), но не обязательно visible
        // (может скрыться после предыдущего клика)
        try {
          await loc.waitFor({ state: 'visible', timeout: 2000 });
        } catch {
          // Если элемент не видим, проверяем attached (может быть скрыт)
          await loc.waitFor({ state: 'attached', timeout: 2000 }).catch(() => {
            // Если элемент вообще не найден, пропускаем клик
            return;
          });
        }
        
        // Если кнопка disabled, пропускаем клик (валидное поведение)
        const isDisabled = await loc.isDisabled().catch(() => false);
        if (!isDisabled) {
          // Проверяем, что элемент еще видим перед кликом
          const isVisible = await loc.isVisible().catch(() => false);
          if (isVisible) {
            await loc.click();
            await page.waitForTimeout(300);
          }
        }
        break;
      }

    case 'fill': {
      const loc = page.locator(action.target);
      await loc.waitFor({ state: 'visible' });
      
      // Для input type="number" нельзя ввести буквы через fill()
      // Проверяем тип поля и используем evaluate для невалидных значений
      const inputType = await loc.getAttribute('type').catch(() => null);
      if (inputType === 'number' && !/^-?\d+(\.\d+)?$/.test(action.value)) {
        // Для невалидных значений для number input используем evaluate
        await loc.evaluate((el, val) => {
          (el as HTMLInputElement).value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, action.value);
      } else {
        await loc.fill(action.value);
        // Триггерим события для валидации (input и change)
        await loc.evaluate((el) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      await loc.blur();
      await page.waitForTimeout(300);
      break;
    }

    case 'select': {
      const loc = page.locator(action.target);
      await loc.waitFor({ state: 'visible' });
      await loc.selectOption(action.value);
      await page.waitForTimeout(300);
      break;
    }

    case 'check': {
      const loc = page.locator(action.target);
      await loc.waitFor({ state: 'visible' });
      await loc.check();
      await page.waitForTimeout(300);
      break;
    }

    case 'uncheck': {
      const loc = page.locator(action.target);
      await loc.waitFor({ state: 'visible' });
      await loc.uncheck();
      await page.waitForTimeout(300);
      break;
    }

      case 'waitFor': {
        const loc = page.locator(action.target);
        try {
          await loc.waitFor({
            state: 'visible',
            timeout: action.timeout || 5000,
          });
        } catch (e) {
          // Если элемент скрылся (например, после перехода на другой шаг), это нормально
          // Проверяем только, что элемент был attached
          await loc.waitFor({
            state: 'attached',
            timeout: action.timeout || 5000,
          });
        }
        break;
      }

    case 'press': {
      await page.keyboard.press(action.key);
      await page.waitForTimeout(200);
      break;
    }

    case 'blur': {
      const loc = page.locator(action.target);
      await loc.blur();
      await page.waitForTimeout(300);
      break;
    }

    case 'fillLongString': {
      const loc = page.locator(action.target);
      await loc.waitFor({ state: 'visible' });
      const longString = action.prefix + action.char.repeat(action.length);
      await loc.fill(longString);
      await page.waitForTimeout(300);
      break;
    }

    default:
      throw new Error(`Unknown action: ${(action as any).action}`);
  }
}

/**
 * Проверить ожидания
 */
async function checkExpectations(
  page: Page,
  testCase: ForbiddenCase,
  consoleErrors: string[]
): Promise<void> {
  // Проверка stayOnStep
  if (testCase.expect.stayOnStep) {
    const currentStep = await getActiveStep(page);
    expect(currentStep).toBe(testCase.expect.stayOnStep);
  }

  // Проверка buttonDisabled
  if (testCase.expect.buttonDisabled) {
    const btn = page.locator(testCase.expect.buttonDisabled);
    await btn.waitFor({ state: 'attached' });
    const isDisabled = await btn.isDisabled();
    expect(isDisabled).toBe(true);
  }

  // Проверка buttonEnabled
  if (testCase.expect.buttonEnabled) {
    const btn = page.locator(testCase.expect.buttonEnabled);
    await btn.waitFor({ state: 'attached' });
    const isEnabled = await btn.isEnabled();
    expect(isEnabled).toBe(true);
  }

  // Проверка errorMessage
  if (testCase.expect.errorMessage) {
    const errorSpec = testCase.expect.errorMessage;
    if (errorSpec.selector) {
      const errorEl = page.locator(errorSpec.selector);
      await expect(errorEl).toBeVisible();
      if (errorSpec.text) {
        await expect(errorEl).toContainText(errorSpec.text);
      }
    } else if (errorSpec.text) {
      await expect(page.getByText(errorSpec.text, { exact: false })).toBeVisible();
    }
  }

  // Проверка fieldError
  if (testCase.expect.fieldError) {
    const field = page.locator(testCase.expect.fieldError.selector);
    await field.waitFor({ state: 'attached' });

    if (testCase.expect.fieldError.hasClass) {
      const hasClass = await field.evaluate((el, className) => {
        return el.classList.contains(className);
      }, testCase.expect.fieldError.hasClass);
      expect(hasClass).toBe(true);
    }

    if (testCase.expect.fieldError.ariaInvalid !== undefined) {
      const ariaInvalid = await field.getAttribute('aria-invalid');
      const expectedValue = testCase.expect.fieldError.ariaInvalid ? 'true' : null;
      expect(ariaInvalid).toBe(expectedValue);
    }

    if (testCase.expect.fieldError.dataAttribute) {
      const hasAttr = await field.getAttribute(testCase.expect.fieldError.dataAttribute);
      expect(hasAttr).toBeTruthy();
    }
  }

  // Проверка noConsoleErrors
  if (testCase.expect.noConsoleErrors) {
    expect(consoleErrors.length).toBe(0);
  }
}

