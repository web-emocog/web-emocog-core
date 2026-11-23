/* Response requirements are independent of whether a response was recorded. */
(function (root) {
  'use strict';
  const passive = trial => trial?.responseMode === 'none'
    || (trial?.task_id ?? trial?.taskType) === 'passive_viewing';
  const noGo = trial => !passive(trial) && /(?:^|[_ -])no[_ -]?go(?:$|[_ -])/i.test(String(trial?.condition || ''));
  function responseRequired(trial) {
    if (passive(trial) || noGo(trial)) return false;
    // Explicit null means withholding; absent metadata retains legacy RT semantics.
    return !Object.hasOwn(trial || {}, 'expectedResponse') || trial.expectedResponse != null;
  }
  const api = Object.freeze({ passive, noGo, responseRequired });
  root.WecogTaskResponses = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
