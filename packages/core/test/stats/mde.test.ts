// Written from spec §5.4 and §6.3, and from the standard closed-form power
// formula for a two-sided one-sample (paired-difference) mean test,
// WITHOUT reading src/stats/mde.ts.
//
// §5.4: "Minimum detectable effect, reported every time... the smallest
// true difference this dataset size could reliably detect. Derive it from
// the observed per-case difference standard deviation and n."
//
// Interface contract (given, not read from src):
//   function minimumDetectableEffect(differenceSD: number, n: number, alpha: number, power: number): number
//
// The standard closed-form MDE for a two-sided test of a mean at
// significance `alpha` and desired `power` is:
//
//   MDE = (z_(1-alpha/2) + z_(power)) * differenceSD / sqrt(n)
//
// where z_(p) is the standard-normal quantile (inverse CDF) at probability
// p. This is the textbook sample-size/effect-size relationship: the test
// rejects when the observed mean exceeds z_(1-alpha/2) standard errors from
// zero, and detecting a true effect of size MDE with the stated power
// requires the true effect to sit z_(power) standard errors past that
// threshold.
//
// ---------------------------------------------------------------------
// AMBIGUITY: `mde-matches-the-effect-size-detected-at-eighty-percent-power`
// ---------------------------------------------------------------------
// §10 lists this test under "Statistics (pure, fast)", but §6.3 describes
// it as validating the reported MDE against the *Phase 6 power-curve
// Monte Carlo simulation* ("If the reported MDE says 5 points but the
// power curve shows 50% detection at 5 points, the MDE formula is wrong"),
// which does not exist yet -- Phase 6 hasn't been built, and the whole
// point of a Monte Carlo power curve is to check the closed-form formula
// against empirical detection rates over repeated simulated trials.
//
// Resolution taken here: rather than silently skip the test or silently
// pick one reading, this file includes a *pure, analytic* version of the
// same claim, independent of both the implementation and of any future
// simulation -- constructed from the same closed-form power theory the
// MDE formula itself rests on (see `analyticPower` below): if
// minimumDetectableEffect(sd, n, alpha, 0.8) truly is "the effect size
// detected at 80% power" under the two-sided z-test model, then plugging
// that returned value back into the analytic power formula must yield
// ~0.80. This is a legitimate, self-contained check of the MDE formula's
// internal consistency and would catch a formula bug (missing the z_power
// term, wrong test sidedness, sqrt(n) vs n, etc.).
//
// It is NOT a substitute for the Phase 6 test: the analytic formula and
// this check share the same normal-approximation model, so this cannot
// catch a case where the *model itself* is a poor fit to how real,
// possibly non-normal paired score differences behave in practice (e.g.
// small-n or heavy-tailed cases where the bootstrap/McNemar detection rate
// diverges from the z-test approximation). That empirical check belongs in
// Phase 6 against the actual power-curve simulation, and should be written
// then, from §6.2/§6.3, against real simulated trials -- not deferred
// silently, but deferred explicitly, here.

import { describe, it, expect } from 'vitest';
import { minimumDetectableEffect } from '../../src/stats/mde.js';

// Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation
// (max absolute error ~1.5e-7) -- ordinary, citable numerical analysis, not
// anything derived from the implementation under test.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function standardNormalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Inverse standard normal CDF via bisection on the CDF above -- generic,
// so the analytic-power check below isn't hard-coded to a single alpha.
function inverseNormalCDF(p: number): number {
  let lo = -10, hi = 10;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (standardNormalCDF(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Sanity-check the helper itself against well-known Phi values before
// relying on it anywhere else in this file.
describe('normal-cdf-helper-matches-well-known-values', () => {
  it('normal-cdf-helper-matches-well-known-values', () => {
    expect(standardNormalCDF(0)).toBeCloseTo(0.5, 6);
    expect(standardNormalCDF(1.959963985)).toBeCloseTo(0.975, 6);
    expect(standardNormalCDF(-1.959963985)).toBeCloseTo(0.025, 6);
    expect(standardNormalCDF(0.8416212336)).toBeCloseTo(0.8, 6);
  });
});

// Standard two-sided critical values, widely tabulated (also verified
// above against the erf-based CDF helper), used to compute expected MDE
// values independently of the implementation:
const Z_975 = 1.9599639845400536; // alpha = 0.05, two-sided
const Z_995 = 2.5758293035488986; // alpha = 0.01, two-sided
const Z_80 = 0.8416212335729141; // power = 0.80
const Z_90 = 1.2815515655446004; // power = 0.90

describe('mde-matches-the-closed-form-power-formula', () => {
  it('mde-matches-the-closed-form-power-formula', () => {
    // MDE = (z_(1-alpha/2) + z_(power)) * sd / sqrt(n)
    //     = (1.9599639845 + 0.8416212336) * 0.25 / sqrt(64)
    //     = 2.8015852181 * 0.25 / 8
    //     = 0.08754953806603025
    const expected = (Z_975 + Z_80) * 0.25 / Math.sqrt(64);
    expect(minimumDetectableEffect(0.25, 64, 0.05, 0.8)).toBeCloseTo(expected, 3);
    expect(minimumDetectableEffect(0.25, 64, 0.05, 0.8)).toBeCloseTo(0.08754953806603025, 3);
  });
});

describe('mde-shrinks-proportionally-to-one-over-sqrt-n', () => {
  it('mde-shrinks-proportionally-to-one-over-sqrt-n', () => {
    // Quadrupling n must exactly halve MDE, since MDE ~ 1/sqrt(n) and
    // sqrt(4) = 2. This is robust to whatever z-value approximation the
    // implementation uses internally, since the same z-values appear in
    // both the numerator and cancel out in the ratio.
    const mde64 = minimumDetectableEffect(0.25, 64, 0.05, 0.8);
    const mde256 = minimumDetectableEffect(0.25, 256, 0.05, 0.8);
    expect(mde256 / mde64).toBeCloseTo(0.5, 3);
  });
});

describe('mde-scales-linearly-with-the-difference-standard-deviation', () => {
  it('mde-scales-linearly-with-the-difference-standard-deviation', () => {
    // Doubling the input SD must exactly double MDE (MDE is linear in sd).
    const mdeAtSd025 = minimumDetectableEffect(0.25, 64, 0.05, 0.8);
    const mdeAtSd050 = minimumDetectableEffect(0.5, 64, 0.05, 0.8);
    expect(mdeAtSd050 / mdeAtSd025).toBeCloseTo(2.0, 3);
  });
});

describe('a-stricter-alpha-requires-a-larger-detectable-effect', () => {
  it('a-stricter-alpha-requires-a-larger-detectable-effect', () => {
    // alpha = 0.01 has a larger critical value (z_0.995 = 2.5758) than
    // alpha = 0.05 (z_0.975 = 1.9600), so, holding sd/n/power fixed, the
    // MDE must be strictly larger -- a stricter significance threshold
    // makes small effects harder to detect, never easier.
    const mdeAt05 = minimumDetectableEffect(0.25, 64, 0.05, 0.8);
    const mdeAt01 = minimumDetectableEffect(0.25, 64, 0.01, 0.8);
    expect(mdeAt01).toBeGreaterThan(mdeAt05);

    const expected01 = (Z_995 + Z_80) * 0.25 / Math.sqrt(64);
    expect(mdeAt01).toBeCloseTo(expected01, 3);
    expect(mdeAt01).toBeCloseTo(0.10679532928505664, 3);
  });
});

describe('demanding-more-power-requires-a-larger-detectable-effect', () => {
  it('demanding-more-power-requires-a-larger-detectable-effect', () => {
    // Requiring 90% power instead of 80% power (holding sd/n/alpha fixed)
    // must strictly increase the reported MDE -- reliably catching a
    // smaller true effect requires more room, not less.
    const mdeAt80 = minimumDetectableEffect(0.25, 64, 0.05, 0.8);
    const mdeAt90 = minimumDetectableEffect(0.25, 64, 0.05, 0.9);
    expect(mdeAt90).toBeGreaterThan(mdeAt80);

    const expected90 = (Z_975 + Z_90) * 0.25 / Math.sqrt(64);
    expect(mdeAt90).toBeCloseTo(expected90, 3);
    expect(mdeAt90).toBeCloseTo(0.10129736094014544, 3);
  });
});

describe('mde-matches-the-effect-size-detected-at-eighty-percent-power', () => {
  it('mde-matches-the-effect-size-detected-at-eighty-percent-power', () => {
    // See the file-level ambiguity note: this is the pure-analytic version
    // of the §6.3 claim, constructed independently of both the
    // implementation and the (not-yet-built) Phase 6 simulation.
    //
    // Analytic power of a two-sided z-test of size alpha, at sample size
    // n, for a true effect `delta` against noise sd `sigma`:
    //   power(delta) = Phi(delta*sqrt(n)/sigma - z_(1-alpha/2))
    //                + Phi(-delta*sqrt(n)/sigma - z_(1-alpha/2))
    // (the second term is the vanishingly small probability of rejecting
    // in the wrong direction; included for correctness, not because it
    // matters numerically here).
    function analyticPower(delta: number, sigma: number, n: number, alpha: number): number {
      const zAlpha = inverseNormalCDF(1 - alpha / 2);
      const ncp = (delta * Math.sqrt(n)) / sigma;
      return standardNormalCDF(ncp - zAlpha) + standardNormalCDF(-ncp - zAlpha);
    }

    // Case 1: sigma=0.25, n=64, alpha=0.05, power=0.8 (same case as above).
    const sigma1 = 0.25, n1 = 64, alpha1 = 0.05, power1 = 0.8;
    const mde1 = minimumDetectableEffect(sigma1, n1, alpha1, power1);
    expect(analyticPower(mde1, sigma1, n1, alpha1)).toBeCloseTo(0.8, 2);

    // Case 2: a different sd/n combination, to rule out the first case
    // passing by coincidence of the particular numbers chosen.
    const sigma2 = 0.3, n2 = 150, alpha2 = 0.05, power2 = 0.8;
    const mde2 = minimumDetectableEffect(sigma2, n2, alpha2, power2);
    expect(analyticPower(mde2, sigma2, n2, alpha2)).toBeCloseTo(0.8, 2);
  });
});
