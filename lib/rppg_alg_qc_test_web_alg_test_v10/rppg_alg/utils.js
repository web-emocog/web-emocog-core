export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const mean = (arr) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);

export const std = (arr) => { // Вычисление стандартного отклонения
  const m = mean(arr);
  const v = mean(arr.map(x => (x - m) * (x - m)));
  return Math.sqrt(v + 1e-12);
};

export const median = (arr) => { // Вычисление медианы
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return (a.length % 2) ? a[mid] : 0.5 * (a[mid - 1] + a[mid]);
};

export const zscore = (arr) => { // Вычисление Z-оценки
  const m = mean(arr);
  const s = std(arr);
  return arr.map(x => (x - m) / (s + 1e-12));
};
