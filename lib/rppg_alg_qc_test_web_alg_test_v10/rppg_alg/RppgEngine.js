import { DEFAULTS } from "./config.js";
import { clamp, zscore, median } from "./utils.js";
import { Biquad } from "./signal/Biquad.js";
import { estimateHeartRate } from "./signal/spectrum.js";
import { estimateRespirationRate } from "./signal/respiration.js";
import { nsqiFromFiltered } from "./signal/sqi_nsqi.js";
import { roiRectsAndMasksFromLandmarksV4 } from "./roi/roiFromLandmarks_v4.js";
import { sampleRectStatsV4 } from "./roi/skinSampling_v4.js";
import { posSampleFromWindow } from "./algorithms/pos.js";
import { chromSampleFromWindow } from "./algorithms/chrom.js";

/**
 * RppgEngine
 * Цели:
 * - меньше зависимость от FPS/джиттера (resample на targetFs перед спектральной оценкой)
 * - infra ROI чаще “активируется” (крупнее ROI + отдельные пороги skin-check)
 * - стабильность без залипания: tracking вокруг prevBpm + escape на явно лучший пик в полном диапазоне
 * - подход для разных пульсов/условий: широкий hrBand по умолчанию, без жёстких приоритетов диапазона
 */
export class RppgEngine { // Основной класс для обработки rPPG сигналов
  constructor(opts = {}) {
    this.cfg = {
      ...DEFAULTS,
      ...opts,
      roiWeights: { ...DEFAULTS.roiWeights, ...(opts.roiWeights ?? {}) },
      roiPrior: { ...DEFAULTS.roiPrior, ...(opts.roiPrior ?? {}) },
      roiSamplingOverrides: { ...DEFAULTS.roiSamplingOverrides, ...(opts.roiSamplingOverrides ?? {}) },
      bpmSmoothing: { ...DEFAULTS.bpmSmoothing, ...(opts.bpmSmoothing ?? {}) },
      tracking: { ...DEFAULTS.tracking, ...(opts.tracking ?? {}) },
    };

    this.algorithm = opts.algorithm ?? this.cfg.algorithm;
    // SAFE — единственный режим для финальной сборки.
    this.mode = "safe";
    this.roiKeys = Object.keys(this.cfg.roiWeights);

    this.state = {};
    for (const k of this.roiKeys) this.state[k] = this._makeRoiState();

    this._lastUpdateMs = 0;
    this._bpmHist = [];
    this._bpmLast = null;
    this._bpmTsMs = 0;
    this._bpmSeries = [];
    // published HR (то, что считаем "правдоподобным" и можно использовать как prevPubBpm)
    this._pubBpmLast = null;
    this._pubTsMs = 0;

    this._escapeCount = { pos: 0, chrom: 0 };
    this._algoAutoLast = null;

    this._safeGateHist = [];
    this._safeGateStreak = 0;

    this._respHist = [];
    this._respLast = null;
  }

  setAlgorithm(algo) {
    if (algo === "pos" || algo === "chrom" || algo === "auto") {
      this.algorithm = algo;
    } else {
      this.algorithm = "chrom";
    }
  }

  setMode(mode) { // Установка режима
    this.mode = (mode === "safe") ? "safe" : "safe";
  }

  _getModeCfg() { // Получение конфигурации режима
    if (!this.mode) return {};
    return this.cfg.modes?.[this.mode] ?? {};
  }

  _makeRoiState() { // Создание состояния ROI
    return {
      rgb: [],       // {tMs, r,g,b}
      sigRawPos: [], // {tMs, x} (сырое rPPG значение)
      sigRawChrom: [],
      filtPos: [],   // resampled+filtered window
      filtChrom: [],
      active: false,
      skinRatio: 0,
      skinPixels: 0,
      totalPixels: 0,
      clippedRatio: 0,
      specularRatio: 0,
      motion: 1,
      lumaMean: 0,
      lumaStd: 0,
      lumaEma: null,
      lumaDelta: 0,
      satMean: 0,
      lumaSeries: [],
      lastCenter: null,
    };
  }

  _corr(a, b) { // Вычисление корреляции между двумя сигналами
    if (!a || !b || a.length !== b.length || a.length < 10) return null;
    let meanA = 0, meanB = 0;
    for (let i = 0; i < a.length; i++) { meanA += a[i]; meanB += b[i]; }
    meanA /= a.length; meanB /= b.length;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      const xa = a[i] - meanA;
      const xb = b[i] - meanB;
      num += xa * xb;
      da += xa * xa;
      db += xb * xb;
    }
    const den = Math.sqrt(da * db) + 1e-12;
    return num / den;
  }

  _illumScore(lumaMean) { // Оценка освещенности
    const a = clamp((lumaMean - 45) / 90, 0, 1);
    const b = clamp((230 - lumaMean) / 90, 0, 1);
    return a * b;
  }

  _quality(d, roiKey) { // Оценка качества ROI
    const motion = clamp(d.motion, 0, 1);
    const skin = clamp(d.skinRatio, 0, 1);
    const illum = this._illumScore(d.lumaMean);
    const contrast = clamp(d.lumaStd / 45, 0, 1);

    const snr01 = clamp(d.snr01 ?? 0, 0, 1);
    const peak01 = clamp(d.peak01 ?? 0, 0, 1);
    const ac01 = clamp(d.ac01 ?? 0, 0, 1);
    const signal01 = clamp(d.signal01 ?? Math.max(0.6 * snr01 + 0.4 * peak01, ac01), 0, 1);

    const prior = clamp(this.cfg.roiPrior?.[roiKey] ?? 1, 0.2, 1.2);

    let q = clamp(
      0.56 * signal01 +
      0.04 * peak01 +
      0.16 * (1 - motion) +
      0.08 * skin +
      0.08 * illum +
      0.08 * contrast,
      0, 1
    );

    // luma change penalty (ROI-level)
    const lumaCfg = this.cfg.lumaChange ?? {};
    if (Number.isFinite(d.lumaDelta) && (d.lumaDelta > (lumaCfg.threshold ?? 12))) {
      q *= (lumaCfg.penalty ?? 0.7);
    }

    // exposure penalty (ROI-level)
    const expCfg = this.cfg.exposure ?? {};
    const lumaMin = expCfg.lumaMeanMin ?? 40;
    const lumaMax = expCfg.lumaMeanMax ?? 210;
    const lumaStdMax = expCfg.lumaStdMax ?? 60;
    const expPenalty = expCfg.penalty ?? 0.7;
    if (Number.isFinite(d.lumaMean) && (d.lumaMean < lumaMin || d.lumaMean > lumaMax)) {
      q *= expPenalty;
    }
    if (Number.isFinite(d.lumaStd) && d.lumaStd > lumaStdMax) {
      q *= expPenalty;
    }

    // specular penalty
    const specPen = this.cfg.specularPenalty ?? {};
    const specThr = specPen.ratioThreshold ?? 0.01;
    const specMinFactor = specPen.minFactor ?? 0.6;
    if (Number.isFinite(d.specularRatio) && d.specularRatio > specThr) {
      q *= specMinFactor;
    }

    // skinPixels quality factor (optional)
    const spCfg = this.cfg.skinPixelsWeight ?? {};
    const minFull = spCfg.minForFullQuality ?? 300;
    const critical = spCfg.criticalMin ?? 80;
    const spWeight = spCfg.qualityWeight ?? 0;
    if (spWeight > 0 && Number.isFinite(d.skinPixels)) {
      let spFactor = 1;
      if (d.skinPixels < minFull) {
        const t = clamp((d.skinPixels - critical) / Math.max(1, minFull - critical), 0, 1);
        spFactor = 0.5 + 0.5 * t;
      }
      q *= (1 - spWeight) + spWeight * spFactor;
    }

    return clamp(q * prior, 0, 1);
  }

  _computeWeights(roiDiag) { // Вычисление весов для каждого ROI
    const raw = {};
    const quality = {};

    for (const k of this.roiKeys) {
      const cfg = this.cfg.roiWeights[k];
      const d = roiDiag[k];

      if (!d?.active) { raw[k] = 0; quality[k] = 0; continue; }

      const q = this._quality(d, k);
      quality[k] = q;

      raw[k] = clamp(cfg.base * Math.pow(q, this.cfg.gamma), cfg.min, cfg.max);
    }

    const sum = Object.values(raw).reduce((s, v) => s + v, 0);
    const w = {};
    if (sum > 1e-9) for (const k of this.roiKeys) w[k] = raw[k] / sum;
    else for (const k of this.roiKeys) w[k] = 0;

    return { weights: w, quality };
  }

  _smoothBpm(bpm, confidence) { // Сглаживание BPM
    if (!bpm || !Number.isFinite(bpm)) return null;

    if (this._bpmLast !== null) {
      const jump = Math.abs(bpm - this._bpmLast);
      if (jump > this.cfg.bpmSmoothing.maxJumpBpm && confidence < this.cfg.bpmSmoothing.minConfidenceForJump) {
        bpm = this._bpmLast;
      }
    }

    this._bpmHist.push(bpm);
    if (this._bpmHist.length > this.cfg.bpmSmoothing.historySize) this._bpmHist.shift();

    const m = median(this._bpmHist);
    this._bpmLast = m;
    return m;
  }

  _maybeResetBpmSmoothing(bpmRaw, quality) { // Возможно сбросить сглаживание BPM
    const last = this._bpmLast;
    if (last == null || bpmRaw == null || !Number.isFinite(bpmRaw)) return false;

    const esc = this.cfg.bpmSmoothing?.escape ?? {};
    const ratioMin = esc.ratioMin ?? 1.35;
    const snrDbMin = esc.snrDbMin ?? 6;
    const peakRatioMin = esc.peakRatioMin ?? 1.6;

    const ratioOk = bpmRaw >= last * ratioMin;
    const snrOk = Number.isFinite(quality?.snrDb) && quality.snrDb >= snrDbMin;
    const peakOk = Number.isFinite(quality?.peakRatio) && quality.peakRatio >= peakRatioMin;

    if (ratioOk && snrOk && peakOk) {
      this._bpmHist = [bpmRaw];
      this._bpmLast = bpmRaw;
      return true;
    }
    return false;
  }

  _pruneByTime(arr, tMs, keepSec) { // Удаление старых данных по времени
    const cutoff = tMs - keepSec * 1000;
    while (arr.length && arr[0].tMs < cutoff) arr.shift();
  }

  _resampleLinear(samples, tStart, tEnd, fs) { // Линейная интерполяция
    const N = Math.max(0, Math.floor(((tEnd - tStart) / 1000) * fs));
    if (N < 2) return null;

    const out = new Float64Array(N);
    const dtMs = 1000 / fs;

    // ищем стартовый индекс
    let j = 0;
    while (j < samples.length && samples[j].tMs < tStart) j++;

    for (let i = 0; i < N; i++) {
      const t = tStart + i * dtMs;

      while (j < samples.length && samples[j].tMs < t) j++;

      const b = (j < samples.length) ? samples[j] : null;
      const a = (j > 0) ? samples[j - 1] : null;

      if (!a && !b) { out[i] = 0; continue; }
      if (!a) { out[i] = b.x; continue; }
      if (!b) { out[i] = a.x; continue; }

      const t0 = a.tMs, t1 = b.tMs;
      const x0 = a.x, x1 = b.x;

      const u = (t1 === t0) ? 0 : (t - t0) / (t1 - t0);
      out[i] = x0 + clamp(u, 0, 1) * (x1 - x0);
    }
    return out;
  }

  _agreementInfo(posBpm, chromBpm, modeCfg) { // Информация о согласовании
    if (!posBpm || !chromBpm) {
      return { deltaBpm: null, score01: 1, hardDisagree: false, hardPenalty: 1 };
    }

    const agreeCfg = { ...this.cfg.agreement, ...(modeCfg.agreement ?? {}) };
    const soft = agreeCfg.softDeltaBpm ?? 5.0;
    const hard = agreeCfg.hardDeltaBpm ?? 15.0;

    const delta = Math.abs(posBpm - chromBpm);
    let score01 = 1;
    if (delta > soft) {
      score01 = clamp(1 - (delta - soft) / Math.max(1e-6, hard - soft), 0, 1);
    }

    const hardDisagree = delta > hard;
    const hardPenalty = hardDisagree ? (agreeCfg.hardPenalty ?? 0.72) : 1;

    return { deltaBpm: delta, score01, hardDisagree, hardPenalty };
  }

  _continuityScore(bpm, prevStable) { // Оценка непрерывности
    if (!prevStable || !Number.isFinite(prevStable) || !bpm) return 1;
    const contCfg = this.cfg.continuity ?? {};
    const soft = contCfg.softDeltaBpm ?? 8.0;
    const falloff = contCfg.falloffBpm ?? 18.0;
    const d = Math.abs(bpm - prevStable);
    return Math.exp(-Math.max(0, d - soft) / falloff);
  }

  _computePqi(out, continuity01, modeCfg) { // Оценка качества сигнала
    if (!out || !out.bpmRaw) return 0;
    const signal = clamp(out.signal01 ?? 0, 0, 1);
    const peak = clamp(out.peak01 ?? 0, 0, 1);
    const qAvg = clamp(out.qAvg ?? 0, 0, 1);
    const cont = clamp(continuity01 ?? 1, 0, 1);

    let pqi = 0.50 * signal + 0.20 * peak + 0.20 * qAvg + 0.10 * cont;
    pqi = clamp(pqi, 0, 1);

    const autoCfg = { ...this.cfg.algoAuto, ...(modeCfg.algoAuto ?? {}) };
    if (out.algo === "pos" && (autoCfg.posPqiBoost ?? 0) > 0) {
      pqi = clamp(pqi + autoCfg.posPqiBoost, 0, 1);
    }
    if (out.algo === "chrom" && (autoCfg.chromPqiPenalty ?? 1) !== 1) {
      pqi = clamp(pqi * autoCfg.chromPqiPenalty, 0, 1);
    }
    return pqi;
  }

  _computeConfidence(out, continuity01, agreement01, agreementPenalty, modeCfg) { // Оценка уверенности
    if (!out || !out.bpmRaw) return 0;

    const confCfg = { ...this.cfg.confidence, ...(modeCfg.confidence ?? {}) };
    const w = confCfg.spectralWeights ?? {};

    const signal = clamp(out.signal01 ?? 0, 0, 1);
    const peak = clamp(out.peak01 ?? 0, 0, 1);
    const ac = clamp(out.ac01 ?? 0, 0, 1);
    const qAvg = clamp(out.qAvg ?? 0, 0, 1);

    let spectral =
      (w.signal ?? 0.55) * signal +
      (w.peak ?? 0.15) * peak +
      (w.ac ?? 0.10) * ac +
      (w.quality ?? 0.20) * qAvg;
    spectral = clamp(spectral, 0, 1);

    const contW = confCfg.continuityWeight ?? 0.22;
    const agreeW = confCfg.agreementWeight ?? 0.24;

    const cont = clamp(continuity01 ?? 1, 0, 1);
    const agree = clamp(agreement01 ?? 1, 0, 1);

    const contFactor = (1 - contW) + contW * cont;
    const agreeFactor = (1 - agreeW) + agreeW * agree;

    const motionAvg = clamp(out.motionAvg ?? 0, 0, 1);
    const motionW = confCfg.motionWeight ?? 0.25;
    const motionFloor = confCfg.motionFloor ?? 0.45;
    const motionPenalty = clamp(1 - motionW * motionAvg, motionFloor, 1);

    const lumaCfg = this.cfg.lumaChange ?? {};
    const lumaDelta = out.lumaDeltaAvg ?? 0;
    const lumaPenalty = lumaDelta > (lumaCfg.threshold ?? 12) ? (lumaCfg.penalty ?? 0.7) : 1;

    let conf = spectral * contFactor * agreeFactor * motionPenalty * lumaPenalty;
    if (agreementPenalty != null) conf *= agreementPenalty;

    return clamp(conf, 0, 1);
  }

  _physioPrior(bpm, prevBpm, dtSec) { // Оценка физиологического приоритета
    if (!bpm || !Number.isFinite(bpm) || !prevBpm || !Number.isFinite(prevBpm)) {
      return { prior01: 1, rateBpmPerSec: null };
    }
    if (!dtSec || !Number.isFinite(dtSec) || dtSec <= 0.01) {
      return { prior01: 1, rateBpmPerSec: null };
    }

    const cfg = this.cfg.physioPrior ?? {};
    const soft = cfg.softRateBpmPerSec ?? 6.0;
    const hard = cfg.hardRateBpmPerSec ?? 15.0;
    const scale = cfg.scaleBpmPerSec ?? 4.0;
    const minPrior = cfg.minPrior ?? 0.2;

    const rate = Math.abs(bpm - prevBpm) / dtSec;
    let prior = Math.exp(-Math.max(0, rate - soft) / Math.max(1e-6, scale));

    if (Number.isFinite(hard) && rate > hard) {
      // Floor the prior so we don't completely kill confidence on real HR changes
      // (and avoid getting "stuck" on a bad frequency lock).
      prior = Math.max(prior, minPrior);
    }

    return { prior01: clamp(prior, 0, 1), rateBpmPerSec: rate };
  }

  _computeAlgoOutput({ // Вычисление выходных данных алгоритма
    algo,
    sigKey,
    filtKey,
    rects,
    tStart,
    tEnd,
    fs,
    fullBand,
    trackingCfg,
    prevBpm,
    prevPubBpm,
    estOptsBase,
  }) {
    const tr = trackingCfg ?? this.cfg.tracking ?? {};
    const contStrength = Number.isFinite(tr.continuityStrength) ? tr.continuityStrength : null;
    const estOptsAlgo = {
      ...(estOptsBase ?? {}),
      rawScoreWeights: (algo === "chrom")
        ? (this.cfg.chromRawScoreWeights ?? null)
        : (algo === "pos" ? (this.cfg.posRawScoreWeights ?? null) : null),
      continuityStrength: (contStrength != null ? contStrength : undefined),
    };

    const roiDiagnostics = {};

    for (const k of this.roiKeys) {
      const s = this.state[k];
      const sigRaw = s[sigKey] ?? [];

      if (!s.active || sigRaw.length < 10) { // Проверка активности ROI и наличия данных
        s[filtKey] = [];
        roiDiagnostics[k] = {
          active: false,
          skinRatio: s.skinRatio,
          skinPixels: s.skinPixels,
          totalPixels: s.totalPixels,
          clippedRatio: s.clippedRatio,
          specularRatio: s.specularRatio,
          motion: s.motion,
          lumaMean: s.lumaMean,
          lumaStd: s.lumaStd,
          lumaDelta: s.lumaDelta,
          satMean: s.satMean,
          snr01: 0,
          peak01: 0,
          bpmHint: null,
          rawScore: 0,
          rect: rects[k],
        };
        continue;
      }

      const rs = this._resampleLinear(sigRaw, tStart, tEnd, fs);
      if (!rs || rs.length < this.cfg.minSamplesForWindow) { // Проверка на достаточное количество сэмплов
        s[filtKey] = [];
        roiDiagnostics[k] = {
          active: true,
          skinRatio: s.skinRatio,
          skinPixels: s.skinPixels,
          totalPixels: s.totalPixels,
          clippedRatio: s.clippedRatio,
          specularRatio: s.specularRatio,
          motion: s.motion,
          lumaMean: s.lumaMean,
          lumaStd: s.lumaStd,
          lumaDelta: s.lumaDelta,
          satMean: s.satMean,
          snr01: 0,
          peak01: 0,
          bpmHint: null,
          rawScore: 0,
          rect: rects[k],
        };
        continue;
      }

      // bandpass на окне (обновляем фильтры на каждый расчёт — стабильно при resample)
      const hp1 = new Biquad("highpass", fs, fullBand[0], 0.707);
      const hp2 = new Biquad("highpass", fs, fullBand[0], 0.707);
      const lp1 = new Biquad("lowpass",  fs, fullBand[1], 0.707);
      const lp2 = new Biquad("lowpass",  fs, fullBand[1], 0.707);

      const filt = new Float64Array(rs.length);
      let y = 0;
      for (let i = 0; i < rs.length; i++) { // Пропуск сигнала через каскад фильтров
        y = rs[i];
        y = hp1.process(y); y = hp2.process(y);
        y = lp1.process(y); y = lp2.process(y);
        filt[i] = y;
      }
      s[filtKey] = Array.from(filt);

      const r = estimateHeartRate(s[filtKey], fs, fullBand, prevBpm, estOptsAlgo); // Оценка сердечного ритма
      roiDiagnostics[k] = {
        active: true,
        skinRatio: s.skinRatio,
        skinPixels: s.skinPixels,
        totalPixels: s.totalPixels,
        clippedRatio: s.clippedRatio,
        specularRatio: s.specularRatio,
        motion: s.motion,
        lumaMean: s.lumaMean,
        lumaStd: s.lumaStd,
        lumaDelta: s.lumaDelta,
        satMean: s.satMean,
        snr01: r.snr01,
        peak01: r.peak01,
        ac01: r.ac01,
        signal01: r.signal01,
        bpmHint: r.bpm,
        bpmFft: r.bpmFft,
        bpmAc: r.bpmAc,
        method: r.method,
        rawScore: r.rawScore,
        rect: rects[k],
      };
    }

    const { weights, quality } = this._computeWeights(roiDiagnostics);
    const activeKeys = this.roiKeys.filter(k =>
      roiDiagnostics[k].active && weights[k] > 0 && (this.state[k][filtKey]?.length ?? 0)
    );

    if (!activeKeys.length) { // Если нет активных ключей
      return {
        algo,
        valid: false,
        bpmRaw: null,
        snr01: 0,
        snrDb: null,
        peak01: 0,
        ac01: 0,
        signal01: 0,
        rawScore: 0,
        peakRatio: null,
        specEntropy: null,
        nsqi: null,
        fftAcDelta: null,
        qAvg: 0,
        motionAvg: 1,
        lumaDeltaAvg: 0,
        clippedRatioAvg: 0,
        specularRatioAvg: 0,
        skinPixelsAvg: 0,
        totalPixelsAvg: 0,
        weights,
        quality,
        roiDiagnostics,
        tracking: null,
      };
    }

    let minLen = Infinity;
    for (const k of activeKeys) minLen = Math.min(minLen, this.state[k][filtKey].length);
    if (!Number.isFinite(minLen) || minLen < this.cfg.minSamplesForWindow) { // Проверка на достаточную длину
      return {
        algo,
        valid: false,
        bpmRaw: null,
        snr01: 0,
        snrDb: null,
        peak01: 0,
        ac01: 0,
        signal01: 0,
        rawScore: 0,
        peakRatio: null,
        specEntropy: null,
        nsqi: null,
        fftAcDelta: null,
        qAvg: 0,
        motionAvg: 1,
        lumaDeltaAvg: 0,
        clippedRatioAvg: 0,
        specularRatioAvg: 0,
        skinPixelsAvg: 0,
        totalPixelsAvg: 0,
        weights,
        quality,
        roiDiagnostics,
        tracking: null,
      };
    }

    const mix = new Float64Array(minLen); // Объединённый сигнал
    for (const k of activeKeys) {
      const w = weights[k];
      const sig = this.state[k][filtKey].slice(this.state[k][filtKey].length - minLen);
      const z = zscore(sig);
      for (let i = 0; i < minLen; i++) mix[i] += w * z[i];
    }
    const nsqi = nsqiFromFiltered(mix);

    let rT = null, rF = null, chosen = null;
    const escapeCount = this._escapeCount[algo] ?? 0;

    if (prevBpm && Number.isFinite(prevBpm)) { // Проверка на наличие предыдущего значения ЧСС
      const range = tr.rangeBpm ?? 35;
      const bandTight = [
        clamp((prevBpm - range) / 60, fullBand[0], fullBand[1]),
        clamp((prevBpm + range) / 60, fullBand[0], fullBand[1]),
      ];

      // Оценка сердечного ритма в узкой полосе
      rT = estimateHeartRate(Array.from(mix), fs, bandTight, prevBpm, estOptsAlgo);
      const fullContinuity = tr.fullContinuityStrength ?? 0.55;
      rF = estimateHeartRate(Array.from(mix), fs, fullBand, prevBpm, { ...estOptsAlgo, continuityStrength: fullContinuity });

      // Разрешаем "выход на высокий ЧСС", даже если узкая полоса выглядит нормально,
      // чтобы не залипать на субгармонике/половинной частоте.
      const highCfg = tr.highHrEscape ?? {};
      const highMinBpm = highCfg.minBpm ?? 100;
      const lowToHighRatioMax = highCfg.lowToHighRatioMax ?? 0.75;
      const scoreMinRatio = highCfg.scoreMinRatio ?? 0.65;
      const peakMin = highCfg.peakMin ?? 0.25;

      const highHrEscape = // Проверка условий для разрешения "выхода на высокий ЧСС"
        rF?.bpm && rT?.bpm &&
        rF.bpm >= highMinBpm &&
        rT.bpm <= rF.bpm * lowToHighRatioMax &&
        Number.isFinite(rF.rawScore) && Number.isFinite(rT.rawScore) &&
        (rF.rawScore >= rT.rawScore * scoreMinRatio) &&
        (rF.peak01 ?? 0) >= peakMin;

      if (highHrEscape) { // Разрешаем "выход на высокий ЧСС"
        chosen = rF;
        this._escapeCount[algo] = 0;
      } else {
        const escapeRatio = tr.escapeRatio ?? 1.8;
        const escapeMinPeak01 = tr.escapeMinPeak01 ?? 0.55;
        const escapeConfirm = tr.escapeConfirm ?? 2;

        const escapeNow = // Проверка условий для "выхода"
          rF.bpm && rT.bpm &&
          (rF.rawScore > (rT.rawScore + 1e-12) * escapeRatio) &&
          (rF.peak01 >= escapeMinPeak01);

        if (escapeNow) this._escapeCount[algo] = escapeCount + 1;
        else this._escapeCount[algo] = 0;

        if (this._escapeCount[algo] >= escapeConfirm) {
          chosen = rF;
        } else {
          const fb = tr.fallbackSNR ?? 0.25;
          if ((rT.signal01 ?? (rT.snr01 ?? 0)) >= fb) {
            chosen = rT;
          } else {
            const sT = rT.signal01 ?? ((rT.snr01 ?? 0) * 0.6 + (rT.peak01 ?? 0) * 0.4);
            const sF = rF.signal01 ?? ((rF.snr01 ?? 0) * 0.6 + (rF.peak01 ?? 0) * 0.4);
            chosen = (sF >= sT) ? rF : rT;
          }
        }
      }
    } else { // Если нет предыдущего значения ЧСС, оцениваем только в полном диапазоне
      rF = estimateHeartRate(Array.from(mix), fs, fullBand, null, estOptsAlgo);
      chosen = rF;
      this._escapeCount[algo] = 0;
    }

    // --- Повышение низкого кандидата (SAFE) ---
    // Если выбранный кандидат подозрительно низкий, а в полном диапазоне есть правдоподобный пик —
    // повышаем его, чтобы не залипать на субгармонике.
    let promotedLowCandidate = false;
    if (this.mode === "safe" && chosen && rF && tr?.lowCandidatePromote) { // Проверка условий для повышения низкого кандидата
      const prm = tr.lowCandidatePromote ?? {};
      const maxCand = prm.maxCandidateBpm ?? 80;
      const minFull = prm.minFullBpm ?? 90;
      const minScoreRatio = prm.minScoreRatio ?? 0.45;
      const minPeak01 = prm.minPeak01 ?? 0.20;
      const minSignal01 = prm.minSignal01 ?? 0.45;

      const candBpm = chosen.bpm ?? null;
      const fullBpm = rF.bpm ?? null;
      const candScore = chosen.rawScore ?? null;
      const fullScore = rF.rawScore ?? null;
      const scoreRatio = (fullScore != null && candScore != null)
        ? (fullScore / Math.max(1e-6, candScore))
        : null;

      if ( 
        candBpm != null &&
        fullBpm != null &&
        candBpm <= maxCand &&
        fullBpm >= minFull &&
        (scoreRatio == null || scoreRatio >= minScoreRatio) &&
        (rF.peak01 ?? 0) >= minPeak01 &&
        (rF.signal01 ?? 0) >= minSignal01
      ) {
        chosen = rF;
        promotedLowCandidate = true;
        this._escapeCount[algo] = 0;
      }
    }

    // Извлечение характеристик выбранного кандидата
    const bpmRaw = chosen?.bpm ?? null;
    const snr01 = chosen?.snr01 ?? 0;
    const peak01 = chosen?.peak01 ?? 0;
    const ac01 = chosen?.ac01 ?? 0;
    const sig01 = clamp(chosen?.signal01 ?? Math.max(0.6 * snr01 + 0.4 * peak01, ac01), 0, 1);

    // Вычисление средних значений по активным ключам
    const qAvg = activeKeys.reduce((s, k) => s + (quality[k] ?? 0), 0) / Math.max(1, activeKeys.length);
    const motionAvg = activeKeys.reduce((s, k) => s + clamp(roiDiagnostics[k].motion ?? 0, 0, 1), 0) / Math.max(1, activeKeys.length);
    const lumaDeltaAvg = activeKeys.reduce((s, k) => s + (roiDiagnostics[k].lumaDelta ?? 0), 0) / Math.max(1, activeKeys.length);
    const lumaMeanAvg = activeKeys.reduce((s, k) => s + (roiDiagnostics[k].lumaMean ?? 0), 0) / Math.max(1, activeKeys.length);
    const lumaStdAvg = activeKeys.reduce((s, k) => s + (roiDiagnostics[k].lumaStd ?? 0), 0) / Math.max(1, activeKeys.length);
    const clippedRatioAvg = activeKeys.reduce((s, k) => s + (roiDiagnostics[k].clippedRatio ?? 0), 0) / Math.max(1, activeKeys.length);
    const specularRatioAvg = activeKeys.reduce((s, k) => s + (roiDiagnostics[k].specularRatio ?? 0), 0) / Math.max(1, activeKeys.length);
    const skinPixelsAvg = activeKeys.reduce((s, k) => s + (roiDiagnostics[k].skinPixels ?? 0), 0) / Math.max(1, activeKeys.length);
    const totalPixelsAvg = activeKeys.reduce((s, k) => s + (roiDiagnostics[k].totalPixels ?? 0), 0) / Math.max(1, activeKeys.length);
    const fftAcDelta = (chosen?.bpmFft && chosen?.bpmAc) ? Math.abs(chosen.bpmFft - chosen.bpmAc) : null;

    return { // Возвращаем объект с результатами
      algo,
      valid: bpmRaw != null,
      bpmRaw,
      snr01,
      peak01,
      ac01,
      signal01: sig01,
      rawScore: chosen?.rawScore ?? 0,
      peakRatio: chosen?.peakRatio ?? null,
      specEntropy: chosen?.specEntropy ?? null,
      snrDb: chosen?.snrDb ?? null,
      nsqi,
      fftAcDelta,
      harmonicDir: chosen?.harmonicDir ?? null,
      harmonicFixed: chosen?.harmonicFixed ?? false,
      harmonicAlt: chosen?.harmonicAlt ?? null,
      qAvg,
      motionAvg,
      lumaDeltaAvg,
      lumaMeanAvg,
      lumaStdAvg,
      clippedRatioAvg,
      specularRatioAvg,
      skinPixelsAvg,
      totalPixelsAvg,
      weights,
      quality,
      roiDiagnostics,
      tracking: {
        prevBpm,
        prevPubBpm,
        escapeCount: this._escapeCount[algo] ?? 0,
        promotedLowCandidate,
        tight: rT ? { bpm: rT.bpm, bpmFft: rT.bpmFft, bpmAc: rT.bpmAc, method: rT.method, snr01: rT.snr01, peak01: rT.peak01, ac01: rT.ac01, signal01: rT.signal01, rawScore: rT.rawScore, harmonicDir: rT.harmonicDir } : null,
        full:  rF ? { bpm: rF.bpm, bpmFft: rF.bpmFft, bpmAc: rF.bpmAc, method: rF.method, snr01: rF.snr01, peak01: rF.peak01, ac01: rF.ac01, signal01: rF.signal01, rawScore: rF.rawScore, harmonicDir: rF.harmonicDir } : null,
        chosen: chosen ? { bpm: chosen.bpm, bpmFft: chosen.bpmFft, bpmAc: chosen.bpmAc, method: chosen.method, snr01: chosen.snr01, peak01: chosen.peak01, ac01: chosen.ac01, signal01: chosen.signal01, rawScore: chosen.rawScore, harmonicDir: chosen.harmonicDir } : null,
      },
    };
  }

  update({ timestampMs, frameW, frameH, imageData, landmarks, fps }) { // Обновление состояния
    if (!landmarks || !landmarks.length) return null;

    const { rects } = roiRectsAndMasksFromLandmarksV4(landmarks, frameW, frameH);

    // motion по центру ROI
    for (const k of this.roiKeys) {
      const s = this.state[k];
      const r = rects[k];
      if (!r) continue;
      const c = { x: r.x + r.w * 0.5, y: r.y + r.h * 0.5 };

      if (s.lastCenter) {
        const dx = c.x - s.lastCenter.x;
        const dy = c.y - s.lastCenter.y;
        const speed = Math.sqrt(dx * dx + dy * dy) / Math.max(1, Math.min(frameW, frameH));
        s.motion = clamp(speed * 18, 0, 1);
      } else s.motion = 0;

      s.lastCenter = c;
    }

    const respCfg = this.cfg.respiration ?? {};
    const respWindowSec = respCfg.windowSec ?? 20;
    const keepSec = Math.max(this.cfg.windowSec + 2, respWindowSec + 2, 14);

    // собираем RGB и sigRaw по каждому ROI (POS + CHROM)
    for (const k of this.roiKeys) {
      const s = this.state[k];

      const ov = this.cfg.roiSamplingOverrides?.[k] ?? {}; // Получаем переопределения параметров выборки для данного ROI
      const st = sampleRectStatsV4(imageData, frameW, frameH, rects[k], {
        sampleStep: (ov.sampleStep ?? this.cfg.sampleStep),
        minSkinRatio: (ov.minSkinRatio ?? this.cfg.minSkinRatio),
        minSkinPixels: (ov.minSkinPixels ?? this.cfg.minSkinPixels),
        specularFilter: (ov.specularFilter ?? this.cfg.specularFilter),
      });

      // Обновляем состояние ROI
      s.active = !!st.ok;
      s.skinRatio = st.skinRatio;
      s.skinPixels = st.skinPixels ?? 0;
      s.totalPixels = st.totalPixels ?? 0;
      s.clippedRatio = st.clippedRatio ?? 0;
      s.specularRatio = st.specularRatio ?? 0;
      s.lumaMean = st.lumaMean;
      s.lumaStd = st.lumaStd;
      s.satMean = st.satMean;

      // EMA для изменения яркости (для оценки влияния дыхания/движения)
      const lumaCfg = this.cfg.lumaChange ?? {};
      const alpha = lumaCfg.emaAlpha ?? 0.15;
      const prevEma = (s.lumaEma == null) ? st.lumaMean : s.lumaEma;
      s.lumaDelta = Math.abs(st.lumaMean - prevEma);
      s.lumaEma = prevEma * (1 - alpha) + st.lumaMean * alpha;

      if (!st.ok) continue;

      // Сохраняем значения яркости для дальнейшего анализа
      s.lumaSeries.push({ tMs: timestampMs, x: st.lumaMean });
      this._pruneByTime(s.lumaSeries, timestampMs, keepSec);

      s.rgb.push({ tMs: timestampMs, r: st.r, g: st.g, b: st.b });
      this._pruneByTime(s.rgb, timestampMs, keepSec);

      // берём окно по времени (не по количеству кадров)
      const tStartNorm = timestampMs - this.cfg.windowSec * 1000;
      const rgbWin = s.rgb.filter(p => p.tMs >= tStartNorm).map(p => ({ r: p.r, g: p.g, b: p.b }));

      if (rgbWin.length >= 30) { // Проверяем, достаточно ли данных для анализа
        const xPos = posSampleFromWindow(rgbWin);
        s.sigRawPos.push({ tMs: timestampMs, x: xPos });
        this._pruneByTime(s.sigRawPos, timestampMs, keepSec);

        const xChrom = chromSampleFromWindow(rgbWin);
        s.sigRawChrom.push({ tMs: timestampMs, x: xChrom });
        this._pruneByTime(s.sigRawChrom, timestampMs, keepSec);
      }
    }

    // расчёт HR не каждый кадр
    if (timestampMs - this._lastUpdateMs < this.cfg.updateEveryMs) return null;
    this._lastUpdateMs = timestampMs;

    const modeCfg = this._getModeCfg();
    const isSafeMode = this.mode === "safe";

    const fs = clamp(this.cfg.targetFs, 20, 60);
    const tEnd = timestampMs;
    const tStart = tEnd - this.cfg.windowSec * 1000;
    const hrBand = modeCfg.hrBandHz ?? this.cfg.hrBandHz;
    let fullBand = modeCfg.hrBandHzFull ?? this.cfg.hrBandHzFull ?? hrBand;
    const prevPubBpm = this._pubBpmLast;
    const prevBpmRaw = this._bpmLast;
    // Если нет предыдущего значения ЧСС, используем необработанное значение
    const prevBpm = (isSafeMode && prevPubBpm != null && Number.isFinite(prevPubBpm))
      ? prevPubBpm
      : prevBpmRaw;

    const tr = { ...(this.cfg.tracking ?? {}), ...(modeCfg.tracking ?? {}) };
    // Если у нас уже есть стабильное значение ЧСС, избегаем очень низких кандидатов в полном диапазоне.
    if (prevPubBpm != null && Number.isFinite(prevPubBpm)) {
      const minPrev = tr.fullBandMinPrevBpm ?? 85;
      const ratio = tr.fullBandMinRatio ?? 0.60;
      if (prevPubBpm >= minPrev) {
        const minHz = (prevPubBpm * ratio) / 60;
        fullBand = [Math.max(fullBand[0], minHz), fullBand[1]];
      }
    }
    const estOpts = (() => { // Извлечение характеристик выбранного кандидата
      const r = tr.preferBpmRange;
      if (Array.isArray(r) && r.length === 2) {
        return { preferBpmRange: r, preferBoost: (tr.preferBoost ?? 1.0) };
      }
      return null;
    })();

    // Извлечение характеристик гармонического анализа
    const harm = this.cfg.harmonic ?? {};
    const peakSel = this.cfg.peakSelect ?? {};
    const estOptsBase = {
      ...(estOpts ?? {}),
      ...peakSel,
      prevPubBpm,
      harmonicRatioThreshold: harm.ratioThreshold ?? 0.85, // Порог гармонического отношения
      harmonicDoubleCheckMinPeakRatio: harm.doubleCheckMinPeakRatio ?? 0.60, // Минимальное отношение пиков для двойной проверки
      harmonicDoubleCheckScoreMargin: harm.doubleCheckScoreMargin ?? 0.20, // Запас по оценке двойной проверки
      harmonicRescueEnabled: true, // Включить спасение
      harmonicRescueLowMaxBpm: harm.rescueLowMaxBpm ?? 75,
      harmonicRescueMinDoubleBpm: harm.rescueMinDoubleBpm ?? 70,
      harmonicRescueMinScoreRatio: harm.rescueMinScoreRatio ?? 0.40, // Минимальное отношение оценки для спасения
      harmonicRescueMaxSnrDrop: harm.rescueMaxSnrDrop ?? 0.18, // Максимальное падение SNR для спасения
      harmonicUp2DominanceRatio: harm.up2DominanceRatio ?? 1.35, // Отношение доминирования для повышения гармонического анализа
      harmonicUp2MinSnrMargin: harm.up2MinSnrMargin ?? 0.08, // Минимальный запас по SNR для повышения гармонического анализа
      harmonicUp2PeakRatioMax: harm.up2PeakRatioMax ?? 2.0, // Максимальное отношение пиков для повышения гармонического анализа
      harmonicUp2LowBpmMax: harm.up2LowBpmMax ?? 80, // Максимальная ЧСС для повышения гармонического анализа
      harmonicHalfMinPowerRatio: harm.halfMinPowerRatio ?? 1.10, // Минимальное отношение мощности для повышения гармонического анализа
      harmonicHalfMinSnrMargin: harm.halfMinSnrMargin ?? 0.08, // Минимальный запас по SNR для повышения гармонического анализа на половинной частоте
      harmonicSubGuardEnabled: harm.subGuardEnabled ?? true,
      harmonicSubGuardMaxBpm: harm.subGuardMaxBpm ?? 80, // Максимальная ЧСС для подзащиты
      harmonicSubGuardMinDoubleBpm: harm.subGuardMinDoubleBpm ?? 90, // Минимальная ЧСС для двойной подзащиты
      harmonicSubGuardMinScoreRatio: harm.subGuardMinScoreRatio ?? 0.45, // Минимальное отношение оценки для подзащиты
      harmonicSubGuardMinPowerRatio: harm.subGuardMinPowerRatio ?? 0.30, // Минимальное отношение мощности для подзащиты
      harmonicSubGuardMaxSnrDrop: harm.subGuardMaxSnrDrop ?? 0.12, // Максимальное падение SNR для подзащиты
      harmonicSubGuardPrevRatioMax: harm.subGuardPrevRatioMax ?? 0.72,
    };

    const posOut = this._computeAlgoOutput({ // Вычисление выходных данных для позиции
      algo: "pos",
      sigKey: "sigRawPos",
      filtKey: "filtPos",
      rects,
      tStart,
      tEnd,
      fs,
      fullBand,
      trackingCfg: tr,
      prevBpm,
      prevPubBpm,
      estOptsBase,
    });

    const chromOut = this._computeAlgoOutput({ // Вычисление выходных данных для CHROM
      algo: "chrom",
      sigKey: "sigRawChrom",
      filtKey: "filtChrom",
      rects,
      tStart,
      tEnd,
      fs,
      fullBand,
      trackingCfg: tr,
      prevBpm,
      prevPubBpm,
      estOptsBase,
    });

    // Согласование
    const agreement = this._agreementInfo(posOut.bpmRaw, chromOut.bpmRaw, modeCfg);
    const prevStable = this._pubBpmLast ?? this._bpmLast ?? null;
    const prevBpmTsMs = this._bpmTsMs;
    const prevPubTsMs = this._pubTsMs;

    const posContinuity = this._continuityScore(posOut.bpmRaw, prevStable);
    const chromContinuity = this._continuityScore(chromOut.bpmRaw, prevStable);

    const pqiPos = this._computePqi({ ...posOut, algo: "pos" }, posContinuity, modeCfg);
    const pqiChrom = this._computePqi({ ...chromOut, algo: "chrom" }, chromContinuity, modeCfg);

    // Оценка дыхания (низкие частоты)
    const respFs = clamp(respCfg.targetFs ?? 10, 6, 20);
    const respBand = respCfg.bandHz ?? [0.10, 0.40];
    const respMinSamples = respCfg.minSamples ?? 80;

    let respOut = null;
    {
      const tStartResp = tEnd - respWindowSec * 1000;
      const weights = posOut?.weights ?? chromOut?.weights ?? {};
      const activeKeys = this.roiKeys.filter(k => (weights[k] ?? 0) > 0);

      if (activeKeys.length) { // Если есть активные ключи
        let minLen = Infinity;
        const series = {};
        for (const k of activeKeys) {
          const s = this.state[k];
          const res = this._resampleLinear(s.lumaSeries, tStartResp, tEnd, respFs);
          if (!res || res.length < 2) { minLen = 0; break; }
          series[k] = res;
          minLen = Math.min(minLen, res.length);
        }

        if (minLen >= respMinSamples && Number.isFinite(minLen)) { // Если длина достаточна
          const mix = new Float64Array(minLen);
          for (const k of activeKeys) {
            const w = weights[k] ?? 0;
            if (w <= 0) continue;
            const sig = series[k].slice(series[k].length - minLen);
            const z = zscore(sig);
            for (let i = 0; i < minLen; i++) mix[i] += w * z[i];
          }
          respOut = estimateRespirationRate(Array.from(mix), respFs, respBand);
        }
      }
    }

    // Стабилизация дыхания: удержание + медианное сглаживание
    let respStable = null;
    if (respOut && Number.isFinite(respOut.bpm)) {
      const minConf = respCfg.minConfPublish ?? 0.20;
      const smoothWindow = respCfg.smoothWindow ?? 5;
      if (Number.isFinite(respOut.conf) && respOut.conf >= minConf) {
        this._respHist.push({ bpm: respOut.bpm });
        if (this._respHist.length > smoothWindow) this._respHist.shift();
        respStable = median(this._respHist.map((r) => r.bpm));
        this._respLast = respStable;
      } else if (this._respLast != null) {
        respStable = this._respLast;
      }
    }

    let chosenOut = null;
    let algoUsed = this.algorithm;

    if (isSafeMode) {
      // SAFE — публикационный режим: публикуем только POS.
      // CHROM остаётся для диагностики и согласованности.
      chosenOut = posOut;
      algoUsed = "pos";
    } else if (this.algorithm === "pos") {
      chosenOut = posOut;
      algoUsed = "pos";
    } else if (this.algorithm === "chrom") {
      chosenOut = chromOut;
      algoUsed = "chrom";
    } else {
      const autoCfg = { ...this.cfg.algoAuto, ...(modeCfg.algoAuto ?? {}) };
      const hysteresis = autoCfg.hysteresis ?? 0.04;

      const hasPos = posOut?.bpmRaw != null;
      const hasChrom = chromOut?.bpmRaw != null;

      if (hasPos && !hasChrom) { // Если есть только POS
        chosenOut = posOut;
        algoUsed = "pos";
      } else if (!hasPos && hasChrom) { // Если есть только CHROM
        chosenOut = chromOut;
        algoUsed = "chrom";
      } else if (hasPos && hasChrom) { // Если есть и POS, и CHROM
        if (agreement.hardDisagree) { // Если жесткое несогласие
          if (prevStable && Number.isFinite(prevStable)) {
            const dPos = Math.abs(posOut.bpmRaw - prevStable);
            const dChrom = Math.abs(chromOut.bpmRaw - prevStable);
            if (dPos <= dChrom) {
              chosenOut = posOut; algoUsed = "pos";
            } else {
              chosenOut = chromOut; algoUsed = "chrom";
            }
          } else {
            chosenOut = (pqiPos >= pqiChrom) ? posOut : chromOut;
            algoUsed = (pqiPos >= pqiChrom) ? "pos" : "chrom";
          }
        } else if (autoCfg.usePqiComparison) { // Если используется сравнение PQI
          const diff = pqiPos - pqiChrom;
          if (this._algoAutoLast === "pos" && diff > -hysteresis) {
            chosenOut = posOut; algoUsed = "pos";
          } else if (this._algoAutoLast === "chrom" && diff < hysteresis) {
            chosenOut = chromOut; algoUsed = "chrom";
          } else {
            chosenOut = (diff >= 0) ? posOut : chromOut;
            algoUsed = (diff >= 0) ? "pos" : "chrom";
          }
        } else {
          chosenOut = (pqiPos >= pqiChrom) ? posOut : chromOut;
          algoUsed = (pqiPos >= pqiChrom) ? "pos" : "chrom";
        }
      } else {
        chosenOut = null;
        algoUsed = "auto";
      }

      this._algoAutoLast = (algoUsed === "pos" || algoUsed === "chrom") ? algoUsed : this._algoAutoLast;
    }

    if (!chosenOut || !chosenOut.bpmRaw) { // Если нет подходящего выхода
      return {
        valid: false,
        bpm: null,
        bpmRaw: null,
        bpmSmoothed: null,
        confidence: 0,
        weights: chosenOut?.weights ?? {},
        quality: chosenOut?.quality ?? {},
        roiDiagnostics: chosenOut?.roiDiagnostics ?? {},
        algo: this.algorithm,
        algoUsed,
        fs,
        pos: { bpmRaw: posOut?.bpmRaw ?? null, pqi: pqiPos, confidence: 0 },
        chrom: { bpmRaw: chromOut?.bpmRaw ?? null, pqi: pqiChrom, confidence: 0 },
        agreement,
      };
    }

    const continuity01 = (algoUsed === "pos") ? posContinuity : chromContinuity; // Определение непрерывности
    const safePubCfg = { ...(this.cfg.safePublishGate ?? {}), ...(modeCfg.safePublishGate ?? {}) };
    const chromPqiMinForAgreement = safePubCfg.agreementChromPqiMin ?? 0.55;
    const chromSnrDbMinForAgreement = safePubCfg.agreementChromSnrDbMin ?? 4.0;
    const chromOkForAgreement = // Если CHROM надежен
      (chromOut?.bpmRaw != null) &&
      Number.isFinite(pqiChrom) && (pqiChrom >= chromPqiMinForAgreement) &&
      Number.isFinite(chromOut?.snrDb) && (chromOut.snrDb >= chromSnrDbMinForAgreement);

    const agreement01 = chromOkForAgreement ? (agreement?.score01 ?? 1) : 1; 
    const agreementPenalty = chromOkForAgreement ? (agreement?.hardPenalty ?? 1) : 1;

    const confidenceHeuristic = this._computeConfidence(chosenOut, continuity01, agreement01, agreementPenalty, modeCfg);

    let prevTs = null; // Предыдущее время
    if (this._pubBpmLast != null && prevPubTsMs > 0 && prevStable === this._pubBpmLast) {
      prevTs = prevPubTsMs;
    } else if (prevBpmTsMs > 0) {
      prevTs = prevBpmTsMs;
    }
    const dtSec = (prevTs != null) ? (timestampMs - prevTs) / 1000 : null;
    const physio = this._physioPrior(chosenOut.bpmRaw, prevStable, dtSec);

    // В SAFE режиме используем только эвристику + мягкий физиологический prior.
    const confCfg = this.cfg.confidence ?? {};
    const priorBlendSafe = confCfg.priorBlendSafe ?? 0.20;
    const prior01 = physio.prior01 ?? 1;
    const priorFactor = (1 - priorBlendSafe) + priorBlendSafe * prior01;
    const confidence = clamp(confidenceHeuristic * priorFactor, 0, 1);

    const bpmRaw = chosenOut.bpmRaw;
    let bpmSmoothed = this._smoothBpm(bpmRaw, confidence);
    // Экстренный выход: если явно "застряли" в низком ЧСС,
    // но появился правдоподобный высокий пик — сбрасываем сглаживание.
    if (this._maybeResetBpmSmoothing(bpmRaw, {
      snrDb: chosenOut.snrDb,
      peakRatio: chosenOut.peakRatio,
    })) {
      bpmSmoothed = this._bpmLast;
    }
    if (bpmSmoothed != null) this._bpmTsMs = timestampMs;

    if (bpmSmoothed != null) {
      this._bpmSeries.push({ tMs: timestampMs, x: bpmSmoothed });
      const respWindowSec = (this.cfg.respiration?.windowSec ?? 20);
      this._pruneByTime(this._bpmSeries, timestampMs, respWindowSec + 2);
    }

    // Оценка связи ЧСС и дыхания через корреляцию между респираторной волной и ЧСС.
    let rsaCorr = null;
    let rsa01 = null;
    let rsaAbs = null;
    let respCoupling01 = null;
    if (respOut?.signal && this._bpmSeries.length >= 10) {
      const respWindowSec = (this.cfg.respiration?.windowSec ?? 20);
      const respFs = clamp(this.cfg.respiration?.targetFs ?? 10, 6, 20);
      const tStartResp = timestampMs - respWindowSec * 1000;
      const bpmRes = this._resampleLinear(this._bpmSeries, tStartResp, timestampMs, respFs);
      if (bpmRes && bpmRes.length === respOut.signal.length) {
        rsaCorr = this._corr(bpmRes, respOut.signal);
        if (rsaCorr != null) rsa01 = clamp((rsaCorr + 1) / 2, 0, 1);
        if (rsaCorr != null) {
          rsaAbs = Math.abs(rsaCorr);
          respCoupling01 = clamp((rsaAbs - 0.05) / 0.25, 0, 1);
        }
      }
    }

    // Связь ЧСС–дыхание: если дыхание уверенное, а связь слабая — уменьшаем уверенность
    if (respOut?.conf != null && Number.isFinite(respOut.conf)) {
      const respCfg = this.cfg.respiration ?? {};
      const minConf = respCfg.minConfForCoupling ?? 0.20;
      const w = respCfg.couplingWeight ?? 0.25;
      if (respOut.conf >= minConf && respCoupling01 != null && Number.isFinite(respCoupling01)) {
        const factor = (1 - w) + w * respCoupling01;
        confidence = clamp(confidence * factor, 0, 1);
      }
    }

    const valid = bpmSmoothed !== null && confidence >= 0.35;

    // ---- SAFE gate (SQI + правдоподобие) ----
    const gateCfg = { ...(this.cfg.safeGate ?? {}), ...(modeCfg.gate ?? {}) };
    let safeGateOk = true;
    let safeGateReason = null;

    if (isSafeMode) {
      const nsqi = chosenOut.nsqi;
      const nsqiMin = Number.isFinite(gateCfg.nsqiMin) ? gateCfg.nsqiMin : null;
      const nsqiMax = Number.isFinite(gateCfg.nsqiMax) ? gateCfg.nsqiMax : null;
      if (nsqi != null && Number.isFinite(nsqi)) {
        if (nsqiMin != null && nsqi < nsqiMin) {
          safeGateOk = false;
          safeGateReason = "low_sqi";
        }
        if (safeGateOk && nsqiMax != null && nsqi > nsqiMax) {
          safeGateOk = false;
          safeGateReason = "low_sqi";
        }
      } else if (nsqiMin != null || nsqiMax != null) {
        safeGateOk = false;
        safeGateReason = "low_sqi";
      }
      if (safeGateOk && Number.isFinite(gateCfg.minAgreement01) && agreement01 < gateCfg.minAgreement01) {
        safeGateOk = false;
        safeGateReason = "low_agreement";
      }
      if (safeGateOk && Number.isFinite(gateCfg.minContinuity01) && continuity01 < gateCfg.minContinuity01) {
        safeGateOk = false;
        safeGateReason = "low_continuity";
      }
      if (safeGateOk && Number.isFinite(gateCfg.maxMotionAvg) && (chosenOut.motionAvg ?? 1) > gateCfg.maxMotionAvg) {
        safeGateOk = false;
        safeGateReason = "high_motion";
      }
      if (safeGateOk && Number.isFinite(gateCfg.maxLumaDeltaAvg) && (chosenOut.lumaDeltaAvg ?? 0) > gateCfg.maxLumaDeltaAvg) {
        safeGateOk = false;
        safeGateReason = "high_luma_change";
      }
      if (safeGateOk && Number.isFinite(gateCfg.minLumaMeanAvg) && (chosenOut.lumaMeanAvg ?? 0) < gateCfg.minLumaMeanAvg) {
        safeGateOk = false;
        safeGateReason = "low_exposure";
      }
      if (safeGateOk && Number.isFinite(gateCfg.maxLumaMeanAvg) && (chosenOut.lumaMeanAvg ?? 0) > gateCfg.maxLumaMeanAvg) {
        safeGateOk = false;
        safeGateReason = "high_exposure";
      }
      if (safeGateOk && Number.isFinite(gateCfg.maxLumaStdAvg) && (chosenOut.lumaStdAvg ?? 0) > gateCfg.maxLumaStdAvg) {
        safeGateOk = false;
        safeGateReason = "high_luma_std";
      }
      if (
        safeGateOk &&
        Number.isFinite(gateCfg.maxSpecularRatioAvg) &&
        (chosenOut.specularRatioAvg ?? 0) > gateCfg.maxSpecularRatioAvg &&
        Number.isFinite(gateCfg.maxLumaMeanAvg) &&
        (chosenOut.lumaMeanAvg ?? 0) > (gateCfg.maxLumaMeanAvg - 10)
      ) {
        safeGateOk = false;
        safeGateReason = "high_specular";
      }
      if (safeGateOk && Number.isFinite(gateCfg.minSkinPixelsAvg) && (chosenOut.skinPixelsAvg ?? 0) < gateCfg.minSkinPixelsAvg) {
        safeGateOk = false;
        safeGateReason = "low_skin_pixels";
      }
      if (safeGateOk && Number.isFinite(gateCfg.maxClippedRatioAvg) && (chosenOut.clippedRatioAvg ?? 0) > gateCfg.maxClippedRatioAvg) {
        safeGateOk = false;
        safeGateReason = "high_clipping";
      }
    }

    // ---- SAFE gate для публикации (режим отчёта) ----
    const requiredStreak = safePubCfg.requiredStreak ?? 3;
    const confMin = safePubCfg.confidenceMin ?? 0.70;
    const snrDbMin = safePubCfg.snrDbMin ?? 6;
    const agreementDeltaMax = safePubCfg.agreementDeltaMax ?? 12;
    const pqiMin = safePubCfg.pqiMin ?? 0.75;
    const std3Max = safePubCfg.std3Max ?? 2;
    const maxStepMax = safePubCfg.maxStepMax ?? 3.5;

    let bpmCandidate = bpmSmoothed;
    let halfFreqRescue = false;
    // SAFE публикует только POS, поэтому PQI берём от POS.
    const pqiUsed = isSafeMode ? pqiPos : ((algoUsed === "pos") ? pqiPos : pqiChrom);
    const snrDb = chosenOut.snrDb ?? null;
    // Согласование считаем только если CHROM сам по себе надёжен.
    const agreementDelta = chromOkForAgreement ? (agreement?.deltaBpm ?? null) : null;

    if (isSafeMode && bpmCandidate != null) { // Если режим безопасной публикации и кандидат на ЧСС не равен null
      const hfCfg = safePubCfg.halfFreq ?? {};
      const ratioThreshold = hfCfg.ratioThreshold ?? 0.65;
      const maxBpmDiff = hfCfg.maxBpmDiff ?? 6;
      const minScoreRatio = hfCfg.minScoreRatio ?? 0.85;
      const lowBpmThreshold = hfCfg.lowBpmThreshold ?? 75;

      const minRescueSnr = hfCfg.snrDbMin ?? snrDbMin;
      const minPeakRatio = hfCfg.minPeakRatio ?? 1.25;
      const minSignal01 = hfCfg.minSignal01 ?? 0.40;

      const qualityOk = // Если качество сигнала удовлетворяет всем условиям
        Number.isFinite(snrDb) && snrDb >= minRescueSnr &&
        (chosenOut.peakRatio ?? 0) >= minPeakRatio &&
        (chosenOut.signal01 ?? 0) >= minSignal01;
      const hasPrevPub = prevPubBpm != null && Number.isFinite(prevPubBpm);
      const suspiciousLow = hasPrevPub
        ? (bpmCandidate < prevPubBpm * ratioThreshold)
        : (bpmCandidate < lowBpmThreshold);

      if (qualityOk && suspiciousLow) { // Если качество сигнала удовлетворяет всем условиям и ЧСС ниже порога
        const candidate2 = bpmCandidate * 2;
        const bpmMin = (fullBand?.[0] ?? 0.7) * 60;
        const bpmMax = (fullBand?.[1] ?? 4.0) * 60;
        const trackFull = chosenOut.tracking?.full ?? null;
        const trackChosen = chosenOut.tracking?.chosen ?? null;
        const fullBpm = trackFull?.bpm ?? null;
        const fullScore = trackFull?.rawScore ?? null;
        const chosenScore = trackChosen?.rawScore ?? null;

        const inRange = candidate2 >= bpmMin && candidate2 <= bpmMax;
        const closeToFull = fullBpm != null && Math.abs(fullBpm - candidate2) <= maxBpmDiff;
        const scoreOk = fullScore != null && chosenScore != null
          ? fullScore >= chosenScore * minScoreRatio
          : true;

        if (inRange && closeToFull && scoreOk) { // Если кандидат на ЧСС в диапазоне, близок к полному значению и удовлетворяет условиям по оценке
          bpmCandidate = fullBpm ?? candidate2;
          halfFreqRescue = true;
        }
      }
    }

    const estimateUpdated = bpmCandidate != null;
    let gatePass01 = null;
    let gateFailReason = null;
    let gateStreakCount = this._safeGateStreak ?? 0;
    let gateStd3 = null;
    let gateMaxStep3 = null;
    let subharmonicBlock = false;

    if (isSafeMode && estimateUpdated) {
      // Антисубгармоника: если есть правдоподобный 2× вариант, низкий кандидат не публикуем.
      const subCfg = safePubCfg.subharmonicBlock ?? {};
      if (subCfg.enabled !== false && bpmCandidate != null) {
        const alt = chosenOut.harmonicAlt ?? null;
        if (alt && Number.isFinite(alt.bpm)) {
          const altBpm = alt.bpm;
          const ratioMax = subCfg.ratioMax ?? 0.72;
          const minAltBpm = subCfg.minAltBpm ?? 90;
          const minAltScoreRatio = subCfg.minAltScoreRatio ?? 0.40;
          const minAltPowerRatio = subCfg.minAltPowerRatio ?? 0.25;
          const maxAltSnrDrop = subCfg.maxAltSnrDrop ?? 0.12;

          const lowVsAlt = bpmCandidate < altBpm * ratioMax;
          const altScoreOk = alt.scoreRatio == null || alt.scoreRatio >= minAltScoreRatio;
          const altPowerOk = alt.powerRatio == null || alt.powerRatio >= minAltPowerRatio;
          const altSnrOk = alt.snrDelta == null || alt.snrDelta >= -maxAltSnrDrop;

          subharmonicBlock = lowVsAlt && altBpm >= minAltBpm && altScoreOk && altPowerOk && altSnrOk;
        }
      }

      const snrOk = Number.isFinite(snrDb) && snrDb >= snrDbMin;
      const agreeOk = agreementDelta == null || agreementDelta <= agreementDeltaMax;
      const pqiOk = Number.isFinite(pqiUsed) && pqiUsed >= pqiMin;
      const confOk = confidence >= confMin;

      // Гейт по дыханию: если ЧСС сильно падает, а связь с дыханием слабая — блокируем публикацию
      let respCouplingBlock = false;
      const respCfg = safePubCfg.respCoupling ?? {};
      if (respCfg.enabled !== false && prevPubBpm != null && bpmCandidate != null) {
        const ratioMax = respCfg.ratioMax ?? 0.80;
        const minRespConf = respCfg.minRespConf ?? 0.20;
        const minCoupling01 = respCfg.minCoupling01 ?? 0.20;
        if (
          bpmCandidate < prevPubBpm * ratioMax &&
          respOut?.conf != null && respOut.conf >= minRespConf &&
          respCoupling01 != null && respCoupling01 < minCoupling01
        ) {
          respCouplingBlock = true;
        }
      }

      const sampleOk = confOk && snrOk && agreeOk && pqiOk && !subharmonicBlock && !respCouplingBlock;
      this._safeGateStreak = sampleOk ? (this._safeGateStreak + 1) : 0;
      gateStreakCount = this._safeGateStreak;

      if (bpmCandidate != null) {
        this._safeGateHist.push({ bpm: bpmCandidate });
        if (this._safeGateHist.length > requiredStreak) this._safeGateHist.shift();
      }

      if (this._safeGateHist.length >= requiredStreak) {
        const last = this._safeGateHist.slice(-requiredStreak).map((s) => s.bpm);
        const mean = last.reduce((s, v) => s + v, 0) / last.length;
        const varSum = last.reduce((s, v) => s + (v - mean) * (v - mean), 0);
        gateStd3 = Math.sqrt(varSum / Math.max(1, last.length));
        gateMaxStep3 = 0;
        for (let i = 1; i < last.length; i++) {
          gateMaxStep3 = Math.max(gateMaxStep3, Math.abs(last[i] - last[i - 1]));
        }
      }

      const stabilityOk =
        gateStd3 != null &&
        gateMaxStep3 != null &&
        gateStd3 <= std3Max &&
        gateMaxStep3 <= maxStepMax;

      const streakOk = gateStreakCount >= requiredStreak;
      const gatePass = sampleOk && streakOk && stabilityOk;
      gatePass01 = gatePass ? 1 : 0;

      if (!sampleOk) { // Если выборка не прошла
        if (subharmonicBlock) gateFailReason = "subharmonic_guard";
        else if (respCouplingBlock) gateFailReason = "low_resp_coupling";
        else if (!confOk) gateFailReason = "low_conf";
        else if (!snrOk) gateFailReason = "low_snr";
        else if (!agreeOk) gateFailReason = "high_agreement_delta";
        else if (!pqiOk) gateFailReason = "low_pqi";
      } else if (!streakOk) {
        gateFailReason = "streak";
      } else if (!stabilityOk) {
        gateFailReason = "unstable";
      }
    }

    // ---- publish gate + physiology limit ----
    const pubCfg = { ...this.cfg.publish, ...(modeCfg.publish ?? {}) };
    const minPubConf = pubCfg.minConfidence ?? 0.89;
    const minAgreement01 = pubCfg.minAgreement01 ?? 0.0;
    const holdLastMs = pubCfg.holdLastMs ?? 2500;
    const holdBandBpm = pubCfg.holdBandBpm ?? 8;

    const useProb = (this.mode === "research" && confidenceProb != null);
    const isNearLast = (this._pubBpmLast != null && bpmCandidate != null)
      ? (Math.abs(bpmCandidate - this._pubBpmLast) <= holdBandBpm)
      : false;

    const minAcquire = useProb
      ? (pubCfg.minConfidenceProb ?? minPubConf)
      : (pubCfg.minConfidenceAcquire ?? minPubConf);
    const minHold = useProb
      ? (pubCfg.minConfidenceProbHold ?? minAcquire)
      : (pubCfg.minConfidenceHold ?? minAcquire);

    const minPubConfEffective = isNearLast ? minHold : minAcquire;

    const maxDeltaPerSec = this.cfg.physiology?.maxDeltaBpmPerSec ?? 20;
    const useSafePublishGate = isSafeMode;
    const safePublishOk = !useSafePublishGate || gatePass01 === 1;
    const confOkForPublish = useSafePublishGate ? true : (confidence >= minPubConfEffective);

    let bpmPublished = null;
    let published = false;
    let publishReason = "low_conf";

    const agreementOk = (agreement01 >= minAgreement01);
    const deltaFromPrevPubBpm = (prevPubBpm != null && bpmCandidate != null && Number.isFinite(prevPubBpm))
      ? Math.abs(bpmCandidate - prevPubBpm)
      : null;

    // Логика SQI (SAFE):
    // - высокий SQI: обычная публикация
    // - низкий SQI: удерживаем последнее значение
    if (safeGateOk && safePublishOk && bpmCandidate != null && confOkForPublish && agreementOk) {
      if (prevPubBpm != null && Number.isFinite(prevPubBpm)) {
        // Ограничение резкого роста: допускаем только при сильном сигнале.
        const upCfg = safePubCfg.upshift ?? {};
        const ratioMax = upCfg.ratioMax ?? 1.18;
        const upSnrMin = upCfg.snrDbMin ?? 8.0;
        const upPeakMin = upCfg.peakRatioMin ?? 1.8;
        const upSignalMin = upCfg.signal01Min ?? 0.55;
        const upConfMin = upCfg.confidenceMin ?? 0.60;
        const upPqiMin = upCfg.pqiMin ?? 0.70;
        const ratioUp = bpmCandidate / prevPubBpm;
        if (ratioUp > ratioMax) {
          const snrOk = Number.isFinite(chosenOut.snrDb) && chosenOut.snrDb >= upSnrMin;
          const peakOk = (chosenOut.peakRatio ?? 0) >= upPeakMin;
          const signalOk = (chosenOut.signal01 ?? 0) >= upSignalMin;
          const confOk = Number.isFinite(confidence) && confidence >= upConfMin;
          const pqiOk = Number.isFinite(pqiUsed) && pqiUsed >= upPqiMin;
          if (!(snrOk && peakOk && signalOk && confOk && pqiOk)) {
            publishReason = "upshift_guard";
          }
        }

        // Ограничение резкого падения: допускаем только при сильном сигнале.
        if (publishReason === "low_conf") {
          const downCfg = safePubCfg.downshift ?? {};
          const ratioMin = downCfg.ratioMin ?? 0.88;
          const snrMin = downCfg.snrDbMin ?? 7;
          const peakMin = downCfg.peakRatioMin ?? 1.6;
          const signalMin = downCfg.signal01Min ?? 0.55;
          const ratio = bpmCandidate / prevPubBpm;
          if (ratio < ratioMin) {
            const snrOk = Number.isFinite(chosenOut.snrDb) && chosenOut.snrDb >= snrMin;
            const peakOk = (chosenOut.peakRatio ?? 0) >= peakMin;
            const signalOk = (chosenOut.signal01 ?? 0) >= signalMin;
            if (!(snrOk && peakOk && signalOk)) {
              publishReason = "downshift_guard";
              // Не публикуем новое; удерживаем последнее значение
            }
          }
        }
      }

      if (publishReason !== "downshift_guard" && publishReason !== "upshift_guard") {
      const maxDeltaFromLastBpm = pubCfg.maxDeltaFromLastBpm;
      const deltaLimitWindowSec = pubCfg.deltaLimitWindowSec ?? 3.0;
      const dtSincePubSec = (this._pubTsMs > 0) ? (timestampMs - this._pubTsMs) / 1000 : Infinity;

      // Дополнительный лимит: в SAFE можно запретить слишком большие скачки
      // относительно последней публикации. Применяем только короткое окно,
      // чтобы не "залипать", если первая публикация была неверной.
      if (
        prevPubBpm != null &&
        Number.isFinite(maxDeltaFromLastBpm) &&
        deltaFromPrevPubBpm != null &&
        dtSincePubSec <= deltaLimitWindowSec &&
        deltaFromPrevPubBpm > maxDeltaFromLastBpm
      ) {
        publishReason = "delta_limit";
      } else {
        const nowMs = timestampMs;
        const dtSec = this._pubTsMs > 0 ? (nowMs - this._pubTsMs) / 1000 : 0;
        const maxDelta = (dtSec > 0 && Number.isFinite(dtSec))
          ? (maxDeltaPerSec * dtSec + 2)
          : Infinity;

        if (prevPubBpm == null || Math.abs(bpmCandidate - prevPubBpm) <= maxDelta) {
          bpmPublished = bpmCandidate;
          published = true;
          publishReason = "ok";
          this._pubBpmLast = bpmCandidate;
          this._pubTsMs = nowMs;
        } else {
          publishReason = "physio_limit";
        }
      }
      }
    } else {
      if (!safeGateOk && safeGateReason) publishReason = safeGateReason;
      else if (!agreementOk) publishReason = "low_agreement";
      else if (!safePublishOk && gateFailReason) publishReason = gateFailReason;
      else publishReason = (bpmCandidate == null) ? "no_bpm" : "low_conf";
    }

    // Удержание последнего значения: если новый кандидат не прошёл публикацию, но он близок к последнему опубликованному и время удержания не истекло — публикуем последнее значение.
    if (!published && this._pubBpmLast != null && (timestampMs - this._pubTsMs) <= holdLastMs) {
      bpmPublished = this._pubBpmLast;
      if (publishReason === "low_conf") publishReason = "hold_low_conf";
      if (publishReason === "no_bpm") publishReason = "hold_no_bpm";
      if (publishReason === "low_agreement") publishReason = "hold_low_agreement";
    }

    return {
      valid,
      bpm: bpmPublished ?? bpmCandidate ?? bpmSmoothed ?? bpmRaw,
      bpmRaw,
      bpmSmoothed,
      bpmCandidate,
      bpmPublished,
      published,
      publishReason,
      estimateUpdated,
      gatePass01,
      gateFailReason,
      gateStreakCount,
      gateStd3,
      gateMaxStep3,
      pqiUsed,
      halfFreqRescue,
      confidence,
      confidenceHeuristic,
      confidenceProb: null,
      confidenceSource: "heuristic",
      weights: chosenOut.weights,
      quality: chosenOut.quality,
      roiDiagnostics: chosenOut.roiDiagnostics,
      algo: this.algorithm,
      algoUsed,
      fs,
      features: {
        signal01: chosenOut.signal01 ?? null,
        snr01: chosenOut.snr01 ?? null,
        peak01: chosenOut.peak01 ?? null,
        ac01: chosenOut.ac01 ?? null,
        nsqi: chosenOut.nsqi ?? null,
        specEntropy: chosenOut.specEntropy ?? null,
        snrDb: chosenOut.snrDb ?? null,
        peakRatio: chosenOut.peakRatio ?? null,
        fftAcDelta: chosenOut.fftAcDelta ?? null,
        harmonicDir: chosenOut.harmonicDir ?? null,
        harmonicFixed: chosenOut.harmonicFixed ?? null,
        subharmonicAltBpm: chosenOut.harmonicAlt?.bpm ?? null,
        subharmonicAltScoreRatio: chosenOut.harmonicAlt?.scoreRatio ?? null,
        subharmonicAltPowerRatio: chosenOut.harmonicAlt?.powerRatio ?? null,
        subharmonicAltSnrDelta: chosenOut.harmonicAlt?.snrDelta ?? null,
        subharmonicBlock: subharmonicBlock ? 1 : 0,
        promotedLowCandidate: chosenOut.tracking?.promotedLowCandidate ? 1 : 0,
        respRate: respStable ?? respOut?.bpm ?? null,
        respRateRaw: respOut?.bpm ?? null,
        respConf: respOut?.conf ?? null,
        respPeakRatio: respOut?.peakRatio ?? null,
        respSnrDb: respOut?.snrDb ?? null,
        rsaCorr,
        rsa01,
        rsaAbs,
        respCoupling01,
        physioPrior01: physio.prior01 ?? null,
        physioRate: physio.rateBpmPerSec ?? null,
        deltaFromPrevPubBpm,
        continuity01,
        agreement01,
        agreementDeltaBpm: agreement?.deltaBpm ?? null,
        motionAvg: chosenOut.motionAvg ?? null,
        lumaDeltaAvg: chosenOut.lumaDeltaAvg ?? null,
        lumaMeanAvg: chosenOut.lumaMeanAvg ?? null,
        lumaStdAvg: chosenOut.lumaStdAvg ?? null,
        clippedRatioAvg: chosenOut.clippedRatioAvg ?? null,
        specularRatioAvg: chosenOut.specularRatioAvg ?? null,
        skinPixelsAvg: chosenOut.skinPixelsAvg ?? null,
        totalPixelsAvg: chosenOut.totalPixelsAvg ?? null,
        qAvg: chosenOut.qAvg ?? null,
      },
      pos: {
        bpmRaw: posOut?.bpmRaw ?? null,
        confidence: this._computeConfidence(posOut, posContinuity, agreement01, agreement?.hardPenalty ?? 1, modeCfg),
        pqi: pqiPos,
        signal01: posOut?.signal01 ?? 0,
        peak01: posOut?.peak01 ?? 0,
        snr01: posOut?.snr01 ?? 0,
        snrDb: posOut?.snrDb ?? null,
        peakRatio: posOut?.peakRatio ?? null,
        specEntropy: posOut?.specEntropy ?? null,
        nsqi: posOut?.nsqi ?? null,
        fftAcDelta: posOut?.fftAcDelta ?? null,
        continuity01: posContinuity,
      },
      chrom: {
        bpmRaw: chromOut?.bpmRaw ?? null,
        confidence: this._computeConfidence(chromOut, chromContinuity, agreement01, agreement?.hardPenalty ?? 1, modeCfg),
        pqi: pqiChrom,
        signal01: chromOut?.signal01 ?? 0,
        peak01: chromOut?.peak01 ?? 0,
        snr01: chromOut?.snr01 ?? 0,
        snrDb: chromOut?.snrDb ?? null,
        peakRatio: chromOut?.peakRatio ?? null,
        specEntropy: chromOut?.specEntropy ?? null,
        nsqi: chromOut?.nsqi ?? null,
        fftAcDelta: chromOut?.fftAcDelta ?? null,
        continuity01: chromContinuity,
      },
      agreement,
      safeGate: {
        ok: safeGateOk,
        reason: safeGateReason,
        cfg: isSafeMode ? gateCfg : null,
      },
      tracking: (algoUsed === "pos") ? posOut?.tracking : chromOut?.tracking,
    };
  }
}
