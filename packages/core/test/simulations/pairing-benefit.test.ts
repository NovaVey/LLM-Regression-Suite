// Written from `.claude/commands/build-llm-regression-suite.md` §6.5 and
// §5.1, and the Phase 6 interface contract (phase6-contract.md, "File 5:
// pairing-benefit.ts"), WITHOUT reading src/simulations/pairing-benefit.ts.
//
// §6.5, verbatim: "Run the same injected regression through paired and
// unpaired analysis at the same n. The paired version detects it; the
// unpaired version often does not. One chart, and it justifies §5.1 to
// anyone who asks why this is more complex than comparing two averages."
//
// Contract recap:
//   Paired: the real computeComparison on generateSyntheticPairedCases
//   output. Detected = verdict === 'regression'.
//   Unpaired: treat baseline/candidate scores as two INDEPENDENT samples --
//   percentile bootstrap on candidateMean - baselineMean using two
//   independently-resampled groups. Detected = CI upper bound < 0.
//
// Parameters (n, effectSize, caseDifficultySpread) were chosen and checked
// for a robust gap against a scratch reference implementation of this exact
// contract before being fixed here (see the test-author's report). The
// case-difficulty-heavy setting is deliberate and load-bearing: per
// generator.ts's own design rationale (see generator.test.ts), pairing has
// nothing real to cancel out when caseDifficultySpread is 0 -- the
// demonstration this test encodes only exists when case difficulty varies
// enough that between-case variance dominates the per-case Bernoulli noise.

import { describe, it, expect } from 'vitest';
import { runPairingBenefitSimulation } from '../../src/simulations/pairing-benefit.js';

describe('paired-analysis-detects-more-than-unpaired-analysis-at-the-same-n', () => {
  it('paired-analysis-detects-more-than-unpaired-analysis-at-the-same-n', () => {
    const result = runPairingBenefitSimulation({
      n: 100,
      effectSize: 0.15,
      basePassRate: 0.5,
      caseDifficultySpread: 0.95, // heavy per-case difficulty variance -- see file header
      trials: 300,
      alpha: 0.05,
      bootstrapIterations: 400,
      seed: 55,
    });

    expect(result.n).toBe(100);
    expect(result.effectSize).toBe(0.15);
    expect(result.trials).toBe(300);
    expect(result.pairedDetectionRate).toBeGreaterThanOrEqual(0);
    expect(result.pairedDetectionRate).toBeLessThanOrEqual(1);
    expect(result.unpairedDetectionRate).toBeGreaterThanOrEqual(0);
    expect(result.unpairedDetectionRate).toBeLessThanOrEqual(1);

    // The core §6.5 claim: pairing detects the injected regression more
    // often than unpaired analysis at the identical n, with a real margin
    // (not just barely ahead, which could be noise) -- this is what
    // justifies §5.1's added complexity over "compare two averages."
    expect(result.pairedDetectionRate).toBeGreaterThan(result.unpairedDetectionRate);
    expect(result.pairedDetectionRate - result.unpairedDetectionRate).toBeGreaterThan(0.15);
  });
});

describe('the-pairing-benefit-simulation-is-deterministic-for-a-fixed-seed', () => {
  it('the-pairing-benefit-simulation-is-deterministic-for-a-fixed-seed', () => {
    const params = {
      n: 30,
      effectSize: 0.15,
      basePassRate: 0.5,
      caseDifficultySpread: 0.6,
      trials: 40,
      alpha: 0.05,
      bootstrapIterations: 120,
      seed: 909,
    };
    const first = runPairingBenefitSimulation(params);
    const second = runPairingBenefitSimulation(params);
    expect(second).toEqual(first);
  });
});

describe('with-no-injected-effect-and-no-shared-case-difficulty-pairing-has-no-advantage-to-show', () => {
  it('with-no-injected-effect-and-no-shared-case-difficulty-pairing-has-no-advantage-to-show', () => {
    // Contrast case for the headline test above: with effectSize: 0 (no
    // real regression to find) and caseDifficultySpread: 0 (nothing shared
    // for pairing to cancel, per generator.ts's own design rationale),
    // neither method should have a meaningfully elevated detection rate --
    // both should sit near the low, noise-driven range, and in particular
    // paired must not show some fixed, effect-independent advantage
    // (which would suggest the paired path is miscalibrated rather than
    // actually finding a real per-case effect).
    const result = runPairingBenefitSimulation({
      n: 100,
      effectSize: 0,
      basePassRate: 0.5,
      caseDifficultySpread: 0,
      trials: 300,
      alpha: 0.05,
      bootstrapIterations: 300,
      seed: 12,
    });
    expect(result.pairedDetectionRate).toBeLessThan(0.15);
    expect(result.unpairedDetectionRate).toBeLessThan(0.15);
  });
});
