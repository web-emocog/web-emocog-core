import { clamp } from "../utils.js";
import { Biquad } from "./Biquad.js";
import { fftMag2Real } from "./fft.js";

// estimateRespirationRate — оценивает частоту дыхания
export function estimateRespirationRate(signal, fs, bandHz = [0.10, 0.40]) {
  if (!signal || signal.length < 20) {
    return { bpm: null, conf: 0, peakRatio: null, snrDb: null, signal: null };
  }

  // Удаляем среднее значение
  let mean = 0;
  for (let i = 0; i < signal.length; i++) mean += signal[i];
  mean /= Math.max(1, signal.length);
  const x = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) x[i] = signal[i] - mean;

  // Применяем фильтры
  const hp1 = new Biquad("highpass", fs, bandHz[0], 0.707);
  const hp2 = new Biquad("highpass", fs, bandHz[0], 0.707);
  const lp1 = new Biquad("lowpass", fs, bandHz[1], 0.707);
  const lp2 = new Biquad("lowpass", fs, bandHz[1], 0.707);

  const filt = new Float64Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y = x[i];
    y = hp1.process(y); y = hp2.process(y);
    y = lp1.process(y); y = lp2.process(y);
    filt[i] = y;
  }
  // Применяем БПФ
  const { mag2, freqs } = fftMag2Real(filt, fs);

  // Ищем границы частотного диапазона
  let k0 = 0;
  while (k0 < freqs.length && freqs[k0] < bandHz[0]) k0++;
  let k1 = k0;
  while (k1 < freqs.length && freqs[k1] <= bandHz[1]) k1++;
  if (k1 - k0 < 3) {
    return { bpm: null, conf: 0, peakRatio: null, snrDb: null, signal: Array.from(filt) };
  }

  // Ищем пик в диапазоне
  let kPeak = k0;
  let pPeak = -1;
  let pSum = 0;
  let pCnt = 0;
  for (let k = k0; k < k1; k++) {
    const p = mag2[k];
    pSum += p;
    pCnt++;
    if (p > pPeak) { pPeak = p; kPeak = k; }
  }

  // Ищем второй по величине пик
  let p2 = -1;
  for (let k = k0; k < k1; k++) {
    if (k === kPeak) continue;
    const p = mag2[k];
    if (p > p2) p2 = p;
  }

  // Вычисляем соотношение пиков
  const peakRatio = pPeak / (p2 + 1e-12);
  const noise = (pSum - pPeak) / Math.max(1, pCnt - 1);
  const snr = pPeak / (noise + 1e-12);
  const snrDb = 10 * Math.log10(snr + 1e-12);
  // Вычисляем частоту пика
  const fPeak = freqs[kPeak];
  const bpm = fPeak * 60;
  // Вычисляем доверие
  const confPeak = clamp((Math.log(peakRatio) - 0.10) / 0.90, 0, 1);
  const confSnr = clamp((snrDb - 1.0) / 6.0, 0, 1);
  const conf = clamp(confPeak * confSnr, 0, 1);

  return { bpm, conf, peakRatio, snrDb, signal: Array.from(filt) };
}
