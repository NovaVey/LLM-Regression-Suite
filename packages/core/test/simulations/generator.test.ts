// Written from `.claude/commands/build-llm-regression-suite.md` §6 and the
// Phase 6 interface contract (phase6-contract.md, "File 1: generator.ts"),
// WITHOUT reading src/simulations/generator.ts (implemented concurrently by
// a different agent -- same discipline as every previous phase's
// test-author work in this repo).
//
// Contract recap:
//   interface CaseGeneratorParams { n; basePassRate; effectSize;
//     caseDifficultySpread; seed }
//   function generateSyntheticPairedCases(params): PairedCase[]
//
//   p_i = clamp(basePassRate + caseDifficultySpread * u_i, 0, 1), u_i ~ Uniform(-1, 1)
//   baseline_i  ~ Bernoulli(p_i)
//   candidate_i ~ Bernoulli(clamp(p_i - effectSize, 0, 1))
//   critical is false on every case, unconditionally.
//   Validate n >= 1, basePassRate in (0,1), caseDifficultySpread in [0,1) --
//   throw on violation. effectSize is NOT range-restricted (the clamp makes
//   any value safe).
//
// FIRST-PRINCIPLES DERIVATION used below (not read from any implementation):
// marginalizing over p_i, Cov(baseline_i, candidate_i) = Var(p_i) when
// effectSize = 0 and no clamping occurs (baseline_i and candidate_i are
// conditionally independent Bernoulli(p_i) draws given p_i, so
// E[baseline*candidate] = E[p_i^2], and Cov = E[p_i^2] - E[p_i]^2 =
// Var(p_i)). With u_i ~ Uniform(-1,1), Var(u_i) = 1/3, so
// Var(p_i) = caseDifficultySpread^2 / 3. This is the formal statement of the
// contract's own reasoning ("this is what gives paired analysis something
// real to cancel out") and is directly testable: baseline and candidate
// scores must be positively correlated when caseDifficultySpread > 0, and
// must NOT be correlated (up to sampling noise) when caseDifficultySpread
// is exactly 0, since then every case shares the identical p_i and the two
// sides are independent coin flips of the same fixed-probability coin.

import { describe, it, expect } from 'vitest';
import { generateSyntheticPairedCases } from '../../src/simulations/generator.js';

describe('every-generated-case-is-marked-non-critical', () => {
  it('every-generated-case-is-marked-non-critical', () => {
    // §6.1's null model and §6.2's power curve both depend on this: a
    // critical case regressing forces verdict: 'regression' regardless of
    // the CI (§5.6), which would inflate the observed rate in a way that
    // has nothing to do with whether the bootstrap CI mechanism itself
    // manufactures regressions from noise. If even one generated case is
    // critical, every downstream statistical simulation is measuring the
    // wrong thing.
    const cases = generateSyntheticPairedCases({
      n: 500,
      basePassRate: 0.5,
      effectSize: 0.1,
      caseDifficultySpread: 0.4,
      seed: 1,
    });
    expect(cases.length).toBe(500);
    for (const c of cases) {
      expect(c.critical).toBe(false);
    }
  });
});

describe('the-generator-is-deterministic-for-a-fixed-seed', () => {
  it('the-generator-is-deterministic-for-a-fixed-seed', () => {
    const params = { n: 200, basePassRate: 0.6, effectSize: 0.05, caseDifficultySpread: 0.3, seed: 12345 };
    const first = generateSyntheticPairedCases(params);
    const second = generateSyntheticPairedCases(params);
    expect(second).toEqual(first);
  });

  it('is deterministic across several distinct seeds, not just one', () => {
    // Guards against an implementation that is stable for one seed by
    // coincidence (e.g. it ignores the seed and reads some other ambient
    // source of "randomness") but isn't actually seeded per-call.
    for (const seed of [1, 2, 3, 999, 424242]) {
      const params = { n: 50, basePassRate: 0.4, effectSize: 0, caseDifficultySpread: 0.2, seed };
      const first = generateSyntheticPairedCases(params);
      const second = generateSyntheticPairedCases(params);
      expect(second).toEqual(first);
    }
  });

  it('two different seeds produce different data (the seed is actually consumed)', () => {
    const a = generateSyntheticPairedCases({ n: 100, basePassRate: 0.5, effectSize: 0, caseDifficultySpread: 0.4, seed: 1 });
    const b = generateSyntheticPairedCases({ n: 100, basePassRate: 0.5, effectSize: 0, caseDifficultySpread: 0.4, seed: 2 });
    expect(b).not.toEqual(a);
  });
});

describe('n-below-one-throws-instead-of-generating-a-bogus-dataset', () => {
  it('throws for n = 0', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: 0, basePassRate: 0.5, effectSize: 0, caseDifficultySpread: 0.2, seed: 1 }),
    ).toThrow();
  });

  it('throws for a negative n', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: -5, basePassRate: 0.5, effectSize: 0, caseDifficultySpread: 0.2, seed: 1 }),
    ).toThrow();
  });

  it('n = 1 is the valid boundary and does not throw', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: 1, basePassRate: 0.5, effectSize: 0, caseDifficultySpread: 0.2, seed: 1 }),
    ).not.toThrow();
  });
});

describe('a-base-pass-rate-outside-the-open-unit-interval-throws', () => {
  it('throws for basePassRate = 0', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: 10, basePassRate: 0, effectSize: 0, caseDifficultySpread: 0.2, seed: 1 }),
    ).toThrow();
  });

  it('throws for basePassRate = 1', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: 10, basePassRate: 1, effectSize: 0, caseDifficultySpread: 0.2, seed: 1 }),
    ).toThrow();
  });

  it('throws for a negative basePassRate', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: 10, basePassRate: -0.2, effectSize: 0, caseDifficultySpread: 0.2, seed: 1 }),
    ).toThrow();
  });

  it('throws for basePassRate > 1', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: 10, basePassRate: 1.5, effectSize: 0, caseDifficultySpread: 0.2, seed: 1 }),
    ).toThrow();
  });
});

describe('a-case-difficulty-spread-outside-zero-one-throws', () => {
  it('throws for a negative caseDifficultySpread', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: 10, basePassRate: 0.5, effectSize: 0, caseDifficultySpread: -0.1, seed: 1 }),
    ).toThrow();
  });

  it('throws for caseDifficultySpread = 1 (half-open upper bound)', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: 10, basePassRate: 0.5, effectSize: 0, caseDifficultySpread: 1, seed: 1 }),
    ).toThrow();
  });

  it('caseDifficultySpread = 0 is the valid lower boundary and does not throw', () => {
    expect(() =>
      generateSyntheticPairedCases({ n: 10, basePassRate: 0.5, effectSize: 0, caseDifficultySpread: 0, seed: 1 }),
    ).not.toThrow();
  });
});

describe('binary-score-and-pass-fail-flag-never-disagree', () => {
  it('binary-score-and-pass-fail-flag-never-disagree', () => {
    const cases = generateSyntheticPairedCases({
      n: 300,
      basePassRate: 0.5,
      effectSize: 0.2,
      caseDifficultySpread: 0.5,
      seed: 7,
    });
    for (const c of cases) {
      expect(c.baselineScore === 1 || c.baselineScore === 0).toBe(true);
      expect(c.candidateScore === 1 || c.candidateScore === 0).toBe(true);
      expect(c.baselinePassed).toBe(c.baselineScore === 1);
      expect(c.candidatePassed).toBe(c.candidateScore === 1);
    }
  });
});

describe('difference-always-equals-candidate-score-minus-baseline-score', () => {
  it('difference-always-equals-candidate-score-minus-baseline-score', () => {
    // §5.1's contract: d_i = candidate_i - baseline_i. Getting the sign
    // backwards here silently flips the direction of every regression this
    // whole phase claims to detect.
    const cases = generateSyntheticPairedCases({
      n: 300,
      basePassRate: 0.5,
      effectSize: 0.2,
      caseDifficultySpread: 0.5,
      seed: 8,
    });
    for (const c of cases) {
      expect(c.difference).toBe(c.candidateScore - c.baselineScore);
    }
  });
});

describe('an-effect-size-that-would-push-probability-out-of-bounds-is-clamped-not-rejected', () => {
  it('a huge positive effectSize clamps the candidate probability to 0: candidate never passes', () => {
    // effectSize = 10 means clamp(p_i - 10, 0, 1) = 0 for every possible
    // p_i in [0,1], so candidatePassed must be false for every case, and
    // the call must not throw (effectSize is explicitly not range-checked
    // per the contract -- the clamp is what makes it safe).
    let cases: ReturnType<typeof generateSyntheticPairedCases> = [];
    expect(() => {
      cases = generateSyntheticPairedCases({
        n: 200,
        basePassRate: 0.5,
        effectSize: 10,
        caseDifficultySpread: 0.4,
        seed: 3,
      });
    }).not.toThrow();
    expect(cases.length).toBe(200);
    for (const c of cases) {
      expect(c.candidatePassed).toBe(false);
      expect(c.candidateScore).toBe(0);
    }
  });

  it('a huge negative effectSize clamps the candidate probability to 1: candidate always passes', () => {
    let cases: ReturnType<typeof generateSyntheticPairedCases> = [];
    expect(() => {
      cases = generateSyntheticPairedCases({
        n: 200,
        basePassRate: 0.5,
        effectSize: -10,
        caseDifficultySpread: 0.4,
        seed: 4,
      });
    }).not.toThrow();
    expect(cases.length).toBe(200);
    for (const c of cases) {
      expect(c.candidatePassed).toBe(true);
      expect(c.candidateScore).toBe(1);
    }
  });
});

// --- Covariance structure: the load-bearing design decision (see file header) ---

function sampleCovariance(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (xs[i]! - meanX) * (ys[i]! - meanY);
  }
  return sum / (n - 1);
}

describe('shared-case-difficulty-makes-baseline-and-candidate-scores-positively-correlated', () => {
  it('shared-case-difficulty-makes-baseline-and-candidate-scores-positively-correlated', () => {
    // Analytic expectation at effectSize = 0, no clamping triggered
    // (basePassRate = 0.5, caseDifficultySpread = 0.3 keeps p_i in
        // [0.2, 0.8], comfortably inside (0,1)):
    //   Cov(baseline, candidate) = Var(p_i) = spread^2 / 3 = 0.09 / 3 = 0.03
    // A large n keeps Monte Carlo noise on the sample covariance small
    // relative to that 0.03 target, so a threshold well below 0.03 still
    // has real power to catch a generator that draws baseline_i and
    // candidate_i from *independent* per-side difficulties (which the
    // contract explicitly says would make pairing-benefit.ts a
    // non-demonstration) -- that bug would drive the sample covariance to
    // ~0, not just shrink it.
    const cases = generateSyntheticPairedCases({
      n: 8000,
      basePassRate: 0.5,
      effectSize: 0,
      caseDifficultySpread: 0.3,
      seed: 99,
    });
    const cov = sampleCovariance(
      cases.map((c) => c.baselineScore),
      cases.map((c) => c.candidateScore),
    );
    expect(cov).toBeGreaterThan(0.01); // well below the ~0.03 analytic target, comfortably above 0
  });
});

describe('zero-difficulty-spread-leaves-baseline-and-candidate-scores-uncorrelated', () => {
  it('zero-difficulty-spread-leaves-baseline-and-candidate-scores-uncorrelated', () => {
    // Contrast case: with caseDifficultySpread = 0, every case shares the
    // exact same p_i = basePassRate, so Var(p_i) = 0 and the analytic
    // covariance target is exactly 0 -- baseline_i and candidate_i are then
    // independent Bernoulli(basePassRate) draws with nothing shared to
    // correlate. Sample covariance should be small in magnitude (bounded by
    // ordinary Monte Carlo noise), not the ~0.03 seen with spread = 0.3
    // above.
    const cases = generateSyntheticPairedCases({
      n: 8000,
      basePassRate: 0.5,
      effectSize: 0,
      caseDifficultySpread: 0,
      seed: 100,
    });
    const cov = sampleCovariance(
      cases.map((c) => c.baselineScore),
      cases.map((c) => c.candidateScore),
    );
    expect(Math.abs(cov)).toBeLessThan(0.01);
  });
});
