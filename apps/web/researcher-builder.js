//(???)
function ExperimentBuilderView(options = {}) {
  const startStep = options.startStep !== undefined ? options.startStep : 0;
  const experimentId = options.experimentId || null;

  let currentStep = startStep;
  let importMode = null;
  let selectedBlockId = null;
  const SYSTEM_BLOCK_TYPES = ['consent','questionnaire','precheck','calibration'];
  const DEFAULT_PARTICIPANT_SHELL = {
    consent: true,
    questionnaire: true,
    precheck: false,
    calibration: false
  };

  function normalizeParticipantShell(shell) {
    return {
      consent: shell?.consent !== false,
      questionnaire: shell?.questionnaire !== false,
      precheck: shell?.precheck === true,
      calibration: shell?.calibration === true
    };
  }

  function getParticipantShellMeta() {
    return normalizeParticipantShell(protocolMeta.participantShell || DEFAULT_PARTICIPANT_SHELL);
  }

  function defaultExportTrialsForCognitiveBlock(content) {
    const existing = Array.isArray(content?.trials) ? content.trials : [];
    if (existing.length) return existing;
    let taskType = String(content?.taskType || 'other').toLowerCase();
    if (taskType === 'other' && content?.useRT !== false) {
      taskType = 'simple_rt';
    }
    if (taskType === 'simple_rt' || taskType === 'pvt') {
      return [{
        stimulusId: 'std_simple_black_square',
        condition: 'target',
        action: 'space',
        duration: 2000,
        repetitions: 10
      }];
    }
    if (taskType === 'go_nogo') {
      return [
        { stimulusId: 'std_go_green_circle', condition: 'Go', action: 'space', duration: 500, repetitions: 1 },
        { stimulusId: 'std_nogo_red_circle', condition: 'No-Go', action: '', duration: 500, repetitions: 1 }
      ];
    }
    return [{
      stimulusId: 'std_simple_black_square',
      condition: 'target',
      action: 'space',
      duration: 1000,
      repetitions: 5
    }];
  }

  function describeParticipantShellForUi(shell) {
    const parts = [];
    if (shell.consent) parts.push(trb('информированное согласие','informed consent'));
    if (shell.questionnaire) parts.push(trb('анкета','questionnaire'));
    if (shell.precheck) parts.push(trb('проверка камеры','camera check'));
    if (shell.calibration) parts.push(trb('калибровка','calibration'));
    if (!parts.length) {
      return trb(
        'Подготовительные этапы отключены — участник сразу перейдёт к блокам эксперимента.',
        'Preparation steps are off — the participant goes straight to experiment blocks.'
      );
    }
    return trb('Перед экспериментом участник пройдёт: ','Before the experiment, the participant will complete: ')
      + parts.join(', ') + '.';
  }

  function resolveTaskTypeForRtMetrics(content) {
    let taskType = String(content?.taskType || content?.rt_task || 'other').toLowerCase();
    if (taskType === 'other' && content?.useRT !== false) {
      taskType = 'simple_rt';
    }
    return taskType;
  }

  /** RT metrics are defined per task in RtRegistry (rt-registry.js), not user-picked. */
  function autoRtMetricsForTaskType(taskType, content) {
    const reg = typeof window !== 'undefined' ? window.RtRegistry : null;
    if (!reg) return null;
    const merged = Object.assign({}, content || {});
    if (taskType) merged.taskType = taskType;
    return reg.resolveSelectedMetrics(resolveTaskTypeForRtMetrics(merged), null);
  }

  let editingExp = null;
  let protocolVersion = '1.0';
  let protocolMeta = {
    title: '',
    protocolId: '',
    estimatedDuration: '',
    description: '',
    participantShell: { ...DEFAULT_PARTICIPANT_SHELL }
  };
  let highestStep = 0;

  if (experimentId) {
    const saved = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];
    editingExp = saved.find(e => e.id === experimentId) || null;
    experimentBlocks = (editingExp && editingExp.blocks) ? JSON.parse(JSON.stringify(editingExp.blocks)).filter(b => !SYSTEM_BLOCK_TYPES.includes(b.type)) : [];
    protocolMeta = {
      title: editingExp?.metadata?.title || editingExp?.title || '',
      protocolId: editingExp?.metadata?.protocolId || editingExp?.protocolId || '',
      estimatedDuration: editingExp?.metadata?.estimatedDuration || '',
      description: editingExp?.metadata?.description || '',
      participantShell: normalizeParticipantShell(
        editingExp?.metadata?.participantShell || DEFAULT_PARTICIPANT_SHELL
      )
    };

    if (editingExp) {
      if (editingExp.status === 'active') {
        highestStep = 8; // Всего 9 шагов (индекс 8)
        protocolVersion = (parseFloat(editingExp.version || '1.0') + 0.1).toFixed(1);
        if (currentStep === 0) currentStep = 2;
      } else {
        highestStep = editingExp.savedStep || 1;
        protocolVersion = editingExp.version || '1.0';
        if (currentStep === 0) currentStep = highestStep;
      }
    }
  } else if (currentStep === 0) {
    experimentBlocks = (JSON.parse(localStorage.getItem('emocog_protocol_blocks')) || []).filter(b => !SYSTEM_BLOCK_TYPES.includes(b.type));
    uploadedPsychoPyFile = null; uploadedResources = {}; parsedExperimentData = null;
    protocolVersion = '1.0';
    protocolMeta = JSON.parse(localStorage.getItem('emocog_protocol_meta_draft') || 'null') || protocolMeta;
    highestStep = 0;
  } else {
    experimentBlocks = (JSON.parse(localStorage.getItem('emocog_protocol_blocks')) || []).filter(b => !SYSTEM_BLOCK_TYPES.includes(b.type));
    protocolMeta = JSON.parse(localStorage.getItem('emocog_protocol_meta_draft') || 'null') || protocolMeta;
    protocolVersion = '1.0';
    highestStep = currentStep;
  }

  document.getElementById('pageTitle').textContent = 'Конструктор протокола';

  const trb = (ru) => ru;
  const localizedInstructionValue = (content, field, fallback = '') => {
    const c = content || {};
    if (CURRENT_LANG === 'en') {
      const knownTranslations = typeof TEMPLATE_INSTRUCTION_TRANSLATIONS !== 'undefined' ? TEMPLATE_INSTRUCTION_TRANSLATIONS : {};
      const known = knownTranslations[c.titleRu || c.title] || null;
      if (field === 'title' && known?.title) return known.title;
      if (field === 'text' && known?.text) return known.text;
      if (field === 'buttonText' && (c.buttonTextRu || c.buttonText || fallback) === 'Начать') return 'Start';
      return c[field + 'En'] || autoTranslateString(c[field] || c[field + 'Ru'] || fallback, CURRENT_LANG);
    }
    return c[field + 'Ru'] || c[field] || fallback;
  };
  const localizedBlockLabel = (block, fallback = '') => {
    if (!block) return fallback;
    if (CURRENT_LANG === 'en') {
      const blockTranslations = typeof TEMPLATE_BLOCK_LABEL_TRANSLATIONS !== 'undefined' ? TEMPLATE_BLOCK_LABEL_TRANSLATIONS : {};
      if (blockTranslations[block.labelRu || block.label]) return blockTranslations[block.labelRu || block.label];
      return block.labelEn || autoTranslateString(block.label || block.labelRu || fallback, CURRENT_LANG);
    }
    return block.labelRu || block.label || fallback;
  };
  const STEPS = I18N.ru.builderSteps;

  const BLOCK_TYPES = [
    { type:'consent',        label:I18N.ru.blockConsent,       color:'#6366f1', icon:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { type:'questionnaire',  label:I18N.ru.blockQuestionnaire, color:'#8b5cf6', icon:'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { type:'precheck',       label:I18N.ru.blockPrecheck,      color:'#0ea5e9', icon:'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
    { type:'calibration',    label:I18N.ru.blockCalibration,   color:'#10b981', icon:'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z' },
    { type:'instruction',    label:trb('Инструкция','Instruction'), color:'#f59e0b', icon:'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { type:'cognitive_task', label:I18N.ru.blockTask,          color:'#ef4444', icon:'M13 10V3L4 14h7v7l9-11h-7z' },
    { type:'passive',        label:I18N.ru.blockPassive,       color:'#ec4899', icon:'M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z' },
    { type:'rest',           label:I18N.ru.blockBreak,         color:'#64748b', icon:'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { type:'finish',         label:trb('Финальный экран','Finish screen'), color:'#5C66BD', icon:'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z' },
  ];

  function getMeta(type) { return BLOCK_TYPES.find(b => b.type === type) || BLOCK_TYPES[BLOCK_TYPES.length-1]; }

  function defaultContent(type) {
    switch(type) {
      case 'instruction':    return { title:'Инструкция', text:'', buttonText:'Далее' };
      case 'cognitive_task': return { taskType:'other', showFeedback:true, useRT:true, stimulusDuration:1000, trials:[], stimuliSource:'library', stimuliFolder:'' };
      case 'questionnaire':  return { questions:[] };
      case 'passive':        return { slideDuration:5000, slides:[], stimuliSource:'library', stimuliFolder:'' };
      case 'rest':           return { text:trb('Сделайте небольшой перерыв','Take a short break'), duration:30 };
      case 'finish':         return { title:trb('Эксперимент завершён','Experiment completed'), text:trb('Спасибо за участие!','Thank you for participating!') };
      default:               return {};
    }
  }



  const root = document.createElement('div');
  root.style.cssText = 'display:flex; gap:0; height:100%; min-height:0; overflow:hidden; max-width: 1100px; margin: 0 auto; width: 100%;';

  const stepperCol = document.createElement('div');
  stepperCol.style.cssText = 'width:200px; flex-shrink:0; display:flex; flex-direction:column; overflow-y:auto; border-right:1px solid var(--stroke); padding:14px 10px;';
  root.appendChild(stepperCol);

  const canvasCol = document.createElement('div');
  canvasCol.style.cssText = 'flex:1; min-width:0; display:flex; flex-direction:column; overflow:hidden;';
  root.appendChild(canvasCol);

  function renderStepper() {
    if (currentStep > highestStep) highestStep = currentStep;
    if (!experimentId) localStorage.setItem('emocog_protocol_step_draft', String(currentStep));

    stepperCol.innerHTML = `
      <div style="font-size:10px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:var(--muted2);padding:0 4px 10px;">Шаги</div>
      ${STEPS.map((label, i) => {
        const done = i < currentStep || i < highestStep || (editingExp?.status === 'active');
        const active = i === currentStep;
        const locked = i > highestStep;

        return `<div class="bstep ${active?'bstep-active':''}" data-step="${i}"
          style="display:flex;align-items:center;gap:9px;padding:8px 8px;border-radius:10px;margin-bottom:2px;cursor:${locked?'default':'pointer'};background:${active?'rgba(92,102,189,.11)':'transparent'};">
          <div style="width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;font-weight:700;
            background:${done?'var(--good)':active?'var(--accent)':'var(--stroke)'};
            color:${done||active?'white':'var(--muted2)'};">
            ${done && !active ? '<svg width="9" height="9" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>' : (i+1)}
          </div>
          <span style="font-size:12px;line-height:1.3;font-weight:${active?'600':'400'};color:${locked?'var(--muted2)':active?'var(--accent)':'var(--text)'};">${label}</span>
        </div>`;
      }).join('')}

      <div style="margin-top:auto; padding-top:20px;">
        <button id="saveDraftGlobalBtn" class="quick-btn" style="width:100%; justify-content:center; font-size:11px; background:rgba(245,158,11,.1); border:1px solid rgba(245,158,11,.3); color:var(--warn); font-weight:600;">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
          Сохранить черновик
        </button>
      </div>
    `;

    stepperCol.querySelectorAll('.bstep').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.step);
        if (i <= highestStep) { currentStep = i; renderStepper(); renderCanvas(); }
      });
    });

    stepperCol.querySelector('#saveDraftGlobalBtn').addEventListener('click', saveDraft);
    setTimeout(() => applyAutoI18n(stepperCol), 0);
  }

  function clearInspector() {
    setInspector({ customHtml: `<div style="color:var(--muted);font-size:12px;padding:8px 0;">${trb('Выберите блок для настройки','Select block to configure')}</div>` });
  }

  function showBlockInspector(blockId) {
    selectedBlockId = blockId;
    const block = experimentBlocks.find(b => b.id === blockId);
    if (!block) { clearInspector(); return; }
    const meta = getMeta(block.type);
    const c = block.content || {};
    const lockedTypes = ['consent','questionnaire','precheck','calibration'];
    const isLockedBlock = lockedTypes.includes(block.type);

    const folderOpts = (folders||[]).map(f =>
      `<option value="${f.id}" ${c.stimuliFolder===f.id?'selected':''}>${f.name}</option>`).join('');

    let typeFields = '';
    if (block.type === 'instruction') {
      const instrTitle = localizedInstructionValue(c, 'title');
      const instrText = localizedInstructionValue(c, 'text');
      const instrButton = localizedInstructionValue(c, 'buttonText', 'Далее');
      typeFields = `
        <div class="insp-field">
          <label>${trb('Заголовок','Title')}</label>
          <input data-field="title" value="${instrTitle}" />
        </div>
        <div class="insp-field">
          <label>${trb('Текст','Text')}</label>
          <textarea data-field="text" rows="4">${instrText}</textarea>
        </div>
        <div class="insp-field">
          <label>${trb('Кнопка','Button')}</label>
          <input data-field="buttonText" value="${instrButton}" />
        </div>`;
    } else if (block.type === 'cognitive_task' || block.type === 'passive') {
      typeFields = `
        ${block.type === 'cognitive_task' ? `
        <div class="insp-field">
          <label>Тип когнитивной задачи</label>
          <select data-field="taskType">
            <option value="simple_rt" ${c.taskType==='simple_rt'?'selected':''}>Простая реакция</option>
            <option value="go_nogo" ${c.taskType==='go_nogo'?'selected':''}>Go / No-Go</option>
            <option value="stroop" ${c.taskType==='stroop'?'selected':''}>Stroop</option>
            <option value="pvt" ${c.taskType==='pvt'?'selected':''}>PVT</option>
            <option value="ax_cpt" ${c.taskType==='ax_cpt'||c.taskType==='cpt'?'selected':''}>CPT</option>
            <option value="other" ${!c.taskType||c.taskType==='other'||c.taskType==='generic'?'selected':''}>Другое</option>
          </select>
        </div>` : ''}
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted2);margin:6px 0;">Источник данных</div>
        <div class="insp-field">
          <label>Откуда брать стимулы?</label>
          <select data-field="stimuliSource">
            <option value="library" ${c.stimuliSource==='library'||!c.stimuliSource?'selected':''}>Вся библиотека</option>
            <option value="folder" ${c.stimuliSource==='folder'?'selected':''}>Из папки</option>
          </select>
        </div>
        <div class="insp-field" id="folderField_${blockId}" style="${c.stimuliSource==='folder'?'':'display:none;'}">
          <label>Папка</label>
          <select data-field="stimuliFolder">
            <option value="">— папка —</option>
            ${folderOpts}
          </select>
        </div>
      `;
    } else if (block.type === 'rest') {
      typeFields = `
        <div class="insp-field">
          <label>${trb('Текст для участника','Text for participant')}</label>
          <textarea data-field="text" rows="3">${c.text||trb('Сделайте небольшой перерыв','Take a short break')}</textarea>
        </div>
        <div class="insp-field">
          <label>${trb('Длительность (сек)','Duration (sec)')}</label>
          <input data-field="duration" type="number" value="${c.duration||30}" />
        </div>`;
    } else if (block.type === 'finish') {
      typeFields = `
        <div class="insp-field">
          <label>${trb('Заголовок','Title')}</label>
          <input data-field="title" data-auto-i18n-value value="${c.title||trb('Эксперимент завершён','Experiment completed')}" />
        </div>
        <div class="insp-field">
          <label>${trb('Текст','Text')}</label>
          <textarea data-field="text" rows="3">${c.text||trb('Спасибо за участие!','Thank you for participating!')}</textarea>
        </div>`;
    }

    const blockLabel = localizedBlockLabel(block, meta.label);
    const html = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--stroke);">
        <div style="width:26px;height:26px;border-radius:8px;background:${meta.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg fill="none" stroke="${meta.color}" stroke-width="2" viewBox="0 0 24 24" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="${meta.icon}"/></svg>
        </div>
        <div style="font-size:13px;font-weight:700;color:var(--text);line-height:1.2;">${meta.label}</div>
      </div>
      ${isLockedBlock ? `
      <div style="font-size:11px;color:var(--muted2);padding:8px 10px;border:1px solid var(--stroke);border-radius:10px;background:rgba(255,255,255,.35);margin-bottom:12px;">
        Этот системный блок нельзя редактировать.
      </div>
      <div class="insp-field">
        <label>${trb('Название блока','Block name')}</label>
        <div style="padding:7px 9px;border-radius:8px;border:1px solid var(--stroke);background:rgba(255,255,255,.45);font-size:12px;color:var(--text);">${blockLabel}</div>
      </div>
      ` : `
      <div class="insp-field">
        <label>${trb('Название блока','Block name')}</label>
        <input id="insp_label" value="${blockLabel}" />
      </div>
      `}
      ${typeFields}
      ${isLockedBlock ? '' : `<button id="inspSaveBtn" class="quick-btn" style="width:100%;margin-top:8px;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;font-size:12px;">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
        ${trb('Сохранить','Save')}
      </button>`}
      <style>
        .insp-field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;}
        .insp-field label{font-size:11px;font-weight:600;color:var(--muted);}
        .insp-field input,.insp-field select,.insp-field textarea{width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--stroke);background:rgba(255,255,255,.6);font-size:12px;color:var(--text);font-family:inherit;resize:vertical;}
      </style>
    `;
    setInspector({ customHtml: html });

    setTimeout(() => {
      applyAutoI18n(document.getElementById('inspector'));

      const insp = document.getElementById('inspector');
      if (!insp) return;
      const srcSelect = insp.querySelector('[data-field="stimuliSource"]');
      if (srcSelect) {
        srcSelect.addEventListener('change', () => {
          const ff = insp.querySelector('#folderField_' + blockId);
          if (ff) ff.style.display = srcSelect.value === 'folder' ? '' : 'none';
        });
      }

      const taskTypeSelect = insp.querySelector('[data-field="taskType"]');
      if (taskTypeSelect) {
        taskTypeSelect.addEventListener('change', () => {
          block.content = block.content || {};
          block.content.taskType = taskTypeSelect.value || 'other';
          block.content.rt_task = block.content.taskType;
          block.content.selected_metrics = autoRtMetricsForTaskType(
            block.content.taskType,
            block.content
          );
          localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
        });
      }

      const slideMode = insp.querySelector('[data-field="slideChangeMode"]');
      if (slideMode) {
        slideMode.addEventListener('change', () => {
          const durF = insp.querySelector('#slideDurationField_' + blockId);
          const keyF = insp.querySelector('#manualKeyField_' + blockId);
          if (durF) durF.style.display = slideMode.value === 'manual' ? 'none' : '';
          if (keyF) keyF.style.display = slideMode.value === 'manual' ? '' : 'none';
        });
      }

      const trialsBtn = insp.querySelector(`#btn_edit_trials_${blockId}`);
      if (trialsBtn) {
        trialsBtn.addEventListener('click', () => {
          showTrialTableModal(block);
        });
      }

      const saveBtn = insp.querySelector('#inspSaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          block.label = insp.querySelector('#insp_label')?.value || block.label;
          block[CURRENT_LANG === 'en' ? 'labelEn' : 'labelRu'] = block.label;
          block.content = block.content || {};
          insp.querySelectorAll('[data-field]').forEach(el => {
            const field = el.dataset.field;
            if (el.type === 'checkbox') block.content[field] = el.checked;
            else if (el.type === 'number') block.content[field] = parseFloat(el.value) || 0;
            else block.content[field] = el.value;
          });
          if (block.type === 'instruction') {
            ['title', 'text', 'buttonText'].forEach(field => {
              if (block.content[field] === undefined) return;
              block.content[field + (CURRENT_LANG === 'en' ? 'En' : 'Ru')] = block.content[field];
            });
          }
          localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
          renderCanvasBlocks();
          toast(trb('Блок сохранён','Block saved'));
        });
      }
    }, 50);
  }

  function showTrialTableModal(block, onSaveCallback) {
    if (!block.content.trials) block.content.trials = [];
    let currentTrials = JSON.parse(JSON.stringify(block.content.trials));

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,0.65);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:rgba(255,255,255,0.97);border:1px solid rgba(92,102,189,0.22);border-radius:20px;padding:26px 24px 20px;width:1120px;max-width:98vw;max-height:85vh;display:flex;flex-direction:column;gap:16px;box-shadow:0 28px 72px rgba(10,15,35,0.30);';

    const stimuliOptions = stimuliList.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    const selectedFolderId = block.content.stimuliFolder || '';
    const folderOptions = folders.map(f => `<option value="${f.id}" ${f.id === selectedFolderId ? 'selected' : ''}>${f.name}</option>`).join('');

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--text);">
            <span>${trb('Настройка логики:','Configure logic:')}</span> <span style="color:var(--accent);">${block.label}</span>
          </div>
        </div>
        <button id="trialCloseBtn" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:4px;">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="22" height="22"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div style="display:flex; gap:16px; background:var(--card-bg); border:1px solid var(--stroke); padding:12px 16px; border-radius:12px; flex-wrap:nowrap; align-items:flex-end;">

        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:9px; font-weight:700; color:var(--muted2); text-transform:uppercase; letter-spacing:.04em; line-height:1.2;">${trb('Расчет времени реакции','Reaction time calculation')}</label>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);">
              <input type="checkbox" id="useRtCalcCb" ${(block.content.useRT !== false) ? 'checked' : ''} style="cursor:pointer; width:16px; height:16px; accent-color:var(--accent);">
              ${trb('нужен расчет','calculation required')}
            </label>
            <input type="number" id="rtWindowInput" min="1" value="${block.content.rtWindow || 1000}" style="width:90px; padding:6px; font-size:12px; border:1px solid var(--stroke); border-radius:6px; outline:none;" ${(block.content.useRT !== false) ? '' : 'disabled'}>
            <span style="font-size:12px; color:var(--muted);">${trb('макс. мс','max. ms')}</span>
          </div>
        </div>

        <div style="width:1px; height:36px; background:var(--stroke); margin:0 4px;"></div>

        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:9px; font-weight:700; color:var(--muted2); text-transform:uppercase; letter-spacing:.04em; line-height:1.2;">Фиксация (+)</label>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" id="useFixationCb" ${block.content.useFixation ? 'checked' : ''} style="cursor:pointer; width:16px; height:16px; accent-color:var(--accent);">
            <input type="number" id="fixationDuration" value="${block.content.fixationDuration || 500}" placeholder="мс" style="width:70px; padding:6px; font-size:12px; border:1px solid var(--stroke); border-radius:6px; outline:none;" ${block.content.useFixation ? '' : 'disabled'}>
            <span style="font-size:12px; color:var(--muted);">мс</span>
          </div>
        </div>

        ${block.type === 'cognitive_task' ? `
          <div style="width:1px; height:36px; background:var(--stroke); margin:0 4px;"></div>

          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:9px; font-weight:700; color:var(--muted2); text-transform:uppercase; letter-spacing:.04em; line-height:1.2;">${trb('Обратная связь','Feedback')}</label>
            <div style="display:flex; align-items:center; gap:8px;">
              <input type="checkbox" id="fbCb" ${block.content.showFeedback ? 'checked' : ''} style="cursor:pointer; width:16px; height:16px; accent-color:var(--accent);" title="${trb('Показывать','Show')}">
              <input type="text" id="fbCorr" data-auto-i18n-value value="${block.content.feedbackCorrect || trb('Верно!','Correct!')}" placeholder="${trb('Успех','Success')}" style="width:80px; padding:6px; font-size:12px; border:1px solid var(--stroke); border-radius:6px; outline:none;" ${block.content.showFeedback ? '' : 'disabled'}>
              <input type="text" id="fbInc" data-auto-i18n-value value="${block.content.feedbackIncorrect || trb('Ошибка!','Error!')}" placeholder="${trb('Ошибка','Error')}" style="width:80px; padding:6px; font-size:12px; border:1px solid var(--stroke); border-radius:6px; outline:none;" ${block.content.showFeedback ? '' : 'disabled'}>
            </div>
          </div>

          <div style="width:1px; height:36px; background:var(--stroke); margin:0 4px;"></div>

          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:9px; font-weight:700; color:var(--muted2); text-transform:uppercase; letter-spacing:.04em; line-height:1.2;">Действие при пропуске</label>
            <select id="omissionRuleSel" style="padding:6px 10px; font-size:12px; border:1px solid var(--stroke); border-radius:6px; outline:none; background:white;">
              <option value="flag" ${block.content.omissionRule==='flag'?'selected':''}>Пометить как ошибку</option>
              <option value="skip" ${block.content.omissionRule==='skip'?'selected':''}>Проигнорировать</option>
            </select>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <label style="font-size:9px; font-weight:700; color:var(--muted2); text-transform:uppercase; letter-spacing:.04em; line-height:1.2;">Действие при лишнем нажатии</label>
            <select id="commissionRuleSel" style="padding:6px 10px; font-size:12px; border:1px solid var(--stroke); border-radius:6px; outline:none; background:white;">
              <option value="flag" ${block.content.commissionRule==='flag'?'selected':''}>Пометить как ошибку</option>
              <option value="skip" ${block.content.commissionRule==='skip'?'selected':''}>Проигнорировать</option>
            </select>
          </div>
        ` : ''}
      </div>

      <div style="display:flex;gap:10px;align-items:center;margin-bottom:4px;flex-wrap:wrap;">
        <button id="addTrialRowBtn" class="quick-btn" style="background:var(--card-bg);border:1px solid var(--stroke);">+ Строка</button>
        <div style="width:1px;height:24px;background:var(--stroke);margin:0 4px;"></div>
        <span style="font-size:12px;color:var(--muted);font-weight:600;">Автогенерация из:</span>
        <select id="autoGenFolder" style="padding:6px 10px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;background:var(--card-bg);min-width:150px;">
          <option value="">— Выбрать папку —</option>
          ${folderOptions}
        </select>
        <button id="autoGenBtn" class="quick-btn" style="background:rgba(92,102,189,.1);color:var(--accent);border:none;">Сгенерировать</button>

        <div style="flex:1;"></div>

        <div style="display:flex;align-items:center;gap:6px;background:rgba(245,158,11,.1);padding:6px 12px;border-radius:8px;">
          <input type="checkbox" id="trialRandomizeCb" ${block.content.randomize ? 'checked' : ''} style="accent-color:var(--warn);width:16px;height:16px;cursor:pointer;">
          <label for="trialRandomizeCb" style="font-size:12px;font-weight:700;color:var(--warn);cursor:pointer;">Перемешивать пробы</label>
        </div>
        <div style="display:flex;align-items:center;gap:6px;background:rgba(92,102,189,.10);padding:6px 12px;border-radius:8px;">
          <input type="checkbox" id="trialAoiCb" ${block.content.useAOI ? 'checked' : ''} style="accent-color:var(--accent);width:16px;height:16px;cursor:pointer;">
          <label for="trialAoiCb" style="font-size:12px;font-weight:700;color:var(--accent);cursor:pointer;">AOI</label>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:40px 2fr 1.2fr 1.4fr 1fr 80px 40px;gap:8px;padding:0 8px;font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.05em;">
        <div>№</div>
        <div>Стимул</div>
        <div>Условие</div>
        <div style="display:flex;align-items:center;gap:6px;">
            <span>${trb('Действие','Action')}</span>
          <span title="${trb('Действие участника в ответ на стимул (клик мышью/клавишей)','Action participant takes in response to stimulus (mouse/keyboard)')}" style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;border:1px solid var(--stroke);font-size:10px;line-height:1;cursor:help;color:var(--muted);">!</span>
        </div>
        <div>Длит.(мс)</div>
        <div>Повторы</div>
        <div></div>
      </div>
      <div id="trialsContainer" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding:4px;min-height:200px;background:rgba(92,102,189,.03);border-radius:12px;border:1px inset var(--stroke);"></div>

      <div style="display:flex;gap:12px;justify-content:flex-end;flex-shrink:0;padding-top:12px;border-top:1px solid var(--stroke);">
        <button class="quick-btn" id="trialCancelBtn" style="background:transparent;border:1px solid var(--stroke);">Отмена</button>
        <button class="quick-btn" id="trialSaveBtn" style="background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700;">Сохранить таблицу</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const container = modal.querySelector('#trialsContainer');

    const fixCb = modal.querySelector('#useFixationCb');
    const fixInput = modal.querySelector('#fixationDuration');
    fixCb.addEventListener('change', () => { fixInput.disabled = !fixCb.checked; });
    const useRtCalcCb = modal.querySelector('#useRtCalcCb');
    const rtWindowInput = modal.querySelector('#rtWindowInput');
    useRtCalcCb.addEventListener('change', () => {
      rtWindowInput.disabled = !useRtCalcCb.checked;
    });

    if (block.type === 'cognitive_task') {
      const fbCb = modal.querySelector('#fbCb');
      const fbCorr = modal.querySelector('#fbCorr');
      const fbInc = modal.querySelector('#fbInc');
      fbCb.addEventListener('change', () => {
        fbCorr.disabled = !fbCb.checked;
        fbInc.disabled = !fbCb.checked;
      });
    }

    function renderRows() {
      if (currentTrials.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:13px;">Таблица пуста. Добавьте строку или сгенерируйте из папки.</div>`;
        return;
      }

      container.innerHTML = currentTrials.map((trial, index) => `
        <div class="trial-row" data-index="${index}" style="display:grid;grid-template-columns:40px 2fr 1.2fr 1.4fr 1fr 80px 40px;gap:8px;align-items:center;background:var(--card-bg);padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);">
          <div style="font-size:12px;font-weight:600;color:var(--muted);text-align:center;">${index + 1}</div>

          <select class="t-input t-stimulus" style="width:100%;padding:6px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;background:var(--card-bg);">
            <option value="">— Выбрать —</option>
            ${stimuliOptions}
          </select>

          <input class="t-input t-condition" value="${trial.condition || ''}" placeholder="условие" style="width:100%;padding:6px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;background:rgba(255,255,255,.55);" />

          <select class="t-input t-action" style="width:100%;padding:6px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;background:var(--card-bg);" ${trial.stimulusId ? '' : 'disabled'}>
            <option value="">- (действие не нужно)</option>
            <option value="mouse_click">Клик мышью</option>
            <option value="space">Пробел</option>
            <option value="arrow_up">Вверх</option>
            <option value="arrow_down">Вниз</option>
            <option value="arrow_right">Вправо</option>
            <option value="arrow_left">Влево</option>
          </select>
          <input type="number" class="t-input t-duration" min="1" value="${trial.duration || 1000}" style="width:100%;padding:6px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;" />
          <input type="number" class="t-input t-reps" value="${trial.repetitions || 1}" min="1" style="width:100%;padding:6px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;text-align:center;" />

          <button class="del-row-btn" data-index="${index}" style="background:none;border:none;color:var(--bad);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:4px;border-radius:6px;">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      `).join('');

      container.querySelectorAll('.trial-row').forEach(row => {
        const idx = row.dataset.index;
        if (currentTrials[idx].stimulusId) {
          row.querySelector('.t-stimulus').value = currentTrials[idx].stimulusId;
        }
        const actionEl = row.querySelector('.t-action');
        actionEl.disabled = !currentTrials[idx].stimulusId;
        actionEl.value = currentTrials[idx].action || currentTrials[idx].correctResponse || '';
      });

      highlightInvalidRows();
      setTimeout(() => applyAutoI18n(container), 0);
    }

    function markFieldInvalid(el, invalid) {
      if (!el) return;
      if (invalid) {
        el.style.borderColor = 'var(--bad)';
        el.style.background = 'rgba(239,68,68,.07)';
      } else {
        el.style.borderColor = 'var(--stroke)';
        el.style.background = 'var(--card-bg)';
      }
    }

    function highlightInvalidRows() {
      container.querySelectorAll('.trial-row').forEach((row) => {
        const stimEl = row.querySelector('.t-stimulus');
        const durEl = row.querySelector('.t-duration');
        const repsEl = row.querySelector('.t-reps');
        markFieldInvalid(stimEl, !stimEl.value);
        markFieldInvalid(durEl, (parseInt(durEl.value) || 0) <= 0);
        markFieldInvalid(repsEl, (parseInt(repsEl.value) || 0) <= 0);
      });
    }

    container.addEventListener('input', (e) => {
      if (e.target.classList.contains('t-input')) {
        const row = e.target.closest('.trial-row');
        const idx = row.dataset.index;
        const stimulusValue = row.querySelector('.t-stimulus').value;
        const actionEl = row.querySelector('.t-action');
        actionEl.disabled = !stimulusValue;
        if (!stimulusValue) actionEl.value = '';
        currentTrials[idx] = {
          ...currentTrials[idx],
          stimulusId: stimulusValue,
          condition: row.querySelector('.t-condition').value,
          action: actionEl.value,
          correctResponse: actionEl.value,
          duration: parseInt(row.querySelector('.t-duration').value) || 0,
          repetitions: parseInt(row.querySelector('.t-reps').value) || 1
        };
        highlightInvalidRows();
      }
    });

    container.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.del-row-btn');
      if (delBtn) {
        currentTrials.splice(delBtn.dataset.index, 1);
        renderRows();
      }
    });

    modal.querySelector('#addTrialRowBtn').addEventListener('click', () => {
      currentTrials.push({ stimulusId: '', condition: '', action: '', correctResponse: '', duration: 1000, repetitions: 1 });
      renderRows();
      setTimeout(() => container.scrollTop = container.scrollHeight, 50);
    });

    modal.querySelector('#autoGenBtn').addEventListener('click', () => {
      const folderId = modal.querySelector('#autoGenFolder').value;
      if (!folderId) return toast('Пожалуйста, выберите папку из списка', 'error');

      const folder = folders.find(f => f.id === folderId);
      if (!folder || !folder.stimuliIds || folder.stimuliIds.length === 0) {
        return toast('Выбранная папка пуста!', 'error');
      }

      folder.stimuliIds.forEach(stimId => {
        currentTrials.push({
          stimulusId: stimId,
          condition: '',
          action: '',
          correctResponse: '',
          duration: 1000,
          repetitions: 1
        });
      });

      renderRows();
      setTimeout(() => container.scrollTop = container.scrollHeight, 50);
      toast(`Успешно добавлено ${folder.stimuliIds.length} проб!`);
    });

    const close = () => document.body.removeChild(overlay);
    modal.querySelector('#trialCloseBtn').addEventListener('click', close);
    modal.querySelector('#trialCancelBtn').addEventListener('click', close);

    modal.querySelector('#trialSaveBtn').addEventListener('click', () => {
      if (!currentTrials.length) {
        highlightInvalidRows();
        toast('Добавьте хотя бы одну пробу со стимулом');
        return;
      }
      const invalidIdx = currentTrials.findIndex(t => !t.stimulusId || (parseInt(t.duration) || 0) <= 0 || (parseInt(t.repetitions) || 0) <= 0);
      if (invalidIdx !== -1) {
        highlightInvalidRows();
      toast(`${trb('Проверьте строку','Check row')} ${invalidIdx + 1}: ${trb('обязательны "Стимул", "Длит.(мс)" > 0 и "Повторы" > 0','required: "Stimulus", "Dur.(ms)" > 0 and "Repetitions" > 0')}`);
        return;
      }

      block.content.trials = currentTrials.map(({ feedbackCorrect, feedbackIncorrect, correctFeedback, incorrectFeedback, feedbackText, feedbackError, ...trial }) => trial);
      block.content.randomize = modal.querySelector('#trialRandomizeCb').checked;
      block.content.useAOI = modal.querySelector('#trialAoiCb').checked;
      const useRtCalc = modal.querySelector('#useRtCalcCb').checked;
      if (useRtCalc && (parseInt(modal.querySelector('#rtWindowInput').value) || 0) <= 0) {
        toast('Укажите максимальное время ожидаемой реакции > 0 мс');
        return;
      }
      block.content.useRT = useRtCalc;
      block.content.rtWindow = useRtCalc ? (parseInt(modal.querySelector('#rtWindowInput').value) || 1000) : null;
      block.content.useFixation = fixCb.checked;
      block.content.fixationDuration = parseInt(fixInput.value) || 500;

      if (block.type === 'cognitive_task') {
        block.content.showFeedback = modal.querySelector('#fbCb').checked;
        block.content.feedbackCorrect = modal.querySelector('#fbCorr').value || trb('Верно!','Correct!');
        block.content.feedbackIncorrect = modal.querySelector('#fbInc').value || trb('Ошибка!','Error!');

        block.content.omissionRule = modal.querySelector('#omissionRuleSel').value;
        block.content.commissionRule = modal.querySelector('#commissionRuleSel').value;
        block.content.rt_task = block.content.taskType || 'other';
        block.content.selected_metrics = autoRtMetricsForTaskType(
          block.content.taskType,
          block.content
        );
      }

      localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
      close();
      toast('Настройки логики сохранены ✓');

      if (onSaveCallback) onSaveCallback();
    });

    renderRows();
    setTimeout(() => applyAutoI18n(), 0);
  }

  function renderCanvas() {
    if (currentStep === 0) renderMetadataStep();
    else if (currentStep === 1) renderStep0();
    else if (currentStep === 2) renderStep1();
    else if (currentStep === 3) renderStep2Stimuli();
    else renderPlaceholder(currentStep);
    clearInspector();

    setTimeout(() => applyAutoI18n(), 0);
  }

  function getProtocolMetaFromForm() {
    return {
      title: (canvasCol.querySelector('#metaTitle')?.value || '').trim(),
      protocolId: (canvasCol.querySelector('#metaProtocolId')?.value || '').trim(),
      estimatedDuration: (canvasCol.querySelector('#metaDuration')?.value || '').trim(),
      description: (canvasCol.querySelector('#metaDescription')?.value || '').trim()
    };
  }

  function validateProtocolMeta(meta = protocolMeta) {
    const missing = [];
    if (!meta.title) missing.push(trb('название эксперимента','experiment title'));
    if (!meta.protocolId) missing.push(trb('id протокола','protocol id'));
    if (!meta.estimatedDuration) missing.push(trb('приблизительную длительность','estimated duration'));
    return missing;
  }

  function renderMetadataStep() {
    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:22px 24px;gap:18px;overflow-y:auto;">
        <div>
          <div style="font-size:19px;font-weight:800;color:var(--text);margin-bottom:4px;">${trb('Описание эксперимента','Experiment description')}</div>
          <div style="font-size:13px;color:var(--muted);line-height:1.5;">${trb('Заполните базовые параметры протокола. Поля со звездочкой обязательны для продолжения.','Fill in the basic protocol parameters. Fields marked with an asterisk are required to continue.')}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:860px;">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);">
            ${trb('Название эксперимента *','Experiment title *')}
            <input id="metaTitle" value="${protocolMeta.title || ''}" placeholder="${trb('Например: Внимание и рабочая память','For example: Attention and working memory')}" style="padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--card-bg);font-size:14px;color:var(--text);">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);">
            ${trb('ID протокола *','Protocol ID *')}
            <input id="metaProtocolId" value="${protocolMeta.protocolId || ''}" placeholder="attention-memory-v1" style="padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--card-bg);font-size:14px;color:var(--text);font-family:var(--mono);">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);">
            ${trb('Приблизительная длительность *','Estimated duration *')}
            <input id="metaDuration" value="${protocolMeta.estimatedDuration || ''}" placeholder="${trb('Например: 25 минут','For example: 25 minutes')}" style="padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--card-bg);font-size:14px;color:var(--text);">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);grid-column:1/-1;">
            ${trb('Краткое описание','Short description')}
            <textarea id="metaDescription" rows="5" placeholder="${trb('Кратко опишите цель и структуру эксперимента','Briefly describe the goal and structure of the experiment')}" style="padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--card-bg);font-size:14px;color:var(--text);font-family:inherit;resize:vertical;">${protocolMeta.description || ''}</textarea>
          </label>
        </div>
        <div id="metaError" style="display:none;color:var(--bad);font-size:12px;font-weight:700;"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:auto;padding-top:12px;border-top:1px solid var(--stroke);">
          <button class="quick-btn" id="metaNextBtn" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:700;font-size:13px;">Далее →</button>
        </div>
      </div>
    `;
    canvasCol.querySelector('#metaNextBtn').addEventListener('click', () => {
      protocolMeta = getProtocolMetaFromForm();
      const missing = validateProtocolMeta(protocolMeta);
      const err = canvasCol.querySelector('#metaError');
      if (missing.length) {
        err.style.display = 'block';
        err.textContent = autoTranslateString(trb('Заполните обязательные поля: ','Fill in required fields: ') + missing.join(', '), CURRENT_LANG);
        return;
      }
      localStorage.setItem('emocog_protocol_meta_draft', JSON.stringify(protocolMeta));
      currentStep = 1;
      renderStepper();
      renderCanvas();
    });
  }

  function renderStep0() {
    // Task template definitions
    const TASK_TEMPLATES = [
      {
        id: 'simple_rt',
        label: 'Простая реакция',
        sublabel: 'Скорость реакции',
        desc: 'Нажатие на кнопку в ответ на появление стимула. Измеряет базовое время реакции.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="4" stroke-width="2"/><path stroke-linecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`,
        color: '#6366F1',
        bg: 'rgba(99,102,241,.12)',
        tags: ['RT', '~5 мин', 'базовый'],
        blocks: [
          { type: 'instructions', label: 'Инструкция', color: '#77A9E8', content: { text: 'Нажимайте пробел как можно быстрее, когда увидите стимул.' } },
          { type: 'fixation', label: 'Фиксация', color: '#94A3B8', content: { duration: 500 } },
          { type: 'cognitive_task', label: 'Simple RT', color: '#6366F1', content: { trials: [], randomize: false } },
          { type: 'rest', label: 'Отдых', color: '#10B981', content: { duration: 10000 } },
          { type: 'debrief', label: 'Завершение', color: '#5C66BD', content: { text: 'Спасибо за участие!' } }
        ]
      },
      {
        id: 'go_nogo',
        label: 'Go / No-Go',
        sublabel: 'Тормозной контроль',
        desc: 'Реагируйте на целевые стимулы и подавляйте ответ на нецелевые. Измеряет тормозной контроль.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><circle cx="8" cy="12" r="3" stroke-width="2"/><path stroke-linecap="round" stroke-linejoin="round" d="M14 9l4 3-4 3"/><line x1="18" y1="12" x2="14" y2="12" stroke-linecap="round"/></svg>`,
        color: '#10B981',
        bg: 'rgba(16,185,129,.12)',
        tags: ['Ингибиция', '~10 мин', 'средний'],
        blocks: [
          { type: 'instructions', label: 'Инструкция', color: '#77A9E8', content: { text: 'Нажимайте пробел на зелёный сигнал (Go). На красный — не нажимайте (No-Go).' } },
          { type: 'fixation', label: 'Фиксация', color: '#94A3B8', content: { duration: 500 } },
          { type: 'cognitive_task', label: 'Go / No-Go', color: '#10B981', content: { trials: [], randomize: true } },
          { type: 'rest', label: 'Отдых', color: '#10B981', content: { duration: 15000 } },
          { type: 'debrief', label: 'Завершение', color: '#5C66BD', content: { text: 'Спасибо за участие!' } }
        ]
      },
      {
        id: 'stroop',
        label: 'Stroop',
        sublabel: 'Когнитивный контроль',
        desc: 'Называйте цвет, которым написано слово, игнорируя само слово. Классический тест когнитивного контроля и интерференции.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="7" width="18" height="10" rx="3" stroke-width="2"/><path stroke-linecap="round" d="M7 12h2M11 12h2M15 12h2"/></svg>`,
        color: '#F59E0B',
        bg: 'rgba(245,158,11,.12)',
        tags: ['Интерференция', '~12 мин', 'классика'],
        blocks: [
          { type: 'instructions', label: 'Инструкция', color: '#77A9E8', content: { text: 'Назовите цвет чернил, которым написано слово, как можно быстрее.' } },
          { type: 'fixation', label: 'Фиксация', color: '#94A3B8', content: { duration: 500 } },
          { type: 'cognitive_task', label: 'Stroop (практика)', color: '#F59E0B', content: { trials: [], randomize: true } },
          { type: 'rest', label: 'Пауза', color: '#10B981', content: { duration: 10000 } },
          { type: 'cognitive_task', label: 'Stroop (тест)', color: '#F59E0B', content: { trials: [], randomize: true } },
          { type: 'debrief', label: 'Завершение', color: '#5C66BD', content: { text: 'Спасибо за участие!' } }
        ]
      },
      {
        id: 'flanker',
        label: 'Flanker',
        sublabel: 'Фокус внимания',
        desc: 'Реагируйте на центральный стимул, игнорируя фланкеры. Оценивает избирательное внимание.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h2l2-3 2 6 2-6 2 3h2"/><line x1="3" y1="12" x2="5" y2="12" stroke-linecap="round"/><line x1="19" y1="12" x2="21" y2="12" stroke-linecap="round"/></svg>`,
        color: '#8B5CF6',
        bg: 'rgba(139,92,246,.12)',
        tags: ['Внимание', '~10 мин', 'средний'],
        blocks: [
          { type: 'instructions', label: 'Инструкция', color: '#77A9E8', content: { text: 'Реагируйте только на центральную стрелку, игнорируя боковые.' } },
          { type: 'fixation', label: 'Фиксация', color: '#94A3B8', content: { duration: 500 } },
          { type: 'cognitive_task', label: 'Flanker', color: '#8B5CF6', content: { trials: [], randomize: true } },
          { type: 'rest', label: 'Отдых', color: '#10B981', content: { duration: 15000 } },
          { type: 'debrief', label: 'Завершение', color: '#5C66BD', content: { text: 'Спасибо за участие!' } }
        ]
      },
      {
        id: 'nback',
        label: 'N-back',
        sublabel: 'Рабочая память',
        desc: 'Определяйте, совпадает ли текущий стимул со стимулом N шагов назад. Измеряет рабочую память.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><rect x="3" y="3" width="7" height="7" rx="2" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="2" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="2" stroke-width="2"/><rect x="14" y="14" width="7" height="7" rx="2" stroke-width="2" stroke-dasharray="3 2"/></svg>`,
        color: '#EC4899',
        bg: 'rgba(236,72,153,.12)',
        tags: ['Рабочая память', '~15 мин', 'сложный'],
        blocks: [
          { type: 'instructions', label: 'Инструкция', color: '#77A9E8', content: { text: 'Нажимайте пробел, если текущий стимул совпадает со стимулом 2 шага назад (2-back).' } },
          { type: 'fixation', label: 'Фиксация', color: '#94A3B8', content: { duration: 500 } },
          { type: 'cognitive_task', label: '1-Back (разминка)', color: '#EC4899', content: { trials: [], randomize: false } },
          { type: 'rest', label: 'Отдых', color: '#10B981', content: { duration: 20000 } },
          { type: 'cognitive_task', label: '2-Back (тест)', color: '#EC4899', content: { trials: [], randomize: false } },
          { type: 'debrief', label: 'Завершение', color: '#5C66BD', content: { text: 'Спасибо за участие!' } }
        ]
      },
      {
        id: 'pvt',
        label: 'PVT',
        sublabel: 'Сонливость',
        desc: 'Тест психомоторной бдительности. Реагируйте на счётчик при его появлении. Чувствителен к недосыпанию.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="9" stroke-width="2"/><path stroke-linecap="round" d="M12 7v5l3 3"/></svg>`,
        color: '#0EA5E9',
        bg: 'rgba(14,165,233,.12)',
        tags: ['Бдительность', '~10 мин', 'стандарт'],
        blocks: [
          { type: 'instructions', label: 'Инструкция', color: '#77A9E8', content: { text: 'Нажимайте пробел как можно быстрее, когда появится счётчик.' } },
          { type: 'fixation', label: 'Ожидание', color: '#94A3B8', content: { duration: 2000 } },
          { type: 'cognitive_task', label: 'PVT', color: '#0EA5E9', content: { trials: [], randomize: false } },
          { type: 'debrief', label: 'Завершение', color: '#5C66BD', content: { text: 'Спасибо за участие!' } }
        ]
      },
      {
        id: 'cpt',
        label: 'CPT',
        sublabel: 'Концентрация',
        desc: 'Непрерывный тест работоспособности. Реагируйте только на целевые стимулы в серии. Оценивает устойчивое внимание.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1" stroke-width="2"/><path stroke-linecap="round" d="M9 12h6M9 16h4"/></svg>`,
        color: '#F97316',
        bg: 'rgba(249,115,22,.12)',
        tags: ['Устойч. внимание', '~20 мин', 'клинич.'],
        blocks: [
          { type: 'instructions', label: 'Инструкция', color: '#77A9E8', content: { text: 'Нажимайте пробел только когда видите букву X после буквы A.' } },
          { type: 'fixation', label: 'Фиксация', color: '#94A3B8', content: { duration: 500 } },
          { type: 'cognitive_task', label: 'CPT (практика)', color: '#F97316', content: { trials: [], randomize: false } },
          { type: 'rest', label: 'Отдых', color: '#10B981', content: { duration: 30000 } },
          { type: 'cognitive_task', label: 'CPT (тест)', color: '#F97316', content: { trials: [], randomize: false } },
          { type: 'debrief', label: 'Завершение', color: '#5C66BD', content: { text: 'Спасибо за участие!' } }
        ]
      },
      {
        id: 'task_switching',
        label: 'Переключение задач',
        sublabel: 'Гибкость',
        desc: 'Чередуйте правила классификации стимулов. Оценивает когнитивную гибкость и стоимость переключения.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>`,
        color: '#14B8A6',
        bg: 'rgba(20,184,166,.12)',
        tags: ['Гибкость', '~15 мин', 'сложный'],
        blocks: [
          { type: 'instructions', label: 'Инструкция A', color: '#77A9E8', content: { text: 'Задача 1: классифицируйте стимул по цвету.' } },
          { type: 'cognitive_task', label: 'Блок A (цвет)', color: '#14B8A6', content: { trials: [], randomize: false } },
          { type: 'rest', label: 'Пауза', color: '#10B981', content: { duration: 5000 } },
          { type: 'instructions', label: 'Инструкция B', color: '#77A9E8', content: { text: 'Задача 2: классифицируйте стимул по форме.' } },
          { type: 'cognitive_task', label: 'Блок B (форма)', color: '#14B8A6', content: { trials: [], randomize: false } },
          { type: 'rest', label: 'Пауза', color: '#10B981', content: { duration: 5000 } },
          { type: 'cognitive_task', label: 'Смешанный блок', color: '#14B8A6', content: { trials: [], randomize: true } },
          { type: 'debrief', label: 'Завершение', color: '#5C66BD', content: { text: 'Спасибо за участие!' } }
        ]
      },
      {
        id: 'emotion_viewing',
        label: 'Просмотр эмоций',
        sublabel: 'Зрительное внимание',
        desc: 'Пассивный просмотр эмоциональных изображений или видео. Запись физиологических и поведенческих реакций.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="9" stroke-width="2"/><path stroke-linecap="round" d="M8.5 14s1 1.5 3.5 1.5 3.5-1.5 3.5-1.5"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/></svg>`,
        color: '#EF4444',
        bg: 'rgba(239,68,68,.12)',
        tags: ['Эмоции', 'Eye-tracking', 'пассивный'],
        blocks: [
          { type: 'instructions', label: 'Инструкция', color: '#77A9E8', content: { text: 'Просматривайте изображения. Старайтесь не двигаться и смотреть на экран.' } },
          { type: 'fixation', label: 'Фиксационный крест', color: '#94A3B8', content: { duration: 1000 } },
          { type: 'stimuli', label: 'Нейтральные стимулы', color: '#EF4444', content: { items: [] } },
          { type: 'rest', label: 'Отдых (30 с)', color: '#10B981', content: { duration: 30000 } },
          { type: 'stimuli', label: 'Эмоциональные стимулы', color: '#EF4444', content: { items: [] } },
          { type: 'questionnaire', label: 'SAM / Оценка', color: '#F59E0B', content: { questions: [] } },
          { type: 'debrief', label: 'Завершение', color: '#5C66BD', content: { text: 'Спасибо за участие!' } }
        ]
      },
      {
        id: 'scratch',
        label: 'Создать с нуля',
        sublabel: 'Свободная сборка',
        desc: 'Соберите эксперимент самостоятельно из блоков. Полный контроль над структурой протокола.',
        icon: `<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="26" height="26"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>`,
        color: '#5C66BD',
        bg: 'rgba(92,102,189,.12)',
        tags: ['Свободная структура', 'Все блоки'],
        isScratch: true
      }
    ];

    let selectedTemplates = [];

    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
        <!-- Header -->
        <div style="flex-shrink:0;padding:20px 24px 0;">
          <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:4px;">${trb('Выбор задачи','Task selection')}</div>
          <div style="font-size:13px;color:var(--muted);line-height:1.5;">${trb('Можно выбрать несколько задач: они будут добавлены в один эксперимент последовательно.','You can select multiple tasks: they will be added to one experiment sequentially.')}</div>
        </div>

        <!-- Cards grid scroll area -->
        <div id="s0grid" style="flex:1;overflow-y:auto;padding:16px 24px 8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;align-content:start;"></div>

        <!-- Footer -->
        <div style="flex-shrink:0;padding:12px 24px 16px;border-top:1px solid var(--stroke);display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <button id="step0Back" class="quick-btn" style="font-size:12px;">← Назад</button>
          <div id="s0hint" style="font-size:12px;color:var(--muted2);line-height:1.4;flex:1;">← ${trb('Выберите одну или несколько задач, чтобы продолжить','Select one or more tasks to continue')}</div>
          <button id="step0Next" class="quick-btn" style="opacity:.35;pointer-events:none;padding:9px 28px;font-weight:600;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);white-space:nowrap;">Далее →</button>
        </div>
      </div>
    `;

    const grid = canvasCol.querySelector('#s0grid');
    const nextBtn = canvasCol.querySelector('#step0Next');
    const backBtn = canvasCol.querySelector('#step0Back');
    const hintEl = canvasCol.querySelector('#s0hint');
    const selectedIds = () => new Set(selectedTemplates.map(t => t.id));
    const updateNextState = () => {
      nextBtn.style.opacity = selectedTemplates.length ? '1' : '.35';
      nextBtn.style.pointerEvents = selectedTemplates.length ? 'auto' : 'none';
    };

    function renderCards() {
      grid.innerHTML = '';
      TASK_TEMPLATES.forEach(tpl => {
        const card = document.createElement('div');
        const isSelected = selectedIds().has(tpl.id);
        card.style.cssText = [
          'display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:16px;cursor:pointer;',
          'border:2px solid ' + (isSelected ? 'var(--accent)' : 'var(--stroke)') + ';',
          'background:' + (isSelected ? 'rgba(92,102,189,.06)' : 'var(--card-bg)') + ';',
          'transition:border-color .12s, background .12s, box-shadow .12s;',
          'box-shadow:' + (isSelected ? '0 0 0 3px rgba(92,102,189,.14)' : '0 2px 8px rgba(92,102,189,.04)') + ';',
          'position:relative;overflow:hidden;'
        ].join('');

        // scratch gets a dashed border style
        const isScratch = !!tpl.isScratch;

        card.innerHTML = `
          ${isSelected ? `<div style="position:absolute;top:10px;right:10px;width:18px;height:18px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;">
            <svg fill="none" stroke="#fff" stroke-width="3" viewBox="0 0 24 24" width="10" height="10"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
          </div>` : ''}
          <div style="width:44px;height:44px;border-radius:12px;background:${tpl.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;color:${tpl.color};">
            ${tpl.icon}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${tpl.label}</div>
            <div style="font-size:10px;font-weight:600;color:${tpl.color};letter-spacing:.04em;margin-bottom:6px;">${tpl.sublabel}</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.45;">${tpl.desc}</div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;">
            ${tpl.tags.map(tag => `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:99px;background:${tpl.bg};color:${tpl.color};letter-spacing:.02em;">${tag}</span>`).join('')}
          </div>
          ${!isScratch && tpl.blocks ? `<div style="font-size:10px;color:var(--muted2);border-top:1px solid var(--stroke);padding-top:8px;margin-top:2px;">${tpl.blocks.length} ${trb('блоков в шаблоне','blocks in template')}</div>` : ''}
        `;

        card.addEventListener('mouseenter', () => {
          if (!isSelected) { card.style.borderColor = 'rgba(92,102,189,.35)'; card.style.background = 'rgba(92,102,189,.03)'; }
        });
        card.addEventListener('mouseleave', () => {
          if (!isSelected) { card.style.borderColor = 'var(--stroke)'; card.style.background = 'var(--card-bg)'; }
        });

        card.addEventListener('click', () => {
          selectedTemplates = isSelected
            ? selectedTemplates.filter(x => x.id !== tpl.id)
            : [...selectedTemplates, tpl];
          hintEl.innerHTML = selectedTemplates.length
            ? `<strong style="color:var(--text);">${trb('Выбрано:','Selected:')} ${selectedTemplates.length}</strong> — ${selectedTemplates.map(x => x.label).join(', ')}`
            : `← ${trb('Выберите одну или несколько задач, чтобы продолжить','Select one or more tasks to continue')}`;
          updateNextState();
          renderCards();
        });

        grid.appendChild(card);
      });
      setTimeout(() => applyAutoI18n(grid), 0);
    }

    renderCards();
    updateNextState();

    nextBtn.addEventListener('click', () => {
      if (!selectedTemplates.length) return;
      importMode = 'create';
      const templateSelections = selectedTemplates.filter(tpl => !tpl.isScratch);
      if (templateSelections.length) {
        ensureStandardStimuli();
        const mergedBlocks = templateSelections.flatMap((tpl, tplIndex) => {
          const blocks = readyProtocolForTemplate(tpl);
          const skipTypes = [...SYSTEM_BLOCK_TYPES, 'finish'];
          return blocks.filter(b => !skipTypes.includes(b.type));
        });
        const finalBlocks = [...mergedBlocks, { type:'finish', label:'Финальный экран', content:{ title:'Эксперимент завершен', text:'Спасибо за участие!' } }];
        experimentBlocks = finalBlocks.map((b, i) => ({
          id: 'block_' + Date.now() + '_' + i,
          type: b.type,
          label: b.label,
          color: b.color,
          content: b.content || {}
        }));
        localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
      } else {
        experimentBlocks = [];
        localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
      }
      currentStep = 2;
      renderStepper();
      renderCanvas();
    });
    backBtn.addEventListener('click', () => { currentStep = 0; renderStepper(); renderCanvas(); });
  }

  function renderStep1() {
    const shell = getParticipantShellMeta();
    canvasCol.innerHTML = `
      <div style="display:flex;gap:0;height:100%;overflow:hidden;">
        <!-- Block library palette -->
        <div style="width:196px;flex-shrink:0;border-right:1px solid var(--stroke);overflow-y:auto;padding:12px 10px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:var(--muted2);margin-bottom:10px;padding:0 2px;">Блоки</div>
          <div id="blockPalette" style="display:flex;flex-direction:column;gap:5px;"></div>
        </div>
        <!-- Timeline -->
        <div style="flex:1;display:flex;flex-direction:column;padding:14px;overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-shrink:0;">
            <div>
              <div style="font-size:14px;font-weight:700;color:var(--text);">Таймлайн протокола</div>
              <div id="participantShellHint" style="font-size:11px;color:var(--muted);line-height:1.45;margin-top:4px;max-width:720px;">
                ${describeParticipantShellForUi(shell)}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:10px 14px;margin-top:10px;max-width:720px;">
                <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="checkbox" id="shellConsent" ${shell.consent ? 'checked' : ''} style="accent-color:var(--accent);">
                  ${trb('Согласие','Consent')}
                </label>
                <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="checkbox" id="shellQuestionnaire" ${shell.questionnaire ? 'checked' : ''} style="accent-color:var(--accent);">
                  ${trb('Анкета','Questionnaire')}
                </label>
                <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="checkbox" id="shellPrecheck" ${shell.precheck ? 'checked' : ''} style="accent-color:var(--accent);">
                  ${trb('Пречек камеры','Camera pre-check')}
                </label>
                <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="checkbox" id="shellCalibration" ${shell.calibration ? 'checked' : ''} style="accent-color:var(--accent);">
                  ${trb('Калибровка взгляда','Gaze calibration')}
                </label>
              </div>
            </div>
          </div>
          <div id="protoCanvas" style="flex:1;overflow-y:auto;border:2px dashed var(--stroke);border-radius:14px;padding:10px;background:rgba(255,255,255,.2);min-height:200px;"></div>
          <div style="display:flex;justify-content:space-between;margin-top:10px;flex-shrink:0;">
            <button class="quick-btn" id="backBtn0" style="font-size:12px;">← Назад</button>
            <button class="quick-btn" id="nextBtn2" style="font-size:12px;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;">Далее →</button>
          </div>
        </div>
      </div>
    `;

    const palette = canvasCol.querySelector('#blockPalette');
    BLOCK_TYPES.filter(bt => !SYSTEM_BLOCK_TYPES.includes(bt.type)).forEach(bt => {
      const item = document.createElement('div');
      item.draggable = true;
      item.dataset.type = bt.type;
      item.style.cssText = 'display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:9px;border:1px solid var(--stroke);background:var(--card-bg);cursor:grab;font-size:11px;color:var(--text);';
      item.innerHTML = `
        <div style="width:22px;height:22px;border-radius:6px;background:${bt.color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg fill="none" stroke="${bt.color}" stroke-width="2" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="${bt.icon}"/></svg>
        </div>
        <span style="flex:1;line-height:1.3;">${bt.label}</span>
        <button data-type="${bt.type}" style="background:none;border:none;cursor:pointer;color:var(--muted2);display:flex;align-items:center;padding:1px;border-radius:4px;flex-shrink:0;" title="${trb('Добавить','Add')}">
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
        </button>
      `;
      item.querySelector('button').addEventListener('click', e => { e.stopPropagation(); addBlock(bt.type); });
      item.addEventListener('dragstart', e => e.dataTransfer.setData('blockType', bt.type));
      palette.appendChild(item);
    });

    renderCanvasBlocks();
    initDragDrop();

    function syncParticipantShellFromForm() {
      protocolMeta.participantShell = {
        consent: !!canvasCol.querySelector('#shellConsent')?.checked,
        questionnaire: !!canvasCol.querySelector('#shellQuestionnaire')?.checked,
        precheck: !!canvasCol.querySelector('#shellPrecheck')?.checked,
        calibration: !!canvasCol.querySelector('#shellCalibration')?.checked
      };
      const hint = canvasCol.querySelector('#participantShellHint');
      if (hint) hint.textContent = describeParticipantShellForUi(getParticipantShellMeta());
    }
    ['#shellConsent', '#shellQuestionnaire', '#shellPrecheck', '#shellCalibration'].forEach((sel) => {
      const el = canvasCol.querySelector(sel);
      if (el) el.addEventListener('change', syncParticipantShellFromForm);
    });

    canvasCol.querySelector('#backBtn0').addEventListener('click', () => {
      if (experimentId) { navigate('#/experiments'); return; }
      currentStep=1; renderStepper(); renderCanvas();
    });
    canvasCol.querySelector('#nextBtn2').addEventListener('click', () => {
      syncParticipantShellFromForm();
      currentStep=3; renderStepper(); renderCanvas();
    });
  }

  function showImportInterface() {
  // Очищаем canvasCol и вставляем UI импорта (аналогично renderStep2 из старой версии)
    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:18px;gap:14px;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
          <div>
            <div style="font-size:15px;font-weight:700;">Импорт эксперимента</div>
            <div style="font-size:11px;color:var(--muted);">Загрузите .psyexp или .json файл</div>
          </div>
        </div>
        <div id="imp_drop" style="border:2px dashed var(--stroke);border-radius:14px;padding:28px;text-align:center;cursor:pointer;background:rgba(255,255,255,.25);">
          <svg fill="none" stroke="var(--accent)" stroke-width="1.5" viewBox="0 0 24 24" width="38" height="38" style="margin:0 auto 10px;display:block;"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
          <div style="font-size:13px;font-weight:600;margin-bottom:3px;">Перетащите файл или нажмите для выбора</div>
          <div style="font-size:11px;color:var(--muted);">.psyexp · .json</div>
          <input type="file" id="imp_file" accept=".psyexp,.json" style="display:none;">
        </div>
        <div id="imp_info" style="display:none;padding:9px 12px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:9px;font-size:12px;"></div>
        <div id="imp_resources" style="display:none;">
          <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:5px;">CSV-файлы условий (необязательно)</div>
          <div id="imp_res_drop" style="border:2px dashed var(--stroke);border-radius:10px;padding:12px;text-align:center;cursor:pointer;font-size:11px;color:var(--muted);">
            <input type="file" id="imp_res_file" multiple accept=".csv" style="display:none;">Загрузить CSV
          </div>
          <div id="imp_res_list" style="margin-top:5px;font-size:11px;color:var(--muted);"></div>
        </div>
        <div id="imp_prog_area" style="display:none;">
          <div style="background:var(--stroke);border-radius:99px;height:5px;overflow:hidden;margin-bottom:5px;">
            <div id="imp_prog" style="width:0%;height:100%;background:var(--accent);border-radius:99px;transition:width .3s;"></div>
          </div>
          <div id="imp_prog_txt" style="font-size:11px;color:var(--muted);text-align:center;"></div>
        </div>
        <div id="imp_result" style="display:none;flex:1;overflow-y:auto;"></div>
        <div style="display:flex;justify-content:space-between;flex-shrink:0;padding-top:8px;border-top:1px solid var(--stroke);">
          <button class="quick-btn" id="imp_back_btn" style="font-size:12px;">← Назад</button>
          <button class="quick-btn" id="imp_start_btn" style="opacity:.35;pointer-events:none;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;font-size:12px;">Конвертировать</button>
          <button class="quick-btn" id="imp_open_btn" style="display:none;background:rgba(16,185,129,.1);border-color:rgba(16,185,129,.3);color:var(--good);font-weight:600;font-size:12px;">Открыть в конструкторе →</button>
        </div>
      </div>
    `;

    // Теперь настраиваем все обработчики (копируем из старого renderStep2)
    const drop = canvasCol.querySelector('#imp_drop');
    const fileInp = canvasCol.querySelector('#imp_file');
    const infoEl = canvasCol.querySelector('#imp_info');
    const resSec = canvasCol.querySelector('#imp_resources');
    const resDropEl = canvasCol.querySelector('#imp_res_drop');
    const resInp = canvasCol.querySelector('#imp_res_file');
    const resListEl = canvasCol.querySelector('#imp_res_list');
    const startBtn = canvasCol.querySelector('#imp_start_btn');
    const progArea = canvasCol.querySelector('#imp_prog_area');
    const progBar = canvasCol.querySelector('#imp_prog');
    const progTxt = canvasCol.querySelector('#imp_prog_txt');
    const resultDiv = canvasCol.querySelector('#imp_result');
    const openBtn = canvasCol.querySelector('#imp_open_btn');
    const backBtn = canvasCol.querySelector('#imp_back_btn');

    let importedType = null;

    backBtn.addEventListener('click', () => {
      // Возвращаемся к шагу 0 (выбор режима)
      currentStep = 0;
      renderStepper();
      renderCanvas();
    });

    function handleFile(file) {
      const n = file.name.toLowerCase();
      if (n.endsWith('.json')) importedType = 'json';
      else if (n.endsWith('.psyexp')) importedType = 'psyexp';
      else { toast('Неподдерживаемый формат'); return; }
      const reader = new FileReader();
      reader.onload = ev => {
        uploadedPsychoPyFile = ev.target.result;
        infoEl.style.display = 'block';
        infoEl.innerHTML = `<svg fill="none" stroke="var(--good)" stroke-width="2" viewBox="0 0 24 24" width="14" height="14" style="vertical-align:middle;margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>${file.name} (${(file.size/1024).toFixed(1)} KB)`;
        if (importedType === 'psyexp') resSec.style.display = 'block';
        startBtn.style.opacity='1'; startBtn.style.pointerEvents='auto';
      };
      reader.readAsText(file);
    }

    drop.addEventListener('click', () => fileInp.click());
    fileInp.addEventListener('change', e => { if(e.target.files[0]) handleFile(e.target.files[0]); });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor='var(--accent)'; });
    drop.addEventListener('dragleave', () => drop.style.borderColor='var(--stroke)');
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor='var(--stroke)'; if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

    resDropEl.addEventListener('click', () => resInp.click());
    resInp.addEventListener('change', e => {
      uploadedResources = {};
      resListEl.innerHTML = '';
      Array.from(e.target.files).forEach(f => {
        resListEl.innerHTML += `<div>📄 ${f.name}</div>`;
        const r = new FileReader(); r.onload = ev => { uploadedResources[f.name] = ev.target.result; }; r.readAsText(f);
      });
    });

    startBtn.addEventListener('click', async () => {
      if (!uploadedPsychoPyFile) return;
      startBtn.style.opacity='.35'; startBtn.style.pointerEvents='none';
      progArea.style.display='block'; resultDiv.style.display='none';
      const setP = async (pct, txt) => { progBar.style.width=pct+'%'; progTxt.textContent=txt; await new Promise(r=>setTimeout(r,280)); };
      try {
        await setP(15,'Чтение файла…');
        await setP(35,'Парсинг структуры…');
        let result;
        if (importedType === 'json') {
          const json = JSON.parse(uploadedPsychoPyFile);
          result = { json, stats: { blocks: json.blocks?.length||0, trials: 0 } };
        } else {
          result = parsePsyExp(uploadedPsychoPyFile, uploadedResources);
        }
        await setP(70,'Конвертация…');
        await setP(95,'Валидация…');
        await setP(100,'Готово ✓');
        parsedExperimentData = result;
        const { json, stats } = result;
        resultDiv.style.display = 'block';
        const totalTrials = (json.blocks||[]).filter(b=>b.type==='cognitive_task').reduce((a,b)=>a+(b.trials?.length||0),0);
        resultDiv.innerHTML = `
          <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;">Результат</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
            <div style="padding:10px;background:var(--card-bg);border-radius:9px;border:1px solid var(--stroke);text-align:center;">
              <div style="font-size:20px;font-weight:700;color:var(--accent);">${stats.blocks}</div>
              <div style="font-size:10px;color:var(--muted);">Блоков</div>
            </div>
            <div style="padding:10px;background:var(--card-bg);border-radius:9px;border:1px solid var(--stroke);text-align:center;">
              <div style="font-size:20px;font-weight:700;color:var(--accent);">${totalTrials}</div>
              <div style="font-size:10px;color:var(--muted);">Проб</div>
            </div>
          </div>
          ${(json.blocks||[]).map(b => {
            const meta = getMeta(b.type);
            return `<div style="display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:8px;background:var(--card-bg);border:1px solid var(--stroke);margin-bottom:5px;">
              <div style="width:20px;height:20px;border-radius:5px;background:${meta.color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg fill="none" stroke="${meta.color}" stroke-width="2" viewBox="0 0 24 24" width="11" height="11"><path stroke-linecap="round" stroke-linejoin="round" d="${meta.icon}"/></svg>
              </div>
              <div style="font-size:11px;"><b>${b.id}</b> <span style="color:var(--muted);">${b.type}${b.trials?' · '+b.trials.length+' проб':''}</span></div>
            </div>`;
          }).join('')}
        `;
        openBtn.style.display = 'block';
      } catch(err) {
        await setP(100,'Ошибка: '+err.message);
        progBar.style.background='var(--bad)';
      }
    });

    openBtn.addEventListener('click', () => {
      if (!parsedExperimentData) return;
      experimentBlocks = (parsedExperimentData.json.blocks||[]).map(b => ({
        ...b, label: getMeta(b.type).label,
        content: b.content || { title: b.id, text: '', buttonText: 'Далее' }
      }));
      localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
      currentStep = 2;
      renderStepper();
      renderCanvas();
    });
  }

  function addBlock(type) {
    const meta = getMeta(type);
    experimentBlocks.push({ id: type+'_'+Date.now(), type, label: meta.label, content: defaultContent(type) });
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
    renderCanvasBlocks();
  }

  function renderCanvasBlocks() {
    const canvas = canvasCol.querySelector('#protoCanvas');
    if (!canvas) return;
    if (experimentBlocks.length === 0) {
      canvas.innerHTML = `
        <div style="height:100%;min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted);text-align:center;gap:8px;pointer-events:none;">
          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="36" height="36" style="opacity:.35;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
          <div style="font-size:13px;font-weight:600;">${trb('Перетащите блоки сюда','Drag blocks here')}</div>
          <div style="font-size:11px;">${trb('или нажмите + рядом с блоком','or press + next to block')}</div>
        </div>`;
      return;
    }
    canvas.innerHTML = experimentBlocks.map((b, i) => {
      const meta = getMeta(b.type);
      const sel = b.id === selectedBlockId;
      const trialsCount = b.content?.trials?.length;
      const extraInfo = trialsCount ? ` · ${trialsCount} проб` : '';
      const blockLabel = localizedBlockLabel(b, meta.label);

      return `
        <div class="proto-card ${sel?'proto-card-sel':''}" data-id="${b.id}" data-idx="${i}" draggable="true"
          style="display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:11px;border:1px solid ${sel?'var(--accent)':'var(--stroke)'};background:${sel?'rgba(92,102,189,.07)':'var(--card-bg)'};cursor:pointer;margin-bottom:6px;position:relative;">
          <div style="width:28px;height:28px;border-radius:8px;background:${meta.color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg fill="none" stroke="${meta.color}" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="${meta.icon}"/></svg>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${blockLabel}</div>
            ${extraInfo ? `<div style="font-size:10px;color:var(--muted);">${extraInfo}</div>` : ''}
          </div>
          <div style="display:flex;gap:2px;flex-shrink:0;">
            <button class="pcbtn up-btn" data-idx="${i}" title="Вверх" ${i===0?'disabled':''} style="background:none;border:none;cursor:pointer;color:var(--muted2);padding:3px;border-radius:5px;">
              <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>
            </button>
            <button class="pcbtn dn-btn" data-idx="${i}" title="Вниз" ${i===experimentBlocks.length-1?'disabled':''} style="background:none;border:none;cursor:pointer;color:var(--muted2);padding:3px;border-radius:5px;">
              <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <button class="pcbtn del-btn" data-id="${b.id}" title="Удалить" style="background:none;border:none;cursor:pointer;color:var(--muted2);padding:3px;border-radius:5px;">
              <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');

    canvas.querySelectorAll('.proto-card').forEach(card => {
      card.addEventListener('click', e => { if(e.target.closest('.pcbtn')) return; showBlockInspector(card.dataset.id); renderCanvasBlocks(); });
      card.addEventListener('dragstart', e => {
        if (e.target.closest('.pcbtn')) { e.preventDefault(); return; }
        e.dataTransfer.setData('protocolBlockIndex', card.dataset.idx);
        card.style.opacity = '.55';
      });
      card.addEventListener('dragend', () => { card.style.opacity = ''; });
      card.addEventListener('dragover', e => {
        const dragTypes = Array.from(e.dataTransfer.types || []).map(x => String(x).toLowerCase());
        if (dragTypes.includes('protocolblockindex')) {
          e.preventDefault();
          card.style.borderColor = 'var(--accent)';
        }
      });
      card.addEventListener('dragleave', () => { card.style.borderColor = ''; });
      card.addEventListener('drop', e => {
        const fromRaw = e.dataTransfer.getData('protocolBlockIndex');
        if (fromRaw === '') return;
        e.preventDefault();
        e.stopPropagation();
        const from = parseInt(fromRaw);
        const to = parseInt(card.dataset.idx);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
        const [moved] = experimentBlocks.splice(from, 1);
        experimentBlocks.splice(to, 0, moved);
        localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
        renderCanvasBlocks();
      });
    });
    canvas.querySelectorAll('.up-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); const i=parseInt(btn.dataset.idx); if(i>0){[experimentBlocks[i-1],experimentBlocks[i]]=[experimentBlocks[i],experimentBlocks[i-1]]; renderCanvasBlocks();} });
    });
    canvas.querySelectorAll('.dn-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); const i=parseInt(btn.dataset.idx); if(i<experimentBlocks.length-1){[experimentBlocks[i],experimentBlocks[i+1]]=[experimentBlocks[i+1],experimentBlocks[i]]; renderCanvasBlocks();} });
    });
    canvas.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation();
        experimentBlocks = experimentBlocks.filter(b => b.id !== btn.dataset.id);
        if (selectedBlockId === btn.dataset.id) { selectedBlockId = null; clearInspector(); }
        localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
        renderCanvasBlocks();
        toast(trb('Блок удалён','Block deleted'));
      });
    });

    setTimeout(() => applyAutoI18n(), 0);
  }

  function initDragDrop() {
    const canvas = canvasCol.querySelector('#protoCanvas');
    if (!canvas) return;
    canvas.addEventListener('dragover', e => { e.preventDefault(); canvas.style.borderColor='var(--accent)'; });
    canvas.addEventListener('dragleave', () => { canvas.style.borderColor='var(--stroke)'; });
    canvas.addEventListener('drop', e => {
      e.preventDefault(); canvas.style.borderColor='var(--stroke)';
      const t = e.dataTransfer.getData('blockType');
      if (t) addBlock(t);
    });
  }

  function renderStep2() {
    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:18px;gap:14px;overflow-y:auto;"></div>
        <div style="display:flex;justify-content:flex-start;margin-top:auto;padding-top:20px;flex-shrink:0;">
          <button class="quick-btn" id="imp_back" style="font-size:12px;">← Назад</button>
          </div>
        </div>
          <div>
            <div style="font-size:15px;font-weight:700;">Импорт эксперимента</div>
            <div style="font-size:11px;color:var(--muted);">Загрузите .psyexp или .json файл</div>
          </div>
        </div>
        <div id="imp_drop" style="border:2px dashed var(--stroke);border-radius:14px;padding:28px;text-align:center;cursor:pointer;background:rgba(255,255,255,.25);">
          <svg fill="none" stroke="var(--accent)" stroke-width="1.5" viewBox="0 0 24 24" width="38" height="38" style="margin:0 auto 10px;display:block;"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
          <div style="font-size:13px;font-weight:600;margin-bottom:3px;">Перетащите файл или нажмите для выбора</div>
          <div style="font-size:11px;color:var(--muted);">.psyexp · .json</div>
          <input type="file" id="imp_file" accept=".psyexp,.json" style="display:none;">
        </div>
        <div id="imp_info" style="display:none;padding:9px 12px;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:9px;font-size:12px;"></div>
        <div id="imp_resources" style="display:none;">
          <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:5px;">CSV-файлы условий (необязательно)</div>
          <div id="imp_res_drop" style="border:2px dashed var(--stroke);border-radius:10px;padding:12px;text-align:center;cursor:pointer;font-size:11px;color:var(--muted);">
            <input type="file" id="imp_res_file" multiple accept=".csv" style="display:none;">Загрузить CSV
          </div>
          <div id="imp_res_list" style="margin-top:5px;font-size:11px;color:var(--muted);"></div>
        </div>
        <div id="imp_prog_area" style="display:none;">
          <div style="background:var(--stroke);border-radius:99px;height:5px;overflow:hidden;margin-bottom:5px;">
            <div id="imp_prog" style="width:0%;height:100%;background:var(--accent);border-radius:99px;transition:width .3s;"></div>
          </div>
          <div id="imp_prog_txt" style="font-size:11px;color:var(--muted);text-align:center;"></div>
        </div>
        <div id="imp_result" style="display:none;flex:1;overflow-y:auto;"></div>
        <div style="display:flex;justify-content:space-between;flex-shrink:0;padding-top:8px;border-top:1px solid var(--stroke);">
          <button class="quick-btn" id="imp_start_btn" style="opacity:.35;pointer-events:none;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;font-size:12px;">Конвертировать</button>
          <button class="quick-btn" id="imp_open_btn" style="display:none;background:rgba(16,185,129,.1);border-color:rgba(16,185,129,.3);color:var(--good);font-weight:600;font-size:12px;">Открыть в конструкторе →</button>
        </div>
      </div>
    `;

    const drop = canvasCol.querySelector('#imp_drop');
    const fileInp = canvasCol.querySelector('#imp_file');
    const infoEl = canvasCol.querySelector('#imp_info');
    const resSec = canvasCol.querySelector('#imp_resources');
    const resDropEl = canvasCol.querySelector('#imp_res_drop');
    const resInp = canvasCol.querySelector('#imp_res_file');
    const resListEl = canvasCol.querySelector('#imp_res_list');
    const startBtn = canvasCol.querySelector('#imp_start_btn');
    const progArea = canvasCol.querySelector('#imp_prog_area');
    const progBar = canvasCol.querySelector('#imp_prog');
    const progTxt = canvasCol.querySelector('#imp_prog_txt');
    const resultDiv = canvasCol.querySelector('#imp_result');
    const openBtn = canvasCol.querySelector('#imp_open_btn');

    let importedType = null;

    canvasCol.querySelector('#imp_back').addEventListener('click', () => { currentStep=0; renderStepper(); renderCanvas(); });

    function handleFile(file) {
      const n = file.name.toLowerCase();
      if (n.endsWith('.json')) importedType = 'json';
      else if (n.endsWith('.psyexp')) importedType = 'psyexp';
      else { toast('Неподдерживаемый формат'); return; }
      const reader = new FileReader();
      reader.onload = ev => {
        uploadedPsychoPyFile = ev.target.result;
        infoEl.style.display = 'block';
        infoEl.innerHTML = `<svg fill="none" stroke="var(--good)" stroke-width="2" viewBox="0 0 24 24" width="14" height="14" style="vertical-align:middle;margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>${file.name} (${(file.size/1024).toFixed(1)} KB)`;
        if (importedType === 'psyexp') resSec.style.display = 'block';
        startBtn.style.opacity='1'; startBtn.style.pointerEvents='auto';
      };
      reader.readAsText(file);
    }

    drop.addEventListener('click', () => fileInp.click());
    fileInp.addEventListener('change', e => { if(e.target.files[0]) handleFile(e.target.files[0]); });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor='var(--accent)'; });
    drop.addEventListener('dragleave', () => drop.style.borderColor='var(--stroke)');
    drop.addEventListener('drop', e => { e.preventDefault(); drop.style.borderColor='var(--stroke)'; if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

    resDropEl.addEventListener('click', () => resInp.click());
    resInp.addEventListener('change', e => {
      uploadedResources = {};
      resListEl.innerHTML = '';
      Array.from(e.target.files).forEach(f => {
        resListEl.innerHTML += `<div>📄 ${f.name}</div>`;
        const r = new FileReader(); r.onload = ev => { uploadedResources[f.name] = ev.target.result; }; r.readAsText(f);
      });
    });

    startBtn.addEventListener('click', async () => {
      if (!uploadedPsychoPyFile) return;
      startBtn.style.opacity='.35'; startBtn.style.pointerEvents='none';
      progArea.style.display='block'; resultDiv.style.display='none';
      const setP = async (pct, txt) => { progBar.style.width=pct+'%'; progTxt.textContent=txt; await new Promise(r=>setTimeout(r,280)); };
      try {
        await setP(15,'Чтение файла…');
        await setP(35,'Парсинг структуры…');
        let result;
        if (importedType === 'json') {
          const json = JSON.parse(uploadedPsychoPyFile);
          result = { json, stats: { blocks: json.blocks?.length||0, trials: 0 } };
        } else {
          result = parsePsyExp(uploadedPsychoPyFile, uploadedResources);
        }
        await setP(70,'Конвертация…');
        await setP(95,'Валидация…');
        await setP(100,'Готово ✓');
        parsedExperimentData = result;
        const { json, stats } = result;
        resultDiv.style.display = 'block';
        const totalTrials = (json.blocks||[]).filter(b=>b.type==='cognitive_task').reduce((a,b)=>a+(b.trials?.length||0),0);
        resultDiv.innerHTML = `
          <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;">Результат</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
            <div style="padding:10px;background:var(--card-bg);border-radius:9px;border:1px solid var(--stroke);text-align:center;">
              <div style="font-size:20px;font-weight:700;color:var(--accent);">${stats.blocks}</div>
              <div style="font-size:10px;color:var(--muted);">Блоков</div>
            </div>
            <div style="padding:10px;background:var(--card-bg);border-radius:9px;border:1px solid var(--stroke);text-align:center;">
              <div style="font-size:20px;font-weight:700;color:var(--accent);">${totalTrials}</div>
              <div style="font-size:10px;color:var(--muted);">Проб</div>
            </div>
          </div>
          ${(json.blocks||[]).map(b => {
            const meta = getMeta(b.type);
            return `<div style="display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:8px;background:var(--card-bg);border:1px solid var(--stroke);margin-bottom:5px;">
              <div style="width:20px;height:20px;border-radius:5px;background:${meta.color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg fill="none" stroke="${meta.color}" stroke-width="2" viewBox="0 0 24 24" width="11" height="11"><path stroke-linecap="round" stroke-linejoin="round" d="${meta.icon}"/></svg>
              </div>
              <div style="font-size:11px;"><b>${b.id}</b> <span style="color:var(--muted);">${b.type}${b.trials?' · '+b.trials.length+' проб':''}</span></div>
            </div>`;
          }).join('')}
        `;
        openBtn.style.display = 'block';
      } catch(err) {
        await setP(100,'Ошибка: '+err.message);
        progBar.style.background='var(--bad)';
      }
    });

    openBtn.addEventListener('click', () => {
      if (!parsedExperimentData) return;
      experimentBlocks = (parsedExperimentData.json.blocks||[]).map(b => ({
        ...b, label: getMeta(b.type).label,
        content: b.content || { title: b.id, text: '', buttonText: 'Далее' }
      }));
      localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
      currentStep = 2; renderStepper(); renderCanvas();
    });
  }

  function renderStep2Stimuli() {
    const stimuliBlocks = experimentBlocks.filter(b => b.type === 'cognitive_task' || b.type === 'passive');
    canvasCol.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'padding:16px 18px 10px;flex-shrink:0;border-bottom:1px solid var(--stroke);';
    header.innerHTML = `
      <div style="font-size:17px;font-weight:800;color:var(--text);"><span>${trb('Стимулы и Таблицы проб','Stimuli and Trial Tables')}</span></div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px;"><span>${trb('Настройте логику показа стимулов (Trials) для каждого блока','Configure stimulus presentation logic (Trials) for each block')}</span></div>
    `;
    wrapper.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:16px;';

    const uploadPanel = document.createElement('div');
    uploadPanel.style.cssText = 'border:2px dashed var(--stroke);border-radius:14px;padding:16px;background:rgba(92,102,189,.04);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;';
    uploadPanel.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;min-width:260px;flex:1;">
        <div style="width:38px;height:38px;border-radius:12px;background:rgba(92,102,189,.12);display:flex;align-items:center;justify-content:center;color:var(--accent);flex-shrink:0;">
          <svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 4v12m0-12l-4 4m4-4l4 4"/></svg>
        </div>
        <div>
          <div style="font-size:13px;font-weight:800;color:var(--text);">Загрузить стимулы в библиотеку</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">Перетащите файлы сюда или выберите файлы/папку с компьютера. После загрузки стимулы появятся в библиотеке.</div>
          <div id="builderUploadStatus" style="font-size:11px;color:var(--accent);margin-top:6px;display:none;font-weight:700;"></div>
          <div id="builderUploadProgressWrap" style="display:none;margin-top:8px;width:min(360px,100%);height:6px;border-radius:999px;background:rgba(92,102,189,.12);overflow:hidden;">
            <div id="builderUploadProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg,var(--accent),#77A9E8);border-radius:999px;transition:width .18s ease;"></div>
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="quick-btn" id="builderStimuliFileBtn" style="font-size:12px;background:var(--card-bg);border-color:var(--stroke);">Выбрать файлы</button>
        <button class="quick-btn" id="builderStimuliFolderBtn" style="font-size:12px;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:700;">Открыть папку</button>
        <input id="builderStimuliFileInput" type="file" multiple accept="image/*,video/*,audio/*,.txt,.csv,.json" style="display:none;">
        <input id="builderStimuliFolderInput" type="file" multiple webkitdirectory directory style="display:none;">
      </div>
    `;
    body.appendChild(uploadPanel);

    if (stimuliBlocks.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted);text-align:center;font-size:13px;margin-top:24px;padding:28px;border:1px dashed var(--stroke);border-radius:12px;';
      emptyState.textContent = trb('В протоколе нет блоков, требующих настройки стимулов.','No blocks requiring stimulus setup in the protocol.');
      body.appendChild(emptyState);
    } else {
      stimuliBlocks.forEach(block => {
        const meta = getMeta(block.type);
        const trialsCount = (block.content?.trials || []).reduce((sum, trial) => sum + (parseInt(trial.repetitions) || 1), 0);

        const folderName = folders.find(f => f.id === block.content.stimuliFolder)?.name || `<span>${trb('Не выбрана','Not selected')}</span>`;
        const sourceHtml = block.content?.stimuliSource === 'folder'
          ? `<span>${trb('Папка:','Folder:')}</span> <span style="color:var(--text);">${folderName}</span>`
          : `<span>${trb('Вся библиотека','Entire library')}</span>`;

        const section = document.createElement('div');
        section.style.cssText = 'border:1px solid var(--stroke);border-radius:12px;padding:16px;background:var(--card-bg);display:flex;align-items:center;justify-content:space-between;';

        section.innerHTML = `
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <div style="width:26px;height:26px;border-radius:7px;background:${meta.color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg fill="none" stroke="${meta.color}" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="${meta.icon}"/></svg>
              </div>
              <div style="font-size:15px;font-weight:700;color:var(--text);">${localizedBlockLabel(block, meta.label)}</div>
            </div>
            <div style="font-size:12px;color:var(--muted);display:flex;gap:12px;align-items:center;">
              <span><b style="color:var(--text);">${trialsCount}</b> <span>проб</span></span>
              <span style="color:var(--stroke);">|</span>
              <span><span>${trb('Источник:','Source:')}</span> ${sourceHtml}</span>
              ${block.content?.useFixation ? `<span style="color:var(--stroke);">|</span><span style="color:var(--accent);">${trb('Есть фиксация (+)','Has fixation (+)')}</span>` : ''}
            </div>
          </div>
          <button class="quick-btn open-trials-btn" style="background:var(--accent);border-color:var(--accent);color:white;font-weight:600;font-size:13px;padding:8px 16px;">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16" style="margin-right:6px;"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            <span>${trb('Таблица проб','Trial table')}</span>
          </button>
        `;

        section.querySelector('.open-trials-btn').addEventListener('click', () => {
          showTrialTableModal(block, () => renderStep2Stimuli());
        });

        body.appendChild(section);
      });
    }
    wrapper.appendChild(body);

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:space-between;padding:12px 18px;flex-shrink:0;border-top:1px solid var(--stroke);';
    footer.innerHTML = `
      <button class="quick-btn" id="s2Back2" style="font-size:12px;">← Назад</button>
      <button class="quick-btn" id="s2Next" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;font-size:12px;">Далее →</button>
    `;
    wrapper.appendChild(footer);
    canvasCol.appendChild(wrapper);

    wrapper.querySelector('#s2Back2').addEventListener('click', () => { currentStep--; renderStepper(); renderCanvas(); });
    wrapper.querySelector('#s2Next').addEventListener('click', () => { currentStep++; renderStepper(); renderCanvas(); });

    const fileInput = wrapper.querySelector('#builderStimuliFileInput');
    const folderInput = wrapper.querySelector('#builderStimuliFolderInput');
    const statusEl = wrapper.querySelector('#builderUploadStatus');
    const progressWrap = wrapper.querySelector('#builderUploadProgressWrap');
    const progressBar = wrapper.querySelector('#builderUploadProgressBar');
    const fileTypeFromUpload = (file) => {
      if (file.type.startsWith('image/')) return 'image';
      if (file.type.startsWith('video/')) return 'video';
      if (file.type.startsWith('audio/')) return 'audio';
      if (file.type.startsWith('text/') || /\.(txt|csv|json)$/i.test(file.name)) return 'text';
      if (/\.(pptx?|key)$/i.test(file.name) || file.type.includes('presentation')) return 'slides';
      return 'other';
    };
    const uploadBuilderStimuli = async (fileList) => {
      const files = Array.from(fileList || []).filter(Boolean);
      if (!files.length) return;
      const setUploadProgress = (done, total, isComplete = false) => {
        const pct = total ? Math.round((done / total) * 100) : 0;
        if (statusEl) {
          statusEl.style.display = 'block';
          statusEl.style.color = isComplete ? 'var(--good)' : 'var(--accent)';
          statusEl.textContent = isComplete
            ? `${trb('Загружено','Uploaded')} ${done} ${trb('из','of')} ${total} ${trb('файлов','files')}`
            : `${trb('Загружено','Uploaded')} ${done} ${trb('из','of')} ${total} ${trb('файлов','files')}`;
        }
        if (progressWrap) progressWrap.style.display = 'block';
        if (progressBar) progressBar.style.width = pct + '%';
      };
      setUploadProgress(0, files.length);
      let completed = 0;
      if (fileInput) fileInput.disabled = true;
      if (folderInput) folderInput.disabled = true;
      wrapper.querySelector('#builderStimuliFileBtn').disabled = true;
      wrapper.querySelector('#builderStimuliFolderBtn').disabled = true;
      uploadPanel.style.pointerEvents = 'none';
      const uploaded = await Promise.all(files.map(file => new Promise(resolve => {
        const reader = new FileReader();
        const finish = (item) => {
          completed += 1;
          setUploadProgress(completed, files.length);
          resolve(item);
        };
        reader.onload = ev => finish({
          id: 'stim_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
          name: file.webkitRelativePath || file.name,
          type: fileTypeFromUpload(file),
          url: ev.target.result,
          info: (file.size / 1024).toFixed(1) + ' KB',
          createdAt: new Date().toISOString()
        });
        reader.onerror = () => finish(null);
        reader.readAsDataURL(file);
      })));
      uploadPanel.style.pointerEvents = '';
      wrapper.querySelector('#builderStimuliFileBtn').disabled = false;
      wrapper.querySelector('#builderStimuliFolderBtn').disabled = false;
      if (fileInput) fileInput.disabled = false;
      if (folderInput) folderInput.disabled = false;
      const newItems = uploaded.filter(Boolean);
      if (!newItems.length) {
        if (statusEl) {
          statusEl.style.color = 'var(--bad)';
          statusEl.textContent = `${trb('Не удалось загрузить файлы','Could not upload files')}`;
        }
        return;
      }
      setUploadProgress(newItems.length, files.length, true);
      stimuliList = [...newItems, ...stimuliList];
      localStorage.setItem('emocog_stimuli', JSON.stringify(stimuliList));
      toast(`${trb('Добавлено стимулов:','Stimuli added:')} ${newItems.length}`);
      setTimeout(() => renderStep2Stimuli(), 900);
    };

    wrapper.querySelector('#builderStimuliFileBtn')?.addEventListener('click', () => fileInput?.click());
    wrapper.querySelector('#builderStimuliFolderBtn')?.addEventListener('click', () => folderInput?.click());
    fileInput?.addEventListener('change', (e) => {
      uploadBuilderStimuli(e.target.files);
      e.target.value = '';
    });
    folderInput?.addEventListener('change', (e) => {
      uploadBuilderStimuli(e.target.files);
      e.target.value = '';
    });
    uploadPanel.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadPanel.style.borderColor = 'var(--accent)';
      uploadPanel.style.background = 'rgba(92,102,189,.08)';
    });
    uploadPanel.addEventListener('dragleave', () => {
      uploadPanel.style.borderColor = 'var(--stroke)';
      uploadPanel.style.background = 'rgba(92,102,189,.04)';
    });
    uploadPanel.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadPanel.style.borderColor = 'var(--stroke)';
      uploadPanel.style.background = 'rgba(92,102,189,.04)';
      uploadBuilderStimuli(e.dataTransfer.files);
    });
    setTimeout(() => applyAutoI18n(wrapper), 0);
  }

  function renderPlaceholder(stepIdx) {
    const s = STEPS[stepIdx];
    const isLast = stepIdx === STEPS.length - 1;
    const isPreview = stepIdx === 5;
    const isQC = stepIdx === 6; // QC rules step
    const isAnalyticsStep = stepIdx === 7;

    if (isLast) {
      renderFinishStep();
      return;
    }
    if (isPreview) {
      renderExperimentPreviewStep();
      return;
    }
    if (isQC) {
      renderQCStep();
      return;
    }
    if (isAnalyticsStep) {
      renderAnalyticsStep();
      return;
    }

    canvasCol.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;padding:18px;gap:14px;">
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
        <div style="font-size:18px;font-weight:800;color:var(--text);">${s}</div>
      </div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;border:2px dashed var(--stroke);border-radius:14px;background:rgba(255,255,255,.2);color:var(--muted);text-align:center;flex-direction:column;gap:10px;">
        <div style="font-size:14px;font-weight:600;color:var(--text);">${s}</div>
        <div style="font-size:12px;max-width:260px;">${trb('Этот шаг находится в разработке.','This step is in development.')}</div>
      </div>

      ${isLast ? `
        <div style="display:flex; flex-direction:column; gap:6px; margin-top:10px;">
          <label for="experimentNameInput" style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em;">Имя эксперимента</label>
          <input type="text" id="experimentNameInput" placeholder="Например: Тест памяти на лица" style="padding:10px 14px; border-radius:10px; border:1px solid var(--stroke); background:var(--card-bg); font-size:14px; font-weight:600; color:var(--text); outline:none; width:100%; max-width:400px;" value="${editingExp ? editingExp.title : ''}">
        </div>
      ` : ''}

      <div style="display:flex;justify-content:space-between;flex-shrink:0;padding-top:10px;border-top:1px solid var(--stroke);">
        <button class="quick-btn" id="phBack2" style="font-size:12px;">← Назад</button>
        ${isLast
          ? `<button class="quick-btn" id="phSave" style="background:rgba(16,185,129,.1);border-color:rgba(16,185,129,.3);color:var(--good);font-weight:700;font-size:13px;">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
              Сохранить протокол
            </button>`
          : `<button class="quick-btn" id="phNext" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;font-size:12px;">Далее →</button>`}
      </div>
    </div>
  `;
    canvasCol.querySelectorAll('#phBack2').forEach(b => b.addEventListener('click', () => { currentStep--; renderStepper(); renderCanvas(); }));
    canvasCol.querySelector('#phNext')?.addEventListener('click', () => { currentStep++; renderStepper(); renderCanvas(); });
    canvasCol.querySelector('#phSave')?.addEventListener('click', saveProtocol);
  }

  function participantProtocolLink() {
    const protocolId = (protocolMeta.protocolId || 'protocol').trim();
    const builderKey = experimentId || 'draft';
    const apiState = typeof loadBuilderApiState === 'function' ? loadBuilderApiState(builderKey) : {};
    const code = apiState.invitationCode || protocolId;
    if (typeof window.buildParticipantRunLink === 'function') {
      return window.buildParticipantRunLink(code);
    }
    return (window.location.origin || '') + '/invite/' + encodeURIComponent(code);
  }

  function showProtocolPreview() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,0.65);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:rgba(255,255,255,0.97);border:1px solid var(--stroke);border-radius:18px;padding:20px;width:720px;max-width:96vw;max-height:84vh;display:flex;flex-direction:column;gap:14px;box-shadow:0 24px 70px rgba(10,15,35,.28);';
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-size:17px;font-weight:800;color:var(--text);">${protocolMeta.title || 'Предпросмотр эксперимента'}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">Protocol ID: <code>${protocolMeta.protocolId || '—'}</code> · ${experimentBlocks.length} блоков</div>
        </div>
        <button id="previewCloseBtn" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;">×</button>
      </div>
      <div style="overflow:auto;border:1px solid var(--stroke);border-radius:12px;background:rgba(255,255,255,.42);padding:10px;display:flex;flex-direction:column;gap:8px;">
        ${experimentBlocks.map((b, i) => {
          const trials = (b.content?.trials || []).reduce((sum, tr) => sum + (parseInt(tr.repetitions) || 1), 0);
          return `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:10px;background:var(--card-bg);border:1px solid var(--stroke);">
            <div style="width:24px;height:24px;border-radius:50%;background:rgba(92,102,189,.12);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;">${i+1}</div>
            <div style="min-width:0;">
              <div style="font-size:13px;font-weight:800;color:var(--text);">${b.label || b.type}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">${b.type}${b.content?.taskType ? ' · ' + b.content.taskType : ''}${trials ? ' · ' + trials + ' проб' : ''}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => applyAutoI18n(modal), 0);
    const close = () => document.body.removeChild(overlay);
    modal.querySelector('#previewCloseBtn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }

  function renderFinishStep() {
    const link = participantProtocolLink();
    const shell = getParticipantShellMeta();
    const shellLine = describeParticipantShellForUi(shell);
    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:18px;gap:14px;overflow-y:auto;">
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--text);">${trb('Завершение','Finish')}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px;">${trb('Проверьте эксперимент и нажмите «Сохранить протокол» — протокол опубликуется в API, ссылка станет рабочей.','Review the experiment and click “Save protocol” to publish to the API and activate the invite link.')}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div style="padding:14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);">
            <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${trb('Эксперимент','Experiment')}</div>
            <div style="font-size:16px;font-weight:800;color:var(--text);margin-top:6px;">${protocolMeta.title || '—'}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px;">${protocolMeta.estimatedDuration || '—'} · ${experimentBlocks.length} блоков</div>
          </div>
          <div style="padding:14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);">
            <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Protocol ID</div>
            <code style="display:block;font-size:14px;color:var(--accent);margin-top:8px;word-break:break-all;">${protocolMeta.protocolId || '—'}</code>
          </div>
        </div>
        <div style="padding:14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:13px;font-weight:800;color:var(--text);">${trb('Ссылка для участников','Participant link')}</div>
          <div style="font-size:11px;color:var(--muted);line-height:1.45;">${shellLine}</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="participantLinkInput" readonly value="${link}" style="flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:rgba(255,255,255,.62);font-size:12px;color:var(--text);font-family:var(--mono);">
            <button class="quick-btn" id="copyParticipantLinkBtn" style="font-size:12px;">${trb('Скопировать','Copy')}</button>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:auto;padding-top:10px;border-top:1px solid var(--stroke);">
          <button class="quick-btn" id="finishBackBtn" style="font-size:12px;">← Назад</button>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="quick-btn" id="finishSaveProtocolBtn" style="min-width:158px;justify-content:center;padding:9px 14px;background:rgba(16,185,129,.1);border-color:rgba(16,185,129,.3);color:var(--good);font-weight:800;font-size:12px;">Сохранить протокол</button>
          </div>
        </div>
      </div>
    `;
    canvasCol.querySelector('#finishSaveProtocolBtn').addEventListener('click', saveProtocol);
    canvasCol.querySelector('#finishBackBtn').addEventListener('click', () => { currentStep--; renderStepper(); renderCanvas(); });
    canvasCol.querySelector('#copyParticipantLinkBtn').addEventListener('click', async () => {
      const input = canvasCol.querySelector('#participantLinkInput');
      try {
        await navigator.clipboard.writeText(input.value);
        toast(trb('Ссылка скопирована','Link copied'));
      } catch (_) {
        input.select();
        document.execCommand('copy');
        toast(trb('Ссылка скопирована','Link copied'));
      }
    });
  }

  function previewableExperimentBlocks() {
    return experimentBlocks.filter(b => !SYSTEM_BLOCK_TYPES.includes(b.type));
  }

  function stimulusNameById(stimulusId) {
    return stimuliList.find(s => String(s.id) === String(stimulusId))?.name || stimulusId || '—';
  }

  function previewEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[ch]));
  }

  function previewStimulusById(stimulusId) {
    return stimuliList.find(s => String(s.id) === String(stimulusId)) || null;
  }

  function previewActionLabel(action) {
    return ({
      mouse_click:'Клик мышью',
      space:'Пробел',
      arrow_up:trb('стрелка вверх','arrow up'),
      arrow_down:trb('стрелка вниз','arrow down'),
      arrow_right:trb('стрелка вправо','arrow right'),
      arrow_left:trb('стрелка влево','arrow left')
    })[action] || action || trb('ответ не требуется','no response required');
  }

  function previewColorFromId(id, fallback = '#0f172a') {
    const value = String(id || '').toLowerCase();
    if (value.includes('green')) return '#16a34a';
    if (value.includes('blue')) return '#2563eb';
    if (value.includes('red')) return '#dc2626';
    if (value.includes('yellow')) return '#f59e0b';
    return fallback;
  }

  function renderPreviewStimulus(stimulus, trial = {}) {
    if (!stimulus) {
      return `<div style="color:var(--bad);font-size:14px;font-weight:700;">${trb('Стимул не найден','Stimulus not found')}</div>`;
    }

    const id = String(stimulus.id || '');
    const name = previewEscape(stimulus.name || stimulus.text || id);
    const url = stimulus.url || stimulus.src;

    if (stimulus.type === 'image' && url) {
      return `<img src="${previewEscape(url)}" alt="${name}" style="max-width:min(72vw,620px);max-height:48vh;object-fit:contain;border-radius:14px;box-shadow:0 12px 36px rgba(15,23,42,.16);">`;
    }
    if (stimulus.type === 'video' && url) {
      return `<video src="${previewEscape(url)}" controls autoplay muted style="max-width:min(72vw,620px);max-height:48vh;border-radius:14px;box-shadow:0 12px 36px rgba(15,23,42,.16);"></video>`;
    }
    if (stimulus.type === 'audio' && url) {
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
        <div style="width:88px;height:88px;border-radius:24px;background:rgba(92,102,189,.12);display:flex;align-items:center;justify-content:center;font-size:36px;color:var(--accent);">♪</div>
        <audio src="${previewEscape(url)}" controls autoplay></audio>
      </div>`;
    }

    if (id === 'std_simple_black_square') {
      return `<div style="width:120px;height:120px;background:#020617;border-radius:10px;box-shadow:0 14px 34px rgba(2,6,23,.22);"></div>`;
    }
    if (id === 'std_go_green_circle' || id === 'std_nogo_red_circle') {
      return `<div style="width:140px;height:140px;border-radius:999px;background:${previewColorFromId(id)};box-shadow:0 16px 34px ${previewColorFromId(id)}44;"></div>`;
    }
    if (id.startsWith('std_stroop_')) {
      const raw = id.replace('std_stroop_', '').split('_');
      const wordMap = CURRENT_LANG === 'en'
        ? { red:'RED', blue:'BLUE', green:'GREEN' }
        : { red:'КРАСНЫЙ', blue:'СИНИЙ', green:'ЗЕЛЕНЫЙ' };
      const ink = raw[1] || raw[0];
      return `<div style="font-size:clamp(48px,9vw,92px);font-weight:900;letter-spacing:.04em;color:${previewColorFromId(ink)};">${wordMap[raw[0]] || name}</div>`;
    }
    if (id.startsWith('std_flanker_')) {
      const text = (stimulus.name || '').split(':').pop()?.trim() || stimulus.text || name;
      return `<div style="font-size:clamp(54px,10vw,100px);font-weight:900;letter-spacing:.08em;color:#0f172a;">${previewEscape(text)}</div>`;
    }
    if (id.startsWith('std_nback_')) {
      const shape = id.replace('std_nback_', '');
      if (shape === 'circle') return `<div style="width:130px;height:130px;border-radius:999px;background:#5c66bd;"></div>`;
      if (shape === 'square') return `<div style="width:130px;height:130px;border-radius:16px;background:#5c66bd;"></div>`;
      if (shape === 'triangle') return `<div style="width:0;height:0;border-left:76px solid transparent;border-right:76px solid transparent;border-bottom:132px solid #5c66bd;"></div>`;
      if (shape === 'diamond') return `<div style="width:120px;height:120px;background:#5c66bd;transform:rotate(45deg);border-radius:12px;"></div>`;
    }
    if (id === 'std_pvt_counter') {
      return `<div style="font-family:var(--mono);font-size:clamp(56px,10vw,104px);font-weight:900;color:#dc2626;">000</div>`;
    }
    if (id.startsWith('std_cpt_') || id.startsWith('std_switch_')) {
      const text = stimulus.text || (stimulus.name || '').split(':').pop()?.trim() || name;
      return `<div style="font-size:clamp(58px,11vw,110px);font-weight:900;letter-spacing:.08em;color:#0f172a;">${previewEscape(text)}</div>`;
    }
    if (id.startsWith('std_emo_')) {
      const emotion = previewEscape(stimulus.emotion || (stimulus.name || '').split(':').pop()?.trim() || 'emotion');
      return `<div style="width:min(340px,70vw);aspect-ratio:4/3;border-radius:24px;background:linear-gradient(135deg,rgba(92,102,189,.18),rgba(119,169,232,.20));border:1px solid rgba(92,102,189,.24);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#0f172a;">
        <div style="font-size:76px;line-height:1;">◉‿◉</div>
        <div style="font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;">${emotion}</div>
      </div>`;
    }

    const text = stimulus.text || stimulus.label || stimulus.name || trial.stimulusId || trb('Стимул','Stimulus');
    return `<div style="font-size:clamp(42px,8vw,86px);font-weight:900;color:#0f172a;text-align:center;line-height:1.12;">${previewEscape(text)}</div>`;
  }

  function expandPreviewTrials(block) {
    let rows = [];
    (block.content?.trials || []).forEach((trial, trialIndex) => {
      const reps = Math.max(1, parseInt(trial.repetitions) || 1);
      for (let rep = 0; rep < reps; rep++) {
        rows.push({ ...trial, _trialIndex: trialIndex, _repIndex: rep });
      }
    });
    if (block.content?.randomize) {
      rows = rows
        .map(row => ({ row, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(item => item.row);
    }
    return rows;
  }

  function previewDurationMs(value, fallback = 1000) {
    const n = parseInt(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function previewBlockStimuliStrip(block) {
    if (block.type !== 'cognitive_task') return '';
    const seen = [];
    (block.content?.trials || []).forEach(trial => {
      if (trial.stimulusId && !seen.includes(String(trial.stimulusId))) seen.push(String(trial.stimulusId));
    });
    if (!seen.length) return '';
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      ${seen.slice(0, 6).map(id => {
        const stim = previewStimulusById(id);
        return `<div title="${previewEscape(stim?.name || id)}" style="width:56px;height:44px;border:1px solid var(--stroke);border-radius:10px;background:rgba(255,255,255,.72);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:4px;">
          <div style="transform:scale(.36);transform-origin:center;display:flex;align-items:center;justify-content:center;min-width:140px;min-height:110px;">${renderPreviewStimulus(stim, { stimulusId:id })}</div>
        </div>`;
      }).join('')}
      ${seen.length > 6 ? `<div style="height:44px;padding:0 10px;border:1px solid var(--stroke);border-radius:10px;display:flex;align-items:center;color:var(--muted);font-size:11px;">+${seen.length - 6}</div>` : ''}
    </div>`;
  }

  function previewBlockSummary(block) {
    if (block.type === 'instruction') return localizedInstructionValue(block.content, 'text', trb('Инструкция без текста','Instruction without text'));
    if (block.type === 'cognitive_task') {
      const trials = block.content?.trials || [];
      const total = trials.reduce((sum, tr) => sum + (parseInt(tr.repetitions) || 1), 0);
      const first = trials[0];
      return `${block.content?.taskType || 'cognitive_task'} · ${total} проб${first ? ` · ${trb('первый стимул:','first stimulus:')} ` + stimulusNameById(first.stimulusId) : ''}`;
    }
    if (block.type === 'rest') return `${trb('Пауза','Pause')}: ${block.content?.duration || 30} сек.`;
    if (block.type === 'finish') return block.content?.text || trb('Финальный экран','Finish screen');
    return block.type;
  }

  function runUserExperimentPreview() {
    const blocks = previewableExperimentBlocks();
    if (!blocks.length) {
      toast(trb('Нет блоков для предпросмотра','No blocks to preview'));
      return;
    }

    const screens = [];
    blocks.forEach((block, blockIndex) => {
      if (block.type === 'instruction') {
        screens.push({
          kind:'instruction',
          block,
          blockIndex,
          manual:true,
          title:localizedInstructionValue(block.content, 'title', block.label || trb('Инструкция','Instruction')),
          text:localizedInstructionValue(block.content, 'text', trb('Инструкция без текста','Instruction without text'))
        });
        return;
      }

      if (block.type === 'rest') {
        screens.push({
          kind:'rest',
          block,
          blockIndex,
          duration:previewDurationMs(block.content?.duration, 30) * (previewDurationMs(block.content?.duration, 30) < 1000 ? 1000 : 1),
          title:localizedBlockLabel(block, trb('Пауза','Pause')),
          text:block.content?.text || trb('Сделайте небольшой перерыв','Take a short break')
        });
        return;
      }

      if (block.type === 'finish') {
        screens.push({
          kind:'finish',
          block,
          blockIndex,
          manual:true,
          title:block.content?.title || localizedBlockLabel(block, trb('Завершение','Finish')),
          text:block.content?.text || trb('Спасибо за участие!','Thank you for participating!')
        });
        return;
      }

      if (block.type !== 'cognitive_task') {
        screens.push({
          kind:'generic',
          block,
          blockIndex,
          manual:true,
          title:localizedBlockLabel(block, block.type),
          text:previewBlockSummary(block)
        });
        return;
      }

      const trials = expandPreviewTrials(block);
      if (!trials.length) {
        screens.push({
          kind:'emptyTask',
          block,
          blockIndex,
          manual:true,
          title:localizedBlockLabel(block, 'Задача на время реакции'),
          text:trb('В этом блоке пока нет trials.','This block does not have trials yet.')
        });
        return;
      }

      trials.forEach((trial, trialIndex) => {
        const fixationMin = parseInt(trial.fixationMin);
        const fixationMax = parseInt(trial.fixationMax);
        const hasRandomFixation = Number.isFinite(fixationMin) && fixationMin > 0 && Number.isFinite(fixationMax) && fixationMax >= fixationMin;
        const fixationDuration = hasRandomFixation
          ? Math.round(fixationMin + Math.random() * (fixationMax - fixationMin))
          : previewDurationMs(trial.fixationDuration || block.content?.fixationDuration, 500);
        const randomItiMin = parseInt(trial.randomItiMin);
        const randomItiMax = parseInt(trial.randomItiMax);
        if (Number.isFinite(randomItiMin) && randomItiMin > 0 && Number.isFinite(randomItiMax) && randomItiMax >= randomItiMin) {
          screens.push({ kind:'blank', block, blockIndex, trial, trialIndex, totalTrials:trials.length, duration:Math.round(randomItiMin + Math.random() * (randomItiMax - randomItiMin)), label:trb('Ожидание','Waiting') });
        }
        if (block.content?.useFixation || trial.fixationDuration || hasRandomFixation) {
          screens.push({ kind:'fixation', block, blockIndex, trial, trialIndex, totalTrials:trials.length, duration:fixationDuration });
        }
        if (trial.cue) {
          screens.push({ kind:'cue', block, blockIndex, trial, trialIndex, totalTrials:trials.length, duration:previewDurationMs(trial.cueDuration, 200) });
        }
        const stimulusDuration = previewDurationMs(trial.duration || block.content?.stimulusDuration || block.content?.rtWindow, 1000);
        screens.push({ kind:'stimulus', block, blockIndex, trial, trialIndex, totalTrials:trials.length, duration:stimulusDuration });
        const responseWindow = parseInt(trial.responseWindow || block.content?.rtWindow);
        if (Number.isFinite(responseWindow) && responseWindow > stimulusDuration) {
          screens.push({ kind:'responseWindow', block, blockIndex, trial, trialIndex, totalTrials:trials.length, duration:responseWindow - stimulusDuration });
        }
        const iti = parseInt(trial.iti || block.content?.iti);
        if (Number.isFinite(iti) && iti > 0) {
          screens.push({ kind:'blank', block, blockIndex, trial, trialIndex, totalTrials:trials.length, duration:iti, label:'ITI' });
        }
      });
    });

    let idx = 0;
    let speed = 1;
    let timer = null;
    let closed = false;
    let feedbackActive = false;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,.88);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'width:min(980px,96vw);height:min(760px,92vh);background:#fff;border:1px solid var(--stroke);border-radius:22px;box-shadow:0 28px 80px rgba(10,15,35,.36);display:flex;flex-direction:column;overflow:hidden;';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => {
      closed = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('keydown', handleKeydown);
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
    };

    const goToIndex = (nextIdx) => {
      if (nextIdx >= screens.length) {
        close();
        toast(trb('Предпросмотр завершен','Preview completed'));
        return;
      }
      idx = nextIdx;
      render();
    };

    const next = () => {
      goToIndex(idx + 1);
    };

    const previous = () => {
      if (idx > 0) {
        idx -= 1;
        render();
      }
    };

    const previewExpectedAction = (screen) => screen.trial?.action || screen.trial?.correctResponse || '';
    const isPreviewResponseScreen = (screen) => screen?.kind === 'stimulus' || screen?.kind === 'responseWindow';
    const shouldPreviewFeedback = (screen) => {
      if (!isPreviewResponseScreen(screen) || !screen.trial || screen.block?.type !== 'cognitive_task') return false;
      return screen.block?.content?.useRT !== false;
    };
    const isSamePreviewTrial = (a, b) => a?.block === b?.block && a?.trialIndex === b?.trialIndex && a?.trial === b?.trial;
    const hasNextResponseWindow = (screen) => isSamePreviewTrial(screen, screens[idx + 1]) && screens[idx + 1]?.kind === 'responseWindow';
    const responseAdvanceIndex = (screen) => {
      let nextIdx = idx + 1;
      while (isSamePreviewTrial(screen, screens[nextIdx]) && screens[nextIdx]?.kind === 'responseWindow') nextIdx += 1;
      return nextIdx;
    };
    const previewFeedbackText = (screen, isCorrect) => {
      const trial = screen.trial || {};
      const blockContent = screen.block?.content || {};
      const fallback = isCorrect ? trb('Верно!','Correct!') : trb('Ошибка!','Error!');
      const text = isCorrect
        ? (blockContent.feedbackCorrect || fallback)
        : (blockContent.feedbackIncorrect || fallback);
      return autoTranslateString(text, CURRENT_LANG);
    };
    const showPreviewFeedback = (screen, isCorrect, nextIdx = responseAdvanceIndex(screen)) => {
      if (!shouldPreviewFeedback(screen) || feedbackActive) {
        goToIndex(nextIdx);
        return;
      }
      feedbackActive = true;
      if (timer) clearTimeout(timer);
      const text = previewFeedbackText(screen, isCorrect);
      const color = isCorrect ? 'var(--good)' : 'var(--bad)';
      const icon = isCorrect ? '✓' : '×';
      const stage = modal.querySelector('#previewStage');
      if (stage) {
        stage.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;">
          <div style="width:86px;height:86px;border-radius:999px;background:${isCorrect ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)'};color:${color};display:flex;align-items:center;justify-content:center;font-size:52px;font-weight:900;">${icon}</div>
          <div style="font-size:clamp(28px,5vw,48px);font-weight:900;color:${color};line-height:1.12;">${previewEscape(text)}</div>
        </div>`;
      }
      timer = setTimeout(() => {
        feedbackActive = false;
        goToIndex(nextIdx);
      }, Math.max(350, Math.round(700 / speed)));
    };

    const responseMatches = (screen, event) => {
      const action = screen.trial?.action || screen.trial?.correctResponse || '';
      if (!action) return false;
      const key = event.key.toLowerCase();
      if (action === 'space') return key === ' ';
      if (action === 'arrow_up') return key === 'arrowup';
      if (action === 'arrow_down') return key === 'arrowdown';
      if (action === 'arrow_left') return key === 'arrowleft';
      if (action === 'arrow_right') return key === 'arrowright';
      return false;
    };
    const isSupportedPreviewKey = (event) => [' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(event.key.toLowerCase());

    function handleKeydown(event) {
      if (closed || feedbackActive) return;
      const screen = screens[idx];
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key === 'Enter' && screen?.manual) {
        next();
        return;
      }
      if (shouldPreviewFeedback(screen) && isSupportedPreviewKey(event)) {
        event.preventDefault();
        showPreviewFeedback(screen, responseMatches(screen, event));
      }
    }

    window.addEventListener('keydown', handleKeydown);

    const screenMeta = (screen) => {
      const trialText = typeof screen.trialIndex === 'number'
        ? `${trb('Проба','Trial')} ${screen.trialIndex + 1} / ${screen.totalTrials}`
        : `${trb('Блок','Block')} ${screen.blockIndex + 1} / ${blocks.length}`;
      return `${trialText} · ${screen.block?.label || screen.block?.type || trb('Блок','Block')}`;
    };

    const renderStage = (screen) => {
      if (screen.kind === 'instruction' || screen.kind === 'finish' || screen.kind === 'generic' || screen.kind === 'emptyTask') {
        return `<div style="max-width:720px;text-align:left;">
          <div style="font-size:28px;font-weight:900;color:#0f172a;margin-bottom:18px;">${previewEscape(screen.title)}</div>
          <div style="font-size:18px;line-height:1.65;color:#334155;white-space:pre-wrap;">${previewEscape(screen.text)}</div>
        </div>`;
      }
      if (screen.kind === 'rest') {
        return `<div style="text-align:center;">
          <div style="font-size:26px;font-weight:900;color:#0f172a;margin-bottom:10px;">${previewEscape(screen.title)}</div>
          <div style="font-size:17px;color:#475569;">${previewEscape(screen.text)}</div>
        </div>`;
      }
      if (screen.kind === 'fixation') {
        return `<div style="font-size:clamp(64px,11vw,120px);font-weight:300;color:#0f172a;line-height:1;">+</div>`;
      }
      if (screen.kind === 'blank') {
        return `<div style="font-size:18px;color:#64748b;font-weight:700;">${previewEscape(screen.label || trb('Пустой экран','Blank screen'))}</div>`;
      }
      if (screen.kind === 'cue') {
        const cueColor = previewColorFromId(screen.trial?.cue, '#5c66bd');
        return `<div style="width:min(520px,72vw);height:280px;border-radius:24px;background:${cueColor};display:flex;align-items:center;justify-content:center;box-shadow:0 20px 54px ${cueColor}44;">
          <div style="font-size:22px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:.1em;">${previewEscape(screen.trial?.cue || 'cue')}</div>
        </div>`;
      }
      if (screen.kind === 'responseWindow') {
        return `<div style="text-align:center;color:#64748b;">
          <div style="font-size:18px;font-weight:800;margin-bottom:8px;">${trb('Окно ответа','Response window')}</div>
          <div style="font-size:14px;">${trb('Ожидаемый ответ:','Expected response:')} ${previewEscape(previewActionLabel(screen.trial?.action || screen.trial?.correctResponse))}</div>
        </div>`;
      }
      const stimulus = previewStimulusById(screen.trial?.stimulusId);
      return renderPreviewStimulus(stimulus, screen.trial);
    };

    const render = () => {
      if (timer) clearTimeout(timer);
      feedbackActive = false;
      const screen = screens[idx];
      const isTimed = !screen.manual && screen.duration;
      const effectiveDuration = isTimed ? Math.max(60, Math.round(screen.duration / speed)) : 0;
      const progressPct = screens.length > 1 ? (idx / (screens.length - 1)) * 100 : 100;
      modal.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--stroke);">
          <div>
            <div style="font-size:12px;color:var(--muted);font-weight:700;">${trb('Экран','Screen')} ${idx + 1} / ${screens.length}</div>
            <div style="font-size:18px;font-weight:800;color:var(--text);margin-top:2px;">${screenMeta(screen)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;">${trb('Скорость','Speed')}
              <select id="previewSpeed" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);background:#fff;">
                ${[1,2,5,10].map(v => `<option value="${v}" ${speed === v ? 'selected' : ''}>${v}x</option>`).join('')}
              </select>
            </label>
            <button id="previewRunClose" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;">×</button>
          </div>
        </div>
        <div style="height:4px;background:rgba(92,102,189,.10);">
          <div style="height:100%;width:${progressPct}%;background:linear-gradient(90deg,var(--accent),#77A9E8);"></div>
        </div>
        <div style="flex:1;min-height:0;padding:22px;display:flex;flex-direction:column;gap:14px;">
          <div id="previewStage" style="flex:1;min-height:320px;border:1px solid var(--stroke);border-radius:18px;background:${screen.trial?.cue ? previewColorFromId(screen.trial.cue, '#fff') + '12' : 'rgba(255,255,255,.74)'};padding:28px;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;cursor:${shouldPreviewFeedback(screen) ? 'pointer' : 'default'};">
            ${renderStage(screen)}
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--muted);font-size:12px;line-height:1.45;">
            <div>
              ${screen.trial ? `${trb('Стимул:','Stimulus:')} ${previewEscape(stimulusNameById(screen.trial.stimulusId))} · ${trb('Условие:','Condition:')} ${previewEscape(screen.trial.condition || '—')} · ${trb('Ответ:','Response:')} ${previewEscape(previewActionLabel(screen.trial.action || screen.trial.correctResponse))}` : trb('Системные обязательные блоки в этом предпросмотре не показываются.','Required system blocks are not shown in this preview.')}
            </div>
            <div style="white-space:nowrap;">${isTimed ? `${screen.duration} ${trb('мс','ms')}${speed > 1 ? ` · ${speed}x` : ''}` : trb('ручной переход','manual transition')}</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px;padding:14px 18px;border-top:1px solid var(--stroke);">
          <button class="quick-btn" id="previewRunBack" ${idx === 0 ? 'disabled' : ''}>← Назад</button>
          <div style="display:flex;gap:8px;">
            ${isTimed ? `<button class="quick-btn" id="previewRunPause">${trb('Пауза','Pause')}</button>` : ''}
            <button class="quick-btn" id="previewRunNext" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:700;">${idx === screens.length - 1 ? trb('Завершить','Finish') : (screen.manual ? 'Далее →' : trb('Пропустить →','Skip →'))}</button>
          </div>
        </div>
      `;
      modal.querySelector('#previewRunClose').addEventListener('click', close);
      modal.querySelector('#previewRunBack').addEventListener('click', previous);
      modal.querySelector('#previewRunNext').addEventListener('click', next);
      modal.querySelector('#previewStage')?.addEventListener('click', () => {
        if (!shouldPreviewFeedback(screen) || feedbackActive) return;
        showPreviewFeedback(screen, previewExpectedAction(screen) === 'mouse_click');
      });
      modal.querySelector('#previewSpeed').addEventListener('change', (e) => {
        speed = parseInt(e.target.value) || 1;
        render();
      });
      modal.querySelector('#previewRunPause')?.addEventListener('click', () => {
        if (timer) clearTimeout(timer);
        timer = null;
      });
      setTimeout(() => applyAutoI18n(modal), 0);
      if (isTimed) {
        timer = setTimeout(() => {
          if (shouldPreviewFeedback(screen) && !hasNextResponseWindow(screen)) {
            showPreviewFeedback(screen, !previewExpectedAction(screen), idx + 1);
          } else {
            next();
          }
        }, effectiveDuration);
      }
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    render();
  }

  function renderExperimentPreviewStep() {
    const blocks = previewableExperimentBlocks();
    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:18px;gap:14px;overflow-y:auto;">
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--text);">${trb('Предпросмотр','Preview')}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px;">${trb('Запустите пользовательскую часть эксперимента без обязательных системных блоков, чтобы проверить инструкции, порядок и настройки задач.','The user part of the experiment can be previewed without required system blocks to check instructions, order, and task settings.')}</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button class="quick-btn" id="runUserPreviewBtn" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:800;">▶ ${trb('Запустить предпросмотр','Start preview')}</button>
          <span style="font-size:12px;color:var(--muted);">${blocks.length} ${trb('блоков в пользовательской части','user part blocks')}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${blocks.length ? blocks.map((b, i) => `
            <div style="display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);">
              <div style="width:24px;height:24px;border-radius:50%;background:rgba(92,102,189,.12);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;">${i+1}</div>
              <div>
                <div style="font-size:13px;font-weight:800;color:var(--text);">${b.label || b.type}</div>
                <div style="font-size:11px;color:var(--muted);margin-top:3px;">${previewBlockSummary(b)}</div>
                ${previewBlockStimuliStrip(b)}
              </div>
            </div>
          `).join('') : `<div style="font-size:13px;color:var(--muted);padding:24px;border:1px dashed var(--stroke);border-radius:12px;text-align:center;">${trb('Добавьте блоки на шаге протокола, чтобы запустить предпросмотр.','Add blocks on the protocol step to run preview.')}</div>`}
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:auto;padding-top:10px;border-top:1px solid var(--stroke);">
          <button class="quick-btn" id="previewStepBackBtn" style="font-size:12px;">← Назад</button>
          <button class="quick-btn" id="previewStepNextBtn" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:700;font-size:12px;">Далее →</button>
        </div>
      </div>
    `;
    canvasCol.querySelector('#runUserPreviewBtn').addEventListener('click', runUserExperimentPreview);
    canvasCol.querySelector('#previewStepBackBtn').addEventListener('click', () => { currentStep--; renderStepper(); renderCanvas(); });
    canvasCol.querySelector('#previewStepNextBtn').addEventListener('click', () => { currentStep++; renderStepper(); renderCanvas(); });
  }

  function renderQCStep() {
    // Load saved QC thresholds or defaults
    const qcKey = 'emocog_qc_thresholds_' + (experimentId || 'draft');
    let qc = JSON.parse(localStorage.getItem(qcKey) || 'null') || {
      gazeValid: { enabled: true, threshold: 70, hardStop: false },
      faceDetected: { enabled: true, threshold: 80, hardStop: true },
      fpsStable: { enabled: true, threshold: 25, hardStop: false },
      lighting: { enabled: true, threshold: 60, hardStop: false },
    };

    canvasCol.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;padding:18px;gap:14px;overflow-y:auto;';
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--text);">${trb('Правила контроля качества','Quality Control Rules')}</div>
          <div style="font-size:12px;color:var(--muted);">${trb('Пороговые значения контроля качества','Quality control thresholds')}</div>
        </div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;gap:12px;overflow-y:auto;">
        ${[
          { key:'gazeValid', label:trb('Взгляд валиден','Gaze valid'), unit:'%', min:0, max:100, hint:trb('Минимальный % кадров с валидным взглядом','Minimum % of frames with valid gaze'), yellowFrom:51, greenFrom:70 },
          { key:'faceDetected', label:trb('Лицо обнаружено','Face detected'), unit:'%', min:0, max:100, hint:trb('Минимальный % кадров с обнаруженным лицом','Minimum % of frames with face detected'), yellowFrom:51, greenFrom:80 },
          { key:'fpsStable', label:trb('FPS стабилен','FPS stable'), unit:'fps', min:0, max:60, hint:trb('Минимальный FPS для стабильной записи','Minimum FPS for stable recording'), yellowFrom:16, greenFrom:25 },
          { key:'lighting', label:trb('Освещение','Lighting'), unit:'%', min:0, max:100, hint:trb('Минимальное качество освещения (0–100)','Minimum lighting quality (0-100)'), yellowFrom:51, greenFrom:70 },
        ].map(param => `
          <div style="padding:14px 16px;background:var(--card-bg);border:1px solid var(--stroke);border-radius:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--text);">${param.label}</div>
                <div style="font-size:11px;color:var(--muted);">${param.hint}</div>
              </div>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <input type="checkbox" class="qc-enabled" data-key="${param.key}" ${qc[param.key].enabled?'checked':''} style="width:auto;">
                <span style="font-size:11px;color:var(--muted);">${trb('Активно','Active')}</span>
              </label>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-size:11px;color:var(--muted);min-width:60px;">${trb('Порог:','Threshold:')}</span>
              <input type="range" class="qc-range" data-key="${param.key}" min="${param.min}" max="${param.max}" step="1"
                value="${qc[param.key].threshold}"
                style="flex:1;height:8px;cursor:pointer;border-radius:999px;appearance:none;-webkit-appearance:none;background:linear-gradient(90deg,#ef4444 0%, #ef4444 ${(((param.yellowFrom - param.min) / (param.max - param.min)) * 100).toFixed(2)}%, #f59e0b ${(((param.yellowFrom - param.min) / (param.max - param.min)) * 100).toFixed(2)}%, #f59e0b ${(((param.greenFrom - param.min) / (param.max - param.min)) * 100).toFixed(2)}%, #22c55e ${(((param.greenFrom - param.min) / (param.max - param.min)) * 100).toFixed(2)}%, #22c55e 100%);"
                oninput="this.nextElementSibling.textContent=this.value+'${param.unit}'">
              <span style="font-size:13px;font-weight:700;color:var(--accent);min-width:48px;">${qc[param.key].threshold}${param.unit}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
              <input type="checkbox" class="qc-hardstop" data-key="${param.key}" ${qc[param.key].hardStop?'checked':''} style="width:auto;">
              <label style="font-size:11px;color:var(--muted);cursor:pointer;">${trb('Hard stop (прервать сессию при нарушении)','Hard stop (abort session)')}</label>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;flex-shrink:0;padding-top:10px;border-top:1px solid var(--stroke);">
        <button class="quick-btn" id="qcBack2" style="font-size:12px;">← Назад</button>
        <button class="quick-btn" id="qcNext" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;font-size:12px;">Далее →</button>
      </div>
    `;
    canvasCol.appendChild(wrap);

    function saveQC() {
      wrap.querySelectorAll('.qc-enabled').forEach(cb => { qc[cb.dataset.key].enabled = cb.checked; });
      wrap.querySelectorAll('.qc-range').forEach(r => { qc[r.dataset.key].threshold = parseInt(r.value); });
      wrap.querySelectorAll('.qc-hardstop').forEach(cb => { qc[cb.dataset.key].hardStop = cb.checked; });
      localStorage.setItem(qcKey, JSON.stringify(qc));
    }
    wrap.querySelectorAll('#qcBack2').forEach(b => b.addEventListener('click', () => { saveQC(); currentStep--; renderStepper(); renderCanvas(); }));
    wrap.querySelector('#qcNext').addEventListener('click', () => { saveQC(); currentStep++; renderStepper(); renderCanvas(); });
  }

  function renderAnalyticsStep() {
    const analyticsKey = 'emocog_analytics_config_' + (experimentId || 'draft');
    const cfg = JSON.parse(localStorage.getItem(analyticsKey) || 'null') || {
      perParticipantSessionQuality: true,
      groupAnalytics: true,
      dataQuality: true
    };
    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:18px;gap:14px;">
        <div style="font-size:18px;font-weight:800;color:var(--text);">Аналитика</div>
        <div style="font-size:12px;color:var(--muted);">Отметьте, какая аналитика вам нужна.</div>
        <div style="display:flex;flex-direction:column;gap:10px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);padding:12px;">
          <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text);"><input id="anPerParticipant" type="checkbox" ${cfg.perParticipantSessionQuality ? 'checked' : ''}>Качество сессии по каждому участнику</label>
          <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text);"><input id="anGroupAnalytics" type="checkbox" ${cfg.groupAnalytics ? 'checked' : ''}>Групповая аналитика</label>
          <label style="display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text);"><input id="anDataQuality" type="checkbox" ${cfg.dataQuality ? 'checked' : ''}>Качество данных</label>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:10px;border-top:1px solid var(--stroke);margin-top:auto;">
          <button class="quick-btn" id="analyticsBackBtn" style="font-size:12px;">← Назад</button>
          <button class="quick-btn" id="analyticsNextBtn" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;font-size:12px;">Далее →</button>
        </div>
      </div>
    `;
    function saveAnalyticsStep() {
      localStorage.setItem(analyticsKey, JSON.stringify({
        perParticipantSessionQuality: !!canvasCol.querySelector('#anPerParticipant').checked,
        groupAnalytics: !!canvasCol.querySelector('#anGroupAnalytics').checked,
        dataQuality: !!canvasCol.querySelector('#anDataQuality').checked
      }));
    }
    canvasCol.querySelector('#analyticsBackBtn').addEventListener('click', () => { saveAnalyticsStep(); currentStep--; renderStepper(); renderCanvas(); });
    canvasCol.querySelector('#analyticsNextBtn').addEventListener('click', () => { saveAnalyticsStep(); currentStep++; renderStepper(); renderCanvas(); });
  }

  //сохранение черновика
  function saveDraft() {
    const metaFromForm = canvasCol.querySelector('#metaTitle') ? getProtocolMetaFromForm() : protocolMeta;
    protocolMeta = { ...protocolMeta, ...metaFromForm };
    const expTitle = protocolMeta.title || editingExp?.title || trb('Черновик эксперимента','Experiment draft');

    const experiments = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];
    const id = experimentId || 'exp_' + Date.now();
    const userBlocks = experimentBlocks.filter(b => !SYSTEM_BLOCK_TYPES.includes(b.type));

    const entry = {
      id,
      title: expTitle,
      protocolId: protocolMeta.protocolId,
      metadata: protocolMeta,
      blocks: userBlocks,
      version: editingExp?.status === 'active' ? protocolVersion : (editingExp?.version || '1.0'),
      history: editingExp?.history || [],
      savedStep: currentStep,
      createdAt: editingExp?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'draft'
    };

    const idx = experiments.findIndex(e => e.id === id);
    if (idx >= 0) experiments[idx] = entry; else experiments.push(entry);
    localStorage.setItem('emocog_my_experiments', JSON.stringify(experiments));
    clearExperimentBuilderDraft();

    toast(trb('Черновик успешно сохранён!','Draft saved successfully!'));
    setTimeout(() => navigate('#/experiments'), 700);
  }

  function saveProtocol() {
    const errors = [];
    validateProtocolMeta(protocolMeta).forEach(field => errors.push(trb('Заполните поле: ','Fill in field: ') + field));

    if (errors.length > 0) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,0.65);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;';
      const modal = document.createElement('div');
      modal.style.cssText = 'background:rgba(255,255,255,0.97);border:1px solid rgba(239,68,68,.25);border-radius:18px;padding:28px 24px;width:400px;max-width:95vw;box-shadow:0 20px 60px rgba(10,15,35,0.25);';
      modal.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <div style="width:32px;height:32px;border-radius:50%;background:rgba(239,68,68,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <svg fill="none" stroke="var(--bad)" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </div>
          <div style="font-size:15px;font-weight:700;color:var(--text);">${trb('Протокол неполный','Protocol is incomplete')}</div>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:14px;">${trb('Исправьте следующие проблемы перед сохранением:','Fix the following issues before saving:')}</div>
        <ul style="list-style:none;padding:0;margin:0 0 18px;display:flex;flex-direction:column;gap:8px;">
          ${errors.map(e => '<li style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--bad);"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'+e+'</li>').join('')}
        </ul>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="valIgnore" class="quick-btn" style="font-size:12px;color:var(--muted);">${trb('Сохранить всё равно','Save anyway')}</button>
          <button id="valClose" class="quick-btn" style="font-size:12px;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;">${trb('Исправить','Fix')}</button>
        </div>
      `;
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      setTimeout(() => applyAutoI18n(modal), 0);
      modal.querySelector('#valClose').addEventListener('click', () => document.body.removeChild(overlay));
      modal.querySelector('#valIgnore').addEventListener('click', () => { document.body.removeChild(overlay); doSave(); });
      return;
    }
    doSave();
  }

  async function doSave() {
    const srcData = parsedExperimentData?.json || {};

    const expTitle = protocolMeta.title || srcData.title || 'Новый эксперимент';

    const shell = getParticipantShellMeta();
    protocolMeta.participantShell = shell;
    const systemBlocks = requiredProtocolBlocks()
      .filter((b) => {
        if (b.type === 'consent') return shell.consent;
        if (b.type === 'questionnaire') return shell.questionnaire;
        if (b.type === 'precheck') return shell.precheck;
        if (b.type === 'calibration') return shell.calibration;
        return false;
      })
      .map((b, i) => ({
        id: `system_${b.type}_${i + 1}`,
        type: b.type
      }));
    const userBlocks = experimentBlocks.filter(b => !SYSTEM_BLOCK_TYPES.includes(b.type));

    const json = {
      title: expTitle,
      protocolId: protocolMeta.protocolId,
      estimatedDuration: protocolMeta.estimatedDuration,
      description: protocolMeta.description,
      participantShell: shell,
      testHubMetrics: [],
      version: 'v2.0_universal',
      settings: srcData.settings || { backgroundColor:'#1a1a2e', textColor:'#ffffff' },
      blocks: [
        ...systemBlocks,
        ...userBlocks.map(b => {
        const out = { id: b.id, type: b.type, label: localizedBlockLabel(b, b.label || b.type) };
        if (b.type === 'instruction') {
          out.content = {
            title: localizedInstructionValue(b.content, 'title', b.label),
            text: localizedInstructionValue(b.content, 'text', ''),
            buttonText: localizedInstructionValue(b.content, 'buttonText', 'Далее')
          };
        } else if (b.type === 'cognitive_task') {
          const taskType = b.content?.taskType || 'other';
          out.taskType = taskType;
          out.rt_task = b.content?.rt_task || taskType;
          const rtMetrics = autoRtMetricsForTaskType(taskType, b.content);
          out.blockConfig = {
            taskType,
            rt_task: out.rt_task,
            selected_metrics: rtMetrics,
            showFeedback: !!b.content?.showFeedback,
            feedbackConfig: b.content?.showFeedback ? {
              correctText: b.content?.feedbackCorrect || trb("Верно!","Correct!"),
              incorrectText: b.content?.feedbackIncorrect || trb("Ошибка!","Error!")
            } : null,
            useRT: b.content?.useRT !== false,
            stimulusDuration: b.content?.stimulusDuration || 1000,
            rtWindow: b.content?.rtWindow || 1000,
            responseType: b.content?.responseType || 'keys',
            omissionRule: b.content?.omissionRule || 'skip',
            commissionRule: b.content?.commissionRule || 'flag',
            targetAOI: b.content?.targetAOI || '',
            stimuliSource: b.content?.stimuliSource || 'library',
            stimuliFolder: b.content?.stimuliFolder || '',
            randomize: !!b.content?.randomize,
            protocolDurationMs: b.content?.protocolDurationMs || null,
            analytics: b.content?.analytics || null,
          };
          if (b.content?.useFixation) {
            out.blockConfig.fixation = {
              content: "+",
              duration: b.content?.fixationDuration || 500
            };
          }
          out.trials = defaultExportTrialsForCognitiveBlock(b.content);
        } else if (b.type === 'passive') {
          out.blockConfig = {
            slideDuration: b.content?.slideDuration || 5000,
            slideChangeMode: b.content?.slideChangeMode || 'timer',
            manualKey: b.content?.manualKey || 'Space',
            aoiMode: b.content?.aoiMode || 'heatmap',
            contentType: b.content?.contentType || 'slides',
            stimuliSource: b.content?.stimuliSource || 'library',
            stimuliFolder: b.content?.stimuliFolder || '',
            randomize: !!b.content?.randomize,
          };
          if (b.content?.useFixation) {
            out.blockConfig.fixation = {
              content: "+",
              duration: b.content?.fixationDuration || 500
            };
          }
        } else if (b.type === 'rest') {
          out.content = { text: b.content?.text || trb('Сделайте небольшой перерыв','Take a short break'), duration: b.content?.duration || 30 };
        } else if (b.type === 'finish') {
          out.content = { title: b.content?.title || trb('Эксперимент завершён','Experiment completed'), text: b.content?.text || trb('Спасибо за участие!','Thank you for participating!') };
        } else {
          out.content = b.content || {};
        }
        return out;
        })
      ]
    };
    if (typeof deriveSelectedMetricsFromBlocks === 'function') {
      json.selected_metrics = deriveSelectedMetricsFromBlocks(json.blocks);
    }

    const builderKey = experimentId || 'draft';
    const experiments = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];
    const id = experimentId || 'exp_' + Date.now();

    let history = editingExp?.history || [];
    if (editingExp && editingExp.status === 'active') {
      history.push({
        version: editingExp.version,
        blocks: editingExp.blocks,
        updatedAt: editingExp.updatedAt
      });
    }

    const entry = {
      id,
      title: json.title,
      protocolId: protocolMeta.protocolId,
      metadata: protocolMeta,
      blocks: userBlocks,
      version: protocolVersion,
      history: history,
      savedStep: 8,
      createdAt: editingExp?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active'
    };

    const idx = experiments.findIndex(e => e.id === id);
    if (idx >= 0) experiments[idx] = entry; else experiments.push(entry);
    localStorage.setItem('emocog_my_experiments', JSON.stringify(experiments));
    clearExperimentBuilderDraft();

    const blob = new Blob([JSON.stringify(json, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=json.title+'.json';
    document.body.appendChild(a); a.click();     document.body.removeChild(a); URL.revokeObjectURL(url);

    let toastMain = trb(
      'Сохранено локально в этом браузере. Участники по ссылке не увидят протокол, пока он не опубликован в API.',
      'Saved locally in this browser only. Participants will not see this protocol until it is published to the API.'
    );
    if (typeof publishBuilderProtocolAndInvitation === 'function' && typeof hasResearcherApiToken === 'function' && hasResearcherApiToken()) {
      try {
        const pub = await publishBuilderProtocolAndInvitation(json, builderKey, protocolMeta.protocolId);
        toastMain = trb(
          'Протокол опубликован в API. Код приглашения: ',
          'Protocol published to the API. Invitation code: '
        ) + pub.invitation.code + trb('. Ссылка обновлена.', ' Link updated.');
        const linkInput = document.getElementById('participantLinkInput');
        if (linkInput) linkInput.value = pub.link;
      } catch (e) {
        var apiErr = e?.message || String(e);
        if (String(apiErr).indexOf('403') >= 0 && String(apiErr).toLowerCase().indexOf('forbidden') >= 0) {
          toastMain = trb(
            'Сохранено локально. API отклонил публикацию (403). Войдите как исследователь/PI/admin. ',
            'Saved locally. API publish denied (403). Sign in as researcher/PI/admin. '
          ) + apiErr;
        } else {
          toastMain = trb('Сохранено локально. Ошибка API: ', 'Saved locally. API error: ') + apiErr;
        }
      }
    } else {
      toastMain = trb(
        'Сохранено локально. Войдите в API (developer/login) и нажмите «Сохранить протокол» снова.',
        'Saved locally. Sign in via developer/login and click “Save protocol” again.'
      );
    }

    toast(toastMain);
    setTimeout(() => navigate('#/experiments'), 1200);
  }


  // PsychoPy parser
  function parsePsyExp(xmlStr, res) {
    const doc = new DOMParser().parseFromString(xmlStr,'text/xml');
    const stats = { blocks:0, trials:0 };
    const expName = doc.querySelector("Settings Param[name='expName']")?.getAttribute('val')||'Experiment';
    const json = { title:expName, version:'v2.0', settings:{backgroundColor:'#000000',textColor:'#ffffff'}, blocks:[] };
    const rmap = {};
    doc.querySelectorAll('Routines Routine').forEach(r => rmap[r.getAttribute('name')]=r);
    const flow = doc.querySelector('Flow');
    if (!flow) throw new Error('Flow не найден');
    Array.from(flow.children).forEach(node => {
      if (node.tagName==='Routine') {
        const name=node.getAttribute('name'); const routine=rmap[name];
        if (routine) {
          const tc=routine.querySelector('TextComponent');
          if (tc) {
            const p={}; tc.querySelectorAll('Param').forEach(x=>p[x.getAttribute('name')]=x.getAttribute('val'));
            let text=(p['text']||'').replace(/^['"]|['"]$/g,'').replace(/&#10;/g,'\n').replace(/\\n/g,'\n');
            json.blocks.push({id:name,type:'instruction',content:{title:name,text,buttonText:'Далее'}});
            stats.blocks++;
          }
        }
      } else if (node.tagName==='LoopInitiator') {
        const p={}; node.querySelectorAll('Param').forEach(x=>p[x.getAttribute('name')]=x.getAttribute('val'));
        const name=node.getAttribute('name');
        let cf=(p['conditionsFile']||'').replace(/^['"]|['"]$/g,'');
        if(cf.endsWith('.xlsx')) cf=cf.replace('.xlsx','.csv');
        let trials=[];
        if(res[cf]){
          const lines=res[cf].split(/\r\n|\n/).filter(l=>l.trim());
          if(lines.length>=2){
            const hdrs=lines[0].split(',').map(h=>h.trim());
            trials=lines.slice(1).map((l,i)=>{
              const vals=l.split(','); const row={}; hdrs.forEach((h,j)=>row[h]=vals[j]?.trim());
              const type=row['trial_type']||'test';
              const cm={green:'#22C55E',red:'#EF4444',white:'#ffffff',black:'#000000'};
              return {id:`t_${i}`,condition:type,correctResponse:type==='go'?'Space':null,
                stimulus:{type:'shape',style:{backgroundColor:cm[row['stim_color']]||'#ffffff',width:'150px',height:'150px',borderRadius:'50%'}}};
            });
            stats.trials+=trials.length;
          }
        } else { trials=[{info:'Файл условий не найден'}]; }
        json.blocks.push({id:name,type:'cognitive_task',blockConfig:{showFeedback:name.includes('practice'),stimulusDuration:1000},trials});
        stats.blocks++;
      }
    });
    return {json, stats};
  }

  renderStepper();
  renderCanvas();
  return root;
}
//~

//(Аня)
