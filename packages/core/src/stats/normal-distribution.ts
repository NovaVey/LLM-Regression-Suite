/**
 * Numerical approximations to the standard normal distribution's CDF and its
 * inverse (the quantile / probit function), plus the upper-tail p-value for
 * a chi-square statistic with 1 degree of freedom that is derived from it.
 *
 * This is not a statistics library dependency — it is a few closed-form
 * numerical approximations to well-known special functions (erf, probit),
 * hand-written so they can be read and verified line by line, same as the
 * rest of packages/core/src/stats. See docs/DECISIONS.md ("Statistics
 * implemented in-repo, not from a library").
 *
 * It lives in its own file because both mcnemar.ts (needs a chi-square(1)
 * p-value) and mde.ts (needs normal quantiles z_alpha, z_power) reduce to
 * the same underlying normal-distribution math, and duplicating ~40 lines of
 * numerics in two files would be its own source of drift/bugs.
 */

/**
 * Error function erf(x), Abramowitz & Stegun formula 7.1.26.
 * Maximum absolute error 1.5e-7 — more than sufficient precision for
 * p-values and critical z-values used to produce a verdict.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF: Phi(x) = P(Z <= x) for Z ~ N(0, 1). */
export function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Inverse standard normal CDF (probit / quantile function): the z such that
 * P(Z <= z) = p. Peter Acklam's rational approximation; relative error
 * < 1.15e-9 across the full (0, 1) domain, which is standard for this
 * purpose (used e.g. as the basis of many `qnorm` implementations).
 */
export function inverseNormalCDF(p: number): number {
  if (!(p > 0 && p < 1)) {
    throw new Error(`inverseNormalCDF requires p in (0, 1), got ${p}`);
  }

  const a: readonly [number, number, number, number, number, number] = [
    -3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02,
    1.38357751867269e02, -3.066479806614716e01, 2.506628277459239e00,
  ];
  const b: readonly [number, number, number, number, number] = [
    -5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02,
    6.680131188771972e01, -1.328068155288572e01,
  ];
  const c: readonly [number, number, number, number, number, number] = [
    -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00,
    -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00,
  ];
  const d: readonly [number, number, number, number] = [
    7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00,
    3.754408661907416e00,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }

  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/**
 * Upper-tail p-value for a chi-square statistic with 1 degree of freedom:
 * P(X > statistic). Uses the identity that if Z ~ N(0, 1) then Z^2 ~
 * chi-square(1), so P(X > x) = P(|Z| > sqrt(x)) = 2 * (1 - Phi(sqrt(x))).
 * This sidesteps needing a general chi-square/gamma CDF implementation —
 * McNemar's statistic always has exactly 1 degree of freedom (one
 * discordant-pair proportion being tested), so df=1 is the only case
 * this module ever needs.
 */
export function chiSquarePValueDf1(statistic: number): number {
  if (statistic < 0) {
    throw new Error('chi-square statistic cannot be negative');
  }
  if (statistic === 0) {
    return 1;
  }
  return 2 * (1 - normalCDF(Math.sqrt(statistic)));
}
