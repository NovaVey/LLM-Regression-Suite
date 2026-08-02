/**
 * Minimum detectable effect (MDE) for a paired comparison. See §5.4 of the
 * spec: "the smallest true difference this dataset size could reliably
 * detect," derived from the observed per-case difference standard deviation
 * and n.
 *
 * FORMULA AND WHERE IT COMES FROM:
 *
 * The comparison is a one-sample test on the vector of per-case differences
 * d_i (§5.1 — pairing turns a two-sample problem into a one-sample one). The
 * standard error of the mean difference is SD / sqrt(n). The minimum true
 * effect that a two-sided test at significance `alpha` can detect with
 * probability `power`, at that standard error, is the classic power-
 * analysis result:
 *
 *   MDE = (z_(alpha/2) + z_power) * SD / sqrt(n)
 *
 * where z_(alpha/2) is the two-sided critical value (e.g. 1.96 for
 * alpha=0.05) and z_power is the one-sided quantile for the desired power
 * (e.g. 0.84 for power=0.8). This is the same formula used to size a
 * one-sample (or paired) t-test in most experimentation/power-analysis
 * tools; it is *not* the two-independent-samples formula (which would carry
 * an extra sqrt(2) and use pooled variance across two arms) — there is only
 * one sample here, the differences, because pairing already removed the
 * second arm's variance.
 *
 * ASSUMPTIONS:
 *
 * 1. Uses the normal approximation (z-scores from `inverseNormalCDF`), not
 *    the exact t-distribution. This slightly *understates* the true MDE at
 *    small n (a t critical value is larger than the corresponding z for
 *    small degrees of freedom, so the true required effect is a little
 *    bigger than what this formula reports). The gap shrinks fast and is
 *    under ~1% by n=60; below roughly n=30 treat the reported MDE as an
 *    optimistic (too-small) estimate. Implementing an exact t-quantile
 *    function requires inverting the incomplete beta function, which is
 *    real added complexity for a correction that matters least exactly
 *    where this tool is meant to run (§11 targets a 240-case example
 *    suite). See docs/DECISIONS.md.
 * 2. `differenceSD` is the *sample* standard deviation of the observed
 *    per-case differences, computed by the caller from the same vector fed
 *    to `bootstrapCI`. This function does not compute it — it takes SD and
 *    n as already-known summary statistics, per the pure-function, no-I/O
 *    contract.
 * 3. This estimates the MDE for a two-sided test at the given `alpha`,
 *    matching the two-sided percentile bootstrap CI used elsewhere in this
 *    module (§5.2) — an effect this large in *either* direction would be
 *    detected at the stated power, not just a regression.
 * 4. It must be validated against the Phase 6 power curve (§6.3): if the
 *    reported MDE doesn't match the effect size actually detected at ~80%
 *    power on simulated data, the formula (or an assumption above) is
 *    wrong. That validation is Phase 6's job, not this file's, but this
 *    file exists to make that check possible.
 */

import { inverseNormalCDF } from './normal-distribution.js';

/**
 * Returns the minimum true effect (in the same units as `differenceSD`)
 * that a paired comparison with this per-case difference SD and n could
 * detect with the given `power`, at two-sided significance `alpha`.
 */
export function minimumDetectableEffect(
  differenceSD: number,
  n: number,
  alpha: number,
  power: number,
): number {
  if (!Number.isFinite(differenceSD) || differenceSD < 0) {
    throw new Error(`minimumDetectableEffect requires differenceSD >= 0, got ${differenceSD}`);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`minimumDetectableEffect requires n >= 1, got ${n}`);
  }
  if (!(alpha > 0 && alpha < 1)) {
    throw new Error(`minimumDetectableEffect requires alpha in (0, 1), got ${alpha}`);
  }
  if (!(power > 0 && power < 1)) {
    throw new Error(`minimumDetectableEffect requires power in (0, 1), got ${power}`);
  }

  if (differenceSD === 0) {
    // No variance in the observed differences at all: any nonzero true
    // effect would be detected with certainty, so the MDE is 0.
    return 0;
  }

  const zAlpha = inverseNormalCDF(1 - alpha / 2); // two-sided critical value
  const zPower = inverseNormalCDF(power); // one-sided power quantile
  const standardError = differenceSD / Math.sqrt(n);

  return (zAlpha + zPower) * standardError;
}
