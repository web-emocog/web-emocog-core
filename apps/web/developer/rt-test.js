/**
 * Standalone RT test: считывание нажатий (Space / клик), лог в формате rt_component (JSONL).
 * Цель: протестировать реакшн-тайм аналитику без MVP.
 */
(function () {
  const MIN_RT_MS = 100;
  const MAX_RT_MS = 1500;
  const TIMEOUT_MS = 1500;
  const FIXATION_MS = 800;
  const MIN_DELAY_MS = 500;
  const MAX_DELAY_MS = 1500;
  const GO_COUNT = 5;
  const NOGO_COUNT = 2;

  const screen = document.getElementById('screen');
  const logEl = document.getElementById('log');
  const statsPanel = document.getElementById('statsPanel');
  const statsEl = document.getElementById('stats');
  const btnStart = document.getElementById('btnStart');
  const btnDownload = document.getElementById('btnDownload');
  const btnAgain = document.getElementById('btnAgain');

  let runStartMs = 0;
  let events = [];
  let trialId = 0;
  let blockId = 1;
  let stimulusOnMonos = null;
  let stimulusIsGo = null;
  let timeoutId = null;
  let results = [];

  function tMono() {
    return runStartMs ? (Date.now() - runStartMs) / 1000 : 0;
  }

  function emit(event) {
    const e = {
      instrument: 'rt',
      session_id: 'rt-dev-' + Date.now(),
      run_id: 'run-1',
      event_type: event.event_type,
      t_mono: typeof event.t_mono === 'number' ? event.t_mono : tMono(),
      t_unix: Math.floor(Date.now() / 1000),
      trial_id: event.trial_id,
      block_id: event.block_id != null ? event.block_id : blockId,
      ...event
    };
    delete e.event_type;
    const full = { ...e, event_type: event.event_type };
    events.push(full);
    appendLog(full);
    return full;
  }

  function appendLog(ev) {
    const div = document.createElement('div');
    div.className = 'ev';
    if (ev.event_type === 'stimulus_on') {
      div.textContent = `trial ${ev.trial_id} stimulus_on ${ev.is_go ? 'GO' : 'NO GO'} t_mono=${ev.t_mono.toFixed(3)}`;
    } else if (ev.event_type === 'keypress') {
      const rt = stimulusOnMonos != null ? (ev.t_mono - stimulusOnMonos) * 1000 : null;
      div.className = 'ev ' + (ev.rt_ms != null ? (ev.rt_ms >= MIN_RT_MS && ev.rt_ms <= MAX_RT_MS ? 'rt' : stimulusIsGo ? 'miss' : 'comm') : '');
      div.textContent = `trial ${ev.trial_id} keypress ${ev.button_id} t_mono=${ev.t_mono.toFixed(3)}` + (rt != null ? ` RT=${Math.round(rt)} ms` : '');
    }
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function show(msg, cls) {
    screen.textContent = msg;
    screen.className = cls || '';
  }

  function randomBetween(a, b) {
    return a + Math.random() * (b - a);
  }

  function runTrial(isGo) {
    stimulusIsGo = isGo;
    show('+', 'fixation');
    const delay = FIXATION_MS + randomBetween(MIN_DELAY_MS, MAX_DELAY_MS);

    setTimeout(() => {
      const t0 = tMono();
      stimulusOnMonos = t0;
      emit({
        event_type: 'stimulus_on',
        trial_id: trialId,
        block_id: blockId,
        stimulus_type: isGo ? 'go' : 'nogo',
        expected_response: isGo ? 'space' : null,
        is_go: isGo,
        timeout_ms: TIMEOUT_MS
      });
      show(isGo ? 'GO' : 'NO GO', isGo ? 'go' : 'nogo');

      let responded = false;
      function onResponse(buttonId) {
        if (responded) return;
        responded = true;
        clearTimeout(timeoutId);
        const t1 = tMono();
        const rtMs = (t1 - t0) * 1000;
        emit({
          event_type: 'keypress',
          trial_id: trialId,
          block_id: blockId,
          button_id: buttonId,
          t_mono: t1,
          rt_ms: rtMs
        });
        results.push({ trialId, isGo, rtMs, buttonId });
        nextTrial();
      }

      document.addEventListener('keydown', keyHandler);
      screen.addEventListener('click', clickHandler);
      function keyHandler(e) {
        if (e.code === 'Space') {
          e.preventDefault();
          document.removeEventListener('keydown', keyHandler);
          screen.removeEventListener('click', clickHandler);
          onResponse('space');
        }
      }
      function clickHandler() {
        document.removeEventListener('keydown', keyHandler);
        screen.removeEventListener('click', clickHandler);
        onResponse('click');
      }

      timeoutId = setTimeout(() => {
        document.removeEventListener('keydown', keyHandler);
        screen.removeEventListener('click', clickHandler);
        if (!responded) {
          results.push({ trialId, isGo, rtMs: null, buttonId: null });
        }
        nextTrial();
      }, TIMEOUT_MS);
    }, delay);
  }

  let queue = [];
  function nextTrial() {
    trialId++;
    if (queue.length === 0) {
      finishRun();
      return;
    }
    runTrial(queue.shift());
  }

  function finishRun() {
    show('Готово', 'wait');
    statsPanel.style.display = 'block';
    const validRTs = results.filter(r => r.isGo && r.rtMs != null && r.rtMs >= MIN_RT_MS && r.rtMs <= MAX_RT_MS).map(r => r.rtMs);
    const goTrials = results.filter(r => r.isGo);
    const nogoTrials = results.filter(r => !r.isGo);
    const omissions = goTrials.filter(r => r.rtMs == null).length;
    const commissions = nogoTrials.filter(r => r.rtMs != null).length;
    const meanRt = validRTs.length ? (validRTs.reduce((a, b) => a + b, 0) / validRTs.length).toFixed(0) : '—';
    const accuracy = results.length ? ((results.filter(r => (r.isGo && r.rtMs != null && r.rtMs >= MIN_RT_MS && r.rtMs <= MAX_RT_MS) || (!r.isGo && r.rtMs == null)).length / results.length) * 100).toFixed(1) : '—';
    statsEl.innerHTML = [
      '<span>mean_rt <strong>' + meanRt + ' ms</strong></span>',
      '<span>valid n <strong>' + validRTs.length + '</strong></span>',
      '<span>accuracy <strong>' + accuracy + '%</strong></span>',
      '<span>omissions <strong>' + omissions + '</strong></span>',
      '<span>commissions <strong>' + commissions + '</strong></span>'
    ].join('');
    btnDownload.onclick = function () { downloadJsonl(); };
    btnAgain.onclick = function () { startRun(); };
  }

  function downloadJsonl() {
    const lines = events.map(e => JSON.stringify(e)).join('\n');
    const blob = new Blob([lines], { type: 'application/x-ndjson' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rt_test_' + Date.now() + '.jsonl';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function startRun() {
    runStartMs = Date.now();
    events = [];
    results = [];
    trialId = 0;
    statsPanel.style.display = 'none';
    logEl.innerHTML = '';
    queue = [];
    for (let i = 0; i < GO_COUNT; i++) queue.push(true);
    for (let i = 0; i < NOGO_COUNT; i++) queue.push(false);
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    show('Старт через 1 сек…', 'wait');
    setTimeout(() => runTrial(queue.shift()), 1000);
  }

  function startFromUI() {
    startRun();
  }
  btnStart.addEventListener('click', startFromUI);
  document.addEventListener('keydown', function firstKey(e) {
    if (e.code === 'Space' && !runStartMs) {
      e.preventDefault();
      startFromUI();
    }
  });
  screen.addEventListener('click', function screenStart() {
    if (!runStartMs) startFromUI();
  });
})();
