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
    precheck: true,
    calibration: true
  };

  function normalizeParticipantShell() {
    return { ...DEFAULT_PARTICIPANT_SHELL };
  }

  function getParticipantShellMeta() {
    return normalizeParticipantShell(protocolMeta.participantShell || DEFAULT_PARTICIPANT_SHELL);
  }

  function defaultExportTrialsForCognitiveBlock(content) {
    const existing = Array.isArray(content?.trials) ? content.trials : [];
    if (existing.length) return existing;
    const taskType = String(content?.taskType || content?.rt_task || 'simple').toLowerCase();
    if (taskType === 'simple' || taskType === 'simple_rt') {
      return [{
        stimulusId: 'std_simple_black_square',
        condition: 'target',
        action: 'space',
        duration: 2000,
        repetitions: 10
      }];
    }
    if (taskType === 'pvt') {
      return [{
        stimulusId: 'std_pvt_counter',
        condition: 'counter onset',
        action: 'space',
        duration: 10000,
        repetitions: 5
      }];
    }
    if (taskType === 'go_nogo') {
      return [
        { stimulusId: 'std_go_green_circle', condition: 'Go', action: 'space', duration: 500, repetitions: 1 },
        { stimulusId: 'std_nogo_red_circle', condition: 'No-Go', action: '', duration: 500, repetitions: 1 }
      ];
    }
    if (taskType === 'stroop') {
      return [
        { stimulusId: 'std_stroop_red_red', condition: 'congruent/red', action: 'arrow_left', duration: 2000, repetitions: 1 },
        { stimulusId: 'std_stroop_blue_green', condition: 'incongruent/green ink', action: 'arrow_right', duration: 2000, repetitions: 1 },
        { stimulusId: 'std_stroop_red_blue', condition: 'incongruent/blue ink', action: 'arrow_down', duration: 2000, repetitions: 1 }
      ];
    }
    if (taskType === 'flanker') {
      return [
        { stimulusId: 'std_flanker_right_incong', condition: 'incongruent/right', action: 'arrow_right', duration: 1500, repetitions: 1 },
        { stimulusId: 'std_flanker_left_incong', condition: 'incongruent/left', action: 'arrow_left', duration: 1500, repetitions: 1 }
      ];
    }
    if (taskType === 'nback' || taskType === 'nback_2') {
      return [
        { stimulusId: 'std_nback_circle', condition: 'non-target', action: '', duration: 1000, repetitions: 1 },
        { stimulusId: 'std_nback_square', condition: 'non-target', action: '', duration: 1000, repetitions: 1 },
        { stimulusId: 'std_nback_circle', condition: 'target 2-back', action: 'space', duration: 1000, repetitions: 1 }
      ];
    }
    if (taskType === 'cpt' || taskType === 'ax_cpt') {
      return [
        { stimulusId: 'std_cpt_a', condition: 'cue', action: '', duration: 500, repetitions: 1 },
        { stimulusId: 'std_cpt_x', condition: 'AX target', action: 'space', duration: 500, repetitions: 1 },
        { stimulusId: 'std_cpt_b', condition: 'non-target', action: '', duration: 500, repetitions: 1 },
        { stimulusId: 'std_cpt_x', condition: 'non-target', action: '', duration: 500, repetitions: 1 }
      ];
    }
    if (taskType === 'task_switching') {
      return [
        { stimulusId: 'std_switch_4g', condition: 'number/even', action: 'arrow_left', duration: 2000, repetitions: 1 },
        { stimulusId: 'std_switch_7a', condition: 'number/odd', action: 'arrow_right', duration: 2000, repetitions: 1 },
        { stimulusId: 'std_switch_2e', condition: 'letter/vowel', action: 'arrow_left', duration: 2000, repetitions: 1 },
        { stimulusId: 'std_switch_9k', condition: 'letter/consonant', action: 'arrow_right', duration: 2000, repetitions: 1 }
      ];
    }
    if (taskType === 'emotion_viewing') {
      return [
        { stimulusId: 'std_emo_neutral_01', condition: 'neutral', action: '', responseMode: 'none', duration: 4000, repetitions: 1 },
        { stimulusId: 'std_emo_happy_01', condition: 'happy', action: '', responseMode: 'none', duration: 4000, repetitions: 1 }
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

  function stimulusIdsForAoiExport(content, trials) {
    const ids = (Array.isArray(trials) ? trials : [])
      .map(trial => trial?.stimulusId ?? trial?.id)
      .filter(value => value != null && String(value).trim());
    (Array.isArray(content?.slides) ? content.slides : []).forEach(slide => {
      const id = typeof slide === 'object' ? (slide?.stimulusId ?? slide?.id) : slide;
      if (id != null && String(id).trim()) ids.push(id);
    });
    if (content?.stimuliSource === 'folder' && content?.stimuliFolder) {
      const folder = folders.find(item => String(item.id) === String(content.stimuliFolder));
      if (Array.isArray(folder?.stimuliIds)) ids.push(...folder.stimuliIds);
    }
    return ids;
  }

  function attachBlockAois(blockConfig, content, trials) {
    if (!content?.useAOI || !globalThis.EmocogAoiProtocol) return;
    const stimulusIds = new Set(stimulusIdsForAoiExport(content, trials).map(String));
    const scopedDefinitions = content.aoiDefinitions && typeof content.aoiDefinitions === 'object'
      ? Object.fromEntries(Object.entries(content.aoiDefinitions)
        .filter(([stimulusId, aois]) => stimulusIds.has(String(stimulusId)) && Array.isArray(aois) && aois.length)
        .map(([stimulusId, aois]) => [stimulusId, JSON.parse(JSON.stringify(aois))]))
      : {};
    const definitions = Object.keys(scopedDefinitions).length
      ? scopedDefinitions
      : globalThis.EmocogAoiProtocol.buildAoiDefinitions(stimuliList, [...stimulusIds]);
    if (!Object.keys(definitions).length) return;
    blockConfig.aoiSchemaVersion = globalThis.EmocogAoiProtocol.AOI_SCHEMA_VERSION;
    blockConfig.aoiDefinitions = definitions;
  }

  function describeParticipantShellForUi(shell) {
    const parts = [];
    if (shell.consent) parts.push(trb('информированное согласие', 'informed consent'));
    if (shell.questionnaire) parts.push(trb('анкета', 'questionnaire'));
    if (shell.precheck) parts.push(trb('проверка камеры', 'camera pre-check'));
    if (shell.calibration) parts.push(trb('калибровка взгляда', 'gaze calibration'));
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
    return normalizeAnalyzerTaskType(content?.taskType || content?.rt_task);
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

  document.getElementById('pageTitle').textContent = (CURRENT_LANG === 'en' ? I18N.en : I18N.ru).protocolBuilder;

  if (typeof ensureStandardStimuli === 'function') ensureStandardStimuli();

  const trb = (ru, en) => CURRENT_LANG === 'en'
    ? (en || (typeof autoTranslateString === 'function' ? autoTranslateString(ru, 'en') : ru))
    : ru;

  const RT_ANALYZER_TASK_BOUNDS = {
    simple: { min: 100, max: 2000, timeout: 2500 },
    choice: { min: 150, max: 2000, timeout: 2500 },
    go_nogo: { min: 100, max: 1500, timeout: 2000 },
    stroop: { min: 200, max: 3000, timeout: 3500 },
    pvt: { min: 100, max: 5000, timeout: 5000 },
    cpt: { min: 100, max: 2000, timeout: 2000 },
  };

  const LEGACY_TASK_TYPE_TO_ANALYZER = {
    simple_rt: 'simple',
    other: 'simple',
    generic: 'simple',
    flanker: 'choice',
    nback_2: 'choice',
    nback: 'choice',
    task_switching: 'choice',
    ax_cpt: 'cpt',
  };

  function normalizeAnalyzerTaskType(taskType) {
    const t = String(taskType || 'simple').toLowerCase();
    if (RT_ANALYZER_TASK_BOUNDS[t]) return t;
    return LEGACY_TASK_TYPE_TO_ANALYZER[t] || 'simple';
  }

  const TASK_TYPE_OPTIONS = [
    { value: 'simple', label: trb('Простая реакция', 'Simple RT') },
    { value: 'choice', label: trb('Выбор (choice)', 'Choice') },
    { value: 'go_nogo', label: 'Go / No-Go' },
    { value: 'stroop', label: 'Stroop' },
    { value: 'pvt', label: 'PVT' },
    { value: 'cpt', label: 'CPT' },
  ];

  function defaultRtBoundsForTaskType(taskType) {
    const key = normalizeAnalyzerTaskType(taskType);
    const b = RT_ANALYZER_TASK_BOUNDS[key];
    return { min: b.min, max: b.max, timeout: b.timeout };
  }

  function resolveRtBounds(content) {
    const taskType = resolveTaskTypeForRtMetrics(content);
    const defaults = defaultRtBoundsForTaskType(taskType);
    const min = parseInt(content?.rtMin);
    const max = parseInt(content?.rtWindow);
    return {
      rtMin: Number.isFinite(min) && min > 0 ? min : defaults.min,
      rtWindow: Number.isFinite(max) && max > 0 ? max : defaults.max
    };
  }

  function legacyTaskTypeLabel(type) {
    const labels = {
      simple_rt: trb('Простая реакция', 'Simple RT'),
      flanker: 'Flanker',
      nback_2: '2-back',
      nback: 'N-back',
      task_switching: trb('Переключение задач', 'Task switching'),
      ax_cpt: 'AX-CPT',
      other: trb('Другое', 'Other'),
      generic: trb('Другое', 'Other'),
    };
    return labels[type] || type;
  }

  function taskTypeSelectEditorHtml(block) {
    const c = block.content || {};
    const current = String(c.taskType || c.rt_task || 'simple_rt').toLowerCase();
    const options = [...TASK_TYPE_OPTIONS];
    const known = new Set(options.map(opt => opt.value));
    if (current && !known.has(current)) {
      options.unshift({ value: current, label: legacyTaskTypeLabel(current) });
    }
    return `
      <select class="proto-task-type-sel" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;background:var(--card-bg);color:var(--text);width:100%;">
        ${options.map(opt => `<option value="${previewEscape(opt.value)}" ${current === opt.value ? 'selected' : ''}>${previewEscape(opt.label)}</option>`).join('')}
      </select>`;
  }

  function surveyContract() {
    return globalThis.WecogSurveyContract || null;
  }

  function normalizedSurveyContent(content) {
    const contract = surveyContract();
    return contract?.normalizeSurveyContent
      ? contract.normalizeSurveyContent(content || {})
      : (content || defaultContent('survey'));
  }

  function surveyEditorValue(source, field) {
    const value = source && typeof source === 'object' ? source : {};
    if (CURRENT_LANG === 'en') return value[`${field}En`] || '';
    return value[`${field}Ru`] || value[field] || '';
  }

  function setSurveyEditorValue(target, field, value) {
    const next = { ...(target || {}) };
    if (CURRENT_LANG === 'en') next[`${field}En`] = value;
    else {
      next[field] = value;
      next[`${field}Ru`] = value;
    }
    return next;
  }

  function newSurveyQuestion() {
    return {
      id: `question_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      text: '',
      type: 'open',
      required: false,
      options: []
    };
  }

  function newSurveyOption(questionId, index) {
    return {
      id: `${questionId}_option_${Date.now()}_${index + 1}`,
      label: ''
    };
  }

  function createProtocolBlockId(type) {
    const suffix = globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    return `${type}_${suffix}`;
  }

  function surveyOptionsEditorHtml(question, questionIndex) {
    if (question.type === 'open') return '';
    const options = question.options.length >= 2
      ? question.options
      : [newSurveyOption(question.id, 0), newSurveyOption(question.id, 1)];
    return `
      <div class="survey-options-editor" style="display:flex;flex-direction:column;gap:6px;">
        <div style="font-size:10px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);">${trb('Варианты ответа', 'Answer options')}</div>
        ${options.map((option, optionIndex) => `
          <div class="survey-option-row" data-option-id="${previewEscape(option.id)}" style="display:flex;gap:6px;align-items:center;">
            <input class="survey-option-label" value="${previewEscape(surveyEditorValue(option, 'label'))}" placeholder="${trb('Вариант ', 'Option ')}${optionIndex + 1}" maxlength="500" style="flex:1;min-width:0;padding:7px 9px;border-radius:8px;border:1px solid var(--stroke);background:var(--card-bg);color:var(--text);font-size:12px;">
            <button type="button" class="survey-remove-option" data-question-index="${questionIndex}" data-option-index="${optionIndex}" aria-label="${trb('Удалить вариант', 'Remove option')}" style="width:30px;height:30px;border:1px solid var(--stroke);border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;">×</button>
          </div>`).join('')}
        <button type="button" class="survey-add-option quick-btn" data-question-index="${questionIndex}" style="align-self:flex-start;font-size:11px;padding:6px 10px;">+ ${trb('Вариант', 'Option')}</button>
      </div>`;
  }

  function buildSurveyInlineEditor(block) {
    const survey = normalizedSurveyContent(block.content);
    block.content = survey;
    return `
      <div class="proto-inline-editor survey-inline-editor" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke);display:flex;flex-direction:column;gap:10px;">
        <label style="font-size:11px;font-weight:650;color:var(--muted);">${trb('Название опроса', 'Survey title')}</label>
        <input class="survey-title-field" value="${previewEscape(surveyEditorValue(survey, 'title'))}" maxlength="200" style="padding:7px 9px;border-radius:8px;border:1px solid var(--stroke);background:var(--card-bg);color:var(--text);font-size:12px;">
        <label style="font-size:11px;font-weight:650;color:var(--muted);">${trb('Пояснение участнику', 'Participant description')}</label>
        <textarea class="survey-description-field" rows="2" maxlength="1000" style="padding:7px 9px;border-radius:8px;border:1px solid var(--stroke);background:var(--card-bg);color:var(--text);font-size:12px;resize:vertical;">${previewEscape(surveyEditorValue(survey, 'description'))}</textarea>
        <div style="padding:9px 10px;border-left:3px solid var(--warn);background:rgba(245,158,11,.08);border-radius:7px;color:var(--muted);font-size:10px;line-height:1.45;">
          ${trb('Не запрашивайте ФИО, телефон, почту и другие прямые идентификаторы: ingest отклоняет PII.', 'Do not request names, phone numbers, email, or other direct identifiers: ingest rejects PII.')}
        </div>
        <div class="survey-question-list" style="display:flex;flex-direction:column;gap:10px;">
          ${survey.questions.map((question, questionIndex) => `
            <section class="survey-question-editor" data-question-id="${previewEscape(question.id)}" style="padding:11px;border:1px solid var(--stroke);border-radius:11px;background:rgba(255,255,255,.34);display:flex;flex-direction:column;gap:8px;">
              <div style="display:flex;gap:7px;align-items:center;">
                <strong style="font-size:11px;color:var(--text);flex:1;">${trb('Вопрос', 'Question')} ${questionIndex + 1}</strong>
                <select class="survey-question-type" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);background:var(--card-bg);color:var(--text);font-size:11px;">
                  <option value="open" ${question.type === 'open' ? 'selected' : ''}>${trb('Открытый ответ', 'Open answer')}</option>
                  <option value="single" ${question.type === 'single' ? 'selected' : ''}>${trb('Один из нескольких', 'Single choice')}</option>
                  <option value="multiple" ${question.type === 'multiple' ? 'selected' : ''}>${trb('Несколько из нескольких', 'Multiple choice')}</option>
                </select>
                <label style="display:flex;align-items:center;gap:5px;color:var(--muted);font-size:10px;white-space:nowrap;">
                  <input type="checkbox" class="survey-question-required" ${question.required ? 'checked' : ''}> ${trb('Обязательный', 'Required')}
                </label>
                <button type="button" class="survey-remove-question" data-question-index="${questionIndex}" aria-label="${trb('Удалить вопрос', 'Remove question')}" style="width:30px;height:30px;border:1px solid var(--stroke);border-radius:8px;background:transparent;color:var(--muted);cursor:pointer;">×</button>
              </div>
              <textarea class="survey-question-text" rows="2" maxlength="1000" placeholder="${trb('Введите текст вопроса', 'Enter the question')}" style="padding:7px 9px;border-radius:8px;border:1px solid var(--stroke);background:var(--card-bg);color:var(--text);font-size:12px;resize:vertical;">${previewEscape(surveyEditorValue(question, 'text'))}</textarea>
              ${surveyOptionsEditorHtml(question, questionIndex)}
            </section>`).join('')}
        </div>
        <button type="button" class="survey-add-question quick-btn" style="align-self:flex-start;font-size:11px;padding:7px 11px;">+ ${trb('Добавить вопрос', 'Add question')}</button>
      </div>`;
  }

  function buildBlockInlineEditor(block) {
    const c = block.content || {};
    const folderOpts = (folders || []).map(f =>
      `<option value="${previewEscape(f.id)}" ${c.stimuliFolder === f.id ? 'selected' : ''}>${previewEscape(typeof localizedFolderName === 'function' ? localizedFolderName(f) : f.name)}</option>`).join('');

    if (block.type === 'instruction') {
      return `
        <div class="proto-inline-editor" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke);display:flex;flex-direction:column;gap:8px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Заголовок', 'Title')}</label>
          <input class="proto-field" data-field="title" value="${previewEscape(localizedInstructionValue(c, 'title'))}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;" />
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Текст', 'Text')}</label>
          <textarea class="proto-field" data-field="text" rows="3" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;resize:vertical;">${previewEscape(localizedInstructionValue(c, 'text'))}</textarea>
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Кнопка', 'Button')}</label>
          <input class="proto-field" data-field="buttonText" value="${previewEscape(localizedInstructionValue(c, 'buttonText', 'Далее'))}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;" />
        </div>`;
    }
    if (block.type === 'survey') {
      return buildSurveyInlineEditor(block);
    }
    if (block.type === 'rest') {
      const restDuration = Number(c.duration);
      const restDurationSeconds = Number.isFinite(restDuration) && restDuration > 0
        ? (c.durationUnit === 'seconds' ? restDuration : (restDuration >= 1000 ? restDuration / 1000 : restDuration))
        : 30;
      return `
        <div class="proto-inline-editor" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke);display:flex;flex-direction:column;gap:8px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Текст для участника', 'Text for participant')}</label>
          <textarea class="proto-field" data-field="text" rows="2" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;">${previewEscape(c.text || trb('Сделайте небольшой перерыв', 'Take a short break'))}</textarea>
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Длительность (сек)', 'Duration (sec)')}</label>
          <input class="proto-field" data-field="duration" type="number" min="1" max="3600" value="${restDurationSeconds}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;width:100px;" />
        </div>`;
    }
    if (block.type === 'audio_test') {
      return `
        <div class="proto-inline-editor" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke);display:flex;flex-direction:column;gap:8px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Тип аудиотеста', 'Audio test type')}</label>
          <select class="proto-field" data-field="testType" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;">
            <option value="reading" ${c.testType === 'reading' || !c.testType ? 'selected' : ''}>${trb('Чтение фразы', 'Read a phrase')}</option>
            <option value="counting" ${c.testType === 'counting' ? 'selected' : ''}>${trb('Счёт вслух', 'Count aloud')}</option>
            <option value="sustained_vowel" ${c.testType === 'sustained_vowel' ? 'selected' : ''}>${trb('Протяжный звук', 'Sustained vowel')}</option>
          </select>
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Задание участнику', 'Participant prompt')}</label>
          <textarea class="proto-field" data-field="prompt" rows="3" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;resize:vertical;">${previewEscape(c.prompt || defaultContent('audio_test').prompt)}</textarea>
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Длительность (сек)', 'Duration (sec)')}</label>
          <input class="proto-field" data-field="duration" type="number" min="5" max="120" value="${c.duration || 12}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;width:100px;" />
          <div style="font-size:11px;line-height:1.5;color:var(--muted);padding:9px 10px;border-radius:8px;background:rgba(15,118,110,.08);border:1px solid rgba(15,118,110,.18);">${trb('Участник увидит задание и обратный отсчёт. В аналитику попадут только рассчитанные акустические признаки и качество записи; исходный голос не сохраняется.', 'The participant sees the prompt and countdown. Only derived acoustic features and recording quality are sent to analytics; raw voice is not stored.')}</div>
        </div>`;
    }
    if (block.type === 'timer') {
      return `
        <div class="proto-inline-editor" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke);display:flex;flex-direction:column;gap:8px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Название измерения', 'Measurement name')}</label>
          <input class="proto-field" data-field="name" value="${previewEscape(c.name || trb('Общее время сессии', 'Total session time'))}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;" />
          <div style="font-size:11px;line-height:1.5;color:var(--muted);padding:9px 10px;border-radius:8px;background:rgba(8,145,178,.08);border:1px solid rgba(8,145,178,.2);">
            ${trb('Блок не показывается участнику. Он фиксирует общее время от старта сессии до её завершения и передаёт его исследователю.', 'This block is hidden from the participant. It records total time from session start to completion and sends it to the researcher.')}
          </div>
        </div>`;
    }
    if (block.type === 'finish') {
      return `
        <div class="proto-inline-editor" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke);display:flex;flex-direction:column;gap:8px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Заголовок', 'Title')}</label>
          <input class="proto-field" data-field="title" value="${previewEscape(c.title || trb('Эксперимент завершён', 'Experiment completed'))}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;" />
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Текст', 'Text')}</label>
          <textarea class="proto-field" data-field="text" rows="2" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;">${previewEscape(c.text || trb('Спасибо за участие!', 'Thank you for participating!'))}</textarea>
        </div>`;
    }
    if (block.type === 'cognitive_task' || block.type === 'passive') {
      const taskTypeField = block.type === 'cognitive_task' ? `
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Тип задачи', 'Task type')}</label>
          ${taskTypeSelectEditorHtml(block)}` : '';
      return `
        <div class="proto-inline-editor" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--stroke);display:flex;flex-direction:column;gap:8px;">
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Название блока', 'Block name')}</label>
          <input class="proto-label-input" value="${previewEscape(localizedBlockLabel(block, block.label))}" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;" />
          ${taskTypeField}
          <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Откуда брать стимулы?', 'Stimulus source')}</label>
          <select class="proto-field" data-field="stimuliSource" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;">
            <option value="library" ${c.stimuliSource === 'library' || !c.stimuliSource ? 'selected' : ''}>${trb('Вся библиотека', 'Entire library')}</option>
            <option value="folder" ${c.stimuliSource === 'folder' ? 'selected' : ''}>${trb('Из папки', 'From folder')}</option>
          </select>
          <div class="proto-folder-field" style="${c.stimuliSource === 'folder' ? '' : 'display:none;'}">
            <label style="font-size:11px;font-weight:600;color:var(--muted);">${trb('Папка', 'Folder')}</label>
            <select class="proto-field" data-field="stimuliFolder" style="padding:6px 8px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;">
              <option value="">— ${trb('папка', 'folder')} —</option>
              ${folderOpts}
            </select>
          </div>
          <button type="button" class="quick-btn proto-save-inline" style="font-size:11px;align-self:flex-start;margin-top:4px;">${trb('Сохранить', 'Save')}</button>
        </div>`;
    }
    return '';
  }

  function saveBlockInlineFields(block, card) {
    block.content = block.content || {};
    const labelInput = card.querySelector('.proto-label-input');
    if (labelInput) {
      block.label = labelInput.value || block.label;
      block[CURRENT_LANG === 'en' ? 'labelEn' : 'labelRu'] = block.label;
    }
    card.querySelectorAll('.proto-field').forEach(el => {
      const field = el.dataset.field;
      if (el.type === 'checkbox') block.content[field] = el.checked;
      else if (el.type === 'number') block.content[field] = parseFloat(el.value) || 0;
      else block.content[field] = el.value;
    });
    if (block.type === 'rest' || block.type === 'audio_test') {
      block.content.durationUnit = 'seconds';
    }
    const taskTypeSel = card.querySelector('.proto-task-type-sel');
    if (taskTypeSel) {
      block.content.taskType = taskTypeSel.value;
      block.content.rt_task = taskTypeSel.value;
      block.content.selected_metrics = autoRtMetricsForTaskType(block.content.taskType, block.content);
    }
    if (block.type === 'instruction') {
      ['title', 'text', 'buttonText'].forEach(field => {
        if (block.content[field] === undefined) return;
        block.content[field + (CURRENT_LANG === 'en' ? 'En' : 'Ru')] = block.content[field];
      });
    }
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
  }

  function readSurveyEditor(block, card) {
    const previous = normalizedSurveyContent(block.content);
    const questions = [...card.querySelectorAll('.survey-question-editor')].map((questionEl, questionIndex) => {
      const type = questionEl.querySelector('.survey-question-type')?.value || 'open';
      const previousQuestion = previous.questions[questionIndex] || newSurveyQuestion();
      const options = type === 'open' ? [] : [...questionEl.querySelectorAll('.survey-option-row')].map((optionEl, optionIndex) => {
        const previousOption = previousQuestion.options[optionIndex]
          || newSurveyOption(previousQuestion.id, optionIndex);
        return setSurveyEditorValue({
          ...previousOption,
          id: optionEl.dataset.optionId || previousOption.id
        }, 'label', optionEl.querySelector('.survey-option-label')?.value || '');
      });
      return setSurveyEditorValue({
        ...previousQuestion,
        id: questionEl.dataset.questionId || previousQuestion.id,
        type,
        required: !!questionEl.querySelector('.survey-question-required')?.checked,
        options
      }, 'text', questionEl.querySelector('.survey-question-text')?.value || '');
    });
    let nextContent = {
      ...previous,
      questions
    };
    nextContent = setSurveyEditorValue(
      nextContent,
      'title',
      card.querySelector('.survey-title-field')?.value || ''
    );
    nextContent = setSurveyEditorValue(
      nextContent,
      'description',
      card.querySelector('.survey-description-field')?.value || ''
    );
    block.content = normalizedSurveyContent(nextContent);
    block.label = surveyEditorValue(block.content, 'title') || trb('Опрос', 'Survey');
    block[CURRENT_LANG === 'en' ? 'labelEn' : 'labelRu'] = block.label;
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
    return block.content;
  }

  function rerenderSurveyEditor(block, card, mutate) {
    const survey = readSurveyEditor(block, card);
    mutate(survey);
    block.content = normalizedSurveyContent(survey);
    block.label = surveyEditorValue(block.content, 'title') || trb('Опрос', 'Survey');
    block[CURRENT_LANG === 'en' ? 'labelEn' : 'labelRu'] = block.label;
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
    renderCanvasBlocks();
  }

  function wireSurveyEditor(card, block) {
    card.querySelectorAll('.survey-inline-editor input, .survey-inline-editor textarea, .survey-inline-editor select, .survey-inline-editor button').forEach(el => {
      el.addEventListener('click', event => event.stopPropagation());
    });
    card.querySelectorAll('.survey-title-field, .survey-description-field, .survey-question-text, .survey-question-required, .survey-option-label').forEach(el => {
      el.addEventListener('change', () => readSurveyEditor(block, card));
    });
    card.querySelectorAll('.survey-question-type').forEach((select, questionIndex) => {
      select.addEventListener('change', () => rerenderSurveyEditor(block, card, survey => {
        const question = survey.questions[questionIndex];
        if (!question || question.type === 'open') return;
        while (question.options.length < 2) {
          question.options.push(newSurveyOption(question.id, question.options.length));
        }
      }));
    });
    card.querySelector('.survey-add-question')?.addEventListener('click', () => {
      rerenderSurveyEditor(block, card, survey => survey.questions.push(newSurveyQuestion()));
    });
    card.querySelectorAll('.survey-remove-question').forEach(button => {
      button.addEventListener('click', () => {
        const questionIndex = Number(button.dataset.questionIndex);
        rerenderSurveyEditor(block, card, survey => survey.questions.splice(questionIndex, 1));
      });
    });
    card.querySelectorAll('.survey-add-option').forEach(button => {
      button.addEventListener('click', () => {
        const questionIndex = Number(button.dataset.questionIndex);
        rerenderSurveyEditor(block, card, survey => {
          const question = survey.questions[questionIndex];
          if (question) question.options.push(newSurveyOption(question.id, question.options.length));
        });
      });
    });
    card.querySelectorAll('.survey-remove-option').forEach(button => {
      button.addEventListener('click', () => {
        const questionIndex = Number(button.dataset.questionIndex);
        const optionIndex = Number(button.dataset.optionIndex);
        rerenderSurveyEditor(block, card, survey => {
          const question = survey.questions[questionIndex];
          if (question) question.options.splice(optionIndex, 1);
        });
      });
    });
  }

  function wireBlockCardInteractions(card, block) {
    if (block.type === 'survey') wireSurveyEditor(card, block);
    const taskTypeSel = card.querySelector('.proto-task-type-sel');
    if (taskTypeSel) {
      taskTypeSel.addEventListener('click', e => e.stopPropagation());
      taskTypeSel.addEventListener('change', () => {
        block.content = block.content || {};
        block.content.taskType = taskTypeSel.value;
        block.content.rt_task = taskTypeSel.value;
        block.content.selected_metrics = autoRtMetricsForTaskType(block.content.taskType, block.content);
        localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
      });
    }
    const srcSelect = card.querySelector('[data-field="stimuliSource"]');
    if (srcSelect) {
      srcSelect.addEventListener('change', () => {
        const ff = card.querySelector('.proto-folder-field');
        if (ff) ff.style.display = srcSelect.value === 'folder' ? '' : 'none';
      });
    }
    card.querySelector('.proto-save-inline')?.addEventListener('click', (e) => {
      e.stopPropagation();
      saveBlockInlineFields(block, card);
      toast(trb('Блок сохранён', 'Block saved'));
    });
    card.querySelectorAll('.proto-field').forEach(el => {
      el.addEventListener('click', e => e.stopPropagation());
      el.addEventListener('change', () => saveBlockInlineFields(block, card));
    });
    card.querySelectorAll('.proto-label-input, .proto-inline-editor input, .proto-inline-editor textarea, .proto-inline-editor select').forEach(el => {
      el.addEventListener('click', e => e.stopPropagation());
    });
  }
  const instructionValueForLocale = (content, field, locale, fallback = '') => {
    const c = content || {};
    if (locale === 'en') {
      const knownTranslations = typeof TEMPLATE_INSTRUCTION_TRANSLATIONS !== 'undefined' ? TEMPLATE_INSTRUCTION_TRANSLATIONS : {};
      const known = knownTranslations[c.titleRu || c.title] || null;
      if (field === 'title' && known?.title) return known.title;
      if (field === 'text' && known?.text) return known.text;
      if (field === 'buttonText' && (c.buttonTextRu || c.buttonText || fallback) === 'Начать') return 'Start';
      return c[field + 'En'] || autoTranslateString(c[field] || c[field + 'Ru'] || fallback, 'en');
    }
    return c[field + 'Ru'] || c[field] || fallback;
  };
  const localizedInstructionValue = (content, field, fallback = '') => (
    instructionValueForLocale(content, field, CURRENT_LANG, fallback)
  );
  const localizedBlockLabel = (block, fallback = '') => {
    if (!block) return fallback;
    if (CURRENT_LANG === 'en') {
      const blockTranslations = typeof TEMPLATE_BLOCK_LABEL_TRANSLATIONS !== 'undefined' ? TEMPLATE_BLOCK_LABEL_TRANSLATIONS : {};
      if (blockTranslations[block.labelRu || block.label]) return blockTranslations[block.labelRu || block.label];
      return block.labelEn || autoTranslateString(block.label || block.labelRu || fallback, CURRENT_LANG);
    }
    return block.labelRu || block.label || fallback;
  };
  function i18nPack() {
    return (typeof I18N !== 'undefined' && CURRENT_LANG === 'en') ? I18N.en : I18N.ru;
  }

  function tKey(key) {
    return i18nPack()[key] || key;
  }

  function blockTypeLabel(type) {
    const pack = i18nPack();
    const map = {
      consent: pack.blockConsent,
      questionnaire: pack.blockQuestionnaire,
      precheck: pack.blockPrecheck,
      calibration: pack.blockCalibration,
      survey: trb('Опрос', 'Survey'),
      cognitive_task: pack.blockTask,
      passive: pack.blockPassive,
      rest: pack.blockBreak,
      audio_test: trb('Аудиотест', 'Audio test'),
      finish: pack.blockFinish,
      instruction: trb('Инструкция', 'Instruction'),
      timer: trb('Таймер', 'Timer'),
    };
    return map[type] || type;
  }

  function builderStepHint(stepIdx) {
    const hints = [
      '',
      trb('Можно выбрать несколько задач: они будут добавлены в один эксперимент последовательно.', 'You can select multiple tasks: they will be added to one experiment sequentially.'),
      trb('Соберите последовательность блоков и настройте подготовительные этапы для участника.', 'Build the block sequence and configure participant preparation steps.'),
      trb('Настройте логику показа стимулов и таблицы проб для каждого блока.', 'Configure stimulus presentation and trial tables for each block.'),
      trb('Определите зоны интереса и целевые области для анализа взгляда.', 'Define areas of interest and target regions for gaze analysis.'),
      trb('Запустите пользовательскую часть эксперимента без системных блоков, чтобы проверить порядок и настройки.', 'Run the user-facing part without system blocks to verify order and settings.'),
      trb('Задайте пороговые значения контроля качества записи сессии.', 'Set quality control thresholds for session recording.'),
      trb('Выберите инструменты, которые будут доступны при просмотре данных этого эксперимента.', 'Choose tools available when viewing data from this experiment.'),
      trb('Проверьте эксперимент и сохраните протокол — ссылка для участников станет рабочей.', 'Review the experiment and save the protocol to activate the participant link.'),
    ];
    return hints[stepIdx] || '';
  }

  function builderStepHeader(stepIdx, extraHtml = '') {
    const title = i18nPack().builderSteps[stepIdx] || '';
    const hint = builderStepHint(stepIdx);
    return `
      <div class="builder-step-header" style="padding:16px 18px;border-radius:16px;background:linear-gradient(135deg,rgba(92,102,189,.14),rgba(14,165,233,.08));border:1px solid rgba(92,102,189,.18);">
        <div style="font-size:20px;font-weight:800;color:var(--text);">${title}</div>
        ${hint ? `<div style="font-size:13px;color:var(--muted);line-height:1.55;margin-top:6px;max-width:720px;">${hint}</div>` : ''}
        ${extraHtml}
      </div>`;
  }

  const BUILDER_CANVAS_PAD = '14px 16px';

  const BLOCK_TYPES = [
    { type:'consent',        color:'#6366f1', icon:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { type:'questionnaire',  color:'#8b5cf6', icon:'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { type:'precheck',       color:'#0ea5e9', icon:'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
    { type:'calibration',    color:'#10b981', icon:'M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z' },
    { type:'instruction',    color:'#f59e0b', icon:'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { type:'survey',         color:'#185cff', icon:'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
    { type:'cognitive_task', color:'#ef4444', icon:'M13 10V3L4 14h7v7l9-11h-7z' },
    { type:'passive',        color:'#ec4899', icon:'M7 4v16M17 4v16M3 8h4m10 0h4M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z' },
    { type:'rest',           color:'#64748b', icon:'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z' },
    { type:'audio_test',     color:'#0f766e', icon:'M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3zM5 10v2a7 7 0 0014 0v-2M12 19v3m-4 0h8' },
    { type:'timer',          color:'#0891b2', icon:'M12 8v4l3 2m3-9l2 2M6 5L4 7m8 14a8 8 0 100-16 8 8 0 000 16z' },
    { type:'finish',         color:'#5C66BD', icon:'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z' },
  ];

  function getMeta(type) {
    const base = BLOCK_TYPES.find(b => b.type === type) || BLOCK_TYPES[BLOCK_TYPES.length - 1];
    return { ...base, label: blockTypeLabel(type) };
  }

  function defaultContent(type) {
    switch(type) {
      case 'instruction':    return { title: trb('Инструкция', 'Instruction'), text:'', buttonText: trb('Далее', 'Next') };
      case 'survey':         return {
        schemaVersion: 'protocol_survey.v1',
        title: trb('Опрос', 'Survey'),
        description: '',
        submitButtonText: trb('Продолжить', 'Continue'),
        questions: [{
          id: 'question_' + Date.now(),
          text: '',
          type: 'open',
          required: false,
          options: []
        }]
      };
      case 'cognitive_task': return { taskType:'simple_rt', showFeedback:true, useRT:true, responseMode:'keypress', stimulusDuration:1000, trials:[], stimuliSource:'library', stimuliFolder:'' };
      case 'questionnaire':  return { questions:[] };
      case 'passive':        return { slideDuration:5000, slides:[], stimuliSource:'library', stimuliFolder:'' };
      case 'rest':           return { text:trb('Сделайте небольшой перерыв','Take a short break'), duration:30, durationUnit:'seconds' };
      case 'audio_test':     return { testType:'reading', prompt:trb('Спокойно прочитайте вслух: Сегодня хороший день для внимательной работы.','Read aloud calmly: Today is a good day for focused work.'), duration:12, durationUnit:'seconds' };
      case 'timer':          return { name:trb('Общее время сессии','Total session time'), hidden:true, startsAt:'session_start' };
      case 'finish':         return { title:trb('Эксперимент завершён','Experiment completed'), text:trb('Спасибо за участие!','Thank you for participating!') };
      default:               return {};
    }
  }



  const root = document.createElement('div');
  root.style.cssText = 'display:flex; gap:0; height:100%; min-height:0; overflow:hidden; width:100%;';

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
      <div style="font-size:10px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:var(--muted2);padding:0 4px 10px;">${tKey('builderStepsLabel')}</div>
      ${i18nPack().builderSteps.map((label, i) => {
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
          ${tKey('saveDraftBtn')}
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

  function showTrialTableModal(block, onSaveCallback) {
    if (!block.content.trials) block.content.trials = [];
    let currentTrials = JSON.parse(JSON.stringify(block.content.trials));

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,0.65);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:rgba(255,255,255,0.97);border:1px solid rgba(92,102,189,0.22);border-radius:20px;padding:20px 24px 18px;width:1180px;max-width:98vw;height:min(92vh,900px);display:flex;flex-direction:column;gap:12px;box-shadow:0 28px 72px rgba(10,15,35,0.30);';

    const stimuliOptions = stimuliList.map(s => `<option value="${previewEscape(s.id)}">${previewEscape(s.name)}</option>`).join('');
    const standardFolderId = typeof getStandardFolderId === 'function' ? getStandardFolderId() : 'folder_standard';
    const autoGenDefault = block.content?.stimuliFolder || standardFolderId;
    const folderOptions = folders.map(f => `<option value="${f.id}" ${f.id === autoGenDefault ? 'selected' : ''}>${typeof localizedFolderName === 'function' ? localizedFolderName(f) : f.name}</option>`).join('');
    const rtBounds = resolveRtBounds(block.content || {});
    const rtMinVal = block.content?.rtMin != null && block.content.rtMin !== '' ? block.content.rtMin : '';
    const rtMaxVal = block.content?.rtWindow != null && block.content.rtWindow !== '' ? block.content.rtWindow : '';
    const responseMode = ['keypress', 'click', 'pointer_intent', 'none'].includes(block.content?.responseMode)
      ? block.content.responseMode
      : 'keypress';

    modal.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0;gap:16px;">
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">${trb('Таблица проб', 'Trial table')}</div>
          <div style="font-size:18px;font-weight:700;color:var(--text);">
            ${block.label}
            <span id="trialCountBadge" style="display:inline-block;margin-left:8px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(92,102,189,.12);color:var(--accent);vertical-align:middle;">0</span>
          </div>
        </div>
        <button id="trialCloseBtn" style="background:none;border:none;cursor:pointer;color:var(--muted);padding:4px;border-radius:8px;">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="22" height="22"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
        <div style="padding:12px 14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;">${trb('Измерения', 'Measurements')}</div>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text);cursor:pointer;">
            <input type="checkbox" id="useRtCalcCb" ${(block.content.useRT !== false) ? 'checked' : ''} style="margin-top:2px;accent-color:var(--accent);">
            <span style="flex:1;">
              <span style="font-weight:600;display:block;">${trb('Время реакции', 'Reaction time')}</span>
              <span style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;">
                <input type="number" id="rtMinInput" min="1" placeholder="${rtBounds.rtMin}" value="${rtMinVal}" title="${trb('Мин. (мс)', 'Min (ms)')}" style="width:64px;padding:5px 6px;font-size:11px;border:1px solid var(--stroke);border-radius:6px;" ${(block.content.useRT !== false) ? '' : 'disabled'}>
                <span style="font-size:11px;color:var(--muted);">—</span>
                <input type="number" id="rtWindowInput" min="1" placeholder="${rtBounds.rtWindow}" value="${rtMaxVal}" title="${trb('Макс. (мс)', 'Max (ms)')}" style="width:64px;padding:5px 6px;font-size:11px;border:1px solid var(--stroke);border-radius:6px;" ${(block.content.useRT !== false) ? '' : 'disabled'}>
                <span style="font-size:11px;color:var(--muted);">${trb('мс', 'ms')}</span>
              </span>
            </span>
          </label>
          <label style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:5px;">
            <span>${trb('Способ ответа', 'Response mode')}</span>
            <select id="responseModeSel" style="padding:6px 8px;font-size:12px;border:1px solid var(--stroke);border-radius:6px;background:var(--card-bg);">
              <option value="keypress" ${responseMode==='keypress'?'selected':''}>${trb('Клавиша', 'Keypress')}</option>
              <option value="click" ${responseMode==='click'?'selected':''}>${trb('Клик', 'Click')}</option>
              <option value="pointer_intent" ${responseMode==='pointer_intent'?'selected':''}>${trb('Намеренное движение мыши', 'Pointer intent')}</option>
              <option value="none" ${responseMode==='none'?'selected':''}>${trb('Ответ не требуется', 'No response')}</option>
            </select>
            <span id="responseModeHint" style="font-size:10px;line-height:1.4;color:var(--muted2);"></span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);cursor:pointer;">
            <input type="checkbox" id="trialAoiCb" ${block.content.useAOI ? 'checked' : ''} style="accent-color:var(--accent);">
            <span style="font-weight:600;">AOI (${trb('области интереса', 'areas of interest')})</span>
          </label>
        </div>

        <div style="padding:12px 14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;">${trb('Презентация', 'Presentation')}</div>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text);cursor:pointer;">
            <input type="checkbox" id="useFixationCb" ${block.content.useFixation ? 'checked' : ''} style="margin-top:2px;accent-color:var(--accent);">
            <span style="flex:1;">
              <span style="font-weight:600;display:block;">${trb('Фиксация (+)', 'Fixation (+)')}</span>
              <span style="display:flex;align-items:center;gap:6px;margin-top:6px;">
                <input type="number" id="fixationDuration" value="${block.content.fixationDuration || 500}" style="width:72px;padding:5px 6px;font-size:11px;border:1px solid var(--stroke);border-radius:6px;" ${block.content.useFixation ? '' : 'disabled'}>
                <span style="font-size:11px;color:var(--muted);">${trb('мс', 'ms')}</span>
              </span>
            </span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);cursor:pointer;">
            <input type="checkbox" id="trialRandomizeCb" ${block.content.randomize ? 'checked' : ''} style="accent-color:var(--warn);">
            <span style="font-weight:600;color:var(--warn);">${trb('Перемешивать пробы', 'Randomize trials')}</span>
          </label>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text);cursor:pointer;">
            <input type="checkbox" id="randomIsiCb" ${block.content.randomInterStimulus ? 'checked' : ''} style="margin-top:2px;accent-color:var(--warn);">
            <span style="flex:1;">
              <span style="font-weight:600;display:block;">${trb('Случайная пауза перед стимулом', 'Random pre-stimulus interval')}</span>
              <span style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;">
                <input type="number" id="randomIsiMin" min="0" value="${block.content.interStimulusMinMs ?? 300}" style="width:68px;padding:5px 6px;font-size:11px;border:1px solid var(--stroke);border-radius:6px;" ${block.content.randomInterStimulus ? '' : 'disabled'}>
                <span style="font-size:11px;color:var(--muted);">—</span>
                <input type="number" id="randomIsiMax" min="0" value="${block.content.interStimulusMaxMs ?? 900}" style="width:68px;padding:5px 6px;font-size:11px;border:1px solid var(--stroke);border-radius:6px;" ${block.content.randomInterStimulus ? '' : 'disabled'}>
                <span style="font-size:11px;color:var(--muted);">${trb('мс', 'ms')}</span>
              </span>
            </span>
          </label>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text);cursor:pointer;">
            <input type="checkbox" id="fullscreenStimulusCb" ${block.content.fullscreenStimulus ? 'checked' : ''} style="margin-top:2px;accent-color:var(--accent);">
            <span><strong style="display:block;">${trb('Показывать на весь экран', 'Show in fullscreen')}</strong><small style="display:block;color:var(--muted);line-height:1.4;margin-top:3px;">${trb('Браузер запросит разрешение после нажатия «Начать».', 'The browser will request permission after the participant presses Start.')}</small></span>
          </label>
        </div>

        ${block.type === 'cognitive_task' ? `
        <div style="padding:12px 14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);display:flex;flex-direction:column;gap:10px;min-width:0;overflow:hidden;">
          <div style="font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;">${trb('Обратная связь', 'Feedback')}</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">
            <input type="checkbox" id="fbCb" ${block.content.showFeedback ? 'checked' : ''} style="accent-color:var(--accent);">
            <span style="font-weight:600;">${trb('Показывать участнику', 'Show to participant')}</span>
          </label>
          <div style="display:flex;flex-direction:column;gap:8px;min-width:0;">
            <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--muted);min-width:0;">
              <span>${trb('Верный ответ', 'Correct response')}</span>
              <input type="text" id="fbCorr" data-auto-i18n-value value="${block.content.feedbackCorrect || trb('Верно!','Correct!')}" placeholder="${trb('Например: Верно!', 'e.g. Correct!')}" style="width:100%;box-sizing:border-box;min-width:0;padding:6px 8px;font-size:11px;border:1px solid var(--stroke);border-radius:6px;" ${block.content.showFeedback ? '' : 'disabled'}>
            </label>
            <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--muted);min-width:0;">
              <span>${trb('Неверный ответ', 'Incorrect response')}</span>
              <input type="text" id="fbInc" data-auto-i18n-value value="${block.content.feedbackIncorrect || trb('Ошибка!','Error!')}" placeholder="${trb('Например: Ошибка!', 'e.g. Error!')}" style="width:100%;box-sizing:border-box;min-width:0;padding:6px 8px;font-size:11px;border:1px solid var(--stroke);border-radius:6px;" ${block.content.showFeedback ? '' : 'disabled'}>
            </label>
          </div>
        </div>

        <div style="padding:12px 14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em;">${trb('Правила ошибок', 'Error rules')}</div>
          <label style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
            <span>${trb('Пропуск ответа', 'Omission')}</span>
            <select id="omissionRuleSel" style="padding:6px 8px;font-size:12px;border:1px solid var(--stroke);border-radius:6px;background:var(--card-bg);">
              <option value="flag" ${block.content.omissionRule==='flag'?'selected':''}>${trb('Пометить как ошибку', 'Mark as error')}</option>
              <option value="skip" ${block.content.omissionRule==='skip'?'selected':''}>${trb('Проигнорировать', 'Ignore')}</option>
            </select>
          </label>
          <label style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
            <span>${trb('Лишнее нажатие', 'Commission')}</span>
            <select id="commissionRuleSel" style="padding:6px 8px;font-size:12px;border:1px solid var(--stroke);border-radius:6px;background:var(--card-bg);">
              <option value="flag" ${block.content.commissionRule==='flag'?'selected':''}>${trb('Пометить как ошибку', 'Mark as error')}</option>
              <option value="skip" ${block.content.commissionRule==='skip'?'selected':''}>${trb('Проигнорировать', 'Ignore')}</option>
            </select>
          </label>
        </div>` : ''}
      </div>

      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:4px;">
        <button id="addTrialRowBtn" class="quick-btn" style="font-size:12px;">+ ${trb('Добавить пробу', 'Add trial')}</button>
        <div style="width:1px;height:22px;background:var(--stroke);"></div>
        <span style="font-size:12px;color:var(--muted);font-weight:600;">${trb('Автогенерация:', 'Auto-generate:')}</span>
        <select id="autoGenFolder" style="padding:6px 10px;border-radius:8px;border:1px solid var(--stroke);font-size:12px;background:var(--card-bg);min-width:160px;">
          <option value="">— ${trb('папка', 'folder')} —</option>
          ${folderOptions}
        </select>
        <button id="autoGenBtn" class="quick-btn" style="background:rgba(92,102,189,.1);color:var(--accent);border-color:rgba(92,102,189,.2);font-size:12px;">${trb('Сгенерировать', 'Generate')}</button>
      </div>

      <div id="trialsContainer" style="flex:1;min-height:300px;overflow:auto;border:1px solid var(--stroke);border-radius:12px;background:rgba(255,255,255,.45);">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:rgba(92,102,189,.08);border-bottom:1px solid var(--stroke);">
              <th style="padding:10px 8px;width:44px;text-align:center;font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;">№</th>
              <th style="padding:10px 8px;text-align:left;font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;">${trb('Стимул', 'Stimulus')}</th>
              <th style="padding:10px 8px;width:120px;text-align:left;font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;">${trb('Условие', 'Condition')}</th>
              <th style="padding:10px 8px;width:140px;text-align:left;font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;">
                <div style="display:flex;align-items:center;gap:5px;">
                  <span>${trb('Действие', 'Action')}</span>
                  <button type="button" id="actionHelpBtn" title="${trb('Действие участника в ответ на стимул: клик мышью или нажатие клавиши (пробел, стрелки).', 'Participant action in response to stimulus: mouse click or key press (space, arrows).')}" style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;border:1px solid var(--stroke);font-size:9px;line-height:1;cursor:pointer;color:var(--muted);background:var(--card-bg);padding:0;flex-shrink:0;">!</button>
                </div>
              </th>
              <th style="padding:10px 8px;width:88px;text-align:center;font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;">${trb('Длит.', 'Dur.')}</th>
              <th style="padding:10px 8px;width:72px;text-align:center;font-size:10px;font-weight:700;color:var(--muted2);text-transform:uppercase;">${trb('Повт.', 'Reps')}</th>
              <th style="padding:10px 8px;width:40px;"></th>
            </tr>
          </thead>
          <tbody id="trialsTbody"></tbody>
        </table>
      </div>

      <div style="display:flex;gap:12px;justify-content:flex-end;flex-shrink:0;padding-top:12px;border-top:1px solid var(--stroke);">
        <button class="quick-btn" id="trialCancelBtn" style="background:transparent;border:1px solid var(--stroke);">${trb('Отмена', 'Cancel')}</button>
        <button class="quick-btn" id="trialSaveBtn" style="background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700;">${trb('Сохранить', 'Save')}</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const container = modal.querySelector('#trialsTbody');
    const trialCountBadge = modal.querySelector('#trialCountBadge');

    function updateTrialCountBadge() {
      if (trialCountBadge) trialCountBadge.textContent = String(currentTrials.length);
    }

    const fixCb = modal.querySelector('#useFixationCb');
    const fixInput = modal.querySelector('#fixationDuration');
    fixCb.addEventListener('change', () => { fixInput.disabled = !fixCb.checked; });
    const randomIsiCb = modal.querySelector('#randomIsiCb');
    const randomIsiMin = modal.querySelector('#randomIsiMin');
    const randomIsiMax = modal.querySelector('#randomIsiMax');
    randomIsiCb?.addEventListener('change', () => {
      randomIsiMin.disabled = !randomIsiCb.checked;
      randomIsiMax.disabled = !randomIsiCb.checked;
    });
    const useRtCalcCb = modal.querySelector('#useRtCalcCb');
    const rtMinInput = modal.querySelector('#rtMinInput');
    const rtWindowInput = modal.querySelector('#rtWindowInput');
    useRtCalcCb.addEventListener('change', () => {
      const on = useRtCalcCb.checked;
      if (rtMinInput) rtMinInput.disabled = !on;
      rtWindowInput.disabled = !on;
    });
    const responseModeSel = modal.querySelector('#responseModeSel');
    const responseModeHint = modal.querySelector('#responseModeHint');
    const refreshResponseModeHint = () => {
      const pointer = responseModeSel?.value === 'pointer_intent';
      responseModeHint.textContent = pointer
        ? trb(
          'Только для aiming/shooter-задач: движение засчитывается после baseline, dead-zone и устойчивого порога скорости/смещения.',
          'Only for aiming/shooter tasks: movement counts after baseline, dead-zone, and sustained velocity/displacement thresholds.'
        )
        : trb(
          'Для стратегий и меню используйте клик или клавишу.',
          'Use click or keypress for strategy and menu tasks.'
        );
    };
    responseModeSel?.addEventListener('change', refreshResponseModeHint);
    refreshResponseModeHint();
    modal.querySelector('#actionHelpBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toast(trb(
        'Действие участника в ответ на стимул: клик мышью или нажатие клавиши (пробел, стрелки).',
        'Participant action in response to stimulus: mouse click or key press (space, arrows).'
      ));
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
      updateTrialCountBadge();
      if (currentTrials.length === 0) {
        container.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:48px 20px;color:var(--muted);font-size:13px;">${trb('Таблица пуста. Добавьте пробу или сгенерируйте из папки.', 'Table is empty. Add a trial or generate from a folder.')}</td></tr>`;
        return;
      }

      container.innerHTML = currentTrials.map((trial, index) => `
        <tr class="trial-row" data-index="${index}" style="border-bottom:1px solid var(--stroke);background:${index % 2 ? 'rgba(92,102,189,.03)' : 'transparent'};">
          <td style="padding:8px;text-align:center;font-weight:600;color:var(--muted);">${index + 1}</td>
          <td style="padding:8px;">
            <select class="t-input t-stimulus" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;background:var(--card-bg);">
              <option value="">— ${trb('выбрать', 'select')} —</option>
              ${stimuliOptions}
            </select>
          </td>
          <td style="padding:8px;">
            <input class="t-input t-condition" value="${previewEscape(trial.condition || '')}" placeholder="${trb('условие', 'condition')}" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;" />
          </td>
          <td style="padding:8px;">
            <select class="t-input t-action" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;background:var(--card-bg);" ${trial.stimulusId ? '' : 'disabled'}>
              <option value="">— ${trb('не нужно', 'none')} —</option>
              <option value="mouse_click">${trb('Клик мышью', 'Mouse click')}</option>
              <option value="mouse_intent">${trb('Движение мыши', 'Pointer intent')}</option>
              <option value="space">${trb('Пробел', 'Space')}</option>
              <option value="arrow_up">${trb('Вверх', 'Up')}</option>
              <option value="arrow_down">${trb('Вниз', 'Down')}</option>
              <option value="arrow_right">${trb('Вправо', 'Right')}</option>
              <option value="arrow_left">${trb('Влево', 'Left')}</option>
            </select>
          </td>
          <td style="padding:8px;">
            <input type="number" class="t-input t-duration" min="1" value="${trial.duration || 1000}" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;text-align:center;" />
          </td>
          <td style="padding:8px;">
            <input type="number" class="t-input t-reps" value="${trial.repetitions || 1}" min="1" style="width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--stroke);font-size:12px;text-align:center;" />
          </td>
          <td style="padding:8px;text-align:center;">
            <button class="del-row-btn" data-index="${index}" title="${trb('Удалить', 'Delete')}" style="background:none;border:none;color:var(--bad);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:4px;border-radius:6px;">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </td>
        </tr>
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
      const scrollWrap = modal.querySelector('#trialsContainer');
      setTimeout(() => { if (scrollWrap) scrollWrap.scrollTop = scrollWrap.scrollHeight; }, 50);
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
      const scrollWrap = modal.querySelector('#trialsContainer');
      setTimeout(() => { if (scrollWrap) scrollWrap.scrollTop = scrollWrap.scrollHeight; }, 50);
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

      const selectedResponseMode = responseModeSel?.value || 'keypress';
      const actionMode = action => {
        if (action === 'mouse_click') return 'click';
        if (action === 'mouse_intent' || action === 'pointer_intent') return 'pointer_intent';
        if (!action) return 'none';
        return 'keypress';
      };
      const incompatibleTrial = currentTrials.findIndex(trial => {
        const mode = actionMode(trial.action || trial.correctResponse || '');
        if (selectedResponseMode === 'none') return mode !== 'none';
        return mode !== 'none' && mode !== selectedResponseMode;
      });
      if (incompatibleTrial !== -1) {
        toast(`${trb('Способ ответа не совпадает с действием в строке', 'Response mode does not match the action in row')} ${incompatibleTrial + 1}`);
        return;
      }

      block.content.trials = currentTrials.map(({ feedbackCorrect, feedbackIncorrect, correctFeedback, incorrectFeedback, feedbackText, feedbackError, ...trial }) => trial);
      block.content.randomize = modal.querySelector('#trialRandomizeCb').checked;
      block.content.useAOI = modal.querySelector('#trialAoiCb').checked;
      delete block.content.useEmotionTracking;
      delete block.content.useBPM;
      const useRtCalc = modal.querySelector('#useRtCalcCb').checked;
      if (useRtCalc && (parseInt(modal.querySelector('#rtWindowInput').value) || 0) <= 0) {
        toast('Укажите максимальное время ожидаемой реакции > 0 мс');
        return;
      }
      block.content.useRT = useRtCalc;
      block.content.responseMode = selectedResponseMode;
      if (useRtCalc) {
        const bounds = resolveRtBounds(block.content);
        const minRaw = parseInt(modal.querySelector('#rtMinInput').value);
        const maxRaw = parseInt(modal.querySelector('#rtWindowInput').value);
        block.content.rtMin = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : null;
        block.content.rtWindow = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : null;
        const resolvedMin = block.content.rtMin ?? bounds.rtMin;
        const resolvedMax = block.content.rtWindow ?? bounds.rtWindow;
        if (resolvedMin >= resolvedMax) {
          toast(trb('Минимальное время реакции должно быть меньше максимального', 'Minimum RT must be less than maximum RT'));
          return;
        }
      } else {
        block.content.rtMin = null;
        block.content.rtWindow = null;
      }
      block.content.useFixation = fixCb.checked;
      block.content.fixationDuration = parseInt(fixInput.value) || 500;
      const randomIntervalEnabled = !!randomIsiCb?.checked;
      const randomIntervalMin = Math.max(0, parseInt(randomIsiMin?.value, 10) || 0);
      const randomIntervalMax = Math.max(0, parseInt(randomIsiMax?.value, 10) || 0);
      if (randomIntervalEnabled && randomIntervalMin > randomIntervalMax) {
        toast(trb('Минимальная пауза должна быть меньше или равна максимальной', 'Minimum interval must be less than or equal to maximum interval'));
        return;
      }
      block.content.randomInterStimulus = randomIntervalEnabled;
      block.content.interStimulusMinMs = randomIntervalMin;
      block.content.interStimulusMaxMs = randomIntervalMax;
      block.content.fullscreenStimulus = !!modal.querySelector('#fullscreenStimulusCb')?.checked;

      if (block.type === 'cognitive_task') {
        block.content.showFeedback = modal.querySelector('#fbCb').checked;
        block.content.feedbackCorrect = modal.querySelector('#fbCorr').value || trb('Верно!','Correct!');
        block.content.feedbackIncorrect = modal.querySelector('#fbInc').value || trb('Ошибка!','Error!');

        block.content.omissionRule = modal.querySelector('#omissionRuleSel').value;
        block.content.commissionRule = modal.querySelector('#commissionRuleSel').value;
        block.content.selected_metrics = autoRtMetricsForTaskType(block.content.taskType, block.content);
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
    else if (currentStep === 4) renderStep4Aoi();
    else renderPlaceholder(currentStep);

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

  function hasLocalProtocolIdConflict(protocolId, currentExperimentId) {
    const normalized = String(protocolId || '').trim().toLowerCase();
    if (!normalized) return false;
    const experiments = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];
    return experiments.some(experiment => (
      String(experiment?.id || '') !== String(currentExperimentId || '')
      && String(experiment?.protocolId || experiment?.metadata?.protocolId || '').trim().toLowerCase() === normalized
    ));
  }

  function renderMetadataStep() {
    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:${BUILDER_CANVAS_PAD};gap:14px;overflow-y:auto;">
        ${builderStepHeader(0)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);">
            ${trb('Название эксперимента *','Experiment title *')}
            <input id="metaTitle" value="${previewEscape(protocolMeta.title || '')}" placeholder="${trb('Например: Внимание и рабочая память','For example: Attention and working memory')}" style="padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--card-bg);font-size:14px;color:var(--text);">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);">
            ${trb('ID протокола *','Protocol ID *')}
            <input id="metaProtocolId" value="${previewEscape(protocolMeta.protocolId || '')}" placeholder="attention-memory-v1" style="padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--card-bg);font-size:14px;color:var(--text);font-family:var(--mono);">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);">
            ${trb('Приблизительная длительность *','Estimated duration *')}
            <input id="metaDuration" value="${previewEscape(protocolMeta.estimatedDuration || '')}" placeholder="${trb('Например: 25 минут','For example: 25 minutes')}" style="padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--card-bg);font-size:14px;color:var(--text);">
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:var(--muted);grid-column:1/-1;">
            ${trb('Краткое описание','Short description')}
            <textarea id="metaDescription" rows="5" placeholder="${trb('Кратко опишите цель и структуру эксперимента','Briefly describe the goal and structure of the experiment')}" style="padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:var(--card-bg);font-size:14px;color:var(--text);font-family:inherit;resize:vertical;">${previewEscape(protocolMeta.description || '')}</textarea>
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
        <div style="flex-shrink:0;padding:${BUILDER_CANVAS_PAD};padding-bottom:0;">
          ${builderStepHeader(1)}
        </div>

        <!-- Cards — vertical scroll -->
        <div style="flex:1;min-height:0;padding:12px 16px 8px;">
          <div id="s0grid" style="height:100%;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:12px;padding:4px 2px;scroll-behavior:smooth;scrollbar-width:thin;"></div>
        </div>

        <!-- Footer -->
        <div style="flex-shrink:0;padding:12px 16px 16px;border-top:1px solid var(--stroke);display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <button id="step0Back" class="quick-btn" style="font-size:12px;">← ${trb('Назад', 'Back')}</button>
          <button id="step0Next" class="quick-btn" style="opacity:.35;pointer-events:none;padding:9px 28px;font-weight:600;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);white-space:nowrap;">${trb('Далее', 'Next')} →</button>
        </div>
      </div>
    `;

    const grid = canvasCol.querySelector('#s0grid');
    const nextBtn = canvasCol.querySelector('#step0Next');
    const backBtn = canvasCol.querySelector('#step0Back');
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
          'width:100%;flex-shrink:0;',
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
        const finalBlocks = [...mergedBlocks, { type:'finish', label: trb('Финальный экран', 'Finish screen'), content:{ title: trb('Эксперимент завершён', 'Experiment completed'), text: trb('Спасибо за участие!', 'Thank you for participating!') } }];
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
      <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;padding:${BUILDER_CANVAS_PAD};gap:12px;">
        ${builderStepHeader(2)}
        <div style="display:flex;flex:1;min-height:0;overflow:hidden;border:1px solid var(--stroke);border-radius:14px;background:rgba(255,255,255,.12);">
          <div style="width:196px;flex-shrink:0;border-right:1px solid var(--stroke);overflow-y:auto;padding:12px 10px;display:flex;flex-direction:column;">
            <div style="font-size:10px;font-weight:700;letter-spacing:.10em;text-transform:uppercase;color:var(--muted2);margin-bottom:10px;padding:0 2px;">${tKey('builderBlocksPalette')}</div>
            <div id="blockPalette" style="display:flex;flex-direction:column;gap:5px;"></div>
          </div>
          <div style="flex:1;display:flex;flex-direction:column;padding:12px 14px;overflow:hidden;min-width:0;">
            <div style="flex-shrink:0;margin-bottom:10px;">
              <div id="participantShellHint" style="font-size:11px;color:var(--muted);line-height:1.45;max-width:720px;">
                ${describeParticipantShellForUi(shell)}
              </div>
            </div>
            <div id="protoCanvas" style="flex:1;overflow-y:auto;border:2px dashed var(--stroke);border-radius:14px;padding:10px;background:rgba(255,255,255,.2);min-height:200px;"></div>
            <div style="display:flex;justify-content:space-between;margin-top:10px;flex-shrink:0;">
              <button class="quick-btn" id="backBtn0" style="font-size:12px;">${tKey('builderBack')}</button>
              <button class="quick-btn" id="nextBtn2" style="font-size:12px;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;">${tKey('builderNext')}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const palette = canvasCol.querySelector('#blockPalette');
    BLOCK_TYPES.filter(bt => !SYSTEM_BLOCK_TYPES.includes(bt.type)).forEach(bt => {
      const meta = getMeta(bt.type);
      const item = document.createElement('div');
      item.draggable = true;
      item.dataset.type = bt.type;
      item.style.cssText = 'display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:9px;border:1px solid var(--stroke);background:var(--card-bg);cursor:grab;font-size:11px;color:var(--text);';
      item.innerHTML = `
        <div style="width:22px;height:22px;border-radius:6px;background:${meta.color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <svg fill="none" stroke="${meta.color}" stroke-width="2" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="${meta.icon}"/></svg>
        </div>
        <span style="flex:1;line-height:1.3;">${meta.label}</span>
        <button data-type="${bt.type}" style="background:none;border:none;cursor:pointer;color:var(--muted2);display:flex;align-items:center;padding:1px;border-radius:4px;flex-shrink:0;" title="${trb('Добавить','Add')}">
          <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
        </button>
      `;
      item.querySelector('button').addEventListener('click', e => { e.stopPropagation(); addBlock(bt.type); });
      item.addEventListener('dragstart', e => e.dataTransfer.setData('blockType', bt.type));
      palette.appendChild(item);
    });

    renderCanvasBlocks();

    function syncParticipantShellFromForm() {
      protocolMeta.participantShell = { ...DEFAULT_PARTICIPANT_SHELL };
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

  function resolveInsertIndexFromY(canvas, clientY) {
    const zones = [...canvas.querySelectorAll('.proto-drop-zone')];
    if (!zones.length) return 0;
    let bestZone = zones[0];
    let bestScore = Infinity;
    zones.forEach(zone => {
      const rect = zone.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const score = Math.abs(clientY - mid);
      if (score < bestScore) {
        bestScore = score;
        bestZone = zone;
      }
    });
    return parseInt(bestZone.dataset.insertIdx, 10);
  }

  function wireDropZones(canvas) {
    let highlightedZone = null;

    function setDropHighlight(zone) {
      if (highlightedZone && highlightedZone !== zone) {
        highlightedZone.style.background = '';
        highlightedZone.style.outline = '';
        if (!highlightedZone.classList.contains('proto-drop-zone-empty')) {
          highlightedZone.style.height = '12px';
        }
      }
      highlightedZone = zone || null;
      if (zone) {
        zone.style.background = 'rgba(92,102,189,.16)';
        zone.style.outline = '2px dashed rgba(92,102,189,.45)';
        if (!zone.classList.contains('proto-drop-zone-empty')) {
          zone.style.height = '32px';
        }
      }
    }

    canvas.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      canvas.style.borderColor = 'var(--accent)';
      const zones = canvas.querySelectorAll('.proto-drop-zone');
      let best = null;
      let bestScore = Infinity;
      zones.forEach(zone => {
        const rect = zone.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const score = Math.abs(e.clientY - mid);
        if (score < bestScore) {
          bestScore = score;
          best = zone;
        }
      });
      setDropHighlight(best);
    };

    canvas.ondragleave = (e) => {
      if (!canvas.contains(e.relatedTarget)) {
        canvas.style.borderColor = 'var(--stroke)';
        setDropHighlight(null);
      }
    };

    canvas.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const insertIdx = resolveInsertIndexFromY(canvas, e.clientY);
      canvas.style.borderColor = 'var(--stroke)';
      setDropHighlight(null);
      const blockType = e.dataTransfer.getData('blockType');
      const fromRaw = e.dataTransfer.getData('protocolBlockIndex');
      if (blockType) {
        addBlock(blockType, insertIdx);
        return;
      }
      if (fromRaw !== '') {
        const from = parseInt(fromRaw, 10);
        if (Number.isFinite(from) && Number.isFinite(insertIdx)) moveBlockToIndex(from, insertIdx);
      }
    };
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
        infoEl.innerHTML = `<svg fill="none" stroke="var(--good)" stroke-width="2" viewBox="0 0 24 24" width="14" height="14" style="vertical-align:middle;margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>${previewEscape(file.name)} (${(file.size/1024).toFixed(1)} KB)`;
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
        resListEl.insertAdjacentHTML('beforeend', `<div>📄 ${previewEscape(f.name)}</div>`);
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
              <div style="font-size:11px;"><b>${previewEscape(b.id)}</b> <span style="color:var(--muted);">${previewEscape(b.type)}${b.trials?' · '+b.trials.length+' проб':''}</span></div>
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

  function addBlock(type, insertAt) {
    const meta = getMeta(type);
    const block = { id: createProtocolBlockId(type), type, label: meta.label, content: defaultContent(type) };
    const idx = Number.isFinite(insertAt) ? Math.max(0, Math.min(insertAt, experimentBlocks.length)) : experimentBlocks.length;
    if (type === 'survey' && surveyContract()?.isProtectedInstructionBoundary?.(experimentBlocks, idx)) {
      toast(trb(
        'Опрос нельзя поставить между инструкцией и связанным с ней заданием.',
        'A survey cannot be placed between an instruction and its task.'
      ));
      return;
    }
    if (type === 'survey' && !getParticipantShellMeta().consent) {
      protocolMeta.participantShell = { ...getParticipantShellMeta(), consent: true };
      const consentToggle = canvasCol.querySelector('#shellConsent');
      if (consentToggle) consentToggle.checked = true;
      const hint = canvasCol.querySelector('#participantShellHint');
      if (hint) hint.textContent = describeParticipantShellForUi(getParticipantShellMeta());
      toast(trb('Для опроса включено согласие участника.', 'Participant consent was enabled for the survey.'));
    }
    experimentBlocks.splice(idx, 0, block);
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
    renderCanvasBlocks();
  }

  function moveBlockToIndex(from, toIndex) {
    if (!Number.isFinite(from) || !Number.isFinite(toIndex) || from < 0 || from >= experimentBlocks.length) return;
    let target = Math.max(0, Math.min(toIndex, experimentBlocks.length));
    const moved = experimentBlocks[from];
    const remaining = experimentBlocks.filter((_, index) => index !== from);
    if (from < target) target -= 1;
    if (moved?.type === 'survey' && surveyContract()?.isProtectedInstructionBoundary?.(remaining, target)) {
      toast(trb(
        'Опрос нельзя поставить между инструкцией и связанным с ней заданием.',
        'A survey cannot be placed between an instruction and its task.'
      ));
      return;
    }
    remaining.splice(target, 0, moved);
    experimentBlocks = remaining;
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
    renderCanvasBlocks();
  }

  function renderCanvasBlocks() {
    const canvas = canvasCol.querySelector('#protoCanvas');
    if (!canvas) return;
    if (experimentBlocks.length === 0) {
      canvas.innerHTML = `
        <div class="proto-drop-zone proto-drop-zone-empty" data-insert-idx="0" style="height:100%;min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted);text-align:center;gap:8px;border-radius:11px;">
          <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="36" height="36" style="opacity:.35;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
          <div style="font-size:13px;font-weight:600;">${trb('Перетащите блоки сюда','Drag blocks here')}</div>
          <div style="font-size:11px;">${trb('или нажмите + рядом с блоком','or press + next to block')}</div>
        </div>`;
      wireDropZones(canvas);
      return;
    }

    const parts = [];
    experimentBlocks.forEach((b, i) => {
      parts.push(`<div class="proto-drop-zone" data-insert-idx="${i}" style="height:12px;margin:4px 0;border-radius:4px;transition:height .12s, background .12s, outline .12s;"></div>`);
      const meta = getMeta(b.type);
      const sel = b.id === selectedBlockId;
      const blockLabel = localizedBlockLabel(b, meta.label);
      const inlineEditor = sel ? buildBlockInlineEditor(b) : '';
      const canEdit = ['instruction', 'survey', 'rest', 'audio_test', 'timer', 'finish', 'cognitive_task', 'passive'].includes(b.type);

      parts.push(`
        <div class="proto-card ${sel ? 'proto-card-sel' : ''}" data-id="${previewEscape(b.id)}" data-idx="${i}"
          style="display:flex;flex-direction:column;padding:9px 11px;border-radius:11px;border:1px solid ${sel ? 'var(--accent)' : 'var(--stroke)'};background:${sel ? 'rgba(92,102,189,.07)' : 'var(--card-bg)'};margin-bottom:2px;position:relative;">
          <div style="display:flex;align-items:center;gap:9px;">
            <div class="proto-drag-handle" draggable="true" title="${trb('Перетащите для изменения порядка', 'Drag to reorder')}" style="width:28px;height:28px;border-radius:8px;background:${meta.color}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:grab;touch-action:none;">
              <svg fill="none" stroke="${meta.color}" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" d="${meta.icon}"/></svg>
            </div>
            <div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${previewEscape(blockLabel)}</div>
            </div>
            <div style="display:flex;gap:2px;flex-shrink:0;align-items:center;">
              ${canEdit ? `<button class="pcbtn edit-btn" data-id="${previewEscape(b.id)}" title="${trb('Редактировать', 'Edit')}" style="background:${sel ? 'rgba(92,102,189,.14)' : 'none'};border:none;cursor:pointer;color:${sel ? 'var(--accent)' : 'var(--muted2)'};padding:3px;border-radius:5px;display:flex;align-items:center;">
                <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="13" height="13"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>` : ''}
              <button class="pcbtn del-btn" data-id="${previewEscape(b.id)}" title="${trb('Удалить', 'Delete')}" style="background:none;border:none;cursor:pointer;color:var(--muted2);padding:3px;border-radius:5px;">
                <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
          ${inlineEditor}
        </div>`);
    });
    parts.push(`<div class="proto-drop-zone" data-insert-idx="${experimentBlocks.length}" style="height:12px;margin:4px 0;border-radius:4px;transition:height .12s, background .12s, outline .12s;"></div>`);
    canvas.innerHTML = parts.join('');

    canvas.querySelectorAll('.proto-card').forEach(card => {
      const block = experimentBlocks.find(b => b.id === card.dataset.id);
      if (!block) return;
      wireBlockCardInteractions(card, block);
      card.querySelector('.edit-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        selectedBlockId = selectedBlockId === block.id ? null : block.id;
        renderCanvasBlocks();
      });
      const dragHandle = card.querySelector('.proto-drag-handle');
      dragHandle?.addEventListener('dragstart', e => {
        e.stopPropagation();
        e.dataTransfer.setData('protocolBlockIndex', card.dataset.idx);
        e.dataTransfer.effectAllowed = 'move';
        card.style.opacity = '.55';
        dragHandle.style.cursor = 'grabbing';
      });
      dragHandle?.addEventListener('dragend', () => {
        card.style.opacity = '';
        dragHandle.style.cursor = 'grab';
        canvas.querySelectorAll('.proto-drop-zone').forEach(z => {
          z.style.background = '';
          z.style.outline = '';
          if (!z.classList.contains('proto-drop-zone-empty')) z.style.height = '12px';
        });
      });
    });
    canvas.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        experimentBlocks = experimentBlocks.filter(b => b.id !== btn.dataset.id);
        if (selectedBlockId === btn.dataset.id) selectedBlockId = null;
        localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
        renderCanvasBlocks();
        toast(trb('Блок удалён', 'Block deleted'));
      });
    });

    wireDropZones(canvas);
    setTimeout(() => applyAutoI18n(), 0);
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
        infoEl.innerHTML = `<svg fill="none" stroke="var(--good)" stroke-width="2" viewBox="0 0 24 24" width="14" height="14" style="vertical-align:middle;margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>${previewEscape(file.name)} (${(file.size/1024).toFixed(1)} KB)`;
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
        resListEl.insertAdjacentHTML('beforeend', `<div>📄 ${previewEscape(f.name)}</div>`);
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
              <div style="font-size:11px;"><b>${previewEscape(b.id)}</b> <span style="color:var(--muted);">${previewEscape(b.type)}${b.trials?' · '+b.trials.length+' проб':''}</span></div>
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
    header.style.cssText = `padding:${BUILDER_CANVAS_PAD};padding-bottom:0;flex-shrink:0;`;
    header.innerHTML = builderStepHeader(3);
    wrapper.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = `flex:1;overflow-y:auto;padding:12px 16px 14px;display:flex;flex-direction:column;gap:16px;`;

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
        <input id="builderStimuliFileInput" type="file" multiple accept="image/*,video/*,audio/*,.txt,.csv,.json,.pdf,.ppt,.pptx" style="display:none;">
        <input id="builderStimuliFolderInput" type="file" multiple webkitdirectory directory style="display:none;">
      </div>
    `;
    body.appendChild(uploadPanel);

    if (stimuliBlocks.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted);text-align:center;font-size:13px;margin-top:24px;padding:34px;border:1px dashed var(--stroke);border-radius:14px;background:var(--card-bg);';
      emptyState.innerHTML = `<div style="font-size:16px;font-weight:800;color:var(--text);margin-bottom:8px;">${trb('Настройка стимулов не требуется','No stimulus setup required')}</div>
        <div style="max-width:560px;line-height:1.6;">${trb('В выбранном протоколе нет когнитивных или пассивных блоков. Это корректно: добавьте такой блок на шаге «Протокол», если участнику нужно показывать стимулы.','The selected protocol has no cognitive or passive blocks. This is valid; add one on the Protocol step when participants need to see stimuli.')}</div>`;
      body.appendChild(emptyState);
    } else {
      stimuliBlocks.forEach(block => {
        const meta = getMeta(block.type);
        const trialsCount = (block.content?.trials || []).reduce((sum, trial) => sum + (parseInt(trial.repetitions) || 1), 0);

        const folderName = (() => {
          const f = folders.find(x => x.id === block.content.stimuliFolder);
          if (!f) return `<span>${trb('Не выбрана','Not selected')}</span>`;
          return previewEscape(typeof localizedFolderName === 'function' ? localizedFolderName(f) : f.name);
        })();
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
              <div style="font-size:15px;font-weight:700;color:var(--text);">${previewEscape(localizedBlockLabel(block, meta.label))}</div>
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
      if (fileInput) fileInput.disabled = true;
      if (folderInput) folderInput.disabled = true;
      wrapper.querySelector('#builderStimuliFileBtn').disabled = true;
      wrapper.querySelector('#builderStimuliFolderBtn').disabled = true;
      uploadPanel.style.pointerEvents = 'none';
      let importedCount = 0;
      try {
        const documents = files.filter(file => typeof isConvertibleStimulusDocument === 'function' && isConvertibleStimulusDocument(file));
        const mediaFiles = files.filter(file => !documents.includes(file));
        if (mediaFiles.length) {
          if (typeof handleFileUpload !== 'function') throw new Error(trb('Загрузчик медиа недоступен','Media uploader is unavailable'));
          const ids = await handleFileUpload(mediaFiles, (current, total) => setUploadProgress(current, total));
          importedCount += ids.length;
        }
        for (const file of documents) {
          if (typeof convertDocumentToStimuli !== 'function') throw new Error(trb('Конвертация документов недоступна','Document conversion is unavailable'));
          const progress = typeof showStimulusImportProgress === 'function' ? showStimulusImportProgress(file.name) : null;
          let converted;
          try {
            converted = await convertDocumentToStimuli(file, (current, total, phase) => {
              progress?.update(current, total, phase);
              setUploadProgress(current, total);
              if (statusEl && !phase) {
                statusEl.textContent = `${trb('Конвертация страницы','Converting page')} ${current} ${trb('из','of')} ${total}`;
              }
            });
          } finally {
            progress?.close();
          }
          stimuliList.unshift(...converted);
          importedCount += converted.length;
          if (typeof persistStimuliList === 'function') persistStimuliList();
          else localStorage.setItem('emocog_stimuli', JSON.stringify(stimuliList));
        }
      } catch (error) {
        if (statusEl) {
          statusEl.style.color = 'var(--bad)';
          statusEl.textContent = `${trb('Не удалось загрузить файлы','Could not upload files')}: ${error?.message || ''}`;
        }
        return;
      } finally {
        uploadPanel.style.pointerEvents = '';
        wrapper.querySelector('#builderStimuliFileBtn').disabled = false;
        wrapper.querySelector('#builderStimuliFolderBtn').disabled = false;
        if (fileInput) fileInput.disabled = false;
        if (folderInput) folderInput.disabled = false;
      }
      if (!importedCount) return;
      setUploadProgress(importedCount, importedCount, true);
      toast(`${trb('Добавлено стимулов:','Stimuli added:')} ${importedCount}`);
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
    stimuliList
      .filter(stimulus => stimulus?.apiContentUrl && !stimulus?._previewObjectUrl && !stimulus?._previewHydrating)
      .forEach(stimulus => {
        if (typeof hydrateApiStimulusPreview !== 'function') return;
        stimulus._previewHydrating = true;
        hydrateApiStimulusPreview(stimulus)
          .catch(() => {})
          .finally(() => { stimulus._previewHydrating = false; });
      });
    setTimeout(() => applyAutoI18n(wrapper), 0);
  }

  function aoiStimulusIdsForBlock(block) {
    const ids = [];
    const add = value => {
      const id = String(value || '').trim();
      if (id && !ids.includes(id)) ids.push(id);
    };
    const content = block?.content || {};
    let trials = Array.isArray(content.trials) ? content.trials : [];
    if (!trials.length && block?.type === 'cognitive_task') {
      trials = defaultExportTrialsForCognitiveBlock(content);
    }
    trials.forEach(trial => add(trial?.stimulusId ?? trial?.id));
    (content.stimuliIds || []).forEach(add);
    (content.slides || []).forEach(slide => add(typeof slide === 'object' ? (slide?.stimulusId ?? slide?.id) : slide));
    if (!ids.length && content.stimuliFolder) {
      const folder = folders.find(item => String(item.id) === String(content.stimuliFolder));
      (folder?.stimuliIds || []).forEach(add);
    }
    if (!ids.length && content.stimuliSource === 'library' && block?.type === 'passive') {
      stimuliList.forEach(stimulus => add(stimulus.id));
    }
    return ids;
  }

  function syncProtocolAoiFlags() {
    experimentBlocks.forEach(block => {
      if (block.type !== 'cognitive_task' && block.type !== 'passive') return;
      block.content = block.content || {};
      if (block.content.useAOI === true) {
        block.content.aoiSchemaVersion = globalThis.EmocogAoiProtocol?.AOI_SCHEMA_VERSION || '1.2';
      } else {
        delete block.content.aoiSchemaVersion;
      }
    });
    localStorage.setItem('emocog_protocol_blocks', JSON.stringify(experimentBlocks));
  }

  function renderAoiStimulusThumbnail(stimulus, stimulusId) {
    if ((stimulus?.type === 'image' || stimulus?.type === 'slides') && stimulus.url) {
      return `<img src="${previewEscape(stimulus.url)}" alt="${previewEscape(typeof localizedStimulusName === 'function' ? localizedStimulusName(stimulus) : (stimulus.name || stimulusId))}" style="width:100%;height:100%;object-fit:contain;">`;
    }
    if (stimulus?.type === 'video' && stimulus.url) {
      return `<video src="${previewEscape(stimulus.url)}" muted style="width:100%;height:100%;object-fit:contain;"></video>`;
    }
    return `<div style="transform:scale(.34);transform-origin:center;display:flex;align-items:center;justify-content:center;min-width:360px;min-height:240px;">${renderPreviewStimulus(stimulus, { stimulusId })}</div>`;
  }

  function renderStep4Aoi() {
    const blockRows = experimentBlocks
      .map((block, blockIndex) => ({ block, blockIndex, stimulusIds: aoiStimulusIdsForBlock(block) }))
      .filter(row => (
        (row.block.type === 'cognitive_task' || row.block.type === 'passive')
        && row.block.content?.useAOI === true
      ));
    const uniqueStimulusIds = [...new Set(blockRows.flatMap(row => row.stimulusIds))];
    const configuredCount = blockRows.reduce((count, row) => count + row.stimulusIds.filter(stimulusId => (
      Array.isArray(row.block.content?.aoiDefinitions?.[stimulusId])
      && row.block.content.aoiDefinitions[stimulusId].length > 0
    )).length, 0);
    const missingRows = blockRows.flatMap(row => row.stimulusIds
      .filter(stimulusId => !Array.isArray(row.block.content?.aoiDefinitions?.[stimulusId])
        || row.block.content.aoiDefinitions[stimulusId].length === 0)
      .map(stimulusId => ({ ...row, stimulusId })));
    const queueItems = blockRows.flatMap(row => row.stimulusIds.map(stimulusId => ({
      blockIndex: row.blockIndex,
      stimulusId
    })));

    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:${BUILDER_CANVAS_PAD};gap:12px;overflow:hidden;">
        ${builderStepHeader(4, `
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
            <span style="font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;background:color-mix(in srgb,var(--accent) 10%,transparent);color:var(--accent);">${uniqueStimulusIds.length} ${trb('стимулов с включённым AOI','AOI-enabled stimuli')}</span>
            <span style="font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;background:color-mix(in srgb,var(--good) 10%,transparent);color:var(--good);">${configuredCount} ${trb('настроек AOI для блоков','block AOI configurations')}</span>
            ${missingRows.length ? `<span style="font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;background:color-mix(in srgb,var(--warn) 12%,transparent);color:var(--warn);">${missingRows.length} ${trb('требуют разметки','need markup')}</span>` : ''}
          </div>`)}
        <div style="font-size:12px;color:var(--muted);padding:10px 12px;border:1px solid var(--stroke);border-radius:10px;background:var(--panel2);">
          ${trb('Здесь показаны все визуальные материалы из блоков, для которых на предыдущем шаге включена отметка AOI. Разметьте каждый материал: AOI сохраняются отдельно для каждого блока, даже если блоки используют один stimulusId.','All visual materials from blocks marked AOI on the previous step are shown here. Mark up every material: AOIs are stored separately for each block, even when blocks share one stimulusId.')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:8px;">
          ${[
            trb('Включите AOI у нужных блоков на предыдущем шаге.','Enable AOI for the required blocks on the previous step.'),
            trb('Откройте «Очередь разметки» или отдельный материал.','Open the Markup queue or one material.'),
            trb('Нарисуйте область, задайте имя и отметьте целевую AOI.','Draw an area, name it, and mark the target AOI.'),
            trb('Сохраните материал и перейдите к следующему.','Save the material and continue to the next one.')
          ].map((text, index) => `<div style="display:flex;gap:9px;align-items:flex-start;padding:10px;border:1px solid var(--stroke);border-radius:10px;background:var(--card-bg);"><span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);font-size:11px;font-weight:800;flex-shrink:0;">${index + 1}</span><span style="font-size:11px;line-height:1.45;color:var(--text);">${text}</span></div>`).join('')}
        </div>
        <div id="builderAoiBlocks" style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:14px;padding:2px 2px 8px;">
          ${blockRows.length ? blockRows.map(row => {
            const block = row.block;
            const meta = getMeta(block.type);
            return `<section style="border:1px solid var(--stroke);border-radius:14px;background:var(--card-bg);padding:14px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:9px;min-width:0;">
                  <div style="width:28px;height:28px;border-radius:8px;background:${meta.color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg fill="none" stroke="${meta.color}" stroke-width="2" viewBox="0 0 24 24" width="15" height="15"><path stroke-linecap="round" stroke-linejoin="round" d="${meta.icon}"/></svg></div>
                  <div><div style="font-size:13px;font-weight:800;color:var(--text);">${previewEscape(localizedBlockLabel(block, meta.label))}</div><div style="font-size:10px;color:var(--muted);margin-top:2px;">${row.stimulusIds.length} ${trb('выбранных стимулов','selected stimuli')}</div></div>
                </div>
                <span style="font-size:10px;font-weight:700;padding:4px 8px;border-radius:999px;background:${block.content?.useAOI ? 'color-mix(in srgb,var(--good) 10%,transparent)' : 'var(--panel2)'};color:${block.content?.useAOI ? 'var(--good)' : 'var(--muted)'};">AOI ${block.content?.useAOI ? 'ON' : 'OFF'}</span>
              </div>
              ${row.stimulusIds.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;">
                ${row.stimulusIds.map(stimulusId => {
                  const stimulus = stimuliList.find(item => String(item.id) === String(stimulusId));
                  const aois = block.content?.aoiDefinitions?.[stimulusId] || [];
                  const targets = aois.filter(aoi => aoi.isTarget).length;
                  const stimulusName = typeof localizedStimulusName === 'function' ? localizedStimulusName(stimulus) : (stimulus?.name || stimulusId);
                  return `<article class="builder-aoi-card" data-aoi-ready="${aois.length ? 'true' : 'false'}" style="border:1px solid ${aois.length ? 'var(--good)' : 'var(--warn)'};border-radius:12px;overflow:hidden;background:var(--card-bg);display:flex;flex-direction:column;min-width:0;">
                    <div style="height:112px;background:var(--panel2);display:flex;align-items:center;justify-content:center;overflow:hidden;border-bottom:1px solid var(--stroke);">${renderAoiStimulusThumbnail(stimulus, stimulusId)}</div>
                    <div style="padding:10px;display:flex;flex-direction:column;gap:7px;flex:1;">
                      <div style="font-size:12px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${previewEscape(stimulusName)}">${previewEscape(stimulusName)}</div>
                      <code style="font-size:9px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${previewEscape(stimulusId)}</code>
                      <div style="display:flex;gap:5px;flex-wrap:wrap;font-size:9px;font-weight:700;"><span style="padding:3px 6px;border-radius:999px;background:var(--panel2);color:${aois.length ? 'var(--accent)' : 'var(--warn)'};">${aois.length ? `AOI ${aois.length}` : trb('Требуется разметка','Markup required')}</span>${targets ? `<span style="padding:3px 6px;border-radius:999px;background:color-mix(in srgb,var(--good) 10%,transparent);color:var(--good);">${trb('целей','targets')} ${targets}</span>` : ''}</div>
                      <button class="quick-btn builder-aoi-edit" data-block-index="${row.blockIndex}" data-stimulus-id="${previewEscape(stimulusId)}" style="margin-top:auto;width:100%;justify-content:center;background:var(--panel2);border-color:${aois.length ? 'var(--good)' : 'var(--accent)'};color:${aois.length ? 'var(--good)' : 'var(--accent)'};font-size:11px;font-weight:800;" ${stimulus ? '' : 'disabled'}>${aois.length ? trb('Редактировать AOI','Edit AOIs') : trb('Создать AOI','Create AOI')}</button>
                    </div>
                  </article>`;
                }).join('')}
              </div>` : `<div style="font-size:12px;color:var(--muted);padding:18px;border:1px dashed var(--stroke);border-radius:10px;text-align:center;">${trb('Для этого блока ещё не выбраны стимулы. Вернитесь на шаг «Стимулы / Слайды» и заполните таблицу проб.','No stimuli have been selected for this block. Return to “Stimuli / Slides” and fill in the trial table.')}</div>`}
            </section>`;
          }).join('') : `<div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);border:1px dashed var(--stroke);border-radius:14px;padding:28px;">${trb('Нет блоков с включённой отметкой AOI. Вернитесь на шаг «Стимулы / Слайды», откройте таблицу проб нужного блока и включите AOI.','No blocks have AOI enabled. Return to “Stimuli / Slides”, open the required block trial table, and enable AOI.')}</div>`}
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px;flex-shrink:0;padding-top:10px;border-top:1px solid var(--stroke);">
          <div style="display:flex;gap:8px;">
            <button class="quick-btn" id="aoiStepBack" style="font-size:12px;">← ${trb('Назад','Back')}</button>
            <button class="quick-btn" id="aoiQueueButton" style="background:var(--panel2);border-color:var(--accent);color:var(--accent);font-weight:700;font-size:12px;" ${queueItems.length ? '' : 'disabled'}>${trb('Очередь разметки','Markup queue')} · ${queueItems.length}</button>
          </div>
          <button class="quick-btn" id="aoiStepNext" style="background:var(--panel2);border-color:${missingRows.length ? 'var(--stroke)' : 'var(--accent)'};color:${missingRows.length ? 'var(--muted)' : 'var(--accent)'};font-weight:700;font-size:12px;" ${missingRows.length ? 'aria-disabled="true"' : ''}>${trb('Далее','Next')} →</button>
        </div>
      </div>`;

    const openQueueItem = (item, queueIndex = null) => {
        const stimulusId = item.stimulusId;
        const block = experimentBlocks[parseInt(item.blockIndex, 10)];
        if (!block) return;
        block.content = block.content || {};
        block.content.aoiDefinitions = block.content.aoiDefinitions || {};
        if (typeof openAoiEditor !== 'function') {
          toast(trb('Редактор AOI недоступен','AOI editor is unavailable'));
          return;
        }
        openAoiEditor(stimulusId, {
          previewHtml: renderPreviewStimulus(previewStimulusById(stimulusId), { stimulusId }),
          initialAois: block.content.aoiDefinitions[stimulusId] || [],
          onPersist: aois => {
            if (aois.length) block.content.aoiDefinitions[stimulusId] = JSON.parse(JSON.stringify(aois));
            else delete block.content.aoiDefinitions[stimulusId];
            syncProtocolAoiFlags();
          },
          onChange: () => syncProtocolAoiFlags(),
          onClose: () => {
            syncProtocolAoiFlags();
            if (currentStep === 4) renderStep4Aoi();
          },
          ...(queueIndex === null ? {} : {
            queueIndex,
            queueTotal: queueItems.length,
            onSaveAndNext: () => {
              syncProtocolAoiFlags();
              const nextItem = queueItems[queueIndex + 1];
              if (nextItem) openQueueItem(nextItem, queueIndex + 1);
              else if (currentStep === 4) renderStep4Aoi();
            }
          })
        });
    };
    canvasCol.querySelectorAll('.builder-aoi-edit').forEach(button => {
      button.addEventListener('click', () => {
        openQueueItem({
          stimulusId: button.dataset.stimulusId,
          blockIndex: parseInt(button.dataset.blockIndex, 10)
        });
      });
    });
    canvasCol.querySelector('#aoiQueueButton')?.addEventListener('click', () => {
      if (queueItems.length) openQueueItem(queueItems[0], 0);
    });
    canvasCol.querySelector('#aoiStepBack').addEventListener('click', () => { currentStep = 3; renderStepper(); renderCanvas(); });
    canvasCol.querySelector('#aoiStepNext').addEventListener('click', () => {
      if (missingRows.length) {
        const firstMissing = canvasCol.querySelector('.builder-aoi-card[data-aoi-ready="false"]');
        firstMissing?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(trb(
          `Разметьте AOI для всех выбранных материалов. Осталось: ${missingRows.length}`,
          `Create AOIs for every selected material. Remaining: ${missingRows.length}`
        ));
        return;
      }
      syncProtocolAoiFlags();
      currentStep = 5;
      renderStepper();
      renderCanvas();
    });
    setTimeout(() => applyAutoI18n(canvasCol), 0);
  }

  function renderPlaceholder(stepIdx) {
    const s = i18nPack().builderSteps[stepIdx];
    const isLast = stepIdx === i18nPack().builderSteps.length - 1;
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
    <div style="display:flex;flex-direction:column;height:100%;padding:${BUILDER_CANVAS_PAD};gap:14px;">
      ${builderStepHeader(stepIdx)}
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
    const builderKey = experimentId || 'draft';
    const apiState = typeof loadBuilderApiState === 'function' ? loadBuilderApiState(builderKey) : {};
    const code = apiState.invitationCode;
    if (!code || !apiState.publishVerifiedAt) return '';
    if (typeof window.buildParticipantRunLink === 'function') {
      return window.buildParticipantRunLink(code);
    }
    return getParticipantWebBasePath() + 'run_new.html?code=' + encodeURIComponent(code);
  }

  function showProtocolPreview() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,35,0.65);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:rgba(255,255,255,0.97);border:1px solid var(--stroke);border-radius:18px;padding:20px;width:720px;max-width:96vw;max-height:84vh;display:flex;flex-direction:column;gap:14px;box-shadow:0 24px 70px rgba(10,15,35,.28);';
    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div>
          <div style="font-size:17px;font-weight:800;color:var(--text);">${previewEscape(protocolMeta.title || 'Предпросмотр эксперимента')}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">Protocol ID: <code>${previewEscape(protocolMeta.protocolId || '—')}</code> · ${experimentBlocks.length} блоков</div>
        </div>
        <button id="previewCloseBtn" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:22px;">×</button>
      </div>
      <div style="overflow:auto;border:1px solid var(--stroke);border-radius:12px;background:rgba(255,255,255,.42);padding:10px;display:flex;flex-direction:column;gap:8px;">
        ${experimentBlocks.map((b, i) => {
          const trials = (b.content?.trials || []).reduce((sum, tr) => sum + (parseInt(tr.repetitions) || 1), 0);
          return `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:10px;background:var(--card-bg);border:1px solid var(--stroke);">
            <div style="width:24px;height:24px;border-radius:50%;background:rgba(92,102,189,.12);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;">${i+1}</div>
            <div style="min-width:0;">
              <div style="font-size:13px;font-weight:800;color:var(--text);">${previewEscape(b.label || b.type)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px;">${previewEscape(b.type)}${b.content?.taskType ? ' · ' + previewEscape(b.content.taskType) : ''}${trials ? ' · ' + trials + ' проб' : ''}</div>
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
      <div style="display:flex;flex-direction:column;height:100%;padding:${BUILDER_CANVAS_PAD};gap:14px;overflow-y:auto;">
        ${builderStepHeader(8)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div style="padding:14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);">
            <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">${trb('Эксперимент','Experiment')}</div>
            <div style="font-size:16px;font-weight:800;color:var(--text);margin-top:6px;">${previewEscape(protocolMeta.title || '—')}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px;">${previewEscape(protocolMeta.estimatedDuration || '—')} · ${experimentBlocks.length} блоков</div>
          </div>
          <div style="padding:14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);">
            <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Protocol ID</div>
            <code style="display:block;font-size:14px;color:var(--accent);margin-top:8px;word-break:break-all;">${previewEscape(protocolMeta.protocolId || '—')}</code>
          </div>
        </div>
        <div style="padding:14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:13px;font-weight:800;color:var(--text);">${trb('Ссылка для участников','Participant link')}</div>
          <div style="font-size:11px;color:var(--muted);line-height:1.45;">${previewEscape(shellLine)}</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input id="participantLinkInput" readonly value="${previewEscape(link)}" placeholder="${trb('Ссылка появится после публикации','The link will appear after publishing')}" style="flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--stroke);background:rgba(255,255,255,.62);font-size:12px;color:var(--text);font-family:var(--mono);">
            <button class="quick-btn" id="copyParticipantLinkBtn" style="font-size:12px;" ${link ? '' : 'disabled'}>${trb('Скопировать','Copy')}</button>
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
      if (!input.value) return toast(trb('Сначала опубликуйте протокол','Publish the protocol first'));
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
    return experimentBlocks.filter(b => !SYSTEM_BLOCK_TYPES.includes(b.type) && b.type !== 'timer');
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
    const url = stimulus._previewObjectUrl || stimulus.url || stimulus.src;

    if ((stimulus.type === 'image' || stimulus.type === 'slides') && url) {
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

    const standard = window.StandardStimuli?.resolveStandardStimulus?.(id, stimulus, { lang: CURRENT_LANG });
    if (standard?.type === 'image' && standard.src) {
      return `<img src="${previewEscape(standard.src)}" alt="${name}" style="max-width:min(72vw,620px);max-height:48vh;object-fit:contain;border-radius:14px;">`;
    }
    if (standard?.type === 'text') {
      const style = standard.style || {};
      return `<div style="font-size:${previewEscape(style.fontSize || 'clamp(42px,8vw,86px)')};font-weight:${previewEscape(style.fontWeight || '900')};letter-spacing:${previewEscape(style.letterSpacing || 'normal')};color:${previewEscape(style.color || '#0f172a')};text-align:center;line-height:1.12;white-space:nowrap;">${previewEscape(standard.text)}</div>`;
    }
    if (standard?.type === 'shape') {
      const shapeCss = Object.entries(standard.style || {}).map(([key, value]) => `${key.replace(/[A-Z]/g, char => '-' + char.toLowerCase())}:${value}`).join(';');
      return `<div style="${previewEscape(shapeCss)}"></div>`;
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
      const emotionKey = String(stimulus.emotion || (id.match(/^std_emo_([a-z]+)_/i) || [])[1] || 'neutral').toLowerCase();
      const emoVisual = {
        neutral:  { emoji: '😐', bg: 'rgba(148,163,184,.22)', border: 'rgba(148,163,184,.45)', label: CURRENT_LANG === 'en' ? 'neutral' : 'нейтрально' },
        happy:    { emoji: '😊', bg: 'rgba(245,158,11,.18)', border: 'rgba(245,158,11,.42)', label: CURRENT_LANG === 'en' ? 'happy' : 'радость' },
        anger:    { emoji: '😠', bg: 'rgba(220,38,38,.14)', border: 'rgba(220,38,38,.38)', label: CURRENT_LANG === 'en' ? 'anger' : 'гнев' },
        sad:      { emoji: '😢', bg: 'rgba(59,130,246,.14)', border: 'rgba(59,130,246,.38)', label: CURRENT_LANG === 'en' ? 'sad' : 'грусть' },
        fear:     { emoji: '😨', bg: 'rgba(139,92,246,.14)', border: 'rgba(139,92,246,.38)', label: CURRENT_LANG === 'en' ? 'fear' : 'страх' },
        surprise: { emoji: '😲', bg: 'rgba(6,182,212,.14)', border: 'rgba(6,182,212,.38)', label: CURRENT_LANG === 'en' ? 'surprise' : 'удивление' },
        disgust:  { emoji: '🤢', bg: 'rgba(22,163,74,.14)', border: 'rgba(22,163,74,.38)', label: CURRENT_LANG === 'en' ? 'disgust' : 'отвращение' },
      };
      const vis = emoVisual[emotionKey] || emoVisual.neutral;
      return `<div style="width:min(340px,70vw);aspect-ratio:4/3;border-radius:24px;background:${vis.bg};border:1px solid ${vis.border};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#0f172a;">
        <div style="font-size:76px;line-height:1;">${vis.emoji}</div>
        <div style="font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;">${previewEscape(vis.label)}</div>
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

  function timedBlockDurationMs(content, fallbackSeconds) {
    const explicitMs = Number(content?.durationMs);
    if (Number.isFinite(explicitMs) && explicitMs > 0) return Math.round(explicitMs);
    const value = Number(content?.duration);
    if (!Number.isFinite(value) || value <= 0) return fallbackSeconds * 1000;
    if (content?.durationUnit === 'seconds') return Math.round(value * 1000);
    return Math.round(value >= 1000 ? value : value * 1000);
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
    if (block.type === 'rest') {
      const seconds = timedBlockDurationMs(block.content, 30) / 1000;
      return `${trb('Пауза','Pause')}: ${seconds} ${trb('сек.','sec.')}`;
    }
    if (block.type === 'audio_test') return `${trb('Аудиотест','Audio test')}: ${block.content?.duration || 12} ${trb('сек.','sec.')}`;
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
    let speed = 1.0;
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
                ${[1, 1.5, 2].map(v => `<option value="${v}" ${Math.abs(speed - v) < 0.01 ? 'selected' : ''}>${v}x</option>`).join('')}
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
        speed = parseFloat(e.target.value) || 1;
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
      <div style="display:flex;flex-direction:column;height:100%;padding:${BUILDER_CANVAS_PAD};gap:14px;overflow-y:auto;">
        ${builderStepHeader(5)}
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
    const featuresKey = 'emocog_session_features_' + (experimentId || 'draft');
    const importedFeatureFlags = parsedExperimentData?.json?.settings?.featureFlags
      || editingExp?.sessionFeatureFlags
      || {};
    const sessionFeatures = JSON.parse(localStorage.getItem(featuresKey) || 'null') || {
      audio: importedFeatureFlags.audio === true,
      multimodal: importedFeatureFlags.multimodal !== false,
      bodyMovement: importedFeatureFlags.bodyMovement !== false,
      gamerMode: importedFeatureFlags.gamerMode === true
    };

    canvasCol.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = `display:flex;flex-direction:column;height:100%;padding:${BUILDER_CANVAS_PAD};gap:14px;overflow-y:auto;`;
    wrap.innerHTML = `
      ${builderStepHeader(6)}
      <div style="flex:1;display:flex;flex-direction:column;gap:12px;overflow-y:auto;">
        <div style="padding:14px 16px;background:var(--card-bg);border:1px solid var(--stroke);border-radius:12px;">
          <div style="font-size:13px;font-weight:700;color:var(--text);">${trb('Фоновые исследовательские модули','Background research modules')}</div>
          <div style="font-size:11px;color:var(--muted);margin:4px 0 10px;line-height:1.45;">${trb('Аудио требует отдельного согласия участника. Сырые аудио, видео и landmarks не сохраняются.','Audio requires separate participant consent. Raw audio, video, and landmarks are not stored.')}</div>
          ${[
            { key:'audio', label:trb('Акустические признаки голоса','Acoustic voice features') },
            { key:'multimodal', label:trb('Мультимодальная карта','Multimodal map') },
            { key:'bodyMovement', label:trb('Движение корпуса','Body movement') },
            { key:'gamerMode', label:trb('Расширенный режим для игровых исследований','Extended gamer research mode') }
          ].map(item => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:12px;color:var(--text);"><input type="checkbox" class="session-feature" data-key="${item.key}" ${sessionFeatures[item.key] ? 'checked' : ''} style="width:auto;"><span>${item.label}</span></label>`).join('')}
        </div>
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
                style="flex:1;--qc-track:linear-gradient(90deg,#ef4444 0%, #ef4444 ${(((param.yellowFrom - param.min) / (param.max - param.min)) * 100).toFixed(2)}%, #f59e0b ${(((param.yellowFrom - param.min) / (param.max - param.min)) * 100).toFixed(2)}%, #f59e0b ${(((param.greenFrom - param.min) / (param.max - param.min)) * 100).toFixed(2)}%, #22c55e ${(((param.greenFrom - param.min) / (param.max - param.min)) * 100).toFixed(2)}%, #22c55e 100%);"
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
      wrap.querySelectorAll('.session-feature').forEach(cb => {
        sessionFeatures[cb.dataset.key] = cb.checked;
      });
      if (!sessionFeatures.multimodal) sessionFeatures.gamerMode = false;
      localStorage.setItem(featuresKey, JSON.stringify(sessionFeatures));
    }
    wrap.querySelectorAll('#qcBack2').forEach(b => b.addEventListener('click', () => { saveQC(); currentStep--; renderStepper(); renderCanvas(); }));
    wrap.querySelector('#qcNext').addEventListener('click', () => { saveQC(); currentStep++; renderStepper(); renderCanvas(); });
  }

  function renderAnalyticsStep() {
    const analyticsApi = typeof window !== 'undefined' ? window.EmocogAnalyticsPlan : null;
    if (!analyticsApi) {
      canvasCol.innerHTML = `<div style="padding:${BUILDER_CANVAS_PAD};"><div class="card" style="padding:18px;color:var(--bad);">${trb('Конфигурация аналитики недоступна.','Analytics configuration is unavailable.')}</div></div>`;
      return;
    }
    const builderKey = experimentId || 'draft';
    let plan = getBuilderAnalyticsPlan();
    let metricsOpen = false;
    let overridesOpen = false;
    const analyzableBlocks = experimentBlocks.filter(block => block && (block.type === 'cognitive_task' || block.type === 'passive'));
    const lang = CURRENT_LANG === 'en' ? 'en' : 'ru';
    const esc = value => String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const labelFor = def => def?.label?.[lang] || def?.label?.ru || def?.id || '';
    const descriptionFor = def => def?.description?.[lang] || def?.description?.ru || '';

    function persistPlan() {
      plan = analyticsApi.save(builderKey, plan, experimentBlocks);
      return plan;
    }

    function selectedPackageCount() {
      return plan.defaultPackages.filter(id => id !== 'data_quality').length + 1;
    }

    const analyticsHeaderExtra = `
      <div id="analyticsSelectedSummary" style="display:inline-flex;align-items:center;gap:8px;margin-top:12px;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.62);border:1px solid rgba(92,102,189,.16);font-size:12px;font-weight:600;color:var(--accent);"></div>`;
    canvasCol.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:${BUILDER_CANVAS_PAD};gap:16px;overflow-y:auto;">
        ${builderStepHeader(7, analyticsHeaderExtra)}
        <div id="analyticsPlanContent"></div>

        <div style="display:flex;justify-content:space-between;padding-top:10px;border-top:1px solid var(--stroke);margin-top:auto;">
          <button class="quick-btn" id="analyticsBackBtn" style="font-size:12px;">← ${trb('Назад', 'Back')}</button>
          <button class="quick-btn" id="analyticsNextBtn" style="background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;font-size:12px;">${trb('Далее', 'Next')} →</button>
        </div>
      </div>
    `;

    function packageCardsHtml(packageIds, capabilities, scope, blockId) {
      return analyticsApi.packages.map(pkg => {
        const available = analyticsApi.isPackageAvailable(pkg.id, capabilities);
        const enabled = packageIds.includes(pkg.id);
        const locked = pkg.mandatory === true;
        const unavailableReason = pkg.availability === 'aoi'
          ? trb('Сначала добавьте AOI в этот протокол/блок.', 'Add an AOI to this protocol/block first.')
          : pkg.availability === 'task'
            ? trb('Доступно для блоков с оцениваемой задачей.', 'Available for blocks with a scorable task.')
            : '';
        return `
          <label style="display:flex;gap:12px;padding:14px;border:1.5px solid ${enabled ? pkg.color : 'var(--stroke)'};border-radius:14px;background:${enabled ? pkg.color + '0D' : 'var(--card-bg)'};opacity:${available ? '1' : '.56'};cursor:${locked || !available ? 'default' : 'pointer'};transition:.15s;">
            <div style="width:36px;height:36px;border-radius:11px;background:${pkg.color}18;color:${pkg.color};display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;">${pkg.icon}</div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
                <div>
                  <div style="font-size:13px;font-weight:750;color:var(--text);">${esc(labelFor(pkg))}</div>
                  ${locked ? `<span style="display:inline-block;margin-top:4px;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${pkg.color};">${trb('Обязательно','Required')}</span>` : ''}
                </div>
                <input type="checkbox" class="${scope === 'global' ? 'an-package-cb' : 'an-block-package-cb'}" data-package-id="${esc(pkg.id)}" ${blockId ? `data-block-id="${esc(blockId)}"` : ''} ${enabled ? 'checked' : ''} ${locked || !available ? 'disabled' : ''} style="width:17px;height:17px;accent-color:${pkg.color};flex-shrink:0;">
              </div>
              <div style="font-size:11px;color:var(--muted);line-height:1.45;margin-top:6px;">${esc(descriptionFor(pkg))}</div>
              ${!available ? `<div style="font-size:10px;color:var(--warn);margin-top:6px;">${esc(unavailableReason)}</div>` : ''}
            </div>
          </label>`;
      }).join('');
    }

    function metricGroupsHtml() {
      return analyticsApi.packages.map(pkg => {
        if (!plan.defaultPackages.includes(pkg.id)) return '';
        const packageMetrics = analyticsApi.metrics.filter(metric => metric.packageId === pkg.id);
        if (!packageMetrics.length) {
          return `<div style="padding:12px 14px;border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);">
            <div style="font-size:12px;font-weight:700;color:var(--text);">${esc(labelFor(pkg))}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:5px;">${trb('Использует выбранные показатели и добавляет групповые распределения, N и описательные сводки.','Uses selected outcomes and adds group distributions, N, and descriptive summaries.')}</div>
          </div>`;
        }
        return `<div style="border:1px solid var(--stroke);border-radius:12px;background:var(--card-bg);overflow:hidden;">
          <div style="padding:10px 14px;background:${pkg.color}0B;border-bottom:1px solid var(--stroke);font-size:12px;font-weight:700;color:var(--text);">${esc(labelFor(pkg))}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(255px,1fr));">
            ${packageMetrics.map(metric => {
              const checked = plan.selectedMetricIds.includes(metric.id);
              const locked = metric.mandatory === true;
              return `<label style="display:flex;align-items:flex-start;gap:9px;padding:10px 14px;border-bottom:1px solid rgba(100,116,139,.09);cursor:${locked ? 'default' : 'pointer'};">
                <input type="checkbox" class="an-metric-cb" data-metric-id="${esc(metric.id)}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''} style="margin-top:2px;width:15px;height:15px;accent-color:${pkg.color};">
                <span style="min-width:0;">
                  <span style="display:block;font-size:11px;font-weight:650;color:var(--text);">${esc(labelFor(metric))}${locked ? ` · ${trb('обязательно','required')}` : ''}</span>
                  <span style="display:block;font-size:10px;line-height:1.4;color:var(--muted);margin-top:3px;">${esc(descriptionFor(metric))}</span>
                </span>
              </label>`;
            }).join('')}
          </div>
        </div>`;
      }).join('');
    }

    function blockMetricsHtml(override, blockId) {
      const enabledPackages = new Set(override.packages);
      const availableMetrics = analyticsApi.metrics.filter(metric => enabledPackages.has(metric.packageId));
      if (!availableMetrics.length) return '';
      return `<details style="margin-top:10px;border:1px solid var(--stroke);border-radius:10px;overflow:hidden;background:rgba(255,255,255,.3);">
        <summary style="cursor:pointer;list-style:none;padding:9px 11px;display:flex;justify-content:space-between;gap:8px;font-size:10px;font-weight:700;color:var(--text);">
          <span>${trb('Настроить метрики этой задачи','Configure metrics for this task')}</span>
          <span style="color:var(--muted);font-weight:550;">${override.selectedMetricIds.length} ${trb('выбрано','selected')} ▾</span>
        </summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));border-top:1px solid var(--stroke);">
          ${availableMetrics.map(metric => {
            const pkg = analyticsApi.packages.find(item => item.id === metric.packageId);
            const locked = metric.mandatory === true;
            return `<label style="display:flex;align-items:flex-start;gap:8px;padding:9px 11px;border-bottom:1px solid rgba(100,116,139,.09);cursor:${locked ? 'default' : 'pointer'};">
              <input type="checkbox" class="an-block-metric-cb" data-block-id="${esc(blockId)}" data-metric-id="${esc(metric.id)}" ${override.selectedMetricIds.includes(metric.id) ? 'checked' : ''} ${locked ? 'disabled' : ''} style="margin-top:1px;width:14px;height:14px;accent-color:${pkg?.color || 'var(--accent)'};">
              <span style="font-size:10px;line-height:1.4;color:var(--text);">${esc(labelFor(metric))}${locked ? ` · ${trb('обязательно','required')}` : ''}</span>
            </label>`;
          }).join('')}
        </div>
      </details>`;
    }

    function blockOverridesHtml() {
      if (!analyzableBlocks.length) {
        return `<div style="font-size:11px;color:var(--muted);padding:12px;">${trb('В протоколе пока нет блоков, для которых можно настроить аналитику.','The protocol has no blocks that can be configured for analytics yet.')}</div>`;
      }
      return analyzableBlocks.map(block => {
        const blockId = String(block.id);
        const override = plan.blockOverrides[blockId] || null;
        const capabilities = analyticsApi.blockCapabilities(block);
        const blockName = localizedBlockLabel(block, block.label || block.type || blockId);
        const inheritedLabels = plan.defaultPackages.map(id => labelFor(analyticsApi.packages.find(pkg => pkg.id === id))).join(' · ');
        const ownLabels = override ? override.packages.map(id => labelFor(analyticsApi.packages.find(pkg => pkg.id === id))).join(' · ') : '';
        return `<div style="padding:13px 14px;border:1px solid var(--stroke);border-radius:13px;background:var(--card-bg);">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
            <div style="min-width:0;">
              <div style="font-size:12px;font-weight:750;color:var(--text);">${esc(blockName)}</div>
              <div style="font-size:10px;color:var(--muted);margin-top:3px;">${esc(blockId)} · ${block.type === 'cognitive_task' ? trb('задача','task') : trb('пассивный просмотр','passive viewing')}</div>
            </div>
            <label style="display:flex;align-items:center;gap:7px;font-size:10px;font-weight:650;color:var(--muted);cursor:pointer;white-space:nowrap;">
              <input type="checkbox" class="an-block-override-cb" data-block-id="${esc(blockId)}" ${override ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--accent);">
              ${trb('Свой набор','Custom set')}
            </label>
          </div>
          ${override ? `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(225px,1fr));gap:8px;margin-top:12px;">
              ${packageCardsHtml(override.packages, capabilities, 'block', blockId)}
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:9px;">${trb('Для блока: ','For this block: ')}${esc(ownLabels)}</div>
            ${blockMetricsHtml(override, blockId)}
          ` : `<div style="font-size:10px;color:var(--muted);margin-top:9px;">${trb('Наследует: ','Inherits: ')}${esc(inheritedLabels)}</div>`}
        </div>`;
      }).join('');
    }

    function renderPlanContent() {
      plan = analyticsApi.normalizePlan(plan, experimentBlocks);
      const capabilities = analyticsApi.experimentCapabilities(experimentBlocks);
      const content = canvasCol.querySelector('#analyticsPlanContent');
      const summary = canvasCol.querySelector('#analyticsSelectedSummary');
      if (summary) {
        summary.textContent = `${selectedPackageCount()} ${trb('пакета','packages')} · ${plan.selectedMetricIds.length} ${trb('показателей','metrics')} · ${Object.keys(plan.blockOverrides).length} ${trb('исключений по блокам','block overrides')}`;
      }
      if (!content) return;
      content.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <div style="font-size:14px;font-weight:750;color:var(--text);">${trb('Что вы хотите анализировать?','What do you want to analyze?')}</div>
            <div style="font-size:11px;color:var(--muted);line-height:1.5;margin-top:4px;">${trb('Выберите компактные пакеты. Подробный список показателей доступен ниже.','Choose compact packages. The detailed metric list is available below.')}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:10px;">
            ${packageCardsHtml(plan.defaultPackages, capabilities, 'global')}
          </div>

          <details id="analyticsMetricsDetails" ${metricsOpen ? 'open' : ''} style="border:1px solid var(--stroke);border-radius:14px;background:rgba(255,255,255,.38);overflow:hidden;">
            <summary style="cursor:pointer;list-style:none;padding:13px 15px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;font-weight:700;color:var(--text);">
              <span>${trb('Настроить отдельные показатели','Configure individual metrics')}</span>
              <span style="font-size:10px;color:var(--muted);font-weight:550;">${plan.selectedMetricIds.length} ${trb('выбрано','selected')} ▾</span>
            </summary>
            <div style="padding:0 12px 12px;display:flex;flex-direction:column;gap:9px;">${metricGroupsHtml()}</div>
          </details>

          <details id="analyticsOverridesDetails" ${overridesOpen ? 'open' : ''} style="border:1px solid var(--stroke);border-radius:14px;background:rgba(255,255,255,.38);overflow:hidden;">
            <summary style="cursor:pointer;list-style:none;padding:13px 15px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;font-weight:700;color:var(--text);">
              <span>${trb('Разные настройки для отдельных задач','Different settings for individual tasks')}</span>
              <span style="font-size:10px;color:var(--muted);font-weight:550;">${Object.keys(plan.blockOverrides).length} ${trb('исключений','overrides')} ▾</span>
            </summary>
            <div style="padding:0 12px 12px;display:flex;flex-direction:column;gap:9px;">${blockOverridesHtml()}</div>
          </details>

          <div style="font-size:11px;color:var(--muted);padding:12px 14px;border-radius:12px;background:rgba(92,102,189,.05);border:1px dashed rgba(92,102,189,.2);line-height:1.55;">
            <strong style="color:var(--text);">${trb('Важно:','Important:')}</strong>
            ${trb(' выбор здесь определяет состав отчёта по умолчанию, но не отключает сбор исходных обезличенных gaze/QC данных. Качество данных всегда остаётся включённым.',' this selection controls the default report, but does not disable collection of source anonymized gaze/QC data. Data quality always remains enabled.')}
          </div>
        </div>`;

      content.querySelector('#analyticsMetricsDetails')?.addEventListener('toggle', event => { metricsOpen = event.currentTarget.open; });
      content.querySelector('#analyticsOverridesDetails')?.addEventListener('toggle', event => { overridesOpen = event.currentTarget.open; });

      content.querySelectorAll('.an-package-cb').forEach(input => {
        input.addEventListener('change', () => {
          const packageId = input.dataset.packageId;
          if (input.checked) {
            if (!plan.defaultPackages.includes(packageId)) plan.defaultPackages.push(packageId);
            analyticsApi.metrics.filter(metric => metric.packageId === packageId && metric.defaultSelected).forEach(metric => {
              if (!plan.selectedMetricIds.includes(metric.id)) plan.selectedMetricIds.push(metric.id);
            });
          } else {
            plan.defaultPackages = plan.defaultPackages.filter(id => id !== packageId);
            plan.selectedMetricIds = plan.selectedMetricIds.filter(id => {
              const metric = analyticsApi.metrics.find(item => item.id === id);
              return !metric || metric.mandatory || metric.packageId !== packageId;
            });
          }
          persistPlan();
          renderPlanContent();
        });
      });

      content.querySelectorAll('.an-metric-cb').forEach(input => {
        input.addEventListener('change', () => {
          const metricId = input.dataset.metricId;
          if (input.checked) {
            if (!plan.selectedMetricIds.includes(metricId)) plan.selectedMetricIds.push(metricId);
          } else {
            plan.selectedMetricIds = plan.selectedMetricIds.filter(id => id !== metricId);
          }
          persistPlan();
          renderPlanContent();
        });
      });

      content.querySelectorAll('.an-block-override-cb').forEach(input => {
        input.addEventListener('change', () => {
          const blockId = input.dataset.blockId;
          const block = analyzableBlocks.find(item => String(item.id) === String(blockId));
          if (!block) return;
          if (input.checked) {
            const caps = analyticsApi.blockCapabilities(block);
            const packagesForBlock = plan.defaultPackages.filter(id => analyticsApi.isPackageAvailable(id, caps));
            if (!packagesForBlock.includes('data_quality')) packagesForBlock.push('data_quality');
            plan.blockOverrides[blockId] = {
              packages: packagesForBlock,
              selectedMetricIds: plan.selectedMetricIds.slice()
            };
          } else {
            delete plan.blockOverrides[blockId];
          }
          persistPlan();
          renderPlanContent();
        });
      });

      content.querySelectorAll('.an-block-package-cb').forEach(input => {
        input.addEventListener('change', () => {
          const blockId = input.dataset.blockId;
          const packageId = input.dataset.packageId;
          const override = plan.blockOverrides[blockId];
          if (!override) return;
          if (input.checked) {
            if (!override.packages.includes(packageId)) override.packages.push(packageId);
            analyticsApi.metrics.filter(metric => metric.packageId === packageId && metric.defaultSelected).forEach(metric => {
              if (!override.selectedMetricIds.includes(metric.id)) override.selectedMetricIds.push(metric.id);
            });
          } else {
            override.packages = override.packages.filter(id => id !== packageId);
            override.selectedMetricIds = override.selectedMetricIds.filter(id => {
              const metric = analyticsApi.metrics.find(item => item.id === id);
              return !metric || metric.mandatory || metric.packageId !== packageId;
            });
          }
          persistPlan();
          renderPlanContent();
        });
      });

      content.querySelectorAll('.an-block-metric-cb').forEach(input => {
        input.addEventListener('change', () => {
          const override = plan.blockOverrides[input.dataset.blockId];
          const metricId = input.dataset.metricId;
          if (!override) return;
          if (input.checked) {
            if (!override.selectedMetricIds.includes(metricId)) override.selectedMetricIds.push(metricId);
          } else {
            override.selectedMetricIds = override.selectedMetricIds.filter(id => id !== metricId);
          }
          persistPlan();
          renderPlanContent();
        });
      });
    }

    renderPlanContent();
    canvasCol.querySelector('#analyticsBackBtn').addEventListener('click', () => { persistPlan(); currentStep--; renderStepper(); renderCanvas(); });
    canvasCol.querySelector('#analyticsNextBtn').addEventListener('click', () => { persistPlan(); currentStep++; renderStepper(); renderCanvas(); });
  }

  //сохранение черновика
  function getBuilderAnalyticsPlan() {
    const analyticsApi = typeof window !== 'undefined' ? window.EmocogAnalyticsPlan : null;
    if (!analyticsApi) return null;
    return analyticsApi.load(experimentId || 'draft', experimentBlocks, [
      editingExp?.analyticsPlan,
      editingExp?.definition?.analyticsPlan,
      parsedExperimentData?.json?.analyticsPlan,
      editingExp?.analyticsConfig,
      editingExp?.definition?.analyticsConfig
    ]);
  }

  function saveDraft() {
    const metaFromForm = canvasCol.querySelector('#metaTitle') ? getProtocolMetaFromForm() : protocolMeta;
    protocolMeta = { ...protocolMeta, ...metaFromForm };
    const expTitle = protocolMeta.title || editingExp?.title || trb('Черновик эксперимента','Experiment draft');

    const experiments = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];
    const id = experimentId || 'exp_' + Date.now();
    if (hasLocalProtocolIdConflict(protocolMeta.protocolId, id)) {
      toast(trb('Этот ID протокола уже используется. Укажите уникальный ID.','This Protocol ID is already in use. Enter a unique ID.'));
      return;
    }
    const userBlocks = experimentBlocks.filter(b => !SYSTEM_BLOCK_TYPES.includes(b.type));
    const analyticsPlan = getBuilderAnalyticsPlan();
    const sessionFeatureFlags = JSON.parse(
      localStorage.getItem('emocog_session_features_' + (experimentId || 'draft')) || 'null'
    ) || editingExp?.sessionFeatureFlags || {
      audio: false,
      multimodal: true,
      bodyMovement: true,
      gamerMode: false
    };

    const entry = {
      id,
      projectId: parseInt(localStorage.getItem('emocog_selected_project_id') || '', 10) || editingExp?.projectId || null,
      title: expTitle,
      protocolId: protocolMeta.protocolId,
      metadata: protocolMeta,
      sessionFeatureFlags,
      analyticsPlan,
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

  let protocolSaveInProgress = false;

  async function runProtocolSave() {
    if (protocolSaveInProgress) return;
    protocolSaveInProgress = true;
    const button = canvasCol.querySelector('#finishSaveProtocolBtn');
    const originalText = button?.textContent || trb('Сохранить протокол', 'Save protocol');
    if (button) {
      button.disabled = true;
      button.textContent = trb('Сохранение…', 'Saving…');
    }
    try {
      await doSave();
    } catch (error) {
      console.error('[ResearcherBuilder] protocol save failed', error);
      toast(
        trb('Не удалось сохранить протокол: ', 'Failed to save protocol: ')
        + (error?.message || String(error))
      );
    } finally {
      protocolSaveInProgress = false;
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  function saveProtocol() {
    const errors = [];
    let hasBlockingErrors = false;
    validateProtocolMeta(protocolMeta).forEach(field => errors.push(trb('Заполните поле: ','Fill in field: ') + field));
    if (hasLocalProtocolIdConflict(protocolMeta.protocolId, experimentId)) {
      hasBlockingErrors = true;
      errors.push(trb('ID протокола уже используется в другом протоколе.','The Protocol ID is already used by another protocol.'));
    }
    const surveyValidation = surveyContract()?.validateProtocolSurveyBlocks?.({
      participantShell: getParticipantShellMeta(),
      blocks: experimentBlocks
    });
    if (surveyValidation && !surveyValidation.ok) {
      hasBlockingErrors = true;
      const surveyMessages = {
        survey_requires_prior_consent: trb('Для опроса необходимо включить согласие участника.', 'Participant consent must be enabled for surveys.'),
        survey_splits_instruction_and_task: trb('Опрос стоит между инструкцией и заданием.', 'A survey is placed between an instruction and its task.'),
        survey_question_required: trb('Добавьте хотя бы один вопрос в каждый опрос.', 'Add at least one question to every survey.'),
        survey_question_text_required: trb('Заполните текст каждого вопроса.', 'Enter text for every question.'),
        survey_options_minimum: trb('Для выбора добавьте минимум два варианта ответа.', 'Choice questions require at least two options.'),
        survey_option_text_required: trb('Заполните все варианты ответа.', 'Fill in every answer option.'),
        survey_question_id_duplicate: trb('Идентификаторы вопросов должны быть уникальными.', 'Question identifiers must be unique.'),
        survey_option_id_duplicate: trb('Идентификаторы вариантов должны быть уникальными.', 'Option identifiers must be unique.'),
        survey_options_too_many: trb('В вопросе превышен безопасный лимит вариантов ответа.', 'A question exceeds the safe answer-option limit.'),
        survey_field_invalid: trb('Одно из полей опроса превышает допустимую длину.', 'A survey field exceeds its allowed length.'),
        survey_question_text_invalid: trb('Текст вопроса превышает допустимую длину.', 'Question text exceeds its allowed length.'),
        survey_option_text_invalid: trb('Текст варианта ответа превышает допустимую длину.', 'Answer option text exceeds its allowed length.'),
        survey_question_type_invalid: trb('Выбран неподдерживаемый тип вопроса.', 'An unsupported question type is selected.'),
        survey_unknown_field: trb('Опрос содержит неподдерживаемое поле.', 'The survey contains an unsupported field.'),
        survey_question_unknown_field: trb('Вопрос содержит неподдерживаемое поле.', 'A question contains an unsupported field.'),
        survey_option_unknown_field: trb('Вариант ответа содержит неподдерживаемое поле.', 'An answer option contains an unsupported field.'),
        protocol_too_many_surveys: trb('В протоколе превышен безопасный лимит опросов.', 'The protocol exceeds the safe survey limit.'),
        survey_too_many_questions: trb('В опросе превышен безопасный лимит вопросов.', 'The survey exceeds the safe question limit.')
      };
      [...new Set(surveyValidation.errors.map(error => surveyMessages[error.code] || error.code))]
        .forEach(message => errors.push(message));
    }

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
          ${hasBlockingErrors ? '' : `<button id="valIgnore" class="quick-btn" style="font-size:12px;color:var(--muted);">${trb('Сохранить всё равно','Save anyway')}</button>`}
          <button id="valClose" class="quick-btn" style="font-size:12px;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:600;">${trb('Исправить','Fix')}</button>
        </div>
      `;
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      setTimeout(() => applyAutoI18n(modal), 0);
      modal.querySelector('#valClose').addEventListener('click', () => document.body.removeChild(overlay));
      modal.querySelector('#valIgnore')?.addEventListener('click', () => {
        document.body.removeChild(overlay);
        runProtocolSave();
      });
      return;
    }
    runProtocolSave();
  }

  async function doSave() {
    const srcData = parsedExperimentData?.json || {};
    const builderKey = experimentId || 'draft';

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

    const analyticsCfg = typeof getExperimentAnalyticsConfig === 'function'
      ? getExperimentAnalyticsConfig(builderKey)
      : null;
    const analyticsPlan = getBuilderAnalyticsPlan();
    const sourceFeatureFlags = srcData.settings?.featureFlags || {};
    const sessionFeatureFlags = JSON.parse(
      localStorage.getItem('emocog_session_features_' + builderKey) || 'null'
    ) || {
      audio: sourceFeatureFlags.audio === true,
      multimodal: sourceFeatureFlags.multimodal !== false,
      bodyMovement: sourceFeatureFlags.bodyMovement !== false,
      gamerMode: sourceFeatureFlags.gamerMode === true
    };
    if (userBlocks.some(block => block.type === 'audio_test')) sessionFeatureFlags.audio = true;
    if (!sessionFeatureFlags.multimodal) sessionFeatureFlags.gamerMode = false;

    const json = {
      title: expTitle,
      protocolId: protocolMeta.protocolId,
      estimatedDuration: protocolMeta.estimatedDuration,
      description: protocolMeta.description,
      participantShell: shell,
      testHubMetrics: [],
      analyticsConfig: analyticsCfg,
      analyticsPlan,
      version: 'v2.0_universal',
      settings: {
        ...(srcData.settings || { backgroundColor:'#1a1a2e', textColor:'#ffffff' }),
        featureFlags: sessionFeatureFlags
      },
      blocks: [
        ...systemBlocks,
        ...userBlocks.map(b => {
        const out = { id: b.id, type: b.type, label: localizedBlockLabel(b, b.label || b.type) };
        if (b.type === 'instruction') {
          const titleRu = instructionValueForLocale(b.content, 'title', 'ru', b.label || 'Инструкция');
          const textRu = instructionValueForLocale(b.content, 'text', 'ru', '');
          const buttonTextRu = instructionValueForLocale(b.content, 'buttonText', 'ru', 'Далее');
          const titleEn = instructionValueForLocale(b.content, 'title', 'en', titleRu);
          const textEn = instructionValueForLocale(b.content, 'text', 'en', textRu);
          const buttonTextEn = instructionValueForLocale(b.content, 'buttonText', 'en', 'Continue');
          out.content = {
            title: localizedInstructionValue(b.content, 'title', b.label),
            text: localizedInstructionValue(b.content, 'text', ''),
            buttonText: localizedInstructionValue(b.content, 'buttonText', 'Далее'),
            titleRu,
            textRu,
            buttonTextRu,
            titleEn,
            textEn,
            buttonTextEn
          };
        } else if (b.type === 'cognitive_task') {
          const taskType = b.content?.taskType || b.content?.rt_task || 'simple_rt';
          out.taskType = taskType;
          out.rt_task = b.content?.rt_task || taskType;
          const rtMetrics = autoRtMetricsForTaskType(taskType, b.content);
          const rtResolved = resolveRtBounds(b.content || {});
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
            rtMin: b.content?.rtMin != null && b.content.rtMin !== '' ? b.content.rtMin : rtResolved.rtMin,
            rtWindow: b.content?.rtWindow != null && b.content.rtWindow !== '' ? b.content.rtWindow : rtResolved.rtWindow,
            responseMode: ['keypress', 'click', 'pointer_intent', 'none'].includes(b.content?.responseMode)
              ? b.content.responseMode
              : null,
            responseType: b.content?.responseType || (b.content?.responseMode === 'click' ? 'click' : 'keys'),
            omissionRule: b.content?.omissionRule || 'skip',
            commissionRule: b.content?.commissionRule || 'flag',
            targetAOI: b.content?.targetAOI || '',
            stimuliSource: b.content?.stimuliSource || 'library',
            stimuliFolder: b.content?.stimuliFolder || '',
            randomize: !!b.content?.randomize,
            randomInterStimulus: !!b.content?.randomInterStimulus,
            interStimulusMinMs: Number(b.content?.interStimulusMinMs) || 0,
            interStimulusMaxMs: Number(b.content?.interStimulusMaxMs) || 0,
            fullscreenStimulus: !!b.content?.fullscreenStimulus,
            useFixation: !!b.content?.useFixation,
            useAOI: !!b.content?.useAOI,
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
          attachBlockAois(out.blockConfig, b.content, out.trials);
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
          attachBlockAois(out.blockConfig, b.content, b.content?.slides || []);
        } else if (b.type === 'rest') {
          out.content = {
            text: b.content?.text || trb('Сделайте небольшой перерыв','Take a short break'),
            durationMs: timedBlockDurationMs(b.content, 30)
          };
        } else if (b.type === 'audio_test') {
          out.content = {
            ...(b.content || {}),
            durationMs: timedBlockDurationMs(b.content, 12)
          };
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

    const experiments = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];
    const id = experimentId || 'exp_' + Date.now();
    if (hasLocalProtocolIdConflict(protocolMeta.protocolId, id)) {
      throw new Error(trb('ID протокола уже используется. Укажите уникальный ID.','Protocol ID is already in use. Enter a unique ID.'));
    }

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
      projectId: parseInt(localStorage.getItem('emocog_selected_project_id') || '', 10) || editingExp?.projectId || null,
      title: json.title,
      protocolId: protocolMeta.protocolId,
      metadata: protocolMeta,
      sessionFeatureFlags,
      analyticsPlan,
      blocks: userBlocks,
      version: protocolVersion,
      history: history,
      savedStep: 8,
      createdAt: editingExp?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'draft'
    };

    const idx = experiments.findIndex(e => e.id === id);
    if (idx >= 0) experiments[idx] = entry; else experiments.push(entry);
    localStorage.setItem('emocog_my_experiments', JSON.stringify(experiments));
    localStorage.setItem('emocog_active_experiment_id', id);

    let toastMain = trb(
      'Сохранено локально в этом браузере. Участники по ссылке не увидят протокол, пока он не опубликован в API.',
      'Saved locally in this browser only. Participants will not see this protocol until it is published to the API.'
    );
    if (typeof publishBuilderProtocolAndInvitation === 'function' && typeof hasResearcherApiToken === 'function' && hasResearcherApiToken()) {
      try {
        const pub = await publishBuilderProtocolAndInvitation(json, builderKey, protocolMeta.protocolId);
        const publishedExperiments = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];
        const publishedIndex = publishedExperiments.findIndex(item => item.id === id);
        if (publishedIndex >= 0) {
          publishedExperiments[publishedIndex] = {
            ...publishedExperiments[publishedIndex],
            invitationCode: pub.invitation.code,
            participantLink: pub.link,
            apiProtocolId: pub.protocol.id,
            publishVerifiedAt: new Date().toISOString(),
            status: 'active',
            updatedAt: new Date().toISOString()
          };
          localStorage.setItem('emocog_my_experiments', JSON.stringify(publishedExperiments));
        }
        if (typeof saveBuilderApiState === 'function') {
          saveBuilderApiState(id, {
            apiProtocolId: pub.protocol.id,
            projectId: pub.protocol.project_id,
            invitationCode: pub.invitation.code,
            publishVerifiedAt: new Date().toISOString()
          });
        }
        toastMain = trb(
          'Протокол опубликован в API. Код приглашения: ',
          'Protocol published to the API. Invitation code: '
        ) + pub.invitation.code + trb('. Ссылка обновлена.', ' Link updated.');
        const linkInput = document.getElementById('participantLinkInput');
        if (linkInput) linkInput.value = pub.link;
        const copyLinkButton = document.getElementById('copyParticipantLinkBtn');
        if (copyLinkButton) copyLinkButton.disabled = false;
        clearExperimentBuilderDraft();
      } catch (e) {
        var apiErr = e?.message || String(e);
        if (typeof saveBuilderApiState === 'function') {
          saveBuilderApiState(builderKey, { invitationCode: null, publishVerifiedAt: null });
          if (builderKey !== id) saveBuilderApiState(id, { invitationCode: null, publishVerifiedAt: null });
        }
        const failedExperiments = JSON.parse(localStorage.getItem('emocog_my_experiments')) || [];
        const failedIndex = failedExperiments.findIndex(item => item.id === id);
        if (failedIndex >= 0) {
          delete failedExperiments[failedIndex].invitationCode;
          delete failedExperiments[failedIndex].participantLink;
          delete failedExperiments[failedIndex].publishVerifiedAt;
          failedExperiments[failedIndex].status = 'draft';
          failedExperiments[failedIndex].publishError = apiErr;
          localStorage.setItem('emocog_my_experiments', JSON.stringify(failedExperiments));
        }
        const linkInput = document.getElementById('participantLinkInput');
        if (linkInput) linkInput.value = '';
        const copyLinkButton = document.getElementById('copyParticipantLinkBtn');
        if (copyLinkButton) copyLinkButton.disabled = true;
        if (String(apiErr).indexOf('403') >= 0 && String(apiErr).toLowerCase().indexOf('forbidden') >= 0) {
          toastMain = trb(
            'Протокол не опубликован: API отклонил доступ (403). Черновик сохранён, исправьте доступ и повторите публикацию. ',
            'Protocol was not published: API denied access (403). The draft is saved; fix access and publish again. '
          ) + apiErr;
        } else {
          toastMain = trb(
            'Протокол не опубликован. Черновик сохранён, несуществующая ссылка удалена. Ошибка API: ',
            'Protocol was not published. The draft is saved and the invalid link was removed. API error: '
          ) + apiErr;
        }
        toast(toastMain);
        return;
      }
    } else {
      toastMain = trb(
        'Протокол сохранён как черновик, но не опубликован. Войдите как исследователь и повторите публикацию.',
        'The protocol was saved as a draft but not published. Sign in as a researcher and publish again.'
      );
      if (typeof saveBuilderApiState === 'function') {
        saveBuilderApiState(builderKey, { invitationCode: null, publishVerifiedAt: null });
        if (builderKey !== id) saveBuilderApiState(id, { invitationCode: null, publishVerifiedAt: null });
      }
      toast(toastMain);
      return;
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
