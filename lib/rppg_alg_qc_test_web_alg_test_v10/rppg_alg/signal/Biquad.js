// Biquad — биquad-фильтр
export class Biquad {
  constructor(type, fs, f0, Q = 0.707) {
    this.type = type;
    this.fs = fs;
    this.f0 = f0;
    this.Q = Q;
    this.z1 = 0;
    this.z2 = 0;
    this._calc();
  }

  _calc() { // вычисляет коэффициенты фильтра
    const w0 = 2 * Math.PI * (this.f0 / this.fs);
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * this.Q);
    // коэффициенты фильтра
    let b0, b1, b2, a0, a1, a2;
    if (this.type === "lowpass") {
      b0 = (1 - cosw0) / 2;
      b1 = 1 - cosw0;
      b2 = (1 - cosw0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
    } else { // highpass
      b0 = (1 + cosw0) / 2;
      b1 = -(1 + cosw0);
      b2 = (1 + cosw0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cosw0;
      a2 = 1 - alpha;
    }

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  process(x) { // обрабатывает входной сигнал
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}
