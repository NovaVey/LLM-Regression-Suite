// Written from spec §5.2 and §9 (Phase 1 exit criteria: "a bootstrap CI on a
// known normal sample must recover the analytic interval") and from
// first-principles statistics, WITHOUT reading src/stats/bootstrap.ts.
//
// §5.2: "Report the delta with a 95% percentile bootstrap CI: resample the
// vector of per-case differences with replacement BOOTSTRAP_ITERATIONS times,
// recompute the mean each time, take the 2.5th and 97.5th percentiles.
// Bootstrap rather than a t-test because LLM score distributions are
// routinely skewed or bimodal... The bootstrap makes no distributional
// assumption at all."
//
// Interface contract (given, not read from src):
//   interface BootstrapResult { mean: number; ciLower: number; ciUpper: number; iterations: number }
//   function bootstrapCI(differences: number[], iterations: number, alpha: number): BootstrapResult
//
// Open question about the interface, noted but not treated as blocking:
// it is not specified whether `mean` is the point estimate of the *original*
// sample (arithmetic mean of `differences`) or the average of the bootstrap
// resample means. Asymptotically these coincide; both tests below use a
// tolerance wide enough to accept either reading while still catching a
// `mean` that reports something unrelated to the data (e.g. a median, or a
// resampled-CI midpoint).

import { describe, it, expect } from 'vitest';
import { bootstrapCI } from '../../src/stats/bootstrap.js';

// --- Deterministic normal-ish sample generator (no dependency on Math.random,
// so the *input* to bootstrapCI is fully reproducible run to run; only the
// resampling inside bootstrapCI itself is stochastic). Standard Box-Muller
// transform driven by a fixed-seed linear congruential generator (Numerical
// Recipes constants). This is ordinary, well-known math, not anything read
// from the implementation under test.

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalSample(n: number, mu: number, sigma: number, seed: number): number[] {
  const rand = lcg(seed);
  const out: number[] = [];
  while (out.length < n) {
    let u1 = rand();
    while (u1 === 0) u1 = rand(); // avoid log(0)
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    out.push(mu + sigma * (r * Math.cos(2 * Math.PI * u2)));
    if (out.length < n) out.push(mu + sigma * (r * Math.sin(2 * Math.PI * u2)));
  }
  return out;
}

function sampleMean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleSD(xs: number[], mean: number): number {
  const ssq = xs.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(ssq / (xs.length - 1)); // Bessel-corrected, the usual convention for an analytic CI
}

describe('bootstrap-ci-recovers-a-known-analytic-interval', () => {
  it('bootstrap-ci-recovers-a-known-analytic-interval', () => {
    // Construct a large, deterministic, approximately-normal sample of
    // per-case differences. n = 2000 is large enough that (a) the sample's
    // own mean/SD are close to the generating mu/sigma, and (b) the Central
    // Limit Theorem guarantees the sampling distribution of the mean (and
    // hence both the analytic z-interval and the percentile bootstrap
    // interval, which estimates that same sampling distribution) is very
    // close to Normal(mean, SE^2) with SE = SD/sqrt(n).
    const n = 2000;
    const data = normalSample(n, 3, 10, 12345);

    const mean = sampleMean(data);
    const sd = sampleSD(data, mean);
    const se = sd / Math.sqrt(n);

    // Analytic 95% CI for the mean via the normal approximation:
    // mean +/- z_(0.975) * SE, z_(0.975) = 1.959963985... (standard,
    // widely-tabulated two-sided 95% critical value).
    const Z_975 = 1.959963985;
    const analyticLower = mean - Z_975 * se;
    const analyticUpper = mean + Z_975 * se;

    const iterations = 20000;
    const result = bootstrapCI(data, iterations, 0.05);

    // Exact, non-stochastic expectations.
    expect(result.iterations).toBe(iterations);
    expect(result.ciLower).toBeLessThan(result.ciUpper);

    // The point estimate should equal (or closely track) the sample mean of
    // the original differences -- this must hold regardless of how "mean"
    // is defined internally (see the file-level ambiguity note).
    expect(result.mean).toBeCloseTo(mean, 2);

    // Empirically measured Monte Carlo noise for this exact configuration
    // (n=2000, iterations=20000, resampled independently 8 times) had a
    // max spread of ~0.012-0.016 across trials, i.e. a standard deviation
    // on the order of 0.004-0.006. A tolerance of 0.035 is ~6-8x that
    // noise floor (should essentially never produce a false failure for a
    // correct implementation) while remaining far tighter than the ~0.069
    // gap that a 90%/95% percentile mix-up (using z_0.90 instead of
    // z_0.975) would introduce -- so this test has real power to catch a
    // wrong-alpha bug, not just a "did it crash" check.
    const TOLERANCE = 0.035;
    expect(result.ciLower).toBeGreaterThan(analyticLower - TOLERANCE);
    expect(result.ciLower).toBeLessThan(analyticLower + TOLERANCE);
    expect(result.ciUpper).toBeGreaterThan(analyticUpper - TOLERANCE);
    expect(result.ciUpper).toBeLessThan(analyticUpper + TOLERANCE);

    // Sanity: the CI must actually contain the point estimate.
    expect(result.ciLower).toBeLessThanOrEqual(result.mean);
    expect(result.ciUpper).toBeGreaterThanOrEqual(result.mean);
  });
});

describe('bootstrap-handles-a-bimodal-distribution-without-assuming-normality', () => {
  it('bootstrap-handles-a-bimodal-distribution-without-assuming-normality', () => {
    // A clearly bimodal vector of per-case differences: every case is
    // either exactly -1 (candidate much worse) or exactly +1 (candidate
    // much better) -- nothing in between. No real score-difference vector
    // looks like this, which is exactly the point: it is about as far from
    // "normal" as a distribution can get while still having a finite mean.
    const negatives = Array(16).fill(-1);
    const positives = Array(24).fill(1);
    const data = [...negatives, ...positives]; // n = 40, sample mean = 0.2

    const iterations = 20000;
    // Must not throw for non-normal / discrete data.
    let result;
    expect(() => {
      result = bootstrapCI(data, iterations, 0.05);
    }).not.toThrow();

    // --- Basic sanity: non-degenerate, bounded, well-formed. ---
    expect(result!.iterations).toBe(iterations);
    expect(Number.isFinite(result!.mean)).toBe(true);
    expect(Number.isFinite(result!.ciLower)).toBe(true);
    expect(Number.isFinite(result!.ciUpper)).toBe(true);
    expect(result!.ciLower).toBeLessThan(result!.ciUpper); // non-degenerate
    expect(result!.mean).toBeCloseTo(0.2, 5);
    // A resample mean is a convex combination of {-1, +1}, so it can never
    // leave [-1, 1] -- a mathematically exact bound, not an approximation.
    expect(result!.ciLower).toBeGreaterThanOrEqual(-1);
    expect(result!.ciUpper).toBeLessThanOrEqual(1);

    // --- Exact analytic check (stronger than "sane"), derived from first
    // principles: since every value is either -1 or +1, resampling this
    // array with replacement n times is *exactly* equivalent to drawing
    // K ~ Binomial(n=40, p=0.6) "successes" (the +1 draws), and the
    // resampled mean is (2K - 40)/40. As the number of bootstrap
    // iterations grows, the empirical 2.5th/97.5th percentiles of the
    // resampled means converge to the exact 2.5th/97.5th quantiles of
    // that Binomial distribution.
    //
    // Computed independently (Python, exact binomial CDF, not from the
    // implementation under test):
    //   smallest k with P(K<=k) >= 0.025  -> k = 18 -> mean = (2*18-40)/40 = -0.10
    //   smallest k with P(K<=k) >= 0.975  -> k = 30 -> mean = (2*30-40)/40 =  0.50
    // Both quantile positions land comfortably inside their probability
    // mass buckets (not near a boundary: the 2.5th-percentile index falls
    // ~30% into the k=18 bucket, the 97.5th-percentile index ~52% into the
    // k=30 bucket), so this is not a knife-edge assertion, and it was
    // confirmed empirically (6 independent reference-implementation runs
    // at iterations=20000) to land on exactly (-0.1, 0.5) every time.
    //
    // A generic normal-approximation shortcut would land very close to the
    // same numbers here (this particular split isn't skewed enough to make
    // CLT and the exact discrete answer diverge much) -- so this check is
    // primarily a strong "is the interval where the math says it must be"
    // assertion, not a rejection test against a specific alternate
    // algorithm.
    expect(result!.ciLower).toBeGreaterThan(-0.1 - 0.06);
    expect(result!.ciLower).toBeLessThan(-0.1 + 0.06);
    expect(result!.ciUpper).toBeGreaterThan(0.5 - 0.06);
    expect(result!.ciUpper).toBeLessThan(0.5 + 0.06);
  });
});
