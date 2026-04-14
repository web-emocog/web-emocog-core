import { std } from "../utils.js";

// nsqiFromFiltered — вычисляет NSQI для отфильтрованного сигнала
export function nsqiFromFiltered(signal) {
  if (!signal || signal.length < 2) return null;

  const abs = new Array(signal.length);
  for (let i = 0; i < signal.length; i++) abs[i] = Math.abs(signal[i]);

  // Вычисляем стандартные отклонения
  const sigmaSignal = std(abs);
  const sigmaNoise = std(signal);
  if (!Number.isFinite(sigmaSignal) || !Number.isFinite(sigmaNoise) || sigmaNoise <= 1e-12) return null;

  const num = sigmaSignal * sigmaSignal;
  const den = sigmaNoise * sigmaNoise + 1e-12;
  return num / den;
}
