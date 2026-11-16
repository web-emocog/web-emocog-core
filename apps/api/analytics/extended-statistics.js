'use strict';

/*
 * Participant-level statistics, not trial/frame-level inference. Callers must
 * establish independent people, disjoint independent groups, aligned pairs,
 * comparable sessions and a prespecified analysis/multiplicity family. These
 * arrays cannot establish independence, missingness mechanisms or validity.
 * No automatic normality testing or test selection is performed.
 *
 * All exports return { status, reason, method, ... }. Status is ok, partial
 * (some descriptive fields available), unavailable, or invalid. Missing results
 * are null, never NaN/Infinity. Nonfinite/missing observations invalidate the
 * whole input: exclusions must be explicit upstream, never independently filtered.
 * Tests are two-sided, except omnibus right-tail tests. Differences and signed
 * effect sizes are B - A. Rank ties use exact JS equality, with no hidden rounding.
 *
 * describe: sample SD, unscaled MAD, type-7 interpolated quantiles; CV requires
 * a positive mean and a meaningful ratio scale (the latter is caller-owned).
 * adjustPValues: { results: [{ id, p, pAdjusted, status, reason }], familySize }.
 * Null p values stay null and count in the family (as unobserved p=1).
 * bootstrapDifference: percentile mean-difference CI, not a hypothesis test.
 * reliability: balanced complete people x sessions; ICC(A,1) = ICC(2,1),
 * two-way random-effects absolute agreement, single measurement, ANOVA estimate.
 * Negative ICC estimates are retained; no clinical/population validity claims.
 *
 * References (formulae/independent fixtures, not runtime dependencies):
 * https://docs.scipy.org/doc/scipy/reference/stats.html
 * https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html
 * Shrout & Fleiss (1979), doi:10.1037/0033-2909.86.2.420
 * Hautus (1995), doi:10.3758/BF03203619 (loglinear +0.5 to every cell).
 */

const LIMITS = Object.freeze({
  vectorLength: 10000,
  totalCells: 20000,
  groups: 32,
  exactStates: 50000,
  exactWork: 2000000,
  signedRankExactN: 50,
  bootstrapIterations: 2000,
  bootstrapDraws: 2000000,
  pValues: 10000,
  signalDetectionCount: 1000000000,
});
const EPS = 2e-14;
const MAX_STEPS = 1000;
const TINY = 1e-300;

class StatisticsError extends Error {
  constructor(reason, status = 'unavailable') {
    super(reason);
    this.reason = reason;
    this.status = status;
  }
}
const fail = (reason, status) => { throw new StatisticsError(reason, status); };
const check = (condition, reason, status) => { if (!condition) fail(reason, status); };
const finite = value => {
  check(Number.isFinite(value), 'numerical_range');
  return value;
};
function probability(value) {
  finite(value);
  check(value >= -EPS && value <= 1 + EPS, 'numerical_probability_bounds');
  return Math.max(0, Math.min(1, value));
}
function positiveExp(logValue) {
  const value = Math.exp(finite(logValue));
  check(value > 0, 'numerical_underflow');
  return finite(value);
}
function run(base, calculate) {
  try {
    return { ...base, status: 'ok', reason: null, ...calculate() };
  } catch (error) {
    if (!(error instanceof StatisticsError)) throw error;
    return { ...base, status: error.status, reason: error.reason };
  }
}
function withP(result, pMethod, calculate) {
  try {
    return { ...result, p: calculate(), pMethod };
  } catch (error) {
    if (!(error instanceof StatisticsError)) throw error;
    return { ...result, status: 'partial', reason: error.reason, p: null, pMethod: 'unavailable' };
  }
}
function vector(values, minimum = 1) {
  check(Array.isArray(values), 'expected_array', 'invalid');
  check(values.length <= LIMITS.vectorLength, 'vector_limit', 'invalid');
  // Do not use every(): sparse arrays must not bypass validation.
  for (let i = 0; i < values.length; i++) {
    check(typeof values[i] === 'number' && Number.isFinite(values[i]), 'nonfinite_observation', 'invalid');
  }
  check(values.length >= minimum, 'insufficient_n');
}
function pair(a, b, minimum = 2, paired = true) {
  vector(a, minimum);
  vector(b, minimum);
  if (paired) check(a.length === b.length, 'length_mismatch', 'invalid');
}
function groupInput(groups, minimumGroups, repeated = false) {
  check(Array.isArray(groups), 'expected_groups', 'invalid');
  check(groups.length <= LIMITS.groups, 'group_limit', 'invalid');
  check(groups.length >= minimumGroups, 'insufficient_groups');
  let total = 0;
  for (let i = 0; i < groups.length; i++) {
    check(Array.isArray(groups[i]), 'expected_array', 'invalid');
    total += groups[i].length;
    check(total <= LIMITS.totalCells, 'total_cell_limit', 'invalid');
    vector(groups[i], repeated ? 2 : 1);
    if (repeated) check(groups[i].length === groups[0].length, 'length_mismatch', 'invalid');
  }
  return total;
}
function sum(values) {
  let total = 0, correction = 0;
  for (const value of values) {
    const next = total + value;
    correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return finite(total + correction);
}
const mean = values => sum(values) / values.length;
const maxAbs = values => values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
function observationMean(values) {
  // Sum original observations with compensation, not centered reconstructions:
  // [-1e200, 1e200, 1e-200] has a small nonzero mean, not zero.
  try {
    const total = sum(values), result = total / values.length;
    check(result !== 0 || total === 0, 'numerical_underflow');
    return result;
  } catch (error) {
    if (!(error instanceof StatisticsError) || error.reason !== 'numerical_range') throw error;
  }
  const divided = values.map(value => value / values.length);
  try {
    const result = sum(divided);
    check(result !== 0 || values.every((value, i) => value === 0 || divided[i] !== 0), 'numerical_underflow');
    return result;
  } catch (error) {
    if (!(error instanceof StatisticsError) || error.reason !== 'numerical_range') throw error;
  }
  const scale = maxAbs(values);
  return finite(scale * mean(values.map(value => value / scale)));
}

// Center before scaling to preserve variation around large offsets. If raw
// subtraction overflows, first scale the original values into [-1, 1].
function centered(values) {
  const origin = values[0];
  const differences = values.map(value => value - origin);
  if (differences.some(value => !Number.isFinite(value))) {
    const scale = maxAbs(values);
    return { origin: 0, scale, z: values.map(value => value / scale) };
  }
  const scale = maxAbs(differences);
  return { origin, scale, z: differences.map(value => scale ? value / scale : 0) };
}
function moments(values) {
  const { scale, z } = centered(values);
  const mz = mean(z);
  const deviations = z.map(value => value - mz);
  const sdZ = values.length > 1 ? Math.sqrt(sum(deviations.map(value => value * value)) / (values.length - 1)) : null;
  const sd = sdZ === null ? null : finite(scale * sdZ);
  check(sdZ === null || sdZ === 0 || sd > 0, 'numerical_underflow');
  return { mean: observationMean(values), sd };
}
function quantile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index), high = Math.ceil(index), weight = index - low;
  if (low === high) return sorted[low];
  // Weighted endpoints avoid overflowing high-low for opposite finite extremes.
  return finite((1 - weight) * sorted[low] + weight * sorted[high]);
}
const count = values => Array.isArray(values) && values.length <= LIMITS.vectorLength ? values.length : null;
const interval = () => ({ lower: null, upper: null });
const inferBase = method => ({ method, statistic: null, df: null, p: null, pMethod: 'unavailable' });
const comparisonBase = (method, a, b, effectMethod) => ({
  ...inferBase(method), nA: count(a), nB: count(b), effect: null, ci95: interval(),
  effectSize: { value: null, method: effectMethod },
});

function describe(numbers) {
  const base = { method: 'sample_sd_raw_mad_type7', n: count(numbers), mean: null,
    median: null, sd: null, mad: null, cvPct: null, p10: null, p90: null,
    p95: null, min: null, max: null, fieldReasons: {} };
  return run(base, () => {
    vector(numbers);
    const sorted = numbers.slice().sort((a, b) => a - b);
    const stats = moments(numbers);
    const median = quantile(sorted, 0.5);
    const deviations = numbers.map(value => finite(Math.abs(value - median))).sort((a, b) => a - b);
    const fieldReasons = {};
    if (numbers.length < 2) fieldReasons.sd = 'insufficient_n';
    if (stats.sd === null) fieldReasons.cvPct = 'insufficient_n';
    else if (stats.mean <= 0) fieldReasons.cvPct = 'cv_requires_positive_mean';
    const cvPct = fieldReasons.cvPct ? null : finite(100 * (stats.sd / stats.mean));
    return { ...stats, median, mad: quantile(deviations, 0.5), cvPct,
      p10: quantile(sorted, 0.1), p90: quantile(sorted, 0.9), p95: quantile(sorted, 0.95),
      min: sorted[0], max: sorted[sorted.length - 1], fieldReasons,
      status: Object.keys(fieldReasons).length ? 'partial' : 'ok',
      reason: Object.keys(fieldReasons).length ? 'some_descriptives_unavailable' : null };
  });
}

// Lanczos log-Gamma; regularized beta and gamma use bounded convergent series
// / modified Lentz continued fractions. A failed convergence is never a p=0.
function logGamma(x) {
  const coefficients = [676.5203681218851, -1259.1392167224028,
    771.3234287776531, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  check(x > 0 && Number.isFinite(x), 'numerical_domain');
  if (x < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = 0.9999999999998099;
  for (let i = 0; i < coefficients.length; i++) a += coefficients[i] / (z + i + 1);
  const t = z + 7.5;
  return finite(0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(a));
}
const nonzero = value => Math.abs(value) < TINY ? (value < 0 ? -TINY : TINY) : value;
function betaFraction(a, b, x) {
  let c = 1, d = 1 / nonzero(1 - (a + b) * x / (a + 1)), h = d;
  for (let m = 1; m <= MAX_STEPS; m++) {
    let aa = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 / nonzero(1 + aa * d); c = nonzero(1 + aa / c); h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 / nonzero(1 + aa * d); c = nonzero(1 + aa / c);
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) <= EPS) return finite(h);
  }
  fail('numerical_nonconvergence');
}
function betaI(x, a, b) {
  check(x >= 0 && x <= 1 && a > 0 && b > 0, 'numerical_domain');
  if (x === 0 || x === 1) return x;
  if (x > (a + 1) / (a + b + 2)) return probability(1 - betaI(1 - x, b, a));
  const logFront = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  return probability(positiveExp(logFront + Math.log(betaFraction(a, b, x) / a)));
}
function gammaQ(a, x) {
  check(a > 0 && x >= 0 && Number.isFinite(x), 'numerical_domain');
  if (x === 0) return 1;
  const logFront = a * Math.log(x) - x - logGamma(a);
  if (x < a + 1) {
    let term = 1 / a, total = term;
    for (let i = 1; i <= MAX_STEPS; i++) {
      term *= x / (a + i); total += term;
      if (Math.abs(term) <= Math.abs(total) * EPS) return probability(1 - positiveExp(logFront + Math.log(total)));
    }
  } else {
    let b = x + 1 - a, c = 1 / TINY, d = 1 / nonzero(b), h = d;
    for (let i = 1; i <= MAX_STEPS; i++) {
      const an = -i * (i - a);
      b += 2; d = 1 / nonzero(an * d + b); c = nonzero(b + an / c);
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) <= EPS) return probability(positiveExp(logFront + Math.log(h)));
    }
  }
  fail('numerical_nonconvergence');
}
function tTwoSided(t, df) {
  finite(t);
  const ratio = Math.abs(t) / Math.sqrt(df);
  const x = 1 / (1 + ratio * ratio);
  check(x > 0, 'numerical_underflow');
  return betaI(x, df / 2, 0.5);
}
function tCritical95(df) {
  let low = 0, high = 1;
  for (let i = 0; i < 32 && tTwoSided(high, df) > 0.05; i++) high *= 2;
  check(tTwoSided(high, df) <= 0.05, 'numerical_quantile_bracket');
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (tTwoSided(mid, df) > 0.05) low = mid; else high = mid;
    if (high - low <= EPS * Math.max(1, high)) return (low + high) / 2;
  }
  fail('numerical_nonconvergence');
}
const normalTwoSided = z => gammaQ(0.5, finite(z * z / 2));
function tResult(effect, se, df, effectSize) {
  check(se > 0, 'zero_variation');
  const statistic = finite(effect / se);
  const margin = finite(tCritical95(df) * se);
  return withP({ effect, statistic, df,
    ci95: { lower: finite(effect - margin), upper: finite(effect + margin) }, effectSize },
  'student_t', () => tTwoSided(statistic, df));
}
function pairedT(a, b) {
  return run(comparisonBase('paired_t', a, b, 'cohen_dz'), () => {
    pair(a, b);
    const differences = b.map((value, i) => finite(value - a[i]));
    const stats = moments(differences);
    if (stats.sd === 0) return { effect: stats.mean, status: 'unavailable', reason: 'zero_difference_variation' };
    return { ...tResult(stats.mean, stats.sd / Math.sqrt(a.length), a.length - 1,
      { value: finite(stats.mean / stats.sd), method: 'cohen_dz' }),
    assumptions: ['independent_participants', 'aligned_pairs', 'approximately_normal_differences_for_small_n'] };
  });
}
function welchT(a, b) {
  return run(comparisonBase('welch_t', a, b, 'cohen_d_pooled_sd'), () => {
    pair(a, b, 2, false);
    const left = moments(a), right = moments(b);
    const effect = finite(right.mean - left.mean);
    const scale = Math.max(left.sd, right.sd);
    if (scale === 0) return { effect, status: 'unavailable', reason: 'zero_variation' };
    const va = (left.sd / scale) ** 2 / a.length, vb = (right.sd / scale) ** 2 / b.length;
    const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
    const pooled = scale * Math.sqrt(((a.length - 1) * (left.sd / scale) ** 2
      + (b.length - 1) * (right.sd / scale) ** 2) / (a.length + b.length - 2));
    return { ...tResult(effect, finite(scale * Math.sqrt(va + vb)), df,
      { value: finite(effect / pooled), method: 'cohen_d_pooled_sd' }),
    assumptions: ['independent_disjoint_participant_groups', 'approximately_normal_means'],
    warnings: ['pooled_sd_effect_size_does_not_assume_equal_variance_for_welch_test'] };
  });
}

function ranks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array(values.length);
  let tieSum = 0;
  for (let i = 0; i < order.length;) {
    let j = i + 1;
    while (j < order.length && order[j].value === order[i].value) j++;
    const rank = (i + 1 + j) / 2, size = j - i;
    if (size > 1) tieSum += size ** 3 - size;
    for (let k = i; k < j; k++) result[order[k].index] = rank;
    i = j;
  }
  return { values: result, tieSum, hasTies: tieSum > 0 };
}
function wilcoxon(a, b) {
  return run({ ...comparisonBase('wilcoxon_signed_rank', a, b, 'matched_rank_biserial'),
    nEffective: null, nZero: null, zeroMethod: 'wilcox_drop_exact_zeros' }, () => {
    pair(a, b);
    const differences = b.map((value, i) => finite(value - a[i]));
    const nonzeroDifferences = differences.filter(value => value !== 0);
    const n = nonzeroDifferences.length;
    if (n === 0) return { status: 'unavailable', reason: 'all_zero_differences', nEffective: 0, nZero: a.length };
    const ranked = ranks(nonzeroDifferences.map(Math.abs));
    const total = sum(ranked.values);
    const plus = sum(ranked.values.map((rank, i) => nonzeroDifferences[i] > 0 ? rank : 0));
    const statistic = Math.min(plus, total - plus);
    const common = { statistic, nEffective: n, nZero: a.length - n, hasTies: ranked.hasTies,
      effectSize: { value: (2 * plus - total) / total, method: 'matched_rank_biserial' },
      assumptions: ['independent_participants', 'aligned_pairs', 'symmetric_difference_distribution'],
      warnings: ['difference_ties_use_exact_machine_equality'] };
    let p, pMethod;
    if (n <= LIMITS.signedRankExactN) {
      const weights = ranked.values.map(rank => 2 * rank);
      const distribution = new Float64Array(2 * total + 1);
      distribution[0] = 1;
      let end = 0;
      for (const weight of weights) {
        for (let j = end + weight; j >= 0; j--) {
          distribution[j] = ((j <= end ? distribution[j] : 0) + (j >= weight ? distribution[j - weight] : 0)) / 2;
        }
        end += weight;
      }
      // Two identical inclusive tails overlap at the center.
      p = probability(Math.min(1, 2 * sum(Array.from(distribution.subarray(0, 2 * statistic + 1)))));
      pMethod = 'exact_conditional_sign_permutation';
    } else {
      const variance = sum(ranked.values.map(rank => rank * rank)) / 4;
      return withP(common, 'normal_tie_corrected_continuity_approximation',
        () => normalTwoSided(Math.max(0, Math.abs(plus - total / 2) - 0.5) / Math.sqrt(variance)));
    }
    return { ...common, p, pMethod };
  });
}
function combinationsCount(n, k) {
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result *= (n - k + i) / i;
    if (result > LIMITS.exactStates) return Infinity;
  }
  return Math.round(result);
}
function combinations(n, k, visit, start = 0, chosen = []) {
  if (chosen.length === k) { visit(chosen); return; }
  for (let i = start; i <= n - (k - chosen.length); i++) {
    chosen.push(i); combinations(n, k, visit, i + 1, chosen); chosen.pop();
  }
}
function permutations(values, visit, index = 0) {
  if (index === values.length) { visit(values); return; }
  for (let i = index; i < values.length; i++) {
    [values[index], values[i]] = [values[i], values[index]];
    permutations(values, visit, index + 1);
    [values[index], values[i]] = [values[i], values[index]];
  }
}
function mannWhitney(a, b) {
  return run(comparisonBase('mann_whitney_u', a, b, 'rank_biserial_b_minus_a'), () => {
    pair(a, b, 2, false);
    const n = a.length + b.length, product = a.length * b.length;
    const ranked = ranks(a.concat(b));
    const statistic = sum(ranked.values.slice(0, a.length)) - a.length * (a.length + 1) / 2;
    check(ranked.tieSum < n ** 3 - n, 'zero_variation');
    const common = { statistic, hasTies: ranked.hasTies,
      effectSize: { value: 1 - 2 * statistic / product, method: 'rank_biserial_b_minus_a' },
      assumptions: ['independent_disjoint_participant_groups', 'exchangeability_under_distributional_null'],
      warnings: ['distribution_test_not_automatically_a_median_test'] };
    const k = Math.min(a.length, b.length), states = combinationsCount(n, k);
    if (states <= LIMITS.exactStates && states * k <= LIMITS.exactWork) {
      const observed = sum(ranked.values.slice(a.length <= b.length ? 0 : a.length, a.length <= b.length ? a.length : n));
      let lower = 0, upper = 0;
      combinations(n, k, indices => {
        const value = sum(indices.map(i => ranked.values[i]));
        if (value <= observed) lower++;
        if (value >= observed) upper++;
      });
      return { ...common, p: Math.min(1, 2 * Math.min(lower, upper) / states),
        pMethod: 'exact_conditional_label_permutation_equal_tails', permutationStates: states };
    }
    if (k < 10) return { ...common, status: 'partial', reason: 'small_n_exact_budget_exceeded' };
    const variance = product / 12 * (n + 1 - ranked.tieSum / (n * (n - 1)));
    const z = Math.max(0, Math.abs(statistic - product / 2) - 0.5) / Math.sqrt(variance);
    return withP(common, 'normal_tie_corrected_continuity_approximation', () => normalTwoSided(z));
  });
}
function kruskal(groups) {
  return run({ ...inferBase('kruskal_wallis'), nGroups: null, n: null }, () => {
    const n = groupInput(groups, 2);
    const ranked = ranks(groups.flat());
    const correction = 1 - ranked.tieSum / (n ** 3 - n);
    check(correction > 0, 'zero_variation');
    let offset = 0;
    const terms = groups.map(group => {
      const rankSum = sum(ranked.values.slice(offset, offset + group.length));
      offset += group.length;
      return group.length * (rankSum / group.length - (n + 1) / 2) ** 2;
    });
    const statistic = 12 * sum(terms) / (n * (n + 1) * correction);
    const common = { n, nGroups: groups.length, ns: groups.map(group => group.length),
      statistic, df: groups.length - 1, hasTies: ranked.hasTies,
      assumptions: ['independent_disjoint_participant_groups'],
      warnings: ['omnibus_distribution_test_no_post_hoc_or_median_claim'] };
    if (groups.some(group => group.length < 5)) {
      return { ...common, status: 'partial', reason: 'insufficient_n_for_chi_square_approximation' };
    }
    return withP(common, 'chi_square_tie_corrected_approximation', () => gammaQ(common.df / 2, statistic / 2));
  });
}
function friedman(groups) {
  return run({ ...inferBase('friedman'), n: null, nConditions: null, kendallW: null }, () => {
    groupInput(groups, 3, true);
    const k = groups.length, n = groups[0].length, blocks = [], totals = new Array(k).fill(0);
    let tieSum = 0;
    for (let i = 0; i < n; i++) {
      const ranked = ranks(groups.map(group => group[i]));
      tieSum += ranked.tieSum;
      blocks.push(ranked.values);
      ranked.values.forEach((value, j) => { totals[j] += value; });
    }
    const correction = 1 - tieSum / (n * (k ** 3 - k));
    check(correction > 0, 'zero_within_participant_variation');
    const rankDispersion = values => sum(values.map(value => (value - n * (k + 1) / 2) ** 2));
    const observed = rankDispersion(totals);
    const statistic = 12 * observed / (n * k * (k + 1) * correction);
    const common = { n, nConditions: k, statistic, df: k - 1, kendallW: statistic / (n * (k - 1)),
      hasTies: tieSum > 0, assumptions: ['independent_participants', 'aligned_condition_positions', 'exchangeable_conditions_under_null'] };
    let factorial = 1;
    for (let i = 2; i <= k && factorial <= LIMITS.exactStates; i++) factorial *= i;
    const states = factorial ** n;
    if (states <= LIMITS.exactStates && states * n * k <= LIMITS.exactWork) {
      const running = new Array(k).fill(0);
      let extreme = 0;
      const enumerate = block => {
        if (block === n) { if (rankDispersion(running) >= observed) extreme++; return; }
        permutations(blocks[block].slice(), permutation => {
          permutation.forEach((value, j) => { running[j] += value; });
          enumerate(block + 1);
          permutation.forEach((value, j) => { running[j] -= value; });
        });
      };
      enumerate(0);
      return { ...common, p: extreme / states, pMethod: 'exact_within_participant_label_permutation', permutationStates: states };
    }
    if (n < 5) return { ...common, status: 'partial', reason: 'small_n_exact_budget_exceeded' };
    return withP({ ...common,
      warnings: n <= 10 || k <= 6 ? ['small_sample_or_few_conditions_chi_square_may_be_inaccurate'] : [] },
    'chi_square_tie_corrected_approximation', () => gammaQ((k - 1) / 2, statistic / 2));
  });
}

function correlation(x, y) {
  const a = centered(x), b = centered(y);
  check(a.scale > 0 && b.scale > 0, 'zero_variation');
  if (a.z.every((value, i) => value === b.z[i])) return 1;
  if (a.z.every((value, i) => value === -b.z[i])) return -1;
  const ma = mean(a.z), mb = mean(b.z);
  const dx = a.z.map(value => value - ma), dy = b.z.map(value => value - mb);
  const sx = Math.sqrt(sum(dx.map(value => value * value)));
  const sy = Math.sqrt(sum(dy.map(value => value * value)));
  check(sx > 0 && sy > 0, 'zero_variation');
  const r = sum(dx.map((value, i) => value / sx * (dy[i] / sy)));
  check(Math.abs(r) <= 1 + EPS, 'numerical_correlation_bounds');
  return Math.max(-1, Math.min(1, r));
}
function pearson(x, y) {
  return run({ ...inferBase('pearson'), n: count(x), r: null }, () => {
    pair(x, y);
    const r = correlation(x, y), n = x.length;
    const common = { r, statistic: r, df: n - 2,
      assumptions: ['independent_participant_pairs', 'bivariate_normal_null_for_p'] };
    if (n < 3) return { ...common, status: 'partial', reason: 'insufficient_n_for_inference' };
    return withP(common, 'exact_bivariate_normal_null',
      () => Math.abs(r) === 1 ? 0 : tTwoSided(r / Math.sqrt((1 - r * r) / (n - 2)), n - 2));
  });
}
function spearman(x, y) {
  return run({ ...inferBase('spearman'), n: count(x), rho: null }, () => {
    pair(x, y, 3);
    const a = ranks(x), b = ranks(y), n = x.length;
    const rho = correlation(a.values, b.values);
    const common = { rho, statistic: rho, df: n - 2, hasTies: a.hasTies || b.hasTies,
      assumptions: ['independent_participant_pairs', 'exchangeable_pairings_under_null'] };
    if (n <= 8) {
      // Ranks and their norms are fixed under permutation; avoid repeated sorts.
      const center = (n + 1) / 2;
      const dx = a.values.map(value => value - center), dy = b.values.map(value => value - center);
      const observed = Math.abs(sum(dx.map((value, i) => value * dy[i])));
      let extreme = 0, total = 0;
      permutations(dy, permutation => {
        const cross = Math.abs(sum(dx.map((value, i) => value * permutation[i])));
        if (cross >= observed) extreme++;
        total++;
      });
      return { ...common, p: extreme / total, pMethod: 'exact_pairing_permutation_absolute_rho', permutationStates: total };
    }
    if (n < 10) return { ...common, status: 'partial', reason: 'small_n_exact_budget_exceeded' };
    // Perfect rank alignment still has a nonzero exact permutation p. Do not
    // manufacture zero from an infinite asymptotic t statistic.
    if (Math.abs(rho) >= 1 - EPS) return { ...common, status: 'partial', reason: 'perfect_rank_correlation_requires_exact_p' };
    return withP({ ...common, warnings: n <= 500 ? ['small_sample_rank_approximation_permutation_preferred'] : [] },
      'student_t_rank_approximation', () => tTwoSided(rho / Math.sqrt((1 - rho * rho) / (n - 2)), n - 2));
  });
}

function adjustPValues(entries, method) {
  return run({ method: typeof method === 'string' && method.length <= 32 ? method : null,
    familySize: null, results: [] }, () => {
    check(['holm', 'bh', 'bonferroni'].includes(method), 'unknown_adjustment_method', 'invalid');
    check(Array.isArray(entries), 'expected_array', 'invalid');
    check(entries.length <= LIMITS.pValues, 'p_value_limit', 'invalid');
    check(entries.length > 0, 'insufficient_n');
    const ids = new Set();
    for (const entry of entries) {
      check(entry && typeof entry === 'object' && !Array.isArray(entry), 'invalid_p_entry', 'invalid');
      check((typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 128)
        || Number.isSafeInteger(entry.id), 'invalid_id', 'invalid');
      check(!ids.has(entry.id), 'duplicate_id', 'invalid'); ids.add(entry.id);
      check(entry.p === null || (typeof entry.p === 'number' && Number.isFinite(entry.p) && entry.p >= 0 && entry.p <= 1), 'invalid_p', 'invalid');
    }
    const m = entries.length;
    const sorted = entries.map((entry, index) => ({ id: entry.id, p: entry.p, index, sortP: entry.p === null ? 1 : entry.p }))
      .sort((a, b) => a.sortP - b.sortP || a.index - b.index);
    const adjusted = new Array(m);
    let running = method === 'bh' ? 1 : 0;
    for (let step = 0; step < m; step++) {
      const i = method === 'bh' ? m - step - 1 : step;
      const row = sorted[i];
      if (method === 'bh') running = Math.min(running, row.sortP * m / (i + 1));
      else if (method === 'holm') running = Math.max(running, row.sortP * (m - i));
      else running = row.sortP * m;
      adjusted[row.index] = row.p === null ? null : Math.min(1, running);
    }
    const missing = entries.filter(entry => entry.p === null).length;
    return { familySize: m, results: entries.map((entry, i) => ({ id: entry.id, p: entry.p, pAdjusted: adjusted[i],
      status: entry.p === null ? 'unavailable' : 'ok', reason: entry.p === null ? 'p_unavailable' : null })),
    status: missing === m ? 'unavailable' : missing ? 'partial' : 'ok',
    reason: missing ? 'unavailable_p_values_retained_in_family' : null,
    assumptions: method === 'bh' ? ['prespecified_family', 'independent_or_positive_dependence_for_fdr_control'] : ['prespecified_family'] };
  });
}
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function resampledMean(values, random) {
  const sample = new Array(values.length);
  for (let i = 0; i < values.length; i++) sample[i] = values[Math.floor(random() * values.length)];
  return observationMean(sample);
}
function bootstrapDifference(a, b, options = {}) {
  return run({ method: 'percentile_mean_difference_bootstrap', nA: count(a), nB: count(b),
    effect: null, ci95: interval(), seed: null, iterations: null, resamplingUnit: null, prng: 'mulberry32_v1' }, () => {
    check(options && typeof options === 'object' && !Array.isArray(options), 'invalid_options', 'invalid');
    check(Object.keys(options).length <= 3 && Object.keys(options).every(key => ['paired', 'seed', 'iterations'].includes(key)), 'unknown_option', 'invalid');
    const { paired = false, seed = 0, iterations = 2000 } = options;
    check(typeof paired === 'boolean', 'invalid_paired_option', 'invalid');
    check(Number.isInteger(seed) && seed >= 0 && seed <= 4294967295, 'invalid_seed', 'invalid');
    check(Number.isInteger(iterations) && iterations >= 200 && iterations <= LIMITS.bootstrapIterations, 'iteration_limit_200_to_2000', 'invalid');
    pair(a, b, 2, paired);
    check(iterations * (paired ? a.length : a.length + b.length) <= LIMITS.bootstrapDraws, 'bootstrap_work_limit', 'invalid');
    const left = paired ? b.map((value, i) => finite(value - a[i])) : a;
    const lm = moments(left), rm = paired ? null : moments(b);
    const effect = paired ? lm.mean : finite(rm.mean - lm.mean);
    const common = { effect, seed, iterations, resamplingUnit: paired ? 'participant_pair' : 'participant', paired,
      warnings: ['percentile_interval_not_bca_or_a_hypothesis_test', 'independent_participants_and_representative_sampling_assumed'] };
    if (lm.sd === 0 && (paired || rm.sd === 0)) return { ...common, status: 'unavailable', reason: 'zero_variation' };
    const random = seededRandom(seed);
    const draws = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
      const ma = resampledMean(left, random);
      draws[i] = paired ? ma : finite(resampledMean(b, random) - ma);
    }
    draws.sort((x, y) => x - y);
    if (draws[0] === draws[draws.length - 1]) return { ...common, status: 'unavailable', reason: 'degenerate_bootstrap_distribution' };
    return { ...common, ci95: { lower: quantile(draws, 0.025), upper: quantile(draws, 0.975) } };
  });
}

function inverseNormal(p) {
  check(p > 0 && p < 1, 'numerical_domain');
  if (p === 0.5) return 0;
  const tail = p < 0.5 ? p : 1 - p;
  let low = 0, high = 10;
  check(normalTwoSided(high) / 2 < tail, 'numerical_quantile_bracket');
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (normalTwoSided(mid) / 2 > tail) low = mid; else high = mid;
    if (high - low <= EPS * Math.max(1, high)) return (p < 0.5 ? -1 : 1) * (low + high) / 2;
  }
  fail('numerical_nonconvergence');
}
function signalDetection(counts) {
  return run({ method: 'equal_variance_gaussian_sdt_loglinear', correction: 'add_0.5_to_all_four_cells',
    correctionValue: 0.5, dPrime: null, criterion: null, hitRate: null, falseAlarmRate: null }, () => {
    check(counts && typeof counts === 'object' && !Array.isArray(counts), 'invalid_counts', 'invalid');
    const keys = ['hits', 'misses', 'falseAlarms', 'correctRejections'];
    check(Object.keys(counts).length === 4 && Object.keys(counts).every(key => keys.includes(key)), 'invalid_count_fields', 'invalid');
    const values = keys.map(key => counts[key]);
    check(values.every(value => Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.signalDetectionCount), 'invalid_count', 'invalid');
    check(sum(values) <= LIMITS.signalDetectionCount, 'count_limit', 'invalid');
    const signals = counts.hits + counts.misses, noises = counts.falseAlarms + counts.correctRejections;
    check(signals > 0 && noises > 0, 'signal_and_noise_trials_required');
    const hitRate = (counts.hits + 0.5) / (signals + 1);
    const falseAlarmRate = (counts.falseAlarms + 0.5) / (noises + 1);
    const zh = inverseNormal(hitRate), zf = inverseNormal(falseAlarmRate);
    return { dPrime: finite(zh - zf), criterion: finite(-(zh + zf) / 2), hitRate, falseAlarmRate,
      warnings: ['descriptive_sdt_estimate_not_participant_level_inference_or_validation'] };
  });
}
function reliability(matrix) {
  return run({ method: 'icc_a1_anova', model: 'two_way_random_effects_absolute_agreement_single_measurement',
    designation: 'ICC(A,1) / ICC(2,1)', icc: null, nPeople: count(matrix), nSessions: null,
    warnings: ['complete_balanced_comparable_sessions_required', 'random_session_model_is_an_assumption',
      'sample_reliability_not_population_or_clinical_validity', 'no_confidence_interval_computed'] }, () => {
    check(Array.isArray(matrix), 'expected_matrix', 'invalid');
    check(matrix.length <= LIMITS.vectorLength, 'vector_limit', 'invalid');
    check(matrix.length >= 2, 'insufficient_n');
    check(Array.isArray(matrix[0]), 'expected_array', 'invalid');
    const n = matrix.length, k = matrix[0].length;
    check(k <= LIMITS.groups, 'session_limit', 'invalid');
    check(k >= 2, 'insufficient_sessions');
    check(n * k <= LIMITS.totalCells, 'total_cell_limit', 'invalid');
    for (const row of matrix) {
      check(Array.isArray(row) && row.length === k, 'unbalanced_matrix', 'invalid');
      vector(row, 2);
    }
    const prepared = centered(matrix.flat());
    check(prepared.scale > 0, 'zero_variation');
    const rows = Array.from({ length: n }, (_, i) => prepared.z.slice(i * k, (i + 1) * k));
    const rowMeans = rows.map(mean), grand = mean(rowMeans);
    const colMeans = Array.from({ length: k }, (_, j) => mean(rows.map(row => row[j])));
    const msPeople = k * sum(rowMeans.map(value => (value - grand) ** 2)) / (n - 1);
    const msSessions = n * sum(colMeans.map(value => (value - grand) ** 2)) / (k - 1);
    const msError = sum(rows.map((row, i) => sum(row.map((value, j) => (value - rowMeans[i] - colMeans[j] + grand) ** 2)))) / ((n - 1) * (k - 1));
    const denominator = msPeople + (k - 1) * msError + k * (msSessions - msError) / n;
    check(denominator > EPS * Math.max(msPeople, msError, msSessions), 'degenerate_icc_denominator');
    const icc = finite((msPeople - msError) / denominator);
    check(icc <= 1 + EPS, 'numerical_icc_bounds');
    return { icc: Math.min(1, icc), nPeople: n, nSessions: k };
  });
}

module.exports = { describe, pairedT, welchT, wilcoxon, mannWhitney, kruskal,
  friedman, pearson, spearman, adjustPValues, bootstrapDifference, signalDetection,
  reliability, LIMITS };
