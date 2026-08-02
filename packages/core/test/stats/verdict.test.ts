// Written from spec §5.6 ("Verdicts are asymmetric, deliberately") and the
// explicit interface/precedence description supplied for this phase,
// WITHOUT reading src/stats/verdict.ts. This module is pure decision logic
// over already-computed numbers, so every expected value here is derived
// directly from the stated rules, not from any statistical estimation.
//
// §5.6 table:
//   regression               | CI upper bound below zero, OR any critical case regressed | fail the check
//   no_detectable_difference | CI spans zero, MDE within ceiling                          | pass, report MDE
//   improvement_detected     | CI lower bound above zero                                  | pass (detected-not-proven)
//   insufficient_data        | MDE above ceiling, OR paired n below floor                 | pass with warning, never a block
//
// "Any critical-tagged case regressing fails the check regardless of the
// aggregate statistic."
//
// Interface contract (given, not read from src):
//   type Verdict = 'regression' | 'no_detectable_difference' | 'improvement_detected' | 'insufficient_data'
//   interface VerdictInput { ciLower; ciUpper; mde; mdeCeiling; pairedN; minPairedN; criticalRegressed }
//   function determineVerdict(input: VerdictInput): Verdict
//
// ---------------------------------------------------------------------
// AMBIGUITIES flagged, not silently resolved:
// ---------------------------------------------------------------------
// 1. Precedence when the critical-case override AND an insufficient-data
//    condition (mde > mdeCeiling, or pairedN < minPairedN) hold at the
//    same time is not specified anywhere in §5.6. "Regardless of the
//    aggregate statistic" clearly means the critical override beats
//    ciLower/ciUpper-based conclusions; it does not say whether a directly
//    observed critical-case failure should still block when the *paired
//    n itself* is below the configured floor (i.e. is a single critical
//    case regression evidence enough on its own, independent of whether
//    the rest of the dataset paired sufficiently?). No test below asserts
//    a specific answer to this combination.
// 2. Similarly, precedence between a CI-based regression (ciUpper < 0,
//    with criticalRegressed = 0) and an insufficient-data condition
//    holding simultaneously is not specified: does a technically-observed
//    negative CI still block when the dataset is otherwise underpowered
//    (mde > ceiling) to have produced that CI reliably? No test below
//    asserts a specific answer to this combination either.
// Both are worth resolving explicitly with the statistician and recording
// in docs/DECISIONS.md, since they change whether the tool blocks or warns
// in a real edge case.

import { describe, it, expect } from 'vitest';
import { determineVerdict, type VerdictInput } from '../../src/stats/verdict.js';

/** A "clean" baseline input: CI spans zero, MDE within ceiling, enough
 * paired cases, no critical regressions -- i.e. every condition that could
 * push the verdict away from `no_detectable_difference` is absent. Tests
 * override only the field(s) relevant to what they're checking. */
function cleanInput(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    ciLower: -0.02,
    ciUpper: 0.03,
    mde: 0.05,
    mdeCeiling: 0.08,
    pairedN: 100,
    minPairedN: 30,
    criticalRegressed: 0,
    ...overrides,
  };
}

describe('a-ci-spanning-zero-never-produces-a-regression-verdict', () => {
  it('a-ci-spanning-zero-never-produces-a-regression-verdict', () => {
    // Scoped deliberately to criticalRegressed = 0: the critical-case
    // override is a documented, separate exception to this guarantee (see
    // `a-critical-case-regression-overrides-an-improving-aggregate` below)
    // and is exercised there, not here. This test isolates the CI-only
    // decision path.
    const spanningZeroCases: Array<[number, number]> = [
      [-0.02, 0.03],
      [-10, 0.001],
      [-0.001, 10],
      [-1, 1],
    ];

    for (const [ciLower, ciUpper] of spanningZeroCases) {
      // Cross every spanning-zero CI with both a "sufficient data" and an
      // "insufficient data" configuration -- a spanning CI must never
      // become 'regression' regardless of which of the other two verdicts
      // (no_detectable_difference vs insufficient_data) it resolves to.
      const sufficientData = determineVerdict(cleanInput({ ciLower, ciUpper }));
      expect(sufficientData).not.toBe('regression');

      const insufficientData = determineVerdict(
        cleanInput({ ciLower, ciUpper, mde: 0.5, mdeCeiling: 0.08 }),
      );
      expect(insufficientData).not.toBe('regression');

      const tooFewPaired = determineVerdict(
        cleanInput({ ciLower, ciUpper, pairedN: 5, minPairedN: 30 }),
      );
      expect(tooFewPaired).not.toBe('regression');
    }
  });

  it('a-ci-upper-bound-of-exactly-zero-is-not-below-zero-and-is-not-a-regression', () => {
    // Boundary case: "CI upper bound below zero" is a strict condition.
    // A CI that merely touches zero from below (ciUpper === 0) still
    // contains zero -- candidate could be exactly tied with baseline --
    // and must not be classified as a regression.
    const result = determineVerdict(cleanInput({ ciLower: -0.04, ciUpper: 0 }));
    expect(result).not.toBe('regression');
    expect(result).toBe('no_detectable_difference');
  });
});

describe('a-ci-entirely-below-zero-produces-a-regression-verdict', () => {
  it('a-ci-entirely-below-zero-produces-a-regression-verdict', () => {
    // Control/reachability check: the guarantee above ("never regression
    // when spanning zero") would be vacuous if 'regression' could never be
    // produced at all. A CI strictly below zero, with no critical override
    // and otherwise-clean data, must yield 'regression'.
    const result = determineVerdict(cleanInput({ ciLower: -0.09, ciUpper: -0.01 }));
    expect(result).toBe('regression');
  });
});

describe('an-mde-above-the-ceiling-produces-insufficient-data-not-no-difference', () => {
  it('an-mde-above-the-ceiling-produces-insufficient-data-not-no-difference', () => {
    // Same CI (spans zero), same paired n (sufficient) -- the ONLY
    // difference between these two inputs is whether mde exceeds
    // mdeCeiling. Per §5.4: "When MDE exceeds a configured mde_ceiling,
    // the verdict is insufficient_data, not no_detectable_difference.
    // Those are different findings and conflating them is the core
    // failure this tool exists to avoid."
    const withinCeiling = determineVerdict(cleanInput({ mde: 0.05, mdeCeiling: 0.08 }));
    expect(withinCeiling).toBe('no_detectable_difference');

    const aboveCeiling = determineVerdict(cleanInput({ mde: 0.09, mdeCeiling: 0.08 }));
    expect(aboveCeiling).toBe('insufficient_data');
    expect(aboveCeiling).not.toBe('no_detectable_difference');
  });

  it('paired-n-below-the-floor-also-produces-insufficient-data-not-no-difference', () => {
    // The insufficient_data condition is an OR of two independent triggers
    // (§5.6: "MDE above ceiling, or paired n below floor"). This exercises
    // the second trigger on its own, with mde back within the ceiling, to
    // make sure it isn't only the mde check that's implemented.
    const enoughPaired = determineVerdict(cleanInput({ pairedN: 100, minPairedN: 30 }));
    expect(enoughPaired).toBe('no_detectable_difference');

    const tooFewPaired = determineVerdict(cleanInput({ pairedN: 20, minPairedN: 30 }));
    expect(tooFewPaired).toBe('insufficient_data');
    expect(tooFewPaired).not.toBe('no_detectable_difference');
  });
});

describe('a-critical-case-regression-overrides-an-improving-aggregate', () => {
  it('a-critical-case-regression-overrides-an-improving-aggregate', () => {
    // CI lower bound strictly above zero (would ordinarily be
    // 'improvement_detected'), MDE and paired-n both clean (so this isn't
    // secretly an insufficient_data case) -- the only variable is whether
    // a critical case regressed.
    const improvingCI = { ciLower: 0.02, ciUpper: 0.08, mde: 0.05, mdeCeiling: 0.08, pairedN: 100, minPairedN: 30 };

    // Control: with no critical regression, an improving CI is
    // 'improvement_detected', confirming the override -- not something
    // else about this input -- is what changes the outcome below.
    const withoutCriticalRegression = determineVerdict({ ...improvingCI, criticalRegressed: 0 });
    expect(withoutCriticalRegression).toBe('improvement_detected');

    // §5.6: "Any critical-tagged case regressing fails the check
    // regardless of the aggregate statistic." One critical regression, on
    // an otherwise-improving aggregate, must still be 'regression'.
    const withOneCriticalRegression = determineVerdict({ ...improvingCI, criticalRegressed: 1 });
    expect(withOneCriticalRegression).toBe('regression');
    expect(withOneCriticalRegression).not.toBe('improvement_detected');

    // Multiple critical regressions must not somehow "cancel out" or be
    // treated differently from exactly one -- still 'regression'.
    const withMultipleCriticalRegressions = determineVerdict({ ...improvingCI, criticalRegressed: 5 });
    expect(withMultipleCriticalRegressions).toBe('regression');
  });
});

describe('improvement-detected-requires-a-strictly-positive-ci-lower-bound', () => {
  it('improvement-detected-requires-a-strictly-positive-ci-lower-bound', () => {
    // Boundary case, mirroring the ciUpper === 0 check above: "CI lower
    // bound above zero" is a strict condition. A CI whose lower bound is
    // exactly zero still contains zero (candidate could be exactly tied)
    // and must not be reported as a detected improvement.
    const result = determineVerdict(cleanInput({ ciLower: 0, ciUpper: 0.05 }));
    expect(result).not.toBe('improvement_detected');
    expect(result).toBe('no_detectable_difference');
  });
});
