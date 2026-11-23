import { RppgEngine, MotionRespirationEstimator } from '../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js?v=20261120-methods1';
import { FilesetResolver, FaceLandmarker, PoseLandmarker } from '../apps/participant-web/js/vendor/mediapipe/vision_bundle.mjs';
import { resample, est, estCorrected, consensus, trialSchedule, srgbToLinear, hexLuminance, WINDOW_SEC } from './respiration-lab-core.mjs?v=2';

const MP = '../apps/participant-web/js/vendor/mediapipe';
const IMG_DIR = '../apps/participant-web/assets/vpc/felidae';
const IMAGES = ['caracal', 'cheetah', 'domestic-cat', 'jaguar', 'leopard', 'lion', 'lynx', 'puma', 'tiger'].map(n => `${IMG_DIR}/${n}.jpg`);
const PACED_RATE = 12;               // вдохов в минуту — «правильный ответ»
const WARMUP_SEC = 25;               // с начала этапа оценки не учитываем (окно 20 с)
const DARK = '#1a1a2e', LIGHT = '#f3f4f6', GRAY = '#808080';
const QUICK = new URLSearchParams(location.search).has('quick'); // самопроверка: этапы по 8 с

// Этапы похожи на реальные блоки протокола: фото ~1 с с паузой 1–2 с
// на тёмном фоне задачи (по умолчанию в конструкторе) и на светлом фоне,
// и пассивный просмотр с ритмичной сменой картинок.
const SEGMENTS = [
  { id: 'static', label: 'Покой (серый экран)', sec: 90, kind: 'static', bg: GRAY },
  { id: 'dark_trials', label: 'Фото на тёмном фоне, пробы 1 с + пауза 1–2 с', sec: 120, kind: 'trials', bg: DARK, stimMs: 1000, isi: [1000, 2000] },
  { id: 'light_trials', label: 'Фото на светлом фоне, пробы 1 с + пауза 1–2 с', sec: 120, kind: 'trials', bg: LIGHT, stimMs: 1000, isi: [1000, 2000] },
  { id: 'dark_blocks', label: 'Фото 4,3 с / пусто 4,3 с на тёмном фоне (≈7/мин)', sec: 90, kind: 'regular', bg: DARK, onSec: 4.3 },
].map(s => QUICK ? { ...s, sec: 8 } : s);
SEGMENTS.forEach((s, i) => { if (s.kind === 'trials') s.schedule = trialSchedule(s.sec * 1000, s.stimMs, s.isi, IMAGES.length, 11 + i); });
const fixedRate = (s) => s.kind === 'regular' ? 60 / (2 * s.onSec) : null;

const METHODS = ['A', 'P', 'C', 'D1', 'D2', 'D3', 'E', 'D2c', 'D3c', 'Ec', 'K'];
const METHOD_NOTES = {
  A: 'текущий: яркость кожи (v2)', P: 'новый метод сайта (консенсус, вычитание яркости щёк)', C: 'щёки минус известная яркость экрана',
  D1: 'переносица', D2: 'наклон головы', D3: 'масштаб лица', E: 'плечи',
  D2c: 'D2 минус яркость экрана', D3c: 'D3 минус яркость экрана', Ec: 'E минус яркость экрана', K: 'медиана D1, D2c, Ec (известная яркость экрана)',
};

const $ = (id) => document.getElementById(id);
const video = $('video'), stage = $('stage'), stim = $('stim'), fix = $('fix');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let face = null, pose = null, stream = null, running = false, frameHandle = null;
let legacy = null, motion = null, lastLegacy = null, lastMotion = null;
let runStart = 0, frameCount = 0, lastEstimateAt = 0, fps = 0, fpsT = 0, fpsN = 0;
let audio = null, imgLum = [], images = [];
const series = { skin: [], screen: [], d1: [], d2: [], d3: [], e: [] };
let rows = [];

// ---------- экран ----------
function segAt(now) {
  if (!running) return null;
  const elapsed = (now - runStart) / 1000;
  let acc = 0;
  for (let i = 0; i < SEGMENTS.length; i++) {
    if (elapsed < acc + SEGMENTS[i].sec) return { seg: SEGMENTS[i], index: i, segMs: (elapsed - acc) * 1000 };
    acc += SEGMENTS[i].sec;
  }
  return null;
}
function screenState(now) {
  const at = segAt(now);
  if (!at) return { bg: GRAY, img: null };
  const { seg, segMs } = at;
  if (seg.kind === 'trials') {
    const tr = seg.schedule.find(x => segMs >= x.start && segMs < x.end);
    return { bg: seg.bg, img: tr ? tr.img : null };
  }
  if (seg.kind === 'regular') {
    const k = Math.floor(segMs / 1000 / seg.onSec);
    return { bg: seg.bg, img: k % 2 === 0 ? k / 2 % IMAGES.length : null };
  }
  return { bg: seg.bg, img: null };
}
let shown = { bg: null, img: undefined }, imgFrac = 0;
function paint() {
  const s = screenState(performance.now());
  if (s.bg !== shown.bg) { stage.style.background = s.bg; fix.style.color = s.bg === LIGHT ? '#333' : '#ccc'; }
  if (s.img !== shown.img) {
    if (s.img == null) { stim.style.visibility = 'hidden'; fix.style.visibility = running ? 'visible' : 'hidden'; }
    else {
      stim.src = images[s.img].src; stim.style.visibility = 'visible'; fix.style.visibility = 'hidden';
      const r = stim.getBoundingClientRect(); imgFrac = (r.width * r.height) / (innerWidth * innerHeight);
    }
  }
  shown = s;
  requestAnimationFrame(paint);
}
requestAnimationFrame(paint);
// Средняя линейная светимость экрана сейчас (фон + доля площади фото)
function screenLuminance(now) {
  const s = screenState(now);
  const bg = hexLuminance(s.bg);
  if (s.img == null || !imgLum.length) return bg;
  return (1 - imgFrac) * bg + imgFrac * imgLum[s.img];
}
async function loadImages() {
  images = await Promise.all(IMAGES.map(src => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error(`нет картинки ${src}`)); im.src = src; })));
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d', { willReadFrequently: true });
  imgLum = images.map(im => {
    x.drawImage(im, 0, 0, 32, 32); const d = x.getImageData(0, 0, 32, 32).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * srgbToLinear(d[i]) + 0.7152 * srgbToLinear(d[i + 1]) + 0.0722 * srgbToLinear(d[i + 2]);
    return s / (d.length / 4);
  });
  // фактическая доля площади фото — по первой картинке
  stim.src = images[0].src; await stim.decode().catch(() => {});
  const r = stim.getBoundingClientRect(); imgFrac = (r.width * r.height) / (innerWidth * innerHeight);
}

// ---------- метроном: тон вверх — вдох, вниз — выдох ----------
function startMetronome() {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ac.createOscillator(), gain = ac.createGain();
  osc.type = 'sine'; gain.gain.value = 0.06;
  osc.connect(gain).connect(ac.destination);
  const half = 60 / PACED_RATE / 2;
  const t0 = ac.currentTime + 0.1;
  osc.frequency.setValueAtTime(220, t0);
  for (let i = 0; i < 2000; i++) osc.frequency.linearRampToValueAtTime(i % 2 === 0 ? 330 : 220, t0 + (i + 1) * half);
  osc.start(t0);
  return { stop: () => { try { osc.stop(); ac.close(); } catch {} } };
}

// ---------- признаки из кадра ----------
function faceBox(lm, w, h) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x: x0 * w, y: y0 * h, w: (x1 - x0) * w, h: (y1 - y0) * h };
}
function cheekLuma(img, w, h, box) {
  const d = img.data; let s = 0, n = 0;
  for (const [fx0, fx1] of [[0.2, 0.4], [0.6, 0.8]]) {
    const x0 = Math.max(0, Math.floor(box.x + fx0 * box.w)), x1 = Math.min(w, Math.floor(box.x + fx1 * box.w));
    const y0 = Math.max(0, Math.floor(box.y + 0.45 * box.h)), y1 = Math.min(h, Math.floor(box.y + 0.65 * box.h));
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * 4;
      const Y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (Y > 3 && Y < 250) { s += Y; n++; }
    }
  }
  return n > 50 ? s / n : null;
}
function motionFeatures(lm) {
  const top = lm[10], chin = lm[152], nose = lm[1], eyeL = lm[33], eyeR = lm[263];
  const faceH = Math.hypot(chin.x - top.x, chin.y - top.y);
  const bridge = [6, 168, 197, 195].reduce((s, i) => s + lm[i].y, 0) / 4;
  return {
    d1: bridge / faceH,
    d2: (nose.y - top.y) / Math.max(1e-6, chin.y - top.y),
    d3: Math.hypot(eyeR.x - eyeL.x, eyeR.y - eyeL.y),
  };
}
function prune(arr, now) { while (arr.length && arr[0].t < now - (WINDOW_SEC + 5) * 1000) arr.shift(); }

function estimates(now) {
  const w = {}; for (const k in series) w[k] = resample(series[k], now);
  const out = {
    A: { bpm: lastLegacy?.features?.respRateRaw, conf: lastLegacy?.features?.respConf },
    P: lastMotion ? { bpm: lastMotion.published ? lastMotion.rate : null, conf: lastMotion.conf, raw: lastMotion.rate } : null,
    C: estCorrected(w.skin, w.screen),
    D1: est(w.d1), D2: est(w.d2), D3: est(w.d3), E: est(w.e),
    D2c: estCorrected(w.d2, w.screen), D3c: estCorrected(w.d3, w.screen), Ec: estCorrected(w.e, w.screen),
    screen: est(w.screen), hr: lastLegacy?.bpm,
  };
  const k = consensus([out.D1, out.D2c, out.Ec]);
  out.K = k;
  return out;
}

// ---------- кадр ----------
function onFrame(now) {
  if (!running) return;
  frameHandle = video.requestVideoFrameCallback(onFrame);
  const at = segAt(now);
  if (!at) { finish(); return; }
  const { seg, index, segMs } = at;
  const segElapsed = segMs / 1000, elapsed = (now - runStart) / 1000;
  $('progress').textContent = `${seg.label} · ${Math.ceil(seg.sec - segElapsed)} с · этап ${index + 1}/${SEGMENTS.length} · ${fps} к/с`;

  fpsN++; if (now - fpsT > 1000) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; }
  const w = video.videoWidth, h = video.videoHeight;
  if (!w) return;
  series.screen.push({ t: now, v: screenLuminance(now) });
  const lm = face.detectForVideo(video, now).faceLandmarks?.[0];
  if (lm && lm.length >= 468) {
    if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const landmarks = lm.map(p => ({ x: p.x, y: p.y, z: p.z }));
    const frame = { timestampMs: now, frameW: w, frameH: h, imageData: img, landmarks, fps };
    const a = legacy.update(frame); if (a) lastLegacy = a;
    motion.pushFace(now, landmarks, img, w, h);
    const sk = cheekLuma(img, w, h, faceBox(lm, w, h)); if (sk != null) series.skin.push({ t: now, v: sk });
    const m = motionFeatures(lm);
    series.d1.push({ t: now, v: m.d1 }); series.d2.push({ t: now, v: m.d2 }); series.d3.push({ t: now, v: m.d3 });
  }
  if (pose && frameCount % 3 === 0) {
    const pl = pose.detectForVideo(video, now + 0.5).landmarks?.[0];
    if (pl && pl[11] && pl[12] && (pl[11].visibility ?? 1) > 0.5 && (pl[12].visibility ?? 1) > 0.5) {
      motion.pushShoulders(now, pl[11], pl[12]);
      const width = Math.hypot(pl[11].x - pl[12].x, pl[11].y - pl[12].y);
      if (width > 0.05) series.e.push({ t: now, v: ((pl[11].y + pl[12].y) / 2) / width });
    }
  }
  frameCount++;
  for (const k in series) prune(series[k], now);

  if (now - lastEstimateAt >= 1000) {
    lastEstimateAt = now;
    lastMotion = motion.estimate(now);
    const e = estimates(now);
    // ритм экрана: для ритмичного блока известен, для проб — оценка по самой яркости экрана
    const sr = fixedRate(seg) ?? ((e.screen?.conf ?? 0) >= 0.3 ? e.screen.bpm : '');
    const row = { time_iso: new Date().toISOString(), t_s: elapsed.toFixed(2), segment: seg.id, seg_t_s: segElapsed.toFixed(1),
      screen_rate: sr ?? '', screen_est_rate: e.screen?.bpm ?? '', screen_est_conf: e.screen?.conf ?? '',
      img_frac: imgFrac.toFixed(3), paced_rate: PACED_RATE, fps, hr_v2: e.hr ?? '' };
    for (const k of METHODS) { row[`${k}_rate`] = e[k]?.bpm ?? ''; row[`${k}_conf`] = e[k]?.conf ?? ''; }
    row.C_corr = e.C?.corr ?? ''; row.D3c_corr = e.D3c?.corr ?? ''; row.Ec_corr = e.Ec?.corr ?? '';
    row.P_raw = e.P?.raw ?? ''; row.P_agreeing = lastMotion?.agreeing ?? ''; row.P_third = lastMotion?.thirdSource ?? '';
    rows.push(row);
    $('status').textContent = `Идёт прогон · ${fps} к/с · A=${fmt(e.A?.bpm)} D3c=${fmt(e.D3c?.bpm)} Ec=${fmt(e.Ec?.bpm)} P=${fmt(e.P?.bpm)}`;
  }
}
const fmt = (v) => v != null && v !== '' && Number.isFinite(+v) ? (+v).toFixed(1) : '—';

// ---------- итог ----------
function summarize() {
  const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  let html = '<table><thead><tr><th>Метод</th>';
  for (const s of SEGMENTS) html += `<th>${s.label}</th>`;
  html += '</tr></thead><tbody>';
  const cell = (R, key) => {
    const ok = R.filter(r => r[key] !== '');
    if (!ok.length) return '<td>нет данных</td>';
    const vals = ok.map(r => +r[key]);
    const nearPaced = vals.filter(v => Math.abs(v - PACED_RATE) <= 1.5).length / vals.length;
    const withScreen = ok.filter(r => r.screen_rate !== '' && Math.abs(+r.screen_rate - PACED_RATE) > 1.5);
    const nearScreen = withScreen.length ? withScreen.filter(r => Math.abs(+r[key] - +r.screen_rate) <= 1.5).length / withScreen.length : null;
    const cls = nearPaced >= 0.6 ? 'good' : (nearScreen != null && nearScreen >= 0.5 ? 'bad' : '');
    const coverage = key === 'P_rate' ? `<br>опубликовано ${Math.round(ok.length / R.length * 100)}%` : '';
    return `<td class="${cls}">медиана ${median(vals).toFixed(1)}<br>≈12: ${Math.round(nearPaced * 100)}%${nearScreen != null ? ` · ≈экран: ${Math.round(nearScreen * 100)}%` : ''}${coverage}</td>`;
  };
  for (const k of METHODS) {
    html += `<tr><td><b>${k}</b><br><span class="muted">${METHOD_NOTES[k]}</span></td>`;
    for (const s of SEGMENTS) html += cell(rows.filter(r => r.segment === s.id && +r.seg_t_s >= WARMUP_SEC), `${k}_rate`);
    html += '</tr>';
  }
  html += '<tr><td><b>Ритм экрана</b><br><span class="muted">оценка по яркости экрана</span></td>';
  for (const s of SEGMENTS) {
    const R = rows.filter(r => r.segment === s.id && +r.seg_t_s >= WARMUP_SEC && r.screen_rate !== '');
    html += `<td>${R.length ? `медиана ${median(R.map(r => +r.screen_rate)).toFixed(1)} · ритм есть в ${Math.round(R.length / Math.max(1, rows.filter(r => r.segment === s.id && +r.seg_t_s >= WARMUP_SEC).length) * 100)}% окон` : 'нет выраженного ритма'}</td>`;
  }
  html += '</tr></tbody></table><p class="muted">Зелёный — ≥60% оценок около 12 (метод видит дыхание). Красный — ≥50% совпадают с ритмом экрана. Пришлите CSV.</p>';
  $('summary').innerHTML = html;
}

function finish() {
  running = false;
  if (frameHandle != null) video.cancelVideoFrameCallback?.(frameHandle);
  stream?.getTracks().forEach(t => t.stop());
  audio?.stop();
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  $('progress').textContent = '';
  $('panel').classList.remove('hidden');
  $('start').disabled = false; $('stop').disabled = true; $('csv').disabled = !rows.length;
  $('status').textContent = `Готово · строк: ${rows.length}`;
  summarize();
}

$('start').addEventListener('click', async () => {
  $('start').disabled = true;
  $('status').textContent = 'Загрузка моделей и картинок…';
  try {
    const vision = await FilesetResolver.forVisionTasks(`${MP}/wasm`);
    face ??= await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: `${MP}/models/face_landmarker.task`, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1 });
    try {
      pose ??= await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${MP}/models/pose_landmarker_lite.task`, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 });
    } catch { pose = null; }
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false });
    video.srcObject = stream; await video.play();
    try { await document.documentElement.requestFullscreen?.(); } catch {}
    $('panel').classList.add('hidden');
    await loadImages();   // после полноэкранного режима — чтобы доля площади фото была верной
    legacy = new RppgEngine({ algorithm: 'pos', mode: 'safe' });
    motion = new MotionRespirationEstimator();
    for (const k in series) series[k] = [];
    rows = []; lastLegacy = lastMotion = null; frameCount = 0; shown = { bg: null, img: undefined };
    audio = startMetronome();
    running = true; runStart = performance.now(); fpsT = runStart;
    frameHandle = video.requestVideoFrameCallback(onFrame);
    $('stop').disabled = false;
  } catch (error) {
    $('panel').classList.remove('hidden');
    $('status').textContent = `Ошибка: ${error.message}`;
    $('start').disabled = false;
  }
});
$('stop').addEventListener('click', finish);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && running) finish(); });

$('csv').addEventListener('click', () => {
  const cols = Object.keys(rows[0]);
  const text = [cols.join(','), ...rows.map(r => cols.map(c => r[c]).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `respiration-lab2-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
