/**
 * Фаза 1.2+: Автопауза и подсказки по QC.
 * При падении QC ниже порога или потере лица показывается overlay
 * «Верните лицо в кадр» / «Улучшите освещение».
 *
 * @module qc-pause-overlay-new
 */

const DEFAULT_CONFIG = {
    /** Порог QC score (0–1). Ниже — показываем overlay. */
    qcScoreThreshold: 0.6,
    /** Секунд без лица — показываем overlay «Верните лицо в кадр». */
    faceLostSec: 3,
    /** Ставить выполнение стимулов на паузу при деградации QC. */
    autoPauseStimulus: true
};

const REASON_MESSAGES = {
    ru: {
        face_lost: 'Верните лицо в кадр',
        low_qc: 'Улучшите условия: освещение и положение лица',
        low_light: 'Улучшите освещение'
    },
    en: {
        face_lost: 'Return your face to the frame',
        low_qc: 'Improve conditions: lighting and face position',
        low_light: 'Improve lighting'
    }
};

let overlayEl = null;
let visible = false;
let config = { ...DEFAULT_CONFIG };
let faceLostSince = null;
let getLang = () => 'ru';
let hideDebounceTimer = null;
let acceptableFrameStreak = 0;
const HIDE_DEBOUNCE_MS = 400;
const ACCEPTABLE_STREAK_TO_HIDE = 3;
let lastVisibleReason = null;

/**
 * @param {Object} options
 * @param {number} [options.qcScoreThreshold]
 * @param {number} [options.faceLostSec]
 * @param {boolean} [options.autoPauseStimulus]
 * @param {function(): string} [options.getLang]
 */
export function init(options = {}) {
    config = { ...DEFAULT_CONFIG, ...options };
    if (options.getLang) getLang = options.getLang;
    ensureOverlay();
}

function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'qc-pause-overlay';
    overlayEl.setAttribute('aria-live', 'polite');
    overlayEl.style.cssText = [
        'position:fixed;inset:0;z-index:9999;',
        'display:none;align-items:center;justify-content:center;',
        'background:rgba(0,0,0,0.75);color:#fff;font-size:1.25rem;',
        'pointer-events:none;'
    ].join('');
    const inner = document.createElement('div');
    inner.id = 'qc-pause-overlay-message';
    inner.style.cssText = 'text-align:center;padding:1.5rem;max-width:90%;';
    overlayEl.appendChild(inner);
    document.body.appendChild(overlayEl);
    return overlayEl;
}

/**
 * @param {'face_lost'|'low_qc'|'low_light'} reason
 */
function logOverlayTransition(action, reason, extra) {
    try {
        const d = typeof window !== 'undefined' ? window.WECOG_DEBUG : null;
        if (d && d.enabled && d.recordOverlayTransition) {
            d.recordOverlayTransition(action, reason, extra);
        } else if (d && d.enabled) {
            d.mark('qc', 'overlay:' + action, { reason, ...(extra || {}) });
        }
    } catch (_) { /* ignore */ }
}

function clearHideDebounce() {
    if (hideDebounceTimer) {
        clearTimeout(hideDebounceTimer);
        hideDebounceTimer = null;
    }
}

export function show(reason) {
    ensureOverlay();
    clearHideDebounce();
    acceptableFrameStreak = 0;
    const lang = getLang();
    const messages = REASON_MESSAGES[lang] || REASON_MESSAGES.en;
    const text = messages[reason] || messages.low_qc;
    const msgEl = document.getElementById('qc-pause-overlay-message');
    if (msgEl) msgEl.textContent = text;
    const wasVisible = visible;
    overlayEl.style.display = 'flex';
    visible = true;
    lastVisibleReason = reason;
    if (!wasVisible) logOverlayTransition('show', reason);
}

export function hide() {
    if (!overlayEl) return;
    const wasVisible = visible;
    overlayEl.style.display = 'none';
    visible = false;
    if (wasVisible) logOverlayTransition('hide', lastVisibleReason);
    lastVisibleReason = null;
}

/** Сброс таймера потери лица (например, при старте tracking test). */
export function resetFaceLostTimer() {
    faceLostSince = null;
    acceptableFrameStreak = 0;
    clearHideDebounce();
}

/**
 * Текущий кадр приемлем для overlay-гейта (не путать с session-cumulative qcScore).
 * Совпадает с флагами QCMetrics._computeFlags.
 */
export function isCurrentFrameAcceptable(precheckResult) {
    if (!precheckResult) return true;
    const pr = precheckResult;
    if (!pr.face || pr.face.detected !== true) return false;
    const badStatuses = ['too_small', 'too_large', 'out_of_bounds', 'not_found'];
    if (badStatuses.includes(pr.face.status)) return false;
    if (pr.pose) {
        const poseOk = pr.pose.status === 'stable' ||
            (pr.pose.isStable === true && pr.pose.isTilted !== true);
        if (!poseOk) return false;
    }
    if (pr.illumination && pr.illumination.status !== 'optimal') return false;
    return true;
}

export function isVisible() {
    return visible;
}

/**
 * Обновить состояние overlay по текущим метрикам и результату кадра.
 * Вызывать из цикла анализа (experimental_task / tests).
 *
 * @param {Object} metrics - результат getCurrentMetrics() QCMetrics
 * @param {Object} [precheckResult] - результат analyzeFrame (face.detected и т.д.)
 */
export function updateFromMetrics(metrics, precheckResult) {
    if (!metrics) return;
    const now = Date.now();
    const faceDetected = precheckResult?.face?.detected !== false;

    if (!faceDetected) {
        acceptableFrameStreak = 0;
        clearHideDebounce();
        if (faceLostSince == null) faceLostSince = now;
        const lostSec = (now - faceLostSince) / 1000;
        if (lostSec >= config.faceLostSec) {
            show('face_lost');
            return;
        }
    } else {
        faceLostSince = null;
    }

    const qcScore = metrics.qcScore;
    if (typeof qcScore === 'number' && qcScore < config.qcScoreThreshold) {
        // Session-cumulative qcScore может оставаться низким после калибровки,
        // даже когда текущий кадр уже нормальный — не «залипаем» на overlay.
        if (!isCurrentFrameAcceptable(precheckResult)) {
            acceptableFrameStreak = 0;
            clearHideDebounce();
            const illumOk = metrics.illuminationOkPct != null && metrics.illuminationOkPct >= 50;
            show(illumOk ? 'low_qc' : 'low_light');
            return;
        }
    }

    if (!isCurrentFrameAcceptable(precheckResult)) {
        acceptableFrameStreak = 0;
        clearHideDebounce();
        return;
    }

    acceptableFrameStreak += 1;
    if (!visible) {
        clearHideDebounce();
        return;
    }
    if (acceptableFrameStreak < ACCEPTABLE_STREAK_TO_HIDE) return;
    if (hideDebounceTimer) return;
    hideDebounceTimer = setTimeout(() => {
        hideDebounceTimer = null;
        if (acceptableFrameStreak >= ACCEPTABLE_STREAK_TO_HIDE) hide();
    }, HIDE_DEBOUNCE_MS);
}

export function getConfig() {
    return { ...config };
}

export function shouldAutoPause() {
    return config.autoPauseStimulus !== false;
}

/**
 * Временно отключить автопаузу по QC (например, во время RT Go/NoGo).
 * @param {boolean} enabled
 */
export function setAutoPauseStimulus(enabled) {
    config = { ...config, autoPauseStimulus: enabled !== false };
}

// Глобальный доступ из других модулей (без прямого импорта),
// чтобы можно было гарантированно скрывать оверлей при выходе в меню/хаб.
if (typeof window !== 'undefined') {
    window.qcPauseOverlay = {
        show,
        hide,
        isVisible,
        isCurrentFrameAcceptable,
        updateFromMetrics,
        resetFaceLostTimer,
        getConfig,
        shouldAutoPause,
        setAutoPauseStimulus
    };
}
