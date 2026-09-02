import { analyzeAudioWindow } from '../../participant-web/js/audio/session-audio.js';

const ui = Object.fromEntries(['level','recordTimer','startBtn','stopBtn','status','accepted','reliability','quality','duration','pitch','speech','reasons']
  .map(id => [id, document.getElementById(id)]));
let stream = null;
let context = null;
let source = null;
let processor = null;
let mute = null;
let chunks = [];
let startedAt = 0;
const MIN_WINDOW_MS = 10000;
let timerId = null;
let stopping = false;

function formatTimer(ms) {
  const seconds = Math.max(0, ms) / 1000;
  return `00:${seconds.toFixed(1).padStart(4, '0')}`;
}

function updateTimer() {
  const remaining = startedAt ? MIN_WINDOW_MS - (performance.now() - startedAt) : MIN_WINDOW_MS;
  ui.recordTimer.textContent = formatTimer(remaining);
  if (startedAt && remaining <= 0 && !stopping) void stop();
}

const REASON_TEXT = {
  low_marker_confidence: 'недостаточно устойчивого речевого материала',
  low_quality_score: 'качество сигнала ниже порога',
  quality_ood: 'сигнал вне допустимого диапазона',
  low_voiced_coverage: 'недостаточно распознанной голосовой части',
  silence: 'не обнаружена речь',
  clipping: 'слишком громкий или искажённый сигнал',
  short_window: 'окно записи слишком короткое',
};

function status(text, type = '') {
  ui.status.textContent = text;
  ui.status.className = `status ${type}`.trim();
}

function release() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  try { processor?.disconnect(); } catch (_) {}
  try { source?.disconnect(); } catch (_) {}
  try { mute?.disconnect(); } catch (_) {}
  stream?.getTracks?.().forEach(track => track.stop());
  const closing = context?.close?.();
  stream = context = source = processor = mute = null;
  ui.level.style.width = '0%';
  return closing;
}

function flatten(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Float32Array(size);
  let offset = 0;
  parts.forEach(part => { result.set(part, offset); offset += part.length; });
  return result;
}

function show(result) {
  const fmt = value => Number.isFinite(value) ? Number(value).toFixed(3) : '—';
  ui.accepted.textContent = result.accepted ? 'Принято' : 'Отклонено';
  ui.reliability.textContent = fmt(result.reliability);
  ui.quality.textContent = fmt(result.qc?.qualityScore);
  ui.duration.textContent = `${(result.durationMs / 1000).toFixed(1)} с`;
  ui.pitch.textContent = Number.isFinite(result.biomarkers?.pitch_mean_hz) ? `${result.biomarkers.pitch_mean_hz.toFixed(1)} Hz` : '—';
  ui.speech.textContent = fmt(result.qc?.speechFraction);
  ui.reasons.textContent = result.qc?.reasons?.map(reason => REASON_TEXT[reason] || reason).join(', ') || 'нет';
  status(result.accepted ? 'Окно принято модулем.' : 'Окно не опубликовано: исправьте условия и повторите.', result.accepted ? 'ok' : 'bad');
}

async function start() {
  chunks = [];
  ui.startBtn.disabled = true;
  status('Запрашиваем доступ к микрофону...');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio:{ channelCount:{ ideal:1 }, echoCancellation:true, noiseSuppression:true, autoGainControl:false }, video:false });
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    context = new AudioContextCtor({ latencyHint:'interactive' });
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(2048, 1, 1);
    mute = context.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = event => {
      const frame = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(frame);
      let square = 0;
      for (let i = 0; i < frame.length; i += 1) square += frame[i] * frame[i];
      ui.level.style.width = `${Math.min(100, Math.sqrt(square / Math.max(1, frame.length)) * 700)}%`;
    };
    source.connect(processor); processor.connect(mute); mute.connect(context.destination);
    startedAt = performance.now();
    stopping = false;
    updateTimer();
    timerId = setInterval(updateTimer, 100);
    ui.stopBtn.disabled = false;
    status('Запись окна идёт. Говорите естественно не менее 10 секунд.');
  } catch (error) {
    await release();
    ui.startBtn.disabled = false;
    status(`Микрофон недоступен: ${error?.message || error}`, 'bad');
  }
}

async function stop() {
  if (stopping || !context) return;
  stopping = true;
  ui.stopBtn.disabled = true;
  const sampleRate = context?.sampleRate || 0;
  const endedAt = performance.now();
  const remainingMs = MIN_WINDOW_MS - (endedAt - startedAt);
  if (remainingMs > 0) {
    stopping = false;
    ui.stopBtn.disabled = false;
    status(`Продолжайте говорить ещё ${Math.ceil(remainingMs / 1000)} с.`);
    return;
  }
  const samples = flatten(chunks);
  chunks = [];
  await release();
  ui.startBtn.disabled = false;
  const result = analyzeAudioWindow(samples, sampleRate, { startMonotonicMs:startedAt, endMonotonicMs:endedAt, scope:{ phase:'developer_diagnostic' } });
  startedAt = 0;
  ui.recordTimer.textContent = formatTimer(0);
  samples.fill(0);
  show(result);
}

ui.startBtn.addEventListener('click', start);
ui.stopBtn.addEventListener('click', stop);
window.addEventListener('pagehide', () => { chunks = []; startedAt = 0; void release(); });
