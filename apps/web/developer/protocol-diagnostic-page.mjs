import { ProtocolDiagnostic } from './protocol-diagnostic.mjs?v=20261104-4';
import { PROTOCOL_PROFILE_ID, MODEL_ASSETS, FRAME_SCHEDULE, protocolCameraConstraints } from '../../participant-web/js/session-runtime/protocol-profile.mjs?v=20261104-4';

const fmt = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '\u2014';
const fpsLabel = measurement => measurement?.status === 'measured'
    ? `${fmt(measurement.fps, 0)} FPS`
    : measurement?.status === 'stale' ? 'нет свежего окна' : 'нет замера';

export function mountProtocolDiagnostic(channel) {
    const video = document.getElementById('video');
    const start = document.getElementById('btnStart') || document.getElementById('startBtn');
    const stop = document.getElementById('btnStop') || document.getElementById('stopBtn');
    const status = document.getElementById('status');
    const screen = document.getElementById('screen');
    const overlay = document.getElementById('overlay');
    if (!video || !start || !stop || !status) throw new Error('Diagnostic controls unavailable');
    const write = (id, value) => { const node = document.getElementById(id); if (node && node.textContent !== value) node.textContent = value; };
    const panel = document.createElement('section'); panel.className = 'card'; panel.id = 'protocolProfile';
    const title = document.createElement('h2'); title.textContent = 'Профиль протокола';
    const note = document.createElement('p');
    note.textContent = 'Тот же pipeline, модели и параметры обработки. Звук проверяется отдельно. Для персонального взгляда и QC конкретной публикации используйте полную сессию с калибровкой.';
    const profile = document.createElement('pre'); profile.id = 'profileDetails'; profile.style.whiteSpace = 'pre-wrap'; profile.style.overflowWrap = 'anywhere';
    const performanceLine = document.createElement('p'); performanceLine.id = 'profilePerformance';
    panel.style.gridColumn = '1 / -1'; panel.style.minWidth = '0';
    profile.textContent = JSON.stringify({ id: PROTOCOL_PROFILE_ID, schedule: FRAME_SCHEDULE, camera: protocolCameraConstraints().video, models: MODEL_ASSETS }, null, 2);
    panel.append(title, note, profile, performanceLine);
    (document.querySelector('main') || document.querySelector('.layout') || document.body).appendChild(panel);
    const states = { access: 'Проверяем доступ...', models: 'Загружаем модели протокола...', camera: 'Запрашиваем камеру...',
        sampling: 'Измеряем частоту камеры...', running: 'Анализ запущен. Взгляд без персональной калибровки не оценивается.', stopped: 'Остановлено' };
    let blocked = false;
    let previousEmotion = null;
    const emotionPoints = [];
    const runner = new ProtocolDiagnostic({ video, onStatus(value) {
        write('status', states[value] || value);
        const active = value !== 'stopped';
        start.disabled = active || blocked; stop.disabled = !active;
        video.style.display = active ? 'block' : 'none';
        screen?.classList.toggle('running', value === 'running');
        if (value === 'stopped') { write('bpmVal', '\u2014'); document.getElementById('bpmVal')?.classList.add('off'); }
        if (value === 'access') {
            previousEmotion = null; emotionPoints.length = 0;
            for (const id of ['bpmVal', 'respirationV', 'valenceV', 'arousalV', 'dominantV', 'valid', 'confidence', 'velocity', 'lean', 'roll', 'qcDetails']) write(id, '\u2014');
            const timeline = document.getElementById('timeline');
            if (timeline) timeline.getContext('2d').clearRect(0, 0, timeline.width, timeline.height);
        }
        if (value === 'stopped') {
            if (overlay) { overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height); overlay.style.display = 'none'; }
            write('profilePerformance', 'Запуск остановлен. Измерения не отправлялись.');
        }
    }, onUpdate(sample) {
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
