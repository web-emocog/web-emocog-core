/**
 * UI-модуль (финальная версия).
 * Основа: ui-updated.js (репо) — сохранены все функции репо.
 * Добавлено: toggleConsent() из ui (2).js (наработка).
 * Исправлено: export function stopPreCheckOnLeave + 5 недостающих функций
 */
import { state, recordSessionEvent } from './state.js';
import { translations } from '../../translations.js?v=20260828-2';
import { stopPreCheck, resetIndicatorsToWaiting, checkAllIndicators } from './precheck-updated.js?v=20260909-1';
import { measureRenderFPS } from './camera.js';
import { buildAggregatesPayload } from '../unified-aggregates-new.js?v=20260828-2';
import { hide as hideQcOverlay } from '../qc-pause-overlay-new.js';
import { getParticipantShell } from './protocol-invite-utils.js?v=20260914-3';
import { primeParticipantSession } from '../session-runtime/ingest-transport.mjs?v=20260807-1';

const MVP_STEP = {
    INTRO: 1,
    CONSENT: 2,
    EMAIL: 3,
    QUESTIONNAIRE: 4,
    PRECHECK: 5,
    SESSION: 6,
    FINAL: 7
};

function participantText(ru, en, es) {
    if (state.currentLang === 'ru') return ru;
    if (state.currentLang === 'es') return es || en;
    return en;
}

function invitationDefinition() {
    return typeof window !== 'undefined' ? window.__WECOG_STATE__?.runtime?.invitationProtocolDefinition : null;
}

function invitationShellConfig() {
    const fromRuntime = typeof window !== 'undefined'
        ? window.__WECOG_STATE__?.runtime?.invitationParticipantShell
        : null;
    if (fromRuntime) return fromRuntime;
    const def = invitationDefinition();
    return def ? getParticipantShell(def) : null;
}

function isInvitationSession() {
    const st = typeof window !== 'undefined' ? window.__WECOG_STATE__ : null;
    return !!(st?.sessionData?.ids?.invitationCode || st?.runtime?.invitationProtocolMeta?.code);
}

function resolveParticipantStep(stepNumber) {
    const target = resolveStepNumber(stepNumber, MVP_STEP.INTRO);
    const shell = invitationShellConfig();
    if (!shell || !isInvitationSession()) return target;

    if (target === MVP_STEP.CONSENT && !shell.consent) {
        return shell.questionnaire ? MVP_STEP.EMAIL : MVP_STEP.SESSION;
    }
    if (target === MVP_STEP.EMAIL && !shell.questionnaire) {
        return shell.precheck ? MVP_STEP.PRECHECK : MVP_STEP.SESSION;
    }
    if (target === MVP_STEP.QUESTIONNAIRE && !shell.questionnaire) {
        return shell.precheck ? MVP_STEP.PRECHECK : MVP_STEP.SESSION;
    }
    if (target === MVP_STEP.PRECHECK && !shell.precheck) {
        return MVP_STEP.SESSION;
    }
    return target;
}

async function maybeStartInvitationSessionAfterShell() {
    const shell = invitationShellConfig();
    if (!shell || !isInvitationSession()) return false;
    if (shell.precheck || shell.calibration) return false;
    try {
        const mod = await import('./tests-updated.js?v=20260914-3');
        if (typeof mod.continueInvitationSessionAfterShell === 'function') {
            mod.continueInvitationSessionAfterShell();
            return true;
        }
    } catch (e) {
        console.warn('[UI] invitation session start failed:', e);
    }
    return false;
}

function dbg(scope, event, data) {
    try {
        const d = window.WECOG_DEBUG;
        if (d && d.enabled) d.log(scope, event, data);
    } catch (_) { /* ignore */ }
}

function dbgErr(scope, event, data) {
    try {
        const d = window.WECOG_DEBUG;
        if (d && d.enabled) d.error(scope, event, data);
    } catch (_) { /* ignore */ }
}

function activeStepSnapshot() {
    const active = document.querySelector('.step.active');
    const visible = [];
    document.querySelectorAll('.step').forEach((el) => {
        if (el.offsetParent !== null || el.classList.contains('active')) {
            visible.push(el.id || '(no-id)');
        }
    });
    return {
        activeStepId: active ? active.id : null,
        visibleSteps: visible,
        precheckDisplay: document.getElementById('precheckContainer')?.style?.display ?? null
    };
}

// ── setLanguage ──────────────────────────────────────────────────────────────

export function setLanguage(lang) {
    const nextLang = Object.prototype.hasOwnProperty.call(translations, lang) ? lang : 'ru';
    const previousLang = state.currentLang;
    state.currentLang = nextLang;
    state.sessionData.user = state.sessionData.user || {};
    state.sessionData.user.interfaceLanguage = nextLang;
    try {
        localStorage.setItem('emocog_participant_lang', nextLang);
    } catch (_) {}

    document.documentElement.lang = nextLang;
    document.documentElement.dir = (nextLang === 'ar' || nextLang === 'ur') ? 'rtl' : 'ltr';
    document.getElementById('langRu')?.classList.toggle('active', nextLang === 'ru');
    document.getElementById('langEn')?.classList.toggle('active', nextLang === 'en');
    const localeSelect = document.getElementById('participantLanguageSelect');
    if (localeSelect && localeSelect.value !== nextLang) localeSelect.value = nextLang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[nextLang]?.[key]) {
            el.innerText = translations[nextLang][key];
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[nextLang]?.[key]) {
            el.setAttribute('placeholder', translations[nextLang][key]);
        }
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria-label');
        if (translations[nextLang]?.[key]) {
            el.setAttribute('aria-label', translations[nextLang][key]);
        }
    });

    // ID-превью (если уже сгенерирован)
    const idPreviewEl = document.getElementById('generatedIdPreview');
    if (idPreviewEl) {
        if (state.sessionData.ids.participant) {
            idPreviewEl.innerText =
                `${translations[nextLang].id_participant} ${state.sessionData.ids.participant}`;
        } else {
            idPreviewEl.innerText = translations[nextLang].id_not_generated;
        }
    }

    if (state.flags.isPrecheckRunning && state.runtime.precheckData) {
        checkAllIndicators();
    }

    if (previousLang !== nextLang) {
        recordSessionEvent('interface_language_changed', {
            category: 'session',
            from: previousLang || null,
            to: nextLang
        });
        window.dispatchEvent(new CustomEvent('wecog:languagechange', {
            detail: { from: previousLang || null, lang: nextLang }
        }));
    }
}

window.setLanguage = setLanguage;

// ── nextStep ─────────────────────────────────────────────────────────────────

function resolveStepNumber(stepNumber, fallback = 5) {
    const n = typeof stepNumber === 'number' ? stepNumber : parseInt(stepNumber, 10);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function ensureParticipantChromeVisible() {
    const container = document.querySelector('.container');
    const topBar = document.querySelector('.top-bar');
    if (container && container.style.display === 'none') {
        container.style.display = '';
    }
    if (topBar && topBar.style.display === 'none') {
        topBar.style.display = '';
    }
}

export function nextStep(stepNumber) {
    const targetStep = resolveParticipantStep(resolveStepNumber(stepNumber, 1));
    dbg('ui', 'step:change:request', { requested: stepNumber, resolved: targetStep, ...activeStepSnapshot() });

    // Уходим со step5 — останавливаем пречек
    if (document.getElementById('step5')?.classList.contains('active')) {
        stopPreCheckOnLeave();
    }

    // Скрываем QC-оверлей при смене шага
    try { hideQcOverlay(); } catch (_) {}

    if (targetStep === MVP_STEP.PRECHECK) {
        resetIndicatorsToWaiting();
        const precheck = document.getElementById('precheckContainer');
        if (precheck && precheck.style.display === 'none') {
            precheck.style.display = '';
        }
    }

    ensureParticipantChromeVisible();
    document.body.classList.toggle('cognitive-session-active', targetStep === MVP_STEP.SESSION);

    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const nextEl = document.getElementById('step' + targetStep);
    if (nextEl) {
        nextEl.classList.add('active');
        if (targetStep >= MVP_STEP.CONSENT && targetStep <= MVP_STEP.PRECHECK) {
            state.sessionData.shellStep = targetStep;
            void state.runtime?.sessionRuntime?.saveCheckpoint?.();
        }
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        dbg('ui', 'step:change:applied', { resolved: targetStep, activeDomId: nextEl.id, ...activeStepSnapshot() });
    } else {
        dbgErr('ui', 'step:change:invalid', { resolved: targetStep, missingId: 'step' + targetStep });
    }

    if (targetStep === MVP_STEP.SESSION) {
        void maybeStartInvitationSessionAfterShell();
    }
}

// ── toggleConsent ────────────────────────────────────────────────────────────

/**
 * Активирует кнопку «Далее» только если оба чекбокса согласия отмечены.
 * Вызывается из HTML: onchange="toggleConsent()"
 */
export function toggleConsent() {
    const consentRead  = document.getElementById('consentRead');
    const consentAgree = document.getElementById('consentAgree');
    const consentSingle = document.getElementById('consentCheck');
    const consentBtn   = document.getElementById('consentBtn');
    const consentError = document.getElementById('consentError');

    if (!consentBtn) return;

    // Backward-compatible: old markup has one checkbox (consentCheck),
    // newer markup has two checkboxes (consentRead + consentAgree).
    let isAccepted = false;
    if (consentRead && consentAgree) {
        isAccepted = consentRead.checked && consentAgree.checked;
    } else if (consentSingle) {
        isAccepted = !!consentSingle.checked;
    } else {
        return;
    }

    consentBtn.disabled = !isAccepted;

    if (consentError && isAccepted) {
        consentError.hidden = true;
        consentError.textContent = '';
    }
}

window.toggleConsent = toggleConsent;

// ── generateIdsAndProceed ────────────────────────────────────────────────────

export function generateUniqueId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    if (!globalThis.crypto?.getRandomValues) {
        throw new Error('Secure random ID generation is unavailable');
    }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
    return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join('')
    ].join('-');
}

export async function generateIdsAndProceed() {
    dbg('ui', 'button:consentBtn', { action: 'generateIdsAndProceed' });
    const sessionId = state.sessionData.ids.session || generateUniqueId();
    const participantId = state.sessionData.ids.participant || generateUniqueId();

    state.sessionData.ids.session     = sessionId;
    state.sessionData.ids.participant = participantId;
    state.sessionData.user.interfaceLanguage = state.currentLang;
    const consentCheck = document.getElementById('consentCheck');
    if (!consentCheck?.checked) {
        toggleConsent();
        return false;
    }
    state.sessionData.consent = {
        informed_consent: {
            accepted: true,
            documentVersion: 'informed-consent-v1.0',
            acceptedAt: new Date().toISOString(),
            participantId
        },
        privacy_policy: {
            accepted: true,
            documentVersion: 'privacy-policy-v1.0',
            acceptedAt: new Date().toISOString()
        }
    };

    console.log('[IDs Generated]', {
        session:     sessionId.substring(0, 8) + '...',
        participant: participantId.substring(0, 8) + '...'
    });

    if (state.sessionData.consent?.informed_consent) {
        state.sessionData.consent.informed_consent.participantId = participantId;
    }

    const idDisplay = document.getElementById('idDisplay');
    if (idDisplay) {
        idDisplay.style.display = 'block';
        idDisplay.innerText = `ID: ${participantId.substring(0, 8)}...`;
    }

    try {
        const invitationCode = state.sessionData.ids.invitationCode || null;
        if (invitationCode && !state.runtime?.invitationProtocolDefinition) {
            throw new Error('invitation_not_loaded');
        }
        await primeParticipantSession({
            sessionId,
            invitationCode
        });
        if (invitationCode) {
            const checkpointSaved = await state.runtime?.sessionRuntime?.saveCheckpoint?.();
            if (checkpointSaved !== true) {
                throw new Error('checkpoint_persistence_failed');
            }
        }
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.has('code')) {
            currentUrl.searchParams.delete('code');
            window.history.replaceState(
                window.history.state,
                '',
                currentUrl.pathname + currentUrl.search + currentUrl.hash
            );
        }
    } catch (error) {
        const consentError = document.getElementById('consentError');
        if (consentError) {
            consentError.hidden = false;
            consentError.textContent = translations[state.currentLang]?.session_reservation_error
                || participantText(
                    'Не удалось открыть сессию. Проверьте ссылку приглашения и подключение к сети.',
                    'The session could not be opened. Check the invitation link and network connection.',
                    'No se pudo abrir la sesión. Compruebe el enlace de invitación y la conexión.'
                );
        }
        recordSessionEvent('participant_admission_failed', {
            category: 'technical',
            severity: 'error',
            message: error?.message || String(error)
        });
        return false;
    }

    nextStep(MVP_STEP.EMAIL);
    return true;
}

window.generateIdsAndProceed = generateIdsAndProceed;

// ── submitEmail ──────────────────────────────────────────────────────────────

export function submitEmail() {
    const emailInput = document.getElementById('userEmail') || document.getElementById('emailInput');
    if (!emailInput) return;

    const email = emailInput.value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const errorEl = document.getElementById('emailError');

    if (!emailRegex.test(email)) {
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.innerText = participantText(
                'Введите корректный email',
                'Please enter a valid email',
                'Introduzca un correo electrónico válido'
            );
        }
        return;
    }

    if (errorEl) errorEl.style.display = 'none';

    generateIdsAndProceed();
}

window.submitEmail = submitEmail;

// ── submitForm ───────────────────────────────────────────────────────────────

export function submitForm() {
    const lang = state.currentLang;
    const t = translations[lang];

    const ageRaw = document.getElementById('age')?.value ?? document.getElementById('ageInput')?.value ?? '';
    const age    = Number(ageRaw);
    const gender = document.getElementById('gender')?.value ?? document.getElementById('genderSelect')?.value;

    const ageError = document.getElementById('ageError');
    if (isNaN(age) || age <= 0) {
        if (ageError) { ageError.style.display = 'block'; ageError.innerText = t.age_zero_error; }
        return;
    }
    if (age < 18) {
        if (ageError) { ageError.style.display = 'block'; ageError.innerText = t.age_min_error; }
        return;
    }
    if (age > 99) {
        if (ageError) { ageError.style.display = 'block'; ageError.innerText = t.age_max_error; }
        return;
    }
    if (ageError) ageError.style.display = 'none';

    state.sessionData.user.age         = age;
    state.sessionData.user.gender      = gender;
    state.sessionData.user.nativeLang  = document.getElementById('language')?.value   || document.getElementById('langSelect')?.value   || '';
    state.sessionData.user.education   = document.getElementById('education')?.value  || document.getElementById('eduSelect')?.value    || '';
    state.sessionData.user.vision      = document.getElementById('vision')?.value     || document.getElementById('visionSelect')?.value || 'none';
    state.sessionData.user.hand        = document.getElementById('hand')?.value       || document.getElementById('handSelect')?.value   || '';
    state.sessionData.user.inputDevice = document.getElementById('inputDevice')?.value || document.getElementById('deviceSelect')?.value || '';
    state.sessionData.user.keyboard    = document.getElementById('keyboardType')?.value || document.getElementById('keyboardSelect')?.value || '';

    nextStep(MVP_STEP.PRECHECK);
    return true;
}

window.submitForm = submitForm;

// ── copyIds ──────────────────────────────────────────────────────────────────

export function copyIds() {
    const ids = state.sessionData?.ids;
    if (!ids) return;
    const text = `Session: ${ids.session}\nParticipant: ${ids.participant}`;
    navigator.clipboard?.writeText(text).catch(() => {});
}

window.copyIds = copyIds;

// ── stopPreCheckOnLeave ──────────────────────────────────────────────────────
// ✅ ИСПРАВЛЕНО: function → export function

export function stopPreCheckOnLeave() {
    try {
        stopPreCheck();
        state.flags.isPrecheckRunning = false;
    } catch (e) {
        console.warn('[UI] stopPreCheckOnLeave error:', e);
    }
}

window.stopPreCheckOnLeave = stopPreCheckOnLeave;

// ── measureFPS helper ────────────────────────────────────────────────────────

export async function checkRenderFPS() {
    try {
        const fps = await measureRenderFPS();
        state.runtime.renderFPS = fps;
        console.log('[UI] Render FPS:', fps);
    } catch (e) {
        console.warn('[UI] measureRenderFPS error:', e);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// НОВЫЕ ФУНКЦИИ — требуются app-updated.js
// ════════════════════════════════════════════════════════════════════════════

// ── checkForm ────────────────────────────────────────────────────────────────

export function checkForm() {
    const lang = state.currentLang || 'ru';
    const t    = translations[lang];

    const ageRaw = String(
        document.getElementById('age')?.value
        ?? document.getElementById('ageInput')?.value
        ?? ''
    );
    const age    = Number(ageRaw);
    const gender = document.getElementById('gender')?.value ?? document.getElementById('genderSelect')?.value;
    const edu    = document.getElementById('education')?.value ?? document.getElementById('eduSelect')?.value;

    const ageValid  = ageRaw.trim() !== ''
        && Number.isInteger(age)
        && age >= 18
        && age <= 99;
    const allFilled = ageValid
        && gender && gender !== ''
        && edu    && edu    !== '';

    const btn = document.getElementById('formBtn') || document.getElementById('btnSubmitForm');
    if (btn) btn.disabled = !allFilled;

    // Подсветка поля возраста
    const ageInput = document.getElementById('age') || document.getElementById('ageInput');
    if (ageInput && ageInput.value !== '') {
        ageInput.classList.toggle('input-error', !ageValid);
        ageInput.classList.toggle('input-ok',    ageValid);
    }

    return allFilled;
}

window.checkForm = checkForm;

// ── validateEmailField ───────────────────────────────────────────────────────

export function validateEmailField() {
    const emailInput = document.getElementById('userEmail') || document.getElementById('emailInput');
    const btn        = document.getElementById('btnSubmitEmail');
    const errorEl    = document.getElementById('emailError');

    if (!emailInput) return false;

    const value   = emailInput.value.trim();
    const isEmpty = value === '';
    // Email необязателен — пустое поле считается валидным
    const isValid = isEmpty || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

    emailInput.classList.toggle('input-error', !isValid);
    emailInput.classList.toggle('input-ok',    isValid && !isEmpty);

    if (errorEl) errorEl.style.display = isValid ? 'none' : 'block';
    if (btn)     btn.disabled = !isValid;

    return isValid;
}

window.validateEmailField = validateEmailField;

function validateEmail(email) {
    const lang = state.currentLang || 'ru';
    const t = translations[lang] || {};
    if (!email || email.trim() === '') {
        return { valid: false, error: t.email_required || 'Email required' };
    }
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
    if (emojiRegex.test(email)) {
        return { valid: false, error: t.email_emoji_error || 'Invalid email' };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return { valid: false, error: t.email_format_error || 'Invalid email format' };
    }
    if (email.includes('..')) {
        return { valid: false, error: t.email_double_dots || 'Invalid email' };
    }
    if (email.includes(' ')) {
        return { valid: false, error: t.email_spaces_error || 'Invalid email' };
    }
    if (/[а-яё]/i.test(email)) {
        return { valid: false, error: t.email_cyrillic_error || 'Invalid email' };
    }
    return { valid: true };
}

// ── collectTechDataAndProceed ────────────────────────────────────────────────

export async function collectTechDataAndProceed(nextStepNumber = MVP_STEP.QUESTIONNAIRE) {
    const targetStep = resolveParticipantStep(resolveStepNumber(nextStepNumber, MVP_STEP.PRECHECK));
    dbg('ui', 'collectTechDataAndProceed', { requestedNext: nextStepNumber, resolved: targetStep });

    const emailInput = document.getElementById('userEmail') || document.getElementById('emailInput');
    const email = emailInput ? emailInput.value.trim() : '';
    const invitationCode = state.sessionData?.ids?.invitationCode;

    const emailValidation = validateEmail(email);
    if (!email && invitationCode) {
        // Респондент по приглашению — email необязателен.
    } else if (!emailValidation.valid) {
        if (emailInput) {
            emailInput.setAttribute('aria-invalid', 'true');
            emailInput.classList.add('error', 'input-error');
            emailInput.classList.remove('input-ok');
            let errorMsg = document.getElementById('emailError');
            if (!errorMsg) {
                errorMsg = document.createElement('div');
                errorMsg.id = 'emailError';
                errorMsg.className = 'error-message';
                errorMsg.style.cssText = 'color: var(--error); font-size: 12px; margin-top: 5px;';
                emailInput.parentElement.appendChild(errorMsg);
            }
            errorMsg.textContent = emailValidation.error;
            errorMsg.style.display = 'block';
        }
        return;
    }

    if (emailInput) {
        emailInput.removeAttribute('aria-invalid');
        emailInput.classList.remove('error', 'input-error');
        const errorMsg = document.getElementById('emailError');
        if (errorMsg) errorMsg.style.display = 'none';
    }
    state.sessionData.tech.screen = {
        width: window.screen.width,
        height: window.screen.height,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
        pixelRatio: window.devicePixelRatio || 1
    };

    const ua = String(navigator.userAgent || '');
    const browserFamily = /Firefox\//.test(ua)
        ? 'firefox'
        : (/Edg\//.test(ua)
            ? 'edge'
            : (/Chrome\//.test(ua)
                ? 'chromium'
                : (/Safari\//.test(ua) ? 'safari' : 'other')));
    const cores = Number(navigator.hardwareConcurrency);
    state.sessionData.tech.browser = {
        family: browserFamily,
        language: navigator.language || null,
        mobile: /Android|iPhone|iPad|Mobile/i.test(ua),
        coresBucket: Number.isFinite(cores)
            ? (cores <= 2 ? '1-2' : (cores <= 4 ? '3-4' : (cores <= 8 ? '5-8' : '9+')))
            : 'unknown'
    };

    try {
        const renderFps = await measureRenderFPS();
        state.sessionData.tech.measuredFPS = renderFps;
        state.sessionData.tech.renderFPS = renderFps;
    } catch (err) {
        console.warn('[UI] measureRenderFPS error:', err);
    }

    nextStep(targetStep);
}

window.collectTechDataAndProceed = collectTechDataAndProceed;

// ── updateFinalStepWithQC ────────────────────────────────────────────────────

function renderFinalQcMetrics(payload, lang) {
    const container = document.getElementById('finalQcSummary');
    if (!container || !payload) {
        if (container) container.innerHTML = '';
        return;
    }
    const t = translations[lang] || {};
    const attention = payload.attentionMetrics || {};
    const emotion = payload.emotion_summary || {};
    const blinkCount = payload.blink_summary?.blinkCount;
    const perclos = payload.perclos_summary?.windows?.['60s']?.meanPct
        ?? payload.perclos_summary?.windows?.['30s']?.meanPct;
    const attentionAverage = Number.isFinite(attention.averageAttention)
        ? attention.averageAttention
        : (Number.isFinite(perclos) ? Math.max(0, 1 - perclos / 100) : null);
    const hasMetrics = attentionAverage != null
        || emotion.valence_mean != null
        || emotion.arousal_mean != null
        || blinkCount != null
        || perclos != null;
    if (!hasMetrics) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = `
        <div class="qc-metric">
            <span class="qc-label">${t.qc_attention_label || 'Внимание'}</span>
            <span class="qc-value">${Number.isFinite(attentionAverage) ? `${Math.round(attentionAverage * 100)}%` : '—'}</span>
        </div>
        <div class="qc-metric">
            <span class="qc-label">${t.qc_blinks_label || 'Моргания'}</span>
            <span class="qc-value">${Number.isFinite(blinkCount) ? Math.round(blinkCount) : '—'}</span>
        </div>
        <div class="qc-metric">
            <span class="qc-label">PERCLOS</span>
            <span class="qc-value">${Number.isFinite(perclos) ? `${Number(perclos).toFixed(1)}%` : '—'}</span>
        </div>
        <div class="qc-metric">
            <span class="qc-label">${t.qc_valence_label || 'Валентность'}</span>
            <span class="qc-value">${Number.isFinite(emotion.valence_mean) ? emotion.valence_mean.toFixed(2) : '—'}</span>
        </div>
        <div class="qc-metric">
            <span class="qc-label">${t.qc_arousal_label || 'Возбуждение'}</span>
            <span class="qc-value">${Number.isFinite(emotion.arousal_mean) ? emotion.arousal_mean.toFixed(2) : '—'}</span>
        </div>
    `;
}

export function updateFinalStepWithQC(qcSummary, options = {}) {
    try {
        hideQcOverlay();
    } catch (_) {}

    const lang = state.currentLang || 'ru';
    const t = translations[lang] || {};
    const qcStatusEl = document.getElementById('qcStatusBlock');

    if (qcStatusEl) {
        const serverValidity = ['valid', 'borderline', 'invalid'].includes(options.serverValidity)
            ? options.serverValidity
            : null;
        if (!qcSummary && !serverValidity) {
            qcStatusEl.innerHTML = `
                <div class="qc-status-pending">
                    <strong>${lang === 'ru' ? 'QC рассчитывается' : (lang === 'es' ? 'Calculando el control de calidad' : 'QC is being calculated')}</strong>
                </div>
            `;
        } else {
        const passed = serverValidity ? serverValidity === 'valid' : qcSummary?.overallPass === true;
        const validGazePct = qcSummary?.gazeValidPct || 0;
        const faceOkPct = qcSummary?.faceOkPct || 0;
        const durationMs = qcSummary?.durationMs || 0;

        if (passed) {
            qcStatusEl.innerHTML = `
                <div class="qc-status-passed">
                    <strong>${t.qc_passed_full || t.qc_passed || 'QC Passed'}</strong>
                    <div class="qc-status-details">
                        ${t.qc_duration || 'Duration'}: ${Math.round(durationMs / 1000)}${t.seconds || 's'} |
                        ${t.qc_valid || 'Valid gaze'}: ${validGazePct.toFixed(1)}${t.percent || '%'} |
                        ${t.qc_face_ok || 'Face OK'}: ${faceOkPct.toFixed(1)}${t.percent || '%'}
                    </div>
                </div>
            `;
        } else {
            const issues = [];
            if (qcSummary?.checks) {
                if (!qcSummary.checks.duration) issues.push(t.issue_short_duration);
                if (!qcSummary.checks.faceVisible) issues.push(t.issue_low_face_visible);
                if (!qcSummary.checks.faceOk) issues.push(t.issue_low_face_ok_pct);
                if (!qcSummary.checks.poseOk) issues.push(t.issue_low_pose_ok_pct);
                if (!qcSummary.checks.illuminationOk) issues.push(t.issue_low_illumination_ok_pct);
                if (!qcSummary.checks.eyesOpen) issues.push(t.issue_low_eyes_open_pct);
                if (!qcSummary.checks.occlusion) issues.push(t.issue_high_occlusion_pct);
                if (!qcSummary.checks.gazeValid) issues.push(t.issue_low_gaze_valid_pct);
                if (!qcSummary.checks.gazeOnScreen) issues.push(t.issue_high_offscreen);
                if (!qcSummary.checks.lowFps) issues.push(t.issue_low_fps_time);
            }
            const issuesList = issues.filter(Boolean).join(', ');
            const statusLabel = serverValidity === 'borderline'
                ? (lang === 'ru' ? 'QC: пограничное качество' : (lang === 'es' ? 'QC: calidad límite' : 'QC: borderline quality'))
                : (t.qc_failed_full || 'QC Failed');
            qcStatusEl.innerHTML = `
                <div class="qc-status-failed">
                    <strong>${statusLabel}</strong>
                    <div style="font-size: 12px; margin-top: 8px;">
                        ${t.qc_issues || 'Issues'}: ${issuesList || (lang === 'ru' ? 'недостаточно валидного сигнала' : (lang === 'es' ? 'señal válida insuficiente' : 'insufficient valid signal'))}
                    </div>
                    <div style="font-size: 12px; margin-top: 4px; opacity: 0.8;">
                        ${t.qc_duration || 'Duration'}: ${Math.round(durationMs / 1000)}${t.seconds || 's'} |
                        ${t.qc_valid || 'Valid gaze'}: ${validGazePct.toFixed(1)}${t.percent || '%'} |
                        ${t.qc_face_ok || 'Face OK'}: ${faceOkPct.toFixed(1)}${t.percent || '%'}
                    </div>
                </div>
            `;
        }
        }
    }

    try {
        renderFinalQcMetrics(buildAggregatesPayload(state.sessionData), lang);
    } catch (err) {
        console.warn('[UI] final metrics render error:', err);
    }
}

window.updateFinalStepWithQC = updateFinalStepWithQC;

// ── downloadData ─────────────────────────────────────────────────────────────

export function downloadData() {
    try {
        const aggregatesOnly = document.getElementById('aggregatesOnlyCheckbox')?.checked;
        const sessionId = state.sessionData?.ids?.session || 'session';
        const data = aggregatesOnly
            ? buildAggregatesPayload(state.sessionData)
            : state.sessionData;
        const fileName = aggregatesOnly
            ? `session_${sessionId}_aggregates.json`
            : `session_${sessionId}.json`;
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('[UI] downloadData error:', err);
    }
}

window.downloadData = downloadData;
