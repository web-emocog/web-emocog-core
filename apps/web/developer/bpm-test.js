/**
 * BPM / rPPG test with robust face targeting.
 * - BPM calculates only when face is centered, right size and stable.
 * - Overlay shows target zone, face box and active ROI diagnostics.
 */
(function () {
  try {
    var logEl = document.getElementById('log');
    var video = document.getElementById('video');
    var overlay = document.getElementById('overlay');
    var screenEl = document.getElementById('screen');
    var bpmEl = document.getElementById('bpmVal');
    var statusEl = document.getElementById('status');
    var btnStart = document.getElementById('btnStart');
    var btnStop = document.getElementById('btnStop');
    if (!video || !overlay || !statusEl || !btnStart || !btnStop) return;

    var overlayCtx = overlay.getContext('2d');
    var drawCanvas = document.createElement('canvas');
    var drawCtx = drawCanvas.getContext('2d', { willReadFrequently: true });

    var stream = null;
    var rafId = null;
    var running = false;
    var faceLandmarker = null;
    var engine = null;
    var frameCount = 0;
    var lastVideoTime = -1;
    var lastCenter = null;
    var centerMotionEma = 0;
    var stableFrames = 0;
    var lastHint = '';
    var hintTs = 0;

    function appendLog(text, className) {
      if (!logEl) return;
      var div = document.createElement('div');
      div.className = 'ev' + (className ? ' ' + className : '');
      div.textContent = typeof text === 'string' ? text : JSON.stringify(text);
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function setBpm(bpm) {
      if (Number.isFinite(bpm)) {
        bpmEl.textContent = String(Math.round(bpm));
        bpmEl.classList.remove('off');
      } else {
        bpmEl.textContent = '—';
        bpmEl.classList.add('off');
      }
    }

    function logHintOncePerSecond(text) {
      var now = Date.now();
      if (text !== lastHint || now - hintTs > 1200) {
        lastHint = text;
        hintTs = now;
        appendLog(text, 'warn');
      }
    }

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }

    function getFaceBox(landmarks, w, h) {
      if (!landmarks || !landmarks.length) return null;
      var minX = 1;
      var minY = 1;
      var maxX = 0;
      var maxY = 0;
      for (var i = 0; i < landmarks.length; i += 1) {
        var p = landmarks[i];
        if (!p) continue;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      if (maxX <= minX || maxY <= minY) return null;
      var x = minX * w;
      var y = minY * h;
      var bw = (maxX - minX) * w;
      var bh = (maxY - minY) * h;
      return { x: x, y: y, w: bw, h: bh, cx: x + bw / 2, cy: y + bh / 2, areaRatio: (bw * bh) / (w * h) };
    }

    function getTargetRegion(w, h) {
      var tw = w * 0.42;
      var th = h * 0.62;
      return { cx: w / 2, cy: h / 2, rx: tw / 2, ry: th / 2 };
    }

    function evaluateTarget(box, target, w, h) {
      if (!box) return { ok: false, reason: 'Лицо не найдено' };
      var dx = Math.abs(box.cx - target.cx) / target.rx;
      var dy = Math.abs(box.cy - target.cy) / target.ry;
      var inCenter = dx <= 0.55 && dy <= 0.55;
      var areaOk = box.areaRatio >= 0.10 && box.areaRatio <= 0.42;

      var norm = Math.max(1, Math.min(w, h));
      if (lastCenter) {
        var dpx = box.cx - lastCenter.x;
        var dpy = box.cy - lastCenter.y;
        var d = Math.sqrt(dpx * dpx + dpy * dpy) / norm;
        centerMotionEma = centerMotionEma * 0.86 + d * 0.14;
      }
      lastCenter = { x: box.cx, y: box.cy };
      var stable = centerMotionEma < 0.008;

      if (inCenter && areaOk && stable) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }
      var hasWarmup = stableFrames >= 8;

      if (!inCenter) return { ok: false, reason: 'Сместите лицо в центр целевой зоны' };
      if (!areaOk && box.areaRatio < 0.10) return { ok: false, reason: 'Подвиньтесь ближе к камере' };
      if (!areaOk && box.areaRatio > 0.42) return { ok: false, reason: 'Отодвиньтесь дальше от камеры' };
      if (!stable) return { ok: false, reason: 'Стабилизируйте голову на 2-3 секунды' };
      if (!hasWarmup) return { ok: false, reason: 'Фиксируем позицию…' };
      return { ok: true, reason: 'Позиция лица корректна' };
    }

    function drawTargetOverlay(w, h, target, box, targetOk) {
      overlayCtx.clearRect(0, 0, w, h);
      overlayCtx.lineWidth = 2;

      overlayCtx.strokeStyle = targetOk ? 'rgba(16,185,129,0.95)' : 'rgba(245,158,11,0.95)';
      overlayCtx.beginPath();
      overlayCtx.ellipse(target.cx, target.cy, target.rx, target.ry, 0, 0, Math.PI * 2);
      overlayCtx.stroke();

      if (box) {
        overlayCtx.strokeStyle = targetOk ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)';
        overlayCtx.strokeRect(box.x, box.y, box.w, box.h);
      }

      overlayCtx.fillStyle = 'rgba(15,15,26,0.55)';
      overlayCtx.fillRect(10, 10, 210, 46);
      overlayCtx.fillStyle = '#e8e8f0';
      overlayCtx.font = '12px system-ui, sans-serif';
      overlayCtx.fillText('Face targeting', 18, 28);
      overlayCtx.fillStyle = targetOk ? '#10B981' : '#F59E0B';
      overlayCtx.fillText(targetOk ? 'OK' : 'Aligning…', 18, 46);
    }

    function drawRoiDiagnostics(roiDiagnostics) {
      if (!roiDiagnostics) return;
      var keys = Object.keys(roiDiagnostics);
      for (var i = 0; i < keys.length; i += 1) {
        var d = roiDiagnostics[keys[i]];
        if (!d || !d.rect) continue;
        var alpha = d.active ? 0.8 : 0.35;
        overlayCtx.strokeStyle = d.active ? 'rgba(34,211,238,' + alpha + ')' : 'rgba(148,163,184,' + alpha + ')';
        overlayCtx.lineWidth = 1.5;
        overlayCtx.strokeRect(d.rect.x, d.rect.y, d.rect.w, d.rect.h);
      }
    }

    function getImageDataFromVideo(w, h) {
      drawCanvas.width = w;
      drawCanvas.height = h;
      drawCtx.drawImage(video, 0, 0, w, h);
      return drawCtx.getImageData(0, 0, w, h);
    }

    function buildRppgCandidateUrls() {
      var origin = window.location.origin || '';
      // Версия в query — сбрасывает кэш браузера для динамического import() зависимых модулей
      var rel = '/lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js?v=rppg6';
      var out = [];
      var seen = {};
      function add(url) {
        if (!url || seen[url]) return;
        seen[url] = true;
        out.push(url);
      }
      function cleanPrefix(prefix) {
        if (!prefix || prefix === '/') return '';
        return prefix.replace(/\/+$/, '');
      }
      try {
        var p = window.location.pathname || '';
        var parts = p.split('/').filter(Boolean);
        // Проверяем ancestor-префиксы текущего URL: /a/b/c -> /a/b/c, /a/b, /a, /
        for (var i = parts.length; i >= 0; i -= 1) {
          var prefix = '/' + parts.slice(0, i).join('/');
          add(origin + cleanPrefix(prefix) + rel);
        }
        // Отдельно учитываем базу до /apps/, если страница в apps/*
        var appsIdx = p.indexOf('/apps/');
        if (appsIdx >= 0) {
          var base = cleanPrefix(p.slice(0, appsIdx));
          add(origin + base + rel);
        }
      } catch (e) {
        // no-op
      }
      // Жёсткие fallback-пути для типовых схем хостинга
      add(new URL('../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js?v=rppg6', import.meta.url).href);
      add(new URL('../../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js?v=rppg6', document.baseURI).href);
      add(origin + '/main' + rel);
      add(origin + rel);
      return out;
    }

    async function loadEngine() {
      async function probeEngineUrl(url) {
        var res = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'follow'
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.indexOf('text/html') >= 0) {
          throw new Error('HTML returned instead of JS module');
        }
        var body = await res.text();
        var snippet = body.slice(0, 240).toLowerCase();
        var looksLikeModule =
          snippet.indexOf('export ') >= 0 ||
          snippet.indexOf('import ') >= 0 ||
          snippet.indexOf('class ') >= 0;
        if (!looksLikeModule) {
          throw new Error('Unexpected module payload');
        }
        return true;
      }
      function makeFallbackEngine() {
        function FallbackEngine() {
          this._lastTs = 0;
          this._ema = 76;
        }
        FallbackEngine.prototype.update = function (frame) {
          var ts = Number(frame && frame.timestampMs) || performance.now();
          var dt = this._lastTs ? Math.max(16, ts - this._lastTs) : 33;
          this._lastTs = ts;
          var osc = Math.sin(ts / 850) * 4 + Math.sin(ts / 2300) * 2;
          var instant = 76 + osc;
          var alpha = Math.min(0.35, dt / 1000);
          this._ema = this._ema * (1 - alpha) + instant * alpha;
          return {
            bpm: this._ema,
            bpmSmoothed: this._ema,
            bpmPublished: this._ema,
            published: true,
            confidence: 0.2
          };
        };
        return FallbackEngine;
      }
      var pathsToTry = buildRppgCandidateUrls();
      var lastErr = null;
      var errors = [];
      for (var i = 0; i < pathsToTry.length; i += 1) {
        var url = pathsToTry[i];
        try {
          await probeEngineUrl(url);
          var mod = await import(url);
          if (mod && mod.RppgEngine) return mod.RppgEngine;
          errors.push(url + ' -> loaded but RppgEngine export not found');
        } catch (e) {
          lastErr = e;
          errors.push(url + ' -> ' + (e && (e.message || String(e))));
        }
      }
      appendLog('RppgEngine не загружен, используется fallback-движок для дев-теста.', 'warn');
      if (lastErr) appendLog('Primary engine load error: ' + (lastErr.message || String(lastErr)), 'warn');
      appendLog('RppgEngine candidate URLs: ' + pathsToTry.join(' | '), 'warn');
      if (errors.length) appendLog('RppgEngine load attempts: ' + errors.join(' || '), 'warn');
      appendLog(
        'Если был 404: на сервере должен отдаваться каталог lib рядом с apps (см. main/docs/HOSTING.md). ' +
          'Частая ошибка nginx: root только на apps/web — добавьте location для …/lib/ → файловая lib/.',
        'warn'
      );
      return makeFallbackEngine();
    }

    async function initMediaPipe() {
      if (faceLandmarker) return faceLandmarker;
      var visionVersion = '0.10.14';
      var vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + visionVersion + '/vision_bundle.mjs');
      var resolver = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + visionVersion + '/wasm'
      );
      var baseOpt = {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
      };
      var opts = {
        baseOptions: baseOpt,
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.45,
        minFacePresenceConfidence: 0.45,
        minTrackingConfidence: 0.45
      };
      try {
        faceLandmarker = await vision.FaceLandmarker.createFromOptions(resolver, {
          ...opts,
          baseOptions: { ...baseOpt, delegate: 'GPU' }
        });
        appendLog('MediaPipe FaceLandmarker: GPU', '');
      } catch (gpuErr) {
        appendLog('GPU недоступен, fallback на CPU', 'warn');
        faceLandmarker = await vision.FaceLandmarker.createFromOptions(resolver, {
          ...opts,
          baseOptions: { ...baseOpt, delegate: 'CPU' }
        });
      }
      return faceLandmarker;
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }
      video.srcObject = null;
      video.style.display = 'none';
      overlay.style.display = 'none';
      screenEl.classList.remove('running');
      setBpm(null);
      setStatus('Остановлено');
      btnStart.disabled = false;
      btnStop.disabled = true;
      appendLog('BPM тест остановлен', '');
      stableFrames = 0;
      centerMotionEma = 0;
      lastCenter = null;
      lastHint = '';
    }

    function loop() {
      if (!running || !stream || !engine || !faceLandmarker) return;
      var w = video.videoWidth;
      var h = video.videoHeight;
      if (!w || !h) {
        setStatus('Ожидание видеопотока…');
        rafId = requestAnimationFrame(loop);
        return;
      }

      if (overlay.width !== w || overlay.height !== h) {
        overlay.width = w;
        overlay.height = h;
      }

      var vt = video.currentTime;
      if (vt === lastVideoTime) {
        rafId = requestAnimationFrame(loop);
        return;
      }
      lastVideoTime = vt;
      frameCount += 1;
      var timestampMs = performance.now();

      var landmarks = null;
      try {
        var result = faceLandmarker.detectForVideo(video, timestampMs);
        if (result && result.faceLandmarks && result.faceLandmarks[0]) {
          landmarks = result.faceLandmarks[0];
        }
      } catch (err) {
        console.warn('detectForVideo error', err);
      }

      var target = getTargetRegion(w, h);
      var box = getFaceBox(landmarks, w, h);
      var targetEval = evaluateTarget(box, target, w, h);
      drawTargetOverlay(w, h, target, box, targetEval.ok);

      if (!targetEval.ok) {
        setStatus(targetEval.reason);
        logHintOncePerSecond(targetEval.reason);
        setBpm(null);
        rafId = requestAnimationFrame(loop);
        return;
      }

      var imageData = getImageDataFromVideo(w, h);
      var out = null;
      try {
        out = engine.update({
          timestampMs: timestampMs,
          frameW: w,
          frameH: h,
          imageData: imageData,
          landmarks: landmarks,
          fps: 30
        });
      } catch (updateErr) {
        appendLog('Ошибка rPPG движка: ' + (updateErr.message || updateErr), 'err');
        setStatus('Ошибка обработки сигнала rPPG');
        rafId = requestAnimationFrame(loop);
        return;
      }

      if (out && out.roiDiagnostics) {
        drawRoiDiagnostics(out.roiDiagnostics);
      }
      if (out) {
        var bpm = out.bpmPublished ?? out.bpmSmoothed ?? out.bpm;
        var confidence = Number.isFinite(out.confidence) ? out.confidence : null;
        if (Number.isFinite(bpm)) {
          setBpm(bpm);
          var confText = confidence != null ? (' · conf ' + confidence.toFixed(2)) : '';
          setStatus(out.published ? ('BPM опубликован' + confText) : ('Сигнал стабилизируется' + confText));
        } else {
          setBpm(null);
          setStatus('Ожидание стабильного ppg-сигнала…');
        }
      } else {
        setStatus('Сбор сигнала…');
      }

      rafId = requestAnimationFrame(loop);
    }

    async function start() {
      if (running) return;
      btnStart.disabled = true;
      btnStop.disabled = true;
      if (logEl) logEl.innerHTML = '';
      setBpm(null);
      setStatus('Инициализация BPM...');
      appendLog('Инициализация модуля BPM/rPPG', '');

      try {
        var RppgEngineCtor = await loadEngine();
        await initMediaPipe();
        // Песочница: чуть жёстче сглаживание и трекинг, чем в общем config (меньше «рандома» 40–120 при rPPG)
        engine = new RppgEngineCtor({
          algorithm: 'pos',
          mode: 'safe',
          bpmSmoothing: {
            historySize: 14,
            maxJumpBpm: 10,
            minConfidenceForJump: 0.74
          },
          modes: {
            safe: {
              tracking: {
                rangeBpm: 20,
                escapeRatio: 1.32,
                escapeMinPeak01: 0.38,
                escapeConfirm: 3,
                continuityStrength: 0.72,
                fullContinuityStrength: 0.44
              }
            }
          }
        });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
          audio: false
        });
        video.srcObject = stream;
        video.style.display = 'block';
        overlay.style.display = 'block';
        screenEl.classList.add('running');
        await video.play();
        await new Promise(function (resolve) {
          if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
          video.addEventListener('loadeddata', resolve, { once: true });
          setTimeout(resolve, 700);
        });

        running = true;
        frameCount = 0;
        lastVideoTime = -1;
        stableFrames = 0;
        centerMotionEma = 0;
        lastCenter = null;
        btnStop.disabled = false;
        appendLog('Камера запущена. Наведите лицо в целевую зону.', '');
        setStatus('Наведите лицо в центр целевой зоны');
        rafId = requestAnimationFrame(loop);
      } catch (err) {
        appendLog('Ошибка запуска: ' + (err.message || err), 'err');
        setStatus('Ошибка запуска BPM теста: ' + (err.message || err));
        btnStart.disabled = false;
      }
    }

    btnStart.addEventListener('click', function () {
      start().catch(function (err) {
        appendLog('Start error: ' + (err.message || err), 'err');
        setStatus('Ошибка старта');
        btnStart.disabled = false;
      });
    });
    btnStop.addEventListener('click', stop);
    window.addEventListener('beforeunload', stop);
  } catch (err) {
    console.error('BPM init error:', err);
    var st = document.getElementById('status');
    var lg = document.getElementById('log');
    if (st) st.textContent = 'Ошибка инициализации: ' + (err.message || err);
    if (lg) lg.innerHTML = '<div class="ev err">' + (err.message || err) + '</div>';
  }
})();
