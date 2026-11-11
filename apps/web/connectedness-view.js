(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EmocogConnectedness = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function ranks(values) {
    const order = values.map((_, index) => index).sort((a, b) => values[a] - values[b]);
    const result = new Array(values.length);
    for (let start = 0, end; start < order.length; start = end) {
      end = start + 1;
      while (end < order.length && values[order[end]] === values[order[start]]) end++;
      for (let i = start; i < end; i++) result[order[i]] = (start + 1 + end) / 2;
    }
    return result;
  }
  function spearman(pairs) {
    if (pairs.length < 3) return null;
    const x = ranks(pairs.map(pair => pair.x)), y = ranks(pairs.map(pair => pair.y));
    const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const mx = average(x), my = average(y);
    let numerator = 0, dx = 0, dy = 0;
    for (let index = 0; index < x.length; index += 1) { const a = x[index] - mx, b = y[index] - my; numerator += a * b; dx += a * a; dy += b * b; }
    return dx && dy ? Math.max(-1, Math.min(1, numerator / Math.sqrt(dx * dy))) : null;
  }
  function pairsFor(trials, window, channel) {
    return trials.filter(trial => trial.qualityValid === true && trial.correct === true && finite(trial.rtMs)
      && trial.windows?.[window]?.channels?.[channel]?.status === 'observed'
      && finite(trial.windows[window].channels[channel].value))
      .map(trial => ({ x: trial.rtMs, y: trial.windows[window].channels[channel].value, trialId: trial.trialId,
        blockId: trial.blockId, onsetMs: trial.onsetMs, attempt: trial.attempt }));
  }
  function csv(bundle) {
    const fields = ['snapshotId', 'datasetHash', 'sessionId', 'blockId', 'condition', 'trialId', 'attempt', 'stimulusId', 'rtMs', 'correct', 'qualityValid', 'status', 'window', 'startMs', 'endMs', 'channel', 'value', 'n', 'nValid', 'validFraction', 'maxGapMs', 'signalStatus', 'clock', 'algorithmVersion', 'schemaVersion', 'baselineMs', 'postMs', 'truncated', 'trialCountTotal', 'reportSource'];
    const rows = [];
    for (const trial of bundle.report.trials) for (const [window, period] of Object.entries(trial.windows)) for (const [channel, metric] of Object.entries(period.channels)) {
      rows.push([bundle.snapshot.id, bundle.snapshot.datasetHash, bundle.report.sessionId, trial.blockId, trial.condition, trial.trialId, trial.attempt, trial.stimulusId, trial.rtMs, trial.correct, trial.qualityValid, trial.status, window, period.startMs, period.endMs, channel, metric.value, metric.n, metric.nValid, metric.validFraction, metric.maxGapMs, metric.status, bundle.report.clock, bundle.report.algorithmVersion, bundle.report.schemaVersion, bundle.report.baselineMs, bundle.report.postMs, bundle.report.truncated, bundle.report.trialCountTotal, bundle.report.source]);
    }
    const cell = value => { let text = String(value ?? ''); if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
    return [fields, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
  }
  function render(host, response, english, labels = {}) {
    const tr = (ru, en) => english ? en : ru;
    const report = response?.data?.connectedness;
    if (!report?.trials?.length) {
      host.innerHTML = `<div class="card" style="padding:24px"><h2>${tr('Нет RT-проб с временными метками','No timestamped RT trials')}</h2><p>${tr('Нужна сессия с задачей на время реакции. Отсутствие данных не является нулевым результатом.','A session with a reaction-time task is required. Missing data is not a zero result.')}</p></div>`;
      return;
    }
    const names = { gaze: tr('Пригодные измерения взгляда','Usable gaze samples'), body: tr('Движение корпуса','Body movement'), valence: tr('Валентность мимики','Facial valence'), arousal: tr('Активность мимики','Facial activity'), bpm: tr('Пульс','Heart rate'), respiration: tr('Дыхание','Respiration') };
    const trialNumber = new Map(report.trials.map((trial, index) => [trial, index + 1]));
    const trialLabel = trial => tr('Проба', 'Trial') + ' ' + trialNumber.get(trial);
    const knownValues = new Set(report.trials.flatMap(trial => [trial.blockId, trial.condition]).map(value => String(value ?? '')));
    let missingSelection = '__missing__';
    while (knownValues.has(missingSelection)) missingSelection += '_';
    const selectionValue = value => value == null || value === '' ? missingSelection : String(value);
    const options = (values, label = value => value) => [...new Set(values.map(selectionValue))].map(value => `<option value="${escape(value)}">${escape(value === missingSelection ? tr('Не указано','Unspecified') : label(value))}</option>`).join('');
    host.innerHTML = `<section class="card ab-connectedness" id="connectednessModule">
      <div class="ab-eyebrow">${tr('Связанность', 'Connectedness')}</div>
      <h2>${tr('Время реакции и сигналы','Reaction time and signals')}</h2>
      <p>${tr('Сопоставьте реакцию и сигнал в одной сессии. Одна точка — одна проба. Связь не означает причину.', 'Compare responses and signals within one session. One point is one trial. Association does not imply causation.')}</p>
      ${report.source === 'legacy_events_only' ? `<p role="status">${tr('Старая сессия: доступны события RT, но оконные сигналы не были сохранены. Полные оконные данные появятся в новых записях; старый результат автоматически не пересчитывается.','Legacy session: RT events are available, but windowed signals were not stored. Full windowed data will be available in new recordings; old results are not automatically recomputed.')}</p>` : ''}
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:14px 0">
        <label>${tr('Блок','Block')} <select id="connectednessBlock"><option value="">${tr('Все','All')}</option>${options(report.trials.map(trial => trial.blockId), labels.block)}</select></label>
        <label>${tr('Условие','Condition')} <select id="connectednessCondition"><option value="">${tr('Все','All')}</option>${options(report.trials.map(trial => trial.condition))}</select></label>
        <label>${tr('Окно','Window')} <select id="connectednessWindow"><option value="baseline">${tr('До стимула (до 1000 мс)','Before stimulus (up to 1000 ms)')}</option><option value="response" selected>${tr('От стимула до ответа','Stimulus to response')}</option><option value="post">${tr('После пробы (до 1000 мс)','After trial (up to 1000 ms)')}</option></select></label>
        <label>${tr('Сигнал','Signal')} <select id="connectednessChannel">${Object.entries(names).map(([key, name]) => `<option value="${key}">${escape(name)}</option>`).join('')}</select></label>
      </div>
      <label>${tr('Масштаб линии','Timeline scale')} <select id="connectednessZoom"><option value="0">${tr('Вся сессия','Whole session')}</option><option value="5000">5 s</option><option value="30000">30 s</option></select></label>
      <div id="connectednessResults" aria-live="polite"></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">
        <button type="button" class="quick-btn" id="connectednessPrevious">${tr('Предыдущая проба','Previous trial')}</button>
        <label style="min-width:0;max-width:100%">${tr('Выбранная проба','Selected trial')} <select id="connectednessTrial" style="width:300px;max-width:100%"></select></label>
        <button type="button" class="quick-btn" id="connectednessNext">${tr('Следующая проба','Next trial')}</button>
      </div>
      <div id="connectednessTrialDetails" aria-live="polite" style="margin-top:12px;overflow:auto"></div>
      <div style="display:flex;gap:10px;margin-top:15px"><button type="button" class="quick-btn" id="connectednessJson">JSON</button><button type="button" class="quick-btn" id="connectednessCsv">CSV</button></div>
      <details class="ab-chart-method"><summary>${tr('Методика и ограничения','Methods and limitations')}</summary><ul>
        <li>${tr('ЧСС и дыхание оценены по нескольким секундам сигнала. Короткое окно не показывает мгновенную реакцию.', 'Heart rate and breathing are estimated over several seconds. A short window is not an instantaneous response.')}</li>
        <li>${tr('Доля пригодных измерений взгляда не равна доле времени. Мимика не измеряет эмоции напрямую.', 'The share of usable gaze samples is not a share of time. Facial movements do not directly measure emotion.')}</li>
        <li>${tr('Связь показывается для одного блока и условия. Минимум три пары — ограничение отображения, а не достаточный размер выборки.', 'Association is shown within one block and condition. Three pairs are a display limit, not an adequate sample size.')}</li>
      </ul></details>
      <details class="ab-chart-method"><summary>${tr('Доступность сигналов и паспорт отчёта', 'Signal availability and report provenance')}</summary>
        <p id="connectednessAvailability">${tr('Видео участника не сохраняется. Моргания и PERCLOS без оконных данных не подменяются средними за сессию.','Participant video is not stored. Blinks and PERCLOS without windowed data are not replaced by session averages.')}</p>
      <p style="font-size:11px;overflow-wrap:anywhere">snapshot ${escape(response.snapshot.id)} · ${escape(response.snapshot.datasetHash)} · ${escape(report.algorithmVersion)} · ${escape(report.clock)} ${report.truncated ? tr('· сохранены первые 200 проб','· first 200 trials retained') : ''}</p>
      </details>
    </section>`;
    const select = id => host.querySelector('#' + id);
    let current = [];
    let selectedTrial = report.trials[0];
    function choose(index, focus = false) {
      if (!Number.isInteger(index) || !current[index]) return;
      selectedTrial = current[index]; update();
      if (focus) select('connectednessTrial').focus();
    }
    function update() {
      const block = select('connectednessBlock').value, condition = select('connectednessCondition').value;
      const window = select('connectednessWindow').value, channel = select('connectednessChannel').value;
      const tableOpen = select('connectednessResults').querySelector('details')?.open;
      current = report.trials.filter(trial => (!block || selectionValue(trial.blockId) === block) && (!condition || selectionValue(trial.condition) === condition));
      if (!current.includes(selectedTrial)) selectedTrial = current[0] || null;
      const selectedIndex = current.indexOf(selectedTrial);
      const pairs = pairsFor(current, window, channel);
      const pairSelected = pair => selectedTrial?.trialId === pair.trialId && selectedTrial?.blockId === pair.blockId
        && selectedTrial?.attempt === pair.attempt && selectedTrial?.onsetMs === pair.onsetMs;
      const rolling = channel === 'bpm' || channel === 'respiration';
      const rho = !rolling && block && condition && block !== missingSelection && condition !== missingSelection ? spearman(pairs) : null;
      const value = metric => finite(metric?.value) ? metric.value.toFixed(3) : tr('Нет данных','No data');
      const maxX = Math.max(1, ...pairs.map(pair => pair.x)), ys = pairs.map(pair => pair.y), minY = Math.min(0, ...ys), maxY = Math.max(1, ...ys);
      const duration = Math.max(1, ...current.map(trial => trial.endMs ?? trial.onsetMs));
      const span = Number(select('connectednessZoom').value) || duration;
      const rangeStart = span >= duration ? 0 : Math.max(0, Math.min(duration - span, (selectedTrial?.onsetMs || 0) - span / 2));
      const rangeEnd = Math.min(duration, rangeStart + span);
      const xTime = time => 20 + (time - rangeStart) / (rangeEnd - rangeStart || 1) * 600;
      const timeline = `<svg role="img" aria-label="${escape(tr('Временная шкала стимулов и ответов','Stimulus and response timeline'))}" viewBox="0 0 640 85" style="width:100%;max-width:900px"><path d="M20 35H620" stroke="currentColor"/>${current.map((trial, index) => {
        const ending = trial.endMs ?? trial.onsetMs;
        if (ending < rangeStart || trial.onsetMs > rangeEnd) return '';
        const x = xTime(Math.max(rangeStart, trial.onsetMs));
        return `<g role="button" tabindex="0" data-trial-index="${index}" aria-label="${escape(tr('Выбрать пробу','Select trial'))} ${index + 1}" aria-pressed="${trial === selectedTrial}" style="cursor:pointer">
          <rect x="${x}" y="22" width="${Math.max(5, xTime(Math.min(rangeEnd, ending)) - x)}" height="26" stroke="${trial === selectedTrial ? 'currentColor' : 'none'}" stroke-width="2" fill="var(--accent)" opacity="${trial === selectedTrial ? 1 : .35}"><title>${escape(trialLabel(trial))}</title></rect>
          ${trial.responseMs == null || trial.responseMs < rangeStart || trial.responseMs > rangeEnd ? '' : `<circle cx="${xTime(trial.responseMs)}" cy="35" r="5" fill="currentColor"><title>RT ${trial.rtMs ?? '?'} ms</title></circle>`}</g>`;
      }).join('')}<text x="20" y="73" fill="currentColor">${(rangeStart / 1000).toFixed(1)} s</text><text x="510" y="73" fill="currentColor">${(rangeEnd / 1000).toFixed(1)} s</text></svg>`;
      const plot = pairs.length ? `<svg role="img" aria-label="${escape(tr('RT и выбранный сигнал','RT versus selected signal'))}" viewBox="0 0 640 210" style="width:100%;max-width:760px"><path d="M45 10V180H630" fill="none" stroke="currentColor"/>${pairs.map(pair => `<circle role="button" tabindex="0" aria-pressed="${pairSelected(pair)}" data-trial-index="${current.findIndex(trial => trial.trialId === pair.trialId && trial.blockId === pair.blockId && trial.attempt === pair.attempt && trial.onsetMs === pair.onsetMs)}" aria-label="${escape(tr('Выбрать пробу','Select trial'))}" style="cursor:pointer" cx="${45 + pair.x / maxX * 575}" cy="${170 - (pair.y - minY) / (maxY - minY) * 150}" r="${pairSelected(pair) ? 6 : 4}" stroke="${pairSelected(pair) ? 'currentColor' : 'none'}" stroke-width="2" fill="var(--accent)"><title>${pair.x.toFixed(1)} ms · ${pair.y.toFixed(3)}</title></circle>`).join('')}<text x="45" y="202" fill="currentColor">0</text><text x="510" y="202" fill="currentColor">RT ${maxX.toFixed(0)} ms</text><text x="5" y="25" fill="currentColor">${maxY.toFixed(2)}</text></svg>` : `<p>${tr('Нет валидных правильных ответов с этим сигналом.','No valid correct responses with this signal.')}</p>`;
      select('connectednessResults').innerHTML = `<div class="ab-connected-charts"><section class="ab-card"><h3>${tr('Когда были показаны стимулы?', 'When were stimuli shown?')}</h3>${timeline}<p>${tr('Нажмите на пробу, чтобы увидеть ответ.', 'Click a trial to inspect its response.')}</p></section><section class="ab-card"><h3>${tr('Как сигнал соотносится со временем реакции?', 'How does the signal relate to reaction time?')}</h3><p>${tr('Проб','Trials')}: ${current.length} · ${tr('Валидных правильных пар','Valid correct pairs')}: ${pairs.length} · ρ: ${rho == null ? tr('не вычислено (выберите один блок и условие; нужна вариативность)','not computed (select one block and condition; variation required)') : rho.toFixed(3)}</p>${plot}</section></div>
        <details class="ab-chart-method" ${tableOpen ? 'open' : ''}><summary>${tr('Таблица проб', 'Trial table')}</summary><div style="overflow:auto;max-height:420px"><table style="width:100%;text-align:left"><thead><tr>${[tr('Проба / попытка','Trial / attempt'),tr('Условие','Condition'),'RT (ms)',tr('Ответ / QC','Response / QC'),names[channel],tr('Валидные / всего','Valid / total'),tr('Макс. пробел, мс','Max gap, ms')].map(label => `<th>${escape(label)}</th>`).join('')}</tr></thead><tbody>${current.map(trial => { const metric = trial.windows[window].channels[channel] || { n: 0, nValid: 0, maxGapMs: null }; return `<tr style="background:${trial === selectedTrial ? 'var(--accent-soft,rgba(30,90,250,.10))' : 'transparent'}"><td><button type="button" class="quick-btn" data-trial-index="${current.indexOf(trial)}" aria-pressed="${trial === selectedTrial}">${escape(trialLabel(trial))}</button></td><td>${escape(trial.condition)}</td><td>${trial.rtMs == null ? '—' : trial.rtMs.toFixed(1)}</td><td>${trial.correct === null ? '—' : trial.correct ? tr('Верно','Correct') : tr('Неверно','Incorrect')} / ${trial.qualityValid ? tr('Допустимо','Eligible') : tr('Исключено','Excluded')}</td><td>${value(metric)}</td><td>${metric.nValid} / ${metric.n}</td><td>${metric.maxGapMs ?? '—'}</td></tr>`; }).join('')}</tbody></table></div></details>`;
      select('connectednessTrial').innerHTML = current.map((trial, index) => `<option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${escape(trialLabel(trial))} · ${escape(labels.stimulus?.(trial.stimulusId) || tr('Стимул', 'Stimulus'))}</option>`).join('');
      select('connectednessPrevious').disabled = selectedIndex <= 0;
      select('connectednessNext').disabled = selectedIndex < 0 || selectedIndex >= current.length - 1;
      select('connectednessTrial').disabled = !current.length;
      const windows = ['baseline', 'response', 'post'];
      const observed = selectedTrial ? Object.keys(names).filter(key =>
        windows.some(period => finite(selectedTrial.windows?.[period]?.channels?.[key]?.value))) : [];
      select('connectednessTrialDetails').innerHTML = selectedTrial ? `<section class="ab-connected-detail"><h3>${escape(trialLabel(selectedTrial))} · ${escape(labels.stimulus?.(selectedTrial.stimulusId) || tr('Стимул', 'Stimulus'))}</h3>
        <p>${tr('Время реакции','Reaction time')}: <strong>${finite(selectedTrial.rtMs) ? selectedTrial.rtMs.toFixed(1) + tr(' мс', ' ms') : '—'}</strong> · ${tr('Начало','Onset')}: ${finite(selectedTrial.onsetMs) ? (selectedTrial.onsetMs / 1000).toFixed(2) + tr(' с', ' s') : '—'}</p>
        ${observed.length && !observed.includes(channel) ? `<p>${escape(names[channel])}: ${tr('нет измерений для этой пробы', 'no measurements for this trial')}.</p>` : ''}
        ${observed.length ? `<div style="overflow:auto"><table class="ab-signal-table"><thead><tr><th>${tr('Сигнал','Signal')}</th><th>${tr('До стимула','Before stimulus')}</th><th>${tr('До ответа','Until response')}</th><th>${tr('После пробы','After trial')}</th></tr></thead><tbody>
        ${observed.map(key => `<tr><th scope="row">${escape(names[key])}</th>${windows.map(period => {
          const signal = selectedTrial.windows?.[period]?.channels?.[key];
          return `<td>${finite(signal?.value) ? (key === 'gaze' ? (signal.value * 100).toFixed(0) + '%' : value(signal)) : '—'}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="ab-empty">${tr('Для этой пробы нет измерений рядом с ответом.', 'No signal measurements near this response.')}</p>`}</section>`
        : `<p>${tr('Нет проб','No trials')}</p>`;
      if (rolling) select('connectednessResults').insertAdjacentHTML('afterbegin', `<p role="status">${tr('Описательный контекст скользящей физиологической оценки. ρ для коротких окон отключён.','Descriptive context of a rolling physiological estimate. Correlation is disabled for short windows.')}</p>`);
      select('connectednessResults').querySelectorAll('[data-trial-index]').forEach(element => {
        element.addEventListener('click', () => choose(Number(element.dataset.trialIndex), true));
        if (element.tagName.toLowerCase() !== 'button') element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(Number(element.dataset.trialIndex), true); }
        });
      });
    }
    select('connectednessTrial').addEventListener('change', event => choose(Number(event.target.value)));
    select('connectednessPrevious').addEventListener('click', () => choose(current.indexOf(selectedTrial) - 1, true));
    select('connectednessNext').addEventListener('click', () => choose(current.indexOf(selectedTrial) + 1, true));
    for (const id of ['connectednessBlock','connectednessCondition','connectednessWindow','connectednessChannel','connectednessZoom']) select(id).addEventListener('change', update);
    for (const format of ['Json','Csv']) select('connectedness' + format).addEventListener('click', () => {
      const bundle = { contractVersion: '1.0', kind: 'rt_connectedness_export', snapshot: response.snapshot,
        view: { selectedTrialId: selectedTrial?.trialId ?? null, selectedAttempt: selectedTrial?.attempt ?? null, blockId: select('connectednessBlock').value === missingSelection ? null : select('connectednessBlock').value,
          condition: select('connectednessCondition').value === missingSelection ? null : select('connectednessCondition').value,
          unspecifiedBlockSelected: select('connectednessBlock').value === missingSelection,
          unspecifiedConditionSelected: select('connectednessCondition').value === missingSelection,
          window: select('connectednessWindow').value, channel: select('connectednessChannel').value }, report: { ...report, trials: current } };
      const blob = new Blob([format === 'Json' ? JSON.stringify(bundle, null, 2) : csv(bundle)], { type: format === 'Json' ? 'application/json' : 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'rt-connectedness.' + format.toLowerCase(); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    update();
  }
  return { render, spearman, pairsFor, csv };
});
