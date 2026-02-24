import { mean, std } from "../utils.js";

export function chromSampleFromWindow(rgbWin) { // Функция для выборки признаков из окна RGB
  const R = rgbWin.map(v => v.r);
  const G = rgbWin.map(v => v.g);
  const B = rgbWin.map(v => v.b);

  const mR = mean(R) + 1e-6;
  const mG = mean(G) + 1e-6;
  const mB = mean(B) + 1e-6;

  const Rn = R.map(x => x / mR - 1);
  const Gn = G.map(x => x / mG - 1);
  const Bn = B.map(x => x / mB - 1);

  const X = Rn.map((r, i) => 3 * r - 2 * Gn[i]);
  const Y = Rn.map((r, i) => 1.5 * r + Gn[i] - 1.5 * Bn[i]);

  const a = std(X) / (std(Y) + 1e-12);
  const last = rgbWin.length - 1;
  return X[last] - a * Y[last];
}
