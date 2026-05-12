/**
 * UI-модуль (финальная версия).
 * Основа: ui-updated.js (репо) — сохранены все функции репо.
 * Добавлено: toggleConsent() из ui (2).js (наработка).
 * Исправлено: export function stopPreCheckOnLeave + 5 недостающих функций
 */
import { state } from './state.js';
import { translations } from '../../translations.js';
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

    if (consentError) {
        consentError.style.display = isAccepted ? 'none' : '';
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

    if (state.sessionData.consent?.informed_consent) {
        state.sessionData.consent.informed_consent.participantId = participantId;
    }

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
    state.sessionData.user.nativeLang  = document.getElementById('langSelect')?.value   || '';
    state.sessionData.user.education   = document.getElementById('eduSelect')?.value    || '';
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

    const age    = parseInt(document.getElementById('ageInput')?.value);
    const gender = document.getElementById('genderSelect')?.value;
    const edu    = document.getElementById('eduSelect')?.value;

    const ageValid  = !isNaN(age) && age >= 18 && age <= 99;
    const allFilled = ageValid
        && gender && gender !== ''
        && edu    && edu    !== '';

    const btn = document.getElementById('btnSubmitForm');
    if (btn) btn.disabled = !allFilled;

    // Подсветка поля возраста
    const ageInput = document.getElementById('ageInput');
    if (ageInput && ageInput.value !== '') {
        ageInput.classList.toggle('input-error', !ageValid);
        ageInput.classList.toggle('input-ok',    ageValid);
    }

    return allFilled;
}

window.checkForm = checkForm;

// ── validateEmailField ───────────────────────────────────────────────────────

export function validateEmailField() {
    const emailInput = document.getElementById('emailInput');
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

// ── collectTechDataAndProceed ────────────────────────────────────────────────

export function collectTechDataAndProceed(nextStepNumber = 5) {
    try {
        const techData = {
            userAgent:        navigator.userAgent,
            platform:         navigator.platform,
            language:         navigator.language,
            screenW:          screen.width,
            screenH:          screen.height,
            devicePixelRatio: window.devicePixelRatio || 1,
            colorDepth:       screen.colorDepth,
            timezone:         Intl.DateTimeFormat().resolvedOptions().timeZone,
            timestamp:        Date.now(),
            vision:    document.getElementById('visionSelect')?.value   || '',
            lighting:  document.getElementById('lightingSelect')?.value || '',
            distance:  document.getElementById('distanceSelect')?.value || ''
        };

        if (state.sessionData) {
            state.sessionData.techData = techData;
        }

        console.log('[UI] Технические данные собраны:', techData);
    } catch (err) {
        console.warn('[UI] collectTechDataAndProceed error:', err);
    }

    nextStep(nextStepNumber);
}

window.collectTechDataAndProceed = collectTechDataAndProceed;

// ── updateFinalStepWithQC ────────────────────────────────────────────────────

export function updateFinalStepWithQC() {
    try {
        hideQcOverlay();

        const payload   = buildAggregatesPayload(state.sessionData);
        const lang      = state.currentLang || 'ru';
        const t         = translations[lang];
        const container = document.getElementById('finalQcSummary');

        if (container && payload) {
            const attention = payload.attentionMetrics || {};
            const emotion   = payload.emotionMetrics   || {};

            container.innerHTML = `
                <div class="qc-metric">
                    <span class="qc-label">${t?.qc_attention_label || 'Внимание'}</span>
                    <span class="qc-value">${Math.round((attention.averageAttention || 0) * 100)}%</span>
                </div>
                <div class="qc-metric">
                    <span class="qc-label">${t?.qc_valence_label || 'Валентность'}</span>
                    <span class="qc-value">${(emotion.averageValence || 0).toFixed(2)}</span>
                </div>
                <div class="qc-metric">
                    <span class="qc-label">${t?.qc_arousal_label || 'Возбуждение'}</span>
                    <span class="qc-value">${(emotion.averageArousal || 0).toFixed(2)}</span>
                </div>
            `;
        }

        console.log('[UI] Финальный шаг обновлён с QC-данными');
    } catch (err) {
        console.warn('[UI] updateFinalStepWithQC error:', err);
    }
}

window.updateFinalStepWithQC = updateFinalStepWithQC;

// ── downloadData ─────────────────────────────────────────────────────────────

export function downloadData() {
    try {
        const payload       = buildAggregatesPayload(state.sessionData);
        const json          = JSON.stringify(payload, null, 2);
        const blob          = new Blob([json], { type: 'application/json' });
        const url           = URL.createObjectURL(blob);
        const participantId = state.sessionData?.ids?.participant || 'unknown';
        const timestamp     = new Date().toISOString().replace(/[:.]/g, '-');
        const filename      = `emocog_${participantId}_${timestamp}.json`;

        const a = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`[UI] Данные скачаны: ${filename}`);
    } catch (err) {
        console.error('[UI] downloadData error:', err);
    }
}

window.downloadData = downloadData;