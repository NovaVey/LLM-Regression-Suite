/**
 * Wires the four Phase 1 statistics primitives (bootstrapCI, mcnemarTest,
 * minimumDetectableEffect, determineVerdict) to the §5.1 pairing output.
 * Pure function, zero I/O — same discipline as `packages/core/src/stats/*`
 * and `pairing.ts` above.
 *
 * WHAT DRIVES THE VERDICT (see docs/DECISIONS.md for the full reasoning):
 *
 * The verdict is always computed from the percentile bootstrap CI on the
 * vector of per-case differences (`paired_bootstrap`), because that is the
 * only Phase 1 primitive that produces the two-sided confidence interval
 * `determineVerdict()` requires, and because the `comparisons` table (§4)
 * has a single `test`/`p_value` pair, not one per statistical method. When
 * `pairedCaseCount > 0`, McNemar's test is ALWAYS additionally computed as
 * supplementary evidence over the same regressed/fixed counts
 * (`discordantB` = count of regressions, `discordantC` = count of fixes) —
 * it is reported on the result but never substituted for the bootstrap CI
 * in the verdict decision. `verdict.ts` has no signature for taking a
 * McNemar result as an alternative input, and building one was judged a
 * bigger interface change than this module should make unilaterally — see
 * DECISIONS.md if a future phase wants a McNemar-driven verdict path for
 * binary-only suites.
 *
 * REGRESSED / FIXED ARE DEFINED BY A PASS/FAIL FLIP, NOT RAW SCORE MOVEMENT:
 *
 *   regressed: baselinePassed === true  && candidatePassed === false
 *   fixed:     baselinePassed === false && candidatePassed === true
 *
 * A case whose score moved (0.9 -> 0.7) but whose pass/fail status did not
 * is not "regressed" in this module's vocabulary — §5.6's "a critical case
 * regressed" and §5.8's "Regressed cases table" sit right next to §5.2's
 * McNemar framing, which is explicitly about discordant pairs (pass->fail,
 * fail->pass), and using the same definition for both keeps
 * `criticalRegressed` a clean count (critical cases inside
 * `regressedExternalIds`) and keeps McNemar's b/c exactly equal to the
 * lengths of `regressedExternalIds`/`fixedExternalIds` — asserted as an
 * internal-consistency check in this module's own verification.
 *
 * THE pairedCaseCount === 0 EDGE CASE:
 *
 * `bootstrapCI` throws on an empty array by design (Phase 1: "requires at
 * least one difference"). When every case has been excluded from both
 * sides (§5.1), there is nothing to bootstrap, nothing to run McNemar on,
 * and no meaningful delta. This function short-circuits before calling any
 * Phase 1 primitive and returns:
 *
 *   - delta = 0, ciLower = 0, ciUpper = 0 — there is no data to estimate a
 *     nonzero point estimate or a nonzero interval from; reporting an
 *     interval "containing zero" here would look like a legitimate
 *     no-detectable-difference finding when in fact nothing was measured
 *     at all. 0/0/0 combined with verdict `insufficient_data` is the
 *     honest way to represent "we could not compute a comparison."
 *   - mde = Infinity, not 0. The MDE is "the smallest true difference this
 *     dataset could reliably detect" (§5.4). With zero paired cases, the
 *     dataset could not reliably detect ANY effect, no matter how large —
 *     the honest value for "cannot detect anything" is unboundedly large,
 *     not zero. Reporting 0 would claim perfect sensitivity, which is the
 *     exact opposite of the truth and the opposite failure direction from
 *     the one this tool exists to avoid (§5.4's whole point is that an
 *     under-reported MDE hides a suite's blind spots).
 *   - mcnemar = null, test = 'paired_bootstrap', pValue = null.
 *   - verdict = 'insufficient_data' (not `no_detectable_difference` — see
 *     the module comment on why those two are never conflated).
 *
 * A NOTE ON `pValue`: the percentile bootstrap as implemented in
 * `bootstrap.ts` returns a mean and two percentile bounds, not a p-value —
 * computing one would require access to the full vector of resampled
 * means, which `BootstrapResult` does not expose, and adding that is a
 * Phase 1 change out of this module's scope. Since the verdict (and hence
 * the `test` column) is always `paired_bootstrap` under the interpretation
 * above, the top-level `pValue` field is always `null`. McNemar's p-value
 * remains available on `mcnemar.pValue` — it is deliberately NOT copied up
 * into the top-level `pValue` field, because that field is understood (per
 * the `comparisons` table's single `test`/`p_value` pair) to describe the
 * test named in `test`, and smuggling McNemar's p-value in under a
 * `paired_bootstrap` label would misrepresent which test it belongs to.
 */

import type { Verdict } from '../stats/verdict.js';
import type { McNemarResult } from '../stats/mcnemar.js';
import { bootstrapCI } from '../stats/bootstrap.js';
import { mcnemarTest } from '../stats/mcnemar.js';
import { minimumDetectableEffect } from '../stats/mde.js';
import { determineVerdict } from '../stats/verdict.js';
import type { PairedCase } from './pairing.js';

/** Default statistical power used for MDE when the caller doesn't specify
 * one. No POWER env var exists in .env.example; 0.8 is the value the
 * spec's own prose uses everywhere it discusses power (§9 Phase 6:
 * "detect ... at ~80% rate"; §6.3: "the effect size the power curve
 * actually detects at ~80% rate"). */
const DEFAULT_POWER = 0.8;

export interface RegressionComparisonInput {
  paired: PairedCase[];
  /** SIGNIFICANCE_ALPHA, in (0,1). */
  alpha: number;
  mdeCeiling: number;
  minPairedN: number;
  bootstrapIterations: number;
  /** Defaults to 0.8 — see DEFAULT_POWER above. */
  power?: number;
  /** Forwarded to `bootstrapCI` — defaults to `Math.random` there. Only Phase 6's simulations pass this, for reproducible seeded runs; production call sites never set it. */
  rand?: () => number;
}

export interface ComparisonStats {
  pairedCaseCount: number;
  /** Bootstrap's point estimate: mean of the paired differences. */
  delta: number;
  ciLower: number;
  ciUpper: number;
  mde: number;
  verdict: Verdict;
  /** Paired cases where baselinePassed && !candidatePassed. */
  regressedExternalIds: string[];
  /** Paired cases where !baselinePassed && candidatePassed. */
  fixedExternalIds: string[];
  /** Count of regressedExternalIds whose `critical` is true. */
  criticalRegressed: number;
  /** null iff pairedCaseCount === 0 (nothing to compute over). */
  mcnemar: McNemarResult | null;
  test: 'paired_bootstrap' | 'mcnemar';
  pValue: number | null;
}

/**
 * Sample standard deviation (Bessel-corrected, n-1 denominator) of
 * `values`, given their mean. Matches the convention `bootstrap.test.ts`'s
 * analytic-interval check uses for the same quantity, so the MDE computed
 * here is comparable to that same check.
 *
 * Returns 0 for n < 2: with a single paired case there is no way to
 * estimate spread, and `minimumDetectableEffect` already treats SD === 0
 * as "any nonzero true effect would be detected with certainty" (mde=0).
 * That is a known artifact at n=1 documented in mde.ts, not something this
 * function tries to paper over — it is caught in practice by the
 * `pairedN < minPairedN` branch of `determineVerdict`, since any reasonable
 * `minPairedN` floor is well above 1. See docs/DECISIONS.md.
 */
function sampleStandardDeviation(values: number[], mean: number): number {
  const n = values.length;
  if (n < 2) {
    return 0;
  }
  let sumSquares = 0;
  for (const v of values) {
    sumSquares += (v - mean) ** 2;
  }
  return Math.sqrt(sumSquares / (n - 1));
}

export function computeComparison(input: RegressionComparisonInput): ComparisonStats {
  const { paired, alpha, mdeCeiling, minPairedN, bootstrapIterations } = input;
  const power = input.power ?? DEFAULT_POWER;
  const pairedCaseCount = paired.length;

  // Regressed/fixed are defined by a pass/fail flip (see module comment),
  // computed once and reused for the McNemar discordant counts below — this
  // is what keeps b/c and these lists in exact agreement by construction,
  // not by coincidence.
  const regressedExternalIds: string[] = [];
  const fixedExternalIds: string[] = [];
  let criticalRegressed = 0;
  for (const c of paired) {
    if (c.baselinePassed && !c.candidatePassed) {
      regressedExternalIds.push(c.externalId);
      if (c.critical) {
        criticalRegressed++;
      }
    } else if (!c.baselinePassed && c.candidatePassed) {
      fixedExternalIds.push(c.externalId);
    }
  }

  if (pairedCaseCount === 0) {
    // Nothing to bootstrap or run McNemar on — see module comment for why
    // each of these specific values (not just "some placeholder") was
    // chosen.
    return {
      pairedCaseCount: 0,
      delta: 0,
      ciLower: 0,
      ciUpper: 0,
      mde: Infinity,
      verdict: 'insufficient_data',
      regressedExternalIds,
      fixedExternalIds,
      criticalRegressed,
      mcnemar: null,
      test: 'paired_bootstrap',
      pValue: null,
    };
  }

  const differences = paired.map((c) => c.difference);
  const bootstrap =
    input.rand !== undefined
      ? bootstrapCI(differences, bootstrapIterations, alpha, input.rand)
      : bootstrapCI(differences, bootstrapIterations, alpha);
  const differenceSD = sampleStandardDeviation(differences, bootstrap.mean);
  const mde = minimumDetectableEffect(differenceSD, pairedCaseCount, alpha, power);

  const baselinePass = paired.map((c) => c.baselinePassed);
  const candidatePass = paired.map((c) => c.candidatePassed);
  const mcnemar = mcnemarTest(baselinePass, candidatePass);

  const verdict = determineVerdict({
    ciLower: bootstrap.ciLower,
    ciUpper: bootstrap.ciUpper,
    mde,
    mdeCeiling,
    pairedN: pairedCaseCount,
    minPairedN,
    criticalRegressed,
  });

  return {
    pairedCaseCount,
    delta: bootstrap.mean,
    ciLower: bootstrap.ciLower,
    ciUpper: bootstrap.ciUpper,
    mde,
    verdict,
    regressedExternalIds,
    fixedExternalIds,
    criticalRegressed,
    mcnemar,
    test: 'paired_bootstrap',
    pValue: null,
  };
}
