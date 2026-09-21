import { test, expect } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:4173';

test.describe('wecog design system', () => {
  test('landing has one role chooser and three theme modes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${baseUrl}/apps/web/index.html`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.site-header .brand')).toHaveCount(1);
    await expect(page.locator('.site-header .brand')).toHaveAttribute('href', 'index.html');
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toHaveCount(0);
    await expect(page.locator('#landingFooter')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 }))
      .toHaveAccessibleName('Понимать реакцию точнее...');
    await expect(page.locator('.cards .card')).toHaveCount(3);
    await expect(page.getByRole('navigation', { name: 'Выбор роли' })).toBeVisible();

    const theme = page.locator('[data-wecog-theme-toggle]');
    await expect(theme).toBeVisible();
    await expect(theme).toHaveAttribute('data-theme-mode', 'auto');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const observed = new Set<string>();
    for (let index = 0; index < 3; index += 1) {
      observed.add((await theme.getAttribute('data-theme-mode')) || '');
      await theme.click();
    }
    expect(observed).toEqual(new Set(['auto', 'light', 'dark']));
  });

  test('landing mobile role chooser has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/apps/web/index.html`, { waitUntil: 'domcontentloaded' });

    const navigation = page.getByRole('navigation', { name: 'Выбор роли' });
    await expect(navigation).toBeVisible();
    const linkHeights = await navigation.getByRole('link').evaluateAll(links =>
      links.map(link => link.getBoundingClientRect().height)
    );
    expect(linkHeights.every(height => height >= 44)).toBe(true);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBe(0);
  });

  test('role cards lead to dedicated staff and participant login flows', async ({ page }) => {
    await page.goto(`${baseUrl}/apps/web/index.html`, { waitUntil: 'domcontentloaded' });

    await page.locator('#cardResearcher').click();
    await expect(page).toHaveURL(/developer\/login\.html\?portal=researcher$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход исследователя');
    await expect(page.locator('#registerForm')).toHaveCount(0);

    await page.goto(`${baseUrl}/apps/web/index.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#cardAdmin').click();
    await expect(page).toHaveURL(/developer\/login\.html\?portal=admin$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вход администратора');

    await page.goto(`${baseUrl}/apps/web/index.html`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#cardParticipant'))
      .toHaveAttribute('href', '../participant-web/invite.html');
  });

  test('participant stays light, exposes ten locales and has large controls', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(
      `${baseUrl}/apps/participant-web/mvp_with_precheck_1-updated.html`,
      { waitUntil: 'load' }
    );

    const locale = page.locator('#participantLanguageSelect');
    await expect(locale).toBeVisible();
    await expect(locale.locator('option')).toHaveCount(10);
    await locale.selectOption('es');
    await expect(page.locator('#step1 h1')).toHaveText('Bienvenido/a');
    await expect(page.locator('#applyInviteLinkBtn')).toHaveText('Aplicar enlace');
    await expect(page.locator('#inviteLinkInput')).toHaveAttribute(
      'placeholder',
      'Enlace o código de invitación'
    );
    await expect(locale).toHaveAttribute('aria-label', 'Idioma de la interfaz');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('#LightIndicator .label')).toHaveText('Iluminación');
    await expect(page.locator('#FaceIndicator .label')).toHaveText('Rostro');
    await expect(page.locator('#PoseIndicator .label')).toHaveText('Posición de la cabeza');
    await expect(page.locator('#VisibilityIndicator .label')).toHaveText('Visibilidad del rostro');
    await expect(page.locator('.status-hint')).toContainText('indicador se vuelve verde');
    await locale.selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#step1 h1')).toHaveText('مرحبًا');
    await locale.selectOption('es');
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('#participantLanguageSelect')).toHaveValue('es');
    await expect(page.locator('#LightIndicator .label')).toHaveText('Iluminación');
    await expect.poll(() => page.evaluate(() => Boolean(
      // @ts-expect-error Browser runtime state intentionally has no .d.ts.
      window.__WECOG_STATE__?.runtime?.sessionRuntime
    ))).toBe(true);
    const sessionBackgrounds = await page.evaluate(() => ({
      calibration: getComputedStyle(document.querySelector('#fullscreenCalibration')).backgroundColor,
      tracking: getComputedStyle(document.querySelector('.gaze-test-screen')).backgroundColor,
    }));
    expect(sessionBackgrounds.calibration).toBe('rgb(255, 255, 255)');
    expect(sessionBackgrounds.tracking).toBe('rgb(255, 255, 255)');
    const geometry = await page.evaluate(() => {
      const start = document.querySelector<HTMLElement>('#btnStartIntro');
      const select = document.querySelector<HTMLElement>('#participantLanguageSelect');
      return {
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        startHeight: start?.getBoundingClientRect().height || 0,
        selectHeight: select?.getBoundingClientRect().height || 0,
      };
    });
    expect(geometry.colorScheme).toContain('light');
    expect(geometry.overflow).toBe(0);
    expect(geometry.startHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.selectHeight).toBeGreaterThanOrEqual(44);
  });

  test('researcher navigation supports search and mobile drawer without redundant header navigation', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(
      `${baseUrl}/apps/web/researcher.html?analyticsPreview=1#/experiments`,
      { waitUntil: 'domcontentloaded' }
    );
    await expect(page.locator('.brand[href="#/overview"]')).toBeVisible();
    await expect(page.locator('#navCreateProtocol')).toBeVisible();
    await expect(page.locator('#navCreateProtocol')).toHaveAttribute(
      'href',
      '#/experiments/builder'
    );
    await expect(page.locator('#navSectionTitle')).toHaveText('Работа');
    await expect(page.locator('#navManagementTitle')).toHaveText('Управление');
    await expect(page.locator('#nav-experiments')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: 'Управление кабинетом' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Хлебные крошки' })).toHaveCount(0);
    await expect(page.locator('.crumb-home, #btnBack, #btnForward')).toHaveCount(0);
    await expect(page.locator('#nav-billing')).toBeHidden();

    const search = page.locator('#researcherNavSearch');
    await search.fill('биб');
    await expect(page.locator('#researcherSearchResults')).toBeVisible();
    await expect(page.locator('#researcherSearchResults')).toContainText('Библиотека');
    await search.fill('качество');
    await expect(page.locator('#researcherSearchResults a')).toHaveAttribute(
      'href',
      '#/analytics/data-quality'
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#mobileNavToggle')).toBeVisible();
    const closedGeometry = await page.evaluate(() => {
      const center = document.querySelector<HTMLElement>('.panel.center');
      const drawer = document.querySelector<HTMLElement>('.panel.left-panel');
      const centerRect = center?.getBoundingClientRect();
      return {
        centerTop: centerRect?.top ?? -1,
        centerHeight: centerRect?.height ?? 0,
        drawerPosition: drawer ? getComputedStyle(drawer).position : '',
      };
    });
    expect(closedGeometry.centerTop).toBe(0);
    expect(closedGeometry.centerHeight).toBeGreaterThanOrEqual(844);
    expect(closedGeometry.drawerPosition).toBe('fixed');
    await page.locator('#mobileNavToggle').click();
    await expect(page.locator('#mobileNavToggle')).toHaveAttribute('aria-expanded', 'true');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  test('researcher onboarding steps navigate to the matching workflows', async ({ page }) => {
    await page.goto(
      `${baseUrl}/apps/web/researcher.html?analyticsPreview=1#/overview`,
      { waitUntil: 'domcontentloaded' }
    );

    const onboarding = page.locator('.onb-step');
    await expect(onboarding).toHaveCount(4);
    await expect(onboarding.first()).toHaveAttribute('data-route', '#/experiments/builder');
    await onboarding.first().click();
    await expect(page).toHaveURL(/#\/experiments\/builder$/);
    await expect(page.locator('.bstep')).toHaveCount(9);
  });

  test('builder steps are freely navigable and emotion stimuli include editable default AOIs', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('emocog_protocol_step_draft', '4');
      localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify({
        title: 'Emotion AOI regression',
        protocolId: 'emotion-aoi-regression',
        estimatedDuration: '2 минуты',
        description: 'Default AOI regression',
        participantShell: {
          consent: true,
          questionnaire: false,
          precheck: false,
          calibration: false,
        },
      }));
      localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{
        id: 'emotion-task',
        type: 'cognitive_task',
        label: 'Просмотр эмоций',
        content: {
          taskType: 'emotion_viewing',
          useAOI: true,
          trials: [
            { stimulusId: 'std_emo_neutral_01', duration: 1000, repetitions: 1 },
            { stimulusId: 'std_emo_happy_01', duration: 1000, repetitions: 1 },
          ],
        },
      }]));
    });

    await page.goto(
      `${baseUrl}/apps/web/researcher.html?analyticsPreview=1#/experiments/builder`,
      { waitUntil: 'load' }
    );

    await expect(page.locator('.bstep')).toHaveCount(9);
    await expect(page.locator('.builder-aoi-card[data-aoi-ready="true"]')).toHaveCount(2);
    await expect(page.locator('#aoiStepNext')).not.toHaveAttribute('aria-disabled', 'true');

    await page.locator('.builder-aoi-edit').first().click();
    await expect(page.locator('#aoiEllipse')).toBeEnabled();
    await expect(page.locator('.aoi-list-row')).toHaveCount(3);
    await expect(page.locator('#aoiList')).toContainText(/Лицо|Face/);
    await expect(page.locator('#aoiList')).toContainText(/Глаза|Eyes/);
    await expect(page.locator('#aoiList')).toContainText(/Рот|Mouth/);
    await page.locator('#aoiClose').click();

    await page.locator('.bstep[data-step="1"]').click();
    await expect(page.locator('.bstep[data-step="1"]')).toHaveClass(/bstep-active/);
    await expect(page.locator('#view')).toContainText(/Выбор задачи|Task selection/);
    await expect(
      page.locator('#s0grid [title="PVT — Psychomotor Vigilance Test"]')
    ).toHaveCount(1);

    await page.locator('.bstep[data-step="6"]').click();
    await expect(page.locator('.session-feature').first().locator('xpath=..'))
      .not.toHaveAttribute('title', /.+/);
  });

  test('uploaded stimuli restore from the project API after local cache is cleared', async ({ page }) => {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
    const rows: Record<string, unknown>[] = [{
      id: 42, project_id: 7, folder_id: null, name: 'existing.png',
      mime_type: 'image/png', size_bytes: image.length, metadata: {},
      content_url: '/stimuli/42/content', content_available: true
    }];
    let failServerRead = false;
    await page.addInitScript(() => {
      localStorage.setItem('emocog_developer_auth', '1');
      localStorage.setItem('emocog_selected_project_id', '7');
    });
    await page.route('http://127.0.0.1:3000/**', async route => {
      const url = new URL(route.request().url());
      const headers = {
        'Access-Control-Allow-Origin': baseUrl,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS'
      };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname.endsWith('/auth/me')) return route.fulfill({ status: 200, headers, json: { id: 1, email: 'test@example.org', role: 'researcher' } });
      if (url.pathname.endsWith('/auth/permissions')) return route.fulfill({ status: 200, headers, json: {} });
      if (url.pathname.endsWith('/projects')) return route.fulfill({ status: 200, headers, json: [{ id: 7, name: 'Project' }] });
      if (url.pathname.endsWith('/stimuli/folders')) return route.fulfill({ status: 200, headers, json: [] });
      if (url.pathname.endsWith('/stimuli') && route.request().method() === 'GET') return route.fulfill({ status: 200, headers, json: rows });
      if (url.pathname.endsWith('/stimuli/upload')) {
        const id = failServerRead ? 44 : 43;
        const row = { id, project_id: 7, folder_id: null, name: 'new.png',
          mime_type: 'image/png', size_bytes: image.length, metadata: {},
          content_url: `/stimuli/${id}/content`, content_available: true };
        rows.push(row);
        return route.fulfill({ status: 201, headers, json: row });
      }
      if (url.pathname.endsWith('/stimuli/44/content')) return route.fulfill({ status: 503, headers, json: { error: 'File unavailable' } });
      if (/\/stimuli\/\d+\/content$/.test(url.pathname)) return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'image/png' }, body: image });
      return route.fulfill({ status: 404, headers, json: { error: 'Not mocked' } });
    });
    await page.goto(`${baseUrl}/apps/web/researcher.html?analyticsPreview=1#/stimuli`, { waitUntil: 'load' });
    await expect(page.locator('.stimulus-card[data-id="42"]')).toBeVisible();
    await page.evaluate(async bytes => {
      const file = new File([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))], 'new.png', { type: 'image/png' });
      await (window as any).handleFileUpload([file]);
    }, image.toString('base64'));
    await page.evaluate(() => localStorage.removeItem('emocog_stimuli'));
    await page.reload({ waitUntil: 'load' });
    await expect(page.locator('.stimulus-card[data-id="42"]')).toBeVisible();
    await expect(page.locator('.stimulus-card[data-id="43"]')).toBeVisible();
    failServerRead = true;
    const unavailable = await page.evaluate(async bytes => {
      const file = new File([Uint8Array.from(atob(bytes), char => char.charCodeAt(0))], 'broken.png', { type: 'image/png' });
      try { await (window as any).handleFileUpload([file]); return false; }
      catch { return true; }
    }, image.toString('base64'));
    expect(unavailable).toBe(true);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_stimuli') || '[]')
      .some((item: any) => String(item.id) === '44'))).toBe(false);
    const rejected = await page.evaluate(async () => {
      localStorage.removeItem('emocog_developer_auth');
      sessionStorage.removeItem('emocog_developer_auth');
      try {
        await (window as any).handleFileUpload([new File(['file'], 'offline.png', { type: 'image/png' })]);
        return false;
      } catch { return true; }
    });
    expect(rejected).toBe(true);
  });

  test('loads the project library when authentication completes after page scripts', async ({ page }) => {
    await page.route('http://127.0.0.1:3000/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const headers = { 'Access-Control-Allow-Origin': baseUrl, 'Access-Control-Allow-Credentials': 'true' };
      if (pathname.endsWith('/auth/me')) {
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({ status: 200, headers, json: { id: 1, email: 'test@example.org', role: 'researcher' } });
      }
      if (pathname.endsWith('/auth/permissions')) return route.fulfill({ status: 200, headers, json: {} });
      if (pathname.endsWith('/projects')) return route.fulfill({ status: 200, headers, json: [{ id: 7, name: 'Project' }] });
      if (pathname.endsWith('/stimuli/folders')) return route.fulfill({ status: 200, headers, json: [] });
      if (pathname.endsWith('/stimuli')) return route.fulfill({ status: 200, headers, json: [{
        id: 42, project_id: 7, name: 'restored.png', mime_type: 'image/png',
        size_bytes: 100, metadata: {}, content_available: false
      }] });
      return route.fulfill({ status: 404, headers, json: { error: 'Not mocked' } });
    });
    await page.goto(`${baseUrl}/apps/web/researcher.html#/stimuli`, { waitUntil: 'load' });
    await expect(page.locator('.stimulus-card[data-id="42"]')).toBeVisible();
    await expect(page.locator('.stimulus-card[data-id="42"]')).toContainText('restored.png');
  });

  test('developer pages share one active shell and preserve module geometry', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/auth/me', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': baseUrl,
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({
        id: 1,
        email: 'visual-check@wecog.test',
        role: 'developer',
        csrf_token: 'visual-check-csrf',
        auth_transport: 'cookie',
      }),
    }));
    await page.goto(`${baseUrl}/apps/web/developer/bpm-test.html`, { waitUntil: 'load' });

    await expect(page.locator('.developer-shell')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Навигация разработчика' })).toBeVisible();
    await expect(page.locator('.developer-shell__brand')).toHaveAttribute(
      'href',
      /\/apps\/web\/developer\.html$/
    );
    const geometry = await page.evaluate(() => {
      const screen = document.querySelector<HTMLElement>('#screen');
      const start = document.querySelector<HTMLElement>('#btnStart');
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        screenWidth: screen?.getBoundingClientRect().width || 0,
        startHeight: start?.getBoundingClientRect().height || 0,
      };
    });
    expect(geometry.overflow).toBe(0);
    expect(geometry.screenWidth).toBeLessThanOrEqual(480);
    expect(geometry.startHeight).toBeGreaterThanOrEqual(44);

    await page.goto(`${baseUrl}/apps/web/developer/emotion-test.html`, { waitUntil: 'load' });
    await expect(page.locator('#startBtn')).toBeVisible();
    await expect(page.locator('#status')).toContainText(/ready|готов/i);

    await page.goto(`${baseUrl}/apps/web/developer/audio-test.html`, { waitUntil: 'load' });
    await expect(page.locator('.developer-shell')).toHaveCount(1);
    await expect(page.locator('#startBtn')).toBeVisible();
    await expect(page.locator('#status')).toContainText(/not requested|не запрашивался/i);
    expect(pageErrors).toEqual([]);
  });

  test('direct developer module access fails closed without a staff session', async ({ page }) => {
    await page.route('**/auth/me', route => route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': baseUrl,
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ error: 'Unauthorized' }),
    }));
    await page.goto(`${baseUrl}/apps/web/developer/rt-test.html`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(/\/apps\/web\/developer\/login\.html$/);
  });
});
