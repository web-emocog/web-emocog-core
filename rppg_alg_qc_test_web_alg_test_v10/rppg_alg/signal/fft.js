/**
 * nextPow2 — находит ближайшую степень двойки, большую или равную n
 */
export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
// fftMag2Real — преобразует спектр в реальный
export function fftMag2Real(signal, fs) {
  const N = nextPow2(signal.length);
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  // Применяем окно Хэмминга
  const L = signal.length;
  for (let i = 0; i < L; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, L - 1)));
    re[i] = signal[i] * w;
  }

  // Битовая перестановка
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
    }
  }

  // Битовая сортировка
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlen_re = Math.cos(ang);
    const wlen_im = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let w_re = 1, w_im = 0;
      for (let j = 0; j < len / 2; j++) {
        const u_re = re[i + j], u_im = im[i + j];
        const v_re = re[i + j + len / 2] * w_re - im[i + j + len / 2] * w_im;
        const v_im = re[i + j + len / 2] * w_im + im[i + j + len / 2] * w_re;

        // Обновляем выходные значения
        re[i + j] = u_re + v_re;
        im[i + j] = u_im + v_im;
        re[i + j + len / 2] = u_re - v_re;
        im[i + j + len / 2] = u_im - v_im;

        // Обновляем коэффициенты вращения
        const nw_re = w_re * wlen_re - w_im * wlen_im;
        const nw_im = w_re * wlen_im + w_im * wlen_re;
        w_re = nw_re; w_im = nw_im;
      }
    }
  }

  // Вычисляем квадрат амплитуды и частоты
  const half = N / 2;
  const mag2 = new Float64Array(half);
  const freqs = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    mag2[k] = re[k] * re[k] + im[k] * im[k];
    freqs[k] = (k * fs) / N;
  }
  return { mag2, freqs };
}
