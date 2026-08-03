// Written from spec §5.1, §5.2, §5.4, §5.6, the Phase 4 exit criteria in §9,
// and the interface contract handed down for this phase, WITHOUT reading
// src/comparison/statistics.ts (implemented concurrently by a different
// agent). The already-established, already-tested Phase 1 primitives
// (src/stats/{bootstrap,mcnemar,mde,verdict}.ts) WERE read -- not to copy
// their conclusions about what statistics.ts should do, but because this
// file needs their exact calling conventions to build independent reference
// arithmetic for a handful of assertions, the same way mde.test.ts and
// bootstrap.test.ts (Phase 1) built their own reference formulas rather than
// asserting against the implementation's own numbers.
//
// §9 Phase 4 exit criterion (the two sentences this whole file is built
// around): "comparing a run against itself yields no_detectable_difference
// with a delta of exactly 0 and an interval containing 0; comparing against
// a deliberately broken variant yields regression with the right case list."
//
// Interface contract (given, not read from src):
//   interface RegressionComparisonInput { paired: PairedCase[]; alpha; mdeCeiling;
//     minPairedN; bootstrapIterations; power? } -- power defaults to 0.8.
//   interface ComparisonStats { pairedCaseCount; delta; ciLower; ciUpper; mde;
//     verdict; regressedExternalIds; fixedExternalIds; criticalRegressed;
//     mcnemar: McNemarResult | null; test: 'paired_bootstrap' | 'mcnemar'; pValue }
//   function computeComparison(input): ComparisonStats
//
// PROPOSED interpretations supplied for this phase, adopted here (both carry
// explicit license to override with documented reasoning; neither was
// overridden -- see the per-item notes below for why):
//   1. "Regressed"/"fixed" = a pass/fail FLIP (baselinePassed !== candidatePassed),
//      not raw score movement. Adopted as given -- distinguished explicitly
//      from a raw-score reading in the dedicated test below, because a test
//      that can't tell the two readings apart wouldn't be testing anything.
//   2. Verdict is ALWAYS driven by the bootstrap CI (test === 'paired_bootstrap'
//      whenever pairedCaseCount > 0); McNemar is ALWAYS additionally computed
//      as supplementary evidence (discordantB = regressed count, discordantC =
//      fixed count) but never drives the verdict. Adopted as given, and tested
//      directly below (mcnemar wiring test) since the contract states the
//      discordantB/C <-> regressed/fixed mapping explicitly, not as something
//      this file derived independently.
//
// ---------------------------------------------------------------------
// AMBIGUITIES flagged, not silently resolved
// ---------------------------------------------------------------------
// A. `pValue`'s source when pairedCaseCount > 0 is genuinely underspecified.
//    Two readings are both defensible from the contract text: (a) pValue is
//    always null because 'test' is always 'paired_bootstrap' and a percentile
//    bootstrap CI has no p-value in this codebase's BootstrapResult shape
//    (mean/ciLower/ciUpper/iterations only -- no pValue field exists there);
//    or (b) pValue mirrors mcnemar.pValue as a convenience even though
//    'test' records what actually drove the verdict. This file does NOT
//    assert either reading for pairedCaseCount > 0. It only asserts pValue
//    is null at pairedCaseCount === 0, which is true under both readings
//    (there is no data to produce any p-value from, regardless of source).
// B. The n=0 short-circuit's `mde` value is explicitly left as the
//    implementer's call in the task brief ("0 or Infinity -- your call,
//    document which and why"). This file asserts only that it is one of
//    those two coherent values (not NaN, not negative, not a thrown error),
//    not which one.
// Both are worth a DECISIONS.md entry from whoever lands the implementation.

import { describe, it, expect } from 'vitest';
import { computeComparison } from '../../src/comparison/statistics.js';
import type { PairedCase } from '../../src/comparison/pairing.js';

function pc(externalId: string, overrides: Partial<PairedCase> = {}): PairedCase {
  const baselineScore = overrides.baselineScore ?? 0.5;
  const candidateScore = overrides.candidateScore ?? 0.5;
  return {
    externalId,
    critical: false,
    baselineScore,
    candidateScore,
    baselinePassed: true,
    candidatePassed: true,
    difference: candidateScore - baselineScore,
    ...overrides,
  };
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleVariance(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  const ssq = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return ssq / (xs.length - 1);
}

// ===========================================================================
// comparing-a-run-against-itself-reports-zero-delta
// ===========================================================================

describe('comparing-a-run-against-itself-reports-zero-delta', () => {
  it('comparing-a-run-against-itself-reports-zero-delta', () => {
    // Self-comparison: every candidateScore equals its baselineScore, so
    // every per-case difference is exactly 0. This makes the bootstrap
    // result fully deterministic (any resample of an all-zero vector is
    // still all zeros), so this test needs no random-seed tolerance.
    const paired: PairedCase[] = Array.from({ length: 12 }, (_, i) => {
      const score = 0.2 + i * 0.06; // varied absolute scores, identical baseline/candidate
      return pc(`case-${i}`, {
        baselineScore: score,
        candidateScore: score,
        difference: 0,
        baselinePassed: true,
        candidatePassed: true,
        critical: i % 4 === 0, // mix in some critical cases; none flip, so irrelevant to the verdict
      });
    });

    const result = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 0.3,
      minPairedN: 5,
      bootstrapIterations: 500,
      power: 0.8,
    });

    expect(result.pairedCaseCount).toBe(12);
    expect(result.delta).toBe(0);
    expect(result.ciLower).toBeLessThanOrEqual(0);
    expect(result.ciUpper).toBeGreaterThanOrEqual(0);
    expect(result.ciLower).toBe(0); // exact, not merely "contains zero" -- degenerate input, no resampling noise possible
    expect(result.ciUpper).toBe(0);
    expect(result.mde).toBe(0); // zero variance in the differences: any nonzero true effect would be certain to detect
    expect(result.verdict).toBe('no_detectable_difference');
    expect(result.regressedExternalIds).toHaveLength(0);
    expect(result.fixedExternalIds).toHaveLength(0);
    expect(result.criticalRegressed).toBe(0);
  });
});

// ===========================================================================
// a-single-critical-case-regressing-fails-the-check-despite-a-positive-aggregate
// ===========================================================================

describe('a-single-critical-case-regressing-fails-the-check-despite-a-positive-aggregate', () => {
  it('a-single-critical-case-regressing-fails-the-check-despite-a-positive-aggregate', () => {
    // 30 non-critical cases all improve by a large, constant +0.4 (no
    // pass/fail flip -- passed=true on both sides). One critical case
    // regresses by -0.5 AND flips pass->fail. The aggregate bootstrap CI is
    // overwhelmingly likely to sit entirely above zero (a single outlier
    // among 30 constant +0.4 values can only pull the resampled mean toward
    // zero if it is drawn roughly 14+ times out of 31 draws -- a
    // sub-astronomically unlikely event under uniform resampling with
    // replacement, i.e. this is not a knife-edge probabilistic test).
    const improved: PairedCase[] = Array.from({ length: 30 }, (_, i) =>
      pc(`improved-${i}`, {
        baselineScore: 0.5,
        candidateScore: 0.9,
        difference: 0.4,
        baselinePassed: true,
        candidatePassed: true,
        critical: false,
      }),
    );
    const criticalRegression = pc('refund-past-window', {
      baselineScore: 0.9,
      candidateScore: 0.4,
      difference: -0.5,
      baselinePassed: true,
      candidatePassed: false, // pass -> fail flip
      critical: true,
    });
    const paired = [...improved, criticalRegression];

    const result = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 3000,
      power: 0.8,
    });

    // Control: confirm the aggregate really is positive -- proves the
    // 'regression' verdict below comes from the critical override, not
    // from the CI itself.
    expect(result.ciLower).toBeGreaterThan(0);

    expect(result.criticalRegressed).toBe(1);
    expect(result.verdict).toBe('regression');
    expect(result.regressedExternalIds).toEqual(['refund-past-window']);
    expect(result.fixedExternalIds).toHaveLength(0);
  });
});

// ===========================================================================
// pairing-detects-an-injected-regression-that-unpaired-analysis-misses
// ===========================================================================
//
// NOTE on construction: the task brief's suggested fixture ("exactly one
// case's score drops significantly" among many unchanged cases) cannot, by
// construction, ever produce a paired CI that excludes zero, regardless of n
// or the drop's magnitude, when the other n-1 differences are exactly zero.
// Proof sketch: with (n-1) zero differences and one outlier of size o, the
// sample mean of differences is o/n and the sample SD is o/sqrt(n) (both
// scale with the same o), so mean/SE is bounded at exactly 1 regardless of o
// or n -- nowhere near the ~2 needed for a 95% CI to exclude zero. This is a
// real, useful finding in its own right: it is exactly *why* the critical-
// case override in §5.6 exists as a mechanism separate from the aggregate
// statistic -- a single flipped case is real signal that a population-level
// test cannot reliably surface on its own. Reported as a spec-adjacent
// finding, not silently worked around.
//
// The construction below instead injects a modest, CONSISTENT regression
// across the whole dataset (every case drops by ~0.08-0.12) while baseline
// scores themselves are highly bimodal (some near 0.2-0.3, some near
// 0.75-0.9) -- the actual scenario §5.1 and §6.5 describe ("a real 4-point
// regression... buried" under "between-case variance... usually far larger
// than the effect being measured").
// ===========================================================================

describe('pairing-detects-an-injected-regression-that-unpaired-analysis-misses', () => {
  it('pairing-detects-an-injected-regression-that-unpaired-analysis-misses', () => {
    const n = 30;
    const baselineScores: number[] = [];
    for (let i = 0; i < 15; i++) baselineScores.push(0.2 + i * 0.01); // 0.20 .. 0.34, "hard" cases
    for (let i = 15; i < 30; i++) baselineScores.push(0.75 + (i - 15) * 0.01); // 0.75 .. 0.89, "easy" cases

    const candidateScores = baselineScores.map((s, i) => s + (i % 2 === 0 ? -0.08 : -0.12));

    const paired: PairedCase[] = baselineScores.map((b, i) =>
      pc(`case-${i}`, {
        baselineScore: b,
        candidateScore: candidateScores[i]!,
        difference: candidateScores[i]! - b,
        baselinePassed: true,
        candidatePassed: true, // no flips: isolate the CI-based path, not the critical override
        critical: false,
      }),
    );

    // --- The paired approach, via the real function under test. ---
    const result = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 3000,
      power: 0.8,
    });

    expect(result.ciUpper).toBeLessThan(0); // paired CI excludes zero: the regression is detected
    expect(result.verdict).toBe('regression');

    // --- A hand-rolled UNPAIRED reference, computed independently of
    // statistics.ts, using the standard two-independent-samples CI (no
    // per-case pairing at all -- just the two score vectors as if they came
    // from unrelated cases). This is the comparison the paired approach
    // exists to improve on, per §5.1. ---
    const baselineMean = mean(baselineScores);
    const candidateMean = mean(candidateScores);
    const unpairedDelta = candidateMean - baselineMean;
    const varBaseline = sampleVariance(baselineScores, baselineMean);
    const varCandidate = sampleVariance(candidateScores, candidateMean);
    const unpairedSE = Math.sqrt(varBaseline / n + varCandidate / n);
    const Z_975 = 1.959963985;
    const unpairedCiLower = unpairedDelta - Z_975 * unpairedSE;
    const unpairedCiUpper = unpairedDelta + Z_975 * unpairedSE;

    // Same point estimate either way -- mean(candidate) - mean(baseline)
    // equals mean(differences) exactly, by linearity. Only the CI differs.
    expect(unpairedDelta).toBeCloseTo(result.delta, 6);

    // The naive unpaired CI spans zero: the SAME true injected regression
    // would NOT be flagged as significant under an unpaired analysis at the
    // same n, because between-case variance (baseline scores ranging from
    // 0.20 to 0.89) swamps the signal.
    expect(unpairedCiLower).toBeLessThan(0);
    expect(unpairedCiUpper).toBeGreaterThan(0);

    // Quantify "far less visible": the paired standard error (computed from
    // the per-case DIFFERENCES, independently of bootstrapCI's internals)
    // is at least an order of magnitude tighter than the unpaired SE, for
    // the same underlying data and the same n.
    const differences = paired.map((p) => p.difference);
    const diffMean = mean(differences);
    const pairedSE = Math.sqrt(sampleVariance(differences, diffMean) / n);
    expect(unpairedSE / pairedSE).toBeGreaterThan(10);
  });
});

// ===========================================================================
// pairedCaseCount === 0 must not throw, and must resolve to insufficient_data
// ===========================================================================

describe('a-comparison-with-zero-paired-cases-reports-insufficient-data-instead-of-throwing', () => {
  it('a-comparison-with-zero-paired-cases-reports-insufficient-data-instead-of-throwing', () => {
    let result;
    expect(() => {
      result = computeComparison({
        paired: [],
        alpha: 0.05,
        mdeCeiling: 0.1,
        minPairedN: 5,
        bootstrapIterations: 1000,
      });
    }).not.toThrow();

    expect(result!.pairedCaseCount).toBe(0);
    expect(result!.delta).toBe(0);
    expect(result!.ciLower).toBe(0);
    expect(result!.ciUpper).toBe(0);
    expect(result!.verdict).toBe('insufficient_data');
    expect(result!.mcnemar).toBeNull();
    expect(result!.pValue).toBeNull(); // see ambiguity note A: true under either reading at n=0
    expect(result!.regressedExternalIds).toEqual([]);
    expect(result!.fixedExternalIds).toEqual([]);
    expect(result!.criticalRegressed).toBe(0);
    // See ambiguity note B: the implementer's documented choice of 0 or
    // Infinity, not pinned to one value here -- but must be coherent, not
    // NaN/undefined/negative.
    expect(Number.isNaN(result!.mde)).toBe(false);
    expect([0, Infinity]).toContain(result!.mde);
  });
});

// ===========================================================================
// regressed/fixed lists reflect a pass/fail FLIP, not raw score movement;
// concordant cases (same pass/fail both sides) appear in neither list.
// ===========================================================================

describe('regressed-and-fixed-external-ids-reflect-a-pass-fail-flip-not-raw-score-movement', () => {
  it('a-pass-to-fail-flip-is-regressed-a-fail-to-pass-flip-is-fixed-concordant-cases-are-in-neither', () => {
    const regressedCase = pc('regressed-case', {
      baselineScore: 0.9,
      candidateScore: 0.4,
      baselinePassed: true,
      candidatePassed: false,
      critical: false,
    });
    const fixedCase = pc('fixed-case', {
      baselineScore: 0.3,
      candidateScore: 0.8,
      baselinePassed: false,
      candidatePassed: true,
      critical: false,
    });
    const concordantPassBoth = pc('concordant-pass-both', {
      baselineScore: 0.9,
      candidateScore: 0.95,
      baselinePassed: true,
      candidatePassed: true,
      critical: false,
    });
    const concordantFailBoth = pc('concordant-fail-both', {
      baselineScore: 0.1,
      candidateScore: 0.15,
      baselinePassed: false,
      candidatePassed: false,
      critical: false,
    });
    const criticalRegressedCase = pc('critical-regressed', {
      baselineScore: 0.9,
      candidateScore: 0.6,
      baselinePassed: true,
      candidatePassed: false,
      critical: true,
    });
    // This is the case that distinguishes "flip-based" from "score-based"
    // regression: the score DROPS (0.6 -> 0.55) but pass/fail does NOT flip
    // (stays passed on both sides). Per the adopted interpretation (flip-
    // based, not raw score movement) this must NOT appear in
    // regressedExternalIds, even though its score went down.
    const scoreDroppedButNoFlip = pc('score-dropped-no-flip', {
      baselineScore: 0.6,
      candidateScore: 0.55,
      baselinePassed: true,
      candidatePassed: true,
      critical: false,
    });

    const paired = [
      regressedCase,
      fixedCase,
      concordantPassBoth,
      concordantFailBoth,
      criticalRegressedCase,
      scoreDroppedButNoFlip,
    ];

    const result = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 1,
      minPairedN: 1,
      bootstrapIterations: 500,
    });

    expect(new Set(result.regressedExternalIds)).toEqual(new Set(['regressed-case', 'critical-regressed']));
    expect(new Set(result.fixedExternalIds)).toEqual(new Set(['fixed-case']));

    // The score-dropped-but-not-flipped case must be in neither list.
    expect(result.regressedExternalIds).not.toContain('score-dropped-no-flip');
    expect(result.fixedExternalIds).not.toContain('score-dropped-no-flip');

    // Concordant cases (agreeing pass/fail on both sides) are in neither list.
    expect(result.regressedExternalIds).not.toContain('concordant-pass-both');
    expect(result.regressedExternalIds).not.toContain('concordant-fail-both');
    expect(result.fixedExternalIds).not.toContain('concordant-pass-both');
    expect(result.fixedExternalIds).not.toContain('concordant-fail-both');

    // criticalRegressed counts only critical cases within regressedExternalIds.
    expect(result.criticalRegressed).toBe(1);
  });
});

// ===========================================================================
// McNemar is computed as supplementary evidence from the regressed/fixed
// counts whenever there is paired data, but never drives the verdict --
// the interpretation this phase's brief explicitly commits to (proposal 2).
// ===========================================================================

describe('mcnemar-is-wired-from-the-paired-regressed-and-fixed-counts-and-never-overrides-the-bootstrap-driven-verdict', () => {
  it('mcnemar-discordant-counts-match-regressed-and-fixed-and-the-ci-driven-verdict-is-unaffected-by-them', () => {
    // 30 concordant cases (exact tie, difference 0, same pass/fail both
    // sides) plus 3 pass->fail flips and 1 fail->pass flip, all with tiny,
    // inconsistent-sign score movement (+/-0.02) so the aggregate mean
    // stays a hair's breadth from zero. Per the same dilution argument as
    // the pairing-benefit test above, 4 small outliers among 34 exact-zero
    // cases cannot plausibly push the bootstrap CI away from zero -- this
    // is a robust, non-knife-edge no_detectable_difference case, even
    // though McNemar sees a real 3-vs-1 discordant-pair asymmetry.
    const concordant: PairedCase[] = Array.from({ length: 30 }, (_, i) =>
      pc(`concordant-${i}`, {
        baselineScore: 0.7,
        candidateScore: 0.7,
        difference: 0,
        baselinePassed: true,
        candidatePassed: true,
        critical: false,
      }),
    );
    const regressed: PairedCase[] = Array.from({ length: 3 }, (_, i) =>
      pc(`regressed-${i}`, {
        baselineScore: 0.51,
        candidateScore: 0.49,
        difference: -0.02,
        baselinePassed: true,
        candidatePassed: false,
        critical: false,
      }),
    );
    const fixed: PairedCase[] = [
      pc('fixed-0', {
        baselineScore: 0.49,
        candidateScore: 0.51,
        difference: 0.02,
        baselinePassed: false,
        candidatePassed: true,
        critical: false,
      }),
    ];
    const paired = [...concordant, ...regressed, ...fixed];

    const result = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 1,
      minPairedN: 5,
      bootstrapIterations: 3000,
    });

    expect(result.mcnemar).not.toBeNull();
    expect(result.mcnemar?.discordantB).toBe(3); // regressed count (baseline pass, candidate fail)
    expect(result.mcnemar?.discordantC).toBe(1); // fixed count (baseline fail, candidate pass)

    // McNemar is supplementary, not verdict-driving: the reported test that
    // drove the verdict is the bootstrap CI, and the verdict itself follows
    // the (heavily-diluted, zero-spanning) CI rather than any conclusion
    // McNemar's own discordant-pair asymmetry might suggest.
    expect(result.test).toBe('paired_bootstrap');
    expect(result.verdict).toBe('no_detectable_difference');
  });
});

// ===========================================================================
// Wiring checks: mdeCeiling and minPairedN, computed from REAL per-case
// difference variance (not the pure verdict.ts unit inputs Phase 1 already
// covers), must actually reach the verdict decision through computeComparison.
// ===========================================================================

describe('an-mde-above-the-ceiling-produces-insufficient-data-via-a-real-computed-mde-not-just-the-verdict-unit-test', () => {
  it('an-mde-above-the-ceiling-produces-insufficient-data-via-a-real-computed-mde-not-just-the-verdict-unit-test', () => {
    // 8 cases alternating +0.1/-0.1: mean difference 0, sample SD ~0.1069.
    // Independently, via the standard closed-form paired MDE formula
    // (z_0.975 + z_0.80) * SD/sqrt(n) = 2.8016 * 0.1069/2.8284 =~ 0.1059 --
    // this file does not assert that exact figure (it depends on the
    // implementation's own inverse-normal-CDF numerics, same caveat
    // mde.test.ts documents), only that a ceiling set comfortably below vs.
    // comfortably above ~0.106 flips the verdict as §5.4 requires.
    const paired: PairedCase[] = Array.from({ length: 8 }, (_, i) => {
      const diff = i % 2 === 0 ? 0.1 : -0.1;
      return pc(`case-${i}`, {
        baselineScore: 0.5,
        candidateScore: 0.5 + diff,
        difference: diff,
        baselinePassed: true,
        candidatePassed: true,
        critical: false,
      });
    });

    const belowCeiling = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 0.05, // well below ~0.106
      minPairedN: 1,
      bootstrapIterations: 2000,
    });
    expect(belowCeiling.mde).toBeGreaterThan(0.08);
    expect(belowCeiling.mde).toBeLessThan(0.13);
    expect(belowCeiling.verdict).toBe('insufficient_data');

    const aboveCeiling = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 0.3, // well above ~0.106
      minPairedN: 1,
      bootstrapIterations: 2000,
    });
    expect(aboveCeiling.verdict).toBe('no_detectable_difference');
  });
});

describe('a-paired-count-below-the-floor-produces-insufficient-data-via-computeComparison', () => {
  it('a-paired-count-below-the-floor-produces-insufficient-data-via-computeComparison', () => {
    const paired: PairedCase[] = Array.from({ length: 4 }, (_, i) =>
      pc(`case-${i}`, {
        baselineScore: 0.5,
        candidateScore: 0.5,
        difference: 0,
        baselinePassed: true,
        candidatePassed: true,
        critical: false,
      }),
    );

    const tooFew = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 1,
      minPairedN: 30,
      bootstrapIterations: 500,
    });
    expect(tooFew.pairedCaseCount).toBe(4);
    expect(tooFew.verdict).toBe('insufficient_data');

    const enough = computeComparison({
      paired,
      alpha: 0.05,
      mdeCeiling: 1,
      minPairedN: 4,
      bootstrapIterations: 500,
    });
    expect(enough.verdict).not.toBe('insufficient_data');
  });
});
