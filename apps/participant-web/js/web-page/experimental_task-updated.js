import {
    state,
    ex_state,
    setSessionPhase,
    recordSessionEvent,
    setTaskContext,
    clearTaskContext,
    getRelativeSessionTimeMs
} from './state.js?v=20261006-3';
import { finishSession } from './tests-updated.js?v=20261006-3';
import { extractEyeSignalSample } from './eye-signal.js';
import { updateFromMetrics as qcOverlayUpdateFromMetrics } from '../qc-pause-overlay-new.js';
import { hide as hideQcOverlay } from '../qc-pause-overlay-new.js';
import { isVisible as isQcOverlayVisible } from '../qc-pause-overlay-new.js';
import { getEmotionSample, appendEmotionSample } from '../emotion-stub-new.js';
import { translations } from '../../translations.js?v=20261006-3';
import { definitionForCognitiveRunner } from './protocol-invite-utils.js?v=20260915-1';
import {
    getSessionRuntime,
    isContinuousSessionAnalysisRunning
} from '../session-runtime/index.js?v=20261006-3';
import {
    buildTrialRepeatPlan,
    collectTrialQualityIssues
} from '../session-runtime/trial-quality.mjs';
import {
    RtResponseCollector,
    normalizeResponseMode,
    normalizeKeyboardResponse,
    keyboardResponseLabel
} from '../rt-input/response-policy.mjs?v=20261006-3';

const TARGET_LOOP_INTERVAL_MS = 33;
const SAME_FRAME_RETRY_MS = 8;

let experimentProtocol = null;
let currentBlockIndex = 0;
let currentTrialIndex = 0;
let fixationTimeout = null;
let trialTimeout = null;
let responseCollector = null;
let activeTrialRuntime = null;
let cognitiveFinished = false;

let cognitiveVideo = null;
let cognitiveLoopLastVideoTime = -1;
let cognitiveSegmenterThrottleCounter = 0;
let cognitiveSegmenterInFlight = false;
let cognitiveLastSegmenterResult = null;
let cognitiveTaskOptions = {
    autoFinishSession: true,
    onComplete: null
};
let trialPhase = 'idle';
let fixationStartPerf = null;
let fixationRemainingMs = 0;
let pendingFixationCallback = null;
let stimulusTimeoutRemainingMs = 0;
let stimulusTimerStartPerf = null;
let pendingStimulusTimeoutCallback = null;
let currentBlockAttempt = 1;
let activeBlockTrialPlan = [];
let activeBlockDeadlinePerf = null;
let activeTrialQualityContext = null;
let acknowledgedTaskBlockIndex = null;
let cognitiveFullscreenOwned = false;
let timedProtocolBlockInterval = null;
let pendingPhotodiodeTaskStart = null;
const MAX_COGNITIVE_BLOCK_ATTEMPTS = 3;

const LOCALE_FIELD_SUFFIX = Object.freeze({
    ru: 'Ru', en: 'En', zh: 'Zh', es: 'Es', hi: 'Hi',
    ar: 'Ar', fr: 'Fr', bn: 'Bn', pt: 'Pt', ur: 'Ur'
});

function localizedProtocolValue(source, field, fallback = '') {
    const value = source && typeof source === 'object' ? source : {};
    const suffix = LOCALE_FIELD_SUFFIX[state.currentLang] || 'En';
    const direct = value[`${field}${suffix}`]
        || (state.currentLang !== 'ru' ? value[`${field}En`] : null);
    if (direct) return direct;

    if (state.currentLang !== 'ru') {
        const titleRu = value.titleRu || value.title || '';
        const standard = state.currentLang === 'en'
            ? globalThis.WecogTemplateInstructionTranslations?.[titleRu]
            : null;
        if (standard && (field === 'title' || field === 'text')) {
            return standard[field] || fallback;
        }
        if (standard && field === 'buttonText') {
            return (translations[state.currentLang] || translations.en).runtime_instruction_action;
        }
    }

    if (state.currentLang !== 'ru') return fallback;
    return value[field] || value[`${field}Ru`] || fallback;
}

const STANDARD_TASK_RULES = Object.freeze({
    "ru": {
        "simple_rt": "Когда появится стимул, как можно быстрее {response}.",
        "go_nogo": "Зелёный круг: {response}. Красный круг: ничего не нажимайте.",
        "stroop": "Отвечайте по ЦВЕТУ ШРИФТА, а не по значению слова.",
        "flanker": "Смотрите только на центральную стрелку. Отвечайте по её направлению; боковые стрелки игнорируйте.",
        "nback_2": "{response}, только если текущая фигура совпадает с фигурой два шага назад. При несовпадении ничего не нажимайте.",
        "pvt": "Когда появится красный счётчик, как можно быстрее {response}. До его появления ничего не нажимайте.",
        "ax_cpt": "{response} только на X, если непосредственно перед ним была A. Во всех остальных случаях ничего не нажимайте.",
        "task_switching": "Синий фон: оцените чётность числа. Жёлтый фон: определите, является ли буква гласной или согласной.",
        "emotion_viewing": "Спокойно смотрите на каждое изображение до его смены."
    },
    "en": {
        "simple_rt": "When the stimulus appears, {response} as quickly as possible.",
        "go_nogo": "Green circle: {response}. Red circle: do not press anything.",
        "stroop": "Respond to the INK COLOUR, not the word.",
        "flanker": "Look only at the centre arrow. Respond to its direction; ignore the surrounding arrows.",
        "nback_2": "{response} only when the current shape matches the shape shown two steps earlier. Otherwise do not respond.",
        "pvt": "When the red counter appears, {response} as quickly as possible. Do not respond before it appears.",
        "ax_cpt": "{response} only for X when it was immediately preceded by A. Do not respond in any other case.",
        "task_switching": "Blue background: classify the number as even or odd. Yellow background: classify the letter as a vowel or consonant.",
        "emotion_viewing": "Look naturally at each image until it changes."
    },
    "es": {
        "simple_rt": "Cuando aparezca el estímulo, {response} lo antes posible.",
        "go_nogo": "Círculo verde: {response}. Círculo rojo: no responda.",
        "stroop": "Responda al COLOR DE LA TINTA, no a la palabra.",
        "flanker": "Mire solo la flecha central y responda según su dirección. Ignore las flechas laterales.",
        "nback_2": "{response} solo si la figura actual coincide con la mostrada dos posiciones antes. Si no coincide, no responda.",
        "pvt": "Cuando aparezca el contador rojo, {response} lo antes posible. No responda antes.",
        "ax_cpt": "{response} solo para X cuando esté precedida inmediatamente por A. En los demás casos no responda.",
        "task_switching": "Fondo azul: clasifique el número como par o impar. Fondo amarillo: clasifique la letra como vocal o consonante.",
        "emotion_viewing": "Mire cada imagen con naturalidad hasta que cambie."
    },
    "fr": {
        "simple_rt": "Lorsque le stimulus apparaît, {response} le plus vite possible.",
        "go_nogo": "Cercle vert : {response}. Cercle rouge : ne répondez pas.",
        "stroop": "Répondez à la COULEUR DE L’ENCRE, pas au mot.",
        "flanker": "Regardez uniquement la flèche centrale et répondez selon sa direction. Ignorez les flèches latérales.",
        "nback_2": "{response} seulement si la forme correspond à celle vue deux positions plus tôt. Sinon, ne répondez pas.",
        "pvt": "Lorsque le compteur rouge apparaît, {response} le plus vite possible. Ne répondez pas avant.",
        "ax_cpt": "{response} uniquement pour X immédiatement précédé de A. Sinon, ne répondez pas.",
        "task_switching": "Fond bleu : nombre pair ou impair. Fond jaune : voyelle ou consonne.",
        "emotion_viewing": "Regardez naturellement chaque image jusqu’à son changement."
    },
    "zh": {
        "simple_rt": "刺激出现时，请尽快{response}。",
        "go_nogo": "绿色圆形：{response}。红色圆形：不要作答。",
        "stroop": "只根据字体颜色作答，不要根据词义作答。",
        "flanker": "只看中央箭头并根据其方向作答；忽略两侧箭头。",
        "nback_2": "仅当当前图形与前两个位置的图形相同时，{response}；否则不要作答。",
        "pvt": "红色计数器出现时，请尽快{response}；出现前不要作答。",
        "ax_cpt": "只有当 X 紧跟在 A 之后时，{response}；其他情况不要作答。",
        "task_switching": "蓝色背景：判断数字的奇偶。黄色背景：判断字母是元音还是辅音。",
        "emotion_viewing": "自然观看每张图像，直到图像切换。"
    },
    "hi": {
        "simple_rt": "उद्दीपन दिखाई देते ही जितनी जल्दी हो सके {response}।",
        "go_nogo": "हरा वृत्त: {response}। लाल वृत्त: उत्तर न दें।",
        "stroop": "शब्द नहीं, स्याही के रंग पर उत्तर दें।",
        "flanker": "केवल बीच के तीर की दिशा पर उत्तर दें; बाकी तीरों को अनदेखा करें।",
        "nback_2": "वर्तमान आकृति दो स्थान पहले वाली आकृति से मिले तभी {response}। अन्यथा उत्तर न दें।",
        "pvt": "लाल काउंटर दिखाई देते ही {response}। उससे पहले उत्तर न दें।",
        "ax_cpt": "X के ठीक पहले A हो तभी {response}। अन्यथा उत्तर न दें।",
        "task_switching": "नीला: संख्या सम या विषम है। पीला: अक्षर स्वर या व्यंजन है।",
        "emotion_viewing": "हर चित्र को बदलने तक स्वाभाविक रूप से देखें।"
    },
    "ar": {
        "simple_rt": "عند ظهور المثير، {response} بأسرع ما يمكن.",
        "go_nogo": "الدائرة الخضراء: {response}. الدائرة الحمراء: لا تستجب.",
        "stroop": "استجب للون الحبر، وليس لمعنى الكلمة.",
        "flanker": "انظر إلى السهم الأوسط فقط واستجب لاتجاهه. تجاهل الأسهم المحيطة.",
        "nback_2": "إذا طابق الشكل الحالي الشكل الذي ظهر قبل خطوتين، {response}. وإلا فلا تستجب.",
        "pvt": "عند ظهور العداد الأحمر، {response} بأسرع ما يمكن. لا تستجب قبله.",
        "ax_cpt": "عند ظهور X إذا سبقه A مباشرة، {response}. وإلا فلا تستجب.",
        "task_switching": "الخلفية الزرقاء: عدد زوجي أو فردي. الصفراء: حرف علة أو حرف ساكن.",
        "emotion_viewing": "انظر بصورة طبيعية إلى كل صورة حتى تتغير."
    },
    "bn": {
        "simple_rt": "উদ্দীপনা দেখা মাত্র যত দ্রুত সম্ভব {response}।",
        "go_nogo": "সবুজ বৃত্ত: {response}। লাল বৃত্ত: উত্তর দেবেন না।",
        "stroop": "শব্দের অর্থ নয়, কালির রং অনুযায়ী উত্তর দিন।",
        "flanker": "শুধু মাঝের তীরের দিক অনুযায়ী উত্তর দিন; পাশের তীরগুলো উপেক্ষা করুন।",
        "nback_2": "বর্তমান আকৃতি দুই ধাপ আগেরটির সঙ্গে মিললেই {response}। না মিললে উত্তর দেবেন না।",
        "pvt": "লাল কাউন্টার দেখা মাত্র {response}। আগে উত্তর দেবেন না।",
        "ax_cpt": "X-এর ঠিক আগে A থাকলেই {response}। অন্য ক্ষেত্রে উত্তর দেবেন না।",
        "task_switching": "নীল: সংখ্যাটি জোড় না বিজোড়। হলুদ: অক্ষরটি স্বর না ব্যঞ্জন।",
        "emotion_viewing": "প্রতিটি ছবি বদলানো পর্যন্ত দেখুন।"
    },
    "pt": {
        "simple_rt": "Quando aparecer o estímulo, {response} o mais rapidamente possível.",
        "go_nogo": "Círculo verde: {response}. Vermelho: não responda.",
        "stroop": "Responda à cor da tinta, não à palavra.",
        "flanker": "Observe apenas a seta central e responda à sua direção. Ignore as setas laterais.",
        "nback_2": "{response} apenas se a forma atual coincidir com a de duas posições antes. Caso contrário, não responda.",
        "pvt": "Quando aparecer o contador vermelho, {response} rapidamente. Não responda antes.",
        "ax_cpt": "{response} apenas para X imediatamente precedido de A. Nos outros casos não responda.",
        "task_switching": "Fundo azul: número par ou ímpar. Fundo amarelo: vogal ou consoante.",
        "emotion_viewing": "Observe cada imagem naturalmente até mudar."
    },
    "ur": {
        "simple_rt": "محرک ظاہر ہوتے ہی جتنی جلدی ممکن ہو {response}۔",
        "go_nogo": "سبز دائرہ: {response}۔ سرخ دائرہ: جواب نہ دیں۔",
        "stroop": "لفظ کے معنی نہیں، سیاہی کے رنگ کے مطابق جواب دیں۔",
        "flanker": "صرف درمیان کے تیر کی سمت کے مطابق جواب دیں؛ اطراف کے تیر نظر انداز کریں۔",
        "nback_2": "موجودہ شکل دو مراحل پہلے کی شکل سے ملے تب ہی {response}۔ ورنہ جواب نہ دیں۔",
        "pvt": "سرخ کاؤنٹر ظاہر ہوتے ہی {response}۔ پہلے جواب نہ دیں۔",
        "ax_cpt": "X سے فوراً پہلے A ہو تب ہی {response}۔ ورنہ جواب نہ دیں۔",
        "task_switching": "نیلا پس منظر: جفت یا طاق عدد۔ پیلا: حرف علت یا صحیح حرف۔",
        "emotion_viewing": "ہر تصویر بدلنے تک فطری طور پر دیکھیں۔"
    }
});

const STANDARD_TASK_NAMES = Object.freeze({
    simple_rt: 'Simple RT', go_nogo: 'Go / No-Go', stroop: 'Stroop',
    flanker: 'Flanker', nback_2: '2-back', pvt: 'PVT', ax_cpt: 'AX-CPT',
    task_switching: 'Task Switching', emotion_viewing: 'Emotion Viewing'
});

const STANDARD_INSTRUCTION_PHASES = Object.freeze({
    ru: { practice: 'тренировка', main: 'основной этап' },
    en: { practice: 'practice', main: 'main phase' },
    zh: { practice: '练习', main: '正式阶段' },
    es: { practice: 'práctica', main: 'fase principal' },
    hi: { practice: 'अभ्यास', main: 'मुख्य चरण' },
    ar: { practice: 'تدريب', main: 'المرحلة الرئيسية' },
    fr: { practice: 'entraînement', main: 'phase principale' },
    bn: { practice: 'অনুশীলন', main: 'মূল পর্ব' },
    pt: { practice: 'prática', main: 'fase principal' },
    ur: { practice: 'مشق', main: 'مرکزی مرحلہ' }
});

function standardInstructionTaskKey(content, nextBlock = null) {
    const rawTaskType = String(
        nextBlock?.taskType
        || nextBlock?.rt_task
        || nextBlock?.blockConfig?.taskType
        || nextBlock?.blockConfig?.rt_task
        || ''
    ).trim().toLowerCase().replace(/[\s-]+/g, '_');
    const taskAliases = {
        simple: 'simple_rt', simple_rt: 'simple_rt',
        go_nogo: 'go_nogo', gonogo: 'go_nogo',
        stroop: 'stroop', flanker: 'flanker',
        nback: 'nback_2', nback_2: 'nback_2', '2_back': 'nback_2',
        pvt: 'pvt', cpt: 'ax_cpt', ax_cpt: 'ax_cpt',
        task_switching: 'task_switching', switching: 'task_switching',
        emotion_viewing: 'emotion_viewing', passive_viewing: 'emotion_viewing'
    };
    const title = String(
        content?.titleRu || content?.titleEn || content?.title || ''
    ).toLowerCase();
    const authoredText = content?.text || Object.values(LOCALE_FIELD_SUFFIX)
        .some(suffix => content?.[`text${suffix}`]);
    const standardTitle = /simple rt|простая реакция|go\s*\/\s*no-go|stroop|струп|flanker|фланкер|2[- ]back|pvt|ax[- ]cpt|task switching|переключение задач|просмотр эмоций|emotion viewing/.test(title);
    if (taskAliases[rawTaskType] && (!authoredText || standardTitle || content?.standardInstruction === true)) {
        return taskAliases[rawTaskType];
    }
    if (title.includes('simple rt') || title.includes('простая реакция')) return 'simple_rt';
    if (title.includes('go / no-go') || title.includes('go/no-go')) return 'go_nogo';
    if (title.includes('stroop') || title.includes('струп')) return 'stroop';
    if (title.includes('flanker') || title.includes('фланкер')) return 'flanker';
    if (title.includes('2-back') || title.includes('2 back')) return 'nback_2';
    if (title.includes('pvt')) return 'pvt';
    if (title.includes('ax-cpt') || title.includes('ax cpt')) return 'ax_cpt';
    if (title.includes('task switching') || title.includes('переключение задач')) return 'task_switching';
    if (title.includes('просмотр эмоций') || title.includes('emotion viewing')) return 'emotion_viewing';
    return null;
}

function standardInstructionTitle(content, nextBlock, taskKey, t) {
    const value = content && typeof content === 'object' ? content : {};
    const suffix = LOCALE_FIELD_SUFFIX[state.currentLang] || 'En';
    const explicit = value[`title${suffix}`];
    if (explicit) return explicit;

    const sourceTitle = String(value.titleRu || value.title || '');
    if (state.currentLang === 'ru' && sourceTitle) return sourceTitle;
    if (state.currentLang === 'en') {
        const translated = globalThis.WecogTemplateInstructionTranslations?.[sourceTitle]?.title;
        if (translated) return translated;
    }

    const phaseSource = `${sourceTitle} ${nextBlock?.labelRu || nextBlock?.label || ''} ${nextBlock?.id || ''}`
        .toLowerCase();
    const phaseKey = /тренир|practice/.test(phaseSource)
        ? 'practice'
        : (/основ|main/.test(phaseSource) ? 'main' : null);
    const phases = STANDARD_INSTRUCTION_PHASES[state.currentLang] || STANDARD_INSTRUCTION_PHASES.en;
    const base = `${t.runtime_instruction_title}: ${STANDARD_TASK_NAMES[taskKey]}`;
    return phaseKey ? `${base} - ${phases[phaseKey]}` : base;
}

function responseActionText(action, t) {
    const keyLabel = keyboardResponseLabel(action);
    if (keyLabel) return keyLabel;
    const normalized = String(action || '').trim().toLowerCase();
    if (normalized === 'space') return t.runtime_response_space;
    if (normalized === 'arrowleft' || normalized === 'arrow_left') return t.runtime_response_left;
    if (normalized === 'arrowright' || normalized === 'arrow_right') return t.runtime_response_right;
    if (normalized === 'arrowdown' || normalized === 'arrow_down') return t.runtime_response_down;
    if (normalized === 'arrowup' || normalized === 'arrow_up') return t.runtime_response_up;
    if (normalized === 'click' || normalized === 'mouse_click') return t.runtime_response_click;
    if (normalized === 'pointerintent' || normalized === 'pointer_intent' || normalized === 'mouse_intent') {
        return t.runtime_response_pointer;
    }
    return null;
}

function responseGuidanceForBlock(block) {
    if (!block || block.type !== 'cognitive_task') return '';
    const t = translations[state.currentLang] || translations.en;
    const trials = Array.isArray(block.trials) ? block.trials : [];
    const actions = [...new Set(trials.filter(trial => trial?.correctResponse)
        .map(trial => responseForTrial(block, trial, t)).filter(Boolean))];
    const hasNoResponseTrials = trials.some(trial => trial?.correctResponse == null || trial.correctResponse === '');
    const method = actions.length ? actions.join(' / ') : t.runtime_response_none;
    return `${t.runtime_response_method}: ${method}.${hasNoResponseTrials && actions.length ? ` ${t.runtime_response_withhold}` : ''}`;
}

function responseForTrial(block, trial, t) {
    const mode = normalizeResponseMode(block?.blockConfig || {}, trial);
    if (mode === 'none' || !trial?.correctResponse) return t.runtime_response_none;
    if (mode === 'click') return t.runtime_response_click;
    if (mode === 'pointer_intent') return t.runtime_response_pointer;
    const key = keyboardResponseLabel(trial.correctResponse);
    return key ? t.runtime_response_keypress.replace('{keys}', key) : responseActionText(trial.correctResponse, t);
}

function responsePhraseForBlock(block) {
    const t = translations[state.currentLang] || translations.en;
    const trials = Array.isArray(block?.trials) ? block.trials : [];
    const phrases = [...new Set(trials.filter(trial => trial?.correctResponse)
        .map(trial => responseForTrial(block, trial, t)).filter(Boolean))];
    return phrases.length ? phrases.join(' / ') : t.runtime_response_none;
}

function localizedStandardInstruction(content, nextBlock, includeGuidance = true) {
    const taskKey = standardInstructionTaskKey(content, nextBlock);
    if (!taskKey) return null;
    const t = translations[state.currentLang] || translations.en;
    let rule = STANDARD_TASK_RULES[state.currentLang]?.[taskKey]
        || STANDARD_TASK_RULES.en[taskKey]
        || t.runtime_standard_instruction_body;
    const response = responsePhraseForBlock(nextBlock);
    rule = rule.replaceAll('{response}', response);
    const responsiveTrials = (nextBlock?.trials || []).filter(trial => trial.correctResponse);
    if (!responsiveTrials.length || responsiveTrials.every(trial => normalizeResponseMode(nextBlock.blockConfig || {}, trial) === 'none')) {
        rule = taskKey === 'emotion_viewing' ? rule : t.runtime_response_none;
    }
    // Choice-task mappings come from the actual trials, never the template's old arrow keys.
    if (['stroop', 'flanker', 'task_switching'].includes(taskKey)) {
        const mapping = new Set((nextBlock?.trials || []).map(trial => {
            const condition = String(trial.condition || '').trim();
            return condition ? `${condition}: ${responseForTrial(nextBlock, trial, t)}.` : null;
        }).filter(Boolean));
        if (mapping.size) rule += '\n' + [...mapping].join('\n');
    }
    const guidance = includeGuidance ? responseGuidanceForBlock(nextBlock) : '';
    return guidance ? `${rule}\n\n${guidance}` : rule;
}

function buildSessionQualityInstruction() {
    const t = translations[state.currentLang] || translations.en;
    return {
        id: 'session_quality_policy',
        type: 'instruction',
        content: {
            title: t.runtime_policy_title,
            text: `${t.runtime_policy_body} ${t.runtime_policy_note}`,
            buttonText: t.runtime_continue
        }
    };
}

function ensureSessionQualityInstruction(protocol) {
    if (!protocol || !Array.isArray(protocol.blocks)) return protocol;
    if (protocol.blocks.some(block => block?.id === 'session_quality_policy')) return protocol;
    protocol.blocks.unshift(buildSessionQualityInstruction());
    return protocol;
}

function resolveTrialStimulusObject(stimulusId, meta) {
    const std = typeof window !== 'undefined' ? window.StandardStimuli : null;
    if (std) {
        return std.resolveParticipantStimulus({
            stimulusId,
            meta,
            lang: state.currentLang || 'ru',
        });
    }
    return {
        type: 'shape',
        style: { width: '140px', height: '140px', borderRadius: '8px', backgroundColor: '#5C66BD' },
        stimulusId: stimulusId || undefined,
    };
}

function buildDefaultTrials(seed = 'default') {
    return [
        {
            id: `trial_${seed}_go`,
            condition: 'go',
            correctResponse: 'Space',
            stimulus: { type: 'shape', style: { width: '140px', height: '140px', borderRadius: '8px', backgroundColor: '#4CAF50' } }
        },
        {
            id: `trial_${seed}_nogo`,
            condition: 'nogo',
            correctResponse: null,
            stimulus: { type: 'shape', style: { width: '140px', height: '140px', borderRadius: '50%', backgroundColor: '#F44336' } }
        }
    ];
}

function buildSimpleRtTrials(seed = 'simple_rt', count = 10) {
    const trials = [];
    for (let i = 0; i < count; i += 1) {
        trials.push({
            id: `trial_${seed}_${i}`,
            condition: 'target',
            correctResponse: 'Space',
            stimulus: {
                type: 'shape',
                style: { width: '120px', height: '120px', borderRadius: '8px', backgroundColor: '#020617' },
                stimulusId: 'std_simple_black_square'
            }
        });
    }
    return trials;
}

function buildStandardInvitationTrials(taskType, index) {
    const specs = {
        go_nogo: [
            ['std_go_green_circle', 'Go', 'space', 700],
            ['std_nogo_red_circle', 'No-Go', '', 700]
        ],
        stroop: [
            ['std_stroop_red_red', 'congruent/red', 'arrow_left', 2000],
            ['std_stroop_blue_green', 'incongruent/green ink', 'arrow_right', 2000],
            ['std_stroop_red_blue', 'incongruent/blue ink', 'arrow_down', 2000]
        ],
        flanker: [
            ['std_flanker_right_incong', 'incongruent/right', 'arrow_right', 1500],
            ['std_flanker_left_incong', 'incongruent/left', 'arrow_left', 1500]
        ],
        nback_2: [
            ['std_nback_circle', 'non-target', '', 1000],
            ['std_nback_square', 'non-target', '', 1000],
            ['std_nback_circle', 'target 2-back', 'space', 1000]
        ],
        ax_cpt: [
            ['std_cpt_a', 'cue', '', 500],
            ['std_cpt_x', 'AX target', 'space', 500],
            ['std_cpt_b', 'non-target', '', 500],
            ['std_cpt_x', 'non-target', '', 500]
        ],
        task_switching: [
            ['std_switch_4g', 'number/even', 'arrow_left', 2000],
            ['std_switch_7a', 'number/odd', 'arrow_right', 2000],
            ['std_switch_2e', 'letter/vowel', 'arrow_left', 2000],
            ['std_switch_9k', 'letter/consonant', 'arrow_right', 2000]
        ],
        emotion_viewing: [
            ['std_emo_neutral_01', 'neutral', '', 4000, 'none'],
            ['std_emo_happy_01', 'happy', '', 4000, 'none']
        ]
    };
    const rows = specs[taskType];
    if (!rows) return [];
    return normalizeV2Trials(rows.map((row, trialIndex) => ({
        stimulusId: row[0],
        condition: row[1],
        action: row[2],
        duration: row[3],
        responseMode: row[4] || null,
        repetitions: 1,
        id: `default_${index}_${trialIndex}`
    })));
}

/** When API cognitive_task has no trials array, derive runnable trials from taskType. */
function synthesizeInvitationTrials(block, index) {
    const normalized = normalizeV2Trials(block.trials);
    if (normalized.length) return normalized;

    const cfg = block.blockConfig || {};
    const taskType = String(
        block.taskType || cfg.taskType || block.rt_task || cfg.rt_task || 'other'
    ).toLowerCase();
    const useRt = cfg.useRT !== false && block.useRT !== false;

    if (taskType === 'simple_rt' || taskType === 'pvt') {
        if (taskType === 'pvt') {
            return normalizeV2Trials([{
                stimulusId: 'std_pvt_counter',
                condition: 'counter onset',
                action: 'space',
                duration: 10000,
                repetitions: 5
            }]);
        }
        return buildSimpleRtTrials(String(index), 10);
    }
    const standardTrials = buildStandardInvitationTrials(taskType, index);
    if (standardTrials.length) return standardTrials;
    // Builder often saves RT blocks as taskType "other" with useRT: true
    if (useRt && taskType === 'other') {
        return buildSimpleRtTrials(String(index), 10);
    }
    return buildDefaultTrials(String(index));
}

function toInstructionBlock(id, title, text, localizedContent = {}) {
    const t = translations[state.currentLang] || translations.en;
    return {
        id,
        type: 'instruction',
        content: {
            ...localizedContent,
            title: title || localizedContent.title || t.runtime_instruction_title,
            text: text || localizedContent.text || '',
            buttonText: localizedContent.buttonText || t.runtime_continue
        }
    };
}

function toSurveyBlock(block, index) {
    const contract = globalThis.WecogSurveyContract;
    const source = block?.content || block?.params || {};
    return {
        id: block?.id || `survey_${index}`,
        type: 'survey',
        label: block?.label || source.title || 'Опрос',
        content: contract?.normalizeSurveyContent
            ? contract.normalizeSurveyContent(source)
            : source
    };
}

function toCognitiveBlockFromStimuli(defBlock, index) {
    const params = defBlock?.params || {};
    const stimuliMap = state.runtime?.invitationStimuliMap || {};
    const normalizeStimulusId = (id) => {
        const raw = String(id || '');
        if (raw.startsWith('api:')) return raw.slice(4);
        return raw;
    };
    const trials = Array.isArray(params.trials) && params.trials.length
        ? params.trials
        : (
            Array.isArray(params.stimuli_ids) && params.stimuli_ids.length
                ? params.stimuli_ids.map((stimulusId, i) => {
                    const normalizedStimulusId = normalizeStimulusId(stimulusId);
                    const row = stimuliMap[normalizedStimulusId] || null;
                    const stimulus = resolveTrialStimulusObject(normalizedStimulusId, row);
                    return {
                    id: `trial_${index}_${i}_${String(stimulusId)}`,
                    condition: 'go',
                    correctResponse: 'Space',
                    stimulus: {
                        ...stimulus,
                        stimulusId: normalizedStimulusId,
                        stimulusName: row?.name || normalizedStimulusId
                    }
                    };
                })
                : buildDefaultTrials(String(index))
        );

    return {
        id: defBlock?.id || `block_${index}`,
        type: 'cognitive_task',
        // Backward/forward compat:
        // - researcher.html protocol editor currently sets `params.duration_sec` for block timing
        // - runtime expects `fixation_ms` / `stimulus_ms`, so we derive sensible ms values from duration_sec.
        blockConfig: {
            fixation: { duration: Number.isFinite(params.fixation_ms) ? params.fixation_ms : 500 },
            stimulusDuration: Number.isFinite(params.stimulus_ms)
                ? params.stimulus_ms
                : (Number.isFinite(params.duration_sec) ? Math.round(params.duration_sec * 1000) : 1000),
            showFeedback: false,
            useAOI: params.useAOI === true,
            aoiSchemaVersion: params.aoiSchemaVersion || null,
            aoiDefinitions: params.aoiDefinitions || {}
        },
        trials
    };
}

function isResearcherV2Protocol(definition) {
    const version = String(definition?.version || '');
    if (version.startsWith('v2')) return true;
    const blocks = Array.isArray(definition?.blocks) ? definition.blocks : [];
    return blocks.some((b) => b?.taskType || b?.blockConfig || Array.isArray(b?.trials));
}

function mapActionToCorrectResponse(action) {
    if (!action) return null;
    const keyboardResponse = normalizeKeyboardResponse(action);
    if (keyboardResponse) return keyboardResponse;
    const a = String(action).toLowerCase();
    if (a === 'space') return 'Space';
    if (a === 'mouse_click') return 'Click';
    if (a === 'mouse_intent' || a === 'pointer_intent') return 'PointerIntent';
    if (a.startsWith('arrow_')) {
        const part = a.replace('arrow_', '');
        return `Arrow${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    }
    return action;
}

function conditionToIsGo(condition) {
    if (condition == null) return null;
    const c = String(condition).toLowerCase();
    if (c.includes('nogo') || c.includes('no-go') || c === 'nogo') return false;
    if (c.includes('go') || c === 'target') return true;
    return null;
}

function normalizeV2Trials(trials) {
    const stimuliMap = state.runtime?.invitationStimuliMap || {};
    const list = Array.isArray(trials) ? trials : [];
    const out = [];
    list.forEach((t, index) => {
        const reps = Math.max(1, parseInt(t.repetitions, 10) || 1);
        for (let r = 0; r < reps; r += 1) {
            const sid = t.stimulusId || `trial_${index}`;
            const meta = stimuliMap[String(sid).replace(/^api:/, '')] || null;
            const stimulus = resolveTrialStimulusObject(sid, meta);
            out.push({
                ...t,
                id: `${sid}_${index}_${r}`,
                condition: t.condition || '',
                correctResponse: mapActionToCorrectResponse(t.action || t.correctResponse),
                responseMode: t.responseMode || null,
                stimulus: { ...stimulus, stimulusId: sid },
                duration: t.duration || null,
                repetitions: 1
            });
        }
    });
    return out;
}

function toCognitiveBlockFromV2(block, index) {
    const cfg = block.blockConfig || {};
    const taskType = block.taskType || cfg.taskType || 'other';
    const isInvite = !!state.runtime?.invitationProtocolDefinition;
    let trials = normalizeV2Trials(block.trials);
    if (!trials.length && isInvite) {
        trials = synthesizeInvitationTrials(block, index);
    }
    if (!trials.length) {
        trials = buildDefaultTrials(String(index));
    }
    return {
        id: block.id || `cognitive_${index}`,
        type: 'cognitive_task',
        taskType,
        rt_task: taskType,
        selected_metrics: cfg.selected_metrics || block.selected_metrics || null,
        blockConfig: {
            ...cfg,
            fixation: cfg.fixation || { duration: cfg.fixationDuration || 500 },
            useFixation: cfg.useFixation !== false,
            stimulusDuration: cfg.stimulusDuration || 1000,
            showFeedback: !!(cfg.showFeedback || cfg.feedbackConfig),
            rtWindow: cfg.rtWindow || 1000,
            omissionRule: cfg.omissionRule || 'skip',
            commissionRule: cfg.commissionRule || 'flag',
            responseMode: cfg.responseMode || null,
            feedbackCorrect: cfg.feedbackConfig?.correctText || null,
            feedbackIncorrect: cfg.feedbackConfig?.incorrectText || null
        },
        trials
    };
}

function toPassiveBlockFromV2(block, index) {
    const content = block?.content || {};
    const config = { ...content, ...(block?.blockConfig || {}) };
    const sourceTrials = Array.isArray(block?.trials) && block.trials.length
        ? block.trials
        : (Array.isArray(content.trials) && content.trials.length ? content.trials : content.slides);
    const trials = (Array.isArray(sourceTrials) ? sourceTrials : []).map((entry, trialIndex) => {
        const value = entry && typeof entry === 'object' ? entry : { stimulusId: entry };
        return {
            ...value,
            stimulusId: value.stimulusId ?? value.id,
            duration: Number(value.duration) || Number(config.slideDuration) || 5000,
            action: null,
            responseMode: 'none',
            condition: value.condition || 'passive_viewing',
            id: value.id || `passive_${index}_${trialIndex}`
        };
    });
    return toCognitiveBlockFromV2({
        ...block,
        type: 'cognitive_task',
        taskType: 'passive_viewing',
        trials,
        blockConfig: {
            ...config,
            taskType: 'passive_viewing',
            useRT: false,
            responseMode: 'none',
            stimulusDuration: Number(config.slideDuration) || 5000,
            useFixation: config.useFixation === true,
            randomize: config.randomize === true,
            randomInterStimulus: config.randomInterStimulus === true,
            fullscreenStimulus: config.fullscreenStimulus === true
        }
    }, index);
}

function normalizeProtocolDefinition(definition, options = {}) {
    if (isResearcherV2Protocol(definition)) {
        const blocksIn = Array.isArray(definition?.blocks) ? definition.blocks : [];
        const outBlocks = [];
        blocksIn.forEach((block, index) => {
            const type = String(block?.type || '').toLowerCase();
            if (type === 'instruction' || type === 'instructions') {
                outBlocks.push(toInstructionBlock(
                    block.id || `instruction_${index}`,
                    block.content?.title || block.label || 'Инструкция',
                    block.content?.text || '',
                    block.content
                ));
                return;
            }
            if (type === 'cognitive_task' || type === 'stimuli') {
                outBlocks.push(toCognitiveBlockFromV2(block, index));
                return;
            }
            if (type === 'survey') {
                outBlocks.push(toSurveyBlock(block, index));
                return;
            }
            if (type === 'finish' || type === 'final') {
                outBlocks.push(toInstructionBlock(
                    block.id || `finish_${index}`,
                    block.content?.title || block.label || 'Эксперимент завершён',
                    block.content?.text || 'Спасибо за участие!',
                    block.content
                ));
                return;
            }
            if (type === 'rest' || type === 'audio_test') {
                outBlocks.push({
                    id: block.id || `${type}_${index}`,
                    type,
                    label: block.label || type,
                    content: { ...(block.content || {}) }
                });
                return;
            }
            if (type === 'passive') {
                outBlocks.push(toPassiveBlockFromV2(block, index));
                return;
            }
            if (type === 'timer') {
                outBlocks.push({
                    id: block.id || `timer_${index}`,
                    type: 'timer',
                    content: { ...(block.content || {}), hidden: true }
                });
            }
        });
        if (outBlocks.length) {
            return {
                title: definition?.title || definition?.meta?.name || 'Protocol',
                version: definition?.version || 'v2-runtime',
                blocks: outBlocks
            };
        }
    }

    const blocksIn = Array.isArray(definition?.blocks) ? definition.blocks : [];
    const outBlocks = [];

    blocksIn.forEach((block, index) => {
        const type = String(block?.type || '').toLowerCase();
        const params = block?.params || {};
        if (type === 'instruction' || type === 'instructions') {
            outBlocks.push(toInstructionBlock(block?.id || `instruction_${index}`, params.title || 'Инструкция', params.text || '', params));
            return;
        }
        if (type === 'consent') {
            outBlocks.push(toInstructionBlock(block?.id || `consent_${index}`, params.title || 'Согласие', params.text || 'Подтвердите согласие на участие.', params));
            return;
        }
        if (type === 'survey') {
            outBlocks.push(toSurveyBlock(block, index));
            return;
        }
        if (type === 'rest' || type === 'audio_test') {
            outBlocks.push({
                id: block?.id || `${type}_${index}`,
                type,
                label: block?.label || params.title || type,
                content: { ...params }
            });
            return;
        }
        if (type === 'questionnaire' || type === 'calibration' || type === 'baseline' || type === 'recovery' || type === 'final') {
            outBlocks.push(toInstructionBlock(block?.id || `${type}_${index}`, params.title || 'Этап', params.text || 'Следующий этап протокола.', params));
            return;
        }
        if (type === 'timer') {
            outBlocks.push({
                id: block?.id || `timer_${index}`,
                type: 'timer',
                content: { ...params, hidden: true }
            });
            return;
        }
        if (type === 'stimuli' || type === 'cognitive_task') {
            outBlocks.push(toCognitiveBlockFromStimuli(block, index));
            return;
        }
    });

    const isInvitationProtocol = options.invitation === true
        || !!state.runtime?.invitationProtocolDefinition;
    if (!outBlocks.length && !isInvitationProtocol) {
        outBlocks.push(toInstructionBlock('instruction_auto', 'Эксперимент', 'Подготовка к когнитивному этапу.'));
        outBlocks.push({
            id: 'task_auto',
            type: 'cognitive_task',
            blockConfig: { fixation: { duration: 500 }, stimulusDuration: 1000, showFeedback: false },
            trials: buildDefaultTrials('auto')
        });
    }

    const hasTask = outBlocks.some((b) => b.type === 'cognitive_task');
    if (!hasTask && !isInvitationProtocol) {
        outBlocks.push({
            id: 'task_fallback',
            type: 'cognitive_task',
            blockConfig: { fixation: { duration: 500 }, stimulusDuration: 1000, showFeedback: false },
            trials: buildDefaultTrials('fallback')
        });
    }

    return {
        title: definition?.meta?.name || 'Invitation protocol',
        version: 'invite-runtime-v1',
        blocks: outBlocks
    };
}

function getVideoTime(videoElement) {
    if (!videoElement || videoElement.readyState < 2) return -1;
    const t = videoElement.currentTime;
    return Number.isFinite(t) ? t : -1;
}

function getTaskPayload(extra = {}) {
    const ctx = state.runtime.taskContext || {};
    return {
        phase: state.runtime.currentPhase || null,
        blockId: ctx.blockId ?? null,
        trialId: ctx.trialId ?? null,
        stimulusId: ctx.stimulusId ?? null,
        stimulusType: ctx.stimulusType ?? null,
        stimulusVersion: ctx.stimulusVersion ?? null,
        expectedResponse: ctx.expectedResponse ?? null,
        ...extra
    };
}

function emitTaskEvent(type, payload = {}) {
    return recordSessionEvent(type, getTaskPayload(payload));
}

function handleQcPauseState(overlayVisible) {
    const runtime = getSessionRuntime();
    if (!runtime) return;
    if (overlayVisible) {
        runtime.reportIssue({
            kind: 'quality',
            code: 'qc_degraded',
            message: 'Качество видеосигнала длительно ниже допустимого уровня.',
            recoverable: true
        });
    } else {
        runtime.resolveIssue('qc_degraded');
    }
}

function resetStimulusViews() {
    if (ex_state.task?.stimulus) {
        ex_state.task.stimulus.style.display = 'none';
    }

    const imageEl = document.getElementById('cogImage');
    if (imageEl) {
        imageEl.style.display = 'none';
        imageEl.onload = null;
        imageEl.onerror = null;
        delete imageEl.dataset.fallbackSrc;
        delete imageEl.dataset.fallbackAttempted;
        imageEl.removeAttribute('src');
    }
    const videoEl = document.getElementById('cogVideo');
    if (videoEl) {
        videoEl.pause();
        videoEl.style.display = 'none';
        videoEl.onloadeddata = null;
        videoEl.oncanplay = null;
        videoEl.onerror = null;
        delete videoEl.dataset.fallbackSrc;
        delete videoEl.dataset.fallbackAttempted;
        videoEl.removeAttribute('src');
        videoEl.load();
    }
}

function setStimulusLayout(block, active) {
    const fullscreen = active && block?.blockConfig?.fullscreenStimulus === true;
    document.body.classList.toggle('cognitive-stimulus-fullscreen', fullscreen);
}

function renderStimulusMediaError(stimulus) {
    const imageEl = document.getElementById('cogImage');
    if (imageEl) imageEl.style.display = 'none';
    const videoEl = document.getElementById('cogVideo');
    if (videoEl) videoEl.style.display = 'none';
    const shapeEl = ex_state.task?.stimulus;
    if (!shapeEl) return;
    shapeEl.style.cssText = '';
    shapeEl.textContent = state.currentLang === 'ru'
        ? 'Медиафайл стимула не загрузился'
        : 'The stimulus media could not be loaded';
    Object.assign(shapeEl.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        maxWidth: 'min(90vw, 680px)',
        padding: '24px',
        borderRadius: '14px',
        background: '#fff',
        color: '#991b1b',
        fontSize: 'clamp(18px, 2.4vw, 30px)',
        fontWeight: '700',
        textAlign: 'center',
    });
    recordSessionEvent('stimulus_media_load_failed', {
        category: 'technical',
        stimulusId: stimulus?.stimulusId || null,
    });
}

function renderStimulus(trial) {
    resetStimulusViews();

    const stimulus = trial?.stimulus || {};
    const stimulusType = stimulus.type || 'shape';
    const shapeEl = ex_state.task?.stimulus;
    const imageEl = document.getElementById('cogImage');
    const videoEl = document.getElementById('cogVideo');

    if (stimulusType === 'video' && videoEl) {
        if (!stimulus.src) {
            renderStimulusMediaError(stimulus);
            return Promise.resolve(false);
        }
        return new Promise(resolve => {
            let settled = false;
            let readyInProgress = false;
            const settle = value => {
                if (settled) return;
                settled = true;
                clearTimeout(loadTimeout);
                resolve(value);
            };
            const fail = () => {
                if (!videoEl.dataset.fallbackAttempted && videoEl.dataset.fallbackSrc) {
                    videoEl.dataset.fallbackAttempted = '1';
                    videoEl.src = videoEl.dataset.fallbackSrc;
                    videoEl.load();
                    return;
                }
                renderStimulusMediaError(stimulus);
                settle(false);
            };
            const ready = () => {
                if (settled || readyInProgress) return;
                readyInProgress = true;
                videoEl.currentTime = 0;
                videoEl.play().then(() => {
                    videoEl.style.display = 'block';
                    settle(true);
                }).catch(() => {
                    readyInProgress = false;
                    fail();
                });
            };
            const loadTimeout = setTimeout(fail, 15_000);
            videoEl.style.cssText = '';
            videoEl.muted = stimulus.muted !== false;
            if (stimulus.style && typeof stimulus.style === 'object') Object.assign(videoEl.style, stimulus.style);
            const fallbackSrc = String(stimulus.fallbackSrc || '').trim();
            if (fallbackSrc) videoEl.dataset.fallbackSrc = fallbackSrc;
            videoEl.onloadeddata = ready;
            videoEl.oncanplay = ready;
            videoEl.onerror = fail;
            videoEl.src = stimulus.src;
            videoEl.load();
            if (videoEl.readyState >= 2) ready();
        });
    }

    if ((stimulusType === 'image' || stimulusType === 'slides') && imageEl) {
        if (!stimulus.src) {
            renderStimulusMediaError(stimulus);
            return Promise.resolve(false);
        }
        return new Promise(resolve => {
            let settled = false;
            const settle = value => {
                if (settled) return;
                settled = true;
                clearTimeout(loadTimeout);
                resolve(value);
            };
            const fail = () => {
                if (!imageEl.dataset.fallbackAttempted && imageEl.dataset.fallbackSrc) {
                    imageEl.dataset.fallbackAttempted = '1';
                    imageEl.src = imageEl.dataset.fallbackSrc;
                    return;
                }
                renderStimulusMediaError(stimulus);
                settle(false);
            };
            const loadTimeout = setTimeout(fail, 10_000);

            imageEl.style.cssText = '';
            if (stimulus.style && typeof stimulus.style === 'object') {
                Object.assign(imageEl.style, stimulus.style);
            }
            const fallbackSrc = String(stimulus.fallbackSrc || '').trim();
            if (fallbackSrc) imageEl.dataset.fallbackSrc = fallbackSrc;
            imageEl.onload = () => {
                if (!(imageEl.naturalWidth > 0 && imageEl.naturalHeight > 0)) {
                    fail();
                    return;
                }
                imageEl.style.display = 'block';
                settle(true);
            };
            imageEl.onerror = fail;
            imageEl.src = stimulus.src;
            if (imageEl.complete && imageEl.naturalWidth > 0) {
                imageEl.style.display = 'block';
                settle(true);
            }
        });
    }

    if (shapeEl) {
        shapeEl.style.cssText = '';
        shapeEl.textContent = '';
        if (stimulusType === 'text') {
            shapeEl.textContent = stimulus.text || '';
            if (stimulus.style && typeof stimulus.style === 'object') {
                Object.assign(shapeEl.style, stimulus.style);
            }
            shapeEl.style.display = 'block';
            return Promise.resolve(true);
        }
        if (stimulus.style && typeof stimulus.style === 'object') {
            Object.assign(shapeEl.style, stimulus.style);
        }
        shapeEl.style.display = 'block';
    }
    return Promise.resolve(Boolean(shapeEl));
}

function stopCognitiveAnalysisLoop() {
    state.runtime._cognitiveLoopActive = false;
    if (state.runtime.cognitiveAnalysisInterval) {
        clearTimeout(state.runtime.cognitiveAnalysisInterval);
        state.runtime.cognitiveAnalysisInterval = null;
    }
    cognitiveVideo = null;
}

function scheduleCognitiveAnalysisTick(delayMs = 0) {
    if (!state.runtime._cognitiveLoopActive) return;
    state.runtime.cognitiveAnalysisInterval = setTimeout(runCognitiveAnalysisTick, delayMs);
}

async function runCognitiveAnalysisTick() {
    if (!state.runtime._cognitiveLoopActive) return;
    if (!cognitiveVideo || !state.runtime.localAnalyzer) {
        scheduleCognitiveAnalysisTick(100);
        return;
    }

    const tickStart = performance.now();

    try {
        const videoTime = getVideoTime(cognitiveVideo);
        if (videoTime < 0 || videoTime === cognitiveLoopLastVideoTime) {
            scheduleCognitiveAnalysisTick(SAME_FRAME_RETRY_MS);
            return;
        }
        cognitiveLoopLastVideoTime = videoTime;

        const precheckResult = await state.runtime.localAnalyzer.analyzeFrame(cognitiveVideo);
        state.runtime.lastPrecheckResult = precheckResult;

        if (precheckResult && precheckResult.pose) {
            state.runtime.lastPoseData = {
                yaw: precheckResult.pose.yaw ?? null,
                pitch: precheckResult.pose.pitch ?? null,
                roll: precheckResult.pose.roll ?? null
            };
        } else {
            state.runtime.lastPoseData = null;
        }

        if (
            state.runtime.gazeTracker &&
            state.runtime.gazeTracker.isCalibrated() &&
            precheckResult &&
            precheckResult.landmarks
        ) {
            const gaze = state.runtime.gazeTracker.predict(precheckResult.landmarks);
            if (gaze && window.handleGazeUpdate) {
                window.handleGazeUpdate(gaze);
            }
        }

        const eyeSignal = extractEyeSignalSample(precheckResult, Date.now());
        if (eyeSignal && window.handleEyeSignalUpdate) {
            window.handleEyeSignalUpdate(eyeSignal);
        }

        cognitiveSegmenterThrottleCounter++;
        if (cognitiveSegmenterThrottleCounter >= 3) {
            cognitiveSegmenterThrottleCounter = 0;
            if (!cognitiveSegmenterInFlight && state.runtime.faceSegmenter && precheckResult && precheckResult.landmarks) {
                cognitiveSegmenterInFlight = true;
                state.runtime.faceSegmenter.segmentFrame(cognitiveVideo, precheckResult.landmarks)
                    .then((segmenterResult) => {
                        cognitiveLastSegmenterResult = segmenterResult;
                    })
                    .catch((segmenterError) => {
                        console.warn('[Cognitive] Ошибка сегментации:', segmenterError);
                    })
                    .finally(() => {
                        cognitiveSegmenterInFlight = false;
                    });
            }
        }

        if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
            state.runtime.qcMetrics.processFrame(precheckResult, cognitiveLastSegmenterResult);
            // Фаза 1.2: overlay при низком QC / потере лица
            const metrics = state.runtime.qcMetrics.getCurrentMetrics();
            qcOverlayUpdateFromMetrics(metrics, precheckResult);
            handleQcPauseState(isQcOverlayVisible());
        }
        // Фаза 1.3: сэмплы эмоций (заглушка valence/arousal)
        const emotionSample = getEmotionSample(precheckResult);
        appendEmotionSample(state, emotionSample, Date.now(), getRelativeSessionTimeMs());
        const cogEmoHud = document.getElementById('cognitiveEmotionHud');
        if (cogEmoHud && emotionSample) {
            const lang = state.currentLang || 'ru';
            const ek = 'emotion_' + String(emotionSample.dominant || 'neutral');
            const name = translations[lang]?.[ek] || emotionSample.dominant || 'neutral';
            const lab = translations[lang]?.hub_emotion_label || 'Emotion';
            const v = Number.isFinite(emotionSample.valence) ? emotionSample.valence.toFixed(2) : '?';
            const a = Number.isFinite(emotionSample.arousal) ? emotionSample.arousal.toFixed(2) : '?';
            cogEmoHud.textContent = `${lab}: ${name} (v ${v}, a ${a})`;
        }
    } catch (e) {
        console.warn('[Cognitive] Ошибка анализа:', e);
    }

    const elapsed = performance.now() - tickStart;
    const nextDelay = Math.max(0, TARGET_LOOP_INTERVAL_MS - elapsed);
    scheduleCognitiveAnalysisTick(nextDelay);
}

function startCognitiveAnalysisLoop() {
    if (isContinuousSessionAnalysisRunning()) {
        console.log('[Cognitive] Используется непрерывный session analysis loop');
        return;
    }
    if (state.runtime._cognitiveLoopActive) return;

    cognitiveVideo = document.getElementById('precheckVideo');
    if (!(cognitiveVideo && cognitiveVideo.srcObject && state.runtime.localAnalyzer)) {
        console.warn('[Cognitive] analysis loop не запущен: нет video/localAnalyzer');
        return;
    }

    cognitiveLoopLastVideoTime = -1;
    cognitiveSegmenterThrottleCounter = 0;
    cognitiveSegmenterInFlight = false;
    cognitiveLastSegmenterResult = null;

    state.runtime._cognitiveLoopActive = true;
    scheduleCognitiveAnalysisTick(0);
    console.log('[Cognitive] Single-flight цикл анализа запущен (gaze + eye-signal + QC)');
}

function emitStimulusOffIfNeeded(rtMs, reason) {
    if (!activeTrialRuntime || activeTrialRuntime.stimulusOff) return;
    activeTrialRuntime.stimulusOff = true;
    emitTaskEvent('stimulus_off', {
        reason,
        rtMs: Number.isFinite(rtMs) ? Math.round(rtMs) : null
    });
}

function finishCognitiveTask(reason = 'completed', errorMessage = null) {
    if (cognitiveFinished) return;
    cognitiveFinished = true;
    pendingPhotodiodeTaskStart = null;
    if (reason === 'completed') void window.Photodiode?.finish();
    else window.Photodiode?.stop();
    if (timedProtocolBlockInterval) {
        clearInterval(timedProtocolBlockInterval);
        timedProtocolBlockInterval = null;
    }

    cleanupTrial();
    resetStimulusViews();
    setStimulusLayout(null, false);

    if (ex_state.task?.fixation) ex_state.task.fixation.style.display = 'none';
    if (ex_state.task?.feedback) ex_state.task.feedback.style.display = 'none';

    stopCognitiveAnalysisLoop();
    hideQcOverlay();
    const cogEmoClear = document.getElementById('cognitiveEmotionHud');
    if (cogEmoClear) cogEmoClear.textContent = '';

    const finishedAt = Date.now();
    const experimentMeta = state.sessionData.experimentMeta || {};
    if (Array.isArray(experimentMeta.protocolTimers)) {
        experimentMeta.protocolTimers = experimentMeta.protocolTimers.map(timer => {
            if (timer.finishedAt) return timer;
            const startedAt = Number(timer.startedAt) || Number(state.sessionData.startTime) || finishedAt;
            return {
                ...timer,
                finishedAt,
                durationMs: Math.max(0, finishedAt - startedAt)
            };
        });
        recordSessionEvent('protocol_timers_complete', {
            timers: experimentMeta.protocolTimers.map(timer => ({
                id: timer.id,
                name: timer.name,
                durationMs: timer.durationMs
            }))
        });
    }

    if (reason === 'error') {
        recordSessionEvent('cognitive_task_error', {
            reason,
            message: errorMessage || null
        });
    } else {
        recordSessionEvent('cognitive_task_complete', {
            blocksProcessed: currentBlockIndex,
            trialResults: state.sessionData.cognitiveResults.length
        });
    }

    clearTaskContext();
    const payload = {
        reason,
        errorMessage: errorMessage || null,
        trialResults: state.sessionData.cognitiveResults.length,
        blocksProcessed: currentBlockIndex
    };

    if (cognitiveTaskOptions.autoFinishSession !== false) {
        setSessionPhase('final', { source: 'finishCognitiveTask' });
        console.log('[Cognitive] Задача завершена');
        finishSession();
        void exitCognitiveFullscreen();
        cognitiveTaskOptions = { autoFinishSession: true, onComplete: null };
    } else {
        setSessionPhase('cognitive_instruction', { source: 'finishCognitiveTask_return' });
        console.log('[Cognitive] Задача завершена, возврат в Test Hub');
        if (typeof cognitiveTaskOptions.onComplete === 'function') {
            cognitiveTaskOptions.onComplete(payload);
        }
        void exitCognitiveFullscreen();
        cognitiveTaskOptions = { autoFinishSession: true, onComplete: null };
    }
}

export async function loadAndStartCognitiveTask(options = {}) {
    console.log('[Cognitive] Инициализация задачи...');
    const requestedProtocol = options.protocol && typeof options.protocol === 'object'
        ? options.protocol
        : null;
    cognitiveTaskOptions = {
        autoFinishSession: options.autoFinishSession !== false,
        onComplete: typeof options.onComplete === 'function' ? options.onComplete : null
    };

    cognitiveFinished = false;
    pendingPhotodiodeTaskStart = null;
    acknowledgedTaskBlockIndex = null;
    clearTaskContext();

    try {
        const runtime = getSessionRuntime();
        if (requestedProtocol || state.runtime?.invitationProtocolDefinition) {
            const normalized = normalizeProtocolDefinition(
                definitionForCognitiveRunner(
                    requestedProtocol || state.runtime.invitationProtocolDefinition
                ),
                { invitation: true }
            );
            experimentProtocol = runtime?.policyShown
                ? normalized
                : ensureSessionQualityInstruction(normalized);
        } else {
            const response = await fetch('./experiment.json');
            if (!response.ok) throw new Error('Файл experiment.json не найден');
            const normalized = await response.json();
            experimentProtocol = runtime?.policyShown
                ? normalized
                : ensureSessionQualityInstruction(normalized);
        }
        const protocolBlocks = Array.isArray(experimentProtocol?.blocks)
            ? experimentProtocol.blocks
            : [];
        if (requestedProtocol && protocolBlocks.length === 0) {
            throw new Error('Invitation protocol contains no executable blocks');
        }
        const pendingRepeat = runtime?.machine?.snapshot?.().repeatQueue?.find(repeat =>
            protocolBlocks.some(block => String(block?.id || '') === String(repeat?.blockId || ''))
        ) || null;
        const repeatBlockIndex = pendingRepeat
            ? protocolBlocks.findIndex(block =>
                String(block?.id || '') === String(pendingRepeat.blockId)
            )
            : -1;
        if (!pendingRepeat) state.sessionData.cognitiveResults = [];
        state.sessionData.experimentMeta = {
            ...(state.sessionData.experimentMeta || {}),
            title: experimentProtocol?.title || null,
            version: experimentProtocol?.version || null,
            loadedAt: Date.now(),
            blockCount: Array.isArray(experimentProtocol?.blocks) ? experimentProtocol.blocks.length : 0,
            protocolTimers: Array.isArray(state.sessionData.experimentMeta?.protocolTimers)
                ? state.sessionData.experimentMeta.protocolTimers
                : []
        };

        currentBlockIndex = repeatBlockIndex >= 0 ? repeatBlockIndex : 0;
        currentTrialIndex = 0;
        activeTrialRuntime = null;

        state.flags.isRecording = true;
        setSessionPhase('cognitive_instruction', { source: 'loadAndStartCognitiveTask' });
        recordSessionEvent('cognitive_task_start', {
            protocolTitle: state.sessionData.experimentMeta.title,
            protocolVersion: state.sessionData.experimentMeta.version,
            blockCount: state.sessionData.experimentMeta.blockCount
        });
        if (pendingRepeat) {
            await runtime.promptRepeat(pendingRepeat.blockId);
            recordSessionEvent('cognitive_task_resume_after_reload', {
                blockId: pendingRepeat.blockId,
                failedAttempt: pendingRepeat.failedAttempt,
                blockIndex: currentBlockIndex
            });
        }

        document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
        document.getElementById('step6').classList.add('active');

        startCognitiveAnalysisLoop();
        runNextBlock();
    } catch (e) {
        console.error('[Cognitive] Ошибка загрузки:', e);
        const runtime = getSessionRuntime();
        recordSessionEvent('protocol_runtime_start_failed', {
            category: 'technical',
            severity: 'error',
            message: String(e?.message || e)
        });
        runtime?.reportIssue?.({
            kind: 'technical',
            code: 'protocol_runtime_start_failed',
            message: (translations[state.currentLang] || translations.en).runtime_protocol_start_failure_body,
            recoverable: true,
            invalidatesBlock: false
        });
        document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
        document.getElementById('step6')?.classList.add('active');
        ex_state.task.area.style.display = 'none';
        ex_state.instruction.container.style.display = 'block';
        const t = translations[state.currentLang] || translations.en;
        ex_state.instruction.title.textContent = t.runtime_protocol_start_failure_title;
        ex_state.instruction.text.textContent = t.runtime_protocol_start_failure_body;
        ex_state.instruction.btn.disabled = false;
        ex_state.instruction.btn.textContent = t.runtime_protocol_retry_action;
        ex_state.instruction.btn.onclick = event => {
            event.preventDefault();
            runtime?.resolveIssue?.('protocol_runtime_start_failed');
            loadAndStartCognitiveTask(options);
        };
    }
}

function runNextBlock() {
    if (!experimentProtocol || !Array.isArray(experimentProtocol.blocks)) {
        finishCognitiveTask('error', 'Некорректный формат experiment.json');
        return;
    }

    if (!experimentProtocol.blocks.length) {
        finishCognitiveTask('empty_protocol', 'No experiment blocks in invitation protocol');
        return;
    }

    if (currentBlockIndex >= experimentProtocol.blocks.length) {
        finishCognitiveTask();
        return;
    }

    const block = experimentProtocol.blocks[currentBlockIndex];
    console.log('[Cognitive] Переход к блоку:', block.id, 'Тип:', block.type);
    getSessionRuntime()?.enterInstruction({
        source: 'cognitive_block_instruction',
        blockId: block?.id || null,
        blockType: block?.type || 'unknown'
    });

    setTaskContext({
        blockId: block?.id ?? null,
        attempt: null,
        trialId: null,
        presentationId: null,
        stimulusId: null,
        stimulusType: null,
        expectedResponse: null
    });

    emitTaskEvent('block_start', {
        blockIndex: currentBlockIndex,
        blockType: block?.type || 'unknown'
    });

    if (block.type === 'timer') {
        const experimentMeta = state.sessionData.experimentMeta || (state.sessionData.experimentMeta = {});
        const timers = Array.isArray(experimentMeta.protocolTimers)
            ? experimentMeta.protocolTimers
            : (experimentMeta.protocolTimers = []);
        const timerId = String(block.id || `timer_${currentBlockIndex}`);
        if (!timers.some(timer => String(timer.id) === timerId)) {
            const startedAt = Number(state.sessionData.startTime) || Date.now();
            timers.push({
                id: timerId,
                name: block.content?.name || block.content?.measurementName || timerId,
                startedAt,
                startsAt: block.content?.startsAt || 'session_start',
                hidden: true
            });
            recordSessionEvent('protocol_timer_started', { id: timerId, startedAt });
        }
        emitTaskEvent('block_end', {
            blockIndex: currentBlockIndex,
            blockType: 'timer',
            reason: 'hidden_timer_registered'
        });
        currentBlockIndex++;
        runNextBlock();
        return;
    }
    if (window.Photodiode?.isEnabled()) {
        if (window.Photodiode.isActive()) void window.Photodiode.signal('task');
        else void window.Photodiode.begin();
        state.sessionData.experimentMeta.photodiode = {
            version: window.Photodiode.version, temporary: true, enabled: true,
            timingValidated: false, pulseMs: 100, gapMs: 100
        };
    }

    if (block.type === 'rest') {
        setSessionPhase('rest', { source: 'rest_block' });
        showTimedParticipantBlock(block, 'rest');
        return;
    }

    if (block.type === 'audio_test') {
        setSessionPhase('audio_test', { source: 'audio_test_block' });
        showTimedParticipantBlock(block, 'audio_test');
        return;
    }

    if (block.type === 'instruction' || block.type === 'instructions') {
        setSessionPhase('cognitive_instruction', { source: 'instruction_block' });
        showInstructions(block);
        return;
    }

    if (block.type === 'cognitive_task') {
        setSessionPhase('cognitive_instruction', { source: 'task_block' });
        if (acknowledgedTaskBlockIndex === currentBlockIndex) {
            acknowledgedTaskBlockIndex = null;
            startTaskBlock(block);
        } else {
            showTaskBlockInstruction(block);
        }
        return;
    }

    if (block.type === 'survey') {
        setSessionPhase('cognitive_instruction', { source: 'survey_block' });
        showSurvey(block);
        return;
    }

    emitTaskEvent('block_skip', {
        blockIndex: currentBlockIndex,
        blockType: block?.type || 'unknown'
    });
    currentBlockIndex++;
    runNextBlock();
}

function protocolBlockDurationMs(content, fallbackSeconds) {
    const explicitMs = Number(content?.durationMs);
    if (Number.isFinite(explicitMs) && explicitMs > 0) {
        return Math.max(1000, Math.min(60 * 60 * 1000, explicitMs));
    }
    const numeric = Number(content?.duration);
    const duration = Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackSeconds;
    const milliseconds = content?.durationUnit === 'seconds'
        ? duration * 1000
        : (duration >= 1000 ? duration : duration * 1000);
    return Math.max(1000, Math.min(60 * 60 * 1000, milliseconds));
}

function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function showTimedParticipantBlock(block, kind) {
    if (timedProtocolBlockInterval) clearInterval(timedProtocolBlockInterval);
    ex_state.task.area.style.display = 'none';
    ex_state.instruction.container.style.display = 'block';
    ex_state.instruction.text.classList.remove('survey-runtime');
    ex_state.instruction.text.style.textAlign = 'center';
    ex_state.instruction.text.style.whiteSpace = 'pre-wrap';

    const t = translations[state.currentLang] || translations.en;
    const isAudio = kind === 'audio_test';
    const durationMs = protocolBlockDurationMs(block.content, isAudio ? 12 : 30);
    const startedAt = Date.now();
    const deadline = startedAt + durationMs;
    const runtime = getSessionRuntime();
    if (isAudio && runtime?.audioCollector?.started !== true) runtime?.startAudioModule?.();
    const collector = runtime?.audioCollector;
    const audioWindowStartPromise = isAudio
        ? Promise.resolve(collector?.flushBoundary?.())
            .catch(() => null)
            .then(() => Array.isArray(collector?.windows) ? collector.windows.length : 0)
        : Promise.resolve(0);
    const title = isAudio
        ? (block.content?.taskName || block.label || t.runtime_audio_test_title || translations.en.runtime_audio_test_title)
        : (block.label || t.runtime_rest_title || translations.en.runtime_rest_title);
    const prompt = isAudio
        ? (block.content?.prompt || t.runtime_audio_test_prompt || translations.en.runtime_audio_test_prompt)
        : (block.content?.text || t.runtime_rest_body || translations.en.runtime_rest_body);

    ex_state.instruction.title.textContent = title;
    ex_state.instruction.text.innerHTML = '';
    const promptElement = document.createElement('div');
    promptElement.textContent = prompt;
    promptElement.style.cssText = 'font-size:clamp(18px,2.3vw,28px);line-height:1.55;max-width:760px;margin:0 auto;';
    const countdownElement = document.createElement('div');
    countdownElement.setAttribute('role', 'timer');
    countdownElement.setAttribute('aria-live', 'polite');
    countdownElement.style.cssText = 'font-size:clamp(46px,8vw,84px);font-weight:800;letter-spacing:.04em;margin-top:28px;color:var(--accent,#5c66bd);font-variant-numeric:tabular-nums;';
    ex_state.instruction.text.append(promptElement, countdownElement);

    const checkContainer = document.getElementById('cogCheckContainer');
    if (checkContainer) checkContainer.style.display = 'none';
    ex_state.instruction.btn.style.display = 'none';

    emitTaskEvent(isAudio ? 'audio_test_start' : 'rest_start', {
        blockIndex: currentBlockIndex,
        durationMs,
        testType: isAudio ? (block.content?.testType || 'reading') : null,
        audioAvailable: isAudio ? collector?.started === true : null
    });

    let completing = false;
    const complete = async () => {
        if (completing) return;
        completing = true;
        if (timedProtocolBlockInterval) clearInterval(timedProtocolBlockInterval);
        timedProtocolBlockInterval = null;
        ex_state.instruction.btn.style.display = '';
        if (isAudio) {
            const audioWindowStart = await audioWindowStartPromise;
            try { await collector?.flushBoundary?.(); } catch (_) { /* The session continues without audio. */ }
            const windows = Array.isArray(collector?.windows) ? collector.windows.slice(audioWindowStart) : [];
            const scopedWindows = windows.filter(window => !window?.blockId || String(window.blockId) === String(block.id));
            const experimentMeta = state.sessionData.experimentMeta || (state.sessionData.experimentMeta = {});
            const tests = Array.isArray(experimentMeta.audioTests)
                ? experimentMeta.audioTests
                : (experimentMeta.audioTests = []);
            const taskResult = collector?.summarizeTaskWindows?.(
                scopedWindows,
                block.content?.testType || 'reading',
                {
                    blockId: String(block.id || `audio_test_${currentBlockIndex}`),
                    title,
                    durationMs: Date.now() - startedAt,
                    audioAvailable: collector?.started === true,
                    completedAt: Date.now()
                }
            ) || {
                schemaVersion: 'audio_task.v1',
                blockId: String(block.id || `audio_test_${currentBlockIndex}`),
                title,
                testType: block.content?.testType || 'reading',
                status: 'audio_unavailable',
                durationMs: Date.now() - startedAt,
                audioAvailable: false,
                windowCount: 0,
                acceptedWindowCount: 0,
                rejectedWindowCount: 0,
                completedAt: Date.now(),
                metrics: {},
                rawAudioStored: false,
                rawAudioTransmitted: false
            };
            tests.push(taskResult);
            emitTaskEvent('audio_test_scored', {
                blockIndex: currentBlockIndex,
                testType: taskResult.testType,
                status: taskResult.status,
                completionScore: taskResult.metrics?.completionScore ?? null
            });
        }
        emitTaskEvent(isAudio ? 'audio_test_complete' : 'rest_complete', {
            blockIndex: currentBlockIndex,
            elapsedMs: Date.now() - startedAt
        });
        emitTaskEvent('block_end', {
            blockIndex: currentBlockIndex,
            blockType: block.type,
            reason: 'timer_complete'
        });
        currentBlockIndex++;
        runNextBlock();
    };

    const update = () => {
        const remaining = deadline - Date.now();
        countdownElement.textContent = formatCountdown(remaining);
        if (remaining <= 0) complete();
    };
    update();
    if (deadline > Date.now()) timedProtocolBlockInterval = setInterval(update, 250);
}

function showInstructions(block) {
    ex_state.task.area.style.display = 'none';
    ex_state.instruction.container.style.display = 'block';

    const t = translations[state.currentLang] || translations.en;
    const followingBlocks = experimentProtocol?.blocks?.slice(currentBlockIndex + 1) || [];
    const nextBlock = followingBlocks.find(candidate => !['instruction', 'instructions', 'fixation'].includes(candidate.type));
    const standardTaskKey = standardInstructionTaskKey(block.content, nextBlock);
    ex_state.instruction.title.innerText = standardTaskKey
        ? standardInstructionTitle(block.content, nextBlock, standardTaskKey, t)
        : localizedProtocolValue(block.content, 'title', t.runtime_instruction_title);
    ex_state.instruction.text.classList.remove('survey-runtime');
    ex_state.instruction.text.style.textAlign = 'center';
    ex_state.instruction.text.style.whiteSpace = 'pre-wrap';
    const localizedText = localizedStandardInstruction(block.content, nextBlock)
        || localizedProtocolValue(block.content, 'text', t.runtime_standard_instruction_body)
            .replaceAll('{response}', responsePhraseForBlock(nextBlock));
    const customGuidance = !standardTaskKey ? responseGuidanceForBlock(nextBlock) : '';
    ex_state.instruction.text.innerText = customGuidance
        ? `${localizedText}\n\n${customGuidance}`
        : localizedText;
    ex_state.instruction.btn.innerText = localizedProtocolValue(
        block.content,
        'buttonText',
        t.runtime_continue
    );

    const checkbox = document.getElementById('cogCheck');
    const checkContainer = document.getElementById('cogCheckContainer');
    const btn = ex_state.instruction.btn;

    if (checkbox) {
        checkbox.checked = false;
        checkbox.onchange = null;
    }
    if (checkContainer) checkContainer.style.display = 'none';
    btn.disabled = false;

    btn.onclick = (e) => {
        e.preventDefault();
        if (block?.id === 'session_quality_policy') {
            const runtime = getSessionRuntime();
            if (runtime) runtime.policyShown = true;
            recordSessionEvent('quality_policy_acknowledged', {
                source: 'cognitive_instruction'
            });
        }
        emitTaskEvent('block_end', {
            blockIndex: currentBlockIndex,
            blockType: block?.type || 'instruction',
            reason: 'button_click'
        });
        if (
            block?.id !== 'session_quality_policy'
            && nextBlock?.type === 'cognitive_task'
        ) {
            acknowledgedTaskBlockIndex = currentBlockIndex + 1;
        }
        currentBlockIndex++;
        runNextBlock();
    };
}

function showSurvey(block) {
    ex_state.task.area.style.display = 'none';
    ex_state.instruction.container.style.display = 'block';

    const contract = globalThis.WecogSurveyContract;
    const result = contract?.validateSurveyContent
        ? contract.validateSurveyContent(block?.content || {})
        : { ok: false, errors: [{ code: 'survey_contract_missing' }], survey: null };
    const t = translations[state.currentLang] || translations.en;
    const localized = result.ok && contract?.localizeSurveyContent
        ? contract.localizeSurveyContent(block?.content || {}, state.currentLang)
        : { ok: result.ok, survey: result.survey, missing: [] };
    const textContainer = ex_state.instruction.text;
    const button = ex_state.instruction.btn;
    const checkContainer = document.getElementById('cogCheckContainer');
    const startedAt = performance.now();

    ex_state.instruction.title.textContent = localized.survey?.title || t.runtime_survey_title;
    textContainer.classList.add('survey-runtime');
    textContainer.style.textAlign = 'left';
    textContainer.style.whiteSpace = 'normal';
    textContainer.replaceChildren();
    if (checkContainer) checkContainer.style.display = 'none';
    button.disabled = false;

    if (!result.ok || !localized.ok) {
        const message = document.createElement('p');
        message.className = 'survey-runtime-error';
        message.textContent = result.ok
            ? t.runtime_survey_translation_missing
            : t.runtime_survey_configuration_error;
        textContainer.appendChild(message);
        recordSessionEvent('survey_configuration_error', {
            category: 'technical',
            severity: 'error',
            blockId: block?.id || null,
            codes: result.errors.map(error => error.code).slice(0, 20),
            missingTranslations: (localized.missing || []).slice(0, 50),
            locale: state.currentLang
        });
        button.textContent = t.runtime_continue;
        button.onclick = (event) => {
            event.preventDefault();
            emitTaskEvent('block_end', {
                blockIndex: currentBlockIndex,
                blockType: 'survey',
                reason: 'invalid_configuration_skipped'
            });
            currentBlockIndex++;
            runNextBlock();
        };
        return;
    }

    const survey = localized.survey;
    if (survey.description) {
        const description = document.createElement('p');
        description.className = 'survey-runtime-description';
        description.textContent = survey.description;
        textContainer.appendChild(description);
    }

    const form = document.createElement('form');
    form.className = 'survey-runtime-form';
    form.noValidate = true;
    const controls = new Map();

    survey.questions.forEach((question, questionIndex) => {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'survey-runtime-question';
        fieldset.dataset.questionId = question.id;

        const legend = document.createElement('legend');
        legend.textContent = `${questionIndex + 1}. ${question.text}`;
        if (question.required) {
            const required = document.createElement('span');
            required.className = 'survey-required-mark';
            required.textContent = ' *';
            required.setAttribute('aria-label', t.runtime_survey_required_label);
            legend.appendChild(required);
        }
        fieldset.appendChild(legend);

        const questionControls = [];
        if (question.type === 'open') {
            const textarea = document.createElement('textarea');
            textarea.className = 'survey-runtime-open';
            textarea.rows = 4;
            textarea.maxLength = contract.LIMITS.maxOpenAnswerLength;
            textarea.placeholder = t.runtime_survey_open_placeholder;
            textarea.setAttribute('aria-required', question.required ? 'true' : 'false');
            fieldset.appendChild(textarea);
            questionControls.push(textarea);
        } else {
            question.options.forEach((option) => {
                const label = document.createElement('label');
                label.className = 'survey-runtime-option';
                const input = document.createElement('input');
                input.type = question.type === 'single' ? 'radio' : 'checkbox';
                input.name = `survey_${block.id}_${question.id}`;
                input.value = option.id;
                input.setAttribute('aria-required', question.required ? 'true' : 'false');
                const optionText = document.createElement('span');
                optionText.textContent = option.label;
                label.append(input, optionText);
                fieldset.appendChild(label);
                questionControls.push(input);
            });
        }

        const error = document.createElement('div');
        error.className = 'survey-question-error';
        error.setAttribute('aria-live', 'polite');
        fieldset.appendChild(error);
        controls.set(question.id, { question, fieldset, controls: questionControls, error });
        form.appendChild(fieldset);
    });

    const privacyNote = document.createElement('p');
    privacyNote.className = 'survey-runtime-privacy';
    privacyNote.textContent = t.runtime_survey_privacy;
    form.appendChild(privacyNote);
    textContainer.appendChild(form);

    button.textContent = survey.submitButtonText || t.runtime_continue;
    button.onclick = (event) => {
        event.preventDefault();
        const responses = [];
        let firstInvalid = null;

        controls.forEach(({ question, fieldset, controls: inputs, error }) => {
            error.textContent = '';
            fieldset.classList.remove('survey-question-invalid');
            let value;
            if (question.type === 'open') {
                value = String(inputs[0]?.value || '').trim();
            } else if (question.type === 'single') {
                value = inputs.find(input => input.checked)?.value || null;
            } else {
                value = inputs.filter(input => input.checked).map(input => input.value);
            }

            const missing = question.required && (
                value == null
                || value === ''
                || (Array.isArray(value) && value.length === 0)
            );
            const pii = question.type === 'open'
                && value
                && contract.containsForbiddenPiiValue(value);
            if (missing || pii) {
                fieldset.classList.add('survey-question-invalid');
                error.textContent = pii
                    ? t.runtime_survey_pii_error
                    : t.runtime_survey_required_error;
                firstInvalid ||= inputs[0] || fieldset;
                return;
            }
            responses.push({
                questionId: question.id,
                responseType: question.type,
                value: value == null ? null : value
            });
        });

        if (firstInvalid) {
            firstInvalid.focus?.();
            return;
        }

        recordSessionEvent('survey_response', {
            category: 'block',
            blockId: block?.id || null,
            responseVersion: contract.RESPONSE_VERSION,
            responseCount: responses.length,
            durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
            responses
        });
        emitTaskEvent('block_end', {
            blockIndex: currentBlockIndex,
            blockType: 'survey',
            reason: 'submitted'
        });
        currentBlockIndex++;
        runNextBlock();
    };
}

function captureSurveyDraft() {
    const draft = new Map();
    ex_state.instruction.text?.querySelectorAll?.('.survey-runtime-question').forEach(fieldset => {
        const questionId = fieldset.dataset.questionId;
        if (!questionId) return;
        const inputs = [...fieldset.querySelectorAll('input, textarea')];
        draft.set(questionId, inputs.map(input => ({
            value: input.value,
            checked: input instanceof HTMLInputElement ? input.checked : false
        })));
    });
    return draft;
}

function restoreSurveyDraft(draft) {
    if (!(draft instanceof Map)) return;
    ex_state.instruction.text?.querySelectorAll?.('.survey-runtime-question').forEach(fieldset => {
        const values = draft.get(fieldset.dataset.questionId);
        if (!values) return;
        [...fieldset.querySelectorAll('input, textarea')].forEach((input, index) => {
            const saved = values[index];
            if (!saved) return;
            input.value = saved.value;
            if (input instanceof HTMLInputElement) input.checked = saved.checked;
        });
    });
}

function refreshLocalizedInstructionScreen() {
    if (!experimentProtocol || !Array.isArray(experimentProtocol.blocks)) return;
    if (ex_state.task.area?.style.display !== 'none') return;
    if (ex_state.instruction.container?.style.display === 'none') return;
    const block = experimentProtocol.blocks[currentBlockIndex];
    if (!block) return;
    if (block.type === 'instruction' || block.type === 'instructions') {
        showInstructions(block);
        return;
    }
    if (block.type === 'cognitive_task') {
        showTaskBlockInstruction(block);
        return;
    }
    if (block.type === 'survey') {
        const draft = captureSurveyDraft();
        showSurvey(block);
        restoreSurveyDraft(draft);
    }
}

window.addEventListener('wecog:languagechange', refreshLocalizedInstructionScreen);

async function requestCognitiveFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const target = document.documentElement;
    const request = target.requestFullscreen || target.webkitRequestFullscreen;
    if (typeof request !== 'function') return;
    try {
        await request.call(target);
        cognitiveFullscreenOwned = true;
        recordSessionEvent('cognitive_fullscreen_entered', {});
    } catch (error) {
        recordSessionEvent('cognitive_fullscreen_unavailable', { message: error?.message || String(error) });
    }
}

async function exitCognitiveFullscreen() {
    if (!cognitiveFullscreenOwned) return;
    cognitiveFullscreenOwned = false;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (typeof exit !== 'function') return;
    try { await exit.call(document); } catch (_) { /* Browser may already have exited. */ }
}

function showTaskBlockInstruction(block) {
    ex_state.task.area.style.display = 'none';
    ex_state.instruction.container.style.display = 'block';
    const t = translations[state.currentLang] || translations.en;
    ex_state.instruction.title.innerText = localizedProtocolValue(block?.content, 'title')
        || localizedProtocolValue(block, 'title')
        || t.runtime_instruction_title;
    ex_state.instruction.text.classList.remove('survey-runtime');
    ex_state.instruction.text.style.textAlign = 'center';
    ex_state.instruction.text.style.whiteSpace = 'pre-wrap';
    const baseInstruction = localizedProtocolValue(block?.content, 'text')
        || localizedProtocolValue(block, 'instructions')
        || localizedProtocolValue(block?.blockConfig, 'instructions')
        || localizedStandardInstruction(null, block, false)
        || t.runtime_standard_instruction_body;
    const responseGuidance = responseGuidanceForBlock(block);
    ex_state.instruction.text.innerText = responseGuidance
        ? `${baseInstruction.replaceAll('{response}', responsePhraseForBlock(block))}\n\n${responseGuidance}`
        : baseInstruction;
    ex_state.instruction.btn.innerText = t.runtime_instruction_action;

    const checkbox = document.getElementById('cogCheck');
    const checkContainer = document.getElementById('cogCheckContainer');
    if (checkbox) checkbox.checked = false;
    if (checkContainer) checkContainer.style.display = 'none';
    ex_state.instruction.btn.disabled = false;
    ex_state.instruction.btn.onclick = async (event) => {
        event.preventDefault();
        recordSessionEvent('cognitive_block_instruction_acknowledged', {
            blockId: block?.id || null,
            blockType: block?.type || 'cognitive_task'
        });
        if (block?.blockConfig?.fullscreenStimulus) await requestCognitiveFullscreen();
        startTaskBlock(block);
    };
}

function buildTrialPlan(block) {
    const trials = Array.isArray(block?.trials) ? block.trials : [];
    const plan = trials.map((trial, sourceIndex) => ({
        trial,
        sourceIndex,
        trialId: String(trial?.id || `trial_${sourceIndex + 1}`)
    }));
    if (block?.blockConfig?.randomize === true) {
        for (let i = plan.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [plan[i], plan[j]] = [plan[j], plan[i]];
        }
    }
    return plan;
}

function trialQualityIssues(runtime, context) {
    const blockIssues = runtime?.getCurrentBlock()?.issues || [];
    const activeNow = runtime?.getActiveIssues?.() || [];
    return collectTrialQualityIssues({
        activeAtStart: context?.activeAtStart || [],
        blockIssues,
        issueStartIndex: context?.issueStartIndex || 0,
        activeNow
    });
}

async function startTaskBlock(block, trialPlan = null) {
    if (window.Photodiode?.isEnabled()) {
        if (pendingPhotodiodeTaskStart) return;
        const pending = {};
        pendingPhotodiodeTaskStart = pending;
        ex_state.instruction.btn.disabled = true;
        await window.Photodiode.signal('stage');
        if (pendingPhotodiodeTaskStart !== pending) return;
        pendingPhotodiodeTaskStart = null;
        if (cognitiveFinished || experimentProtocol.blocks[currentBlockIndex] !== block) return;
        ex_state.instruction.btn.disabled = false;
    }
    ex_state.instruction.container.style.display = 'none';
    ex_state.task.area.style.display = 'flex';
    currentTrialIndex = 0;
    activeBlockTrialPlan = Array.isArray(trialPlan) && trialPlan.length
        ? trialPlan
        : buildTrialPlan(block);
    const durationMs = Math.max(0, Number(block?.blockConfig?.protocolDurationMs) || 0);
    activeBlockDeadlinePerf = durationMs > 0 ? performance.now() + durationMs : null;
    setStimulusLayout(block, true);
    const sessionBlock = getSessionRuntime()?.beginBlock({
        blockId: block?.id || `cognitive_${currentBlockIndex}`,
        blockType: block?.type || 'cognitive_task'
    });
    currentBlockAttempt = sessionBlock?.attempt || 1;

    emitTaskEvent('task_block_ready', {
        blockIndex: currentBlockIndex,
        trialCount: activeBlockTrialPlan.length,
        totalTrialCount: Array.isArray(block?.trials) ? block.trials.length : 0,
        attempt: currentBlockAttempt
    });

    runTrial();
}

function runTrial() {
    const block = experimentProtocol.blocks[currentBlockIndex];
    const trials = activeBlockTrialPlan;

    if (activeBlockDeadlinePerf && performance.now() >= activeBlockDeadlinePerf) {
        currentTrialIndex = trials.length;
    } else if (currentTrialIndex >= trials.length && activeBlockDeadlinePerf && trials.length) {
        currentTrialIndex = 0;
    }

    if (currentTrialIndex >= trials.length) {
        emitTaskEvent('block_end', {
            blockIndex: currentBlockIndex,
            blockType: block?.type || 'cognitive_task',
            trialCount: trials.length,
            attempt: currentBlockAttempt
        });
        finishTaskBlockAttempt(block);
        return;
    }
    const planItem = trials[currentTrialIndex];
    const trial = planItem.trial;
    const config = block.blockConfig || {};
    const useFixation = config.useFixation !== false && !!config.fixation;
    const trialFixationMin = Math.max(0, Number(trial?.fixationMin) || 0);
    const trialFixationMax = Math.max(trialFixationMin, Number(trial?.fixationMax) || trialFixationMin);
    const hasTrialRandomFixation = useFixation && trialFixationMax > 0;
    const baseFixationDuration = useFixation
        ? (hasTrialRandomFixation
            ? Math.round(trialFixationMin + Math.random() * (trialFixationMax - trialFixationMin))
            : Math.max(0, Number(config.fixation?.duration) || 500))
        : 0;
    const blockRandomMin = Math.max(0, Number(config.interStimulusMinMs) || 0);
    const blockRandomMax = Math.max(blockRandomMin, Number(config.interStimulusMaxMs) || blockRandomMin);
    const trialRandomMin = Math.max(0, Number(trial?.randomItiMin) || 0);
    const trialRandomMax = Math.max(trialRandomMin, Number(trial?.randomItiMax) || trialRandomMin);
    const useBlockRandomInterval = config.randomInterStimulus === true;
    const useTrialRandomInterval = !useBlockRandomInterval && trialRandomMax > 0;
    const randomMin = useBlockRandomInterval ? blockRandomMin : trialRandomMin;
    const randomMax = useBlockRandomInterval ? blockRandomMax : trialRandomMax;
    const randomPreStimulusMs = useBlockRandomInterval || useTrialRandomInterval
        ? Math.round(randomMin + Math.random() * (randomMax - randomMin))
        : 0;
    const fixationDuration = baseFixationDuration + randomPreStimulusMs;
    const remainingBlockMs = activeBlockDeadlinePerf ? Math.max(1, activeBlockDeadlinePerf - performance.now()) : Infinity;
    const stimulusDuration = Math.min(
        Math.max(1, Number(trial?.duration) || Number(config.stimulusDuration) || 1000),
        remainingBlockMs
    );

    const stimulusType = trial?.stimulus?.type || 'shape';
    const trialId = planItem.trialId;
    const runtime = getSessionRuntime();
    activeTrialQualityContext = {
        issueStartIndex: runtime?.getCurrentBlock()?.issues?.length || 0,
        activeAtStart: runtime?.getActiveIssues?.() || []
    };

    setTaskContext({
        blockId: block?.id ?? null,
        attempt: currentBlockAttempt,
        trialId,
        presentationId: [
            block?.id ?? `cognitive_${currentBlockIndex}`,
            currentBlockAttempt,
            trialId,
            trial?.stimulus?.stimulusId ?? trialId
        ].map(String).join(':'),
        stimulusId: trial?.stimulus?.stimulusId ?? trialId,
        stimulusName: trial?.stimulus?.stimulusName ?? null,
        stimulusType,
        stimulusVersion: trial?.stimulus?.stimulusVersion || '1',
        expectedResponse: trial?.correctResponse ?? null
    });

    emitTaskEvent('trial_start', {
        trialIndex: currentTrialIndex,
        condition: trial?.condition ?? null,
        fixationDuration,
        randomPreStimulusMs,
        stimulusDuration
    });

    resetStimulusViews();
    ex_state.task.feedback.style.display = 'none';
    ex_state.task.fixation.style.display = useFixation ? 'block' : 'none';
    setSessionPhase('cognitive_instruction', { source: 'trial_fixation' });
    trialPhase = 'fixation';
    fixationRemainingMs = fixationDuration;
    fixationStartPerf = performance.now();
    const responseMode = normalizeResponseMode(config, trial);
    responseCollector = new RtResponseCollector({
        mode: responseMode,
        target: document
    });
    responseCollector.startBaseline();

    pendingFixationCallback = async () => {
        if (activeBlockDeadlinePerf && performance.now() >= activeBlockDeadlinePerf) {
            finishTaskBlockAttempt(block);
            return;
        }
        ex_state.task.fixation.style.display = 'none';
        const stimulusReady = await renderStimulus(trial);
        if (!stimulusReady) {
            const errorAt = performance.now();
            const errorView = ex_state.task?.stimulus;
            if (!errorView) return;
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:18px;';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.textContent = state.currentLang === 'ru' ? 'Повторить загрузку' : 'Retry loading';
            const skip = document.createElement('button');
            skip.type = 'button';
            skip.textContent = state.currentLang === 'ru' ? 'Пропустить пробу' : 'Skip this trial';
            const errorText = errorView.textContent;
            errorView.textContent = '';
            const message = document.createElement('div');
            message.textContent = errorText;
            errorView.append(message, actions);
            actions.append(retry, skip);
            errorView.style.flexDirection = 'column';
            trialPhase = 'media_error';
            retry.onclick = () => {
                if (trialPhase !== 'media_error') return;
                retry.disabled = true;
                skip.disabled = true;
                trialPhase = 'media_retry';
                if (activeBlockDeadlinePerf) activeBlockDeadlinePerf += performance.now() - errorAt;
                void pendingFixationCallback();
            };
            skip.onclick = () => {
                if (trialPhase !== 'media_error') return;
                trialPhase = 'media_skipped';
                getSessionRuntime()?.reportIssue?.({
                    kind: 'technical', code: 'stimulus_media_load_failed',
                    message: state.currentLang === 'ru'
                        ? 'Проба пропущена: файл стимула не загрузился.'
                        : 'Trial skipped: the stimulus file could not be loaded.',
                    recoverable: true, invalidatesBlock: true
                });
                recordSessionEvent('stimulus_trial_skipped', {
                    category: 'technical', trialId, stimulusId: trial?.stimulus?.stimulusId || null
                });
                handleResponse(null, null, { responseMode, skippedMedia: true });
            };
            return;
        }

        const stimulusOnPerf = performance.now();
        activeTrialRuntime = {
            stimulusOnPerf,
            stimulusOnEpoch: Date.now(),
            stimulusOff: false,
            blockId: block?.id ?? null,
            trialId,
            qualityContext: activeTrialQualityContext
        };

        setSessionPhase('cognitive_stimulus', { source: 'stimulus_on' });
        const isGo = conditionToIsGo(trial?.condition);
        const rtWindowMs = config.rtWindow || config.stimulusDuration || 1000;
        emitTaskEvent('stimulus_on', {
            trialIndex: currentTrialIndex,
            trial_id: currentTrialIndex + 1,
            condition: trial?.condition ?? null,
            task_id: block?.taskType || block?.rt_task || null,
            stimulus_type: trial?.condition || stimulusType,
            expected_response: trial?.correctResponse ?? null,
            is_go: isGo,
            timeout_ms: rtWindowMs,
            response_mode: responseMode
        });

        let responded = false;
        trialPhase = 'stimulus';
        stimulusTimeoutRemainingMs = stimulusDuration;
        stimulusTimerStartPerf = performance.now();
        responseCollector.arm((decision) => {
            if (responded) return;
            responded = true;
            handleResponse(decision.rtMs, decision.response, decision);
        });

        if (window.Photodiode?.isEnabled()) {
            const markerContext = { ...state.runtime.taskContext };
            recordSessionEvent('photodiode_marker_request', {
                ...markerContext, category: 'technical', kind: 'stimulus',
                requestedAtMs: performance.now(), timingValidated: false
            });
            void window.Photodiode.signal('stimulus').then(marker => {
                recordSessionEvent('photodiode_marker', {
                    ...markerContext, category: 'technical', kind: marker.kind, status: marker.status,
                    pulses: marker.pulses ?? 0, emittedAtMs: marker.emittedAtMs ?? null,
                    completedAtMs: marker.completedAtMs ?? null, timingValidated: false
                });
            });
        }

        pendingStimulusTimeoutCallback = () => {
            if (!responded) {
                responded = true;
                handleResponse(null, null, {
                    responseMode,
                    inputType: null,
                    decisionTimestampMs: null,
                    pointerSummary: responseCollector?.pointerSummary(null) || null
                });
            }
        };
        trialTimeout = setTimeout(pendingStimulusTimeoutCallback, stimulusDuration);
    };

    fixationTimeout = setTimeout(pendingFixationCallback, fixationDuration);
}

function handleResponse(rt, key, decision = {}) {
    cleanupTrial();

    const block = experimentProtocol.blocks[currentBlockIndex];
    const planItem = activeBlockTrialPlan[currentTrialIndex];
    const trial = planItem.trial;
    const config = block.blockConfig || {};
    const runtime = getSessionRuntime();
    const qualityIssues = trialQualityIssues(
        runtime,
        activeTrialRuntime?.qualityContext || activeTrialQualityContext
    );
    if (decision.skippedMedia && !qualityIssues.some(issue => issue.code === 'stimulus_media_load_failed')) {
        qualityIssues.push({ code: 'stimulus_media_load_failed', kind: 'technical' });
    }
    const qualityValid = qualityIssues.length === 0 && !decision.skippedMedia;

    const rtMs = Number.isFinite(rt) ? Math.round(rt) : null;
    emitStimulusOffIfNeeded(rtMs, key ? 'response' : 'timeout');

    emitTaskEvent('response', {
        key: key || null,
        responded: key !== null,
        rtMs,
        response_mode: decision.responseMode || normalizeResponseMode(config, trial),
        input_type: decision.inputType || null,
        decision_timestamp_ms: decision.decisionTimestampMs ?? null,
        pointer_summary: decision.pointerSummary || null
    });

    setSessionPhase('cognitive_instruction', { source: 'stimulus_off' });
    resetStimulusViews();

    const isCorrect = !decision.skippedMedia && trial.correctResponse === key;

    state.sessionData.cognitiveResults.push({
        trialId: planItem.trialId,
        block: block.id,
        blockId: block.id,
        task_id: block?.taskType || block?.rt_task || null,
        stimulusId: trial?.stimulus?.stimulusId ?? planItem.trialId,
        stimulusType: trial?.stimulus?.type || 'shape',
        expectedResponse: trial.correctResponse ?? null,
        rt: rtMs,
        condition: trial.condition,
        response: key || null,
        responseMode: decision.responseMode || normalizeResponseMode(config, trial),
        inputType: decision.inputType || null,
        decisionTimestampMs: decision.decisionTimestampMs ?? null,
        pointerSummary: decision.pointerSummary || null,
        correct: isCorrect,
        attempt: currentBlockAttempt,
        qualityValid,
        skippedMedia: decision.skippedMedia === true,
        qualityIssueCodes: qualityIssues.map(issue => issue.code),
        qualityIssues,
        sourceTrialIndex: planItem.sourceIndex,
        repeatSequenceIndex: currentTrialIndex,
        timestamp: Date.now()
    });

    emitTaskEvent('trial_end', {
        trialIndex: currentTrialIndex,
        condition: trial?.condition ?? null,
        key: key || null,
        rtMs,
        correct: isCorrect,
        qualityValid,
        qualityIssueCodes: qualityIssues.map(issue => issue.code)
    });

    activeTrialRuntime = null;
    activeTrialQualityContext = null;

    if (config.showFeedback && !decision.skippedMedia) {
        const t = translations[state.currentLang] || translations.en;
        ex_state.task.feedback.innerText = isCorrect
            ? `✓ ${t.runtime_feedback_correct}`
            : `✗ ${t.runtime_feedback_incorrect}`;
        ex_state.task.feedback.style.color = isCorrect ? '#4CAF50' : '#F44336';
        ex_state.task.feedback.style.display = 'block';

        setTimeout(() => {
            ex_state.task.feedback.style.display = 'none';
            moveToNextTrial();
        }, Math.max(0, Number(trial?.feedbackDuration) || 500));
    } else {
        moveToNextTrial();
    }
}

async function finishTaskBlockAttempt(block) {
    const runtime = getSessionRuntime();
    const blockId = String(block?.id || '');
    // Leave the stimulus layout before any completion/repeat modal can block this flow.
    setStimulusLayout(block, false);
    const attemptResults = state.sessionData.cognitiveResults.filter(result => (
        String(result?.blockId || '') === blockId
        && Number(result?.attempt) === Number(currentBlockAttempt)
    ));
    const {
        invalidResults,
        repeatTrialPlan,
        repeatItems
    } = buildTrialRepeatPlan(activeBlockTrialPlan, attemptResults);
    const invalidIds = new Set(invalidResults.map(result => String(result.trialId)));
    const decision = runtime?.completeBlock({
        success: true,
        reason: invalidResults.length ? 'trial_quality_issue' : null,
        repeatItems,
        repeatItemLabel: 'trial',
        totalItemCount: Array.isArray(block?.trials) ? block.trials.length : activeBlockTrialPlan.length
    }) || {
        repeatRequired: false,
        block: { attempt: currentBlockAttempt }
    };
    const attempt = decision.block?.attempt || currentBlockAttempt;

    if (decision.repeatRequired) {
        emitTaskEvent('block_repeat_required', {
            blockIndex: currentBlockIndex,
            blockType: block?.type || 'cognitive_task',
            failedAttempt: attempt,
            invalidTrialCount: invalidResults.length,
            repeatTrialIds: [...invalidIds]
        });
        if (attempt < MAX_COGNITIVE_BLOCK_ATTEMPTS && repeatTrialPlan.length) {
            await runtime.promptRepeat(blockId);
            startTaskBlock(block, repeatTrialPlan);
            return;
        }
        const abandonedRepeat = runtime?.discardRepeat(blockId);
        if (abandonedRepeat) await runtime.notifyRepeatLimit(abandonedRepeat);
    }

    await exitCognitiveFullscreen();
    await runtime?.notifyBlockComplete({
        blockId,
        blockType: block?.type || 'cognitive_task'
    });

    activeBlockTrialPlan = [];
    activeBlockDeadlinePerf = null;
    currentBlockIndex++;
    runNextBlock();
}

function moveToNextTrial() {
    const trial = activeBlockTrialPlan[currentTrialIndex]?.trial;
    const interTrialDelay = Math.max(0, Number(trial?.iti) || 200);
    setTimeout(() => {
        currentTrialIndex++;
        runTrial();
    }, activeBlockDeadlinePerf
        ? Math.min(interTrialDelay, Math.max(0, activeBlockDeadlinePerf - performance.now()))
        : interTrialDelay);
}

function cleanupTrial() {
    responseCollector?.dispose();
    responseCollector = null;

    if (fixationTimeout) {
        clearTimeout(fixationTimeout);
        fixationTimeout = null;
    }

    if (trialTimeout) {
        clearTimeout(trialTimeout);
        trialTimeout = null;
    }

    trialPhase = 'idle';
    fixationStartPerf = null;
    fixationRemainingMs = 0;
    pendingFixationCallback = null;
    stimulusTimeoutRemainingMs = 0;
    stimulusTimerStartPerf = null;
    pendingStimulusTimeoutCallback = null;
    activeTrialQualityContext = null;
}
