// Written from `.claude/commands/build-llm-regression-suite.md` §6.4 and
// §5.5, and the Phase 6 interface contract (phase6-contract.md, "File 6:
// judge-drift.ts"), WITHOUT reading src/simulations/judge-drift.ts. §5.5
// (Cohen's kappa) WAS read at src/judge/kappa.ts, because it is
// already-built, already-tested production code this file's own reference
// reasoning depends on -- not the implementation under test here.
//
// Contract recap:
//   humanTruth_i ~ Bernoulli(humanPassRate)
//   judgeBefore_i = humanTruth_i with probability accuracyBefore, else
//     !humanTruth_i (and the same construction for judgeAfter with
//     accuracyAfter)
//   before = cohensKappa(humanTruth, judgeBefore)
//   after  = cohensKappa(humanTruth, judgeAfter)
//   kappaDelta = after.cohensKappa - before.cohensKappa
//
// §6.4, verbatim: "Take a calibrated judge, perturb the rubric wording,
// re-run calibration, show kappa moving. Demonstrates that calibration is a
// live constraint rather than a one-time formality."
//
// humanPassRate is deliberately kept away from 0 and 1 in every test below
// (0.5-0.6) so neither rater is anywhere near kappa.ts's documented Pe===1
// degenerate case (both raters unanimous in the same direction) --
// otherwise a drop in accuracy could be masked by that special-cased
// cohensKappa: 0 return value instead of producing the graded decline
// this file is actually testing for.

import { describe, it, expect } from 'vitest';
import { runJudgeDriftSimulation } from '../../src/simulations/judge-drift.js';

describe('kappa-drops-when-judge-accuracy-drops-after-a-rubric-edit', () => {
  it('kappa-drops-when-judge-accuracy-drops-after-a-rubric-edit', () => {
    const result = runJudgeDriftSimulation({
      n: 2000,
      humanPassRate: 0.6,
      accuracyBefore: 0.9,
      accuracyAfter: 0.6,
      seed: 11,
    });
    expect(result.n).toBe(2000);
    expect(result.before.labelCount).toBe(2000);
    expect(result.after.labelCount).toBe(2000);
    expect(result.after.cohensKappa).toBeLessThan(result.before.cohensKappa);
    // Real margin, not just "technically lower": a rubric that goes from
    // 90% to 60% judge/human agreement should visibly move kappa, not
    // shift it by a rounding error.
    expect(result.before.cohensKappa - result.after.cohensKappa).toBeGreaterThan(0.2);
  });
});

describe('kappa-rises-when-judge-accuracy-improves-after-a-rubric-edit', () => {
  it('kappa-rises-when-judge-accuracy-improves-after-a-rubric-edit', () => {
    const result = runJudgeDriftSimulation({
      n: 2000,
      humanPassRate: 0.6,
      accuracyBefore: 0.7,
      accuracyAfter: 0.95,
      seed: 12,
    });
    expect(result.after.cohensKappa).toBeGreaterThan(result.before.cohensKappa);
    expect(result.after.cohensKappa - result.before.cohensKappa).toBeGreaterThan(0.2);
  });
});

describe('kappa-delta-equals-after-minus-before-kappa', () => {
  it('kappa-delta-equals-after-minus-before-kappa', () => {
    const result = runJudgeDriftSimulation({
      n: 500,
      humanPassRate: 0.55,
      accuracyBefore: 0.85,
      accuracyAfter: 0.65,
      seed: 13,
    });
    expect(result.kappaDelta).toBeCloseTo(result.after.cohensKappa - result.before.cohensKappa, 10);
  });
});

describe('an-unchanged-rubric-leaves-kappa-effectively-unchanged', () => {
  it('an-unchanged-rubric-leaves-kappa-effectively-unchanged', () => {
    // Contrast case for the two directional tests above: if
    // accuracyBefore === accuracyAfter, nothing about judge quality
    // actually changed, and the small residual kappaDelta should be
    // consistent with ordinary Monte Carlo noise at this n, not a
    // systematic drift in either direction -- a judge-drift implementation
    // that always reports some fixed nonzero delta regardless of input
    // would fail this.
    const result = runJudgeDriftSimulation({
      n: 4000,
      humanPassRate: 0.55,
      accuracyBefore: 0.8,
      accuracyAfter: 0.8,
      seed: 14,
    });
    expect(Math.abs(result.kappaDelta)).toBeLessThan(0.1);
  });
});

describe('judge-drift-simulation-is-deterministic-for-a-fixed-seed', () => {
  it('judge-drift-simulation-is-deterministic-for-a-fixed-seed', () => {
    const params = { n: 300, humanPassRate: 0.6, accuracyBefore: 0.9, accuracyAfter: 0.6, seed: 2024 };
    const first = runJudgeDriftSimulation(params);
    const second = runJudgeDriftSimulation(params);
    expect(second).toEqual(first);
  });

  it('is deterministic across several distinct seeds, not just one', () => {
    for (const seed of [1, 2, 3, 100]) {
      const params = { n: 300, humanPassRate: 0.6, accuracyBefore: 0.9, accuracyAfter: 0.6, seed };
      const first = runJudgeDriftSimulation(params);
      const second = runJudgeDriftSimulation(params);
      expect(second).toEqual(first);
    }
  });
});
