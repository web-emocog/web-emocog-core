(function initSurveyContract(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WecogSurveyContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildSurveyContract() {
  'use strict';

  const VERSION = 'protocol_survey.v1';
  const RESPONSE_VERSION = 'survey_response.v1';
  const QUESTION_TYPES = Object.freeze(['open', 'single', 'multiple']);
  const LOCALE_SUFFIXES = Object.freeze({
    ru: 'Ru', en: 'En', zh: 'Zh', es: 'Es', hi: 'Hi',
    ar: 'Ar', fr: 'Fr', bn: 'Bn', pt: 'Pt', ur: 'Ur'
  });
  const LIMITS = Object.freeze({
    maxSurveys: 100,
    maxQuestionsPerSurvey: 200,
    maxOptionsPerQuestion: 100,
    maxTitleLength: 200,
    maxDescriptionLength: 1000,
    maxQuestionLength: 1000,
    maxOptionLength: 500,
    maxOpenAnswerLength: 2000
  });
  const localizedFields = (fields) => Object.values(LOCALE_SUFFIXES)
    .flatMap(suffix => fields.map(field => `${field}${suffix}`));
  const SURVEY_FIELDS = new Set([
    'schemaVersion', 'title', 'description', 'submitButtonText', 'buttonText', 'questions',
    ...localizedFields(['title', 'description', 'submitButtonText'])
  ]);
  const QUESTION_FIELDS = new Set([
    'id', 'text', 'label', 'type', 'required', 'options',
    ...localizedFields(['text'])
  ]);
  const OPTION_FIELDS = new Set(['id', 'label', ...localizedFields(['label'])]);

  function text(value, maxLength) {
    return String(value == null ? '' : value).trim().slice(0, maxLength);
  }

  function safeId(value, fallback) {
    const normalized = String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 96);
    return normalized || fallback;
  }

  function copyLocalizedText(source, target, fields, limits) {
    Object.values(LOCALE_SUFFIXES).forEach((suffix) => {
      fields.forEach((field) => {
        const key = `${field}${suffix}`;
        if (source[key] == null) return;
        target[key] = text(source[key], limits[field]);
      });
    });
    return target;
  }

  function normalizeQuestionType(value) {
    const type = String(value || '').toLowerCase();
    if (type === 'text' || type === 'textarea' || type === 'open_text') return 'open';
    return QUESTION_TYPES.includes(type) ? type : 'open';
  }

  function normalizeOption(option, index, questionId) {
    const source = option && typeof option === 'object' ? option : { label: option };
    return copyLocalizedText(source, {
      id: safeId(source.id, `${questionId}_option_${index + 1}`),
      label: text(source.label, LIMITS.maxOptionLength)
    }, ['label'], { label: LIMITS.maxOptionLength });
  }

  function normalizeQuestion(question, index) {
    const source = question && typeof question === 'object' ? question : {};
    const id = safeId(source.id, `question_${index + 1}`);
    const type = normalizeQuestionType(source.type);
    const options = type === 'open'
      ? []
      : (Array.isArray(source.options) ? source.options : [])
        .slice(0, LIMITS.maxOptionsPerQuestion)
        .map((option, optionIndex) => normalizeOption(option, optionIndex, id));
    return copyLocalizedText(source, {
      id,
      text: text(source.text || source.label, LIMITS.maxQuestionLength),
      type,
      required: source.required === true,
      options
    }, ['text'], { text: LIMITS.maxQuestionLength });
  }

  function normalizeSurveyContent(content) {
    const source = content && typeof content === 'object' ? content : {};
    return copyLocalizedText(source, {
      schemaVersion: VERSION,
      title: text(source.title || 'Опрос', LIMITS.maxTitleLength),
      description: text(source.description, LIMITS.maxDescriptionLength),
      submitButtonText: text(source.submitButtonText || source.buttonText || 'Продолжить', 80),
      questions: (Array.isArray(source.questions) ? source.questions : [])
        .slice(0, LIMITS.maxQuestionsPerSurvey)
        .map(normalizeQuestion)
    }, ['title', 'description', 'submitButtonText'], {
      title: LIMITS.maxTitleLength,
      description: LIMITS.maxDescriptionLength,
      submitButtonText: 80
    });
  }

  function localizedValue(source, field, locale) {
    const suffix = LOCALE_SUFFIXES[locale] || LOCALE_SUFFIXES.en;
    if (locale === 'ru') return source[`${field}${suffix}`] || source[field] || '';
    return source[`${field}${suffix}`] || '';
  }

  function localizeSurveyContent(content, locale) {
    const source = normalizeSurveyContent(content);
    const normalizedLocale = LOCALE_SUFFIXES[locale] ? locale : 'en';
    const missing = [];
    const requiredValue = (object, field, path) => {
      const value = localizedValue(object, field, normalizedLocale);
      if (normalizedLocale !== 'ru' && !value) missing.push(path);
      return value;
    };
    const survey = {
      schemaVersion: VERSION,
      title: requiredValue(source, 'title', 'title'),
      description: localizedValue(source, 'description', normalizedLocale),
      submitButtonText: localizedValue(source, 'submitButtonText', normalizedLocale),
      questions: source.questions.map((question, questionIndex) => ({
        id: question.id,
        text: requiredValue(question, 'text', `questions.${questionIndex}.text`),
        type: question.type,
        required: question.required,
        options: question.options.map((option, optionIndex) => ({
          id: option.id,
          label: requiredValue(
            option,
            'label',
            `questions.${questionIndex}.options.${optionIndex}.label`
          )
        }))
      }))
    };
    return { survey, missing, locale: normalizedLocale, ok: missing.length === 0 };
  }

  function validateSurveyContent(content) {
    const survey = normalizeSurveyContent(content);
    const errors = [];
    const source = content && typeof content === 'object' && !Array.isArray(content)
      ? content
      : null;
    if (!source) errors.push({ code: 'survey_content_invalid' });
    if (source) {
      Object.keys(source).forEach((field) => {
        if (!SURVEY_FIELDS.has(field)) errors.push({ code: 'survey_unknown_field', field });
      });
      if (source.schemaVersion != null && source.schemaVersion !== VERSION) {
        errors.push({ code: 'survey_schema_version_invalid' });
      }
      [
        ['title', LIMITS.maxTitleLength],
        ['description', LIMITS.maxDescriptionLength],
        ['submitButtonText', 80],
        ['buttonText', 80]
      ].forEach(([field, maxLength]) => {
        if (source[field] != null && (
          typeof source[field] !== 'string' || source[field].length > maxLength
        )) {
          errors.push({ code: 'survey_field_invalid', field, maxLength });
        }
      });
      Object.values(LOCALE_SUFFIXES).forEach((suffix) => {
        [
          ['title', LIMITS.maxTitleLength],
          ['description', LIMITS.maxDescriptionLength],
          ['submitButtonText', 80]
        ].forEach(([field, maxLength]) => {
          const key = `${field}${suffix}`;
          if (source[key] != null && (
            typeof source[key] !== 'string' || source[key].length > maxLength
          )) errors.push({ code: 'survey_field_invalid', field: key, maxLength });
        });
      });
      if (!Array.isArray(source.questions)) errors.push({ code: 'survey_questions_invalid' });
    }
    if (!survey.title) errors.push({ code: 'survey_title_required' });
    if (!survey.questions.length) errors.push({ code: 'survey_question_required' });
    if (Array.isArray(content?.questions) && content.questions.length > LIMITS.maxQuestionsPerSurvey) {
      errors.push({ code: 'survey_too_many_questions' });
    }

    const questionIds = new Set();
    survey.questions.forEach((question, questionIndex) => {
      const sourceQuestion = source?.questions?.[questionIndex];
      if (!sourceQuestion || typeof sourceQuestion !== 'object' || Array.isArray(sourceQuestion)) {
        errors.push({ code: 'survey_question_invalid', questionIndex });
      } else {
        Object.keys(sourceQuestion).forEach((field) => {
          if (!QUESTION_FIELDS.has(field)) {
            errors.push({ code: 'survey_question_unknown_field', questionIndex, field });
          }
        });
        const rawQuestionText = sourceQuestion.text ?? sourceQuestion.label;
        if (rawQuestionText != null && (
          typeof rawQuestionText !== 'string'
          || rawQuestionText.length > LIMITS.maxQuestionLength
        )) {
          errors.push({
            code: 'survey_question_text_invalid',
            questionIndex,
            maxLength: LIMITS.maxQuestionLength
          });
        }
        Object.values(LOCALE_SUFFIXES).forEach((suffix) => {
          const key = `text${suffix}`;
          if (sourceQuestion[key] != null && (
            typeof sourceQuestion[key] !== 'string'
            || sourceQuestion[key].length > LIMITS.maxQuestionLength
          )) errors.push({
            code: 'survey_question_text_invalid',
            questionIndex,
            field: key,
            maxLength: LIMITS.maxQuestionLength
          });
        });
        if (
          sourceQuestion.type != null
          && !QUESTION_TYPES.includes(String(sourceQuestion.type).toLowerCase())
        ) {
          errors.push({ code: 'survey_question_type_invalid', questionIndex });
        }
        if (sourceQuestion.required != null && typeof sourceQuestion.required !== 'boolean') {
          errors.push({ code: 'survey_question_required_invalid', questionIndex });
        }
        if (
          question.type !== 'open'
          && Array.isArray(sourceQuestion.options)
          && sourceQuestion.options.length > LIMITS.maxOptionsPerQuestion
        ) {
          errors.push({ code: 'survey_options_too_many', questionIndex });
        }
      }
      if (!question.text) errors.push({ code: 'survey_question_text_required', questionIndex });
      if (questionIds.has(question.id)) {
        errors.push({ code: 'survey_question_id_duplicate', questionIndex });
      }
      questionIds.add(question.id);
      if (question.type === 'open') return;
      if (question.options.length < 2) {
        errors.push({ code: 'survey_options_minimum', questionIndex });
      }
      const optionIds = new Set();
      question.options.forEach((option, optionIndex) => {
        const sourceOption = sourceQuestion?.options?.[optionIndex];
        if (sourceOption && typeof sourceOption === 'object' && !Array.isArray(sourceOption)) {
          Object.keys(sourceOption).forEach((field) => {
            if (!OPTION_FIELDS.has(field)) {
              errors.push({
                code: 'survey_option_unknown_field',
                questionIndex,
                optionIndex,
                field
              });
            }
          });
          if (
            sourceOption.label != null
            && (
              typeof sourceOption.label !== 'string'
              || sourceOption.label.length > LIMITS.maxOptionLength
            )
          ) {
            errors.push({
              code: 'survey_option_text_invalid',
              questionIndex,
              optionIndex,
              maxLength: LIMITS.maxOptionLength
            });
          }
          Object.values(LOCALE_SUFFIXES).forEach((suffix) => {
            const key = `label${suffix}`;
            if (sourceOption[key] != null && (
              typeof sourceOption[key] !== 'string'
              || sourceOption[key].length > LIMITS.maxOptionLength
            )) errors.push({
              code: 'survey_option_text_invalid',
              questionIndex,
              optionIndex,
              field: key,
              maxLength: LIMITS.maxOptionLength
            });
          });
        } else if (
          sourceOption != null
          && (
            typeof sourceOption !== 'string'
            || sourceOption.length > LIMITS.maxOptionLength
          )
        ) {
          errors.push({
            code: 'survey_option_text_invalid',
            questionIndex,
            optionIndex,
            maxLength: LIMITS.maxOptionLength
          });
        }
        if (!option.label) {
          errors.push({ code: 'survey_option_text_required', questionIndex, optionIndex });
        }
        if (optionIds.has(option.id)) {
          errors.push({ code: 'survey_option_id_duplicate', questionIndex, optionIndex });
        }
        optionIds.add(option.id);
      });
    });
    return { ok: errors.length === 0, errors, survey };
  }

  function isTaskType(type) {
    return ['cognitive_task', 'stimuli', 'passive'].includes(String(type || '').toLowerCase());
  }

  function isInstructionType(type) {
    return ['instruction', 'instructions'].includes(String(type || '').toLowerCase());
  }

  function isProtectedInstructionBoundary(blocks, insertIndex) {
    const list = Array.isArray(blocks) ? blocks : [];
    if (insertIndex <= 0 || insertIndex >= list.length) return false;

    // Fixation/rest setup blocks may sit between an instruction and its task.
    // A survey must not split that whole protected sequence, not just two
    // immediately adjacent blocks.
    let instructionIndex = -1;
    for (let index = insertIndex - 1; index >= 0; index -= 1) {
      const type = list[index]?.type;
      if (isTaskType(type)) return false;
      if (isInstructionType(type)) {
        instructionIndex = index;
        break;
      }
    }
    if (instructionIndex < 0) return false;
    for (let index = insertIndex; index < list.length; index += 1) {
      const type = list[index]?.type;
      if (isInstructionType(type)) return false;
      if (isTaskType(type)) return true;
    }
    return false;
  }

  function surveySplitsInstructionAndTask(blocks, surveyIndex) {
    const list = Array.isArray(blocks) ? blocks : [];
    if (surveyIndex <= 0 || surveyIndex >= list.length - 1) return false;
    const withoutSurvey = list.filter((_, index) => index !== surveyIndex);
    return isProtectedInstructionBoundary(withoutSurvey, surveyIndex);
  }

  function validateProtocolSurveyBlocks(definition) {
    const blocks = Array.isArray(definition?.blocks) ? definition.blocks : [];
    const errors = [];
    const surveyIndexes = [];
    blocks.forEach((block, index) => {
      if (String(block?.type || '').toLowerCase() === 'survey') surveyIndexes.push(index);
    });
    if (surveyIndexes.length > LIMITS.maxSurveys) {
      errors.push({ code: 'protocol_too_many_surveys' });
    }
    const shellConsent = definition?.participantShell?.consent === true;
    const consentIndex = blocks.findIndex((block) => String(block?.type || '').toLowerCase() === 'consent');
    surveyIndexes.forEach((index) => {
      if (!shellConsent && (consentIndex < 0 || consentIndex >= index)) {
        errors.push({ code: 'survey_requires_prior_consent', blockIndex: index });
      }
      if (surveySplitsInstructionAndTask(blocks, index)) {
        errors.push({ code: 'survey_splits_instruction_and_task', blockIndex: index });
      }
      const result = validateSurveyContent(blocks[index]?.content || blocks[index]?.params || {});
      result.errors.forEach((error) => errors.push({ ...error, blockIndex: index }));
    });
    return { ok: errors.length === 0, errors };
  }

  function containsForbiddenPiiValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
    const phone = /^\s*\+?(?:\d[\s().-]*){10,15}\s*$/;
    return email.test(raw) || phone.test(raw);
  }

  return Object.freeze({
    VERSION,
    RESPONSE_VERSION,
    QUESTION_TYPES,
    LOCALE_SUFFIXES,
    LIMITS,
    normalizeQuestionType,
    normalizeSurveyContent,
    localizeSurveyContent,
    validateSurveyContent,
    validateProtocolSurveyBlocks,
    isProtectedInstructionBoundary,
    surveySplitsInstructionAndTask,
    containsForbiddenPiiValue
  });
});
