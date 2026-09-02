import { ContinuousBodyPoseCollector } from '../../participant-web/js/session-runtime/continuous-body-pose.js';

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const context = canvas.getContext('2d');
const startButton = document.getElementById('startBtn');
const stopButton = document.getElementById('stopBtn');
const status = document.getElementById('status');
const fields = Object.fromEntries(['valid','confidence','velocity','bursts','lean','roll'].map(id => [id, document.getElementById(id)]));
const state = {
  runtime: { currentPhase:'developer_diagnostic', taskContext:{}, lastBodyPoseSample:null },
  sessionData: { startTime:Date.now(), bodyPoseSamples:[], bodyPoseAccumulator:null, bodyPoseSummary:null }
};
let stream = null;
let collector = null;
let frameId = null;
let lastVideoTime = -1;

function format(value, digits = 2) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
}

function draw(sample) {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.clearRect(0, 0, width, height);
  if (!sample) return;
  const x = sample.torsoCenterX * width;
  const y = sample.torsoCenterY * height;
  const roll = (sample.shoulderRollDeg || 0) * Math.PI / 180;
  const lean = (sample.torsoLeanDeg || 0) * Math.PI / 180;
  const shoulderHalf = width * .12;
  const torsoLength = height * .20;
  context.lineWidth = Math.max(3, width / 260);
  context.lineCap = 'round';
  context.strokeStyle = sample.valid ? '#b7f52c' : '#f59e0b';
  context.beginPath();
  context.moveTo(x - Math.cos(roll) * shoulderHalf, y - Math.sin(roll) * shoulderHalf);
  context.lineTo(x + Math.cos(roll) * shoulderHalf, y + Math.sin(roll) * shoulderHalf);
  context.moveTo(x, y);
  context.lineTo(x - Math.sin(lean) * torsoLength, y + Math.cos(lean) * torsoLength);
  context.stroke();
  context.fillStyle = sample.movementBurst ? '#ef4444' : (sample.valid ? '#b7f52c' : '#f59e0b');
  context.beginPath(); context.arc(x, y, Math.max(6, width / 90), 0, Math.PI * 2); context.fill();
}

function render(sample) {
  const summary = collector?.summary?.();
  fields.valid.textContent = sample ? (sample.valid ? (sample.movementBurst ? 'Движение' : 'Стабильно') : 'Вне диапазона') : 'Не найден';
  fields.confidence.textContent = sample ? `${Math.round(sample.confidence * 100)}%` : '—';
  fields.velocity.textContent = sample ? format(sample.movementVelocity, 3) : '—';
  fields.bursts.textContent = String(summary?.movementBurstCount || 0);
  fields.lean.textContent = sample ? `${format(sample.torsoLeanDeg, 1)}°` : '—';
  fields.roll.textContent = sample ? `${format(sample.shoulderRollDeg, 1)}°` : '—';
  status.textContent = !sample ? 'Плечи и таз не распознаны полностью.' : sample.ood ? 'Измените дистанцию или откройте плечи и таз.' : sample.movementBurst ? 'Зафиксирован всплеск движения корпуса.' : 'Поза распознана, сигнал валиден.';
  draw(sample);
}

function loop() {
  if (!collector || !stream) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    render(collector.process(video, performance.now()));
  }
  frameId = requestAnimationFrame(loop);
}

async function stop() {
  if (frameId) cancelAnimationFrame(frameId);
  frameId = null;
  const summary = collector?.stop?.();
  collector = null;
  stream?.getTracks?.().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  startButton.disabled = false;
  stopButton.disabled = true;
  status.textContent = summary ? `Остановлено. Валидных кадров: ${summary.validSampleCount}/${summary.sampleCount}.` : 'Остановлено.';
  context.clearRect(0, 0, canvas.width, canvas.height);
}

async function start() {
  startButton.disabled = true;
  status.textContent = 'Инициализация MediaPipe Pose…';
  try {
    state.sessionData = { startTime:Date.now(), bodyPoseSamples:[], bodyPoseAccumulator:null, bodyPoseSummary:null };
    collector = new ContinuousBodyPoseCollector({ state, enabled:true, gamerMode:true, onError:error => { throw error; } });
    const ready = await collector.start();
    if (!ready) throw new Error('Pose Landmarker не инициализирован');
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user', width:{ideal:960}, height:{ideal:720} }, audio:false });
    video.srcObject = stream;
    await video.play();
    stopButton.disabled = false;
    lastVideoTime = -1;
    status.textContent = 'Встаньте так, чтобы были видны плечи и таз.';
    loop();
  } catch (error) {
    const message = `Модуль недоступен: ${error?.message || error}`;
    await stop();
    status.textContent = message;
  }
}

startButton.addEventListener('click', start);
stopButton.addEventListener('click', stop);
window.addEventListener('pagehide', () => { void stop(); });
