const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const contract = require('../../shared/survey-contract');
const { normalizeSurveyResponses } = require('../export/survey-responses');
const { validateSessionFeaturePayload } = require('../security/payload-policy');

const root = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function validSurveyBlock(id = 'survey_1') {
  return {
    id,
    type: 'survey',
    content: {
      title: 'После блока',
      questions: [
        { id: 'q_open', text: 'Что вы заметили?', type: 'open', required: false },
        {
          id: 'q_single',
          text: 'Выберите один вариант',
          type: 'single',
          required: true,
          options: [
            { id: 'yes', label: 'Да' },
            { id: 'no', label: 'Нет' },
          ],
        },
        {
          id: 'q_multiple',
          text: 'Выберите несколько вариантов',
          type: 'multiple',
          required: false,
          options: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
      ],
    },
  };
}

describe('protocol survey contract', () => {
  it('keeps authored locale variants separate and reports missing translations', () => {
    const source = {
      title: 'Опрос',
      titleEn: 'Survey',
      description: 'Описание',
      descriptionEn: 'Description',
      questions: [{
        id: 'q1', text: 'Работает?', textEn: 'Does it work?', type: 'single', required: true,
        options: [
          { id: 'yes', label: 'Да', labelEn: 'Yes' },
          { id: 'no', label: 'Нет', labelEn: 'No' },
        ],
      }],
    };
    const localized = contract.localizeSurveyContent(source, 'en');
    assert.equal(localized.ok, true);
    assert.equal(localized.survey.title, 'Survey');
    assert.equal(localized.survey.questions[0].text, 'Does it work?');
    assert.deepEqual(localized.survey.questions[0].options.map(option => option.label), ['Yes', 'No']);

    delete source.questions[0].textEn;
    const missing = contract.localizeSurveyContent(source, 'en');
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.missing, ['questions.0.text']);
  });
  it('normalizes the three supported answer types and required state', () => {
    const result = contract.validateSurveyContent(validSurveyBlock().content);
    assert.equal(result.ok, true);
    assert.deepEqual(result.survey.questions.map(question => question.type), [
      'open',
      'single',
      'multiple',
    ]);
    assert.equal(result.survey.questions[1].required, true);
  });

  it('allows multiple surveys after shell consent', () => {
    const result = contract.validateProtocolSurveyBlocks({
      participantShell: { consent: true },
      blocks: [
        validSurveyBlock('survey_before'),
        { id: 'instruction_1', type: 'instruction' },
        { id: 'task_1', type: 'cognitive_task' },
        validSurveyBlock('survey_after'),
      ],
    });
    assert.equal(result.ok, true);
  });

  it('rejects surveys without prior consent or inside an instruction-task pair', () => {
    const withoutConsent = contract.validateProtocolSurveyBlocks({
      participantShell: { consent: false },
      blocks: [validSurveyBlock()],
    });
    assert.equal(withoutConsent.ok, false);
    assert.ok(withoutConsent.errors.some(error => error.code === 'survey_requires_prior_consent'));

    const splitPair = contract.validateProtocolSurveyBlocks({
      participantShell: { consent: true },
      blocks: [
        { id: 'instruction_1', type: 'instruction' },
        validSurveyBlock(),
        { id: 'task_1', type: 'cognitive_task' },
      ],
    });
    assert.equal(splitPair.ok, false);
    assert.ok(splitPair.errors.some(error => error.code === 'survey_splits_instruction_and_task'));

    const splitSetupSequence = contract.validateProtocolSurveyBlocks({
      participantShell: { consent: true },
      blocks: [
        { id: 'instruction_2', type: 'instructions' },
        { id: 'fixation_2', type: 'fixation' },
        validSurveyBlock(),
        { id: 'task_2', type: 'cognitive_task' },
      ],
    });
    assert.equal(splitSetupSequence.ok, false);
    assert.ok(splitSetupSequence.errors.some(
      error => error.code === 'survey_splits_instruction_and_task'
    ));
  });

  it('keeps typed responses in ingest and exposes them in exports', () => {
    const event = {
      schemaVersion: 'session_event.v1',
      eventId: 'survey-event-1',
      type: 'survey_response',
      category: 'block',
      severity: 'info',
      timestamp: Date.now(),
      tRelMs: 1200,
      blockId: 'survey_1',
      responseVersion: 'survey_response.v1',
      durationMs: 900,
      responses: [
        { questionId: 'q_open', responseType: 'open', value: 'Спокойно' },
        { questionId: 'q_multiple', responseType: 'multiple', value: ['a', 'b'] },
      ],
    };
    const payload = {
      schemaVersion: 'session_feature.v1',
      ids: { session: 'S-SURVEY-1', participant: 'P-SURVEY-1' },
      lifecycle: {
        schemaVersion: 'session_lifecycle.v1',
        state: 'running',
        status: 'in_progress',
      },
      events: [event],
    };

    assert.deepEqual(validateSessionFeaturePayload(payload), []);
    assert.deepEqual(normalizeSurveyResponses(payload), [{
      response_version: 'survey_response.v1',
      block_id: 'survey_1',
      duration_ms: 900,
      responses: [
        { question_id: 'q_open', response_type: 'open', value: 'Спокойно' },
        { question_id: 'q_multiple', response_type: 'multiple', value: ['a', 'b'] },
      ],
    }]);

    payload.events[0].responses[0].value = 'person@example.org';
    assert.ok(validateSessionFeaturePayload(payload).some(error => error.keyword === 'pii'));
  });

  it('retains an early survey response in a long session event log', async () => {
    const aggregateModule = path.join(
      root,
      'participant-web/js/unified-aggregates-new.js'
    );
    const { trimEventsForIngest } = await import(pathToFileURL(aggregateModule).href);
    const events = Array.from({ length: 320 }, (_, index) => ({
      schemaVersion: 'session_event.v1',
      eventId: `event-${index}`,
      type: index === 5 ? 'survey_response' : 'phase_change',
      category: index === 5 ? 'block' : 'lifecycle',
      severity: 'info',
      timestamp: index,
      responses: index === 5
        ? [{ questionId: 'q1', responseType: 'open', value: 'Ответ' }]
        : undefined,
    }));

    const retained = trimEventsForIngest(events);
    assert.equal(retained.length, 250);
    assert.ok(retained.some(event => event.type === 'survey_response'));
    assert.equal(retained.at(-1).eventId, 'event-319');
  });

  it('rejects incomplete choices and direct contact identifiers', () => {
    const invalid = contract.validateSurveyContent({
      title: 'Bad survey',
      questions: [{ text: 'Choose', type: 'single', options: ['Only one'] }],
    });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some(error => error.code === 'survey_options_minimum'));
    assert.equal(contract.containsForbiddenPiiValue('person@example.org'), true);
    assert.equal(contract.containsForbiddenPiiValue('+7 999 123-45-67'), true);
    assert.equal(contract.containsForbiddenPiiValue('Мне было спокойно'), false);

    const oversized = validSurveyBlock().content;
    oversized.questions[1].options = Array.from(
      { length: contract.LIMITS.maxOptionsPerQuestion + 1 },
      (_, index) => ({ id: `option_${index}`, label: `Option ${index}` })
    );
    oversized.unexpected = true;
    const oversizedResult = contract.validateSurveyContent(oversized);
    assert.equal(oversizedResult.ok, false);
    assert.ok(oversizedResult.errors.some(error => error.code === 'survey_options_too_many'));
    assert.ok(oversizedResult.errors.some(error => error.code === 'survey_unknown_field'));
  });
});

describe('survey browser integration contract', () => {
  it('ships the contract to researcher and participant and preserves survey responses for ingest', () => {
    const researcher = read('web/researcher.html');
    const participant = read('participant-web/mvp_with_precheck_1-updated.html');
    const builder = read('web/researcher-builder.js');
    const runner = read('participant-web/js/web-page/experimental_task-updated.js');
    const inviteUtils = read('participant-web/js/web-page/protocol-invite-utils.js');
    const apiRoute = read('api/routes/protocols_new.js');

    assert.match(researcher, /shared\/survey-contract\.js/);
    assert.match(participant, /shared\/survey-contract\.js/);
    assert.match(builder, /type:'survey'/);
    assert.match(builder, /survey-add-question/);
    assert.match(builder, /survey-question-required/);
    assert.match(runner, /showSurvey\(block\)/);
    assert.match(runner, /recordSessionEvent\('survey_response'/);
    assert.match(runner, /category:\s*'block'/);
    assert.match(inviteUtils, /'survey'/);
    assert.match(apiRoute, /rejectInvalidSurveys/);
    assert.match(read('api/routes/export.js'), /survey_responses/);
  });

  it('keeps calibration clean and instructions actionable', () => {
    const landing = read('web/index.html');
    const participant = read('participant-web/mvp_with_precheck_1-updated.html');
    const participantCss = read('participant-web/style.css');
    const runner = read('participant-web/js/web-page/experimental_task-updated.js');
    const calibration = read('participant-web/js/web-page/tests-updated.js');

    assert.match(
      landing,
      /aria-label="Понимать реакцию точнее\.\.\."[\s\S]*?<span class="hero-line">Понимать<\/span>[\s\S]*?<span class="hero-line">реакцию<\/span>[\s\S]*?<span class="hero-line hero-accent">точнее\.\.\.<\/span>/
    );
    assert.match(participant, /id="calibrationIntro"/);
    assert.match(calibration, /calibration_instruction_acknowledged/);
    assert.doesNotMatch(participantCss, /fullscreen-calib-point[\s\S]{0,500}transition:\s*all/);
    assert.match(runner, /if \(checkContainer\) checkContainer\.style\.display = 'none';[\s\S]+btn\.disabled = false;/);
  });
});
