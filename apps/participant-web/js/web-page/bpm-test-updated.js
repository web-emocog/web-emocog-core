import { state, setSessionPhase, recordSessionEvent, getRelativeSessionTimeMs } from './state.js';

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function getFaceBox(landmarks, w, h) {
    if (!Array.isArray(landmarks) || landmarks.length === 0) return null;
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of landmarks) {
        if (!p) continue;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
    }
    if (maxX <= minX || maxY <= minY) return null;
    const x = minX * w;
    const y = minY * h;
    const bw = (maxX - minX) * w;
    const bh = (maxY - minY) * h;
    return {
        x,
        y,
        w: bw,
        h: bh,
        cx: x + bw / 2,
        cy: y + bh / 2,
        areaRatio: (bw * bh) / Math.max(1, w * h)
    };
}

function getTargetRegion(w, h) {
    return { cx: w / 2, cy: h / 2, rx: w * 0.21, ry: h * 0.31 };
}

export function startBpmTest(options = {}) {
    const hubContainer = document.getElementById('testHubContainer');
    const gazeTestsContainer = document.getElementById('gazeTestsContainer');
    const cognitiveContainer = document.getElementById('cognitiveContainer');
    const bpmScreen = document.getElementById('bpmTestScreen');
    const bpmVideo = document.getElementById('bpmVideo');
    const bpmOverlay = document.getElementById('bpmOverlay');
    const bpmValueEl = document.getElementById('bpmLiveValue');
    const bpmStatusEl = document.getElementById('bpmLiveStatus');
    const bpmStopBtn = document.getElementById('bpmStopBtn');

    if (!bpmScreen || !bpmVideo || !bpmOverlay || !bpmValueEl || !bpmStatusEl || !bpmStopBtn) {
        throw new Error('BPM screen elements are missing');
    }
    if (!state.runtime.localAnalyzer) {
        throw new Error('Precheck analyzer is not initialized');
    }

    const overlayCtx = bpmOverlay.getContext('2d');
    const captureCanvas = document.createElement('canvas');
    const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

    let RppgEngine = null;
    let engine = null;
    let running = false;
    let rafId = null;
    let stableFrames = 0;
    let centerMotionEma = 0;
    let lastCenter = null;
    let lastVideoTime = -1;
    const samples = [];
    const testStartedAt = Date.now();

    function setBpm(v) {
        if (Number.isFinite(v)) bpmValueEl.textContent = String(Math.round(v));
        else bpmValueEl.textContent = '—';
    }

    function setStatus(text) {
        bpmStatusEl.textContent = text;
    }

    function drawOverlay(w, h, target, box, targetOk, roiDiagnostics = null) {
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

        if (roiDiagnostics) {
            for (const key of Object.keys(roiDiagnostics)) {
                const d = roiDiagnostics[key];
                if (!d || !d.rect) continue;
                overlayCtx.strokeStyle = d.active ? 'rgba(34,211,238,0.9)' : 'rgba(148,163,184,0.45)';
                overlayCtx.lineWidth = 1.2;
                overlayCtx.strokeRect(d.rect.x, d.rect.y, d.rect.w, d.rect.h);
            }
        }
    }

    function buildRppgCandidateUrls() {
        const origin = window.location.origin || '';
        const rel = '/lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js?v=rppg6';
        const out = [];
        const seen = new Set();
        const add = (url) => {
            if (!url || seen.has(url)) return;
            seen.add(url);
            out.push(url);
        };
        const cleanPrefix = (prefix) => {
            if (!prefix || prefix === '/') return '';
            return prefix.replace(/\/+$/, '');
        };
        try {
            const p = window.location.pathname || '';
            const parts = p.split('/').filter(Boolean);
            for (let i = parts.length; i >= 0; i -= 1) {
                const prefix = '/' + parts.slice(0, i).join('/');
                add(`${origin}${cleanPrefix(prefix)}${rel}`);
            }
            const appsIdx = p.indexOf('/apps/');
            if (appsIdx >= 0) {
                add(`${origin}${cleanPrefix(p.slice(0, appsIdx))}${rel}`);
            }
        } catch {
            // no-op
        }
        add(new URL('../../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js?v=rppg6', import.meta.url).href);
        add(new URL('../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/index.js?v=rppg6', document.baseURI).href);
        add(`${origin}/main${rel}`);
        add(`${origin}${rel}`);
        return out;
    }

    async function loadEngineCtor() {
        const probeEngineUrl = async (url) => {
            const res = await fetch(url, {
                method: 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
                redirect: 'follow'
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ct = String(res.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('text/html')) throw new Error('HTML returned instead of JS module');
            const body = await res.text();
            const snippet = body.slice(0, 240).toLowerCase();
            const looksLikeModule = snippet.includes('export ') || snippet.includes('import ') || snippet.includes('class ');
            if (!looksLikeModule) throw new Error('Unexpected module payload');
            return true;
        };
        const pathsToTry = buildRppgCandidateUrls();
        let lastErr = null;
        const errors = [];
        for (const url of pathsToTry) {
            try {
                await probeEngineUrl(url);
                const mod = await import(url);
                if (mod && mod.RppgEngine) return mod.RppgEngine;
                errors.push(`${url} -> loaded but RppgEngine export not found`);
            } catch (err) {
                lastErr = err;
                errors.push(`${url} -> ${err?.message || String(err)}`);
            }
        }
        throw new Error('RppgEngine load failed: ' + (lastErr ? (lastErr.message || String(lastErr)) : 'not found') + '. Attempts: ' + errors.join(' || '));
    }

    function ensureCameraStream() {
        if (state.runtime.cameraStream) return Promise.resolve(state.runtime.cameraStream);
        return navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 30, min: 15 } },
            audio: false
        }).then(stream => {
            state.runtime.cameraStream = stream;
            return stream;
        });
    }

    function evaluateFaceTarget(box, target, w, h) {
        if (!box) return { ok: false, reason: 'Лицо не найдено' };
        const dx = Math.abs(box.cx - target.cx) / target.rx;
        const dy = Math.abs(box.cy - target.cy) / target.ry;
        const inCenter = dx <= 0.55 && dy <= 0.55;
        const areaOk = box.areaRatio >= 0.10 && box.areaRatio <= 0.42;
        const norm = Math.max(1, Math.min(w, h));

        if (lastCenter) {
            const mx = box.cx - lastCenter.x;
            const my = box.cy - lastCenter.y;
            centerMotionEma = centerMotionEma * 0.86 + (Math.sqrt(mx * mx + my * my) / norm) * 0.14;
        }
        lastCenter = { x: box.cx, y: box.cy };

        const stable = centerMotionEma < 0.008;
        if (inCenter && areaOk && stable) stableFrames += 1;
        else stableFrames = 0;
        const warmed = stableFrames >= 8;

        if (!inCenter) return { ok: false, reason: 'Сместите лицо в центр зоны' };
        if (!areaOk && box.areaRatio < 0.10) return { ok: false, reason: 'Подвиньтесь ближе к камере' };
        if (!areaOk && box.areaRatio > 0.42) return { ok: false, reason: 'Отодвиньтесь дальше от камеры' };
        if (!stable) return { ok: false, reason: 'Стабилизируйте голову' };
        if (!warmed) return { ok: false, reason: 'Фиксируем позицию…' };
        return { ok: true, reason: 'Позиция корректна' };
    }

    function loop() {
        if (!running) return;
        const w = bpmVideo.videoWidth;
        const h = bpmVideo.videoHeight;
        if (!w || !h) {
            setStatus('Ожидание видеопотока...');
            rafId = requestAnimationFrame(loop);
            return;
        }
        if (bpmOverlay.width !== w || bpmOverlay.height !== h) {
            bpmOverlay.width = w;
            bpmOverlay.height = h;
        }
        const vt = bpmVideo.currentTime;
        if (vt === lastVideoTime) {
            rafId = requestAnimationFrame(loop);
            return;
        }
        lastVideoTime = vt;

        state.runtime.localAnalyzer.analyzeFrame(bpmVideo)
            .then((precheckResult) => {
                const landmarks = precheckResult?.landmarks || null;
                const target = getTargetRegion(w, h);
                const box = getFaceBox(landmarks, w, h);
                const targetEval = evaluateFaceTarget(box, target, w, h);
                drawOverlay(w, h, target, box, targetEval.ok);

                if (!targetEval.ok || !landmarks) {
                    setBpm(null);
                    setStatus(targetEval.reason);
                    rafId = requestAnimationFrame(loop);
                    return;
                }

                captureCanvas.width = w;
                captureCanvas.height = h;
                captureCtx.drawImage(bpmVideo, 0, 0, w, h);
                const imageData = captureCtx.getImageData(0, 0, w, h);

                // ВАЖНО: расчёт BPM — без изменений логики движка (тот же RppgEngine.update)
                const out = engine.update({
                    timestampMs: performance.now(),
                    frameW: w,
                    frameH: h,
                    imageData,
                    landmarks,
                    fps: 30
                });

                if (out && out.roiDiagnostics) {
                    drawOverlay(w, h, target, box, true, out.roiDiagnostics);
                }
                if (out) {
                    const bpm = out.bpmPublished ?? out.bpmSmoothed ?? out.bpm;
                    const feat = out.features || {};
                    const rr = feat.respRate != null ? feat.respRate : feat.respRateRaw;
                    const respPart = Number.isFinite(rr) ? ` · Дыхание ~${Math.round(rr)}/мин` : '';
                    if (Number.isFinite(bpm)) {
                        setBpm(bpm);
                        setStatus((out.published ? 'BPM опубликован' : 'Стабилизация сигнала…') + respPart);
                        samples.push({
                            t: Date.now(),
                            tRelMs: getRelativeSessionTimeMs(),
                            bpm: Number(bpm),
                            published: !!out.published,
                            confidence: Number.isFinite(out.confidence) ? out.confidence : null
                        });
                    } else {
                        setBpm(null);
                        setStatus('Сбор сигнала...' + respPart);
                    }
                } else {
                    setBpm(null);
                    setStatus('Сбор сигнала...');
                }
                rafId = requestAnimationFrame(loop);
            })
            .catch((err) => {
                console.warn('[BPM] analyzeFrame error:', err);
                setStatus('Ошибка анализа кадра');
                rafId = requestAnimationFrame(loop);
            });
    }

    function stopAndResolve(reason = 'manual_stop') {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        bpmStopBtn.onclick = null;
        bpmScreen.style.display = 'none';
        setBpm(null);

        const valid = samples.filter(s => Number.isFinite(s.bpm));
        const mean = valid.length ? valid.reduce((acc, s) => acc + s.bpm, 0) / valid.length : null;
        const payload = {
            reason,
            durationMs: Date.now() - testStartedAt,
            sampleCount: samples.length,
            validSampleCount: valid.length,
            bpmMean: Number.isFinite(mean) ? Math.round(mean * 10) / 10 : null
        };
        if (!Array.isArray(state.sessionData.bpmRuns)) state.sessionData.bpmRuns = [];
        state.sessionData.bpmRuns.push({
            ...payload,
            samples
        });
        recordSessionEvent('bpm_test_complete', payload);
        if (typeof options.onComplete === 'function') options.onComplete(payload);
    }

    return loadEngineCtor()
        .then((Ctor) => {
            RppgEngine = Ctor;
            engine = new RppgEngine({
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
            return ensureCameraStream();
        })
        .then((stream) => {
            if (hubContainer) hubContainer.style.display = 'none';
            if (cognitiveContainer) cognitiveContainer.style.display = 'none';
            if (gazeTestsContainer) gazeTestsContainer.style.display = 'block';
            bpmScreen.style.display = 'block';
            bpmVideo.srcObject = stream;
            return bpmVideo.play();
        })
        .then(() => {
            running = true;
            lastVideoTime = -1;
            setSessionPhase('bpm_test', { source: 'startBpmTest' });
            recordSessionEvent('bpm_test_start');
            setStatus('Наведите лицо в целевую зону');
            setBpm(null);
            bpmStopBtn.onclick = () => stopAndResolve('manual_stop');
            rafId = requestAnimationFrame(loop);
        })
        .catch((err) => {
            bpmScreen.style.display = 'none';
            throw err;
        });
}
