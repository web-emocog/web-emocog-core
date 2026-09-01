import { test, expect } from '@playwright/test';

const RESEARCHER_URL = process.env.EMOCOG_RESEARCHER_URL
  || 'http://127.0.0.1:4173/apps/web/researcher.html';
const RUN_RESEARCHER_CONTRACT = process.env.RUN_RESEARCHER_CONTRACT === '1';

type AuthPayload = {
  csrf_token?: string;
  user: Record<string, unknown>;
};

let cachedAuth: AuthPayload | null = null;
let cachedCookies: Awaited<ReturnType<import('@playwright/test').BrowserContext['cookies']>> = [];

test.describe('Researcher regressions', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !RUN_RESEARCHER_CONTRACT,
      'Set RUN_RESEARCHER_CONTRACT=1 and run the local API fixture'
    );
    if (!cachedAuth) {
      const response = await page.context().request.post('http://127.0.0.1:3000/auth/login', {
        headers: { 'X-Auth-Transport': 'cookie' },
        data: {
          email: process.env.EMOCOG_RESEARCHER_EMAIL || 'local.researcher@wecog.test',
          password: process.env.EMOCOG_RESEARCHER_PASSWORD || 'Researcher2026!',
        },
      });
      expect(response.ok(), `login failed with HTTP ${response.status()}`).toBe(true);
      cachedAuth = await response.json() as AuthPayload;
      cachedCookies = await page.context().cookies('http://127.0.0.1:3000');
    } else {
      await page.context().addCookies(cachedCookies);
    }
    await page.addInitScript(({ csrf_token, user }) => {
      localStorage.setItem('emocog_developer_auth', '1');
      localStorage.setItem('emocog_api_user', JSON.stringify(user));
      localStorage.setItem('emocog_api_base', 'http://127.0.0.1:3000');
      if (csrf_token) sessionStorage.setItem('emocog_csrf_token', csrf_token);
    }, cachedAuth);
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
    await expect(page.locator('#participantLinkInput')).toHaveValue('');
    await expect(page.locator('#copyParticipantLinkBtn')).toBeDisabled();
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
    await expect.poll(async () => page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('emocog_my_experiments') || '[]');
      return saved.find((entry: { protocolId?: string }) => entry.protocolId === 'e2e-protocol')?.invitationCode || '';
    })).not.toBe('');
    const invitationCode = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('emocog_my_experiments') || '[]');
      return saved.find((entry: { protocolId?: string }) => entry.protocolId === 'e2e-protocol')?.invitationCode;
    });
    const invitation = await page.request.get(
      `http://127.0.0.1:3000/invitations/by-code/${encodeURIComponent(invitationCode)}`
    );
    expect(invitation.ok()).toBe(true);
    const participantLink = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('emocog_my_experiments') || '[]');
      return saved.find((entry: { protocolId?: string }) => entry.protocolId === 'e2e-protocol')?.participantLink;
    });
    expect(participantLink).toContain(`/apps/participant-web/run_new.html?code=${invitationCode}`);
    expect(pageErrors).toEqual([]);
  });

  test('offers three readable themes and fully localizes admin and standard stimuli', async ({ page }) => {
    await page.goto(`${RESEARCHER_URL}#/admin`, { waitUntil: 'load' });

    const themeOptions = page.locator('.top-bar [data-wecog-theme-value]');
    await expect(themeOptions).toHaveCount(3);
    await page.locator('.top-bar [data-wecog-theme-value="light"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('.top-bar [data-wecog-theme-value="dark"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const contrast = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--wc-ink)';
      probe.style.backgroundColor = 'var(--wc-surface)';
      document.body.appendChild(probe);
      const style = getComputedStyle(probe);
      const parse = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (rgb: number[]) => {
        const channels = rgb.map(value => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const light = luminance(parse(style.color));
      const dark = luminance(parse(style.backgroundColor));
      probe.remove();
      return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(7);

    await page.locator('#langEn').click();
    await expect(page.locator('#view')).toContainText('Accounts and roles');
    await expect(page.locator('#view')).toContainText('Developer access');
    await expect(page.locator('#view')).not.toContainText('Учётные записи');

    await page.goto(`${RESEARCHER_URL}#/stimuli`, { waitUntil: 'load' });
    await expect(page.locator('#view')).toContainText('Simple RT: black square');
    await expect(page.locator('#view')).toContainText('Black square on a white background');
  });

  test('opens the protocol-scoped AOI editor instead of a placeholder', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('emocog_protocol_step_draft', '4');
      localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify({
        title: 'AOI regression',
        protocolId: 'aoi-regression',
        estimatedDuration: '2 минуты',
        description: 'AOI editor regression',
        participantShell: { consent: true, questionnaire: false, precheck: false, calibration: false },
      }));
      localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{
        id: 'aoi-task',
        type: 'cognitive_task',
        label: 'Simple RT',
        content: {
          taskType: 'simple_rt',
          useAOI: true,
          trials: [{ stimulusId: 'std_simple_black_square', condition: 'target', action: 'Space', duration: 500, repetitions: 1 }],
        },
      }]));
    });
    await page.goto(`${RESEARCHER_URL}#/experiments/builder`, { waitUntil: 'load' });
    await expect(page.locator('#builderAoiBlocks')).toBeVisible();
    await expect(page.locator('#view')).not.toContainText(/находится в разработке|in development/i);
    await page.locator('.builder-aoi-edit').click();
    await expect(page.locator('#aoiViewport')).toBeVisible();
    await expect(page.locator('#aoiRect')).toBeEnabled();
  });

  test('shows every stimulus from AOI-enabled blocks and hides unmarked blocks', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('emocog_protocol_step_draft', '4');
      localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify({
        title: 'AOI selection regression',
        protocolId: 'aoi-selection-regression',
        estimatedDuration: '2 минуты',
        description: 'AOI selection regression',
        participantShell: { consent: true, questionnaire: false, precheck: false, calibration: false },
      }));
      localStorage.setItem('emocog_protocol_blocks', JSON.stringify([
        {
          id: 'aoi-enabled-task',
          type: 'cognitive_task',
          label: 'AOI enabled',
          content: {
            taskType: 'go_nogo',
            useAOI: true,
            trials: [
              { stimulusId: 'std_go_green_circle', condition: 'Go', action: 'Space', duration: 500, repetitions: 1 },
              { stimulusId: 'std_nogo_red_circle', condition: 'No-Go', action: '', duration: 500, repetitions: 1 },
            ],
          },
        },
        {
          id: 'aoi-disabled-task',
          type: 'cognitive_task',
          label: 'AOI disabled',
          content: {
            taskType: 'simple_rt',
            useAOI: false,
            trials: [
              { stimulusId: 'std_simple_black_square', condition: 'target', action: 'Space', duration: 500, repetitions: 1 },
            ],
          },
        },
      ]));
    });

    await page.goto(`${RESEARCHER_URL}#/experiments/builder`, { waitUntil: 'load' });
    await expect(page.locator('.builder-aoi-edit')).toHaveCount(2);
    await expect(page.locator('#builderAoiBlocks')).toContainText('std_go_green_circle');
    await expect(page.locator('#builderAoiBlocks')).toContainText('std_nogo_red_circle');
    await expect(page.locator('#builderAoiBlocks')).not.toContainText('std_simple_black_square');
    await expect(page.locator('#aoiQueueButton')).toContainText(/Очередь разметки|Markup queue/);
    await expect(page.locator('#aoiStepNext')).toHaveAttribute('aria-disabled', 'true');

    await page.locator('#aoiQueueButton').click();
    await expect(page.locator('#aoiSaveNext')).toContainText(/Сохранить материал и далее|Save material and continue/);
    await expect(page.locator('#aoiClose').locator('xpath=preceding-sibling::div')).toContainText('1/2');
    for (let queueIndex = 0; queueIndex < 2; queueIndex += 1) {
      await page.locator('#aoiRect').click();
      const box = await page.locator('#aoiSvg').boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('AOI stage is unavailable');
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.70, box.y + box.height * 0.70);
      await page.mouse.up();
      await page.locator('#aoiSaveNext').click();
      if (queueIndex === 0) {
        await expect(page.locator('#aoiSaveNext')).toContainText(/Сохранить и завершить очередь|Save and finish queue/);
      }
    }
    await expect(page.locator('#aoiViewport')).toHaveCount(0);
    await expect(page.locator('#aoiStepNext')).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('renders visible colored QC tracks instead of collapsed range controls', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('emocog_protocol_step_draft', '6');
      localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify({
        title:'QC visual regression', protocolId:'qc-visual-regression', estimatedDuration:'2 минуты', description:'QC',
        participantShell:{ consent:true, questionnaire:false, precheck:false, calibration:false },
      }));
      localStorage.setItem('emocog_protocol_blocks', '[]');
    });
    await page.goto(`${RESEARCHER_URL}#/experiments/builder`, { waitUntil:'load' });
    await expect(page.locator('.qc-range')).toHaveCount(4);
    const track = await page.locator('.qc-range').first().evaluate(element => {
      const input = element as HTMLInputElement;
      const style = getComputedStyle(input);
      const pseudo = getComputedStyle(input, '::-webkit-slider-runnable-track');
      return {
        height:input.getBoundingClientRect().height,
        customTrack:style.getPropertyValue('--qc-track'),
        pseudoBackground:pseudo.backgroundImage,
      };
    });
    expect(track.height).toBeGreaterThanOrEqual(20);
    expect(`${track.customTrack} ${track.pseudoBackground}`).toContain('linear-gradient');
  });

  test('builds multiple typed surveys without duplicate ids', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('emocog_protocol_step_draft', '2');
      localStorage.setItem(
        'emocog_protocol_meta_draft',
        JSON.stringify({
          title: 'Survey E2E protocol',
          protocolId: 'survey-e2e-protocol',
          estimatedDuration: '3 минуты',
          description: 'Survey regression test',
          participantShell: {
            consent: true,
            questionnaire: false,
            precheck: false,
            calibration: false,
          },
        })
      );
      localStorage.setItem('emocog_protocol_blocks', '[]');
    });

    await page.goto(`${RESEARCHER_URL}#/experiments/builder`, {
      waitUntil: 'load',
    });

    const addSurvey = page.locator('#blockPalette button[data-type="survey"]');
    await expect(addSurvey).toBeVisible();
    await addSurvey.click();
    await addSurvey.click();
    await expect(page.locator('.proto-card[data-id^="survey_"]')).toHaveCount(2);

    const firstSurvey = page.locator('.proto-card[data-id^="survey_"]').first();
    await firstSurvey.locator('.edit-btn').click();
    await firstSurvey.locator('.survey-title-field').fill('Самочувствие после блока');
    await firstSurvey.locator('.survey-question-text').fill('Насколько понятным было задание?');
    await firstSurvey.locator('.survey-question-type').selectOption('single');

    const reopenedSurvey = page.locator('.proto-card[data-id^="survey_"]').first();
    await reopenedSurvey.locator('.survey-option-label').nth(0).fill('Понятно');
    await reopenedSurvey.locator('.survey-option-label').nth(1).fill('Непонятно');
    await reopenedSurvey.locator('.survey-question-required').check();
    await reopenedSurvey.locator('.survey-add-question').click();

    const surveyAfterAdd = page.locator('.proto-card[data-id^="survey_"]').first();
    const questions = surveyAfterAdd.locator('.survey-question-editor');
    await expect(questions).toHaveCount(2);
    await questions.nth(1).locator('.survey-question-text').fill('Что вы заметили?');
    await surveyAfterAdd.locator('.survey-add-question').click();

    const surveyWithThreeQuestions = page.locator('.proto-card[data-id^="survey_"]').first();
    const thirdQuestion = surveyWithThreeQuestions.locator('.survey-question-editor').nth(2);
    await thirdQuestion.locator('.survey-question-text').fill('Что повлияло на ответ?');
    await thirdQuestion.locator('.survey-question-type').selectOption('multiple');

    const finalSurvey = page.locator('.proto-card[data-id^="survey_"]').first();
    const finalThirdQuestion = finalSurvey.locator('.survey-question-editor').nth(2);
    await finalThirdQuestion.locator('.survey-option-label').nth(0).fill('Сложность');
    await finalThirdQuestion.locator('.survey-option-label').nth(1).fill('Усталость');
    await finalThirdQuestion.locator('.survey-option-label').nth(1).blur();

    const stored = await page.evaluate(() => JSON.parse(
      localStorage.getItem('emocog_protocol_blocks') || '[]'
    ));
    const surveys = stored.filter((block: { type?: string }) => block.type === 'survey');
    expect(surveys).toHaveLength(2);
    expect(new Set(surveys.map((block: { id: string }) => block.id)).size).toBe(2);
    expect(surveys[0].content.title).toBe('Самочувствие после блока');
    expect(surveys[0].content.questions.map((question: { type: string }) => question.type))
      .toEqual(['single', 'open', 'multiple']);
    expect(surveys[0].content.questions[0].required).toBe(true);
    expect(surveys[0].content.questions[2].options.map((option: { label: string }) => option.label))
      .toEqual(['Сложность', 'Усталость']);
  });

  test('uses consolidated navigation without duplicated project aliases', async ({ page }) => {
    await page.goto(`${RESEARCHER_URL}#/experiments`, {
      waitUntil: 'load',
    });

    await expect(page.locator('#projectNavigationWrap')).toHaveCount(0);
    await expect(page.locator('#nav-experiments')).toHaveClass(/active/);
    await expect(page.locator('#nav-experiments')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#navCreateProtocol')).toHaveAttribute(
      'href',
      '#/experiments/builder'
    );
    await expect(page.locator('#navSectionTitle')).toHaveText('Работа');
    await expect(page.locator('#navManagementTitle')).toHaveText('Управление');
    await expect(page.locator('#nav-experiments')).toContainText('Исследования');
    await expect(page.locator('#nav-stimuli')).toContainText('Библиотека');
    await expect(page.locator('#nav-analytics-parent')).toBeVisible();
    await expect(page.locator('#nav-settings')).toBeVisible();
    await expect(page.locator('#nav-billing')).toBeHidden();
    await expect(page.locator('#breadcrumbs')).toHaveAttribute('aria-label', 'Хлебные крошки');
    await expect(page.locator('a.brand')).toHaveAttribute('aria-label', 'wecog, главная');
    await expect(page.locator('#btnFocus')).toHaveAttribute('title', 'Режим фокуса');

    await page.locator('#langEn').click();
    await expect(page.locator('#breadcrumbs')).toHaveAttribute('aria-label', 'Breadcrumbs');
    await expect(page.locator('a.brand')).toHaveAttribute('aria-label', 'wecog, overview');
    await expect(page.locator('#btnFocus')).toHaveAttribute('title', 'Focus mode');

    await page.locator('#nav-analytics-session-card').click();
    await page.locator('[data-tab="data-quality"]').click();
    await expect(page).toHaveURL(/#\/analytics\/data-quality$/);
    await expect(page.locator('[data-tab="data-quality"]')).toHaveClass(/active/);
    await expect(page.locator('#view')).not.toContainText('Без demo');
  });

  test('opens Anya navigation as a mobile drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${RESEARCHER_URL}#/experiments`, {
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

    await page.locator('#nav-stimuli').click();
    await expect(page).toHaveURL(/#\/stimuli$/);
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
