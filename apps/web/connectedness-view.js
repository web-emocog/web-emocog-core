(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EmocogConnectedness = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const ranks = values => values.map(value => {
    const smaller = values.filter(other => other < value).length;
    const equal = values.filter(other => other === value).length;
    return smaller + (equal + 1) / 2;
  });
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
      .map(trial => ({ x: trial.rtMs, y: trial.windows[window].channels[channel].value, trialId: trial.trialId, attempt: trial.attempt }));
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
  function render(host, response, english) {
    const tr = (ru, en) => english ? en : ru;
    const report = response?.data?.connectedness;
    if (!report?.trials?.length) {
      host.innerHTML = `<div class="card" style="padding:24px"><h2>${tr('Нет RT-проб с временными метками','No timestamped RT trials')}</h2><p>${tr('Нужна сессия с задачей на время реакции. Отсутствие данных не является нулевым результатом.','A session with a reaction-time task is required. Missing data is not a zero result.')}</p></div>`;
      return;
    }
    const names = { gaze: tr('Доля валидных gaze-сэмплов','Valid gaze sample fraction'), body: tr('Скорость движения корпуса (proxy)','Body movement velocity (proxy)'), valence: tr('Валентность (proxy)','Valence (proxy)'), arousal: tr('Возбуждение (proxy)','Arousal (proxy)'), bpm: tr('BPM: скользящая оценка','BPM: rolling estimate') };
    const options = values => [...new Set(values)].map(value => `<option value="${escape(value)}">${escape(value ?? tr('Не указано','Unspecified'))}</option>`).join('');
    host.innerHTML = `<section class="card" id="connectednessModule" style="padding:18px;min-width:0">
      <h2>${tr('RT и синхронизированные сигналы','RT and synchronized signals')}</h2>
      <p>${tr('Одна точка = одна проба, а не кадр. Описательный анализ одной сессии, без причинных выводов и p-value.','One point = one trial, not one frame. Descriptive analysis of one session; no causal conclusions or p-values.')}</p>
      <p id="connectednessAvailability">${tr('Видео участника не сохраняется. Моргания и PERCLOS без оконных данных не подменяются средними за сессию.','Participant video is not stored. Blinks and PERCLOS without windowed data are not replaced by session averages.')}</p>
      ${report.source === 'legacy_events_only' ? `<p role="status">${tr('Старая сессия: доступны события RT, но оконные сигналы не были сохранены. Полные оконные данные появятся в новых записях; старый результат автоматически не пересчитывается.','Legacy session: RT events are available, but windowed signals were not stored. Full windowed data will be available in new recordings; old results are not automatically recomputed.')}</p>` : ''}
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:14px 0">
        <label>${tr('Блок','Block')} <select id="connectednessBlock"><option value="">${tr('Все','All')}</option>${options(report.trials.map(trial => trial.blockId))}</select></label>
        <label>${tr('Условие','Condition')} <select id="connectednessCondition"><option value="">${tr('Все','All')}</option>${options(report.trials.map(trial => trial.condition))}</select></label>
        <label>${tr('Окно','Window')} <select id="connectednessWindow"><option value="baseline">${tr('До стимула (до 1000 мс)','Before stimulus (up to 1000 ms)')}</option><option value="response" selected>${tr('От стимула до ответа','Stimulus to response')}</option><option value="post">${tr('После пробы (до 1000 мс)','After trial (up to 1000 ms)')}</option></select></label>
        <label>${tr('Сигнал','Signal')} <select id="connectednessChannel">${Object.entries(names).map(([key, name]) => `<option value="${key}">${escape(name)}</option>`).join('')}</select></label>
      </div>
      <div id="connectednessResults" aria-live="polite"></div>
      <div style="display:flex;gap:10px;margin-top:15px"><button type="button" class="quick-btn" id="connectednessJson">JSON</button><button type="button" class="quick-btn" id="connectednessCsv">CSV</button></div>
      <details style="margin-top:16px"><summary>${tr('Методика и ограничения','Methods and limitations')}</summary><p>${tr('Окна обрезаются у соседних проб. Пропуски не интерполируются, задержки камеры и дисплея не компенсируются без аппаратной проверки. Доля gaze относится к сохранённым сэмплам, а не ко всему времени. Мимика не является измерением эмоций; BPM вычисляется скользящим окном и не отражает мгновенный ответ.','Windows stop at neighboring trials. Gaps are not interpolated; camera/display delays are not corrected without hardware validation. Gaze fractions describe retained samples, not full time coverage. Facial expression is not an emotion measurement; rolling BPM is not an instantaneous response.')}</p><p>${tr('ρ Spearman показывается только для одного блока и условия и минимум трёх пар как описательная величина. Это математический минимум, не достаточность выборки. Для групп нужны заранее заданные mixed-effects/rmcorr модели с учётом участников, повторов и условий.','Spearman ρ is shown only for one block and condition and at least three pairs as a descriptive value. This mathematical minimum does not establish sample adequacy. Group inference requires prespecified mixed-effects/rmcorr models accounting for participants, repeats and conditions.')}</p><p><a href="https://doi.org/10.3389/fpsyg.2017.00456" target="_blank" rel="noopener noreferrer">Bakdash &amp; Marusich, 2017</a> · <a href="https://www.tobii.com/resource-center/webinars/introduction-to-tobii-pro-lab" target="_blank" rel="noopener noreferrer">Tobii TOI</a> · <a href="https://imotions.com/products/imotions-lab/" target="_blank" rel="noopener noreferrer">iMotions</a></p></details>
      <p style="font-size:11px;overflow-wrap:anywhere">snapshot ${escape(response.snapshot.id)} · ${escape(response.snapshot.datasetHash)} · ${escape(report.algorithmVersion)} · ${escape(report.clock)} ${report.truncated ? tr('· сохранены первые 200 проб','· first 200 trials retained') : ''}</p>
    </section>`;
    const select = id => host.querySelector('#' + id);
    let current = [];
    function update() {
      const block = select('connectednessBlock').value, condition = select('connectednessCondition').value;
      const window = select('connectednessWindow').value, channel = select('connectednessChannel').value;
      current = report.trials.filter(trial => (!block || trial.blockId === block) && (!condition || trial.condition === condition));
      const pairs = pairsFor(current, window, channel);
      const rho = block && condition ? spearman(pairs) : null;
      const value = metric => finite(metric?.value) ? metric.value.toFixed(3) : tr('Нет данных','No data');
      const maxX = Math.max(1, ...pairs.map(pair => pair.x)), ys = pairs.map(pair => pair.y), minY = Math.min(0, ...ys), maxY = Math.max(1, ...ys);
      const duration = Math.max(1, ...current.map(trial => trial.endMs ?? trial.onsetMs));
      const timeline = `<svg role="img" aria-label="${escape(tr('Временная шкала стимулов и ответов','Stimulus and response timeline'))}" viewBox="0 0 640 65" style="width:100%;max-width:760px"><path d="M20 35H620" stroke="currentColor"/>${current.map(trial => `<rect x="${20 + trial.onsetMs / duration * 600}" y="25" width="${Math.max(2, ((trial.endMs ?? trial.onsetMs) - trial.onsetMs) / duration * 600)}" height="20" fill="var(--accent)" opacity=".35"><title>${escape(trial.trialId)} · ${trial.onsetMs}–${trial.endMs ?? '?'} ms</title></rect>${trial.responseMs == null ? '' : `<circle cx="${20 + trial.responseMs / duration * 600}" cy="35" r="4" fill="currentColor"><title>RT ${trial.rtMs ?? '?'} ms</title></circle>`}`).join('')}<text x="20" y="62" fill="currentColor">0</text><text x="510" y="62" fill="currentColor">${(duration / 1000).toFixed(1)} s</text></svg>`;
      const plot = pairs.length ? `<svg role="img" aria-label="${escape(tr('RT и выбранный сигнал','RT versus selected signal'))}" viewBox="0 0 640 210" style="width:100%;max-width:760px"><path d="M45 10V180H630" fill="none" stroke="currentColor"/>${pairs.map(pair => `<circle cx="${45 + pair.x / maxX * 575}" cy="${170 - (pair.y - minY) / (maxY - minY) * 150}" r="4" fill="var(--accent)"><title>${escape(pair.trialId)} · ${pair.x.toFixed(1)} ms · ${pair.y.toFixed(3)}</title></circle>`).join('')}<text x="45" y="202" fill="currentColor">0</text><text x="510" y="202" fill="currentColor">RT ${maxX.toFixed(0)} ms</text><text x="5" y="25" fill="currentColor">${maxY.toFixed(2)}</text></svg>` : `<p>${tr('Нет валидных правильных ответов с этим сигналом.','No valid correct responses with this signal.')}</p>`;
      select('connectednessResults').innerHTML = `${timeline}<p>${tr('Проб','Trials')}: ${current.length} · ${tr('Валидных правильных пар','Valid correct pairs')}: ${pairs.length} · ρ: ${rho == null ? tr('не вычислено (выберите один блок и условие; нужна вариативность)','not computed (select one block and condition; variation required)') : rho.toFixed(3)}</p>${plot}
        <div style="overflow:auto;max-height:420px"><table style="width:100%;text-align:left"><thead><tr>${[tr('Проба / попытка','Trial / attempt'),tr('Условие','Condition'),'RT (ms)',tr('Ответ / QC','Response / QC'),names[channel],tr('Валидные / всего','Valid / total'),tr('Макс. пробел, мс','Max gap, ms')].map(label => `<th>${escape(label)}</th>`).join('')}</tr></thead><tbody>${current.map(trial => { const metric = trial.windows[window].channels[channel]; return `<tr><td>${escape(trial.trialId)} / ${trial.attempt}</td><td>${escape(trial.condition)}</td><td>${trial.rtMs == null ? '—' : trial.rtMs.toFixed(1)}</td><td>${trial.correct === null ? '—' : trial.correct ? tr('Верно','Correct') : tr('Неверно','Incorrect')} / ${trial.qualityValid ? tr('Допустимо','Eligible') : tr('Исключено','Excluded')}</td><td>${value(metric)}</td><td>${metric.nValid} / ${metric.n}</td><td>${metric.maxGapMs ?? '—'}</td></tr>`; }).join('')}</tbody></table></div>`;
    }
    for (const id of ['connectednessBlock','connectednessCondition','connectednessWindow','connectednessChannel']) select(id).addEventListener('change', update);
    for (const format of ['Json','Csv']) select('connectedness' + format).addEventListener('click', () => {
      const bundle = { contractVersion: '1.0', kind: 'rt_connectedness_export', snapshot: response.snapshot,
        view: { blockId: select('connectednessBlock').value, condition: select('connectednessCondition').value, window: select('connectednessWindow').value, channel: select('connectednessChannel').value }, report: { ...report, trials: current } };
      const blob = new Blob([format === 'Json' ? JSON.stringify(bundle, null, 2) : csv(bundle)], { type: format === 'Json' ? 'application/json' : 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'rt-connectedness.' + format.toLowerCase(); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    update();
  }
  return { render, spearman, pairsFor, csv };
});
