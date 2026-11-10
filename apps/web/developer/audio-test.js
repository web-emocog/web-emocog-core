import { SessionAudioCollector } from '../../participant-web/js/audio/session-audio.js?v=20261110-integration1';
import { authorizeDiagnostic } from './diagnostic-access.mjs?v=20261104-4';
import { DiagnosticRun, SerialDiagnosticStage } from './diagnostic-run.mjs?v=20261028-1';
import { createMonotonicClock } from '../../../packages/shared/multimodal/timebase.mjs';

const ui = Object.fromEntries(['level','recordTimer','startBtn','stopBtn','status','accepted','reliability','quality','duration','pitch','speech','reasons'].map(id => [id, document.getElementById(id)]));
let run = null, collector = null, timer = null, blocked = false, generation = 0;
const microphoneStage = new SerialDiagnosticStage();
const complete = (audio, window) => window.durationMs >= Math.round(audio.windowSeconds * 1000);
const lastComplete = audio => audio.windows.findLast(window => complete(audio, window)) || audio.windows.at(-1);
const fmt = value => Number.isFinite(value) ? value.toFixed(3) : '\u2014';
const display = result => {
  if (!result) return;
  ui.accepted.textContent = result.accepted ? 'Принято' : 'Отклонено';
  ui.reliability.textContent = fmt(result.reliability); ui.quality.textContent = fmt(result.qc?.qualityScore);
  ui.duration.textContent = (result.durationMs / 1000).toFixed(1) + ' с';
  ui.pitch.textContent = fmt(result.biomarkers?.pitch_mean_hz); ui.speech.textContent = fmt(result.qc?.speechFraction);
  ui.reasons.textContent = result.qc?.reasons?.join(', ') || 'нет';
  ui.level.style.width = Math.min(100, (result.qc?.rms || 0) * 700) + '%';
};
async function stop(message = 'Остановлено. Сырое аудио не сохранено.') {
  const owner = ++generation;
  const old = run; run = null; old?.stop(); clearInterval(timer); timer = null;
  const oldCollector = collector; collector = null;
  ui.startBtn.disabled = blocked; ui.stopBtn.disabled = true;
  if (oldCollector) {
    await oldCollector.stop('developer_stop').catch(() => {});
    if (generation === owner) display(lastComplete(oldCollector));
  }
  if (generation === owner) ui.status.textContent = message;
}
async function start() {
  if (run || blocked) return;
  generation++;
  const current = run = new DiagnosticRun(); ui.startBtn.disabled = true; ui.stopBtn.disabled = false;
  ui.status.textContent = 'Проверяем доступ к микрофону...';
  try {
    await authorizeDiagnostic(current, 'microphone'); current.check();
    const state = { runtime: { currentPhase: 'developer_diagnostic', taskContext: {} }, sessionData: { audioConsent: { granted: true } } };
    const audio = collector = new SessionAudioCollector({ state, clock: createMonotonicClock(), enabled: true });
    current.onStop(() => { void audio.stop('developer_cancel').catch(() => {}); });
    if (!await microphoneStage.request(current, () => audio.start())) throw new Error('Audio unavailable'); current.check();
    const started = performance.now();
    const windowMs = audio.windowSeconds * 1000;
    ui.status.textContent = 'Запись тем же модулем: окна ' + audio.windowSeconds + ' с и правила качества протокола.';
    timer = setInterval(() => {
      if (run !== current || current.signal.aborted) return;
      const remaining = Math.max(0, windowMs - (performance.now() - started));
      ui.recordTimer.textContent = '00:' + (remaining / 1000).toFixed(1).padStart(4, '0');
      if (audio.status === 'failed') { void stop('Аудиоанализ остановлен из-за ошибки.'); return; }
      display(lastComplete(audio));
      if (audio.windows.some(window => complete(audio, window))) void stop();
      else if (performance.now() - started >= windowMs * 3) void stop('Не получено полное аудиоокно. Проверьте микрофон.');
    }, 200);
  } catch (_) {
    if (run !== current) return;
    await stop('Аудиомодуль недоступен. Проверьте доступ, разрешение микрофона и локальные модули.');
  }
}
ui.startBtn.addEventListener('click', start); ui.stopBtn.addEventListener('click', () => { void stop(); });
window.addEventListener('pagehide', () => { void stop(); });
window.addEventListener('wecog:staffsessionblocked', () => { blocked = true; void stop(); });
