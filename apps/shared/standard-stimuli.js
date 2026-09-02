/**
 * Virtual standard protocol stimuli (std_* IDs).
 * Used by participant runtime and researcher preview — no image URLs required.
 */

function normalizeStimulusId(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  return raw.startsWith('api:') ? raw.slice(4) : raw;
}

function colorFromToken(token, fallback) {
  const value = String(token || '').toLowerCase();
  if (value.includes('green')) return '#16a34a';
  if (value.includes('blue')) return '#2563eb';
  if (value.includes('red')) return '#dc2626';
  if (value.includes('yellow')) return '#f59e0b';
  return fallback || '#0f172a';
}

const STROOP_WORDS = {
  ru: { red: 'КРАСНЫЙ', blue: 'СИНИЙ', green: 'ЗЕЛЕНЫЙ' },
  en: { red: 'RED', blue: 'BLUE', green: 'GREEN' },
};

const FLANKER_TEXT = Object.freeze({
  std_flanker_right_cong: '>>>>>',
  std_flanker_left_cong: '<<<<<',
  // The middle arrow is the target; the id names its direction.
  std_flanker_right_incong: '<<><<',
  std_flanker_left_incong: '>><>>',
});

const EMO_VISUAL = {
  neutral:  { emoji: '😐', bg: 'rgba(148,163,184,.22)', border: 'rgba(148,163,184,.45)' },
  happy:    { emoji: '😊', bg: 'rgba(245,158,11,.18)', border: 'rgba(245,158,11,.42)' },
  anger:    { emoji: '😠', bg: 'rgba(220,38,38,.14)', border: 'rgba(220,38,38,.38)' },
  sad:      { emoji: '😢', bg: 'rgba(59,130,246,.14)', border: 'rgba(59,130,246,.38)' },
  fear:     { emoji: '😨', bg: 'rgba(139,92,246,.14)', border: 'rgba(139,92,246,.38)' },
  surprise: { emoji: '😲', bg: 'rgba(6,182,212,.14)', border: 'rgba(6,182,212,.38)' },
  disgust:  { emoji: '🤢', bg: 'rgba(22,163,74,.14)', border: 'rgba(22,163,74,.38)' },
};

const EMO_LABEL = {
  ru: { neutral: 'нейтрально', happy: 'радость', anger: 'гнев', sad: 'грусть', fear: 'страх', surprise: 'удивление', disgust: 'отвращение' },
  en: { neutral: 'neutral', happy: 'happy', anger: 'anger', sad: 'sad', fear: 'fear', surprise: 'surprise', disgust: 'disgust' },
};

function parseEmotionFromStdId(stimulusId) {
  const id = normalizeStimulusId(stimulusId);
  const m = id.match(/^std_emo_([a-z]+)_\d+$/i);
  return m ? m[1].toLowerCase() : null;
}

function emotionDisplayLabel(emotionKey, lang) {
  const key = String(emotionKey || 'neutral').toLowerCase();
  const labels = EMO_LABEL[lang === 'en' ? 'en' : 'ru'] || EMO_LABEL.ru;
  return labels[key] || key;
}

function resolveEmotionKey(stimulusId, meta) {
  return String(meta?.emotion || parseEmotionFromStdId(stimulusId) || 'neutral').toLowerCase();
}

const DEFAULT_FALLBACK_STIMULUS = Object.freeze({
  type: 'shape',
  style: {
    width: '140px',
    height: '140px',
    borderRadius: '8px',
    backgroundColor: '#5C66BD',
  },
});

function shapeStimulus(style, stimulusId) {
  return {
    type: 'shape',
    style,
    stimulusId: stimulusId || undefined,
  };
}

function textStimulus(text, style, stimulusId) {
  return {
    type: 'text',
    text: String(text || ''),
    style,
    stimulusId: stimulusId || undefined,
  };
}

function imageStimulus(src, stimulusId, style) {
  return {
    type: 'image',
    src,
    style: style || {},
    stimulusId: stimulusId || undefined,
  };
}

/**
 * Resolve a std_* stimulus id to participant-renderable stimulus object.
 * @param {string} stimulusId
 * @param {object|null} meta optional library row (name, text, emotion, …)
 * @param {{ lang?: string }} [options]
 * @returns {object|null} null if not a known standard id
 */
function resolveStandardStimulus(stimulusId, meta, options) {
  options = options || {};
  const id = normalizeStimulusId(stimulusId);
  if (!id.startsWith('std_')) return null;

  const lang = options.lang === 'en' ? 'en' : 'ru';
  const name = meta?.name || meta?.label || id;
  const metaText = meta?.text || null;

  if (id === 'std_simple_black_square') {
    return shapeStimulus({
      width: '120px',
      height: '120px',
      borderRadius: '10px',
      backgroundColor: '#020617',
    }, id);
  }

  if (id === 'std_go_green_circle') {
    return shapeStimulus({
      width: '140px',
      height: '140px',
      borderRadius: '50%',
      backgroundColor: '#16a34a',
    }, id);
  }

  if (id === 'std_nogo_red_circle') {
    return shapeStimulus({
      width: '140px',
      height: '140px',
      borderRadius: '50%',
      backgroundColor: '#dc2626',
    }, id);
  }

  if (id.startsWith('std_stroop_')) {
    const raw = id.replace('std_stroop_', '').split('_');
    const wordKey = raw[0] || 'red';
    const inkKey = raw[1] || raw[0] || 'red';
    const words = STROOP_WORDS[lang] || STROOP_WORDS.ru;
    return textStimulus(words[wordKey] || name, {
      fontSize: 'clamp(48px, 9vw, 92px)',
      fontWeight: '900',
      letterSpacing: '0.04em',
      color: colorFromToken(inkKey, '#0f172a'),
      backgroundColor: 'transparent',
      width: 'auto',
      height: 'auto',
      borderRadius: '0',
    }, id);
  }

  if (id.startsWith('std_flanker_')) {
    const text = FLANKER_TEXT[id] || metaText || String(name).split(':').pop()?.trim() || '';
    return textStimulus(text, {
      fontSize: 'clamp(54px, 10vw, 100px)',
      fontWeight: '900',
      letterSpacing: '0.08em',
      color: '#0f172a',
      backgroundColor: 'transparent',
      width: 'auto',
      height: 'auto',
      borderRadius: '0',
    }, id);
  }

  if (id.startsWith('std_nback_')) {
    const shape = id.replace('std_nback_', '');
    if (shape === 'circle') {
      return shapeStimulus({
        width: '130px',
        height: '130px',
        borderRadius: '50%',
        backgroundColor: '#5c66bd',
      }, id);
    }
    if (shape === 'square') {
      return shapeStimulus({
        width: '130px',
        height: '130px',
        borderRadius: '16px',
        backgroundColor: '#5c66bd',
      }, id);
    }
    if (shape === 'triangle') {
      return shapeStimulus({
        width: '0',
        height: '0',
        borderLeft: '76px solid transparent',
        borderRight: '76px solid transparent',
        borderBottom: '132px solid #5c66bd',
        backgroundColor: 'transparent',
        borderRadius: '0',
      }, id);
    }
    if (shape === 'diamond') {
      return shapeStimulus({
        width: '120px',
        height: '120px',
        borderRadius: '12px',
        backgroundColor: '#5c66bd',
        transform: 'rotate(45deg)',
      }, id);
    }
  }

  if (id === 'std_pvt_counter') {
    return textStimulus('000', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: 'clamp(56px, 10vw, 104px)',
      fontWeight: '900',
      color: '#dc2626',
      backgroundColor: 'transparent',
      width: 'auto',
      height: 'auto',
      borderRadius: '0',
    }, id);
  }

  if (id.startsWith('std_cpt_') || id.startsWith('std_switch_')) {
    const generatedText = id.startsWith('std_cpt_')
      ? id.slice('std_cpt_'.length).toUpperCase()
      : id.slice('std_switch_'.length).toUpperCase();
    const candidate = metaText || String(name).split(':').pop()?.trim() || '';
    const text = !candidate || candidate === id || candidate.startsWith('std_')
      ? generatedText
      : candidate;
    return textStimulus(text, {
      fontSize: 'clamp(58px, 11vw, 110px)',
      fontWeight: '900',
      letterSpacing: '0.08em',
      color: '#0f172a',
      backgroundColor: 'transparent',
      width: 'auto',
      height: 'auto',
      borderRadius: '0',
    }, id);
  }

  if (id.startsWith('std_emo_')) {
    const emotionKey = resolveEmotionKey(id, meta);
    const vis = EMO_VISUAL[emotionKey] || EMO_VISUAL.neutral;
    const label = emotionDisplayLabel(emotionKey, lang);
    return textStimulus(vis.emoji + '\n' + label.toUpperCase(), {
      fontSize: '16px',
      fontWeight: '800',
      letterSpacing: '0.08em',
      color: '#0f172a',
      backgroundColor: vis.bg,
      width: 'min(340px, 70vw)',
      minHeight: '180px',
      borderRadius: '24px',
      border: '1px solid ' + vis.border,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      whiteSpace: 'pre-wrap',
      textAlign: 'center',
      lineHeight: '1.2',
    }, id);
  }

  return null;
}

function resolveUrlFromMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const md = meta.metadata || meta;
  return md.url || md.file_url || md.preview_url || meta.url || meta.src || null;
}

/**
 * Prefer uploaded/API image URL; otherwise resolve std_*; otherwise fallback shape.
 */
function resolveParticipantStimulus(params) {
  params = params || {};
  const stimulusId = normalizeStimulusId(params.stimulusId);
  const meta = params.meta || null;
  const url = params.url || resolveUrlFromMeta(meta);

  if (url) {
    return imageStimulus(url, stimulusId || undefined, params.imageStyle || {});
  }

  const standard = resolveStandardStimulus(stimulusId, meta, { lang: params.lang });
  if (standard) {
    return standard;
  }

  const fallback = {
    ...DEFAULT_FALLBACK_STIMULUS,
    style: { ...DEFAULT_FALLBACK_STIMULUS.style },
  };
  if (stimulusId) fallback.stimulusId = stimulusId;
  return fallback;
}

const api = {
  normalizeStimulusId,
  parseEmotionFromStdId,
  resolveEmotionKey,
  emotionDisplayLabel,
  colorFromToken,
  resolveStandardStimulus,
  resolveParticipantStimulus,
  resolveUrlFromMeta,
  DEFAULT_FALLBACK_STIMULUS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.StandardStimuli = api;
}
