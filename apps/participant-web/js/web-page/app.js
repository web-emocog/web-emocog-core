// 1. Импорты всех модулей
import { state } from './state.js';
import { 
    setLanguage, 
    nextStep, 
    toggleConsent, 
    generateIdsAndProceed, 
    copyIds, 
    checkForm, 
    validateEmailField, 
    collectTechDataAndProceed, 
    updateFinalStepWithQC,
    stopPreCheckOnLeave,
    downloadData 
} from './ui.js';

import { 
    startPreCheck, 
    stopPreCheck
} from './precheck.js';

import { 
    startCalibration, 
    finishSession 
} from './tests.js';

// Функции доступные для HTML
window.setLanguage = setLanguage;
window.nextStep = nextStep;
window.copyIds = copyIds;
window.validateEmailField = validateEmailField;
window.downloadData = downloadData;

/**
 * Принимает данные взгляда
 * Необходимо вызывает при получении новых координат 
 * handleGazeUpdate({ 
 * x: 100, 
 * y: 200, 
 * t: Date.now()
 * });
 * Если лицо потеряно или взгляд не определен handleGazeUpdate(null);
 */
export function handleGazeUpdate(gazeData) {
    const customDot = document.getElementById('customGazeDot');
    
    if (!gazeData || gazeData.x === null || gazeData.y === null) {
        state.runtime.currentGaze = { x: null, y: null };
        if (customDot) customDot.style.display = 'none';
        
        if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
            state.runtime.qcMetrics.addGazePoint(null, null);
        }
        return;
    }

    // Обработка валидных данных
    const x = Math.round(gazeData.x);
    const y = Math.round(gazeData.y);
    const t = gazeData.t || Date.now();

    state.runtime.currentGaze = { x, y };

    // Визуализация 
    if (customDot && (state.flags.isRecording || state.flags.isValidating)) {
        customDot.style.display = 'block';
        customDot.style.left = `${x}px`;
        customDot.style.top = `${y}px`;
    } else if (customDot) {
        customDot.style.display = 'none';
    }

    // Запись сырых данных в сессию
    if (state.flags.isRecording) {
        state.sessionData.eyeTracking.push({ x, y, t });
    }

    // Отправка в QC Metrics
    if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
        state.runtime.qcMetrics.addGazePoint({ x, y }, null);
    }
}

window.handleGazeUpdate = handleGazeUpdate;


document.addEventListener('DOMContentLoaded', () => {
    console.log('App initialized');

    // Кнопка "Начать исследование" (шаг 1)
    const btnStartIntro = document.getElementById('btnStartIntro');
    if (btnStartIntro) {
        btnStartIntro.addEventListener('click', () => nextStep(2));
    }

    // Переключатель согласия (чекбокс)
    const consentCheck = document.getElementById('consentCheck');
    if (consentCheck) {
        consentCheck.addEventListener('change', toggleConsent);
    }

    // Кнопка подтверждения согласия (шаг 2)
    const consentBtn = document.getElementById('consentBtn');
    if (consentBtn) {
        consentBtn.addEventListener('click', generateIdsAndProceed);
    }
    
    const emailInput = document.getElementById('userEmail');
    if (emailInput) {
        emailInput.addEventListener('blur', validateEmailField);
    }

    // Кнопка сбора тех. данных (шаг 3)
    const step3Btn = document.getElementById('step3NextBtn');
    if (step3Btn) {
        step3Btn.addEventListener('click', collectTechDataAndProceed);
    }

    const userForm = document.getElementById('userForm');
    if (userForm) {
        userForm.addEventListener('input', checkForm);
        userForm.addEventListener('change', checkForm);
    }

    // Кнопка отправки анкеты (шаг 4)
    const formBtn = document.getElementById('formBtn');
    if (formBtn) {
        formBtn.addEventListener('click', (e) => {
            e.preventDefault();
            
            const isValid = checkForm();
            
            if (isValid) {
                nextStep(5);
            }
        });
    }

    // Кнопка запуска проверки камеры (шаг 5)
    const startPrecheckBtn = document.getElementById('startPrecheckBtn');
    if (startPrecheckBtn) {
        startPrecheckBtn.addEventListener('click', startPreCheck);
    }

    // Кнопка перехода к калибровке (появляется после успешного пречека)
    const startCalibBtn = document.getElementById('startCalibBtn');
    if (startCalibBtn) {
        startCalibBtn.addEventListener('click', startCalibration);
    }

    // Кнопка скачивания JSON (шаг 7)
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            downloadData();
        });
    }

    // Кнопка перезапуска (шаг 7)
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            window.location.reload();
        });
    }

    // Обработчики для кнопок переключения языка (если у них нет onclick)
    const langRu = document.getElementById('langRu');
    const langEn = document.getElementById('langEn');
    if (langRu) langRu.addEventListener('click', () => setLanguage('ru'));
    if (langEn) langEn.addEventListener('click', () => setLanguage('en'));

    // Устанавливаем начальный язык из состояния
    setLanguage(state.currentLang);
});

// 4. Очистка ресурсов при закрытии страницы
window.addEventListener('beforeunload', () => {
    stopPreCheckOnLeave();
});