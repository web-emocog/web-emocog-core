const RESPONSE_VERSION = 'survey_response.v1';

function normalizeSurveyResponses(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  return events
    .filter(event => event && event.type === 'survey_response')
    .map((event) => ({
      response_version: event.responseVersion || RESPONSE_VERSION,
      block_id: event.blockId || null,
      duration_ms: Number.isFinite(event.durationMs) ? event.durationMs : null,
      responses: Array.isArray(event.responses)
        ? event.responses.map(response => ({
          question_id: response?.questionId || null,
          response_type: response?.responseType || null,
          value: response?.value ?? null,
        }))
        : [],
    }));
}

module.exports = {
  RESPONSE_VERSION,
  normalizeSurveyResponses,
};
