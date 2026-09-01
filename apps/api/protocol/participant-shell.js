const MANDATORY_PARTICIPANT_SHELL = Object.freeze({
  consent: true,
  questionnaire: true,
  precheck: true,
  calibration: true,
});

function normalizeMandatoryParticipantShell(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return definition;
  }
  return {
    ...definition,
    participantShell: { ...MANDATORY_PARTICIPANT_SHELL },
  };
}

module.exports = {
  MANDATORY_PARTICIPANT_SHELL,
  normalizeMandatoryParticipantShell,
};
