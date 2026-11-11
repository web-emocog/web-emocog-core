import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const requireApi = createRequire(path.resolve(__dirname, '../../api/package.json'));
const databaseUrl = process.env.RESILIENCE_TEST_DATABASE_URL;

test.describe('Durable participant backup through real API', () => {
  test.skip(!databaseUrl, 'Requires a dedicated local resilience test database');
  let pool: any, server: any, api: string, organizationId: number, projectId: number;
  test.beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/protocol_fixes_test') throw new Error('Use only the isolated resilience test DB');
    process.env.DATABASE_URL = databaseUrl;
    process.env.NODE_ENV = 'test';
    ({ pool } = requireApi('./db'));
    server = requireApi('./app').listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    api = `http://127.0.0.1:${server.address().port}`;
    organizationId = (await pool.query('INSERT INTO organizations(name,slug) VALUES($1,$2) RETURNING id', ['Resilience fixture', randomUUID()])).rows[0].id;
    projectId = (await pool.query('INSERT INTO projects(organization_id,name,slug) VALUES($1,$2,$3) RETURNING id', [organizationId, 'Resilience fixture', randomUUID()])).rows[0].id;
  });
  test.afterAll(async () => {
    if (organizationId) await pool.query('DELETE FROM organizations WHERE id=$1', [organizationId]);
    if (server) await new Promise<void>(resolve => server.close(resolve));
    if (pool) await pool.end();
  });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
        throw new Error('Physical capture must not be used by this fixture');
      };
    });
  });

  for (const repeated of [false, true]) {
    test(`RT and survey completion${repeated ? ' after a quality repeat' : ''} persist actual runtime events, answers and presentation plan`, async ({ page }) => {
      const definition = { version: 'v2.0_universal', blocks: [
        { id: 'elapsed', type: 'timer', content: { name: 'Synthetic session duration', startsAt: 'session_start', hidden: true } },
        { id: 'rt', type: 'cognitive_task', taskType: 'simple_rt',
          blockConfig: { useFixation: false, stimulusDuration: 10000, rtWindow: 10000, showFeedback: false },
          trials: [{ id: 'target', stimulusId: 'std_simple_black_square', action: 'Space', duration: 10000 }] },
        { id: 'survey', type: 'survey', content: { title: 'Synthetic survey', titleEn: 'Synthetic survey', questions: [
          { id: 'choice', type: 'single', text: 'Choose a response', textEn: 'Choose a response', required: true,
            options: [{ id: 'yes', label: 'Yes', labelEn: 'Yes' }, { id: 'no', label: 'No', labelEn: 'No' }] }
        ] } },
        { id: 'finish', type: 'finish' }
      ] };
      const protocol = (await pool.query('INSERT INTO protocols(project_id,name,definition) VALUES($1,$2,$3::jsonb) RETURNING id',
        [projectId, `Runtime completion${repeated ? ' after repeat' : ''}`, JSON.stringify(definition)])).rows[0];
      const code = 'normal-' + randomUUID();
      await pool.query('INSERT INTO invitations(protocol_id,code,protocol_definition,max_runs) VALUES($1,$2,$3::jsonb,1)',
        [protocol.id, code, JSON.stringify(definition)]);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(api => { (window as any).WECOG_API_BASE = api; }, api);
      await page.goto(`http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html?code=${code}`);
      await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
      await page.locator('#btnStartIntro').click();
      await page.locator('#consentCheck').check();
      await page.locator('#consentBtn').click();
      await expect(page.locator('#step3')).toHaveClass(/active/);
      await page.locator('#participantLanguageSelect').selectOption('en');
      const sessionId = await page.evaluate(async () => {
        const s = (window as any).__WECOG_STATE__;
        s.runtime.sessionRuntime.policyShown = true;
        const url = performance.getEntriesByType('resource').map(entry => entry.name)
          .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
        await (await import(url)).loadAndStartCognitiveTask({ protocol: s.runtime.invitationProtocolDefinition });
        return s.sessionData.ids.session;
      });
      await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
      await page.locator('#cogStartBtn').click();
      await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.runtime.currentPhase)).toBe('cognitive_stimulus');
      if (repeated) {
        await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.sessionRuntime.reportIssue({
          kind: 'quality', code: 'synthetic_quality_gap', message: 'Synthetic test gap', invalidatesBlock: true
        }));
      }
      await page.keyboard.press('Space');
      if (repeated) {
        await expect(page.getByRole('dialog')).toContainText('repeat');
        await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.sessionRuntime.resolveIssue('synthetic_quality_gap'));
        await page.getByRole('dialog').getByRole('button').click();
        await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.runtime.currentPhase)).toBe('cognitive_stimulus');
        await page.keyboard.press('Space');
      }
      await page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.locator('.survey-runtime-question')).toHaveCount(1);
      await page.getByLabel('Yes', { exact: true }).check();
      const response = page.waitForResponse(response => response.url() === `${api}/ingest`
        && response.request().method() === 'POST' && response.request().postDataJSON().delivery?.kind === 'final');
      await page.locator('#cogStartBtn').click();
      const saved = await response;
      expect(saved.status(), await saved.text()).toBe(200);
      await expect(page.locator('#step7')).toHaveClass(/active/);
      await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.upload?.ok)).toBe(true);
      const rows = (await pool.query(`SELECT s.stopped_at, sf.payload, i.used_runs
        FROM sessions s JOIN session_features sf ON sf.session_id=s.id
        JOIN invitations i ON i.id=s.invitation_id WHERE s.session_id=$1`, [sessionId])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].stopped_at).not.toBeNull();
      expect(rows[0].used_runs).toBe(1);
      const payload = rows[0].payload;
      expect(payload.experimentMeta.protocolTimers).toEqual([expect.objectContaining({
        id: 'elapsed', name: 'Synthetic session duration', startsAt: 'session_start', hidden: true,
        startedAt: expect.any(Number), finishedAt: expect.any(Number), durationMs: expect.any(Number),
      })]);
      expect(payload.events).toContainEqual(expect.objectContaining({ type: 'protocol_timers_complete',
        timers: [expect.objectContaining({ id: 'elapsed', name: 'Synthetic session duration', durationMs: expect.any(Number) })] }));
      expect(payload.cognitiveResults).toHaveLength(repeated ? 2 : 1);
      expect(payload.cognitiveResults.at(-1)).toMatchObject({ blockId: 'rt', correct: true, response: 'Space', qualityValid: true });
      if (repeated) {
        expect(payload.cognitiveResults[0]).toMatchObject({ attempt: 1, qualityValid: false,
          qualityIssueCodes: ['synthetic_quality_gap'] });
        expect(payload.cognitiveResults[1].attempt).toBe(2);
      }
      expect(payload.experimentMeta.presentationPlan.actual).toHaveLength(repeated ? 2 : 1);
      expect(payload.experimentMeta.presentationPlan.actual[0].status).toBe('completed');
      expect(payload.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'survey_response', blockId: 'survey',
          responses: [{ questionId: 'choice', responseType: 'single', value: 'yes' }] }),
        expect.objectContaining({ type: 'stimulus_on', blockId: 'rt' })
      ]));
      expect(errors).toEqual([]);
    });
  }

  test('a failed presentation checkpoint aborts the unshown trial but still delivers earlier accepted results', async ({ page }) => {
    const definition = { version: 'v2.0_universal', blocks: [{ id: 'rt', type: 'cognitive_task', taskType: 'simple_rt',
      blockConfig: { useFixation: false, stimulusDuration: 10000, rtWindow: 10000, showFeedback: false },
      trials: [1, 2].map(i => ({ id: `target-${i}`, stimulusId: 'std_simple_black_square', action: 'Space', duration: 10000 })) },
    { id: 'finish', type: 'finish' }] };
    const protocol = (await pool.query('INSERT INTO protocols(project_id,name,definition) VALUES($1,$2,$3::jsonb) RETURNING id',
      [projectId, 'Failed checkpoint fixture', JSON.stringify(definition)])).rows[0];
    const code = 'checkpoint-' + randomUUID();
    await pool.query('INSERT INTO invitations(protocol_id,code,protocol_definition,max_runs) VALUES($1,$2,$3::jsonb,1)',
      [protocol.id, code, JSON.stringify(definition)]);
    await page.addInitScript(api => { (window as any).WECOG_API_BASE = api; }, api);
    await page.goto(`http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html?code=${code}`);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.locator('#btnStartIntro').click();
    await page.locator('#consentCheck').check();
    await page.locator('#consentBtn').click();
    await expect(page.locator('#step3')).toHaveClass(/active/);
    const sessionId = await page.evaluate(async () => {
      const s = (window as any).__WECOG_STATE__, runtime = s.runtime.sessionRuntime;
      runtime.policyShown = true;
      const save = runtime.saveCheckpoint.bind(runtime);
      runtime.saveCheckpoint = async () => s.sessionData.cognitiveResults?.length > 0
        && s.sessionData.experimentMeta?.presentationPlan?.actual?.length > 1 ? false : save();
      const url = performance.getEntriesByType('resource').map(entry => entry.name)
        .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
      await (await import(url)).loadAndStartCognitiveTask({ protocol: s.runtime.invitationProtocolDefinition });
      return s.sessionData.ids.session;
    });
    await expect(page.locator('[data-block-media-status]')).toHaveAttribute('data-block-media-status', 'ready');
    await page.locator('#cogStartBtn').click();
    await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.runtime.currentPhase)).toBe('cognitive_stimulus');
    const delivered = page.waitForResponse(response => response.url() === `${api}/ingest`
      && response.request().method() === 'POST' && response.request().postDataJSON().delivery?.kind === 'final');
    await page.keyboard.press('Space');
    const response = await delivered;
    expect(response.status(), await response.text()).toBe(200);
    await expect(page.locator('#step7')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.upload?.ok)).toBe(true);
    const payload = (await pool.query('SELECT f.payload FROM session_features f JOIN sessions s ON s.id=f.session_id WHERE s.session_id=$1', [sessionId])).rows[0].payload;
    expect(payload.cognitiveResults).toHaveLength(1);
    expect(payload.cognitiveResults[0]).toMatchObject({ qualityValid: true, correct: true });
    expect(payload.experimentMeta.protocolTermination.reason).toBe('technical_error');
    expect(payload.experimentMeta.presentationPlan.actual.map((item: any) => item.status)).toEqual(['completed', 'interrupted']);
    expect(payload.quality_assessment.recordingIntegrity.status).toBe('partial');
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.sessionRuntime.machine.currentBlock)).toBeNull();
  });

  test('interim RT survives an unavailable final API and reload retries the real canonical packet', async ({ page }) => {
    const definition = { version: 'v2.0_universal', blocks: [{ id: 'finish', type: 'finish', content: { title: 'Done' } }] };
    const protocol = (await pool.query('INSERT INTO protocols(project_id,name,definition) VALUES($1,$2,$3::jsonb) RETURNING id',
      [projectId, 'Live backup', JSON.stringify(definition)])).rows[0];
    const code = 'live-' + randomUUID();
    await pool.query('INSERT INTO invitations(protocol_id,code,protocol_definition) VALUES($1,$2,$3::jsonb)', [protocol.id, code, JSON.stringify(definition)]);
    await page.addInitScript(api => { (window as any).WECOG_API_BASE = api; }, api);
    await page.goto(`http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html?code=${code}`);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.locator('#btnStartIntro').click();
    await page.locator('#consentCheck').check();
    await page.locator('#consentBtn').click();
    await expect(page.locator('#step3')).toHaveClass(/active/);
    const sessionId = await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.sessionData.cognitiveResults = [{ rt: 410, correct: true, blockId: 'recorded', trialId: 'one' }];
      const result = await shared.runtime.sessionRuntime.delivery.checkpoint();
      if (!result.ok) throw new Error(`Backup rejected: ${result.status}/${result.error}`);
      return shared.sessionData.ids.session;
    });
    const read = async () => (await pool.query('SELECT s.stopped_at,sf.payload FROM sessions s JOIN session_features sf ON sf.session_id=s.id WHERE s.session_id=$1', [sessionId])).rows[0];
    expect((await read()).stopped_at).toBeNull();
    expect((await read()).payload.cognitiveResults[0].rt).toBe(410);
    await page.route(`${api}/ingest`, route => route.fulfill({ status: 403, headers: { 'Access-Control-Allow-Origin': '*' }, json: { error: 'test denial' } }));
    await page.evaluate(async () => {
      const { finishSession } = await import(new URL('js/web-page/tests-updated.js?v=20261110-integration1', location.href).href);
      await finishSession();
    });
    await expect(page.locator('#retryUploadBtn')).toBeVisible();
    expect((await read()).stopped_at).toBeNull();
    await page.unroute(`${api}/ingest`);
    await page.reload();
    await expect(page.locator('#step7')).toHaveClass(/active/);
    await expect.poll(async () => Boolean((await read()).stopped_at)).toBe(true);
    const final = (await read()).payload;
    expect(final.delivery).toMatchObject({ sequence: 2, kind: 'final' });
    expect(final.cognitiveResults[0].rt).toBe(410);
    expect((await pool.query('SELECT count(*)::int AS n FROM sessions WHERE session_id=$1', [sessionId])).rows[0].n).toBe(1);
  });

  test('a lost response after the database commit retries the same final result without a duplicate run', async ({ page }) => {
    const definition = { version: 'v2.0_universal', blocks: [{ id: 'finish', type: 'finish' }] };
    const protocol = (await pool.query('INSERT INTO protocols(project_id,name,definition) VALUES($1,$2,$3::jsonb) RETURNING id',
      [projectId, 'Lost final acknowledgement', JSON.stringify(definition)])).rows[0];
    const code = 'lost-ack-' + randomUUID();
    await pool.query('INSERT INTO invitations(protocol_id,code,protocol_definition,max_runs) VALUES($1,$2,$3::jsonb,1)',
      [protocol.id, code, JSON.stringify(definition)]);
    await page.addInitScript(api => { (window as any).WECOG_API_BASE = api; }, api);
    await page.goto(`http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html?code=${code}`);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.locator('#btnStartIntro').click(); await page.locator('#consentCheck').check(); await page.locator('#consentBtn').click();
    await expect(page.locator('#step3')).toHaveClass(/active/);
    const packets: string[] = [], keys: string[] = [];
    let committed = false;
    await page.route(`${api}/ingest`, async route => {
      packets.push(route.request().postData()!); keys.push(route.request().headers()['idempotency-key']);
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBe(true);
      if (!committed) { committed = true; return route.abort('connectionreset'); }
      return route.fulfill({ response });
    });
    const sessionId = await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.sessionData.cognitiveResults = [{ blockId: 'retained', rt: 388, correct: true }];
      const { finishSession } = await import(new URL('js/web-page/tests-updated.js?v=20261110-integration1', location.href).href);
      await finishSession();
      return shared.sessionData.ids.session;
    });
    expect(committed).toBe(true); expect(packets).toHaveLength(2); expect(packets[0]).toBe(packets[1]); expect(keys[0]).toBe(keys[1]);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.upload.ok)).toBe(true);
    const stored = (await pool.query(`SELECT s.stopped_at,sf.payload,i.used_runs FROM sessions s JOIN session_features sf ON sf.session_id=s.id
      JOIN invitations i ON i.id=s.invitation_id WHERE s.session_id=$1`, [sessionId])).rows;
    expect(stored).toHaveLength(1); expect(stored[0].used_runs).toBe(1); expect(stored[0].stopped_at).not.toBeNull();
    expect(stored[0].payload.cognitiveResults[0].rt).toBe(388);
  });

  test('a real browser network outage retains the final packet and sends it once after reconnect', async ({ page, context }) => {
    const definition = { version: 'v2.0_universal', blocks: [{ id: 'finish', type: 'finish' }] };
    const protocol = (await pool.query('INSERT INTO protocols(project_id,name,definition) VALUES($1,$2,$3::jsonb) RETURNING id',
      [projectId, 'Real offline browser', JSON.stringify(definition)])).rows[0];
    const code = 'offline-' + randomUUID();
    await pool.query('INSERT INTO invitations(protocol_id,code,protocol_definition,max_runs) VALUES($1,$2,$3::jsonb,1)',
      [protocol.id, code, JSON.stringify(definition)]);
    await page.addInitScript(api => { (window as any).WECOG_API_BASE = api; }, api);
    await page.goto(`http://127.0.0.1:4173/apps/participant-web/mvp_with_precheck_1-updated.html?code=${code}`);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.locator('#btnStartIntro').click(); await page.locator('#consentCheck').check(); await page.locator('#consentBtn').click();
    await expect(page.locator('#step3')).toHaveClass(/active/);
    const sessionId = await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.session);
    const sent: string[] = [];
    page.on('request', request => {
      if (request.url() === `${api}/ingest` && request.method() === 'POST') sent.push(request.postData()!);
    });
    await context.setOffline(true);
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.sessionData.cognitiveResults = [{ rt: 432, correct: true, blockId: 'retained' }];
      const { finishSession } = await import(new URL('js/web-page/tests-updated.js?v=20261110-integration1', location.href).href);
      (window as any).__offlineFinish = finishSession();
    });
    await expect(page.locator('#retryUploadBtn')).toBeVisible({ timeout: 20000 });
    const packet = await page.evaluate(() => JSON.stringify((window as any).__WECOG_STATE__.sessionData.pendingFinalUpload));
    expect((await pool.query('SELECT stopped_at FROM sessions WHERE session_id=$1', [sessionId])).rows[0].stopped_at).toBeNull();
    await context.setOffline(false);
    const resumed = page.waitForResponse(response => response.url() === `${api}/ingest` && response.request().method() === 'POST');
    await page.locator('#retryUploadBtn').click();
    const response = await resumed;
    expect(response.status(), await response.text()).toBe(200);
    await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.upload?.ok)).toBe(true);
    const rows = (await pool.query(`SELECT sf.payload,i.used_runs,i.code AS pinned_code FROM sessions s JOIN session_features sf ON sf.session_id=s.id
      JOIN invitations i ON i.id=s.invitation_id WHERE s.session_id=$1`, [sessionId])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].used_runs).toBe(1); expect(rows[0].payload.cognitiveResults[0].rt).toBe(432);
    const frozen = JSON.parse(packet).payload;
    const { invitationCode, ...storedIds } = frozen.ids;
    expect(rows[0].payload.ids).toEqual(storedIds);
    // The bearer code is not retained in JSON; the relational reference is authoritative.
    expect(rows[0].pinned_code).toBe(invitationCode);
    expect(rows[0].payload.delivery).toEqual(frozen.delivery);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    for (const body of sent) expect(JSON.parse(body)).toEqual(frozen);
  });

  test('a stable link admits publication two and its silent interim backup stays on publication two', async ({ page }) => {
    const firstDefinition = { version: 'v2.0_universal', blocks: [{ id: 'finish', type: 'finish' }], settings: {
      persistence: { showBackupNotifications: true }, qualityControl: { schemaVersion: 'protocol_quality.v1', rules: {
        gazeValid: { enabled: true, threshold: 57, hardStop: false }
      } }
    } };
    const secondDefinition = { ...firstDefinition, settings: { ...firstDefinition.settings,
      persistence: { showBackupNotifications: false }, qualityControl: { schemaVersion: 'protocol_quality.v1', rules: {
        gazeValid: { enabled: true, threshold: 85, hardStop: false }
      } }
    } };
    const protocol = (await pool.query('INSERT INTO protocols(project_id,name,definition) VALUES($1,$2,$3::jsonb) RETURNING id',
      [projectId, 'Two publications', JSON.stringify(secondDefinition)])).rows[0];
    const stableCode = 'stable-' + randomUUID(), secondCode = 'snapshot-' + randomUUID();
    for (const [version, code, definition] of [[1, stableCode, firstDefinition], [2, secondCode, secondDefinition]]) {
      await pool.query('INSERT INTO invitations(protocol_id,code,protocol_definition,publication_version) VALUES($1,$2,$3::jsonb,$4)',
        [protocol.id, code, JSON.stringify(definition), version]);
    }
    await pool.query(`INSERT INTO protocol_publications(protocol_id,code,invitation_id,version)
      SELECT protocol_id,$1,id,2 FROM invitations WHERE code=$2`, [stableCode, secondCode]);
    await page.addInitScript(api => { (window as any).WECOG_API_BASE = api; }, api);
    await page.goto(`http://127.0.0.1:4173/apps/participant-web/run_new.html?code=${stableCode}`);
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.locator('#btnStartIntro').click();
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.invitationCode)).toBe(secondCode);
    await page.locator('#consentCheck').check();
    await page.locator('#consentBtn').click();
    await expect(page.locator('#step3')).toHaveClass(/active/);
    const sessionId = await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.sessionData.cognitiveResults = [{ rt: 350, correct: true, blockId: 'main', trialId: 'one' }];
      shared.runtime.qcMetrics = { getCurrentMetrics: () => ({ durationMs: 20000, totalFrames: 100, gazeTotal: 100, gazeValidPct: 90 }) };
      const result = await shared.runtime.sessionRuntime.delivery.checkpoint();
      if (!result.ok) throw new Error(`Backup failed: ${result.status}`);
      return shared.sessionData.ids.session;
    });
    await expect(page.locator('#sessionPersistenceStatus')).toHaveCount(0);
    const read = async () => (await pool.query(`SELECT i.publication_version,sf.payload,s.stopped_at FROM sessions s
      JOIN invitations i ON i.id=s.invitation_id LEFT JOIN session_features sf ON sf.session_id=s.id WHERE s.session_id=$1`, [sessionId])).rows[0];
    expect((await read()).publication_version).toBe(2);
    expect((await read()).payload.experimentMeta.publicationVersion).toBe(2);
    expect((await read()).payload.qcSummary.protocolQc.checks.gazeValid.threshold).toBe(85);
    expect((await read()).stopped_at).toBeNull();
    await page.reload();
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.ids.session)).toBe(sessionId);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.invitationProtocolMeta.publicationVersion)).toBe(2);
  });
});
