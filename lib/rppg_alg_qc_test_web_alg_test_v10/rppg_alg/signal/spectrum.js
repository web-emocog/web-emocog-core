import { fftMag2Real } from "./fft.js";
import { clamp } from "../utils.js";

/**
 * estimateHeartRate — оценка ЧСС по rPPG сигналу
 *
 * Включает:
 * - FFT анализ с поиском пиков
 * - Autocorrelation backup
 * - Harmonic disambiguation:
 *   * down2: f -> f/2 (строго, чтобы не уезжать в субгармонику)
 *   * up2:   f -> 2f  (включая rescue на старте против залипания 55–63)
 * - Weak peak handling: при слабом пике выбираем ближе к prevBpm
 * - Fusion FFT + ACF при согласованности
 */
export function estimateHeartRate(sig, fs, bandHz, prevBpm = null, opts = null) {
  // минимально нужно хотя бы ~3 секунды (иначе FFT/ACF бессмысленны)
  if (!sig || sig.length < fs * 3) {
    return {
      bpm: null,
      bpmFft: null,
      bpmAc: null,
      snr01: 0,
      snrDb: null,
      peak01: 0,
      ac01: 0,
      signal01: 0,
      rawScore: 0,
      peakRatio: 0,
      specEntropy: 0,
      method: "none",
      harmonicFixed: false,
      harmonicDir: null,
    };
  }

  const { mag2, freqs } = fftMag2Real(sig, fs);
  // Вычисляем спектральную энтропию
  function spectralEntropy(mag2Arr, freqsArr, band) {
    let sum = 0;
    let cnt = 0;
    for (let k = 0; k < freqsArr.length; k++) {
      const f = freqsArr[k];
      if (f < band[0] || f > band[1]) continue;
      const v = mag2Arr[k];
      if (v > 0) sum += v;
      cnt++;
    }
    if (sum <= 1e-12 || cnt < 2) return 0;

    // Вычисляем энтропию
    let h = 0;
    for (let k = 0; k < freqsArr.length; k++) {
      const f = freqsArr[k];
      if (f < band[0] || f > band[1]) continue;
      const p = mag2Arr[k] / sum;
      if (p > 1e-12) h += p * Math.log(p);
    }
    return clamp(-h / Math.log(cnt), 0, 1);
  }

  // кандидаты — локальные максимумы внутри bandHz
  const cand = [];
  for (let k = 2; k < freqs.length - 2; k++) {
    const f = freqs[k];
    if (f < bandHz[0] || f > bandHz[1]) continue;
    if (mag2[k] > mag2[k - 1] && mag2[k] > mag2[k + 1]) cand.push({ k, f, p: mag2[k] });
  }
  cand.sort((a, b) => b.p - a.p);
  const top = cand.slice(0, 10);

  const df = freqs[1] - freqs[0];

  function powerAtFreq(f) {
    const k = Math.round(f / df);
    if (k < 0 || k >= mag2.length) return 0;
    return mag2[k];
  }

  // Вычисляем SNR для пика k0, исключая окрестности фундамента и 2-го гармоника
  function snrStatsForK(k0) {
    const guard = Math.max(1, Math.round(0.12 / df));
    const harmK = Math.round((2 * freqs[k0]) / df);
    let noiseSum = 0,
      noiseCnt = 0;

      // Ищем шум в окрестностях
    for (let k = 1; k < freqs.length; k++) {
      const f = freqs[k];
      if (f < bandHz[0] || f > bandHz[1]) continue;

      const nearFund = Math.abs(k - k0) <= guard;
      const nearHarm =
        harmK >= 0 && harmK < freqs.length ? Math.abs(k - harmK) <= guard : false;
      if (nearFund || nearHarm) continue;

      noiseSum += mag2[k];
      noiseCnt++;
    }

    // Вычисляем шум
    const noise = noiseSum / Math.max(1, noiseCnt);
    const snrLinear = mag2[k0] / (noise + 1e-12);
    const snrDb = 10 * Math.log10(snrLinear + 1e-12);
    const snr01 = clamp(1 / (1 + Math.exp(-(Math.log(snrLinear) - 0.5))), 0, 1);
    return { snrLinear, snrDb, snr01 };
  }

  // Предпочитаемый диапазон частот
  const preferRange = opts?.preferBpmRange ?? null;
  const preferBoost = opts?.preferBoost ?? 1.0;

  // Весовые коэффициенты для rawScore
  const rawScoreWeights = opts?.rawScoreWeights ?? null;
  const wP2 = Number.isFinite(rawScoreWeights?.p2) ? rawScoreWeights.p2 : 0.5;
  const wHalf = Number.isFinite(rawScoreWeights?.pHalf) ? rawScoreWeights.pHalf : 0.12;

  // Сила приоритета непрерывности (0..1) — позволяет "мягкую" непрерывность для полного диапазона
  const continuityStrength = clamp(opts?.continuityStrength ?? 1.0, 0, 1);

  // Параметры обработки слабых пиков (когда сложно выбрать между несколькими кандидатами)
  const weakPeakRatio = opts?.weakPeakRatio ?? 1.35;
  const weakPeak01 = opts?.weakPeak01 ?? 0.55;
  const weakPickMinRawFrac = opts?.weakPickMinRawFrac ?? 0.75;

  // --- Harmonic disambiguation options (будут приходить из RppgEngine.js) ---
  // Предыдущая опубликованная частота
  const prevPubBpm = opts?.prevPubBpm ?? null;

  // Предпочитаемый диапазон частот
  const harmonicRatioThreshold = opts?.harmonicRatioThreshold ?? 0.85;
  const harmonicDoubleCheckMinPeakRatio = opts?.harmonicDoubleCheckMinPeakRatio ?? 0.60;

  // ВАЖНО: интерпретируем это как "сколько можно потерять по SNR01 при переходе на 2×"
  // (0..1). Чем больше — тем легче принять удвоение.
  const harmonicDoubleCheckScoreMargin = opts?.harmonicDoubleCheckScoreMargin ?? 0.20;

  // rescue против залипания в 55–63
  const harmonicRescueEnabled = opts?.harmonicRescueEnabled ?? true;
  const harmonicRescueLowMaxBpm = opts?.harmonicRescueLowMaxBpm ?? 75;
  const harmonicRescueMinDoubleBpm = opts?.harmonicRescueMinDoubleBpm ?? 85;
  const harmonicRescueMinScoreRatio = opts?.harmonicRescueMinScoreRatio ?? 0.40;
  const harmonicRescueMaxSnrDrop = opts?.harmonicRescueMaxSnrDrop ?? 0.18;
  // Если 2х гармоника сильнее/надёжнее обычной, разрешаем переход на 2х
  const harmonicUp2DominanceRatio = opts?.harmonicUp2DominanceRatio ?? 1.35;
  const harmonicUp2MinSnrMargin = opts?.harmonicUp2MinSnrMargin ?? 0.08;
  const harmonicUp2PeakRatioMax = opts?.harmonicUp2PeakRatioMax ?? 2.0;
  const harmonicUp2LowBpmMax = opts?.harmonicUp2LowBpmMax ?? 80;

  // строгий down2 (чтобы не уезжать в субгармонику)
  const harmonicHalfMinPowerRatio = opts?.harmonicHalfMinPowerRatio ?? 1.10; // p(f/2) > p(f) * 1.10
  const harmonicHalfMinSnrMargin = opts?.harmonicHalfMinSnrMargin ?? 0.08; // SNR(f/2) лучше минимум на 0.08
  // Допускаем down2, если он в preferRange и не слишком хуже по сырым пикам (для устойчивости к шуму)
  const subGuardEnabled = opts?.harmonicSubGuardEnabled ?? true;
  const subGuardMaxBpm = opts?.harmonicSubGuardMaxBpm ?? 80;
  const subGuardMinDoubleBpm = opts?.harmonicSubGuardMinDoubleBpm ?? 90;
  const subGuardMinScoreRatio = opts?.harmonicSubGuardMinScoreRatio ?? 0.45;
  const subGuardMinPowerRatio = opts?.harmonicSubGuardMinPowerRatio ?? 0.30;
  const subGuardMaxSnrDrop = opts?.harmonicSubGuardMaxSnrDrop ?? 0.12;
  const subGuardPrevRatioMax = opts?.harmonicSubGuardPrevRatioMax ?? 0.72;

  let best = null;
  // Инициализация переменных
  let peak01 = 0,
    peakRatio = 0,
    rawScoreBest = 0,
    snr01 = 0,
    snrDb = null,
    bpmFft = null;

  let harmonicFixed = false;
  let harmonicDir = null;
  let harmonicAlt = null;

  if (top.length) {
    // скоринг: rawScore + continuity к prevBpm + preferRange
    const scored = top.map((c) => {
      const p1 = c.p;
      const p2 = powerAtFreq(2 * c.f);
      const pHalf = powerAtFreq(0.5 * c.f);

      let rawScore = p1 + wP2 * p2 + wHalf * pHalf;

      // Предпочитаемый диапазон частот
      if (preferRange && Array.isArray(preferRange) && preferRange.length === 2) {
        const bpm0 = c.f * 60;
        if (bpm0 >= preferRange[0] && bpm0 <= preferRange[1]) rawScore *= preferBoost;
      }

      let score = rawScore;

      // Непрерывность
      if (prevBpm && Number.isFinite(prevBpm) && continuityStrength > 0) {
        const bpm0 = c.f * 60;
        const d = Math.abs(bpm0 - prevBpm);
        const penalty = Math.exp(-Math.max(0, d - 12) / 18);
        const cont = 0.65 + 0.35 * penalty;
        const contBlend = (1 - continuityStrength) + continuityStrength * cont;
        score *= contBlend;
      }

      return { ...c, p1, p2, pHalf, rawScore, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // peak ratio из rawScore топ-2
    const byRaw = [...scored].sort((a, b) => b.rawScore - a.rawScore);
    const raw1 = byRaw[0]?.rawScore ?? 0;
    const raw2 = byRaw[1]?.rawScore ?? raw1 * 0.25;

    peakRatio = raw1 / (raw2 + 1e-12);
    peak01 = clamp((Math.log(peakRatio) - 0.15) / 1.2, 0, 1);
    rawScoreBest = raw1;

    // базовый выбор
    best = scored[0] ?? null;

    // если пик слабый — пытаемся выбрать ближе к prevBpm (но не сильно хуже по rawScore)
    if (best && prevBpm && Number.isFinite(prevBpm)) {
      const weak = peakRatio < weakPeakRatio || peak01 < weakPeak01;
      if (weak) {
        const minRaw = raw1 * weakPickMinRawFrac;
        let closest = null;
        let bestD = Infinity;

        // Ищем ближайший к prevBpm
        for (const c of scored.slice(0, 6)) {
          if ((c.rawScore ?? 0) < minRaw) continue;
          const bpm0 = c.f * 60;
          const d = Math.abs(bpm0 - prevBpm);
          if (d < bestD) {
            bestD = d;
            closest = c;
          }
        }
        if (closest) best = closest;
      }
    }

    // параболическая интерполяция вокруг k
    const k = best.k;
    const p0 = mag2[k - 1] ?? mag2[k];
    const p1 = mag2[k];
    const p2 = mag2[k + 1] ?? mag2[k];
    const denom = p0 - 2 * p1 + p2;
    const delta = Math.abs(denom) < 1e-12 ? 0 : (0.5 * (p0 - p2)) / denom;

    let fPeak = freqs[k] + delta * df;
    let kPeak = k;
    let snrPeakStats = snrStatsForK(kPeak);
    let snrPeak = snrPeakStats.snr01;
    let snrPeakDb = snrPeakStats.snrDb;

    // ------------------------------------------------------------
    // (C0) Harmonic dominance: если 2х гармоника сильнее, переходим на 2х
    // ------------------------------------------------------------
    {
      const pFund = best.p1 ?? powerAtFreq(fPeak);
      const p2h = best.p2 ?? powerAtFreq(2 * fPeak);
      const ratio = p2h / (pFund + 1e-12);
      const fDouble = fPeak * 2;
      const bpmCur = fPeak * 60;
      if (
        bpmCur <= harmonicUp2LowBpmMax && // максимум для перехода на 2х
        ratio >= harmonicUp2DominanceRatio && // соотношение для перехода на 2х
        fDouble <= bandHz[1] &&
        peakRatio <= harmonicUp2PeakRatioMax
      ) { 
        const kDouble = Math.max(1, Math.min(mag2.length - 2, Math.round(fDouble / df)));
        const snrDouble = snrStatsForK(kDouble).snr01;
        const snrOk = (snrDouble + harmonicUp2MinSnrMargin) >= snrPeak;
        if (snrOk) { // если SNR 2х гармоники достаточно высок
          fPeak = fDouble;
          kPeak = kDouble;
          snrPeak = snrDouble;
          snrPeakDb = snrStatsForK(kDouble).snrDb;
          harmonicFixed = true;
          harmonicDir = "up2_dom";
        }
      }
    }

    // ------------------------------------------------------------
    // (C1) Harmonic disambiguation: DOWN2 (f -> f/2), СТРОГО
    // ------------------------------------------------------------
    const fFund = fPeak * 0.5;
    if (fFund >= bandHz[0] && fFund <= bandHz[1]) {
      const pH = powerAtFreq(fPeak);
      const pF = powerAtFreq(fFund);
      const ratioHalf = pF / (pH + 1e-12);

      const kFund = Math.max(1, Math.min(mag2.length - 2, Math.round(fFund / df)));
      const snrFund = snrStatsForK(kFund).snr01;

      const halfBetterByPower = ratioHalf >= harmonicHalfMinPowerRatio;
      const halfBetterBySnr = snrFund - snrPeak >= harmonicHalfMinSnrMargin;

      // делим ТОЛЬКО если f/2 реально лучше по мощности и SNR
      if (halfBetterByPower && halfBetterBySnr) {
        fPeak = fFund;
        kPeak = kFund;
        snrPeak = snrFund;
        snrPeakDb = snrStatsForK(kFund).snrDb;
        harmonicFixed = true;
        harmonicDir = "down2";
      }
    }

    // ------------------------------------------------------------
    // (C2) Harmonic disambiguation: UP2 (f -> 2f) + rescue
    // ------------------------------------------------------------
    {
      const hasPrevPub = prevPubBpm && Number.isFinite(prevPubBpm);
      const noPrevPub = !hasPrevPub;

      const currentBpm = fPeak * 60;

      // обычный триггер: “провал вниз” относительно prevPub
      const isMuchLower =
        hasPrevPub && currentBpm < prevPubBpm * harmonicRatioThreshold;

      // rescue: мы подозрительно низко на старте или prevPub уже низкий
      const prevPubLooksBad = hasPrevPub && prevPubBpm < harmonicRescueLowMaxBpm;
      const suspiciousLowLock =
        harmonicRescueEnabled &&
        (noPrevPub || prevPubLooksBad) &&
        currentBpm <= harmonicRescueLowMaxBpm;

      // раньше пик мог быть сильный на 55, и up2 не запускался никогда — делаем мягче
      const peakNotStrong = peak01 < 0.62 || snrPeak < 0.55 || peakRatio < 1.8;

      if (!harmonicFixed && ((isMuchLower && peakNotStrong) || suspiciousLowLock)) {
        const fDouble = fPeak * 2;
        if (fDouble <= bandHz[1]) {
          const doubleBpm = fDouble * 60;

          // разрешаем проверять 2х гармонику, если она в принципе может быть адекватной,
          // или если мы подозрительно низко “залипли” и нужно спасать ситуацию
          if (doubleBpm >= harmonicRescueMinDoubleBpm || !suspiciousLowLock) {
            const pDouble = powerAtFreq(fDouble);
            const pCurrent = powerAtFreq(fPeak);
            const scoreRatio = pDouble / (pCurrent + 1e-12);

            // Ищем ближайший к 2х гармонике
            const kDouble = Math.max(1, Math.min(mag2.length - 2, Math.round(fDouble / df)));
            const snrDouble = snrStatsForK(kDouble).snr01;

            // Проверяем, достаточно ли хороша 2х гармоника
            const almostAsGood =
              scoreRatio >= harmonicDoubleCheckMinPeakRatio ||
              (suspiciousLowLock && scoreRatio >= harmonicRescueMinScoreRatio);

            const snrDrop = snrPeak - snrDouble;
            const snrAcceptable =
              snrDrop <= harmonicDoubleCheckScoreMargin ||
              (suspiciousLowLock && snrDrop <= harmonicRescueMaxSnrDrop);

            // close-to-prevPub логично только если prevPub “адекватный”
            const closerToPublished = hasPrevPub
              ? Math.abs(doubleBpm - prevPubBpm) < Math.abs(currentBpm - prevPubBpm)
              : true;

            const closerGate = suspiciousLowLock || prevPubLooksBad ? true : closerToPublished;

            if (almostAsGood && snrAcceptable && closerGate) {
              fPeak = fDouble;
              kPeak = kDouble;
              snrPeak = snrDouble;
              snrPeakDb = snrStatsForK(kDouble).snrDb;
              harmonicFixed = true;
              harmonicDir = "up2";
            }
          }
        }
      }
    }

    // ------------------------------------------------------------
    // (C3) Subharmonic guard: если низкая гармоника доминирует, но 2х может быть адекватной
    // ------------------------------------------------------------
    {
      const allowOverride = !harmonicFixed || harmonicDir === "down2";
      const bpmCur = fPeak * 60;
      const hasPrevPub = prevPubBpm && Number.isFinite(prevPubBpm);
      const prevLooksLow = hasPrevPub && prevPubBpm < subGuardMinDoubleBpm;
      const prevOk = !hasPrevPub || prevLooksLow || (bpmCur < prevPubBpm * subGuardPrevRatioMax);

      // Ищем ближайший к 2х гармонике
      if (allowOverride && subGuardEnabled && bpmCur <= subGuardMaxBpm && prevOk) {
        const f2 = fPeak * 2;
        const bpm2 = f2 * 60;
        if (f2 <= bandHz[1] && bpm2 >= subGuardMinDoubleBpm) {
          const pCur = powerAtFreq(fPeak);
          const p2 = powerAtFreq(f2);
          const rawCur = pCur + wP2 * powerAtFreq(2 * fPeak) + wHalf * powerAtFreq(0.5 * fPeak);
          const raw2 = p2 + wP2 * powerAtFreq(2 * f2) + wHalf * powerAtFreq(0.5 * f2);
          const scoreRatio = raw2 / (rawCur + 1e-12);
          const powerRatio = p2 / (pCur + 1e-12);

          const k2 = Math.max(1, Math.min(mag2.length - 2, Math.round(f2 / df)));
          const snr2 = snrStatsForK(k2).snr01;
          const snrDelta = snr2 - snrPeak;

          // Проверяем, достаточно ли хороша 2х гармоника
          harmonicAlt = { bpm: bpm2, scoreRatio, powerRatio, snrDelta };

          const scoreOk = scoreRatio >= subGuardMinScoreRatio;
          const powerOk = powerRatio >= subGuardMinPowerRatio;
          const snrOk = snrDelta >= -subGuardMaxSnrDrop;

          // Разрешаем 2х, если он хорош по метрикам, и при этом близко к prevPub (если prevPub есть)
          if (scoreOk && powerOk && snrOk) {
            fPeak = f2;
            kPeak = k2;
            snrPeak = snr2;
            snrPeakDb = snrStatsForK(k2).snrDb;
            harmonicFixed = true;
            harmonicDir = "up2_guard";
          }
        }
      }
    }

    bpmFft = fPeak * 60;
    snr01 = snrPeak;
    snrDb = snrPeakDb;
  }

  const specEntropy = spectralEntropy(mag2, freqs, bandHz);
  const fftConf = clamp(0.6 * snr01 + 0.4 * peak01, 0, 1);

  // -----------------------
  // Автокорреляция
  // -----------------------
  const N = sig.length;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += sig[i];
  mean /= N;

  let varSum = 0;
  const z = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = sig[i] - mean;
    varSum += v * v;
    z[i] = v;
  }
  const std = Math.sqrt(varSum / Math.max(1, N - 1)) + 1e-12;
  for (let i = 0; i < N; i++) z[i] = z[i] / std;

  const bpmMin = bandHz[0] * 60;
  const bpmMax = bandHz[1] * 60;
  const lagMin = Math.max(2, Math.floor((fs * 60) / bpmMax));
  const lagMax = Math.min(N - 2, Math.ceil((fs * 60) / bpmMin));

  // Ищем лучший лаг
  let bestLag = null;
  let bestR = -1e9;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    const M = N - lag;
    for (let i = 0; i < M; i++) s += z[i] * z[i + lag];
    const r = s / Math.max(1, M);
    if (r > bestR) {
      bestR = r;
      bestLag = lag;
    }
  }

  // Ищем ближайший к 2х гармонике
  let bpmAc = null;
  if (bestLag) bpmAc = (60 * fs) / bestLag;
  const ac01 = clamp((bestR - 0.20) / 0.55, 0, 1);

  function closenessPenalty(bpm) {
    if (!prevBpm || !Number.isFinite(prevBpm) || !bpm) return 1.0;
    const d = Math.abs(bpm - prevBpm);
    return Math.exp(-Math.max(0, d - 10) / 25);
  }

  const fftConfAdj = fftConf * closenessPenalty(bpmFft);
  const acConfAdj = ac01 * closenessPenalty(bpmAc);

  // Объединяем результаты
  let bpm = null;
  let method = null;

  if (bpmFft && bpmAc) {
    const d = Math.abs(bpmFft - bpmAc);
    if (d <= 8) {
      const wF = Math.max(0.05, fftConfAdj);
      const wA = Math.max(0.05, acConfAdj);
      bpm = (wF * bpmFft + wA * bpmAc) / (wF + wA);
      method = "fusion";
    } else {
      if (fftConfAdj >= acConfAdj) {
        bpm = bpmFft;
        method = "fft";
      } else {
        bpm = bpmAc;
        method = "acf";
      }
    }
  } else if (bpmFft) {
    bpm = bpmFft;
    method = "fft";
  } else if (bpmAc) {
    bpm = bpmAc;
    method = "acf";
  } else {
    bpm = null;
    method = "none";
  }

  const signal01 = clamp(Math.max(fftConf, ac01), 0, 1);

  return {
    bpm,
    bpmFft,
    bpmAc,
    snr01,
    snrDb,
    peak01,
    ac01,
    signal01,
    rawScore: rawScoreBest,
    peakRatio,
    specEntropy,
    method,
    harmonicFixed,
    harmonicDir,
    harmonicAlt,
  };
}
