// Written from `.claude/commands/build-llm-regression-suite.md` §6.1 and the
// Phase 6 interface contract (phase6-contract.md, "File 2: null-model.ts"),
// WITHOUT reading src/simulations/null-model.ts's implementation body before
// this file was drafted. §5.6 (verdict precedence) and §5.2 (bootstrap CI)
// WERE read, because they are already-built, already-tested production code
// this file's own reference arithmetic depends on.
//
// ===========================================================================
// BACKGROUND ON WHY THIS RESULT SHAPE HAS TWO RATES, NOT ONE (main-agent
// integration note, added after the statistician's and test-author's
// independent Phase 6 workflow runs both surfaced the same finding):
//
// determineVerdict (§5.6) sets verdict = 'regression' when ciUpper < 0 --
// one edge of a two-sided (1 - alpha) percentile bootstrap CI (§5.2). Under
// a true null, that one-sided event converges to alpha/2, not alpha; the
// symmetric 'improvement_detected' event also converges to alpha/2; their
// sum ("the CI excluded zero at all") converges to alpha. §6.1's prose
// ("the observed rate must land near 5%") and the README's worked example
// ("4.9%") are quantitatively consistent with the COMBINED two-sided rate,
// even though §6.1 literally says to count only 'regression' verdicts (the
// one-sided rate). Rather than silently pick one reading, runNullModelSimulation
// reports both, each checked against its own correct target:
//   regressionRate      (one-sided, the rate that actually blocks a PR) -> alpha/2
//   combinedRate         (regressionRate + improvementRate)              -> alpha
// This is a real, open product question raised to the user at the Phase 6
// checkpoint (see docs/DECISIONS.md), not a bug in this simulation.
// ===========================================================================

import { describe, it, expect } from 'vitest';
import { runNullModelSimulation } from '../../src/simulations/null-model.js';
import { generateSyntheticPairedCases } from '../../src/simulations/generator.js';

const ALPHA = 0.05;

describe('null-model-regression-rate-lands-near-alpha-over-two', () => {
  it('null-model-regression-rate-lands-near-alpha-over-two', () => {
    // The one-sided 'regression' event -- the rate that actually fails the
    // CI check under a true null. Its mathematically correct target is
    // alpha/2, and the result reports its own target/tolerance so this test
    // doesn't hardcode that derivation twice.
    const result = runNullModelSimulation({
      n: 100,
      basePassRate: 0.6,
      caseDifficultySpread: 0.25,
      trials: 2000,
      alpha: ALPHA,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 500,
      seed: 20260803,
    });
    expect(result.trials).toBe(2000);
    expect(result.alpha).toBe(ALPHA);
    expect(result.regressionRateTarget).toBeCloseTo(ALPHA / 2, 10);
    expect(result.regressionRateWithinTolerance).toBe(true);
  });
});

describe('null-model-combined-rate-lands-near-alpha', () => {
  it('null-model-combined-rate-lands-near-alpha', () => {
    // regressionRate + improvementRate -- the standard two-sided Type-I-error
    // rate, and the number closest to §6.1's/§12's literal "~5%" language.
    const result = runNullModelSimulation({
      n: 100,
      basePassRate: 0.5,
      caseDifficultySpread: 0.2,
      trials: 2000,
      alpha: ALPHA,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 500,
      seed: 4242,
    });
    expect(result.combinedRate).toBeCloseTo(result.regressionRate + result.improvementRate, 10);
    expect(result.combinedRateWithinTolerance).toBe(true);
  });
});

describe('the-tolerance-band-arithmetic-matches-a-hand-computed-example', () => {
  it('regression-rate band is centered on alpha/2, not alpha', () => {
    // Hand-computed: alpha=0.05, trials=1000 -> target=0.025,
    // se = sqrt(0.025 * 0.975 / 1000) ~ 0.0049371, band ~ [0.0102, 0.0398].
    const result = runNullModelSimulation({
      n: 20, // small/cheap: only the arithmetic is under test here
      basePassRate: 0.5,
      caseDifficultySpread: 0.2,
      trials: 1000,
      alpha: ALPHA,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 100,
      seed: 1,
    });

    const halfAlpha = ALPHA / 2;
    const handComputedSE = Math.sqrt((halfAlpha * (1 - halfAlpha)) / 1000);
    expect(handComputedSE).toBeCloseTo(0.0049371, 6);
    expect(result.regressionRateStandardError).toBeCloseTo(handComputedSE, 8);

    const lower = halfAlpha - 3 * handComputedSE;
    const upper = halfAlpha + 3 * handComputedSE;
    expect(lower).toBeCloseTo(0.0102, 3);
    expect(upper).toBeCloseTo(0.0398, 3);
  });

  it('combined-rate band is centered on alpha, matching the contract\'s original worked example', () => {
    // alpha=0.05, trials=1000 -> se = sqrt(0.05*0.95/1000) ~ 0.0068920,
    // band ~ [0.0293, 0.0707] -- the exact numbers the original Phase 6
    // contract worked through, now correctly attached to combinedRate
    // rather than to the one-sided regression rate.
    const result = runNullModelSimulation({
      n: 20,
      basePassRate: 0.5,
      caseDifficultySpread: 0.2,
      trials: 1000,
      alpha: ALPHA,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 100,
      seed: 2,
    });

    const handComputedSE = Math.sqrt((ALPHA * (1 - ALPHA)) / 1000);
    expect(handComputedSE).toBeCloseTo(0.006892, 6);
    expect(result.combinedRateStandardError).toBeCloseTo(handComputedSE, 8);

    const lower = ALPHA - 3 * handComputedSE;
    const upper = ALPHA + 3 * handComputedSE;
    expect(lower).toBeCloseTo(0.0293, 3);
    expect(upper).toBeCloseTo(0.0707, 3);
  });
});

describe('within-tolerance-fields-are-computed-consistently-from-their-own-returned-numbers', () => {
  it('regressionRateWithinTolerance matches its own reported rate/target/SE', () => {
    const result = runNullModelSimulation({
      n: 50,
      basePassRate: 0.5,
      caseDifficultySpread: 0.3,
      trials: 500,
      alpha: ALPHA,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 200,
      seed: 55,
    });
    const lower = result.regressionRateTarget - 3 * result.regressionRateStandardError;
    const upper = result.regressionRateTarget + 3 * result.regressionRateStandardError;
    const expected = result.regressionRate >= lower && result.regressionRate <= upper;
    expect(result.regressionRateWithinTolerance).toBe(expected);
  });

  it('combinedRateWithinTolerance matches its own reported rate/alpha/SE', () => {
    const result = runNullModelSimulation({
      n: 50,
      basePassRate: 0.5,
      caseDifficultySpread: 0.3,
      trials: 500,
      alpha: ALPHA,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 200,
      seed: 56,
    });
    const lower = result.alpha - 3 * result.combinedRateStandardError;
    const upper = result.alpha + 3 * result.combinedRateStandardError;
    const expected = result.combinedRate >= lower && result.combinedRate <= upper;
    expect(result.combinedRateWithinTolerance).toBe(expected);
  });
});

describe('the-null-model-is-deterministic-for-a-fixed-seed', () => {
  it('repeats bit-for-bit for the same params', () => {
    // Now that computeComparison accepts a seeded `rand`, this is a genuine
    // bit-for-bit reproducibility check, not an aspiration -- see the
    // module comment on the `rand` parameter added to bootstrapCI for
    // Phase 6.
    const params = {
      n: 30,
      basePassRate: 0.55,
      caseDifficultySpread: 0.2,
      trials: 60,
      alpha: ALPHA,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 150,
      seed: 777,
    };
    const first = runNullModelSimulation(params);
    const second = runNullModelSimulation(params);
    expect(second).toEqual(first);
  });

  it('is deterministic across several distinct seeds, not just one', () => {
    for (const seed of [1, 2, 3, 42]) {
      const params = {
        n: 30,
        basePassRate: 0.55,
        caseDifficultySpread: 0.2,
        trials: 60,
        alpha: ALPHA,
        mdeCeiling: 1,
        minPairedN: 5,
        bootstrapIterations: 150,
        seed,
      };
      const first = runNullModelSimulation(params);
      const second = runNullModelSimulation(params);
      expect(second).toEqual(first);
    }
  });
});

describe('null-model-trials-are-built-from-non-critical-generated-cases', () => {
  it('null-model-trials-are-built-from-non-critical-generated-cases', () => {
    // §5.6's critical-case override is a policy decision layered on top of
    // the statistical test, not itself a calibratable false-positive rate
    // (see the contract's own reasoning). This checks the same generator
    // call shape null-model.ts is specified to use (effectSize: 0) still
    // guarantees critical: false -- a light integration-shaped echo of
    // generator.test.ts's stronger, dedicated check.
    const cases = generateSyntheticPairedCases({
      n: 100,
      basePassRate: 0.6,
      effectSize: 0,
      caseDifficultySpread: 0.25,
      seed: 1,
    });
    expect(cases.every((c) => c.critical === false)).toBe(true);
  });
});
