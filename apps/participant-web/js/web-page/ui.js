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

    // Обновляем ID если сгенерирован
    if (state.sessionData.ids.participant) {
        document.getElementById('generatedIdPreview').innerText = 
            `${translations[lang].id_participant} ${state.sessionData.ids.participant}`;
    } else {
            document.getElementById('idDisplay').innerText = translations[lang].id_not_generated;
    }

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

export function toggleConsent() {
    const chk = document.getElementById('consentCheck');
    document.getElementById('consentBtn').disabled = !chk.checked;
}

export function generateIdsAndProceed() {
    const sessionId = 'S-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    const participantId = 'P-' + Math.random().toString(36).substr(2, 5).toUpperCase();
    
    state.sessionData.ids.session = sessionId;
    state.sessionData.ids.participant = participantId;
    state.sessionData.user.interfaceLanguage = state.currentLang;

    const idBadge = document.getElementById('idDisplay');
    idBadge.style.display = 'block';
    idBadge.innerText = `ID: ${participantId}`;
    
    document.getElementById('generatedIdPreview').innerText = 
        `${translations[state.currentLang].id_participant} ${participantId}`;

    nextStep(3);
}

export function copyIds() {
    const text = `Session: ${state.sessionData.ids.session}, Participant: ${state.sessionData.ids.participant}`;
    navigator.clipboard.writeText(text).then(() => 
        alert(translations[state.currentLang].file_copied)
    );
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

// Валидация анкеты
export function checkForm() {
    const required = ['age', 'gender', 'inputDevice', 'keyboardType', 'vision'];
    let isValid = true;
    
    required.forEach(id => {
        const el = document.getElementById(id);
        if (!el || !el.value) {
            isValid = false;
            if (el) {
                el.setAttribute('aria-invalid', 'true');
                el.classList.add('error');
            }
            } else {
                if (el) {
                    el.removeAttribute('aria-invalid');
                    el.classList.remove('error');
                }
            }
    });
    
    // Валидация возраста (диапазон 18-99)
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

    const formBtn = document.getElementById('formBtn');
    if (formBtn) {
        formBtn.disabled = !isValid;
    }

    // Сохраняем данные
    if (isValid) {
        state.sessionData.user = {
            ...state.sessionData.user,
            age: document.getElementById('age').value,
            gender: document.getElementById('gender').value,
            education: document.getElementById('education').value,
            language: document.getElementById('language').value,
            vision: document.getElementById('vision').value,
            visionIssues: document.getElementById('visionIssues').value,
            hand: document.getElementById('hand').value,
            inputDevice: document.getElementById('inputDevice').value,
            keyboardType: document.getElementById('keyboardType').value
        };
    }

    return isValid;
}

export async function collectTechDataAndProceed() {
    const emailInput = document.getElementById('userEmail');
    const email = emailInput.value.trim();
    
    // Валидация email
    const emailValidation = validateEmail(email);
    if (!emailValidation.valid) {
        // Показываем ошибку
        emailInput.setAttribute('aria-invalid', 'true');
        emailInput.classList.add('error');
        
        // Показываем сообщение об ошибке
        let errorMsg = document.getElementById('emailError');
        if (!errorMsg) {
            errorMsg = document.createElement('div');
            errorMsg.id = 'emailError';
            errorMsg.className = 'error-message';
            errorMsg.style.cssText = 'color: var(--error); font-size: 12px; margin-top: 5px;';
            emailInput.parentElement.appendChild(errorMsg);
        }
        errorMsg.textContent = emailValidation.error;
        
        // Блокируем переход
        return;
    }
    
    // Убираем ошибку если валидно
    emailInput.removeAttribute('aria-invalid');
    emailInput.classList.remove('error');
    const errorMsg = document.getElementById('emailError');
    if (errorMsg) errorMsg.remove();
    
    if (email) state.sessionData.user.email = email; 

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

    // Измеряем FPS рендеринга (для справки)
    measureRenderFPS().then(renderFps => {
        state.sessionData.tech.measuredFPS = renderFps;
        state.sessionData.tech.renderFPS = renderFps;
        nextStep(4);
    });
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
    
    if (passed) {
        qcStatusEl.innerHTML = `
            <div class="qc-status-passed">
                <strong>${translations[state.currentLang].qc_passed_full}</strong>
                <div class="qc-status-details">
                    ${translations[state.currentLang].qc_duration}: ${Math.round(durationMs / 1000)}${translations[state.currentLang].seconds} | 
                    ${translations[state.currentLang].qc_valid}: ${validGazePct.toFixed(1)}${translations[state.currentLang].percent} | 
                    ${translations[state.currentLang].qc_face_ok}: ${faceOkPct.toFixed(1)}${translations[state.currentLang].percent}
                </div>
            </div>
        `;
    } else {
        // Собираем список проблем из объекта checks
        const issues = [];
        if (qcSummary.checks) {
            if (!qcSummary.checks.duration) issues.push(translations[state.currentLang].issue_short_duration);
            if (!qcSummary.checks.faceVisible) issues.push(translations[state.currentLang].issue_low_face_visible);
            if (!qcSummary.checks.faceOk) issues.push(translations[state.currentLang].issue_low_face_ok_pct);
            if (!qcSummary.checks.poseOk) issues.push(translations[state.currentLang].issue_low_pose_ok_pct);
            if (!qcSummary.checks.illuminationOk) issues.push(translations[state.currentLang].issue_low_illumination_ok_pct);
            if (!qcSummary.checks.eyesOpen) issues.push(translations[state.currentLang].issue_low_eyes_open_pct);
            if (!qcSummary.checks.occlusion) issues.push(translations[state.currentLang].issue_high_occlusion_pct);
            if (!qcSummary.checks.gazeValid) issues.push(translations[state.currentLang].issue_low_gaze_valid_pct);
            if (!qcSummary.checks.gazeOnScreen) issues.push(translations[state.currentLang].issue_high_offscreen);
            if (!qcSummary.checks.lowFps) issues.push(translations[state.currentLang].issue_low_fps_time);
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
                    ${translations[state.currentLang].qc_duration}: ${Math.round(durationMs / 1000)}${translations[state.currentLang].seconds} | 
                    ${translations[state.currentLang].qc_valid}: ${validGazePct.toFixed(1)}${translations[state.currentLang].percent} | 
                    ${translations[state.currentLang].qc_face_ok}: ${faceOkPct.toFixed(1)}${translations[state.currentLang].percent}
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
