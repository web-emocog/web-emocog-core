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

function emotionFaceDataUri(emotionKey, stimulusId) {
  const key = String(emotionKey || 'neutral').toLowerCase();
  const match = String(stimulusId || '').match(/_(\d+)$/);
  const variant = Math.max(1, Number(match?.[1]) || 1);
  const skin = ['#f2c9a5', '#c98762', '#8c573f', '#e2ad83', '#6e4435', '#f0bd91'][(variant - 1) % 6];
  const hair = ['#3b2a22', '#16181d', '#6b3e26', '#b77936', '#4b362e', '#25211f'][(variant - 1) % 6];
  const features = {
    neutral: '<path d="M225 185h54M361 185h54"/><circle cx="252" cy="220" r="9" fill="#172033"/><circle cx="388" cy="220" r="9" fill="#172033"/><path d="M258 326h124"/>',
    happy: '<path d="M220 193q32-24 64 0M356 193q32-24 64 0"/><path d="M226 226q26 24 52 0M362 226q26 24 52 0"/><path d="M238 302q82 100 164 0"/>',
    anger: '<path d="M218 200l66-28M356 172l66 28"/><circle cx="252" cy="226" r="10" fill="#172033"/><circle cx="388" cy="226" r="10" fill="#172033"/><path d="M246 350q74-72 148 0"/>',
    sad: '<path d="M218 180q34-26 66 8M356 188q32-34 66-8"/><circle cx="252" cy="226" r="9" fill="#172033"/><circle cx="388" cy="226" r="9" fill="#172033"/><path d="M246 354q74-76 148 0"/><path d="M416 244q18 30 0 55q-18-25 0-55" fill="#69aee8" stroke="none"/>',
    fear: '<path d="M216 174q36-30 70 0M354 174q34-30 70 0"/><ellipse cx="252" cy="224" rx="13" ry="20" fill="#172033"/><ellipse cx="388" cy="224" rx="13" ry="20" fill="#172033"/><ellipse cx="320" cy="332" rx="44" ry="54"/>',
    surprise: '<path d="M216 170q36-30 70 0M354 170q34-30 70 0"/><circle cx="252" cy="224" r="12" fill="#172033"/><circle cx="388" cy="224" r="12" fill="#172033"/><ellipse cx="320" cy="326" rx="38" ry="52"/>',
    disgust: '<path d="M218 184l66 18M356 202l66-18"/><circle cx="252" cy="226" r="9" fill="#172033"/><path d="M367 222q22 18 44 0"/><path d="M246 330q42-58 84-4q34 44 72-6"/>'
  }[key] || '<path d="M225 185h54M361 185h54"/><circle cx="252" cy="220" r="9" fill="#172033"/><circle cx="388" cy="220" r="9" fill="#172033"/><path d="M258 326h124"/>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">'
    + '<rect width="640" height="480" rx="36" fill="#edf1f4"/>'
    + '<path d="M170 206q4-154 150-154t150 154v110q0 130-150 130T170 316z" fill="' + skin + '" stroke="#172033" stroke-width="8"/>'
    + '<path d="M174 205q0-153 146-153t146 153q-40-72-146-72t-146 72z" fill="' + hair + '" stroke="#172033" stroke-width="8"/>'
    + '<g fill="none" stroke="#172033" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">' + features + '</g>'
    + '<path d="M320 224l-14 70h30" fill="none" stroke="#9a684e" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</svg>';
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

const DEFAULT_FALLBACK_STIMULUS = Object.freeze({
  type: 'shape',
  style: {
    width: 'clamp(180px, 22vw, 340px)',
    height: 'clamp(180px, 22vw, 340px)',
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

function mediaTypeFromMeta(meta) {
  const metadata = meta?.metadata && typeof meta.metadata === 'object' ? meta.metadata : {};
  const mimeType = String(
    meta?.mime_type || meta?.mimeType || metadata.mime_type || metadata.mimeType || ''
  ).toLowerCase();
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'image';
  return 'image';
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
      width: 'clamp(180px, 20vw, 320px)',
      height: 'clamp(180px, 20vw, 320px)',
      borderRadius: '10px',
      backgroundColor: '#020617',
    }, id);
  }

  if (id === 'std_go_green_circle') {
    return shapeStimulus({
      width: 'clamp(190px, 22vw, 340px)',
      height: 'clamp(190px, 22vw, 340px)',
      borderRadius: '50%',
      backgroundColor: '#16a34a',
    }, id);
  }

  if (id === 'std_nogo_red_circle') {
    return shapeStimulus({
      width: 'clamp(190px, 22vw, 340px)',
      height: 'clamp(190px, 22vw, 340px)',
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
      fontSize: 'clamp(64px, 11vw, 150px)',
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
      fontSize: 'clamp(68px, 12vw, 160px)',
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
        width: 'clamp(190px, 22vw, 340px)',
        height: 'clamp(190px, 22vw, 340px)',
        borderRadius: '50%',
        backgroundColor: '#5c66bd',
      }, id);
    }
    if (shape === 'square') {
      return shapeStimulus({
        width: 'clamp(190px, 22vw, 340px)',
        height: 'clamp(190px, 22vw, 340px)',
        borderRadius: '16px',
        backgroundColor: '#5c66bd',
      }, id);
    }
    if (shape === 'triangle') {
      return shapeStimulus({
        width: 'clamp(220px, 25vw, 380px)',
        height: 'clamp(190px, 22vw, 330px)',
        clipPath: 'polygon(50% 0, 100% 100%, 0 100%)',
        backgroundColor: '#5c66bd',
        borderRadius: '0',
      }, id);
    }
    if (shape === 'diamond') {
      return shapeStimulus({
        width: 'clamp(170px, 19vw, 290px)',
        height: 'clamp(170px, 19vw, 290px)',
        borderRadius: '12px',
        backgroundColor: '#5c66bd',
        transform: 'rotate(45deg)',
      }, id);
    }
  }

  if (id === 'std_pvt_counter') {
    return textStimulus('000', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: 'clamp(72px, 12vw, 160px)',
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
      fontSize: 'clamp(72px, 13vw, 170px)',
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
    return imageStimulus(emotionFaceDataUri(emotionKey, id), id, {
      width: 'min(82vw, 920px)',
      maxWidth: '96%',
      maxHeight: '92%',
      objectFit: 'contain',
      borderRadius: '22px',
    });
  }

  return null;
}

function resolveUrlFromMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const md = meta.metadata || meta;
  return md.url
    || md.source_url
    || md.content_url
    || md.file_url
    || md.preview_url
    || meta.url
    || meta.source_url
    || meta.content_url
    || meta.src
    || null;
}

/**
 * Prefer uploaded/API image URL; otherwise resolve std_*; otherwise fallback shape.
 */
function resolveParticipantStimulus(params) {
  params = params || {};
  const rawStimulusId = String(params.stimulusId || '').trim();
  const stimulusId = normalizeStimulusId(params.stimulusId);
  const meta = params.meta || null;
  const url = params.url || resolveUrlFromMeta(meta);
  const metadata = meta?.metadata && typeof meta.metadata === 'object' ? meta.metadata : {};
  const sourceUrl = params.sourceUrl
    || metadata.source_url
    || metadata.content_url
    || meta?.source_url
    || meta?.content_url
    || null;

  if (url) {
    const type = mediaTypeFromMeta(meta);
    return {
      ...imageStimulus(url, stimulusId || undefined, params.imageStyle || {}),
      type,
      ...(sourceUrl && sourceUrl !== url ? { fallbackSrc: sourceUrl } : {}),
    };
  }

  const standard = resolveStandardStimulus(stimulusId, meta, { lang: params.lang });
  if (standard) {
    return standard;
  }

  // Database stimuli use numeric ids (optionally namespaced as api:*). They are
  // media references, never synthetic shapes. Keeping the type prevents a
  // transient delivery failure from silently displaying the blue fallback.
  if (/^(?:api:)?[1-9]\d*$/.test(rawStimulusId)) {
    return {
      type: 'image',
      src: '',
      mediaUnavailable: true,
      style: params.imageStyle || {},
      stimulusId: stimulusId || undefined,
    };
  }

  const fallback = {
    ...DEFAULT_FALLBACK_STIMULUS,
    style: { ...DEFAULT_FALLBACK_STIMULUS.style },
  };
  if (stimulusId) fallback.stimulusId = stimulusId;
  return fallback;
}

const standardStimuliApi = {
  normalizeStimulusId,
  parseEmotionFromStdId,
  resolveEmotionKey,
  emotionDisplayLabel,
  emotionFaceDataUri,
  colorFromToken,
  resolveStandardStimulus,
  resolveParticipantStimulus,
  resolveUrlFromMeta,
  mediaTypeFromMeta,
  DEFAULT_FALLBACK_STIMULUS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = standardStimuliApi;
}
if (typeof window !== 'undefined') {
  window.StandardStimuli = standardStimuliApi;
}
