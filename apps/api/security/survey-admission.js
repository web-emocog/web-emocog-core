const { RESPONSE_VERSION, normalizeSurveyContent, containsForbiddenPiiValue } = require('../../shared/survey-contract');
const { HttpError } = require('./http-error');

function assertPublishedSurveyResponses(events, definition) {
  const seen = new Set();
  for (const event of events || []) {
    if (event.type !== 'survey_response') continue;
    const reject = () => { throw new HttpError(422, 'Survey answers do not match the published survey', 'survey_response_not_declared'); };
    const block = definition?.blocks?.find?.(row => row.type === 'survey' && String(row.id) === String(event.blockId));
    if (!block || event.responseVersion !== RESPONSE_VERSION || seen.has(String(block.id)) || !Array.isArray(event.responses)
      || (event.responseCount !== undefined && event.responseCount !== event.responses.length)) reject();
    seen.add(String(block.id));
    const questions = normalizeSurveyContent(block.content || block.params || {}).questions;
    const unanswered = new Set(questions.filter(question => question.required).map(question => question.id));
    const responses = new Set();
    for (const answer of event.responses) {
      const question = questions.find(row => row.id === answer?.questionId);
      if (!question || answer.responseType !== question.type || responses.has(question.id)) reject();
      responses.add(question.id);
      const value = answer.value;
      if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
      const allowed = new Set(question.options?.map(option => option.id));
      if (question.type === 'open' ? typeof value !== 'string' || containsForbiddenPiiValue(value)
        : question.type === 'single' ? typeof value !== 'string' || !allowed.has(value)
          : !Array.isArray(value) || new Set(value).size !== value.length || value.some(id => !allowed.has(id))) reject();
      unanswered.delete(question.id);
    }
    if (unanswered.size) reject();
  }
}

module.exports = { assertPublishedSurveyResponses };
