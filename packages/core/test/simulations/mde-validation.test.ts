// Written from `.claude/commands/build-llm-regression-suite.md` §6.3 and the
// Phase 6 interface contract (phase6-contract.md, "File 4:
// mde-validation.ts"), WITHOUT reading src/simulations/mde-validation.ts.
//
// §6.3, verbatim: "The MDE the tool reports must match the effect size the
// power curve actually detects at ~80% rate. If the reported MDE says 5
// points but the power curve shows 50% detection at 5 points, the MDE
// formula is wrong. Assert this in a test."
//
// Contract recap:
//   interface MdeValidationCell { sampleSize; reportedMde; empiricalMde:
//     number | null; withinTolerance: boolean } -- withinTolerance is false
//     whenever empiricalMde is null.
//   withinTolerance = empiricalMde !== null AND
//     |reportedMde - empiricalMde| / reportedMde <= 0.35 (35% relative
//     tolerance, documented in the contract as deliberately wide because
//     empiricalMde is itself a finite-trial, linearly-interpolated
//     estimate).
//
// Note: this file does not re-derive the MDE formula itself (that is
// mde.test.ts's job against src/stats/mde.ts directly, from the closed-form
// power-analysis formula in §5.4) -- it tests that runMdeValidation wires
// minimumDetectableEffect and the power curve together correctly and that
// the two numbers agree within the contract's stated tolerance, which is
// the actual empirical claim §6.3 asks the repo to make good on.

import { describe, it, expect } from 'vitest';
import { runMdeValidation } from '../../src/simulations/mde-validation.js';

describe('reported-mde-matches-empirical-power-curve-detection-within-tolerance', () => {
  it('reported-mde-matches-empirical-power-curve-detection-within-tolerance', () => {
    const result = runMdeValidation({
      sampleSizes: [50, 150],
      effectSizeSweep: [0.02, 0.04, 0.06, 0.08, 0.1, 0.14, 0.18, 0.24, 0.3],
      basePassRate: 0.7,
      caseDifficultySpread: 0.3,
      trialsPerCell: 150,
      alpha: 0.05,
      power: 0.8,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 500,
      seed: 9,
    });

    expect(result.cells).toHaveLength(2);
    for (const cell of result.cells) {
      expect(cell.empiricalMde).not.toBeNull();
      expect(cell.reportedMde).toBeGreaterThan(0);
      const relativeError = Math.abs(cell.reportedMde - (cell.empiricalMde as number)) / cell.reportedMde;
      expect(relativeError).toBeLessThanOrEqual(0.35);
      expect(cell.withinTolerance).toBe(true);
    }
    expect(result.allWithinTolerance).toBe(true);
  });

  it('a smaller sample size reports a larger MDE than a bigger one, on the same data-generating process', () => {
    // Sanity check independent of the empirical crossing: MDE = (z_a + z_p)
    // * SD / sqrt(n) (§5.4) is monotonically decreasing in n for a fixed SD
    // -- more data can detect a smaller true effect. Both sample sizes here
    // draw from the same basePassRate/caseDifficultySpread, so their SDs
    // should be close enough that this ordering holds.
    const result = runMdeValidation({
      sampleSizes: [50, 300],
      effectSizeSweep: [0.02, 0.05, 0.08, 0.12, 0.18, 0.25],
      basePassRate: 0.6,
      caseDifficultySpread: 0.25,
      trialsPerCell: 100,
      alpha: 0.05,
      power: 0.8,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 300,
      seed: 21,
    });
    const small = result.cells.find((c) => c.sampleSize === 50)!;
    const large = result.cells.find((c) => c.sampleSize === 300)!;
    expect(small.reportedMde).toBeGreaterThan(large.reportedMde);
  });
});

describe('within-tolerance-is-false-whenever-empirical-mde-is-null', () => {
  it('within-tolerance-is-false-whenever-empirical-mde-is-null', () => {
    // Force a non-bracketing sweep: every effect size in this narrow,
    // small sweep is far too small to hit 80% detection at n=30, so
        // interpolateDetectionThreshold has nothing to bracket the crossing
    // with and must return null -- withinTolerance must then be false,
    // per the contract's explicit invariant ("false whenever empiricalMde
    // is null"), regardless of how close reportedMde might otherwise look.
    const result = runMdeValidation({
      sampleSizes: [30],
      effectSizeSweep: [0.005, 0.01, 0.015],
      basePassRate: 0.7,
      caseDifficultySpread: 0.3,
      trialsPerCell: 80,
      alpha: 0.05,
      power: 0.8,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 200,
      seed: 31,
    });
    const cell = result.cells[0]!;
    expect(cell.empiricalMde).toBeNull();
    expect(cell.withinTolerance).toBe(false);
    expect(result.allWithinTolerance).toBe(false);
  });
});

describe('the-mde-validation-is-deterministic-for-a-fixed-seed', () => {
  it('the-mde-validation-is-deterministic-for-a-fixed-seed', () => {
    const params = {
      sampleSizes: [40],
      effectSizeSweep: [0.05, 0.1, 0.2],
      basePassRate: 0.6,
      caseDifficultySpread: 0.2,
      trialsPerCell: 30,
      alpha: 0.05,
      power: 0.8,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 100,
      seed: 5,
    };
    const first = runMdeValidation(params);
    const second = runMdeValidation(params);
    expect(second).toEqual(first);
  });
});
