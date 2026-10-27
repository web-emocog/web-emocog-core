import { test, expect, Page } from '@playwright/test';

const api = 'http://127.0.0.1:3000';
const marker = '<img src=x onerror="window.__xssExecuted=true"> & "quotes" <svg onload="window.__xssExecuted=true">';
const attribute = '\" autofocus onfocus=\"window.__xssExecuted=true';
let fixtures: Map<string, unknown>, mutations: { path: string; body: any }[];

test.beforeEach(async ({ page, baseURL }) => {
  mutations = [];
  fixtures = new Map([
    ['/auth/me', { id: 1, role: 'admin', email: 'synthetic-audit@example.test', csrf_token: 'synthetic-only' }],
    ['/auth/permissions', { can_open_admin_panel: true, can_grant_developer: true,
      can_manage_organization_members: true, operations: ['project.delete'] }],
    ['/projects', [{ id: 7, name: 'Synthetic project' }]],
  ]);
  await page.addInitScript(() => {
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_api_user', JSON.stringify({ id: 1, role: 'admin', email: 'synthetic-audit@example.test' }));
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_selected_project_id', '7');
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === baseURL) return route.continue();
    if (url.origin !== api) return route.abort();
    const headers = { 'Access-Control-Allow-Origin': baseURL!, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type,X-Staff-User-ID,X-CSRF-Token,X-Auth-Transport',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (!['GET', 'HEAD'].includes(request.method())) mutations.push({ path: url.pathname, body: request.postDataJSON() });
    return route.fulfill({ status: 200, headers, json: fixtures.get(url.pathname) ?? [] });
  });
});

async function noExecution(page: Page) {
  await expect(page.locator('[onerror], [onload], [onfocus], script:not([src])[data-injected]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__xssExecuted)).toBeUndefined();
}

test('account role values and text round-trip without creating attributes; membership actions still send exact IDs', async ({ page }) => {
  const role = 'researcher' + attribute;
  fixtures.set('/auth/users', [{ id: 12, email: marker, role, organization_ids: [5], project_ids: [7] }]);
  await page.goto('/apps/web/developer/accounts.html');
  const row = page.locator('#usersBody tr');
  await expect(row).toContainText(marker);
  await expect(row.locator('.user-role')).toHaveValue(role);
  await expect(row.locator('option:checked')).toHaveText(role);
  await row.locator('option:checked').dispatchEvent('focus');
  await noExecution(page);
  await row.locator('.user-role').selectOption('researcher');
  await row.locator('.save-user').click();
  await expect.poll(() => mutations.length).toBe(1);
  expect(mutations[0]).toEqual({ path: '/auth/users/12/memberships', body: { role: 'researcher', organization_ids: [5], project_ids: [7] } });
});

test('developer experiment summaries, recent sessions and invitations treat every response column as text', async ({ page }) => {
  fixtures.set('/experiments', [{ experiment_title: marker, project_id: marker, protocol_id: marker,
    total_sessions: marker, completed_sessions: marker, in_progress_sessions: marker, avg_qc_score: marker, qc_valid_count: marker }]);
  fixtures.set('/experiments/recent', [{ session_id: marker, experiment_title: marker, participant_id: marker,
    invitation_code: marker, session_status: marker, qc_validity: marker, qc_score: marker, started_at: marker }]);
  await page.goto('/apps/web/developer/experiments.html');
  await expect(page.locator('#overviewBody')).toContainText(marker);
  await expect(page.locator('#recentBody')).toContainText(marker);
  await noExecution(page);
  fixtures.set('/invitations', [{ id: marker, code: marker, protocol_id: marker, runs_used: marker, max_runs: marker, expires_at: marker }]);
  await page.goto('/apps/web/developer/invite.html');
  await expect(page.locator('#invitesBody')).toContainText(marker);
  await noExecution(page);
});

test('admin user names, roles and developer-access attributes are literal and removal encodes the exact ID', async ({ page }) => {
  const specialId = 'id/"<&?';
  fixtures.set('/auth/developer-access-emails', [{ id: specialId, email: marker }]);
  fixtures.set('/auth/users', [{ id: 12, email: marker, display_name: marker, role: marker }]);
  await page.goto('/apps/web/researcher.html#/admin');
  await expect(page.locator('#adminDevEmailsList')).toContainText(marker);
  await expect(page.locator('#adminUsersList')).toContainText(marker);
  await expect(page.locator('.admin-dev-email-remove')).toHaveAttribute('data-id', specialId);
  await noExecution(page);
  await page.locator('.admin-dev-email-remove').click();
  await expect.poll(() => mutations.length).toBe(1);
  expect(decodeURIComponent(mutations[0].path)).toBe('/auth/developer-access-emails/' + specialId);
});

test('cached admin identity cannot reveal admin controls when fresh server permissions deny access', async ({ page }) => {
  fixtures.set('/auth/permissions', { can_open_admin_panel: false, can_grant_developer: false, operations: [] });
  fixtures.set('/auth/users', [{ id: 12, email: 'must-not-be-shown@example.test', role: 'researcher' }]);
  await page.goto('/apps/web/researcher.html#/admin');
  await expect(page.locator('#view')).toContainText(/Доступ запрещён|Access denied/);
  await expect(page.locator('#adminUsersList, #adminDevEmailsList')).toHaveCount(0);
  await expect(page.locator('#view')).not.toContainText('must-not-be-shown@example.test');
  expect(mutations).toEqual([]);
});

test('project names and persisted experiment IDs/titles survive rendering without injecting elements', async ({ page }) => {
  fixtures.set('/projects', [{ id: 7, name: marker }]);
  await page.goto('/apps/web/researcher.html#/overview');
  await expect(page.locator('#projectSelect')).toContainText(marker);
  await expect(page.locator('.ov-proj-card')).toContainText(marker);
  await page.evaluate(({ marker, attribute }) => {
    const w = window as any;
    localStorage.setItem('emocog_my_experiments', JSON.stringify([{ id: attribute, projectId: 7,
      title: marker, status: 'draft', blocks: { length: marker } }]));
    document.getElementById('view')!.replaceChildren(w.ExperimentsListView());
  }, { marker, attribute });
  await expect(page.locator('.exp-card')).toContainText(marker);
  await expect(page.locator('.exp-card')).toHaveAttribute('data-id', attribute);
  await noExecution(page);
});

test('workspace chips render literal text, including entities, and keep the first chip active', async ({ page }) => {
  await page.goto('/apps/web/researcher.html#/overview');
  await page.evaluate(marker => (window as any).setChips([marker, 'A & B <literal>', 0]), marker);
  await expect(page.locator('#chips .chip')).toHaveText([marker, 'A & B <literal>', '0']);
  await expect(page.locator('#chips .chip.active')).toHaveCount(1);
  await noExecution(page);
});

test('legacy API-fed session header and blocks do not execute QC, metadata or block strings', async ({ page }) => {
  await page.goto('/apps/web/researcher.html?analyticsDemo=1#/overview');
  await page.evaluate(marker => {
    const w = window as any, host = document.createElement('section');
    host.id = 'legacyAudit'; host.innerHTML = '<div id="qcMain"></div><div id="reasonList"></div><div id="sessionMeta"></div><table><tbody id="blocksTbody"></tbody></table>';
    document.body.appendChild(host);
    const mapped = w.EmocogResearcherBridge.mapSessionRowToSessionData({ id: 1, session_id: marker, protocol_id: marker,
      qc_validity: marker, qc_score: 0, features: { device: marker, browser: marker, light: marker,
        blocks: [{ name: marker, duration_sec: 1, valid_pct: marker, qc_score: 0, reasons: [{ label: marker, value: marker, severity: 'warn' }] }] },
      qc_fail_reasons: [marker], qc_payload: { checks: { [marker]: marker } } });
    w.EmocogResearcherBridge.applySessionData(w.SESSION_DATA, mapped);
    w.renderSessionCardHeader(); w.renderBlocks();
  }, marker);
  await expect(page.locator('#qcMain')).toContainText(marker.toUpperCase());
  for (const id of ['reasonList', 'sessionMeta', 'blocksTbody']) await expect(page.locator('#' + id)).toContainText(marker);
  await expect(page.locator('#sessionMeta code')).toContainText(marker);
  await noExecution(page);
});

test('bridge merging special keys preserves data and cannot change browser object prototypes', async ({ page }) => {
  await page.goto('/apps/web/researcher.html#/overview');
  const result = await page.evaluate(() => {
    const target: any = { session: { keep: 7 } }, before = target.session;
    const source = JSON.parse('{"__proto__":{"auditPolluted":true},"constructor":{"prototype":{"auditPolluted":true}},"session":{"__proto__":{"auditPolluted":true},"name":"literal"}}');
    (window as any).EmocogResearcherBridge.applySessionData(target, source);
    return { clean: !(Object.prototype as any).auditPolluted, sameObject: before === target.session,
      own: Object.prototype.hasOwnProperty.call(target, '__proto__'), retained: JSON.parse(JSON.stringify(target)).__proto__.auditPolluted,
      keep: target.session.keep, name: target.session.name };
  });
  expect(result).toEqual({ clean: true, sameObject: true, own: true, retained: true, keep: 7, name: 'literal' });
});

test('session JSON report treats summary, heatmap, attention reason and event fields as text', async ({ page }) => {
  await page.goto('/apps/participant-web/tools/session-report.html');
  await page.locator('#fileInput').setInputFiles({ name: 'synthetic-literal.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ids: { session: marker, participant: marker },
      heatmaps: { perStimulus: [{ blockId: marker, stimulusId: marker, sampleCount: marker, bins: [[1]], timeRangeMs: { durationMs: marker } }], perBlock: [] },
      attentionMetrics: { global: { perclos: { criteria: { minDeepDwellMs: marker }, rejectReasons: { [marker]: 3 } },
        blinkDynamics: { blinkCount: marker, blinkDetection: { mode: marker } }, hippusProxy: { qualityReason: marker } } },
      events: [{ tRelMs: 1, type: marker, phase: marker, blockId: marker, trialId: marker, stimulusId: marker, detail: marker }] })) });
  await expect(page.locator('#status')).toContainText('Загружено:');
  for (const id of ['summary', 'heatmapStimulus', 'attentionText', 'timeline']) await expect(page.locator('#' + id)).toContainText(marker);
  await noExecution(page);
});

for (const file of ['ui.js', 'ui-updated.js']) {
  test(`${file}: externally supplied QC strings cannot become HTML in participant final status`, async ({ page }) => {
    await page.goto('/apps/web/index.html?guest=1');
    await page.evaluate(async ({ file, marker }) => {
      const mod = await import('/apps/participant-web/js/web-page/' + file + '?v=20261025-1');
      const statePath = '/apps/participant-web/js/web-page/state.js?v=20261025-1';
      const { state } = await import(statePath);
      state.currentLang = 'ru';
      const host = document.createElement('section'); host.innerHTML = '<div id="qcStatusBlock"></div><div id="finalQcSummary"></div>';
      document.body.append(host);
      mod.updateFinalStepWithQC({ overallPass: false, durationMs: 2000, gazeValidPct: 80, faceOkPct: 90,
        issues: [marker], checks: { duration: false, faceVisible: false, [marker]: true } });
    }, { file, marker });
    await expect(page.locator('#qcStatusBlock')).toContainText(/80/);
    await noExecution(page);
  });
}
