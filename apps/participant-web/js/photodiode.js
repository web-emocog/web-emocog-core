(function (global) {
  'use strict';

  // Published protocol settings are authoritative; URL opt-in is local diagnostics only.
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(global.location.hostname);
  const params = new URLSearchParams(global.location.search);
  let protocolConfigured = params.has('code');
  let enabled = local && !protocolConfigured && params.get('photodiode') === '1';
  const COUNTS = Object.freeze({ experiment: 4, task: 3, stage: 2, stimulus: 1 });
  const queue = [];
  let current = null;
  let timer = null;
  let active = false;
  let ending = null;
  let generation = 0;

  function element() { return document.getElementById('photodiode'); }

  function settle(job, status) {
    job.resolve({ kind: job.kind, status, pulses: job.pulses,
      emittedAtMs: job.emittedAtMs, completedAtMs: performance.now() });
  }

  function pump() {
    if (current || !queue.length) return;
    const el = element();
    current = queue.shift();
    if (!el) {
      const missing = current;
      current = null;
      settle(missing, 'missing_element');
      pump();
      return;
    }
    el.hidden = false;
    current.emittedAtMs = performance.now();
    let remaining = current.pulses;
    function pulse() {
      el.style.backgroundColor = '#fff';
      timer = setTimeout(() => {
        el.style.backgroundColor = '#000';
        timer = setTimeout(() => {
          if (--remaining > 0) { pulse(); return; }
          timer = null;
          const completed = current;
          current = null;
          settle(completed, 'emitted');
          pump();
        }, 100);
      }, 100);
    }
    pulse();
  }

  function signal(kind) {
    if (!enabled) return Promise.resolve({ kind, status: 'disabled' });
    if (!Object.hasOwn(COUNTS, kind)) return Promise.resolve({ kind, status: 'unknown_kind' });
    if (!active) return Promise.resolve({ kind, status: 'inactive' });
    if (document.hidden) return Promise.resolve({ kind, status: 'hidden' });
    // A queued stimulus marker would falsely describe an earlier onset.
    if ((kind === 'stimulus' && (current || queue.length)) || queue.length >= 8) {
      return Promise.resolve({ kind, status: 'busy', pulses: 0 });
    }
    return new Promise(resolve => {
      queue.push({ kind, pulses: COUNTS[kind], emittedAtMs: null, resolve });
      pump();
    });
  }

  function stop() {
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const cancelled = [current, ...queue].filter(Boolean);
    current = null;
    queue.length = 0;
    active = false;
    ending = null;
    const el = element();
    if (el) { el.style.backgroundColor = '#000'; el.hidden = true; }
    cancelled.forEach(job => settle(job, 'cancelled'));
  }

  function begin() {
    if (!enabled) return Promise.resolve({ status: 'disabled' });
    if (document.hidden) return Promise.resolve({ status: 'hidden' });
    if (active) return Promise.resolve({ status: 'already_started' });
    ending = null;
    active = true;
    return signal('experiment');
  }

  function finish() {
    if (ending) return ending;
    if (!active) return Promise.resolve({ status: 'inactive' });
    const finishGeneration = generation;
    ending = signal('experiment').then(result => {
      if (generation === finishGeneration) stop();
      return result;
    });
    return ending;
  }

  function setEnabled(value) {
    if (protocolConfigured || active || ending) return enabled;
    enabled = local && value === true;
    return enabled;
  }

  function configureProtocol(definition) {
    stop();
    protocolConfigured = true;
    enabled = definition?.settings?.featureFlags?.photodiode === true;
    setupNotice();
    return enabled;
  }

  function setupNotice() {
    const notice = document.getElementById('photodiodeTemporaryNotice');
    const toggle = document.getElementById('photodiodeTemporaryToggle');
    const text = document.getElementById('photodiodeTemporaryText');
    if (!notice || !toggle || !text) return;
    notice.hidden = protocolConfigured ? !enabled : !local;
    toggle.checked = enabled;
    toggle.disabled = protocolConfigured;
    const russian = (global.__WECOG_STATE__?.currentLang || document.documentElement.lang) === 'ru';
    text.textContent = protocolConfigured
      ? (russian
        ? 'Временная функция: квадрат для фотодетектора включён исследователем в протоколе. Точность импульсов не валидирована.'
        : 'Temporary feature: the photodiode square is enabled by the researcher in this protocol. Pulse timing has not been validated.')
      : (russian
        ? 'Временная локальная функция: квадрат для фотодетектора. Только для проверки оборудования; точность импульсов не валидирована.'
        : 'Temporary local feature: photodiode square. For hardware testing only; pulse timing has not been validated.');
    toggle.onchange = () => { toggle.checked = setEnabled(toggle.checked); };
  }

  global.Photodiode = { signal, begin, finish, stop, setEnabled, configureProtocol,
    isEnabled: () => enabled, isActive: () => active,
    version: 'photodiode.temporary.v1', temporary: true };
  document.addEventListener('DOMContentLoaded', setupNotice, { once: true });
  global.addEventListener('wecog:languagechange', setupNotice);
  global.addEventListener('wecog:session-phase-change', event => {
    if (/precheck|calibrat|validat|consent|registration/.test(event.detail?.phase || '')) stop();
  });
  global.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) stop();
  });
})(window);
