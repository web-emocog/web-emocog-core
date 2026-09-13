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
    assert.doesNotMatch(source, /Фоновые сигналы сессии/);
    assert.match(source, /featureFlags:\s*sessionFeatureFlags/);
    assert.match(source, /class="session-feature"/);
  });

  it('keeps converted document pages in the Slides category with image previews', () => {
    const core = read('web/researcher-core.js');
    const stimuli = read('web/researcher-stimuli.js');
    const builder = read('web/researcher-builder.js');
    assert.match(core, /sourceDocumentName[\s\S]+type: 'slides'/);
    assert.match(stimuli, /function convertedStimulusFromApi[\s\S]+type: 'slides'/);
    assert.match(stimuli, /stimulus\?\.type === 'image' \|\| stimulus\?\.type === 'slides'/);
    assert.match(builder, /stimulus\.type === 'image' \|\| stimulus\.type === 'slides'/);
  });
});

describe('participant test hub contract', () => {
  it('keeps every participant preparation stage mandatory for legacy definitions', async () => {
    const utilsPath = path.join(
      root,
      'participant-web/js/web-page/protocol-invite-utils.js'
    );
    const { getParticipantShell } = await import(
      pathToFileURL(utilsPath).href + `?t=${Date.now()}`
    );
    const expected = {
      consent: true,
      questionnaire: true,
      precheck: true,
      calibration: true,
    };
    assert.deepEqual(getParticipantShell({
      participantShell: {
        consent: false,
        questionnaire: false,
        precheck: false,
        calibration: false,
      },
    }), expected);

    const { normalizeMandatoryParticipantShell } = require('../protocol/participant-shell');
    assert.deepEqual(
      normalizeMandatoryParticipantShell({ participantShell: { calibration: false } }).participantShell,
      expected
    );
  });

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
    for (const moduleName of [
      'gaze',
      'blinks',
      'rt',
      'bpm',
      'emotion',
      'bodyPose',
      'audio',
      'multimodal',
    ]) {
      assert.match(runtime, new RegExp(`'${moduleName}'`));
    }
  });

  it('retains timers and audio tasks after the mandatory calibration shell', async () => {
    const utilsPath = path.join(
      root,
      'participant-web/js/web-page/protocol-invite-utils.js'
    );
    const { definitionForCognitiveRunner, getInvitationSessionPlan } = await import(
      pathToFileURL(utilsPath).href + `?audio=${Date.now()}`
    );
    const definition = {
      blocks: [
        { id: 'calibration', type: 'calibration' },
        { id: 'session-timer', type: 'timer' },
        { id: 'pa-ta-ka', type: 'audio_test', content: { testType: 'oral_ddk' } },
        { id: 'finish', type: 'finish' },
      ],
    };
    assert.deepEqual(
      definitionForCognitiveRunner(definition).blocks.map(block => block.id),
      ['session-timer', 'pa-ta-ka', 'finish']
    );
    assert.equal(getInvitationSessionPlan(definition).runProtocolAfterShell, true);
  });

  it('reserves before testing and removes the invitation bearer from the URL', () => {
    const ui = read('participant-web/js/web-page/ui-updated.js');
    const app = read('participant-web/js/web-page/app-updated.js');
    assert.match(ui, /await primeParticipantSession/);
    // Admission is the security boundary; checkpoint persistence must not hold
    // the consent button on slow IndexedDB implementations.
    assert.match(ui, /void state\.runtime\?\.sessionRuntime\?\.saveCheckpoint/);
    assert.match(ui, /searchParams\.delete\('code'\)/);
    assert.match(ui, /history\.replaceState/);
    assert.match(app, /invitationCodeFromUrl \|\| state\.sessionData\.ids\.invitationCode/);
  });

  it('allows authenticated developers to run modules without an invitation', () => {
    const app = read('participant-web/js/web-page/app-updated.js');
    const bypassStart = app.indexOf('async function fetchParticipantInviteBypass()');
    const bypassEnd = app.indexOf('function ensureDeveloperSessionIds()', bypassStart);
    const bypass = app.slice(bypassStart, bypassEnd);
    assert.match(bypass, /credentials:\s*'include'/);
    assert.match(bypass, /me\?\.user\?\.role \|\| me\?\.role/);
    assert.doesNotMatch(bypass, /if \(!token\) return false/);
  });

  it('uses the full stimulus stage for AOI coordinates and explains gaze validation', async () => {
    const app = read('participant-web/js/web-page/app-updated.js');
    const task = read('participant-web/js/web-page/experimental_task-updated.js');
    const tests = read('participant-web/js/web-page/tests-updated.js');
    const html = read('participant-web/mvp_with_precheck_1-updated.html');
    const css = read('participant-web/style.css');
    const rectStart = app.indexOf('function currentStimulusContentRect()');
    const rectEnd = app.indexOf('window.setLanguage', rectStart);
    const rectSource = app.slice(rectStart, rectEnd);
    assert.match(rectSource, /getElementById\('cognitiveStimulusArea'\)/);
    assert.doesNotMatch(rectSource, /getElementById\('cogImage'\)/);
    assert.match(task, /classList\.add\('cognitive-stimulus-presenting'\)/);
    assert.match(css, /body\.cognitive-stimulus-presenting[\s\S]+#cognitiveStimulusArea/);
    assert.match(html, /id="validationIntro"/);
    assert.match(html, /id="validationResult"/);
    assert.match(tests, /validation_instruction_acknowledged/);
    assert.doesNotMatch(tests, /validation_targeted_recalibration_scheduled/);

    const translationsPath = path.join(root, 'participant-web/translations.js');
    const { translations, participantLocales } = await import(
      pathToFileURL(translationsPath).href + `?validation=${Date.now()}`
    );
    participantLocales.forEach(locale => {
      assert.ok(translations[locale].validation_intro_body);
      assert.ok(translations[locale].validation_result_passed_advice);
      assert.ok(translations[locale].validation_result_failed_advice);
    });
  });

  it('maps yaw and pitch to matching head-pose guidance in both locales', async () => {
    const translationsPath = path.join(root, 'participant-web/translations.js');
    const { translations } = await import(pathToFileURL(translationsPath).href);
    assert.equal(translations.ru.precheck_all_good, '✅ Проверка пройдена! Можно начинать калибровку');
    assert.equal(translations.ru.status_error, '❌ Ошибка');
    assert.equal(translations.en.precheck_all_good, '✅ Check passed. You can start calibration');

    for (const file of [
      'participant-web/js/web-page/precheck.js',
      'participant-web/js/web-page/precheck-updated.js',
    ]) {
      const source = read(file);
      assert.match(source, /pose\.yaw > 0[\s\S]+tip_pose_turn_left[\s\S]+tip_pose_turn_right/);
      assert.match(source, /pose\.pitch > 0[\s\S]+tip_pose_raise_head[\s\S]+tip_pose_lower_head/);
    }
    for (const file of [
      'participant-web/js/web-page/app-updated.js',
      'participant-web/js/web-page/ui-updated.js',
      'participant-web/js/web-page/tests-updated.js',
    ]) {
      assert.doesNotMatch(read(file), /from '\.\/precheck-updated\.js';/);
    }
  });
});

describe('researcher navigation contract', () => {
  it('isolates researcher drafts by staff account and verifies protocol links through the API', () => {
    const accountStorage = read('web/account-storage.js');
    const login = read('web/developer/login.html');
    const researcher = read('web/researcher.html');
    const experiments = read('web/researcher-experiments.js');
    assert.match(accountStorage, /emocog_workspace_owner_v1/);
    assert.match(accountStorage, /unscoped_workspace_migration/);
    assert.match(login, /WecogAccountStorage\.activate\(result\.user\.id\)/);
    assert.match(researcher, /WecogAccountStorage\.activateCachedUser/);
    assert.match(experiments, /apiGet\('\/protocols\?project_id='/);
    assert.match(experiments, /serverSyncComplete/);
    assert.match(experiments, /invitation_code/);
  });
  it('resolves local and production API endpoints without trusting arbitrary origins', () => {
    const resolver = require(path.join(root, 'web/api-base.js'));
    assert.equal(
      resolver.resolve({ pageUrl: 'http://127.0.0.1:8080/apps/web/developer/login.html', useStorage: false }),
      'http://127.0.0.1:3000'
    );
    assert.equal(
      resolver.resolve({ pageUrl: 'https://wecog.ru/main/apps/web/researcher.html', useStorage: false }),
      'https://wecog.ru/main/api'
    );
    assert.equal(
      resolver.resolve({
        pageUrl: 'https://wecog.ru/apps/web/researcher.html',
        configuredBase: 'https://attacker.example/collect',
        useStorage: false,
      }),
      'https://wecog.ru/api'
    );
    const login = read('web/developer/login.html');
    const invite = read('web/developer/invite.html');
    assert.match(login, /EmocogApiBase\.resolve\(\{ useStorage: false \}\)/);
    assert.match(invite, /EmocogApiBase\.resolve\(\{ configuredBase: fromField \|\| undefined \}\)/);
    assert.doesNotMatch(invite, /if \(fromField\) return fromField/);
  });

  it('keeps the consolidated global navigation without duplicate project aliases', () => {
    const html = read('web/researcher.html');
    for (const label of [
      'Главная',
      'Исследования',
      'Библиотека',
      'Аналитика',
      'Настройки',
    ]) {
      assert.match(html, new RegExp(`>${label}<`));
    }
    assert.doesNotMatch(html, /projectNavigationWrap/);
    assert.doesNotMatch(html, /nav-project-(overview|protocols|participants|monitoring|results)/);
    const core = read('web/researcher-core.js');
    const bridge = read('web/researcher-api-bridge.js');
    assert.doesNotMatch(core, /projectRouteMap/);
    assert.doesNotMatch(core, /#\/projects\//);
    assert.match(core, /apiPost\('\/projects'/);
    assert.match(core, /window\.syncWelcomeProjects/);
    assert.match(bridge, /global\.syncWelcomeProjects\(projects\)/);
    assert.match(html, /id="projectSelect" data-no-auto-i18n/);
    assert.match(html, /id="researcherNavSearch"/);
    assert.equal((html.match(/data-wecog-theme-value=/g) || []).length, 6);
    assert.match(html, /data-wecog-theme-value="auto"/);
    assert.match(html, /data-wecog-theme-value="light"/);
    assert.match(html, /data-wecog-theme-value="dark"/);
    assert.match(html, /assets\/wecog-mark\.svg/);
    assert.match(read('web/assets/researcher-redesign.css'), /#nav-billing \{ display: none !important; \}/);
    assert.match(read('web/researcher-i18n.js'), /closest\('\[data-no-auto-i18n\]'\)/);
    const syncStart = bridge.indexOf('async function syncProjectsFromApi()');
    assert.ok(syncStart >= 0);
    assert.ok(
      bridge.indexOf("setSelectedProjectId(projects[0].id", syncStart)
        < bridge.indexOf('populateProjectSelect(projects)', syncStart)
    );
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
    assert.doesNotMatch(guard, /getItem\(['"]emocog_api_token/);
    assert.doesNotMatch(read('web/researcher-core.js'), /getItem\(['"]emocog_api_token/);
    assert.doesNotMatch(read('web/index.html'), /getItem\(['"]emocog_api_token/);
    assert.doesNotMatch(read('web/developer.html'), /getItem\(['"]emocog_api_token/);
    assert.doesNotMatch(read('web/developer/experiments.html'), /getItem\(['"]emocog_api_token/);
    assert.doesNotMatch(read('web/developer/accounts.html'), /emocog_api_token/);
    assert.doesNotMatch(read('web/developer/invite.html'), /emocog_api_token/);
  });

  it('uses cookie auth on the landing page and serializes AOIs into protocol blocks', () => {
    const landing = read('web/index.html');
    const builder = read('web/researcher-builder.js');
    const researcher = read('web/researcher.html');
    assert.match(landing, /auth\/me'[\s\S]+credentials:\s*'include'/);
    assert.match(landing, /sessionStorage\.setItem\('emocog_csrf_token'/);
    assert.match(landing, /developer\/login\.html\?portal=researcher/);
    assert.match(landing, /developer\/login\.html\?portal=admin/);
    assert.doesNotMatch(landing, /id="siteNavigation"|id="landingFooter"|cardDeveloper/);
    assert.match(landing, /\.\.\/participant-web\/invite\.html/);
    assert.match(
      read('web/assets/researcher-redesign.css'),
      /data-theme="dark"[^}]+#welcomeScreen \.ws-logo[\s\S]+background:\s*#f5f5ec/
    );
    assert.match(researcher, /aoi-protocol\.js/);
    assert.match(builder, /attachBlockAois\(out\.blockConfig, b\.content, out\.trials\)/);
    assert.match(builder, /aoiSchemaVersion/);
    assert.match(builder, /aoiDefinitions/);
    assert.match(builder, /currentStep === 4\) renderStep4Aoi\(\)/);
    assert.match(builder, /openAoiEditor\(stimulusId/);
    assert.doesNotMatch(builder, /currentStep === 4[^\n]+renderPlaceholder/);
  });

  it('uses working static participant links and bilingual standard stimuli', () => {
    const core = read('web/researcher-core.js');
    const experiments = read('web/researcher-experiments.js');
    const presets = read('web/cognitive-task-protocols.js');
    assert.match(core, /run_new\.html\?code=/);
    assert.doesNotMatch(core, /return \(window\.location\.origin \|\| ''\) \+ '\/invite\/'/);
    assert.match(experiments, /exp\?\.invitationCode \|\| apiState\.invitationCode \|\| ''/);
    assert.match(experiments, /!serverSyncComplete[\s\S]+!verifiedAt/);
    assert.doesNotMatch(experiments, /apiState\.invitationCode \|\| protocolId/);
    assert.match(experiments, /exp\?\.participantLink/);
    assert.match(read('web/researcher-builder.js'), /invitationCode: pub\.invitation\.code/);
    assert.match(presets, /nameEn/);
    assert.match(presets, /infoEn/);
    assert.match(presets, /Simple RT: black square/);
    assert.match(presets, /localizedStimulusName/);
    assert.match(presets, /WecogTemplateInstructionTranslations/);
    assert.match(read('participant-web/mvp_with_precheck_1-updated.html'), /cognitive-task-protocols\.js/);
    assert.match(read('web/researcher-builder.js'), /titleEn/);
    assert.match(read('web/researcher-builder.js'), /textEn/);
  });

  it('renders standard stimulus ids as visual content and exposes response controls', () => {
    const standard = require(path.join(root, 'shared/standard-stimuli.js'));
    assert.equal(standard.resolveStandardStimulus('std_flanker_left_incong').text, '>><>>');
    assert.equal(standard.resolveStandardStimulus('std_flanker_right_incong').text, '<<><<');
    assert.equal(
      standard.resolveStandardStimulus('std_cpt_k', { name: 'std_cpt_k' }).text,
      'K'
    );
    assert.equal(
      standard.resolveStandardStimulus('std_switch_4g', { name: 'std_switch_4g' }).text,
      '4G'
    );
    const runner = read('participant-web/js/web-page/experimental_task-updated.js');
    assert.match(runner, /responseGuidanceForBlock/);
    assert.match(runner, /runtime_response_pointer/);
    assert.match(runner, /Blue background: classify the number/);
    assert.match(runner, /nextBlock\?\.taskType/);
    assert.match(runner, /переключение задач/);
    assert.match(runner, /buildStandardInvitationTrials/);
    assert.match(runner, /std_switch_4g/);
    assert.doesNotMatch(runner, /\|\| block\?\.instructions\s*\|\|/);
    const ui = read('participant-web/js/web-page/ui-updated.js');
    assert.match(ui, /interface_language_changed/);
    assert.match(ui, /wecog:languagechange/);
    assert.match(runner, /refreshLocalizedInstructionScreen/);
    assert.match(runner, /captureSurveyDraft/);
    assert.match(read('participant-web/mvp_with_precheck_1-updated.html'), /standard-stimuli\.js\?v=20260914-1/);
  });

  it('exports task-specific defaults instead of silently replacing tasks with Simple RT', () => {
    const builder = read('web/researcher-builder.js');
    for (const stimulusId of [
      'std_stroop_red_red',
      'std_flanker_right_incong',
      'std_nback_circle',
      'std_pvt_counter',
      'std_cpt_a',
      'std_switch_4g',
    ]) {
      assert.match(builder, new RegExp(stimulusId));
    }
    assert.match(builder, /taskType === 'task_switching'/);
    assert.match(builder, /action: 'arrow_down'/);
  });

  it('supports secure researcher JSON result import without participant invitation reuse', () => {
    const analytics = read('web/researcher-analytics-production.js');
    const ingest = read('api/routes/ingest.js');
    assert.match(analytics, /analyticsResultImportFile/);
    assert.match(analytics, /buildAggregatesPayload\(source, \{ forIngest: true \}\)/);
    assert.match(analytics, /delete payload\.ids\.invitationCode/);
    assert.match(analytics, /Idempotency-Key/);
    assert.match(analytics, /\/sessions\/start/);
    assert.match(ingest, /return requireAuth\(req, res/);
    assert.match(ingest, /canRolePerform\(req\.user\?\.role, OPERATIONS\.SESSION_WRITE\)/);
  });

  it('renders real session quality, readable exclusions, and nested technical details', () => {
    const analytics = read('web/researcher-analytics-production.js');
    const router = read('api/analytics/v1-router.js');
    assert.match(analytics, /function dataQualityShellHtml/);
    assert.match(analytics, /activeTab === 'data-quality'/);
    assert.match(analytics, /Почему исключена/);
    assert.match(analytics, /face_occluded/);
    assert.match(analytics, /session\.cameraResolution/);
    assert.match(router, /function sessionTechnicalDetails/);
    assert.match(router, /payload\?\.meta\?\.tech/);
    assert.match(router, /quality: sessionQualityDetails\(row\)/);
  });

  it('rejects duplicate protocol identities instead of overwriting an existing protocol', () => {
    const source = read('web/researcher-core.js');
    const routes = read('api/routes/protocols_new.js');
    const migration = read('api/migrations/1699000000016_unique_protocol_identity.js');
    assert.doesNotMatch(source, /apiPatch\('\/protocols\/' \+ matching\.id/);
    assert.doesNotMatch(source, /apiGet\('\/protocols\?project_id=' \+ encodeURIComponent/);
    assert.match(source, /removeItem\(builderApiStateKey\('draft'\)\)/);
    assert.match(source, /\/invitations\?protocol_id=/);
    assert.match(routes, /protocol_id_conflict/);
    assert.match(migration, /protocols_project_protocol_id_unique/);
    assert.match(migration, /lower\(btrim\(definition->>'protocolId'\)\)/);
    assert.match(migration, /row_number\(\) OVER/);
    assert.match(migration, /'-legacy-'/);
  });

  it('exports and executes hidden timers, random intervals and optional fullscreen stimuli', () => {
    const builder = read('web/researcher-builder.js');
    const participant = read('participant-web/js/web-page/experimental_task-updated.js');
    assert.match(builder, /type:\s*'timer'/);
    assert.match(builder, /randomInterStimulus:/);
    assert.match(builder, /fullscreenStimulus:/);
    assert.match(builder, /analyticsPlan/);
    assert.match(participant, /protocolTimers/);
    assert.match(participant, /protocol_timer_started/);
    assert.match(participant, /randomPreStimulusMs/);
    assert.match(participant, /trial\?\.randomItiMin/);
    assert.match(participant, /trial\?\.fixationMin/);
    assert.match(participant, /trial\?\.iti/);
    assert.match(participant, /requestCognitiveFullscreen/);
  });

  it('keeps calibration, timed rest and audio-test flows recoverable and visible', () => {
    const calibration = read('participant-web/js/web-page/tests-updated.js');
    const participant = read('participant-web/js/web-page/experimental_task-updated.js');
    const translations = read('participant-web/translations.js');
    assert.match(calibration, /finishValidationSafely/);
    assert.match(calibration, /validation_calculation_failed/);
    assert.match(calibration, /validationResultMetrics/);
    assert.match(participant, /showTimedParticipantBlock\(block, 'rest'\)/);
    assert.match(participant, /role', 'timer'/);
    assert.match(participant, /showTimedParticipantBlock\(block, 'audio_test'\)/);
    assert.match(participant, /experimentMeta\.audioTests/);
    assert.match(participant, /flushBoundary/);
    assert.match(participant, /summarizeTaskWindows/);
    assert.match(translations, /Не моргайте в момент нажатия/);
    assert.match(translations, /Смотрите на каждый зелёный круг/);
    assert.match(translations, /Ничего не нажимайте/);
  });

  it('supports researcher project management and folder-level stimulus rename', () => {
    const core = read('web/researcher-core.js');
    const permissions = read('api/security/permissions.js');
    const projects = read('api/routes/projects.js');
    const stimuli = read('web/researcher-stimuli.js');
    assert.match(core, /openModal\('rename'/);
    assert.match(core, /apiPatch\('\/projects\/'/);
    assert.match(core, /apiDelete\('\/projects\/'/);
    assert.match(permissions, /OPERATIONS\.PROJECT_DELETE/);
    assert.match(projects, /requireRole\('admin', 'PI', 'researcher'\)/);
    assert.match(stimuli, /folder-stim-edit-btn/);
    assert.match(stimuli, /renameStimulusInLibrary\(button\.dataset\.id, null, renderFolderView\)/);
  });

  it('previews uploads before saving and exposes three distinct audio tasks', () => {
    const stimuli = read('web/researcher-stimuli.js');
    const builder = read('web/researcher-builder.js');
    assert.match(stimuli, /requestStimulusUploadDetails/);
    assert.match(stimuli, /Проверьте превью и названия/);
    assert.match(stimuli, /formData\.append\('name', customName\)/);
    assert.match(stimuli, /_previewObjectUrl: entry\.previewObjectUrl/);
    assert.match(builder, /type:'audio_reading'/);
    assert.match(builder, /type:'audio_sustained_vowel'/);
    assert.match(builder, /type:'audio_oral_ddk'/);
    assert.match(builder, /userBlocks\.some\(block => block\.type === 'audio_test'\)/);
    assert.match(stimuli, /await hydrateApiStimulusPreview\(stimulus\)/);
    assert.match(stimuli, /const mediaUrl = stimulusPreviewSource\(stimulus\)/);
    assert.match(builder, /stimulus\?\._previewObjectUrl \|\| stimulus\?\.url/);
  });

  it('locks analytics to the current project and exposes safe audio summaries', () => {
    const analytics = read('web/researcher-analytics-production.js');
    const router = read('api/analytics/v1-router.js');
    assert.match(analytics, /wecog:projectchange/);
    assert.match(analytics, /Текущий проект/);
    assert.match(analytics, /audioAnalyticsHtml/);
    assert.match(router, /function sessionAudioDetails/);
    assert.match(router, /rawAudioStored: false/);
    assert.match(router, /audio: sessionAudioDetails\(row, hydrated\.protocol\?\.definition\)/);
  });

  it('loads each stateful participant module through one cache version', () => {
    const app = read('participant-web/js/web-page/app-updated.js');
    const tests = read('participant-web/js/web-page/tests-updated.js');
    const task = read('participant-web/js/web-page/experimental_task-updated.js');
    const runtime = read('participant-web/js/session-runtime/index.js');
    for (const source of [app, tests, task, runtime]) {
      assert.doesNotMatch(source, /(ui-updated|tests-updated|experimental_task-updated|session-runtime\/index)\.js\?v=20260828-2/);
    }
    assert.match(tests, /ui-updated\.js\?v=20260914-1/);
    assert.match(app, /tests-updated\.js\?v=20260914-1/);
    assert.match(tests, /experimental_task-updated\.js\?v=20260914-1/);
    assert.match(task, /tests-updated\.js\?v=20260914-1/);
    assert.match(app, /session-runtime\/index\.js\?v=20260914-1/);
    assert.match(tests, /session-runtime\/index\.js\?v=20260914-1/);
    assert.match(task, /session-runtime\/index\.js\?v=20260914-1/);
    assert.match(runtime, /tests-updated\.js\?v=20260914-1/);
    assert.match(app, /protocol-invite-utils\.js\?v=20260914-1/);
    assert.match(tests, /protocol-invite-utils\.js\?v=20260914-1/);
    assert.match(task, /protocol-invite-utils\.js\?v=20260914-1/);
  });

  it('preloads participant media, keeps selected sessions inspectable, and restores editor data', () => {
    const participant = read('participant-web/js/web-page/app-updated.js');
    const calibration = read('participant-web/js/web-page/tests-updated.js');
    const analytics = read('web/researcher-analytics-production.js');
    const builder = read('web/researcher-builder.js');
    assert.match(participant, /preloadInvitationStimulus/);
    assert.match(participant, /URL\.createObjectURL\(blob\)/);
    assert.match(participant, /invitationStimulusObjectUrls/);
    assert.match(calibration, /const SAMPLES_PER_POINT = 60/);
    assert.match(calibration, /const SETTLE_DELAY_MS = 1000/);
    assert.match(analytics, /qcMode: sessionMode \? 'all' : state\.query\.qcMode/);
    assert.match(builder, /function normalizePersistedBuilderBlock/);
    assert.match(builder, /Array\.isArray\(block\.trials\) \? block\.trials/);
    assert.match(builder, /slides: Array\.isArray\(b\.content\?\.slides\) \? b\.content\.slides : \[\]/);
  });

  it('shows real stimulus previews and supports drag and drop with conversion progress', () => {
    const stimuli = read('web/researcher-stimuli.js');
    const builder = read('web/researcher-builder.js');
    const participant = read('participant-web/js/web-page/app-updated.js');
    const researcher = read('web/researcher.html');
    assert.match(stimuli, /function stimulusPreviewHtml/);
    assert.match(stimuli, /resolveStandardStimulus/);
    assert.match(stimuli, /wireStimulusDropzone/);
    assert.match(stimuli, /Preparing page/);
    assert.match(stimuli, /\/stimuli\/upload/);
    assert.match(stimuli, /delete copy\._previewObjectUrl/);
    assert.match(stimuli, /renameStimulusInLibrary/);
    assert.match(stimuli, /apiPatch\('\/stimuli\/'/);
    assert.match(builder, /handleFileUpload\(mediaFiles/);
    assert.match(builder, /convertDocumentToStimuli\(file/);
    assert.match(participant, /addTrialStimuli\(block\?\.trials\)/);
    assert.match(participant, /replace\(\/\^api:\//);
    assert.match(researcher, /shared\/standard-stimuli\.js/);
  });

  it('keeps new protocols, developer diagnostics, calibration, and navigation isolated', () => {
    const core = read('web/researcher-core.js');
    const developer = read('web/developer.html');
    const participant = read('participant-web/mvp_with_precheck_1-updated.html');
    const participantCss = read('participant-web/style.css');
    const researcher = read('web/researcher.html');
    const consent = read('participant-web/documents/informed-consent-v1.0.html');
    const privacy = read('participant-web/documents/privacy-policy-v1.0.html');
    assert.match(core, /isNewProtocol \? \{ forceCreate: true \}/);
    assert.match(core, /href==='#\/experiments\/builder'[\s\S]+startNewExperimentBuilder\(\)/);
    assert.doesNotMatch(developer, /run_new\.html\?code=test/);
    assert.match(developer, /developer_module=tracking/);
    assert.match(participant, /class="calibration-live-copy"/);
    assert.match(participantCss, /\.cognitive-session-active \.container/);
    assert.match(participantCss, /height: clamp\(520px, 72vh, 860px\)/);
    assert.match(researcher, /name="wecog-navigation-filter"/);
    assert.match(researcher, /data-1p-ignore="true"/);
    assert.doesNotMatch(consent, /АВТОЗАПОЛНЕНИЕ|<li>✅/);
    assert.doesNotMatch(privacy, /АВТОЗАПОЛНЕНИЕ|<li>[📄✏️🗑️⛔📤]/u);
  });

  it('keeps participant gaze prediction hidden and shows head guidance only on deviation', () => {
    const app = read('participant-web/js/web-page/app-updated.js');
    const visuospatial = read('participant-web/js/gaze-tracker/gaze-tests/visuospatial/runner.js');
    const headGuide = read('participant-web/js/gaze-tracker/head-pose-guide.js');
    assert.match(app, /const showGazeDot = false/);
    assert.doesNotMatch(visuospatial, /gazeDot\.style\.display = 'block'/);
    assert.match(headGuide, /currentDeviation\.status !== 'aligned'/);
  });

  it('does not route public respondents into staff UI or render API labels as HTML', () => {
    const login = read('web/developer/login.html');
    const experiments = read('web/developer/experiments.html');
    const stimuli = read('web/researcher-stimuli.js');
    assert.match(login, /destinationForRole\(role\)/);
    assert.match(login, /requestedPortal === 'researcher'/);
    assert.match(login, /requestedPortal === 'developer'/);
    assert.match(login, /requestedPortal === 'admin'/);
    assert.match(login, /result\.user\.role === 'respondent'/);
    assert.match(login, /Участники входят по коду или ссылке приглашения/);
    assert.doesNotMatch(login, /registerForm|Регистрация участника|regEmail|regPassword/);
    assert.match(experiments, /escapeHtml\(r\.experiment_title/);
    assert.match(experiments, /escapeHtml\(r\.participant_id/);
    assert.match(stimuli, /localizedStimulusName\(s\)/);
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
    assert.match(experiments, /escapeUiHtml\(participantLink\)/);
  });

  it('ships one local brand system across public, participant and developer surfaces', () => {
    const participant = read('participant-web/mvp_with_precheck_1-updated.html');
    const translations = read('participant-web/translations.js');
    const developerPages = [
      'web/developer/accounts.html',
      'web/developer/bpm-test.html',
      'web/developer/body-pose-test.html',
      'web/developer/audio-test.html',
      'web/developer/emotion-test.html',
      'web/developer/experiments.html',
      'web/developer/invite.html',
      'web/developer/login.html',
      'web/developer/rt-test.html',
    ];
    assert.match(read('web/index.html'), /assets\/wecog-foundation\.css/);
    assert.match(participant, /participant-redesign\.css/);
    assert.match(participant, /id="participantLanguageSelect"/);
    assert.match(translations, /participantLocales = \['ru', 'en', 'zh', 'es', 'hi', 'ar', 'fr', 'bn', 'pt', 'ur'\]/);
    assert.match(read('web/assets/wecog-mark.svg'), /A W-shaped gaze path with a focus point/);
    assert.match(read('web/assets/wecog-foundation.css'), /Atkinson Hyperlegible Next/);
    developerPages.forEach(file => {
      const html = read(file);
      assert.match(html, /wecog-foundation\.css/);
      assert.match(html, /developer-redesign\.css/);
      assert.match(html, /developer-shell\.js/);
      if (/\/(bpm-test|body-pose-test|audio-test|emotion-test|rt-test)\.html$/.test(file)) {
        assert.match(html, /auth-guard\.js/);
        assert.match(html, /allowedRoles:\s*\['admin', 'developer'\]/);
      } else if (file.endsWith('/accounts.html')) {
        assert.match(html, /allowedRoles:\s*\['admin', 'org_admin', 'PI'\]/);
      } else if (/\/(experiments|invite)\.html$/.test(file)) {
        assert.match(html, /allowedRoles:\s*\['admin'\]/);
      }
    });
  });

  it('keeps Spanish throughout pre-check and fails closed for uncertain biometrics', async () => {
    const translationsPath = path.join(root, 'participant-web/translations.js');
    const { translations } = await import(pathToFileURL(translationsPath).href + `?t=${Date.now()}`);
    assert.equal(translations.es.label_light, 'Iluminación');
    assert.equal(translations.es.label_visibility, 'Visibilidad del rostro');
    assert.equal(translations.es.status_needs_fix, 'Requiere corrección');
    assert.match(translations.es.precheck_criteria_help, /indicador/);
    for (const locale of ['ru', 'en', 'zh', 'es', 'hi', 'ar', 'fr', 'bn', 'pt', 'ur']) {
      assert.ok(translations[locale].runtime_continuous_start_failed);
      assert.ok(translations[locale].runtime_repeat_trials_title);
    }
    const participant = read('participant-web/mvp_with_precheck_1-updated.html');
    assert.match(participant, /data-i18n="precheck_criteria_help"/);
    const emotionApi = read('participant-web/js/emotion/public-api.js');
    assert.match(emotionApi, /emotionInferred:\s*false/);
    assert.doesNotMatch(emotionApi, /dominant:\s*valence\s*>/);
    const bpmRuntime = read('participant-web/js/session-runtime/continuous-bpm.js');
    assert.doesNotMatch(bpmRuntime, /bpmPublished \?\? output\.bpmSmoothed/);
    assert.match(bpmRuntime, /publicationGate\.evaluate\(output\)/);
    assert.doesNotMatch(read('web/developer/bpm-test.js'), /FallbackEngine/);
  });

  it('keeps browser errors inert and static pages protected from hostile framing', () => {
    const analytics = read('web/researcher-analytics.js');
    const bpm = read('web/developer/bpm-test.js');
    const nginx = read('../deploy/nginx-participant-media.conf');
    assert.doesNotMatch(analytics, /innerHTML\s*=\s*['"`][^\n]*e\.message/);
    assert.doesNotMatch(bpm, /innerHTML\s*=\s*['"`][^\n]*err\.message/);
    assert.match(analytics, /message\.textContent\s*=/);
    assert.match(bpm, /errorLine\.textContent\s*=/);
    assert.match(nginx, /location \^~ \/apps\/participant-web\/[\s\S]+frame-ancestors 'self'/);
    assert.match(nginx, /location \^~ \/apps\/web\/[\s\S]+camera=\(\), microphone=\(\)/);
    assert.match(nginx, /X-Frame-Options "SAMEORIGIN"/);
  });
});
