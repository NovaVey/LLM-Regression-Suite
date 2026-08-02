/**
 * Verdict logic per §5.6. This is deliberately the only place in the repo
 * that turns numbers into one of the four words a human reads. It contains
 * no statistics of its own — it composes the outputs of bootstrap.ts,
 * mcnemar.ts, and mde.ts (plus the critical-case count computed elsewhere)
 * into a decision, and trusts its inputs: it does not recompute or sanity
 * check ciLower/ciUpper/mde, so a caller that passes an interval computed
 * from unpaired data or the wrong alpha will get a confidently wrong
 * verdict out of a function that looks correct.
 *
 * PRECEDENCE (this is the part most likely to be gotten wrong, so it is
 * spelled out here as well as in code — see §5.6's table plus the explicit
 * precedence rule this was implemented against):
 *
 *   1. `regression`                — ciUpper < 0, OR criticalRegressed > 0.
 *      This check runs FIRST and short-circuits everything below it. A
 *      critical-tagged case regressing fails the check "regardless of the
 *      aggregate statistic" (§5.6) — including regardless of whether the
 *      dataset was otherwise too small to trust (insufficient_data) or
 *      whether the aggregate CI looked fine. Concretely: if criticalRegressed
 *      > 0 and pairedN < minPairedN at the same time, the verdict is still
 *      `regression`, not `insufficient_data` — a critical case that broke is
 *      real signal on that one case regardless of how underpowered the
 *      aggregate statistic is on the rest of the suite.
 *   2. `insufficient_data`         — mde > mdeCeiling, OR pairedN < minPairedN.
 *      Checked only once regression has been ruled out. This must win over
 *      what the CI alone would otherwise suggest: a CI that happens to sit
 *      entirely above zero on 8 paired cases is not "improvement detected,"
 *      it is a dataset too small to trust, and this check makes sure that's
 *      reported honestly instead.
 *   3. `improvement_detected`      — ciLower > 0.
 *   4. `no_detectable_difference`  — otherwise (CI spans zero).
 *
 * ASSUMPTIONS / NON-NEGOTIABLES this function enforces by construction:
 *   - A `regression` verdict never comes from a CI that spans zero — the
 *     only CI-based path to `regression` requires the *entire* interval
 *     (including the upper bound) to be below zero.
 *   - `no_detectable_difference` and `insufficient_data` are kept distinct:
 *     the former means "we looked and found nothing," the latter means "we
 *     could not have found anything smaller than mdeCeiling even if it were
 *     there, or didn't have enough paired cases to look properly." Conflating
 *     them is exactly the failure this tool exists to avoid (§5.4).
 *   - This function never returns anything that could be read as "proven
 *     better" — `improvement_detected` is the strongest positive verdict
 *     that exists, and its name says "detected," not "proven" or "confirmed."
 */

export type Verdict =
  | 'regression'
  | 'no_detectable_difference'
  | 'improvement_detected'
  | 'insufficient_data';

export interface VerdictInput {
  ciLower: number;
  ciUpper: number;
  mde: number;
  mdeCeiling: number;
  pairedN: number;
  minPairedN: number;
  /** Count of critical-tagged cases that regressed candidate vs baseline. */
  criticalRegressed: number;
}

export function determineVerdict(input: VerdictInput): Verdict {
  const { ciLower, ciUpper, mde, mdeCeiling, pairedN, minPairedN, criticalRegressed } = input;

  // 1. Regression overrides everything else per §5.6, whether it comes from
  //    the aggregate CI being entirely below zero or from any critical case
  //    regressing (even a single one, even if the aggregate looks fine).
  if (ciUpper < 0 || criticalRegressed > 0) {
    return 'regression';
  }

  // 2. Insufficient data: this dataset either could not have detected an
  //    effect smaller than mdeCeiling, or simply doesn't have enough paired
  //    cases to trust a statistic on at all. Wins over whatever the CI alone
  //    would suggest, because a CI computed on too little data (or with too
  //    little power to matter) is not trustworthy evidence either way.
  if (mde > mdeCeiling || pairedN < minPairedN) {
    return 'insufficient_data';
  }

  // 3. The entire interval sits above zero: an improvement was detected.
  //    Never phrase this (here or in any caller) as "proven" — see the
  //    module comment above and §5.6.
  if (ciLower > 0) {
    return 'improvement_detected';
  }

  // 4. CI spans zero, dataset was adequate: honestly, nothing was found.
  return 'no_detectable_difference';
}
