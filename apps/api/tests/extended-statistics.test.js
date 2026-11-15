'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const stats = require('../analytics/extended-statistics');
const { describe, pairedT, welchT, wilcoxon, mannWhitney, kruskal, friedman,
  pearson, spearman, adjustPValues, bootstrapDifference, signalDetection,
  reliability, LIMITS } = stats;

/*
 * Independent goldens/provenance:
 * - R's Student sleep data and paired example:
 *   https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/sleep.html
 * - Corn signed ranks (Wilcoxon 1945), diagnosis-age U, Pearson, Kruskal:
 *   https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.wilcoxon.html
 *   https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.mannwhitneyu.html
 *   https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.pearsonr.html
 *   https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.kruskal.html
 * - Sprent/Smeeton pulse-rate Friedman example (SciPy 1.13):
 *   https://docs.scipy.org/doc/scipy-1.13.0/reference/generated/scipy.stats.friedmanchisquare.html
 * - Shrout/Fleiss Table 2: ICC(2,1)=184/635, published rounded value .29,
 *   doi:10.1037/0033-2909.86.2.420. Wine fixture ICC=318/437:
 *   https://raw.githubusercontent.com/raphaelvallat/pingouin/master/src/pingouin/datasets/icc.csv
 * - Normal quantiles independently checked with Python 3.13 statistics.NormalDist;
 *   rank normal tails checked with Python math.erfc; ICC with fractions.Fraction.
 * - Bootstrap endpoints independently generated with Python uint32 arithmetic,
 *   direct uncentered resampled means and type-7 quantiles (seed 12345, 500 draws).
 * No dependency, production routine or network is used as a test oracle.
 */

function near(actual, expected, tolerance = 1e-11) {
  assert.equal(typeof actual, 'number');
  assert.ok(Number.isFinite(actual), `nonfinite value: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected} (absolute tolerance ${tolerance})`);
}
function relative(actual, expected, tolerance = 2e-12) {
  near(actual / expected, 1, tolerance);
}
function ok(result) {
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(result.reason, null);
  return result;
}
function absent(result, reason, status = 'unavailable') {
  assert.equal(result.status, status, JSON.stringify(result));
  assert.equal(result.reason, reason);
  if ('p' in result) assert.equal(result.p, null);
  return result;
}
function finiteTree(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `nonfinite result: ${value}`);
  else if (value && typeof value === 'object') Object.values(value).forEach(finiteTree);
}
const average = values => values.reduce((a, b) => a + b, 0) / values.length;
function independentRanks(values) {
  return values.map(value => values.filter(x => x < value).length
    + (values.filter(x => x === value).length + 1) / 2);
}
function independentR(x, y) {
  const mx = average(x), my = average(y);
  let xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < x.length; i++) {
    xx += (x[i] - mx) ** 2; yy += (y[i] - my) ** 2;
    xy += (x[i] - mx) * (y[i] - my);
  }
  return xy / Math.sqrt(xx * yy);
}
function signOracle(differences) {
  const d = differences.filter(value => value !== 0);
  const ranked = independentRanks(d.map(Math.abs));
  const observed = Math.abs(ranked.reduce((total, rank, i) => total + Math.sign(d[i]) * rank, 0));
  let extreme = 0;
  for (let mask = 0; mask < 2 ** d.length; mask++) {
    const value = Math.abs(ranked.reduce((total, rank, i) => total + ((mask & (1 << i)) ? rank : -rank), 0));
    if (value >= observed) extreme++;
  }
  return extreme / 2 ** d.length;
}
function mannWhitneyOracle(a, b) {
  const ranked = independentRanks(a.concat(b));
  const observed = ranked.slice(0, a.length).reduce((total, value) => total + value, 0);
  let lower = 0, upper = 0, states = 0;
  for (let mask = 0; mask < 2 ** ranked.length; mask++) {
    let size = 0, total = 0;
    for (let i = 0; i < ranked.length; i++) if (mask & (1 << i)) { size++; total += ranked[i]; }
    if (size !== a.length) continue;
    states++;
    if (total <= observed) lower++;
    if (total >= observed) upper++;
  }
  return Math.min(1, 2 * Math.min(lower, upper) / states);
}
// Lexicographic enumeration is deliberately different from production's swaps.
function allOrders(n) {
  const order = Array.from({ length: n }, (_, i) => i), result = [order.slice()];
  for (;;) {
    let i = n - 2;
    while (i >= 0 && order[i] > order[i + 1]) i--;
    if (i < 0) return result;
    let j = n - 1;
    while (order[j] < order[i]) j--;
    [order[i], order[j]] = [order[j], order[i]];
    const tail = order.splice(i + 1).reverse(); order.push(...tail);
    result.push(order.slice());
  }
}
function spearmanOracle(x, y) {
  const rx = independentRanks(x), ry = independentRanks(y);
  const observed = Math.abs(independentR(rx, ry));
  const orders = allOrders(x.length);
  return orders.filter(order => Math.abs(independentR(rx, order.map(i => ry[i]))) >= observed - 1e-13).length / orders.length;
}
function friedmanOracle(groups) {
  const k = groups.length, n = groups[0].length;
  const rows = Array.from({ length: n }, (_, i) => independentRanks(groups.map(group => group[i])));
  const score = matrix => {
    const sums = Array.from({ length: k }, (_, j) => matrix.reduce((total, row) => total + row[j], 0));
    return sums.reduce((total, value) => total + value * value, 0);
  };
  const observed = score(rows), orders = allOrders(k), states = orders.length ** n;
  let extreme = 0;
  for (let code = 0; code < states; code++) {
    let value = code;
    const permuted = rows.map(row => {
      const order = orders[value % orders.length]; value = Math.floor(value / orders.length);
      return order.map(index => row[index]);
    });
    if (score(permuted) >= observed) extreme++;
  }
  return extreme / states;
}
// Student-t tail via a trigonometric integral and composite Simpson quadrature.
// No beta/gamma functions or production coefficients are involved.
function independentTP(t, df) {
  const integral = (low, high) => {
    const steps = 16384, step = (high - low) / steps;
    const f = angle => Math.max(0, Math.cos(angle)) ** (df - 1);
    let total = f(low) + f(high);
    for (let i = 1; i < steps; i++) total += (i % 2 ? 4 : 2) * f(low + step * i);
    return total * step / 3;
  };
  return integral(Math.atan(Math.abs(t) / Math.sqrt(df)), Math.PI / 2) / integral(0, Math.PI / 2);
}
const sleepA = [0.7, -1.6, -0.2, -1.2, -0.1, 3.4, 3.7, 0.8, 0, 2];
const sleepB = [1.9, 0.8, 1.1, 0.1, -0.1, 4.4, 5.5, 1.6, 4.6, 3.4];

test('module is self-contained CommonJS, ASCII and has explicit immutable workload limits', () => {
  const source = fs.readFileSync(require.resolve('../analytics/extended-statistics'), 'utf8');
  assert.ok(/^[\x00-\x7f]*$/.test(source));
  assert.ok(/^[\x00-\x7f]*$/.test(fs.readFileSync(__filename, 'utf8')));
  assert.doesNotMatch(source, /\brequire\s*\(|\bimport\s|Math\.random/);
  assert.deepEqual(Object.keys(stats).sort(), ['describe', 'pairedT', 'welchT', 'wilcoxon', 'mannWhitney',
    'kruskal', 'friedman', 'pearson', 'spearman', 'adjustPValues', 'bootstrapDifference',
    'signalDetection', 'reliability', 'LIMITS'].sort());
  assert.ok(Object.isFrozen(LIMITS));
  assert.equal(LIMITS.bootstrapIterations, 2000);
});

test('describe matches hand-computed sample SD, unscaled MAD and type-7 quantiles', () => {
  const result = ok(describe([100, 1, 4, 2, 3]));
  assert.equal(result.n, 5);
  near(result.mean, 22); near(result.median, 3); near(result.sd, Math.sqrt(1902.5));
  near(result.mad, 1); near(result.cvPct, Math.sqrt(1902.5) / 22 * 100);
  near(result.p10, 1.4); near(result.p90, 61.6); near(result.p95, 80.8);
  assert.equal(result.min, 1); assert.equal(result.max, 100);
  const even = ok(describe([1, 3, 7, 9]));
  near(even.median, 5); near(even.mad, 3);
  near(even.sd, Math.sqrt(40 / 3));
});

test('describe distinguishes genuine constant values, missing SD and undefined CV', () => {
  const one = describe([4]);
  assert.equal(one.status, 'partial'); assert.equal(one.n, 1);
  assert.equal(one.sd, null); assert.equal(one.cvPct, null);
  assert.equal(one.fieldReasons.sd, 'insufficient_n'); near(one.mad, 0);
  const constant = ok(describe([5, 5, 5])); near(constant.sd, 0); near(constant.cvPct, 0);
  for (const values of [[-1, 1], [-2, -1], [0, 0]]) {
    const result = describe(values);
    assert.equal(result.status, 'partial'); assert.equal(result.cvPct, null);
    assert.equal(result.fieldReasons.cvPct, 'cv_requires_positive_mean');
  }
  absent(describe([]), 'insufficient_n');
});

test('centered/scaled moments preserve small, large and offset observations', () => {
  const shifted = ok(describe([1, 2, 3, 4, 5].map(value => 1e12 + value)));
  near(shifted.mean, 1e12 + 3); near(shifted.sd, Math.sqrt(2.5));
  for (const scale of [1e-200, 1e200]) {
    const result = ok(describe([scale, 2 * scale, 3 * scale]));
    relative(result.mean, 2 * scale); relative(result.sd, scale); relative(result.mad, scale);
    const paired = ok(pairedT([0, 0, 0], [scale, 2 * scale, 3 * scale]));
    near(paired.statistic, Math.sqrt(12)); near(paired.p, 1 - Math.sqrt(6 / 7));
  }
});

test('compensated original-value means preserve cancellation residuals instead of reporting fake zero', () => {
  for (const values of [[-1e16, 1e16, 1], [-1e200, 1e200, 1e-100], [-1e100, 1e100, 1e-100]]) {
    const result = ok(describe(values));
    relative(result.mean, values[2] / 3);
    assert.notEqual(result.mean, 0);
  }
  const max = Number.MAX_VALUE;
  // Overflow in an intermediate raw sum must not invalidate a finite mean.
  const manyLarge = ok(describe(new Array(10).fill(max)));
  relative(manyLarge.mean, max); near(manyLarge.sd, 0);
  absent(describe([Number.MIN_VALUE, 0, 0]), 'numerical_underflow');
});

test('paired t matches R sleep golden and explicitly uses B-A and Cohen dz', () => {
  const result = ok(pairedT(sleepA, sleepB));
  assert.equal(result.method, 'paired_t'); assert.equal(result.nA, 10); assert.equal(result.nB, 10);
  near(result.effect, 1.58); near(result.statistic, 4.062127683382037);
  near(result.p, 0.00283289019738427); near(result.df, 9);
  near(result.ci95.lower, 0.700114236723); near(result.ci95.upper, 2.459885763277);
  assert.equal(result.effectSize.method, 'cohen_dz'); near(result.effectSize.value, 1.284557562591055);
  const reverse = ok(pairedT(sleepB, sleepA));
  near(reverse.effect, -result.effect); near(reverse.statistic, -result.statistic);
  near(reverse.p, result.p); near(reverse.ci95.lower, -result.ci95.upper);
  near(reverse.effectSize.value, -result.effectSize.value);
});

test('t inference handles df=1 and df=2 against closed-form Cauchy/t2 tails', () => {
  const paired = ok(pairedT([0, 0], [1, 3]));
  near(paired.statistic, 2); near(paired.df, 1);
  near(paired.p, 1 - 2 * Math.atan(2) / Math.PI);
  near(paired.ci95.lower, 2 - 12.7062047361747); near(paired.ci95.upper, 2 + 12.7062047361747);
  const welch = ok(welchT([1, 3], [3, 5]));
  near(welch.df, 2); near(welch.statistic, Math.SQRT2); near(welch.p, 1 - 1 / Math.SQRT2);
  near(welch.ci95.lower, -4.08486984459331); near(welch.ci95.upper, 8.08486984459331);
});

test('Welch fractional df, CI and two-sided p agree with an independent integration oracle', () => {
  for (const [a, b] of [[sleepA, sleepB], [[2, 3, 5, 8], [1, 7, 12, 14, 18, 22]],
    [[1, 1, 1], [1, 2, 4, 9]], [[2, 4, 6, 8, 10], [3, 7, 11]]]) {
    const result = ok(welchT(a, b));
    near(result.p, independentTP(result.statistic, result.df), 2e-10);
    const variance = values => values.reduce((total, value) => total + (value - average(values)) ** 2, 0) / (values.length - 1);
    const va = variance(a) / a.length, vb = variance(b) / b.length;
    const se = Math.sqrt(va + vb);
    near(result.effect, average(b) - average(a));
    near(result.df, (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1)));
    near(independentTP((result.ci95.upper - result.effect) / se, result.df), 0.05, 2e-10);
    assert.equal(result.effectSize.method, 'cohen_d_pooled_sd');
    const pooled = Math.sqrt(((a.length - 1) * variance(a) + (b.length - 1) * variance(b)) / (a.length + b.length - 2));
    near(result.effectSize.value, result.effect / pooled);
    const reverse = ok(welchT(b, a));
    near(reverse.p, result.p); near(reverse.df, result.df); near(reverse.effect, -result.effect);
    near(reverse.ci95.upper, -result.ci95.lower);
  }
  const sleep = ok(welchT(sleepA, sleepB));
  near(sleep.df, 17.7764735161785); near(sleep.p, 0.079394140187358);
  near(sleep.ci95.lower, -0.2054832307117); near(sleep.ci95.upper, 3.3654832307117);
});

test('zero standard error is unavailable, not t=0, p=1 or a fake precise CI', () => {
  for (const [a, b] of [[[1, 2, 3], [2, 3, 4]], [[1, 2, 3], [1, 2, 3]]]) {
    const result = absent(pairedT(a, b), 'zero_difference_variation');
    assert.equal(result.statistic, null); assert.deepEqual(result.ci95, { lower: null, upper: null });
    assert.equal(result.effectSize.value, null);
  }
  absent(welchT([1, 1], [2, 2]), 'zero_variation');
  const nullEffect = ok(welchT([1, 2, 3], [1, 2, 3]));
  near(nullEffect.statistic, 0); near(nullEffect.p, 1); near(nullEffect.effectSize.value, 0);
});

test('Wilcoxon matches published corn exact golden', () => {
  const d = [6, 8, 14, 16, 23, 24, 28, 29, 41, -48, 49, 56, 60, -67, 75];
  const result = ok(wilcoxon(d.map(() => 0), d));
  near(result.statistic, 24); near(result.p, 0.041259765625, 0);
  assert.equal(result.pMethod, 'exact_conditional_sign_permutation');
  near(result.effectSize.value, (96 - 24) / 120);
});

test('Wilcoxon ties, exact zeros, central tails and one informative difference use real sign permutations', () => {
  const cases = [[1, -1], [1, 2, -3], [0, 0, 2, -2, 2], [0, 1], [0, 0, 0, -3],
    [1, -2, 2, -2, 4, 4, 0], [1, 1, 1, 1], [1, -1, 2, -2, 3, -3]];
  for (const d of cases) {
    const result = ok(wilcoxon(d.map(() => 0), d));
    near(result.p, signOracle(d), 0);
    assert.equal(result.nEffective, d.filter(value => value !== 0).length);
    assert.equal(result.nZero, d.filter(value => value === 0).length);
    const reverse = ok(wilcoxon(d, d.map(() => 0)));
    near(reverse.p, result.p); near(reverse.effectSize.value, -result.effectSize.value);
  }
  const zero = absent(wilcoxon([1, 2], [1, 2]), 'all_zero_differences');
  assert.equal(zero.nEffective, 0); assert.equal(zero.nZero, 2);
  assert.equal(zero.statistic, null);
});

test('signed-rank DP agrees with exhaustive enumeration across tied random integer fixtures', () => {
  let seed = 137;
  for (let fixture = 0; fixture < 60; fixture++) {
    const d = Array.from({ length: 2 + fixture % 9 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % 7 - 3;
    });
    if (d.every(value => value === 0)) d[0] = 1;
    const result = ok(wilcoxon(d.map(() => 0), d));
    near(result.p, signOracle(d), 0);
  }
});

test('Wilcoxon labels its tie-corrected normal approximation and continuity correction', () => {
  const d = Array.from({ length: 70 }, (_, i) => [-3, -1, 0, 1, 1, 2, 4][i % 7]);
  const result = ok(wilcoxon(d.map(() => 0), d));
  assert.equal(result.nEffective, 60); near(result.statistic, 610);
  near(result.p, 0.02257905472892896);
  assert.equal(result.pMethod, 'normal_tie_corrected_continuity_approximation');
  assert.equal(result.hasTies, true);
  const exactBoundary = ok(wilcoxon(new Array(50).fill(0), new Array(50).fill(1)));
  near(exactBoundary.p, 2 ** -49, 0);
  assert.equal(exactBoundary.pMethod, 'exact_conditional_sign_permutation');
});

test('Mann-Whitney matches published U=17 and exact p=1/9 golden', () => {
  const result = ok(mannWhitney([19, 22, 16, 29, 24], [20, 11, 17, 12]));
  near(result.statistic, 17); near(result.p, 1 / 9, 0);
  near(result.effectSize.value, -0.7); assert.equal(result.permutationStates, 126);
  assert.equal(result.pMethod, 'exact_conditional_label_permutation_equal_tails');
});

test('Mann-Whitney ties and unequal Ns agree with exhaustive label assignment, not tie-free tables', () => {
  for (const [a, b] of [[[1, 1, 2], [1, 2, 3]], [[1, 2], [2, 3, 4]],
    [[0, 0, 0], [0, 1]], [[2, 3, 3, 4], [1, 2, 4]], [[1, 2], [3, 4]]]) {
    const result = ok(mannWhitney(a, b));
    near(result.p, mannWhitneyOracle(a, b), 0);
    const reverse = ok(mannWhitney(b, a));
    near(result.statistic + reverse.statistic, a.length * b.length);
    near(result.p, reverse.p); near(result.effectSize.value, -reverse.effectSize.value);
  }
  absent(mannWhitney([1, 1], [1, 1]), 'zero_variation');
});

test('Mann-Whitney bounded asymptotic path has an independent normal-tail golden', () => {
  const a = Array.from({ length: 12 }, (_, i) => i % 4);
  const b = Array.from({ length: 12 }, (_, i) => (i + 2) % 6);
  const result = ok(mannWhitney(a, b));
  near(result.statistic, 48); near(result.p, 0.16708667922565057);
  assert.equal(result.pMethod, 'normal_tie_corrected_continuity_approximation');
  const small = absent(mannWhitney([0, 1], Array.from({ length: 1000 }, (_, i) => i)), 'small_n_exact_budget_exceeded', 'partial');
  assert.ok(Number.isFinite(small.statistic));
  assert.equal(small.pMethod, 'unavailable');
});

test('Kruskal matches published untied and tied statistics and does not invent small-N p', () => {
  const result = ok(kruskal([[1, 3, 5, 7, 9], [2, 4, 6, 8, 10]]));
  near(result.statistic, 0.2727272727272734); near(result.p, 0.6015081344405895);
  assert.equal(result.pMethod, 'chi_square_tie_corrected_approximation');
  const small = absent(kruskal([[1, 1, 1], [2, 2, 2], [2, 2]]), 'insufficient_n_for_chi_square_approximation', 'partial');
  near(small.statistic, 7); assert.equal(small.hasTies, true);
  // Same two-level structure at permitted N; df=2 survival is exp(-H/2).
  const tied = ok(kruskal([[1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [2, 2, 2, 2, 2]]));
  near(tied.statistic, 14); near(tied.p, Math.exp(-7));
  absent(kruskal([[1, 1], [1, 1]]), 'zero_variation');
});

test('Friedman published repeated-measures pulse golden labels approximation limitations', () => {
  const result = ok(friedman([[72, 96, 88, 92, 74, 76, 82],
    [120, 120, 132, 120, 101, 96, 112], [76, 95, 104, 96, 84, 72, 76]]));
  near(result.statistic, 10.57142857142857); near(result.p, 0.005063414171757498);
  near(result.kendallW, result.statistic / 14); assert.equal(result.n, 7);
  assert.equal(result.pMethod, 'chi_square_tie_corrected_approximation');
  assert.ok(result.warnings.includes('small_sample_or_few_conditions_chi_square_may_be_inaccurate'));
});

test('Friedman small-N exact within-person permutations work with ties and preserve person positions', () => {
  for (const groups of [[[1, 1], [2, 2], [3, 3]], [[1, 2, 3], [1, 4, 2], [3, 4, 1]],
    [[1, 3], [3, 1], [2, 2]], [[1, 2], [2, 1], [3, 4], [4, 3]]]) {
    const result = ok(friedman(groups));
    near(result.p, friedmanOracle(groups), 0);
    assert.equal(result.pMethod, 'exact_within_participant_label_permutation');
    const shifted = groups.map(group => group.map((value, i) => value + 100 * i));
    near(ok(friedman(shifted)).p, result.p, 0);
    near(ok(friedman(groups.slice().reverse())).statistic, result.statistic);
  }
  absent(friedman([[1, 2], [1, 2], [1, 2]]), 'zero_within_participant_variation');
  const tooMany = Array.from({ length: 8 }, (_, j) => [j, j + 1]);
  absent(friedman(tooMany), 'small_n_exact_budget_exceeded', 'partial');
});

test('Pearson published r/p golden and independent-pair metadata', () => {
  const x = [1, 2, 3, 4, 5, 6, 7], y = [10, 9, 2.5, 6, 4, 3, 2];
  const result = ok(pearson(x, y));
  near(result.r, -0.828503883588428); near(result.p, 0.021280260007523286);
  near(result.statistic, result.r); assert.equal(result.n, 7); assert.equal(result.df, 5);
  assert.ok(result.assumptions.includes('independent_participant_pairs'));
  near(ok(pearson(y, x)).r, result.r);
  near(ok(pearson(x.map(v => v * -2 + 1e12), y.map(v => v * 3 - 1e12))).r, -result.r);
  near(ok(pearson(x.map(v => v * 1e200), y.map(v => v * 1e-200))).r, result.r);
});

test('Pearson rejects constant marginals; two pairs have coefficient only; perfect lines are not fake nulls', () => {
  absent(pearson([1, 1, 1], [1, 2, 3]), 'zero_variation');
  absent(pearson([1, 2, 3], [2, 2, 2]), 'zero_variation');
  const small = absent(pearson([1, 2], [3, 4]), 'insufficient_n_for_inference', 'partial');
  near(small.r, 1);
  const perfect = ok(pearson([1, 2, 3], [2, 4, 6])); near(perfect.r, 1); near(perfect.p, 0);
  const anti = ok(pearson([1, 2, 3], [6, 4, 2])); near(anti.r, -1); near(anti.p, 0);
});

test('Spearman ties use average ranks and exact pair permutations, not a small-N t p-value', () => {
  for (const [x, y] of [[[1, 2, 3, 4, 5], [5, 6, 7, 8, 7]], [[1, 1, 2, 3], [4, 2, 2, 1]],
    [[1, 2, 3], [1, 2, 3]], [[3, 1, 2, 4], [2, 2, 1, 5]]]) {
    const result = ok(spearman(x, y));
    near(result.rho, independentR(independentRanks(x), independentRanks(y)));
    near(result.p, spearmanOracle(x, y), 0);
    assert.equal(result.pMethod, 'exact_pairing_permutation_absolute_rho');
    near(result.statistic, result.rho);
  }
  const example = ok(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]));
  near(example.rho, 0.8207826816681233);
  // Published SciPy exact-permutation example, not its asymptotic .0723965.
  const published = ok(spearman([1.76405235, 0.40015721, 0.97873798, 2.2408932, 1.86755799, -0.97727788],
    [2.71414076, 0.2488, 0.87551913, 2.6514917, 2.01160156, 0.47699563]));
  near(published.p, 0.10277777777777777, 0);
  near(ok(spearman([1, 2, 3], [1, 2, 3])).p, 1 / 3, 0);
  absent(spearman([1, 1, 1], [1, 2, 3]), 'zero_variation');
});

test('Spearman unavailable/approximation boundaries are explicit', () => {
  const x = Array.from({ length: 12 }, (_, i) => i);
  const y = x.map(i => i % 5);
  const result = ok(spearman(x, y));
  assert.equal(result.pMethod, 'student_t_rank_approximation');
  near(result.p, independentTP(result.rho / Math.sqrt((1 - result.rho ** 2) / 10), 10));
  assert.ok(result.warnings.includes('small_sample_rank_approximation_permutation_preferred'));
  absent(spearman(x.slice(0, 9), y.slice(0, 9)), 'small_n_exact_budget_exceeded', 'partial');
  const perfect = absent(spearman(x, x), 'perfect_rank_correlation_requires_exact_p', 'partial');
  near(perfect.rho, 1);
  const boundary = ok(spearman(x.slice(0, 8), x.slice(0, 8)));
  assert.equal(boundary.permutationStates, 40320); near(boundary.p, 2 / 40320, 0);
});

test('Holm/BH/Bonferroni match independent stepwise goldens and retain order/IDs', () => {
  const entries = [0.01, 0.04, 0.03, 0.002].map((p, i) => ({ id: `h${i}`, p }));
  const expected = { holm: [0.03, 0.06, 0.06, 0.008], bh: [0.02, 0.04, 0.04, 0.008], bonferroni: [0.04, 0.16, 0.12, 0.008] };
  for (const method of Object.keys(expected)) {
    const result = ok(adjustPValues(entries, method));
    assert.equal(result.familySize, 4);
    result.results.forEach((row, i) => {
      assert.equal(row.id, entries[i].id); near(row.p, entries[i].p); near(row.pAdjusted, expected[method][i]);
    });
    const reverse = ok(adjustPValues(entries.slice().reverse(), method)).results.reverse();
    assert.deepEqual(reverse, result.results);
    const ties = ok(adjustPValues([0, 0.01, 0.01, 1].map((p, id) => ({ id, p })), method));
    near(ties.results[0].pAdjusted, 0); near(ties.results[3].pAdjusted, 1);
    near(ties.results[1].pAdjusted, ties.results[2].pAdjusted);
  }
});

test('missing p stays missing and conservatively retains its multiplicity-family slot', () => {
  const entries = [{ id: 'a', p: 0.01 }, { id: 'missing', p: null }, { id: 'b', p: 0.04 }];
  const result = adjustPValues(entries, 'holm');
  assert.equal(result.status, 'partial'); assert.equal(result.familySize, 3);
  near(result.results[0].pAdjusted, 0.03); near(result.results[2].pAdjusted, 0.08);
  assert.equal(result.results[1].pAdjusted, null); assert.equal(result.results[1].status, 'unavailable');
  const bh = adjustPValues(entries, 'bh');
  near(bh.results[0].pAdjusted, 0.03); near(bh.results[2].pAdjusted, 0.06);
  assert.equal(adjustPValues([{ id: 'a', p: null }], 'bh').status, 'unavailable');
});

test('bootstrap is deterministic and matches independent cross-language paired/unpaired goldens', () => {
  const a = [2, 7, 4, 9, 1], b = [6, 6, 5, 14, 3];
  for (const [paired, lower, upper] of [[true, 0.4, 4], [false, -1.4, 6.505]]) {
    const options = { paired, seed: 12345, iterations: 500 };
    const result = ok(bootstrapDifference(a, b, options));
    near(result.effect, 2.2); near(result.ci95.lower, lower); near(result.ci95.upper, upper);
    assert.equal(result.seed, 12345); assert.equal(result.iterations, 500);
    assert.equal(result.resamplingUnit, paired ? 'participant_pair' : 'participant');
    assert.deepEqual(bootstrapDifference(a, b, options), result);
    assert.notDeepEqual(bootstrapDifference(a, b, { ...options, seed: 99 }).ci95, result.ci95);
    assert.equal('p' in result, false);
  }
  assert.deepEqual(bootstrapDifference(a, b), bootstrapDifference(a, b, { seed: 0, iterations: 2000, paired: false }));
});

test('paired bootstrap resamples whole participants, invariant to arbitrary participant baseline offsets', () => {
  const a = [1, 3, 8, 4, 12], b = [3, 2, 11, 4, 17], offsets = [1e6, -1000, 100, -100, 2000];
  const options = { paired: true, seed: 1, iterations: 1000 };
  assert.deepEqual(bootstrapDifference(a, b, options), bootstrapDifference(
    a.map((value, i) => value + offsets[i]), b.map((value, i) => value + offsets[i]), options));
  const zero = absent(bootstrapDifference([1, 2, 3], [3, 4, 5], options), 'zero_variation');
  near(zero.effect, 2); assert.deepEqual(zero.ci95, { lower: null, upper: null });
  absent(bootstrapDifference([1, 1], [3, 3]), 'zero_variation');
  ok(bootstrapDifference([1, 1], [2, 3, 4], { paired: false }));
});

test('bootstrap validates seeds, options, minimum Monte Carlo resolution and draw budget', () => {
  for (const seed of [-1, 2 ** 32, 1.1, NaN, '1', null]) absent(bootstrapDifference([1, 2], [3, 5], { seed }), 'invalid_seed', 'invalid');
  for (const iterations of [0, 1, 199, 2001, Infinity, 500.5, '500']) {
    absent(bootstrapDifference([1, 2], [3, 5], { iterations }), 'iteration_limit_200_to_2000', 'invalid');
  }
  for (const options of [null, [], 'x']) absent(bootstrapDifference([1, 2], [3, 5], options), 'invalid_options', 'invalid');
  absent(bootstrapDifference([1, 2], [3, 5], { paired: 1 }), 'invalid_paired_option', 'invalid');
  absent(bootstrapDifference([1, 2], [3, 5], { ignored: true }), 'unknown_option', 'invalid');
  ok(bootstrapDifference([1, 2], [3, 5], { seed: 4294967295, iterations: 200 }));
  const large = Array.from({ length: 1001 }, (_, i) => i);
  absent(bootstrapDifference(large, large, { paired: true }), 'bootstrap_work_limit', 'invalid');
});

test('signal detection applies +0.5 to every cell and matches independent NormalDist goldens', () => {
  const fixtures = [
    [[8, 2, 1, 9], 1.8446621568568151, 0.17447248366510543],
    [[20, 0, 0, 20], 3.961504793294557, 0],
    [[70, 30, 20, 80], 1.3497721944180368, 0.1561723820875559],
    [[0, 20, 20, 0], -3.961504793294557, 0],
    [[4, 6, 2, 8], 0.5179744771840701, 0.48887135617126715],
  ];
  for (const [[hits, misses, falseAlarms, correctRejections], dPrime, criterion] of fixtures) {
    const result = ok(signalDetection({ hits, misses, falseAlarms, correctRejections }));
    near(result.dPrime, dPrime); near(result.criterion, criterion);
    near(result.hitRate, (hits + 0.5) / (hits + misses + 1));
    near(result.falseAlarmRate, (falseAlarms + 0.5) / (falseAlarms + correctRejections + 1));
    assert.equal(result.correctionValue, 0.5); assert.equal(result.correction, 'add_0.5_to_all_four_cells');
  }
  const chance = ok(signalDetection({ hits: 5, misses: 5, falseAlarms: 5, correctRejections: 5 }));
  near(chance.dPrime, 0); near(chance.criterion, 0);
  const extreme = ok(signalDetection({ hits: 499999999, misses: 0, falseAlarms: 0, correctRejections: 499999999 }));
  assert.ok(extreme.dPrime > 11 && extreme.dPrime < 13);
});

test('signal detection rejects missing stimulus classes, noninteger/negative counts and oversized totals', () => {
  const valid = { hits: 8, misses: 2, falseAlarms: 1, correctRejections: 9 };
  for (const invalid of [NaN, Infinity, -1, 1.5, '1', null, undefined, 1000000001]) {
    absent(signalDetection({ ...valid, hits: invalid }), 'invalid_count', 'invalid');
  }
  for (const counts of [{ hits: 1 }, { ...valid, extra: 1 }, {}, { ...valid, falseAlarms: undefined }]) {
    assert.equal(signalDetection(counts).status, 'invalid');
  }
  for (const counts of [null, [], 'x']) absent(signalDetection(counts), 'invalid_counts', 'invalid');
  absent(signalDetection({ hits: 0, misses: 0, falseAlarms: 1, correctRejections: 2 }), 'signal_and_noise_trials_required');
  absent(signalDetection({ hits: 2, misses: 1, falseAlarms: 0, correctRejections: 0 }), 'signal_and_noise_trials_required');
  absent(signalDetection({ hits: 1e9, misses: 1, falseAlarms: 1, correctRejections: 1 }), 'count_limit', 'invalid');
});

test('ICC absolute-agreement single-measurement matches published and rational arithmetic goldens', () => {
  const matrix = [[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]];
  const result = ok(reliability(matrix));
  near(result.icc, 184 / 635); assert.equal(result.nPeople, 6); assert.equal(result.nSessions, 4);
  assert.equal(result.method, 'icc_a1_anova'); assert.equal(result.designation, 'ICC(A,1) / ICC(2,1)');
  assert.equal(result.model, 'two_way_random_effects_absolute_agreement_single_measurement');
  assert.ok(result.warnings.includes('sample_reliability_not_population_or_clinical_validity'));
  const wine = [[1, 2, 0, 1], [1, 3, 3, 2], [3, 8, 1, 4], [6, 4, 3, 3], [6, 5, 5, 6],
    [7, 5, 6, 2], [8, 7, 7, 9], [9, 9, 9, 8]];
  near(ok(reliability(wine)).icc, 318 / 437);
  near(ok(reliability(matrix.slice().reverse().map(row => row.slice().reverse()))).icc, result.icc);
  for (const scale of [1e-150, 1e150, -2]) near(ok(reliability(matrix.map(row => row.map(value => scale * value)))).icc, result.icc);
});

test('ICC penalizes systematic session bias, preserves negative estimates and rejects degeneracy', () => {
  const identical = [[1, 1], [2, 2], [3, 3], [4, 4]];
  near(ok(reliability(identical)).icc, 1);
  const biased = identical.map(([value]) => [value, value + 10]);
  const result = ok(reliability(biased));
  // MSpeople=10/3, MSsession=200, MSerror=0 -> ICC=1/31.
  near(result.icc, 1 / 31); assert.ok(result.icc < 0.1);
  near(ok(pearson(biased.map(row => row[0]), biased.map(row => row[1]))).r, 1);
  near(ok(reliability([[1, 3], [2, 2], [3, 1]])).icc, -3);
  absent(reliability([[1, 1], [1, 1]]), 'zero_variation');
  absent(reliability([[0, 1], [1, 0]]), 'degenerate_icc_denominator');
});

test('all vector APIs reject nonfinite, missing, sparse, coerced and nested observations', () => {
  const consumers = [values => describe(values), values => pairedT(values, [1, 2, 3]),
    values => welchT(values, [1, 2, 3]), values => wilcoxon(values, [1, 2, 3]),
    values => mannWhitney(values, [1, 2, 3]), values => kruskal([values, [1, 2, 3]]),
    values => friedman([values, [1, 2, 3], [2, 3, 4]]), values => pearson(values, [1, 2, 3]),
    values => spearman(values, [1, 2, 3]), values => bootstrapDifference(values, [1, 2, 3]),
    values => reliability([values, [1, 2, 3]])];
  for (const invalid of [NaN, Infinity, -Infinity, null, undefined, '2', true, {}, [2]]) {
    for (const consume of consumers) {
      const result = absent(consume([1, invalid, 3]), 'nonfinite_observation', 'invalid');
      finiteTree(result); assert.equal(JSON.stringify(result).includes('NaN'), false);
    }
  }
  for (const consume of consumers) absent(consume([1, , 3]), 'nonfinite_observation', 'invalid');
  for (const values of [null, '123', {}, new Float64Array([1, 2, 3])]) {
    for (const consume of consumers) assert.equal(consume(values).status, 'invalid');
  }
});

test('mismatched pairs are never truncated, independently filtered or recycled', () => {
  for (const consume of [pairedT, wilcoxon, pearson, spearman,
    (a, b) => bootstrapDifference(a, b, { paired: true })]) {
    absent(consume([1, 2, 3], [1, 3, 5, 8]), 'length_mismatch', 'invalid');
  }
  absent(friedman([[1, 2], [2, 3, 4], [3, 4]]), 'length_mismatch', 'invalid');
  absent(reliability([[1, 2], [2, 3, 4]]), 'unbalanced_matrix', 'invalid');
  ok(welchT([1, 2, 3], [1, 3, 5, 8]));
  ok(mannWhitney([1, 2, 3], [1, 3, 5, 8]));
});

test('insufficient N and malformed matrix/group structures return explicit reasons', () => {
  for (const consume of [pairedT, welchT, wilcoxon, mannWhitney, pearson, spearman, bootstrapDifference]) {
    absent(consume([], []), 'insufficient_n');
    absent(consume([1], [2]), 'insufficient_n');
  }
  for (const consume of [kruskal, friedman]) {
    absent(consume(null), 'expected_groups', 'invalid');
    absent(consume([]), 'insufficient_groups');
    absent(consume([[1, 2], null, [2, 3]]), 'expected_array', 'invalid');
    absent(consume([[1, 2], [], [2, 3]]), 'insufficient_n');
  }
  absent(reliability(null), 'expected_matrix', 'invalid');
  absent(reliability([]), 'insufficient_n');
  absent(reliability([[1, 2]]), 'insufficient_n');
  absent(reliability([[1], [2]]), 'insufficient_sessions');
  absent(reliability([null, [1, 2]]), 'expected_array', 'invalid');
  absent(adjustPValues([], 'holm'), 'insufficient_n');
});

test('multiple-testing input validates methods, IDs, finite probabilities and limits', () => {
  for (const p of [NaN, Infinity, -Infinity, -0.1, 1.01, '0.2', undefined, {}, []]) {
    absent(adjustPValues([{ id: 'x', p }], 'holm'), 'invalid_p', 'invalid');
  }
  for (const id of ['', 'x'.repeat(129), null, {}, [], 1.5, Infinity]) {
    absent(adjustPValues([{ id, p: 0.1 }], 'bh'), 'invalid_id', 'invalid');
  }
  absent(adjustPValues([{ id: 1, p: 0.1 }, { id: 1, p: 0.2 }], 'holm'), 'duplicate_id', 'invalid');
  absent(adjustPValues([null], 'holm'), 'invalid_p_entry', 'invalid');
  absent(adjustPValues([[]], 'holm'), 'invalid_p_entry', 'invalid');
  absent(adjustPValues({}, 'holm'), 'expected_array', 'invalid');
  for (const method of ['unknown', 'BH', null, {}, 'x'.repeat(1000)]) {
    absent(adjustPValues([{ id: 'x', p: 0.2 }], method), 'unknown_adjustment_method', 'invalid');
  }
  absent(adjustPValues(new Array(LIMITS.pValues + 1), 'holm'), 'p_value_limit', 'invalid');
});

test('oversized vectors/groups/cell counts are rejected before scanning huge or sparse inputs', () => {
  const huge = new Array(LIMITS.vectorLength + 1);
  for (const consume of [describe, values => pairedT(values, values), values => welchT(values, values),
    values => wilcoxon(values, values), values => mannWhitney(values, values),
    values => pearson(values, values), values => spearman(values, values),
    values => bootstrapDifference(values, values), reliability]) {
    absent(consume(huge), 'vector_limit', 'invalid');
  }
  for (const consume of [kruskal, friedman]) {
    absent(consume(new Array(33)), 'group_limit', 'invalid');
    const group = Array.from({ length: 7000 }, (_, i) => i);
    absent(consume([group, group, group]), 'total_cell_limit', 'invalid');
  }
  absent(reliability([[1, 2, 3], ...Array.from({ length: 7000 }, () => [1, 2, 3])]), 'total_cell_limit', 'invalid');
  absent(reliability([new Array(33), new Array(33)]), 'session_limit', 'invalid');
});

test('numerical overflow/underflow is explicit unavailable, with no nonfinite serialized output', () => {
  const huge = Number.MAX_VALUE;
  const results = [describe([-huge, huge]), pairedT([-huge, -huge], [huge, huge]),
    welchT([-huge, -huge / 2], [huge / 2, huge]), wilcoxon([-huge, -huge], [huge, huge]),
    bootstrapDifference([-huge, -huge / 2], [huge / 2, huge], { paired: true })];
  for (const result of results) {
    assert.equal(result.status, 'unavailable', JSON.stringify(result));
    assert.match(result.reason, /^numerical_/); finiteTree(result);
    if ('p' in result) assert.equal(result.p, null);
  }
  const underflow = absent(wilcoxon(new Array(5000).fill(0), new Array(5000).fill(1)), 'numerical_underflow', 'partial');
  near(underflow.statistic, 0); near(underflow.effectSize.value, 1);
  const x = Array.from({ length: 10000 }, (_, i) => i % 97);
  const y = x.map((value, i) => value + i % 3 - 1);
  const correlation = absent(pearson(x, y), 'numerical_underflow', 'partial');
  assert.ok(correlation.r > 0.99); finiteTree(correlation);
});

test('public functions never mutate frozen participant arrays, conditions, matrix, entries or options', () => {
  const a = Object.freeze([1, 2, 5, 3]), b = Object.freeze([2, 4, 4, 7]);
  const groups = Object.freeze([a, b, Object.freeze([4, 1, 6, 8])]);
  const entries = Object.freeze([Object.freeze({ id: 'a', p: 0.01 }), Object.freeze({ id: 'b', p: null })]);
  const options = Object.freeze({ paired: true, seed: 0, iterations: 200 });
  const counts = Object.freeze({ hits: 5, misses: 2, falseAlarms: 1, correctRejections: 3 });
  for (const result of [describe(a), pairedT(a, b), welchT(a, b), wilcoxon(a, b), mannWhitney(a, b),
    kruskal(groups), friedman(groups), pearson(a, b), spearman(a, b), reliability(groups),
    adjustPValues(entries, 'holm'), bootstrapDifference(a, b, options), signalDetection(counts)]) {
    assert.notEqual(result.status, 'invalid'); finiteTree(result);
  }
});

test('synthetic 24-participant repeated/independent analyses are finite and respect inference units', () => {
  const a = Array.from({ length: 24 }, (_, i) => 300 + i * 3 + (i % 5) * 7);
  const b = a.map((value, i) => value - 15 + (i % 7) * 4);
  const c = a.map((value, i) => value + 7 - (i % 3) * 5);
  for (const result of [pairedT(a, b), welchT(a, b), wilcoxon(a, b), mannWhitney(a, b),
    kruskal([a, b, c]), friedman([a, b, c]), pearson(a, b), spearman(a, b),
    reliability(a.map((value, i) => [value, b[i], c[i]])),
    bootstrapDifference(a, b, { paired: true, seed: 24, iterations: 2000 })]) {
    ok(result); finiteTree(result);
    if ('nA' in result) assert.equal(result.nA, 24);
    if ('p' in result) assert.ok(result.p >= 0 && result.p <= 1);
  }
});

test('maximum supported workloads and exact-budget boundaries finish in an isolated bounded process', () => {
  const script = `
    const assert = require('node:assert/strict');
    const s = require(${JSON.stringify(require.resolve('../analytics/extended-statistics'))});
    const a = Array.from({length: 10000}, (_, i) => i % 97);
    const b = a.map((v, i) => (i * 7) % 89 + (i % 3) - 1);
    for (const result of [s.describe(a), s.pairedT(a,b), s.welchT(a,b),
      s.pearson(a,b), s.spearman(a,b), s.mannWhitney(a,b), s.wilcoxon(a,b),
      s.reliability(a.map((v,i) => [v,b[i]])),
      s.bootstrapDifference(a.slice(0,1000), b.slice(0,1000), {paired:true}),
      s.friedman([[1,2,3,4,5,6], [2,3,4,5,6,7], [3,4,5,6,7,8]])]) {
      assert.equal(result.status, 'ok', JSON.stringify(result));
    }
    assert.equal(s.bootstrapDifference(a, b).reason, 'bootstrap_work_limit');
    assert.equal(s.adjustPValues(a.map((_, id) => ({id, p:0.1})), 'bh').results.length, 10000);
  `;
  const child = spawnSync(process.execPath, ['-e', script], { timeout: 10000, encoding: 'utf8' });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});
