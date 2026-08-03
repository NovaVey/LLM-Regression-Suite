// Written from `.claude/commands/build-llm-regression-suite.md` §6.2 and the
// Phase 6 interface contract (phase6-contract.md, "File 3: power-curve.ts"),
// WITHOUT reading src/simulations/power-curve.ts.
//
// Contract recap:
//   runPowerCurveSimulation(params): { cells: PowerCurveCell[] } -- one cell
//   per (effectSize, sampleSize) pair, trialsPerCell trials each, feeding
//   generateSyntheticPairedCases through the real computeComparison,
//   detectionRate = fraction with verdict === 'regression'.
//
//   interpolateDetectionThreshold(cellsForOneSampleSize, targetPower): a
//   small pure helper -- sort by effectSize ascending, walk consecutive
//   pairs, linearly interpolate the effectSize where detectionRate first
//   crosses targetPower; null if the given cells don't bracket the
//   crossing.
//
// Parameters below (effect sizes, sample sizes, trialsPerCell, seed) were
// chosen and checked for a robust monotonic signal against a scratch
// reference implementation of this exact contract before being fixed here
// (see the test-author's report) -- not tuned against the real
// implementation, which does not exist yet.

import { describe, it, expect } from 'vitest';
import {
  runPowerCurveSimulation,
  interpolateDetectionThreshold,
  type PowerCurveCell,
} from '../../src/simulations/power-curve.js';
import { generateSyntheticPairedCases } from '../../src/simulations/generator.js';

function findCell(cells: PowerCurveCell[], effectSize: number, sampleSize: number): PowerCurveCell {
  const cell = cells.find((c) => c.effectSize === effectSize && c.sampleSize === sampleSize);
  if (!cell) {
    throw new Error(`no cell for effectSize=${effectSize}, sampleSize=${sampleSize}`);
  }
  return cell;
}

describe('power-curve-detection-rate-increases-with-effect-size-and-sample-size', () => {
  it('power-curve-detection-rate-increases-with-effect-size-and-sample-size', () => {
    const result = runPowerCurveSimulation({
      effectSizes: [0.01, 0.05, 0.2],
      sampleSizes: [20, 100, 500],
      basePassRate: 0.7,
      caseDifficultySpread: 0.3,
      trialsPerCell: 200,
      alpha: 0.05,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 400,
      seed: 3,
    });
    expect(result.cells).toHaveLength(9); // 3 effect sizes x 3 sample sizes

    // Headline comparison from the §6.5-adjacent division-of-labor prose:
    // "a 20-point regression at n=500 should detect far more often than a
    // 1-point regression at n=20."
    const big = findCell(result.cells, 0.2, 500);
    const tiny = findCell(result.cells, 0.01, 20);
    expect(big.detectionRate - tiny.detectionRate).toBeGreaterThan(0.6);

    // Effect-size monotonicity, holding sample size fixed at n=500.
    const es01 = findCell(result.cells, 0.01, 500);
    const es05 = findCell(result.cells, 0.05, 500);
    const es20 = findCell(result.cells, 0.2, 500);
    expect(es05.detectionRate).toBeGreaterThan(es01.detectionRate);
    expect(es20.detectionRate).toBeGreaterThan(es05.detectionRate);

    // Sample-size monotonicity, holding effect size fixed at 0.05.
    const n20 = findCell(result.cells, 0.05, 20);
    const n100 = findCell(result.cells, 0.05, 100);
    const n500 = findCell(result.cells, 0.05, 500);
    expect(n100.detectionRate).toBeGreaterThan(n20.detectionRate);
    expect(n500.detectionRate).toBeGreaterThan(n100.detectionRate);
  });
});

describe('power-curve-trials-are-built-from-non-critical-generated-cases', () => {
  it('power-curve-trials-are-built-from-non-critical-generated-cases', () => {
    const cases = generateSyntheticPairedCases({
      n: 100,
      basePassRate: 0.7,
      effectSize: 0.1,
      caseDifficultySpread: 0.3,
      seed: 1,
    });
    expect(cases.every((c) => c.critical === false)).toBe(true);
  });
});

describe('the-power-curve-simulation-is-deterministic-for-a-fixed-seed', () => {
  it('the-power-curve-simulation-is-deterministic-for-a-fixed-seed', () => {
    const params = {
      effectSizes: [0.05, 0.2],
      sampleSizes: [30],
      basePassRate: 0.6,
      caseDifficultySpread: 0.2,
      trialsPerCell: 25,
      alpha: 0.05,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 100,
      seed: 42,
    };
    const first = runPowerCurveSimulation(params);
    const second = runPowerCurveSimulation(params);
    expect(second).toEqual(first);
  });
});

describe('interpolate-detection-threshold-linearly-interpolates-between-bracketing-grid-points', () => {
  const cells: PowerCurveCell[] = [
    { effectSize: 0.01, sampleSize: 100, trials: 1, detections: 0, detectionRate: 0.1 },
    { effectSize: 0.05, sampleSize: 100, trials: 1, detections: 0, detectionRate: 0.5 },
    { effectSize: 0.1, sampleSize: 100, trials: 1, detections: 0, detectionRate: 0.9 },
  ];

  it('interpolates strictly between two bracketing points', () => {
    // Between (0.01, 0.1) and (0.05, 0.5): target 0.2 is 25% of the way
    // from 0.1 to 0.5 (NOT the midpoint of the y-range -- deliberately
    // asymmetric, so a buggy "just return the midpoint of the two
    // effect sizes" implementation gives a different, wrong answer (0.03)
    // than correct linear interpolation (0.02) and this test can tell them
    // apart), so the interpolated effect size is 25% of the way from 0.01
    // to 0.05: 0.01 + 0.25 * 0.04 = 0.02.
    const threshold = interpolateDetectionThreshold(cells, 0.2);
    expect(threshold).not.toBeNull();
    expect(threshold as number).toBeCloseTo(0.02, 10);
  });

  it('interpolate-detection-threshold-returns-the-exact-grid-point-when-the-rate-lands-on-it', () => {
    const threshold = interpolateDetectionThreshold(cells, 0.5);
    expect(threshold).toBeCloseTo(0.05, 10);
  });

  it('interpolate-detection-threshold-returns-null-when-the-target-power-is-never-reached', () => {
    // Max detectionRate in this grid is 0.9; 0.95 is never bracketed.
    expect(interpolateDetectionThreshold(cells, 0.95)).toBeNull();
  });

  it('interpolate-detection-threshold-returns-null-when-every-cell-already-exceeds-the-target', () => {
    // Min detectionRate in this grid is 0.1; 0.05 is already exceeded by
    // the very first point, so there is no crossing to interpolate.
    expect(interpolateDetectionThreshold(cells, 0.05)).toBeNull();
  });

  it('interpolate-detection-threshold-does-not-require-pre-sorted-input', () => {
    // Chosen so that walking ADJACENT pairs of this exact ordering without
    // sorting first would find a *different* (wrong) bracket than the
    // correctly-sorted grid does -- [cells[2], cells[0], cells[1]] leaves
    // the last two elements in their original ascending order, so an
    // implementation that forgets to sort can still stumble onto the right
    // adjacent pair by coincidence and pass anyway. This permutation does
    // not have that gap: every adjacent pair here is out of ascending
    // order relative to the others.
    const shuffled: PowerCurveCell[] = [cells[1]!, cells[0]!, cells[2]!];
    const sortedResult = interpolateDetectionThreshold(cells, 0.5);
    const shuffledResult = interpolateDetectionThreshold(shuffled, 0.5);
    expect(shuffledResult).toBeCloseTo(sortedResult as number, 10);
  });
});
