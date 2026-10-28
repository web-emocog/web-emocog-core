/**
 * Protocol Runner (Фаза 4.4). Выполнение протокола по JSON: текущий блок → экран/действие → переход.
 * Блоки: instruction, consent, questionnaire, calibration, stimuli, rest, baseline, recovery, final.
 * Исходные файлы не удаляем.
 */
(function (global) {
  'use strict';

  if (global.ProtocolRunner && global.ProtocolRunner.dispose) global.ProtocolRunner.dispose();
  var disposed = false;
  var loadReady = false;
  var loadSequence = 0;
  var activeLoad = null;
  var viewGeneration = 0;
  var viewTimer = null;
  var activeContainer = null;
  var viewListeners = [];

  function clearView() {
    viewGeneration++;
    if (viewTimer !== null) clearInterval(viewTimer);
    viewTimer = null;
    viewListeners.splice(0).forEach(function (remove) { remove(); });
  }

  function stop() {
    loadSequence++;
    if (activeLoad) activeLoad.abort();
    activeLoad = null;
    clearView();
    activeContainer = null;
  }

  function listenView(element, type, callback) {
    var generation = viewGeneration;
    var container = activeContainer;
    function handler(event) {
      if (generation !== viewGeneration || container !== activeContainer || container.isConnected === false) return;
      callback(event);
    }
    element.addEventListener(type, handler);
    viewListeners.push(function () { element.removeEventListener(type, handler); });
  }

  function loadCancelled() {
    var error = new Error('Protocol load cancelled');
    error.name = 'AbortError';
    error.code = 'protocol_load_cancelled';
    return error;
  }

  var state = {
    invitation: null,
    definition: null,
    blockIndex: 0,
    run_log: [],
    started_at: null,
    answers: Object.create(null),
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
    if (disposed) return Promise.reject(loadCancelled());
    var base = (getApiBase() || '').replace(/\/$/, '');
    if (!base) return Promise.reject(new Error('API base is not configured'));
    var url = base + '/invitations/by-code/' + encodeURIComponent(code);
    stop();
    loadReady = false;
    var request = ++loadSequence;
    var controller = new AbortController();
    activeLoad = controller;
    var deadline = setTimeout(function () { controller.abort(); }, 15000);
    var abort;
    var cancelled = new Promise(function (_resolve, reject) {
      abort = function () { reject(loadCancelled()); };
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    var pending = Promise.resolve().then(function () {
      if (controller.signal.aborted) throw loadCancelled();
      return fetch(url, { signal: controller.signal });
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
      return r.json();
    }).then(function (data) {
      if (controller.signal.aborted || request !== loadSequence) throw loadCancelled();
      state.invitation = data;
      state.definition = data.definition || { blocks: [] };
      state.blockIndex = 0;
      state.run_log = [];
      state.started_at = new Date().toISOString();
      state.answers = Object.create(null);
      loadReady = true;
      return state.definition;
    });
    return Promise.race([pending, cancelled]).finally(function () {
      clearTimeout(deadline);
      controller.signal.removeEventListener('abort', abort);
      if (activeLoad === controller) activeLoad = null;
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
    state.answers = Object.assign(Object.create(null), state.answers, answers);
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
    listenView(container.querySelector('.protocol-next'), 'click', onNext);
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
    listenView(check, 'change', function () { btn.disabled = !check.checked; });
    listenView(btn, 'click', onNext);
  }

  function renderQuestionnaire(block, container, onNext) {
    var params = getBlockParams(block);
    var config = params.config || [];
    var html = '<div class="protocol-block questionnaire"><h2>Questionnaire</h2><form id="protocolQuestionnaireForm">';
    config.forEach(function (field, i) {
      var id = 'q_' + i;
      var name = escapeHtml(field.name || id);
      var label = field.label || field.name || 'Q' + (i + 1);
      var required = field.required ? ' required' : '';
      if (field.type === 'text') {
        html += '<div class="form-group"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
          '<input type="text" id="' + id + '" name="' + name + '"' + required + '></div>';
      } else if (field.type === 'number') {
        html += '<div class="form-group"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
          '<input type="number" id="' + id + '" name="' + name + '"' + required + '></div>';
      } else if (field.type === 'scale') {
        var min = field.min != null && Number.isFinite(Number(field.min)) ? Number(field.min) : 1;
        var max = field.max != null && Number.isFinite(Number(field.max)) ? Math.max(min, Number(field.max)) : Math.max(min, 10);
        html += '<div class="form-group"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
          '<input type="range" id="' + id + '" name="' + name + '" min="' + min + '" max="' + max + '" value="' + min + '">' +
          '<span class="scale-value" id="' + id + '_val">' + min + '</span></div>';
      } else {
        html += '<div class="form-group"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
          '<input type="text" id="' + id + '" name="' + name + '"' + required + '></div>';
      }
    });
    html += '<button type="submit" class="btn protocol-next">Submit</button></form></div>';
    container.innerHTML = html;
    container.querySelectorAll('input[type="range"]').forEach(function (range) {
      var valEl = document.getElementById(range.id + '_val');
      if (valEl) {
        listenView(range, 'input', function () { valEl.textContent = range.value; });
      }
    });
    listenView(container.querySelector('#protocolQuestionnaireForm'), 'submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var answers = Object.create(null);
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
    listenView(container.querySelector('.protocol-next'), 'click', onNext);
  }

  function renderStimuli(block, container, onNext) {
    var params = getBlockParams(block);
    var title = params.title || 'Stimuli';
    container.innerHTML = '<div class="protocol-block stimuli">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p>Stimuli block. In the full flow, stimuli would be presented here.</p>' +
      '<button type="button" class="btn protocol-next">Next</button></div>';
    listenView(container.querySelector('.protocol-next'), 'click', onNext);
  }

  function renderCountdown(block, container, onNext, kind, fallback) {
    var params = getBlockParams(block);
    var duration = Number(params.duration_sec != null ? params.duration_sec : fallback);
    if (!Number.isSafeInteger(duration) || duration < 0) {
      showError(container, 'Invalid block duration');
      return;
    }
    var title = params.title || kind[0].toUpperCase() + kind.slice(1);
    state.restDuration = duration;
    state.restStart = Date.now();
    container.innerHTML = '<div class="protocol-block ' + kind + '">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p class="rest-timer" id="protocolRestTimer">' + duration + ' s</p>' +
      (kind === 'rest' ? '<p class="muted">Please wait...</p>' : '') + '</div>';
    var timerEl = container.querySelector('#protocolRestTimer');
    var generation = viewGeneration;
    viewTimer = setInterval(function () {
      if (generation !== viewGeneration || activeContainer !== container) return;
      if (container.isConnected === false) { clearView(); activeContainer = null; return; }
      var left = Math.max(0, duration - Math.floor((Date.now() - state.restStart) / 1000));
      if (timerEl) timerEl.textContent = left + ' s';
      if (left <= 0) {
        onNext();
      }
    }, 500);
  }

  function renderRest(block, container, onNext) {
    renderCountdown(block, container, onNext, 'rest', 60);
  }

  function renderBaseline(block, container, onNext) {
    renderCountdown(block, container, onNext, 'baseline', 180);
  }

  function renderRecovery(block, container, onNext) {
    renderCountdown(block, container, onNext, 'recovery', 180);
  }

  function renderFinal(block, container) {
    var params = getBlockParams(block);
    var title = params.title || 'Thank you';
    var text = params.text || 'You have completed the protocol. You can download your report below.';
    container.innerHTML = '<div class="protocol-block final">' +
      '<h2>' + escapeHtml(title) + '</h2>' +
      '<p>' + escapeHtml(text) + '</p>' +
      '<button type="button" class="btn protocol-download" id="protocolDownloadBtn">Download report (JSON)</button></div>';
    listenView(container.querySelector('#protocolDownloadBtn'), 'click', function () {
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
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showError(container, message) {
    container.innerHTML = '<div class="protocol-block error"><h2>Error</h2><p>' + escapeHtml(message) + '</p></div>';
  }

  function runNext(container) {
    advanceBlock();
    start(container);
  }

  function start(container) {
    if (disposed) throw loadCancelled();
    if (activeLoad) throw new Error('Wait for protocol loading before starting');
    if (!loadReady) throw new Error('Load a protocol successfully before starting');
    clearView();
    activeContainer = container;
    var block = getCurrentBlock();
    if (!block) {
      renderFinal(null, container);
      return;
    }
    var type = block.type || 'instruction';
    var generation = viewGeneration;
    var advanced = false;
    var onNext = function () {
      if (advanced || generation !== viewGeneration || activeContainer !== container || container.isConnected === false) return;
      advanced = true;
      runNext(container);
    };
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
    stop: stop,
    dispose: function () {
      stop();
      disposed = true;
      global.removeEventListener('pagehide', stop);
    },
    getRunLog: getRunLog,
    getCurrentBlock: getCurrentBlock,
    getDefinition: function () { return state.definition; },
  };
  global.addEventListener('pagehide', stop);
})(typeof window !== 'undefined' ? window : this);
