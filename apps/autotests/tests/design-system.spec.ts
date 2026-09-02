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

  test('researcher navigation supports search, breadcrumbs and mobile drawer', async ({ page }) => {
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
    await expect(page.getByRole('navigation', { name: 'Хлебные крошки' })).toBeVisible();
    await expect(page.locator('.crumb-home')).toHaveAttribute('href', '#/overview');
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
