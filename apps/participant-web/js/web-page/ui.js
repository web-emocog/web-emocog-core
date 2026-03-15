import { state } from './state.js';
import { translations } from '../../translations.js';
import { stopPreCheck, resetIndicatorsToWaiting } from './precheck.js';
import { measureRenderFPS } from './camera.js';

export function setLanguage(lang) {
    state.currentLang = lang;
    
    // Обновляем кнопки языка
    document.getElementById('langRu').classList.toggle('active', lang === 'ru');
    document.getElementById('langEn').classList.toggle('active', lang === 'en');

    // Обновляем все текстовые элементы
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {
            el.innerText = translations[lang][key];
        }
    });

    // ✅ ID не показывается участнику

    if (state.flags.isPrecheckRunning && state.runtime.precheckData) {
        checkAllIndicators(); 
    }
}


window.setLanguage = setLanguage;

export function nextStep(stepNumber) {
    // Если уходим со step5, останавливаем пречек
    if (document.getElementById('step5').classList.contains('active')) {
        stopPreCheckOnLeave();
    }

    if (stepNumber === 5) {
        resetIndicatorsToWaiting();
    }
    
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const nextEl = document.getElementById('step' + stepNumber);
    if (nextEl) nextEl.classList.add('active');
}

/**
 * Проверяет, отмечены ли оба чекбокса согласия.
 * Активирует кнопку "Далее" только если оба отмечены.
 */
export function toggleConsent() {
    const consentRead = document.getElementById('consentRead');
    const consentAgree = document.getElementById('consentAgree');
    const consentBtn = document.getElementById('consentBtn');
    
    if (!consentRead || !consentAgree || !consentBtn) return;
    
    // Кнопка активна только если ОБА чекбокса отмечены
    const bothChecked = consentRead.checked && consentAgree.checked;
    consentBtn.disabled = !bothChecked;
}

// Делаем функцию доступной глобально
window.toggleConsent = toggleConsent;


// Генерация UUID v4 (криптографически стойкий)
function generateUniqueId() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    } else {
        // Fallback для старых браузеров
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

export function generateIdsAndProceed() {
    // Генерируем UUID для session и participant
    const sessionId = generateUniqueId();
    const participantId = generateUniqueId();
    
    state.sessionData.ids.session = sessionId;
    state.sessionData.ids.participant = participantId;
    state.sessionData.user.interfaceLanguage = state.currentLang;

    // ✅ ID записывается только в state, НЕ показывается участнику
    console.log('[IDs Generated]', { 
        session: sessionId.substring(0, 8) + '...', 
        participant: participantId.substring(0, 8) + '...' 
    });

    // ✅ НОВОЕ: Обновляем participantId в подписи
    if (state.sessionData.consent?.informed_consent) {
        state.sessionData.consent.informed_consent.participantId = state.participantId;
        console.log('[Consent] ✅ Updated signature with real participant ID');
    }

    nextStep(3);
}


// Валидация email
export function validateEmailField() {
    const emailInput = document.getElementById('userEmail');
    const email = emailInput.value.trim();
    const validation = validateEmail(email);
    
    if (!validation.valid) {
        emailInput.setAttribute('aria-invalid', 'true');
        emailInput.classList.add('error');
        showFieldError(emailInput, validation.error);
    } else {
        emailInput.removeAttribute('aria-invalid');
        emailInput.classList.remove('error');
        hideFieldError(emailInput);
    }
}

function validateEmail(email) {
    if (!email || email.trim() === '') {
        return { valid: false, error: translations[state.currentLang].email_required };
    }
    
    // Проверка на emoji и специальные символы (до базовой проверки)
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
    if (emojiRegex.test(email)) {
        return { valid: false, error: translations[state.currentLang].email_emoji_error };
    }
    
    // Базовые проверки формата
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return { valid: false, error: translations[state.currentLang].email_format_error };
    }
    
    // Дополнительные проверки
    if (email.includes('..')) {
        return { valid: false, error: translations[state.currentLang].email_double_dots };
    }
    
    if (email.includes(' ')) {
        return { valid: false, error: translations[state.currentLang].email_spaces_error };
    }
    
    // Проверка на кириллицу (опционально, можно убрать если нужно)
    if (/[а-яё]/i.test(email)) {
        return { valid: false, error: translations[state.currentLang].email_cyrillic_error };
    }
    
    return { valid: true };
}

/**
 * Валидация и сохранение данных анкеты (Step 4)
 * Возвращает true если форма валидна, false если нет
 * НЕ переходит к следующему шагу (это делает app.js)
 */
export function checkForm() {
    // 1. Проверяем обязательные поля
    const required = ['age', 'gender', 'inputDevice', 'keyboardType', 'vision'];
    let isValid = true;
    
    required.forEach(id => {
        const el = document.getElementById(id);
        if (!el || !el.value) {
            isValid = false;
            if (el) {
                el.setAttribute('aria-invalid', 'true');
                el.classList.add('error');
                showFieldError(el, translations[state.currentLang][`${id}_required`] || `Поле обязательно`);
            }
        } else {
            if (el) {
                el.removeAttribute('aria-invalid');
                el.classList.remove('error');
                hideFieldError(el);
            }
        }
    });
    
    // 2. Валидация возраста (диапазон 18-99)
    const ageInput = document.getElementById('age');
    if (ageInput && ageInput.value) {
        const age = parseInt(ageInput.value, 10);
        const ageValue = ageInput.value.trim();
        
        // Проверка на число
        if (isNaN(age) || ageValue !== age.toString()) {
            isValid = false;
            ageInput.setAttribute('aria-invalid', 'true');
            ageInput.classList.add('error');
            showFieldError(ageInput, translations[state.currentLang].age_integer_error);
        }
        // Проверка диапазона
        else if (age < 18 || age > 99) {
            isValid = false;
            ageInput.setAttribute('aria-invalid', 'true');
            ageInput.classList.add('error');
            if (age < 18) {
                showFieldError(ageInput, translations[state.currentLang].age_min_error);
            } else {
                showFieldError(ageInput, translations[state.currentLang].age_max_error);
            }
        }
        // Проверка на отрицательные числа
        else if (age < 0) {
            isValid = false;
            ageInput.setAttribute('aria-invalid', 'true');
            ageInput.classList.add('error');
            showFieldError(ageInput, translations[state.currentLang].age_negative_error);
        }
        // Проверка на ноль
        else if (age === 0) {
            isValid = false;
            ageInput.setAttribute('aria-invalid', 'true');
            ageInput.classList.add('error');
            showFieldError(ageInput, translations[state.currentLang].age_zero_error);
        }
        // Валидно
        else {
            ageInput.removeAttribute('aria-invalid');
            ageInput.classList.remove('error');
            hideFieldError(ageInput);
        }
    }

    // 3. Обновляем состояние кнопки
    const formBtn = document.getElementById('formBtn');
    if (formBtn) {
        formBtn.disabled = !isValid;
    }

    // 4. Если форма невалидна — выходим
    if (!isValid) {
        console.warn('[checkForm] Форма невалидна');
        return false;
    }

    // 5. ✅ Сохраняем данные в state.sessionData.user
    state.sessionData.user = {
        ...state.sessionData.user,
        age: parseInt(document.getElementById('age').value, 10),
        gender: document.getElementById('gender').value,
        education: document.getElementById('education')?.value || 'not_specified',
        language: document.getElementById('language')?.value || 'not_specified',
        vision: document.getElementById('vision').value,
        hand: document.getElementById('hand')?.value || 'not_specified',
        inputDevice: document.getElementById('inputDevice').value,
        keyboardType: document.getElementById('keyboardType').value
    };

    // 6. ✅ Записываем событие завершения анкеты
    if (typeof recordSessionEvent === 'function') {
        recordSessionEvent('questionnaire_completed', {
            participant_id: state.sessionData.ids.participant,
            age: state.sessionData.user.age,
            gender: state.sessionData.user.gender,
            inputDevice: state.sessionData.user.inputDevice,
            keyboardType: state.sessionData.user.keyboardType
        });
    }

    console.log('[checkForm] Данные анкеты сохранены:', state.sessionData.user);

    // 7. ✅ Возвращаем true (переход делает app.js)
    return true;
}



export async function collectTechDataAndProceed() {
    const emailInput = document.getElementById('userEmail');
    const consentStorage = document.getElementById('emailConsentStorage');
    const consentContact = document.getElementById('emailConsentContact');
    const email = emailInput.value.trim();
    
    // Валидация email
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
        emailInput.setAttribute('aria-invalid', 'true');
        emailInput.classList.add('error');
        showFieldError(emailInput, emailValidation.error);
        return;
    }
    
    // Проверка чекбоксов (оба обязательны)
    if (!consentStorage.checked || !consentContact.checked) {
        alert(translations[state.currentLang].consent_required || 'Необходимо отметить оба согласия');
        return;
    }
    
    // Убираем ошибку если валидно
    emailInput.removeAttribute('aria-invalid');
    emailInput.classList.remove('error');
    hideFieldError(emailInput);
    
    // Сохраняем email и согласия
    state.sessionData.user.email = email;
    state.sessionData.user.emailConsentStorage = true;
    state.sessionData.user.emailConsentContact = consentContact.checked;
    state.sessionData.user.emailConsentTimestamp = new Date().toISOString();

    // Хешируем email для логов (не храним plaintext в событиях)
    const emailHash = await hashEmail(email);
    
    // Записываем событие
    if (typeof recordSessionEvent === 'function') {
        recordSessionEvent('email_submitted', {
            participant_id: state.sessionData.ids.participant,
            email_hash: emailHash,
            consent_storage: true,
            consent_contact: consentContact.checked
        });
    }

    console.log('[Email Step Complete]', {
        participant_id: state.sessionData.ids.participant,
        email_hash: emailHash,
        consent_storage: true,
        consent_contact: consentContact.checked
    });

    // Собираем технические данные
    state.sessionData.tech.screen = {
        width: window.screen.width,
        height: window.screen.height,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
        pixelRatio: window.devicePixelRatio || 1
    };

    state.sessionData.tech.browser = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        cores: navigator.hardwareConcurrency || 'unknown',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };

    // Измеряем FPS рендеринга
    measureRenderFPS().then(renderFps => {
        state.sessionData.tech.measuredFPS = renderFps;
        state.sessionData.tech.renderFPS = renderFps;
        nextStep(4); // Переход на анкету
    });
}

// Хеширование email для логов (SHA-256)
async function hashEmail(email) {
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(email.toLowerCase().trim());
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        console.error('[Hash Error]', error);
        return 'hash_unavailable';
    }
}


export function downloadData() {
    const fileName = `session_${state.sessionData.ids.session}.json`;
    const dataStr = "data:text/json;charset=utf-8," + 
        encodeURIComponent(JSON.stringify(state.sessionData, null, 2));
    const node = document.createElement('a');
    node.setAttribute("href", dataStr);
    node.setAttribute("download", fileName);
    document.body.appendChild(node);
    node.click();
    node.remove();
}

// Показать ошибку поля
function showFieldError(field, message) {
    let errorMsg = field.parentElement.querySelector('.field-error');
    if (!errorMsg) {
        errorMsg = document.createElement('div');
        errorMsg.className = 'field-error';
        field.parentElement.appendChild(errorMsg);
    }
    errorMsg.textContent = message;
}

// Скрыть ошибку поля
function hideFieldError(field) {
    const errorMsg = field.parentElement.querySelector('.field-error');
    if (errorMsg) {
        errorMsg.remove();
    }
}

export function updateFinalStepWithQC(qcSummary) {
    const qcStatusEl = document.getElementById('qcStatusBlock');
    if (!qcStatusEl || !qcSummary) return;
    
    // getSummary() возвращает поля напрямую, не во вложенном объекте metrics
    const passed = qcSummary.overallPass;
    const totalFrames = qcSummary.totalFrames || 0;
    const validGazePct = qcSummary.gazeValidPct || 0;
    const faceOkPct = qcSummary.faceOkPct || 0;
    const durationMs = qcSummary.durationMs || 0;
    
    // ✅ Форматируем единицы измерения напрямую (без translations)
    const durationText = state.currentLang === 'ru' ? 'с' : 's';
    const percentText = '%';
    
    if (passed) {
        qcStatusEl.innerHTML = `
            <div class="qc-status-passed">
                <strong>${translations[state.currentLang].qc_passed_full}</strong>
                <div class="qc-status-details">
                    ${translations[state.currentLang].qc_duration}: ${Math.round(durationMs / 1000)}${durationText} | 
                    ${translations[state.currentLang].qc_valid}: ${validGazePct.toFixed(1)}${percentText} | 
                    ${translations[state.currentLang].qc_face_ok}: ${faceOkPct.toFixed(1)}${percentText}
                </div>
            </div>
        `;
    } else {
        // Собираем список проблем из объекта checks
        const issues = [];
        if (qcSummary.checks) {
            if (!qcSummary.checks.duration) issues.push('short_duration');
            if (!qcSummary.checks.faceVisible) issues.push('low_face_visible');
            if (!qcSummary.checks.faceOk) issues.push('low_face_ok_pct');
            if (!qcSummary.checks.poseOk) issues.push('low_pose_ok_pct');
            if (!qcSummary.checks.illuminationOk) issues.push('low_illumination_ok_pct');
            if (!qcSummary.checks.eyesOpen) issues.push('low_eyes_open_pct');
            if (!qcSummary.checks.occlusion) issues.push('high_occlusion_pct');
            if (!qcSummary.checks.gazeValid) issues.push('low_gaze_valid_pct');
            if (!qcSummary.checks.gazeOnScreen) issues.push('high_offscreen');
            if (!qcSummary.checks.lowFps) issues.push('low_fps_time');
        }
        
        const issueTexts = {
            'insufficient_data': translations[state.currentLang].issue_insufficient_data,
            'low_gaze_valid_pct': translations[state.currentLang].issue_low_gaze_valid_pct,
            'low_face_ok_pct': translations[state.currentLang].issue_low_face_ok_pct,
            'high_offscreen': translations[state.currentLang].issue_high_offscreen,
            'short_duration': translations[state.currentLang].issue_short_duration,
            'low_face_visible': translations[state.currentLang].issue_low_face_visible,
            'low_pose_ok_pct': translations[state.currentLang].issue_low_pose_ok_pct,
            'low_illumination_ok_pct': translations[state.currentLang].issue_low_illumination_ok_pct,
            'low_eyes_open_pct': translations[state.currentLang].issue_low_eyes_open_pct,
            'high_occlusion_pct': translations[state.currentLang].issue_high_occlusion_pct,
            'low_fps_time': translations[state.currentLang].issue_low_fps_time
        };
        const issuesList = issues.map(issue => issueTexts[issue] || issue).join(', ');
        
        qcStatusEl.innerHTML = `
            <div class="qc-status-failed">
                <strong>${translations[state.currentLang].qc_failed_full}</strong>
                <div style="font-size: 12px; margin-top: 8px;">
                    ${translations[state.currentLang].qc_issues}: ${issuesList || 'N/A'}
                </div>
                <div style="font-size: 12px; margin-top: 4px; opacity: 0.8;">
                    ${translations[state.currentLang].qc_duration}: ${Math.round(durationMs / 1000)}${durationText} | 
                    ${translations[state.currentLang].qc_valid}: ${validGazePct.toFixed(1)}${percentText} | 
                    ${translations[state.currentLang].qc_face_ok}: ${faceOkPct.toFixed(1)}${percentText}
                </div>
            </div>
        `;
    }
}


export function stopPreCheckOnLeave() {
    if (state.flags.isPrecheckRunning) {
        stopPreCheck();
    }
    // Очищаем validation gaze interval (если уходим во время валидации)
    state.runtime._validationLoopActive = false;
    if (state.runtime._validationGazeInterval) {
        clearTimeout(state.runtime._validationGazeInterval);
        state.runtime._validationGazeInterval = null;
    }
    // Очищаем analysis interval (если уходим во время tracking test)
    state.runtime._analysisLoopActive = false;
    if (state.runtime.analysisInterval) {
        clearTimeout(state.runtime.analysisInterval);
        state.runtime.analysisInterval = null;
    }
    if (state.runtime.cameraStream) {
        state.runtime.cameraStream.getTracks().forEach(track => track.stop());
        state.runtime.cameraStream = null;
    }
    state.flags.isPrecheckRunning = false;
}

// ========================================
// STEP 3: Проверка заполненности формы email
// ========================================

/**
 * Проверяет, заполнены ли все поля Step 3 (email + два чекбокса).
 * Если всё заполнено корректно — активирует кнопку "Далее".
 * Если что-то не заполнено — кнопка остаётся disabled.
 */
function checkEmailStepComplete() {
    const emailInput = document.getElementById('userEmail');
    const consentStorage = document.getElementById('emailConsentStorage');
    const consentContact = document.getElementById('emailConsentContact');
    const nextBtn = document.getElementById('step3NextBtn');
    
    // Если элементы не найдены (например, ещё не загрузились) — выходим
    if (!emailInput || !consentStorage || !consentContact || !nextBtn) {
        return;
    }
    
    // Проверяем, что email валиден
    const emailValid = emailInput.value.trim() && validateEmail(emailInput.value.trim()).valid;
    
    // Проверяем, что оба чекбокса отмечены
    const storageChecked = consentStorage.checked;
    const contactChecked = consentContact.checked;
    
    // Кнопка активна только если ВСЕ условия выполнены
    nextBtn.disabled = !(emailValid && storageChecked && contactChecked);
}

// Делаем функцию доступной глобально (для вызова из app.js)
window.checkEmailStepComplete = checkEmailStepComplete;


// ========================================
// STEP 4: Валидация анкеты
// ========================================

/**
 * Проверяет, заполнены ли все обязательные поля Step 4.
 * Обязательные поля: age (18-99), gender (не пустой).
 * Остальные поля имеют значения по умолчанию.
 * Активирует кнопку "Далее" только если всё корректно.
 */
function validateQuestionnaire() {
    const ageInput = document.getElementById('age');
    const genderSelect = document.getElementById('gender');
    const formBtn = document.getElementById('formBtn');
    
    if (!ageInput || !genderSelect || !formBtn) return;
    
    // Проверяем возраст (18-99)
    const ageValid = ageInput.value && 
                     parseInt(ageInput.value) >= 18 && 
                     parseInt(ageInput.value) <= 99;
    
    // Проверяем пол (не пустой)
    const genderValid = genderSelect.value !== '';
    
    // Подсветка ошибок
    if (ageInput.value && !ageValid) {
        ageInput.style.borderColor = '#e74c3c';
    } else {
        ageInput.style.borderColor = '';
    }
    
    if (genderSelect.value === '' && genderSelect.classList.contains('touched')) {
        genderSelect.style.borderColor = '#e74c3c';
    } else {
        genderSelect.style.borderColor = '';
    }
    
    // Кнопка активна только если ВСЕ обязательные поля заполнены
    formBtn.disabled = !(ageValid && genderValid);
}

/**
 * Отмечаем поле как "touched" (пользователь взаимодействовал с ним)
 */
function markFieldTouched(fieldId) {
    const field = document.getElementById(fieldId);
    if (field) {
        field.classList.add('touched');
        validateQuestionnaire();
    }
}

// Делаем функции доступными глобально
window.validateQuestionnaire = validateQuestionnaire;
window.markFieldTouched = markFieldTouched;
