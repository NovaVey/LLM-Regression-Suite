/**
 * McNemar's test for paired binary (pass/fail) outcomes. See §5.2 of the
 * spec: "the correct paired test for dichotomous outcomes."
 *
 * ASSUMPTIONS:
 *
 * 1. Paired binary outcomes. `baselinePass[i]` and `candidatePass[i]` must
 *    describe the *same case i* run under each variant — this is only valid
 *    on already-paired data (§5.1: only cases present and valid in both
 *    runs). Passing unpaired or misaligned arrays produces a meaningless
 *    number that still looks like a p-value.
 * 2. Only discordant pairs carry information about change. A case that
 *    passed under both variants, or failed under both, tells you nothing
 *    about whether the change moved anything — it is evidence the two
 *    variants agree on that case, not evidence about the *difference*
 *    between them. McNemar's test is built around exactly this: it counts
 *    only the pairs that disagree.
 * 3. Independence across cases (not across variants — the whole point of
 *    pairing is that baseline and candidate are correlated on the same
 *    case). If cases are not independent of each other (e.g. duplicated or
 *    near-duplicated inputs in the dataset), the discordant-pair counts are
 *    inflated and the test is over-confident, same failure mode as the
 *    bootstrap's exchangeability assumption.
 * 4. The chi-square approximation requires enough discordant pairs to be
 *    meaningful; with b + c very small (single digits) the test has little
 *    power and the p-value should be read as indicative, not exact. See the
 *    continuity-correction note below.
 */

import { chiSquarePValueDf1 } from './normal-distribution.js';

export interface McNemarResult {
  /** Count of cases: baseline pass, candidate fail (discordant). */
  discordantB: number;
  /** Count of cases: baseline fail, candidate pass (discordant). */
  discordantC: number;
  /** Chi-square statistic (continuity-corrected — see note below). */
  statistic: number;
  pValue: number;
}

/**
 * Runs McNemar's test on paired pass/fail outcomes.
 *
 * Continuity correction: this implementation always applies Edwards'
 * continuity correction, i.e. statistic = (|b - c| - 1)^2 / (b + c) rather
 * than the uncorrected (b - c)^2 / (b + c). This is McNemar's test's
 * standard default (it's what R's `mcnemar.test` applies unless the caller
 * explicitly sets `correct = FALSE`) and it matters most exactly where this
 * tool will spend most of its time: eval suites in the tens-to-low-hundreds
 * of cases, where discordant-pair counts (b + c) are often well under 50.
 * The correction accounts for the fact that b - c is a discrete quantity
 * being approximated by a continuous chi-square distribution — without it,
 * the p-value is anti-conservative (too small) at small b + c. At large b +
 * c the correction's effect vanishes, so there is no downside at scale.
 * See docs/DECISIONS.md for the exact-binomial alternative that was
 * considered instead.
 */
export function mcnemarTest(
  baselinePass: boolean[],
  candidatePass: boolean[],
): McNemarResult {
  if (baselinePass.length !== candidatePass.length) {
    throw new Error(
      `mcnemarTest requires paired arrays of equal length (baseline=${baselinePass.length}, candidate=${candidatePass.length})`,
    );
  }
  const n = baselinePass.length;
  if (n === 0) {
    throw new Error('mcnemarTest requires at least one paired observation');
  }

  let discordantB = 0; // baseline pass, candidate fail
  let discordantC = 0; // baseline fail, candidate pass

  for (let i = 0; i < n; i++) {
    const base = baselinePass[i] as boolean;
    const cand = candidatePass[i] as boolean;
    if (base && !cand) {
      discordantB++;
    } else if (!base && cand) {
      discordantC++;
    }
    // Concordant pairs (base === cand) are intentionally not counted
    // anywhere — per assumption 2 above, they carry no information about
    // change and must not enter the statistic.
  }

  const discordantTotal = discordantB + discordantC;

  if (discordantTotal === 0) {
    // No discordant pairs at all: every case agreed between variants.
    // There is no evidence of any change, corrected or not.
    return { discordantB, discordantC, statistic: 0, pValue: 1 };
  }

  const statistic = Math.pow(Math.abs(discordantB - discordantC) - 1, 2) / discordantTotal;
  const pValue = chiSquarePValueDf1(statistic);

  return { discordantB, discordantC, statistic, pValue };
}
