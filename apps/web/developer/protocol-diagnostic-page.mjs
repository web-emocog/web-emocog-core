import { ProtocolDiagnostic } from './protocol-diagnostic.mjs?v=20261104-4';
import { expressionNames } from './emotion-comparison.mjs';
import { PROTOCOL_PROFILE_ID, MODEL_ASSETS, FRAME_SCHEDULE, protocolCameraConstraints } from '../../participant-web/js/session-runtime/protocol-profile.mjs?v=20261104-4';

const fmt = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '\u2014';
const fpsLabel = measurement => measurement?.status === 'measured'
    ? `${fmt(measurement.fps, 0)} FPS`
    : measurement?.status === 'stale' ? 'нет свежего окна' : 'нет замера';

const auNames = {
    AU1: 'Подъём внутренних частей бровей', AU2: 'Подъём внешних частей бровей',
    AU4: 'Сведение бровей', AU5: 'Раскрытие глаз', AU6: 'Подъём щёк',
    AU7: 'Сужение век', AU9: 'Сморщивание носа', AU10: 'Подъём верхней губы',
    AU12: 'Растяжение уголков губ', AU15: 'Опускание уголков губ',
    AU17: 'Подъём подбородка', AU20: 'Растяжение губ', AU23: 'Сжатие губ',
    AU25: 'Размыкание губ', AU26: 'Опускание челюсти', AU27: 'Широкое открытие рта',
};

export function mountProtocolDiagnostic(channel) {
    const video = document.getElementById('video');
    const start = document.getElementById('btnStart') || document.getElementById('startBtn');
    const stop = document.getElementById('btnStop') || document.getElementById('stopBtn');
    const status = document.getElementById('status');
    const screen = document.getElementById('screen');
    const overlay = document.getElementById('overlay');
    if (!video || !start || !stop || !status) throw new Error('Diagnostic controls unavailable');
    const write = (id, value) => { const node = document.getElementById(id); if (node && node.textContent !== value) node.textContent = value; };
    let emotionExport = null;
    const panel = document.createElement('section'); panel.className = 'card'; panel.id = 'protocolProfile';
    const title = document.createElement('h2'); title.textContent = 'Профиль протокола';
    const note = document.createElement('p');
    note.textContent = 'Тот же pipeline, модели и параметры обработки. Звук проверяется отдельно. Для персонального взгляда и QC конкретной публикации используйте полную сессию с калибровкой.';
    const profile = document.createElement('pre'); profile.id = 'profileDetails'; profile.style.whiteSpace = 'pre-wrap'; profile.style.overflowWrap = 'anywhere';
    const performanceLine = document.createElement('p'); performanceLine.id = 'profilePerformance';
    panel.style.gridColumn = '1 / -1'; panel.style.minWidth = '0';
    profile.textContent = JSON.stringify({ id: PROTOCOL_PROFILE_ID, schedule: FRAME_SCHEDULE, camera: protocolCameraConstraints().video, models: MODEL_ASSETS }, null, 2);
    panel.append(title, note, profile, performanceLine);
    if (channel === 'emotion') {
        const heading = document.createElement('h2'); heading.textContent = 'Диагностика эмоций';
        const help = document.createElement('p');
        help.textContent = 'Верхний график и карточки - прежняя модель, новый вариант сравнивается на тех же кадрах. Данные не отправляются.';
        const download = document.createElement('button'); download.id = 'emotionDownload';
        download.type = 'button'; download.textContent = 'Скачать результаты (.json)'; download.disabled = true;
        download.addEventListener('click', () => {
            if (!emotionExport) return;
            const json = JSON.stringify(emotionExport,
                (_key, value) => typeof value === 'number' ? Number(value.toFixed(4)) : value, 2);
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
            const link = document.createElement('a'); link.href = url;
            link.download = `wecog-emotion-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
        const exportHelp = document.createElement('p');
        exportHelp.textContent = 'Файл содержит последний снимок обоих вариантов и записанные пробы. Можно скачать во время анализа или после остановки. Новый запуск очищает результаты; перед ним скачайте файл.';
        panel.append(heading, help, download, exportHelp);
        const summary = document.createElement('section');
        summary.id = 'emotionLiveDiagnostics';
        const caption = document.createElement('h3'); caption.textContent = 'Калибровка и движения лица';
        const calibration = document.createElement('p'); calibration.id = 'emotionCalibrationStatus';
        calibration.setAttribute('role', 'status'); calibration.textContent = 'Калибровка: ожидание запуска.';
        const freshness = document.createElement('p'); freshness.id = 'emotionSampleStatus';
        const candidateStatus = document.createElement('p'); candidateStatus.id='emotionCandidateStatus';
        const candidateValue = document.createElement('strong');
        candidateValue.id = 'emotionCandidateValue';
        candidateValue.textContent = 'ожидание запуска';
        candidateStatus.append('Новый вариант: ', candidateValue);
        const trialHelp=document.createElement('p');
        trialHelp.textContent='После калибровки выберите выражение, примите его, удерживайте 1–2 секунды и нажмите «Записать 5 секунд».';
        const trialLabel=document.createElement('label'); trialLabel.htmlFor='emotionTrialLabel'; trialLabel.textContent='Выражение для проверки: ';
        const select=document.createElement('select'); select.id='emotionTrialLabel';
        for(const [value,text] of expressionNames) {
            const option=document.createElement('option'); option.value=value; option.textContent=text; select.appendChild(option);
        }
        const record=document.createElement('button'); record.id='emotionTrialStart'; record.type='button';
        record.textContent='Записать 5 секунд'; record.disabled=true;
        record.addEventListener('click',()=>{
            if(runner.emotionDiagnostics?.beginTrial(select.value)) {
                record.disabled=true; select.disabled=true;
                write('emotionTrialStatus','Запись: удерживайте выбранное выражение 5 секунд.');
            }
        });
        const trialStatus=document.createElement('p'); trialStatus.id='emotionTrialStatus'; trialStatus.textContent='Пробы ещё не записаны';
        const tableWrap=document.createElement('div'); tableWrap.style.overflowX='auto';
        tableWrap.tabIndex=0; tableWrap.setAttribute('role','region');
        tableWrap.setAttribute('aria-label','Сравнение AU, на узком экране прокручивается горизонтально');
        const table = document.createElement('table'); table.style.width = '100%';
        table.style.minWidth = '600px';
        table.style.tableLayout = 'fixed'; table.style.overflowWrap = 'anywhere';
        const head = table.createTHead().insertRow();
        for (const label of ['Признак AU', 'Raw', 'Adjusted', 'Raw новый', 'Adj новый']) {
            const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label;
            cell.style.textAlign = 'left'; head.appendChild(cell);
        }
        head.cells[0].style.width = '47%';
        const body = table.createTBody();
        for (const [au, name] of Object.entries(auNames)) {
            const row = body.insertRow();
            const label = document.createElement('th'); label.scope = 'row';
            label.style.textAlign = 'left'; label.style.fontWeight = 'normal';
            label.textContent = `${au} - ${name}`; row.appendChild(label);
            for (const kind of ['raw', 'adjusted', 'candidate-raw', 'candidate-adjusted']) {
                const cell = row.insertCell(); cell.id = `emotion-${kind}-${au}`;
                cell.textContent = '-'; cell.style.fontVariantNumeric = 'tabular-nums';
            }
        }
        tableWrap.appendChild(table);
        summary.append(caption, calibration, freshness, candidateStatus,trialHelp,trialLabel,select,record,trialStatus,tableWrap);
        const timelineCard=document.getElementById('timeline')?.parentElement;
        if(timelineCard) { timelineCard.style.minWidth='0'; timelineCard.appendChild(summary); }
    }
    (document.querySelector('main') || document.querySelector('.layout') || document.body).appendChild(panel);
    const states = { access: 'Проверяем доступ...', models: 'Загружаем модели протокола...', camera: 'Запрашиваем камеру...',
        sampling: 'Измеряем частоту камеры...', running: 'Анализ запущен. Взгляд без персональной калибровки не оценивается.', stopped: 'Остановлено' };
    let blocked = false;
    let previousEmotion = null;
    const emotionPoints = [];
    const runner = new ProtocolDiagnostic({ video, emotionDiagnostics: channel === 'emotion', onStatus(value) {
        write('status', states[value] || value);
        const active = value !== 'stopped';
        start.disabled = active || blocked; stop.disabled = !active;
        video.style.display = active ? 'block' : 'none';
        screen?.classList.toggle('running', value === 'running');
        if (value === 'stopped') { write('bpmVal', '\u2014'); document.getElementById('bpmVal')?.classList.add('off'); }
        if (value === 'access') {
            write('emotionCandidateValue', 'ожидание первого измерения');
            write('emotionTrialStatus','Пробы ещё не записаны');
            write('emotionCalibrationStatus', 'Калибровка: ожидание первого измерения. Сохраняйте нейтральное лицо.');
            write('emotionSampleStatus', 'Ожидание данных');
            for (const au of Object.keys(auNames)) {
                write(`emotion-raw-${au}`, '-'); write(`emotion-adjusted-${au}`, '-');
                write(`emotion-candidate-raw-${au}`, '-'); write(`emotion-candidate-adjusted-${au}`, '-');
            }
            emotionExport = null;
            const download = document.getElementById('emotionDownload'); if (download) download.disabled = true;
            previousEmotion = null; emotionPoints.length = 0;
            for (const id of ['bpmVal', 'respirationV', 'valenceV', 'arousalV', 'dominantV', 'valid', 'confidence', 'velocity', 'lean', 'roll', 'qcDetails']) write(id, '\u2014');
            const timeline = document.getElementById('timeline');
            if (timeline) timeline.getContext('2d').clearRect(0, 0, timeline.width, timeline.height);
        }
        if (value === 'stopped') {
            const record=document.getElementById('emotionTrialStart'); if(record) record.disabled=true;
            const select=document.getElementById('emotionTrialLabel'); if(select) select.disabled=false;
            write('emotionSampleStatus', 'Остановлено - показан последний снимок, новые измерения не поступают.');
            if (overlay) { overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height); overlay.style.display = 'none'; }
            write('profilePerformance', 'Запуск остановлен. Измерения не отправлялись.');
        }
    }, onUpdate(sample) {
        if (channel === 'emotion') {
            const diagnostics = sample.emotionDiagnostics;
            emotionExport = diagnostics ?? null;
            const download = document.getElementById('emotionDownload');
            if (download) download.disabled = !emotionExport;
            const latest = diagnostics?.latest;
            const calibration = latest?.calibration;
            const candidate=diagnostics?.candidate?.latest;
            const candidateCalibration=candidate?.calibration;
            write('emotionCandidateValue', candidateCalibration?.ready
                ? `${candidate?.dominant ?? 'пропуск'}; valence ${fmt(candidate?.valence,3)}, arousal ${fmt(candidate?.arousal,3)}. Статус: ${candidate?.status}.`
                : `калибровка: ${candidateCalibration?.frames ?? 0}/${candidateCalibration?.requiredFrames ?? 18}. Статус: ${candidate?.status ?? 'ожидание'}.`);
            const active=diagnostics?.trialActive;
            const record=document.getElementById('emotionTrialStart');
            if(record) record.disabled=!!active||!calibration?.ready||!candidateCalibration?.ready
                ||latest?.status!=='success'||candidate?.status!=='success'||(diagnostics?.trials?.length??0)>=30;
            const select=document.getElementById('emotionTrialLabel'); if(select) select.disabled=!!active;
            const trials=diagnostics?.trials ?? [];
            const last = trials.at(-1);
            write('emotionTrialStatus',active ? `Запись «${expressionNames.get(active.expression) ?? active.expected}»: осталось ${fmt(active.remainingMs/1000,1)} с.`
                : last ? `Сохранено проб: ${trials.length}. Последняя: «${expressionNames.get(last.expression) ?? last.expected}», ${last.status}, общих валидных измерений: ${last.commonValid}.` : 'Пробы ещё не записаны');
            write('emotionCalibrationStatus', calibration?.ready
                ? `Калибровка завершена: ${calibration.frames}/${calibration.requiredFrames}. Можно выполнять выражения лица.`
                : `Калибровка: ${calibration?.frames ?? 0}/${calibration?.requiredFrames ?? '-'}. Сохраняйте нейтральное лицо.`);
            const labels = { success: 'Успешное измерение', calibrating: 'Сбор нейтрального уровня',
                missing_landmarks: 'Пропуск: нет точек лица', missing_data: 'Пропуск: нет данных',
                invalid_landmarks: 'Пропуск: некорректные точки лица', analysis_error: 'Ошибка расчёта' };
            write('emotionSampleStatus', `${labels[latest?.status] || 'Ожидание данных'}; возраст снимка: ${fmt(diagnostics?.lastAttemptAgeMs, 0)} мс; средняя частота расчётов: ${fmt(diagnostics?.attemptHzSinceFirst)} Гц.`);
            for (const au of Object.keys(auNames)) {
                write(`emotion-raw-${au}`, fmt(latest?.rawAU?.[au], 3));
                write(`emotion-adjusted-${au}`, fmt(latest?.adjustedAU?.[au], 3));
                write(`emotion-candidate-raw-${au}`,fmt(candidate?.rawAU?.[au],3));
                write(`emotion-candidate-adjusted-${au}`,fmt(candidate?.adjustedAU?.[au],3));
            }
        }
        const bpm = sample.bpm;
        if (bpm?.published || bpm?.held) {
            write('bpmVal', fmt(bpm.bpm, 0)); document.getElementById('bpmVal')?.classList.remove('off');
        } else { write('bpmVal', '\u2014'); document.getElementById('bpmVal')?.classList.add('off'); }
        write('respirationV', fmt(bpm?.respRate, 1));
        if (channel === 'bpm') write('status', bpm?.held ? 'Удерживается последнее значение; это не новое измерение.'
            : bpm?.published ? 'ЧСС опубликована модулем протокола.' : 'Накапливаем валидный сигнал: ' + (bpm?.publicationReason || 'warmup'));
        const emotion = sample.emotion;
        if (channel === 'emotion' && emotion && emotion !== previousEmotion) {
            previousEmotion = emotion;
            emotionPoints.push([emotion.valence, emotion.arousal]);
            if (emotionPoints.length > 600) emotionPoints.shift();
            const canvas = document.getElementById('timeline');
            if (canvas) {
                const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
                for (const [field, color] of [[0, '#b7f52c'], [1, '#f59e0b']]) {
                    ctx.strokeStyle = color; ctx.beginPath();
                    emotionPoints.forEach((point, index) => {
                        const x = index * canvas.width / Math.max(1, emotionPoints.length - 1);
                        const y = canvas.height * (1 - (field === 0 ? (point[field] + 1) / 2 : point[field]));
                        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
                    }); ctx.stroke();
                }
            }
        }
        write('valenceV', fmt(emotion?.valence, 3)); write('arousalV', fmt(emotion?.arousal, 3));
        write('dominantV', emotion?.dominant || 'unknown');
        write('brightnessV', fmt(sample.frame?.illumination != null ? sample.frame.illumination / 255 : null, 3));
        write('faceV', sample.frame?.faceDetected ? 'yes' : 'no');
        const body = sample.body;
        write('valid', !body ? 'Не найден' : body.valid ? 'Валидно' : 'Нет валидного сигнала');
        write('confidence', fmt(body?.confidence)); write('velocity', fmt(body?.movementVelocity, 3));
        write('bursts', String(sample.bodyBursts)); write('lean', fmt(body?.torsoLeanDeg, 1)); write('roll', fmt(body?.shoulderRollDeg, 1));
        write('qcDetails', JSON.stringify(sample.qc, null, 2));
        const mean = sample.diagnostics?.frames ? sample.diagnostics.primaryMsTotal / sample.diagnostics.frames : null;
        const face = sample.diagnostics?.stages?.face;
        const faceMs = face?.frames ? face.totalMs / face.frames : null;
        const camera = sample.camera?.width && sample.camera?.height
            ? ` Камера: ${sample.camera.width}×${sample.camera.height}, настройки трека: ${fmt(sample.camera.frameRate, 1)} FPS.` : '';
        const backends = sample.diagnostics ? ` Лицо: ${sample.diagnostics.faceBackend}; сегментация: ${sample.diagnostics.segmentDelegate || '\u2014'}; корпус: ${sample.diagnostics.poseBackend || '\u2014'}.` : '';
        const cadence = sample.qc?.fpsDiagnostics;
        const method = cadence?.camera?.method ? ` (${cadence.camera.method})` : '';
        const ceiling = cadence?.camera?.status === 'measured' && cadence.camera.fps > 0
            && cadence?.analysis?.status === 'measured' ? sample.budget.primaryCeilingFps : null;
        write('profilePerformance', `Источник: ${fpsLabel(cadence?.camera)}${method}; анализ: ${fpsLabel(cadence?.analysis)}; среднее время кадра за запуск: ${fmt(mean)} мс (лицо: ${fmt(faceMs)} мс). Бюджет 30 FPS: 33.33 мс; 25 FPS: 40 мс. Расчётная верхняя граница: ${fmt(ceiling)} FPS.${camera}${backends}`);
        if (overlay && channel === 'body') {
            overlay.style.display = 'block';
            const width = video.videoWidth || 640, height = video.videoHeight || 480;
            if (overlay.width !== width || overlay.height !== height) { overlay.width = width; overlay.height = height; }
            const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, width, height);
            if (body) {
                ctx.strokeStyle = body.valid ? '#b7f52c' : '#f59e0b'; ctx.lineWidth = 3;
                const x = body.torsoCenterX * width, y = body.torsoCenterY * height;
                ctx.beginPath(); ctx.moveTo(x - width * .12, y); ctx.lineTo(x + width * .12, y);
                ctx.moveTo(x, y); ctx.lineTo(x, y + height * .2); ctx.stroke();
            }
        } else if (overlay) overlay.style.display = 'none';
    } });
    start.addEventListener('click', () => {
        if (blocked) return;
        void runner.start().catch(error => {
            const policy = error?.code === 'diagnostic_sensor_policy_denied';
            write('status', policy ? 'Камера запрещена политикой этого сервера.' : error?.code === 'diagnostic_access_denied'
                ? 'Не удалось подтвердить доступ к диагностике.' : error?.code === 'diagnostic_timeout'
                    ? 'Время ожидания истекло. Можно запустить диагностику снова.'
                    : 'Диагностика недоступна. Проверьте камеру и локальные модули.');
        });
    });
    stop.addEventListener('click', () => runner.stop());
    const shutdown = () => runner.stop();
    window.addEventListener('pagehide', shutdown);
    window.addEventListener('beforeunload', shutdown);
    window.addEventListener('wecog:staffsessionblocked', () => { blocked = true; runner.blocked = true; runner.stop(); start.disabled = true; });
    stop.disabled = true;
    return runner;
}
