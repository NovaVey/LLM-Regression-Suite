/**
 * Cohen's kappa for judge calibration. See §5.5 of the spec: "Compute
 * Cohen's kappa between human and judge, plus raw agreement... Raw
 * agreement alone is not enough: on a task where 90% of cases pass, a judge
 * that says 'pass' unconditionally scores 90% agreement and knows nothing.
 * Kappa corrects for agreement expected by chance, which is exactly the
 * failure mode here."
 *
 * Pure function, zero I/O — same discipline as packages/core/src/stats/*.ts
 * (Phase 1) and packages/core/src/comparison/*.ts (Phase 4). This module
 * does not fetch labels, does not call the judge, does not touch the
 * database; it takes two paired boolean arrays and returns a number plus
 * the confusion matrix behind it.
 *
 * STANDARD (UNWEIGHTED, 2-CATEGORY) KAPPA, NOT A WEIGHTED/ORDINAL VARIANT.
 * §5.5 discusses agreement entirely in pass/fail terms (the 90%-pass
 * example above is a statement about a binary classifier), and the
 * `judge_calibrations`/`grades` schema (§4) stores a single `passed:
 * boolean` per grade alongside the continuous `score` — kappa here is
 * computed on that boolean, not on the raw score. See docs/DECISIONS.md for
 * why a continuous/ordinal-weighted kappa (e.g. quadratic-weighted, common
 * when scores are graded on an ordered multi-point scale) was considered
 * and rejected for this phase.
 *
 * ASSUMPTIONS:
 *
 * 1. `humanPassed[i]` and `judgePassed[i]` describe the SAME output — paired
 *    arrays, same length, same order, one entry per labeled output. Per
 *    §5.5, labels attach to `output_hash`, not `case_id`; matching human
 *    labels to judge grades by output hash (so a label never gets silently
 *    reused as ground truth for a different output the next variant
 *    produced) is the caller's job, not this function's — by the time
 *    arrays reach `cohensKappa`, the pairing must already be correct. This
 *    function has no way to check that and trusts the caller, exactly like
 *    `mcnemarTest` trusts that its inputs are already paired per-case.
 * 2. Independence across labeled outputs. If the sampled outputs are not
 *    independent (e.g. several are near-duplicates, or several come from
 *    the same underlying conversation), the effective sample size is
 *    smaller than `labelCount` suggests and kappa is more sensitive to
 *    those correlated cases than the raw count implies — the same failure
 *    mode documented for the bootstrap's exchangeability assumption and
 *    McNemar's independence assumption in docs/STATISTICS.md.
 * 3. Kappa answers "how much better than chance do human and judge agree,"
 *    not "is the judge correct." A judge and a human rubric can agree with
 *    each other very well (high kappa) while both being wrong about what
 *    the feature should actually do — kappa validates the judge against
 *    the human rubric, not against ground truth about the product.
 */

export interface ConfusionMatrix {
  /** Human passed, judge passed. */
  bothPass: number;
  /** Human passed, judge failed. */
  humanPassJudgeFail: number;
  /** Human failed, judge passed. */
  humanFailJudgePass: number;
  /** Human failed, judge failed. */
  bothFail: number;
}

export interface KappaResult {
  cohensKappa: number;
  /**
   * Raw agreement, (bothPass + bothFail) / n. Reported ALONGSIDE kappa per
   * §5.5, never as a substitute for it — see the module comment above and
   * the Pe===1 note below for exactly the case where the gap between these
   * two numbers matters most.
   */
  agreementRate: number;
  labelCount: number;
  confusionMatrix: ConfusionMatrix;
}

/**
 * Computes standard (unweighted) Cohen's kappa on paired PASS/FAIL
 * classifications.
 *
 * Formula:
 *   Po = observed agreement rate = (bothPass + bothFail) / n
 *   Pe = expected agreement by chance
 *      = (humanPassRate * judgePassRate) + (humanFailRate * judgeFailRate)
 *   kappa = (Po - Pe) / (1 - Pe)
 *
 * Throws if the two arrays differ in length (they must describe the same
 * outputs, in the same order) or if given an empty array (there is nothing
 * to compute agreement over — an empty calibration set is a caller bug, not
 * a valid zero-information kappa).
 *
 * DEGENERATE CASE — Pe === 1: this happens if and only if both raters are
 * unanimous in the identical direction across the *entire* sample (every
 * human label is "pass" and every judge label is "pass", or every human
 * label is "fail" and every judge label is "fail" — algebraically, Pe = 1 -
 * humanPassRate - judgePassRate + 2*humanPassRate*judgePassRate hits 1 only
 * at humanPassRate = judgePassRate = 1 or humanPassRate = judgePassRate =
 * 0). Whenever this holds, Po is *also* exactly 1 by construction (if both
 * raters say "pass" on every item, every item is a bothPass concordant
 * pair), so the raw formula divides 0 by 0 — this is a true mathematical
 * indeterminate, not merely "the denominator happens to be zero while the
 * numerator is some other number." No finite kappa is implied by the data;
 * a zero-variance sample never actually tested whether the judge can tell
 * pass from fail, because it never saw a fail.
 *
 * DECISION: this function returns `cohensKappa: 0` in that case, rather
 * than throwing or returning `NaN`/`1`. Reasoning, and the rejected
 * alternatives, are in docs/DECISIONS.md; in short: `JUDGE_KAPPA_FLOOR`
 * gates a judge into production, and a caller comparing a `number` against
 * that floor cannot safely handle `NaN` (NaN fails every comparison,
 * silently letting `kappa >= JUDGE_KAPPA_FLOOR` evaluate to `false` for the
 * wrong reason, or letting a careless `!(kappa < floor)` check silently let
 * it pass) or `1` (which would let a rubber-stamp-shaped calibration run —
 * one that happened to sample zero failing outputs — sail through the gate
 * looking like flawless agreement). Returning 0 fails the calibration gate
 * by default, which is the safe direction: the honest reading of "we never
 * saw a disagreement because we never saw a case where disagreement was
 * possible" is "this calibration proves nothing," and 0 is the value that
 * makes `checkCalibrationGate` treat it that way without special-casing.
 * `confusionMatrix` and `labelCount` are still returned in full, so a human
 * reading the result sees immediately *why* kappa is 0 (a matrix with only
 * `bothPass` or only `bothFail` populated is visibly different from one
 * with a real spread of disagreement) rather than treating the two
 * situations as the same finding.
 */
export function cohensKappa(humanPassed: boolean[], judgePassed: boolean[]): KappaResult {
  if (humanPassed.length !== judgePassed.length) {
    throw new Error(
      `cohensKappa requires paired arrays of equal length (human=${humanPassed.length}, judge=${judgePassed.length})`,
    );
  }
  const n = humanPassed.length;
  if (n === 0) {
    throw new Error('cohensKappa requires at least one labeled pair (n=0 given)');
  }

  let bothPass = 0;
  let humanPassJudgeFail = 0;
  let humanFailJudgePass = 0;
  let bothFail = 0;

  for (let i = 0; i < n; i++) {
    const human = humanPassed[i] as boolean;
    const judge = judgePassed[i] as boolean;
    if (human && judge) {
      bothPass++;
    } else if (human && !judge) {
      humanPassJudgeFail++;
    } else if (!human && judge) {
      humanFailJudgePass++;
    } else {
      bothFail++;
    }
  }

  const confusionMatrix: ConfusionMatrix = { bothPass, humanPassJudgeFail, humanFailJudgePass, bothFail };

  const agreementRate = (bothPass + bothFail) / n;

  const humanPassRate = (bothPass + humanPassJudgeFail) / n;
  const judgePassRate = (bothPass + humanFailJudgePass) / n;
  const humanFailRate = 1 - humanPassRate;
  const judgeFailRate = 1 - judgePassRate;

  const po = agreementRate;
  const pe = humanPassRate * judgePassRate + humanFailRate * judgeFailRate;

  // See the DEGENERATE CASE note above: Pe === 1 implies Po === 1 too
  // (0/0, a true indeterminate), and this is the only way Pe can reach 1.
  let cohensKappa: number;
  if (pe === 1) {
    cohensKappa = 0;
  } else {
    cohensKappa = (po - pe) / (1 - pe);
  }

  return { cohensKappa, agreementRate, labelCount: n, confusionMatrix };
}
