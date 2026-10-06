import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const fixturePath = process.env.LIVE_STIMULUS_FIXTURE;
const fixture = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
const api = 'http://127.0.0.1:3000';
const web = 'http://127.0.0.1:4173';

test.describe('Live stimulus workflow on an isolated API and database', () => {
  test.skip(!fixture, 'Set LIVE_STIMULUS_FIXTURE after seeding an isolated test database');
  test.setTimeout(60_000);

  const cases = ([['image', 800, 200], ['image', 200, 800], ['image', 400, 400], ['video', 640, 360]] as const)
    .flatMap(([kind, width, height]) => [{ width: 1280, height: 720 }, { width: 390, height: 844 }]
      .map(viewport => ({ kind, width, height, viewport, fullscreen: false })));
  cases.push({ kind: 'image', width: 200, height: 800, viewport: { width: 1280, height: 720 }, fullscreen: true });
  for (const { kind, width, height, viewport, fullscreen } of cases) {
    test(`${kind} ${width}x${height} at ${viewport.width}px${fullscreen ? ' fullscreen' : ''}: private access, participant display and pinned heatmap`, async ({ page, request }, testInfo) => {
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const staffHeaders = async (name: string) => {
        const user = fixture.users[name];
        const login = await request.post(`${api}/auth/login`, { data: { email: user.email, password: user.password } });
        expect(login.status(), await login.text()).toBe(200);
        return { Authorization: `Bearer ${(await login.json()).token}` };
      };
      const owner = await staffHeaders('owner');
      const peer = await staffHeaders('peer');
      const outsider = await staffHeaders('outsider');
      await page.goto(`${web}/apps/participant-web/mvp_with_precheck_1-updated.html`);
      const bytes = kind === 'video' ? readFileSync(path.resolve(__dirname, '../../api/tests/fixtures/stimulus-video.mp4'))
        : Buffer.from(await page.evaluate(({ width, height }) => {
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#147d64'; context.fillRect(0, 0, width / 2, height);
          context.fillStyle = '#e49c31'; context.fillRect(width / 2, 0, width / 2, height);
          return canvas.toDataURL('image/png').split(',')[1];
        }, { width, height }), 'base64');
      const upload = await request.post(`${api}/stimuli/upload`, { headers: owner, multipart: {
        project_id: String(fixture.projectId), name: `Geometry ${width}x${height}`,
        file: { name: kind === 'video' ? 'geometry.mp4' : 'geometry.png', mimeType: kind === 'video' ? 'video/mp4' : 'image/png', buffer: bytes },
      } });
      expect(upload.status(), await upload.text()).toBe(201);
      const stimulus = await upload.json();
      expect(stimulus.visibility).toBe('private');
      for (const headers of [peer, outsider]) {
        expect((await request.get(`${api}${stimulus.content_url}`, { headers })).status()).toBe(403);
        expect((await request.patch(`${api}/stimuli/${stimulus.id}`, { headers, data: { name: 'Unauthorized rename' } })).status()).toBe(403);
      }
      const list = await request.get(`${api}/stimuli?project_id=${fixture.projectId}`, { headers: peer });
      expect(list.status()).toBe(200);
      expect((await list.json()).some((row: any) => row.id === stimulus.id)).toBe(false);
      const definition = { version: '1.0.0', blocks: [{ id: 'main', type: 'cognitive_task', taskType: 'simple_rt',
        blockConfig: { useFixation: false, stimulusDuration: 5000, responseMode: 'keypress', fullscreenStimulus: fullscreen, aoiEnabled: true,
          aoiSchemaVersion: '1.2', aoiDefinitions: { [String(stimulus.id)]: [{ id: 'target', name: 'Target', shape: 'rectangle',
            points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }], order: 1, isTarget: true }] } },
        trials: [{ id: 'trial-1', stimulusId: String(stimulus.id), action: 'я', duration: 5000 }],
      }] };
      const saved = await request.post(`${api}/protocols`, { headers: owner, data: { project_id: fixture.projectId,
        name: `Live geometry ${kind} ${width}x${height} ${randomUUID()}`, definition } });
      expect(saved.status(), await saved.text()).toBe(201);
      const protocol = await saved.json();
      expect((await request.post(`${api}/invitations`, { headers: peer, data: { protocol_id: protocol.id } })).status()).toBe(422);
      const publication = await request.post(`${api}/invitations`, { headers: owner, data: { protocol_id: protocol.id, max_runs: 3 } });
      expect(publication.status(), await publication.text()).toBe(201);
      const invitation = await publication.json();
      // Historical project analytics can read a published version, never a private replacement.
      expect((await request.get(`${api}${stimulus.content_url}`, { headers: peer })).status()).toBe(200);
      expect((await request.get(`${api}${stimulus.content_url}`, { headers: outsider })).status()).toBe(403);

      await page.goto(`${web}/apps/participant-web/mvp_with_precheck_1-updated.html?code=${invitation.code}`);
      await page.waitForFunction(id => Boolean((window as any).__WECOG_STATE__?.runtime?.invitationStimuliMap?.[id]?.metadata?.url), String(stimulus.id));
      await page.evaluate(async () => {
        const shared = (window as any).__WECOG_STATE__;
        shared.runtime.sessionRuntime.policyShown = true;
        const { loadAndStartCognitiveTask } = await import(new URL('js/web-page/experimental_task-updated.js?v=20261006-3', location.href).href);
        await loadAndStartCognitiveTask({ protocol: shared.runtime.invitationProtocolDefinition, autoFinishSession: false });
      });
      await page.locator('#cogStartBtn').click();
      const media = page.locator(kind === 'video' ? '#cogVideo' : '#cogImage');
      await expect(media).toBeVisible();
      await expect.poll(() => media.evaluate((element: HTMLImageElement | HTMLVideoElement) => ({
        width: element instanceof HTMLImageElement ? element.naturalWidth : element.videoWidth,
        height: element instanceof HTMLImageElement ? element.naturalHeight : element.videoHeight,
      }))).toEqual({ width, height });
      if (kind === 'video') await expect.poll(() => media.evaluate((element: HTMLVideoElement) =>
        element.readyState >= 2 && !element.paused && element.currentTime > 0)).toBe(true);
      await expect(page.locator('#step6')).toHaveCSS('animation-name', 'none');
      await expect(page.locator('#step6')).toHaveCSS('transform', 'none');
      const { rect, gazeRect, actualViewport } = await page.evaluate(async kind => {
        const { currentStimulusContentRect } = await import(new URL('js/web-page/app-updated.js?v=20261006-3', location.href).href);
        const element = document.getElementById(kind === 'video' ? 'cogVideo' : 'cogImage')!;
        const box = element.getBoundingClientRect();
        return { rect: { x: box.x, y: box.y, width: box.width, height: box.height },
          gazeRect: currentStimulusContentRect(), actualViewport: { width: innerWidth, height: innerHeight } };
      }, kind);
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(actualViewport.width + 1);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(actualViewport.height + 1);
      if (!fullscreen) expect(rect!.width).toBeLessThan(actualViewport.width);
      const scale = Math.min(rect!.width / width, rect!.height / height);
      expect(gazeRect?.width).toBeCloseTo(width * scale, 1);
      expect(gazeRect?.height).toBeCloseTo(height * scale, 1);
      expect(gazeRect?.left).toBeCloseTo(rect!.x + (rect!.width - width * scale) / 2, 1);
      expect(gazeRect?.top).toBeCloseTo(rect!.y + (rect!.height - height * scale) / 2, 1);
      if (fullscreen) await expect(page.locator('body')).toHaveClass(/cognitive-stimulus-fullscreen/);
      else await expect(page.locator('body')).not.toHaveClass(/cognitive-stimulus-fullscreen/);
      await page.screenshot({ path: testInfo.outputPath('participant.png') });
      await page.waitForTimeout(180);
      await page.keyboard.press('KeyZ');
      await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
      expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults[0])).toMatchObject({
        response: 'KeyZ', expectedResponse: 'KeyZ', correct: true,
      });
      await page.evaluate(async () => { if (document.fullscreenElement) await document.exitFullscreen(); });

      const sessionId = `LIVE-${testInfo.project.name}-${Date.now()}-${width}-${height}`;
      const admission = await request.post(`${api}/invitations/by-code/${invitation.code}/ingest-token`, { data: { session_id: sessionId } });
      expect(admission.status(), await admission.text()).toBe(200);
      const admitted = await admission.json();
      const ingest = await request.post(`${api}/ingest`, { headers: { Authorization: `Bearer ${admitted.token}`, 'Idempotency-Key': `finish-${sessionId}` }, data: {
        schemaVersion: 'session_feature.v1', ids: { session: sessionId, participant: 'SYNTHETIC', invitationCode: invitation.code },
        meta: { user: { interfaceLanguage: 'ru' }, tech: {} }, events: [],
        lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed', finishAttemptId: `finish-${sessionId}`, completedAt: Date.now() },
        gaze_analytics: { schemaVersion: 'gaze_analytics.v1', coordinateSpace: 'stimulus_normalized_0_1', presentations: [{
          blockId: 'main', trialId: 'trial-1', presentationId: 'geometry-presentation', stimulusId: String(stimulus.id),
          stimulusVersion: stimulus.current_version_id, stimulusType: kind,
          grid: { width: 2, height: 2, values: [1, 0, 0, 0] }, fixationPoints: [{ x: 0.25, y: 0.25, durationMs: 200, signalConfidence: 1 }],
          validObservationDurationMs: 1000,
        }] },
      } });
      expect(ingest.status(), await ingest.text()).toBe(200);
      const snapshotResult = await request.post(`${api}/analytics/v1/snapshots`, { headers: owner, data: {
        schemaVersion: '1.0', mode: 'session', analysisLevel: 'level_1', projectId: fixture.projectId, protocolId: protocol.id,
        protocolVersion: '1.0.0', metricIds: ['viz.heatmap'], filters: { sessionIds: [sessionId], qcMode: 'all', qcChannels: ['task', 'gaze'] },
      } });
      expect(snapshotResult.status(), await snapshotResult.text()).toBe(201);
      const snapshot = await snapshotResult.json();
      const login = await page.request.post(`${api}/auth/login`, { headers: { 'X-Auth-Transport': 'cookie' },
        data: { email: fixture.users.owner.email, password: fixture.users.owner.password } });
      expect(login.status()).toBe(200);
      const auth = await login.json();
      await page.addInitScript(({ auth, projectId }) => {
        localStorage.setItem('emocog_developer_auth', '1');
        localStorage.setItem('emocog_api_user', JSON.stringify(auth.user));
        localStorage.setItem('emocog_selected_project_id', String(projectId));
        if (auth.csrf_token) sessionStorage.setItem('emocog_csrf_token', auth.csrf_token);
      }, { auth, projectId: fixture.projectId });
      await page.goto(`${web}/apps/web/researcher.html#/analytics/session-card`);
      await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
      await page.waitForFunction(() => (window as any).EmocogAnalyticsProduction.store.state.status === 'ready');
      const descriptor = await page.evaluate(async ({ sessionId, snapshot }) => {
        const production = (window as any).EmocogAnalyticsProduction;
        const visual = await production.api.sessionVisuals(sessionId, snapshot);
        const summary = await production.api.sessionSummary(sessionId, snapshot);
        production.store.state.snapshot = snapshot;
        production.store.state.dirty = false;
        production.store.state.snapshotStatus = 'ready';
        production.store.state.summaryResponse = summary;
        production.store.state.visualResponse = visual;
        production.store.state.visualStatus = 'ready';
        production.store.state.summaryStatus = 'ready';
        production.store.state.status = 'ready';
        production.store.emit();
        return visual.data.contexts[0].stimulus;
      }, { sessionId, snapshot });
      expect(descriptor).toMatchObject({ intrinsicWidth: width, intrinsicHeight: height, version: stimulus.current_version_id });
      const background = page.locator('.analytics-stimulus-media').first();
      await expect(background).toBeVisible();
      await expect.poll(() => background.evaluate((element: HTMLImageElement | HTMLVideoElement) => ({
        width: element instanceof HTMLImageElement ? element.naturalWidth : element.videoWidth,
        height: element instanceof HTMLImageElement ? element.naturalHeight : element.videoHeight,
      }))).toEqual({ width, height });
      const canvas = page.locator('.analytics-heatmap-canvas').first();
      await expect(canvas).toBeVisible();
      const bounds = await canvas.boundingBox();
      expect(bounds!.width / bounds!.height).toBeCloseTo(width / height, 1);
      const backgroundBounds = await background.boundingBox();
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(bounds![key] - backgroundBounds![key])).toBeLessThanOrEqual(2);
      await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d')!.getImageData(0, 0, 1, 1).data[3])).toBeGreaterThan(0);
      await canvas.scrollIntoViewIfNeeded();
      if (kind === 'video') await expect.poll(() => background.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
      await page.screenshot({ path: testInfo.outputPath('heatmap.png'), fullPage: true });
      expect(errors).toEqual([]);
    });
  }

  test('real researcher library survives reload and hides private files after account switch and sharing revocation', async ({ page, request }) => {
    const login = async (name: string, cookie = false) => {
      const user = fixture.users[name];
      const response = await (cookie ? page.request : request).post(`${api}/auth/login`, {
        headers: cookie ? { 'X-Auth-Transport': 'cookie' } : {}, data: { email: user.email, password: user.password },
      });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const owner = { Authorization: `Bearer ${(await login('owner')).token}` };
    const upload = await request.post(`${api}/stimuli/upload`, { headers: owner, multipart: {
      project_id: String(fixture.projectId), name: `Private reload ${randomUUID()}`,
      file: { name: 'private.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') },
    } });
    expect(upload.status(), await upload.text()).toBe(201);
    const stimulus = await upload.json();
    const auth = await login('owner', true);
    await page.addInitScript(({ auth, projectId }) => {
      if (localStorage.getItem('live-library-seeded')) return;
      localStorage.setItem('live-library-seeded', '1');
      localStorage.setItem('emocog_api_user', JSON.stringify(auth.user));
      localStorage.setItem('emocog_selected_project_id', String(projectId));
      localStorage.setItem('emocog_developer_auth', '1');
    }, { auth, projectId: fixture.projectId });
    await page.goto(`${web}/apps/web/researcher.html#/stimuli`);
    const card = page.locator(`.stimulus-card[data-id="${stimulus.id}"]`);
    const assertLoaded = async () => {
      await expect(card).toBeVisible();
      await expect.poll(() => card.locator('img').evaluateAll(elements => elements.some(element => (element as HTMLImageElement).naturalWidth > 0))).toBe(true);
    };
    await assertLoaded();
    await page.reload();
    await assertLoaded();
    await login('peer', true);
    await page.reload();
    await page.waitForFunction(id => (window as any).__EMOCOG_AUTH_USER?.id === id || JSON.parse(localStorage.getItem('emocog_api_user') || '{}').id === id, fixture.users.peer.id);
    await expect(card).toHaveCount(0);
    expect((await page.request.get(`${api}${stimulus.content_url}`)).status()).toBe(403);
    expect((await request.patch(`${api}/stimuli/${stimulus.id}`, { headers: owner, data: { visibility: 'project' } })).status()).toBe(200);
    await page.reload();
    await assertLoaded();
    expect((await page.request.get(`${api}${stimulus.content_url}`)).status()).toBe(200);
    expect((await request.patch(`${api}/stimuli/${stimulus.id}`, { headers: owner, data: { visibility: 'private' } })).status()).toBe(200);
    await page.reload();
    await expect(card).toHaveCount(0);
    expect((await page.request.get(`${api}${stimulus.content_url}`)).status()).toBe(403);
    await login('owner', true);
    await page.reload();
    await assertLoaded();
  });

  test('authentication before the core script loads cannot break library initialization', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const login = await page.request.post(`${api}/auth/login`, { headers: { 'X-Auth-Transport': 'cookie' },
      data: { email: fixture.users.owner.email, password: fixture.users.owner.password } });
    expect(login.status()).toBe(200);
    const auth = await login.json();
    const upload = await page.request.post(`${api}/stimuli/upload`, { headers: { 'X-CSRF-Token': auth.csrf_token }, multipart: {
      project_id: String(fixture.projectId), name: `Bootstrap ${randomUUID()}`,
      file: { name: 'bootstrap.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') },
    } });
    expect(upload.status(), await upload.text()).toBe(201);
    const stimulus = await upload.json();
    await page.addInitScript(({ auth, projectId }) => {
      localStorage.setItem('emocog_api_user', JSON.stringify(auth.user));
      localStorage.setItem('emocog_workspace_owner_v1', String(auth.user.id));
      localStorage.setItem('emocog_selected_project_id', String(projectId));
      localStorage.setItem('emocog_developer_auth', '1');
      (window as any).__liveAuthEvents = 0;
      window.addEventListener('wecog:researcherauthenticated', () => { (window as any).__liveAuthEvents++; });
    }, { auth, projectId: fixture.projectId });
    let corePending = false;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/researcher-core.js?v=*', async route => {
      corePending = true;
      await held;
      await route.continue();
    });
    try {
      await page.goto(`${web}/apps/web/researcher.html#/stimuli`, { waitUntil: 'commit' });
      await expect.poll(() => corePending).toBe(true);
      await page.waitForFunction(() => !document.documentElement.classList.contains('emocog-auth-pending'));
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => (window as any).__liveAuthEvents)).toBe(0);
      expect(errors).toEqual([]);
    } finally { release(); }
    await page.waitForLoadState('load');
    await expect.poll(() => page.evaluate(() => (window as any).__liveAuthEvents)).toBe(1);
    const card = page.locator(`.stimulus-card[data-id="${stimulus.id}"]`);
    await expect(card).toBeVisible();
    await expect.poll(() => card.locator('img').evaluateAll(elements => elements.some(element => (element as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(errors).toEqual([]);
  });
});
