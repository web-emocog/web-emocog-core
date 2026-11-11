import { test, expect, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const marker = '<img src=x onerror="window.__analyticsXss=1"> & "quotes" <svg onload="window.__analyticsXss=1">';
const attribute = '"><img src=x onerror="window.__analyticsXss=1"><i data-injected="';
const apiOrigin = 'http://127.0.0.1:3000';
let fixtures: Map<string, any>;
let requests: { path: string; query: string; method: string; headers: Record<string, string> }[];
let snapshot: any;
let exportFailure: 'hash' | 'redirect' | '';

test.beforeEach(async ({ page, baseURL }) => {
  requests = [];
  snapshot = null;
  exportFailure = '';
  fixtures = new Map<string, any>([
    ['/auth/me', { id: 1, role: 'researcher', email: 'analytics-audit@example.test', csrf_token: 'synthetic-csrf' }],
    ['/auth/permissions', { operations: [], can_open_admin_panel: false }],
    ['/projects', [{ id: 7, name: 'Audit project' }]],
    ['/protocols', [{ id: 9, name: 'Audit protocol', version: '1' }]],
    ['/sessions', [{ id: 11, protocol_id: 9, protocol_version: '1', participant_id: 'P-audit', status: 'completed' }]],
    ['/analytics/v1/filter-options', { blocks: [], stimuli: [], aois: [], qcChannels: ['task'], selectedMetricIds: ['task.rt_mean_ms'] }],
  ]);
  await page.addInitScript(() => {
    localStorage.setItem('emocog_workspace_owner_v1', '1');
    localStorage.setItem('emocog_api_user', JSON.stringify({ id: 1, role: 'researcher', email: 'analytics-audit@example.test' }));
    localStorage.setItem('emocog_developer_auth', '1');
    localStorage.setItem('emocog_selected_project_id', '7');
    localStorage.setItem('emocog_selected_protocol_id', '9');
    sessionStorage.setItem('emocog_csrf_token', 'synthetic-csrf');
    (window as any).__mediaRequests = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__mediaRequests++;
      throw new Error('Media capture forbidden in analytics audit');
    };
  });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === baseURL) return route.continue();
    if (url.origin !== apiOrigin) return route.abort();
    const headers = { 'Access-Control-Allow-Origin': baseURL!, 'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type,X-Staff-User-ID,X-CSRF-Token,X-Auth-Transport',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Expose-Headers': 'X-Analysis-Snapshot-Id,X-Dataset-Hash' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    requests.push({ path: url.pathname, query: url.search, method: request.method(), headers: request.headers() });
    if (url.pathname === '/analytics/v1/snapshots') {
      snapshot = { id: 'audit-snapshot', datasetHash: 'sha256:audit', queryEcho: request.postDataJSON(),
        includedSessionIds: [11], includedParticipantIds: ['P-audit'], excludedSessions: [], versions: {} };
      return route.fulfill({ headers, json: snapshot });
    }
    if (url.pathname === '/analytics/v1/exports') {
      if (exportFailure === 'redirect') return route.continue({ url: baseURL + '/__analytics_security/redirect' });
      return route.fulfill({ headers: { ...headers, 'X-Analysis-Snapshot-Id': snapshot.id,
        'X-Dataset-Hash': exportFailure === 'hash' ? 'sha256:wrong' : snapshot.datasetHash },
        json: { kind: 'analytics_export', snapshot, counts: { participants: 1, sessions: 1, observations: 1 } } });
    }
    const fixture = fixtures.get(url.pathname);
    return route.fulfill({ headers, json: fixture?.kind ? { ...fixture, snapshot } : fixture ?? [] });
  });
});

async function inert(page: Page) {
  await expect(page.locator('#view [onerror], #view [onload], #view [onfocus], #view [data-injected]')).toHaveCount(0);
  const state = await page.evaluate(() => ({ executed: (window as any).__analyticsXss, media: (window as any).__mediaRequests }));
  expect(state).toEqual({ executed: undefined, media: 0 });
}

async function apply(page: Page, tab = 'session-card') {
  await page.goto(`/apps/web/researcher.html#/analytics/${tab}`);
  await expect(page.locator('#analyticsProtocolFilter')).toHaveValue('9');
  await page.locator('#analyticsApplyFilters').click();
}

test('legacy API bridge values remain text; missing metrics and hostile percentiles cannot become SVG', async ({ page }) => {
  await page.goto('/apps/web/researcher.html?analyticsDemo=1#/overview');
  await page.evaluate(({ marker, attribute }) => {
    const w = window as any;
    const mapped = w.EmocogResearcherBridge.mapSessionRowToSessionData({ id: 11, session_id: marker,
      qc_validity: attribute, features: { device: marker, browser: marker, valence_mean: 0,
        blocks: [{ name: marker, valid_pct: marker, reasons: [{ label: marker, value: marker }] }] } });
    w.EmocogResearcherBridge.applySessionData(w.SESSION_DATA, mapped);
    w.SESSION_DATA.group.full.valence_mean = { mean: 0, sd: 1, p: attribute };
    document.getElementById('view')!.replaceChildren(w._buildSessionCard());
  }, { marker, attribute });
  await expect(page.locator('#metricsGrid .dash-metric')).toHaveCount(8);
  await expect(page.locator('.dash-metric[data-key="valence_mean"] .num')).toHaveText('0.0');
  await expect(page.locator('.dash-metric[data-key="emotion_joy"] .num')).toHaveText('—');
  await expect(page.locator('#distSvg > *')).toHaveCount(0);
  await expect(page.locator('#view .hint').first()).toContainText(marker);
  await expect(page.locator('#sessionMeta')).toContainText(marker);
  await expect(page.locator('#blocksTbody')).toContainText(marker);
  await page.locator('#modeSelect').selectOption('zscore');
  await expect(page.locator('#kpiCompare')).toHaveText('0.00');
  await page.locator('#segmentSelect').selectOption('baseline');
  await expect(page.locator('#kpiCompare')).toHaveText('—');
  await inert(page);
});

test('production API metrics, QC classes and algorithm/scope text remain inert', async ({ page }) => {
  fixtures.set('/projects', [{ id: 7, name: marker }]);
  fixtures.set('/protocols', [{ id: 9, name: marker, version: '1' }]);
  fixtures.set('/analytics/v1/sessions/11/summary', { kind: 'session_summary', data: {
    session: { sessionId: 11, participantAlias: marker, protocolId: 9, protocolVersion: marker,
      completionStatus: attribute, browserFamily: marker, actualFps: marker },
    metrics: [{ metricId: 'task.' + marker, status: attribute, reason: marker, nObservations: marker,
      scope: { blockId: marker, trialId: marker }, qc: { status: attribute }, algorithm: { id: marker, version: marker } }],
    qcChannels: [{ channel: marker, status: attribute, reasons: [marker], ruleVersion: marker }], exclusions: [],
  } });
  fixtures.set('/analytics/v1/sessions/11/visuals', { kind: 'session_visuals', data: { contexts: [] } });
  await page.addInitScript(attribute => localStorage.setItem('emocog_analytics_query_draft_v1', JSON.stringify({
    groupId: attribute, conditionId: attribute, dateFrom: attribute, qcChannels: [attribute],
  })), attribute);
  await apply(page);
  const body = page.locator('#analyticsProductionBody');
  await expect(body).toContainText(marker);
  await expect(body).toContainText(attribute);
  await expect(body).toContainText('task.' + marker);
  await expect(page.locator('#analyticsProjectFilter option:checked')).toHaveText(marker);
  await expect(body.locator('[class*="onerror"]')).toHaveCount(0);
  await inert(page);
  expect(requests.some(request => request.path === '/analytics/v1/sessions/11/summary')).toBeTruthy();
  expect(snapshot.queryEcho.filters.qcChannels).toEqual(['task', 'gaze']);
});

test('old protocol metric codes and unsupported saved filters never reach the snapshot validator', async ({ page }) => {
  fixtures.set('/analytics/v1/filter-options', {
    blocks: [], stimuli: [], aois: [], qcChannels: ['task', 'gaze'],
    selectedMetricIds: ['task.legacy_removed_metric', 'task.rt_mean_ms'],
  });
  fixtures.set('/analytics/v1/sessions/11/summary', { kind: 'session_summary', data: { session: { sessionId: 11 }, metrics: [], qcChannels: [] } });
  await page.addInitScript(() => localStorage.setItem('emocog_analytics_query_draft_v1', JSON.stringify({
    qcChannels: ['old_qc'], qcMode: 'old_mode', comparisonMetric: 'old_metric',
  })));
  await apply(page);
  await expect(page.locator('.ab-report-intro')).toBeVisible();
  expect(snapshot.queryEcho.metricIds).toContain('task.rt_mean_ms');
  expect(snapshot.queryEcho.metricIds).not.toContain('task.legacy_removed_metric');
  expect(snapshot.queryEcho.filters.qcChannels).toEqual(['task', 'gaze']);
});

test('a stale calculation clears every report and can be explicitly reapplied without changing filters', async ({ page }) => {
  fixtures.set('/analytics/v1/sessions/11/summary', { kind: 'session_summary', data: {
    session: { sessionId: 11 }, metrics: [], qcChannels: [],
  } });
  await page.goto('/apps/web/researcher.html#/analytics/session-card');
  await expect(page.locator('#analyticsProtocolFilter')).toHaveValue('9');
  await page.evaluate(() => {
    const api = (window as any).EmocogAnalyticsProduction.api;
    const original = api.sessionSummary;
    let fail = true;
    api.sessionSummary = async (...args: any[]) => {
      if (!fail) return original(...args);
      fail = false;
      throw Object.assign(new Error('SECRET implementation details'), { code: 'analytics_snapshot_stale', status: 409 });
    };
  });
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('.ab-filter-status')).toContainText('методы расчёта обновились');
  await expect(page.locator('#analyticsPdfDownload')).toHaveCount(0);
  await expect(page.locator('.ab-dashboard')).toHaveCount(0);
  await expect(page.locator('#analyticsProductionBody')).not.toContainText('SECRET');
  await expect(page.locator('#analyticsProtocolFilter')).toHaveValue('9');
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('.ab-report-intro')).toBeVisible();
  expect(requests.filter(request => request.path === '/analytics/v1/snapshots')).toHaveLength(2);
  await inert(page);
});

test('interactive session chart keeps missing values, block attempts and PDF selection distinct', async ({ page }) => {
  const signal = (mean: number | null) => ({ mean, observedMs: mean == null ? 0 : 4000, count: mean == null ? 0 : 3, methodVersion: 'test-v1' });
  fixtures.set('/analytics/v1/filter-options', { blocks: [{ id: 'one', name: marker }, { id: 'two', name: 'Block B' }],
    stimuli: [], aois: [], qcChannels: ['task'], selectedMetricIds: ['task.rt_mean_ms'] });
  fixtures.set('/analytics/v1/sessions/11/summary', { kind: 'session_summary', data: {
    session: { sessionId: 11, participantAlias: 'P-audit', protocolId: 9, protocolVersion: '1', completionStatus: 'completed' },
    metrics: [], qcChannels: [{ channel: 'task', validFraction: 0, status: 'invalid', reasons: [marker] }], exclusions: [],
    physiologyIntervals: {
      blocks: [
        { blockId: 'one', attempt: 1, startMs: 0, endMs: 5000, status: 'repeat_required', heartRate: signal(72), respiration: signal(null) },
        { blockId: 'two', attempt: 1, startMs: 6000, endMs: 10000, status: 'accepted', heartRate: signal(88), respiration: signal(14) },
      ],
      minutes: [{ startMs: 0, endMs: 60000, heartRate: signal(82), respiration: signal(12) }],
    },
    connectedness: { trials: [{ trialId: 'std_simple_black_square_0_0', stimulusId: 'std_simple_black_square', blockId: 'one', attempt: 1, onsetMs: 2000, rtMs: 220, correct: true, qualityValid: true, status: 'responded' },
      { trialId: 'wrong', rtMs: 330, correct: false, qualityValid: true }, { trialId: 'invalid', rtMs: 450, correct: true, qualityValid: false }] },
  } });
  fixtures.set('/analytics/v1/sessions/11/visuals', { kind: 'session_visuals', data: { contexts: [] } });
  await apply(page);
  const dashboard = page.locator('#analyticsSessionBlocks');
  await expect(page.locator('#analyticsPdfDownload')).toBeEnabled();
  await expect(page.locator('#analyticsRtDistribution .ab-detail')).toContainText('220');
  await expect(page.locator('#analyticsRtDistribution .ab-heading')).toContainText('проверку качества: 1');
  await expect(page.getByText('sha256:audit', { exact: false }).first()).toBeHidden();
  await page.locator('.ab-glossary summary').click();
  await page.locator('#analyticsGlossarySearch').fill('TTFF');
  await expect(page.locator('.ab-glossary dl > div:visible')).toHaveCount(1);
  await page.locator('.ab-glossary summary').click();
  await expect(dashboard.locator('.ab-detail')).toContainText('72');
  await expect(dashboard.locator('.ab-detail')).toContainText(marker);
  await dashboard.locator('.ab-chart').scrollIntoViewIfNeeded();
  const bar = await dashboard.locator('[data-ab-point="1"] .ab-range-hit').evaluate(node => {
    const line = node as SVGLineElement;
    const mid = new DOMPoint((line.x1.baseVal.value + line.x2.baseVal.value) / 2, line.y1.baseVal.value)
      .matrixTransform(line.getScreenCTM()!);
    return { x: mid.x, y: mid.y };
  });
  await page.mouse.click(bar.x, bar.y);
  await expect(dashboard.locator('.ab-detail')).toContainText('88');
  await expect(dashboard.locator('#abPoint')).toHaveValue('1');
  const pdf = await page.locator('#analyticsProductionBody').evaluate(node => {
    const result = (window as any).EmocogAnalyticsPdf.capture(node);
    return { controls: result.controls, captions: result.figures.map((figure: any) => figure.caption) };
  });
  expect(pdf.controls).toEqual(expect.arrayContaining([expect.objectContaining({ control: 'abPoint', key: '1' })]));
  expect(pdf.captions).toContain('Блоки и попытки · уд/мин');
  const download = page.waitForEvent('download');
  await page.locator('#analyticsPdfDownload').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/session-card\.pdf$/);
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.toString('latin1')).toContain('/Subtype /Image');
  const chartDownload = page.waitForEvent('download');
  await dashboard.locator('[data-ab-save-chart]').click();
  const png = await chartDownload;
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  expect((await readFile((await png.path())!)).subarray(1, 4).toString()).toBe('PNG');
  const respiration = dashboard.getByRole('button', { name: /Дыхание/ });
  await respiration.focus();
  await respiration.press('Enter');
  await expect(respiration).toBeFocused();
  await expect(dashboard.locator('#abPoint')).toHaveValue('1');
  await expect(dashboard.locator('.ab-detail')).toContainText('14 дых/мин');
  await dashboard.getByRole('button', { name: 'Предыдущее наблюдение' }).click();
  await expect(dashboard.locator('#abPoint')).toHaveValue('0');
  await expect(dashboard.locator('.ab-detail')).toContainText('Нет данных');
  await dashboard.locator('#abBlock').selectOption('one');
  await expect(dashboard.locator('.ab-mark')).toHaveCount(0);
  await expect(dashboard.locator('.ab-detail')).toContainText('Нет данных');
  await dashboard.locator('#abMode').selectOption('minutes');
  await expect(dashboard.locator('.ab-detail')).toContainText('12');
  await dashboard.locator('#abMode').selectOption('trials');
  await expect(dashboard.locator('.ab-detail')).toContainText('220');
  await expect(dashboard.locator('#abPoint option:checked')).toHaveText('Проба 1 · Чёрный квадрат');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dashboard.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await inert(page);
  await apply(page, 'data-quality');
  await expect(page.locator('#analyticsChannelQuality meter')).toHaveAttribute('value', '0');
  await expect(page.locator('#analyticsChannelQuality .ab-detail')).toContainText('<img src=x onerror=');
  await inert(page);
});

test('localStorage draft date attributes round-trip literally and invalid dates stay out of the API query', async ({ page }) => {
  await page.addInitScript(attribute => localStorage.setItem('emocog_analytics_query_draft_v1', JSON.stringify({
    dateFrom: attribute, dateTo: attribute,
  })), attribute);
  await page.goto('/apps/web/researcher.html#/analytics/group-comparison');
  await expect(page.locator('#analyticsDateFrom')).toHaveAttribute('value', attribute);
  await expect(page.locator('#analyticsDateTo')).toHaveAttribute('value', attribute);
  const query = await page.evaluate(() => {
    const app = (window as any).EmocogAnalyticsProduction;
    return app.buildAnalyticsQuery(app.store.state);
  });
  expect(query.filters.dateFrom).toBeNull();
  expect(query.filters.dateTo).toBeNull();
  await inert(page);
});

test('legacy group, QC and connectedness charts use local fixtures, not API or stored session datasets', async ({ page }) => {
  await page.addInitScript(marker => localStorage.setItem('emocog_session_features_11', marker), marker);
  for (const tab of ['group-comparison', 'data-quality', 'connectedness']) {
    await page.goto(`/apps/web/researcher.html?analyticsDemo=1#/analytics/${tab}`);
    await expect(page.locator('#analyticsViewBody svg').first()).toBeVisible();
    await expect(page.locator('#analyticsViewBody')).not.toContainText(marker);
    await inert(page);
  }
  expect(requests.filter(request => request.path.startsWith('/analytics/v1/'))).toEqual([]);
});

test('group API QC counts, AOI fractions, participant titles and device counts are literal data', async ({ page }) => {
  fixtures.set('/analytics/v1/groups/summary', { kind: 'group_summary', data: {
    nParticipants: 1, nSessions: 1, nObservations: 1,
    qcByChannel: [{ channel: marker, valid: marker, borderline: marker, invalid: marker, notComputed: marker }],
    metrics: [{ metricId: 'aoi.' + marker, status: 'computed', median: 1, q1: 0, q3: 2, min: 0, max: 3,
      numerator: marker, denominator: marker, nParticipants: marker, nObservations: marker, scope: { aoiId: marker },
      participantValues: [{ participantId: attribute, value: 1, nObservations: marker }] }],
    deviceCounts: [{ deviceClass: marker, participantCount: marker, sessionCount: marker }],
  } });
  await apply(page, 'group-comparison');
  await expect(page.locator('#analyticsProductionBody table')).toContainText(marker);
  const group = page.locator('#analyticsGroupDistribution');
  await expect(group.locator('.ab-mark title')).toHaveText(`${attribute}: 1`);
  await expect(group.locator('.ab-detail').last()).toContainText(attribute);
  await group.locator('#abGroupView').selectOption('hist');
  await expect(group.locator('.ab-bin')).toHaveCount(1);
  await expect(group.locator('.ab-detail').last()).toContainText('Участников в диапазоне');
  await inert(page);
});

test('comparison API counts and pair identifiers stay text on level two', async ({ page }) => {
  fixtures.set('/analytics/v1/filter-options', { qcChannels: ['task'], comparisons: [{ id: 'audit', name: marker }] });
  fixtures.set('/analytics/v1/comparisons/audit', { kind: 'model_result', data: {
    modelId: 'descriptive-participant-difference', metricId: marker, design: 'paired', readiness: 'available',
    reference: { mean: 1, nParticipants: marker }, comparison: { mean: 2, nParticipants: marker }, effect: 1,
    nParticipants: marker, nObservations: marker, unidentifiedSessionCount: marker, excludedParticipants: [],
    pairs: [{ participantId: marker, reference: 1, comparison: 2, difference: 1 },
      { participantId: 'Pair 2', reference: 3, comparison: 7, difference: 4 }], specification: {}, formula: marker,
  } });
  await page.addInitScript(() => localStorage.setItem('emocog_analytics_query_draft_v1', JSON.stringify({ analysisLevel: 'level_2', comparisonId: 'audit' })));
  await page.goto('/apps/web/researcher.html#/analytics/group-comparison');
  await expect(page.locator('#analyticsComparisonFilter')).toBeVisible();
  await page.locator('#analyticsComparisonFilter').selectOption('audit');
  await page.locator('#analyticsApplyFilters').click();
  await expect(page.locator('#analyticsDescriptiveComparison')).toContainText(marker);
  const graph = page.locator('#analyticsBlockComparison');
  await expect(graph.locator('line.ab-pair')).toHaveCount(2);
  await graph.locator('#abPoint').selectOption('1');
  await expect(graph.locator('.ab-detail')).toContainText('Pair 2');
  await inert(page);
});

test('physiology comparison includes rest blocks and keeps units and missingness explicit', async ({ page }) => {
  fixtures.set('/analytics/v1/filter-options', { qcChannels: ['task'],
    blocks: [{ id: 'rest', name_ru: 'Покой', hasTrials: false }, { id: 'task', name_ru: 'Задание', hasTrials: true }] });
  fixtures.set('/analytics/v1/comparisons/custom', { kind: 'model_result', data: {
    modelId: 'descriptive-participant-difference', metricId: 'physiology.bpm_mean', effectUnit: 'bpm',
    design: 'paired', readiness: 'available', effect: 8,
    reference: { mean: 70, nParticipants: 1 }, comparison: { mean: 78, nParticipants: 1 },
    pairs: [{ participantId: 'P-audit', reference: 70, comparison: 78, difference: 8 }],
    nParticipants: 1, nObservations: 8, excludedParticipants: [],
    warnings: ['physiology_comparison_descriptive_only'],
  } });
  await page.goto('/apps/web/researcher.html#/analytics/group-comparison');
  await expect(page.locator('#analyticsProtocolFilter')).toHaveValue('9');
  await page.locator('.analytics-level[data-level="level-2"]').click();
  await page.locator('#analyticsComparisonMetric').selectOption('physiology.bpm_mean');
  await expect(page.locator('#analyticsComparisonMetric option:checked')).toHaveText('ЧСС: средняя оценка');
  await expect(page.locator('#analyticsReferenceLevel option[value="rest"]')).toHaveText('Покой');
  await page.locator('#analyticsReferenceLevel').selectOption('rest');
  await page.locator('#analyticsComparisonLevel').selectOption('task');
  await page.locator('#analyticsApplyFilters').click();
  const dashboard = page.locator('#analyticsDescriptiveComparison');
  await expect(dashboard).toContainText('уд/мин');
  await expect(dashboard).toContainText('Покой');
  await expect(dashboard).toContainText('засчитанные попытки');
  await expect(dashboard).not.toContainText(/95% CI:|adjusted p =/);
  expect(snapshot.queryEcho.comparison).toEqual({ design: 'paired', metricId: 'physiology.bpm_mean',
    axis: 'block', referenceId: 'rest', comparisonId: 'task' });
  await page.locator('#analyticsComparisonAxis').selectOption('condition');
  await expect(page.locator('#analyticsApplyFilters')).toBeDisabled();
  await inert(page);
});

test('participant associations match identities, not array order, and keep missing values out', async ({ page }) => {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333'];
  const participantValues = (values: [string, number | null][]) => values.map(([participantId, value]) => ({ participantId, value, nObservations: 10 }));
  fixtures.set('/analytics/v1/groups/summary', { kind: 'group_summary', data: {
    nParticipants: 3, nSessions: 3, nObservations: 60,
    metrics: [
      { metricId: 'face.valence_mean', unit: 'index', status: 'computed',
        participantValues: participantValues([[ids[0], -1], [ids[1], 0], [ids[2], 1]]) },
      { metricId: 'physiology.bpm_mean', unit: 'bpm', status: 'computed',
        participantValues: participantValues([[ids[2], 90], [ids[0], 70], [ids[1], 80], ['unmatched', 100], ['missing', null]]) },
    ],
  } });
  await apply(page, 'group-comparison');
  const relation = page.locator('#analyticsParticipantRelation');
  await relation.locator('summary').click();
  await expect(relation.locator('.ab-mark')).toHaveCount(3);
  await relation.locator('#abRelationPoint').selectOption('1');
  await expect(relation.locator('.ab-detail dd')).toHaveText(['3', '1', '0', '80']);
  await expect(relation.locator('#abRelationY option:checked')).toContainText('уд/мин');
  await expect(relation).not.toContainText(ids[0]);
  await relation.locator('#abRelationX').selectOption('1');
  await expect(relation.locator('.ab-mark')).toHaveCount(0);
  await expect(relation).toContainText('Выберите два разных показателя.');
  await inert(page);
});

test('independent comparisons show unlinked observations and an exported interval figure', async ({ page }) => {
  await page.goto('/apps/web/researcher.html#/analytics/group-comparison');
  await expect(page.locator('#analyticsApplyFilters')).toBeVisible();
  await page.evaluate(() => {
    const target = document.createElement('div');
    target.id = 'test-comparison';
    document.getElementById('analyticsProductionBody')!.appendChild(target);
    (window as any).EmocogBlockDashboard.comparison(target, {
      design: 'independent', effectUnit: 'ms', effect: 5, estimateCi95: { lower: -20, upper: 30 },
      reference: { values: [0, 10, 20] }, comparison: { values: [5, 15, 25] },
    }, { en: true, metric: 'Reaction time' });
  });
  const chart = page.locator('#test-comparison');
  await expect(chart.locator('.ab-mark')).toHaveCount(6);
  await expect(chart.locator('.ab-pair')).toHaveCount(0);
  await chart.locator('#abPoint').selectOption('5');
  await expect(chart.locator('.ab-detail')).toContainText('25 ms');
  const figures = await page.locator('#analyticsProductionBody').evaluate(node => (window as any).EmocogAnalyticsPdf.capture(node).figures.map((figure: any) => figure.caption));
  expect(figures).toContain('Difference B − A and exploratory 95% CI');
});

test('visual API dimensions cannot escape style; AOI labels, SVG coordinates and metadata are inert', async ({ page }) => {
  fixtures.set('/analytics/v1/sessions/11/summary', { kind: 'session_summary', data: { session: { sessionId: 11 }, metrics: [], qcChannels: [], exclusions: [] } });
  fixtures.set('/analytics/v1/sessions/11/visuals', { kind: 'session_visuals', data: { contexts: [{
    status: 'computed', blockName: marker, presentationId: marker,
    stimulus: { name: marker, intrinsicWidth: attribute, intrinsicHeight: '9', contentUrl: 'javascript:window.__analyticsXss=1' },
    aoiRows: [{ aoi: { shape: 'polygon', name: marker, order: marker, points: [{ x: attribute, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, metrics: [] }],
    heatmap: { nFixations: 0, fixationPoints: [{ x: attribute, y: 0, durationMs: attribute }] },
  }] } });
  await apply(page);
  await expect(page.locator('#analyticsProductionBody')).toContainText(marker);
  await expect(page.locator('#analyticsProductionBody [style*="aspect-ratio"]')).toHaveCSS('aspect-ratio', '16 / 9');
  await expect(page.locator('#analyticsProductionBody polygon, #analyticsProductionBody svg circle')).toHaveCount(0);
  await expect(page.locator('#analyticsProductionBody [src^="javascript:"]')).toHaveCount(0);
  await inert(page);
});

test('export refuses mismatched provenance and never follows an API redirect', async ({ page, request, baseURL }) => {
  fixtures.set('/analytics/v1/sessions/11/summary', { kind: 'session_summary', data: { session: { sessionId: 11 }, metrics: [] } });
  fixtures.set('/analytics/v1/sessions/11/visuals', { kind: 'session_visuals', data: { contexts: [] } });
  await apply(page);
  await expect(page.locator('#analyticsOpenExport')).toBeVisible();
  const before = await (await request.get(baseURL + '/__analytics_security/stats')).json();
  for (const failure of ['hash', 'redirect'] as const) {
    exportFailure = failure;
    const error = await page.evaluate(async () => {
      const app = (window as any).EmocogAnalyticsProduction;
      try { await app.api.exportSnapshot(app.store.state, 'json', 'summary'); return ''; }
      catch (error) { return String(error); }
    });
    expect(error).not.toBe('');
    if (failure === 'hash') expect(error).toContain('dataset hash does not match');
  }
  const after = await (await request.get(baseURL + '/__analytics_security/stats')).json();
  expect(after.redirects).toBe(before.redirects + 1);
  expect(after.targets).toBe(before.targets);
  await inert(page);
});

test('snapshot POST and export download preserve canonical path, cookie/CSRF headers and provenance', async ({ page }) => {
  fixtures.set('/analytics/v1/sessions/11/summary', { kind: 'session_summary', data: { session: { sessionId: 11 }, metrics: [], qcChannels: [], exclusions: [] } });
  fixtures.set('/analytics/v1/sessions/11/visuals', { kind: 'session_visuals', data: { contexts: [] } });
  await apply(page);
  await expect(page.locator('#analyticsOpenExport')).toBeVisible();
  await page.locator('#analyticsOpenExport').click();
  await expect(page.locator('#analyticsExportDownload')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#analyticsExportDownload').click()]);
  expect(download.suggestedFilename()).toMatch(/^emocog-Audit-protocol-v1-audit-snapshot\.(csv|json)$/);
  const created = requests.find(request => request.path === '/analytics/v1/snapshots')!;
  const exported = requests.find(request => request.path === '/analytics/v1/exports')!;
  expect(created.method).toBe('POST');
  for (const request of [created, exported]) {
    expect(request.headers['x-csrf-token']).toBe('synthetic-csrf');
    expect(request.headers['x-staff-user-id']).toBe('1');
  }
  expect(new URLSearchParams(exported.query).get('snapshot_id')).toBe('audit-snapshot');
  await inert(page);
});
