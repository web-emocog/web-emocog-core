import { mean, std } from "../utils.js";

export function posSampleFromWindow(rgbWin) { // Функция для выборки признаков из окна RGB
  const R = rgbWin.map(v => v.r);
  const G = rgbWin.map(v => v.g);
  const B = rgbWin.map(v => v.b);

  const mR = mean(R) + 1e-6;
  const mG = mean(G) + 1e-6;
  const mB = mean(B) + 1e-6;

  const Rn = R.map(x => x / mR - 1);
  const Gn = G.map(x => x / mG - 1);
  const Bn = B.map(x => x / mB - 1);

  const S1 = Gn.map((g, i) => g - Bn[i]);
  const S2 = Rn.map((r, i) => -2 * r + Gn[i] + Bn[i]);

  const a = std(S1) / (std(S2) + 1e-12);
  const last = rgbWin.length - 1;
  return S1[last] + a * S2[last];
}
