/**
 * Protocol Runner (Фаза 4.4). Выполнение протокола по JSON: текущий блок → экран/действие → переход.
 * Блоки: instruction, consent, questionnaire, calibration, stimuli, rest, baseline, recovery, final.
 * Исходные файлы не удаляем.
 */
(function (global) {
  'use strict';

  var state = {
    invitation: null,
    definition: null,
    blockIndex: 0,
    run_log: [],
    started_at: null,
    answers: {},
    restStart: null,
    restDuration: 0,
  };

  function getApiBase() {
    if (window.location && window.location.origin) {
      return window.location.origin + '/api';
    }
    return '';
  }

  /**
   * Загрузить протокол по коду приглашения (GET /invitations/by-code/:code).
   */
  function loadByCode(code) {
    var base = (getApiBase() || '').replace(/\/$/, '');
    if (!base) return Promise.reject(new Error('API base is not configured'));
    var url = base + '/invitations/by-code/' + encodeURIComponent(code);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
      return r.json();
    }).then(function (data) {
      state.invitation = data;
      state.definition = data.definition || { blocks: [] };
      state.blockIndex = 0;
      state.run_log = [];
      state.started_at = new Date().toISOString();
      state.answers = {};
      return state.definition;
    });
  }

  function getCurrentBlock() {
    var blocks = (state.definition && state.definition.blocks) || [];
    return blocks[state.blockIndex] || null;
  }

  function getBlockParams(block) {
    return (block && block.params) || {};
  }

  function advanceBlock() {
    var blocks = (state.definition && state.definition.blocks) || [];
    state.run_log.push({
      block_index: state.blockIndex,
      block_type: blocks[state.blockIndex] && blocks[state.blockIndex].type,
      completed_at: new Date().toISOString(),
    });
    state.blockIndex++;
    return getCurrentBlock();
  }

  function recordAnswers(answers) {
    state.answers = Object.assign({}, state.answers, answers);
  }

  function getRunLog() {
    return {
      invitation_id: state.invitation && state.invitation.invitation_id,
      code: state.invitation && state.invitation.code,
      protocol_id: state.invitation && state.invitation.protocol_id,
      protocol_name: state.invitation && state.invitation.protocol_name,
      started_at: state.started_at,
      finished_at: new Date().toISOString(),
      run_log: state.run_log,
      answers: state.answers,
    };
  }

  function renderInstruction(block, container, onNext) {
    var params = getBlockParams(block);
    var title = params.title || 'Instruction';
    var text = params.text || 'Please read the instructions and click Next to continue.';
    container.innerHTML = '<div class="protocol-block instruction">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p class="protocol-text">' + escapeHtml(text).replace(/\n/g, '<br>') + '</p>' +
      '<button type="button" class="btn protocol-next">Next</button></div>';
    container.querySelector('.protocol-next').addEventListener('click', onNext);
  }

  function renderConsent(block, container, onNext) {
    var params = getBlockParams(block);
    var title = params.title || 'Informed consent';
    var text = params.text || 'I have read the information and agree to participate.';
    container.innerHTML = '<div class="protocol-block consent">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<label class="checkbox-wrapper"><input type="checkbox" id="protocolConsentCheck">' +
      '<span>' + escapeHtml(text) + '</span></label>' +
      '<button type="button" class="btn protocol-next" id="protocolConsentBtn" disabled>Confirm and continue</button></div>';
    var check = container.querySelector('#protocolConsentCheck');
    var btn = container.querySelector('#protocolConsentBtn');
    check.addEventListener('change', function () { btn.disabled = !check.checked; });
    btn.addEventListener('click', onNext);
  }

  function renderQuestionnaire(block, container, onNext) {
    var params = getBlockParams(block);
    var config = params.config || [];
    var html = '<div class="protocol-block questionnaire"><h2>Questionnaire</h2><form id="protocolQuestionnaireForm">';
    config.forEach(function (field, i) {
      var id = 'q_' + i;
      var label = field.label || field.name || 'Q' + (i + 1);
      var required = field.required ? ' required' : '';
      if (field.type === 'text') {
        html += '<div class="form-group"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
          '<input type="text" id="' + id + '" name="' + (field.name || id) + '"' + required + '></div>';
      } else if (field.type === 'number') {
        html += '<div class="form-group"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
          '<input type="number" id="' + id + '" name="' + (field.name || id) + '"' + required + '></div>';
      } else if (field.type === 'scale') {
        var min = field.min != null ? field.min : 1;
        var max = field.max != null ? field.max : 10;
        html += '<div class="form-group"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
          '<input type="range" id="' + id + '" name="' + (field.name || id) + '" min="' + min + '" max="' + max + '" value="' + min + '">' +
          '<span class="scale-value" id="' + id + '_val">' + min + '</span></div>';
      } else {
        html += '<div class="form-group"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
          '<input type="text" id="' + id + '" name="' + (field.name || id) + '"' + required + '></div>';
      }
    });
    html += '<button type="submit" class="btn protocol-next">Submit</button></form></div>';
    container.innerHTML = html;
    container.querySelectorAll('input[type="range"]').forEach(function (range) {
      var valEl = document.getElementById(range.id + '_val');
      if (valEl) {
        range.addEventListener('input', function () { valEl.textContent = range.value; });
      }
    });
    container.querySelector('#protocolQuestionnaireForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var answers = {};
      for (var i = 0; i < config.length; i++) {
        var id = 'q_' + i;
        var el = form.querySelector('#' + id);
        if (el) answers[el.name || id] = el.value;
      }
      recordAnswers(answers);
      onNext();
    });
  }

  function renderCalibration(block, container, onNext) {
    var params = getBlockParams(block);
    var title = params.title || 'Calibration';
    container.innerHTML = '<div class="protocol-block calibration">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p>In the full flow, calibration would run here. For protocol-runner MVP, click Next to continue.</p>' +
      '<button type="button" class="btn protocol-next">Next</button></div>';
    container.querySelector('.protocol-next').addEventListener('click', onNext);
  }

  function renderStimuli(block, container, onNext) {
    var params = getBlockParams(block);
    var title = params.title || 'Stimuli';
    container.innerHTML = '<div class="protocol-block stimuli">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p>Stimuli block. In the full flow, stimuli would be presented here.</p>' +
      '<button type="button" class="btn protocol-next">Next</button></div>';
    container.querySelector('.protocol-next').addEventListener('click', onNext);
  }

  function renderRest(block, container, onNext) {
    var params = getBlockParams(block);
    var duration = (params.duration_sec != null ? params.duration_sec : 60) | 0;
    var title = params.title || 'Rest';
    state.restDuration = duration;
    state.restStart = Date.now();
    container.innerHTML = '<div class="protocol-block rest">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p class="rest-timer" id="protocolRestTimer">' + duration + ' s</p>' +
      '<p class="muted">Please wait...</p></div>';
    var timerEl = container.querySelector('#protocolRestTimer');
    var interval = setInterval(function () {
      var left = Math.max(0, duration - Math.floor((Date.now() - state.restStart) / 1000));
      if (timerEl) timerEl.textContent = left + ' s';
      if (left <= 0) {
        clearInterval(interval);
        onNext();
      }
    }, 500);
  }

  function renderBaseline(block, container, onNext) {
    var params = getBlockParams(block);
    var duration = (params.duration_sec != null ? params.duration_sec : 180) | 0;
    var title = params.title || 'Baseline';
    state.restDuration = duration;
    state.restStart = Date.now();
    container.innerHTML = '<div class="protocol-block baseline">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p class="rest-timer" id="protocolRestTimer">' + duration + ' s</p></div>';
    var timerEl = container.querySelector('#protocolRestTimer');
    var interval = setInterval(function () {
      var left = Math.max(0, duration - Math.floor((Date.now() - state.restStart) / 1000));
      if (timerEl) timerEl.textContent = left + ' s';
      if (left <= 0) {
        clearInterval(interval);
        onNext();
      }
    }, 500);
  }

  function renderRecovery(block, container, onNext) {
    var params = getBlockParams(block);
    var duration = (params.duration_sec != null ? params.duration_sec : 180) | 0;
    var title = params.title || 'Recovery';
    state.restDuration = duration;
    state.restStart = Date.now();
    container.innerHTML = '<div class="protocol-block recovery">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p class="rest-timer" id="protocolRestTimer">' + duration + ' s</p></div>';
    var timerEl = container.querySelector('#protocolRestTimer');
    var interval = setInterval(function () {
      var left = Math.max(0, duration - Math.floor((Date.now() - state.restStart) / 1000));
      if (timerEl) timerEl.textContent = left + ' s';
      if (left <= 0) {
        clearInterval(interval);
        onNext();
      }
    }, 500);
  }

  function renderFinal(block, container) {
    var params = getBlockParams(block);
    var title = params.title || 'Thank you';
    var text = params.text || 'You have completed the protocol. You can download your report below.';
    container.innerHTML = '<div class="protocol-block final">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p>' + escapeHtml(text) + '</p>' +
      '<button type="button" class="btn protocol-download" id="protocolDownloadBtn">Download report (JSON)</button></div>';
    container.querySelector('#protocolDownloadBtn').addEventListener('click', function () {
      var log = getRunLog();
      var blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'protocol-run-' + (state.invitation && state.invitation.code ? state.invitation.code : 'report') + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function showError(container, message) {
    container.innerHTML = '<div class="protocol-block error"><h2>Error</h2><p>' + escapeHtml(message) + '</p></div>';
  }

  function runNext(container) {
    var block = advanceBlock();
    if (!block) {
      renderFinal(null, container);
      return;
    }
    var type = block.type || 'instruction';
    var onNext = function () { runNext(container); };
    if (type === 'instruction') renderInstruction(block, container, onNext);
    else if (type === 'consent') renderConsent(block, container, onNext);
    else if (type === 'questionnaire') renderQuestionnaire(block, container, onNext);
    else if (type === 'calibration') renderCalibration(block, container, onNext);
    else if (type === 'stimuli') renderStimuli(block, container, onNext);
    else if (type === 'rest') renderRest(block, container, onNext);
    else if (type === 'baseline') renderBaseline(block, container, onNext);
    else if (type === 'recovery') renderRecovery(block, container, onNext);
    else if (type === 'final') {
      advanceBlock();
      renderFinal(block, container);
    } else {
      renderInstruction(block, container, onNext);
    }
  }

  function start(container) {
    var block = getCurrentBlock();
    if (!block) {
      renderFinal(null, container);
      return;
    }
    var type = block.type || 'instruction';
    var onNext = function () { runNext(container); };
    if (type === 'instruction') renderInstruction(block, container, onNext);
    else if (type === 'consent') renderConsent(block, container, onNext);
    else if (type === 'questionnaire') renderQuestionnaire(block, container, onNext);
    else if (type === 'calibration') renderCalibration(block, container, onNext);
    else if (type === 'stimuli') renderStimuli(block, container, onNext);
    else if (type === 'rest') renderRest(block, container, onNext);
    else if (type === 'baseline') renderBaseline(block, container, onNext);
    else if (type === 'recovery') renderRecovery(block, container, onNext);
    else if (type === 'final') renderFinal(block, container);
    else renderInstruction(block, container, onNext);
  }

  global.ProtocolRunner = {
    loadByCode: loadByCode,
    start: start,
    getRunLog: getRunLog,
    getCurrentBlock: getCurrentBlock,
    getDefinition: function () { return state.definition; },
  };
})(typeof window !== 'undefined' ? window : this);
