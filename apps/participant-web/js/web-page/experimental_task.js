import { state, ex_state } from './state.js';
import { finishSession } from './tests.js';

let experimentProtocol = null;
let currentBlockIndex = 0;
let currentTrialIndex = 0;
let trialTimeout = null;
let responseHandler = null;

export async function loadAndStartCognitiveTask() {
    console.log("[Cognitive] Инициализация задачи...");
    try {
        const response = await fetch('./experiment.json');
        if (!response.ok) throw new Error("Файл experiment.json не найден");
        
        experimentProtocol = await response.json();
        state.sessionData.cognitiveResults = [];
        
        currentBlockIndex = 0;
        
        // Переключаем экран на шаг 6
        document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
        document.getElementById('step6').classList.add('active');
        
        runNextBlock();
    } catch (e) {
        console.error("[Cognitive] Ошибка загрузки:", e);
        alert("Ошибка: не удалось загрузить протокол эксперимента.");
    }
}

function runNextBlock() {
    if (currentBlockIndex >= experimentProtocol.blocks.length) {
        finishCognitiveTask();
        return;
    }

    const block = experimentProtocol.blocks[currentBlockIndex];
    console.log("[Cognitive] Переход к блоку:", block.id, "Тип:", block.type);

    if (block.type === 'instruction' || block.type === 'instructions') {
        showInstructions(block);
    } else if (block.type === 'cognitive_task') {
        startTaskBlock(block);
    } else {
        currentBlockIndex++;
        runNextBlock();
    }
}

function showInstructions(block) {
    ex_state.task.area.style.display = 'none';
    ex_state.instruction.container.style.display = 'block';
    
    ex_state.instruction.title.innerText = block.content?.title || "Инструкция";
    ex_state.instruction.text.innerText = block.content?.text || "";
    ex_state.instruction.btn.innerText = block.content?.buttonText || "Далее";
    
    const checkbox = document.getElementById('cogCheck');
    const checkContainer = document.getElementById('cogCheckContainer');
    const btn = ex_state.instruction.btn;

    // Сбрасываем состояние
    checkbox.checked = false;

    if (block.id === 'instruction') {
        checkContainer.style.display = 'block'; 
        btn.disabled = true;                   
    } else {
        checkContainer.style.display = 'none';  
        btn.disabled = false;                   
    }

    checkbox.onchange = (e) => {
        btn.disabled = !e.target.checked;
    };

    btn.onclick = (e) => {
        e.preventDefault();
        currentBlockIndex++;
        runNextBlock();
    };
}

function startTaskBlock(block) {
    ex_state.instruction.container.style.display = 'none';
    ex_state.task.area.style.display = 'flex';
    currentTrialIndex = 0;
    runTrial();
}

function runTrial() {
    const block = experimentProtocol.blocks[currentBlockIndex];
    if (currentTrialIndex >= block.trials.length) {
        currentBlockIndex++;
        runNextBlock();
        return;
    }

    const trial = block.trials[currentTrialIndex];
    const config = block.blockConfig || {};
    const fixationDuration = config.fixation?.duration || 500;
    const stimulusDuration = config.stimulusDuration || 1000;

    // Показываем фиксацию
    ex_state.task.stimulus.style.display = 'none';
    ex_state.task.feedback.style.display = 'none';
    ex_state.task.fixation.style.display = 'block';

    setTimeout(() => {
        // Показываем стимул
        ex_state.task.fixation.style.display = 'none';
        
        if (trial.stimulus && trial.stimulus.style) {
            Object.assign(ex_state.task.stimulus.style, trial.stimulus.style);
        }
        ex_state.task.stimulus.style.display = 'block';

        const startTime = performance.now();
        let responded = false;

        responseHandler = (e) => {
            if (e.code === 'Space' && !responded) {
                responded = true;
                handleResponse(performance.now() - startTime, 'Space');
            }
        };
        document.addEventListener('keydown', responseHandler);

        trialTimeout = setTimeout(() => {
            if (!responded) handleResponse(null, null);
        }, stimulusDuration);

    }, fixationDuration);
}

function handleResponse(rt, key) {
    cleanupTrial();
    
    const block = experimentProtocol.blocks[currentBlockIndex];
    const trial = block.trials[currentTrialIndex];
    const config = block.blockConfig || {};

    // Проверка корректности: если correctResponse "Space", то key должен быть "Space". 
    // Если correctResponse null (NoGo), то key должен быть null.
    const isCorrect = (trial.correctResponse === key);

    state.sessionData.cognitiveResults.push({
        trialId: trial.id,
        block: block.id,
        rt: rt,
        condition: trial.condition,
        correct: isCorrect,
        timestamp: Date.now()
    });

    if (config.showFeedback) {
        ex_state.task.feedback.innerText = isCorrect ? "✓ Верно" : "✗ Ошибка";
        ex_state.task.feedback.style.color = isCorrect ? "#4CAF50" : "#F44336";
        ex_state.task.feedback.style.display = 'block';
        
        setTimeout(() => {
            ex_state.task.feedback.style.display = 'none';
            moveToNextTrial(config);
        }, 500);
    } else {
        moveToNextTrial(config);
    }
}

function moveToNextTrial(config) {
    setTimeout(() => {
        currentTrialIndex++;
        runTrial();
    }, 200);
}

function cleanupTrial() {
    document.removeEventListener('keydown', responseHandler);
    clearTimeout(trialTimeout);
}

function finishCognitiveTask() {
    console.log("[Cognitive] Задача завершена");
    finishSession();
}