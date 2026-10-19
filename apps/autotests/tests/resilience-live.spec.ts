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
      const { finishSession } = await import(new URL('js/web-page/tests-updated.js?v=20261019-4', location.href).href);
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
      const { finishSession } = await import(new URL('js/web-page/tests-updated.js?v=20261019-4', location.href).href);
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
    page.on('request', request => { if (request.url() === `${api}/ingest`) sent.push(request.postData()!); });
    await context.setOffline(true);
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.sessionData.cognitiveResults = [{ rt: 432, correct: true, blockId: 'retained' }];
      const { finishSession } = await import(new URL('js/web-page/tests-updated.js?v=20261019-4', location.href).href);
      (window as any).__offlineFinish = finishSession();
    });
    await expect(page.locator('#retryUploadBtn')).toBeVisible({ timeout: 20000 });
    const packet = await page.evaluate(() => JSON.stringify((window as any).__WECOG_STATE__.sessionData.pendingFinalUpload));
    expect((await pool.query('SELECT stopped_at FROM sessions WHERE session_id=$1', [sessionId])).rows[0].stopped_at).toBeNull();
    await context.setOffline(false);
    await page.locator('#retryUploadBtn').click();
    await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.upload?.ok)).toBe(true);
    const rows = (await pool.query(`SELECT sf.payload,i.used_runs FROM sessions s JOIN session_features sf ON sf.session_id=s.id
      JOIN invitations i ON i.id=s.invitation_id WHERE s.session_id=$1`, [sessionId])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].used_runs).toBe(1); expect(rows[0].payload.cognitiveResults[0].rt).toBe(432);
    const frozen = JSON.parse(packet).payload;
    expect(rows[0].payload.ids).toEqual(frozen.ids);
    expect(rows[0].payload.delivery).toEqual(frozen.delivery);
    expect(sent.length).toBeGreaterThan(1);
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
