// Owned scratch space for synchronous, per-engine POS/CHROM projection.
// Keep the original summation order, expressions and standard-deviation epsilons.
export class ColorProjectionWindow {
  constructor() {
    this.capacity = 0;
    this._vectors = [];
  }

  sample(series, since = null, minimumSamples = 0) {
    let count = 0, rSum = 0, gSum = 0, bSum = 0;
    for (const point of series) {
      if (since !== null && !(point.tMs >= since)) continue;
      count++;
      rSum += point.r; gSum += point.g; bSum += point.b;
    }
    if (count < minimumSamples) return null;
    if (count === 0) return { sampleCount: 0, pos: NaN, chrom: NaN };
    if (count > this.capacity) {
      let capacity = 1;
      while (capacity < count) capacity *= 2;
      this._vectors = Array.from({ length: 4 }, () => new Float64Array(capacity));
      this.capacity = capacity;
    }
    const [s1, s2, x, y] = this._vectors;
    const mR = rSum / count + 1e-6, mG = gSum / count + 1e-6, mB = bSum / count + 1e-6;
    let index = 0, s1Sum = 0, s2Sum = 0, xSum = 0, ySum = 0;
    for (const point of series) {
      if (since !== null && !(point.tMs >= since)) continue;
      const rn = point.r / mR - 1, gn = point.g / mG - 1, bn = point.b / mB - 1;
      s1[index] = gn - bn;
      s2[index] = -2 * rn + gn + bn;
      x[index] = 3 * rn - 2 * gn;
      y[index] = 1.5 * rn + gn - 1.5 * bn;
      s1Sum += s1[index]; s2Sum += s2[index]; xSum += x[index]; ySum += y[index];
      index++;
    }
    const s1Mean = s1Sum / count, s2Mean = s2Sum / count, xMean = xSum / count, yMean = ySum / count;
    let s1Variance = 0, s2Variance = 0, xVariance = 0, yVariance = 0;
    for (let i = 0; i < count; i++) {
      s1Variance += (s1[i] - s1Mean) * (s1[i] - s1Mean);
      s2Variance += (s2[i] - s2Mean) * (s2[i] - s2Mean);
      xVariance += (x[i] - xMean) * (x[i] - xMean);
      yVariance += (y[i] - yMean) * (y[i] - yMean);
    }
    const posAlpha = Math.sqrt(s1Variance / count + 1e-12) / (Math.sqrt(s2Variance / count + 1e-12) + 1e-12);
    const chromAlpha = Math.sqrt(xVariance / count + 1e-12) / (Math.sqrt(yVariance / count + 1e-12) + 1e-12);
    return { sampleCount: count, pos: s1[count - 1] + posAlpha * s2[count - 1], chrom: x[count - 1] - chromAlpha * y[count - 1] };
  }
}
