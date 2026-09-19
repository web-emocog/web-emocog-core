/* Cognitive task protocol presets for the experiment builder.
   Loaded by researcher.html before the main inline application script. */

function cloneProtocolData(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function requiredProtocolBlocks() {
    return [
      { type:'consent', label:'Информированное согласие', content:{ required:true, system:true } },
      { type:'questionnaire', label:'Анкета', content:{ required:true, system:true, questions:[
        { id:'age', label:'Возраст', type:'number', required:true },
        { id:'vision', label:'Зрение нормальное или скорректировано?', type:'select', options:['Да','Нет'], required:true },
        { id:'sleep', label:'Сколько часов вы спали прошлой ночью?', type:'number' },
        { id:'caffeine', label:'Кофеин за последние 3 часа?', type:'select', options:['Да','Нет'] }
      ] } },
      { type:'precheck', label:'Проверка камеры', content:{ required:true, system:true, checks:['camera','face','lighting','fps'], minFaceDetectedPct:80 } },
      { type:'calibration', label:'Калибровка', content:{ required:true, system:true, points:9, minValidGazePct:70 } }
    ];
  }

  function standardStimulus(id, nameRu, nameEn, type, infoRu, infoEn, extra = {}) {
    return { id, name:nameRu, nameRu, nameEn, type, info:infoRu, infoRu, infoEn, ...extra };
  }

  function localizedStimulusName(stimulus) {
    if (!stimulus) return '';
    const isEn = typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'en';
    return isEn ? (stimulus.nameEn || stimulus.name) : (stimulus.nameRu || stimulus.name);
  }

  function localizedStimulusInfo(stimulus) {
    if (!stimulus) return '';
    const isEn = typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'en';
    return isEn ? (stimulus.infoEn || stimulus.info) : (stimulus.infoRu || stimulus.info);
  }

  function emotionFaceAois() {
    const interval = { startMs: 0, endMs: 4000 };
    return [
      { id:'face', name:'Лицо', shape:'ellipse', points:[{x:0.26,y:0.08},{x:0.74,y:0.94}], order:1, isTarget:true, validityInterval:{...interval} },
      { id:'eyes', name:'Глаза', shape:'ellipse', points:[{x:0.32,y:0.34},{x:0.68,y:0.56}], order:2, isTarget:false, validityInterval:{...interval} },
      { id:'mouth', name:'Рот', shape:'ellipse', points:[{x:0.36,y:0.60},{x:0.64,y:0.83}], order:3, isTarget:false, validityInterval:{...interval} }
    ];
  }

  function standardProtocolStimuli() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(ch => standardStimulus(
      'std_cpt_' + ch.toLowerCase(),
      'AX-CPT: буква ' + ch,
      'AX-CPT: letter ' + ch,
      'text',
      'Буква',
      'Letter',
      { text:ch }
    ));
    const switches = ['4G','7A','2E','9K','6O','3M','8I','5T'].map(v => standardStimulus(
      'std_switch_' + v.toLowerCase(),
      'Task Switching: ' + v,
      'Task Switching: ' + v,
      'text',
      'Пара «число — буква»',
      'Number-letter pair',
      { text:v }
    ));
    const emotionRu = { neutral:'нейтральное', happy:'радость', anger:'гнев', sad:'грусть', fear:'страх', surprise:'удивление', disgust:'отвращение' };
    const emotions = ['neutral','happy','anger','sad','fear','surprise','disgust'].flatMap(em =>
      Array.from({ length: em === 'disgust' ? 4 : 6 }, (_, i) => standardStimulus(
        `std_emo_${em}_${String(i+1).padStart(2,'0')}`,
        `Просмотр эмоций: ${emotionRu[em]} ${i+1}`,
        `Emotion viewing: ${em} ${i+1}`,
        'image',
        'Плейсхолдер эмоционального лица',
        'Emotional face placeholder',
        { emotion:em, aoiSchemaVersion:'1.2', aois:emotionFaceAois() }
      ))
    );
    return [
      standardStimulus('std_simple_black_square', 'Simple RT: чёрный квадрат', 'Simple RT: black square', 'image', 'Чёрный квадрат на белом фоне', 'Black square on a white background'),
      standardStimulus('std_go_green_circle', 'Go: зелёный круг', 'Go: green circle', 'image', 'Go-стимул', 'Go stimulus'),
      standardStimulus('std_nogo_red_circle', 'No-Go: красный круг', 'No-Go: red circle', 'image', 'No-Go-стимул', 'No-Go stimulus'),
      ...[
        ['red_red','КРАСНЫЙ красным','RED in red','Конгруэнтный','Congruent'],
        ['blue_blue','СИНИЙ синим','BLUE in blue','Конгруэнтный','Congruent'],
        ['green_green','ЗЕЛЁНЫЙ зелёным','GREEN in green','Конгруэнтный','Congruent'],
        ['red_blue','КРАСНЫЙ синим','RED in blue','Неконгруэнтный','Incongruent'],
        ['blue_green','СИНИЙ зелёным','BLUE in green','Неконгруэнтный','Incongruent'],
        ['green_red','ЗЕЛЁНЫЙ красным','GREEN in red','Неконгруэнтный','Incongruent']
      ].map(x => standardStimulus('std_stroop_' + x[0], 'Stroop: ' + x[1], 'Stroop: ' + x[2], 'text', x[3], x[4])),
      standardStimulus('std_flanker_right_cong', 'Flanker: >>>>>', 'Flanker: >>>>>', 'text', 'Конгруэнтный, вправо', 'Congruent, right'),
      standardStimulus('std_flanker_left_cong', 'Flanker: <<<<<', 'Flanker: <<<<<', 'text', 'Конгруэнтный, влево', 'Congruent, left'),
      standardStimulus('std_flanker_right_incong', 'Flanker: <<><<', 'Flanker: <<><<', 'text', 'Неконгруэнтный, вправо', 'Incongruent, right'),
      standardStimulus('std_flanker_left_incong', 'Flanker: >><>>', 'Flanker: >><>>', 'text', 'Неконгруэнтный, влево', 'Incongruent, left'),
      standardStimulus('std_nback_circle', 'N-back: круг', 'N-back: circle', 'image', 'Геометрическая фигура', 'Geometric shape'),
      standardStimulus('std_nback_square', 'N-back: квадрат', 'N-back: square', 'image', 'Геометрическая фигура', 'Geometric shape'),
      standardStimulus('std_nback_triangle', 'N-back: треугольник', 'N-back: triangle', 'image', 'Геометрическая фигура', 'Geometric shape'),
      standardStimulus('std_nback_diamond', 'N-back: ромб', 'N-back: diamond', 'image', 'Геометрическая фигура', 'Geometric shape'),
      standardStimulus('std_pvt_counter', 'PVT: счётчик миллисекунд', 'PVT: millisecond counter', 'text', 'Красный счётчик RT', 'Red RT counter'),
      ...letters,
      ...switches,
      ...emotions
    ];
  }

  const STANDARD_FOLDER_ID = 'folder_standard';
  const STANDARD_FOLDER_NAME = 'Стандартные';

  function ensureStandardFolder() {
    let folder = folders.find(f => f.id === STANDARD_FOLDER_ID || f.name === STANDARD_FOLDER_NAME);
    if (!folder) {
      folder = { id: STANDARD_FOLDER_ID, name: STANDARD_FOLDER_NAME, stimuliIds: [], system: true };
      folders.push(folder);
    }
    return folder;
  }

  function getStandardFolderId() {
    ensureStandardFolder();
    localStorage.setItem('emocog_folders', JSON.stringify(folders));
    const folder = folders.find(f => f.id === STANDARD_FOLDER_ID || f.name === STANDARD_FOLDER_NAME);
    return folder ? folder.id : STANDARD_FOLDER_ID;
  }

  function ensureStandardStimuli() {
    const folder = ensureStandardFolder();
    const known = new Set(stimuliList.map(s => String(s.id)));
    let stimuliChanged = false;
    let folderChanged = false;
    standardProtocolStimuli().forEach(stim => {
      const existing = stimuliList.find(s => String(s.id) === String(stim.id));
      if (existing) {
        ['name', 'nameRu', 'nameEn', 'type', 'info', 'infoRu', 'infoEn', 'emotion', 'text', 'aoiSchemaVersion', 'aois'].forEach(function (key) {
          if (stim[key] != null && existing[key] !== stim[key]) {
            existing[key] = stim[key];
            stimuliChanged = true;
          }
        });
      } else if (!known.has(stim.id)) {
        stimuliList.push({ ...stim, standard: true, createdAt: new Date().toISOString() });
        known.add(stim.id);
        stimuliChanged = true;
      }
      if (!folder.stimuliIds.includes(stim.id)) {
        folder.stimuliIds.push(stim.id);
        folderChanged = true;
      }
    });
    if (stimuliChanged) localStorage.setItem('emocog_stimuli', JSON.stringify(stimuliList));
    if (folderChanged || stimuliChanged) localStorage.setItem('emocog_folders', JSON.stringify(folders));
  }

  function trial(stimulusId, condition, action, duration, repetitions = 1, extra = {}) {
    return { stimulusId, condition, action:action || '', correctResponse:action || '', duration, repetitions, ...extra };
  }

  const TEMPLATE_INSTRUCTION_TRANSLATIONS = {
    'Инструкция: Simple RT - тренировка': {
      title: 'Instruction: Simple RT - practice',
      text: `Welcome! In this task, we will measure your reaction speed.
The stimulus will appear in the center of the screen. Your task is to press the Space key as quickly as possible as soon as it appears.
A short practice will start now so you can get used to the task. After each response, you will see how quickly you answered.`
    },
    'Инструкция: Simple RT - основной этап': {
      title: 'Instruction: Simple RT - main phase',
      text: `Practice is complete. The main part will now begin.
The rules stay the same: press Space as quickly as possible when the stimulus appears. Reaction-time hints will no longer be shown.
Try to stay focused throughout the task. Respond as quickly as possible while avoiding mistakes.`
    },
    'Инструкция: Go / No-Go - тренировка': {
      title: 'Instruction: Go / No-Go - practice',
      text: `In this task, two types of signals will appear on the screen one after another.
If you see a green circle, press Space as quickly as possible.
If you see a red circle, do not press anything and simply wait for the next signal.
Let's practice briefly. If you make a mistake, the system will show a warning.`
    },
    'Инструкция: Go / No-Go - основной этап': {
      title: 'Instruction: Go / No-Go - main phase',
      text: `Great! We are moving on to the main task.
Press Space when the green circle appears and do nothing when the red circle appears. The signals will appear quickly.
Try to respond as fast as possible without sacrificing accuracy. Feedback will no longer be shown.`
    },
    'Инструкция: Stroop - тренировка': {
      title: 'Instruction: Stroop - practice',
      text: `In this task, color words will appear on the screen, for example the word "RED", but they may be written in a different ink color, for example in blue.
Your task is to identify the INK COLOR while ignoring the written word itself.
If the ink is red, press Arrow Left. If the ink is blue, press Arrow Down. If the ink is green, press Arrow Right.
Complete the practice to memorize the keys. Respond as quickly as possible while avoiding mistakes.`
    },
    'Инструкция: Stroop - основной этап': {
      title: 'Instruction: Stroop - main phase',
      text: `We are moving on to the main part.
Remember the main rule: respond only to the ink color, not to the meaning of the word.
Press the correct key as quickly and accurately as possible: Arrow Left for red, Arrow Down for blue, Arrow Right for green. Feedback will no longer be shown.`
    },
    'Инструкция: Flanker - тренировка': {
      title: 'Instruction: Flanker - practice',
      text: `A row of five arrows will appear on the screen, for example >><>> or <<<<<.
Your task is to look only at the center arrow and indicate which direction it points. Ignore the surrounding arrows.
If the center arrow points left <, press Arrow Left.
If the center arrow points right >, press Arrow Right.
Let's practice.`
    },
    'Инструкция: Flanker - основной этап': {
      title: 'Instruction: Flanker - main phase',
      text: `Practice is complete.
Continue focusing only on the center arrow and press the corresponding keyboard key: Left or Right.
Try not to be distracted by the side arrows. Respond as quickly as possible while avoiding mistakes.`
    },
    'Инструкция: 2-back - тренировка': {
      title: 'Instruction: 2-back - practice',
      text: `In this task, geometric shapes will appear on the screen one at a time.
Your goal is to press Space if the current shape matches the one shown exactly two shapes earlier.
Example: circle -> square -> circle. On the third shape, you should press Space because it matches the shape from two steps back.
If the shape does not match the one from 2 steps back, do not press anything. Complete the training block to learn the rules.`
    },
    'Инструкция: 2-back - основной этап': {
      title: 'Instruction: 2-back - main phase',
      text: `You have learned the rules. The main block will now begin.
Watch the sequence carefully. Press Space only when the current shape matches the shape from two steps back.
This task requires strong concentration. Respond as quickly as possible while avoiding mistakes.`
    },
    'Инструкция: PVT - тренировка': {
      title: 'Instruction: PVT - practice',
      text: `In this test, we will measure your ability to sustain attention.
A red millisecond counter will appear on the screen. Your task is to stop it as quickly as possible by pressing Space.
After stopping the counter, you will see your reaction time. The intervals between counter appearances will be unpredictable, from a few seconds to ten seconds.
Try stopping it a few times.`
    },
    'Инструкция: PVT - основной этап': {
      title: 'Instruction: PVT - main phase',
      text: `A longer phase will now begin. It will take several minutes of continuous work.
Look at the center of the screen and press Space the moment the red counter appears.
Try not to look away from the screen until the test is over.`
    },
    'Инструкция: AX-CPT - тренировка': {
      title: 'Instruction: AX-CPT - practice',
      text: `Letters will appear quickly on the screen.
You should press Space only in one specific case: when you see the letter X and it was immediately preceded by the letter A.
In all other cases, for example if X was preceded by another letter or if A is followed by a letter other than X, do not press anything.
Practice recognizing this letter pair.`
    },
    'Инструкция: AX-CPT - основной этап': {
      title: 'Instruction: AX-CPT - main phase',
      text: `The main task is starting. It will last for a fairly long time.
Watch the screen carefully. Press Space ONLY for the letter X when it was preceded by the letter A.
Stay focused and respond quickly.`
    },
    'Инструкция: Task Switching - тренировка': {
      title: 'Instruction: Task Switching - practice',
      text: `In this task, combinations of a number and a letter will appear on the screen, for example 4G or 7A. Pay attention to the background color because it tells you which rule to use.
If the background is BLUE: look only at the number. Press Arrow Left if it is even and Arrow Right if it is odd.
If the background is YELLOW: look only at the letter. Press Arrow Left if it is a vowel and Arrow Right if it is a consonant.
First you will practice each rule separately, and then the rules will alternate randomly.`
    },
    'Инструкция: Task Switching - основной этап': {
      title: 'Instruction: Task Switching - main phase',
      text: `The rules are set.
Reminder: Blue background = number, even or odd. Yellow background = letter, vowel or consonant.
Pay attention to the screen color before each response. Respond quickly but accurately.`
    },
    'Инструкция: Просмотр эмоций - тренировка': {
      title: 'Instruction: Emotion Viewing - practice',
      text: `This task is different from the previous ones. You will not need to press any keys.
Faces showing different emotions will appear on the screen one after another. Your task is simply to look carefully at these images.
Because this task uses the camera for analysis, please make sure you are sitting upright, your face is well lit, and your whole face is visible in the frame.
Do not close your eyes and try not to make sudden head movements. We will now show a couple of test images.`
    },
    'Инструкция: Просмотр эмоций - основной этап': {
      title: 'Instruction: Emotion Viewing - main phase',
      text: `We are moving on to viewing.
Simply look at the screen at a natural pace until the images stop changing.
Maintain a comfortable position in front of the camera.`
    }
  };

  // Participant runtime uses this table to localize legacy protocols that were
  // published before bilingual instruction fields were persisted.
  globalThis.WecogTemplateInstructionTranslations = TEMPLATE_INSTRUCTION_TRANSLATIONS;

  function instructionProtocolBlock(titleRu, textRu, titleEn, textEn) {
    const translated = TEMPLATE_INSTRUCTION_TRANSLATIONS[titleRu] || {};
    titleEn = titleEn || translated.title;
    textEn = textEn || translated.text;
    const isEn = typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'en';
    const title = isEn && titleEn ? titleEn : titleRu;
    const text = isEn && textEn ? textEn : textRu;
    return {
      type:'instruction',
      label:title,
      labelRu:titleRu,
      labelEn:titleEn || titleRu,
      content:{
        title,
        text,
        titleRu,
        textRu,
        titleEn:titleEn || titleRu,
        textEn:textEn || textRu,
        buttonText:isEn ? 'Start' : 'Начать',
        buttonTextRu:'Начать',
        buttonTextEn:'Start'
      }
    };
  }

  const TEMPLATE_BLOCK_LABEL_TRANSLATIONS = {
    'Финальный экран': 'Final screen',
    'Simple RT - тренировка': 'Simple RT - practice',
    'Simple RT - основной блок': 'Simple RT - main block',
    'Go / No-Go - тренировка': 'Go / No-Go - practice',
    'Go / No-Go - основной блок': 'Go / No-Go - main block',
    'Stroop - тренировка': 'Stroop - practice',
    'Stroop - основной блок': 'Stroop - main block',
    'Flanker - тренировка': 'Flanker - practice',
    'Flanker - основной блок': 'Flanker - main block',
    '2-back - тренировка': '2-back - practice',
    '2-back - основной блок 1': '2-back - main block 1',
    '2-back - основной блок 2': '2-back - main block 2',
    '2-back - основной блок 3': '2-back - main block 3',
    'PVT - тренировка': 'PVT - practice',
    'PVT - 5 минут': 'PVT - 5 minutes',
    'AX-CPT - тренировка': 'AX-CPT - practice',
    'AX-CPT - основной блок': 'AX-CPT - main block',
    'Task Switching - правило числа': 'Task Switching - number rule',
    'Task Switching - правило буквы': 'Task Switching - letter rule',
    'Task Switching - смешанная тренировка': 'Task Switching - mixed practice',
    'Task Switching - основной смешанный блок': 'Task Switching - main mixed block',
    'Emotion Viewing - тренировка': 'Emotion Viewing - practice',
    'Emotion Viewing - свободный просмотр': 'Emotion Viewing - free viewing'
  };

  function localizedTemplateBlockLabel(labelRu) {
    const labelEn = TEMPLATE_BLOCK_LABEL_TRANSLATIONS[labelRu] || labelRu;
    return typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'en' ? labelEn : labelRu;
  }

  function cognitiveProtocolBlock(label, taskType, content) {
    return {
      type:'cognitive_task',
      label:localizedTemplateBlockLabel(label),
      labelRu:label,
      labelEn:TEMPLATE_BLOCK_LABEL_TRANSLATIONS[label] || label,
      content:{ taskType, stimuliSource:'library', responseType:'keys', useRT:true, ...content }
    };
  }

  function completeProtocol(taskBlocks) {
    return [
      ...requiredProtocolBlocks(),
      ...taskBlocks,
      {
        type:'finish',
        label:localizedTemplateBlockLabel('Финальный экран'),
        labelRu:'Финальный экран',
        labelEn:'Final screen',
        content:{
          title:typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'en' ? 'Experiment completed' : 'Эксперимент завершен',
          text:typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'en' ? 'Thank you for participating!' : 'Спасибо за участие!',
          titleRu:'Эксперимент завершен',
          titleEn:'Experiment completed',
          textRu:'Спасибо за участие!',
          textEn:'Thank you for participating!'
        }
      }
    ];
  }

  function repeatTrials(items, repetitions) {
    return items.map(item => trial(item[0], item[1], item[2], item[3], repetitions, item[4] || {}));
  }

  function goNoGoTrials() {
    const noGoAt = new Set([4,9,14,19,24,29,34,39,44,49]);
    return Array.from({ length:50 }, (_, i) => noGoAt.has(i)
      ? trial('std_nogo_red_circle','No-Go','',500,1,{ responseWindow:1000, iti:1000 })
      : trial('std_go_green_circle','Go','space',500,1,{ responseWindow:1000, iti:1000 }));
  }

  function nBackTrials(blockName, targets) {
    const pool = ['std_nback_circle','std_nback_square','std_nback_triangle','std_nback_diamond'];
    const targetSet = new Set(targets);
    const rows = [];
    for (let i = 0; i < 22; i++) {
      let stimulusId = pool[i % pool.length];
      if (i >= 2 && targetSet.has(i)) stimulusId = rows[i - 2].stimulusId;
      rows.push(trial(stimulusId, targetSet.has(i) ? 'target 2-back' : 'non-target', targetSet.has(i) ? 'space' : '', 500, 1, { block:blockName, iti:2000 }));
    }
    return rows;
  }

  function cptTrials(repetitions = 24) {
    const sequence = ['A','X','B','X','A','K','C','D','A','X','M','X','A','X','Q','A','T','X','A','X'];
    return sequence.map((ch, i) => {
      const isTarget = ch === 'X' && sequence[i - 1] === 'A';
      return trial('std_cpt_' + ch.toLowerCase(), isTarget ? 'AX target' : 'non-target', isTarget ? 'space' : '', 250, repetitions, { isi:1000 });
    });
  }

  function taskSwitchTrials(rule, repetitions) {
    const rows = [];
    if (rule !== 'letter') rows.push(
      ['std_switch_4g','number/even','arrow_left',2000,{ cue:'blue', cueDuration:200, iti:1000 }],
      ['std_switch_7a','number/odd','arrow_right',2000,{ cue:'blue', cueDuration:200, iti:1000 }]
    );
    if (rule !== 'number') rows.push(
      ['std_switch_2e','letter/vowel','arrow_left',2000,{ cue:'yellow', cueDuration:200, iti:1000 }],
      ['std_switch_9k','letter/consonant','arrow_right',2000,{ cue:'yellow', cueDuration:200, iti:1000 }]
    );
    return repeatTrials(rows, repetitions);
  }

  function buildEmotionViewingTrialSets() {
    const passiveExtra = { passive: true, analytics: ['mediapipe_face', 'gaze_aoi_eyes_mouth'] };
    const makeTrial = (s) => trial(s.id, s.emotion, '', 4000, 1, passiveExtra);
    const byEmotion = {};
    standardProtocolStimuli().filter(function (s) { return s.id.startsWith('std_emo_'); }).forEach(function (s) {
      const em = s.emotion || 'neutral';
      if (!byEmotion[em]) byEmotion[em] = [];
      byEmotion[em].push(s);
    });
    const order = ['neutral', 'happy', 'anger', 'sad', 'fear', 'surprise', 'disgust'];
    const training = ['neutral', 'happy', 'sad']
      .map(function (em) { return byEmotion[em] && byEmotion[em][0]; })
      .filter(Boolean)
      .map(makeTrial);
    const main = order.flatMap(function (em) {
      return (byEmotion[em] || []).slice(0, 4).map(makeTrial);
    });
    return { training: training, main: main };
  }

  function readyProtocolForTemplate(template) {
    const stroop = [
      ['std_stroop_red_red','congruent/red','arrow_left',2000], ['std_stroop_blue_blue','congruent/blue','arrow_down',2000], ['std_stroop_green_green','congruent/green','arrow_right',2000],
      ['std_stroop_red_blue','incongruent/blue ink','arrow_down',2000], ['std_stroop_blue_green','incongruent/green ink','arrow_right',2000], ['std_stroop_green_red','incongruent/red ink','arrow_left',2000]
    ];
    const flanker = [
      ['std_flanker_right_cong','congruent/right','arrow_right',1500], ['std_flanker_left_cong','congruent/left','arrow_left',1500],
      ['std_flanker_right_incong','incongruent/right','arrow_right',1500], ['std_flanker_left_incong','incongruent/left','arrow_left',1500]
    ];
    const emotions = buildEmotionViewingTrialSets();

    const protocols = {
      simple_rt: completeProtocol([
        instructionProtocolBlock('Инструкция: Simple RT - тренировка', `Добро пожаловать! В этой задаче мы проверим скорость вашей реакции.
В центре экрана будет появляться стимул. Ваша задача - нажать клавишу Пробел как можно быстрее сразу после его появления.
Сейчас начнется небольшая тренировка, чтобы вы привыкли к задаче. После каждого нажатия вы будете видеть, насколько быстро вы ответили.`),
        cognitiveProtocolBlock('Simple RT - тренировка', 'simple_rt', { trials:[trial('std_simple_black_square','target','space',2000,10,{ fixationMin:500, fixationMax:1500, iti:500 })], randomize:false, useFixation:true, fixationDuration:500, rtWindow:2000, showFeedback:true }),
        instructionProtocolBlock('Инструкция: Simple RT - основной этап', `Тренировка окончена. Теперь начнется основная часть.
Правила остаются теми же: нажимайте Пробел максимально быстро при появлении стимула. Подсказок о времени реакции больше не будет.
Постарайтесь сохранять концентрацию на протяжении всей задачи. Отвечайте максимально быстро, но старайтесь не допускать ошибок.`),
        cognitiveProtocolBlock('Simple RT - основной блок', 'simple_rt', { trials:[trial('std_simple_black_square','target','space',2000,30,{ fixationMin:500, fixationMax:1500, iti:500 })], randomize:false, useFixation:true, fixationDuration:500, rtWindow:2000, showFeedback:false })
      ]),
      go_nogo: completeProtocol([
        instructionProtocolBlock('Инструкция: Go / No-Go - тренировка', `В этой задаче на экране будут по очереди появляться сигналы двух типов.
Если вы видите зеленый круг - нажмите Пробел как можно быстрее.
Если вы видите красный круг - ничего не нажимайте и просто ждите следующий сигнал.
Давайте немного потренируемся. Если вы ошибетесь, система выдаст предупреждение.`),
        cognitiveProtocolBlock('Go / No-Go - тренировка', 'go_nogo', { trials:[trial('std_go_green_circle','Go','space',500,8,{ responseWindow:1000, iti:1000 }), trial('std_nogo_red_circle','No-Go','',500,2,{ responseWindow:1000, iti:1000 })], randomize:true, useFixation:true, fixationDuration:500, rtWindow:1000, showFeedback:true }),
        instructionProtocolBlock('Инструкция: Go / No-Go - основной этап', `Отлично! Переходим к основной задаче.
Жмите Пробел при появлении зеленого круга и ничего не делайте при появлении красного круга. Сигналы будут появляться быстро.
Постарайтесь отвечать максимально быстро, но не в ущерб точности. Обратная связь больше отображаться не будет.`),
        cognitiveProtocolBlock('Go / No-Go - основной блок', 'go_nogo', { trials:goNoGoTrials(), randomize:false, pseudoRandomization:'No-Go не идут более 3 раз подряд', useFixation:true, fixationDuration:500, rtWindow:1000, showFeedback:false })
      ]),
      stroop: completeProtocol([
        instructionProtocolBlock('Инструкция: Stroop - тренировка', `В этом задании на экране будут появляться названия цветов, например слово "КРАСНЫЙ", но они могут быть написаны другим цветом чернил, например синим шрифтом.
Ваша задача - определить ЦВЕТ ШРИФТА, игнорируя само написанное слово.
Если шрифт красный - нажмите стрелку влево. Если шрифт синий - нажмите стрелку вниз. Если шрифт зеленый - нажмите стрелку вправо.
Пройдите тренировку, чтобы запомнить клавиши. Отвечайте максимально быстро, но старайтесь не допускать ошибок.`),
        cognitiveProtocolBlock('Stroop - тренировка', 'stroop', { trials:repeatTrials(stroop,2), randomize:true, useFixation:true, fixationDuration:500, rtWindow:2000, showFeedback:true }),
        instructionProtocolBlock('Инструкция: Stroop - основной этап', `Переходим к основной части.
Напоминаем главное правило: реагируйте только на цвет чернил, а не на смысл слова.
Нажимайте нужную клавишу как можно быстрее и точнее: стрелка влево - красный, стрелка вниз - синий, стрелка вправо - зеленый. Обратная связь больше отображаться не будет.`),
        cognitiveProtocolBlock('Stroop - основной блок', 'stroop', { trials:repeatTrials(stroop,10), randomize:true, useFixation:true, fixationDuration:500, rtWindow:2000, showFeedback:false })
      ]),
      flanker: completeProtocol([
        instructionProtocolBlock('Инструкция: Flanker - тренировка', `На экране будет появляться ряд из пяти стрелок, например >><>> или <<<<<.
Ваша задача - смотреть только на центральную стрелку и указать, в какую сторону она смотрит. Соседние стрелки нужно игнорировать.
Если центральная стрелка смотрит влево < - нажмите Стрелку Влево.
Если центральная стрелка смотрит вправо > - нажмите Стрелку Вправо.
Давайте потренируемся.`),
        cognitiveProtocolBlock('Flanker - тренировка', 'flanker', { trials:repeatTrials(flanker,2).concat([trial('std_flanker_right_cong','congruent/right','arrow_right',1500), trial('std_flanker_left_incong','incongruent/left','arrow_left',1500)]), randomize:true, useFixation:true, fixationDuration:500, rtWindow:1500, showFeedback:true }),
        instructionProtocolBlock('Инструкция: Flanker - основной этап', `Тренировка завершена.
Продолжайте следить только за центральной стрелкой и нажимать соответствующую клавишу на клавиатуре: Влево или Вправо.
Старайтесь не отвлекаться на боковые стрелки. Отвечайте максимально быстро, но старайтесь не допускать ошибок.`),
        cognitiveProtocolBlock('Flanker - основной блок', 'flanker', { trials:repeatTrials(flanker,20), randomize:true, useFixation:true, fixationDuration:500, rtWindow:1500, showFeedback:false })
      ]),
      nback: completeProtocol([
        instructionProtocolBlock('Инструкция: 2-back - тренировка', `В этой задаче на экране будут по одной появляться геометрические фигуры.
Ваша цель - нажать Пробел, если текущая фигура совпадает с той, что была показана ровно две фигуры назад.
Пример: круг -> квадрат -> круг. На третьей фигуре нужно нажать Пробел, потому что она совпадает с фигурой два шага назад.
Если фигура не совпадает с той, что была 2 шага назад, ничего не нажимайте. Пройдите обучающий блок для закрепления правил.`),
        cognitiveProtocolBlock('2-back - тренировка', 'nback_2', { trials:nBackTrials('practice',[4,7,10,13,16,19]), randomize:false, useFixation:true, fixationDuration:500, rtWindow:2500, stimulusDuration:500, showFeedback:true }),
        instructionProtocolBlock('Инструкция: 2-back - основной этап', `Правила усвоены. Теперь начнется основной блок.
Внимательно следите за последовательностью. Жмите Пробел только при совпадении текущей фигуры с фигурой через одну назад.
Задача требует высокой концентрации. Отвечайте максимально быстро, но старайтесь не допускать ошибок.`),
        cognitiveProtocolBlock('2-back - основной блок 1', 'nback_2', { trials:nBackTrials('main_1',[4,8,11,15,18,21]), randomize:false, useFixation:true, fixationDuration:500, rtWindow:2500, stimulusDuration:500, showFeedback:false }),
        cognitiveProtocolBlock('2-back - основной блок 2', 'nback_2', { trials:nBackTrials('main_2',[5,7,12,14,17,20,21]), randomize:false, useFixation:true, fixationDuration:500, rtWindow:2500, stimulusDuration:500, showFeedback:false }),
        cognitiveProtocolBlock('2-back - основной блок 3', 'nback_2', { trials:nBackTrials('main_3',[3,6,10,13,16,19,21]), randomize:false, useFixation:true, fixationDuration:500, rtWindow:2500, stimulusDuration:500, showFeedback:false })
      ]),
      pvt: completeProtocol([
        instructionProtocolBlock('Инструкция: PVT - тренировка', `В этом тесте мы проверим вашу способность удерживать внимание.
На экране будет появляться красный счетчик с бегущими миллисекундами. Ваша задача - остановить его как можно быстрее, нажав Пробел.
После остановки счетчика вы увидите свое время реакции. Интервалы между появлениями счетчика будут непредсказуемыми, от пары секунд до десяти секунд.
Попробуйте остановить его несколько раз.`),
        cognitiveProtocolBlock('PVT - тренировка', 'pvt', { trials:[trial('std_pvt_counter','counter onset','space',10000,5,{ randomItiMin:2000, randomItiMax:6000, feedbackDuration:1000 })], randomize:false, useFixation:false, rtWindow:10000, stimulusDuration:0, showFeedback:true, feedbackCorrect:'{rt} мс' }),
        instructionProtocolBlock('Инструкция: PVT - основной этап', `Сейчас начнется длительный этап. Он займет несколько минут непрерывной работы.
Смотрите на центр экрана и нажимайте Пробел сразу же, как появляется красный счётчик.
Постарайтесь не отвлекаться от экрана до самого конца теста.`),
        cognitiveProtocolBlock('PVT - 5 минут', 'pvt', { trials:[trial('std_pvt_counter','counter onset','space',10000,1,{ randomItiMin:2000, randomItiMax:10000, feedbackDuration:1000 })], randomize:false, useFixation:false, rtWindow:10000, stimulusDuration:0, protocolDurationMs:300000, showFeedback:true, feedbackCorrect:'{rt} мс' })
      ]),
      cpt: completeProtocol([
        instructionProtocolBlock('Инструкция: AX-CPT - тренировка', `На экране будут быстро появляться буквы.
Вы должны нажать Пробел только в одном конкретном случае: когда вы видите букву X, и при этом сразу перед ней была буква A.
Во всех остальных случаях, например если перед X была другая буква или если после A появилась не X, ничего не нажимайте.
Потренируйтесь распознавать эту пару букв.`),
        cognitiveProtocolBlock('AX-CPT - тренировка', 'ax_cpt', { trials:cptTrials(1).slice(0,8), randomize:false, useFixation:false, rtWindow:1250, stimulusDuration:250, showFeedback:true }),
        instructionProtocolBlock('Инструкция: AX-CPT - основной этап', `Начинаем основное задание. Оно продлится довольно долго.
Внимательно следите за экраном. Нажимайте Пробел ТОЛЬКО на букву X, которой предшествовала буква A.
Сохраняйте фокус и реагируйте быстро.`),
        cognitiveProtocolBlock('AX-CPT - основной блок', 'ax_cpt', { trials:cptTrials(24), randomize:false, useFixation:false, rtWindow:1250, stimulusDuration:250, protocolDurationMs:600000, showFeedback:false })
      ]),
      task_switching: completeProtocol([
        instructionProtocolBlock('Инструкция: Task Switching - тренировка', `В этом задании на экране будут появляться комбинации из цифры и буквы, например 4G или 7A. Обратите внимание на цвет фона - он подскажет вам правило.
Если фон СИНИЙ: смотрите только на цифру. Нажмите Стрелку Влево, если она четная, и Стрелку Вправо, если нечетная.
Если фон ЖЕЛТЫЙ: смотрите только на букву. Нажмите Стрелку Влево, если это гласная, и Стрелку Вправо, если согласная.
Сначала вы потренируетесь с каждым правилом отдельно, а затем они будут чередоваться случайным образом.`),
        cognitiveProtocolBlock('Task Switching - правило числа', 'task_switching', { trials:taskSwitchTrials('number',10), randomize:true, useFixation:false, rtWindow:3000, showFeedback:true }),
        cognitiveProtocolBlock('Task Switching - правило буквы', 'task_switching', { trials:taskSwitchTrials('letter',10), randomize:true, useFixation:false, rtWindow:3000, showFeedback:true }),
        cognitiveProtocolBlock('Task Switching - смешанная тренировка', 'task_switching', { trials:taskSwitchTrials('mixed',5), randomize:true, useFixation:false, rtWindow:3000, showFeedback:true }),
        instructionProtocolBlock('Инструкция: Task Switching - основной этап', `Правила зафиксированы.
Напоминаем: Синий фон = цифра, четная или нечетная. Желтый фон = буква, гласная или согласная.
Будьте внимательны к цвету экрана перед каждым ответом. Отвечайте быстро, но точно.`),
        cognitiveProtocolBlock('Task Switching - основной смешанный блок', 'task_switching', { trials:taskSwitchTrials('mixed',20), randomize:true, useFixation:false, rtWindow:3000, showFeedback:false })
      ]),
      emotion_viewing: completeProtocol([
        instructionProtocolBlock('Инструкция: Просмотр эмоций - тренировка', `Это задание отличается от предыдущих. Здесь вам не нужно будет нажимать на клавиши.
На экране будут по очереди появляться лица людей с разными эмоциями. Ваша задача - просто внимательно смотреть на эти изображения.
Поскольку в этом задании для анализа используется камера, пожалуйста, убедитесь, что вы сидите ровно, ваше лицо хорошо освещено и полностью находится в кадре.
Не закрывайте глаза и старайтесь не делать резких движений головой. Сейчас мы выведем пару тестовых изображений.`),
        cognitiveProtocolBlock('Emotion Viewing - тренировка', 'emotion_viewing', { trials: emotions.training, randomize:false, useRT:false, useAOI:true, useFixation:true, fixationDuration:1000, stimulusDuration:4000, responseType:'none', analytics:{ webcam:true, mediapipe:true, gazeAoi:['eyes','mouth','face'] } }),
        instructionProtocolBlock('Инструкция: Просмотр эмоций - основной этап', `Переходим к просмотру.
Просто смотрите на экран в естественном для вас темпе, пока изображения не перестанут сменять друг друга.
Сохраняйте удобное положение перед камерой.`),
        cognitiveProtocolBlock('Emotion Viewing - свободный просмотр', 'emotion_viewing', { trials: emotions.main, randomize:true, useRT:false, useAOI:true, useFixation:true, fixationDuration:1000, stimulusDuration:4000, responseType:'none', analytics:{ webcam:true, mediapipe:true, gazeAoi:['eyes','mouth','face'] } })
      ])
    };

    return cloneProtocolData(protocols[template.id] || template.blocks || []);
  }
