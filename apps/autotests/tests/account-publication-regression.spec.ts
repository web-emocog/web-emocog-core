import { test, expect } from '@playwright/test';

const web = 'http://127.0.0.1:4173';
const api = 'http://127.0.0.1:3000';
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('changing staff account locks the old tab, caches and requests; same-account CSRF can recover', async ({ context, page }) => {
  let actor = 1;
  let csrf = 'csrf-1';
  let rejectedUploads = 0;
  let acceptedUploads = 0;
  const user = () => ({ id: actor, role: 'researcher', email: `user-${actor}@example.test` });
  await context.addInitScript(() => {
    if (localStorage.getItem('account-fixture')) return;
    localStorage.setItem('account-fixture', '1');
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_api_user', JSON.stringify({ id: 1, role: 'researcher', email: 'user-1@example.test' }));
    localStorage.setItem('emocog_selected_project_id', '7');
    localStorage.setItem('wecog_researcher_language', 'ru');
  });
  await context.route(`${api}/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': web, 'Access-Control-Allow-Credentials': 'true' };
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers, json: body });
    if (path === '/auth/login') {
      actor = 2; csrf = 'csrf-2';
      return json({ user: user(), csrf_token: csrf, auth_transport: 'cookie' });
    }
    const expected = request.headers()['x-staff-user-id'];
    if (expected && expected !== String(actor)) return json({ code: 'staff_account_changed' }, 409);
    if (path === '/auth/me') return json({ ...user(), csrf_token: csrf });
    if (path === '/auth/permissions') return json({});
    if (path === '/projects') return json([{ id: 7, name: 'Shared project' }]);
    if (path === '/stimuli/folders') return json([]);
    if (path === '/stimuli/upload') {
      if (request.headers()['x-csrf-token'] !== csrf) {
        rejectedUploads++;
        return json({ code: 'csrf_token_invalid' }, 403);
      }
      acceptedUploads++;
      return json({ id: 44, project_id: 7, created_by: actor, visibility: 'private' }, 201);
    }
    if (path === '/stimuli') return json([{ id: actor + 40, project_id: 7, created_by: actor,
      name: `Personal image ${actor}`, visibility: 'private', mime_type: 'image/png',
      content_available: true, content_url: `/stimuli/${actor + 40}/content`, metadata: {} }]);
    if (path.endsWith('/content')) return route.fulfill({ status: 200, headers: { ...headers, 'Content-Type': 'image/png' }, body: pixel });
    return json({ error: 'Not mocked' }, 404);
  });
  await page.goto(`${web}/apps/web/researcher.html#/stimuli`);
  await expect(page.locator('.stimulus-card[data-id="41"]')).toBeVisible();
  const second = await context.newPage();
  await second.goto(`${web}/apps/web/developer/login.html?portal=researcher`);
  await second.locator('#login').fill('user-2@example.test');
  await second.locator('#password').fill('synthetic-password-only');
  await second.locator('#form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#staffSessionChanged')).toBeVisible();
  await second.waitForURL(/researcher\.html/);
  await second.goto(`${web}/apps/web/researcher.html#/stimuli`);
  await expect(second.locator('.stimulus-card[data-id="42"]')).toBeVisible();
  await expect(second.locator('.stimulus-card[data-id="41"]')).toHaveCount(0);
  expect(await page.evaluate(async () => {
    try { await (window as any).apiPatch('/stimuli/42', { visibility: 'project' }); return 'sent'; }
    catch (error: any) { return error.code; }
  })).toBe('staff_account_changed');
  expect(await page.evaluate(() => {
    try { localStorage.setItem('wecog_researcher_language', 'ru'); return 'written'; }
    catch (error: any) { return error.code; }
  })).toBe('staff_account_changed');
  await second.evaluate(() => localStorage.setItem('wecog_researcher_language', 'en'));
  csrf = 'rotated-same-user';
  const result = await second.evaluate(async () => {
    const form = new FormData();
    form.append('file', new Blob(['synthetic']), 'test.png');
    form.append('project_id', '7');
    return (window as any).apiPost('/stimuli/upload', form);
  });
  expect(result).toMatchObject({ created_by: 2, visibility: 'private' });
  expect(rejectedUploads).toBe(1);
  expect(acceptedUploads).toBe(1);
  await page.locator('#staffSessionChanged button').click();
  await expect(page.locator('.stimulus-card[data-id="42"]')).toBeVisible();
  await expect(page.locator('#staffSessionChanged')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('wecog_researcher_language'))).toBe('en');
});

test('publishing an edited protocol creates a new pinned invitation, never an old-code lookup', async ({ page }) => {
  let created = 0;
  let patched = 0;
  let oldLookups = 0;
  await page.addInitScript(() => {
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_selected_project_id', '7');
    localStorage.setItem('emocog_builder_api_edited', JSON.stringify({ apiProtocolId: 9, invitationCode: 'old-code' }));
  });
  await page.route(`${api}/**`, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/auth/me') return json({ id: 1, role: 'researcher', email: 'user@example.test' });
    if (path === '/auth/permissions') return json({});
    if (path === '/projects') return json([{ id: 7, name: 'Project' }]);
    if (path === '/protocols/9' && request.method() === 'PATCH') {
      patched++;
      return json({ id: 9, project_id: 7, ...request.postDataJSON() });
    }
    if (path === '/invitations' && request.method() === 'POST') {
      created++;
      return json({ id: 50 + created, protocol_id: 9, code: `new-code-${created}` }, 201);
    }
    if (path.startsWith('/invitations')) oldLookups++;
    if (path === '/stimuli' || path === '/stimuli/folders') return json([]);
    return json({ error: 'Not mocked' }, 404);
  });
  await page.goto(`${web}/apps/web/researcher.html#/overview`);
  await page.waitForFunction(() => Boolean((window as any).publishBuilderProtocolAndInvitation));
  for (const code of ['new-code-1', 'new-code-2']) {
    const publication = await page.evaluate(async () => (window as any).publishBuilderProtocolAndInvitation({
      protocolId: 'edited', title: 'RT only', version: '1.0.0', blocks: [{ id: 'rt', type: 'cognitive_task', trials: [] }]
    }, 'edited', 'edited'));
    expect(publication.invitation.code).toBe(code);
    expect(publication.link).toContain(`?code=${code}`);
  }
  expect(patched).toBe(2);
  expect(created).toBe(2);
  expect(oldLookups).toBe(0);
});

test('builtin AOIs survive catalog refresh and preserve custom and explicitly empty markup', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('aoi-fixture')) return;
    localStorage.setItem('aoi-fixture', '1');
    localStorage.setItem('emocog_protocol_step_draft', '4');
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify([{
      id: 'builtin-aoi', type: 'cognitive_task', label: 'Builtin AOIs', content: {
        taskType: 'simple_rt', useAOI: true, trials: ['std_emo_happy_01', 'std_simple_black_square', 'std_nback_diamond']
          .map(stimulusId => ({ stimulusId, action: 'KeyZ', duration: 1000, repetitions: 1 }))
      }
    }]));
  });
  await page.goto(`${web}/apps/web/researcher.html?analyticsPreview=1#/experiments/builder`);
  await expect(page.locator('.builder-aoi-card[data-aoi-ready="true"]')).toHaveCount(3);
  const result = await page.evaluate(() => {
    const w = window as any;
    w.ensureStandardStimuli();
    const rows = JSON.parse(localStorage.getItem('emocog_stimuli') || '[]');
    const aoi = w.EmocogAoiProtocol;
    const defaults = aoi.buildAoiDefinitions(rows, ['std_emo_happy_01', 'std_simple_black_square', 'std_nback_diamond']);
    const face = rows.find((row: any) => row.id === 'std_emo_happy_01');
    face.aois = [{ ...defaults.std_emo_happy_01[0], id: 'custom-face' }];
    rows.find((row: any) => row.id === 'std_nback_diamond').aois = [];
    localStorage.setItem('emocog_stimuli', JSON.stringify(rows));
    return { defaults, valid: aoi.validateAoiDefinitions(defaults, '1.2').ok };
  });
  expect(result.valid).toBe(true);
  expect(result.defaults.std_emo_happy_01).toHaveLength(3);
  expect(result.defaults.std_simple_black_square).toHaveLength(1);
  await page.reload();
  const saved = await page.evaluate(() => {
    (window as any).ensureStandardStimuli();
    const rows = JSON.parse(localStorage.getItem('emocog_stimuli') || '[]');
    return { face: rows.find((row: any) => row.id === 'std_emo_happy_01').aois,
      diamond: rows.find((row: any) => row.id === 'std_nback_diamond').aois };
  });
  expect(saved.face.map((aoi: any) => aoi.id)).toEqual(['custom-face']);
  expect(saved.diamond).toEqual([]);
  await expect(page.locator('.builder-aoi-card[data-aoi-ready="true"]')).toHaveCount(2);
  await expect(page.locator('.builder-aoi-card[data-aoi-ready="false"]')).toHaveCount(1);
});

test('a new invitation cannot restore the previous invitation checkpoint or results', async ({ page }) => {
  await page.route(`${api}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/invitations/by-code/new-invitation') return route.fulfill({ json: {
      invitation_id: 9, protocol_id: 9, project_id: null, protocol_name: 'RT only', code: 'new-invitation',
      definition: { version: '1.0.0', blocks: [{ id: 'rt-new', type: 'cognitive_task', taskType: 'simple_rt',
        blockConfig: { useFixation: false }, trials: [{ stimulusId: 'std_simple_black_square', action: 'KeyZ', duration: 1000 }] }] }
    } });
    return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
  });
  const participant = `${web}/apps/participant-web/mvp_with_precheck_1-updated.html`;
  await page.goto(participant);
  await page.waitForFunction(() => Boolean((window as any).__WECOG_STATE__?.runtime?.sessionRuntime));
  await page.evaluate(async () => {
    const state = (window as any).__WECOG_STATE__;
    const runtime = state.runtime.sessionRuntime;
    runtime.enterInstruction({ source: 'synthetic-restore-test' });
    await runtime.checkpoints.save('previous-session', {
      ids: { session: 'previous-session', participant: 'previous-participant', invitationCode: 'old-invitation' },
      cognitiveResults: [{ blockId: 'old-passive', rt: null }], shellStep: 0
    }, runtime.machine.snapshot());
  });
  await page.goto(`${participant}?code=new-invitation`);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.invitationProtocolMeta?.protocolId === 9);
  const result = await page.evaluate(async () => {
    const state = (window as any).__WECOG_STATE__;
    return { ids: state.sessionData.ids, results: state.sessionData.cognitiveResults,
      preserved: Boolean(await state.runtime.sessionRuntime.checkpoints.load('previous-session')) };
  });
  expect(result.ids.invitationCode).toBe('new-invitation');
  expect(result.ids.session).not.toBe('previous-session');
  expect(result.results).toEqual([]);
  expect(result.preserved).toBe(true);
});
