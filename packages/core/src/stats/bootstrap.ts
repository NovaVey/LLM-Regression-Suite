/**
 * Percentile bootstrap confidence interval for the mean of a vector of
 * paired per-case differences. See §5.2 of the spec.
 *
 * ASSUMPTIONS (state these anywhere this function's output is surfaced):
 *
 * 1. Exchangeability of cases. Resampling with replacement treats every
 *    difference d_i as interchangeable with every other d_i — the procedure
 *    is only valid if there is no structure (ordering, grouping, drift over
 *    the run) that makes cases non-exchangeable. If, say, later cases in a
 *    run systematically score lower because of a rate-limit-induced timeout
 *    pattern, or cases are secretly correlated because several came from the
 *    same underlying conversation, the bootstrap's implicit i.i.d. sampling
 *    assumption is violated and the interval will be too narrow — it won't
 *    know to widen for correlation it can't see.
 * 2. No distributional assumption on the differences themselves. This is
 *    the whole reason to bootstrap instead of a t-test: judge scores pile
 *    up at the top of a bounded scale, pass/fail differences are literally
 *    trinary (-1, 0, +1), and none of that is close to normal. The bootstrap
 *    only assumes the *sample* of differences is a reasonable stand-in for
 *    the population of differences you'd see across all possible cases.
 * 3. The percentile method (as opposed to BCa or the bootstrap-t) is biased
 *    for small n or strongly skewed differences — it under-covers the true
 *    interval in those regimes. It is standard, simple to verify by hand,
 *    and adequate at the sample sizes this tool targets (tens to hundreds of
 *    paired cases per §11's 240-case example suite), but it is not the most
 *    accurate bootstrap variant that exists. Flagged in docs/DECISIONS.md.
 * 4. Resampling is with replacement, at the case level, one draw per
 *    original case per iteration (the standard nonparametric bootstrap) —
 *    each bootstrap sample has the same size n as the input.
 */

export interface BootstrapResult {
  /** Point estimate: mean of the input differences (not a bootstrap mean). */
  mean: number;
  /** Lower percentile bound (e.g. 2.5th for alpha=0.05). */
  ciLower: number;
  /** Upper percentile bound (e.g. 97.5th for alpha=0.05). */
  ciUpper: number;
  iterations: number;
}

/**
 * Linear-interpolation percentile over an already-sorted array (the same
 * convention numpy's default `percentile` uses). `p` is in [0, 1].
 */
function percentile(sortedValues: number[], p: number): number {
  const n = sortedValues.length;
  if (n === 1) {
    return sortedValues[0] as number;
  }
  const rank = p * (n - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lowerValue = sortedValues[lowerIndex] as number;
  if (lowerIndex === upperIndex) {
    return lowerValue;
  }
  const upperValue = sortedValues[upperIndex] as number;
  const weight = rank - lowerIndex;
  return lowerValue * (1 - weight) + upperValue * weight;
}

/**
 * Resample `differences` with replacement `iterations` times, recompute the
 * mean each time, and return the mean of the observed data plus the
 * [alpha/2, 1 - alpha/2] percentiles of the bootstrap distribution of means
 * as the confidence interval.
 *
 * Never compute two independent means and subtract — `differences` must
 * already be the per-case paired differences d_i = candidate_i - baseline_i
 * (§5.1). This function has no way to check that; it trusts the caller.
 */
export function bootstrapCI(
  differences: number[],
  iterations: number,
  alpha: number,
): BootstrapResult {
  const n = differences.length;
  if (n === 0) {
    throw new Error('bootstrapCI requires at least one difference (n=0 given)');
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`bootstrapCI requires iterations >= 1, got ${iterations}`);
  }
  if (!(alpha > 0 && alpha < 1)) {
    throw new Error(`bootstrapCI requires alpha in (0, 1), got ${alpha}`);
  }

  let sum = 0;
  for (const d of differences) {
    sum += d;
  }
  const mean = sum / n;

  const bootstrapMeans = new Array<number>(iterations);
  for (let i = 0; i < iterations; i++) {
    let resampledSum = 0;
    for (let j = 0; j < n; j++) {
      // Draw one case index uniformly at random, with replacement.
      const idx = Math.floor(Math.random() * n);
      resampledSum += differences[idx] as number;
    }
    bootstrapMeans[i] = resampledSum / n;
  }

  bootstrapMeans.sort((a, b) => a - b);

  const ciLower = percentile(bootstrapMeans, alpha / 2);
  const ciUpper = percentile(bootstrapMeans, 1 - alpha / 2);

  return { mean, ciLower, ciUpper, iterations };
}
