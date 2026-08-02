// Written from spec §5.2 and §9, and from the textbook definition of
// McNemar's test, WITHOUT reading src/stats/mcnemar.ts.
//
// §5.2: "For binary pass/fail metrics, also report McNemar's test, which is
// the correct paired test for dichotomous outcomes: it looks only at the
// discordant pairs -- cases that passed before and fail now, versus fail
// before and pass now -- and ignores the cases that agree. Concordant pairs
// carry no information about change and including them only dilutes the
// signal."
//
// Interface contract (given, not read from src):
//   interface McNemarResult { discordantB: number; discordantC: number; statistic: number; pValue: number }
//     discordantB = baseline pass, candidate fail  ("b" in the classic 2x2 table -- a regression)
//     discordantC = baseline fail, candidate pass  ("c" -- a fix)
//   function mcnemarTest(baselinePass: boolean[], candidatePass: boolean[]): McNemarResult
//
// KNOWN AMBIGUITY, flagged rather than silently resolved by reading the
// implementation: the spec does not say whether the statistic should apply
// Yates' continuity correction, chi2 = (|b-c|-1)^2/(b+c), or use the plain
// uncorrected form chi2 = (b-c)^2/(b+c). These differ substantially for
// small b+c (see the worked example below, where they differ by ~30%).
// This test originally asserted the UNCORRECTED form (see git history for
// the original reasoning). It disagreed with the implementation, which
// applies Edwards' continuity correction -- exactly the kind of disagreement
// this file predicted and asked to be resolved explicitly rather than
// papered over.
//
// RESOLVED by the main agent in favor of the CONTINUITY-CORRECTED form,
// matching the implementation. Reasoning (see docs/DECISIONS.md, Phase 1,
// "McNemar's test uses the continuity-corrected chi-square statistic,
// always" plus its resolution addendum): (a) it is the standard default for
// "McNemar's test" as commonly implemented (R's mcnemar.test() applies it
// unless correct=FALSE is passed explicitly), and (b) it is the
// conservative choice -- it does not inflate the false-positive rate at
// small discordant-pair counts, which is this project's single most
// important stated property (§6.1's null-model simulation must land near
// alpha=0.05, and "materially above that means the implementation is
// manufacturing regressions from noise"). The uncorrected form is
// anti-conservative at exactly the small-b+c regime this tool's target
// suite sizes (tens to low hundreds of cases, §11) will often sit in, which
// argues against it here specifically. Revisit if Phase 6's actual
// simulation suggests otherwise.

import { describe, it, expect } from 'vitest';
import { mcnemarTest } from '../../src/stats/mcnemar.js';

/** Build paired boolean arrays from 2x2 counts: a=both pass, b=baseline pass/candidate fail,
 * c=baseline fail/candidate pass, d=both fail. */
function buildPairs(a: number, b: number, c: number, d: number): { baselinePass: boolean[]; candidatePass: boolean[] } {
  const baselinePass: boolean[] = [];
  const candidatePass: boolean[] = [];
  for (let i = 0; i < a; i++) { baselinePass.push(true); candidatePass.push(true); }
  for (let i = 0; i < b; i++) { baselinePass.push(true); candidatePass.push(false); }
  for (let i = 0; i < c; i++) { baselinePass.push(false); candidatePass.push(true); }
  for (let i = 0; i < d; i++) { baselinePass.push(false); candidatePass.push(false); }
  return { baselinePass, candidatePass };
}

describe('mcnemar-matches-a-hand-computed-textbook-example', () => {
  it('mcnemar-matches-a-hand-computed-textbook-example', () => {
    // Worked example, n = 21 paired cases:
    //   a = 5  both baseline and candidate PASS      (concordant, ignored)
    //   b = 9  baseline PASS, candidate FAIL          (discordant, "regressed")
    //   c = 3  baseline FAIL, candidate PASS          (discordant, "fixed")
    //   d = 4  both baseline and candidate FAIL       (concordant, ignored)
    //
    // McNemar's chi-square statistic, CONTINUITY-CORRECTED (Edwards'
    // correction — see the resolution note above and docs/DECISIONS.md):
    //   chi2 = (|b - c| - 1)^2 / (b + c) = (|9 - 3| - 1)^2 / 12 = 25/12
    //        = 2.0833333333333335
    //
    // For 1 degree of freedom, a chi-square variate is the square of a
    // standard normal variate, so the (two-sided) upper-tail p-value is:
    //   p = P(chi2_1 > 2.0833...) = P(|Z| > sqrt(2.0833...))
    //     = 2 * (1 - Phi(sqrt(2.0833...))) = 0.14891476288202066
    // (independently re-derived by the main agent when resolving this file's
    // originally-flagged ambiguity, not copied from the implementation).
    //
    // For reference, the uncorrected form this test originally asserted:
    //   chi2 = (b - c)^2 / (b + c) = (9 - 3)^2 / 12 = 36/12 = 3.0, p ~= 0.0833
    // -- a materially different answer; see the resolution note above.
    const { baselinePass, candidatePass } = buildPairs(5, 9, 3, 4);

    const result = mcnemarTest(baselinePass, candidatePass);

    expect(result.discordantB).toBe(9);
    expect(result.discordantC).toBe(3);
    expect(result.statistic).toBeCloseTo(25 / 12, 6);
    expect(result.pValue).toBeCloseTo(0.14891476288202066, 5);
  });
});

describe('mcnemar-ignores-concordant-pairs', () => {
  it('mcnemar-ignores-concordant-pairs', () => {
    // Base dataset: a handful of discordant pairs (b=7, c=4) alongside a
    // modest number of concordant pairs (a=5, d=5). n = 21.
    const base = buildPairs(5, 7, 4, 5);
    const baseResult = mcnemarTest(base.baselinePass, base.candidatePass);

    // Sanity: this is itself a legitimate, non-trivial computation.
    // Continuity-corrected: statistic = (|7-4|-1)^2/(7+4) = 4/11 = 0.363636...
    // (uncorrected would be (7-4)^2/11 = 9/11 = 0.818181... — see the
    // resolution note at the top of this file for why corrected was chosen).
    expect(baseResult.discordantB).toBe(7);
    expect(baseResult.discordantC).toBe(4);
    expect(baseResult.statistic).toBeCloseTo(4 / 11, 9);

    // Same discordant counts, but with a large, ASYMMETRIC pile of extra
    // concordant pairs added on top (60 more "both pass", 45 more "both
    // fail" -- deliberately not equal, so nothing could cancel out by
    // coincidence). If concordant pairs are correctly ignored, the result
    // must be identical in every field: adding cases that carry no
    // information about a behaviour change must not move the statistic.
    const withManyMoreConcordant = buildPairs(5 + 60, 7, 4, 5 + 45);
    const extendedResult = mcnemarTest(withManyMoreConcordant.baselinePass, withManyMoreConcordant.candidatePass);

    expect(extendedResult).toEqual(baseResult);

    // Also check adding concordant pairs on only ONE side (only more
    // "both pass", none added to "both fail") -- still must not move
    // anything, ruling out a bug where only the *balance* of a and d
    // happens to cancel out rather than a and d being ignored outright.
    const onlyMoreConcordantPass = buildPairs(5 + 200, 7, 4, 5);
    const onlyMoreConcordantPassResult = mcnemarTest(onlyMoreConcordantPass.baselinePass, onlyMoreConcordantPass.candidatePass);
    expect(onlyMoreConcordantPassResult).toEqual(baseResult);

    const onlyMoreConcordantFail = buildPairs(5, 7, 4, 5 + 200);
    const onlyMoreConcordantFailResult = mcnemarTest(onlyMoreConcordantFail.baselinePass, onlyMoreConcordantFail.candidatePass);
    expect(onlyMoreConcordantFailResult).toEqual(baseResult);
  });
});
