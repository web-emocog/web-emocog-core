import { test, expect } from '@playwright/test';

const RESEARCHER_URL = process.env.EMOCOG_RESEARCHER_URL
  || 'http://127.0.0.1:4173/apps/web/researcher.html';

test.describe('Researcher regressions', () => {
  test.beforeEach(async ({ page, request }) => {
    const response = await request.post('http://127.0.0.1:3000/auth/login', {
      data: {
        email: 'researcher@wecog.local',
        password: 'WecogResearcher2026!',
      },
    });
    expect(response.ok()).toBe(true);
    const auth = await response.json();
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('emocog_developer_auth', '1');
      localStorage.setItem('emocog_api_token', token);
      localStorage.setItem('emocog_api_user', JSON.stringify(user));
      localStorage.setItem('emocog_api_base', 'http://127.0.0.1:3000');
    }, auth);
  });

  test('saves a protocol from the final builder step and confirms the result', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('download', download => download.cancel());
    await page.addInitScript(() => {
      localStorage.setItem('emocog_protocol_step_draft', '8');
      localStorage.setItem(
        'emocog_protocol_meta_draft',
        JSON.stringify({
          title: 'E2E protocol',
          protocolId: 'e2e-protocol',
          estimatedDuration: '2 минуты',
          description: 'Regression test',
          participantShell: {
            consent: true,
            questionnaire: true,
            precheck: false,
            calibration: false,
          },
        })
      );
      localStorage.setItem(
        'emocog_protocol_blocks',
        JSON.stringify([
          {
            id: 'instruction-1',
            type: 'instruction',
            label: 'Инструкция',
            content: {
              title: 'Инструкция',
              text: 'Выполните задание',
              buttonText: 'Далее',
            },
          },
        ])
      );
    });

    await page.goto(`${RESEARCHER_URL}#/experiments/builder`, {
      waitUntil: 'load',
    });
    const saveButton = page.locator('#finishSaveProtocolBtn');
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    await expect
      .poll(async () => page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem('emocog_my_experiments') || '[]'
        );
        return saved.some((entry: { protocolId?: string }) =>
          entry.protocolId === 'e2e-protocol'
        );
      }))
      .toBe(true);
    await expect(page.locator('.toast, [role="status"]')).toContainText(
      /Сохранено|Saved|опубликован|published/i
    );
    expect(pageErrors).toEqual([]);
  });

  test('uses global and selected-project navigation without changing layout', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('emocog_selected_project_id', '7');
    });
    await page.goto(`${RESEARCHER_URL}#/projects/7/protocols`, {
      waitUntil: 'load',
    });

    await expect(page.locator('#projectNavigationWrap')).toBeVisible();
    await expect(page.locator('#nav-project-protocols')).toHaveClass(/active/);
    await expect(page.locator('#nav-experiments')).toContainText('Проекты');
    await expect(page.locator('#nav-stimuli')).toContainText('Библиотека');
    await expect(page.locator('#nav-billing')).toContainText('Тариф');

    await page.locator('#nav-project-participants').click();
    await expect(page).toHaveURL(/#\/projects\/7\/participants$/);
    await expect(page.locator('#nav-project-participants')).toHaveClass(/active/);
  });

  test('opens the same project navigation as a mobile drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem('emocog_selected_project_id', '7');
    });
    await page.goto(`${RESEARCHER_URL}#/projects/7/protocols`, {
      waitUntil: 'load',
    });

    const centerWidth = await page.locator('.panel.center').evaluate(
      element => element.getBoundingClientRect().width
    );
    expect(centerWidth).toBeGreaterThan(350);
    await expect(page.locator('#mobileNavToggle')).toBeVisible();
    await page.locator('#mobileNavToggle').click();
    await expect(page.locator('#mobileNavigationPanel')).toBeVisible();
    await expect.poll(async () => {
      const box = await page.locator('#mobileNavigationPanel').boundingBox();
      return box ? { x: Math.round(box.x), width: Math.round(box.width) } : null;
    }).toEqual({ x: 12, width: 280 });
    await expect(page.locator('#mobileNavToggle')).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    await page.locator('#nav-project-results').click();
    await expect(page).toHaveURL(/#\/projects\/7\/results$/);
    await expect(page.locator('#mobileNavToggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });
});

test('does not expose pulse or emotion as standalone participant tests', async ({ page }) => {
  await page.goto(
    'http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html',
    { waitUntil: 'domcontentloaded' }
  );
  await expect(page.locator('#hubRunBpmBtn')).toHaveCount(0);
  await expect(page.locator('#bpmTestScreen')).toHaveCount(0);
});
