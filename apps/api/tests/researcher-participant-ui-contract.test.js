const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('researcher protocol builder contract', () => {
  it('declares builderKey before analytics config is read', () => {
    const source = read('web/researcher-builder.js');
    const saveStart = source.indexOf('async function doSave()');
    const builderKey = source.indexOf("const builderKey = experimentId || 'draft';", saveStart);
    const analyticsRead = source.indexOf('getExperimentAnalyticsConfig(builderKey)', saveStart);
    assert.ok(saveStart >= 0);
    assert.ok(builderKey > saveStart);
    assert.ok(analyticsRead > builderKey);
  });

  it('exports background measurements without standalone BPM or emotion flags', () => {
    const source = read('web/researcher-builder.js');
    assert.match(source, /testHubMetrics:\s*\[\]/);
    assert.doesNotMatch(source, /useBPM:\s*!!/);
    assert.doesNotMatch(source, /useEmotionTracking:\s*!!/);
    assert.match(source, /Фоновые сигналы сессии/);
  });
});

describe('participant test hub contract', () => {
  it('filters legacy BPM cards while retaining background BPM collection', async () => {
    const utilsPath = path.join(
      root,
      'participant-web/js/web-page/protocol-invite-utils.js'
    );
    const { deriveInvitationHubMetrics } = await import(pathToFileURL(utilsPath).href);
    assert.deepEqual(
      deriveInvitationHubMetrics({
        testHubMetrics: ['rt', 'bpm', 'vpc'],
      }),
      ['rt', 'vpc']
    );

    const html = read('participant-web/mvp_with_precheck_1-updated.html');
    assert.doesNotMatch(html, /hubRunBpmBtn|bpmTestScreen/);
    const runtime = read('participant-web/js/session-runtime/index.js');
    assert.match(runtime, /modules:\s*\['gaze', 'blinks', 'rt', 'bpm', 'emotion', 'bodyPose'\]/);
  });

  it('reserves before testing and removes the invitation bearer from the URL', () => {
    const ui = read('participant-web/js/web-page/ui-updated.js');
    const app = read('participant-web/js/web-page/app-updated.js');
    assert.match(ui, /await primeParticipantSession/);
    assert.match(ui, /await state\.runtime\?\.sessionRuntime\?\.saveCheckpoint/);
    assert.match(ui, /searchParams\.delete\('code'\)/);
    assert.match(ui, /history\.replaceState/);
    assert.match(app, /invitationCodeFromUrl \|\| state\.sessionData\.ids\.invitationCode/);
  });
});

describe('researcher navigation contract', () => {
  it('contains global and project navigation from the researcher flow', () => {
    const html = read('web/researcher.html');
    for (const label of [
      'Главная',
      'Проекты',
      'Библиотека',
      'Тариф',
      'Обзор',
      'Протоколы',
      'Участники',
      'Мониторинг',
      'Результаты',
      'Настройки',
    ]) {
      assert.match(html, new RegExp(`>${label}<`));
    }
    const core = read('web/researcher-core.js');
    assert.match(core, /participants:\s*'sessions'/);
    assert.match(core, /monitoring:\s*'analytics'/);
    assert.match(core, /results:\s*'analytics'/);
  });

  it('never enables fictional analytics outside explicit localhost preview', () => {
    const html = read('web/researcher.html');
    assert.match(html, /analyticsPreview/);
    assert.match(html, /location\.hostname === 'localhost'/);
    assert.doesNotMatch(
      html,
      /<script\s+src="researcher-analytics-preview-fixture\.js[^>]*><\/script>/
    );
  });

  it('uses cookie credentials and restores CSRF without exposing the staff JWT', () => {
    const guard = read('web/auth-guard.js');
    const login = read('web/developer/login.html');
    const authRoute = read('api/routes/auth.js');
    assert.match(guard, /credentials:\s*'include'/);
    assert.match(guard, /sessionStorage\.setItem\('emocog_csrf_token'/);
    assert.match(guard, /delete safeUser\.csrf_token/);
    assert.doesNotMatch(guard, /localStorage\.setItem\('emocog_api_user', JSON\.stringify\(payload\)\)/);
    assert.match(login, /'X-Auth-Transport':\s*'cookie'/);
    assert.doesNotMatch(login, /localStorage\.setItem\('emocog_api_token'/);
    assert.match(authRoute, /req\.authTransport === 'cookie'[\s\S]+csrf_token/);
    assert.doesNotMatch(read('web/developer/accounts.html'), /emocog_api_token/);
    assert.doesNotMatch(read('web/developer/invite.html'), /emocog_api_token/);
  });

  it('uses cookie auth on the landing page and serializes AOIs into protocol blocks', () => {
    const landing = read('web/index.html');
    const builder = read('web/researcher-builder.js');
    const researcher = read('web/researcher.html');
    assert.match(landing, /auth\/me'[\s\S]+credentials:\s*'include'/);
    assert.match(landing, /sessionStorage\.setItem\('emocog_csrf_token'/);
    assert.match(researcher, /aoi-protocol\.js/);
    assert.match(builder, /attachBlockAois\(out\.blockConfig, b\.content, out\.trials\)/);
    assert.match(builder, /aoiSchemaVersion/);
    assert.match(builder, /aoiDefinitions/);
  });

  it('does not route public respondents into staff UI or render API labels as HTML', () => {
    const login = read('web/developer/login.html');
    const experiments = read('web/developer/experiments.html');
    const stimuli = read('web/researcher-stimuli.js');
    assert.match(login, /Public registration intentionally creates respondent-only accounts/);
    assert.match(login, /Аккаунт участника создан/);
    assert.match(login, /Регистрация участника/);
    assert.match(login, /Минимум 12 символов/);
    assert.doesNotMatch(login, /Публичная регистрация создаёт роль <strong>исследователя<\/strong>/);
    assert.match(experiments, /escapeHtml\(r\.experiment_title/);
    assert.match(experiments, /escapeHtml\(r\.participant_id/);
    assert.match(stimuli, /escapeStimulusHtml\(s\.name\)/);
    assert.doesNotMatch(stimuli, /onclick="[^"]*deleteStimulusFromLibrary/);
  });

  it('escapes imported protocol, account and membership values before HTML rendering', () => {
    const builder = read('web/researcher-builder.js');
    const accounts = read('web/developer/accounts.html');
    const invites = read('web/developer/invite.html');
    const admin = read('web/researcher-admin-settings.js');
    const experiments = read('web/researcher-experiments.js');
    assert.match(builder, /previewEscape\(file\.name\)/);
    assert.match(builder, /previewEscape\(b\.id\)/);
    assert.match(builder, /previewEscape\(protocolMeta\.title/);
    assert.match(builder, /previewEscape\(localizedBlockLabel/);
    assert.match(accounts, /escapeHtml\(u\.email/);
    assert.match(invites, /escapeHtml\(x\.code/);
    assert.match(admin, /escapeAdminHtml\(u\.email/);
    assert.match(experiments, /escapeUiHtml\(exp\.title/);
    assert.match(experiments, /escapeUiHtml\(participantLinkForExperiment/);
  });
});
