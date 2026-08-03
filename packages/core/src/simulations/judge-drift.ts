/**
 * Judge drift — §6.4: "Take a calibrated judge, perturb the rubric wording,
 * re-run calibration, show kappa moving. Demonstrates that calibration is a
 * live constraint rather than a one-time formality."
 *
 * THIS IS A SYNTHETIC STAND-IN, NOT A SIMULATION OF A REAL LLM JUDGE'S
 * BEHAVIOUR. There is no real judge model callable in this build/CI
 * environment. "The judge" here is a noisy function of a case's true
 * human-labeled pass/fail, parameterized by a single scalar `accuracy` in
 * `[0, 1]` — the probability the judge agrees with the human label on a
 * given case (1 = perfect judge, 0.5 = coin flip, independent of any real
 * rubric wording or model behaviour). "Perturbing the rubric wording" is
 * modeled as changing `accuracy` between a "before" and "after" run: a
 * worse-written rubric is modeled as a judge that agrees with human labels
 * less often. This does not mechanistically simulate what an actual LLM
 * judge would do if you edited its prompt; it demonstrates the one thing
 * §6.4 actually asks to see — that the real `cohensKappa` (`../judge/kappa.js`)
 * genuinely responds to a real change in judge quality, rather than
 * calibration being a number computed once and never revisited.
 *
 * For `n` synthetic labeled outputs:
 *
 *   humanTruth_i  ~ Bernoulli(humanPassRate)
 *   judgeBefore_i = humanTruth_i with probability accuracyBefore, else !humanTruth_i
 *   judgeAfter_i  = humanTruth_i with probability accuracyAfter,  else !humanTruth_i
 *
 * `cohensKappa` is called once on `(humanTruth, judgeBefore)` and once on
 * `(humanTruth, judgeAfter)`.
 *
 * This file has no CLI verb (§7 lists only `llmreg simulate null|power|mde`)
 * — it is a library function plus tests only, per this contract's explicit
 * scope decision. No CLI wiring is added here.
 *
 * Fully deterministic given `seed`: the only randomness in this function is
 * `mulberry32(seed)`, drawn in a fixed order (truth, then judgeBefore
 * agreement, then judgeAfter agreement, per case) — unlike the other five
 * simulation files, this one never calls `computeComparison`/`bootstrapCI`,
 * so it has no exposure to that dependency's unseeded `Math.random()` (see
 * null-model.ts's module comment for that caveat, which does not apply
 * here).
 */

import type { KappaResult } from '../judge/kappa.js';
import { cohensKappa } from '../judge/kappa.js';
import { mulberry32 } from '../dataset/split.js';

export interface JudgeDriftParams {
  n: number;
  humanPassRate: number;
  accuracyBefore: number; // probability the "judge" agrees with the human label, before a rubric edit
  accuracyAfter: number; // same, after a rubric edit
  seed: number;
}

export interface JudgeDriftResult {
  n: number;
  before: KappaResult;
  after: KappaResult;
  kappaDelta: number; // after.cohensKappa - before.cohensKappa
}

export function runJudgeDriftSimulation(params: JudgeDriftParams): JudgeDriftResult {
  const { n, humanPassRate, accuracyBefore, accuracyAfter, seed } = params;

  const rand = mulberry32(seed);
  const humanTruth: boolean[] = new Array(n);
  const judgeBefore: boolean[] = new Array(n);
  const judgeAfter: boolean[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const truth = rand() < humanPassRate;
    humanTruth[i] = truth;

    const beforeAgrees = rand() < accuracyBefore;
    judgeBefore[i] = beforeAgrees ? truth : !truth;

    const afterAgrees = rand() < accuracyAfter;
    judgeAfter[i] = afterAgrees ? truth : !truth;
  }

  const before = cohensKappa(humanTruth, judgeBefore);
  const after = cohensKappa(humanTruth, judgeAfter);

  return {
    n,
    before,
    after,
    kappaDelta: after.cohensKappa - before.cohensKappa,
  };
}
