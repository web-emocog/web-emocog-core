/**
 * UI-модуль (финальная версия).
 * Основа: ui-updated.js (репо) — сохранены все функции репо.
 * Добавлено: toggleConsent() из ui (2).js (наработка).
 */
import { state } from './state.js';
import { translations } from '../translations.js';
import { stopPreCheck, resetIndicatorsToWaiting, checkAllIndicators } from './precheck-updated.js';
import { measureRenderFPS } from './camera.js';
import { buildAggregatesPayload } from '../unified-aggregates-new.js';
import { hide as hideQcOverlay } from '../qc-pause-overlay-new.js';

// ── setLanguage ──────────────────────────────────────────────────────────────

export function setLanguage(lang) {
    const nextLang = (lang === 'en') ? 'en' : 'ru';
    state.currentLang = nextLang;
    try {
        localStorage.setItem('emocog_participant_lang', nextLang);
    } catch (_) {}

    document.getElementById('langRu').classList.toggle('active', nextLang === 'ru');
    document.getElementById('langEn').classList.toggle('active', nextLang === 'en');

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[nextLang]?.[key]) {
            el.innerText = translations[nextLang][key];
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
}

window.setLanguage = setLanguage;

// ── initSecureSenderToggle ───────────────────────────────────────────────────

export function initSecureSenderToggle() {
    const checkbox = document.getElementById('secureSenderCheckbox');
    if (!checkbox) return;

    const params = new URLSearchParams(window.location.search);
    const fromQuery   = params.get('secure_sender');
    const fromStorage = localStorage.getItem('emocog_use_secure_sender');
    const initialEnabled =
        window.__EMOCOG_USE_SECURE_SENDER__ === true ||
        fromQuery   === '1' ||
        fromStorage === '1' ||
        fromStorage === 'true';

    checkbox.checked = initialEnabled;
    window.__EMOCOG_USE_SECURE_SENDER__ = initialEnabled;

    checkbox.addEventListener('change', () => {
        const enabled = checkbox.checked;
        window.__EMOCOG_USE_SECURE_SENDER__ = enabled;
        localStorage.setItem('emocog_use_secure_sender', enabled ? '1' : '0');
    });
}

// ── nextStep ─────────────────────────────────────────────────────────────────

export function nextStep(stepNumber) {
    // Уходим со step5 — останавливаем пречек
    if (document.getElementById('step5')?.classList.contains('active')) {
        stopPreCheckOnLeave();
    }

    // Скрываем QC-оверлей при смене шага
    try { hideQcOverlay(); } catch (_) {}

    if (stepNumber === 5) {
        resetIndicatorsToWaiting();
    }

    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const nextEl = document.getElementById('step' + stepNumber);
    if (nextEl) nextEl.classList.add('active');
}

// ── toggleConsent ────────────────────────────────────────────────────────────
// Добавлено из ui (2).js: проверяет оба чекбокса согласия

/**
 * Активирует кнопку «Далее» только если оба чекбокса согласия отмечены.
 * Вызывается из HTML: onchange="toggleConsent()"
 */
export function toggleConsent() {
    const consentRead  = document.getElementById('consentRead');
    const consentAgree = document.getElementById('consentAgree');
    const consentBtn   = document.getElementById('consentBtn');
    const consentError = document.getElementById('consentError');

    if (!consentRead || !consentAgree || !consentBtn) return;

    const bothChecked = consentRead.checked && consentAgree.checked;
    consentBtn.disabled = !bothChecked;

    // Скрываем сообщение об ошибке если оба отмечены
    if (consentError) {
        consentError.style.display = bothChecked ? 'none' : '';
    }
}

window.toggleConsent = toggleConsent;

// ── generateIdsAndProceed ────────────────────────────────────────────────────

function generateUniqueId() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function generateIdsAndProceed() {
    const sessionId     = generateUniqueId();
    const participantId = generateUniqueId();

    state.sessionData.ids.session     = sessionId;
    state.sessionData.ids.participant = participantId;
    state.sessionData.user.interfaceLanguage = state.currentLang;

    console.log('[IDs Generated]', {
        session:     sessionId.substring(0, 8) + '...',
        participant: participantId.substring(0, 8) + '...'
    });

    // Обновляем consent.participantId если согласие уже подписано
    if (state.sessionData.consent?.informed_consent) {
        state.sessionData.consent.informed_consent.participantId = participantId;
    }

    // Показываем badge с ID
    const idDisplay = document.getElementById('idDisplay');
    if (idDisplay) {
        idDisplay.style.display = 'block';
        idDisplay.innerText = `ID: ${participantId.substring(0, 8)}...`;
    }

    nextStep(3);
}

window.generateIdsAndProceed = generateIdsAndProceed;

// ── submitEmail ──────────────────────────────────────────────────────────────

export function submitEmail() {
    const emailInput = document.getElementById('emailInput');
    if (!emailInput) return;

    const email = emailInput.value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const errorEl = document.getElementById('emailError');

    if (!emailRegex.test(email)) {
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.innerText = state.currentLang === 'ru'
                ? 'Введите корректный email'
                : 'Please enter a valid email';
        }
        return;
    }

    if (errorEl) errorEl.style.display = 'none';

    state.sessionData.user.email = email;
    generateIdsAndProceed();
}

window.submitEmail = submitEmail;

// ── submitForm ───────────────────────────────────────────────────────────────

export function submitForm() {
    const lang = state.currentLang;
    const t = translations[lang];

    const age    = parseInt(document.getElementById('ageInput')?.value);
    const gender = document.getElementById('genderSelect')?.value;

    // Валидация возраста
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

    // Сохраняем данные формы
    state.sessionData.user.age    = age;
    state.sessionData.user.gender = gender;
    state.sessionData.user.nativeLang  = document.getElementById('langSelect')?.value  || '';
    state.sessionData.user.education   = document.getElementById('eduSelect')?.value   || '';
    state.sessionData.user.vision      = document.getElementById('visionSelect')?.value || 'none';
    state.sessionData.user.hand        = document.getElementById('handSelect')?.value   || '';
    state.sessionData.user.inputDevice = document.getElementById('deviceSelect')?.value || '';
    state.sessionData.user.keyboard    = document.getElementById('keyboardSelect')?.value || '';

    nextStep(5);
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

function stopPreCheckOnLeave() {
    try {
        stopPreCheck();
        state.flags.isPrecheckRunning = false;
    } catch (e) {
        console.warn('[UI] stopPreCheckOnLeave error:', e);
    }
}

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