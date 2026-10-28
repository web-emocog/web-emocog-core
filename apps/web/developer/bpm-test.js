import { BpmPublicationGate } from '../../participant-web/js/session-runtime/bpm-publication-gate.mjs';
import { publishedRespiration } from '../../participant-web/js/session-runtime/continuous-bpm.js';
import { DiagnosticRun, SerialDiagnosticStage, waitForDiagnosticVideo } from './diagnostic-run.mjs?v=20261028-1';

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
    var activeRun = null;
    var blocked = false;
    var modelStage = new SerialDiagnosticStage();
    var cameraStage = new SerialDiagnosticStage();
    var faceLandmarker = null;
    var engine = null;
    var reporter = null;
    var publicationGate = new BpmPublicationGate();
    var frameCount = 0;
    var lastVideoTime = -1;
    var lastCenter = null;
    var centerMotionEma = 0;
    var stableFrames = 0;
    var lastHint = '';
    var hintTs = 0;
    var measurementStartedAt = 0;
    var lastStatusText = '';

    var PUBLICATION_REASON_TEXT = {
      no_bpm: 'накапливаем видеосигнал',
      low_conf: 'сигнал пока недостаточно надёжен',
      low_snr: 'слишком много шума в цветовом сигнале',
      low_pqi: 'качество пульсовой волны ниже порога',
      low_agreement: 'алгоритмы ещё не согласовали оценку',
      high_agreement_delta: 'оценки алгоритмов расходятся',
      streak: 'подтверждаем стабильность значения',
      unstable: 'значение пока нестабильно',
      subharmonic_guard: 'проверяем возможную кратную частоту',
      low_resp_coupling: 'отделяем пульс от дыхания',
      delta_limit: 'проверяем резкое изменение ЧСС',
      physio_limit: 'изменение ЧСС требует подтверждения',
      upshift_guard: 'подтверждаем повышение ЧСС',
      downshift_guard: 'подтверждаем снижение ЧСС',
      outside_physiological_range: 'оценка вне допустимого диапазона',
      engine_rejected: 'накапливаем валидный сигнал'
    };

    function appendLog(text, className) {
      if (!logEl) return;
      var div = document.createElement('div');
      div.className = 'ev' + (className ? ' ' + className : '');
      div.textContent = typeof text === 'string' ? text : JSON.stringify(text);
      logEl.appendChild(div);
      while (logEl.childElementCount > 200) logEl.firstElementChild.remove();
      logEl.scrollTop = logEl.scrollHeight;
    }

    function setStatus(text) {
      if (text === lastStatusText) return;
      lastStatusText = text;
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
      if (text !== lastHint || now - hintTs > 5000) {
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
      if (drawCanvas.width !== w) drawCanvas.width = w;
      if (drawCanvas.height !== h) drawCanvas.height = h;
      drawCtx.drawImage(video, 0, 0, w, h);
      return drawCtx.getImageData(0, 0, w, h);
    }

    async function loadEngine(run) {
      // Resolve from the module, not the page/base tag or guessed hosting ancestors.
      var url = new URL('../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js?v=rppg6', import.meta.url).href;
      await run.wait(() => WecogHttp.request(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: run.signal
      }, async function (res) {
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
      }, { scope: 'document' }));
      var mod = await run.wait(() => import(url));
      run.check();
      if (typeof mod.RppgEngine !== 'function' || typeof mod.SessionReporter !== 'function') {
        throw new Error('Diagnostic engine unavailable');
      }
      return mod;
    }

    async function initMediaPipe(run) {
      var vision = await run.wait(() => import('../../participant-web/js/vendor/mediapipe/vision_bundle.mjs'));
      var resolver = await run.wait(() => vision.FilesetResolver.forVisionTasks(
        new URL('../../participant-web/js/vendor/mediapipe/wasm', import.meta.url).href
      ));
      var baseOpt = {
        modelAssetPath: new URL('../../participant-web/js/vendor/mediapipe/models/face_landmarker.task', import.meta.url).href
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
        var task = await modelStage.request(run, () => vision.FaceLandmarker.createFromOptions(resolver, {
          ...opts,
          baseOptions: { ...baseOpt, delegate: 'GPU' }
        }), { release: task => task.close() });
        run.check();
        appendLog('MediaPipe FaceLandmarker: GPU', '');
        return task;
      } catch (gpuErr) {
        if (gpuErr?.code === 'diagnostic_timeout') throw gpuErr;
        run.check();
        appendLog('GPU недоступен, fallback на CPU', 'warn');
        return modelStage.request(run, () => vision.FaceLandmarker.createFromOptions(resolver, {
          ...opts,
          baseOptions: { ...baseOpt, delegate: 'CPU' }
        }), { release: task => task.close() });
      }
    }

    function stopTracks(acquired) {
      acquired.getTracks().forEach(function (track) {
        try { track.stop(); } catch (_) { /* Release the other tracks too. */ }
      });
    }

    function stop() {
      var hadRun = !!activeRun;
      var run = activeRun;
      activeRun = null;
      running = false;
      run?.stop();
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      stream = null;
      faceLandmarker = null;
      engine = null;
      try { video.pause(); } catch (_) { /* Native resources are already released by the run. */ }
      video.srcObject = null;
      video.style.display = 'none';
      overlay.style.display = 'none';
      screenEl.classList.remove('running');
      setBpm(null);
      setStatus('Остановлено');
      measurementStartedAt = 0;
      btnStart.disabled = blocked;
      btnStop.disabled = true;
      if (reporter) {
        var stoppedReporter = reporter;
        reporter = null;
        try {
          var sessionJson = stoppedReporter.finalize();
          var respRows = (sessionJson && sessionJson.samples) ? sessionJson.samples : [];
          var respVals = respRows.map(function (s) { return s.resp_rate; }).filter(function (v) { return Number.isFinite(v); });
          var respMean = respVals.length
            ? Math.round((respVals.reduce(function (a, b) { return a + b; }, 0) / respVals.length) * 10) / 10
            : null;
          appendLog('Respiration retained samples: ' + respRows.length + (respMean != null ? (' · retained mean ' + respMean + '/min') : ''), '');
        } catch (_) { appendLog('Сводка теста недоступна. Камера и обработка остановлены.', 'warn'); }
      }
      drawCanvas.width = drawCanvas.height = 0;
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      if (hadRun) appendLog('BPM тест остановлен', '');
      stableFrames = 0;
      centerMotionEma = 0;
      lastCenter = null;
      lastHint = '';
    }

    function scheduleFrame(run) {
      if (activeRun !== run || run.signal.aborted) return;
      rafId = requestAnimationFrame(() => {
        if (activeRun !== run || run.signal.aborted) return;
        rafId = null;
        try { loop(run); }
        catch (_) {
          stop();
          setStatus('Ошибка обработки видео. Тест остановлен; можно повторить запуск.');
          appendLog('Обработка видео прервана без сохранения кадров.', 'err');
        }
      });
    }

    function loop(run) {
      if (activeRun !== run || run.signal.aborted || !running || !stream || !engine || !faceLandmarker) return;
      var w = video.videoWidth;
      var h = video.videoHeight;
      if (!w || !h) {
        setStatus('Ожидание видеопотока…');
        scheduleFrame(run);
        return;
      }

      if (overlay.width !== w || overlay.height !== h) {
        overlay.width = w;
        overlay.height = h;
      }

      var vt = video.currentTime;
      if (vt === lastVideoTime) {
        scheduleFrame(run);
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
        setStatus('Ошибка распознавания лица. Измерения этого кадра недоступны.');
        logHintOncePerSecond('Не удалось обработать кадр лица.');
        setBpm(null);
        scheduleFrame(run);
        return;
      }

      var target = getTargetRegion(w, h);
      var box = getFaceBox(landmarks, w, h);
      var targetEval = evaluateTarget(box, target, w, h);
      drawTargetOverlay(w, h, target, box, targetEval.ok);

      if (!targetEval.ok) {
        setStatus(targetEval.reason);
        logHintOncePerSecond(targetEval.reason);
        setBpm(null);
        scheduleFrame(run);
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
          landmarks: landmarks
        });
      } catch (updateErr) {
        logHintOncePerSecond('Ошибка обработки сигнала rPPG. Кадр не принят.');
        setStatus('Ошибка обработки сигнала rPPG');
        scheduleFrame(run);
        return;
      }

      if (out && out.roiDiagnostics) {
        drawRoiDiagnostics(out.roiDiagnostics);
      }
      if (out) {
        var publication = publicationGate.evaluate(out);
        var rr = publishedRespiration(out.features);
        if (reporter) reporter.push({
          ...out,
          features: { ...out.features, respRate: rr },
          published: publication.accepted && !publication.held,
          bpmPublished: publication.bpm,
          publishReason: publication.reason
        }, timestampMs);
        var bpm = publication.bpm;
        var confidence = Number.isFinite(out.confidence) ? out.confidence : null;
        var respPart = Number.isFinite(rr) ? (' · дыхание ~' + Math.round(rr) + '/мин') : '';
        if (Number.isFinite(bpm)) {
          setBpm(bpm);
          var confText = confidence != null ? (' · conf ' + confidence.toFixed(2)) : '';
          var classification = publication.classification === 'elevated'
            ? ' · повышенное значение подтверждено длительным стабильным сигналом'
            : publication.classification === 'low'
              ? ' · низкое значение подтверждено длительным стабильным сигналом'
              : '';
          setStatus((publication.held ? 'Последняя валидная ЧСС удерживается' : 'ЧСС опубликована') + confText + classification + respPart);
        } else {
          setBpm(null);
          var confirmation = publication.confirmationCount
            ? (' (' + publication.confirmationCount + '/8)')
            : '';
          var elapsedSec = measurementStartedAt ? Math.floor((performance.now() - measurementStartedAt) / 1000) : 0;
          var reasonText = PUBLICATION_REASON_TEXT[publication.reason] || 'проверяем качество сигнала';
          setStatus('Измерение ' + elapsedSec + ' с · ' + reasonText + confirmation + respPart);
        }
      } else {
        setStatus('Сбор сигнала…');
      }

      scheduleFrame(run);
    }

    async function start() {
      if (activeRun || blocked) return;
      var run = new DiagnosticRun();
      activeRun = run;
      btnStart.disabled = true;
      btnStop.disabled = false;
      if (logEl) logEl.innerHTML = '';
      setBpm(null);
      setStatus('Инициализация BPM...');
      appendLog('Инициализация модуля BPM/rPPG', '');

      try {
        var access = await run.wait(() => window.WecogBpmAccess);
        run.check();
        if (!access?.ok || !['admin', 'developer'].includes(access.user?.role)) {
          throw Object.assign(new Error('Diagnostic access unavailable'), { code: 'diagnostic_access_denied' });
        }
        window.WecogStaffSession?.assertCurrent();
        // A cached admission may outlive logout, role revocation or a BFCache round trip.
        var fresh = await run.wait(() => WecogHttp.json(window.EmocogApiBase.resolve() + '/auth/me', {
          credentials: 'include', signal: run.signal
        }, { scope: 'document', timeoutMs: 15000 }));
        run.check();
        var actor = fresh?.user || fresh;
        if (!actor?.id || String(actor.id) !== String(access.user.id)
          || !['admin', 'developer'].includes(actor.role)) {
          throw Object.assign(new Error('Diagnostic access unavailable'), { code: 'diagnostic_access_denied' });
        }
        var policy = document.permissionsPolicy || document.featurePolicy;
        if (policy?.allowsFeature && !policy.allowsFeature('camera')) {
          throw Object.assign(new Error('Diagnostic camera denied by policy'), { code: 'diagnostic_camera_policy_denied' });
        }
        var mod = await loadEngine(run);
        var task = await initMediaPipe(run);
        run.check();
        faceLandmarker = task;
        engine = new mod.RppgEngine({ algorithm: 'pos', mode: 'safe' });
        publicationGate.reset();
        reporter = new mod.SessionReporter({ maxSamples: 7200 });
        var acquired = await cameraStage.request(run, () => navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
          audio: false
        }), { release: stopTracks });
        run.check();
        stream = acquired;
        video.srcObject = stream;
        video.style.display = 'block';
        overlay.style.display = 'block';
        screenEl.classList.add('running');
        await run.wait(() => video.play(), { timeoutMs: 10000 });
        await waitForDiagnosticVideo(video, run);
        run.check();

        running = true;
        measurementStartedAt = performance.now();
        frameCount = 0;
        lastVideoTime = -1;
        stableFrames = 0;
        centerMotionEma = 0;
        lastCenter = null;
        btnStop.disabled = false;
        appendLog('Камера запущена. Наведите лицо в целевую зону.', '');
        setStatus('Наведите лицо в центр целевой зоны');
        scheduleFrame(run);
      } catch (err) {
        if (activeRun !== run) return;
        stop();
        var message = err?.code === 'diagnostic_timeout'
          ? 'Время ожидания запуска истекло. Тест остановлен; повторите запуск.'
          : err?.code === 'diagnostic_camera_policy_denied'
            ? 'Камера запрещена политикой этого сервера. Используйте разрешённую диагностическую среду.'
          : err?.code === 'diagnostic_access_denied' || err?.code === 'staff_account_changed' || err?.status === 401 || err?.status === 403
            ? 'Не удалось подтвердить доступ к тесту. Обновите страницу.'
            : err?.name === 'NotAllowedError'
              ? 'Камера недоступна. Проверьте разрешение браузера и повторите запуск.'
              : 'Не удалось запустить BPM тест. Проверьте камеру и загрузку локальных модулей.';
        appendLog(message, 'err');
        setStatus(message);
      }
    }

    btnStart.addEventListener('click', function () {
      start();
    });
    btnStop.addEventListener('click', stop);
    window.addEventListener('beforeunload', stop);
    window.addEventListener('pagehide', stop);
    window.addEventListener('wecog:staffsessionblocked', () => { blocked = true; stop(); });
  } catch (err) {
    var st = document.getElementById('status');
    var lg = document.getElementById('log');
    if (st) st.textContent = 'Не удалось инициализировать BPM тест. Обновите страницу.';
    if (btnStart) btnStart.disabled = true;
    if (btnStop) btnStop.disabled = true;
    if (lg) {
      var errorLine = document.createElement('div');
      errorLine.className = 'ev err';
      errorLine.textContent = 'Инициализация теста недоступна. Камера не запущена.';
      lg.replaceChildren(errorLine);
    }
  }
})();
